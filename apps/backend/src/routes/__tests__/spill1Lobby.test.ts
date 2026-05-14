/**
 * Public lobby-route for Spill 1 (2026-05-08): integrasjonstester.
 *
 * Tester `GET /api/games/spill1/lobby?hallId=X` ende-til-ende mot et
 * stub-laget Game1LobbyService:
 *   1. 200 + closed-state hvis service returnerer `closed`
 *   2. 200 + idle-state med plan-info + neste spill
 *   3. 200 + purchase_open-state med scheduled-game-data
 *   4. 400 INVALID_INPUT hvis hallId mangler
 *   5. 400 INVALID_INPUT hvis hallId er tom streng
 *   6. Cache-Control: no-store header på 200-svar
 *   7. Service-feil propagerer som 5xx
 *
 * Vi trenger ikke auth (public-rute), så ingen accessToken-mocking.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

import { createSpill1LobbyRouter } from "../spill1Lobby.js";
import type {
  Game1LobbyService,
  Game1LobbyState,
} from "../../game/Game1LobbyService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── stubs ────────────────────────────────────────────────────────────────

function makeStubLobbyService(opts: {
  /** Returner denne staten ved getLobbyState. */
  state?: Game1LobbyState;
  /** Eller kast denne feilen. */
  error?: Error | DomainError;
}): {
  service: Game1LobbyService;
  calls: { hallId: string }[];
} {
  const calls: { hallId: string }[] = [];
  const service = {
    async getLobbyState(hallId: string): Promise<Game1LobbyState> {
      calls.push({ hallId });
      if (opts.error) throw opts.error;
      if (opts.state) return opts.state;
      throw new Error("test-stub: ingen state eller error oppgitt");
    },
  } as unknown as Game1LobbyService;
  return { service, calls };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(service: Game1LobbyService): Promise<Ctx> {
  const app = express();
  app.use(express.json());
  app.use(createSpill1LobbyRouter({ lobbyService: service }));

  return new Promise<Ctx>((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://localhost:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

function makeIdleState(overrides: Partial<Game1LobbyState> = {}): Game1LobbyState {
  return {
    hallId: "hall-1",
    businessDate: "2026-05-08",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "21:00",
    planId: "gp-1",
    planName: "Pilot",
    runId: null,
    runStatus: null,
    overallStatus: "idle",
    nextScheduledGame: {
      itemId: "item-1",
      position: 1,
      catalogSlug: "bingo",
      catalogDisplayName: "Bingo",
      status: "idle",
      scheduledGameId: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      actualStartTime: null,
      // Fase 2 (2026-05-10): ticket-config eksponert via lobby
      ticketColors: ["hvit", "gul", "lilla"],
      ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
      prizeMultiplierMode: "auto",
      bonusGameSlug: null,
    },
    currentRunPosition: 0,
    totalPositions: 2,
    planCompletedForToday: false,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────

test("GET /api/games/spill1/lobby returnerer closed-state for hall uten plan", async () => {
  const { service, calls } = makeStubLobbyService({
    state: {
      hallId: "hall-1",
      businessDate: "2026-05-08",
      isOpen: false,
      openingTimeStart: null,
      openingTimeEnd: null,
      planId: null,
      planName: null,
      runId: null,
      runStatus: null,
      overallStatus: "closed",
      nextScheduledGame: null,
      currentRunPosition: 0,
      totalPositions: 0,
      planCompletedForToday: false,
    },
  });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=hall-1`);
    assert.equal(res.status, 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.isOpen, false);
    assert.equal(body.data.overallStatus, "closed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.hallId, "hall-1");
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby returnerer idle-state med neste spill", async () => {
  const { service } = makeStubLobbyService({ state: makeIdleState() });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=hall-1`);
    assert.equal(res.status, 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.isOpen, true);
    assert.equal(body.data.overallStatus, "idle");
    assert.equal(body.data.openingTimeStart, "11:00");
    assert.equal(body.data.openingTimeEnd, "21:00");
    assert.equal(body.data.nextScheduledGame.position, 1);
    assert.equal(body.data.nextScheduledGame.catalogSlug, "bingo");
    assert.equal(body.data.nextScheduledGame.scheduledGameId, null);
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby returnerer purchase_open + scheduledGameId", async () => {
  const state = makeIdleState({
    runId: "run-1",
    runStatus: "running",
    overallStatus: "purchase_open",
    currentRunPosition: 1,
    nextScheduledGame: {
      itemId: "item-1",
      position: 1,
      catalogSlug: "bingo",
      catalogDisplayName: "Bingo",
      status: "purchase_open",
      scheduledGameId: "sg-1",
      scheduledStartTime: "2026-05-08T12:00:00Z",
      scheduledEndTime: "2026-05-08T12:10:00Z",
      actualStartTime: null,
      ticketColors: ["hvit", "gul", "lilla"],
      ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
      prizeMultiplierMode: "auto",
      bonusGameSlug: null,
    },
  });
  const { service } = makeStubLobbyService({ state });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=hall-1`);
    assert.equal(res.status, 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.data.overallStatus, "purchase_open");
    assert.equal(body.data.nextScheduledGame.scheduledGameId, "sg-1");
    assert.equal(body.data.nextScheduledGame.status, "purchase_open");
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby returnerer 400 ved manglende hallId", async () => {
  const { service, calls } = makeStubLobbyService({ state: makeIdleState() });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby`);
    assert.equal(res.status, 400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INVALID_INPUT");
    // Tjenesten skal ikke kalles ved valideringsfeil.
    assert.equal(calls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby returnerer 400 ved tom hallId", async () => {
  const { service } = makeStubLobbyService({ state: makeIdleState() });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=`);
    assert.equal(res.status, 400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby setter Cache-Control: no-store på 200", async () => {
  const { service } = makeStubLobbyService({ state: makeIdleState() });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=hall-1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby trimmer hallId med whitespace", async () => {
  const { service, calls } = makeStubLobbyService({ state: makeIdleState() });
  const ctx = await startServer(service);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/games/spill1/lobby?hallId=${encodeURIComponent("  hall-1  ")}`,
    );
    assert.equal(res.status, 200);
    assert.equal(calls[0]?.hallId, "hall-1");
  } finally {
    await ctx.close();
  }
});

test("GET /api/games/spill1/lobby propagerer DomainError fra service", async () => {
  const { service } = makeStubLobbyService({
    error: new DomainError("INVALID_CONFIG", "noe gikk galt"),
  });
  const ctx = await startServer(service);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/games/spill1/lobby?hallId=hall-1`);
    assert.equal(res.status, 400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INVALID_CONFIG");
  } finally {
    await ctx.close();
  }
});
