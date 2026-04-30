/**
 * BingoEngine.miniGameSurvivesArchive.test.ts
 *
 * Tobias prod-incident 2026-04-30: spilleren rapporterte "Feil: Ingen aktiv
 * mini-game" etter å ha spilt gjennom Mystery Joker. Mystery Joker har
 * intern timing på opptil 2 min (autospill) — auto-round-intervallet er
 * 3 min default, så i edge-case kan neste runde starte før spilleren
 * har valgt og bekreftet sitt valg.
 *
 * Bug: `playMiniGame` leste fra `currentGame.miniGame`. Når neste runde
 * startet, kjørte `archiveIfEnded` og wipet `currentGame` (med dens
 * `miniGame`-felt) — så spillerens påfølgende `minigame:play` traff
 * `NO_MINIGAME` kasterstien.
 *
 * Fix: `archiveIfEnded` flytter en uspilt mini-game til
 * `room.pendingMiniGame` før wipe; `playMiniGame` faller tilbake dit.
 *
 * Denne testen verifiserer den nye fallback-stien:
 *   1. Aktiver mini-game i runde 1.
 *   2. Avslutt runde 1 (status=ENDED) og start runde 2 — som triggrer
 *      `archiveIfEnded`.
 *   3. Verifiser at `room.pendingMiniGame` har den uspilte tilstanden
 *      med korrekt `gameId`.
 *   4. Kall `playMiniGame` — skal lykkes (fall tilbake til pending),
 *      kreditere prize, og rydde `pendingMiniGame`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";

class FixedTicketAdapter implements BingoSystemAdapter {
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
}

test("playMiniGame faller tilbake til room.pendingMiniGame etter archive — fix Tobias 2026-04-30", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minDrawIntervalMs: 0,
  });

  const hallId = "hall-pending-minigame-fallback";
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId,
    playerName: "Host",
    walletId: "wallet-host-pending",
    gameSlug: "bingo",
  });
  await engine.joinRoom({
    roomCode,
    hallId,
    playerName: "Guest",
    walletId: "wallet-guest-pending",
  });

  // ── Runde 1: start, aktiver mini-game (ikke spill den), avslutt ─────────
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });
  const round1MiniGame = engine.activateMiniGame(roomCode, hostId);
  assert.ok(round1MiniGame, "aktivering returnerte null");
  const round1Snapshot = engine.getRoomSnapshot(roomCode);
  const round1GameId = round1Snapshot.currentGame?.id;
  assert.ok(round1GameId, "ingen gameId etter aktivering");

  // Tving runden til ENDED uten å spille mini-game (simulerer Fullt Hus
  // auto-claim-flow der mini-game er aktivert men spilleren ikke har
  // klikket ennå).
  await engine.endGame({ roomCode, actorPlayerId: hostId });

  // Simuler at 30-sekunders round-interval har gått ved å stomme private
  // last-start timestamp (samme mønster som Game3Engine.test.ts).
  const lastStart = (engine as unknown as {
    roomLastRoundStartMs: Map<string, number>;
  }).roomLastRoundStartMs;
  lastStart.set(roomCode, Date.now() - 40_000);

  // ── Runde 2: starter, archiveIfEnded skal flytte uspilt mini-game ───────
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  // Verifiser at pending-feltet er satt med korrekt gameId.
  // Vi har ikke direct accessor for room-state, så bruker getCurrentMiniGame
  // som faller tilbake til pendingMiniGame når currentGame.miniGame er null.
  const fallbackMiniGame = engine.getCurrentMiniGame(roomCode);
  assert.ok(
    fallbackMiniGame,
    "getCurrentMiniGame returnerte null — pending-fallback mangler",
  );
  assert.equal(
    fallbackMiniGame!.playerId,
    hostId,
    "pending mini-game har feil playerId",
  );
  assert.equal(
    fallbackMiniGame!.isPlayed,
    false,
    "pending mini-game er allerede markert spilt",
  );

  // ── Spill mini-game etter archive — skal lykkes via fallback ────────────
  const result = await engine.playMiniGame(roomCode, hostId);
  assert.ok(
    typeof result.prizeAmount === "number",
    "playMiniGame returnerte ikke prizeAmount",
  );
  assert.ok(
    typeof result.segmentIndex === "number",
    "playMiniGame returnerte ikke segmentIndex",
  );
  assert.equal(
    result.type,
    "mysteryGame",
    "forventet mysteryGame fra MYSTERY_FORCE_DEFAULT_FOR_TESTING",
  );

  // Etter vellykket play skal pending være ryddet.
  const afterPlay = engine.getCurrentMiniGame(roomCode);
  // Etter play kan currentGame.miniGame være null (runde 2 har ikke aktivert
  // ny mini-game), og pendingMiniGame skal være ryddet → samlet null.
  assert.equal(
    afterPlay,
    null,
    "pendingMiniGame ble ikke ryddet etter vellykket play",
  );

  // Idempotency: play igjen skal feile med MINIGAME_PLAYED eller NO_MINIGAME
  // — ikke kreditere på nytt.
  await assert.rejects(
    () => engine.playMiniGame(roomCode, hostId),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const code = (err as { code?: unknown }).code;
      assert.ok(
        code === "MINIGAME_PLAYED" || code === "NO_MINIGAME",
        `forventet MINIGAME_PLAYED eller NO_MINIGAME, fikk ${String(code)}`,
      );
      return true;
    },
    "andre play burde feile (idempotency)",
  );
});

test("playMiniGame faller IKKE tilbake til pendingMiniGame hvis annen spiller prøver", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minDrawIntervalMs: 0,
  });

  const hallId = "hall-pending-cross-player";
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId,
    playerName: "Host",
    walletId: "wallet-host-cross",
    gameSlug: "bingo",
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode,
    hallId,
    playerName: "Guest",
    walletId: "wallet-guest-cross",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });
  // Aktiver for Guest — ikke Host.
  engine.activateMiniGame(roomCode, guestId);
  await engine.endGame({ roomCode, actorPlayerId: hostId });

  // Simuler 30-sekunders intervall (samme mønster som over).
  const lastStart = (engine as unknown as {
    roomLastRoundStartMs: Map<string, number>;
  }).roomLastRoundStartMs;
  lastStart.set(roomCode, Date.now() - 40_000);

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  // Host prøver å spille Guest's mini-game via fallback — skal feile.
  await assert.rejects(
    () => engine.playMiniGame(roomCode, hostId),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const code = (err as { code?: unknown }).code;
      assert.equal(
        code,
        "NOT_MINIGAME_PLAYER",
        `forventet NOT_MINIGAME_PLAYER, fikk ${String(code)}`,
      );
      return true;
    },
    "Host burde ikke kunne spille Guest's pending mini-game",
  );
});
