import assert from "node:assert/strict";
import test from "node:test";
import { CryptoRngProvider } from "./RngProvider.js";

test("getRoundDrawBag is idempotent for same roundId until released", () => {
  const provider = new CryptoRngProvider();

  const first = provider.getRoundDrawBag({
    roundId: "round-1",
    gameId: "game-1",
    roomCode: "ROOM1",
    maxNumber: 75
  });
  const second = provider.getRoundDrawBag({
    roundId: "round-1",
    gameId: "game-1",
    roomCode: "ROOM1",
    maxNumber: 75
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.requestId, second.requestId);
  assert.deepEqual(first.drawBag, second.drawBag);

  provider.releaseRound("round-1");
  const third = provider.getRoundDrawBag({
    roundId: "round-1",
    gameId: "game-1",
    roomCode: "ROOM1",
    maxNumber: 75
  });

  assert.equal(third.cacheHit, false);
  assert.notEqual(third.requestId, first.requestId);
});
