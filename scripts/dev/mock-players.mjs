#!/usr/bin/env node
/**
 * scripts/dev/mock-players.mjs
 *
 * Spawner N "fake" spillere som logger inn, joiner rom, og holder seg
 * tilkoblet med menneske-aktig tempo (kjøper bonger, marker tall, chater).
 *
 * Forskjellen fra `dev:stress` er at mock-players er tunet for å produsere
 * REALISTISK trafikk-mønster (lange økter, varierte mellomrom mellom
 * actions, occasional chat) snarere enn maksimal load. Bruk den for å:
 *   - manuelt teste features med live multi-player-trafikk i bakgrunnen
 *   - reprodusere bugs som krever flere samtidige spillere
 *   - generere meningsfulle metrics-data for klient-debug-suite
 *
 * Bruk:
 *   npm run dev:mock-players -- --count=5 --game=rocket
 *   npm run dev:mock-players -- --count=10 --simulate-offline-percent=20
 *   npm run dev:mock-players -- --count=3 --rapid-purchase
 *
 * Argumenter:
 *   --count=N                 Antall mock-spillere (default 5, max 12 — vi har
 *                              kun 12 demo-pilot-spillere seedet)
 *   --game=SLUG               bingo | rocket | monsterbingo (default rocket)
 *   --backend=URL             Backend-URL (default http://localhost:4000)
 *   --rapid-purchase          Kjøper bonger / marker tall hvert 1-3s
 *                              (default: hvert 5-15s)
 *   --simulate-offline-percent=N   N% sjanse per spiller for å disconnecte
 *                              hvert 30s (simulerer mobil-flakkende-internett)
 *   --duration=N              Hvor lenge mock-spillere skal kjøre (default 600s)
 *   --quiet                   Mindre logging
 *
 * Stoppe: Ctrl+C — alle mock-spillere disconnecter rent.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_LOCAL = path.resolve(__dirname, "../..");

// socket.io-client ligger i root node_modules eller apps/backend/node_modules.
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
const COUNT = Math.min(Number(args.count ?? 5), 12);
const GAME_SLUG = String(args.game ?? "rocket");
const BACKEND_URL = String(args.backend ?? "http://localhost:4000");
const RAPID = Boolean(args["rapid-purchase"]);
const OFFLINE_PCT = Number(args["simulate-offline-percent"] ?? 0);
const DURATION_S = Number(args.duration ?? 600);
const QUIET = Boolean(args.quiet);

const ROOM_CODE_FOR_GAME = {
  bingo: "BINGO1",
  rocket: "ROCKET",
  monsterbingo: "MONSTERBINGO",
  spillorama: "SPINNGO",
};
const ROOM_CODE = ROOM_CODE_FOR_GAME[GAME_SLUG] ?? GAME_SLUG.toUpperCase();

// ── Logging ─────────────────────────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};
const PLAYER_COLORS = ["green", "blue", "yellow", "magenta", "cyan", "red"];
function color(name, t) {
  if (!process.stdout.isTTY) return t;
  return `${COLORS[name] ?? ""}${t}${COLORS.reset}`;
}
function plog(player, msg, level = "info") {
  if (QUIET && level !== "error") return;
  const cName = PLAYER_COLORS[player.idx % PLAYER_COLORS.length];
  const ts = new Date().toISOString().slice(11, 19);
  const lc = level === "error" ? "red" : "dim";
  console.log(
    `${color(lc, `[${ts}]`)} ${color(cName, `[player-${player.idx + 1}]`)} ${msg}`
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pause(min, max) {
  return new Promise((r) => setTimeout(r, randInt(min, max)));
}

async function login(email, password) {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(`login: ${JSON.stringify(body.error)}`);
  return { accessToken: body.data.accessToken, userId: body.data.user?.id };
}

// ── Single mock player ──────────────────────────────────────────────────────

const players = [];
let shuttingDown = false;

async function runMockPlayer(idx) {
  const playerNum = (idx % 12) + 1;
  const email = `demo-pilot-spiller-${playerNum}@example.com`;
  const password = process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";
  const player = { idx, email, socket: null };
  players.push(player);

  let session;
  try {
    session = await login(email, password);
    plog(player, color("dim", `logged in (userId=${session.userId?.slice(0, 8)})`));
  } catch (err) {
    plog(player, color("red", `login feilet: ${err.message}`), "error");
    return;
  }

  const socket = ioClient(BACKEND_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 5,
    auth: { token: session.accessToken },
    extraHeaders: { Authorization: `Bearer ${session.accessToken}` },
  });
  player.socket = socket;

  socket.on("connect", () => {
    plog(player, color("green", `connected → join ${ROOM_CODE}`));
    socket.emit(
      "room:join",
      { roomCode: ROOM_CODE, gameSlug: GAME_SLUG },
      (ack) => {
        if (ack?.ok === false) {
          plog(player, color("yellow", `join feilet: ${ack.error?.message}`));
        } else {
          plog(player, color("dim", "join OK"));
        }
      }
    );
  });
  socket.on("disconnect", (reason) => {
    plog(player, color("dim", `disconnected (${reason})`));
  });
  socket.on("connect_error", (err) => {
    plog(player, color("red", `connect_error: ${err.message}`), "error");
  });
  socket.on("draw:new", (payload) => {
    plog(player, color("dim", `draw → ${payload?.number ?? "?"}`));
  });

  // Realistisk action-loop
  const startedAt = Date.now();
  while (!shuttingDown && Date.now() - startedAt < DURATION_S * 1000) {
    const minWait = RAPID ? 1000 : 5000;
    const maxWait = RAPID ? 3000 : 15000;
    await pause(minWait, maxWait);
    if (shuttingDown) break;

    if (!socket.connected) continue;

    // Tilfeldig action: ticket:mark eller bare lytt
    const action = Math.random();
    if (action < 0.3) {
      // ticket:mark — lat som vi merker et tall
      const number = randInt(1, 75);
      socket.emit("ticket:mark", { roomCode: ROOM_CODE, number }, () => {});
      plog(player, color("dim", `mark ${number}`));
    }

    // Simulert offline-window
    if (OFFLINE_PCT > 0 && Math.random() * 100 < OFFLINE_PCT) {
      plog(player, color("yellow", "simulering: går offline 5s"));
      socket.disconnect();
      await pause(5000, 5000);
      if (!shuttingDown) socket.connect();
    }
  }

  socket.disconnect();
}

// ── Shutdown ────────────────────────────────────────────────────────────────

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  console.log(color("yellow", "[mock-players] avslutter alle spillere…"));
  for (const p of players) {
    if (p.socket?.connected) p.socket.disconnect();
  }
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    color(
      "cyan",
      `▸ Mock players: count=${COUNT} game=${GAME_SLUG} rapid=${RAPID} offline-pct=${OFFLINE_PCT}%`
    )
  );
  console.log(color("dim", `  backend=${BACKEND_URL} duration=${DURATION_S}s`));
  console.log(color("dim", "  Ctrl+C avslutter alle spillere"));
  console.log("");

  const tasks = [];
  for (let i = 0; i < COUNT; i += 1) {
    // Stagger spawn over 0-3s for å unngå thundering herd
    await pause(50, 200);
    tasks.push(runMockPlayer(i));
  }
  await Promise.all(tasks);

  console.log(color("green", "✓ alle mock-spillere fullført"));
  process.exit(0);
}

main().catch((err) => {
  console.error(color("red", `[mock-players] feil: ${err.stack ?? err.message}`));
  process.exit(1);
});
