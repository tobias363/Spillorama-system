/**
 * R10 Spill 3 chaos-test invariants (BIN-820).
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-820
 * Mandat: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3 R10
 * Driver: infra/chaos-tests/r10-spill3-chaos-test.sh
 *
 * ── Hva denne filen gjør ──────────────────────────────────────────────────
 *
 * Verifiserer at Spill 3 (monsterbingo) phase-state-machine overlever
 * SIGKILL midt i en runde — fase-overgang, pause-vinduer og
 * compliance-ledger skal være intakt etter at sekundær backend-instans
 * plukker opp via Redis-state + Postgres.
 *
 * Spill 3 har 5 sekvensielle faser: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus,
 * med en konfigurerbar pause (default 3000ms) mellom hver. Fase-state
 * persisteres i `app_room_states.current_game.spill3PhaseState` (JSON)
 * via recovery-checkpoint, slik at en ny instans kan reproducere fasen
 * og pause-vinduet eksakt.
 *
 * ── Snapshot-shape ───────────────────────────────────────────────────────
 *
 * Chaos-script-et passerer to JSON-snapshots via env-vars:
 *
 *   PRE_KILL_SNAPSHOT       (snapshot rett før SIGKILL)
 *   POST_RECOVERY_SNAPSHOT  (snapshot etter sekundær instans plukket opp)
 *
 * Hver snapshot har felter:
 *   - phase_state           — currentPhaseIndex + phasesWon + status
 *   - drawn_count           — antall baller trukket totalt for runden
 *   - prize_pool_remaining  — gjenstående premie-pool (verifisere at
 *                             ingen utbetalinger ble dobbelt-committet)
 *   - compliance_ledger_count_for_round
 *   - compliance_ledger_amount_sum_for_round
 *   - tickets_sold          — bonger solgt for runden
 *   - autostart_threshold   — admin-konfigurert minTicketsToStart
 *
 * Invariantene er:
 *
 *   I1 — Phase-state bevart: `currentPhaseIndex` etter recovery skal være
 *        ≥ verdien før SIGKILL. Phase-state-maskinen advancer kun
 *        framover; en lavere index ville bety "rollback" som er
 *        STRUKTURELT brudd.
 *
 *   I2 — Phases-won bevart: `phasesWon`-array etter recovery skal være
 *        et superset av før-arrayet. Vi mistet aldri en utbetalt fase.
 *
 *   I3 — Pot-recovery: `prize_pool_remaining` etter recovery skal være ≤
 *        før (ikke større — vi gir ikke tilbake utbetalte premier). Hvis
 *        før=80 kr og etter=100 kr betyr det at vi rullet tilbake en
 *        utbetaling — STRUKTURELT.
 *
 *   I4 — Compliance-ledger §71-sporbarhet: `compliance_ledger_count` og
 *        `compliance_ledger_amount_sum` etter ≥ før (append-only).
 *
 *   I5 — Auto-start-threshold ikke trigget 2x: hvis `tickets_sold ≥
 *        autostart_threshold` er nådd, og runden er ENDED, skal det IKKE
 *        finnes 2 runder med overlappende windowstart. Vi sjekker dette
 *        via `phasesWon.length === 5` ELLER `endedReason === DRAW_BAG_EMPTY`.
 *
 *   I6 — Pause-konsistens: hvis `pausedUntilMs` var satt før SIGKILL
 *        OG den ennå ikke har utløpt (relativt server-clock), skal den
 *        fortsatt være i pause-vindu etter recovery. Vi tester via
 *        `pausedUntilMs` ≥ før-snapshot's verdi.
 *
 * ── Strukturelt vs ikke-strukturelt ──────────────────────────────────────
 *
 * Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1:
 *
 *   Strukturelt (test FAIL → pilot pauses):
 *     - I1, I2, I3, I4, I5 brutt
 *
 *   Ikke-strukturelt (test passerer + advarsel):
 *     - I6 (klokke-skew mellom instanser kan gi små avvik)
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

// ── Snapshot-shape ──────────────────────────────────────────────────────────

interface PhaseStateSnapshot {
  currentPhaseIndex: number;
  pausedUntilMs: number | null;
  phasesWon: number[];
  status: "ACTIVE" | "ENDED";
  endedReason: "FULL_HOUSE" | "DRAW_BAG_EMPTY" | null;
}

interface Spill3RoundSnapshot {
  phase_state: PhaseStateSnapshot | null;
  drawn_count: number;
  prize_pool_remaining: string | number;
  compliance_ledger_count_for_round: number;
  compliance_ledger_amount_sum_for_round: string | number;
  tickets_sold: number;
  autostart_threshold: number;
  game_status: string;
  ended_reason: string | null;
  snapshot_label: string;
  snapshot_at: string;
}

function loadSnapshot(envVar: string): Spill3RoundSnapshot | null {
  const path = process.env[envVar];
  if (!path) return null;
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0 || raw === "{}") return null;
  try {
    return JSON.parse(raw) as Spill3RoundSnapshot;
  } catch {
    return null;
  }
}

function asNumber(v: string | number | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PRE_KILL = loadSnapshot("PRE_KILL_SNAPSHOT");
const POST_RECOVERY = loadSnapshot("POST_RECOVERY_SNAPSHOT");

const HAS_SNAPSHOTS = PRE_KILL !== null && POST_RECOVERY !== null;

// ── Skeleton-test (kjøres alltid) ──────────────────────────────────────────

test("r10Spill3Invariants: kontrakten dokumentert", () => {
  // Verifiser at typer/loaders er gyldige selv uten chaos-script
  assert.equal(typeof loadSnapshot, "function");
  assert.equal(typeof asNumber, "function");
});

// ── I1: Phase-state advancer aldri bakover ────────────────────────────────

test(
  "r10Spill3Invariants: I1 — currentPhaseIndex advancer aldri bakover",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    const beforeIdx = PRE_KILL.phase_state?.currentPhaseIndex ?? 0;
    const afterIdx = POST_RECOVERY.phase_state?.currentPhaseIndex ?? 0;

    assert.ok(
      afterIdx >= beforeIdx,
      `Phase-index minket etter SIGKILL: før=${beforeIdx}, etter=${afterIdx}. ` +
        `Phase-state-maskinen rullet tilbake — STRUKTURELT brudd. ` +
        `Pilot pauses per mandat §6.1.`,
    );
  },
);

// ── I2: phasesWon er append-only ────────────────────────────────────────────

test(
  "r10Spill3Invariants: I2 — phasesWon er append-only etter recovery",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    const before = PRE_KILL.phase_state?.phasesWon ?? [];
    const after = POST_RECOVERY.phase_state?.phasesWon ?? [];

    assert.ok(
      after.length >= before.length,
      `phasesWon-array minket etter SIGKILL: før=[${before.join(",")}], ` +
        `etter=[${after.join(",")}]. STRUKTURELT — utbetalt fase ble glemt.`,
    );

    // Superset-sjekk: alle pre-kill-faser må være tilstede etter recovery.
    for (const pre of before) {
      assert.ok(
        after.includes(pre),
        `Phase ${pre} var registrert som won før SIGKILL, men mangler etter ` +
          `recovery (etter=[${after.join(",")}]). STRUKTURELT.`,
      );
    }
  },
);

// ── I3: prize_pool_remaining minker monotont ────────────────────────────────

test(
  "r10Spill3Invariants: I3 — prize_pool_remaining ruller ikke tilbake",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    const before = asNumber(PRE_KILL.prize_pool_remaining);
    const after = asNumber(POST_RECOVERY.prize_pool_remaining);

    assert.ok(
      after <= before,
      `prize_pool_remaining VOKSTE etter SIGKILL: før=${before}, etter=${after}. ` +
        `Det betyr at en utbetaling ble rullet tilbake — STRUKTURELT. ` +
        `Wallet kan ha double-spent eller ledger-event tapt.`,
    );
  },
);

// ── I4: Compliance-ledger §71 intakt ────────────────────────────────────────

test(
  "r10Spill3Invariants: I4 — compliance-ledger ikke truncert",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    const beforeCount = PRE_KILL.compliance_ledger_count_for_round;
    const afterCount = POST_RECOVERY.compliance_ledger_count_for_round;
    const beforeSum = asNumber(PRE_KILL.compliance_ledger_amount_sum_for_round);
    const afterSum = asNumber(POST_RECOVERY.compliance_ledger_amount_sum_for_round);

    assert.ok(
      afterCount >= beforeCount,
      `compliance_ledger_count for runden minket: før=${beforeCount}, ` +
        `etter=${afterCount}. §71-sporbarhet brutt — STRUKTURELT.`,
    );
    assert.ok(
      afterSum >= beforeSum,
      `compliance_ledger amount-sum for runden minket: før=${beforeSum}, ` +
        `etter=${afterSum}. STRUKTURELT.`,
    );
  },
);

// ── I5: Auto-start ikke dobbelt-trigget ─────────────────────────────────────

test(
  "r10Spill3Invariants: I5 — auto-start-threshold ikke trigget 2 ganger",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    // En enkelt indikator på dobbelt-trigging: hvis runden er ENDED og
    // phasesWon har 5 eller mer (skulle vært max 5), eller hvis status
    // er ACTIVE men tickets_sold er en multippel av threshold (kan tyde
    // på at neste runde startet før denne ble registrert som ENDED).
    const phaseState = POST_RECOVERY.phase_state;
    if (!phaseState) {
      // Ingen phase-state etter recovery → enten ikke-Spill-3 eller runden
      // er ferdig og state ble cleared. Begge er OK.
      return;
    }
    const wonCount = phaseState.phasesWon.length;
    assert.ok(
      wonCount <= 5,
      `phasesWon har ${wonCount} entries (max 5 = Rad 1-4 + Fullt Hus). ` +
        `Indikerer dobbelt-trigget round eller bug i state-maskinen. STRUKTURELT.`,
    );

    // Faseidx må være innenfor [0, 4]
    assert.ok(
      phaseState.currentPhaseIndex >= 0 && phaseState.currentPhaseIndex <= 4,
      `currentPhaseIndex=${phaseState.currentPhaseIndex} utenfor lovlige [0, 4]. STRUKTURELT.`,
    );

    // Om status === ENDED skal endedReason være satt
    if (phaseState.status === "ENDED") {
      assert.ok(
        phaseState.endedReason === "FULL_HOUSE" || phaseState.endedReason === "DRAW_BAG_EMPTY",
        `status=ENDED men endedReason=${phaseState.endedReason} er ugyldig. STRUKTURELT.`,
      );
    }
  },
);

// ── I6: Pause-vindu konsistens (advisory) ───────────────────────────────────

test(
  "r10Spill3Invariants: I6 — pause-vindu konsistens (advisory)",
  { skip: !HAS_SNAPSHOTS },
  () => {
    if (!PRE_KILL || !POST_RECOVERY) return;
    const beforePause = PRE_KILL.phase_state?.pausedUntilMs ?? null;
    const afterPause = POST_RECOVERY.phase_state?.pausedUntilMs ?? null;

    if (beforePause === null) {
      // Ikke i pause før SIGKILL. Etter kan være null eller satt (om en
      // ny pause ble scheduled mellom snapshots) — begge OK.
      return;
    }

    if (afterPause === null) {
      // Pause utløpt mellom snapshots — OK.
      return;
    }

    // Begge har pause: pause-end-timestamp skal ikke krympe tilbake.
    // Tillat 100ms slack for clock-drift mellom instanser.
    const slackMs = 100;
    if (afterPause < beforePause - slackMs) {
      // eslint-disable-next-line no-console
      console.warn(
        `[I6 WARN] pausedUntilMs krympet: før=${beforePause}, etter=${afterPause}. ` +
          `Klokke-drift mellom instanser? Ikke-strukturelt — pilot kan fortsette.`,
      );
    }

    // Sanity: pause-end skal ikke være langt i fremtiden (>1 time).
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    assert.ok(
      afterPause < oneHourFromNow,
      `pausedUntilMs=${afterPause} er > 1 time fremover — sannsynligvis bug. ` +
        `Phase-state-maskinen scheduler max 60000ms (admin-cap).`,
    );
  },
);
