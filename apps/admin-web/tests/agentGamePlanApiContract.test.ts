/**
 * Test-engineer (2026-05-07): kontrakt-verifisering mellom backend-respons
 * og frontend API-wrapper for agent-game-plan-runtime.
 *
 * Dekker:
 *   - startAgentGamePlan-respons inkluderer scheduledGameId + bridgeError
 *     fra backend, men frontend-typen utelater dem (FUNN: typing-gap).
 *   - advanceAgentGamePlan-respons har samme problem.
 *   - Frontend-wrappere er enten ubrukte (start/advance/pause/resume) eller
 *     brukes (current/jackpot-setup) — vi sporer kontrakt-konsumenter.
 *
 * Hvorfor dette er viktig
 * -----------------------
 * Backend-rute /api/agent/game-plan/start returnerer:
 *   { ok: true, data: { run, scheduledGameId, bridgeError } }
 *
 * Frontend `startAgentGamePlan` typer det som `{ run: GamePlanRun }` — så
 * `scheduledGameId` (som er PR #983 sin SAK å eksponere så master-UI kan
 * trigge engine via /api/agent/game1/start) er IKKE accessible fra
 * TypeScript på frontend-siden.
 *
 * Pluss: ingen UI-side kaller `startAgentGamePlan` eller
 * `advanceAgentGamePlan`. Ny flyt har ingen runtime-driver-knapper i UI.
 * Master-dashbord rendrer "currentItem" men kan ikke faktisk trigge
 * `start`/`advance` mot ny API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startAgentGamePlan,
  advanceAgentGamePlan,
  pauseAgentGamePlan,
  resumeAgentGamePlan,
  fetchAgentGamePlanCurrent,
  setAgentGamePlanJackpot,
  type GamePlanRun,
} from "../src/api/agent-game-plan.js";

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

function mockFetch(
  data: unknown,
  status = 200,
): { fn: ReturnType<typeof vi.fn>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return new Response(
      JSON.stringify({ ok: status < 400, data }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return { fn, calls };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseRun: GamePlanRun = {
  id: "run-1",
  planId: "plan-1",
  hallId: "hall-1",
  businessDate: "2026-05-07",
  currentPosition: 1,
  status: "running",
  jackpotOverrides: {},
  startedAt: "2026-05-07T11:00:00Z",
  finishedAt: null,
  masterUserId: "agent-1",
  createdAt: "2026-05-07T10:00:00Z",
  updatedAt: "2026-05-07T11:00:00Z",
};

function firstCall(calls: FetchCall[]): FetchCall {
  if (calls.length === 0) {
    throw new Error("ingen fetch-kall registrert");
  }
  return calls[0]!;
}

describe("agent-game-plan API contract", () => {
  it("startAgentGamePlan POST-er til /api/agent/game-plan/start", async () => {
    const { calls } = mockFetch({ run: baseRun });
    await startAgentGamePlan();
    expect(calls.length).toBe(1);
    const call = firstCall(calls);
    expect(call.url).toContain("/api/agent/game-plan/start");
    expect(call.method).toBe("POST");
  });

  it("advanceAgentGamePlan POST-er til /api/agent/game-plan/advance", async () => {
    const { calls } = mockFetch({
      run: baseRun,
      nextGame: null,
      jackpotSetupRequired: false,
    });
    await advanceAgentGamePlan();
    expect(calls.length).toBe(1);
    const call = firstCall(calls);
    expect(call.url).toContain("/api/agent/game-plan/advance");
    expect(call.method).toBe("POST");
  });

  it("pauseAgentGamePlan POST-er til /api/agent/game-plan/pause", async () => {
    const { calls } = mockFetch({ run: { ...baseRun, status: "paused" } });
    await pauseAgentGamePlan();
    expect(calls.length).toBe(1);
    const call = firstCall(calls);
    expect(call.url).toContain("/api/agent/game-plan/pause");
  });

  it("resumeAgentGamePlan POST-er til /api/agent/game-plan/resume", async () => {
    const { calls } = mockFetch({ run: baseRun });
    await resumeAgentGamePlan();
    expect(calls.length).toBe(1);
    const call = firstCall(calls);
    expect(call.url).toContain("/api/agent/game-plan/resume");
  });

  it("fetchAgentGamePlanCurrent støtter ?hallId-query for ADMIN", async () => {
    const { calls } = mockFetch({
      hallId: "hall-x",
      businessDate: "2026-05-07",
      run: null,
      plan: null,
      items: [],
      currentItem: null,
      nextItem: null,
      jackpotSetupRequired: false,
      pendingJackpotOverride: null,
      isMaster: false,
    });
    await fetchAgentGamePlanCurrent({ hallId: "hall-x" });
    const call = firstCall(calls);
    expect(call.url).toContain("/api/agent/game-plan/current?hallId=hall-x");
  });

  it("setAgentGamePlanJackpot serialiserer prizesCents i ØRE", async () => {
    const { calls } = mockFetch({ run: baseRun });
    await setAgentGamePlanJackpot({
      position: 1,
      draw: 54,
      prizesCents: { gul: 500000, hvit: 250000 },
    });
    const call = firstCall(calls);
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/api/agent/game-plan/jackpot-setup");
    if (!call.body) throw new Error("body mangler");
    const body = JSON.parse(call.body);
    expect(body.position).toBe(1);
    expect(body.draw).toBe(54);
    expect(body.prizesCents.gul).toBe(500000);
    expect(body.prizesCents.hvit).toBe(250000);
  });
});

describe("CONTRACT-GAP: backend-respons har felt som frontend-type utelater", () => {
  it("FUNN: backend returnerer scheduledGameId + bridgeError fra /start, men frontend-type kun har { run }", async () => {
    // Backend-rute returnerer:
    //   { ok: true, data: { run, scheduledGameId, bridgeError } }
    // Frontend-API typet det som:
    //   Promise<{ run: GamePlanRun }>
    //
    // Dette betyr at hvis UI-koden vil bruke scheduledGameId for å trigge
    // /api/agent/game1/start (engine), så MÅ den bruke `as unknown` eller
    // `(result as any).scheduledGameId`. Det er en typing-bug i
    // apps/admin-web/src/api/agent-game-plan.ts:114.
    const { calls } = mockFetch({
      run: baseRun,
      scheduledGameId: "sg-abc-123",
      bridgeError: null,
    });
    // I praksis virker runtime-en — feltet kommer over JSON. Men TS-typen
    // utelater scheduledGameId fra returverdien, så caller må bruke type-cast
    // eller endre typing.
    const result = await startAgentGamePlan();
    expect(result.run.id).toBe("run-1");
    // scheduledGameId finnes i runtime-payload men er ikke i Type:
    const raw = result as unknown as {
      scheduledGameId?: string;
      bridgeError?: string | null;
    };
    expect(raw.scheduledGameId).toBe("sg-abc-123");
    expect(raw.bridgeError).toBe(null);
    expect(calls.length).toBe(1);
  });

  it("FUNN: advanceAgentGamePlan også utelater scheduledGameId + bridgeError fra type", async () => {
    const { calls } = mockFetch({
      run: { ...baseRun, currentPosition: 2 },
      nextGame: null,
      jackpotSetupRequired: false,
      scheduledGameId: "sg-pos-2",
      bridgeError: null,
    });
    const result = await advanceAgentGamePlan();
    expect(result.jackpotSetupRequired).toBe(false);
    const raw = result as unknown as {
      scheduledGameId?: string;
      bridgeError?: string | null;
    };
    expect(raw.scheduledGameId).toBe("sg-pos-2");
    expect(calls.length).toBe(1);
  });
});
