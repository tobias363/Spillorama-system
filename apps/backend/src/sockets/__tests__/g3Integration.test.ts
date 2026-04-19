/**
 * BIN-615 / PR-C3b: Game 3 end-to-end integration test.
 *
 * Validates the full runtime path:
 *   Socket connect → room:create (G3 slug) → variant-config seed →
 *   game:start → draw:next cycle → auto-claim → g3:pattern:* events on wire →
 *   Full House ends round.
 *
 * Unlike the happy-path unit tests in Game3Engine.test.ts, this asserts the
 * SOCKET layer correctly drains Game3Engine.getG3LastDrawEffects and emits
 * `g3:pattern:changed` + `g3:pattern:auto-won` to subscribed clients.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../../game/types.js";
import { DEFAULT_GAME3_CONFIG } from "../../game/variantConfig.js";
import { createTestServer, type TestServer } from "./testServer.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * 5×5 no-free-centre ticket with Row 1 = {1, 16, 31, 46, 61} (B/I/N/G/O col 0).
 * Matches the unit-test convention in Game3Engine.test.ts (buildRow1WinningTicket).
 */
function buildRow1WinningTicket(): Ticket {
  return {
    grid: [
      [ 1, 16, 31, 46, 61],  // Row 1 — completes on draw 1/16/31/46/61
      [ 2, 17, 32, 47, 62],
      [ 3, 18, 33, 48, 63],
      [ 4, 19, 34, 49, 64],
      [ 5, 20, 35, 50, 65],
    ],
  };
}

/** Simple G3-aware ticket adapter — returns a Row-1 winner for every request. */
class Row1WinnerTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: buildRow1WinningTicket().grid.map((r) => [...r]) };
  }
}

/**
 * Full-House-first ticket — every cell in column 0 is drawn early so the ticket
 * completes Row 1 at draw 5, then continues toward Full House as more balls land.
 * Draw bag sequence: 1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, ..., 65 (25 balls).
 */
function buildFullHouseTicket(): Ticket {
  return {
    grid: [
      [ 1, 16, 31, 46, 61],
      [ 2, 17, 32, 47, 62],
      [ 3, 18, 33, 48, 63],
      [ 4, 19, 34, 49, 64],
      [ 5, 20, 35, 50, 65],
    ],
  };
}

class FullHouseTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: buildFullHouseTicket().grid.map((r) => [...r]) };
  }
}

// Row-1 bag: balls 1, 16, 31, 46, 61 first; then fill remaining in ascending order.
function row1DrawBag(size: number): number[] {
  const first = [1, 16, 31, 46, 61];
  const rest: number[] = [];
  for (let n = 1; n <= size; n += 1) {
    if (!first.includes(n)) rest.push(n);
  }
  return [...first, ...rest];
}

