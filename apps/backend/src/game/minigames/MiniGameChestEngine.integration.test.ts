/**
 * BIN-690 Spor 3 M3: integrasjonstester for Chest-runtime via orchestrator.
 *
 * Dekning:
 *   - Full flyt: MiniGamesConfigService → orchestrator.maybeTriggerFor →
 *     handleChoice. Tester at config-endringer speiles i runtime.
 *   - Default-config-fallback når admin-config mangler (6 luker, 400-4000 kr).
 *   - Admin-config override endrer chestCount + range i runtime.
 *   - Credit kalles med `to: "winnings"` (regulatorisk krav).
 *   - Idempotency-key er `g1-minigame-${resultId}`.
 *   - Dobbel handleChoice → MINIGAME_ALREADY_COMPLETED.
 *   - Wallet-credit feil → raden er IKKE markert completed (fail-closed).
 *   - discreteTiers config påvirker runtime-sampling.
 *
 * Merk: bruker in-memory fake-pool (samme pattern som M2 WheelEngine).
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
  MiniGameChestEngine,
  type ChestRng,
  type ChestResultJson,
} from "./MiniGameChestEngine.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FakePoolState {
  /** Simulert `app_mini_games_config` — kun for chest-typen. */
  configRow: { config_json: Record<string, unknown> } | null;
  /** Simulert `app_game1_mini_game_results`. */
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
    // Config-lookup: app_mini_games_config WHERE game_type = $1.
    if (sql.includes("app_mini_games_config") && sql.includes("SELECT")) {
      return {
        rows: state.configRow ? [state.configRow] : [],
      };
    }
    // INSERT mini_game_results.
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

function makeSequencedRng(values: number[]): ChestRng {
  let i = 0;
  return {
    nextInt: () => {
      const v = values[i]!;
      i += 1;
      return v;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("BIN-690 M3 integration: default-config → chest payout (6 luker, 400-4000 kr)", async () => {
  const state: FakePoolState = {
    configRow: null, // Admin har ikke konfigurert → default brukes.
    rows: new Map(),
  };
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
  // 6 verdier fra RNG: 0, 100, 200, 300, 400, 500. Default range = [400, 4000].
  // Verdier blir: 400, 500, 600, 700, 800, 900.
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 100, 200, 300, 400, 500]),
    }),
  );

  // Trigger.
  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-chest-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });
  assert.equal(trig.triggered, true);
  assert.equal(trig.miniGameType, "chest");
  assert.equal(triggers.length, 1);

  // Payload skal ha 6 chests (default).
  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(triggerPayload.chestCount, 6);
  assert.deepEqual(triggerPayload.prizeRange, { minNok: 400, maxNok: 4000 });
  assert.equal(triggerPayload.hasDiscreteTiers, false);

  // Klient velger luke 3.
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: 3 },
  });

  // values = [400, 500, 600, 700, 800, 900] → chosenIndex 3 = 700 kr.
  assert.equal(resp.payoutCents, 70_000);
  const resultJson = resp.resultJson as ChestResultJson;
  assert.equal(resultJson.chosenIndex, 3);
  assert.equal(resultJson.prizeAmountKroner, 700);
  assert.deepEqual(resultJson.allValuesKroner, [400, 500, 600, 700, 800, 900]);
  assert.equal(resultJson.chestCount, 6);

  // Wallet-credit kalt med `to: "winnings"` (regulatorisk krav).
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-winner");
  assert.equal(credits[0]!.amount, 700);
  assert.equal(credits[0]!.options?.to, "winnings");
  assert.equal(
    credits[0]!.options?.idempotencyKey,
    `g1-minigame-${trig.resultId}`,
  );

  // Broadcast.
  assert.equal(results.length, 1);
  assert.equal(results[0]!.payoutCents, 70_000);
  assert.equal(results[0]!.miniGameType, "chest");

  // Audit: trigger + completed.
  const triggerAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.triggered",
  );
  const completedAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.completed",
  );
  assert.equal(triggerAudits.length, 1);
  assert.equal(completedAudits.length, 1);
  assert.equal(completedAudits[0]!.details.miniGameType, "chest");
  assert.equal(completedAudits[0]!.details.payoutCents, 70_000);
});

