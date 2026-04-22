/**
 * BIN-690 Spor 3 M5: unit-tester for MiniGameOddsenEngine.
 *
 * Dekning:
 *   - parseOddsenConfig: tom config → default, malformed → throw, gyldig
 *     passes through (default + overridden validNumbers + pot-amounts).
 *   - trigger: returnerer korrekt payload-shape, bruker configSnapshot.
 *   - handleChoice: persisterer state, validerer chosenNumber ∈ validNumbers,
 *     finner ticket-size, finner neste spill, kaster ved mangel.
 *   - handleChoice: payoutCents er alltid 0 (deferred payout).
 *   - resolveForGame: hit → credit med `to:winnings` + idempotency,
 *     miss → ingen credit, UPDATE-er oddsen_state korrekt.
 *   - resolveForGame: pot-størrelse basert på ticket-size-snapshot.
 *   - resolveForGame: idempotent (FOR UPDATE + idempotency-key).
 *   - expireStateForGame: markerer resolved_outcome='expired'.
 *
 * Integrasjonstester (fake-pool + orchestrator wire-up) ligger i
 * `MiniGameOddsenEngine.integration.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_ODDSEN_CONFIG,
  MiniGameOddsenEngine,
  parseOddsenConfig,
  type OddsenChoiceResultJson,
  type OddsenConfig,
} from "./MiniGameOddsenEngine.js";
import type { MiniGameTriggerContext } from "./types.js";
import { DomainError } from "../BingoEngine.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeContext(
  configSnapshot: Readonly<Record<string, unknown>> = {},
  overrides: Partial<MiniGameTriggerContext> = {},
): MiniGameTriggerContext {
  return {
    resultId: "mgr-oddsen-test-1",
    scheduledGameId: "sg-oddsen-1",
    winnerUserId: "u-winner",
    winnerWalletId: "w-winner",
    hallId: "h-main",
    drawSequenceAtWin: 50,
    configSnapshot,
    ...overrides,
  };
}

interface FakeQueryHandler {
  (sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount?: number }>;
}

/**
 * Fake Pool som kan konfigureres med handlers per SQL-mønster.
 * Støtter både `pool.query` og `pool.connect().query`.
 */
function makeFakePool(handler: FakeQueryHandler): Pool {
  const queryFn = async (sql: string, params: unknown[] = []) =>
    handler(sql, params);
  return {
    query: queryFn,
    connect: async () =>
      ({
        query: queryFn,
        release: () => undefined,
      }) as unknown as PoolClient,
  } as unknown as Pool;
}

function makeStubAuditLog(): {
  service: AuditLogService;
  records: Array<{ action: string; resourceId: string; details: Record<string, unknown> }>;
} {
  const records: Array<{ action: string; resourceId: string; details: Record<string, unknown> }> = [];
  const service = {
    record: async (entry: {
      actorId: string | null;
      actorType: string;
      action: string;
      resource: string;
      resourceId: string;
      details: Record<string, unknown>;
    }) => {
      records.push({
        action: entry.action,
        resourceId: entry.resourceId,
        details: entry.details,
      });
    },
  } as unknown as AuditLogService;
  return { service, records };
}

interface CreditCall {
  accountId: string;
  amount: number;
  reason: string;
  options: { idempotencyKey?: string; to?: string } | undefined;
}

function makeStubWallet(opts: { throwOnCredit?: boolean } = {}): {
  adapter: WalletAdapter;
  credits: CreditCall[];
} {
  const credits: CreditCall[] = [];
  const adapter = {
    credit: async (
      accountId: string,
      amount: number,
      reason: string,
      options?: { idempotencyKey?: string; to?: string },
    ) => {
      if (opts.throwOnCredit) throw new Error("wallet credit failed");
      credits.push({ accountId, amount, reason, options });
      return { id: `wtx-${credits.length}` };
    },
    debit: async () => ({ id: "dbg" }),
    transfer: async () => ({ fromTx: { id: "f" }, toTx: { id: "t" } }),
    getBalance: async () => 0,
  } as unknown as WalletAdapter;
  return { adapter, credits };
}

// ── parseOddsenConfig ────────────────────────────────────────────────────────

test("BIN-690 M5: parseOddsenConfig — tom config returnerer default", () => {
  assert.deepEqual(parseOddsenConfig({}), DEFAULT_ODDSEN_CONFIG);
});

