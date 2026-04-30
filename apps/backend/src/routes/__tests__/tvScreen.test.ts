/**
 * Public TV Screen + Winners router-tester.
 *
 * Dekker:
 *   - Gyldig (hallId, tvToken) → 200 + shape-check state + winners
 *   - Ugyldig token → 404 NOT_FOUND (ikke 401/403 — bevisst uniform med 404
 *     for ukjent hall så enumeration ikke fungerer)
 *   - Ukjent hall → 404 NOT_FOUND
 *   - Inaktiv hall → 404 NOT_FOUND
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createTvScreenRouter } from "../tvScreen.js";
import type { PlatformService, HallDefinition } from "../../platform/PlatformService.js";
import type {
  TvScreenService,
  TvGameState,
  TvWinnersSummary,
} from "../../game/TvScreenService.js";
import { DomainError } from "../../errors/DomainError.js";

const validHall: HallDefinition = {
  id: "hall-1",
  slug: "hall-1",
  name: "Test Hall",
  region: "NO",
  address: "",
  isActive: true,
  clientVariant: "web",
  tvToken: "valid-token-abc",
  createdAt: "2026-04-23T00:00:00Z",
  updatedAt: "2026-04-23T00:00:00Z",
};

function makePlatformStub(voice: "voice1" | "voice2" | "voice3" = "voice1"): PlatformService {
  return {
    async verifyHallTvToken(hallId: string, tvToken: string): Promise<HallDefinition> {
      if (hallId === validHall.id && tvToken === validHall.tvToken) {
        return { ...validHall, tvVoiceSelection: voice };
      }
      throw new DomainError("TV_TOKEN_INVALID", "TV-token ugyldig.");
    },
    async getTvVoice(hallRef: string) {
      if (hallRef === validHall.id || hallRef === validHall.slug) return voice;
      throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
    },
  } as unknown as PlatformService;
}

function makeTvStub(
  state: TvGameState,
  winners: TvWinnersSummary
): TvScreenService {
  return {
    async getState() {
      return state;
    },
    async getWinners() {
      return winners;
    },
  } as unknown as TvScreenService;
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  state: TvGameState,
  winners: TvWinnersSummary,
  voice: "voice1" | "voice2" | "voice3" = "voice1",
): Promise<Ctx> {
  const app = express();
  app.use(express.json());
  app.use(
    createTvScreenRouter({
      platformService: makePlatformStub(voice),
      tvScreenService: makeTvStub(state, winners),
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const exampleState: TvGameState = {
  hall: { id: "hall-1", name: "Test Hall" },
  currentGame: {
    id: "sg-1",
    name: "Mystery Spill",
    number: 1,
    startAt: "2026-04-23T20:00:00Z",
    ballsDrawn: [71, 31, 1, 46, 75, 16],
    lastBall: 16,
  },
  patterns: [
    { name: "Row 1", phase: 1, playersWon: 5, prize: 10000, highlighted: true, hallNames: ["Test Hall"] },
    { name: "Row 2", phase: 2, playersWon: 0, prize: 0, highlighted: false, hallNames: [] },
    { name: "Row 3", phase: 3, playersWon: 0, prize: 0, highlighted: false, hallNames: [] },
    { name: "Row 4", phase: 4, playersWon: 0, prize: 0, highlighted: false, hallNames: [] },
    { name: "Full House", phase: 5, playersWon: 0, prize: 0, highlighted: false, hallNames: [] },
  ],
  drawnCount: 12,
  totalBalls: 75,
  fullHouseWinners: 0,
  patternsWon: 5,
  nextGame: { name: "Quick Bingo", startAt: "2026-04-23T21:00:00Z" },
  countdownToNextGame: null,
  status: "drawing",
  participatingHalls: [],
};

const exampleWinners: TvWinnersSummary = {
  totalNumbersWithdrawn: 74,
  fullHouseWinners: 1,
  patternsWon: 5,
  winners: [
    {
      pattern: "Row 1",
      phase: 1,
      playersWon: 5,
      prizePerTicket: 5000,
      hallName: "Test Hall",
    },
    {
      pattern: "Row 2",
      phase: 2,
      playersWon: 0,
      prizePerTicket: 0,
      hallName: "",
    },
    {
      pattern: "Row 3",
      phase: 3,
      playersWon: 0,
      prizePerTicket: 0,
      hallName: "",
    },
    {
      pattern: "Row 4",
      phase: 4,
      playersWon: 0,
      prizePerTicket: 0,
      hallName: "",
    },
    {
      pattern: "Full House",
      phase: 5,
      playersWon: 1,
      prizePerTicket: 20000,
      hallName: "Test Hall",
    },
  ],
};

test("GET /api/tv/:hallId/:tvToken/state returns state for valid token", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/${validHall.tvToken}/state`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: TvGameState };
    assert.equal(body.ok, true);
    assert.equal(body.data.hall.id, "hall-1");
    assert.equal(body.data.currentGame?.lastBall, 16);
    assert.deepEqual(body.data.currentGame?.ballsDrawn, [71, 31, 1, 46, 75, 16]);
    assert.equal(body.data.patterns.length, 5);
    assert.equal(body.data.patterns[0]!.highlighted, true);
    assert.equal(body.data.status, "drawing");
    // Bølge 1: drawnCount, totalBalls, nextGame skal være i response.
    assert.equal(body.data.drawnCount, 12);
    assert.equal(body.data.totalBalls, 75);
    assert.equal(body.data.nextGame?.name, "Quick Bingo");
    assert.equal(body.data.nextGame?.startAt, "2026-04-23T21:00:00Z");
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/winners returns summary for valid token", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/${validHall.tvToken}/winners`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: TvWinnersSummary };
    assert.equal(body.ok, true);
    assert.equal(body.data.totalNumbersWithdrawn, 74);
    assert.equal(body.data.fullHouseWinners, 1);
    assert.equal(body.data.patternsWon, 5);
    assert.equal(body.data.winners.length, 5);
    assert.equal(body.data.winners[4]!.pattern, "Full House");
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/state returns 404 for invalid token", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/wrong-token/state`
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/state returns 404 for unknown hall", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/hall-does-not-exist/${validHall.tvToken}/state`
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/winners returns 404 for invalid token", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/bogus/winners`
    );
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv with empty token component returns 404", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    // With empty path segment Express returns 404 from the routing layer.
    const res = await fetch(`${ctx.baseUrl}/api/tv/${validHall.id}//state`);
    // Either 404 from route-miss or 404 from our handler — both OK.
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

// ── Voice-config (wireframe PDF 14) ────────────────────────────────────────

test("GET /api/tv/:hallId/voice returns hall voice pack", async () => {
  const ctx = await startServer(exampleState, exampleWinners, "voice2");
  try {
    const res = await fetch(`${ctx.baseUrl}/api/tv/${validHall.id}/voice`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { voice: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.voice, "voice2");
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/voice returns 404 for unknown hall", async () => {
  const ctx = await startServer(exampleState, exampleWinners);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/tv/hall-does-not-exist/voice`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Fase 1 MVP §24: Screen Saver public endpoint ──────────────────────────

interface ScreenSaverImageStubInput {
  id: string;
  hallId: string | null;
  imageUrl: string;
  displaySeconds: number;
  displayOrder: number;
  isActive: boolean;
}

function makeScreenSaverStub(images: ScreenSaverImageStubInput[]): {
  getCarouselForHall: (hallId: string) => Promise<unknown[]>;
} {
  return {
    async getCarouselForHall(hallId: string) {
      // Globale + per-hall, kun aktive (ikke deletedAt — stub-en simulerer
      // det faktiske DB-filteret).
      return images
        .filter((img) => img.isActive)
        .filter((img) => img.hallId === null || img.hallId === hallId)
        .map((img) => ({
          id: img.id,
          hallId: img.hallId,
          imageUrl: img.imageUrl,
          displayOrder: img.displayOrder,
          displaySeconds: img.displaySeconds,
          isActive: img.isActive,
          createdBy: null,
          createdAt: "2026-04-30T12:00:00Z",
          updatedAt: "2026-04-30T12:00:00Z",
          deletedAt: null,
        }));
    },
  };
}

function makeSettingsStub(
  enabled: boolean,
  timeoutMinutes: number
): { list: () => Promise<unknown[]> } {
  return {
    async list() {
      return [
        {
          key: "branding.screen_saver_enabled",
          value: enabled,
          category: "branding",
          description: "",
          type: "boolean",
          isDefault: false,
          updatedByUserId: null,
          updatedAt: null,
        },
        {
          key: "branding.screen_saver_timeout_minutes",
          value: timeoutMinutes,
          category: "branding",
          description: "",
          type: "number",
          isDefault: false,
          updatedByUserId: null,
          updatedAt: null,
        },
      ];
    },
  };
}

async function startServerWithScreenSaver(
  enabled: boolean,
  timeoutMinutes: number,
  images: ScreenSaverImageStubInput[]
): Promise<Ctx> {
  const app = express();
  app.use(express.json());
  app.use(
    createTvScreenRouter({
      platformService: makePlatformStub(),
      tvScreenService: makeTvStub(exampleState, exampleWinners),
      screenSaverService: makeScreenSaverStub(images) as unknown as Parameters<
        typeof createTvScreenRouter
      >[0]["screenSaverService"],
      settingsService: makeSettingsStub(enabled, timeoutMinutes) as unknown as Parameters<
        typeof createTvScreenRouter
      >[0]["settingsService"],
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("GET /api/tv/:hallId/:tvToken/screen-saver returns enabled config + images", async () => {
  const ctx = await startServerWithScreenSaver(true, 3, [
    {
      id: "img-1",
      hallId: null,
      imageUrl: "https://cdn.example.com/global.png",
      displaySeconds: 10,
      displayOrder: 0,
      isActive: true,
    },
    {
      id: "img-2",
      hallId: validHall.id,
      imageUrl: "https://cdn.example.com/hall.png",
      displaySeconds: 15,
      displayOrder: 1,
      isActive: true,
    },
  ]);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/${validHall.tvToken}/screen-saver`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        enabled: boolean;
        timeoutMinutes: number;
        images: Array<{ id: string; imageUrl: string; displaySeconds: number; isGlobal: boolean }>;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.enabled, true);
    assert.equal(body.data.timeoutMinutes, 3);
    assert.equal(body.data.images.length, 2);
    const ids = body.data.images.map((i) => i.id).sort();
    assert.deepEqual(ids, ["img-1", "img-2"]);
    const global = body.data.images.find((i) => i.id === "img-1");
    assert.equal(global?.isGlobal, true);
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/screen-saver returns enabled=false when disabled", async () => {
  const ctx = await startServerWithScreenSaver(false, 2, [
    {
      id: "img-1",
      hallId: null,
      imageUrl: "https://cdn.example.com/global.png",
      displaySeconds: 10,
      displayOrder: 0,
      isActive: true,
    },
  ]);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/${validHall.tvToken}/screen-saver`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { enabled: boolean; images: unknown[] };
    };
    // Disabled-flagg respekteres selv om bilder finnes.
    assert.equal(body.data.enabled, false);
    assert.equal(body.data.images.length, 1);
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/screen-saver: enabled overrides false når ingen bilder", async () => {
  const ctx = await startServerWithScreenSaver(true, 2, []);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/${validHall.tvToken}/screen-saver`
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { enabled: boolean; images: unknown[] };
    };
    // Tomt bildesett → enabled=false (TV skal ikke prøve å rendre tom carousel).
    assert.equal(body.data.enabled, false);
    assert.equal(body.data.images.length, 0);
  } finally {
    await ctx.close();
  }
});

test("GET /api/tv/:hallId/:tvToken/screen-saver: 404 for invalid token", async () => {
  const ctx = await startServerWithScreenSaver(true, 2, []);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/tv/${validHall.id}/wrong-token/screen-saver`
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    await ctx.close();
  }
});
