/**
 * BIN-508: Artillery processor for the 1000-player scenario.
 *
 * Responsibilities:
 *   - Per-VU test token seeding (so auth middleware accepts the connection).
 *   - drawLoop: listen for draw:new events and mark/claim in response.
 *   - Emit custom histogram `latency_draw_to_client_ms` so the report surfaces
 *     the draw-to-client latency that's the SLO for BIN-508.
 *
 * This file is intentionally plain CommonJS JS (not TS) — Artillery loads
 * processors via require() and running TS here would force an extra build step.
 */

"use strict";

const crypto = require("node:crypto");

const MAX_DRAWS_TO_WAIT = 90;          // one 75-ball round + headroom
const MAX_MARKS_PER_VU = 20;           // per BIN-508 scenario spec
const DRAW_TIMEOUT_MS = 15_000;        // guard against hanging listeners

function seedTokenPerVU(requestParams, context, ee, next) {
  // In real deployments the backend seeds test tokens via an admin endpoint
  // (see README). For local runs we generate a deterministic pseudo-token per
  // VU and rely on the backend running with AUTH_ALLOW_LOADTEST=true so the
  // auth middleware skips user-lookup for the `loadtest-*` prefix.
  if (!context.vars.token) {
    const vu = context.vars.$uuid || crypto.randomUUID();
    context.vars.token = `loadtest-${vu}`;
  }
  return next();
}

function drawLoop(context, events, done) {
  const socket = context.sockets && context.sockets[""] ? context.sockets[""] : null;
  if (!socket) {
    return done(new Error("drawLoop: no Socket.IO socket on context"));
  }

  let draws = 0;
  let marks = 0;
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    events.emit("counter", "drawLoop.timeout", 1);
    socket.off("draw:new", onDraw);
    done();
  }, DRAW_TIMEOUT_MS + MAX_DRAWS_TO_WAIT * 1500);

  function onDraw(payload) {
    if (settled) return;
    draws += 1;
    // Server puts serverEmittedAt on the payload so the round-trip latency is
    // measurable here. Fall back to "now" if missing (old deploys) so the
    // counter still advances.
    const emittedAt = typeof payload?.serverEmittedAt === "number" ? payload.serverEmittedAt : Date.now();
    const latency = Math.max(0, Date.now() - emittedAt);
    events.emit("histogram", "latency_draw_to_client_ms", latency);

    const onGrid = payload?.number != null && payload.number % 3 === 0;
    if (marks < MAX_MARKS_PER_VU && onGrid) {
      marks += 1;
      socket.emit("ticket:mark", {
        roomCode: context.vars.roomCode,
        number: payload.number,
        accessToken: context.vars.token,
      });
    }

    if (draws >= MAX_DRAWS_TO_WAIT) {
      // Try a BINGO claim on our way out — not all VUs will win, but the
      // server-side validation path gets exercised on every attempt.
      socket.emit("claim:submit", {
        roomCode: context.vars.roomCode,
        type: "BINGO",
        accessToken: context.vars.token,
      });
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.off("draw:new", onDraw);
        done();
      }
    }
  }

  socket.on("draw:new", onDraw);
}

module.exports = { seedTokenPerVU, drawLoop };