test("BIN-690 M5: parseOddsenConfig — default har [55,56,57] + 1500/3000 + resolveAtDraw=57", () => {
  assert.deepEqual([...DEFAULT_ODDSEN_CONFIG.validNumbers], [55, 56, 57]);
  assert.equal(DEFAULT_ODDSEN_CONFIG.potSmallNok, 1500);
  assert.equal(DEFAULT_ODDSEN_CONFIG.potLargeNok, 3000);
  assert.equal(DEFAULT_ODDSEN_CONFIG.resolveAtDraw, 57);
});

test("BIN-690 M5: parseOddsenConfig — kun 'active' i config faller tilbake til default", () => {
  assert.deepEqual(parseOddsenConfig({ active: true }), DEFAULT_ODDSEN_CONFIG);
});

test("BIN-690 M5: parseOddsenConfig — aksepterer full custom config", () => {
  const cfg = parseOddsenConfig({
    validNumbers: [50, 51, 52],
    potSmallNok: 500,
    potLargeNok: 1000,
    resolveAtDraw: 52,
  });
  assert.deepEqual([...cfg.validNumbers], [50, 51, 52]);
  assert.equal(cfg.potSmallNok, 500);
  assert.equal(cfg.potLargeNok, 1000);
  assert.equal(cfg.resolveAtDraw, 52);
});

test("BIN-690 M5: parseOddsenConfig — partial config merges med default", () => {
  const cfg = parseOddsenConfig({ potSmallNok: 2000 });
  assert.equal(cfg.potSmallNok, 2000);
  assert.equal(cfg.potLargeNok, DEFAULT_ODDSEN_CONFIG.potLargeNok);
  assert.deepEqual([...cfg.validNumbers], [...DEFAULT_ODDSEN_CONFIG.validNumbers]);
});

test("BIN-690 M5: parseOddsenConfig — validNumbers ikke-array → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ validNumbers: 55 as unknown as number[] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — tom validNumbers → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ validNumbers: [] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — validNumbers med ikke-heltall → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ validNumbers: [55, 55.5, 56] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — validNumbers med 0 eller negativ → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ validNumbers: [55, -1] }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — negativ potSmallNok → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ potSmallNok: -100 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — negativ potLargeNok → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ potLargeNok: -1 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — non-integer potSmall → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ potSmallNok: 1500.5 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — resolveAtDraw 0 eller negativ → INVALID_ODDSEN_CONFIG", () => {
  assert.throws(
    () => parseOddsenConfig({ resolveAtDraw: 0 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: parseOddsenConfig — pot=0 er gyldig (no-payout config)", () => {
  const cfg = parseOddsenConfig({ potSmallNok: 0, potLargeNok: 0 });
  assert.equal(cfg.potSmallNok, 0);
  assert.equal(cfg.potLargeNok, 0);
});

// ── trigger ──────────────────────────────────────────────────────────────────

test("BIN-690 M5: trigger — returnerer korrekt payload-struktur for default-config", () => {
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({
    pool,
    walletAdapter,
    auditLog,
  });
  const payload = engine.trigger(makeContext());
  assert.equal(payload.type, "oddsen");
  assert.equal(payload.resultId, "mgr-oddsen-test-1");
  assert.equal(payload.timeoutSeconds, 60);
  const inner = payload.payload as Record<string, unknown>;
  assert.deepEqual(inner.validNumbers, [55, 56, 57]);
  assert.equal(inner.potSmallNok, 1500);
  assert.equal(inner.potLargeNok, 3000);
  assert.equal(inner.resolveAtDraw, 57);
});

test("BIN-690 M5: trigger — bruker admin-configSnapshot (override default)", () => {
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });
  const payload = engine.trigger(
    makeContext({
      validNumbers: [42, 43, 44],
      potSmallNok: 500,
      potLargeNok: 1000,
      resolveAtDraw: 45,
    }),
  );
  const inner = payload.payload as Record<string, unknown>;
  assert.deepEqual(inner.validNumbers, [42, 43, 44]);
  assert.equal(inner.potSmallNok, 500);
  assert.equal(inner.potLargeNok, 1000);
  assert.equal(inner.resolveAtDraw, 45);
});

test("BIN-690 M5: trigger — malformed config kaster INVALID_ODDSEN_CONFIG", () => {
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });
  assert.throws(
    () =>
      engine.trigger(
        makeContext({ potSmallNok: -1 }),
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_ODDSEN_CONFIG",
  );
});

