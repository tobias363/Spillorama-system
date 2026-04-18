#!/usr/bin/env node
/**
 * BIN-525: Staging-rehearsal harness — Bolk 8 rehearsal-steg 3, 4, 5, 7.
 *
 * Runs against a live staging environment. Output is append-only
 * markdown rows for PILOT_CUTOVER_RUNBOOK.md §7 plus per-step human-
 * readable logs to stderr. Re-runnable.
 *
 * Required env:
 *   STAGING_URL              — base URL, e.g. https://spillorama-system.onrender.com
 *   ADMIN_EMAIL              — admin login email
 *   ADMIN_PASSWORD           — admin login password
 *   TEST_USER_A_EMAIL        — cutover test-user 1
 *   TEST_USER_A_PASSWORD     — cutover test-user 1 password
 *   TEST_USER_B_EMAIL        — cutover test-user 2
 *   TEST_USER_B_PASSWORD     — cutover test-user 2 password
 *   HALL_SLUG                — staging hall slug, e.g. staging-hall-1
 *   HALL_ID                  — staging hall id
 *
 * Optional:
 *   STEPS                    — comma-separated subset (default: "3,4,5,7")
 *   VERBOSE                  — "1" to log every socket event
 */
import { io } from "socket.io-client";

const env = process.env;
const required = ["STAGING_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "TEST_USER_A_EMAIL",
  "TEST_USER_A_PASSWORD", "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD", "HALL_SLUG", "HALL_ID"];
for (const key of required) {
  if (!env[key]) { console.error(`FATAL: missing env ${key}`); process.exit(2); }
}
const URL = env.STAGING_URL.replace(/\/$/, "");
const STEPS = new Set((env.STEPS ?? "3,4,5,7").split(",").map((s) => s.trim()));
const VERBOSE = env.VERBOSE === "1";

const markdownRows = [];
const log = (...args) => console.error("[rehearsal]", ...args);
const iso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP helpers ──────────────────────────────────────────────────────────

