/**
 * Bølge K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1):
 *
 * Quarantine-tester for `assertSpill1NotAdHoc`. BingoEngine er nå
 * Spill 2/3 + Demo Hall/test-haller-only for Spill 1 i production.
 * Production retail Spill 1 (gameSlug=bingo, !isTestHall, !scheduledGameId)
 * MÅ kjøre via Game1DrawEngineService — disse testene verifiserer at
 * BingoEngine kaster `USE_SCHEDULED_API` for slike forsøk.
 *
 * Sjekker:
 *   1. Production retail Spill 1 (slug bingo, !isTestHall) → startGame
 *      kaster USE_SCHEDULED_API.
 *   2. Production retail Spill 1 → drawNextNumber kaster USE_SCHEDULED_API.
 *      (Vi må sette opp scenarioet via en lavere-nivå-call siden startGame
 *      blokkeres — bruker isTestHall-fixture og setter til false POST.)
 *   3. Production retail Spill 1 → submitClaim kaster USE_SCHEDULED_API.
 *   4. Production retail Spill 1 → endGame kaster USE_SCHEDULED_API.
 *   5. Production retail Spill 1 → pauseGame kaster USE_SCHEDULED_API.
 *   6. Production retail Spill 1 → resumeGame kaster USE_SCHEDULED_API.
 *   7. Production Spill 1 + isTestHall=true → startGame fungerer
 *      (Demo Hall bypass).
 *   8. Production Spill 1 + scheduledGameId → kaster USE_SCHEDULED_API
 *      (assertNotScheduled tar over først, forventet melding peker mot
 *      scheduled-engine).
 *   9. Production Spill 2 (rocket) → IKKE påvirket av quarantine-guarden.
 *   10. Production Spill 3 (monsterbingo) → IKKE påvirket.
 *   11. Test-runtime (isProductionRuntime=false) + ad-hoc Spill 1 →
 *       fortsetter å virke (eksisterende tester forblir grønne).
 *   12. DomainError details inkluderer roomCode, gameSlug, hallId,
 *       isTestHall (debug-info for ops).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine } from "./BingoEngine.js";
import { DomainError } from "../errors/DomainError.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const FIXED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((r) => [...r]) };
  }
}

/**
 * Production-runtime engine: setter `isProductionRuntime: true` så
 * `assertSpill1NotAdHoc` aktiveres.
 */
function makeProductionEngine(): BingoEngine {
  return new BingoEngine(new FixedGridAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
    isProductionRuntime: true,
  });
}

/**
 * Test/dev-runtime engine: `isProductionRuntime` ikke satt → guard er
 * no-op. Brukes i siste test for å verifisere bakoverkompatibilitet.
 */
function makeTestEngine(): BingoEngine {
  return new BingoEngine(new FixedGridAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });
}

// ── 1: production retail Spill 1 — startGame blokkert ───────────────────────

test("K3: production Spill 1 (slug=bingo, !isTestHall) — startGame kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-1",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    // INGEN isTestHall — dette er retail-flyten.
  });

  await assert.rejects(
    () =>
      engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      // Feilmeldingen må peke mot scheduled-engine for ops/debug.
      assert.match(
        (err as DomainError).message,
        /scheduled|Game1DrawEngineService/i,
      );
      return true;
    },
  );
});

// ── 2: production retail Spill 1 — drawNextNumber blokkert ──────────────────
//
// drawNextNumber kjøres normalt etter startGame, men siden startGame er
// blokkert må vi verifisere at guard er aktiv på begge — ellers ville
// en alternativ kall-vei (test-hall som flippes mid-runde) kunne lekke.
// Vi simulerer ved å starte spill med isTestHall=true, deretter flippe
// flagget av før drawNextNumber kalles. Production-guarden skal kicke inn
// på neste kall.

