/**
 * K2-A CRIT-2 + CRIT-3: tester for compliance ledger + single-prize-cap
 * i Game1MiniGameOrchestrator.
 *
 * Verifiserer:
 *   - CRIT-2: Mini-game-payout skriver EXTRA_PRIZE-entry til ComplianceLedger
 *     med korrekt MAIN_GAME-gameType (Spill 1 = hovedspill).
 *   - CRIT-2: Soft-fail — ledger-feil ruller IKKE tilbake wallet-credit.
 *   - CRIT-3: Mini-game-payout > 2500 kr trimmes til cap.
 *   - CRIT-3: payout_cents persistert i DB matcher capped beløp.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
} from "./Game1MiniGameOrchestrator.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
  MiniGameType,
} from "./types.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../../adapters/ComplianceLedgerPort.js";
import type {
  PrizePolicyApplyInput,
  PrizePolicyApplyResult,
  PrizePolicyPort,
} from "../../adapters/PrizePolicyPort.js";

// ── Stubs ──────────────────────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeFakePool() {
  const calls: QueryCall[] = [];
  // Used to return rows from the locked select + context-load queries.
  const updates: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // Return locked row for the first SELECT FOR UPDATE on results.
        if (sql.includes("FROM ") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: "res-1",
                scheduled_game_id: "sg-1",
                mini_game_type: "wheel",
                winner_user_id: "u-1",
                config_snapshot_json: {},
                choice_json: null,
                result_json: null,
                payout_cents: 0,
                triggered_at: new Date(),
                completed_at: null,
              },
            ],
          };
        }
        // app_users wallet_id lookup.
        if (sql.includes("app_users") && sql.includes("wallet_id")) {
          return { rows: [{ wallet_id: "w-1" }] };
        }
        // app_game1_phase_winners lookup.
        if (sql.includes("app_game1_phase_winners")) {
          return {
            rows: [{ hall_id: "hall-a", draw_sequence_at_win: 57 }],
          };
        }
        // UPDATE — track for assertions.
        if (sql.startsWith("UPDATE")) {
          updates.push({ sql, params });
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
  };
  return { pool, calls, updates };
}

function makeStubAuditLog() {
  return {
    record: async () => undefined,
  } as unknown as import("../../compliance/AuditLogService.js").AuditLogService;
}

function makeStubWalletAdapter() {
  const credits: Array<{ accountId: string; amount: number; idempotencyKey?: string }> = [];
  return {
    adapter: {
      credit: async (
        accountId: string,
        amount: number,
        _reason: string,
        options?: { idempotencyKey?: string },
      ) => {
        credits.push({
          accountId,
          amount,
          idempotencyKey: options?.idempotencyKey,
        });
        return { id: `tx-${credits.length}`, accountId, amount };
      },
      debit: async () => {
        throw new Error("unused");
      },
      transfer: async () => {
        throw new Error("unused");
      },
      getBalance: async () => 0,
      getAccountExists: async () => true,
      createAccount: async () => undefined,
    } as unknown as import("../../adapters/WalletAdapter.js").WalletAdapter,
    credits,
  };
}

function makeRecordingLedgerPort(): {
  port: ComplianceLedgerPort;
  calls: ComplianceLedgerEventInput[];
} {
  const calls: ComplianceLedgerEventInput[] = [];
  return {
    port: {
      async recordComplianceLedgerEvent(input) {
        calls.push(input);
      },
    },
    calls,
  };
}

function makeThrowingLedgerPort(): ComplianceLedgerPort {
  return {
    async recordComplianceLedgerEvent() {
      throw new Error("simulated ledger outage");
    },
  };
}

function makeRecordingPolicyPort(
  cappedAmount?: number,
): {
  port: PrizePolicyPort;
  calls: PrizePolicyApplyInput[];
} {
  const calls: PrizePolicyApplyInput[] = [];
  return {
    port: {
      applySinglePrizeCap(input): PrizePolicyApplyResult {
        calls.push(input);
        const out = cappedAmount ?? input.amount;
        return {
          cappedAmount: out,
          wasCapped: out < input.amount,
          policyId: "test-policy",
        };
      },
    },
    calls,
  };
}

function makeBroadcaster(): MiniGameBroadcaster {
  return { onTrigger: () => undefined, onResult: () => undefined };
}

function makeFakeMiniGame(payoutCents: number): MiniGame {
  return {
    type: "wheel" as MiniGameType,
    trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
      return {
        type: "wheel",
        resultId: context.resultId,
        payload: {},
        timeoutSeconds: 30,
      };
    },
    async handleChoice(_input: MiniGameChoiceInput): Promise<MiniGameResult> {
      return { payoutCents, resultJson: {} };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("K2-A CRIT-2: mini-game-payout skriver EXTRA_PRIZE til ComplianceLedger med MAIN_GAME", async () => {
  const { pool } = makeFakePool();
  const audit = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    auditLog: audit,
    walletAdapter,
    broadcaster: makeBroadcaster(),
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame(150_000)); // 1500 kr

  await orchestrator.handleChoice({
    resultId: "res-1",
    userId: "u-1",
    choiceJson: { chosenIndex: 0 },
  });

  assert.equal(ledgerCalls.length, 1, "én EXTRA_PRIZE-entry skrevet");
  const entry = ledgerCalls[0]!;
  assert.equal(entry.eventType, "EXTRA_PRIZE");
  assert.equal(entry.gameType, "MAIN_GAME", "Spill 1 = hovedspill (15%)");
  assert.equal(entry.channel, "INTERNET");
  assert.equal(entry.hallId, "hall-a");
  assert.equal(entry.amount, 1500); // 150000 øre = 1500 kr
  assert.equal(entry.playerId, "u-1");
  assert.equal(entry.walletId, "w-1");
  assert.equal(entry.gameId, "sg-1");
  const metadata = entry.metadata!;
  assert.equal(metadata.reason, "GAME1_MINI_GAME_PAYOUT");
  assert.equal(metadata.miniGameType, "wheel");
});

test("K2-A CRIT-2: ledger-feil ruller IKKE tilbake wallet-credit (soft-fail)", async () => {
  const { pool } = makeFakePool();
  const audit = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const ledgerPort = makeThrowingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    auditLog: audit,
    walletAdapter,
    broadcaster: makeBroadcaster(),
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame(200_000)); // 2000 kr

  // Skal IKKE kaste — ledger-feil svelges.
  const result = await orchestrator.handleChoice({
    resultId: "res-1",
    userId: "u-1",
    choiceJson: {},
  });

  assert.equal(result.payoutCents, 200_000);
  assert.equal(credits.length, 1, "wallet-credit ble fortsatt utført");
  assert.equal(credits[0]!.amount, 2000); // kroner
});

test("K2-A CRIT-3: mini-game-payout 4000 kr → cap til 2500 kr", async () => {
  const { pool, updates } = makeFakePool();
  const audit = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  // Policy-port returnerer 2500 (capped) for input 4000.
  const { port: policyPort, calls: policyCalls } = makeRecordingPolicyPort(2500);

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    auditLog: audit,
    walletAdapter,
    broadcaster: makeBroadcaster(),
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });
  // Wheel-bucket på 4000 kr = 400 000 øre.
  orchestrator.registerMiniGame(makeFakeMiniGame(400_000));

  const result = await orchestrator.handleChoice({
    resultId: "res-1",
    userId: "u-1",
    choiceJson: {},
  });

  // Policy-port ble kalt med kroner-beløp.
  assert.equal(policyCalls.length, 1);
  assert.equal(policyCalls[0]!.amount, 4000);
  assert.equal(policyCalls[0]!.hallId, "hall-a");

  // Wallet ble kreditert med capped beløp (2500 kr), IKKE 4000.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.amount, 2500);

  // Returnert payoutCents = capped (250 000), ikke requested (400 000).
  assert.equal(result.payoutCents, 250_000);

  // Ledger-entry har capped amount.
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0]!.amount, 2500);
  const meta = ledgerCalls[0]!.metadata!;
  assert.equal(meta.requestedCents, 400_000);
  assert.equal(meta.cappedCents, 250_000);
  assert.equal(meta.houseRetainedCents, 150_000);

  // UPDATE-statement persistert capped payout_cents (parameter 4 = 250000).
  const update = updates.find((u) => u.sql.startsWith("UPDATE"));
  assert.ok(update, "UPDATE-call funnet");
  assert.equal(update!.params[3], 250_000, "payout_cents = capped");
});

test("K2-A CRIT-3: mini-game-payout 2000 kr → ingen cap, full utbetaling", async () => {
  const { pool } = makeFakePool();
  const audit = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  // Policy-port returnerer input uendret (under cap).
  const { port: policyPort } = makeRecordingPolicyPort();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    auditLog: audit,
    walletAdapter,
    broadcaster: makeBroadcaster(),
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame(200_000)); // 2000 kr

  const result = await orchestrator.handleChoice({
    resultId: "res-1",
    userId: "u-1",
    choiceJson: {},
  });

  assert.equal(result.payoutCents, 200_000);
  assert.equal(credits[0]!.amount, 2000);
  assert.equal(ledgerCalls[0]!.amount, 2000);
  const meta = ledgerCalls[0]!.metadata!;
  assert.equal(meta.houseRetainedCents, 0);
});

test("K2-A CRIT-2: zero-payout → ingen ledger-entry, ingen wallet-credit", async () => {
  const { pool } = makeFakePool();
  const audit = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as never,
    auditLog: audit,
    walletAdapter,
    broadcaster: makeBroadcaster(),
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame(0)); // 0 kr

  await orchestrator.handleChoice({
    resultId: "res-1",
    userId: "u-1",
    choiceJson: {},
  });

  assert.equal(credits.length, 0, "ingen wallet-credit for 0-payout");
  assert.equal(ledgerCalls.length, 0, "ingen ledger-entry for 0-payout");
});
