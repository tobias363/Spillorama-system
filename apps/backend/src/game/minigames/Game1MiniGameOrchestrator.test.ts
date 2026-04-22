/**
 * BIN-690 Spor 3 M1: unit + integration-tester for Game1MiniGameOrchestrator.
 *
 * Dekning:
 *   - extractActiveMiniGameTypes parses gameConfigJson korrekt (positive +
 *     negative cases).
 *   - maybeTriggerFor skipper uten config, uten implementasjon, fanger
 *     DB-feil (fire-and-forget).
 *   - maybeTriggerFor INSERT-er rad + broadcaster.onTrigger ved happy-path.
 *   - handleChoice reject'er ukjent resultId, feil owner, allerede spilt.
 *   - handleChoice dispatcher til implementasjon + utbetaler payout +
 *     persisterer resultat.
 *   - Integrasjon: Fullt Hus → trigger → choice → result-flyt med
 *     mock-implementasjon av MiniGame.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MiniGameOrchestrator,
  extractActiveMiniGameTypes,
  type MiniGameBroadcaster,
  type MiniGameTriggerBroadcast,
  type MiniGameResultBroadcast,
} from "./Game1MiniGameOrchestrator.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
  MiniGameType,
} from "./types.js";
import { DomainError } from "../BingoEngine.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal "spec-able" pool. Tests registrerer handlers per SQL-prefix
 * slik at ingen ekte Postgres trengs.
 */
interface QueryCall {
  sql: string;
  params: unknown[];
}

interface FakePoolHandlers {
  query?: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  connect?: () => Promise<FakePoolClient>;
}

interface FakePoolClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
}

function makeFakePool(handlers: FakePoolHandlers = {}): {
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    connect: () => Promise<FakePoolClient>;
  };
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [] };
    },
    connect: async () => {
      if (handlers.connect) return handlers.connect();
      return {
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
  };
  return { pool, calls };
}

function makeStubAuditLog() {
  const records: Array<Record<string, unknown>> = [];
  return {
    service: {
      record: async (input: Record<string, unknown>) => {
        records.push(input);
      },
    } as unknown as import("../../compliance/AuditLogService.js").AuditLogService,
    records,
  };
}

function makeStubWalletAdapter() {
  const credits: Array<{
    accountId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }> = [];
  return {
    adapter: {
      credit: async (
        accountId: string,
        amount: number,
        reason: string,
        options?: { idempotencyKey?: string },
      ) => {
        credits.push({
          accountId,
          amount,
          reason,
          idempotencyKey: options?.idempotencyKey,
        });
        return { id: `tx-${credits.length}`, accountId, amount };
      },
      debit: async () => {
        throw new Error("unused in tests");
      },
      transfer: async () => {
        throw new Error("unused in tests");
      },
      getBalance: async () => 0,
      getAccountExists: async () => true,
      createAccount: async () => undefined,
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
      onTrigger: (e) => {
        triggers.push(e);
      },
      onResult: (e) => {
        results.push(e);
      },
    },
    triggers,
    results,
  };
}

/**
 * Fake MiniGame-implementasjon brukt for tester. Returnerer deterministisk
 * resultat basert på configSnapshot.payoutCents så vi kan verifisere
 * payout-flyt.
 */
interface FakeMiniGame extends MiniGame {
  triggerCalls: number;
  handleChoiceCalls: number;
}

function makeFakeMiniGame(
  type: MiniGameType,
  fixedPayoutCents: number,
): FakeMiniGame {
  const state = { triggerCalls: 0, handleChoiceCalls: 0 };
  const impl: FakeMiniGame = {
    type,
    get triggerCalls() {
      return state.triggerCalls;
    },
    get handleChoiceCalls() {
      return state.handleChoiceCalls;
    },
    trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
      state.triggerCalls += 1;
      return {
        type,
        resultId: context.resultId,
        payload: { mocked: true, configSnapshot: context.configSnapshot },
        timeoutSeconds: 30,
      };
    },
    async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
      state.handleChoiceCalls += 1;
      return {
        payoutCents: fixedPayoutCents,
        resultJson: {
          type,
          choice: input.choiceJson,
          fixedPayoutCents,
        },
      };
    },
  };
  return impl;
}

