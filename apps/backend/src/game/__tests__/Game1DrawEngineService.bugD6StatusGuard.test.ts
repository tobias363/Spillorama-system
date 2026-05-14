/**
 * BUG-D6 regression — `engine.UPDATE status='completed'` MÅ ha WHERE-clause-guard.
 *
 * Bakgrunn: `Game1DrawEngineService.endRound()`-pathen (når isFinished=true)
 * inneholdt tidligere en UPDATE-statement uten guard:
 *
 *   UPDATE app_game1_scheduled_games
 *   SET status='completed', actual_end_time = ..., updated_at = now()
 *   WHERE id = $1
 *
 * Race-window: hvis master eller cron har satt scheduled-game til
 * `cancelled` mellom engine-completion-detect og denne UPDATE-en,
 * vil engine overskrive terminal status `cancelled` med `completed`.
 * Audit-trail blir korrupt.
 *
 * Fix (PR for BUG-D6): la til guard `AND status IN ('running', 'paused')`
 * slik at engine kun flipper fra de to ikke-terminal statusene.
 *
 * Disse testene verifiserer SQL-en som engine sender ned mot Postgres.
 * Stub-pool fanger query-text + params og asserter:
 *   - `WHERE id = $1` finnes
 *   - `AND status IN ('running', 'paused')` finnes (kjernen i guarden)
 *   - Strenge `'cancelled'` / `'completed'` / `'finished'` er IKKE i WHERE-guarden
 *
 * Referanser:
 *   - Agent D research §5.6 + §6.4 — `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md`
 *   - Audit skall — `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`
 *   - Skill — `.claude/skills/spill1-master-flow/SKILL.md`
 *   - PITFALLS-entry §3.X i `docs/engineering/PITFALLS_LOG.md`
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "../Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "../Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

// ── Stub pool (mønster: matcher Game1DrawEngineService.test.ts) ─────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
}

interface StubClient {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[]): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (r.once !== false) queue.splice(i, 1);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query: runQuery,
        release: () => undefined,
      }),
      query: runQuery,
    },
    queries,
  };
}

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "ready_to_start",
    ticket_config_json: {},
    ...overrides,
  };
}

function runningStateRow(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    draw_bag_json: [10, 20, 30, 40, 50, 60],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

function makeFakeTicketPurchase(
  purchases: Game1TicketPurchaseRow[] = [],
): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return purchases;
    },
  } as unknown as Game1TicketPurchaseService;
}

function makeService(opts: { poolResponses: StubResponse[] }): {
  service: Game1DrawEngineService;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const ticketPurchase = makeFakeTicketPurchase();
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
    auditLogService,
  });
  return { service, queries };
}

/**
 * Bygger en standard pool-response som driver `drawNext` mot maxDraws=3
 * med 2 draws allerede gjort, slik at neste draw flipper isFinished=true
 * og engine prøver å sette status='completed'.
 *
 * Pre-conditions:
 *   - `loadScheduledGameForUpdate` returnerer raden med gitt `currentStatus`
 *   - `app_game1_game_state` viser draws_completed=2 (slik at +1 = 3 = maxDraws)
 *   - maxDraws=3 i ticket_config_json
 *
 * Engine vil deretter sende en UPDATE mot scheduled_games-tabellen. Testen
 * fanger den SQL-en (med params) via queries[] og asserter:
 *   - WHERE id = $1 (params[0] = "g1")
 *   - AND status IN ('running', 'paused')
 */
