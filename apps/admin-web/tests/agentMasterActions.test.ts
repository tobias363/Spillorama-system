/**
 * Tester for `agent-master-actions.ts`-wrapper.
 *
 * Cleanup 2026-05-08: `useNewGamePlan`-flagget er fjernet — ny flyt er
 * standard. Verifiserer nå at:
 *   - `startSpill1MasterAction` ALLTID kaller plan-API først og deretter
 *     legacy-API for å trigge engine.
 *   - `resumeSpill1MasterAction` ALLTID kaller plan-API + engine-API.
 *   - `pauseSpill1MasterPlanState` ALLTID kaller plan-API.
 *   - Idempotens-fallback: hvis plan-API kaster
 *     `GAME_PLAN_RUN_INVALID_TRANSITION` eller `GAME_PLAN_RUN_NOT_FOUND`
 *     (avhengig av action), faller wrapperen tilbake til ren engine-call
 *     uten å kaste.
 *   - Reelle feil (f.eks. `JACKPOT_SETUP_REQUIRED`) propageres til caller
 *     uten at engine-API kalles.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  startSpill1MasterAction,
  resumeSpill1MasterAction,
  pauseSpill1MasterPlanState,
} from "../src/api/agent-master-actions.js";

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

describe("agent-master-actions wrapper", () => {
  describe("startSpill1MasterAction", () => {
    it("kaller plan-API FØRST og deretter legacy-API", async () => {
      const { calls, setResponses } = recordingFetch();
      setResponses([
        // Plan-API responsen
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
      expect(calls[1]!.init!.method).toBe("POST");
    });

    it("tolererer GAME_PLAN_RUN_INVALID_TRANSITION (plan allerede running)", async () => {
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

    it("propagerer JACKPOT_SETUP_REQUIRED uten å kalle legacy", async () => {
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

    it("videresender confirmExcludedHalls + confirmUnreadyHalls til legacy", async () => {
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
    it("kaller plan-API + legacy-API", async () => {
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

    it("tolererer GAME_PLAN_RUN_NOT_FOUND og kjører legacy-resume", async () => {
      const { calls, setResponses } = recordingFetch();
      setResponses([
        { status: 400, body: { code: "GAME_PLAN_RUN_NOT_FOUND", message: "ingen plan" } },
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await resumeSpill1MasterAction();

      expect(calls.length).toBe(2);
    });

    it("tolererer GAME_PLAN_RUN_INVALID_TRANSITION og kjører legacy-resume", async () => {
      const { calls, setResponses } = recordingFetch();
      setResponses([
        {
          status: 400,
          body: {
            code: "GAME_PLAN_RUN_INVALID_TRANSITION",
            message: "Plan ikke i paused-state",
          },
        },
        { status: 200, body: { gameId: "g-1", status: "running", auditId: "a1" } },
      ]);

      await resumeSpill1MasterAction();

      expect(calls.length).toBe(2);
    });
  });

  describe("pauseSpill1MasterPlanState", () => {
    it("kaller /api/agent/game-plan/pause", async () => {
      const { calls, setResponses } = recordingFetch();
      setResponses([{ status: 200, body: { run: { id: "run-1", status: "paused" } } }]);

      await pauseSpill1MasterPlanState();

      expect(calls.length).toBe(1);
      expect(calls[0]!.url).toBe("/api/agent/game-plan/pause");
    });

    it("tolererer INVALID_TRANSITION (plan ikke i running)", async () => {
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

    it("tolererer GAME_PLAN_RUN_NOT_FOUND", async () => {
      const { setResponses } = recordingFetch();
      setResponses([
        {
          status: 400,
          body: { code: "GAME_PLAN_RUN_NOT_FOUND", message: "ingen plan" },
        },
      ]);

      await expect(pauseSpill1MasterPlanState()).resolves.toBeUndefined();
    });
  });
});
