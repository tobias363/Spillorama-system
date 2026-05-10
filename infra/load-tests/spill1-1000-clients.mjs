#!/usr/bin/env node
/**
 * R4 Load-test (BIN-817): 1000 simultane Spill 1-klienter per rom.
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-817
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5 R4
 *
 * ── Hva denne gjør ──────────────────────────────────────────────────────────
 *
 * Spawner N virtuelle brukere (VUs) som simulerer realistisk Spill 1-trafikk:
 *
 *   1. REST-login (henter accessToken).
 *   2. Socket.IO connect.
 *   3. `room:join` til target-rommet.
 *   4. `room:state` for å hente initial snapshot.
 *   5. Lytter på `draw:new` + `room:update` events.
 *   6. Sender `ticket:mark` med tilfeldig hyppighet (matrate).
 *   7. Måler:
 *        - Socket connect-time
 *        - room:join ack-roundtrip
 *        - ticket:mark ack-roundtrip
 *        - draw:new event-rate
 *        - room:update event-rate
 *        - Connection-errors / ack-timeouts / disconnects
 *   8. Etter holdMinutes: gradvis disconnect.
 *
 * Hver VU er én async funksjon. Vi kjører dem som Promise.allSettled(),
 * skalerbart til 1000+ samtidige uten worker_threads (socket.io-client er
 * IO-bound, ikke CPU-bound).
 *
 * ── Args via env ────────────────────────────────────────────────────────────
 *
 *   BACKEND_URL          (default http://localhost:4000)
 *   SCENARIO             (smoke | stress | full — fra spill1-load-config.json)
 *   CONFIG_FILE          (path til config-JSON, default ./spill1-load-config.json)
 *   OUTPUT_DIR           (default /tmp/r4-load-test-results)
 *   VU_COUNT_OVERRIDE    (override scenario.vuCount)
 *   HOLD_MINUTES_OVERRIDE
 *   PLAYER_PASSWORD      (default Spillorama123!)
 *
 * ── Exit-koder ──────────────────────────────────────────────────────────────
 *
 *   0 — alle SLA-tresholds møtt
 *   1 — én eller flere SLA-violations (men test kjørte ferdig)
 *   2 — testen kunne ikke kjøres (oppsett-feil, backend nede)
 *   3 — uventet exception
 */

import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { MetricsCollector, summarizeForConsole } from "./metrics-collector.mjs";

// ── Config from env ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const SCENARIO = process.env.SCENARIO ?? "smoke";
const CONFIG_FILE =
  process.env.CONFIG_FILE ?? path.join(__dirname, "spill1-load-config.json");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp/r4-load-test-results";
const PLAYER_PASSWORD = process.env.PLAYER_PASSWORD ?? "Spillorama123!";

const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
const scenario = config.scenarios?.[SCENARIO];
if (!scenario) {
  process.stderr.write(
    `[r4] Unknown scenario "${SCENARIO}". Available: ${Object.keys(config.scenarios ?? {}).join(", ")}\n`,
  );
  process.exit(2);
}

const VU_COUNT = Number(process.env.VU_COUNT_OVERRIDE ?? scenario.vuCount);
const RAMP_UP_S = scenario.rampUpSeconds;
const HOLD_MINUTES = Number(
  process.env.HOLD_MINUTES_OVERRIDE ?? scenario.holdMinutes,
);
const RAMP_DOWN_S = scenario.rampDownSeconds;
const TARGET_HALL = scenario.targetHallId;
const TARGET_ROOM = scenario.targetRoomCode;
const MARKS_PER_SEC = scenario.marksPerSecond;
const PLAYER_PREFIX = scenario.playerEmailPrefix;
const PLAYER_DOMAIN = scenario.playerEmailDomain;
const SLA = scenario.expectedSlaMs ?? {};

mkdirSync(OUTPUT_DIR, { recursive: true });

const collector = new MetricsCollector();
const vuStates = new Map(); // vu-id → { phase, errors }

// ── Logging ─────────────────────────────────────────────────────────────────
function logProgress(msg) {
  const elapsed = Math.round((Date.now() - startMs) / 1000);
  process.stderr.write(`[r4 t+${elapsed}s] ${msg}\n`);
}

