/**
 * BIN-MYSTERY M6: integrasjonstester for Mystery Game-runtime via orchestrator.
 *
 * Dekning:
 *   - Full flyt: maybeTriggerFor → handleChoice med default-config og med
 *     admin-config override.
 *   - Wallet-credit kalles med `to: "winnings"` (regulatorisk krav).
 *   - Idempotency-key er `g1-minigame-${resultId}`.
 *   - Dobbel handleChoice → MINIGAME_ALREADY_COMPLETED.
 *   - Wallet-credit feil → raden er IKKE markert completed (fail-closed).
 *   - Joker-runde terminerer tidlig og gir max-payout.
 *   - Admin-config prizeListNok override påvirker payout.
 *
 * Merk: bruker in-memory fake-pool (samme pattern som M2/M3/M4/M5).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
  type MiniGameResultBroadcast,
  type MiniGameTriggerBroadcast,
} from "./Game1MiniGameOrchestrator.js";
import {
  MiniGameMysteryEngine,
  getDigitAt,
  type MysteryDirection,
  type MysteryResultJson,
} from "./MiniGameMysteryEngine.js";
import { DomainError } from "../BingoEngine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FakePoolState {
  configRow: { config_json: Record<string, unknown> } | null;
  rows: Map<string, Record<string, unknown>>;
}

function makeFakePool(state: FakePoolState): {
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      release: () => void;
    }>;
  };
} {
  const handleQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("app_mini_games_config") && sql.includes("SELECT")) {
      return { rows: state.configRow ? [state.configRow] : [] };
    }
    if (sql.includes("INSERT INTO") && sql.includes("app_game1_mini_game_results")) {
      const [id, scheduledGameId, type, winnerUserId, configSnapshotJson] =
        params as [string, string, string, string, string];
      state.rows.set(id, {
        id,
        scheduled_game_id: scheduledGameId,
        mini_game_type: type,
        winner_user_id: winnerUserId,
        config_snapshot_json: JSON.parse(configSnapshotJson),
        choice_json: null,
        result_json: null,
        payout_cents: 0,
        triggered_at: new Date(),
        completed_at: null,
      });
      return { rows: [] };
    }
    return { rows: [] };
  };

  const clientQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
      return { rows: [] };
    }
    if (sql.includes("FOR UPDATE") && sql.includes("app_game1_mini_game_results")) {
      const id = params[0] as string;
      const row = state.rows.get(id);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("app_users") && sql.includes("wallet_id")) {
      return { rows: [{ wallet_id: "w-winner" }] };
    }
    if (sql.includes("app_game1_phase_winners")) {
      return { rows: [{ hall_id: "h-main", draw_sequence_at_win: 50 }] };
    }
    if (sql.includes("UPDATE") && sql.includes("app_game1_mini_game_results")) {
      const id = params[0] as string;
      const row = state.rows.get(id);
      if (row) {
        row.choice_json = JSON.parse(params[1] as string);
        row.result_json = JSON.parse(params[2] as string);
        row.payout_cents = params[3] as number;
        row.completed_at = new Date();
      }
      return { rows: [] };
    }
    return { rows: [] };
  };

  return {
    pool: {
      query: handleQuery,
      connect: async () => ({
        query: clientQuery,
        release: () => undefined,
      }),
    },
  };
}

function makeStubAuditLog() {
  const records: Array<{
    actorId: string | null;
    action: string;
    resource: string;
    resourceId: string;
    details: Record<string, unknown>;
  }> = [];
  return {
    service: {
      record: async (input: {
        actorId: string | null;
        actorType: string;
        action: string;
        resource: string;
        resourceId: string;
        details: Record<string, unknown>;
      }) => {
        records.push({
          actorId: input.actorId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          details: input.details,
        });
      },
    } as unknown as import("../../compliance/AuditLogService.js").AuditLogService,
    records,
  };
}

interface CreditCall {
  accountId: string;
  amount: number;
  reason: string;
  options: { idempotencyKey?: string; to?: string } | undefined;
}

function makeStubWalletAdapter(options: { throwOnCredit?: boolean } = {}) {
  const credits: CreditCall[] = [];
  return {
    adapter: {
      credit: async (
        accountId: string,
        amount: number,
        reason: string,
        opts?: { idempotencyKey?: string; to?: string },
      ) => {
        if (options.throwOnCredit) {
          throw new Error("simulated wallet failure");
        }
        credits.push({ accountId, amount, reason, options: opts });
        return { id: `tx-${credits.length}`, accountId, amount };
      },
      debit: async () => {
        throw new Error("unused");
      },
      transfer: async () => {
        throw new Error("unused");
      },
      getBalance: async () => 0,
    } as unknown as import("../../adapters/WalletAdapter.js").WalletAdapter,
    credits,
  };
}

function makeRecordingBroadcaster(): {
  broadcaster: MiniGameBroadcaster;
  triggers: MiniGameTriggerBroadcast[];
  results: MiniGameResultBroadcast[];
} {
  const triggers: MiniGameTriggerBroadcast[] = [];
  const results: MiniGameResultBroadcast[] = [];
  return {
    broadcaster: {
      onTrigger: (e) => triggers.push(e),
      onResult: (e) => results.push(e),
    },
    triggers,
    results,
  };
}

/** Bygg optimal direction-array fra et trigger-payload (hvis ingen joker). */
function buildOptimalDirections(
  middleNumber: number,
  resultNumber: number,
): { directions: MysteryDirection[]; hasJoker: boolean } {
  const dirs: MysteryDirection[] = [];
  let hasJoker = false;
  for (let d = 0; d < 5; d += 1) {
    const md = getDigitAt(middleNumber, d);
    const rd = getDigitAt(resultNumber, d);
    if (md === rd) {
      hasJoker = true;
      break;
    }
    dirs.push(rd > md ? "up" : "down");
  }
  return { directions: dirs, hasJoker };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("BIN-MYSTERY M6 integration: default-config → Mystery trigger + optimal play → full payout", async () => {
  // Siden vi ikke kan forutsi middleNumber/resultNumber fra en randomUUID,
  // bruker vi en retry-loop: prøv scheduledGameIds til vi finner en uten joker.
  // I praksis rammes ~50% av seeder av minst én joker, så ≤ 10 forsøk nok.
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog, records: auditRecords } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers, results } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameMysteryEngine());

  let trigResult: Awaited<ReturnType<typeof orchestrator.maybeTriggerFor>> | null =
    null;
  let directions: MysteryDirection[] = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const t = await orchestrator.maybeTriggerFor({
      scheduledGameId: `sg-mystery-int-${attempt}`,
      winnerUserId: "u-winner",
      winnerWalletId: "w-winner",
      hallId: "h-main",
      drawSequenceAtWin: 50,
      gameConfigJson: { spill1: { miniGames: ["mystery"] } },
    });
    const latestTrigger = triggers[triggers.length - 1]!;
    const tp = latestTrigger.payload as Record<string, unknown>;
    const { directions: dirs, hasJoker } = buildOptimalDirections(
      tp.middleNumber as number,
      tp.resultNumber as number,
    );
    if (!hasJoker) {
      trigResult = t;
      directions = dirs;
      break;
    }
  }
  assert.ok(trigResult !== null, "Fant ingen joker-fri seed i 30 forsøk");
  assert.equal(trigResult.triggered, true);
  assert.equal(trigResult.miniGameType, "mystery");

  // Verifiser trigger-payload-shape.
  const triggerPayload = triggers[triggers.length - 1]!.payload as Record<string, unknown>;
  assert.ok(typeof triggerPayload.middleNumber === "number");
  assert.ok(typeof triggerPayload.resultNumber === "number");
  assert.equal(
    (triggerPayload.prizeListNok as number[]).length,
    6,
  );
  assert.equal(triggerPayload.autoTurnFirstMoveSec, 20);
  assert.equal(triggerPayload.autoTurnOtherMoveSec, 10);
  assert.equal(triggerPayload.maxRounds, 5);

  // Spill optimalt → alle 5 correct → priceIndex = 5 → max-premie (1500 kr).
  const resp = await orchestrator.handleChoice({
    resultId: trigResult.resultId!,
    userId: "u-winner",
    choiceJson: { directions },
  });
  const resultJson = resp.resultJson as MysteryResultJson;
  assert.equal(resultJson.rounds.length, 5);
  assert.equal(resultJson.jokerTriggered, false);
  assert.equal(resultJson.finalPriceIndex, 5);
  assert.equal(resultJson.prizeAmountKroner, 1500);
  assert.equal(resp.payoutCents, 1500 * 100);

  // Wallet-credit kalt med `to: "winnings"` (regulatorisk krav).
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-winner");
  assert.equal(credits[0]!.amount, 1500);
  assert.equal(credits[0]!.options?.to, "winnings");
  assert.equal(
    credits[0]!.options?.idempotencyKey,
    `g1-minigame-${trigResult.resultId}`,
  );

  // Broadcast.
  assert.ok(results.length >= 1);
  const lastResult = results[results.length - 1]!;
  assert.equal(lastResult.payoutCents, 1500 * 100);
  assert.equal(lastResult.miniGameType, "mystery");

  // Audit.
  const triggerAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.triggered",
  );
  const completedAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.completed",
  );
  assert.ok(triggerAudits.length >= 1);
  assert.ok(completedAudits.length >= 1);
  const lastCompleted = completedAudits[completedAudits.length - 1]!;
  assert.equal(lastCompleted.details.miniGameType, "mystery");
  assert.equal(lastCompleted.details.payoutCents, 1500 * 100);
});

