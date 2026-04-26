/**
 * BingoEngine.adhocMysteryDefault.test.ts
 *
 * Verifiserer fix Tobias 2026-04-26: ad-hoc-engine sin
 * `activateMiniGame` skal returnere mysteryGame som default ved Fullt Hus
 * når `MYSTERY_FORCE_DEFAULT_FOR_TESTING = true` (backport av PR #555).
 *
 * Testen kjører 5 sekvensielle aktiveringer i forskjellige rom og verifiserer
 * at ALLE returnerer mysteryGame, uavhengig av hvor i rotasjons-counteren
 * vi er. Når flagget slås av igjen skal forventningen tilbake til:
 *   wheelOfFortune → treasureChest → mysteryGame → colorDraft → wheelOfFortune
 *
 * Denne testen lever ved siden av eksisterende rotasjons-tester i
 * `BingoEngine.test.ts` og dokumenterer den eksplisitte mystery-default-
 * forventningen frem til admin-UI for mini-game-valg lander.
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

test("ad-hoc activateMiniGame: forcer mysteryGame for 5 sekvensielle Fullt Hus-vinster (backport PR #555)", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });

  const observedTypes: string[] = [];

  for (let i = 0; i < 5; i += 1) {
    const hallId = `hall-mystery-default-${i}`;
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId,
      playerName: `Host${i}`,
      walletId: `wallet-host-mystery-${i}`,
      gameSlug: "bingo",
    });
    await engine.joinRoom({
      roomCode,
      hallId,
      playerName: `Guest${i}`,
      walletId: `wallet-guest-mystery-${i}`,
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
    });
    const miniGame = engine.activateMiniGame(roomCode, hostId);
    assert.ok(miniGame, `aktivering #${i} returnerte null`);
    observedTypes.push(miniGame!.type);
  }

  // Hovedassertion: alle 5 aktiveringer skal være mysteryGame mens
  // MYSTERY_FORCE_DEFAULT_FOR_TESTING er true. Når flagget slås av,
  // bytt forventning tilbake til full rotasjons-sekvens.
  assert.deepEqual(
    observedTypes,
    ["mysteryGame", "mysteryGame", "mysteryGame", "mysteryGame", "mysteryGame"],
    `mystery-force-default brukket: ${JSON.stringify(observedTypes)}`,
  );
});

test("ad-hoc activateMiniGame: andregangs aktivering i samme rom returnerer eksisterende mini-game (idempotent)", async () => {
  // Sanity-check: hvis runden allerede har en mini-game, skal vi få den
  // eksisterende tilbake — ikke en ny mysteryGame som overskriver.
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-mystery-idempotent",
    playerName: "Host",
    walletId: "wallet-host-mystery-idemp",
    gameSlug: "bingo",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-mystery-idempotent",
    playerName: "Guest",
    walletId: "wallet-guest-mystery-idemp",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  const first = engine.activateMiniGame(roomCode, hostId);
  const second = engine.activateMiniGame(roomCode, hostId);
  assert.equal(first?.type, "mysteryGame");
  assert.equal(second?.type, "mysteryGame");
  // Skal være samme instans — ikke ny aktivering.
  assert.equal(first, second);
});
