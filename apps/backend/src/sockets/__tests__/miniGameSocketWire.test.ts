/**
 * BIN-MYSTERY Gap D: integrasjonstest for mini-game socket-wire.
 *
 * Verifiserer at hele flyt-en fra orchestrator → broadcaster → klient virker
 * for ALLE 5 M6 mini-games (felles wire). Vi tester med mystery-typen som
 * representant fordi pattern-en er identisk — wire-en er agnostisk for type.
 *
 * Dekning:
 *   - `mini_game:trigger` emittes til riktig user-rom (kun winner mottar)
 *   - `mini_game:result` emittes etter handleChoice (post-commit)
 *   - `mini_game:choice` lyttes server-side og driver orchestrator.handleChoice
 *   - User uten matchende userId mottar IKKE events (privacy + security)
 *   - Auth-feil i mini_game:choice → ack { ok: false }
 *
 * Mock-strategi:
 *   - `Game1MiniGameOrchestrator` mock-es med to hooks: setBroadcaster fanger
 *     broadcaster-instansen; handleChoice returnerer en deterministisk verdi
 *     for å verifisere at choice-handler kaller den med riktige args.
 *   - `platformService.getUserFromAccessToken` returnerer en av tre kjente
 *     test-brukere basert på token (samme pattern som adminGame1Namespace.test).
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server, type Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createMiniGameSocketWire } from "../miniGameSocketWire.js";
import type {
  Game1MiniGameOrchestrator,
  HandleChoiceInput,
  HandleChoiceResult,
  MiniGameBroadcaster,
} from "../../game/minigames/Game1MiniGameOrchestrator.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

const TEST_USERS: Record<string, PublicAppUser> = {
  "tok-winner": {
    id: "user-winner",
    email: "winner@test.no",
    displayName: "Winner",
    walletId: "wallet-winner",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  },
  "tok-other": {
    id: "user-other",
    email: "other@test.no",
    displayName: "Other",
    walletId: "wallet-other",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  },
};

const mockPlatform = {
  getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
    const u = TEST_USERS[token];
    if (!u) throw new Error(`UNAUTHORIZED: ukjent token "${token}"`);
    return { ...u };
  },
};

interface MockOrchestrator {
  service: Game1MiniGameOrchestrator;
  capturedBroadcaster: MiniGameBroadcaster | null;
  handleChoiceCalls: HandleChoiceInput[];
  setHandleChoiceImpl(
    impl: (input: HandleChoiceInput) => Promise<HandleChoiceResult>
  ): void;
}

function makeMockOrchestrator(): MockOrchestrator {
  let captured: MiniGameBroadcaster | null = null;
  const calls: HandleChoiceInput[] = [];
  let impl: (input: HandleChoiceInput) => Promise<HandleChoiceResult> = async (
    input
  ) => ({
    resultId: input.resultId,
    miniGameType: "mystery",
    payoutCents: 50_000,
    resultJson: { win: true, mocked: true },
  });

  const fake = {
    setBroadcaster(b: MiniGameBroadcaster): void {
      captured = b;
    },
    handleChoice(input: HandleChoiceInput): Promise<HandleChoiceResult> {
      calls.push({ ...input });
      return impl(input);
    },
  } as unknown as Game1MiniGameOrchestrator;

  return {
    service: fake,
    get capturedBroadcaster() {
      return captured;
    },
    handleChoiceCalls: calls,
    setHandleChoiceImpl(newImpl) {
      impl = newImpl;
    },
  };
}

// ── Server lifecycle ────────────────────────────────────────────────────────

interface Fixture {
  url: string;
  io: Server;
  orchestrator: MockOrchestrator;
  broadcaster: MiniGameBroadcaster;
  close: () => Promise<void>;
}

async function startServer(): Promise<Fixture> {
  const app = express();
  const httpSrv = http.createServer(app);
  const io = new Server(httpSrv, { cors: { origin: "*" } });

  const orchestrator = makeMockOrchestrator();
  const wire = createMiniGameSocketWire({
    io,
    orchestrator: orchestrator.service,
    platformService: mockPlatform as never,
  });
  orchestrator.service.setBroadcaster(wire.broadcaster);

  io.on("connection", (socket: ServerSocket) => {
    wire.register(socket);
  });

  await new Promise<void>((resolve) => httpSrv.listen(0, resolve));
  const addr = httpSrv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://localhost:${port}`,
    io,
    orchestrator,
    broadcaster: wire.broadcaster,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()));
    },
  };
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(
      () => reject(new Error("connect timeout")),
      3000
    );
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function disconnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.disconnected) return resolve();
    socket.once("disconnect", () => resolve());
    socket.disconnect();
  });
}

function waitForEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 1500
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      timeoutMs
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function emitWithAck<R>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<R> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (resp: R) => resolve(resp));
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Gap D: mini-game socket-wire — broadcast + choice handler", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await startServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  test("setBroadcaster blir kalt (orchestrator får non-noop broadcaster)", () => {
    assert.ok(
      fixture.orchestrator.capturedBroadcaster !== null,
      "setBroadcaster må være kalt fra wire-init"
    );
  });

  test("mini_game:join joiner user-rom og lar broadcaster.onTrigger nå klienten", async () => {
    const winner = await connect(fixture.url);
    try {
      const joinResp = await emitWithAck<{ ok: boolean }>(
        winner,
        "mini_game:join",
        { accessToken: "tok-winner" }
      );
      assert.equal(joinResp.ok, true);

      const receivedTrigger = waitForEvent<{
        scheduledGameId: string;
        resultId: string;
        type: string;
        payload: Record<string, unknown>;
      }>(winner, "mini_game:trigger");

      fixture.broadcaster.onTrigger({
        scheduledGameId: "sg-1",
        winnerUserId: "user-winner",
        resultId: "mgr-abc",
        miniGameType: "mystery",
        payload: { mocked: true },
        timeoutSeconds: 30,
      });

      const ev = await receivedTrigger;
      assert.equal(ev.scheduledGameId, "sg-1");
      assert.equal(ev.resultId, "mgr-abc");
      assert.equal(ev.type, "mystery");
      assert.deepEqual(ev.payload, { mocked: true });
    } finally {
      await disconnect(winner);
    }
  });

  test("broadcaster.onTrigger leveres KUN til winner — ikke til andre brukere", async () => {
    const winner = await connect(fixture.url);
    const other = await connect(fixture.url);
    try {
      await emitWithAck(winner, "mini_game:join", { accessToken: "tok-winner" });
      await emitWithAck(other, "mini_game:join", { accessToken: "tok-other" });

      let otherReceived = false;
      other.once("mini_game:trigger", () => {
        otherReceived = true;
      });

      const winnerWaiter = waitForEvent(winner, "mini_game:trigger");
      fixture.broadcaster.onTrigger({
        scheduledGameId: "sg-1",
        winnerUserId: "user-winner",
        resultId: "mgr-priv",
        miniGameType: "mystery",
        payload: {},
      });
      await winnerWaiter;
      // Gi event-loopen en sjanse til å levere feilen — fortsatt 0.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(otherReceived, false, "other-user skal IKKE motta trigger");
    } finally {
      await disconnect(winner);
      await disconnect(other);
    }
  });

  test("mini_game:choice driver orchestrator.handleChoice + ack returnerer payout", async () => {
    const winner = await connect(fixture.url);
    try {
      const ack = await emitWithAck<{
        ok: boolean;
        data?: { resultId: string; payoutCents: number; type: string };
        error?: { code: string };
      }>(winner, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-xyz",
        choice: { directions: ["up", "down", "up", "down", "up"] },
      });

      assert.equal(ack.ok, true);
      assert.equal(ack.data?.resultId, "mgr-xyz");
      assert.equal(ack.data?.payoutCents, 50_000);
      assert.equal(ack.data?.type, "mystery");

      assert.equal(fixture.orchestrator.handleChoiceCalls.length, 1);
      const call = fixture.orchestrator.handleChoiceCalls[0]!;
      assert.equal(call.resultId, "mgr-xyz");
      assert.equal(call.userId, "user-winner");
      assert.deepEqual(call.choiceJson, {
        directions: ["up", "down", "up", "down", "up"],
      });
    } finally {
      await disconnect(winner);
    }
  });

  test("mini_game:choice uten accessToken → ack { ok: false }", async () => {
    const sock = await connect(fixture.url);
    try {
      const ack = await emitWithAck<{
        ok: boolean;
        error?: { code: string };
      }>(sock, "mini_game:choice", {
        resultId: "mgr-x",
        choice: { foo: 1 },
      });
      assert.equal(ack.ok, false);
      assert.ok(ack.error);
      assert.equal(fixture.orchestrator.handleChoiceCalls.length, 0);
    } finally {
      await disconnect(sock);
    }
  });

  test("mini_game:choice uten resultId → ack { ok: false } (INVALID_INPUT)", async () => {
    const sock = await connect(fixture.url);
    try {
      const ack = await emitWithAck<{
        ok: boolean;
        error?: { code: string };
      }>(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        choice: { foo: 1 },
      });
      assert.equal(ack.ok, false);
      assert.equal(ack.error?.code, "INVALID_INPUT");
      assert.equal(fixture.orchestrator.handleChoiceCalls.length, 0);
    } finally {
      await disconnect(sock);
    }
  });

  test("mini_game:choice uten choice-objekt → ack { ok: false }", async () => {
    const sock = await connect(fixture.url);
    try {
      const ack = await emitWithAck<{
        ok: boolean;
        error?: { code: string };
      }>(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-1",
      });
      assert.equal(ack.ok, false);
      assert.equal(ack.error?.code, "INVALID_INPUT");
      assert.equal(fixture.orchestrator.handleChoiceCalls.length, 0);
    } finally {
      await disconnect(sock);
    }
  });

  test("orchestrator-feil (DomainError) bobles opp via ack med code", async () => {
    fixture.orchestrator.setHandleChoiceImpl(async () => {
      const { DomainError } = await import("../../game/BingoEngine.js");
      throw new DomainError(
        "MINIGAME_ALREADY_COMPLETED",
        "Mini-game er allerede spilt."
      );
    });

    const sock = await connect(fixture.url);
    try {
      const ack = await emitWithAck<{
        ok: boolean;
        error?: { code: string };
      }>(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-old",
        choice: { x: 1 },
      });
      assert.equal(ack.ok, false);
      assert.equal(ack.error?.code, "MINIGAME_ALREADY_COMPLETED");
    } finally {
      await disconnect(sock);
    }
  });

  test("broadcaster.onResult leveres til winner-rom med payout-detaljer", async () => {
    const winner = await connect(fixture.url);
    try {
      await emitWithAck(winner, "mini_game:join", { accessToken: "tok-winner" });

      const waiter = waitForEvent<{
        resultId: string;
        type: string;
        payoutCents: number;
        resultJson: Record<string, unknown>;
      }>(winner, "mini_game:result");

      fixture.broadcaster.onResult({
        scheduledGameId: "sg-1",
        winnerUserId: "user-winner",
        resultId: "mgr-done",
        miniGameType: "mystery",
        payoutCents: 100_000,
        resultJson: { final: true, prize: 1000 },
      });

      const ev = await waiter;
      assert.equal(ev.resultId, "mgr-done");
      assert.equal(ev.type, "mystery");
      assert.equal(ev.payoutCents, 100_000);
      assert.deepEqual(ev.resultJson, { final: true, prize: 1000 });
    } finally {
      await disconnect(winner);
    }
  });

  test("mini_game:choice etter lykkes ende-til-ende: choice → handleChoice → ack + result-broadcast", async () => {
    // Simuler at orchestrator.handleChoice broadcaster onResult selv (det er
    // det den ekte orchestratoren gjør i handleChoice.then() — vi mocker det
    // her ved å la handleChoiceImpl kalle broadcaster).
    fixture.orchestrator.setHandleChoiceImpl(async (input) => {
      const result = {
        resultId: input.resultId,
        miniGameType: "mystery" as const,
        payoutCents: 75_000,
        resultJson: { directions: input.choiceJson.directions },
      };
      fixture.broadcaster.onResult({
        scheduledGameId: "sg-real",
        winnerUserId: input.userId,
        resultId: input.resultId,
        miniGameType: "mystery",
        payoutCents: result.payoutCents,
        resultJson: result.resultJson,
      });
      return result;
    });

    const winner = await connect(fixture.url);
    try {
      await emitWithAck(winner, "mini_game:join", { accessToken: "tok-winner" });

      // Lytt på result-event PARALLELT med choice-emit.
      const resultWaiter = waitForEvent<{ payoutCents: number }>(
        winner,
        "mini_game:result"
      );

      const ack = await emitWithAck<{
        ok: boolean;
        data?: { payoutCents: number };
      }>(winner, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-ete",
        choice: { directions: ["up", "up", "up", "up", "up"] },
      });

      assert.equal(ack.ok, true);
      assert.equal(ack.data?.payoutCents, 75_000);

      const broadcastEv = await resultWaiter;
      assert.equal(broadcastEv.payoutCents, 75_000);
    } finally {
      await disconnect(winner);
    }
  });
});