// ── extractActiveMiniGameTypes ────────────────────────────────────────────────

test("BIN-690 M1: extractActiveMiniGameTypes returnerer tom for null/undefined", () => {
  assert.deepEqual(extractActiveMiniGameTypes(null), []);
  assert.deepEqual(extractActiveMiniGameTypes(undefined), []);
  assert.deepEqual(extractActiveMiniGameTypes({}), []);
  assert.deepEqual(extractActiveMiniGameTypes("string" as unknown), []);
  assert.deepEqual(extractActiveMiniGameTypes([]), []);
});

test("BIN-690 M1: extractActiveMiniGameTypes parses spill1.miniGames-array", () => {
  const cfg = { spill1: { miniGames: ["wheel", "chest"] } };
  assert.deepEqual(extractActiveMiniGameTypes(cfg), ["wheel", "chest"]);
});

test("BIN-690 M1: extractActiveMiniGameTypes filtrerer ukjente strings", () => {
  const cfg = { spill1: { miniGames: ["wheel", "bogus", "chest", 42, null] } };
  assert.deepEqual(extractActiveMiniGameTypes(cfg), ["wheel", "chest"]);
});

test("BIN-690 M1: extractActiveMiniGameTypes returnerer tom ved manglende spill1", () => {
  assert.deepEqual(extractActiveMiniGameTypes({ other: true }), []);
});

test("BIN-690 M1: extractActiveMiniGameTypes returnerer tom ved miniGames ikke array", () => {
  const cfg = { spill1: { miniGames: "wheel" } };
  assert.deepEqual(extractActiveMiniGameTypes(cfg), []);
});

// ── registerMiniGame ──────────────────────────────────────────────────────────

test("BIN-690 M1: registerMiniGame lagrer implementasjon og hindrer duplikat", () => {
  const { pool } = makeFakePool();
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });

  const wheel = makeFakeMiniGame("wheel", 1000);
  orchestrator.registerMiniGame(wheel);
  assert.deepEqual(orchestrator.getRegisteredTypes(), ["wheel"]);

  assert.throws(
    () => orchestrator.registerMiniGame(wheel),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_ALREADY_REGISTERED",
  );
});

// ── maybeTriggerFor ───────────────────────────────────────────────────────────

test("BIN-690 M1: maybeTriggerFor skip når ingen mini-games konfigurert", async () => {
  const { pool } = makeFakePool();
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });

  const result = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    gameConfigJson: null,
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "NO_MINI_GAMES_CONFIGURED");
});

test("BIN-690 M1: maybeTriggerFor skip når implementasjon mangler (ikke-kast)", async () => {
  const { pool } = makeFakePool();
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });

  // Admin har konfigurert "wheel" men ingen impl registrert.
  const result = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-1",
    winnerUserId: "u-1",
    winnerWalletId: "w-1",
    hallId: "h-1",
    drawSequenceAtWin: 45,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });

  assert.equal(result.triggered, false);
  assert.equal(result.miniGameType, "wheel");
  assert.equal(result.reason, "IMPLEMENTATION_NOT_REGISTERED");
});

