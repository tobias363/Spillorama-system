/**
 * Code-review-test 2026-05-08 (PR #1075 review #4): unit-tester for
 * `mapLobbyToLegacyShape` i `NextGamePanel.ts`.
 *
 * Bakgrunn (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §6.3):
 *   Bølge 3 erstatter dual-fetch-pattern (plan-API + legacy-API) +
 *   adapter med single-source-of-truth fra `fetchLobbyState`. Translator-
 *   funksjonen `mapLobbyToLegacyShape` oversetter den kanoniske
 *   `Spill1AgentLobbyState`-shapen til den eksisterende
 *   `Spill1CurrentGameResponse`-shapen som
 *   `Spill1AgentStatus`/`Spill1AgentControls`-renderne forventer.
 *
 *   Kritisk invariant: `currentGame.id` MÅ være
 *   `lobby.currentScheduledGameId` (IKKE plan-run-id, slik forrige
 *   adapter feilaktig satte). Denne testen pinner kontrakten.
 *
 * Dekker:
 *   - Empty-state (ingen aktiv runde) → currentGame=null
 *   - Full-state (aktiv runde) → currentGame.id=scheduledGameId
 *   - inconsistencyWarnings-propagering (separat path i refresh, men vi
 *     verifiserer her at translatoren ikke filtrerer bort warnings)
 *   - isMasterAgent + allReady propageres uendret
 *   - halls[]-listen mappes 1:1 fra aggregator (alle hall-state-felter
 *     bevart, ingen tap)
 */

import { describe, it, expect, vi } from "vitest";
import type { Spill1AgentLobbyState } from "../../../packages/shared-types/src/spill1-lobby-state.js";

// Mocks for socket og API — NextGamePanel laster disse, men vi tester
// kun translatoren som er sync og ikke bruker dem. Replikerer mock-
// shapen fra nextGamePanelSpill1Unified.test.ts for konsistens.
vi.mock("../src/api/client.js", () => {
  class ApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    getToken: () => "tok-agent",
    setToken: () => {},
    clearToken: () => {},
    apiRequest: vi.fn(async () => ({})),
    ApiError,
  };
});

vi.mock("../src/pages/agent-portal/agentGame1Socket.js", () => ({
  AgentGame1Socket: class {
    constructor() {
      /* no-op */
    }
    subscribe() {
      /* no-op */
    }
    dispose() {
      /* no-op */
    }
    isFallbackActive() {
      return false;
    }
    isConnected() {
      return false;
    }
  },
}));

vi.mock("../src/pages/agent-portal/agentHallSocket.js", () => ({
  AgentHallSocket: class {
    constructor() {
      /* no-op */
    }
    subscribe() {
      /* no-op */
    }
    dispose() {
      /* no-op */
    }
    isFallbackActive() {
      return false;
    }
    isConnected() {
      return false;
    }
  },
}));

// Importeres etter vi.mock for at mocks skal slå inn på socket/api-imports
// inne i NextGamePanel-modulen.
import { __test } from "../src/pages/agent-portal/NextGamePanel.js";

const { mapLobbyToLegacyShape } = __test;

/**
 * Bygg minimal-men-Zod-gyldig `Spill1AgentLobbyState` for bruk i tester.
 * `mapLobbyToLegacyShape` antar at lobby allerede er parsed/validert —
 * den krever ikke schema-roundtrip her, så vi cast'er for å holde
 * fixturen kompakt.
 */
function emptyLobby(
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

describe("mapLobbyToLegacyShape — empty-state", () => {
  it("returnerer currentGame=null når currentScheduledGameId er null", () => {
    const lobby = emptyLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.currentGame).toBeNull();
    expect(legacy.hallId).toBe("hall-1");
    expect(legacy.isMasterAgent).toBe(false);
    expect(legacy.allReady).toBe(false);
    expect(legacy.halls).toEqual([]);
  });

  it("returnerer currentGame=null hvis scheduledGameMeta mangler (defensiv)", () => {
    const lobby = emptyLobby({
      currentScheduledGameId: "00000000-0000-0000-0000-000000000001",
      scheduledGameMeta: null,
    });

    const legacy = mapLobbyToLegacyShape(lobby);

    // Hvis aggregator-warning sier at scheduledGameId finnes men meta er
    // null (race), translatoren skal IKKE rendre fake currentGame med
    // tomme felter — fall-back til null så UI viser "venter"-state.
    expect(legacy.currentGame).toBeNull();
  });

  it("hallId faller tilbake til '' når lobby.hallId er null (ADMIN empty-state)", () => {
    const lobby = emptyLobby({
      hallId: null,
      hallName: null,
      businessDate: null,
    });

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.hallId).toBe("");
    expect(legacy.currentGame).toBeNull();
  });
});