const startMs = Date.now();

// ── REST helpers ────────────────────────────────────────────────────────────
async function login(email, password) {
  const t0 = performance.now();
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  collector.addLatencySample("loginLatency", performance.now() - t0);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`login http ${res.status}: ${text.slice(0, 100)}`);
  }
  const json = await res.json();
  const token = json?.data?.accessToken;
  if (!token) {
    throw new Error(`login missing accessToken in body`);
  }
  return token;
}

// ── Socket helpers ──────────────────────────────────────────────────────────
function connectSocket() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const sock = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 15000,
    });
    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error("socket connect timeout"));
    }, 15000);
    sock.once("connect", () => {
      clearTimeout(timer);
      collector.addLatencySample("socketConnectLatency", performance.now() - t0);
      resolve(sock);
    });
    sock.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(new Error(`socket connect_error: ${err.message}`));
    });
  });
}

function emitWithAck(sock, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const timer = setTimeout(() => {
      collector.addCounter(`ackTimeout:${event}`);
      reject(new Error(`emit ${event} ack timeout`));
    }, timeoutMs);
    sock.emit(event, payload, (response) => {
      clearTimeout(timer);
      const dt = performance.now() - t0;
      // ALLTID registrer roundtrip — det er måling av server-respons-tid,
      // uavhengig av om payload var "ok" eller business-error (eks
      // GAME_NOT_RUNNING — server svarer fortsatt raskt).
      collector.addLatencySample("socketRoundtrip", dt);
      collector.addLatencySample(`ack:${event}`, dt);
      if (!response) {
        reject(new Error(`emit ${event} no response`));
        return;
      }
      if (response.ok === false) {
        const code = response?.error?.code ?? "UNKNOWN";
        // Tell business-errors per error-code for tolking (eks
        // GAME_NOT_RUNNING er forventet hvis rommet er idle).
        collector.addCounter(`businessError:${event}:${code}`);
        reject(new Error(`emit ${event} failed: ${code}`));
        return;
      }
      resolve(response.data ?? response);
    });
  });
}

