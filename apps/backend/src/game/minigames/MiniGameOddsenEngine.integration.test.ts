/**
 * BIN-690 Spor 3 M5: integrasjonstester for Oddsen-runtime via orchestrator
 * + simulert draw-engine-resolve.
 *
 * Dekning:
 *   - Full flyt: MiniGamesConfigService-stub → orchestrator.maybeTriggerFor
 *     → handleChoice → resolveForGame (simulert draw-engine-trigger).
 *   - Chosen=55, drawn[57]=55 → hit, pot credit med `to:winnings` +
 *     idempotency-key `g1-oddsen-{id}`.
 *   - Chosen=56, drawn[57]=59 → miss, ingen credit.
 *   - Pot-størrelse basert på ticket_size (small → 1500, large → 3000).
 *   - Spill utløper (expireStateForGame) → resolved_outcome='expired'.
 *   - UNIQUE (hall_id, chosen_for_game_id): forsøk på dobbel-INSERT
 *     rejectes med ODDSEN_STATE_ALREADY_EXISTS.
 *   - handleChoice returnerer payoutCents=0 (deferred).
 *   - Orchestrator MARKERER mini_game_results completed selv når
 *     payoutCents=0 (ingen fasit wallet-credit).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
  type MiniGameResultBroadcast,
  type MiniGameTriggerBroadcast,
} from "./Game1MiniGameOrchestrator.js";
import {
  DEFAULT_ODDSEN_CONFIG,
  MiniGameOddsenEngine,
  type OddsenChoiceResultJson,
} from "./MiniGameOddsenEngine.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Fake DB state ────────────────────────────────────────────────────────────

interface FakeRow {
  id: string;
  scheduled_game_id: string;
  mini_game_type: string;
  winner_user_id: string;
  config_snapshot_json: Record<string, unknown>;
  choice_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  payout_cents: number;
  triggered_at: Date;
  completed_at: Date | null;
}

interface FakeOddsenRow {
  id: string;
  hall_id: string;
  chosen_number: number;
  chosen_by_player_id: string;
  chosen_for_game_id: string;
  set_by_game_id: string;
  ticket_size_at_win: "small" | "large";
  set_at: Date;
  resolved_at: Date | null;
  resolved_outcome: "hit" | "miss" | "expired" | null;
  pot_amount_cents: number | null;
  wallet_transaction_id: string | null;
}

interface FakeState {
  oddsenConfig: Record<string, unknown> | null;
  miniGameResults: Map<string, FakeRow>;
  oddsenStates: Map<string, FakeOddsenRow>;
  nextGameIdInHall: Map<string, string | null>;
  ticketSizeByUser: Map<string, "small" | "large">;
  walletByUser: Map<string, string>;
  hallByUser: Map<string, string>;
}

function makeFakeState(initial: Partial<FakeState> = {}): FakeState {
  return {
    oddsenConfig: initial.oddsenConfig ?? null,
    miniGameResults: initial.miniGameResults ?? new Map(),
    oddsenStates: initial.oddsenStates ?? new Map(),
    nextGameIdInHall: initial.nextGameIdInHall ?? new Map(),
    ticketSizeByUser: initial.ticketSizeByUser ?? new Map(),
    walletByUser: initial.walletByUser ?? new Map(),
    hallByUser: initial.hallByUser ?? new Map(),
  };
}

// ── Fake pool/client ─────────────────────────────────────────────────────────

function makeFakePool(state: FakeState): {
  pool: import("pg").Pool;
} {
  const handle = async (sql: string, params: unknown[] = []) => {
    // orchestrator: config-lookup i app_mini_games_config
    if (sql.includes("app_mini_games_config") && sql.includes("SELECT")) {
      const gameType = params[0] as string;
      if (gameType === "oddsen" && state.oddsenConfig) {
        return { rows: [{ config_json: state.oddsenConfig }] };
      }
      return { rows: [] };
    }
    // orchestrator: INSERT mini_game_results
    if (
      sql.includes("INSERT INTO") &&
      sql.includes("app_game1_mini_game_results")
    ) {
      const [id, sgId, type, winnerId, configSnapshotJson] = params as [
        string,
        string,
        string,
        string,
        string,
      ];
      if (!state.miniGameResults.has(id)) {
        state.miniGameResults.set(id, {
          id,
          scheduled_game_id: sgId,
          mini_game_type: type,
          winner_user_id: winnerId,
          config_snapshot_json: JSON.parse(configSnapshotJson),
          choice_json: null,
          result_json: null,
          payout_cents: 0,
          triggered_at: new Date(),
          completed_at: null,
        });
      }
      return { rows: [] };
    }
    // oddsen-engine: phase_winners-join for ticket_size
    if (sql.includes("phase_winners") && sql.includes("ticket_size")) {
      const [, userId] = params as [string, string];
      const size = state.ticketSizeByUser.get(userId);
      if (size) return { rows: [{ ticket_size: size }] };
      return { rows: [] };
    }
    // oddsen-engine: fallback assignments
    if (
      sql.includes("ticket_assignments") &&
      sql.includes("ticket_size") &&
      !sql.includes("JOIN")
    ) {
      const [, userId] = params as [string, string];
      const size = state.ticketSizeByUser.get(userId);
      if (size) return { rows: [{ ticket_size: size }] };
      return { rows: [] };
    }
    // oddsen-engine: next-game lookup
    if (
      sql.includes("scheduled_games") &&
      sql.includes("scheduled_start_time") &&
      sql.includes("participating_halls_json")
    ) {
      const [hallId] = params as [string];
      const next = state.nextGameIdInHall.get(hallId);
      if (next) return { rows: [{ id: next }] };
      return { rows: [] };
    }
    // oddsen-engine: INSERT oddsen_state
    if (sql.includes("INSERT INTO") && sql.includes("oddsen_state")) {
      const [id, hallId, chosenNum, playerId, forGame, setByGame, size] =
        params as [string, string, number, string, string, string, "small" | "large"];
      // UNIQUE (hall_id, chosen_for_game_id)
      for (const row of state.oddsenStates.values()) {
        if (row.hall_id === hallId && row.chosen_for_game_id === forGame) {
          const err = new Error("duplicate") as Error & { code?: string };
          err.code = "23505";
          throw err;
        }
      }
      state.oddsenStates.set(id, {
        id,
        hall_id: hallId,
        chosen_number: chosenNum,
        chosen_by_player_id: playerId,
        chosen_for_game_id: forGame,
        set_by_game_id: setByGame,
        ticket_size_at_win: size,
        set_at: new Date(),
        resolved_at: null,
        resolved_outcome: null,
        pot_amount_cents: null,
        wallet_transaction_id: null,
      });
      return { rows: [] };
    }
    return { rows: [] };
  };

  const clientQuery = async (sql: string, params: unknown[] = []) => {
    if (
      sql.trim() === "BEGIN" ||
      sql.trim() === "COMMIT" ||
      sql.trim() === "ROLLBACK"
    )
      return { rows: [] };

    // orchestrator: FOR UPDATE på mini_game_results
    if (
      sql.includes("FOR UPDATE") &&
      sql.includes("app_game1_mini_game_results")
    ) {
      const id = params[0] as string;
      const row = state.miniGameResults.get(id);
      return { rows: row ? [row] : [] };
    }
    // orchestrator: wallet_id lookup
    if (
      sql.includes("app_users") &&
      sql.includes("wallet_id") &&
      !sql.includes("phase_winners")
    ) {
      const id = params[0] as string;
      const walletId = state.walletByUser.get(id);
      return { rows: walletId ? [{ wallet_id: walletId }] : [] };
    }
    // orchestrator: phase_winners for hall/draw-seq
    if (
      sql.includes("app_game1_phase_winners") &&
      sql.includes("hall_id") &&
      !sql.includes("ticket_size")
    ) {
      const [, winnerId] = params as [string, string];
      const hallId = state.hallByUser.get(winnerId);
      if (hallId) {
        return { rows: [{ hall_id: hallId, draw_sequence_at_win: 57 }] };
      }
      return { rows: [] };
    }
    if (sql.includes("app_game1_ticket_assignments") && sql.includes("hall_id")) {
      const [, winnerId] = params as [string, string];
      const hallId = state.hallByUser.get(winnerId);
      if (hallId) return { rows: [{ hall_id: hallId }] };
      return { rows: [] };
    }
    // orchestrator: UPDATE mini_game_results
    if (
      sql.includes("UPDATE") &&
      sql.includes("app_game1_mini_game_results")
    ) {
      const id = params[0] as string;
      const row = state.miniGameResults.get(id);
      if (row) {
        row.choice_json = JSON.parse(params[1] as string);
        row.result_json = JSON.parse(params[2] as string);
        row.payout_cents = params[3] as number;
        row.completed_at = new Date();
      }
      return { rows: [] };
    }
    // oddsen: FOR UPDATE på oddsen_state
    if (sql.includes("FOR UPDATE") && sql.includes("oddsen_state")) {
      const [sgId] = params as [string];
      for (const row of state.oddsenStates.values()) {
        if (row.chosen_for_game_id === sgId && row.resolved_at === null) {
          return { rows: [row] };
        }
      }
      return { rows: [] };
    }
    // oddsen: UPDATE oddsen_state (resolve)
    if (sql.includes("UPDATE") && sql.includes("oddsen_state")) {
      // To UPDATE-varianter: resolve og expire. Resolve tar 4 params, expire tar 1.
      if (params.length >= 4) {
        const [id, outcome, potCents, walletTxId] = params as [
          string,
          "hit" | "miss" | "expired",
          number,
          string | null,
        ];
        const row = state.oddsenStates.get(id);
        if (row) {
          row.resolved_at = new Date();
          row.resolved_outcome = outcome;
          row.pot_amount_cents = potCents;
          row.wallet_transaction_id = walletTxId;
        }
        return { rows: [], rowCount: 1 };
      } else {
        // Expire-path
        const [sgId] = params as [string];
        let count = 0;
        for (const row of state.oddsenStates.values()) {
          if (row.chosen_for_game_id === sgId && row.resolved_at === null) {
            row.resolved_at = new Date();
            row.resolved_outcome = "expired";
            row.pot_amount_cents = 0;
            count += 1;
          }
        }
        return { rows: [], rowCount: count };
      }
    }
    // oddsen: user wallet_id lookup inne i resolveForGame
    if (
      sql.includes("app_users") &&
      sql.includes("wallet_id") &&
      !sql.includes("phase_winners")
    ) {
      const id = params[0] as string;
      const walletId = state.walletByUser.get(id);
      return { rows: walletId ? [{ wallet_id: walletId }] : [] };
    }
    return { rows: [] };
  };

  return {
    pool: {
      query: handle,
      connect: async () =>
        ({
          query: clientQuery,
          release: () => undefined,
        }) as unknown as PoolClient,
    } as unknown as import("pg").Pool,
  };
}

function makeStubAuditLog() {
  const records: Array<{
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }> = [];
  return {
    service: {
      record: async (e: {
        actorId: string | null;
        actorType: string;
        action: string;
        resource: string;
        resourceId: string;
        details: Record<string, unknown>;
      }) => {
        records.push({
          action: e.action,
          resourceId: e.resourceId,
          details: e.details,
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

function makeStubWallet() {
  const credits: CreditCall[] = [];
  const adapter = {
    credit: async (
      accountId: string,
      amount: number,
      reason: string,
      opts?: { idempotencyKey?: string; to?: string },
    ) => {
      credits.push({ accountId, amount, reason, options: opts });
      return { id: `wtx-${credits.length}` };
    },
    debit: async () => ({ id: "d" }),
    transfer: async () => ({ fromTx: { id: "f" }, toTx: { id: "t" } }),
    getBalance: async () => 0,
  } as unknown as import("../../adapters/WalletAdapter.js").WalletAdapter;
  return { adapter, credits };
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

// ── Tests ────────────────────────────────────────────────────────────────────

test("BIN-690 M5 integration: full happy-path chosen=55, drawn includes 55 → hit + pot credit + idempotency", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-42"]]),
    ticketSizeByUser: new Map([["u-winner", "small"]]),
    walletByUser: new Map([["u-winner", "w-winner"]]),
    hallByUser: new Map([["u-winner", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog, records: auditRecords } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const { broadcaster, triggers, results } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  // 1) Trigger fra forrige Fullt Hus.
  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-current",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  assert.equal(trig.triggered, true);
  assert.equal(trig.miniGameType, "oddsen");
  assert.equal(triggers.length, 1);
  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  assert.deepEqual(triggerPayload.validNumbers, [55, 56, 57]);
  assert.equal(triggerPayload.potSmallNok, 1500);
  assert.equal(triggerPayload.potLargeNok, 3000);

  // 2) Spiller velger 55.
  const choiceResult = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenNumber: 55 },
  });
  // Payout er deferred → 0 fra orchestrator-perspektiv.
  assert.equal(choiceResult.payoutCents, 0);
  // Ingen credit ennå (deferred).
  assert.equal(credits.length, 0);
  // result_json inneholder oddsenStateId.
  const choiceJson = choiceResult.resultJson as OddsenChoiceResultJson;
  const oddsenStateId = choiceJson.oddsenStateId;
  assert.ok(oddsenStateId.startsWith("oddsen-"));
  assert.equal(choiceJson.chosenNumber, 55);
  assert.equal(choiceJson.chosenForGameId, "sg-next-42");
  assert.equal(choiceJson.ticketSizeAtWin, "small");
  assert.equal(choiceJson.potAmountNokIfHit, 1500);

  // State persistert i oddsen_state-mappen.
  assert.equal(state.oddsenStates.size, 1);
  const oddsenRow = state.oddsenStates.get(oddsenStateId)!;
  assert.equal(oddsenRow.chosen_number, 55);
  assert.equal(oddsenRow.resolved_at, null);

  // 3) Simuler resolve ved neste spill, draw #57 har truffet 55.
  const { pool: resolvePool } = makeFakePool(state);
  const client = await resolvePool.connect();
  try {
    await client.query("BEGIN");
    const resolveResult = await oddsenEngine.resolveForGame(
      "sg-next-42",
      [1, 10, 20, 33, 55, 44], // 55 er i drawn.
      DEFAULT_ODDSEN_CONFIG,
      client,
    );
    await client.query("COMMIT");

    assert.ok(resolveResult);
    assert.equal(resolveResult!.outcome, "hit");
    assert.equal(resolveResult!.potAmountCents, 150_000); // 1500 kr

    // Credit sjekket: beløp + idempotency + winnings-konto.
    assert.equal(credits.length, 1);
    assert.equal(credits[0]!.accountId, "w-winner");
    assert.equal(credits[0]!.amount, 1500);
    assert.equal(credits[0]!.options?.to, "winnings");
    assert.equal(
      credits[0]!.options?.idempotencyKey,
      `g1-oddsen-${oddsenStateId}`,
    );

    // State oppdatert.
    const updatedRow = state.oddsenStates.get(oddsenStateId)!;
    assert.notEqual(updatedRow.resolved_at, null);
    assert.equal(updatedRow.resolved_outcome, "hit");
    assert.equal(updatedRow.pot_amount_cents, 150_000);
  } finally {
    client.release();
  }

  // Audit: number_chosen + resolved_hit.
  await new Promise((r) => setTimeout(r, 0));
  const chosenAudits = auditRecords.filter(
    (r) => r.action === "mini_game.oddsen_number_chosen",
  );
  const hitAudits = auditRecords.filter(
    (r) => r.action === "mini_game.oddsen_resolved_hit",
  );
  assert.equal(chosenAudits.length, 1);
  assert.equal(hitAudits.length, 1);

  // Orchestrator broadcast result har payoutCents=0 (deferred).
  assert.equal(results.length, 1);
  assert.equal(results[0]!.payoutCents, 0);
});

test("BIN-690 M5 integration: chosen=56, drawn=[1,5,10,59] → miss, ingen credit", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-miss"]]),
    ticketSizeByUser: new Map([["u-miss", "small"]]),
    walletByUser: new Map([["u-miss", "w-miss"]]),
    hallByUser: new Map([["u-miss", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-sg-miss",
    winnerUserId: "u-miss",
    winnerWalletId: "w-miss",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-miss",
    choiceJson: { chosenNumber: 56 },
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await oddsenEngine.resolveForGame(
      "sg-next-miss",
      [1, 5, 10, 59], // 56 ikke trukket
      DEFAULT_ODDSEN_CONFIG,
      client,
    );
    await client.query("COMMIT");
    assert.equal(r!.outcome, "miss");
    assert.equal(r!.potAmountCents, 0);
  } finally {
    client.release();
  }

  // Ingen credit for miss.
  assert.equal(credits.length, 0);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(
    records.some((r) => r.action === "mini_game.oddsen_resolved_miss"),
  );
});

test("BIN-690 M5 integration: large ticket gir 3000 kr pot ved hit", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-big"]]),
    ticketSizeByUser: new Map([["u-big", "large"]]),
    walletByUser: new Map([["u-big", "w-big"]]),
    hallByUser: new Map([["u-big", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-big-prev",
    winnerUserId: "u-big",
    winnerWalletId: "w-big",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-big",
    choiceJson: { chosenNumber: 57 },
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await oddsenEngine.resolveForGame(
      "sg-next-big",
      [1, 57, 20],
      DEFAULT_ODDSEN_CONFIG,
      client,
    );
    await client.query("COMMIT");
    assert.equal(r!.outcome, "hit");
    assert.equal(r!.potAmountCents, 300_000);
  } finally {
    client.release();
  }
  assert.equal(credits[0]!.amount, 3000);
});

test("BIN-690 M5 integration: expireStateForGame markerer state som expired", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-exp"]]),
    ticketSizeByUser: new Map([["u-exp", "small"]]),
    walletByUser: new Map([["u-exp", "w-exp"]]),
    hallByUser: new Map([["u-exp", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-exp-prev",
    winnerUserId: "u-exp",
    winnerWalletId: "w-exp",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-exp",
    choiceJson: { chosenNumber: 55 },
  });
  assert.equal(state.oddsenStates.size, 1);

  // Simuler at spillet fullfører uten å nå threshold, og cleanup kjøres.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await oddsenEngine.expireStateForGame("sg-next-exp", client);
    await client.query("COMMIT");
    assert.equal(result.expiredCount, 1);
  } finally {
    client.release();
  }

  for (const row of state.oddsenStates.values()) {
    assert.equal(row.resolved_outcome, "expired");
  }
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(
    records.some((r) => r.action === "mini_game.oddsen_resolved_expired"),
  );
});

test("BIN-690 M5 integration: UNIQUE (hall, chosen_for_game) — forsøk 2 blir rejected", async () => {
  // Første vinner legger state. Andre vinner (også Fullt Hus, sjeldent) prøver
  // å INSERTe for samme hall + chosen_for_game → blir rejected.
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-unique"]]),
    ticketSizeByUser: new Map([
      ["u-a", "small"],
      ["u-b", "large"],
    ]),
    walletByUser: new Map([
      ["u-a", "w-a"],
      ["u-b", "w-b"],
    ]),
    hallByUser: new Map([
      ["u-a", "h-main"],
      ["u-b", "h-main"],
    ]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  // Vinner A trigger + velger.
  const trigA = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-prev-a",
    winnerUserId: "u-a",
    winnerWalletId: "w-a",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trigA.resultId!,
    userId: "u-a",
    choiceJson: { chosenNumber: 55 },
  });

  // Vinner B trigger + velger — skal feile på UNIQUE.
  const trigB = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-prev-b",
    winnerUserId: "u-b",
    winnerWalletId: "w-b",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trigB.resultId!,
        userId: "u-b",
        choiceJson: { chosenNumber: 57 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_STATE_ALREADY_EXISTS",
  );

  // Kun én state lagret.
  assert.equal(state.oddsenStates.size, 1);
});

test("BIN-690 M5 integration: orchestrator markerer mini_game_results completed selv ved payout=0", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-comp"]]),
    ticketSizeByUser: new Map([["u-c", "small"]]),
    walletByUser: new Map([["u-c", "w-c"]]),
    hallByUser: new Map([["u-c", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameOddsenEngine({ pool, walletAdapter, auditLog }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-prev-c",
    winnerUserId: "u-c",
    winnerWalletId: "w-c",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-c",
    choiceJson: { chosenNumber: 55 },
  });

  const row = state.miniGameResults.get(trig.resultId!)!;
  assert.notEqual(row.completed_at, null);
  assert.equal(row.payout_cents, 0); // Deferred payout, 0 i mini_game_results.
  assert.ok(row.result_json);
  const json = row.result_json as OddsenChoiceResultJson;
  assert.equal(json.payoutDeferred, true);
});

test("BIN-690 M5 integration: dobbel handleChoice → MINIGAME_ALREADY_COMPLETED", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-idem"]]),
    ticketSizeByUser: new Map([["u-idem", "small"]]),
    walletByUser: new Map([["u-idem", "w-idem"]]),
    hallByUser: new Map([["u-idem", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameOddsenEngine({ pool, walletAdapter, auditLog }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-prev-idem",
    winnerUserId: "u-idem",
    winnerWalletId: "w-idem",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-idem",
    choiceJson: { chosenNumber: 55 },
  });
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-idem",
        choiceJson: { chosenNumber: 56 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-690 M5 integration: resolveForGame idempotent via FOR UPDATE lock — dobbel call bruker bare state 1 gang", async () => {
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-idemr"]]),
    ticketSizeByUser: new Map([["u-r", "small"]]),
    walletByUser: new Map([["u-r", "w-r"]]),
    hallByUser: new Map([["u-r", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-prev-r",
    winnerUserId: "u-r",
    winnerWalletId: "w-r",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-r",
    choiceJson: { chosenNumber: 55 },
  });

  const client1 = await pool.connect();
  try {
    await client1.query("BEGIN");
    const r1 = await oddsenEngine.resolveForGame(
      "sg-next-idemr",
      [55],
      DEFAULT_ODDSEN_CONFIG,
      client1,
    );
    await client1.query("COMMIT");
    assert.equal(r1!.outcome, "hit");
  } finally {
    client1.release();
  }

  // Andre kall: staten er allerede resolved_at != null. FOR UPDATE WHERE
  // resolved_at IS NULL gir 0 rader → returnerer null, ingen dobbel credit.
  const client2 = await pool.connect();
  try {
    await client2.query("BEGIN");
    const r2 = await oddsenEngine.resolveForGame(
      "sg-next-idemr",
      [55],
      DEFAULT_ODDSEN_CONFIG,
      client2,
    );
    await client2.query("COMMIT");
    assert.equal(r2, null);
  } finally {
    client2.release();
  }

  // Kun ett credit-kall totalt.
  assert.equal(credits.length, 1);
});

test("BIN-690 M5 integration: custom admin-config (pot=5000, validNumbers=[80,81]) speiles i runtime", async () => {
  const state = makeFakeState({
    oddsenConfig: {
      validNumbers: [80, 81],
      potSmallNok: 5000,
      potLargeNok: 10000,
      resolveAtDraw: 82,
    },
    nextGameIdInHall: new Map([["h-main", "sg-next-custom"]]),
    ticketSizeByUser: new Map([["u-cust", "small"]]),
    walletByUser: new Map([["u-cust", "w-cust"]]),
    hallByUser: new Map([["u-cust", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });
  const oddsenEngine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  orchestrator.registerMiniGame(oddsenEngine);

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-cust-prev",
    winnerUserId: "u-cust",
    winnerWalletId: "w-cust",
    hallId: "h-main",
    drawSequenceAtWin: 82,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  // Custom validNumbers speilet i trigger payload.
  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  assert.deepEqual(triggerPayload.validNumbers, [80, 81]);
  assert.equal(triggerPayload.potSmallNok, 5000);

  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-cust",
    choiceJson: { chosenNumber: 80 },
  });

  // Resolve.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await oddsenEngine.resolveForGame(
      "sg-next-custom",
      [10, 20, 80],
      {
        validNumbers: [80, 81],
        potSmallNok: 5000,
        potLargeNok: 10000,
        resolveAtDraw: 82,
      },
      client,
    );
    await client.query("COMMIT");
    assert.equal(r!.outcome, "hit");
    assert.equal(r!.potAmountCents, 500_000); // 5000 kr * 100
  } finally {
    client.release();
  }
  assert.equal(credits[0]!.amount, 5000);
});

test("BIN-690 M5 integration: handleChoice feiler → audit-event ikke fires som number_chosen", async () => {
  // Ticket-size mangler → INVALID. Vi skal ikke ha audit-event for chosen,
  // siden INSERT aldri skjedde.
  const state = makeFakeState({
    nextGameIdInHall: new Map([["h-main", "sg-next-fail"]]),
    ticketSizeByUser: new Map(), // Empty — ticket-size mangler.
    walletByUser: new Map([["u-fail", "w-fail"]]),
    hallByUser: new Map([["u-fail", "h-main"]]),
  });
  const { pool } = makeFakePool(state);
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameOddsenEngine({ pool, walletAdapter, auditLog }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-fail-prev",
    winnerUserId: "u-fail",
    winnerWalletId: "w-fail",
    hallId: "h-main",
    drawSequenceAtWin: 57,
    gameConfigJson: { spill1: { miniGames: ["oddsen"] } },
  });
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-fail",
        choiceJson: { chosenNumber: 55 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_TICKET_SIZE_MISSING",
  );

  // Ingen state persistert, ingen chosen-audit.
  assert.equal(state.oddsenStates.size, 0);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    records.filter((r) => r.action === "mini_game.oddsen_number_chosen").length,
    0,
  );
});
