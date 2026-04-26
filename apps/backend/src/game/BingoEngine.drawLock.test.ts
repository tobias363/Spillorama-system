/**
 * HIGH-5 (Casino Review): per-room draw mutex.
 *
 * To samtidige `drawNextNumber`-kall mot samme rom skal aldri begge
 * passere `assertHost` og deretter mutere `currentGame.drawBag`. Per-
 * socket-rate-limit (5/2s i `socketRateLimit.ts`) er ikke nok — to
 * forskjellige sockets fra samme host (åpen i to faner / dual admin-
 * panel) kan kalle drawNextNumber simultant.
 *
 * Denne testen verifiserer at:
 *   1. To parallelle drawNextNumber-kall mot samme rom: nøyaktig 1
 *      lykkes, den andre kaster `DRAW_IN_PROGRESS`.
 *   2. drawnNumbers øker med eksakt 1 (ikke 2 — ingen race-mutasjon).
 *   3. Etter at låsen er sluppet, kan en ny draw kjøre normalt.
 *   4. Lås på rom A blokkerer ikke draw på rom B.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

/**
 * BingoSystemAdapter med konfigurerbar latency på createTicket og
 * onNumberDrawn slik at vi kan tvinge draw-handlingen til å være
 * "in-flight" lenge nok til at en parallell draw rekker å treffe
 * låsen før den første har sluppet den.
 */
class SlowAdapter implements BingoSystemAdapter {
  /** Millisekunder å vente i onNumberDrawn — gir oss et stort vindu der låsen er holdt. */
  public onNumberDrawnDelayMs = 0;

  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }

  async onNumberDrawn(): Promise<void> {
    if (this.onNumberDrawnDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.onNumberDrawnDelayMs));
    }
  }
}

async function setupRunningRoom(adapter: SlowAdapter): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
}> {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(adapter, wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 10,
    payoutPercent: 80,
    armedPlayerIds: [playerId],
  });
  return { engine, roomCode, hostId: playerId };
}

test("HIGH-5: to parallelle drawNextNumber mot samme rom — eksakt 1 lykkes", async () => {
  const adapter = new SlowAdapter();
  // Hold låsen i 30ms slik at den andre Promise.all-armen rekker å treffe
  // den. Ikke for lenge — vi vil ikke at testene skal være trege.
  adapter.onNumberDrawnDelayMs = 30;

  const { engine, roomCode, hostId } = await setupRunningRoom(adapter);

  const drawnBefore = engine.getRoomSnapshot(roomCode).currentGame?.drawnNumbers.length ?? 0;

  // Fyr av to draws SAMTIDIG. Den første tar låsen, den andre treffer
  // `DRAW_IN_PROGRESS` synkront.
  const [resA, resB] = await Promise.allSettled([
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
  ]);

  const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
  const rejected = [resA, resB].filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "nøyaktig 1 draw skal ha lyktes");
  assert.equal(rejected.length, 1, "nøyaktig 1 draw skal ha blitt avvist");

  // Den avviste skal være DRAW_IN_PROGRESS — ikke noe annet (f.eks.
  // GAME_PAUSED eller NO_MORE_NUMBERS).
  const rej = rejected[0] as PromiseRejectedResult;
  const err = rej.reason as DomainError;
  assert.ok(err instanceof DomainError, `forventet DomainError, fikk ${typeof err}: ${String(err)}`);
  assert.equal(err.code, "DRAW_IN_PROGRESS");
  // Norsk feilmelding-krav.
  assert.match(err.message, /pågår|trekk/i);

  // drawnNumbers skal ha økt med eksakt 1, ikke 2 (ingen race-mutasjon).
  const drawnAfter = engine.getRoomSnapshot(roomCode).currentGame?.drawnNumbers.length ?? 0;
  assert.equal(drawnAfter, drawnBefore + 1);
});

test("HIGH-5: ny draw kan kjøres etter at låsen er sluppet", async () => {
  const adapter = new SlowAdapter();
  adapter.onNumberDrawnDelayMs = 5;
  const { engine, roomCode, hostId } = await setupRunningRoom(adapter);

  // Første draw — ingen konflikt.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const after1 = engine.getRoomSnapshot(roomCode).currentGame?.drawnNumbers.length ?? 0;
  assert.equal(after1, 1);

  // Andre draw — låsen skal være borte siden den første er ferdig.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const after2 = engine.getRoomSnapshot(roomCode).currentGame?.drawnNumbers.length ?? 0;
  assert.equal(after2, 2);

  // Tredje draw, parallelt med fjerde — fjerde skal avvises.
  adapter.onNumberDrawnDelayMs = 30;
  const [r3, r4] = await Promise.allSettled([
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
  ]);
  const fulfilledCount = [r3, r4].filter((r) => r.status === "fulfilled").length;
  assert.equal(fulfilledCount, 1);
});

test("HIGH-5: lås på rom A blokkerer ikke draw på rom B", async () => {
  const adapter = new SlowAdapter();
  adapter.onNumberDrawnDelayMs = 30;

  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(adapter, wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });

  // Rom A
  const { roomCode: roomA, playerId: hostA } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "HostA",
    walletId: "wallet-A",
  });
  await engine.startGame({
    roomCode: roomA,
    actorPlayerId: hostA,
    entryFee: 10,
    payoutPercent: 80,
    armedPlayerIds: [hostA],
  });

  // Rom B
  const { roomCode: roomB, playerId: hostB } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "HostB",
    walletId: "wallet-B",
  });
  await engine.startGame({
    roomCode: roomB,
    actorPlayerId: hostB,
    entryFee: 10,
    payoutPercent: 80,
    armedPlayerIds: [hostB],
  });

  // Begge skal lykkes selv om de starter samtidig — ulike rom har
  // ulike låser.
  const [resA, resB] = await Promise.allSettled([
    engine.drawNextNumber({ roomCode: roomA, actorPlayerId: hostA }),
    engine.drawNextNumber({ roomCode: roomB, actorPlayerId: hostB }),
  ]);
  assert.equal(resA.status, "fulfilled");
  assert.equal(resB.status, "fulfilled");
});

test("HIGH-5: feilet draw frigjør låsen (assertHost-feil)", async () => {
  const adapter = new SlowAdapter();
  const { engine, roomCode, hostId } = await setupRunningRoom(adapter);

  // Først kall fra ikke-host → kaster (men skal ikke holde låsen).
  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: "not-the-host" }),
    (err: unknown) => err instanceof DomainError,
  );

  // Så kall fra host — låsen skal være ledig.
  const result = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(typeof result.number, "number");
});