// ── Per-VU lifecycle ────────────────────────────────────────────────────────
async function runVU(vuId, durationMs, prefetchedToken) {
  const state = {
    vuId,
    phase: "init",
    drawEventCount: 0,
    roomUpdateCount: 0,
    markCount: 0,
    errors: [],
  };
  vuStates.set(vuId, state);

  const email = `${PLAYER_PREFIX}${vuId}${PLAYER_DOMAIN}`;
  let accessToken = prefetchedToken;
  let sock;

  // ── Login (kun hvis prefetch feilet eller skippet) ───────────────────────
  if (!accessToken) {
    try {
      state.phase = "login";
      accessToken = await login(email, PLAYER_PASSWORD);
      collector.addCounter("loginsSuccessful");
    } catch (err) {
      state.errors.push(`login: ${err.message}`);
      collector.addCounter("loginsFailed");
      return state;
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  try {
    state.phase = "connect";
    sock = await connectSocket();
    collector.addCounter("socketConnectsSuccessful");
  } catch (err) {
    state.errors.push(`connect: ${err.message}`);
    collector.addCounter("socketConnectsFailed");
    return state;
  }

  // Lytt på events
  sock.on("draw:new", () => {
    state.drawEventCount += 1;
    collector.addCounter("drawNewEventsReceived");
  });
  sock.on("room:update", () => {
    state.roomUpdateCount += 1;
    collector.addCounter("roomUpdateEventsReceived");
  });
  sock.on("disconnect", (reason) => {
    state.errors.push(`disconnect: ${reason}`);
    collector.addCounter(`disconnect:${reason}`);
  });

  // ── Join room ────────────────────────────────────────────────────────────
  let actualRoomCode;
  let playerId;
  try {
    state.phase = "join";
    const joinResp = await emitWithAck(sock, "room:join", {
      accessToken,
      hallId: TARGET_HALL,
      roomCode: TARGET_ROOM,
    });
    actualRoomCode = joinResp.roomCode;
    playerId = joinResp.playerId;
    collector.addCounter("roomJoinsSuccessful");
  } catch (err) {
    state.errors.push(`join: ${err.message}`);
    collector.addCounter("roomJoinsFailed");
    sock.disconnect();
    return state;
  }

  // ── Get initial state ─────────────────────────────────────────────────────
  try {
    state.phase = "state";
    await emitWithAck(sock, "room:state", {
      accessToken,
      roomCode: actualRoomCode,
      hallId: TARGET_HALL,
    });
  } catch (err) {
    // Ikke fatal — fortsetter uten initial state
    state.errors.push(`state: ${err.message}`);
  }

  // ── Hold-løkke ────────────────────────────────────────────────────────────
  state.phase = "hold";
  const endAt = Date.now() + durationMs;
  const markIntervalMs = 1000 / Math.max(MARKS_PER_SEC, 0.01);

  while (Date.now() < endAt && sock.connected) {
    // Vent før neste mark (med lite jitter for å spre last)
    const jitter = Math.random() * markIntervalMs * 0.4 - markIntervalMs * 0.2;
    await sleep(markIntervalMs + jitter);

    if (Date.now() >= endAt || !sock.connected) break;

    // Send en ticket:mark for et tilfeldig tall i [1, 75]
    const number = 1 + Math.floor(Math.random() * 75);
    const clientRequestId = randomUUID();
    const t0 = performance.now();
    try {
      await emitWithAck(
        sock,
        "ticket:mark",
        {
          accessToken,
          roomCode: actualRoomCode,
          playerId,
          hallId: TARGET_HALL,
          number,
          clientRequestId,
        },
        3000,
      );
      state.markCount += 1;
      collector.addCounter("ticketMarksSuccessful");
      // emitWithAck logger socketRoundtrip + ack:ticket:mark allerede;
      // ticketMarkLatency er en separat label for å lette tolkning når
      // man søker etter "hvor lang tid tar mark-roundtrips konkret".
      collector.addLatencySample(
        "ticketMarkLatency",
        performance.now() - t0,
      );
    } catch (err) {
      collector.addCounter("ticketMarksFailed");
      // Ikke logg som error med mindre det er > 5% — fanges av aggregat
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  state.phase = "done";
  if (sock.connected) {
    sock.disconnect();
  }
  return state;
}

// ── Pre-fetch tokens (unngår login rate-limit på 5/min/IP) ──────────────────
//
// `apps/backend/src/middleware/httpRateLimit.ts` setter login=5/min/IP.
// 1000 VUs fra én IP ville treffe taket umiddelbart. To strategier:
//
//   1) **Token-cache fra forrige run** — sjekker fil først (anbefalt for
//      dev/lokal: prefetch 1000 tokens tar ~3-4 timer, men skjer kun ÉN
//      gang).
//   2) **Live prefetch** — kjør 4 logins/min/IP og vent ferdig før test
//      starter. Treig men nødvendig hvis cache mangler.
//
// For staging/prod: backend bør deployes med en `LOAD_TEST_BYPASS_RATE_LIMIT=1`
// eller tilsvarende env-flag (krever liten backend-PR — se runbook).
//
const TOKEN_CACHE_PATH = path.join(
  OUTPUT_DIR,
  `tokens-${SCENARIO}-${TARGET_HALL}-${PLAYER_PREFIX}.json`,
);
const TOKEN_CACHE_TTL_MS = 6 * 24 * 3600 * 1000; // 6 dager (matcher backend default)

function loadCachedTokens() {
  if (!existsSync(TOKEN_CACHE_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(TOKEN_CACHE_PATH, "utf-8"));
    if (Date.now() - raw.savedAt > TOKEN_CACHE_TTL_MS) {
      logProgress(`Token-cache utløpt (eldre enn 6 dager) — refetcher`);
      return null;
    }
    const map = new Map(Object.entries(raw.tokens).map(([k, v]) => [Number(k), v]));
    logProgress(`Bruker cached tokens (${map.size} stk fra ${new Date(raw.savedAt).toISOString()})`);
    return map;
  } catch (err) {
    logProgress(`Token-cache uleselig (${err.message}) — refetcher`);
    return null;
  }
}

function saveCachedTokens(tokens) {
  const obj = { savedAt: Date.now(), tokens: Object.fromEntries(tokens) };
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(obj));
  logProgress(`Tokens cached til ${TOKEN_CACHE_PATH}`);
}

async function prefetchAllTokens(vuCount, maxPerMinute = 4) {
  // Sjekk cache først
  const cached = loadCachedTokens();
  if (cached && cached.size >= vuCount) return cached;

  logProgress(
    `Pre-fetching ${vuCount} tokens (max ${maxPerMinute}/min/IP — kan ta ${Math.ceil(vuCount / maxPerMinute)} min)`,
  );
  const tokens = cached ?? new Map();
  const startMs = Date.now();
  let firstFailure = null;

  // Parallell-batches på maxPerMinute for å maksimere throughput innen taket
  const batchSize = maxPerMinute;
  for (let i = 1; i <= vuCount; i += batchSize) {
    // Skip hvis allerede cached
    const needed = [];
    for (let j = 0; j < batchSize && i + j <= vuCount; j++) {
      const vuId = i + j;
      if (!tokens.has(vuId)) needed.push(vuId);
    }

    if (needed.length === 0) continue;

    const batch = needed.map((vuId) => {
      const email = `${PLAYER_PREFIX}${vuId}${PLAYER_DOMAIN}`;
      return login(email, PLAYER_PASSWORD)
        .then((token) => tokens.set(vuId, token))
        .catch((err) => {
          if (!firstFailure) firstFailure = err;
          collector.addCounter("loginsPrefetchFailed");
        });
    });
    await Promise.allSettled(batch);

    // Cache underveis hvert 100 token, så vi ikke mister state ved Ctrl-C
    if (i % 100 === 1) saveCachedTokens(tokens);

    // Vent for å holde 4/min-takt
    const elapsedInWindow = Date.now() - startMs;
    const expectedAt = ((i - 1 + batchSize) / maxPerMinute) * 60_000;
    const wait = Math.max(0, expectedAt - elapsedInWindow);
    if (wait > 0 && i + batchSize <= vuCount) {
      await sleep(wait);
    }

    if (i % (batchSize * 10) === 1 || i + batchSize > vuCount) {
      logProgress(
        `  ${tokens.size}/${vuCount} tokens (${Math.round((Date.now() - startMs) / 1000)}s)`,
      );
    }
  }

  // Final cache
  saveCachedTokens(tokens);

  if (tokens.size < vuCount * 0.95) {
    logProgress(
      `[WARN] Bare ${tokens.size}/${vuCount} tokens hentet (${Math.round((tokens.size / vuCount) * 100)}%)`,
    );
    if (firstFailure) {
      logProgress(`[WARN] First failure: ${firstFailure.message}`);
    }
  }
  return tokens;
}

// ── Hovedløkke ──────────────────────────────────────────────────────────────
async function main() {
  logProgress(`Starter R4 load-test (scenario=${SCENARIO}, vu=${VU_COUNT})`);
  logProgress(`Backend URL: ${BACKEND_URL}`);
  logProgress(`Target: hall=${TARGET_HALL} room=${TARGET_ROOM}`);
  logProgress(
    `Phases: ramp-up ${RAMP_UP_S}s → hold ${HOLD_MINUTES}min → ramp-down ${RAMP_DOWN_S}s`,
  );

  // ── Pre-flight: backend health ────────────────────────────────────────────
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      logProgress(`[FAIL] Backend health http ${res.status} — abort`);
      process.exit(2);
    }
  } catch (err) {
    logProgress(`[FAIL] Backend health unreachable: ${err.message} — abort`);
    process.exit(2);
  }
  logProgress("[OK] Backend health green");

  // ── Pre-fetch tokens ──────────────────────────────────────────────────────
  // Hopp over hvis vi kun har < 5 VUs (under rate-limit-taket på 5/min/IP)
  let prefetchedTokens = null;
  if (VU_COUNT >= 5 && process.env.SKIP_PREFETCH_TOKENS !== "1") {
    // Default 3/min = trygg under 5/min/IP-tak. Override med
    // PREFETCH_RATE for staging hvor rate-limit er disabled.
    const prefetchRate = Number(process.env.PREFETCH_RATE_PER_MIN ?? "3");
    prefetchedTokens = await prefetchAllTokens(VU_COUNT, prefetchRate);
    if (prefetchedTokens.size === 0) {
      logProgress("[FAIL] Ingen tokens hentet — abort");
      process.exit(2);
    }
  }

  // ── Time-series sampler (kjører hvert 30. sekund) ─────────────────────────
  const samplerInterval = setInterval(() => {
    collector.addGauge("vusActive", vuStates.size);
    collector.addGauge(
      "vusInPhaseHold",
      [...vuStates.values()].filter((s) => s.phase === "hold").length,
    );
    collector.recordTimeSeriesPoint();
  }, (config.metricsSamplingSeconds ?? 30) * 1000);

  // ── Ramp-up: spawne VUs gradvis ───────────────────────────────────────────
  const vuPromises = [];
  const holdMs = HOLD_MINUTES * 60_000;
  // Hver VU kjører i: holdMs + delay-justering så ramp-up VU 1 og siste VU
  // får ~samme totale "i rommet"-tid.
  const spacingMs = (RAMP_UP_S * 1000) / Math.max(VU_COUNT, 1);

  logProgress(`Ramp-up start: spawner ${VU_COUNT} VUs over ${RAMP_UP_S}s`);

  for (let vuId = 1; vuId <= VU_COUNT; vuId++) {
    const delay = (vuId - 1) * spacingMs;
    const token = prefetchedTokens?.get(vuId) ?? null;
    const vuPromise = (async () => {
      await sleep(delay);
      try {
        await runVU(vuId, holdMs, token);
      } catch (err) {
        collector.addCounter("vuFatalErrors");
        process.stderr.write(`[r4 vu=${vuId}] fatal: ${err.message}\n`);
      } finally {
        vuStates.delete(vuId);
      }
    })();
    vuPromises.push(vuPromise);
  }

  // ── Wait for ramp-up to complete + hold ───────────────────────────────────
  await sleep(RAMP_UP_S * 1000);
  logProgress(`Ramp-up done. Holding for ${HOLD_MINUTES} min...`);

  const holdTotalMs = HOLD_MINUTES * 60_000;
  const reportInterval = Math.min(60_000, holdTotalMs / 4);
  let elapsed = 0;
  while (elapsed < holdTotalMs) {
    await sleep(Math.min(reportInterval, holdTotalMs - elapsed));
    elapsed += reportInterval;
    const snap = collector.getSnapshot();
    const activeVus = vuStates.size;
    const p95 = snap.latencies?.socketRoundtrip?.p95 ?? "-";
    const p99 = snap.latencies?.socketRoundtrip?.p99 ?? "-";
    logProgress(
      `Active VUs: ${activeVus}/${VU_COUNT} | socket p95/p99 = ${p95}/${p99}ms | marks: ${snap.counters?.ticketMarksSuccessful ?? 0}`,
    );
  }

  logProgress(`Hold done. Waiting for VUs to finish naturally...`);

  // ── Wait for all VUs to wrap up (Promise.allSettled to handle errors) ─────
  const results = await Promise.allSettled(vuPromises);
  clearInterval(samplerInterval);

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  collector.addGauge("vusCompleted", succeeded);
  collector.addGauge("vusFailed", failed);

  logProgress(
    `[DONE] All VUs finished. ${succeeded}/${results.length} completed, ${failed} failed.`,
  );

  // ── Export results ────────────────────────────────────────────────────────
  const reportPath = path.join(
    OUTPUT_DIR,
    `r4-${SCENARIO}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const report = collector.exportToFile(reportPath);
  logProgress(`Report: ${reportPath}`);

  // ── Console summary ───────────────────────────────────────────────────────
  process.stdout.write("\n" + summarizeForConsole(report) + "\n\n");

  // ── SLA-check ─────────────────────────────────────────────────────────────
  const slaCheck = collector.checkSla(SLA);
  if (slaCheck.pass) {
    logProgress("[PASS] All SLA tresholds met");
    process.exit(0);
  } else {
    logProgress(`[FAIL] SLA violations:`);
    for (const v of slaCheck.violations) {
      process.stderr.write(`  - ${v}\n`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[r4] fatal: ${err.stack ?? err.message}\n`);
  process.exit(3);
});
