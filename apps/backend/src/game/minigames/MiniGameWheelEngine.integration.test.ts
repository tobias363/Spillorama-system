/**
 * BIN-690 Spor 3 M2: integrasjonstester for Wheel-runtime via orchestrator.
 *
 * Dekning:
 *   - Full flyt: MiniGamesConfigService → orchestrator.maybeTriggerFor →
 *     handleChoice. Tester at config-endringer speiles i runtime.
 *   - Idempotency: dobbel handleChoice rejects (MINIGAME_ALREADY_COMPLETED).
 *   - Default-config-fallback når admin-config mangler.
 *   - Credit kalles med `to: "winnings"` (regulatorisk krav).
 *   - `mini_game:trigger`/`mini_game:result`-broadcast-events fyres.
 *
 * Merk: bruker in-memory fake-pool (samme pattern som
 * Game1MiniGameOrchestrator.test.ts) slik at ingen Postgres kreves.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  type MiniGameBroadcaster,
  type MiniGameResultBroadcast,
  type MiniGameTriggerBroadcast,
} from "./Game1MiniGameOrchestrator.js";
import { MiniGameWheelEngine, type WheelRng, type WheelResultJson } from "./MiniGameWheelEngine.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FakePoolState {
  /** Simulert `app_mini_games_config` — kun for wheel-typen. */
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

function makeSequencedRng(values: number[]): WheelRng {
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

test("BIN-690 M2 integration: default-config → wheel payout (50 buckets, legacy-paritet)", async () => {
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
  // Bucket 14 = første bucket i gruppe 3 (1000 kr).
  orchestrator.registerMiniGame(
    new MiniGameWheelEngine({ rng: makeSequencedRng([14, 0]) }),
  );

  // Trigger.
  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });
  assert.equal(trig.triggered, true);
  assert.equal(trig.miniGameType, "wheel");
  assert.equal(triggers.length, 1);
  // Payload skal ha 50 buckets (default).
  const triggerPayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(triggerPayload.totalBuckets, 50);

  // Klient sender "spin".
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { spin: true },
  });

  // Bucket 14 → 1000 kr → 100 000 øre.
  assert.equal(resp.payoutCents, 100_000);
  const resultJson = resp.resultJson as WheelResultJson;
  assert.equal(resultJson.winningBucketIndex, 14);
  assert.equal(resultJson.prizeGroupIndex, 3);
  assert.equal(resultJson.amountKroner, 1000);

  // Wallet-credit kalt med `to: "winnings"` (regulatorisk krav).
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-winner");
  assert.equal(credits[0]!.amount, 1000);
  assert.equal(credits[0]!.options?.to, "winnings");
  assert.equal(
    credits[0]!.options?.idempotencyKey,
    `g1-minigame-${trig.resultId}`,
  );

  // Broadcast.
  assert.equal(results.length, 1);
  assert.equal(results[0]!.payoutCents, 100_000);
  assert.equal(results[0]!.miniGameType, "wheel");

  // Audit: trigger + completed.
  const triggerAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.triggered",
  );
  const completedAudits = auditRecords.filter(
    (r) => r.action === "game1_minigame.completed",
  );
  assert.equal(triggerAudits.length, 1);
  assert.equal(completedAudits.length, 1);
  assert.equal(completedAudits[0]!.details.miniGameType, "wheel");
  assert.equal(completedAudits[0]!.details.payoutCents, 100_000);
});

test("BIN-690 M2 integration: admin-config endring speiles i runtime", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        prizes: [
          { amount: 50000, buckets: 1 },
          { amount: 100, buckets: 9 },
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
  orchestrator.registerMiniGame(
    new MiniGameWheelEngine({ rng: makeSequencedRng([0, 0]) }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int-2",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });

  // Påse at trigger-payload reflekterer admin-config (ikke default).
  const tpayload = triggers[0]!.payload as Record<string, unknown>;
  assert.equal(tpayload.totalBuckets, 10);

  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: {},
  });
  // Bucket 0 → gruppe 0 → 50 000 kr.
  assert.equal(resp.payoutCents, 5_000_000);
  assert.equal(credits[0]!.amount, 50000);
});

test("BIN-690 M2 integration: dobbel handleChoice → MINIGAME_ALREADY_COMPLETED", async () => {
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
    new MiniGameWheelEngine({ rng: makeSequencedRng([0, 0, 0, 0]) }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-idem",
    winnerUserId: "u-idem",
    winnerWalletId: "w-idem",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });
  assert.equal(trig.triggered, true);

  // Første kall OK.
  await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-idem",
    choiceJson: {},
  });

  // Andre kall rejected.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-idem",
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-690 M2 integration: 0-amount bucket ⇒ ingen credit-kall", async () => {
  const state: FakePoolState = {
    configRow: {
      config_json: {
        prizes: [
          { amount: 0, buckets: 5 },
          { amount: 100, buckets: 1 },
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
  orchestrator.registerMiniGame(
    new MiniGameWheelEngine({ rng: makeSequencedRng([0, 1]) }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-zero",
    winnerUserId: "u-zero",
    winnerWalletId: "w-zero",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-zero",
    choiceJson: {},
  });
  assert.equal(resp.payoutCents, 0);
  // Ingen credit-kall siden beløp er 0.
  assert.equal(credits.length, 0);
});

test("BIN-690 M2 integration: wallet.credit kaster → DomainError bobler opp (fail-closed)", async () => {
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
    new MiniGameWheelEngine({ rng: makeSequencedRng([0, 0]) }),
  );

  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-fail",
    winnerUserId: "u-fail",
    winnerWalletId: "w-fail",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });
  assert.equal(trig.triggered, true);

  // Wallet-feil → transaksjonen rulles tilbake (ROLLBACK i orchestrator).
  // Vi forventer at feilen bobler opp (fail-closed).
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-fail",
        choiceJson: {},
      }),
    /simulated wallet failure/,
  );

  // Raden er IKKE markert completed (rollback) → dobbel-submit kan retrye.
  const row = state.rows.get(trig.resultId!);
  assert.equal(row?.completed_at, null);
  assert.equal(row?.payout_cents, 0);
});
