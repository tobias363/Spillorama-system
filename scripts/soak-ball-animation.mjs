#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const FRONTEND_URL = process.env.CANDY_SOAK_FRONTEND_URL ?? "http://127.0.0.1:4174/";
const BACKEND_URL = process.env.CANDY_SOAK_BACKEND_URL ?? "http://127.0.0.1:4000";
const ADMIN_EMAIL = process.env.CANDY_SOAK_ADMIN_EMAIL ?? "test@test.no";
const ADMIN_PASSWORD = process.env.CANDY_SOAK_ADMIN_PASSWORD ?? "test1234";
const ROOM_CODE = process.env.CANDY_SOAK_ROOM_CODE ?? "CANDY1";
const DRAWS_PER_GAME = 30;
const DRAW_SETTLE_MS = 2100;
const START_SETTLE_MS = 350;

const requestedDraws = readPositiveIntegerArg("--draws") ?? 100;

main().catch((error) => {
  console.error("[ball-soak] failed", error);
  process.exit(1);
});

async function main() {
  const initialSettings = await getCandySettings();

  try {
    openBrowser();
    installMonitor();
    await withAdminToken(async (token) => {
      await endCurrentGame(token, "ball-monitor-reset");
      await updateCandySettings(token, {
        autoRoundStartEnabled: false,
        autoDrawEnabled: false,
      });

      for (let drawIndex = 1; drawIndex <= requestedDraws; drawIndex += 1) {
        if ((drawIndex - 1) % DRAWS_PER_GAME === 0) {
          await startGame(token);
          sleep(START_SETTLE_MS);
        }

        agentEval(`window.__ballMonitor.markDraw("draw-${drawIndex}")`, { quiet: true });
        await drawNext(token);
        sleep(DRAW_SETTLE_MS);
      }

      const summary = getMonitorSummary();
      console.log(JSON.stringify(summary, null, 2));

      const hasUnexpectedDrawCount =
        summary.totalDraws !== requestedDraws || summary.completedDraws !== requestedDraws;
      if (summary.anomalyCount > 0 || hasUnexpectedDrawCount) {
        process.exitCode = 1;
      }
    });
  } finally {
    try {
      await withAdminToken(async (token) => {
        await endCurrentGame(token, "post-soak cleanup");
        await updateCandySettings(token, {
          autoRoundStartEnabled: initialSettings.autoRoundStartEnabled,
          autoDrawEnabled: initialSettings.autoDrawEnabled,
        });
      });
    } catch (cleanupError) {
      console.error("[ball-soak] cleanup failed", cleanupError);
      process.exitCode = 1;
    }
  }
}

function openBrowser() {
  runCommand("npx", ["-y", "agent-browser", "open", FRONTEND_URL], { quiet: false });
  runCommand("npx", ["-y", "agent-browser", "wait", "--load", "networkidle"], { quiet: true });
}

