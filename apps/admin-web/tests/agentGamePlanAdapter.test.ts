/**
 * Fase 3 (2026-05-07): adaptGamePlanToLegacyShape tester.
 *
 * Verifiserer at plan-runtime-respons mappes korrekt til legacy
 * `Spill1CurrentGameResponse`-format så master-dashbord-UI er uendret.
 */

import { describe, it, expect } from "vitest";
import { adaptGamePlanToLegacyShape } from "../src/api/agent-game-plan-adapter.js";
import type {
  AgentGamePlanCurrentResponse,
} from "../src/api/agent-game-plan.js";
import type { GameCatalogEntry } from "../src/api/admin-game-catalog.js";

function makeCatalog(): GameCatalogEntry {
  return {
    id: "cat-1",
    slug: "spill-1",
    displayName: "Spill 1 Hovedrunde",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 250000 },
    },
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

describe("Fase 3 — adaptGamePlanToLegacyShape", () => {
  it("returnerer null-shape når run mangler", () => {
    const resp: AgentGamePlanCurrentResponse = {
      hallId: "hall-1",
      businessDate: "2026-05-07",
      run: null,
      plan: null,
      items: [],
      currentItem: null,
      nextItem: null,
      jackpotSetupRequired: false,
      pendingJackpotOverride: null,
      isMaster: false,
    };
    const adapted = adaptGamePlanToLegacyShape(resp);
    expect(adapted.hallId).toBe("hall-1");
    expect(adapted.currentGame).toBeNull();
    expect(adapted.halls).toEqual([]);
    expect(adapted.allReady).toBe(false);
    expect(adapted.isMasterAgent).toBe(false);
  });

  it("mapper aktivt run til legacy currentGame-shape", () => {
    const cat = makeCatalog();
    const resp: AgentGamePlanCurrentResponse = {
      hallId: "hall-1",
      businessDate: "2026-05-07",
      run: {
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
      },
      plan: {
        id: "plan-1",
        name: "Plan A",
        description: null,
        hallId: "hall-1",
        groupOfHallsId: null,
        weekdays: ["mon", "tue"],
        startTime: "11:00",
        endTime: "23:00",
        isActive: true,
      },
      items: [
        {
          id: "i-1",
          position: 1,
          notes: null,
          catalogEntry: cat,
        },
      ],
      currentItem: {
        id: "i-1",
        position: 1,
        notes: null,
        catalogEntry: cat,
      },
      nextItem: null,
      jackpotSetupRequired: false,
      pendingJackpotOverride: null,
      isMaster: true,
    };
    const adapted = adaptGamePlanToLegacyShape(resp);
    expect(adapted.currentGame).not.toBeNull();
    expect(adapted.currentGame?.id).toBe("run-1");
    expect(adapted.currentGame?.status).toBe("running");
    expect(adapted.currentGame?.subGameName).toBe("Spill 1 Hovedrunde");
    expect(adapted.currentGame?.actualStartTime).toBe("2026-05-07T11:00:00Z");
    expect(adapted.isMasterAgent).toBe(true);
    // halls returneres som placeholder-list med master-hallen
    expect(adapted.halls.length).toBe(1);
    expect(adapted.halls[0]?.hallId).toBe("hall-1");
  });

  it("mapper status-overganger riktig (idle → scheduled, paused → paused)", () => {
    const cat = makeCatalog();
    const baseResp: AgentGamePlanCurrentResponse = {
      hallId: "hall-1",
      businessDate: "2026-05-07",
      run: {
        id: "run-1",
        planId: "plan-1",
        hallId: "hall-1",
        businessDate: "2026-05-07",
        currentPosition: 1,
        status: "idle",
        jackpotOverrides: {},
        startedAt: null,
        finishedAt: null,
        masterUserId: null,
        createdAt: "2026-05-07T10:00:00Z",
        updatedAt: "2026-05-07T10:00:00Z",
      },
      plan: {
        id: "plan-1",
        name: "Plan A",
        description: null,
        hallId: "hall-1",
        groupOfHallsId: null,
        weekdays: ["mon"],
        startTime: "11:00",
        endTime: "23:00",
        isActive: true,
      },
      items: [],
      currentItem: {
        id: "i-1",
        position: 1,
        notes: null,
        catalogEntry: cat,
      },
      nextItem: null,
      jackpotSetupRequired: false,
      pendingJackpotOverride: null,
      isMaster: true,
    };

    expect(adaptGamePlanToLegacyShape(baseResp).currentGame?.status).toBe("scheduled");

    const pausedResp = {
      ...baseResp,
      run: { ...baseResp.run!, status: "paused" as const },
    };
    expect(adaptGamePlanToLegacyShape(pausedResp).currentGame?.status).toBe("paused");

    const finishedResp = {
      ...baseResp,
      run: { ...baseResp.run!, status: "finished" as const },
    };
    expect(adaptGamePlanToLegacyShape(finishedResp).currentGame?.status).toBe("completed");
  });
});