test("BIN-690 M5: trigger — type === 'oddsen' konstant", () => {
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });
  assert.equal(engine.type, "oddsen");
});

// ── handleChoice ─────────────────────────────────────────────────────────────

/**
 * Hjelper: bygg en fake-pool som kan svare på de tre lookup-queries
 * handleChoice gjør (phase_winners-join, fallback assignment, next-game).
 */
function makeHandleChoicePool(options: {
  ticketSize?: "small" | "large" | null;
  nextGameId?: string | null;
  insertBehaviour?: "ok" | "unique_violation" | "throw";
}): {
  pool: Pool;
  inserts: Array<{ sql: string; params: unknown[] }>;
} {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const handler: FakeQueryHandler = async (sql, params) => {
    // phase_winners-join → ticket_size
    if (sql.includes("phase_winners") && sql.includes("ticket_size") && sql.includes("JOIN")) {
      if (options.ticketSize != null) {
        return { rows: [{ ticket_size: options.ticketSize }] };
      }
      return { rows: [] };
    }
    // fallback assignments
    if (
      sql.includes("ticket_assignments") &&
      sql.includes("ticket_size") &&
      !sql.includes("JOIN")
    ) {
      if (options.ticketSize != null) {
        return { rows: [{ ticket_size: options.ticketSize }] };
      }
      return { rows: [] };
    }
    // next-game lookup
    if (sql.includes("scheduled_games") && sql.includes("scheduled_start_time")) {
      if (options.nextGameId) {
        return { rows: [{ id: options.nextGameId }] };
      }
      return { rows: [] };
    }
    // INSERT oddsen_state
    if (sql.includes("INSERT INTO") && sql.includes("oddsen_state")) {
      inserts.push({ sql, params });
      if (options.insertBehaviour === "unique_violation") {
        const err = new Error("duplicate key") as Error & { code?: string };
        err.code = "23505";
        throw err;
      }
      if (options.insertBehaviour === "throw") {
        throw new Error("insert failed");
      }
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { pool: makeFakePool(handler), inserts };
}

test("BIN-690 M5: handleChoice — persisterer state + returnerer payoutCents=0", async () => {
  const { pool, inserts } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next-1",
  });
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.handleChoice({
    resultId: "mgr-1",
    context: makeContext(),
    choiceJson: { chosenNumber: 55 },
  });

  // Payout deferred — ingen øyeblikkelig credit.
  assert.equal(result.payoutCents, 0);
  assert.equal(credits.length, 0);

  // INSERT skjedde med riktige params.
  assert.equal(inserts.length, 1);
  const params = inserts[0]!.params;
  // Params-rekkefølge: id, hallId, chosenNumber, winnerUserId, chosenForGame,
  // setByGame, ticketSize.
  assert.equal(params[1], "h-main");
  assert.equal(params[2], 55);
  assert.equal(params[3], "u-winner");
  assert.equal(params[4], "sg-next-1");
  assert.equal(params[5], "sg-oddsen-1");
  assert.equal(params[6], "small");

  const json = result.resultJson as OddsenChoiceResultJson;
  assert.equal(json.chosenNumber, 55);
  assert.equal(json.chosenForGameId, "sg-next-1");
  assert.equal(json.ticketSizeAtWin, "small");
  assert.equal(json.potAmountNokIfHit, 1500);
  assert.deepEqual([...json.validNumbers], [55, 56, 57]);
  assert.equal(json.payoutDeferred, true);

  // Audit recorded (async fire-and-forget — vent et tick).
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(records.some((r) => r.action === "mini_game.oddsen_number_chosen"));
});

test("BIN-690 M5: handleChoice — large ticket gir potLarge-beløp", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "large",
    nextGameId: "sg-next-big",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.handleChoice({
    resultId: "mgr-2",
    context: makeContext(),
    choiceJson: { chosenNumber: 57 },
  });
  const json = result.resultJson as OddsenChoiceResultJson;
  assert.equal(json.potAmountNokIfHit, 3000); // large → 3000 kr
  assert.equal(json.ticketSizeAtWin, "large");
});

test("BIN-690 M5: handleChoice — manglende chosenNumber → INVALID_CHOICE", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-inv",
        context: makeContext(),
        choiceJson: {},
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M5: handleChoice — chosenNumber ikke i validNumbers → INVALID_CHOICE", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-inv-num",
        context: makeContext(),
        choiceJson: { chosenNumber: 42 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M5: handleChoice — chosenNumber ikke-heltall (float) → INVALID_CHOICE", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-inv-float",
        context: makeContext(),
        choiceJson: { chosenNumber: 55.5 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CHOICE",
  );
});

