#!/usr/bin/env node
/**
 * scripts/dev/stress-test.mjs
 *
 * CLI for å spawne N parallelle Socket.IO-klienter mot lokal backend, simulere
 * en realistisk spillsesjon (login → connect socket → join room → mark tickets
 * → disconnect) og rapportere connection-rate, p95-latency og errors.
 *
 * Bruk:
 *   npm run dev:stress -- --players=100 --duration=60 --game=rocket
 *   npm run dev:stress -- --players=500 --duration=120 --game=monsterbingo
 *
 * Argumenter:
 *   --players=N         Antall samtidige klienter (default 50)
 *   --duration=N        Hvor lenge hver klient holder socket åpen (sek, default 30)
 *   --game=SLUG         Spill-slug: bingo | rocket | monsterbingo (default rocket)
 *   --backend=URL       Backend-URL (default http://localhost:4000)
 *   --ramp-up=N         Sek å spread out connection-spawn over (default 5)
 *   --output=FILE       Skriv per-client-stats til JSON-fil (default
 *                       scripts/dev/stress-results.json)
 *   --debug             Logg alle errors detaljert
 *   --quiet             Kun final summary
 *
 * Output:
 *   - Real-time progress (connections opp / nede / i gang)
 *   - Final summary (p50/p95/p99 latency, errors, msg-throughput)
 *   - JSON-fil med per-client-stats (for senere analyse)
 *
 * Pilot-mål: 24 haller × 1500 spillere = 36 000 samtidige sockets. På utvikler-
 * maskin kan vi typisk teste 1 000-2 000 — det validerer hot-paths (room-join,
 * draw-broadcast) før prod-deploy.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_LOCAL = path.resolve(__dirname, "../..");

// socket.io-client ligger i root node_modules (workspace-hoisted) eller
// apps/backend/node_modules. createRequire gir oss CJS-imports.
const require = createRequire(import.meta.url);
function resolveDep(name) {
  const candidates = [
    path.join(ROOT_LOCAL, "node_modules", name),
    path.join(ROOT_LOCAL, "apps/backend/node_modules", name),
  ];
  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* fall through */
    }
  }
  throw new Error(
    `Kunne ikke laste '${name}'. Kjør 'npm install' fra root.`,
  );
}
const { io: ioClient } = resolveDep("socket.io-client");

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    out[k] = v === undefined ? true : v;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PLAYERS = Number(args.players ?? 50);
const DURATION_S = Number(args.duration ?? 30);
const GAME_SLUG = String(args.game ?? "rocket"); // bingo | rocket | monsterbingo
const BACKEND_URL = String(args.backend ?? "http://localhost:4000");
const RAMP_UP_S = Number(args["ramp-up"] ?? 5);
const OUTPUT_FILE = String(
  args.output ??
    path.join(__dirname, `stress-results-${new Date().toISOString().slice(0, 10)}.json`)
);
const DEBUG = Boolean(args.debug);
const QUIET = Boolean(args.quiet);

const ROOM_CODE_FOR_GAME = {
  bingo: "BINGO1",
  rocket: "ROCKET",
  monsterbingo: "MONSTERBINGO",
  spillorama: "SPINNGO",
};
const ROOM_CODE = ROOM_CODE_FOR_GAME[GAME_SLUG] ?? GAME_SLUG.toUpperCase();

// ── Logging ─────────────────────────────────────────────────────────────────

const COLORS = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m" };
function color(name, t) {
  if (!process.stdout.isTTY) return t;
  return `${COLORS[name] ?? ""}${t}${COLORS.reset}`;
}
function log(level, msg) {
  if (QUIET && level !== "error") return;
  const ts = new Date().toISOString().slice(11, 19);
  const c = level === "error" ? "red" : level === "warn" ? "yellow" : "dim";
  console.log(`${color(c, `[${ts}] [${level}]`)} ${msg}`);
}

// ── Stats ───────────────────────────────────────────────────────────────────

class Stats {
  constructor() {
    this.connections = 0;
    this.connectErrors = 0;
    this.loginErrors = 0;
    this.joinErrors = 0;
    this.markEvents = 0;
    this.drawEvents = 0;
    this.disconnects = 0;
    this.latencies = []; // ms — handshake-til-første-snapshot
    this.errors = [];
    this.startedAt = Date.now();
  }
  percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
  }
  summary() {
    const elapsedS = (Date.now() - this.startedAt) / 1000;
    return {
      players: PLAYERS,
      duration_s: DURATION_S,
      game: GAME_SLUG,
      room_code: ROOM_CODE,
      backend: BACKEND_URL,
      elapsed_s: Number(elapsedS.toFixed(2)),
      connections: this.connections,
      connect_errors: this.connectErrors,
      login_errors: this.loginErrors,
      join_errors: this.joinErrors,
      mark_events: this.markEvents,
      draw_events: this.drawEvents,
      disconnects: this.disconnects,
      latency_p50_ms: this.percentile(this.latencies, 50),
      latency_p95_ms: this.percentile(this.latencies, 95),
      latency_p99_ms: this.percentile(this.latencies, 99),
      latency_max_ms: this.latencies.length ? Math.max(...this.latencies) : 0,
      msgs_per_sec: Number(((this.markEvents + this.drawEvents) / elapsedS).toFixed(2)),
      errors_sample: this.errors.slice(0, 20),
    };
  }
}

const stats = new Stats();

// ── HTTP login (uten å bruke noen avhengigheter utover Node fetch) ──────────

