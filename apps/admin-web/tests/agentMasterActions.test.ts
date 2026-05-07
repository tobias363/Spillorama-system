/**
 * Hotfix 2 (2026-05-07): tester for `agent-master-actions.ts`-wrapper.
 *
 * Verifiserer at:
 *   - Når `useNewGamePlan=false` (default), kalles KUN legacy
 *     `/api/agent/game1/start` og `/api/agent/game1/resume` — plan-API
 *     er stille.
 *   - Når `useNewGamePlan=true`, kalles plan-API FØRST og deretter
 *     legacy-API for å trigge engine.
 *   - Idempotens-fallback: hvis plan-API kaster
 *     `GAME_PLAN_RUN_INVALID_TRANSITION` (plan allerede running), faller
 *     wrapperen tilbake til ren legacy-call uten å kaste.
 *
 * Dette er et regress-test for HIGH #2-buggen som fant at master-knapper
 * ALDRI kalte plan-API selv med flag på (knapper var koblet direkte til
 * legacy `startAgentGame1`).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  startSpill1MasterAction,
  resumeSpill1MasterAction,
  pauseSpill1MasterPlanState,
} from "../src/api/agent-master-actions.js";
import { setFeatureFlag } from "../src/utils/featureFlags.js";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(): {
  fn: typeof fetch;
  calls: FetchCall[];
  setResponses: (
    responses: Array<{ status: number; body: unknown }>,
  ) => void;
} {
  let queue: Array<{ status: number; body: unknown }> = [];
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: { run: {} } };
    return new Response(
      JSON.stringify({
        ok: next.status < 400,
        ...(next.status < 400
          ? { data: next.body }
          : { error: next.body }),
      }),
      {
        status: next.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return {
    fn,
    calls,
    setResponses: (rs) => {
      queue = [...rs];
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  // Spillorama-frontend leser auth-token fra localStorage (bingo_admin_access_token).
  window.localStorage.setItem("bingo_admin_access_token", "tok-abc");
});

describe("Hotfix 2 — agent-master-actions wrapper (HIGH #2)", () => {
  describe("startSpill1MasterAction", () => {
    it("flag=false: kaller KUN legacy /api/agent/game1/start", async () => {
      // Default: feature-flag av — wrapperen skal ikke kalle plan-API.
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await startSpill1MasterAction();

      expect(calls.length).toBe(1);
      expect(calls[0]!.url).toBe("/api/agent/game1/start");
      expect(calls[0]!.init!.method).toBe("POST");
    });

    it("flag=true: kaller plan-API FØRST og deretter legacy-API", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        // Plan-API responsen (med scheduledGameId fra Fase 4-bridgen)
        {
          status: 200,
          body: {
            run: { id: "run-1", status: "running" },
            scheduledGameId: "sg-1",
            bridgeError: null,
          },
        },
        // Legacy engine-start
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await startSpill1MasterAction();

      expect(calls.length).toBe(2);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/start");
      expect(calls[1]!.url).toBe("/api/agent/game1/start");
    });

    it("flag=true: tolererer GAME_PLAN_RUN_INVALID_TRANSITION (plan allerede running)", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        // Plan-API: plan er allerede running → INVALID_TRANSITION
        {
          status: 400,
          body: {
            code: "GAME_PLAN_RUN_INVALID_TRANSITION",
            message: "Plan kan ikke startes fra status=running",
          },
        },
        // Legacy engine-start kjøres uansett
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await expect(startSpill1MasterAction()).resolves.toBeDefined();

      expect(calls.length).toBe(2);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/start");
      expect(calls[1]!.url).toBe("/api/agent/game1/start");
    });

    it("flag=true: propagerer JACKPOT_SETUP_REQUIRED uten å kalle legacy", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        {
          status: 400,
          body: {
            code: "JACKPOT_SETUP_REQUIRED",
            message: "Jackpot må settes opp før start.",
          },
        },
      ]);

      await expect(startSpill1MasterAction()).rejects.toMatchObject({
        code: "JACKPOT_SETUP_REQUIRED",
      });

      // Bare plan-API kalles — legacy hoppes over når plan-call kaster
      // en ekte feil (ikke en idempotens-tolerert overgang).
      expect(calls.length).toBe(1);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/start");
    });

    it("flag=true: videresender confirmExcludedHalls + confirmUnreadyHalls til legacy", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 200, body: { run: { id: "run-1" }, scheduledGameId: "sg-1", bridgeError: null } },
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await startSpill1MasterAction(["hall-x"], ["hall-y"]);

      const legacyBody = JSON.parse(String(calls[1]!.init!.body));
      expect(legacyBody.confirmExcludedHalls).toEqual(["hall-x"]);
      expect(legacyBody.confirmUnreadyHalls).toEqual(["hall-y"]);
    });
  });

  describe("resumeSpill1MasterAction", () => {
    it("flag=false: kaller KUN legacy /api/agent/game1/resume", async () => {
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await resumeSpill1MasterAction();

      expect(calls.length).toBe(1);
      expect(calls[0]!.url).toBe("/api/agent/game1/resume");
    });

    it("flag=true: kaller plan-API + legacy-API", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 200, body: { run: { id: "run-1", status: "running" } } },
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await resumeSpill1MasterAction();

      expect(calls.length).toBe(2);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/resume");
      expect(calls[1]!.url).toBe("/api/agent/game1/resume");
    });

    it("flag=true: tolererer GAME_PLAN_RUN_NOT_FOUND og kjører legacy-resume", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 400, body: { code: "GAME_PLAN_RUN_NOT_FOUND", message: "ingen plan" } },
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await resumeSpill1MasterAction();

      expect(calls.length).toBe(2);
    });
  });

  describe("pauseSpill1MasterPlanState", () => {
    it("flag=false: no-op (ingen kall)", async () => {
      const { calls } = recordingFetch();

      await pauseSpill1MasterPlanState();

      expect(calls.length).toBe(0);
    });

    it("flag=true: kaller /api/agent/game-plan/pause", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { calls, setResponses } = recordingFetch();
      setResponses([{ status: 200, body: { run: { id: "run-1", status: "paused" } } }]);

      await pauseSpill1MasterPlanState();

      expect(calls.length).toBe(1);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/pause");
    });

    it("flag=true: tolererer INVALID_TRANSITION (plan ikke i running)", async () => {
      setFeatureFlag("useNewGamePlan", true);
      const { setResponses } = recordingFetch();
      setResponses([
        {
          status: 400,
          body: { code: "GAME_PLAN_RUN_INVALID_TRANSITION", message: "ikke running" },
        },
      ]);

      // Skal ikke kaste — caller har ansvar for engine-pause separat.
      await expect(pauseSpill1MasterPlanState()).resolves.toBeUndefined();
    });
  });
});
