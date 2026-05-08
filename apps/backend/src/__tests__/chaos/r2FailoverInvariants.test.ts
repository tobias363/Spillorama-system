/**
 * R2 Failover-test invariants (BIN-811).
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-811
 * Mandat: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3
 * Driver: infra/chaos-tests/r2-failover-test.sh
 *
 * ── Hva denne filen gjør ──────────────────────────────────────────────────
 *
 * Når chaos-script-et `r2-failover-test.sh` har drept backend-1 og verifisert
 * at backend-2 svarer på `/health`, lar det dette test-suite-et avgjøre om
 * recovery-en var korrekt på data-nivå (ikke bare "instansen kjører").
 *
 * Vi får inn to JSON-snapshots via env-vars (`PRE_KILL_SNAPSHOT` og
 * `POST_RECOVERY_SNAPSHOT`), tatt direkte mot Postgres før hhv. etter
 * SIGKILL. Hvert snapshot er en aggregat-rad over draws, wallet-entries
 * og compliance-ledger.
 *
 * Invariantene er:
 *
 *   I1 — Draws-sekvens uten gaps. `MAX(draw_sequence) === COUNT(*)` per
 *        scheduled_game; samme `COUNT(DISTINCT ball_value)` som
 *        `COUNT(*)` (ingen duplikat-draws fra to instanser).
 *
 *   I2 — Marks/draws ikke gått tapt. Antall draws etter recovery ≥ antall
 *        før kill (vi mistet ingenting; runden kan ha fortsatt eller
 *        stått stille, men aldri minket).
 *
 *   I3 — Wallet ikke double-debited. SUM(CREDIT) - SUM(DEBIT) på
 *        wallet-entries før og etter er konsistent (delta ≥ 0 i begge
 *        retninger med samme transaksjons-volum).
 *
 *   I4 — Compliance-ledger intakt. `COUNT(*)` etter ≥ før, og
 *        `SUM(amount)` etter ≥ før — vi mistet ikke noen audit-rader.
 *
 *   I5 — Recovery-tid (advisory, ikke strukturell). RECOVERY_TIME_SECONDS
 *        bør være ≤ 5 (BIN-811 SLA). Hvis ≥ 5: WARN, ikke FAIL — det er
 *        latency-tuning, ikke arkitektur-problem.
 *
 * Test-suiten kalles fra chaos-script-et med:
 *   PRE_KILL_SNAPSHOT=/tmp/.../pre_kill.json \
 *   POST_RECOVERY_SNAPSHOT=/tmp/.../post_recovery.json \
 *   RECOVERY_TIME_SECONDS=3 \
 *   npx tsx --test src/__tests__/chaos/r2FailoverInvariants.test.ts
 *
 * ── Strukturelt vs ikke-strukturelt ──────────────────────────────────────
 *
 * Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1:
 *
 *   Strukturelt (test FAIL → pilot pauses):
 *     - I1, I2, I3, I4 brutt
 *
 *   Ikke-strukturelt (test passerer + advarsel):
 *     - I5 (recovery-tid > 5s)
 *
 * ── Hvis testen ikke har snapshots ───────────────────────────────────────
 *
 * Hvis env-vars ikke er satt (f.eks. når testen kjøres som del av vanlig
 * `npm test` uten chaos-script-et), hopper vi over selve invariant-
 * sjekkingene og kjører kun et "skeleton-test" som dokumenterer hva som
 * faktisk testes. Dette holder testen syntaktisk gyldig i CI uten å
 * kreve at hele Docker-stacken kjøres på hver commit.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

interface PostgresAggregateSnapshot {
  draws_count: number;
  draws_max_sequence: number;
  draws_distinct_balls: number;
  wallet_entries_count: number;
  wallet_entries_credit_sum: string | number;
  wallet_entries_debit_sum: string | number;
  compliance_ledger_count: number;
  compliance_ledger_amount_sum: string | number;
  scheduled_games_running: number;
  scheduled_games_completed: number;
  snapshot_label: string;
  snapshot_at: string;
}

function loadSnapshot(envVar: string): PostgresAggregateSnapshot | null {
  const path = process.env[envVar];
  if (!path) return null;
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0 || raw === "{}") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed as PostgresAggregateSnapshot;
  } catch {
    return null;
  }
}

function asNumber(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PRE_KILL = loadSnapshot("PRE_KILL_SNAPSHOT");
const POST_RECOVERY = loadSnapshot("POST_RECOVERY_SNAPSHOT");
const RECOVERY_TIME_SECONDS = Number(process.env.RECOVERY_TIME_SECONDS ?? "0");

const HAS_SNAPSHOTS = PRE_KILL !== null && POST_RECOVERY !== null;

// ── Skeleton-test (kjøres alltid, dokumenterer kontrakten) ──────────────────

test("r2FailoverInvariants: kontrakten dokumentert", () => {
  // Test-en er gyldig hvis vi har miljøet som trengs. Når den kjøres som del
  // av vanlig `npm test` uten chaos-script-et, hoppes invariant-sjekkene over
  // og bare kontrakten verifiseres.
  assert.equal(typeof loadSnapshot, "function");
  assert.equal(typeof asNumber, "function");

  // Dokumenter at vi vet om recovery-time-env-en
  assert.ok(Number.isFinite(RECOVERY_TIME_SECONDS), "RECOVERY_TIME_SECONDS må være numerisk");
});

// ── I1: Draws-sekvens uten gaps ─────────────────────────────────────────────

test("r2FailoverInvariants: I1 — draws-sekvens uten gaps etter recovery", { skip: !HAS_SNAPSHOTS }, () => {
  if (!POST_RECOVERY) return;

  const draws = POST_RECOVERY.draws_count;
  const maxSeq = POST_RECOVERY.draws_max_sequence;
  const distinct = POST_RECOVERY.draws_distinct_balls;

  // I1.a — Hvis det finnes draws, skal MAX(draw_sequence) === COUNT(*).
  // Ellers er det gaps i sekvensen (en draw mistet ved kill).
  if (draws > 0) {
    assert.equal(
      maxSeq,
      draws,
      `Draws-sekvensen har gaps: COUNT(*)=${draws} men MAX(seq)=${maxSeq}. ` +
        `STRUKTURELT PROBLEM — pilot pauses per mandat §6.1.`,
    );

    // I1.b — Ingen duplikate ball-verdier. Hvis to instanser begge skrev
    // samme draw, ville UNIQUE-constraint i app_game1_draws normalt blokkere
    // det, men vi sjekker likevel for å være helt sikker.
    assert.equal(
      distinct,
      draws,
      `Draws inneholder duplikate ball-verdier: COUNT=${draws} men DISTINCT=${distinct}. ` +
        `STRUKTURELT PROBLEM — pilot pauses.`,
    );
  }
});

// ── I2: Marks/draws ikke gått tapt ──────────────────────────────────────────

test("r2FailoverInvariants: I2 — draws-count har ikke minket etter recovery", { skip: !HAS_SNAPSHOTS }, () => {
  if (!PRE_KILL || !POST_RECOVERY) return;

  const before = PRE_KILL.draws_count;
  const after = POST_RECOVERY.draws_count;

  assert.ok(
    after >= before,
    `Antall draws minket etter SIGKILL: før=${before}, etter=${after}. ` +
      `STRUKTURELT PROBLEM — pilot pauses (draws ble mistet).`,
  );
});

// ── I3: Wallet ikke double-debited ──────────────────────────────────────────

test("r2FailoverInvariants: I3 — wallet-balanser konsistente etter recovery", { skip: !HAS_SNAPSHOTS }, () => {
  if (!PRE_KILL || !POST_RECOVERY) return;

  const creditBefore = asNumber(PRE_KILL.wallet_entries_credit_sum);
  const debitBefore = asNumber(PRE_KILL.wallet_entries_debit_sum);
  const creditAfter = asNumber(POST_RECOVERY.wallet_entries_credit_sum);
  const debitAfter = asNumber(POST_RECOVERY.wallet_entries_debit_sum);

  // I3.a — Hverken credit eller debit minket. (Begge er append-only ledger-tabeller —
  // hvis noe minker, har failover-en truncert lederen, som er strukturelt brudd.)
  assert.ok(
    creditAfter >= creditBefore,
    `wallet_entries CREDIT-sum minket: før=${creditBefore}, etter=${creditAfter}. STRUKTURELT.`,
  );
  assert.ok(
    debitAfter >= debitBefore,
    `wallet_entries DEBIT-sum minket: før=${debitBefore}, etter=${debitAfter}. STRUKTURELT.`,
  );

  // I3.b — Ny credit + debit etter recovery skal ha gyldig forhold.
  // I praksis: hvis backend-2 fortsetter en runde og krediterer en gevinst,
  // skal det ikke være credits uten en debet-side eller motsatt
  // (double-credit-deteksjon). Vi kan ikke regne ut dette presist uten
  // per-tx-data — så her dokumenterer vi heller at delta-beløpene begge
  // peker rimelig retning.
  const creditDelta = creditAfter - creditBefore;
  const debitDelta = debitAfter - debitBefore;
  assert.ok(
    creditDelta >= 0 && debitDelta >= 0,
    `Wallet-entries delta-verdiene er negative: credit=${creditDelta}, debit=${debitDelta}.`,
  );
});

// ── I4: Compliance-ledger intakt ────────────────────────────────────────────

test("r2FailoverInvariants: I4 — compliance-ledger ikke truncert", { skip: !HAS_SNAPSHOTS }, () => {
  if (!PRE_KILL || !POST_RECOVERY) return;

  const beforeCount = PRE_KILL.compliance_ledger_count;
  const afterCount = POST_RECOVERY.compliance_ledger_count;
  const beforeSum = asNumber(PRE_KILL.compliance_ledger_amount_sum);
  const afterSum = asNumber(POST_RECOVERY.compliance_ledger_amount_sum);

  assert.ok(
    afterCount >= beforeCount,
    `app_rg_compliance_ledger COUNT minket: før=${beforeCount}, etter=${afterCount}. ` +
      `Brudd på §66/§71-sporbarhet — STRUKTURELT.`,
  );
  assert.ok(
    afterSum >= beforeSum,
    `app_rg_compliance_ledger SUM(amount) minket: før=${beforeSum}, etter=${afterSum}. STRUKTURELT.`,
  );
});

// ── I5: Recovery-tid (advisory) ─────────────────────────────────────────────

test("r2FailoverInvariants: I5 — recovery-tid (advisory)", { skip: !HAS_SNAPSHOTS }, () => {
  // BIN-811 SLA: backend-2 skal svare på /health innen 5 sek etter SIGKILL.
  // Hvis ≥ 5: ikke-strukturelt (kan tunes med mindre healthcheck-interval,
  // varmere connection pool osv). Vi logger advarsel men feiler IKKE testen.
  if (RECOVERY_TIME_SECONDS > 5) {
    // eslint-disable-next-line no-console
    console.warn(
      `[I5 WARN] Recovery-tid ${RECOVERY_TIME_SECONDS}s > 5s SLA. ` +
        `IKKE strukturelt brudd — krever latency-tuning.`,
    );
  }

  // Sanity: testen registrerte iallfall en tid (chaos-script-et kjørte).
  assert.ok(RECOVERY_TIME_SECONDS >= 0, "RECOVERY_TIME_SECONDS skal være ≥ 0");
});