async function login(email, password) {
  const t0 = Date.now();
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`login failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`login failed: ${JSON.stringify(body.error)}`);
  }
  return { accessToken: body.data.accessToken, userId: body.data.user?.id, latency: ms };
}

// ── Single virtual player ────────────────────────────────────────────────────

async function runVirtualPlayer(playerNumber) {
  const email = `demo-pilot-spiller-${(playerNumber % 12) + 1}@example.com`;
  const password = process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";
  const t0 = Date.now();

  let session;
  try {
    session = await login(email, password);
  } catch (err) {
    stats.loginErrors += 1;
    if (DEBUG) stats.errors.push({ phase: "login", player: playerNumber, msg: err.message });
    return;
  }

  // Connect socket. Socket.IO 4 kan ikke sende auth-token i query — vi bruker
  // auth-payload. Backend leser den i sockets/auth-middleware.
  const socket = ioClient(BACKEND_URL, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10000,
    auth: { token: session.accessToken },
    extraHeaders: { Authorization: `Bearer ${session.accessToken}` },
  });

  let firstSnapshotAt = null;
  const markListener = () => {
    stats.markEvents += 1;
  };
  const drawListener = () => {
    stats.drawEvents += 1;
  };
  const snapshotListener = () => {
    if (firstSnapshotAt === null) {
      firstSnapshotAt = Date.now();
      stats.latencies.push(firstSnapshotAt - t0);
    }
  };

  socket.on("ticket:marked", markListener);
  socket.on("draw:new", drawListener);
  socket.on("room:snapshot", snapshotListener);
  socket.on("room:update", snapshotListener);

  await new Promise((resolve) => {
    let connected = false;
    socket.once("connect", () => {
      connected = true;
      stats.connections += 1;
      // Forsøk room:join — send minimal payload. Backend resolver
      // identity fra auth-token.
      socket.emit(
        "room:join",
        { roomCode: ROOM_CODE, gameSlug: GAME_SLUG },
        (ack) => {
          if (!ack || ack.ok === false) {
            stats.joinErrors += 1;
            if (DEBUG)
              stats.errors.push({
                phase: "join",
                player: playerNumber,
                msg: ack?.error?.message ?? "no ack",
              });
          }
        }
      );
    });
    socket.once("connect_error", (err) => {
      stats.connectErrors += 1;
      if (DEBUG)
        stats.errors.push({ phase: "connect", player: playerNumber, msg: err.message });
      resolve();
    });
    socket.once("disconnect", () => {
      stats.disconnects += 1;
      resolve();
    });

    setTimeout(() => {
      if (connected) socket.disconnect();
      resolve();
    }, DURATION_S * 1000);
  });
}

// ── Progress-printer ─────────────────────────────────────────────────────────

function startProgressPrinter() {
  if (QUIET) return null;
  const interval = setInterval(() => {
    const elapsed = (Date.now() - stats.startedAt) / 1000;
    const summary = stats.summary();
    process.stdout.write(
      `\r${color(
        "cyan",
        `[${elapsed.toFixed(0)}s]`
      )} conn=${summary.connections} draws=${summary.draw_events} marks=${summary.mark_events} err=${summary.connect_errors + summary.login_errors + summary.join_errors}    `
    );
  }, 1000);
  return interval;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(color("cyan", `▸ Stress test: ${PLAYERS} players × ${DURATION_S}s on ${GAME_SLUG} (${ROOM_CODE})`));
  console.log(color("dim", `  backend=${BACKEND_URL} ramp-up=${RAMP_UP_S}s`));

  const interval = startProgressPrinter();

  // Spawn med ramp-up — distribuer connection-attempts jevnt over RAMP_UP_S
  const promises = [];
  const spawnDelayMs = (RAMP_UP_S * 1000) / Math.max(1, PLAYERS);

  for (let i = 0; i < PLAYERS; i += 1) {
    await new Promise((r) => setTimeout(r, spawnDelayMs));
    promises.push(runVirtualPlayer(i));
  }

  await Promise.all(promises);
  if (interval) clearInterval(interval);
  process.stdout.write("\n");

  const summary = stats.summary();
  console.log("");
  console.log(color("cyan", "▸ Final summary"));
  console.log("");
  for (const [k, v] of Object.entries(summary)) {
    if (k === "errors_sample") continue;
    const label = k.padEnd(22);
    const valStr = typeof v === "number" ? String(v) : JSON.stringify(v);
    console.log(`  ${label} ${color("green", valStr)}`);
  }
  if (summary.errors_sample.length > 0) {
    console.log("");
    console.log(color("yellow", `  errors_sample (${summary.errors_sample.length}):`));
    for (const e of summary.errors_sample) {
      console.log(`    ${color("dim", `[${e.phase} player ${e.player}]`)} ${e.msg}`);
    }
  }

  // Skriv JSON-resultatfil
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2), "utf-8");
  console.log("");
  console.log(color("dim", `  resultat lagret: ${OUTPUT_FILE}`));

  // Exit-code: failure hvis > 5% av connection-attempts feilet
  const totalAttempted = PLAYERS;
  const failed =
    summary.connect_errors + summary.login_errors + summary.join_errors;
  const failRate = totalAttempted ? failed / totalAttempted : 0;
  if (failRate > 0.05) {
    console.log(
      color(
        "red",
        `  fail-rate ${(failRate * 100).toFixed(1)}% > 5% threshold — exiting 1`
      )
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(color("red", `[stress] feil: ${err.stack ?? err.message}`));
  process.exit(1);
});