function buildMaxDrawsResponses(currentStatus: string): StubResponse[] {
  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: 2,
          last_drawn_ball: 20,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        scheduledGameRow({
          status: currentStatus,
          ticket_config_json: { maxDraws: 3 },
        }),
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_game_state"),
      rows: [],
    },
    // UPDATE scheduled_game → completed. Pool tar imot uavhengig av status —
    // det er service-koden som inneholder selve WHERE-guarden. Vi bekrefter
    // SQL-en via queries[] etter call.
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'completed'"),
      rows: [],
      rowCount: currentStatus === "running" ? 1 : 0,
    },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("SELECT"),
      rows: [
        runningStateRow({
          draws_completed: 3,
          last_drawn_ball: 30,
          engine_ended_at: "2026-04-21T12:05:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

/**
 * Finn den endelige UPDATE-en som flipper scheduled_games → 'completed'.
 * Returnerer hele SQL-strengen + params for assertions.
 */
function findCompletedUpdate(queries: RecordedQuery[]): RecordedQuery {
  const candidates = queries.filter(
    (q) =>
      q.sql.trim().startsWith("UPDATE") &&
      q.sql.includes("scheduled_games") &&
      q.sql.includes("'completed'"),
  );
  assert.ok(
    candidates.length > 0,
    "UPDATE status='completed' skal sendes når maxDraws nådd",
  );
  // Take last candidate — endRound flipper status etter alle pre-update steps.
  return candidates[candidates.length - 1]!;
}

// ── Tester ──────────────────────────────────────────────────────────────────

test(
  "BUG-D6: completed-UPDATE inneholder WHERE-guard `status IN ('running','paused')`",
  async () => {
    const { service, queries } = makeService({
      poolResponses: buildMaxDrawsResponses("running"),
    });

    await service.drawNext("g1");

    const update = findCompletedUpdate(queries);

    // Hovedassertion: guarden er på plass i SQL-en.
    assert.ok(
      /AND\s+status\s+IN\s*\(\s*'running'\s*,\s*'paused'\s*\)/i.test(update.sql),
      `WHERE-clause-guard mangler. Faktisk SQL:\n${update.sql}`,
    );

    // Defensive: id-param er fortsatt riktig.
    assert.equal(
      update.params[0],
      "g1",
      "params[0] skal være scheduled_game_id",
    );

    // Sanity: status='completed' er fortsatt i SET (vi flipper TIL completed,
    // ikke fra).
    assert.ok(
      update.sql.includes("SET") && update.sql.includes("'completed'"),
      "SET status='completed' skal fortsatt være i UPDATE",
    );
  },
);

test(
  "BUG-D6: WHERE-clause inneholder IKKE terminal-status i guard (ingen 'cancelled' / 'finished')",
  async () => {
    // Verifiser at vi ikke ved en feil whitelister terminal status —
    // det ville bety at engine kunne overskrive cancelled→completed igjen.
    const { service, queries } = makeService({
      poolResponses: buildMaxDrawsResponses("running"),
    });

    await service.drawNext("g1");

    const update = findCompletedUpdate(queries);

    // Trekk ut WHERE-delen for å unngå false-positives fra SET-klausulen
    // som inneholder 'completed' (vi flipper jo TIL completed).
    const whereMatch = update.sql.match(/WHERE[\s\S]*$/i);
    assert.ok(whereMatch, "UPDATE skal ha WHERE-klausul");
    const whereClause = whereMatch![0];

    assert.ok(
      !/'cancelled'/.test(whereClause),
      `WHERE-clause skal IKKE inneholde 'cancelled' (ville la engine overskrive cancelled).\nWHERE: ${whereClause}`,
    );
    assert.ok(
      !/'finished'/.test(whereClause),
      `WHERE-clause skal IKKE inneholde 'finished'.\nWHERE: ${whereClause}`,
    );
    // 'completed' MÅ ikke være i WHERE (men kan være i SET).
    assert.ok(
      !/status\s*=\s*'completed'/i.test(whereClause) &&
        !/'completed'.*IN/i.test(whereClause),
      `WHERE-clause skal IKKE matche status='completed' eller IN-liste med 'completed'.\nWHERE: ${whereClause}`,
    );
  },
);

test(
  "BUG-D6: idempotent ved repeat-call — UPDATE ville matchet 0 rader hvis status allerede 'completed'",
  async () => {
    // Engine sender ALLTID UPDATE-en når isFinished=true; det er Postgres
    // som med WHERE-guarden no-op'er for terminal status. Vi verifiserer
    // her at den genererte SQL-en gjør UPDATE-en idempotent (0 rader
    // berørt hvis status allerede er 'completed').
    //
    // Konkret: hvis vi setter `rowCount: 0` på stub-en (simulerer at
    // WHERE-guarden filtrerer alt bort), så skal `drawNext` fortsatt
    // returnere uten å kaste. Engine skal ikke avhenge av rowCount==1 for
    // å fullføre transaksjonen.
    const { service, queries } = makeService({
      poolResponses: buildMaxDrawsResponses("running").map((r) => {
        // Returner rowCount=0 på den endelige completed-UPDATE.
        if (
          r.match("UPDATE app_game1_scheduled_games SET status='completed'") ||
          (typeof r.match === "function" &&
            r.match(
              "UPDATE app_game1_scheduled_games SET status='completed', actual_end_time=COALESCE(actual_end_time, now()), updated_at=now() WHERE id=$1",
            ))
        ) {
          return { ...r, rowCount: 0 };
        }
        return r;
      }),
    });

    // Skal ikke kaste — drawNext må håndtere rowCount=0 fra completed-UPDATE
    // som no-op (guarden filtrerte raden bort).
    const view = await service.drawNext("g1");
    assert.equal(view.isFinished, true);

    // Verifiser at UPDATE-en faktisk ble sendt med korrekt guard.
    const update = findCompletedUpdate(queries);
    assert.ok(
      /AND\s+status\s+IN\s*\(\s*'running'\s*,\s*'paused'\s*\)/i.test(update.sql),
      "Guard skal være på plass selv ved repeat-call",
    );
  },
);

test(
  "BUG-D6: regression — guard pattern matcher exact WHERE-form fra fix",
  async () => {
    // Eksakt SQL-snippet fra Agent D §6.4 fix-diff:
    //   WHERE id = $1
    //     AND status IN ('running', 'paused')
    //
    // Denne testen feiler hvis noen i fremtiden endrer guard-formen
    // (f.eks. til `status <> 'cancelled'` som ville være feil — da kunne
    // engine overskrive 'completed' med 'completed' og dobbelt-skrive
    // actual_end_time).
    const { service, queries } = makeService({
      poolResponses: buildMaxDrawsResponses("running"),
    });

    await service.drawNext("g1");

    const update = findCompletedUpdate(queries);

    // Normaliser whitespace for tolerant matching.
    const normalized = update.sql.replace(/\s+/g, " ").trim();
    assert.match(
      normalized,
      /WHERE id = \$1 AND status IN \('running', 'paused'\)/i,
      `Eksakt guard-form (`+
        `\`WHERE id = $1 AND status IN ('running', 'paused')\`) mangler. ` +
        `Faktisk: ${normalized}`,
    );
  },
);
