/**
 * Unit + integrasjonstester for `PerpetualRoundOpeningWindowGuard`.
 *
 * BIN-823 (regulatorisk pilot-go-live-blokker, Tobias 2026-05-08):
 *   "Veldig viktig at det ikke er mulig å kunne spille spillene etter
 *    stengetid. Er strenge regler på det fra Lotteritilsynet."
 *
 * Disse testene dekker beslutnings-tabellen i factory-en:
 *   1. Spill 3-slug → henter Spill3Config og kaller isWithinOpeningWindow
 *   2. Spill 2-slug → henter Spill2Config og kaller isWithinOpeningHours
 *   3. Ukjent slug → null (ingen guard, fail-open)
 *   4. DB-feil → null (fail-open)
 *   5. Slug-aliaser (game_2, tallspill, mønsterbingo, game_3) virker
 *
 * Mock-strategi: vi stub-ber `getActive()` på begge config-tjenestene siden
 * factory-en kun bruker den. Ingen Postgres, ingen Redis, ingen sockets —
 * alt kjører i-minne med fast frosset tid.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createPerpetualRoundOpeningWindowGuard,
  _SPILL2_SLUGS_FOR_GUARD,
  _SPILL3_SLUGS_FOR_GUARD,
} from "./PerpetualRoundOpeningWindowGuard.js";
import type { Spill2Config } from "./Spill2ConfigService.js";
import type { Spill3Config } from "./Spill3ConfigService.js";

// ── Test-fixtures ──────────────────────────────────────────────────────────

const DEFAULT_JACKPOT_TABLE = {
  "9":    { price: 5000, isCash: true },
  "10":   { price: 2500, isCash: true },
  "11":   { price: 1000, isCash: true },
  "12":   { price: 100,  isCash: false },
  "13":   { price: 75,   isCash: false },
  "1421": { price: 50,   isCash: false },
};

function spill2ConfigWithOpeningHours(
  start: string | null,
  end: string | null,
): Spill2Config {
  return {
    id: "spill2-test",
    openingTimeStart: start,
    openingTimeEnd: end,
    minTicketsToStart: 5,
    ticketPriceCents: 1000,
    roundPauseMs: 60_000,
    ballIntervalMs: 4_000,
    jackpotNumberTable: DEFAULT_JACKPOT_TABLE,
    luckyNumberEnabled: false,
    luckyNumberPrizeCents: null,
    active: true,
    createdAt: "2026-05-08T00:00:00Z",
    updatedAt: "2026-05-08T00:00:00Z",
    updatedByUserId: null,
  };
}

function spill3ConfigWithOpeningWindow(start: string, end: string): Spill3Config {
  return {
    id: "spill3-test",
    minTicketsToStart: 5,
    prizeMode: "fixed",
    prizeRad1Cents: 5000,
    prizeRad2Cents: 5000,
    prizeRad3Cents: 5000,
    prizeRad4Cents: 5000,
    prizeFullHouseCents: 50000,
    prizeRad1Pct: null,
    prizeRad2Pct: null,
    prizeRad3Pct: null,
    prizeRad4Pct: null,
    prizeFullHousePct: null,
    ticketPriceCents: 500,
    pauseBetweenRowsMs: 3000,
    openingTimeStart: start,
    openingTimeEnd: end,
    active: true,
    createdAt: "2026-05-08T00:00:00Z",
    updatedAt: "2026-05-08T00:00:00Z",
    updatedByUserId: null,
  };
}

interface StubServices {
  spill2ConfigService: { getActive: () => Promise<Spill2Config> };
  spill3ConfigService: { getActive: () => Promise<Spill3Config> };
  spill2Calls: number;
  spill3Calls: number;
}

function makeStubs(spill2: Spill2Config, spill3: Spill3Config): StubServices {
  const stubs = {
    spill2Calls: 0,
    spill3Calls: 0,
  } as StubServices;
  stubs.spill2ConfigService = {
    async getActive() {
      stubs.spill2Calls += 1;
      return spill2;
    },
  };
  stubs.spill3ConfigService = {
    async getActive() {
      stubs.spill3Calls += 1;
      return spill3;
    },
  };
  return stubs;
}

// ── Spill 2-pathen: regulatorisk hovedfokus for BIN-823 ────────────────────

test("Spill 2 (rocket): innenfor åpningstid (14:30 Oslo) → true", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T12:30:00Z"), // 14:30 Oslo CEST
  });

  const result = await guard({ roomCode: "ROCKET", gameSlug: "rocket" });
  assert.equal(result, true);
  assert.equal(stubs.spill2Calls, 1, "Spill2Config skal hentes for rocket-slug");
  assert.equal(stubs.spill3Calls, 0, "Spill3Config skal IKKE hentes");
});

test("Spill 2 (rocket): utenfor åpningstid (23:30 Oslo) → false (regulatorisk!)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T21:30:00Z"), // 23:30 Oslo CEST — etter stengetid
  });

  const result = await guard({ roomCode: "ROCKET", gameSlug: "rocket" });
  assert.equal(
    result,
    false,
    "Etter stengetid SKAL guard returnere false (BIN-823 regulatorisk)",
  );
});

test("Spill 2 (rocket): åpningstider null → alltid åpent (true)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours(null, null),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T03:00:00Z"), // 05:00 Oslo CEST — natt
  });

  const result = await guard({ roomCode: "ROCKET", gameSlug: "rocket" });
  assert.equal(
    result,
    true,
    "Null-vindu betyr 'alltid åpent' for Spill 2 (default-konfig)",
  );
});

test("Spill 2-aliaser: game_2 og tallspill håndteres samme som rocket", async () => {
  const stubs1 = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard1 = createPerpetualRoundOpeningWindowGuard({
    ...stubs1,
    now: () => new Date("2026-05-08T12:30:00Z"), // 14:30 Oslo
  });
  assert.equal(await guard1({ roomCode: "ROCKET", gameSlug: "game_2" }), true);
  assert.equal(stubs1.spill2Calls, 1);

  const stubs2 = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard2 = createPerpetualRoundOpeningWindowGuard({
    ...stubs2,
    now: () => new Date("2026-05-08T12:30:00Z"),
  });
  assert.equal(await guard2({ roomCode: "ROCKET", gameSlug: "tallspill" }), true);
  assert.equal(stubs2.spill2Calls, 1);
});

test("Spill 2 (rocket): DB-feil ved getActive() → null (fail-open)", async () => {
  const failingStubs = {
    spill2ConfigService: {
      async getActive(): Promise<Spill2Config> {
        throw new Error("Postgres connection lost");
      },
    },
    spill3ConfigService: {
      async getActive(): Promise<Spill3Config> {
        return spill3ConfigWithOpeningWindow("11:00", "23:00");
      },
    },
  };
  const guard = createPerpetualRoundOpeningWindowGuard(failingStubs);

  const result = await guard({ roomCode: "ROCKET", gameSlug: "rocket" });
  assert.equal(
    result,
    null,
    "DB-feil skal gi null (fail-open) — bedre å spawne enn å fryse pilot ved DB-glipp",
  );
});

// ── Spill 3-pathen: må fortsatt fungere uberørt etter refaktor ────────────

test("Spill 3 (monsterbingo): innenfor vindu (14:30 Oslo) → true", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T12:30:00Z"), // 14:30 Oslo CEST
  });

  const result = await guard({
    roomCode: "MONSTERBINGO",
    gameSlug: "monsterbingo",
  });
  assert.equal(result, true);
  assert.equal(stubs.spill3Calls, 1, "Spill3Config skal hentes for monsterbingo-slug");
  assert.equal(stubs.spill2Calls, 0, "Spill2Config skal IKKE hentes");
});

test("Spill 3 (monsterbingo): utenfor vindu (23:30 Oslo) → false", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T21:30:00Z"), // 23:30 Oslo
  });

  const result = await guard({
    roomCode: "MONSTERBINGO",
    gameSlug: "monsterbingo",
  });
  assert.equal(result, false);
});

test("Spill 3-aliaser: mønsterbingo og game_3 håndteres samme som monsterbingo", async () => {
  const stubs1 = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard1 = createPerpetualRoundOpeningWindowGuard({
    ...stubs1,
    now: () => new Date("2026-05-08T12:30:00Z"),
  });
  assert.equal(
    await guard1({ roomCode: "MB", gameSlug: "mønsterbingo" }),
    true,
  );
  assert.equal(stubs1.spill3Calls, 1);

  const stubs2 = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard2 = createPerpetualRoundOpeningWindowGuard({
    ...stubs2,
    now: () => new Date("2026-05-08T12:30:00Z"),
  });
  assert.equal(await guard2({ roomCode: "MB", gameSlug: "game_3" }), true);
  assert.equal(stubs2.spill3Calls, 1);
});

test("Spill 3 (monsterbingo): DB-feil ved getActive() → null (fail-open)", async () => {
  const failingStubs = {
    spill2ConfigService: {
      async getActive(): Promise<Spill2Config> {
        return spill2ConfigWithOpeningHours(null, null);
      },
    },
    spill3ConfigService: {
      async getActive(): Promise<Spill3Config> {
        throw new Error("Postgres connection lost");
      },
    },
  };
  const guard = createPerpetualRoundOpeningWindowGuard(failingStubs);

  const result = await guard({
    roomCode: "MONSTERBINGO",
    gameSlug: "monsterbingo",
  });
  assert.equal(result, null, "DB-feil skal gi null (fail-open) for Spill 3 også");
});

// ── Andre slugs: ingen guard ──────────────────────────────────────────────

test("Ukjent slug ('bingo' = Spill 1) → null (ingen guard)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T03:00:00Z"), // 05:00 Oslo
  });

  const result = await guard({ roomCode: "BINGO", gameSlug: "bingo" });
  assert.equal(result, null);
  assert.equal(stubs.spill2Calls, 0, "Hverken Spill 2- eller Spill 3-config skal hentes");
  assert.equal(stubs.spill3Calls, 0);
});

test("Ukjent slug ('themebingo') → null (ingen guard)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T03:00:00Z"),
  });

  const result = await guard({ roomCode: "X", gameSlug: "themebingo" });
  assert.equal(result, null);
});

test("Empty/ugyldig slug → null (ingen guard)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T03:00:00Z"),
  });

  assert.equal(await guard({ roomCode: "X", gameSlug: "" }), null);
  assert.equal(await guard({ roomCode: "X", gameSlug: "ROCKET" }), null); // case-sensitive
});

// ── Slug-set-paritet med kanonisk Game2/3 slug-set ────────────────────────

test("SPILL2_SLUGS_FOR_GUARD matcher kanonisk Game2AutoDrawTickService.GAME2_SLUGS", async () => {
  // Hvis dette feiler har noen endret GAME2_SLUGS uten å oppdatere guarden.
  const { GAME2_SLUGS } = await import("./Game2AutoDrawTickService.js");
  for (const slug of GAME2_SLUGS) {
    assert.ok(
      _SPILL2_SLUGS_FOR_GUARD.has(slug),
      `GAME2_SLUGS inneholder "${slug}" men guard-en gjenkjenner det ikke. Oppdater guarden.`,
    );
  }
  for (const slug of _SPILL2_SLUGS_FOR_GUARD) {
    assert.ok(
      GAME2_SLUGS.has(slug),
      `Guard-en har slug "${slug}" som ikke finnes i GAME2_SLUGS. Inkonsistent slug-set.`,
    );
  }
});

test("SPILL3_SLUGS_FOR_GUARD matcher kanonisk Game3AutoDrawTickService.GAME3_SLUGS", async () => {
  const { GAME3_SLUGS } = await import("./Game3AutoDrawTickService.js");
  for (const slug of GAME3_SLUGS) {
    assert.ok(
      _SPILL3_SLUGS_FOR_GUARD.has(slug),
      `GAME3_SLUGS inneholder "${slug}" men guard-en gjenkjenner det ikke. Oppdater guarden.`,
    );
  }
  for (const slug of _SPILL3_SLUGS_FOR_GUARD) {
    assert.ok(
      GAME3_SLUGS.has(slug),
      `Guard-en har slug "${slug}" som ikke finnes i GAME3_SLUGS. Inkonsistent slug-set.`,
    );
  }
});

// ── Edge cases for boundary-exact tider ──────────────────────────────────

test("Spill 2 boundary: nøyaktig på openingTimeStart (11:00 Oslo) → true (inklusiv)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T09:00:00Z"), // 11:00 Oslo CEST exact
  });

  assert.equal(await guard({ roomCode: "R", gameSlug: "rocket" }), true);
});

test("Spill 2 boundary: nøyaktig på openingTimeEnd (23:00 Oslo) → false (eksklusiv)", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T21:00:00Z"), // 23:00 Oslo CEST exact
  });

  assert.equal(
    await guard({ roomCode: "R", gameSlug: "rocket" }),
    false,
    "Spillet stenger på selve stengetidspunktet — eksklusiv end (regulatorisk)",
  );
});

test("Spill 2 boundary: 1 minutt før stengetid (22:59 Oslo) → true", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T20:59:00Z"), // 22:59 Oslo CEST
  });

  assert.equal(await guard({ roomCode: "R", gameSlug: "rocket" }), true);
});

test("Spill 2 boundary: 1 minutt etter stengetid (23:01 Oslo) → false", async () => {
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours("11:00", "23:00"),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard({
    ...stubs,
    now: () => new Date("2026-05-08T21:01:00Z"), // 23:01 Oslo CEST
  });

  assert.equal(
    await guard({ roomCode: "R", gameSlug: "rocket" }),
    false,
    "1 minutt etter stengetid skal være closed",
  );
});

// ── Default now() (uten clock-injection) ──────────────────────────────────

test("Default now() — bygger guard uten å eksplodere når now ikke er injisert", async () => {
  // Sanity-test: hvis vi bygger uten `now`-callback skal det fortsatt fungere
  // (production-modus). Vi kan ikke assert konkret resultat siden tiden er
  // ekte, men vi kan verifisere at calls ikke kaster.
  const stubs = makeStubs(
    spill2ConfigWithOpeningHours(null, null),
    spill3ConfigWithOpeningWindow("11:00", "23:00"),
  );
  const guard = createPerpetualRoundOpeningWindowGuard(stubs);

  // Spill 2 med null-vindu → alltid true uavhengig av tid.
  assert.equal(await guard({ roomCode: "R", gameSlug: "rocket" }), true);
});
