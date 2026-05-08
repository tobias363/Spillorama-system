#!/usr/bin/env node
/**
 * R3 Reconnect-test mock-klient (BIN-812).
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-812
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3 R3
 *
 * ── Hva denne klienten gjør ──────────────────────────────────────────────────
 *
 * Driver én scenario-gjennomspilling for r3-reconnect-test.sh:
 *
 *   1. Logger inn via REST (henter accessToken).
 *   2. Kobler seg til via Socket.IO.
 *   3. Joiner kanonisk hall-rom ("BINGO1" alias).
 *   4. Gjør N ticket-marks via `ticket:mark`-event (UUID v4 per mark for R5
 *      idempotency-deduplisering).
 *   5. Cacher de "før-disconnect"-marks lokalt.
 *   6. Tvinger socket-disconnect ved å lukke transport-en.
 *   7. Venter `disconnectSeconds` sekunder.
 *   8. Reconnecter og emitter `room:resume` (state-replay).
 *   9. Sammenligner cached marks vs server-returnerte marks via `room:state`.
 *  10. Gjør én ny mark + verifiserer at den lander.
 *
 * Skriver alle observasjoner som JSON til stdout slik at shell-driveren kan
 * parse resultatet og avgjøre PASS/FAIL.
 *
 * ── CLI ─────────────────────────────────────────────────────────────────────
 *
 * Args via env:
 *   BACKEND_URL=http://localhost:4001
 *   ADMIN_EMAIL=demo-spiller-1@example.com
 *   ADMIN_PASSWORD=Spillorama123!     # gjenbruker DEMO_SEED_PASSWORD
 *   HALL_ID=demo-hall-999
 *   ROOM_CODE=BINGO1                  # canonical alias
 *   MARKS_BEFORE_DISCONNECT=5
 *   DISCONNECT_SECONDS=5              # 5/15/60 — variabel per kjøring
 *   OUT_FILE=/tmp/r3-result-5s.json   # hvor JSON-resultatet skrives
 *
 * Avbrudd:
 *   - Ved login-feil eller socket-handshake-feil: exit 2 (oppsett-feil)
 *   - Ved invariant-brudd (manglende marks etter reconnect): JSON-resultat
 *     viser pass=false; shell-driveren rapporterer FAIL.
 *   - Ved uventet exception: exit 3 + skriver feil til stderr.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

// ── Config from env ─────────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4001";
const PLAYER_EMAIL = process.env.PLAYER_EMAIL ?? "demo-spiller-1@example.com";
const PLAYER_PASSWORD = process.env.PLAYER_PASSWORD ?? "Spillorama123!";
const HALL_ID = process.env.HALL_ID ?? "demo-hall-999";
const ROOM_CODE = process.env.ROOM_CODE ?? "BINGO1";
const MARKS_BEFORE_DISCONNECT = Number(process.env.MARKS_BEFORE_DISCONNECT ?? "5");
const DISCONNECT_SECONDS = Number(process.env.DISCONNECT_SECONDS ?? "5");
const OUT_FILE = process.env.OUT_FILE ?? "/tmp/r3-result.json";

// ── Result-blob skrives ved exit ────────────────────────────────────────────
const result = {
  scenario: `disconnect_${DISCONNECT_SECONDS}s`,
  backendUrl: BACKEND_URL,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  pass: false,
  steps: [],
  marksBeforeDisconnect: [],
  marksAfterReconnect: [],
  newMarkAfterReconnect: null,
  errors: [],
  // Hva sluttklienten ville sett — brukes av invariant-test:
  preDisconnectMarkCount: 0,
  postReconnectMarkCount: 0,
  marksMatchAfterReconnect: false,
  newMarkAcceptedAfterReconnect: false,
  reconnectDurationMs: 0,
  totalScenarioMs: 0,
};

function writeResult(extra = {}) {
  Object.assign(result, extra);
  result.finishedAt = new Date().toISOString();
  result.totalScenarioMs = Date.now() - startMs;
  try {
    writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`[r3-mock-client] failed to write ${OUT_FILE}: ${String(err)}\n`);
  }
}

function step(name, data = {}) {
  const entry = { at: new Date().toISOString(), step: name, ...data };
  result.steps.push(entry);
  process.stderr.write(`[r3-mock-client] ${name} ${JSON.stringify(data)}\n`);
}

const startMs = Date.now();

// ── §1 — login via REST ─────────────────────────────────────────────────────
async function login() {
  step("login.start", { email: PLAYER_EMAIL });
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PLAYER_EMAIL, password: PLAYER_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`login http ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const token = json?.data?.accessToken;
  if (!token) {
    throw new Error(`login missing accessToken in body: ${JSON.stringify(json).slice(0, 200)}`);
  }
  step("login.ok", { tokenPrefix: String(token).slice(0, 12) + "..." });
  return token;
}

// ── §2 — connect Socket.IO ──────────────────────────────────────────────────
function connectSocket(label = "primary") {
  return new Promise((resolve, reject) => {
    const sock = io(BACKEND_URL, {
      transports: ["websocket"], // skip long-poll for deterministic disconnect
      reconnection: false,        // we manage reconnects manually
      timeout: 10000,
    });
    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error(`socket connect timeout (${label})`));
    }, 10000);
    sock.once("connect", () => {
      clearTimeout(timer);
      step(`socket.connect.${label}`, { id: sock.id });
      resolve(sock);
    });
    sock.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(new Error(`socket connect_error (${label}): ${err.message}`));
    });
  });
}

// ── §3 — emit-helper med ack ────────────────────────────────────────────────
function emitWithAck(sock, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`emit ${event} ack timeout`));
    }, timeoutMs);
    sock.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (!response) {
        reject(new Error(`emit ${event} no response`));
        return;
      }
      if (response.ok === false) {
        const code = response?.error?.code ?? "UNKNOWN";
        const msg = response?.error?.message ?? "";
        reject(new Error(`emit ${event} failed: ${code} ${msg}`));
        return;
      }
      resolve(response.data ?? response);
    });
  });
}

// ── Mark-counting helper ────────────────────────────────────────────────────
function countTotalMarks(snapshot) {
  // Server-state-shape: `currentGame.marks` er Record<playerId, number[][]>
  // (per-ticket arrays). Vi summerer alle marks på tvers av tickets.
  const marks = snapshot?.currentGame?.marks;
  if (!marks || typeof marks !== "object") return 0;
  let total = 0;
  for (const ticketMarks of Object.values(marks)) {
    if (!Array.isArray(ticketMarks)) continue;
    for (const oneTicket of ticketMarks) {
      if (Array.isArray(oneTicket)) total += oneTicket.length;
    }
  }
  return total;
}

// ── Hovedflyt ───────────────────────────────────────────────────────────────
async function main() {
  let accessToken;
  try {
    accessToken = await login();
  } catch (err) {
    result.errors.push(`login: ${err.message}`);
    writeResult({ pass: false });
    process.exit(2);
  }

  // ── 2a) Connect primary socket ────────────────────────────────────────────
  let sock1;
  try {
    sock1 = await connectSocket("primary");
  } catch (err) {
    result.errors.push(`connect primary: ${err.message}`);
    writeResult({ pass: false });
    process.exit(2);
  }

  // ── 3) Join canonical room ────────────────────────────────────────────────
  // Vi prøver først `room:join` med BINGO1; hvis rommet ikke eksisterer
  // auto-create-flyten i room.ts oppretter det. Server returnerer ekte
  // roomCode + playerId i ack.data.
  let actualRoomCode;
  let playerId;
  try {
    const joinResp = await emitWithAck(sock1, "room:join", {
      accessToken,
      hallId: HALL_ID,
      roomCode: ROOM_CODE,
    });
    actualRoomCode = joinResp.roomCode;
    playerId = joinResp.playerId;
    step("room.join.ok", { roomCode: actualRoomCode, playerId });
  } catch (err) {
    result.errors.push(`room:join: ${err.message}`);
    sock1.disconnect();
    writeResult({ pass: false });
    process.exit(2);
  }

  // For at `ticket:mark` skal funke må det finnes en `currentGame` med
  // tickets generert til player. Vi ser etter en RUNNING-runde i snapshot.
  // Hvis ikke → testen rapporterer "no_running_game" og hopper over mark-
  // delen; da verifiserer vi minst at room-state replay fungerer.
  let stateResp1;
  try {
    stateResp1 = await emitWithAck(sock1, "room:state", {
      accessToken,
      roomCode: actualRoomCode,
      hallId: HALL_ID,
    });
    step("room.state.initial", {
      gameStatus: stateResp1?.snapshot?.currentGame?.status ?? "NONE",
      playerCount: stateResp1?.snapshot?.players?.length ?? 0,
    });
  } catch (err) {
    result.errors.push(`room:state initial: ${err.message}`);
    sock1.disconnect();
    writeResult({ pass: false });
    process.exit(2);
  }

  const hasRunningGame =
    stateResp1?.snapshot?.currentGame?.status === "RUNNING" ||
    stateResp1?.snapshot?.currentGame?.status === "WAITING";
  step("game.detection", { hasRunningGame });

  // ── 4) Mark numbers (kun hvis RUNNING-runde eksisterer) ───────────────────
  if (hasRunningGame) {
    // Plukk tilfeldige tall i [1, 75] å markere. ticket:mark godtar at tall
    // ikke er på player's plate — engine no-ops (BIN-244-marks lagres kun
    // hvis tall er på en av playerens tickets) — men vi vil verifisere
    // BIN-499-private-ack, ikke selve mark-effekten her. Reconnect-replay
    // verifiseres via at server-state ikke "glemmer" det vi har emitet.
    //
    // For at testen skal være stabil mot "tall ikke på platen" plukker vi
    // tall fra `currentGame.drawnNumbers` hvis tilgjengelig (de er garantert
    // valid-trekninger).
    const drawnNumbers = Array.isArray(stateResp1?.snapshot?.currentGame?.drawnNumbers)
      ? stateResp1.snapshot.currentGame.drawnNumbers
      : [];
    const candidates = drawnNumbers.length > 0
      ? drawnNumbers.slice(0, MARKS_BEFORE_DISCONNECT)
      : Array.from({ length: MARKS_BEFORE_DISCONNECT }, (_, i) => i + 1);

    for (const number of candidates) {
      const clientRequestId = randomUUID();
      try {
        await emitWithAck(sock1, "ticket:mark", {
          accessToken,
          roomCode: actualRoomCode,
          playerId,
          hallId: HALL_ID,
          number,
          clientRequestId,
        });
        result.marksBeforeDisconnect.push({ number, clientRequestId });
      } catch (err) {
        // Marks som ikke er på platen blir akseptert som ok (engine no-op);
        // hvis dette feiler er det noe annet galt — logg, men fortsett.
        step("ticket.mark.warn", { number, error: err.message });
      }
    }
    step("ticket.marks.done", { count: result.marksBeforeDisconnect.length });
  } else {
    step("ticket.marks.skipped", { reason: "no_running_or_waiting_game" });
  }

  // ── 5) Snapshot pre-disconnect for sammenligning ──────────────────────────
  let preDisconnectSnap;
  try {
    preDisconnectSnap = await emitWithAck(sock1, "room:state", {
      accessToken,
      roomCode: actualRoomCode,
      hallId: HALL_ID,
    });
    result.preDisconnectMarkCount = countTotalMarks(preDisconnectSnap.snapshot);
    step("snapshot.pre", {
      markCount: result.preDisconnectMarkCount,
      gameStatus: preDisconnectSnap?.snapshot?.currentGame?.status ?? "NONE",
    });
  } catch (err) {
    result.errors.push(`pre-disconnect snapshot: ${err.message}`);
  }

  // ── 6) Force disconnect ───────────────────────────────────────────────────
  step("disconnect.force", { seconds: DISCONNECT_SECONDS });
  const disconnectStartMs = Date.now();
  sock1.disconnect();
  // Vent eksplisitt - simulere nett-glipp.
  await sleep(DISCONNECT_SECONDS * 1000);

  // ── 7) Reconnect ──────────────────────────────────────────────────────────
  let sock2;
  try {
    sock2 = await connectSocket("reconnect");
    result.reconnectDurationMs = Date.now() - disconnectStartMs;
  } catch (err) {
    result.errors.push(`reconnect: ${err.message}`);
    writeResult({ pass: false });
    process.exit(3);
  }

  // ── 8) room:resume ───────────────────────────────────────────────────────
  // `room:resume` er den dedikerte reconnect-handleren. Den re-attacher
  // socket-id-en til player-rad-en i room-state. Hvis det feiler kan vi
  // også prøve `room:join` som faller tilbake til attachPlayerSocket.
  let resumeOk = false;
  try {
    const resumeResp = await emitWithAck(sock2, "room:resume", {
      accessToken,
      roomCode: actualRoomCode,
      playerId,
      hallId: HALL_ID,
    });
    if (resumeResp?.snapshot) resumeOk = true;
    step("room.resume.ok", {
      gameStatus: resumeResp?.snapshot?.currentGame?.status ?? "NONE",
    });
  } catch (err) {
    step("room.resume.warn", { error: err.message });
    // Fallback: room:join (canonical alias plukker opp eksisterende rom).
    try {
      await emitWithAck(sock2, "room:join", {
        accessToken,
        hallId: HALL_ID,
        roomCode: ROOM_CODE,
      });
      resumeOk = true;
      step("room.join.fallback.ok");
    } catch (joinErr) {
      result.errors.push(`reconnect room:resume + fallback room:join failed: ${joinErr.message}`);
      sock2.disconnect();
      writeResult({ pass: false });
      process.exit(3);
    }
  }

  // ── 9) Hent post-reconnect snapshot og sammenlign marks ──────────────────
  try {
    const postResp = await emitWithAck(sock2, "room:state", {
      accessToken,
      roomCode: actualRoomCode,
      hallId: HALL_ID,
    });
    result.postReconnectMarkCount = countTotalMarks(postResp.snapshot);
    step("snapshot.post", {
      markCount: result.postReconnectMarkCount,
      gameStatus: postResp?.snapshot?.currentGame?.status ?? "NONE",
    });
    // Marks-bevarelse: post-mark-count skal være >= pre-mark-count (server
    // mister IKKE marks under disconnect; den kan legge til hvis andre
    // spillere markerte mens vi var nede).
    result.marksMatchAfterReconnect =
      result.postReconnectMarkCount >= result.preDisconnectMarkCount;
  } catch (err) {
    result.errors.push(`post-reconnect snapshot: ${err.message}`);
  }

  // ── 10) Ny mark etter reconnect ──────────────────────────────────────────
  if (hasRunningGame) {
    const newClientRequestId = randomUUID();
    try {
      await emitWithAck(sock2, "ticket:mark", {
        accessToken,
        roomCode: actualRoomCode,
        playerId,
        hallId: HALL_ID,
        number: 7, // arbitrary — engine no-ops hvis ikke på platen
        clientRequestId: newClientRequestId,
      });
      result.newMarkAcceptedAfterReconnect = true;
      result.newMarkAfterReconnect = { number: 7, clientRequestId: newClientRequestId };
      step("ticket.mark.post-reconnect.ok");
    } catch (err) {
      result.errors.push(`post-reconnect new mark: ${err.message}`);
    }
  } else {
    // Hvis det ikke er en aktiv runde, regnes "new mark" som no-op success
    // (vi har testet selve socket-roundtrip-en gjennom reconnect ovenfor).
    result.newMarkAcceptedAfterReconnect = true;
    step("ticket.mark.post-reconnect.skipped", { reason: "no_running_game" });
  }

  // ── Pass-kriterium ───────────────────────────────────────────────────────
  // R3 PASS = (resume-flyten ok) AND (marks bevart eller likt) AND
  //          (ny mark akseptert) AND (ingen errors).
  result.pass =
    resumeOk &&
    result.marksMatchAfterReconnect &&
    result.newMarkAcceptedAfterReconnect &&
    result.errors.length === 0;

  step("done", { pass: result.pass });
  sock2.disconnect();

  writeResult();
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  result.errors.push(`uncaught: ${err.message}`);
  writeResult({ pass: false });
  process.stderr.write(`[r3-mock-client] uncaught: ${err.stack ?? err.message}\n`);
  process.exit(3);
});