function installMonitor() {
  const script = `
    (() => {
      if (window.__ballMonitor) {
        window.__ballMonitor.startedAt = performance.now();
        window.__ballMonitor.samples = 0;
        window.__ballMonitor.anomalies = [];
        window.__ballMonitor.draws = [];
        window.__ballMonitor.activeDraw = null;
        return "reset";
      }

      const state = {
        startedAt: performance.now(),
        samples: 0,
        anomalies: [],
        draws: [],
        activeDraw: null,
      };

      const visibleCount = (selector) => Array.from(document.querySelectorAll(selector)).filter((node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0.01;
      }).length;

      const push = (type, detail) => {
        state.anomalies.push({
          timeMs: Math.round(performance.now() - state.startedAt),
          type,
          detail,
        });
      };

      state.markDraw = (label) => {
        if (state.activeDraw && !state.activeDraw.completed) {
          push("DRAW_OVERLAP", "new draw before previous completed");
        }

        const draw = {
          index: state.draws.length + 1,
          label: label ?? null,
          markedAt: performance.now(),
          sawRail: false,
          lastRailSeenAt: null,
          railVisibleSamples: 0,
          maxRailCount: 0,
          legacyFloatingSamples: 0,
          legacyOutputSamples: 0,
          completed: false,
          reportedNoRail: false,
          reportedMultiRail: false,
          reportedLegacyFloating: false,
          reportedLegacyOutput: false,
        };

        state.draws.push(draw);
        state.activeDraw = draw;
        return draw.index;
      };

      state.getSummary = () => ({
        totalSamples: state.samples,
        totalDraws: state.draws.length,
        completedDraws: state.draws.filter((draw) => draw.completed).length,
        anomalyCount: state.anomalies.length,
        anomalies: state.anomalies,
        draws: state.draws.map((draw) => ({
          index: draw.index,
          sawRail: draw.sawRail,
          railVisibleSamples: draw.railVisibleSamples,
          maxRailCount: draw.maxRailCount,
          legacyFloatingSamples: draw.legacyFloatingSamples,
          legacyOutputSamples: draw.legacyOutputSamples,
          completed: draw.completed,
        })),
      });

      const tick = () => {
        state.samples += 1;

        const draw = state.activeDraw;
        const now = performance.now();
        const legacyFloating = visibleCount(".theme1-draw-machine__floating-ball");
        const legacyOutput = visibleCount(".theme1-draw-machine__output-ball");
        const railCount = visibleCount(".playfield__flying-ball");

        if (draw) {
          draw.maxRailCount = Math.max(draw.maxRailCount, railCount);

          if (legacyFloating > 0) {
            draw.legacyFloatingSamples += legacyFloating;
            if (!draw.reportedLegacyFloating) {
              draw.reportedLegacyFloating = true;
              push("LEGACY_FLOATING_VISIBLE", "legacy machine floating ball became visible");
            }
          }

          if (legacyOutput > 0) {
            draw.legacyOutputSamples += legacyOutput;
            if (!draw.reportedLegacyOutput) {
              draw.reportedLegacyOutput = true;
              push("LEGACY_OUTPUT_VISIBLE", "legacy machine output ball became visible");
            }
          }

          if (railCount > 1 && !draw.reportedMultiRail) {
            draw.reportedMultiRail = true;
            push("MULTIPLE_RAIL_BALLS", "more than one rail ball was visible");
          }

          if (railCount > 0) {
            draw.sawRail = true;
            draw.lastRailSeenAt = now;
            draw.railVisibleSamples += 1;
          }

          if (!draw.sawRail && now - draw.markedAt > 900 && !draw.reportedNoRail) {
            draw.reportedNoRail = true;
            push("RAIL_NEVER_APPEARED", "rail ball never became visible");
          }

          if (
            draw.sawRail &&
            draw.lastRailSeenAt !== null &&
            railCount === 0 &&
            now - draw.lastRailSeenAt > 250 &&
            now - draw.markedAt > 1000
          ) {
            draw.completed = true;
            state.activeDraw = null;
          }

          if (!draw.completed && now - draw.markedAt > 2600) {
            push("DRAW_TIMEOUT", "draw did not settle within the expected window");
            draw.completed = true;
            state.activeDraw = null;
          }
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
      window.__ballMonitor = state;
      return "installed";
    })()
  `;

  agentEval(script, { quiet: true });
}

function getMonitorSummary() {
  const encoded = agentEval("JSON.stringify(window.__ballMonitor.getSummary())", { quiet: true });
  return JSON.parse(JSON.parse(encoded));
}

function agentEval(expression, options = {}) {
  return runCommand("npx", ["-y", "agent-browser", "eval", expression], options);
}

async function withAdminToken(fn) {
  const token = await loginAsAdmin();
  return fn(token);
}

async function loginAsAdmin() {
  const response = await fetchJson(`${BACKEND_URL}/api/admin/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  });

  if (!response.ok || !response.data?.accessToken) {
    throw new Error(`Admin login failed: ${JSON.stringify(response)}`);
  }

  return response.data.accessToken;
}

async function getCandySettings() {
  return withAdminToken(async (token) => {
    const response = await fetchJson(`${BACKEND_URL}/api/admin/candy-mania/settings`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok || !response.data) {
      throw new Error(`Failed to load candy settings: ${JSON.stringify(response)}`);
    }

    return response.data;
  });
}

async function updateCandySettings(token, patch) {
  const response = await fetchJson(`${BACKEND_URL}/api/admin/candy-mania/settings`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Failed to update candy settings: ${JSON.stringify(response)}`);
  }
}

async function startGame(token) {
  const deadline = Date.now() + 35_000;

  while (true) {
    const response = await fetchJson(`${BACKEND_URL}/api/admin/rooms/${ROOM_CODE}/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entryFee: 0,
        ticketsPerPlayer: 4,
      }),
    });

    if (response.ok) {
      return;
    }

    if (response.error?.code !== "ROUND_START_TOO_SOON" || Date.now() >= deadline) {
      throw new Error(`Failed to start game: ${JSON.stringify(response)}`);
    }

    sleep(1000);
  }
}

async function drawNext(token) {
  const response = await fetchJson(`${BACKEND_URL}/api/admin/rooms/${ROOM_CODE}/draw-next`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Failed to draw next ball: ${JSON.stringify(response)}`);
  }
}

async function endCurrentGame(token, reason) {
  await fetchJson(`${BACKEND_URL}/api/admin/rooms/${ROOM_CODE}/end`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  return response.json();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with code ${result.status}\n${result.stderr}`,
    );
  }

  const output = result.stdout.trim();
  if (!options.quiet && output) {
    console.log(output);
  }
  return output;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readPositiveIntegerArg(name) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return null;
  const value = Number.parseInt(raw.slice(name.length + 1), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