test("BIN-690 M5: handleChoice — ingen neste spill i hallen → ODDSEN_NO_NEXT_GAME", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: null,
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-no-next",
        context: makeContext(),
        choiceJson: { chosenNumber: 55 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_NO_NEXT_GAME",
  );
});

test("BIN-690 M5: handleChoice — ticket-size mangler → ODDSEN_TICKET_SIZE_MISSING", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: null, // Hverken phase_winners eller assignment matcher.
    nextGameId: "sg-next",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-no-size",
        context: makeContext(),
        choiceJson: { chosenNumber: 56 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_TICKET_SIZE_MISSING",
  );
});

test("BIN-690 M5: handleChoice — duplicate (hall, chosen_for_game_id) → ODDSEN_STATE_ALREADY_EXISTS", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next",
    insertBehaviour: "unique_violation",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.handleChoice({
        resultId: "mgr-dup",
        context: makeContext(),
        choiceJson: { chosenNumber: 55 },
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_STATE_ALREADY_EXISTS",
  );
});

test("BIN-690 M5: handleChoice — custom validNumbers config respekteres", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next-custom",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  // Custom config aksepterer 42 som gyldig tall.
  const result = await engine.handleChoice({
    resultId: "mgr-custom",
    context: makeContext({
      validNumbers: [42, 43, 44],
      potSmallNok: 500,
      potLargeNok: 1000,
      resolveAtDraw: 45,
    }),
    choiceJson: { chosenNumber: 42 },
  });
  const json = result.resultJson as OddsenChoiceResultJson;
  assert.equal(json.chosenNumber, 42);
  assert.equal(json.potAmountNokIfHit, 500);
});

test("BIN-690 M5: handleChoice — anti-juks: klient-sendt pot-amount blir ignorert (server bestemmer)", async () => {
  const { pool } = makeHandleChoicePool({
    ticketSize: "small",
    nextGameId: "sg-next-anti-cheat",
  });
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.handleChoice({
    resultId: "mgr-hack",
    context: makeContext(),
    choiceJson: {
      chosenNumber: 55,
      potAmountNokIfHit: 99999999, // Klient-juks.
      ticketSizeAtWin: "large", // Klient-juks.
    },
  });
  const json = result.resultJson as OddsenChoiceResultJson;
  // Server har brukt eget pot-oppslag (small → 1500), ikke klient-injected.
  assert.equal(json.potAmountNokIfHit, 1500);
  assert.equal(json.ticketSizeAtWin, "small");
});

// ── resolveForGame ───────────────────────────────────────────────────────────

/**
 * Fake PoolClient for resolveForGame-tester.
 */
function makeResolveClient(options: {
  stateRow?: {
    id: string;
    hall_id: string;
    chosen_number: number;
    chosen_by_player_id: string;
    ticket_size_at_win: "small" | "large";
  } | null;
  walletId?: string | null;
}): {
  client: PoolClient;
  updates: Array<{ sql: string; params: unknown[] }>;
  lockQueries: number;
} {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  let lockQueries = 0;
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FOR UPDATE") && sql.includes("oddsen_state")) {
      lockQueries += 1;
      if (options.stateRow) {
        return { rows: [options.stateRow] };
      }
      return { rows: [] };
    }
    if (sql.includes("app_users") && sql.includes("wallet_id")) {
      return {
        rows: options.walletId != null ? [{ wallet_id: options.walletId }] : [],
      };
    }
    if (sql.includes("UPDATE") && sql.includes("oddsen_state")) {
      updates.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  };
  return {
    client: { query, release: () => undefined } as unknown as PoolClient,
    updates,
    lockQueries,
  };
}