test("BIN-690 M1: maybeTriggerFor happy-path INSERT + broadcaster.onTrigger", async () => {
  // Pool svar: config-lookup → tom rad; INSERT → ingen feil.
  const insertCalls: Array<{ sql: string; params: unknown[] }> = [];
  const { pool } = makeFakePool({
    query: async (sql, params) => {
      if (sql.includes("INSERT INTO")) {
        insertCalls.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("app_mini_games_config")) {
        // Ingen config-rad → empty.
        return { rows: [] };
      }
      return { rows: [] };
    },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();
  const { broadcaster, triggers } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });

  const wheel = makeFakeMiniGame("wheel", 0);
  orchestrator.registerMiniGame(wheel);

  const result = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-42",
    winnerUserId: "u-42",
    winnerWalletId: "w-42",
    hallId: "h-1",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel", "chest"] } },
  });

  assert.equal(result.triggered, true);
  assert.equal(result.miniGameType, "wheel");
  assert.ok(result.resultId && result.resultId.startsWith("mgr-"));

  // INSERT kalt én gang.
  assert.equal(insertCalls.length, 1);
  assert.ok(insertCalls[0]!.sql.includes("app_game1_mini_game_results"));
  assert.equal(insertCalls[0]!.params[0], result.resultId);
  assert.equal(insertCalls[0]!.params[1], "sg-42");
  assert.equal(insertCalls[0]!.params[2], "wheel");
  assert.equal(insertCalls[0]!.params[3], "u-42");

  // Broadcaster kalt én gang.
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0]!.scheduledGameId, "sg-42");
  assert.equal(triggers[0]!.winnerUserId, "u-42");
  assert.equal(triggers[0]!.miniGameType, "wheel");
  assert.equal(triggers[0]!.resultId, result.resultId);

  // Implementation ble kalt.
  assert.equal(wheel.triggerCalls, 1);
});

test("BIN-690 M1: maybeTriggerFor fanger DB-feil og returnerer reason (ikke kast)", async () => {
  // Pool kaster under INSERT.
  const { pool } = makeFakePool({
    query: async (sql) => {
      if (sql.includes("INSERT INTO")) {
        throw new Error("simulated DB error");
      }
      return { rows: [] };
    },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  // Skal IKKE kaste — fire-and-forget i produksjon.
  const result = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-err",
    winnerUserId: "u-err",
    winnerWalletId: "w-err",
    hallId: "h-err",
    drawSequenceAtWin: 45,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "TRIGGER_FAILED");
  assert.equal(result.miniGameType, "wheel");
});

// ── handleChoice ──────────────────────────────────────────────────────────────

/**
 * Setter opp en FakePoolClient som returnerer predefinerte rader for
 * SELECT og samler UPDATE-queries i `updates`.
 */
function makeHandleChoicePool(opts: {
  resultRow: Record<string, unknown> | null;
  userWalletId?: string | null;
  phaseWinnerRow?: { hall_id: string; draw_sequence_at_win: number } | null;
  assignmentRow?: { hall_id: string } | null;
}): {
  pool: { query: () => Promise<{ rows: unknown[] }>; connect: () => Promise<FakePoolClient> };
  transactions: string[];
  updates: QueryCall[];
} {
  const transactions: string[] = [];
  const updates: QueryCall[] = [];
  const clientQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
      transactions.push(sql.trim());
      return { rows: [] };
    }
    // SELECT FOR UPDATE (lockResultRow).
    if (sql.includes("FOR UPDATE") && sql.includes("app_game1_mini_game_results")) {
      return { rows: opts.resultRow ? [opts.resultRow] : [] };
    }
    // SELECT wallet_id fra app_users.
    if (sql.includes("app_users") && sql.includes("wallet_id")) {
      return opts.userWalletId
        ? { rows: [{ wallet_id: opts.userWalletId }] }
        : { rows: [{ wallet_id: null }] };
    }
    // SELECT fra phase_winners.
    if (sql.includes("app_game1_phase_winners")) {
      return opts.phaseWinnerRow
        ? { rows: [opts.phaseWinnerRow] }
        : { rows: [] };
    }
    // SELECT fra ticket_assignments.
    if (sql.includes("app_game1_ticket_assignments")) {
      return opts.assignmentRow
        ? { rows: [opts.assignmentRow] }
        : { rows: [] };
    }
    if (sql.includes("UPDATE") && sql.includes("app_game1_mini_game_results")) {
      updates.push({ sql, params });
      return { rows: [] };
    }
    return { rows: [] };
  };
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: clientQuery,
      release: () => undefined,
    }),
  };
  return { pool, transactions, updates };
}

test("BIN-690 M1: handleChoice kaster MINIGAME_NOT_FOUND når rad mangler", async () => {
  const { pool } = makeHandleChoicePool({ resultRow: null });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: "mgr-nope",
        userId: "u-1",
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_NOT_FOUND",
  );
});