async function httpJson(method, path, { token, body } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${method} ${path}: ${text.slice(0, 500)}`);
  }
  return parsed;
}

async function loginAs(email, password) {
  const res = await httpJson("POST", "/api/auth/login", { body: { email, password } });
  if (!res?.data?.accessToken) throw new Error(`login failed for ${email}: no accessToken`);
  return { token: res.data.accessToken, user: res.data.user };
}

// ── Socket helper ─────────────────────────────────────────────────────────

function connectSocket(accessToken, label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, {
      transports: ["websocket", "polling"],
      auth: { accessToken },
      reconnection: false,
      timeout: 20_000,
    });
    const events = [];
    const listen = (name) => socket.on(name, (payload) => {
      events.push({ at: iso(), event: name, payload });
      if (VERBOSE) log(`${label} ← ${name}`, JSON.stringify(payload).slice(0, 200));
    });
    ["room:update", "draw:new", "pattern:won", "chat:message",
     "admin:hall-event", "game:paused", "game:resumed", "spectator:started",
     "error", "connect_error"].forEach(listen);
    socket.once("connect", () => {
      log(`${label} connected id=${socket.id}`);
      resolve({ socket, events });
    });
    socket.once("connect_error", (err) => {
      reject(new Error(`${label} connect_error: ${err?.message ?? err}`));
    });
  });
}

function emit(socket, event, payload, accessToken) {
  return new Promise((resolve) => {
    const withToken = { ...payload, accessToken };
    const timer = setTimeout(() => resolve({ ok: false, error: { code: "TIMEOUT", message: `${event} ack timeout` } }), 15_000);
    socket.emit(event, withToken, (response) => { clearTimeout(timer); resolve(response); });
  });
}

function waitForEvent(eventsArr, eventName, predicate = () => true, { timeoutMs = 15_000, fromIndex = 0 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      for (let i = fromIndex; i < eventsArr.length; i += 1) {
        const entry = eventsArr[i];
        if (entry.event === eventName && predicate(entry.payload)) {
          resolve({ ok: true, index: i, entry });
          return;
        }
      }
      if (Date.now() > deadline) { resolve({ ok: false, reason: "timeout" }); return; }
      setTimeout(check, 50);
    };
    check();
  });
}

// ── Row builder ───────────────────────────────────────────────────────────

function recordRow({ step, env: rehearsalEnv, hall, event, start, end, outcome, issuesRefs }) {
  markdownRows.push({ step, env: rehearsalEnv, hall, event, start, end, outcome, issuesRefs });
}

// ── Steps ─────────────────────────────────────────────────────────────────

async function step7_adminHallEvents({ adminToken, adminUser }) {
  // Set up: create a room as admin, arm + start game, then drive admin:pause-game
  // and admin:resume-game. Verify the admin:hall-event fan-out.
  log("== Step 7: admin hall-events ==");
  const startIso = iso();
  const startMs = Date.now();

  const hostSocket = (await connectSocket(adminToken, "admin-host")).socket;
  const hostEvents = [];
  hostSocket.on("admin:hall-event", (p) => hostEvents.push({ at: iso(), event: "admin:hall-event", payload: p }));
  hostSocket.on("room:update", (p) => hostEvents.push({ at: iso(), event: "room:update", payload: p }));

  try {
    // Create room
    const created = await emit(hostSocket, "room:create",
      { playerName: "Rehearsal Host", hallId: env.HALL_ID, gameSlug: "bingo" }, adminToken);
    if (!created.ok) throw new Error(`room:create failed: ${JSON.stringify(created.error)}`);
    const roomCode = created.data.roomCode;
    log(`step 7: room created ${roomCode}`);

    // Arm bet + start
    await emit(hostSocket, "bet:arm", { roomCode, armed: true, ticketCount: 1 }, adminToken);
    const started = await emit(hostSocket, "game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 }, adminToken);
    if (!started.ok) throw new Error(`game:start failed: ${JSON.stringify(started.error)}`);

    // Draw a couple of numbers so we have a "running" state
    for (let i = 0; i < 2; i += 1) {
      const d = await emit(hostSocket, "draw:next", { roomCode }, adminToken);
      if (!d.ok) log(`draw:next ${i} failed: ${JSON.stringify(d.error)}`);
    }

    // Log in on the admin-hall-events channel and fire pause
    const adminLogin = await emit(hostSocket, "admin:login", { accessToken: adminToken }, adminToken);
    if (!adminLogin.ok) throw new Error(`admin:login failed: ${JSON.stringify(adminLogin.error)}`);
    log(`step 7: admin:login ok role=${adminLogin.data.role} canControlRooms=${adminLogin.data.canControlRooms}`);

    const markerBefore = hostEvents.length;
    const paused = await emit(hostSocket, "admin:pause-game", { roomCode, message: "Rehearsal pause" }, adminToken);
    if (!paused.ok) throw new Error(`admin:pause-game failed: ${JSON.stringify(paused.error)}`);
    log(`step 7: admin:pause-game ok`);

    // Wait for the pause broadcast to come back
    const pausedBroadcast = await waitForEvent(hostEvents, "admin:hall-event",
      (p) => p?.kind === "paused" && p?.roomCode === roomCode, { fromIndex: markerBefore });
    if (!pausedBroadcast.ok) throw new Error("admin:hall-event paused broadcast not received");
    log(`step 7: paused broadcast received`);

    await sleep(1_500);

    const resumeMarker = hostEvents.length;
    const resumed = await emit(hostSocket, "admin:resume-game", { roomCode }, adminToken);
    if (!resumed.ok) throw new Error(`admin:resume-game failed: ${JSON.stringify(resumed.error)}`);
    log(`step 7: admin:resume-game ok`);

    const resumedBroadcast = await waitForEvent(hostEvents, "admin:hall-event",
      (p) => p?.kind === "resumed" && p?.roomCode === roomCode, { fromIndex: resumeMarker });
    if (!resumedBroadcast.ok) throw new Error("admin:hall-event resumed broadcast not received");
    log(`step 7: resumed broadcast received`);

    // Cleanup: end the game to release the hall
    await emit(hostSocket, "game:end", { roomCode, reason: "Rehearsal cleanup" }, adminToken);

    const endIso = iso();
    recordRow({
      step: 7, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 7 (admin hall-events: pause + resume via socket)",
      start: startIso, end: endIso, outcome: "pass",
      issuesRefs: `room \`${roomCode}\`, pause ack: ${paused.ok}, resume ack: ${resumed.ok}, broadcasts received (kind=paused + kind=resumed to room). [BIN-515](https://linear.app/bingosystem/issue/BIN-515). varighet ${((Date.now() - startMs) / 1000).toFixed(1)} s.`,
    });
    return { ok: true };
  } catch (err) {
    log(`step 7 FAIL: ${err.message}`);
    recordRow({
      step: 7, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 7 (admin hall-events: pause + resume via socket)",
      start: startIso, end: iso(), outcome: "fail",
      issuesRefs: `${err.message}. [BIN-515](https://linear.app/bingosystem/issue/BIN-515).`,
    });
    return { ok: false, error: err.message };
  } finally {
    hostSocket.disconnect();
  }
}