test("BIN-690 M5: resolveForGame — hit: credit + UPDATE + audit", async () => {
  const { client, updates } = makeResolveClient({
    stateRow: {
      id: "oddsen-42",
      hall_id: "h-1",
      chosen_number: 55,
      chosen_by_player_id: "u-player",
      ticket_size_at_win: "small",
    },
    walletId: "w-player",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const drawn = [1, 5, 55, 9]; // Chosen number 55 er trukket → hit.
  const result = await engine.resolveForGame(
    "sg-next",
    drawn,
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.ok(result);
  assert.equal(result!.outcome, "hit");
  assert.equal(result!.potAmountCents, 150_000); // 1500 kr * 100
  assert.equal(result!.oddsenStateId, "oddsen-42");
  assert.equal(result!.chosenNumber, 55);
  assert.equal(result!.chosenByPlayerId, "u-player");

  // Credit ble kalt med riktig beløp + idempotency + winnings.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.accountId, "w-player");
  assert.equal(credits[0]!.amount, 1500);
  assert.equal(credits[0]!.options?.to, "winnings");
  assert.equal(credits[0]!.options?.idempotencyKey, "g1-oddsen-oddsen-42");

  // UPDATE oddsen_state med resolved_outcome='hit'.
  assert.equal(updates.length, 1);
  assert.equal(updates[0]!.params[0], "oddsen-42");
  assert.equal(updates[0]!.params[1], "hit");
  assert.equal(updates[0]!.params[2], 150_000);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(records.some((r) => r.action === "mini_game.oddsen_resolved_hit"));
});

test("BIN-690 M5: resolveForGame — large ticket: 3000 kr pot ved hit", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-big",
      hall_id: "h-1",
      chosen_number: 56,
      chosen_by_player_id: "u-big",
      ticket_size_at_win: "large",
    },
    walletId: "w-big",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.resolveForGame(
    "sg-x",
    [10, 20, 56, 30, 40],
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.ok(result);
  assert.equal(result!.potAmountCents, 300_000); // 3000 kr * 100
  assert.equal(credits[0]!.amount, 3000);
});

test("BIN-690 M5: resolveForGame — miss: ingen credit, UPDATE med outcome='miss'", async () => {
  const { client, updates } = makeResolveClient({
    stateRow: {
      id: "oddsen-miss",
      hall_id: "h-1",
      chosen_number: 57,
      chosen_by_player_id: "u-miss",
      ticket_size_at_win: "small",
    },
    walletId: "w-miss",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const drawn = [1, 2, 3, 55, 56]; // 57 er IKKE trukket.
  const result = await engine.resolveForGame(
    "sg-miss",
    drawn,
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.ok(result);
  assert.equal(result!.outcome, "miss");
  assert.equal(result!.potAmountCents, 0);
  assert.equal(credits.length, 0);
  assert.equal(updates[0]!.params[1], "miss");
  assert.equal(updates[0]!.params[2], 0);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(records.some((r) => r.action === "mini_game.oddsen_resolved_miss"));
});

test("BIN-690 M5: resolveForGame — ingen state for spillet → returnerer null, ingen side-effects", async () => {
  const { client, updates } = makeResolveClient({ stateRow: null });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.resolveForGame(
    "sg-none",
    [1, 2, 3],
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.equal(result, null);
  assert.equal(credits.length, 0);
  assert.equal(updates.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(records.length, 0);
});

test("BIN-690 M5: resolveForGame — wallet mangler → ODDSEN_WALLET_MISSING", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-nowallet",
      hall_id: "h-1",
      chosen_number: 55,
      chosen_by_player_id: "u-missing",
      ticket_size_at_win: "small",
    },
    walletId: null, // Wallet ikke funnet.
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await assert.rejects(
    () =>
      engine.resolveForGame(
        "sg-nowallet",
        [55],
        DEFAULT_ODDSEN_CONFIG,
        client,
      ),
    (err: unknown) =>
      err instanceof DomainError && err.code === "ODDSEN_WALLET_MISSING",
  );
});

test("BIN-690 M5: resolveForGame — pot=0 config: hit men ingen credit-call", async () => {
  const { client, updates } = makeResolveClient({
    stateRow: {
      id: "oddsen-zero",
      hall_id: "h-1",
      chosen_number: 55,
      chosen_by_player_id: "u-zero",
      ticket_size_at_win: "small",
    },
    walletId: "w-zero",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const zeroPotConfig: OddsenConfig = {
    ...DEFAULT_ODDSEN_CONFIG,
    potSmallNok: 0,
  };
  const result = await engine.resolveForGame(
    "sg-zero",
    [55],
    zeroPotConfig,
    client,
  );
  assert.ok(result);
  assert.equal(result!.outcome, "hit");
  assert.equal(result!.potAmountCents, 0);
  // Ingen credit-call siden potCents = 0.
  assert.equal(credits.length, 0);
  // UPDATE markerer fortsatt som hit (outcome = hit, pot_amount_cents = 0).
  assert.equal(updates[0]!.params[1], "hit");
});

test("BIN-690 M5: resolveForGame — drawn empty → miss (defensive)", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-empty",
      hall_id: "h-1",
      chosen_number: 55,
      chosen_by_player_id: "u-empty",
      ticket_size_at_win: "small",
    },
    walletId: "w-empty",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.resolveForGame(
    "sg-empty",
    [],
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.ok(result);
  assert.equal(result!.outcome, "miss");
  assert.equal(credits.length, 0);
});

test("BIN-690 M5: resolveForGame — custom pot-amounts fra config", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-custom",
      hall_id: "h-1",
      chosen_number: 42,
      chosen_by_player_id: "u-c",
      ticket_size_at_win: "large",
    },
    walletId: "w-c",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const customConfig: OddsenConfig = {
    validNumbers: [42, 43, 44],
    potSmallNok: 700,
    potLargeNok: 1400,
    resolveAtDraw: 45,
  };
  const result = await engine.resolveForGame(
    "sg-c",
    [42],
    customConfig,
    client,
  );
  assert.equal(result!.potAmountCents, 140_000); // 1400 * 100
  assert.equal(credits[0]!.amount, 1400);
});

test("BIN-690 M5: resolveForGame — idempotency-key format matcher `g1-oddsen-{id}`", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-idem-xyz",
      hall_id: "h-1",
      chosen_number: 55,
      chosen_by_player_id: "u-idem",
      ticket_size_at_win: "small",
    },
    walletId: "w-idem",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  await engine.resolveForGame("sg-idem", [55], DEFAULT_ODDSEN_CONFIG, client);
  assert.equal(credits[0]!.options?.idempotencyKey, "g1-oddsen-oddsen-idem-xyz");
});

// ── expireStateForGame ───────────────────────────────────────────────────────

test("BIN-690 M5: expireStateForGame — markerer states som expired", async () => {
  let updateCalled = false;
  let updateParams: unknown[] = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE") && sql.includes("oddsen_state")) {
        updateCalled = true;
        updateParams = params;
        return { rows: [], rowCount: 2 };
      }
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.expireStateForGame("sg-exp", client);
  assert.equal(result.expiredCount, 2);
  assert.equal(updateCalled, true);
  assert.equal(updateParams[0], "sg-exp");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(records.some((r) => r.action === "mini_game.oddsen_resolved_expired"));
});

test("BIN-690 M5: expireStateForGame — 0 rader → ingen audit-event", async () => {
  const client = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog, records } = makeStubAuditLog();
  const { adapter: walletAdapter } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.expireStateForGame("sg-no-state", client);
  assert.equal(result.expiredCount, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    records.filter((r) => r.action === "mini_game.oddsen_resolved_expired").length,
    0,
  );
});

