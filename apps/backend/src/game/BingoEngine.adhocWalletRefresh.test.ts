/**
 * BingoEngine.adhocWalletRefresh.test.ts
 *
 * Verifiserer fix Tobias 2026-04-26: ad-hoc-engine kaller
 * `refreshPlayerBalancesForWallet(player.walletId)` etter LINE-payout og
 * etter BINGO-payout i `submitClaim`, i stedet for optimistisk
 * `player.balance += payout`.
 *
 * Hvorfor: optimistisk += taper deposit/winnings-split-info. Når en spiller
 * vinner en gang (LINE) og deretter igjen (BINGO eller mini-game), blir
 * `player.balance` stale i `room:update`-broadcasts på 2.+ vinn.
 *
 * Strategien: subclasser BingoEngine og spioner på
 * `refreshPlayerBalancesForWallet`. Kjører en full LINE+BINGO-runde og
 * sjekker at hookene ble kalt med riktig walletId.
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

class SpyingEngine extends BingoEngine {
  public readonly refreshCalls: string[] = [];

  async refreshPlayerBalancesForWallet(walletId: string): Promise<string[]> {
    this.refreshCalls.push(walletId);
    return super.refreshPlayerBalancesForWallet(walletId);
  }
}

function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferredNumbers: readonly number[],
): void {
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  };
  const room = internal.rooms.get(roomCode);
  const game = room?.currentGame;
  if (!game) throw new Error("Spillet er ikke startet enda.");
  const ordered = [...preferredNumbers];
  const remaining = game.drawBag.filter((n) => !ordered.includes(n));
  game.drawBag = [...remaining, ...ordered].reverse();
}

test("ad-hoc submitClaim LINE: kaller refreshPlayerBalancesForWallet etter payout", async () => {
  const engine = new SpyingEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-refresh-line",
    playerName: "Host",
    walletId: "wallet-host-line",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-refresh-line",
    playerName: "Guest",
    walletId: "wallet-guest-line",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 50,
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ],
  });

  const lineNumbers = new Set([1, 2, 3, 4, 5]);
  const allWinNumbers = [
    1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28,
    37, 38, 39, 40, 41, 49, 50, 51, 52, 53,
  ];
  prioritizeDrawNumbers(engine, roomCode, allWinNumbers);

  let drawGuard = 0;
  while (lineNumbers.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    if (lineNumbers.has(number)) {
      await engine.markNumber({ roomCode, playerId: hostId, number });
      lineNumbers.delete(number);
    }
    drawGuard += 1;
  }
  assert.equal(lineNumbers.size, 0, "alle line-tall må være trukket");

  // Nullstill spy så vi måler kun submitClaim-effekten.
  engine.refreshCalls.length = 0;

  const lineClaim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });
  assert.equal(lineClaim.valid, true, "LINE claim skal være gyldig");
  assert.ok(lineClaim.payoutAmount && lineClaim.payoutAmount > 0, "LINE skal gi payout");

  // Hovedassertion: refresh ble kalt med vinnerens wallet etter LINE-payout.
  assert.ok(
    engine.refreshCalls.includes("wallet-host-line"),
    `LINE submitClaim skal kalle refreshPlayerBalancesForWallet — fikk: ${JSON.stringify(engine.refreshCalls)}`,
  );
});

test("ad-hoc submitClaim BINGO: kaller refreshPlayerBalancesForWallet etter payout", async () => {
  const engine = new SpyingEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-refresh-bingo",
    playerName: "Host",
    walletId: "wallet-host-bingo",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-refresh-bingo",
    playerName: "Guest",
    walletId: "wallet-guest-bingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 50,
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ],
  });

  const allWinNumbers = [
    1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28,
    37, 38, 39, 40, 41, 49, 50, 51, 52, 53,
  ];
  prioritizeDrawNumbers(engine, roomCode, allWinNumbers);
  const remaining = new Set(allWinNumbers);

  let drawGuard = 0;
  while (remaining.size > 0 && drawGuard < 80) {
    const { number } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    if (remaining.has(number)) {
      await engine.markNumber({ roomCode, playerId: hostId, number });
      remaining.delete(number);
    }
    drawGuard += 1;
  }
  assert.equal(remaining.size, 0, "alle bingo-tall må være trukket");

  // Først LINE-claim slik at BINGO er neste fase.
  await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });

  // Nullstill spy så vi måler kun BINGO-grenens refresh-kall.
  engine.refreshCalls.length = 0;

  const bingoClaim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "BINGO",
  });
  assert.equal(bingoClaim.valid, true, "BINGO claim skal være gyldig");
  assert.ok(bingoClaim.payoutAmount && bingoClaim.payoutAmount > 0, "BINGO skal gi payout");

  // Hovedassertion: refresh ble kalt med vinnerens wallet etter BINGO-payout.
  assert.ok(
    engine.refreshCalls.includes("wallet-host-bingo"),
    `BINGO submitClaim skal kalle refreshPlayerBalancesForWallet — fikk: ${JSON.stringify(engine.refreshCalls)}`,
  );
});

test("ad-hoc submitClaim: refresh-feil er fail-soft (vinneren er allerede betalt)", async () => {
  // Verifiserer try/catch — refresh som kaster skal IKKE feile claim-en.
  class ThrowingEngine extends BingoEngine {
    async refreshPlayerBalancesForWallet(_walletId: string): Promise<string[]> {
      throw new Error("simulert wallet-feil");
    }
  }

  const engine = new ThrowingEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-refresh-fail",
    playerName: "Host",
    walletId: "wallet-host-fail",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-refresh-fail",
    playerName: "Guest",
    walletId: "wallet-guest-fail",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 50,
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ],
  });

  const lineNumbers = [1, 2, 3, 4, 5];
  prioritizeDrawNumbers(engine, roomCode, lineNumbers);
  const remaining = new Set(lineNumbers);

  let drawGuard = 0;
  while (remaining.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    if (remaining.has(number)) {
      await engine.markNumber({ roomCode, playerId: hostId, number });
      remaining.delete(number);
    }
    drawGuard += 1;
  }

  // Skal IKKE kaste, selv om refresh kaster.
  const claim = await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });
  assert.equal(claim.valid, true, "claim skal være gyldig selv når refresh feiler");
  assert.ok(claim.payoutAmount && claim.payoutAmount > 0, "payout skal være gjort");
});
