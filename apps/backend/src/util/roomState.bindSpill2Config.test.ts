/**
 * Spill 2 re-design 2026-05-08: integrasjonstester for
 * `RoomStateManager.bindVariantConfigForRoom` med Spill 2-config-hook.
 *
 * Verifiserer at:
 *   - rocket-rom binder variantConfig fra Spill2Config (ikke default)
 *   - Variantens jackpotNumberTable + minTicketsBeforeCountdown speilte
 *     admin-konfig
 *   - Når fetchSpill2Config returnerer null, fallback til legacy-pacepath
 *     (DEFAULT_GAME2_CONFIG) fungerer
 *   - Spill 2-aliaser (game_2, tallspill) trigger samme hook
 *   - Andre slugs (bingo, monsterbingo, spillorama) IGNORERER hooken
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RoomStateManager } from "./roomState.js";
import type { Spill2Config } from "../game/Spill2ConfigService.js";

const MOCK_CONFIG: Spill2Config = {
  id: "spill2-default",
  openingTimeStart: "10:00",
  openingTimeEnd: "22:00",
  minTicketsToStart: 5,
  ticketPriceCents: 1000,
  roundPauseMs: 60000,
  ballIntervalMs: 4000,
  jackpotNumberTable: {
    "9":    { price: 5000, isCash: true },
    "10":   { price: 2500, isCash: true },
    "11":   { price: 1000, isCash: true },
    "12":   { price: 100,  isCash: false },
    "13":   { price: 75,   isCash: false },
    "1421": { price: 50,   isCash: false },
  },
  luckyNumberEnabled: true,
  luckyNumberPrizeCents: 50000,
  active: true,
  createdAt: "2026-05-08T00:00:00Z",
  updatedAt: "2026-05-08T00:00:00Z",
  updatedByUserId: null,
};

test("bind: rocket-rom bruker Spill2Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_A", {
    gameSlug: "rocket",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
  const variant = manager.getVariantConfig("ROOM_A");
  assert.ok(variant, "variantConfig skal være satt");
  assert.equal(variant!.gameType, "rocket");
  assert.equal(variant!.config.maxBallValue, 21);
  assert.equal(variant!.config.minTicketsBeforeCountdown, 5);
  assert.equal(variant!.config.jackpotNumberTable!["9"]?.price, 5000);
  assert.equal(variant!.config.luckyNumberPrize, 500); // 50000 øre → 500 kr
});

test("bind: tallspill-alias trigger samme hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_B", {
    gameSlug: "tallspill",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
  const variant = manager.getVariantConfig("ROOM_B");
  assert.ok(variant);
  assert.equal(variant!.config.maxBallValue, 21);
});

test("bind: game_2-alias trigger samme hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_C", {
    gameSlug: "game_2",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
});

test("bind: bingo-rom IGNORERER fetchSpill2Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_D", {
    gameSlug: "bingo",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 0, "Spill 2-hook skal ikke kalles for bingo");
  const variant = manager.getVariantConfig("ROOM_D");
  assert.ok(variant);
  assert.equal(variant!.gameType, "bingo");
});

test("bind: monsterbingo-rom (Spill 3) IGNORERER fetchSpill2Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_E", {
    gameSlug: "monsterbingo",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 0);
});

test("bind: spillorama-rom (SpinnGo) IGNORERER fetchSpill2Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_F", {
    gameSlug: "spillorama",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 0);
});

test("bind: rocket med null Spill2Config faller til legacy default", async () => {
  const manager = new RoomStateManager();
  await manager.bindVariantConfigForRoom("ROOM_G", {
    gameSlug: "rocket",
    fetchSpill2Config: async () => null,
  });
  const variant = manager.getVariantConfig("ROOM_G");
  assert.ok(variant);
  assert.equal(variant!.gameType, "rocket");
  // Default fallback har 21-ball drawbag også, men jackpot-tabellen
  // matcher DEFAULT_GAME2_CONFIG som er identisk med vår default-seed.
  assert.equal(variant!.config.maxBallValue, 21);
});

test("bind: rocket med thrown Spill2Config-feil faller til legacy default", async () => {
  const manager = new RoomStateManager();
  await manager.bindVariantConfigForRoom("ROOM_H", {
    gameSlug: "rocket",
    fetchSpill2Config: async () => {
      throw new Error("DB connection lost");
    },
  });
  const variant = manager.getVariantConfig("ROOM_H");
  assert.ok(variant);
  assert.equal(variant!.gameType, "rocket");
  assert.equal(variant!.config.maxBallValue, 21);
});

test("bind: variant-binding er idempotent (samme rom bindes ikke to ganger)", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_I", {
    gameSlug: "rocket",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  await manager.bindVariantConfigForRoom("ROOM_I", {
    gameSlug: "rocket",
    fetchSpill2Config: async () => {
      hookCalled += 1;
      return MOCK_CONFIG;
    },
  });
  assert.equal(hookCalled, 1, "andre bind skal være no-op");
});