test("BIN-MYSTERY M6 integration: admin-config prizeListNok override speiles i payout", async () => {
  const customPrizes = [0, 50, 200, 600, 1800, 5000];
  const state: FakePoolState = {
    configRow: { config_json: { prizeListNok: customPrizes } },
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameMysteryEngine());

  // Retry loop for joker-free seed.
  let trigResult: Awaited<ReturnType<typeof orchestrator.maybeTriggerFor>> | null =
    null;
  let directions: MysteryDirection[] = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const t = await orchestrator.maybeTriggerFor({
      scheduledGameId: `sg-mystery-custom-${attempt}`,
      winnerUserId: "u-winner",
      winnerWalletId: "w-winner",
      hallId: "h-main",
      drawSequenceAtWin: 50,
      gameConfigJson: { spill1: { miniGames: ["mystery"] } },
    });
    const tp = triggers[triggers.length - 1]!.payload as Record<string, unknown>;
    const { directions: dirs, hasJoker } = buildOptimalDirections(
      tp.middleNumber as number,
      tp.resultNumber as number,
    );
    if (!hasJoker) {
      trigResult = t;
      directions = dirs;
      // Verifiser at trigger-payload har custom prizes.
      assert.deepEqual(tp.prizeListNok, customPrizes);
      break;
    }
  }
  assert.ok(trigResult !== null, "Fant ingen joker-fri seed");

  const resp = await orchestrator.handleChoice({
    resultId: trigResult.resultId!,
    userId: "u-winner",
    choiceJson: { directions },
  });
  const resultJson = resp.resultJson as MysteryResultJson;
  assert.equal(resultJson.finalPriceIndex, 5);
  assert.equal(resultJson.prizeAmountKroner, customPrizes[5]);
  assert.equal(resp.payoutCents, customPrizes[5]! * 100);
  assert.equal(credits[0]!.amount, customPrizes[5]);
});