// ── Behavioral sanity ────────────────────────────────────────────────────────

test("BIN-690 M5: handleChoice aksepterer alle tre default-tall (55,56,57)", async () => {
  for (const n of [55, 56, 57]) {
    const { pool } = makeHandleChoicePool({
      ticketSize: "small",
      nextGameId: `sg-next-${n}`,
    });
    const { service: auditLog } = makeStubAuditLog();
    const { adapter: walletAdapter } = makeStubWallet();
    const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });
    const result = await engine.handleChoice({
      resultId: `mgr-${n}`,
      context: makeContext(),
      choiceJson: { chosenNumber: n },
    });
    const json = result.resultJson as OddsenChoiceResultJson;
    assert.equal(json.chosenNumber, n);
  }
});

test("BIN-690 M5: resolveForGame — hit med vinner som har valgt 56 mot draw-array [1,5,56,12]", async () => {
  const { client } = makeResolveClient({
    stateRow: {
      id: "oddsen-56",
      hall_id: "h-1",
      chosen_number: 56,
      chosen_by_player_id: "u-56",
      ticket_size_at_win: "small",
    },
    walletId: "w-56",
  });
  const pool = makeFakePool(async () => ({ rows: [] }));
  const { service: auditLog } = makeStubAuditLog();
  const { adapter: walletAdapter, credits } = makeStubWallet();
  const engine = new MiniGameOddsenEngine({ pool, walletAdapter, auditLog });

  const result = await engine.resolveForGame(
    "sg-56",
    [1, 5, 56, 12],
    DEFAULT_ODDSEN_CONFIG,
    client,
  );
  assert.equal(result!.outcome, "hit");
  assert.equal(credits.length, 1);
});