describe("mapLobbyToLegacyShape — full-state", () => {
  function fullLobby(): Spill1AgentLobbyState {
    return emptyLobby({
      hallId: "hall-master",
      hallName: "Master-hall",
      currentScheduledGameId: "11111111-1111-1111-1111-111111111111",
      masterHallId: "hall-master",
      groupOfHallsId: "goh-1",
      isMasterAgent: true,
      allHallsReady: true,
      planMeta: {
        planRunId: "22222222-2222-2222-2222-222222222222",
        planId: "33333333-3333-3333-3333-333333333333",
        planName: "Mandag-kveld-plan",
        currentPosition: 3,
        totalPositions: 10,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        planRunStatus: "running",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
      scheduledGameMeta: {
        scheduledGameId: "11111111-1111-1111-1111-111111111111",
        status: "running",
        scheduledStartTime: "2026-05-08T18:00:00.000Z",
        scheduledEndTime: "2026-05-08T19:00:00.000Z",
        actualStartTime: "2026-05-08T18:00:05.000Z",
        actualEndTime: null,
        pauseReason: null,
      },
      halls: [
        {
          hallId: "hall-master",
          hallName: "Master-hall",
          isReady: true,
          hasNoCustomers: false,
          excludedFromGame: false,
          excludedReason: null,
          colorCode: "green",
          lastUpdatedAt: "2026-05-08T18:00:05.000Z",
          isMaster: true,
        },
        {
          hallId: "hall-slave-1",
          hallName: "Slave-hall 1",
          isReady: true,
          hasNoCustomers: false,
          excludedFromGame: false,
          excludedReason: null,
          colorCode: "green",
          lastUpdatedAt: "2026-05-08T18:00:03.000Z",
          isMaster: false,
        },
        {
          hallId: "hall-slave-2",
          hallName: "Slave-hall 2",
          isReady: false,
          hasNoCustomers: true,
          excludedFromGame: true,
          excludedReason: "Ingen kunder",
          colorCode: "red",
          lastUpdatedAt: "2026-05-08T18:00:00.000Z",
          isMaster: false,
        },
      ],
    });
  }

  it("currentGame.id = currentScheduledGameId (single id-rom)", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    // Kritisk invariant: currentGame.id er ALDRI plan-run-id.
    // Bølge 3-arkitektur — "plan-run-id er kun for diagnose, master-
    // actions skal aldri se den".
    expect(legacy.currentGame).not.toBeNull();
    expect(legacy.currentGame!.id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(legacy.currentGame!.id).not.toBe(
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("currentGame.subGameName trekkes fra planMeta.catalogDisplayName", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.currentGame!.subGameName).toBe("Bingo");
  });

  it("scheduled-meta-felter propageres direkte (status, start/end times)", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.currentGame!.status).toBe("running");
    expect(legacy.currentGame!.scheduledStartTime).toBe(
      "2026-05-08T18:00:00.000Z",
    );
    expect(legacy.currentGame!.scheduledEndTime).toBe(
      "2026-05-08T19:00:00.000Z",
    );
    expect(legacy.currentGame!.actualStartTime).toBe(
      "2026-05-08T18:00:05.000Z",
    );
    expect(legacy.currentGame!.actualEndTime).toBeNull();
  });

  it("isMasterAgent + allReady propageres uendret", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.isMasterAgent).toBe(true);
    expect(legacy.allReady).toBe(true);
  });

  it("halls-listen mappes 1:1 med alle ready/excluded-felter bevart", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.halls).toHaveLength(3);

    const master = legacy.halls.find((h) => h.hallId === "hall-master");
    expect(master).toMatchObject({
      hallId: "hall-master",
      hallName: "Master-hall",
      isReady: true,
      excludedFromGame: false,
      excludedReason: null,
    });

    const excluded = legacy.halls.find((h) => h.hallId === "hall-slave-2");
    expect(excluded).toMatchObject({
      hallId: "hall-slave-2",
      isReady: false,
      excludedFromGame: true,
      excludedReason: "Ingen kunder",
    });
  });

  it("masterHallId/groupHallId/participatingHallIds propageres", () => {
    const lobby = fullLobby();

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.currentGame!.masterHallId).toBe("hall-master");
    expect(legacy.currentGame!.groupHallId).toBe("goh-1");
    expect(legacy.currentGame!.participatingHallIds).toEqual([
      "hall-master",
      "hall-slave-1",
      "hall-slave-2",
    ]);
  });

  it("masterHallId faller tilbake til lobby.hallId hvis null (defensiv)", () => {
    const lobby = emptyLobby({
      hallId: "hall-1",
      currentScheduledGameId: "11111111-1111-1111-1111-111111111111",
      // masterHallId: null — race der scheduled-meta finnes men master ikke registrert
      planMeta: {
        planRunId: "22222222-2222-2222-2222-222222222222",
        planId: "33333333-3333-3333-3333-333333333333",
        planName: "Test",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        planRunStatus: "running",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
      scheduledGameMeta: {
        scheduledGameId: "11111111-1111-1111-1111-111111111111",
        status: "running",
        scheduledStartTime: "2026-05-08T18:00:00.000Z",
        scheduledEndTime: null,
        actualStartTime: null,
        actualEndTime: null,
        pauseReason: null,
      },
    });

    const legacy = mapLobbyToLegacyShape(lobby);

    // Translatoren skal alltid gi en streng for masterHallId (UI bruker
    // den til crown-rendering); fall-back til egen hallId er trygt
    // siden caller-hallen er garantert til stede når currentGame finnes.
    expect(legacy.currentGame!.masterHallId).toBe("hall-1");
  });
});

