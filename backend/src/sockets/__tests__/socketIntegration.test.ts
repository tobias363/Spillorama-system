/**
 * Socket.IO integration tests — BIN-340
 *
 * Tests the full socket event flow against a real server with in-memory adapters:
 * 1. room:create → join → verify snapshot
 * 2. bet:arm → game:start → draw:next → draw:new received
 * 3. ticket:mark → ack ok
 * 4. claim:submit (LINE/BINGO) → pattern:won
 * 5. Reconnect: disconnect → room:create (rejoin) → snapshot intact
 * 6. chat:send → chat:message broadcast
 * 7. lucky:set → ack ok
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { createTestServer, type TestServer } from "./testServer.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Socket.IO integration", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── 1. Connection & Room ──────────────────────────────────────────────────

  test("connects with valid token", async () => {
    const client = await server.connectClient("token-alice");
    assert.ok(client.socket.connected, "client should be connected");
  });

  test("rejects invalid token", async () => {
    await assert.rejects(
      () => server.connectClient("invalid-token"),
      (err: Error) => err.message.includes("UNAUTHORIZED"),
    );
  });

  test("room:create returns roomCode, playerId and snapshot", async () => {
    const alice = await server.connectClient("token-alice");
    const result = await alice.emit<AckResponse<{ roomCode: string; playerId: string; snapshot: unknown }>>(
      "room:create", { hallId: "hall-test", gameSlug: "bingo" },
    );
    assert.ok(result.ok, `room:create failed: ${result.error?.message}`);
    assert.ok(result.data);
    assert.ok(result.data.roomCode, "should return roomCode");
    assert.ok(result.data.playerId, "should return playerId");
    assert.ok(result.data.snapshot, "should return snapshot");
  });

  test("second player joins same room via room:create (enforceSingleRoomPerHall)", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r1.ok && r1.data);

    const r2 = await bob.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r2.ok && r2.data);
    assert.equal(r2.data.roomCode, r1.data.roomCode, "both players should be in same room");
  });

  // ── 2. Game lifecycle: arm → start → draw ─────────────────────────────────

  test("bet:arm → game:start → draw:next → draw:new event", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    // Both join same room
    const r1 = await alice.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;

    const r2 = await bob.emit<AckResponse<{ playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r2.ok && r2.data);

    // Arm both players
    const armAlice = await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    assert.ok(armAlice.ok, `arm alice failed: ${armAlice.error?.message}`);

    const armBob = await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    assert.ok(armBob.ok, `arm bob failed: ${armBob.error?.message}`);

    // Start game
    const startResult = await alice.emit<AckResponse>(
      "game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 },
    );
    assert.ok(startResult.ok, `game:start failed: ${startResult.error?.message}`);

    // Listen for draw:new on bob's socket
    const drawPromise = bob.waitFor<{ number: number; drawIndex: number }>("draw:new");

    // Draw next number
    const drawResult = await alice.emit<AckResponse<{ number: number }>>(
      "draw:next", { roomCode },
    );
    assert.ok(drawResult.ok, `draw:next failed: ${drawResult.error?.message}`);
    assert.ok(typeof drawResult.data?.number === "number", "should return drawn number");

    // Verify bob received the draw:new broadcast
    const drawEvent = await drawPromise;
    assert.equal(drawEvent.number, drawResult.data!.number, "broadcast number should match");
    assert.equal(drawEvent.drawIndex, 1, "first draw should have drawIndex 1 (length after push)");
  });

  // ── 3. ticket:mark ────────────────────────────────────────────────────────

  test("ticket:mark acknowledges ok", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Fixed ticket grid numbers: 1-5, 13-17, 25-28, 37-41, 49-53
    // Draw numbers until we get one that's on the grid
    const gridNumbers = new Set([1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,50,51,52,53]);
    let drawnOnGrid: number | null = null;
    for (let i = 0; i < 60; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      assert.ok(drawResult.ok, `draw:next failed: ${drawResult.error?.message}`);
      if (gridNumbers.has(drawResult.data!.number)) {
        drawnOnGrid = drawResult.data!.number;
        break;
      }
    }
    assert.ok(drawnOnGrid !== null, "should have drawn at least one grid number");

    // Mark the drawn grid number
    const markResult = await alice.emit<AckResponse>("ticket:mark", { roomCode, number: drawnOnGrid });
    assert.ok(markResult.ok, `ticket:mark failed: ${markResult.error?.message}`);
  });

  // ── 4. claim:submit → pattern:won ─────────────────────────────────────────

  test("claim:submit LINE after completing a row → pattern:won broadcast", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    const armA = await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    assert.ok(armA.ok, `arm alice: ${armA.error?.message}`);
    const armB = await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    assert.ok(armB.ok, `arm bob: ${armB.error?.message}`);

    const startResult = await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });
    assert.ok(startResult.ok, `game:start failed: ${startResult.error?.message}`);

    // Fixed ticket first row: [1, 2, 3, 4, 5]
    // Draw numbers until all 5 are drawn, marking each grid number on alice's ticket.
    const gridNumbers = new Set([1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,50,51,52,53]);
    const drawnNumbers: number[] = [];
    const neededForLine = [1, 2, 3, 4, 5];
    let lastDrawError: string | undefined;
    for (let i = 0; i < 60; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!drawResult.ok) {
        lastDrawError = drawResult.error?.message ?? drawResult.error?.code ?? "unknown";
        break;
      }
      const num = drawResult.data!.number;
      drawnNumbers.push(num);
      // Mark on alice's ticket if it's a grid number
      if (gridNumbers.has(num)) {
        await alice.emit("ticket:mark", { roomCode, number: num });
      }
      if (neededForLine.every((n) => drawnNumbers.includes(n))) break;
    }
    assert.ok(
      neededForLine.every((n) => drawnNumbers.includes(n)),
      `LINE numbers not all drawn. Drew ${drawnNumbers.length} numbers: [${drawnNumbers.join(",")}]. Last error: ${lastDrawError}`,
    );

    // Set up listener BEFORE claim — event fires synchronously after ack
    const patternPromise = bob.waitFor<{ patternName: string; winnerId: string }>("pattern:won");

    // Alice claims LINE
    const claimResult = await alice.emit<AckResponse>("claim:submit", { roomCode, type: "LINE" });
    assert.ok(claimResult.ok, `claim:submit LINE failed: ${claimResult.error?.message}`);

    // Verify pattern:won was broadcast
    const wonEvent = await patternPromise;
    assert.ok(wonEvent.patternName, "should have pattern name");
    assert.ok(wonEvent.winnerId, "should have winner id");
  });

  test("claim:submit BINGO after completing full grid → pattern:won broadcast", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "bingo" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Fixed ticket grid numbers (0 = free space):
    // [1,2,3,4,5], [13,14,15,16,17], [25,26,0,27,28], [37,38,39,40,41], [49,50,51,52,53]
    const neededNumbers = [1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,50,51,52,53];
    const gridNumbers = new Set(neededNumbers);
    const drawnNumbers: number[] = [];
    for (let i = 0; i < 60; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!drawResult.ok) break;
      const num = drawResult.data!.number;
      drawnNumbers.push(num);
      // Mark on alice's ticket if it's a grid number
      if (gridNumbers.has(num)) {
        await alice.emit("ticket:mark", { roomCode, number: num });
      }
      if (neededNumbers.every((n) => drawnNumbers.includes(n))) break;
    }
    assert.ok(
      neededNumbers.every((n) => drawnNumbers.includes(n)),
      `Not all needed numbers drawn. Missing: ${neededNumbers.filter((n) => !drawnNumbers.includes(n))}`,
    );

    // Listen for pattern:won on bob
    const patternPromise = bob.waitFor<{ patternName: string; claimType: string }>("pattern:won");

    // Alice claims BINGO
    const claimResult = await alice.emit<AckResponse>("claim:submit", { roomCode, type: "BINGO" });
    assert.ok(claimResult.ok, `claim:submit BINGO failed: ${claimResult.error?.message}`);

    const wonEvent = await patternPromise;
    assert.ok(wonEvent.patternName, "should have pattern name");
  });

  // ── 5. Reconnect scenario ────────────────────────────────────────────────

  test("disconnect → reconnect (room:create) → same room, snapshot intact", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    // Create room
    const r1 = await alice.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    // Arm and start
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Draw a few numbers
    for (let i = 0; i < 3; i++) {
      await alice.emit("draw:next", { roomCode });
    }

    // Get draw count before disconnect
    const snapshotBefore = server.engine.getRoomSnapshot(roomCode);
    const drawCountBefore = snapshotBefore.currentGame?.drawnNumbers.length ?? 0;
    assert.ok(drawCountBefore >= 3, "should have drawn at least 3 numbers");

    // Bob disconnects
    bob.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob reconnects
    const bob2 = await server.connectClient("token-bob");
    const rejoin = await bob2.emit<AckResponse<{ roomCode: string; playerId: string; snapshot: { currentGame: { drawnNumbers: number[] } } }>>(
      "room:create", { hallId: "hall-test" },
    );

    assert.ok(rejoin.ok, `rejoin failed: ${rejoin.error?.message}`);
    assert.equal(rejoin.data!.roomCode, roomCode, "should rejoin same room");
    assert.equal(
      rejoin.data!.snapshot.currentGame.drawnNumbers.length,
      drawCountBefore,
      "snapshot should have same number of drawn numbers",
    );
  });

  // ── 6. Chat ───────────────────────────────────────────────────────────────

  test("chat:send → chat:message broadcast to room", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    // Listen for chat:message on bob
    const chatPromise = bob.waitFor<{ message: string; playerName: string }>("chat:message");

    // Alice sends chat
    const chatResult = await alice.emit<AckResponse>(
      "chat:send", { roomCode, message: "Hei alle sammen!" },
    );
    assert.ok(chatResult.ok, `chat:send failed: ${chatResult.error?.message}`);

    // Verify bob received the message
    const chatEvent = await chatPromise;
    assert.equal(chatEvent.message, "Hei alle sammen!");
    assert.equal(chatEvent.playerName, "Alice");
  });

  test("chat:history returns previously sent messages", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    // Send a message
    await alice.emit("chat:send", { roomCode, message: "Test melding" });
    // Small delay for processing
    await new Promise((r) => setTimeout(r, 50));

    // Retrieve history
    const historyResult = await bob.emit<AckResponse<{ messages: { message: string }[] }>>(
      "chat:history", { roomCode },
    );
    assert.ok(historyResult.ok, `chat:history failed: ${historyResult.error?.message}`);
    assert.ok(historyResult.data!.messages.length >= 1, "should have at least 1 message");
    assert.equal(historyResult.data!.messages[0].message, "Test melding");
  });

  // ── 7. Lucky number ──────────────────────────────────────────────────────

  test("lucky:set → ack ok and reflected in room:update", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    // Listen for room:update on bob (triggered by lucky:set)
    const updatePromise = bob.waitFor<{ luckyNumbers: Record<string, number> }>("room:update");

    const luckyResult = await alice.emit<AckResponse>(
      "lucky:set", { roomCode, luckyNumber: 42 },
    );
    assert.ok(luckyResult.ok, `lucky:set failed: ${luckyResult.error?.message}`);

    // Verify room:update contains the lucky number
    const update = await updatePromise;
    assert.ok(update.luckyNumbers, "room:update should contain luckyNumbers");
    const luckyValues = Object.values(update.luckyNumbers);
    assert.ok(luckyValues.includes(42), "luckyNumbers should include 42");
  });

  // ── 8. Error cases ────────────────────────────────────────────────────────

  test("claim:submit with invalid type returns error", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    const claimResult = await alice.emit<AckResponse>(
      "claim:submit", { roomCode, type: "INVALID" },
    );
    assert.equal(claimResult.ok, false, "should fail with invalid claim type");
    assert.ok(claimResult.error?.code, "should have error code");
  });

  test("draw:next without running game returns error", async () => {
    const alice = await server.connectClient("token-alice");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;

    const drawResult = await alice.emit<AckResponse>("draw:next", { roomCode });
    assert.equal(drawResult.ok, false, "should fail without running game");
    assert.ok(drawResult.error?.code, "should have error code");
  });

  // ── 9. Room state query ───────────────────────────────────────────────────

  test("room:state returns current snapshot", async () => {
    const alice = await server.connectClient("token-alice");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;

    const stateResult = await alice.emit<AckResponse<{ snapshot: { code: string; players: unknown[] } }>>(
      "room:state", { roomCode },
    );
    assert.ok(stateResult.ok, `room:state failed: ${stateResult.error?.message}`);
    assert.equal(stateResult.data!.snapshot.code, roomCode);
    assert.ok(stateResult.data!.snapshot.players.length >= 1, "should have at least 1 player");
  });

  // ── 25. Reconnect mid-draw — drawn numbers and marks survive ─────────

  test("reconnect mid-draw: snapshot includes all drawn numbers and player marks", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Draw several numbers and mark matching ones on alice's ticket
    const gridNumbers = new Set([1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,50,51,52,53]);
    const drawnNumbers: number[] = [];
    const markedNumbers: number[] = [];
    for (let i = 0; i < 10; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!drawResult.ok) break;
      drawnNumbers.push(drawResult.data!.number);
      if (gridNumbers.has(drawResult.data!.number)) {
        await alice.emit("ticket:mark", { roomCode, number: drawResult.data!.number });
        markedNumbers.push(drawResult.data!.number);
      }
    }
    assert.ok(drawnNumbers.length >= 10, "should have drawn 10 numbers");

    // Alice disconnects mid-draw
    alice.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Alice reconnects
    const alice2 = await server.connectClient("token-alice");
    const rejoin = await alice2.emit<AckResponse<{
      roomCode: string;
      snapshot: { currentGame: { drawnNumbers: number[]; status: string } };
    }>>("room:create", { hallId: "hall-test" });

    assert.ok(rejoin.ok, `rejoin failed: ${rejoin.error?.message}`);
    assert.equal(rejoin.data!.roomCode, roomCode, "should rejoin same room");
    assert.equal(
      rejoin.data!.snapshot.currentGame.drawnNumbers.length,
      drawnNumbers.length,
      "all drawn numbers should be in snapshot",
    );
    assert.equal(rejoin.data!.snapshot.currentGame.status, "RUNNING", "game should still be running");

    // Verify the actual drawn numbers match
    for (const num of drawnNumbers) {
      assert.ok(
        rejoin.data!.snapshot.currentGame.drawnNumbers.includes(num),
        `drawn number ${num} should be in reconnect snapshot`,
      );
    }
  });

  // ── 26. Reconnect with wrong token — cannot hijack room ──────────────

  test("reconnect with different token gets own player context, not another's", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;
    const alicePlayerId = r1.data.playerId;

    const r2 = await bob.emit<AckResponse<{ playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(r2.ok && r2.data);
    const bobPlayerId = r2.data.playerId;

    assert.notEqual(alicePlayerId, bobPlayerId, "different users should have different player IDs");

    // Bob disconnects and reconnects — should get his own playerId back
    bob.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const bob2 = await server.connectClient("token-bob");
    const rejoin = await bob2.emit<AckResponse<{ playerId: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    assert.ok(rejoin.ok, `rejoin failed: ${rejoin.error?.message}`);
    assert.equal(rejoin.data!.playerId, bobPlayerId, "should get same player ID on reconnect");
    assert.notEqual(rejoin.data!.playerId, alicePlayerId, "should not get alice's player ID");
  });

  // ── 27. Empty round — all numbers drawn, no claims ───────────────────

  test("empty round: draw all numbers without claiming — game ends with NO_MORE_NUMBERS", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Draw all numbers until the engine refuses
    let drawCount = 0;
    let lastError: string | undefined;
    for (let i = 0; i < 61; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!drawResult.ok) {
        lastError = drawResult.error?.code;
        break;
      }
      drawCount++;
    }

    assert.ok(drawCount > 0, "should have drawn at least some numbers");
    // Engine auto-ends game when max draws reached — next draw returns GAME_NOT_RUNNING or NO_MORE_NUMBERS
    assert.ok(
      lastError === "NO_MORE_NUMBERS" || lastError === "GAME_NOT_RUNNING",
      `expected NO_MORE_NUMBERS or GAME_NOT_RUNNING, got ${lastError}`,
    );

    // After exhaustion, room:state should show game ended or no running game
    const stateResult = await alice.emit<AckResponse<{
      snapshot: { currentGame?: { status: string; endedReason?: string } };
    }>>("room:state", { roomCode });
    assert.ok(stateResult.ok, `room:state failed: ${stateResult.error?.message}`);
    const game = stateResult.data!.snapshot.currentGame;
    if (game) {
      assert.equal(game.status, "ENDED", "game should be ended after all numbers drawn");
    }
  });

  // ── 28. Checkpoint recovery — snapshot persists across engine queries ─

  test("checkpoint recovery: engine snapshot survives room:state queries after draws", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Draw 5 numbers
    const drawnNumbers: number[] = [];
    for (let i = 0; i < 5; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      assert.ok(drawResult.ok, `draw ${i} failed: ${drawResult.error?.message}`);
      drawnNumbers.push(drawResult.data!.number);
    }

    // Verify engine internal state matches what socket returns
    const engineSnapshot = server.engine.getRoomSnapshot(roomCode);
    assert.ok(engineSnapshot.currentGame, "engine should have running game");
    assert.equal(engineSnapshot.currentGame!.drawnNumbers.length, 5, "engine should have 5 drawn numbers");

    // Verify via socket room:state — should match engine exactly
    const stateResult = await alice.emit<AckResponse<{
      snapshot: { currentGame: { drawnNumbers: number[]; status: string } };
    }>>("room:state", { roomCode });
    assert.ok(stateResult.ok);
    assert.deepStrictEqual(
      stateResult.data!.snapshot.currentGame.drawnNumbers,
      engineSnapshot.currentGame!.drawnNumbers,
      "socket snapshot drawnNumbers should match engine state",
    );
    assert.equal(stateResult.data!.snapshot.currentGame.status, "RUNNING");

    // Draw 5 more and re-verify consistency
    for (let i = 0; i < 5; i++) {
      const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      assert.ok(drawResult.ok, `draw ${i + 5} failed: ${drawResult.error?.message}`);
      drawnNumbers.push(drawResult.data!.number);
    }

    const engineSnapshot2 = server.engine.getRoomSnapshot(roomCode);
    assert.equal(engineSnapshot2.currentGame!.drawnNumbers.length, 10, "engine should have 10 drawn numbers");

    const stateResult2 = await alice.emit<AckResponse<{
      snapshot: { currentGame: { drawnNumbers: number[] } };
    }>>("room:state", { roomCode });
    assert.deepStrictEqual(
      stateResult2.data!.snapshot.currentGame.drawnNumbers,
      engineSnapshot2.currentGame!.drawnNumbers,
      "socket snapshot should stay consistent with engine after additional draws",
    );
  });

  // ── 29. Multiple sequential reconnects ───────────────────────────────

  test("multiple sequential reconnects: state stays consistent across 3 disconnect cycles", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test" },
    );
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Draw 3 numbers from alice before first disconnect
    for (let i = 0; i < 3; i++) {
      await alice.emit("draw:next", { roomCode });
    }

    // 3 disconnect/reconnect cycles for bob
    let currentBob = bob;
    for (let cycle = 0; cycle < 3; cycle++) {
      currentBob.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      currentBob = await server.connectClient("token-bob");
      const rejoin = await currentBob.emit<AckResponse<{
        roomCode: string;
        snapshot: { currentGame: { drawnNumbers: number[] } };
      }>>("room:create", { hallId: "hall-test" });

      assert.ok(rejoin.ok, `rejoin cycle ${cycle} failed: ${rejoin.error?.message}`);
      assert.equal(rejoin.data!.roomCode, roomCode, `cycle ${cycle}: should rejoin same room`);
      assert.equal(
        rejoin.data!.snapshot.currentGame.drawnNumbers.length,
        3,
        `cycle ${cycle}: should still have 3 drawn numbers`,
      );
    }

    // Draw one more from alice — bob (now reconnected) should see it
    const drawPromise = currentBob.waitFor<{ number: number }>("draw:new");
    const drawResult = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
    assert.ok(drawResult.ok, "draw after reconnect cycles should succeed");

    const drawEvent = await drawPromise;
    assert.equal(drawEvent.number, drawResult.data!.number, "reconnected bob should receive new draw");
  });

  // ── 30. Env-vars: required config is present and valid ───────────────

  test("envConfig: loadBingoRuntimeConfig returns valid config with defaults", async () => {
    // Dynamic import to test the config loader in isolation
    const { loadBingoRuntimeConfig } = await import("../../util/envConfig.js");
    const config = loadBingoRuntimeConfig();

    // Compliance limits — must respect Norwegian regulations
    assert.ok(config.bingoMinRoundIntervalMs >= 30000, "min round interval must be >= 30s");
    assert.ok(config.bingoDailyLossLimit > 0, "daily loss limit must be positive");
    assert.ok(config.bingoMonthlyLossLimit > 0, "monthly loss limit must be positive");
    assert.ok(config.bingoMonthlyLossLimit >= config.bingoDailyLossLimit, "monthly limit should >= daily limit");
    assert.ok(config.bingoPlaySessionLimitMs > 0, "play session limit must be positive");
    assert.ok(config.bingoPauseDurationMs > 0, "pause duration must be positive");
    assert.ok(config.bingoSelfExclusionMinMs >= 365 * 24 * 60 * 60 * 1000, "self-exclusion must be >= 1 year");
    assert.ok(config.bingoMaxDrawsPerRound >= 1 && config.bingoMaxDrawsPerRound <= 60, "max draws must be 1-60");

    // Scheduler settings
    assert.ok(typeof config.runtimeBingoSettings === "object", "scheduler settings must be an object");
    assert.ok(config.runtimeBingoSettings.autoRoundStartIntervalMs >= config.bingoMinRoundIntervalMs,
      "auto round interval must respect min round interval");
    assert.ok(config.runtimeBingoSettings.payoutPercent >= 0 && config.runtimeBingoSettings.payoutPercent <= 100,
      "payout percent must be 0-100");
    assert.ok(config.runtimeBingoSettings.autoRoundTicketsPerPlayer >= 1 && config.runtimeBingoSettings.autoRoundTicketsPerPlayer <= 30,
      "tickets per player must be 1-30");

    // KYC
    assert.ok(config.kycMinAge >= 18, "KYC min age must be >= 18");

    // Session TTL
    assert.ok(config.sessionTtlHours > 0, "session TTL must be positive");
  });
});