test("BIN-690 M3 integration: admin-config endring (8 luker, 1000-5000 kr) speiles i runtime", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        numberOfChests: 8,
        prizeRange: { minNok: 1000, maxNok: 5000 },
      },
    },
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
  // 8 verdier. span = 5000 - 1000 + 1 = 4001. rng returnerer 0 → 1000.
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 0, 0, 0, 0, 0, 0, 0]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-chest-2",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });

  // Påse at trigger-payload reflekterer admin-config (ikke default).
  const tpayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(tpayload.chestCount, 8);
  assert.deepEqual(tpayload.prizeRange, { minNok: 1000, maxNok: 5000 });

  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: 0 },
  });
  // values = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] → 1000 kr.
  assert.equal(resp.payoutCents, 100_000);
  assert.equal(credits[0]!.amount, 1000);
  const json = resp.resultJson as ChestResultJson;
  assert.equal(json.chestCount, 8);
  assert.equal(json.allValuesKroner.length, 8);
});

test("BIN-690 M3 integration: admin-config discreteTiers endring speiles i runtime", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        numberOfChests: 3,
        prizeRange: { minNok: 0, maxNok: 0 },
        discreteTiers: [
          { amount: 4000, weight: 1 },
          { amount: 1000, weight: 2 },
        ],
      },
    },
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
  // Total weight = 3. rng returner 0, 1, 2 → tier 0 (4000), tier 1 (1000), tier 1 (1000).
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 1, 2]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-chest-tiers",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });

  // trigger-payload skal indikere discrete-tiers via flagg.
  const tpayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(tpayload.hasDiscreteTiers, true);
  assert.equal(tpayload.chestCount, 3);

  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { chosenIndex: 0 },
  });
  // values[0] = 4000 (tier 0).
  assert.equal(resp.payoutCents, 400_000);
  assert.equal(credits[0]!.amount, 4000);
  const json = resp.resultJson as ChestResultJson;
  assert.deepEqual(json.allValuesKroner, [4000, 1000, 1000]);
});

test("BIN-690 M3 integration: dobbel handleChoice → MINIGAME_ALREADY_COMPLETED", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 0, 0, 0, 0, 0]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-chest-idem",
    winnerUserId: "u-idem",
    winnerWalletId: "w-idem",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });
  assert.equal(trig.triggered, true);

  // Første kall OK.
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-idem",
    choiceJson: { chosenIndex: 0 },
  });

  // Andre kall rejected.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-idem",
        choiceJson: { chosenIndex: 1 },
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-690 M3 integration: 0-amount tier (discreteTiers) ⇒ ingen credit-kall", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        numberOfChests: 3,
        prizeRange: { minNok: 0, maxNok: 0 },
        discreteTiers: [
          { amount: 0, weight: 1 },
          { amount: 100, weight: 1 },
        ],
      },
    },
    rows: new Map(),
  };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  // Velg tier 0 (amount=0) for alle 3 luker.
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 0, 0]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-chest-zero",
    winnerUserId: "u-zero",
    winnerWalletId: "w-zero",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-zero",
    choiceJson: { chosenIndex: 0 },
  });
  assert.equal(resp.payoutCents, 0);
  // Ingen credit-kall siden beløp er 0.
  assert.equal(credits.length, 0);
});

test("BIN-690 M3 integration: wallet.credit kaster → raden er IKKE completed (fail-closed, retry mulig)", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter({ throwOnCredit: true });

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 0, 0, 0, 0, 0]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-chest-fail",
    winnerUserId: "u-fail",
    winnerWalletId: "w-fail",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });
  assert.equal(trig.triggered, true);

  // Wallet-feil → transaksjonen rulles tilbake (ROLLBACK i orchestrator).
  // Vi forventer at feilen bobler opp (fail-closed).
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-fail",
        choiceJson: { chosenIndex: 0 },
      }),
    /simulated wallet failure/,
  );

  // Raden er IKKE markert completed (rollback) → dobbel-submit kan retrye.
  const row = state.rows.get(trig.resultId!);
  assert.equal(row?.completed_at, null);
  assert.equal(row?.payout_cents, 0);
});

test("BIN-690 M3 integration: ugyldig chosenIndex → INVALID_CHOICE, ikke completed", async () => {
  const state: FakePoolState = { configRow: null, rows: new Map() };
  const { pool } = makeFakePool(state);
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(
    new MiniGameChestEngine({
      rng: makeSequencedRng([0, 0, 0, 0, 0, 0]),
    }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-chest-invalid",
    winnerUserId: "u-invalid",
    winnerWalletId: "w-invalid",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["chest"] } },
  });

  // Klient sender out-of-range chosenIndex.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-invalid",
        choiceJson: { chosenIndex: 99 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );

  // Raden er IKKE completed — klient kan retry med gyldig chosenIndex.
  const row = state.rows.get(trig.resultId!);
  assert.equal(row?.completed_at, null);
});
