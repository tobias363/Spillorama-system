/**
 * PR B (variantConfig-admin-kobling): RoomStateManager.bindVariantConfigForRoom.
 *
 * Dekker:
 *   1. Uten gameManagementId → fallback til default (samme som
 *      bindDefaultVariantConfig).
 *   2. Med gameManagementId + fetch-hook som returnerer config.spill1 →
 *      mapperen kjører og patternsByColor er bundet.
 *   3. Fetcher returnerer null → fallback til default.
 *   4. Fetcher kaster → fallback til default, feil logges.
 *   5. Idempotent — andre kall er no-op hvis variant allerede er bundet.
 *   6. Ukjent gameSlug (ikke Spill 1) → fallback uten DB-lookup.
 *   7. extractSpill1Config: nested {spill1: {...}} vs direkte-shape.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "./roomState.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  PATTERNS_BY_COLOR_DEFAULT_KEY,
} from "../game/variantConfig.js";

function fresh(): RoomStateManager {
  return new RoomStateManager();
}

test("bindVariantConfigForRoom: uten gameManagementId → fallback (default-config)", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R1", { gameSlug: "bingo" });
  const info = rs.getVariantConfig("R1");
  assert.ok(info);
  // Default-pathen setter DEFAULT_NORSK_BINGO_CONFIG direkte — ingen patternsByColor.
  assert.strictEqual(info!.config, DEFAULT_NORSK_BINGO_CONFIG);
  assert.equal(info!.config.patternsByColor, undefined);
});

test("bindVariantConfigForRoom: med gameManagementId + spill1 → mapperen kjører + patternsByColor bundet", async () => {
  const rs = fresh();
  const fetchedConfig = {
    spill1: {
      ticketColors: [
        {
          color: "small_white",
          priceNok: 20,
          prizePerPattern: { row_1: { mode: "fixed", amount: 100 } },
        },
        {
          color: "small_yellow",
          priceNok: 15,
          prizePerPattern: { row_1: { mode: "fixed", amount: 50 } },
        },
      ],
    },
  };
  await rs.bindVariantConfigForRoom("R2", {
    gameSlug: "bingo",
    gameManagementId: "gm-1",
    fetchGameManagementConfig: async () => fetchedConfig,
  });
  const info = rs.getVariantConfig("R2");
  assert.ok(info);
  assert.ok(info!.config.patternsByColor, "patternsByColor skal være satt");
  assert.equal(info!.config.patternsByColor?.["Small White"]?.[0].prize1, 100);
  assert.equal(info!.config.patternsByColor?.["Small Yellow"]?.[0].prize1, 50);
  assert.ok(info!.config.patternsByColor?.[PATTERNS_BY_COLOR_DEFAULT_KEY]);
});

test("bindVariantConfigForRoom: fetcher returnerer null → fallback til default", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R3", {
    gameSlug: "bingo",
    gameManagementId: "gm-missing",
    fetchGameManagementConfig: async () => null,
  });
  const info = rs.getVariantConfig("R3");
  assert.ok(info);
  assert.strictEqual(info!.config, DEFAULT_NORSK_BINGO_CONFIG);
});

test("bindVariantConfigForRoom: fetcher kaster → fallback + ingen exception ut", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R4", {
    gameSlug: "bingo",
    gameManagementId: "gm-broken",
    fetchGameManagementConfig: async () => {
      throw new Error("DB connection lost");
    },
  });
  const info = rs.getVariantConfig("R4");
  assert.ok(info, "fallback må binde default selv om fetcher feiler");
  assert.strictEqual(info!.config, DEFAULT_NORSK_BINGO_CONFIG);
});

test("bindVariantConfigForRoom: idempotent — andre kall er no-op", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R5", { gameSlug: "bingo" });
  const first = rs.getVariantConfig("R5");
  await rs.bindVariantConfigForRoom("R5", {
    gameSlug: "bingo",
    gameManagementId: "gm-different",
    fetchGameManagementConfig: async () => ({
      spill1: {
        ticketColors: [{ color: "small_white", priceNok: 30 }],
      },
    }),
  });
  const second = rs.getVariantConfig("R5");
  // Andre kall skal ikke overstyre den første binding-en.
  assert.strictEqual(second!.config, first!.config);
});

test("bindVariantConfigForRoom: Spill 2/3 gameSlug → fetcher kalles for pace-config (admin-config-round-pace)", async () => {
  // Tobias 2026-05-04 (admin-config-round-pace): tidligere skipset binderen
  // fetcheren for ikke-Spill-1, men nå må Spill 2/3 også gjøre DB-oppslag
  // for å hente `roundPauseMs`/`ballIntervalMs` fra config.spill2/spill3.
  // Mangler pace-konfig → fortsatt default-variantConfig (verifisert under).
  const rs = fresh();
  let fetcherCalled = false;
  await rs.bindVariantConfigForRoom("R6", {
    gameSlug: "monsterbingo",
    gameManagementId: "gm-1",
    fetchGameManagementConfig: async () => {
      fetcherCalled = true;
      // Ingen spill3-pace-felt → faller til default. Spill 1-config
      // ignoreres for monsterbingo.
      return { spill1: { ticketColors: [] } };
    },
  });
  assert.equal(fetcherCalled, true, "fetcher skal kalles for Spill 2/3 så pace-config kan leses");
  const info = rs.getVariantConfig("R6");
  assert.ok(info);
  assert.equal(info!.gameType, "monsterbingo");
  // Default-variantConfig har ingen pace-felt — admin må sette dem.
  assert.equal(info!.config.roundPauseMs, undefined);
  assert.equal(info!.config.ballIntervalMs, undefined);
});

test("bindVariantConfigForRoom: Spill 2 → henter pace fra config.spill2 (admin-config-round-pace)", async () => {
  // Tobias 2026-05-04: admin-konfigurert pace overstyrer env-default. Vi
  // verifiserer at både roundPauseMs (rocket → perpetual-pause) og
  // ballIntervalMs (rocket → ball-interval) merges på toppen av defaults.
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R6b", {
    gameSlug: "rocket",
    gameManagementId: "gm-rocket",
    fetchGameManagementConfig: async () => ({
      spill2: {
        roundPauseMs: 45000,
        ballIntervalMs: 3000,
      },
    }),
  });
  const info = rs.getVariantConfig("R6b");
  assert.ok(info);
  assert.equal(info!.gameType, "rocket");
  assert.equal(info!.config.roundPauseMs, 45000);
  assert.equal(info!.config.ballIntervalMs, 3000);
  // Default-rocket-felt skal fortsatt være intakte.
  assert.equal(info!.config.maxBallValue, 21);
});

test("bindVariantConfigForRoom: Spill 3 → henter pace fra config.spill3 (admin-config-round-pace)", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R6c", {
    gameSlug: "monsterbingo",
    gameManagementId: "gm-monster",
    fetchGameManagementConfig: async () => ({
      spill3: {
        roundPauseMs: 60000,
        ballIntervalMs: 5000,
      },
    }),
  });
  const info = rs.getVariantConfig("R6c");
  assert.ok(info);
  assert.equal(info!.gameType, "monsterbingo");
  assert.equal(info!.config.roundPauseMs, 60000);
  assert.equal(info!.config.ballIntervalMs, 5000);
});

test("bindVariantConfigForRoom: ugyldig pace (utenfor MIN/MAX) → ignoreres, default beholdes", async () => {
  // Tobias 2026-05-04: defense-in-depth — admin-API validerer ved lagring,
  // men hvis en ugyldig verdi har sluppet inn i DB skal binderen ignorere
  // den (resolve-helperen falle til env-default i serviceanvenden).
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R6d", {
    gameSlug: "rocket",
    gameManagementId: "gm-bad",
    fetchGameManagementConfig: async () => ({
      spill2: {
        roundPauseMs: 999, // < MIN (1000)
        ballIntervalMs: 99999, // > MAX (10000)
      },
    }),
  });
  const info = rs.getVariantConfig("R6d");
  assert.ok(info);
  // Ingen pace-felt skal være satt på config — caller faller til env.
  assert.equal(info!.config.roundPauseMs, undefined);
  assert.equal(info!.config.ballIntervalMs, undefined);
});

test("bindVariantConfigForRoom: direkte-shape (uten spill1-wrapper) tolkes korrekt", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R7", {
    gameSlug: "bingo",
    gameManagementId: "gm-1",
    // Caller har allerede flatet ut config_json
    fetchGameManagementConfig: async () => ({
      ticketColors: [
        {
          color: "large_yellow",
          priceNok: 45,
          prizePerPattern: { full_house: { mode: "fixed", amount: 3000 } },
        },
      ],
    }),
  });
  const info = rs.getVariantConfig("R7");
  assert.ok(info);
  assert.equal(info!.config.patternsByColor?.["Large Yellow"]?.[4].prize1, 3000);
});

test("bindVariantConfigForRoom: spill1 mangler ticketColors → mapperen lager ren default-matrise", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R8", {
    gameSlug: "bingo",
    gameManagementId: "gm-empty",
    fetchGameManagementConfig: async () => ({
      spill1: { startTime: "18:00", ticketColors: [] },
    }),
  });
  const info = rs.getVariantConfig("R8");
  assert.ok(info);
  // Ingen farger → patternsByColor har bare __default__.
  const keys = Object.keys(info!.config.patternsByColor ?? {});
  assert.deepEqual(keys, [PATTERNS_BY_COLOR_DEFAULT_KEY]);
});

test("bindVariantConfigForRoom: gameManagementId satt men ingen fetcher → fallback", async () => {
  const rs = fresh();
  await rs.bindVariantConfigForRoom("R9", {
    gameSlug: "bingo",
    gameManagementId: "gm-no-hook",
    // Ingen fetchGameManagementConfig
  });
  const info = rs.getVariantConfig("R9");
  assert.strictEqual(info!.config, DEFAULT_NORSK_BINGO_CONFIG);
});
