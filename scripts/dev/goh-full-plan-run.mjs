#!/usr/bin/env node
/**
 * Deterministic local GoH full-plan runner.
 *
 * Runs the seeded demo-pilot-goh play plan end-to-end with N players per hall:
 *   - 4 demo halls
 *   - purchase_open -> purchases -> hall-ready -> master-start
 *   - waits for completion and advances through every plan item
 *   - writes JSON + Markdown evidence reports under /tmp
 *
 * This is a local/dev verification tool. It uses the dev auto-login route and
 * direct local Postgres reset queries for the seeded demo halls only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { io } = require("socket.io-client");
const { Pool } = require("pg");

const args = parseArgs(process.argv.slice(2));

const BACKEND_URL = String(args.backend ?? "http://localhost:4000").replace(/\/$/, "");
const PLAYERS_PER_HALL = Number(args["players-per-hall"] ?? 20);
const CONNECT_DELAY_MS = Number(args["connect-delay-ms"] ?? 2200);
const JOIN_DELAY_MS = Number(args["join-delay-ms"] ?? 60);
const PURCHASE_CONCURRENCY = Number(args["purchase-concurrency"] ?? 8);
const PURCHASE_RETRIES = Number(args["purchase-retries"] ?? 4);
const ROUND_TIMEOUT_MS = Number(args["round-timeout-ms"] ?? 900_000);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_JSON = String(args.output ?? `/tmp/goh-full-plan-run-${RUN_ID}.json`);
const OUTPUT_MD = OUTPUT_JSON.replace(/\.json$/i, ".md");

const MASTER_HALL_ID = "demo-hall-001";
const GROUP_OF_HALLS_ID = "demo-pilot-goh";
const HALLS = [
  "demo-hall-001",
  "demo-hall-002",
  "demo-hall-003",
  "demo-hall-004",
];

const COLOR_LABEL = {
  yellow: "Gul",
  white: "Hvit",
  purple: "Lilla",
};

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "spillorama",
  password: process.env.PGPASSWORD ?? "spillorama",
  database: process.env.PGDATABASE ?? "spillorama",
});

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  backendUrl: BACKEND_URL,
  groupOfHallsId: GROUP_OF_HALLS_ID,
  masterHallId: MASTER_HALL_ID,
  halls: HALLS,
  playersPerHall: PLAYERS_PER_HALL,
  purchaseConcurrency: PURCHASE_CONCURRENCY,
  purchaseRetries: PURCHASE_RETRIES,
  status: "running",
  monitoring: {
    pilotMonitorLog: "/tmp/pilot-monitor.log",
    pilotMonitorSnapshot: "/tmp/pilot-monitor-snapshot.md",
    sentryAuthTokenPresent: Boolean(process.env.SENTRY_AUTH_TOKEN),
    posthogEnvPresent: Boolean(process.env.POSTHOG_API_KEY || process.env.POSTHOG_PROJECT_ID),
  },
  planItems: [],
  clients: {
    requested: HALLS.length * PLAYERS_PER_HALL,
    loaded: 0,
    connected: 0,
    connectionFailures: [],
  },
  reset: {},
  rounds: [],
  anomalies: [],
  failure: null,
};

let activeGameId = null;
let activeRoomCode = null;
let activeRound = null;
const clients = [];

main()
  .catch(async (err) => {
    report.status = "failed";
    report.failure = serializeError(err);
    log("FAILED", { message: err.message, json: OUTPUT_JSON, markdown: OUTPUT_MD });
    await writeReports();
    process.exitCode = 1;
  })
  .finally(async () => {
    activeGameId = null;
    activeRound = null;
    for (const client of clients) {
      try {
        client.socket?.disconnect();
      } catch {
        // ignore
      }
    }
    await pool.end().catch(() => {});
  });

async function main() {
  log("loading admin session");
  const admin = await autoLogin("tobias@nordicprofil.no");

  log("reset: recover/cancel local demo GoH state");
  await resetLocalDemoState(admin.accessToken);

  const planItems = await loadPlanItems();
  report.planItems = planItems.map((item) => ({
    position: item.position,
    slug: item.slug,
    displayName: item.displayName,
    requiresJackpotSetup: item.requiresJackpotSetup,
  }));
  log("loaded plan items", {
    count: planItems.length,
    slugs: planItems.map((item) => item.slug),
  });

  await loadClients();
  log("loaded player logins", { count: clients.length });

  await connectClients();

  let open = await openPurchaseWindow({ admin, position: 1, slug: planItems[0]?.slug });

  for (const item of planItems) {
    const round = {
      position: item.position,
      slug: item.slug,
      displayName: item.displayName,
      scheduledGameId: open.scheduledGameId,
      planRunId: open.planRunId ?? null,
      purchaseOpenAt: new Date().toISOString(),
      roomCode: null,
      joins: { ok: 0, failed: [] },
      purchases: { ok: 0, failed: [] },
      ready: { ok: 0, failed: [] },
      start: null,
      terminalStatus: null,
      completedAt: null,
      durationMs: null,
      resumes: 0,
      summary: null,
      socketEventTotals: null,
    };
    report.rounds.push(round);
    log("round purchase open", {
      position: item.position,
      slug: item.slug,
      gameId: round.scheduledGameId,
    });

    const ticketCatalog = await loadTicketCatalog(round.scheduledGameId);
    await joinRound(round);
    await purchaseRound(round, ticketCatalog);
    if (round.joins.failed.length > 0 || round.purchases.failed.length > 0) {
      throw new Error(`Round ${item.position} had join/purchase failures`);
    }

    await markHallsReady(round);
    if (round.ready.failed.length > 0) {
      throw new Error(`Round ${item.position} had ready failures`);
    }

    const startedAt = Date.now();
    round.start = await startRound(admin.accessToken, round.scheduledGameId);
    await loadClientTicketNumbers(round);
    activeGameId = round.scheduledGameId;
    activeRoomCode = round.roomCode;
    activeRound = round;
    log("round running", {
      position: item.position,
      slug: item.slug,
      status: round.start.scheduledGameStatus,
      gameId: round.scheduledGameId,
      roomCode: round.roomCode,
    });

    const terminal = await waitForRoundTerminal(round, admin.accessToken);
    activeGameId = null;
    activeRoomCode = null;
    activeRound = null;
    round.terminalStatus = terminal.status;
    round.completedAt = terminal.completedAt;
    round.durationMs = Date.now() - startedAt;
    round.summary = await summarizeRound(round.scheduledGameId);
    round.socketEventTotals = summarizeSocketEvents(round.scheduledGameId);

    assertRoundSummary(round);

    log("round completed", {
      position: item.position,
      slug: item.slug,
      durationSec: Math.round(round.durationMs / 1000),
      draws: round.summary.draws,
      purchases: round.summary.purchases,
      tickets: round.summary.tickets,
      amountKr: round.summary.amountCents / 100,
      resumes: round.resumes,
    });

    if (item.position < planItems.length) {
      open = await openPurchaseWindow({
        admin,
        position: item.position + 1,
        slug: planItems[item.position]?.slug,
      });
    }
  }

  const finishResult = await advancePastEnd(admin.accessToken);
  report.finishResult = finishResult;
  report.status = "passed";
  await writeReports();
  log("PASSED", { json: OUTPUT_JSON, markdown: OUTPUT_MD });
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, rawValue] = arg.slice(2).split("=");
    out[key] = rawValue === undefined ? true : rawValue;
  }
  return out;
}

function log(message, data) {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[full-plan] ${new Date().toISOString()} ${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function businessDateOslo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function api(pathname, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
  const res = await fetch(`${BACKEND_URL}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok || body?.ok === false) {
    const err = new Error(body?.error?.message ?? `HTTP ${res.status} ${pathname}`);
    err.status = res.status;
    err.code = body?.error?.code;
    err.body = body;
    throw err;
  }
  return body?.data ?? body;
}

async function autoLogin(email) {
  const data = await api(`/api/dev/auto-login?email=${encodeURIComponent(email)}`);
  return {
    accessToken: data.accessToken,
    user: data.user,
  };
}

async function resetLocalDemoState(adminToken) {
  try {
    const recovered = await api("/api/agent/game1/master/recover-stale", {
      method: "POST",
      token: adminToken,
      body: { hallId: MASTER_HALL_ID },
    });
    report.reset.recoverStale = recovered;
  } catch (err) {
    report.anomalies.push({
      at: new Date().toISOString(),
      type: "reset.recover_stale.nonfatal",
      ...serializeError(err),
    });
  }

  const active = await pool.query(
    `SELECT id
       FROM app_game1_scheduled_games
      WHERE master_hall_id = ANY($1)
        AND status IN ('scheduled','purchase_open','ready_to_start','running','paused')`,
    [HALLS],
  );
  const activeIds = active.rows.map((row) => row.id);

  if (activeIds.length > 0) {
    await pool.query(
      `UPDATE app_game1_scheduled_games
          SET status = 'cancelled',
              actual_end_time = COALESCE(actual_end_time, now()),
              updated_at = now()
        WHERE id = ANY($1)`,
      [activeIds],
    );
    await pool.query(
      `DELETE FROM app_game1_hall_ready_status WHERE game_id = ANY($1)`,
      [activeIds],
    );
  }

  const businessDate = businessDateOslo();
  const planRunReset = await pool.query(
    `UPDATE app_game_plan_run
        SET current_position = 1,
            status = 'idle',
            jackpot_overrides_json = '{}'::jsonb,
            started_at = NULL,
            finished_at = NULL,
            master_user_id = NULL,
            updated_at = now()
      WHERE hall_id = $1
        AND business_date = $2::date`,
    [MASTER_HALL_ID, businessDate],
  );

  report.reset.cancelledScheduledGames = activeIds.length;
  report.reset.planRunsReset = planRunReset.rowCount ?? 0;
  report.reset.businessDate = businessDate;

  const walletTopUp = await pool.query(
    `UPDATE wallet_accounts wa
        SET deposit_balance = GREATEST(wa.deposit_balance, 100000),
            updated_at = now()
       FROM app_users u
      WHERE u.wallet_id = wa.id
        AND u.email LIKE 'demo-load-h%@example.com'
        AND u.hall_id = ANY($1)`,
    [HALLS],
  );
  report.reset.loadPlayerWalletsToppedUp = walletTopUp.rowCount ?? 0;
  report.reset.loadPlayerWalletMinDepositNok = 100000;

  // Full-plan load tests span 13 rounds. Demo-load users can carry
  // Spillvett/loss-limit ledger rows from earlier aborted local tests, which
  // makes the run fail nondeterministically around Oddsen even though wallet
  // balance is topped up. Keep this scoped to synthetic demo-load users only.
  const loadPlayerWallets = `
    SELECT u.wallet_id, u.hall_id
      FROM app_users u
     WHERE u.email LIKE 'demo-load-h%@example.com'
       AND u.hall_id = ANY($1)
  `;
  const lossEntriesReset = await pool.query(
    `DELETE FROM app_rg_loss_entries le
       USING (${loadPlayerWallets}) lp
      WHERE le.wallet_id = lp.wallet_id
        AND le.hall_id = lp.hall_id`,
    [HALLS],
  );
  const personalLimitsReset = await pool.query(
    `DELETE FROM app_rg_personal_loss_limits pll
       USING (${loadPlayerWallets}) lp
      WHERE pll.wallet_id = lp.wallet_id
        AND pll.hall_id = lp.hall_id`,
    [HALLS],
  );
  const pendingLimitsReset = await pool.query(
    `DELETE FROM app_rg_pending_loss_limit_changes plc
       USING (${loadPlayerWallets}) lp
      WHERE plc.wallet_id = lp.wallet_id
        AND plc.hall_id = lp.hall_id`,
    [HALLS],
  );
  report.reset.loadPlayerLossEntriesDeleted = lossEntriesReset.rowCount ?? 0;
  report.reset.loadPlayerPersonalLimitsDeleted = personalLimitsReset.rowCount ?? 0;
  report.reset.loadPlayerPendingLimitsDeleted = pendingLimitsReset.rowCount ?? 0;
  report.reset.lossLimitResetNote =
    "DB-ledger reset for synthetic demo-load users only. Restart backend after reset if it already had old RG state hydrated in memory.";
}

async function loadPlanItems() {
  const { rows } = await pool.query(
    `SELECT i.position,
            c.id,
            c.slug,
            c.display_name,
            c.ticket_colors_json,
            c.ticket_prices_cents_json,
            c.prizes_cents_json,
            c.requires_jackpot_setup
       FROM app_game_plan p
       JOIN app_game_plan_item i ON i.plan_id = p.id
       JOIN app_game_catalog c ON c.id = i.game_catalog_id
      WHERE p.group_of_halls_id = $1
        AND p.is_active = TRUE
        AND p.id = 'demo-plan-pilot'
      ORDER BY i.position ASC`,
    [GROUP_OF_HALLS_ID],
  );
  if (rows.length === 0) {
    throw new Error("No active demo-plan-pilot items found");
  }
  return rows.map((row) => ({
    position: Number(row.position),
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    ticketColors: row.ticket_colors_json,
    ticketPricesCents: row.ticket_prices_cents_json,
    prizesCents: row.prizes_cents_json,
    requiresJackpotSetup: row.requires_jackpot_setup === true,
  }));
}

async function loadClients() {
  const { rows } = await pool.query(
    `SELECT id, email, hall_id, display_name
       FROM app_users
      WHERE email LIKE 'demo-load-h%@example.com'
        AND hall_id = ANY($1)
      ORDER BY hall_id, email`,
    [HALLS],
  );
  const byHall = new Map(HALLS.map((hallId) => [hallId, []]));
  for (const row of rows) {
    byHall.get(row.hall_id)?.push(row);
  }
  for (const [hallIndex, hallId] of HALLS.entries()) {
    const hallPlayers = (byHall.get(hallId) ?? [])
      .sort((a, b) => playerNumberFromEmail(a.email) - playerNumberFromEmail(b.email))
      .slice(0, PLAYERS_PER_HALL);
    if (hallPlayers.length !== PLAYERS_PER_HALL) {
      throw new Error(`Expected ${PLAYERS_PER_HALL} load players for ${hallId}, found ${hallPlayers.length}`);
    }
    for (const [idx, player] of hallPlayers.entries()) {
      const session = await autoLogin(player.email);
      clients.push({
        email: player.email,
        userId: player.id,
        hallId,
        hallNumber: hallIndex + 1,
        indexInHall: idx + 1,
        playerName: `H${hallIndex + 1}P${String(idx + 1).padStart(2, "0")}`,
        accessToken: session.accessToken,
        socket: null,
        connected: false,
        currentGameId: null,
        roomCode: null,
        playerId: null,
        drawEventsByGame: new Map(),
        markAcksByGame: new Map(),
        markFailuresByGame: new Map(),
        markFailureCodesByGame: new Map(),
        markFailureSamplesByGame: new Map(),
        markSkippedByGame: new Map(),
        ticketNumbersByGame: new Map(),
      });
    }
  }
  report.clients.loaded = clients.length;
}

function playerNumberFromEmail(email) {
  const match = email.match(/-(\d+)@/);
  return match ? Number(match[1]) : 0;
}

async function connectClients() {
  log("socket rate limit cooldown before connecting clients", {
    seconds: Math.ceil(CONNECT_DELAY_MS * clients.length / 1000),
  });
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    try {
      await connectClient(client);
      report.clients.connected += 1;
    } catch (err) {
      report.clients.connectionFailures.push({
        email: client.email,
        ...serializeError(err),
      });
    }
    if ((i + 1) % 10 === 0 || i + 1 === clients.length) {
      log("connected clients", { connected: i + 1, total: clients.length });
    }
    if (i + 1 < clients.length) await sleep(CONNECT_DELAY_MS);
  }
  if (report.clients.connectionFailures.length > 0) {
    throw new Error(`Socket connection failures: ${report.clients.connectionFailures.length}`);
  }
}

function connectClient(client) {
  return new Promise((resolve, reject) => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 15_000,
      auth: { token: client.accessToken },
      extraHeaders: { Authorization: `Bearer ${client.accessToken}` },
    });
    client.socket = socket;
    const timer = setTimeout(() => {
      reject(new Error("socket connect timeout"));
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
    }, 20_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      client.connected = true;
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("draw:new", (payload) => {
      void onDrawNew(client, payload);
    });
  });
}

async function onDrawNew(client, payload) {
  if (!payload || payload.gameId !== client.currentGameId) return;
  if (!client.roomCode || client.currentGameId !== activeGameId) return;
  incrementMap(client.drawEventsByGame, payload.gameId);
  const ticketNumbers = client.ticketNumbersByGame.get(payload.gameId);
  if (!ticketNumbers?.has(Number(payload.number))) {
    incrementMap(client.markSkippedByGame, payload.gameId);
    return;
  }
  try {
    const ack = await emitAck(client.socket, "ticket:mark", {
      roomCode: client.roomCode,
      accessToken: client.accessToken,
      playerId: client.playerId,
      number: payload.number,
      clientRequestId: randomUUID(),
    }, 5000);
    if (ack?.ok === false) {
      incrementMap(client.markFailuresByGame, payload.gameId);
      recordMarkFailure(client, payload.gameId, {
        email: client.email,
        number: payload.number,
        code: ack.error?.code ?? "ACK_FALSE",
        message: ack.error?.message ?? "ticket:mark returned ok=false",
      });
      return;
    }
    incrementMap(client.markAcksByGame, payload.gameId);
  } catch (err) {
    incrementMap(client.markFailuresByGame, payload.gameId);
    recordMarkFailure(client, payload.gameId, {
      email: client.email,
      number: payload.number,
      code: "ACK_TIMEOUT_OR_THROW",
      message: err instanceof Error ? err.message : "ticket:mark ack timed out or threw",
    });
  }
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function recordMarkFailure(client, gameId, sample) {
  const codes = client.markFailureCodesByGame.get(gameId) ?? new Map();
  codes.set(sample.code, (codes.get(sample.code) ?? 0) + 1);
  client.markFailureCodesByGame.set(gameId, codes);

  const samples = client.markFailureSamplesByGame.get(gameId) ?? [];
  if (samples.length < 3) {
    samples.push(sample);
    client.markFailureSamplesByGame.set(gameId, samples);
  }

  if (activeRound) {
    activeRound.markFailureCodes = activeRound.markFailureCodes ?? {};
    activeRound.markFailureCodes[sample.code] =
      (activeRound.markFailureCodes[sample.code] ?? 0) + 1;
    activeRound.markFailureSamples = activeRound.markFailureSamples ?? [];
    if (activeRound.markFailureSamples.length < 12) {
      activeRound.markFailureSamples.push(sample);
    }
  }
}

function emitAck(socket, event, payload, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function openPurchaseWindow({ admin, position, slug }) {
  const endpoint = position === 1
    ? "/api/agent/game1/master/start"
    : "/api/agent/game1/master/advance";
  try {
    const result = await api(endpoint, {
      method: "POST",
      token: admin.accessToken,
      body: { hallId: MASTER_HALL_ID },
    });
    if (!result.scheduledGameId) {
      throw new Error(`${endpoint} did not return scheduledGameId`);
    }
    return result;
  } catch (err) {
    if (err.code === "JACKPOT_SETUP_REQUIRED") {
      log("jackpot setup required before opening purchase window", { position, slug });
      await setupJackpot(admin.accessToken, position, slug);
      const result = await api(endpoint, {
        method: "POST",
        token: admin.accessToken,
        body: { hallId: MASTER_HALL_ID },
      });
      if (!result.scheduledGameId) {
        throw new Error(`${endpoint} after jackpot setup did not return scheduledGameId`);
      }
      return result;
    }
    throw err;
  }
}

async function setupJackpot(adminToken, position, slug) {
  const { rows } = await pool.query(
    `SELECT prizes_cents_json
       FROM app_game_catalog
      WHERE slug = $1`,
    [slug ?? "jackpot"],
  );
  const prizes = rows[0]?.prizes_cents_json?.bingo ?? {
    hvit: 100_000,
    gul: 200_000,
    lilla: 300_000,
  };
  const result = await api("/api/agent/game1/master/jackpot-setup", {
    method: "POST",
    token: adminToken,
    body: {
      hallId: MASTER_HALL_ID,
      position,
      draw: 56,
      prizesCents: prizes,
    },
  });
  report.anomalies.push({
    at: new Date().toISOString(),
    type: "jackpot.setup.applied",
    position,
    draw: 56,
    prizesCents: prizes,
    result,
  });
}

async function loadTicketCatalog(scheduledGameId) {
  const { rows } = await pool.query(
    `SELECT ticket_config_json
       FROM app_game1_scheduled_games
      WHERE id = $1`,
    [scheduledGameId],
  );
  const config = rows[0]?.ticket_config_json;
  const items = Array.isArray(config?.ticketTypesData)
    ? config.ticketTypesData
    : Array.isArray(config?.ticketTypes)
      ? config.ticketTypes
      : Array.isArray(config)
        ? config
        : [];
  const catalog = new Map();
  for (const item of items) {
    const color = String(item.color ?? "").trim();
    const size = String(item.size ?? "").trim();
    const price = Number(item.priceCents ?? item.priceCentsEach ?? item.pricePerTicket ?? item.price);
    if (!color || !size || !Number.isInteger(price)) continue;
    catalog.set(`${color}:${size}`, price);
  }
  for (const key of [
    "yellow:small",
    "yellow:large",
    "white:large",
    "purple:large",
  ]) {
    if (!catalog.has(key)) {
      throw new Error(`ticket_config_json missing ${key} for ${scheduledGameId}`);
    }
  }
  return catalog;
}

async function joinRound(round) {
  for (const client of clients) {
    try {
      const ack = await emitAck(client.socket, "game1:join-scheduled", {
        accessToken: client.accessToken,
        scheduledGameId: round.scheduledGameId,
        hallId: client.hallId,
        playerName: client.playerName,
      }, 20_000);
      if (!ack?.ok) {
        round.joins.failed.push({
          email: client.email,
          hallId: client.hallId,
          playerName: client.playerName,
          response: ack,
        });
      } else {
        round.joins.ok += 1;
        client.currentGameId = round.scheduledGameId;
        client.roomCode = ack.data.roomCode;
        client.playerId = ack.data.playerId;
        round.roomCode = round.roomCode ?? ack.data.roomCode;
      }
    } catch (err) {
      round.joins.failed.push({
        email: client.email,
        hallId: client.hallId,
        playerName: client.playerName,
        ...serializeError(err),
      });
    }
    await sleep(JOIN_DELAY_MS);
  }
  log("round joined", {
    position: round.position,
    ok: round.joins.ok,
    failed: round.joins.failed.length,
    roomCode: round.roomCode,
  });
}

async function purchaseRound(round, ticketCatalog) {
  const tasks = clients.map((client) => async () => {
    const spec = ticketSpecForClient(client, ticketCatalog);
    try {
      const result = await purchaseWithRetry(round, client, spec);
      round.purchases.ok += 1;
      return result;
    } catch (err) {
      round.purchases.failed.push({
        email: client.email,
        hallId: client.hallId,
        spec,
        ...serializeError(err),
      });
      return null;
    }
  });
  await mapLimit(tasks, PURCHASE_CONCURRENCY);
  log("round purchased", {
    position: round.position,
    ok: round.purchases.ok,
    failed: round.purchases.failed.length,
  });
}

async function purchaseWithRetry(round, client, spec) {
  const idempotencyKey = `goh-full-plan:${RUN_ID}:${round.position}:${client.userId}`;
  let lastError = null;
  for (let attempt = 1; attempt <= PURCHASE_RETRIES + 1; attempt += 1) {
    try {
      const result = await api("/api/game1/purchase", {
        method: "POST",
        token: client.accessToken,
        body: {
          scheduledGameId: round.scheduledGameId,
          buyerUserId: client.userId,
          hallId: client.hallId,
          paymentMethod: "digital_wallet",
          idempotencyKey,
          ticketSpec: [spec],
        },
      });
      if (attempt > 1) {
        round.purchases.retried = (round.purchases.retried ?? 0) + 1;
        report.anomalies.push({
          at: new Date().toISOString(),
          type: "purchase.retry.succeeded",
          position: round.position,
          scheduledGameId: round.scheduledGameId,
          email: client.email,
          attempts: attempt,
          previousCode: lastError?.code,
          previousMessage: lastError?.message,
        });
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt > PURCHASE_RETRIES || !isTransientPurchaseFailure(err)) {
        throw err;
      }
      round.purchases.transientFailures = (round.purchases.transientFailures ?? 0) + 1;
      await sleep(250 * attempt + Math.floor(Math.random() * 150));
    }
  }
  throw lastError ?? new Error("purchase retry exhausted");
}

function isTransientPurchaseFailure(err) {
  const message = String(err?.message ?? err?.body?.error?.message ?? "");
  return (
    err?.code === "WALLET_SERIALIZATION_FAILURE" ||
    message.includes("Lommebok-operasjon kunne ikke fullføres")
  );
}

function ticketSpecForClient(client, catalog) {
  let color;
  let size;
  if (client.indexInHall <= 5) {
    color = "yellow";
    size = "small";
  } else if (client.indexInHall <= 10) {
    color = "white";
    size = "large";
  } else if (client.indexInHall <= 15) {
    color = "yellow";
    size = "large";
  } else {
    color = "purple";
    size = "large";
  }
  const priceCentsEach = catalog.get(`${color}:${size}`);
  return {
    color,
    size,
    count: 1,
    priceCentsEach,
    label: `${COLOR_LABEL[color] ?? color} ${size}`,
  };
}

async function mapLimit(tasks, limit) {
  const executing = new Set();
  const results = [];
  for (const task of tasks) {
    const promise = Promise.resolve().then(task);
    results.push(promise);
    executing.add(promise);
    promise.finally(() => executing.delete(promise));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function markHallsReady(round) {
  for (const hallId of HALLS) {
    try {
      const result = await api(`/api/admin/game1/halls/${hallId}/ready`, {
        method: "POST",
        token: (await getAdminToken()).accessToken,
        body: {
          gameId: round.scheduledGameId,
          digitalTicketsSold: 50,
        },
      });
      round.ready.ok += 1;
      round.ready[hallId] = result;
    } catch (err) {
      round.ready.failed.push({
        hallId,
        ...serializeError(err),
      });
    }
  }
  log("round ready", {
    position: round.position,
    ok: round.ready.ok,
    failed: round.ready.failed.length,
  });
}

async function loadClientTicketNumbers(round) {
  const expectedAssignments = HALLS.length * 50;
  let rows = [];
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await pool.query(
      `SELECT buyer_user_id, grid_numbers_json
         FROM app_game1_ticket_assignments
        WHERE scheduled_game_id = $1`,
      [round.scheduledGameId],
    );
    rows = result.rows;
    if (rows.length >= expectedAssignments) break;
    await sleep(500);
  }
  const byUser = new Map();
  for (const row of rows) {
    const set = byUser.get(row.buyer_user_id) ?? new Set();
    const numbers = Array.isArray(row.grid_numbers_json) ? row.grid_numbers_json : [];
    for (const raw of numbers) {
      const value = Number(raw);
      if (Number.isInteger(value) && value >= 1 && value <= 75) {
        set.add(value);
      }
    }
    byUser.set(row.buyer_user_id, set);
  }
  for (const client of clients) {
    client.ticketNumbersByGame.set(round.scheduledGameId, byUser.get(client.userId) ?? new Set());
  }
  round.ticketNumberCoverage = {
    assignmentRows: rows.length,
    playersWithNumbers: [...byUser.values()].filter((set) => set.size > 0).length,
  };
  if (rows.length < expectedAssignments) {
    report.anomalies.push({
      at: new Date().toISOString(),
      type: "ticket.assignments.incomplete_before_marking",
      position: round.position,
      scheduledGameId: round.scheduledGameId,
      assignmentRows: rows.length,
      expectedAssignments,
    });
  }
}

let cachedAdmin = null;
async function getAdminToken() {
  if (!cachedAdmin) cachedAdmin = await autoLogin("tobias@nordicprofil.no");
  return cachedAdmin;
}

async function startRound(adminToken, expectedScheduledGameId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await api("/api/agent/game1/master/start", {
      method: "POST",
      token: adminToken,
      body: { hallId: MASTER_HALL_ID },
    });
    if (result.scheduledGameId !== expectedScheduledGameId) {
      throw new Error(
        `master/start returned scheduledGameId=${result.scheduledGameId}, expected ${expectedScheduledGameId}`,
      );
    }
    if (result.scheduledGameStatus === "running") {
      return result;
    }
    if (result.scheduledGameStatus === "purchase_open" && attempt < 3) {
      await sleep(1000);
      continue;
    }
    throw new Error(
      `master/start returned status=${result.scheduledGameStatus} for ${expectedScheduledGameId} on attempt ${attempt}`,
    );
  }
  throw new Error(`master/start did not transition ${expectedScheduledGameId} to running`);
}

async function waitForRoundTerminal(round, adminToken) {
  const startedAt = Date.now();
  let lastStatus = null;
  while (Date.now() - startedAt < ROUND_TIMEOUT_MS) {
    const state = await loadScheduledState(round.scheduledGameId);
    const statusKey = `${state.status}:${state.enginePaused ? "engine_paused" : "engine_active"}`;
    if (statusKey !== lastStatus) {
      lastStatus = statusKey;
      log("round status", {
        position: round.position,
        slug: round.slug,
        status: state.status,
        enginePaused: state.enginePaused,
        draws: state.draws,
      });
    }
    if (state.status === "completed") {
      return { status: "completed", completedAt: new Date().toISOString() };
    }
    if (state.status === "cancelled") {
      throw new Error(`Round ${round.position} was cancelled`);
    }
    if (state.status === "paused" || state.enginePaused) {
      try {
        await api("/api/agent/game1/master/resume", {
          method: "POST",
          token: adminToken,
          body: { hallId: MASTER_HALL_ID },
        });
        round.resumes += 1;
        log("round auto-resumed", {
          position: round.position,
          slug: round.slug,
          draws: state.draws,
          trigger: state.status === "paused" ? "scheduled_status" : "engine_paused",
        });
      } catch (err) {
        report.anomalies.push({
          at: new Date().toISOString(),
          type: "round.resume.failed",
          position: round.position,
          scheduledGameId: round.scheduledGameId,
          ...serializeError(err),
        });
      }
    }
    await sleep(2500);
  }
  throw new Error(`Round ${round.position} timeout after ${ROUND_TIMEOUT_MS}ms`);
}

async function loadScheduledState(scheduledGameId) {
  const { rows } = await pool.query(
    `SELECT sg.status,
            sg.actual_start_time,
            sg.actual_end_time,
            sg.room_code,
            COALESCE(gs.paused, false) AS engine_paused,
            (SELECT COUNT(*)::int FROM app_game1_draws d WHERE d.scheduled_game_id = sg.id) AS draws
       FROM app_game1_scheduled_games sg
       LEFT JOIN app_game1_game_state gs ON gs.scheduled_game_id = sg.id
      WHERE sg.id = $1`,
    [scheduledGameId],
  );
  if (!rows[0]) throw new Error(`scheduled-game not found: ${scheduledGameId}`);
  return {
    ...rows[0],
    enginePaused: rows[0].engine_paused === true,
  };
}

async function summarizeRound(scheduledGameId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM app_game1_ticket_purchases p
         WHERE p.scheduled_game_id = $1
           AND p.refunded_at IS NULL) AS purchases,
       (SELECT COALESCE(SUM(p.total_amount_cents), 0)::bigint
          FROM app_game1_ticket_purchases p
         WHERE p.scheduled_game_id = $1
           AND p.refunded_at IS NULL) AS amount_cents,
       (SELECT COUNT(*)::int
          FROM app_game1_ticket_assignments a
         WHERE a.scheduled_game_id = $1) AS tickets,
       (SELECT COUNT(*)::int
          FROM app_game1_draws d
         WHERE d.scheduled_game_id = $1) AS draws,
       (SELECT COUNT(*)::int
          FROM app_game1_phase_winners w
         WHERE w.scheduled_game_id = $1) AS winners`,
    [scheduledGameId],
  );
  const row = rows[0];
  return {
    purchases: Number(row.purchases),
    amountCents: Number(row.amount_cents),
    tickets: Number(row.tickets),
    draws: Number(row.draws),
    winners: Number(row.winners),
  };
}

function summarizeSocketEvents(scheduledGameId) {
  let drawEvents = 0;
  let markAcks = 0;
  let markFailures = 0;
  let markSkipped = 0;
  const markFailureCodes = {};
  const markFailureSamples = [];
  for (const client of clients) {
    drawEvents += client.drawEventsByGame.get(scheduledGameId) ?? 0;
    markAcks += client.markAcksByGame.get(scheduledGameId) ?? 0;
    markFailures += client.markFailuresByGame.get(scheduledGameId) ?? 0;
    markSkipped += client.markSkippedByGame.get(scheduledGameId) ?? 0;
    const codes = client.markFailureCodesByGame.get(scheduledGameId);
    if (codes) {
      for (const [code, count] of codes.entries()) {
        markFailureCodes[code] = (markFailureCodes[code] ?? 0) + count;
      }
    }
    const samples = client.markFailureSamplesByGame.get(scheduledGameId) ?? [];
    for (const sample of samples) {
      if (markFailureSamples.length >= 12) break;
      markFailureSamples.push(sample);
    }
  }
  return { drawEvents, markAcks, markFailures, markSkipped, markFailureCodes, markFailureSamples };
}

function assertRoundSummary(round) {
  const expectedPurchases = HALLS.length * PLAYERS_PER_HALL;
  const expectedTickets = HALLS.length * 50;
  if (round.summary.purchases !== expectedPurchases) {
    throw new Error(
      `Round ${round.position} expected ${expectedPurchases} purchases, got ${round.summary.purchases}`,
    );
  }
  if (round.summary.tickets !== expectedTickets) {
    throw new Error(
      `Round ${round.position} expected ${expectedTickets} ticket assignments, got ${round.summary.tickets}`,
    );
  }
  if (round.summary.draws <= 0) {
    throw new Error(`Round ${round.position} completed with zero draws`);
  }
  if (round.socketEventTotals.markFailures > 0) {
    report.anomalies.push({
      at: new Date().toISOString(),
      type: "ticket.mark.failures",
      severity: "P1",
      position: round.position,
      scheduledGameId: round.scheduledGameId,
      markFailures: round.socketEventTotals.markFailures,
      markFailureCodes: round.socketEventTotals.markFailureCodes,
      samples: round.socketEventTotals.markFailureSamples,
      note: "Scheduled Game1 fullfører via server-side draw/pattern-eval, men klientenes ticket:mark socket-flow feiler og må undersøkes separat.",
    });
  }
}

async function advancePastEnd(adminToken) {
  try {
    const result = await api("/api/agent/game1/master/advance", {
      method: "POST",
      token: adminToken,
      body: { hallId: MASTER_HALL_ID },
    });
    return result;
  } catch (err) {
    if (err.code === "PLAN_COMPLETED_FOR_TODAY") {
      return { expectedPlanCompletedForToday: true, code: err.code, message: err.message };
    }
    if (
      err.code === "GAME_PLAN_RUN_INVALID_TRANSITION" &&
      String(err.message ?? "").includes("status=finished")
    ) {
      return { expectedPlanAlreadyFinished: true, code: err.code, message: err.message };
    }
    throw err;
  }
}

function serializeError(err) {
  return {
    message: err?.message ?? String(err),
    code: err?.code,
    status: err?.status,
    body: err?.body,
    stack: err?.stack,
  };
}

async function writeReports() {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUTPUT_MD, renderMarkdownReport(), "utf8");
}

function renderMarkdownReport() {
  const lines = [];
  lines.push(`# GoH full-plan run ${RUN_ID}`);
  lines.push("");
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Backend: ${report.backendUrl}`);
  lines.push(`- Group of halls: ${report.groupOfHallsId}`);
  lines.push(`- Scope: ${report.halls.length} halls x ${report.playersPerHall} players = ${report.clients.requested} players`);
  lines.push(`- Purchase pacing: concurrency ${report.purchaseConcurrency}, retries ${report.purchaseRetries}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt ?? "n/a"}`);
  lines.push(`- Pilot monitor log: ${report.monitoring.pilotMonitorLog}`);
  lines.push(`- Sentry token present: ${report.monitoring.sentryAuthTokenPresent ? "yes" : "no"}`);
  lines.push(`- PostHog env present: ${report.monitoring.posthogEnvPresent ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Plan Items");
  lines.push("");
  lines.push("| Pos | Slug | Result | Purchases | Tickets | Amount | Draws | Resumes | Marks |");
  lines.push("| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const round of report.rounds) {
    lines.push(
      `| ${round.position} | ${round.slug} | ${round.terminalStatus ?? "n/a"} | ${round.summary?.purchases ?? 0} | ${round.summary?.tickets ?? 0} | ${((round.summary?.amountCents ?? 0) / 100).toFixed(0)} kr | ${round.summary?.draws ?? 0} | ${round.resumes ?? 0} | ${round.socketEventTotals?.markAcks ?? 0} |`,
    );
  }
  lines.push("");
  if (report.anomalies.length > 0) {
    lines.push("## Anomalies");
    lines.push("");
    for (const anomaly of report.anomalies) {
      lines.push(`- ${anomaly.at}: ${anomaly.type}${anomaly.code ? ` (${anomaly.code})` : ""}${anomaly.message ? ` — ${anomaly.message}` : ""}`);
    }
    lines.push("");
  }
  if (report.failure) {
    lines.push("## Failure");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(report.failure, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Evidence Files");
  lines.push("");
  lines.push(`- JSON: ${OUTPUT_JSON}`);
  lines.push(`- Markdown: ${OUTPUT_MD}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
