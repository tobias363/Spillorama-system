/**
 * Tester for `agent-game1.ts` Bølge 3-funksjoner — single-source-of-truth
 * `fetchLobbyState` + 6 master-actions mot `/api/agent/game1/master/*`-routes.
 *
 * Bakgrunn (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.3):
 *   Tidligere brukte UI dual-fetch (plan-API + legacy-API) + adapter +
 *   wrapper for å koordinere plan-state og engine-state. Bølge 1 (aggregator)
 *   + Bølge 2 (MasterActionService) flytter all sekvensering til backend.
 *   Disse testene verifiserer at klient-bindingen er riktig kontrakt-sett:
 *
 *     - `fetchLobbyState` parser respons mot `Spill1AgentLobbyStateSchema`
 *     - hver master-action POSTer korrekt body til riktig route
 *     - `MasterActionResult`-shape passerer through uendret
 *     - error-paths (400 INVALID_INPUT, 403 FORBIDDEN, koder fra
 *       DomainError) propageres som `ApiError`
 *     - `inconsistencyWarnings` propageres uendret slik at UI-komponenter
 *       kan vise dem som non-blocking varsler
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchLobbyState,
  startMaster,
  advanceMaster,
  pauseMaster,
  resumeMaster,
  stopMaster,
  setJackpot,
} from "../src/api/agent-game1.js";
import { ApiError } from "../src/api/client.js";
import type { Spill1AgentLobbyState } from "../../../packages/shared-types/src/spill1-lobby-state.js";

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
    fn,
    calls,
    setResponses: (rs) => {
      queue = [...rs];
    },
  };
}

/**
 * Bygg minimal-men-Zod-gyldig `Spill1AgentLobbyState` for bruk i mocks.
 * Default-state er "tom hall, ingen aktiv runde" — overrides på top-level
 * via `partial`-objektet.
 */
function emptyLobbyState(
  overrides: Partial<Spill1AgentLobbyState> = {},
): Spill1AgentLobbyState {
  return {
    hallId: "hall-1",
    hallName: "Test-hall",
    businessDate: "2026-05-08",
    generatedAt: "2026-05-08T12:00:00.000Z",
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
    halls: [],
    allHallsReady: false,
    masterHallId: null,
    groupOfHallsId: null,
    isMasterAgent: false,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  // Spillorama-frontend leser auth-token fra localStorage.
  window.localStorage.setItem("bingo_admin_access_token", "tok-abc");
});

describe("fetchLobbyState (Bølge 3 single-source-of-truth)", () => {
  it("treffer GET /api/agent/game1/lobby med hallId-param", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([{ status: 200, body: emptyLobbyState() }]);

    const state = await fetchLobbyState("hall-1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/api/agent/game1/lobby?hallId=hall-1");
    expect(calls[0]!.init!.method ?? "GET").toBe("GET");
    expect(state.hallId).toBe("hall-1");
  });

  it("kaller uten hallId-param når hallId ikke gitt (ADMIN-flow)", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([{ status: 200, body: emptyLobbyState() }]);

    await fetchLobbyState();

    expect(calls[0]!.url).toBe("/api/agent/game1/lobby");
  });

  it("Zod-parser respons og kaster på kontrakt-brudd", async () => {
    const { setResponses } = recordingFetch();
    // Manglende `currentScheduledGameId`-felt — Zod skal kaste fordi
    // schemaet krever det (kan være null, men ikke utelatt).
    setResponses([
      {
        status: 200,
        body: {
          hallId: "hall-1",
          hallName: "Test-hall",
          businessDate: "2026-05-08",
          generatedAt: "2026-05-08T12:00:00.000Z",
          // currentScheduledGameId mangler
          planMeta: null,
          scheduledGameMeta: null,
          halls: [],
          allHallsReady: false,
          masterHallId: null,
          groupOfHallsId: null,
          isMasterAgent: false,
          nextScheduledStartTime: null,
          inconsistencyWarnings: [],
        },
      },
    ]);

    await expect(fetchLobbyState("hall-1")).rejects.toBeDefined();
  });

  it("propagerer inconsistencyWarnings i parsed response", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: emptyLobbyState({
          inconsistencyWarnings: [
            {
              code: "STALE_PLAN_RUN",
              message: "Plan-run fra i går er fortsatt åpen",
            },
          ],
        }),
      },
    ]);

    const state = await fetchLobbyState("hall-1");
    expect(state.inconsistencyWarnings).toHaveLength(1);
    expect(state.inconsistencyWarnings[0]!.code).toBe("STALE_PLAN_RUN");
  });

  it("propagerer 403 FORBIDDEN som ApiError (HALL_OPERATOR cross-hall)", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 403,
        body: {
          code: "FORBIDDEN",
          message: "Du kan kun lese lobby for din egen hall.",
        },
      },
    ]);

    await expect(fetchLobbyState("annen-hall")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("threader signal til underliggende fetch", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([{ status: 200, body: emptyLobbyState() }]);
    const ac = new AbortController();

    await fetchLobbyState("hall-1", { signal: ac.signal });

    expect(calls[0]!.init!.signal).toBe(ac.signal);
  });
});

