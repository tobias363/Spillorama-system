/**
 * Spill 3 re-design 2026-05-08: integrasjonstester for
 * `RoomStateManager.bindVariantConfigForRoom` med Spill 3-config-hook.
 *
 * Verifiserer at:
 *   - monsterbingo-rom binder variantConfig fra Spill3Config (ikke default)
 *   - Patterns har korrekt 5-fase shape (Row 1-4 + Full House)
 *   - Når fetchSpill3Config returnerer null, fallback til
 *     legacy-pacepath fungerer
 *   - Andre Spill 3-aliaser (mønsterbingo, game_3) trigger samme hook
 *   - Spill 1 / Spill 2 / SpinnGo IGNORERER fetchSpill3Config (hooken
 *     skal aldri kalles for disse slugene)
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RoomStateManager } from "./roomState.js";
import type { Spill3Config } from "../game/Spill3ConfigService.js";

const MOCK_PERCENTAGE_CONFIG: Spill3Config = {
  id: "spill3-default",
  minTicketsToStart: 25,
  prizeMode: "percentage",
  prizeRad1Cents: null,
  prizeRad2Cents: null,
  prizeRad3Cents: null,
  prizeRad4Cents: null,
  prizeFullHouseCents: null,
  prizeRad1Pct: 5,
  prizeRad2Pct: 8,
  prizeRad3Pct: 12,
  prizeRad4Pct: 15,
  prizeFullHousePct: 30,
  ticketPriceCents: 500,
  pauseBetweenRowsMs: 3000,
  active: true,
  createdAt: "2026-05-08T00:00:00Z",
  updatedAt: "2026-05-08T00:00:00Z",
  updatedByUserId: null,
};

test("bind: monsterbingo-rom bruker Spill3Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_A", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
  const variant = manager.getVariantConfig("ROOM_A");
  assert.ok(variant, "variantConfig skal være satt");
  assert.equal(variant!.gameType, "monsterbingo");
  // 5 patterns (Row 1-4 + Full House) — distinkt fra 4 default-patterns.
  assert.equal(variant!.config.patterns.length, 5);
  assert.equal(variant!.config.patterns[0]?.name, "1 Rad");
  assert.equal(variant!.config.patterns[4]?.name, "Fullt Hus");
  assert.equal(variant!.config.minTicketsBeforeCountdown, 25);
});

test("bind: mønsterbingo-alias trigger samme hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_B", {
    gameSlug: "mønsterbingo",  // Norsk-alias
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
  const variant = manager.getVariantConfig("ROOM_B");
  assert.ok(variant);
  assert.equal(variant!.config.patterns.length, 5);
});

test("bind: game_3-alias trigger samme hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_C", {
    gameSlug: "game_3",  // Legacy-alias
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 1);
});

test("bind: bingo-rom IGNORERER fetchSpill3Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_D", {
    gameSlug: "bingo",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  // Hook skal ALDRI kalles for Spill 1.
  assert.equal(hookCalled, 0);
  const variant = manager.getVariantConfig("ROOM_D");
  assert.ok(variant);
  assert.equal(variant!.gameType, "bingo");
});

test("bind: rocket-rom (Spill 2) IGNORERER fetchSpill3Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_E", {
    gameSlug: "rocket",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 0);
});

test("bind: spillorama-rom (SpinnGo) IGNORERER fetchSpill3Config-hook", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_F", {
    gameSlug: "spillorama",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 0);
});

test("bind: monsterbingo med null Spill3Config faller til legacy default", async () => {
  const manager = new RoomStateManager();
  await manager.bindVariantConfigForRoom("ROOM_G", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => null,
  });
  const variant = manager.getVariantConfig("ROOM_G");
  assert.ok(variant);
  assert.equal(variant!.gameType, "monsterbingo");
  // Default-config har 4 designs-patterns (Topp+midt, Kryss, etc.).
  // Med null Spill3Config faller vi tilbake til DEFAULT_GAME3_CONFIG.
  assert.equal(variant!.config.patterns.length, 4);
});

test("bind: monsterbingo med thrown Spill3Config-feil faller til legacy default", async () => {
  const manager = new RoomStateManager();
  await manager.bindVariantConfigForRoom("ROOM_H", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => {
      throw new Error("DB connection lost");
    },
  });
  const variant = manager.getVariantConfig("ROOM_H");
  assert.ok(variant, "Skal fortsatt sette variantConfig (legacy-fallback)");
  assert.equal(variant!.gameType, "monsterbingo");
});

test("bind: fixed-mode Spill3Config gir prize1 i kr på patterns", async () => {
  const manager = new RoomStateManager();
  const fixedConfig: Spill3Config = {
    ...MOCK_PERCENTAGE_CONFIG,
    prizeMode: "fixed",
    prizeRad1Cents: 5000,
    prizeRad2Cents: 8000,
    prizeRad3Cents: 12000,
    prizeRad4Cents: 15000,
    prizeFullHouseCents: 30000,
    prizeRad1Pct: null,
    prizeRad2Pct: null,
    prizeRad3Pct: null,
    prizeRad4Pct: null,
    prizeFullHousePct: null,
  };
  await manager.bindVariantConfigForRoom("ROOM_I", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => fixedConfig,
  });
  const variant = manager.getVariantConfig("ROOM_I");
  assert.ok(variant);
  // Fixed-mode: winningType="fixed", prize1 i kr.
  assert.equal(variant!.config.patterns[0]?.winningType, "fixed");
  assert.equal(variant!.config.patterns[0]?.prize1, 50);  // 5000 øre = 50 kr
  assert.equal(variant!.config.patterns[4]?.prize1, 300); // 30000 øre = 300 kr
});

test("bind: variant-binding er idempotent (samme rom bindes ikke to ganger)", async () => {
  const manager = new RoomStateManager();
  let hookCalled = 0;
  await manager.bindVariantConfigForRoom("ROOM_J", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  // Andre kall: skal være no-op (rom har allerede config).
  await manager.bindVariantConfigForRoom("ROOM_J", {
    gameSlug: "monsterbingo",
    fetchSpill3Config: async () => {
      hookCalled += 1;
      return MOCK_PERCENTAGE_CONFIG;
    },
  });
  assert.equal(hookCalled, 1, "Hook skal kun kalles én gang per rom");
});