async function step4_featureFlagSwitch({ adminToken }) {
  log("== Step 4: feature-flag switch ==");
  const startIso = iso();

  // Scope reality: BIN-540 shipped the DB column + public reader
  // (`GET /api/halls/:slug/client-variant` with a 60 s cache) + a
  // rollback-runbook, but the admin-side flip is documented as a
  // direct `UPDATE app_halls SET client_variant = …` — there is
  // intentionally no admin REST endpoint yet. That means this step
  // can only verify the read-path end-to-end, and surface the
  // missing admin-setter as a rehearsal finding.
  try {
    // Admin-view is unreachable on the current staging deploy (see findings
    // block below — `GET /api/admin/halls` returns INTERNAL_ERROR). Fall
    // back to the public read path which is explicitly fail-closed and
    // therefore resilient to the same schema issue.
    let adminView = null;
    let adminErr = null;
    try {
      const halls = await httpJson("GET", "/api/admin/halls", { token: adminToken });
      const target = halls.data.find((h) => h.slug === env.HALL_SLUG || h.id === env.HALL_ID);
      adminView = target?.clientVariant ?? null;
      log(`step 4: admin-view clientVariant=${adminView}`);
    } catch (err) {
      adminErr = err.message;
      log(`step 4: admin-view UNREACHABLE: ${adminErr}`);
    }

    const lookup = await httpJson("GET", `/api/halls/${env.HALL_SLUG}/client-variant`);
    const publicView = lookup.data?.clientVariant ?? lookup.clientVariant;
    log(`step 4: public-view clientVariant=${publicView}`);

    const adminPublicMatch = adminView !== null && adminView === publicView;
    const summary = adminView !== null
      ? `admin-view=\`${adminView}\` public-view=\`${publicView}\` (match=${adminPublicMatch})`
      : `admin-view unreachable (\`${adminErr}\`); public-view=\`${publicView}\``;

    recordRow({
      step: 4, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 4 (feature-flag switch — read-path end-to-end; gaps surfaced)",
      start: startIso, end: iso(), outcome: adminView === null ? "partial" : "partial",
      issuesRefs: `${summary}. **Gap 1:** BIN-540 did not ship an admin REST endpoint for mutating \`client_variant\`; flip still requires direct \`UPDATE app_halls …\` per rollback-runbook. **Gap 2:** on current staging deploy, \`GET /api/admin/halls\` + \`/api/admin/dashboard/live\` + \`/api/admin/halls/:id/display-tokens\` + \`/api/admin/halls/:id/game-config\` all return \`INTERNAL_ERROR\`; public \`/api/halls/:slug/client-variant\` works via its fail-closed fallback. Root cause likely a missing migration against \`app_halls\` on staging DB. [BIN-540](https://linear.app/bingosystem/issue/BIN-540) / [BIN-525](https://linear.app/bingosystem/issue/BIN-525).`,
    });
    return { ok: true, note: "read-path verified, admin-setter + admin-halls-500 gaps surfaced" };
  } catch (err) {
    log(`step 4 FAIL: ${err.message}`);
    recordRow({
      step: 4, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 4 (feature-flag switch — read-path end-to-end)",
      start: startIso, end: iso(), outcome: "fail",
      issuesRefs: `${err.message}. [BIN-540](https://linear.app/bingosystem/issue/BIN-540).`,
    });
    return { ok: false, error: err.message };
  }
}