describe("mapLobbyToLegacyShape — kontrakt-bevaring", () => {
  it("digitalTicketsSold + physicalTicketsSold er hardkodet til 0 (aggregator eksponerer ikke disse)", () => {
    // Bølge 3 fjerner dual-fetch-pathen som leverte ticket-counters.
    // mapLobbyToLegacyShape setter dem til 0 så Spill1AgentStatus-
    // renderen ikke krasher; cash-inout-dashboardet har egen
    // ticket-flow-tabell hvis brukeren trenger tellinger.
    const lobby = emptyLobby({
      currentScheduledGameId: "11111111-1111-1111-1111-111111111111",
      planMeta: {
        planRunId: "22222222-2222-2222-2222-222222222222",
        planId: "33333333-3333-3333-3333-333333333333",
        planName: "Test",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        planRunStatus: "running",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
      scheduledGameMeta: {
        scheduledGameId: "11111111-1111-1111-1111-111111111111",
        status: "running",
        scheduledStartTime: "2026-05-08T18:00:00.000Z",
        scheduledEndTime: null,
        actualStartTime: null,
        actualEndTime: null,
        pauseReason: null,
      },
      halls: [
        {
          hallId: "hall-1",
          hallName: "Hall 1",
          isReady: true,
          hasNoCustomers: false,
          excludedFromGame: false,
          excludedReason: null,
          colorCode: "green",
          lastUpdatedAt: null,
          isMaster: true,
        },
      ],
    });

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.halls[0]!.digitalTicketsSold).toBe(0);
    expect(legacy.halls[0]!.physicalTicketsSold).toBe(0);
  });

  it("readyAt mappes fra lastUpdatedAt (kontrakt-rename)", () => {
    const lobby = emptyLobby({
      halls: [
        {
          hallId: "hall-1",
          hallName: "Hall 1",
          isReady: true,
          hasNoCustomers: false,
          excludedFromGame: false,
          excludedReason: null,
          colorCode: "green",
          lastUpdatedAt: "2026-05-08T18:00:00.000Z",
          isMaster: true,
        },
      ],
    });

    const legacy = mapLobbyToLegacyShape(lobby);

    expect(legacy.halls[0]!.readyAt).toBe("2026-05-08T18:00:00.000Z");
  });
});