test("K3: production Spill 1 — drawNextNumber kaster USE_SCHEDULED_API når isTestHall flips off mid-runde", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-2",
    playerName: "Bob",
    walletId: "w-bob",
    gameSlug: "bingo",
    isTestHall: true, // start som test-hall
  });
  // Start spill mens test-flagget er PÅ.
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  // Admin/operasjonell endring: flipper rommet til ikke-test (simulerer
  // at hall_is_test ble fjernet i DB og setRoomTestHall ble kalt med
  // false). Etter dette skal alle videre mutasjoner kaste.
  engine.setRoomTestHall(roomCode, false);

  await assert.rejects(
    () =>
      engine.drawNextNumber({
        roomCode,
        actorPlayerId: playerId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 3: production retail Spill 1 — submitClaim blokkert ─────────────────────

test("K3: production Spill 1 — submitClaim kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-3",
    playerName: "Carol",
    walletId: "w-carol",
    gameSlug: "bingo",
    isTestHall: true,
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  engine.setRoomTestHall(roomCode, false);

  await assert.rejects(
    () =>
      engine.submitClaim({
        roomCode,
        playerId,
        type: "BINGO",
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 4: production retail Spill 1 — endGame blokkert ─────────────────────────

test("K3: production Spill 1 — endGame kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-4",
    playerName: "Dave",
    walletId: "w-dave",
    gameSlug: "bingo",
    isTestHall: true,
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  engine.setRoomTestHall(roomCode, false);

  await assert.rejects(
    () =>
      engine.endGame({
        roomCode,
        actorPlayerId: playerId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 5: production retail Spill 1 — pauseGame blokkert ───────────────────────

test("K3: production Spill 1 — pauseGame kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-5",
    playerName: "Eve",
    walletId: "w-eve",
    gameSlug: "bingo",
    isTestHall: true,
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  engine.setRoomTestHall(roomCode, false);

  assert.throws(
    () => engine.pauseGame(roomCode, "test"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 6: production retail Spill 1 — resumeGame blokkert ──────────────────────

test("K3: production Spill 1 — resumeGame kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-6",
    playerName: "Frank",
    walletId: "w-frank",
    gameSlug: "bingo",
    isTestHall: true,
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  engine.pauseGame(roomCode, "test pause"); // mens isTestHall=true → ok
  engine.setRoomTestHall(roomCode, false);

  assert.throws(
    () => engine.resumeGame(roomCode),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 7: Demo Hall bypass — isTestHall=true tillater ad-hoc Spill 1 ───────────

test("K3: Demo Hall (isTestHall=true) — Spill 1 startGame fungerer i production", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "demo-hall",
    playerName: "Demo Player",
    walletId: "w-demo",
    gameSlug: "bingo",
    isTestHall: true,
  });

  // Skal IKKE kaste — Demo Hall får fortsatt ad-hoc-flyt.
  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
  // Hele flyten må fungere.
  await assert.doesNotReject(() =>
    engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    }),
  );
});

// ── 8: scheduled Spill 1 i production — assertNotScheduled tar over ─────────
//
// Når en bingo-rom er BÅDE markert som scheduled OG ikke test-hall, er
// `assertNotScheduled` (CRIT-4) som kicker først og kaster USE_SCHEDULED_API.
// Begge guarder gir samme error code, så testen verifiserer kun at guarden
// fyrer — ikke hvilken av de to. Detail-payloaden inneholder enten
// scheduledGameId (assertNotScheduled) eller hallId/isTestHall (K3).

test("K3: production scheduled Spill 1 — kaster USE_SCHEDULED_API", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-scheduled",
    playerName: "Grace",
    walletId: "w-grace",
    gameSlug: "bingo",
    isTestHall: true, // start ad-hoc, så marker som scheduled etterpå
  });
  // Start spill mens isTestHall=true
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  // Marker scheduled OG fjern test-hall-flagget — nå er det produksjons-
  // retail scheduled, som assertNotScheduled blokkerer.
  engine.markRoomAsScheduled(roomCode, "sg-grace");
  engine.setRoomTestHall(roomCode, false);

  await assert.rejects(
    () =>
      engine.drawNextNumber({
        roomCode,
        actorPlayerId: playerId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 9: Spill 2 (rocket) — production-guarden påvirker IKKE ──────────────────

test("K3: production Spill 2 (rocket) — IKKE påvirket av quarantine", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-rocket",
    playerName: "Heidi",
    walletId: "w-heidi",
    gameSlug: "rocket",
    // INGEN isTestHall — vanlig retail-rom — men quarantine SKAL ikke
    // gjelde rocket-slug.
  });

  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
  await assert.doesNotReject(() =>
    engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    }),
  );
});

// ── 10: Spill 3 (monsterbingo) — production-guarden påvirker IKKE ───────────

test("K3: production Spill 3 (monsterbingo) — IKKE påvirket av quarantine", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-monster",
    playerName: "Ivan",
    walletId: "w-ivan",
    gameSlug: "monsterbingo",
  });

  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
  await assert.doesNotReject(() =>
    engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    }),
  );
});

// ── 11: Test/dev-runtime — bakoverkompatibilitet ────────────────────────────

test("K3: test/dev-runtime (isProductionRuntime=false) — ad-hoc Spill 1 fortsetter å virke", async () => {
  const engine = makeTestEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "test-hall-dev",
    playerName: "Judy",
    walletId: "w-judy",
    gameSlug: "bingo",
    // INGEN isTestHall — men siden vi er i test-runtime skal det IKKE
    // kaste. Dette er den eksisterende oppførselen som BingoEngine.test.ts
    // og 32+ andre test-filer er avhengige av.
  });

  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
  await assert.doesNotReject(() =>
    engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    }),
  );
});

// ── 12: DomainError details for ops/debug ───────────────────────────────────

test("K3: USE_SCHEDULED_API DomainError inkluderer roomCode + gameSlug + hallId + isTestHall", async () => {
  const engine = makeProductionEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall-debug",
    playerName: "Karl",
    walletId: "w-karl",
    gameSlug: "bingo",
  });

  try {
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    assert.fail("Skulle ha kastet USE_SCHEDULED_API");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    const details = (err as DomainError).details as
      | { roomCode?: string; gameSlug?: string; hallId?: string; isTestHall?: boolean }
      | undefined;
    assert.ok(details, "Detaljer må følge med for ops-debugging");
    assert.equal(details.roomCode, roomCode);
    assert.equal(details.gameSlug, "bingo");
    assert.equal(details.hallId, "retail-hall-debug");
    assert.equal(details.isTestHall, false);
  }
});