test("BIN-MYSTERY M6 integration: dobbel handleChoice → MINIGAME_ALREADY_COMPLETED", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(new MiniGameMysteryEngine());

  const t = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-mystery-dup-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["mystery"] } },
  });

  // Første choice går gjennom.
  await orchestrator.handleChoice({
    resultId: t.resultId!,
    userId: "u-winner",
    choiceJson: { directions: ["up", "down", "up", "down", "up"] },
  });

  // Andre choice → MINIGAME_ALREADY_COMPLETED.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: t.resultId!,
        userId: "u-winner",
        choiceJson: { directions: ["up", "up", "up", "up", "up"] },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-MYSTERY M6 integration: wallet-credit feil → DomainError bobler opp, rad IKKE completed", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter({
    throwOnCredit: true,
  });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(new MiniGameMysteryEngine());

  const t = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-mystery-walleterr-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["mystery"] } },
  });

  // Wallet-credit throws → Error bobler opp; raden er IKKE committed.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: t.resultId!,
        userId: "u-winner",
        choiceJson: { directions: ["up", "up", "up", "up", "up"] },
      }),
    (err: unknown) => err instanceof Error,
  );

  // Raden skal IKKE være markert completed (ROLLBACK kjørt i
  // orchestrator.runInTransaction).
  const row = state.rows.get(t.resultId!);
  assert.ok(row, "Row må eksistere");
  assert.equal(row.completed_at, null, "Row skal IKKE være completed");
});

test("BIN-MYSTERY M6 integration: joker-treff termineres tidlig og utbetaler max-premie", async () => {
  // Retry-loop for å finne en seed der runde 0 er joker (ones-siffer equal).
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  orchestrator.registerMiniGame(new MiniGameMysteryEngine());

  let trigResult: Awaited<ReturnType<typeof orchestrator.maybeTriggerFor>> | null =
    null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const t = await orchestrator.maybeTriggerFor({
      scheduledGameId: `sg-mystery-joker-${attempt}`,
      winnerUserId: "u-winner",
      winnerWalletId: "w-winner",
      hallId: "h-main",
      drawSequenceAtWin: 50,
      gameConfigJson: { spill1: { miniGames: ["mystery"] } },
    });
    const tp = triggers[triggers.length - 1]!.payload as Record<string, unknown>;
    const mid = tp.middleNumber as number;
    const res = tp.resultNumber as number;
    // Vi vil ha runde 0 som joker (første digit equal).
    if (getDigitAt(mid, 0) === getDigitAt(res, 0)) {
      trigResult = t;
      break;
    }
  }
  assert.ok(
    trigResult !== null,
    "Fant ingen seed med joker på runde 0 i 100 forsøk (usannsynlig med p=0.1)",
  );

  // Selv om klienten sender 5 directions, skal engine kun evaluere den første
  // runden (joker → terminate early).
  const resp = await orchestrator.handleChoice({
    resultId: trigResult.resultId!,
    userId: "u-winner",
    choiceJson: { directions: ["up", "up", "up", "up", "up"] },
  });
  const resultJson = resp.resultJson as MysteryResultJson;
  assert.equal(resultJson.rounds.length, 1);
  assert.equal(resultJson.jokerTriggered, true);
  assert.equal(resultJson.finalPriceIndex, 5);
  assert.equal(resultJson.prizeAmountKroner, 1500);
  assert.equal(resp.payoutCents, 1500 * 100);

  // Credit skal være 1500 (full max-premie).
  assert.equal(credits[credits.length - 1]!.amount, 1500);
});
