/**
 * Tests for `agent-game1.recoverStale` (2026-05-09).
 *
 * Verifies the API-client shape matches the backend route contract:
 *   - POST /api/agent/game1/master/recover-stale
 *   - body: { hallId? }
 *   - response: { ok: true, cleared: { planRuns, scheduledGames }, details }
 *
 * The actual cleanup logic is covered server-side
 * (`StalePlanRunRecoveryService.test.ts`); these tests confirm the
 * client wraps the call correctly, sends/omits hallId per the same
 * pattern as the master-actions, and surfaces errors as `ApiError`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { recoverStale } from "../src/api/agent-game1.js";
import { ApiError } from "../src/api/client.js";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(): {
  calls: FetchCall[];
  setResponses: (
    responses: Array<{ status: number; body: unknown }>,
  ) => void;
} {
  let queue: Array<{ status: number; body: unknown }> = [];
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, body: {} };
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
    calls,
    setResponses: (rs) => {
      queue = [...rs];
    },
  };
}

beforeEach(() => {
  // Set a fake access token in localStorage so the auth-injected fetch
  // gets `Authorization: Bearer ...` header without erroring out.
  const ls = globalThis.localStorage;
  if (ls && typeof ls.setItem === "function") {
    ls.setItem("auth.accessToken", "test-token");
  }
});

describe("recoverStale", () => {
  it("POSTs to /api/agent/game1/master/recover-stale with empty body when hallId omitted", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          ok: true,
          cleared: { planRuns: 0, scheduledGames: 0 },
          details: {
            recoveredAt: "2026-05-09T15:00:00.000Z",
            todayBusinessDate: "2026-05-09",
            clearedPlanRuns: [],
            clearedScheduledGames: [],
          },
        },
      },
    ]);

    const result = await recoverStale();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toMatch(/\/api\/agent\/game1\/master\/recover-stale$/);
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body ?? "{}"));
    expect(body).toEqual({});
    expect(result.ok).toBe(true);
    expect(result.cleared.planRuns).toBe(0);
    expect(result.cleared.scheduledGames).toBe(0);
  });

  it("POSTs hallId in body when provided", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          ok: true,
          cleared: { planRuns: 1, scheduledGames: 0 },
          details: {
            recoveredAt: "2026-05-09T15:00:00.000Z",
            todayBusinessDate: "2026-05-09",
            clearedPlanRuns: [],
            clearedScheduledGames: [],
          },
        },
      },
    ]);

    await recoverStale("11111111-1111-1111-1111-111111111111");

    const body = JSON.parse(String(calls[0]!.init?.body ?? "{}"));
    expect(body.hallId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns clearedPlanRuns + clearedScheduledGames from details", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          ok: true,
          cleared: { planRuns: 2, scheduledGames: 1 },
          details: {
            recoveredAt: "2026-05-09T15:00:00.000Z",
            todayBusinessDate: "2026-05-09",
            clearedPlanRuns: [
              {
                id: "run-1",
                businessDate: "2026-05-08",
                status: "running",
                currentPosition: 3,
                planId: "plan-1",
              },
              {
                id: "run-2",
                businessDate: "2026-05-07",
                status: "paused",
                currentPosition: 2,
                planId: "plan-1",
              },
            ],
            clearedScheduledGames: [
              {
                id: "game-1",
                status: "running",
                scheduledStartTime: "2026-05-07T15:00:00.000Z",
                scheduledEndTime: "2026-05-07T17:00:00.000Z",
                subGameName: "Bingo",
                groupHallId: "grp-1",
              },
            ],
          },
        },
      },
    ]);

    const result = await recoverStale("hall-1");

    expect(result.cleared.planRuns).toBe(2);
    expect(result.cleared.scheduledGames).toBe(1);
    expect(result.details.clearedPlanRuns.length).toBe(2);
    expect(result.details.clearedPlanRuns[0]!.id).toBe("run-1");
    expect(result.details.clearedScheduledGames[0]!.id).toBe("game-1");
  });

  it("propagates DomainError as ApiError when service is misconfigured", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 503,
        body: {
          code: "RECOVERY_NOT_CONFIGURED",
          message:
            "Stale-plan-run-recovery er ikke konfigurert på denne backend-instansen.",
        },
      },
    ]);

    await expect(recoverStale("hall-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("propagates FORBIDDEN as ApiError when caller is not master", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 400,
        body: {
          code: "FORBIDDEN",
          message:
            "Du kan kun utføre master-actions for din egen hall.",
        },
      },
    ]);

    await expect(
      recoverStale("other-hall"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
