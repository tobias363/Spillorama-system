/**
 * GAME1_SCHEDULE PR 4c Bolk 2: Tester for Game1PayoutService.
 *
 * Dekker:
 *   - Single winner: wallet.credit + phase_winners INSERT + audit
 *   - Multi-winner split-rounding: floor(total/N), rest audites
 *   - Jackpot-beløp: lagres men kaller ikke loyalty-hook separat
 *   - Wallet.credit-feil → DomainError(PAYOUT_WALLET_CREDIT_FAILED)
 *   - Ingen vinnere → DomainError(PAYOUT_NO_WINNERS)
 *   - Ugyldig fase → DomainError(PAYOUT_INVALID_PHASE)
 *   - Loyalty-hook-feil påvirker ikke payout (fire-and-forget)
 *   - Split-rounding audit-event har korrekt amount + kroner-konvertering
 *   - Zero prize (jackpot=0, totalPhasePrize=0) hopper wallet.credit
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1PayoutService, type Game1WinningAssignment } from "./Game1PayoutService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type {
  LoyaltyPointsHookPort,
  LoyaltyHookInput,
} from "../adapters/LoyaltyPointsHookPort.js";
import type {
  SplitRoundingAuditPort,
  SplitRoundingHouseRetainedEvent,
} from "../adapters/SplitRoundingAuditPort.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function makeFakeClient(): {
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
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

function makeFakeWallet(opts: { failWithCode?: string; failReason?: "wallet-error" | "plain-error" } = {}): {
  adapter: WalletAdapter;
  credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
} {
  const credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }> = [];
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
    async debit() {
      throw new Error("not implemented");
    },
    async credit(accountId, amount, reason, options) {
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey: options?.idempotencyKey,
      });
      if (opts.failWithCode) {
        if (opts.failReason === "plain-error") {
          throw new Error("simulated plain error");
        }
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

function makeFakeLoyalty(opts: { throwOnWin?: boolean } = {}): {
  port: LoyaltyPointsHookPort;
  events: LoyaltyHookInput[];
} {
  const events: LoyaltyHookInput[] = [];
  const port: LoyaltyPointsHookPort = {
    async onLoyaltyEvent(input) {
      events.push(input);
      if (opts.throwOnWin && input.kind === "game.win") {
        throw new Error("simulated loyalty outage");
      }
    },
  };
  return { port, events };
}

function makeFakeSplitAudit(): {
  port: SplitRoundingAuditPort;
  events: SplitRoundingHouseRetainedEvent[];
} {
  const events: SplitRoundingHouseRetainedEvent[] = [];
  const port: SplitRoundingAuditPort = {
    async onSplitRoundingHouseRetained(event) {
      events.push(event);
    },
  };
  return { port, events };
}

function makeService(opts: {
  walletOpts?: Parameters<typeof makeFakeWallet>[0];
  loyaltyOpts?: Parameters<typeof makeFakeLoyalty>[0];
} = {}) {
  const wallet = makeFakeWallet(opts.walletOpts);
  const loyalty = makeFakeLoyalty(opts.loyaltyOpts);
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

function winner(overrides: Partial<Game1WinningAssignment> = {}): Game1WinningAssignment {
  return {
    assignmentId: "a-1",
    walletId: "w-1",
    userId: "u-1",
    hallId: "hall-a",
    ticketColor: "yellow",
    ...overrides,
  };
}

// ── Happy-path tester ──────────────────────────────────────────────────────

test("payoutPhase: single winner får hele potten", async () => {
  const { service, wallet, loyalty, splitAudit, auditStore } = makeService();
  const { client, queries } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000, // 500 kr
    winners: [winner()],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(result.prizePerWinnerCents, 50000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(result.winnerRecords.length, 1);
  assert.equal(result.winnerRecords[0]!.prizeCents, 50000);
  assert.equal(result.winnerRecords[0]!.jackpotCents, 0);
  assert.ok(result.winnerRecords[0]!.walletTransactionId);

  // wallet.credit ble kalt med 500 (kroner, ikke øre).
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 500);
  assert.equal(wallet.credits[0]!.accountId, "w-1");
  assert.ok(wallet.credits[0]!.idempotencyKey?.includes("g1"));

  // phase_winners INSERT skjedde.
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert, "INSERT phase_winners skal skje");
  // params[6] = phase = 1, params[7] = prize_amount_cents = 50000
  assert.equal(phaseInsert!.params[5], 1);
  assert.equal(phaseInsert!.params[7], 50000);

  // Loyalty-hook fired with kroner amount.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(loyalty.events.length, 1);
  assert.equal(loyalty.events[0]!.kind, "game.win");
  assert.equal(loyalty.events[0]!.amount, 500);

  // Ingen split-rounding-audit (0 rest).
  assert.equal(splitAudit.events.length, 0);

  // Audit-event skrevet.
  const audit = await auditStore.list();
  assert.ok(audit.some((e) => e.action === "game1_payout.phase_winner"));
});

test("payoutPhase: multi-winner split-rounding med rest", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  // 3 vinnere, totalt 100 kr (10000 øre) — split = 3333 øre pr., rest = 1 øre.
  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 2,
    drawSequenceAtWin: 30,
    roomCode: "",
    totalPhasePrizeCents: 10000,
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
    ],
    phaseName: "2 Rader",
  });

  assert.equal(result.totalWinners, 3);
  assert.equal(result.prizePerWinnerCents, 3333);
  assert.equal(result.houseRetainedCents, 1);
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 33.33); // kroner med desimaler
  }

  // Split-rounding audit kalt med kroner-verdier.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 1);
  assert.equal(splitAudit.events[0]!.amount, 0.01);
  assert.equal(splitAudit.events[0]!.winnerCount, 3);
  assert.equal(splitAudit.events[0]!.totalPhasePrize, 100);
  assert.equal(splitAudit.events[0]!.prizePerWinner, 33.33);
});

test("payoutPhase: jackpot-tillegg krediteres sammen med prize", async () => {
  const { service, wallet } = makeService();
  const { client, queries } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 5,
    drawSequenceAtWin: 50,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr
    winners: [winner()],
    jackpotAmountCentsPerWinner: 500000, // 5000 kr jackpot
    phaseName: "Fullt Hus",
  });

  // wallet.credit skal ha 1000 + 5000 = 6000 kr.
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 6000);

  // phase_winners har jackpot_amount_cents = 500000.
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert);
  assert.equal(phaseInsert!.params[12], 500000);
});

// ── Error-paths ────────────────────────────────────────────────────────────

test("payoutPhase: wallet.credit-feil → DomainError PAYOUT_WALLET_CREDIT_FAILED", async () => {
  const { service } = makeService({
    walletOpts: { failWithCode: "INSUFFICIENT_FUNDS" },
  });
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 50000,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );
});

test("payoutPhase: plain Error fra wallet → wrappes også som PAYOUT_WALLET_CREDIT_FAILED", async () => {
  const { service } = makeService({
    walletOpts: { failWithCode: "whatever", failReason: "plain-error" },
  });
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 50000,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );
});

test("payoutPhase: ingen vinnere → DomainError PAYOUT_NO_WINNERS", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 0,
      winners: [],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_NO_WINNERS"
  );
});

test("payoutPhase: ugyldig fase → DomainError PAYOUT_INVALID_PHASE", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  for (const bad of [0, 6, -1, 3.5]) {
    await assert.rejects(
      service.payoutPhase(client as never, {
        scheduledGameId: "g1",
        phase: bad,
        drawSequenceAtWin: 25,
        roomCode: "",
        totalPhasePrizeCents: 100,
        winners: [winner()],
        phaseName: "x",
      }),
      (err) =>
        err instanceof DomainError && err.code === "PAYOUT_INVALID_PHASE"
    );
  }
});

test("payoutPhase: negativ totalPhasePrizeCents → DomainError PAYOUT_INVALID_PRIZE", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: -1,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_INVALID_PRIZE"
  );
});

// ── Fire-and-forget semantikk ──────────────────────────────────────────────

test("payoutPhase: loyalty-hook-feil blokkerer ikke payout (fire-and-forget)", async () => {
  const { service, wallet } = makeService({
    loyaltyOpts: { throwOnWin: true },
  });
  const { client } = makeFakeClient();

  // Skal ikke kaste.
  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000,
    winners: [winner()],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(wallet.credits.length, 1);
});

test("payoutPhase: zero-prize + zero-jackpot hopper wallet.credit", async () => {
  const { service, wallet } = makeService();
  const { client, queries } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 0,
    winners: [winner()],
    phaseName: "1 Rad",
  });

  // Ingen wallet-tx.
  assert.equal(wallet.credits.length, 0);
  assert.equal(result.winnerRecords[0]!.walletTransactionId, null);
  assert.equal(result.winnerRecords[0]!.prizeCents, 0);

  // phase_winners-rad skrives likevel (audit-trail).
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert);
});

// ── 4c-services-coverage tillegg: 7 nye tester per PM-godkjent scope ────────
//
// Dekker partial-failure, jackpot-kombinasjoner, audit-event-innhold,
// INSERT-propagering og loyalty-event-shape.

test("partial-failure: wallet feiler på 2. av 3 vinnere → vinner 1 er allerede kreditert + INSERTed (caller må rollbacke)", async () => {
  // Kontrakt: sekvensiell loop. Hvis wallet feiler på vinner N, er
  // vinner 1..N-1 allerede prosessert (wallet.credit + phase_winners-
  // INSERT har skjedd). Den eneste korrekte håndteringen er at caller
  // (Game1DrawEngineService) ruller tilbake hele pg-transaksjonen —
  // phase_winners-INSERT-ene forsvinner da, og wallet-credit er
  // idempotency-key-sikret mot dobbelt-effekt ved retry.
  //
  // Testen låser at 1-indexed failure-winner etterlater partial state
  // slik at vi kan dokumentere rollback-behovet.
  let callCount = 0;
  const credits: Array<{ walletId: string; amount: number }> = [];
  const adapter: WalletAdapter = {
    async createAccount() { throw new Error("n/a"); },
    async ensureAccount() { throw new Error("n/a"); },
    async getAccount() { throw new Error("n/a"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async debit() { throw new Error("n/a"); },
    async credit(walletId, amount, reason) {
      callCount++;
      if (callCount === 2) {
        throw new WalletError("INSUFFICIENT_FUNDS", "simulert feil på vinner 2");
      }
      credits.push({ walletId, amount });
      return {
        id: `wtx-${callCount}`, accountId: walletId, type: "CREDIT",
        amount, reason, createdAt: new Date().toISOString(),
      };
    },
    async topUp() { throw new Error("n/a"); },
    async withdraw() { throw new Error("n/a"); },
    async transfer() { throw new Error("n/a"); },
    async listTransactions() { return []; },
  };
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const service = new Game1PayoutService({
    walletAdapter: adapter,
    auditLogService: auditLog,
  });
  const { client, queries } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1", phase: 1, drawSequenceAtWin: 25, roomCode: "",
      totalPhasePrizeCents: 30000,
      winners: [
        winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
        winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
        winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
      ],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_WALLET_CREDIT_FAILED",
  );

  // Vinner 1 har allerede fått wallet.credit og phase_winners-INSERT.
  assert.equal(credits.length, 1, "vinner 1 ble kreditert før feilen");
  assert.equal(credits[0]!.walletId, "w-1");
  const inserts = queries.filter(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners"),
  );
  assert.equal(inserts.length, 1, "vinner 1 har phase_winners-rad (vinner 3 nådd aldri)");
  // Vinner 2's INSERT skjedde aldri fordi wallet.credit kastet før.
  assert.equal(callCount, 2, "loop stoppet på vinner 2's wallet-kall");
});

test("partial-failure: phase_winners INSERT-feil propagerer rått (ingen DomainError-wrap)", async () => {
  // PM-direktiv 4c #2: Kontraktet er at pg-transaksjonen er rollback-
  // garantien, ikke eksplisitt DomainError-wrap. Testen dokumenterer at
  // en client.query-feil propagerer rå gjennom payoutPhase() slik at
  // caller ser det originale feilobjektet.
  const { service, wallet } = makeService();
  const boomClient = {
    async query(sql: string) {
      if (sql.includes("INSERT INTO") && sql.includes("app_game1_phase_winners")) {
        throw new Error("simulated pg constraint violation");
      }
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.rejects(
    service.payoutPhase(boomClient as never, {
      scheduledGameId: "g1", phase: 1, drawSequenceAtWin: 25, roomCode: "",
      totalPhasePrizeCents: 50000, winners: [winner()], phaseName: "1 Rad",
    }),
    (err) => {
      // Rå Error, IKKE DomainError — dokumenterer at INSERT-feil ikke
      // wrappes. Caller's pg-transaksjon ruller tilbake wallet.credit
      // via idempotency-key + transaksjonsgrense.
      return err instanceof Error
        && !(err instanceof DomainError)
        && err.message.includes("constraint violation");
    },
  );

  // wallet.credit skjedde FØR INSERT, så er "igjen" — men pg-transaksjonen
  // ruller tilbake via caller.
  assert.equal(wallet.credits.length, 1);
});

test("jackpot-kun: totalPhasePrize=0 + jackpot>0 → kun jackpot krediteres, loyalty SKIPPES", async () => {
  // Subtilt samspill: loyalty-hook kjører kun hvis prizePerWinnerCents > 0
  // (se Game1PayoutService.ts:273). Ren jackpot-only-scenario betyr at
  // vinneren IKKE får game.win-loyalty-event — kontrakt verdt å låse.
  const { service, wallet, loyalty } = makeService();
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1", phase: 5, drawSequenceAtWin: 40, roomCode: "",
    totalPhasePrizeCents: 0,
    winners: [winner()],
    jackpotAmountCentsPerWinner: 500000, // 5000 kr
    phaseName: "Fullt Hus",
  });

  // wallet.credit ble kalt med 5000 (kun jackpot).
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 5000);

  // Loyalty-hook ble IKKE kalt (prize=0-gating).
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(loyalty.events.length, 0, "loyalty.game.win skippes ved prize=0");
});

test("jackpot + multi-winner split: 3 vinnere, hver får prize-andel + full jackpot", async () => {
  // Jackpot per vinner er et FLAT tillegg — ikke splittet mellom vinnerne.
  // Dette er bevisst: jackpot er farge-basert, og hver vinner har sin
  // egen (kanskje ulike) ticketColor. PayoutService får
  // `jackpotAmountCentsPerWinner` beregnet av JackpotService for hver
  // vinner separat. Testen låser at kreditten = prize-andel + jackpot.
  const { service, wallet } = makeService();
  const { client, queries } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1", phase: 5, drawSequenceAtWin: 45, roomCode: "",
    totalPhasePrizeCents: 30000, // 300 kr split på 3 → 100 kr hver
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
    ],
    jackpotAmountCentsPerWinner: 200000, // 2000 kr hver
    phaseName: "Fullt Hus",
  });

  // Hver vinner: 100 + 2000 = 2100 kr.
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 2100);
  }

  // phase_winners har jackpot_amount_cents = 200000 for hver.
  const inserts = queries.filter(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners"),
  );
  assert.equal(inserts.length, 3);
  for (const ins of inserts) {
    assert.equal(ins.params[12], 200000, "jackpot_amount_cents pr vinner-rad");
  }
});

test("audit-event-innhold: details har ticketColor, drawSequenceAtWin, prizeCents, jackpotCents, winnerCount", async () => {
  // Kontrakt for compliance-rapportering: audit-event må ha tilstrekkelig
  // detail for at revisjonslogg kan rekonstruere alle fase-utbetalinger
  // uten å gå tilbake til phase_winners-tabellen.
  const { service, auditStore } = makeService();
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "game-abc", phase: 3, drawSequenceAtWin: 42, roomCode: "",
    totalPhasePrizeCents: 20000,
    winners: [
      winner({ assignmentId: "a-1", userId: "u-1", ticketColor: "large_purple" }),
      winner({ assignmentId: "a-2", userId: "u-2", ticketColor: "small_yellow" }),
    ],
    jackpotAmountCentsPerWinner: 0,
    phaseName: "3 Rader",
  });

  await new Promise((r) => setTimeout(r, 5));
  const events = await auditStore.list();
  const payoutEvents = events.filter((e) => e.action === "game1_payout.phase_winner");
  assert.equal(payoutEvents.length, 2, "én audit-event per vinner");

  const details1 = payoutEvents.find(
    (e) => (e.details as { assignmentId: string }).assignmentId === "a-1",
  )?.details as {
    phase: number; phaseName: string; prizeCents: number; jackpotCents: number;
    ticketColor: string; drawSequenceAtWin: number; winnerCount: number;
    totalPhasePrizeCents: number;
  };
  assert.ok(details1);
  assert.equal(details1.phase, 3);
  assert.equal(details1.phaseName, "3 Rader");
  assert.equal(details1.prizeCents, 10000); // 20000/2
  assert.equal(details1.jackpotCents, 0);
  assert.equal(details1.ticketColor, "large_purple");
  assert.equal(details1.drawSequenceAtWin, 42);
  assert.equal(details1.winnerCount, 2);
  assert.equal(details1.totalPhasePrizeCents, 20000);
});

test("loyalty-event-shape: alle påkrevde felt satt (userId, hallId, gameId, patternName, roomCode, amount)", async () => {
  // Låser hook-payload-shape slik at LoyaltyPointsHookPort-konsumenter
  // kan stole på at alle felt er satt. PatternName skal være fase-navn
  // (ikke fase-id), og amount i kroner (ikke øre).
  const { service, loyalty } = makeService();
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "game-xyz", phase: 2, drawSequenceAtWin: 20, roomCode: "room-42",
    totalPhasePrizeCents: 40000,
    winners: [winner({ userId: "user-α", hallId: "hall-north" })],
    phaseName: "2 Rader",
  });

  await new Promise((r) => setTimeout(r, 5));
  assert.equal(loyalty.events.length, 1);
  const ev = loyalty.events[0]!;
  assert.equal(ev.kind, "game.win");
  if (ev.kind === "game.win") {
    assert.equal(ev.userId, "user-α");
    assert.equal(ev.amount, 400, "40000 øre = 400 kr");
    assert.equal(ev.patternName, "2 Rader");
    assert.equal(ev.roomCode, "room-42");
    assert.equal(ev.gameId, "game-xyz");
    assert.equal(ev.hallId, "hall-north");
  }
});

test("split-rounding-audit: amount = rest i kroner (ikke øre) — 25 øre = 0.25 kr", async () => {
  // Regresjonstest for øre→kroner-konvertering i split-audit-event.
  // 7 vinnere på 100 kr (10000 øre): floor(10000/7)=1428 øre, rest=10000-7*1428=4 øre.
  // Prøver dette nøyaktig slik.
  const { service, splitAudit } = makeService();
  const { client } = makeFakeClient();

  const winners: Game1WinningAssignment[] = [];
  for (let i = 1; i <= 7; i++) {
    winners.push(winner({ assignmentId: `a-${i}`, walletId: `w-${i}`, userId: `u-${i}` }));
  }
  await service.payoutPhase(client as never, {
    scheduledGameId: "g1", phase: 1, drawSequenceAtWin: 25, roomCode: "",
    totalPhasePrizeCents: 10000, winners, phaseName: "1 Rad",
  });

  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 1);
  const ev = splitAudit.events[0]!;
  assert.equal(ev.winnerCount, 7);
  assert.equal(ev.amount, 0.04, "4 øre rest = 0.04 kr");
  assert.equal(ev.totalPhasePrize, 100, "10000 øre = 100 kr");
  assert.equal(ev.prizePerWinner, 14.28, "1428 øre = 14.28 kr");
  assert.equal(ev.patternName, "1 Rad");
});