// Full-House bag: column-0, column-1, ..., column-4 in turn. At draw 5 Row 1 lands;
// at draw 25 the full 5×5 grid has been drawn → Full House.
function fullHouseDrawBag(size: number): number[] {
  const gridCols: number[] = [];
  for (let col = 0; col < 5; col += 1) {
    for (let row = 0; row < 5; row += 1) {
      gridCols.push(1 + row + col * 15);
    }
  }
  const rest: number[] = [];
  for (let n = 1; n <= size; n += 1) {
    if (!gridCols.includes(n)) rest.push(n);
  }
  return [...gridCols, ...rest];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Game3 integration — g3:pattern:* events on wire", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer({
      useGame3Engine: true,
      bingoAdapter: new Row1WinnerTicketAdapter(),
      drawBagFactory: row1DrawBag,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  test("Row 1 win emits g3:pattern:auto-won to every subscribed client", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    // Both join the same G3 room. gameSlug=monsterbingo is required for
    // isGame3Round to opt into auto-claim semantics.
    const r1 = await alice.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r1.ok && r1.data, `room:create failed: ${r1.error?.message}`);
    const roomCode = r1.data.roomCode;

    const r2 = await bob.emit<AckResponse<{ playerId: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r2.ok && r2.data);

    // Seed G3 variant config on the room so requireAuthenticatedPlayerAction
    // + game:start resolves `patternEvalMode="auto-claim-on-draw"`.
    server.roomState.setVariantConfig(roomCode, {
      gameType: "monsterbingo",
      config: DEFAULT_GAME3_CONFIG,
    });

    // Arm both players so game:start enrols them.
    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    // Subscribe BEFORE game:start so we don't miss the early draw events.
    const g3Wins: unknown[] = [];
    const g3Changes: unknown[] = [];
    alice.socket.on("g3:pattern:auto-won", (p) => g3Wins.push(p));
    alice.socket.on("g3:pattern:changed", (p) => g3Changes.push(p));

    const startR = await alice.emit<AckResponse<{ snapshot: unknown }>>(
      "game:start", { roomCode, entryFee: 100, ticketsPerPlayer: 1 },
    );
    assert.ok(startR.ok, `game:start failed: ${startR.error?.message}`);

    // Draw 1..5 → Row 1 completes on draw 5 (ball 61). Auto-claim fires.
    for (let i = 0; i < 5; i += 1) {
      const dR = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      assert.ok(dR.ok, `draw ${i} failed: ${dR.error?.message}`);
    }

    // Brief wait for the event loop to flush broadcast emits.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(g3Wins.length >= 1, "expected g3:pattern:auto-won after Row 1 completion");
    const winPayload = g3Wins[0] as {
      roomCode: string;
      patternName: string;
      winnerPlayerIds: string[];
      prizePerWinner: number;
      drawIndex: number;
    };
    assert.equal(winPayload.roomCode, roomCode);
    assert.equal(winPayload.patternName, "Row 1");
    assert.equal(winPayload.drawIndex, 5);
    // prizePool = 2 × 100 entryFee = 200. Row 1 = 10% of pool = 20 kr.
    // Two winners share → round(20 / 2) = 10 kr each.
    assert.equal(winPayload.winnerPlayerIds.length, 2, "two winners share pattern");
    assert.equal(winPayload.prizePerWinner, 10);

    // `g3:pattern:changed` fired on the first draw (Row 1 activates when first ball lands).
    assert.ok(g3Changes.length >= 1, "expected g3:pattern:changed during round");
  });

  test("non-G3 room (gameSlug=bingo) does NOT emit g3:pattern:* events", async () => {
    // For this test we need a separate server configured with G1 slug + adapter.
    await server.close();
    server = await createTestServer({ useGame3Engine: true });

    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "bingo" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;
    await bob.emit<AckResponse>("room:create", { hallId: "hall-test", gameSlug: "bingo" });

    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    const g3Emits: unknown[] = [];
    alice.socket.on("g3:pattern:auto-won", (p) => g3Emits.push(p));
    alice.socket.on("g3:pattern:changed", (p) => g3Emits.push(p));

    await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(g3Emits.length, 0, "G1 round must not leak g3:* events");
  });
});

describe("Game3 integration — Full House terminates the round", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer({
      useGame3Engine: true,
      bingoAdapter: new FullHouseTicketAdapter(),
      drawBagFactory: fullHouseDrawBag,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  test("draw all 25 grid numbers → Full House wins, round ENDED, g3:pattern:auto-won fires", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;
    await bob.emit<AckResponse>("room:create", { hallId: "hall-test", gameSlug: "monsterbingo" });

    server.roomState.setVariantConfig(roomCode, {
      gameType: "monsterbingo",
      config: DEFAULT_GAME3_CONFIG,
    });

    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    const allWins: Array<{ patternName: string; drawIndex: number }> = [];
    alice.socket.on("g3:pattern:auto-won", (p) => allWins.push(p as { patternName: string; drawIndex: number }));

    await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 100, ticketsPerPlayer: 1 });
    // Draw all 25 grid cells — Row 1..4 cycle off via thresholds, Full House
    // lands on draw 25 and ends the round.
    for (let i = 0; i < 25; i += 1) {
      const r = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!r.ok) break;  // Engine may auto-end the round before draw 25 completes.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Row 1 hit on draw 5; Full House on draw 25.
    const fullHouseWin = allWins.find((w) => w.patternName === "Full House");
    assert.ok(fullHouseWin, `Full House auto-won not received. Got: ${JSON.stringify(allWins.map((w) => w.patternName))}`);
    assert.equal(fullHouseWin.drawIndex, 25);

    const stateR = await alice.emit<AckResponse<{ snapshot: { currentGame: { status: string; endedReason?: string } } }>>(
      "room:state", { roomCode },
    );
    assert.ok(stateR.ok && stateR.data);
    assert.equal(stateR.data.snapshot.currentGame.status, "ENDED");
    assert.equal(stateR.data.snapshot.currentGame.endedReason, "G3_FULL_HOUSE");
  });
});
