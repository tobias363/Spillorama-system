import assert from "node:assert/strict";
import test from "node:test";
import { CandyLaunchTokenStore } from "./CandyLaunchTokenStore.js";

test("launch token is one-time and consumed exactly once", () => {
  const store = new CandyLaunchTokenStore({ ttlMs: 30_000 });
  const issued = store.issue({
    accessToken: "token-1",
    hallId: "hall-1",
    playerName: "Player One",
    walletId: "wallet-1",
    apiBaseUrl: "https://bingosystem-3.onrender.com"
  });

  const firstConsume = store.consume(issued.launchToken);
  assert.ok(firstConsume);
  assert.equal(firstConsume.accessToken, "token-1");
  assert.equal(firstConsume.hallId, "hall-1");
  assert.equal(firstConsume.playerName, "Player One");
  assert.equal(firstConsume.walletId, "wallet-1");
  assert.equal(firstConsume.apiBaseUrl, "https://bingosystem-3.onrender.com");

  const secondConsume = store.consume(issued.launchToken);
  assert.equal(secondConsume, null);
});

test("launch token expires and cannot be resolved after ttl", () => {
  let nowMs = Date.parse("2026-03-05T12:00:00.000Z");
  const store = new CandyLaunchTokenStore({
    ttlMs: 5_000,
    now: () => nowMs
  });

  const issued = store.issue({
    accessToken: "token-expiring",
    hallId: "hall-1",
    playerName: "Player Expiring",
    walletId: "wallet-1",
    apiBaseUrl: "https://bingosystem-3.onrender.com"
  });

  nowMs += 10_000;
  const expiredConsume = store.consume(issued.launchToken);
  assert.equal(expiredConsume, null);
});

test("blank launch token is rejected", () => {
  const store = new CandyLaunchTokenStore({ ttlMs: 60_000 });
  assert.equal(store.consume(""), null);
  assert.equal(store.consume("   "), null);
});