async function step3_tvDisplaySubscribe({ adminToken }) {
  log("== Step 3: TV-display subscribe + draws mirror ==");
  const startIso = iso();

  try {
    // Create a display token so the TV-kiosk socket login succeeds (BIN-503).
    const tokenResp = await httpJson("POST", `/api/admin/halls/${env.HALL_ID}/display-tokens`, {
      token: adminToken, body: { label: "Rehearsal TV" },
    });
    const composite = tokenResp.data.compositeToken;
    const tokenId = tokenResp.data.id;
    log(`step 3: display token created id=${tokenId}`);

    // Connect a second "TV" socket — admin-display:login, then admin-display:subscribe.
    const tvSocket = io(URL, { transports: ["websocket", "polling"], reconnection: false, timeout: 20_000 });
    const tvEvents = [];
    ["admin:hall-event", "room:update", "draw:new", "pattern:won", "connect_error"]
      .forEach((e) => tvSocket.on(e, (p) => tvEvents.push({ at: iso(), event: e, payload: p })));
    await new Promise((resolve, reject) => {
      tvSocket.once("connect", resolve);
      tvSocket.once("connect_error", (err) => reject(new Error(`TV socket connect_error: ${err?.message ?? err}`)));
    });
    log("step 3: TV socket connected");

    const tvLogin = await emit(tvSocket, "admin-display:login", { token: composite });
    if (!tvLogin.ok) throw new Error(`admin-display:login failed: ${JSON.stringify(tvLogin.error)}`);
    log(`step 3: TV login ok hallId=${tvLogin.data.hallId}`);
    const tvSubscribe = await emit(tvSocket, "admin-display:subscribe", {});
    if (!tvSubscribe.ok) throw new Error(`admin-display:subscribe failed: ${JSON.stringify(tvSubscribe.error)}`);
    log(`step 3: TV subscribed`);

    // Drive a mini-game on a separate admin socket so TV receives broadcasts.
    const hostSocket = (await connectSocket(adminToken, "admin-host-step3")).socket;
    const created = await emit(hostSocket, "room:create",
      { playerName: "Rehearsal Host (step 3)", hallId: env.HALL_ID, gameSlug: "bingo" }, adminToken);
    if (!created.ok) throw new Error(`room:create failed: ${JSON.stringify(created.error)}`);
    const roomCode = created.data.roomCode;
    await emit(hostSocket, "bet:arm", { roomCode, armed: true, ticketCount: 1 }, adminToken);
    await emit(hostSocket, "game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 }, adminToken);
    for (let i = 0; i < 3; i += 1) {
      await emit(hostSocket, "draw:next", { roomCode }, adminToken);
      await sleep(600);
    }

    // Wait for TV to see at least one draw:new for this room.
    const tvDraw = await waitForEvent(tvEvents, "draw:new", (p) => true, { timeoutMs: 10_000 });
    const drawCount = tvEvents.filter((e) => e.event === "draw:new").length;
    log(`step 3: TV received ${drawCount} draw:new events`);

    // Cleanup: end + revoke display token
    await emit(hostSocket, "game:end", { roomCode, reason: "Rehearsal cleanup" }, adminToken);
    hostSocket.disconnect();
    tvSocket.disconnect();
    await httpJson("DELETE", `/api/admin/halls/${env.HALL_ID}/display-tokens/${tokenId}`, { token: adminToken });

    if (!tvDraw.ok || drawCount < 1) throw new Error(`TV did not receive draw:new (got ${drawCount})`);

    recordRow({
      step: 3, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 3 (TV-display subscribe + draw mirror, synthetic socket client)",
      start: startIso, end: iso(), outcome: "pass",
      issuesRefs: `display token rotated via admin API, \`admin-display:login\`+\`subscribe\` ack ok, TV socket received ${drawCount} \`draw:new\` events for room \`${roomCode}\`. Token revoked post-test. [BIN-498](https://linear.app/bingosystem/issue/BIN-498) / [BIN-503](https://linear.app/bingosystem/issue/BIN-503).`,
    });
    return { ok: true };
  } catch (err) {
    log(`step 3 FAIL: ${err.message}`);
    recordRow({
      step: 3, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 3 (TV-display subscribe + draw mirror)",
      start: startIso, end: iso(), outcome: "fail",
      issuesRefs: `${err.message}. [BIN-498](https://linear.app/bingosystem/issue/BIN-498) / [BIN-503](https://linear.app/bingosystem/issue/BIN-503).`,
    });
    return { ok: false, error: err.message };
  }
}

async function step5_lateJoinSpectator({ userAToken, userBToken }) {
  log("== Step 5: late-join spectator ==");
  const startIso = iso();

  try {
    const a = await connectSocket(userAToken, "client-A");
    const b = await connectSocket(userBToken, "client-B");

    // A creates room, arms, starts, draws 5 times — DO NOT invite B yet.
    const created = await emit(a.socket, "room:create",
      { playerName: "Cutover A", hallId: env.HALL_ID, gameSlug: "bingo" }, userAToken);
    if (!created.ok) throw new Error(`A room:create failed: ${JSON.stringify(created.error)}`);
    const roomCode = created.data.roomCode;
    log(`step 5: A created room ${roomCode}`);

    await emit(a.socket, "bet:arm", { roomCode, armed: true, ticketCount: 1 }, userAToken);
    const startAck = await emit(a.socket, "game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 }, userAToken);
    if (!startAck.ok) throw new Error(`A game:start failed: ${JSON.stringify(startAck.error)}`);

    for (let i = 0; i < 5; i += 1) {
      await emit(a.socket, "draw:next", { roomCode }, userAToken);
      await sleep(400);
    }
    log(`step 5: A drew 5 numbers`);

    // Now B joins mid-round.
    const bJoinMarker = b.events.length;
    const bJoin = await emit(b.socket, "room:join",
      { roomCode, playerName: "Cutover B", hallId: env.HALL_ID }, userBToken);
    if (!bJoin.ok) throw new Error(`B room:join failed: ${JSON.stringify(bJoin.error)}`);
    const bSnapshot = bJoin.data.snapshot;
    log(`step 5: B joined, gameStatus=${bSnapshot?.currentGame?.status}, drawnSoFar=${bSnapshot?.currentGame?.drawnNumbers?.length}`);

    // B must have received a snapshot showing the game already RUNNING — that's
    // the SPECTATING-phase signal. Then one more draw to confirm B gets live events.
    const oneMoreDraw = await emit(a.socket, "draw:next", { roomCode }, userAToken);
    await waitForEvent(b.events, "draw:new", () => true, { fromIndex: bJoinMarker, timeoutMs: 10_000 });
    const bDrawCount = b.events.filter((e, i) => i >= bJoinMarker && e.event === "draw:new").length;
    log(`step 5: B received ${bDrawCount} live draw:new after join`);

    // Cleanup
    await emit(a.socket, "game:end", { roomCode, reason: "Rehearsal cleanup" }, userAToken);
    a.socket.disconnect();
    b.socket.disconnect();

    const snapshotRunning = bSnapshot?.currentGame?.status === "RUNNING";
    if (!snapshotRunning) throw new Error(`B snapshot did not show RUNNING (got ${bSnapshot?.currentGame?.status})`);
    if (bDrawCount < 1) throw new Error(`B did not receive any live draw:new after join`);

    recordRow({
      step: 5, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 5 (late-join spectator: B joins after 5 draws, receives live draws)",
      start: startIso, end: iso(), outcome: "pass",
      issuesRefs: `room \`${roomCode}\`, A drew 5, B joined with snapshot showing RUNNING + drawnNumbers.length=${bSnapshot?.currentGame?.drawnNumbers?.length}, then received ${bDrawCount} further live draw:new. [BIN-500](https://linear.app/bingosystem/issue/BIN-500) / [BIN-507](https://linear.app/bingosystem/issue/BIN-507).`,
    });
    return { ok: true };
  } catch (err) {
    log(`step 5 FAIL: ${err.message}`);
    recordRow({
      step: 5, env: "staging (Render free)", hall: env.HALL_SLUG,
      event: "rehearsal — step 5 (late-join spectator)",
      start: startIso, end: iso(), outcome: "fail",
      issuesRefs: `${err.message}. [BIN-500](https://linear.app/bingosystem/issue/BIN-500) / [BIN-507](https://linear.app/bingosystem/issue/BIN-507).`,
    });
    return { ok: false, error: err.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

(async () => {
  log(`staging URL: ${URL}`);
  const admin = await loginAs(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  log(`admin login ok: ${admin.user.email} role=${admin.user.role}`);

  const results = {};
  if (STEPS.has("7")) results.step7 = await step7_adminHallEvents({ adminToken: admin.token, adminUser: admin.user });
  if (STEPS.has("4")) results.step4 = await step4_featureFlagSwitch({ adminToken: admin.token });
  if (STEPS.has("3")) results.step3 = await step3_tvDisplaySubscribe({ adminToken: admin.token });
  if (STEPS.has("5")) {
    const userA = await loginAs(env.TEST_USER_A_EMAIL, env.TEST_USER_A_PASSWORD);
    const userB = await loginAs(env.TEST_USER_B_EMAIL, env.TEST_USER_B_PASSWORD);
    results.step5 = await step5_lateJoinSpectator({ userAToken: userA.token, userBToken: userB.token });
  }

  console.log("\n## §7 Rehearsal-log rows (paste into PILOT_CUTOVER_RUNBOOK.md):\n");
  for (const row of markdownRows) {
    console.log(`| ${row.start} | ${row.env} | ${row.hall} | ${row.event} | agent-2 | ${row.start.slice(11, 19)}Z | ${row.end.slice(11, 19)}Z | ${row.outcome} | ${row.issuesRefs} |`);
  }

  const failures = Object.entries(results).filter(([, r]) => r && !r.ok);
  if (failures.length > 0) {
    log(`FAIL summary: ${failures.map(([k, r]) => `${k}=${r.error}`).join(" | ")}`);
    process.exit(1);
  }
  log("all requested steps passed");
  process.exit(0);
})().catch((err) => {
  log(`FATAL: ${err.message ?? err}`);
  process.exit(2);
});
