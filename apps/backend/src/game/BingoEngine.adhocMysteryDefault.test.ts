// Mystery-force-default backport (Tobias 2026-04-26 — PR #555 til ad-hoc-engine):
// Verifiserer at `BingoEngineMiniGames.activateMiniGame` returnerer
// `"mysteryGame"` uavhengig av rotasjons-counter når flagget
// `MYSTERY_FORCE_DEFAULT_FOR_TESTING = true` er aktivt.
//
// Scheduled-engine fikk dette fixet i PR #555 via
// `Game1MiniGameOrchestrator.maybeTriggerFor`. Ad-hoc-engine
// (BingoEngine.activateMiniGame → BingoEngineMiniGames.activateMiniGame)
// bruker en separat rotasjons-counter og må ha sin egen force-bypass.
//
// Når admin-control lander, settes flagget til `false` og rotasjonen
// returnerer til wheelOfFortune → treasureChest → mysteryGame → colorDraft.

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

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

test("Mystery-force-default backport: activateMiniGame returnerer 'mysteryGame' uavhengig av rotasjons-counter", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });

  // 5 sekvensielle aktiveringer i forskjellige haller — alle skal være mysteryGame.
  for (let i = 0; i < 5; i += 1) {
    const hallId = `hall-mf-${i}`;
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId,
      playerName: `Host${i}`,
      walletId: `wallet-host-mf-${i}`,
    });
    await engine.joinRoom({
      roomCode,
      hallId,
      playerName: `Guest${i}`,
      walletId: `wallet-guest-mf-${i}`,
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
    });
    const mg = engine.activateMiniGame(roomCode, hostId);
    assert.ok(mg, `aktivering #${i} skal ikke returnere null`);
    assert.equal(
      mg!.type,
      "mysteryGame",
      `aktivering #${i} skal være mysteryGame (PR #555 backport, force-default)`,
    );
  }
});