describe("startMaster (POST /api/agent/game1/master/start)", () => {
  it("POSTer hallId i body for ADMIN-overstyring", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: "running",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await startMaster("hall-1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/api/agent/game1/master/start");
    expect(calls[0]!.init!.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
  });

  it("POSTer tom body når hallId ikke gitt (HALL_OPERATOR self-scope)", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: "running",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await startMaster();

    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toEqual({});
  });

  it("returnerer MasterActionResult med scheduledGameId for videre actions", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-abc",
          planRunId: "run-abc",
          status: "running",
          scheduledGameStatus: "running",
          inconsistencyWarnings: [],
        },
      },
    ]);

    const result = await startMaster("hall-1");
    expect(result.scheduledGameId).toBe("sg-abc");
    expect(result.planRunId).toBe("run-abc");
    expect(result.status).toBe("running");
  });

  it("propagerer JACKPOT_SETUP_REQUIRED som ApiError", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 400,
        body: {
          code: "JACKPOT_SETUP_REQUIRED",
          message: "Jackpot må settes opp før start.",
        },
      },
    ]);

    await expect(startMaster("hall-1")).rejects.toMatchObject({
      code: "JACKPOT_SETUP_REQUIRED",
      status: 400,
    });
  });

  it("propagerer BRIDGE_FAILED-warning fra inconsistencyWarnings", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: null,
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: null,
          inconsistencyWarnings: ["BRIDGE_FAILED"],
        },
      },
    ]);

    const result = await startMaster("hall-1");
    expect(result.inconsistencyWarnings).toContain("BRIDGE_FAILED");
    expect(result.scheduledGameId).toBeNull();
  });
});

describe("advanceMaster (POST /api/agent/game1/master/advance)", () => {
  it("POSTer hallId og returnerer MasterActionResult", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-2",
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: "purchase_open",
          inconsistencyWarnings: [],
        },
      },
    ]);

    const result = await advanceMaster("hall-1");

    expect(calls[0]!.url).toBe("/api/agent/game1/master/advance");
    expect(calls[0]!.init!.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(result.scheduledGameId).toBe("sg-2");
  });
});

describe("pauseMaster (POST /api/agent/game1/master/pause)", () => {
  it("POSTer hallId + reason i body når reason er gitt", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "paused",
          scheduledGameStatus: "paused",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await pauseMaster("hall-1", "Pause for kaffepause");

    expect(calls[0]!.url).toBe("/api/agent/game1/master/pause");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(body.reason).toBe("Pause for kaffepause");
  });

  it("utelater reason når den er tom streng", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "paused",
          scheduledGameStatus: "paused",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await pauseMaster("hall-1", "  ");

    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(body.reason).toBeUndefined();
  });

  it("utelater reason når undefined", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "paused",
          scheduledGameStatus: "paused",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await pauseMaster("hall-1");

    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.reason).toBeUndefined();
  });
});

describe("resumeMaster (POST /api/agent/game1/master/resume)", () => {
  it("POSTer hallId og returnerer MasterActionResult", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: "running",
          inconsistencyWarnings: [],
        },
      },
    ]);

    const result = await resumeMaster("hall-1");

    expect(calls[0]!.url).toBe("/api/agent/game1/master/resume");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(result.status).toBe("running");
  });
});

describe("stopMaster (POST /api/agent/game1/master/stop)", () => {
  it("POSTer hallId + reason (begge påkrevd)", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: null,
          planRunId: "run-1",
          status: "finished",
          scheduledGameStatus: "cancelled",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await stopMaster("hall-1", "Tekniske problemer");

    expect(calls[0]!.url).toBe("/api/agent/game1/master/stop");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(body.reason).toBe("Tekniske problemer");
  });

  it("propagerer INVALID_INPUT når reason er tom", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 400,
        body: {
          code: "INVALID_INPUT",
          message: "Ugyldig request body: String must contain at least 1 character(s)",
        },
      },
    ]);

    await expect(stopMaster("hall-1", "")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("setJackpot (POST /api/agent/game1/master/jackpot-setup)", () => {
  it("POSTer hallId + position + draw + prizesCents", async () => {
    const { calls, setResponses } = recordingFetch();
    setResponses([
      {
        status: 200,
        body: {
          scheduledGameId: "sg-1",
          planRunId: "run-1",
          status: "running",
          scheduledGameStatus: "running",
          inconsistencyWarnings: [],
        },
      },
    ]);

    await setJackpot("hall-1", 3, 47, { gul: 50000, hvit: 30000 });

    expect(calls[0]!.url).toBe("/api/agent/game1/master/jackpot-setup");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.hallId).toBe("hall-1");
    expect(body.position).toBe(3);
    expect(body.draw).toBe(47);
    expect(body.prizesCents).toEqual({ gul: 50000, hvit: 30000 });
  });

  it("kaster ApiError med INVALID_INPUT for ugyldig draw (>90)", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 400,
        body: {
          code: "INVALID_INPUT",
          message: "Ugyldig request body: Number must be less than or equal to 90",
        },
      },
    ]);

    await expect(
      setJackpot("hall-1", 1, 99, { gul: 1000 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("error propagation across all master-actions", () => {
  it("propagerer ApiError-instans (ikke vanlig Error)", async () => {
    const { setResponses } = recordingFetch();
    setResponses([
      {
        status: 403,
        body: {
          code: "FORBIDDEN",
          message: "Rollen din har ikke tilgang til Spill 1 master-actions.",
        },
      },
    ]);

    try {
      await startMaster("hall-1");
      expect.fail("startMaster skulle kaste");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe("FORBIDDEN");
        expect(err.status).toBe(403);
      }
    }
  });
});
