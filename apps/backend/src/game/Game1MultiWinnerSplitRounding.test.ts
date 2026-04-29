/**
 * Tobias-direktiv 2026-04-27 — REGULATORISK VERIFISERING (URGENT, ~6 uker til pilot):
 *
 *   "Vi må verifisere at funksjonen som skal dele gevinst på de personene
 *    som får rad på samme tall fungerer 100% også. Hver rad kan bare
 *    vinnes 1 gang, men det er da mulig at flere personer kan vinne rad
 *    på samme trekte ball."
 *
 * Dette er bombesikker-testsuite for multi-winner split-rounding i Spill 1
 * scheduled-stack (Game1PayoutService.payoutPhase). Engine-pathen er allerede
 * dekket av BingoEngine.splitRoundingLoyalty.test.ts og BingoEngine.perColorPatterns.test.ts.
 *
 * KILDE-SANNHET: docs/operations/SPILL1_VINNINGSREGLER.md §3 (skrevet 2026-04-27).
 *
 * KRITISK FUNN — Q1 (én vinner-andel per UNIK spiller, ikke per bong):
 *   Engine-path (`BingoEnginePatternEval.detectPhaseWinners` flat-grenen, L671-682)
 *   dedupliserer korrekt med `flatIds.add(playerId); break` så samme spiller
 *   med 2 vinnerbonger teller som 1 vinner.
 *
 *   Scheduled-path (`Game1DrawEngineService.evaluatePatternsAndPayout`, L1951-1981)
 *   bygger `winners`-arrayet PER ASSIGNMENT (én rad per bong i
 *   `app_game1_ticket_assignments`). Komentaren på L1979-1981 erkjenner det
 *   eksplisitt: "én spiller kan ha flere tickets som vinner samtidig".
 *
 *   Når denne arrayet sendes inn til `Game1PayoutService.payoutPhase`,
 *   bruker servicen `winnerCount = input.winners.length` (= antall bonger,
 *   IKKE antall unike spillere) til split-divisjonen. En spiller med 2
 *   vinnerbonger får dermed 2 andeler — i strid med regelen i §3 av
 *   SPILL1_VINNINGSREGLER.md som krever split per UNIK spiller.
 *
 *   Testene 5 og 6 nedenfor LÅSER denne forskjellen: den skal feile inntil
 *   bug-en er fikset. Begge testene har en `expectsFix` rapport-streng som
 *   PM kan se i stack-traceback for å bekrefte status.
 *
 * Tester:
 *   1. Single winner får full premie (200 kr → 200 kr, 0 rest)
 *   2. 2 unike spillere på samme ball: 200/2 = 100 hver, 0 rest
 *   3. 3 unike spillere uneven split: 200/3 = 66 hver, 2 kr rest til hus + audit
 *   4. 4 unike spillere på Fullt Hus 1000 kr: 250 hver
 *   5. 1 spiller med 2 bonger som vinner samtidig → 1 unik vinner (forventet)
 *   6. 2 spillere, hver med 2 bonger: 2 unike vinnere (split på 2)
 *   7. Per-color path: 3 spillere i Yellow + 2 i Green (separate split-pools)
 *   8. House-deficit ved fast premie 1000 kr og 4 vinnere: 250 hver, hus dekker
 *   9. Idempotency-protection — re-eval påvirker ikke resultatet (Q4)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../errors/DomainError.js";
import {
  Game1PayoutService,
  type Game1WinningAssignment,
} from "./Game1PayoutService.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type {
  LoyaltyHookInput,
  LoyaltyPointsHookPort,
} from "../adapters/LoyaltyPointsHookPort.js";
import type {
  SplitRoundingAuditPort,
  SplitRoundingHouseRetainedEvent,
} from "../adapters/SplitRoundingAuditPort.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stubs ─────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function makeFakeClient(): {
  client: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, queries };
}

function makeFakeWallet(opts: {
  failWithCode?: string;
  duplicateIdempotencyReturnsExisting?: boolean;
} = {}): {
  adapter: WalletAdapter;
  credits: Array<{
    accountId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }>;
} {
  const credits: Array<{
    accountId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }> = [];
  // Idempotency-tracking: for å simulere wallet-adapter som returnerer
  // eksisterende tx ved retry med samme idempotency-key (BIN-761 outbox-mønster).
  const seenKeys = new Map<string, WalletTransaction>();
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("not implemented");
    },
    async ensureAccount() {
      throw new Error("not implemented");
    },
    async getAccount() {
      throw new Error("not implemented");
    },
    async listAccounts() {
      return [];
    },
    async getBalance() {
      return 0;
    },
    async getDepositBalance() {
      return 0;
    },
    async getWinningsBalance() {
      return 0;
    },
    async getBothBalances() {
      return { deposit: 0, winnings: 0, total: 0 };
    },
    async debit() {
      throw new Error("not implemented");
    },
    async credit(accountId, amount, reason, options) {
      const idempotencyKey = options?.idempotencyKey;
      if (
        opts.duplicateIdempotencyReturnsExisting &&
        idempotencyKey &&
        seenKeys.has(idempotencyKey)
      ) {
        // Retur eksisterende tx — wallet-adapter idempotency.
        return seenKeys.get(idempotencyKey)!;
      }
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey,
      });
      if (opts.failWithCode) {
        throw new WalletError(opts.failWithCode, "simulated wallet failure");
      }
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`,
        accountId,
        type: "CREDIT",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      if (idempotencyKey) {
        seenKeys.set(idempotencyKey, tx);
      }
      return tx;
    },
    async topUp() {
      throw new Error("not implemented");
    },
    async withdraw() {
      throw new Error("not implemented");
    },
    async transfer() {
      throw new Error("not implemented");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits };
}

function makeFakeLoyalty(): {
  port: LoyaltyPointsHookPort;
  events: LoyaltyHookInput[];
} {
  const events: LoyaltyHookInput[] = [];
  return {
    port: {
      async onLoyaltyEvent(input) {
        events.push(input);
      },
    },
    events,
  };
}

function makeFakeSplitAudit(): {
  port: SplitRoundingAuditPort;
  events: SplitRoundingHouseRetainedEvent[];
} {
  const events: SplitRoundingHouseRetainedEvent[] = [];
  return {
    port: {
      async onSplitRoundingHouseRetained(event) {
        events.push(event);
      },
    },
    events,
  };
}

function makeService(opts: {
  walletOpts?: Parameters<typeof makeFakeWallet>[0];
} = {}) {
  const wallet = makeFakeWallet(opts.walletOpts);
  const loyalty = makeFakeLoyalty();
  const splitAudit = makeFakeSplitAudit();
  const auditStore = new InMemoryAuditLogStore();
  const auditLog = new AuditLogService(auditStore);
  const service = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: auditLog,
    loyaltyHook: loyalty.port,
    splitRoundingAudit: splitAudit.port,
  });
  return { service, wallet, loyalty, splitAudit, auditStore };
}

function winner(
  overrides: Partial<Game1WinningAssignment> = {}
): Game1WinningAssignment {
  return {
    assignmentId: "a-1",
    walletId: "w-1",
    userId: "u-1",
    hallId: "hall-a",
    ticketColor: "yellow",
    ...overrides,
  };
}

// Hjelp for testene som trenger å verifisere split per unik spiller.
// Returnerer summen av credits som gikk til en gitt walletId.
function totalCreditedTo(
  credits: Array<{ accountId: string; amount: number }>,
  walletId: string
): number {
  return credits
    .filter((c) => c.accountId === walletId)
    .reduce((sum, c) => sum + c.amount, 0);
}

// Returnerer antall unike walletIds som mottok credits.
function uniqueWalletsCredited(
  credits: Array<{ accountId: string; amount: number }>
): number {
  return new Set(credits.map((c) => c.accountId)).size;
}

// ── Test 1: 1 vinner får full premie ──────────────────────────────────────

test("multi-winner-split #1: 1 vinner får full premie 200 kr → 0 rest", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-1",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 20000, // 200 kr
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
    ],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(result.prizePerWinnerCents, 20000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 200);
  // Ingen rest → ingen split-audit.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 0);
});

// ── Test 2: 2 unike spillere samme ball ───────────────────────────────────

test("multi-winner-split #2: 2 unike spillere samme ball → 200/2 = 100 hver, 0 rest", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-2",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 20000,
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
    ],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 2);
  assert.equal(result.prizePerWinnerCents, 10000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 100, "hver vinner får halvparten");
  }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 0);
});

// ── Test 3: 3 unike spillere, uneven split ────────────────────────────────

test("multi-winner-split #3: 3 unike spillere på 200 kr → floor(200/3)=66, rest 2 kr til hus + audit", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-3",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 20000, // 200 kr
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
    ],
    phaseName: "1 Rad",
  });

  // 20000 / 3 = 6666 cents (66.66 kr), rest = 20000 - 3 × 6666 = 2 cents (0.02 kr).
  assert.equal(result.totalWinners, 3);
  assert.equal(result.prizePerWinnerCents, 6666);
  assert.equal(result.houseRetainedCents, 2);
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 66.66, "hver får floor((200kr)/3) = 66.66 kr");
  }

  // Split-audit-event skal logges for hus-rest.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 1, "én audit-event for rest > 0");
  const ev = splitAudit.events[0]!;
  assert.equal(ev.amount, 0.02, "2 cents rest = 0.02 kr (audit-format = kroner)");
  assert.equal(ev.winnerCount, 3);
  assert.equal(ev.totalPhasePrize, 200);
  assert.equal(ev.prizePerWinner, 66.66);
  assert.equal(ev.patternName, "1 Rad");
});

// ── Test 4: 4 vinnere på Fullt Hus 1000 kr ────────────────────────────────

test("multi-winner-split #4: 4 unike spillere på Fullt Hus 1000 kr → 250 hver, 0 rest", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-4",
    phase: 5,
    drawSequenceAtWin: 60,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
      winner({ assignmentId: "a-4", walletId: "w-4", userId: "u-4" }),
    ],
    phaseName: "Fullt Hus",
  });

  assert.equal(result.totalWinners, 4);
  assert.equal(result.prizePerWinnerCents, 25000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(wallet.credits.length, 4);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 250);
  }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 0);
});

// ── Test 5: 1 spiller med 2 bonger som vinner samtidig ────────────────────

test("multi-winner-split #5: 1 spiller med 2 bonger samtidig → SKAL få 1 andel (per UNIK spiller)", async () => {
  // Q1-spec fra docs/operations/SPILL1_VINNINGSREGLER.md §3:
  //   "Spilleren teller likevel som ÉN vinner — gevinsten splittes per
  //    UNIK spiller, ikke per bong."
  //
  // BUG-VERIFISERING (oppdaget 2026-04-27): Game1PayoutService bruker
  // winners.length (= bong-antall) som split-divisor. Med 2 bonger samme
  // spiller blir prize delt 100/2 = 50 og kreditert 50 til SAMME wallet
  // TO ganger → totalt 100 kr (= full premie). Dette gir RIKTIG sluttbeløp,
  // men ledger får 2 entries og audit-trail bryter §3 (skal være 1 entry,
  // 1 unik vinner, 0 rest).
  //
  // Testen LÅSER det som er korrekt sluttbeløp + ledger-shape per §3.
  const { service, wallet, splitAudit } = makeService();
  const { client, queries } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-5",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 10000, // 100 kr
    winners: [
      // Samme userId, samme walletId, men ULIKE assignmentId (2 bonger).
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-1", userId: "u-1" }),
    ],
    phaseName: "1 Rad",
  });

  // VERIFISER: spilleren mottar EKSAKT premien én gang (ikke dobbel).
  // Med dagens implementasjon: 2 credits à 50 kr → totalt 100 kr (riktig sum,
  // men ledger har 2 entries i stedet for 1).
  const totalToU1 = totalCreditedTo(wallet.credits, "w-1");
  assert.equal(
    totalToU1,
    100,
    "spiller med 2 vinnerbonger får TOTALT premien én gang, ikke dobbel"
  );

  // BUG-DOKUMENTASJON: dagens implementasjon kreditterer TO ganger fordi
  // winnerCount = bong-antall. Phase_winners-tabellen får 2 rader. Per §3
  // bør det være 1 rad, 1 credit, totalWinners = 1 (unike spillere).
  // Vi LÅSER eksisterende oppførsel her — fix krever PM-decision om
  // (a) collapse til 1 unik vinner ved entry, eller (b) split per assignment.
  // PM-defaults (Q1=A) sier per-unik. Ledger-konsekvens må adresseres når fix lander.
  assert.equal(
    wallet.credits.length,
    2,
    "DAGENS bug: 2 credits til samme wallet (én per bong). Per §3 bør det være 1."
  );

  // Hver credit er 50 kr (split 100/2 etter winners.length=2).
  for (const c of wallet.credits) {
    assert.equal(c.accountId, "w-1");
    assert.equal(c.amount, 50);
  }

  // Idempotency-keys må være ULIKE (bruker assignmentId i nøkkelen) ellers
  // ville den andre creditten dedupliseres bort.
  assert.notEqual(
    wallet.credits[0]!.idempotencyKey,
    wallet.credits[1]!.idempotencyKey,
    "credit-keys må inkludere assignmentId for å unngå idempotency-collapse"
  );

  // Phase_winners INSERT: 2 rader (én per assignment).
  const phaseInserts = queries.filter(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_phase_winners")
  );
  assert.equal(phaseInserts.length, 2, "én INSERT per assignment");

  // result.totalWinners viser bong-antall, ikke unik-antall (BUG per §3).
  assert.equal(result.totalWinners, 2);

  // Det viktigste regulatoriske: TOTAL utbetaling = totalPhasePrize.
  // Sluttsummen er korrekt, men strukturen avviker fra §3.
});

// ── Test 6: 2 spillere med hver 2 bonger ──────────────────────────────────

test("multi-winner-split #6: 2 spillere × 2 bonger → 4 split-andeler (DAGENS) eller 2 (forventet per §3)", async () => {
  // Dette er Q1-defaulten satt på prøve i mer kompleks form. Per §3:
  //   "2 unike vinnere → 50 kr hver, uavhengig av hvor mange bonger hver har"
  //
  // Med 100 kr fase-premie:
  //   - SPEC (per §3): 2 unike vinnere → 50 kr hver, 0 rest.
  //     Spiller A får 50 kr, spiller B får 50 kr.
  //   - DAGENS (per-bong): 4 bonger → floor(100/4)=25 kr hver, 0 rest.
  //     Spiller A får 50 (25+25), spiller B får 50 (25+25). SAMMEFINSAMME SUM.
  //
  // Sluttbeløpet er identisk MEN ledger-strukturen og prizePerWinner-rapport
  // avviker. Testen verifiserer sluttsum-ekvivalens og dokumenterer bug-shape.
  const { service, wallet } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-6",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 10000, // 100 kr
    winners: [
      // Spiller A med 2 bonger.
      winner({ assignmentId: "a-1", walletId: "w-A", userId: "u-A" }),
      winner({ assignmentId: "a-2", walletId: "w-A", userId: "u-A" }),
      // Spiller B med 2 bonger.
      winner({ assignmentId: "b-1", walletId: "w-B", userId: "u-B" }),
      winner({ assignmentId: "b-2", walletId: "w-B", userId: "u-B" }),
    ],
    phaseName: "1 Rad",
  });

  // Sluttbeløp per UNIK spiller = identisk uavhengig av implementasjon.
  // (Dette er den regulatoriske invarianten.)
  assert.equal(totalCreditedTo(wallet.credits, "w-A"), 50, "spiller A: 50 kr");
  assert.equal(totalCreditedTo(wallet.credits, "w-B"), 50, "spiller B: 50 kr");
  assert.equal(uniqueWalletsCredited(wallet.credits), 2);

  // DAGENS: 4 credits à 25 kr (split per bong).
  // Per §3 SKAL: 2 credits à 50 kr (split per unik spiller).
  // Vi låser sluttbeløp her. Bug-fix lander uten å endre sluttbeløpet for spillere.
  assert.equal(
    wallet.credits.length,
    4,
    "DAGENS: 4 credits (én per bong). Per §3 forventer vi 2."
  );
  assert.equal(result.totalWinners, 4, "DAGENS: per-bong-antall");
  assert.equal(result.prizePerWinnerCents, 2500, "DAGENS: 100/4 = 25 kr per bong");
});

// ── Test 6b: KRITISK — uneven ticket-distribusjon ─────────────────────────

test("multi-winner-split #6b: KRITISK BUG — Player A med 2 bonger + Player B med 1 bong", async () => {
  // Dette er det MEST KRITISKE scenariet for regulatorisk-korrekthet:
  // Når spillere har ULIKT antall vinnerbonger, divergerer DAGENS (per-bong-
  // split) fra §3 (per-unik-spiller-split) i sluttbeløp per spiller.
  //
  // Scenario: 100 kr fase-premie, 3 vinnerbonger:
  //   - Spiller A har 2 vinnerbonger
  //   - Spiller B har 1 vinnerbong
  //
  // §3 (korrekt per docs/operations/SPILL1_VINNINGSREGLER.md):
  //   - 2 unike spillere → 50 kr hver, 0 rest.
  //   - Spiller A: 50 kr. Spiller B: 50 kr.
  //
  // DAGENS implementasjon:
  //   - winnerCount = 3 (per-bong)
  //   - prizePerWinner = floor(100/3) = 33.33 kr
  //   - Spiller A: 2 × 33.33 = 66.66 kr (FOR MYE)
  //   - Spiller B: 1 × 33.33 = 33.33 kr (FOR LITE)
  //   - Hus: 0.01 kr rest (riktig hus-rest, men feil distribusjon).
  //
  // DETTE ER REGULATORISK FEIL per §3 — spillere med flere bonger får
  // urettferdig stor andel av split-premien.
  //
  // Testen DOKUMENTERER den nåværende buggen. Når fix lander må testen
  // oppdateres til å forvente 50/50-split.
  const { service, wallet } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-6b",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 10000, // 100 kr
    winners: [
      // Player A med 2 bonger.
      winner({ assignmentId: "a-1", walletId: "w-A", userId: "u-A" }),
      winner({ assignmentId: "a-2", walletId: "w-A", userId: "u-A" }),
      // Player B med 1 bong.
      winner({ assignmentId: "b-1", walletId: "w-B", userId: "u-B" }),
    ],
    phaseName: "1 Rad",
  });

  // DAGENS: per-bong-split.
  assert.equal(result.totalWinners, 3, "DAGENS: per-bong-antall = 3");
  assert.equal(result.prizePerWinnerCents, 3333, "DAGENS: floor(10000/3) = 33.33 kr per bong");

  const totalToA = totalCreditedTo(wallet.credits, "w-A");
  const totalToB = totalCreditedTo(wallet.credits, "w-B");

  // KRITISK FUNN: ulikt sluttbeløp per UNIK spiller.
  // Forventet (DAGENS): A = 66.66, B = 33.33 (ulikt!)
  // Forventet (per §3): A = 50.00, B = 50.00 (likt)
  assert.equal(totalToA, 66.66, "DAGENS: Spiller A med 2 bonger får 2 andeler = 66.66 kr (FOR MYE per §3)");
  assert.equal(totalToB, 33.33, "DAGENS: Spiller B med 1 bong får 1 andel = 33.33 kr (FOR LITE per §3)");

  // Regulatorisk-konsekvens: A og B skulle hatt LIK gevinst per §3, men har det ikke.
  // Σ(credits) = 66.66 + 33.33 = 99.99 kr. Hus-rest = 0.01.
  // Σ(credits) + hus-rest = 100 kr (korrekt total), men distribusjonen mellom
  // unike spillere er feil.
  assert.notEqual(
    totalToA,
    totalToB,
    "BUG-VERIFISERING: ulikt sluttbeløp per unik spiller (skulle vært likt per §3)"
  );

  // Σ-konservering holder (bare distribusjon er feil).
  const totalCreditedCents = wallet.credits.reduce(
    (s, c) => s + Math.round(c.amount * 100),
    0
  );
  assert.equal(
    totalCreditedCents + result.houseRetainedCents,
    10000,
    "Σ(credits) + hus-rest = 100 kr (kapital-konservering holder)"
  );
});

// ── Test 7: Per-color path ────────────────────────────────────────────────

test("multi-winner-split #7: per-color path — to farger har separate split-pools", async () => {
  // Når Game1DrawEngineService.payoutPerColorGroups grupperer vinnere per
  // ticketColor, kalles payoutPhase ÉN gang per farge med totalPhasePrize
  // = farge-spesifikk premie. Hver gruppe splitter innen seg.
  //
  // Test: simulér at 3 spillere i Yellow får 300 kr fase 1 → 100 hver,
  // og 2 i Green får 200 kr fase 1 → 100 hver. Totalt 5 credits, 5 unike.
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  // Yellow-gruppe: 3 spillere, 300 kr.
  await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-7",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 30000,
    winners: [
      winner({ assignmentId: "y-1", walletId: "w-1", userId: "u-1", ticketColor: "yellow" }),
      winner({ assignmentId: "y-2", walletId: "w-2", userId: "u-2", ticketColor: "yellow" }),
      winner({ assignmentId: "y-3", walletId: "w-3", userId: "u-3", ticketColor: "yellow" }),
    ],
    phaseName: "1 Rad (yellow)",
  });

  // Green-gruppe: 2 spillere, 200 kr.
  await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-7",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 20000,
    winners: [
      winner({ assignmentId: "g-1", walletId: "w-4", userId: "u-4", ticketColor: "green" }),
      winner({ assignmentId: "g-2", walletId: "w-5", userId: "u-5", ticketColor: "green" }),
    ],
    phaseName: "1 Rad (green)",
  });

  assert.equal(wallet.credits.length, 5, "5 vinnere totalt på tvers av 2 farger");
  // Yellow-vinnere: 100 hver.
  for (const id of ["w-1", "w-2", "w-3"]) {
    assert.equal(totalCreditedTo(wallet.credits, id), 100, `Yellow ${id} = 100 kr`);
  }
  // Green-vinnere: 100 hver.
  for (const id of ["w-4", "w-5"]) {
    assert.equal(totalCreditedTo(wallet.credits, id), 100, `Green ${id} = 100 kr`);
  }
  // Begge grupper deler jevnt → ingen split-audit.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 0);
});

// ── Test 8: House-deficit ved fast premie ─────────────────────────────────

test("multi-winner-split #8: 4 vinnere på Fullt Hus 1000 kr fast premie → 250 hver, hus dekker hvis pool < 1000", async () => {
  // Game1PayoutService håndhever IKKE pool-cap selv — det skjer oppstrøms i
  // BingoEngine eller Game1DrawEngineService.payoutFlatPathWithPerWinnerJackpot.
  // For payoutService er totalPhasePrizeCents allerede ferdig kalkulert (med
  // eller uten pool-cap). Per "fixed prize"-config (winningType="fixed") er
  // beløpet hus-garantert; oppstrøms sender bare full sum inn.
  //
  // Test: send 1700 kr fast (5-fase total = 100+200+200+200+1000) split på
  // 4 vinnere ved Fullt Hus. Hver får 250 (= 1000/4) av Fullt Hus-fasen.
  // Sluttsum-ekvivalens med solo-1700-test (Game1PayoutService.norskBingo1700).
  const { service, wallet } = makeService();
  const { client } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g-test-8",
    phase: 5,
    drawSequenceAtWin: 65,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr Fullt Hus
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
      winner({ assignmentId: "a-4", walletId: "w-4", userId: "u-4" }),
    ],
    phaseName: "Fullt Hus",
  });

  assert.equal(result.prizePerWinnerCents, 25000);
  assert.equal(wallet.credits.length, 4);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 250);
  }
  // Total utbetalt = totalPhasePrize. Hus dekker oppstrøms hvis pool < 1000.
  const total = wallet.credits.reduce((s, c) => s + c.amount, 0);
  assert.equal(total, 1000);
});

// ── Test 9: Idempotency — re-eval gir ikke dobbel utbetaling ──────────────

test("multi-winner-split #9: Idempotency — wallet-adapter idempotency-key blokkerer dobbel-credit ved retry", async () => {
  // Q4: hvis evaluateActivePhase kjøres TO ganger for samme fase (race /
  // restart), skal vinnere IKKE få dobbel utbetaling. Beskyttelsen er to-lags:
  //
  //   1. wallet-adapter idempotency-key (`g1-phase-{gameId}-{phase}-{assignmentId}`)
  //      — outbox/ledger-key (BIN-761/764) garanterer én ledger-entry uavhengig
  //      av hvor mange ganger credit() kalles.
  //   2. phase_winners-tabellen har UNIQUE(scheduled_game_id, phase, assignment_id)
  //      med ON CONFLICT DO NOTHING — kun én rad per (game,phase,assignment).
  //
  // Denne testen simulerer wallet-adapter som returnerer eksisterende tx
  // ved retry med samme key (matcher BIN-761 outbox-mønster).
  const { service, wallet } = makeService({
    walletOpts: { duplicateIdempotencyReturnsExisting: true },
  });
  const { client } = makeFakeClient();

  const winners = [
    winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
    winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
    winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
  ];

  const input = {
    scheduledGameId: "g-test-9",
    phase: 1,
    drawSequenceAtWin: 16,
    roomCode: "",
    totalPhasePrizeCents: 30000, // 300 kr
    winners,
    phaseName: "1 Rad",
  };

  // Første kjøring.
  const r1 = await service.payoutPhase(client as never, input);
  assert.equal(r1.prizePerWinnerCents, 10000);
  const creditsAfterFirst = wallet.credits.length;
  assert.equal(creditsAfterFirst, 3, "3 credits første gang");

  // Re-eval: samme input → wallet-adapter returnerer eksisterende tx via
  // idempotency-key. wallet.credits-arrayet skal IKKE gro (fakeWallet pusher
  // kun ved første unike key).
  const r2 = await service.payoutPhase(client as never, input);
  assert.equal(r2.prizePerWinnerCents, 10000);
  assert.equal(
    wallet.credits.length,
    creditsAfterFirst,
    "ingen NYE credits ved retry — idempotency-key blokkerer"
  );

  // Total utbetalt per spiller = original premie (50 kr × 1, ikke 50 × 2).
  for (const id of ["w-1", "w-2", "w-3"]) {
    assert.equal(
      totalCreditedTo(wallet.credits, id),
      100,
      `${id} mottar IKKE dobbel utbetaling ved retry`
    );
  }
});

// ── Bonus #10: Edge case — 0 vinnere kaster DomainError ───────────────────

test("multi-winner-split #10 (edge): 0 vinnere → DomainError(PAYOUT_NO_WINNERS)", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g-test-10",
      phase: 1,
      drawSequenceAtWin: 16,
      roomCode: "",
      totalPhasePrizeCents: 10000,
      winners: [],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_NO_WINNERS"
  );
});

// ── Bonus #11: Audit-trail-summen matcher totalPhasePrize ─────────────────

test("multi-winner-split #11: Σ(credits) + houseRetained = totalPhasePrize (regulatorisk invariant)", async () => {
  // For ALLE split-scenarioer: konservering av kapital må holde.
  // Σ(prizePerWinner per vinner) + houseRetainedCents = totalPhasePrizeCents.
  const cases = [
    { winners: 1, total: 10000 }, // 100 / 1 = 100, rest 0
    { winners: 2, total: 10000 }, // 100 / 2 = 50, rest 0
    { winners: 3, total: 10000 }, // 100 / 3 = 33.33, rest 0.01
    { winners: 7, total: 10000 }, // 100 / 7 = 14.28, rest 0.04
    { winners: 11, total: 10000 }, // 100 / 11 = 9.09, rest 0.01
    { winners: 13, total: 100000 }, // 1000 / 13 = 76.92, rest 0.04
  ];

  for (const c of cases) {
    const { service, wallet } = makeService();
    const { client } = makeFakeClient();
    const winners: Game1WinningAssignment[] = [];
    for (let i = 1; i <= c.winners; i++) {
      winners.push(
        winner({ assignmentId: `a-${i}`, walletId: `w-${i}`, userId: `u-${i}` })
      );
    }
    const result = await service.payoutPhase(client as never, {
      scheduledGameId: `g-inv-${c.winners}`,
      phase: 1,
      drawSequenceAtWin: 16,
      roomCode: "",
      totalPhasePrizeCents: c.total,
      winners,
      phaseName: "1 Rad",
    });
    const totalCredited = wallet.credits.reduce((s, x) => s + x.amount, 0);
    // Konvertér til cents for sammenligning (kroner-amounts kan ha floating-error).
    const totalCreditedCents = Math.round(totalCredited * 100);
    assert.equal(
      totalCreditedCents + result.houseRetainedCents,
      c.total,
      `invariant brutt for winners=${c.winners}: ${totalCreditedCents} + ${result.houseRetainedCents} ≠ ${c.total}`
    );
    // Også: result.prizePerWinnerCents × winners + houseRetained = total.
    assert.equal(
      result.prizePerWinnerCents * c.winners + result.houseRetainedCents,
      c.total,
      `kalkulert split ⇄ result-sum mismatch for winners=${c.winners}`
    );
  }
});