test("BIN-690 M1: handleChoice kaster MINIGAME_NOT_OWNER for feil bruker", async () => {
  const { pool } = makeHandleChoicePool({
    resultRow: {
      id: "mgr-1",
      scheduled_game_id: "sg-1",
      mini_game_type: "wheel",
      winner_user_id: "u-owner",
      config_snapshot_json: {},
      choice_json: null,
      result_json: null,
      payout_cents: 0,
      triggered_at: new Date(),
      completed_at: null,
    },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: "mgr-1",
        userId: "u-intruder",
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_NOT_OWNER",
  );
});

test("BIN-690 M1: handleChoice kaster MINIGAME_ALREADY_COMPLETED for committed rad", async () => {
  const { pool } = makeHandleChoicePool({
    resultRow: {
      id: "mgr-1",
      scheduled_game_id: "sg-1",
      mini_game_type: "wheel",
      winner_user_id: "u-1",
      config_snapshot_json: {},
      choice_json: {},
      result_json: {},
      payout_cents: 500,
      triggered_at: new Date(),
      completed_at: new Date(),
    },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: "mgr-1",
        userId: "u-1",
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});

test("BIN-690 M1: handleChoice kaster MINIGAME_NO_IMPLEMENTATION når type ikke registrert", async () => {
  const { pool } = makeHandleChoicePool({
    resultRow: {
      id: "mgr-1",
      scheduled_game_id: "sg-1",
      mini_game_type: "chest", // Ikke registrert
      winner_user_id: "u-1",
      config_snapshot_json: {},
      choice_json: null,
      result_json: null,
      payout_cents: 0,
      triggered_at: new Date(),
      completed_at: null,
    },
    userWalletId: "w-1",
    phaseWinnerRow: { hall_id: "h-1", draw_sequence_at_win: 50 },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  // Registrerer kun wheel, ikke chest.
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: "mgr-1",
        userId: "u-1",
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_NO_IMPLEMENTATION",
  );
});

test("BIN-690 M1: handleChoice happy-path utbetaler + UPDATE + broadcast", async () => {
  const { pool, transactions, updates } = makeHandleChoicePool({
    resultRow: {
      id: "mgr-happy",
      scheduled_game_id: "sg-happy",
      mini_game_type: "wheel",
      winner_user_id: "u-happy",
      config_snapshot_json: { segments: [] },
      choice_json: null,
      result_json: null,
      payout_cents: 0,
      triggered_at: new Date(),
      completed_at: null,
    },
    userWalletId: "w-happy",
    phaseWinnerRow: { hall_id: "h-happy", draw_sequence_at_win: 48 },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, results } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });

  const wheel = makeFakeMiniGame("wheel", 12500); // 125 kr
  orchestrator.registerMiniGame(wheel);

  const result = await orchestrator.handleChoice({
    resultId: "mgr-happy",
    userId: "u-happy",
    choiceJson: { spin: true },
  });

  // Transaksjon commit-ed.
  assert.deepEqual(transactions, ["BEGIN", "COMMIT"]);

  // Wallet-credit kalt med korrekt beløp i kroner + idempotency-key.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-happy");
  assert.equal(credits[0]!.amount, 125);
  assert.equal(credits[0]!.idempotencyKey, "g1-minigame-mgr-happy");

  // UPDATE kalt med resultId + choice + result + payout.
  assert.equal(updates.length, 1);
  assert.equal(updates[0]!.params[0], "mgr-happy");
  assert.equal(updates[0]!.params[3], 12500);

  // Implementation kalt.
  assert.equal(wheel.handleChoiceCalls, 1);

  // Broadcast på resultat.
  assert.equal(results.length, 1);
  assert.equal(results[0]!.resultId, "mgr-happy");
  assert.equal(results[0]!.payoutCents, 12500);
  assert.equal(results[0]!.miniGameType, "wheel");

  // Return-value.
  assert.equal(result.resultId, "mgr-happy");
  assert.equal(result.payoutCents, 12500);
});

test("BIN-690 M1: handleChoice ikke utbetaler når payoutCents=0", async () => {
  const { pool, updates } = makeHandleChoicePool({
    resultRow: {
      id: "mgr-zero",
      scheduled_game_id: "sg-zero",
      mini_game_type: "wheel",
      winner_user_id: "u-zero",
      config_snapshot_json: {},
      choice_json: null,
      result_json: null,
      payout_cents: 0,
      triggered_at: new Date(),
      completed_at: null,
    },
    userWalletId: "w-zero",
    phaseWinnerRow: { hall_id: "h-zero", draw_sequence_at_win: 50 },
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
  });
  orchestrator.registerMiniGame(makeFakeMiniGame("wheel", 0));

  await orchestrator.handleChoice({
    resultId: "mgr-zero",
    userId: "u-zero",
    choiceJson: {},
  });

  // Ingen wallet-credit fordi payoutCents=0.
  assert.equal(credits.length, 0);
  // UPDATE er fortsatt kalt med payout_cents=0.
  assert.equal(updates.length, 1);
  assert.equal(updates[0]!.params[3], 0);
});

// ── Integration: trigger → choice → result ──────────────────────────────────

test("BIN-690 M1 integration: Fullt Hus → trigger → klient-choice → result", async () => {
  // Ett in-memory resultat-register som simulerer DB. INSERT skriver en
  // rad, SELECT FOR UPDATE leser den ut, UPDATE markerer completed.
  const rows = new Map<string, Record<string, unknown>>();

  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO") && sql.includes("app_game1_mini_game_results")) {
        const [id, scheduledGameId, type, winnerUserId, configSnapshotJson] = params as [
          string,
          string,
          string,
          string,
          string,
        ];
        rows.set(id, {
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
      if (sql.includes("app_mini_games_config")) {
        // Admin-config tom for denne testen.
        return { rows: [] };
      }
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
          return { rows: [] };
        }
        if (sql.includes("FOR UPDATE") && sql.includes("app_game1_mini_game_results")) {
          const id = params[0] as string;
          const row = rows.get(id);
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
          const row = rows.get(id);
          if (row) {
            row.choice_json = JSON.parse(params[1] as string);
            row.result_json = JSON.parse(params[2] as string);
            row.payout_cents = params[3] as number;
            row.completed_at = new Date();
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
  };

  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWalletAdapter();
  const { broadcaster, triggers, results } = makeRecordingBroadcaster();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool: pool as unknown as import("pg").Pool,
    auditLog,
    walletAdapter,
    broadcaster,
  });

  const wheel = makeFakeMiniGame("wheel", 5000); // 50 kr
  orchestrator.registerMiniGame(wheel);

  // Fase 1: Fullt Hus → orchestrator trigges.
  const trig = await orchestrator.maybeTriggerFor({
    scheduledGameId: "sg-int",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    gameConfigJson: { spill1: { miniGames: ["wheel"] } },
  });

  assert.equal(trig.triggered, true);
  assert.equal(trig.miniGameType, "wheel");
  assert.equal(triggers.length, 1);
  assert.equal(wheel.triggerCalls, 1);
  assert.equal(rows.size, 1);

  // Fase 2: Klient sender valg → handleChoice.
  const resp = await orchestrator.handleChoice({
    resultId: trig.resultId!,
    userId: "u-winner",
    choiceJson: { spin: true },
  });

  assert.equal(resp.payoutCents, 5000);
  assert.equal(resp.miniGameType, "wheel");
  assert.equal(wheel.handleChoiceCalls, 1);
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-winner");
  assert.equal(credits[0]!.amount, 50);
  assert.equal(results.length, 1);

  // Rad-state skal være completed.
  const row = rows.get(trig.resultId!)!;
  assert.equal(row.payout_cents, 5000);
  assert.notEqual(row.completed_at, null);

  // Fase 3: Dobbel-submit → reject.
  await assert.rejects(
    () =>
      orchestrator.handleChoice({
        resultId: trig.resultId!,
        userId: "u-winner",
        choiceJson: { spin: true },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "MINIGAME_ALREADY_COMPLETED",
  );
});
