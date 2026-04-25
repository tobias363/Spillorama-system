// MASTER_PLAN §2.3 — tester for jackpot-confirm-flow i admin-web.
//
// Dekker:
//   - startGame1(gameId) sender body uten jackpotConfirmed som default
//   - startGame1(gameId, undefined, true) sender jackpotConfirmed=true
//   - ApiError.details propageres når backend svarer JACKPOT_CONFIRM_REQUIRED
//   - fetchGame1JackpotState treffer riktig URL
//   - fetchGame1Detail returnerer jackpot-state-felt

import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../src/api/client.js";
import {
  startGame1,
  fetchGame1JackpotState,
  fetchGame1Detail,
} from "../src/api/admin-game1-master.js";

type FetchCall = { url: string; init: RequestInit | undefined };

function mockJson(data: unknown, status = 200): typeof fetch {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ ok: status < 400, data }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  ) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return fn;
}

function mockError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status = 400
): typeof fetch {
  const fn = vi.fn(async () =>
    new Response(
      JSON.stringify({ ok: false, error: { code, message, details } }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    )
  ) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return fn;
}

function captureCall(fn: typeof fetch): FetchCall {
  const call = (fn as unknown as { mock: { calls: [string, RequestInit | undefined][] } })
    .mock.calls[0];
  return { url: String(call![0]), init: call![1] };
}

describe("startGame1", () => {
  it("sender body uten jackpotConfirmed som default", async () => {
    const fetchMock = mockJson({ gameId: "g1", status: "running", auditId: "a1" });
    await startGame1("g1");
    const call = captureCall(fetchMock);
    expect(call.url).toBe("/api/admin/game1/games/g1/start");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(String(call.init?.body ?? "{}"));
    expect(body.jackpotConfirmed).toBeUndefined();
  });

  it("sender jackpotConfirmed=true når flagget", async () => {
    const fetchMock = mockJson({
      gameId: "g1",
      status: "running",
      auditId: "a1",
      jackpotAmountCents: 2_456_000,
    });
    const result = await startGame1("g1", undefined, true);
    const call = captureCall(fetchMock);
    const body = JSON.parse(String(call.init?.body ?? "{}"));
    expect(body.jackpotConfirmed).toBe(true);
    expect(result.jackpotAmountCents).toBe(2_456_000);
  });

  it("kaster ApiError med details når JACKPOT_CONFIRM_REQUIRED", async () => {
    mockError(
      "JACKPOT_CONFIRM_REQUIRED",
      "Jackpott må bekreftes",
      {
        jackpotAmountCents: 2_400_000,
        maxCapCents: 3_000_000,
        dailyIncrementCents: 400_000,
        drawThresholds: [50, 55, 56, 57],
        hallGroupId: "grp-1",
      },
      400
    );
    await expect(startGame1("g1")).rejects.toBeInstanceOf(ApiError);
    try {
      await startGame1("g1");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("JACKPOT_CONFIRM_REQUIRED");
      expect(apiErr.details).toBeDefined();
      expect(apiErr.details?.jackpotAmountCents).toBe(2_400_000);
      expect(apiErr.details?.drawThresholds).toEqual([50, 55, 56, 57]);
    }
  });

  it("sender confirmExcludedHalls når gitt", async () => {
    const fetchMock = mockJson({ gameId: "g1", status: "running", auditId: "a1" });
    await startGame1("g1", ["hall-a", "hall-b"], true);
    const call = captureCall(fetchMock);
    const body = JSON.parse(String(call.init?.body ?? "{}"));
    expect(body.confirmExcludedHalls).toEqual(["hall-a", "hall-b"]);
    expect(body.jackpotConfirmed).toBe(true);
  });
});

describe("fetchGame1JackpotState", () => {
  it("treffer riktig URL", async () => {
    const fetchMock = mockJson({
      jackpot: {
        hallGroupId: "grp-1",
        currentAmountCents: 2_400_000,
        maxCapCents: 3_000_000,
        dailyIncrementCents: 400_000,
        drawThresholds: [50, 55, 56, 57],
        lastAccumulationDate: "2026-04-24",
      },
    });
    const result = await fetchGame1JackpotState("grp-1");
    const call = captureCall(fetchMock);
    expect(call.url).toBe("/api/admin/game1/jackpot-state/grp-1");
    expect(call.init?.method ?? "GET").toBe("GET");
    expect(result.jackpot?.currentAmountCents).toBe(2_400_000);
  });

  it("returnerer null-jackpot når backend svarer null", async () => {
    mockJson({ jackpot: null });
    const result = await fetchGame1JackpotState("grp-1");
    expect(result.jackpot).toBeNull();
  });
});

describe("fetchGame1Detail", () => {
  it("inkluderer jackpot-state i response", async () => {
    mockJson({
      game: {
        id: "g1",
        status: "ready_to_start",
        scheduledStartTime: null,
        scheduledEndTime: null,
        actualStartTime: null,
        actualEndTime: null,
        masterHallId: "h1",
        groupHallId: "grp-1",
        participatingHallIds: [],
        subGameName: "Sub-spill 1",
        customGameName: null,
        startedByUserId: null,
        stoppedByUserId: null,
        stopReason: null,
      },
      halls: [],
      allReady: false,
      auditRecent: [],
      jackpot: {
        currentAmountCents: 2_400_000,
        maxCapCents: 3_000_000,
        dailyIncrementCents: 400_000,
        drawThresholds: [50, 55, 56, 57],
        lastAccumulationDate: "2026-04-24",
      },
    });
    const detail = await fetchGame1Detail("g1");
    expect(detail.jackpot?.currentAmountCents).toBe(2_400_000);
    expect(detail.jackpot?.drawThresholds).toEqual([50, 55, 56, 57]);
  });

  it("aksepterer null-jackpot (backend legacy-mode)", async () => {
    mockJson({
      game: {
        id: "g1",
        status: "ready_to_start",
        scheduledStartTime: null,
        scheduledEndTime: null,
        actualStartTime: null,
        actualEndTime: null,
        masterHallId: "h1",
        groupHallId: "grp-1",
        participatingHallIds: [],
        subGameName: "Sub-spill 1",
        customGameName: null,
        startedByUserId: null,
        stoppedByUserId: null,
        stopReason: null,
      },
      halls: [],
      allReady: false,
      auditRecent: [],
      jackpot: null,
    });
    const detail = await fetchGame1Detail("g1");
    expect(detail.jackpot).toBeNull();
  });
});
