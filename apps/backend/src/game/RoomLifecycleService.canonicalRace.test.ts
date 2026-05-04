/**
 * Test for createRoom race-condition guard (Tobias-direktiv 2026-05-04).
 *
 * Bakgrunn:
 *   `createRoom({ roomCode: "ROCKET" })` sjekket `existingCodes.has("ROCKET")`
 *   før insertion. Hvis sjekken passerte, satte den `this.rooms.set("ROCKET")`.
 *   Men ved race kunne to samtidige createRoom-kall begge passere sjekken,
 *   og den andre falt da tilbake til `makeRoomCode()` (random kode) i stedet
 *   for å feile — som skapte et duplikat-rom for samme rocket-slug.
 *
 * Fix:
 *   Hvis `input.roomCode` er KANONISK (BINGO_*, ROCKET, MONSTERBINGO) og
 *   allerede finnes i `this.rooms`, kast `ROOM_ALREADY_EXISTS` i stedet for
 *   å falle tilbake til random kode. Caller (room:create-handler) recover-er
 *   ved å re-loope til "join existing canonical"-pathen.
 *
 * Non-canonical input.roomCode (legacy random / tester) beholder gammel
 * fall-back-oppførsel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 0, 13, 14],
        [15, 16, 17, 18, 19],
        [20, 21, 22, 23, 24],
      ],
    };
  }
}

test("createRoom med kanonisk ROCKET som allerede finnes → ROOM_ALREADY_EXISTS", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  // Først: opprett ROCKET
  await engine.createRoom({
    hallId: "hall-A",
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: "ROCKET",
    gameSlug: "rocket",
    effectiveHallId: null,
  });

  // Deretter: forsøk å opprette ROCKET på nytt → skal kaste
  await assert.rejects(
    async () => {
      await engine.createRoom({
        hallId: "hall-B",
        playerName: "Bob",
        walletId: "w-bob",
        roomCode: "ROCKET",
        gameSlug: "rocket",
        effectiveHallId: null,
      });
    },
    (err: { code?: string; message?: string }) => {
      assert.equal(err.code, "ROOM_ALREADY_EXISTS");
      assert.match(err.message ?? "", /ROCKET/);
      return true;
    },
  );
});

test("createRoom med kanonisk MONSTERBINGO som allerede finnes → ROOM_ALREADY_EXISTS", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  await engine.createRoom({
    hallId: "hall-A",
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: "MONSTERBINGO",
    gameSlug: "monsterbingo",
    effectiveHallId: null,
  });

  await assert.rejects(
    async () => {
      await engine.createRoom({
        hallId: "hall-B",
        playerName: "Bob",
        walletId: "w-bob",
        roomCode: "MONSTERBINGO",
        gameSlug: "monsterbingo",
        effectiveHallId: null,
      });
    },
    (err: { code?: string }) => err.code === "ROOM_ALREADY_EXISTS",
  );
});

test("createRoom med kanonisk BINGO_GROUP-X som allerede finnes → ROOM_ALREADY_EXISTS", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  await engine.createRoom({
    hallId: "hall-A",
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: "BINGO_GROUP-X",
    gameSlug: "bingo",
    effectiveHallId: null,
  });

  await assert.rejects(
    async () => {
      await engine.createRoom({
        hallId: "hall-B",
        playerName: "Bob",
        walletId: "w-bob",
        roomCode: "BINGO_GROUP-X",
        gameSlug: "bingo",
        effectiveHallId: null,
      });
    },
    (err: { code?: string }) => err.code === "ROOM_ALREADY_EXISTS",
  );
});

test("createRoom med non-canonical kode som finnes → fortsatt fall-back til random (legacy)", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  // Opprett rom med random/legacy kode
  const first = await engine.createRoom({
    hallId: "hall-A",
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: "LEGACY1",
    gameSlug: "themebingo",
  });
  assert.equal(first.roomCode, "LEGACY1");

  // Forsøk å opprette igjen — fall back til random er OK (legacy oppførsel)
  const second = await engine.createRoom({
    hallId: "hall-B",
    playerName: "Bob",
    walletId: "w-bob",
    roomCode: "LEGACY1",
    gameSlug: "themebingo",
  });
  // Rom-koden er random, ikke "LEGACY1"
  assert.notEqual(second.roomCode, "LEGACY1");
  // Men rommet finnes
  const snap = engine.getRoomSnapshot(second.roomCode);
  assert.equal(snap.code, second.roomCode);
});

test("createRoom uten input.roomCode → genererer random kode (uendret)", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const result = await engine.createRoom({
    hallId: "hall-A",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  // Random kode, ikke kanonisk
  assert.equal(/^BINGO_/.test(result.roomCode), false);
  assert.notEqual(result.roomCode, "ROCKET");
  assert.notEqual(result.roomCode, "MONSTERBINGO");
});

test("Race-simulering: 2 samtidige createRoom-kall på ROCKET → 1 vinner, 1 får ROOM_ALREADY_EXISTS", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });

  // Promise.allSettled så vi ser begge utfall, ikke bare første reject.
  const [r1, r2] = await Promise.allSettled([
    engine.createRoom({
      hallId: "hall-A",
      playerName: "Alice",
      walletId: "w-alice",
      roomCode: "ROCKET",
      gameSlug: "rocket",
      effectiveHallId: null,
    }),
    engine.createRoom({
      hallId: "hall-B",
      playerName: "Bob",
      walletId: "w-bob",
      roomCode: "ROCKET",
      gameSlug: "rocket",
      effectiveHallId: null,
    }),
  ]);

  // Nøyaktig én skal lykkes, og én skal feile med ROOM_ALREADY_EXISTS.
  // Note: i node-runtime er createRoom serialisert (await ensureAccount + await getBalance),
  // så i praksis kjører de én etter en. Vinneren er uansett kun ÉN.
  const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
  const rejected = [r1, r2].filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const rejErr = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
  assert.equal(rejErr.code, "ROOM_ALREADY_EXISTS");

  // Engine-state har KUN ÉTT ROCKET-rom — invariant holder.
  const summaries = engine.listRoomSummaries();
  const rocketRooms = summaries.filter((s) => s.gameSlug === "rocket");
  assert.equal(rocketRooms.length, 1);
  assert.equal(rocketRooms[0].code, "ROCKET");
});
