/**
 * BingoEngineMiniGames — helper-modul for jackpot og mini-games.
 *
 * Ekstrahert fra `BingoEngine.ts` i refactor/s1-bingo-engine-split (Forslag A)
 * for å redusere LOC uten å endre offentlig API eller subklasse-inheritance.
 *
 * **Kontrakt:**
 *   - Rene funksjoner som tar en `MiniGamesContext` med nødvendige ports.
 *   - Ingen engine-state-mutasjon utover det som allerede skjer via
 *     `game.jackpot` / `game.miniGame` + wallet-transfer + ledger-write.
 *   - `BingoEngine`-metodene `activateJackpot`/`spinJackpot`/`activateMiniGame`/
 *     `playMiniGame` er uendret i signatur — delegerer hit med kontekst.
 *
 * **Regulatorisk:** payout-siden (transfer + compliance.recordLossEntry +
 * ledger.recordComplianceLedgerEvent) er byte-identisk med forrige inline-
 * implementasjon. Ingen endring i idempotency-keys eller policyVersion-tags.
 */

import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { ComplianceManager } from "./ComplianceManager.js";
import type { ComplianceLedger } from "./ComplianceLedger.js";
import type {
  GameState,
  JackpotState,
  MiniGameState,
  MiniGameType,
  Player,
  RoomState,
} from "./types.js";
import { DomainError } from "./BingoEngine.js";

/** Default prize segments for the jackpot wheel (in kr). */
export const JACKPOT_PRIZES: readonly number[] = [5, 10, 15, 20, 25, 50, 10, 15];

/** Default prize segments for Game 1 mini-games (in kr). */
export const MINIGAME_PRIZES: readonly number[] = [5, 10, 15, 20, 25, 50, 10, 15];

/**
 * BIN-505/506: 4-way rotation order for Game 1 mini-games. Legacy ran the
 * same rotation per hall (wheel → chest → mystery → colorDraft), reading
 * prize lists from the admin-configured `otherGame` collection. We keep the
 * rotation but default every type to MINIGAME_PRIZES until per-type admin
 * config lands (follow-up issue).
 */
export const MINIGAME_ROTATION: readonly MiniGameType[] = [
  "wheelOfFortune",
  "treasureChest",
  "mysteryGame",
  "colorDraft",
];

/**
 * Narrow port eksponerer kun de delene av BingoEngine som mini-game-
 * modulen trenger. Holder private state (rooms-map, playerMap) innkapslet.
 */
export interface MiniGamesContext {
  readonly walletAdapter: WalletAdapter;
  readonly compliance: ComplianceManager;
  readonly ledger: ComplianceLedger;
  requireRoom(roomCode: string): RoomState;
  requirePlayer(room: RoomState, playerId: string): Player;
}

/**
 * Activate jackpot mini-game for a player (called after BINGO win in Game 5).
 * Returns the jackpot state, or null if not applicable.
 */
export function activateJackpot(
  ctx: MiniGamesContext,
  roomCode: string,
  playerId: string,
): JackpotState | null {
  const room = ctx.requireRoom(roomCode);
  const game = room.currentGame;
  if (!game) return null;
  if (game.jackpot) return game.jackpot; // Already activated

  const jackpot: JackpotState = {
    playerId,
    prizeList: [...JACKPOT_PRIZES],
    totalSpins: 1,
    playedSpins: 0,
    spinHistory: [],
    isComplete: false,
  };
  game.jackpot = jackpot;
  return jackpot;
}

/**
 * Process a jackpot spin. Server picks a random segment.
 * Returns the spin result with prize amount.
 */
export async function spinJackpot(
  ctx: MiniGamesContext,
  roomCode: string,
  playerId: string,
): Promise<{
  segmentIndex: number;
  prizeAmount: number;
  playedSpins: number;
  totalSpins: number;
  isComplete: boolean;
  spinHistory: JackpotState["spinHistory"];
}> {
  const room = ctx.requireRoom(roomCode);
  const game = room.currentGame;
  if (!game || !game.jackpot) {
    throw new DomainError("NO_JACKPOT", "Ingen aktiv jackpot.");
  }
  const jackpot = game.jackpot;
  if (jackpot.playerId !== playerId) {
    throw new DomainError("NOT_JACKPOT_PLAYER", "Jackpot tilhører en annen spiller.");
  }
  if (jackpot.isComplete) {
    throw new DomainError("JACKPOT_COMPLETE", "Jackpot er allerede fullført.");
  }
  if (jackpot.playedSpins >= jackpot.totalSpins) {
    throw new DomainError("NO_SPINS_LEFT", "Ingen spinn igjen.");
  }

  // Server-authoritative random segment
  const segmentIndex = Math.floor(Math.random() * jackpot.prizeList.length);
  const prizeAmount = jackpot.prizeList[segmentIndex];
  jackpot.playedSpins += 1;

  jackpot.spinHistory.push({
    spinNumber: jackpot.playedSpins,
    segmentIndex,
    prizeAmount,
  });

  if (jackpot.playedSpins >= jackpot.totalSpins) {
    jackpot.isComplete = true;
  }

  // Credit prize to player balance
  if (prizeAmount > 0) {
    const player = ctx.requirePlayer(room, playerId);
    const gameType = "DATABINGO" as const;
    const channel = "INTERNET" as const;
    const houseAccountId = ctx.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
    const transfer = await ctx.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      prizeAmount,
      `Jackpot prize ${room.code}`,
      {
        idempotencyKey: `jackpot-${game.id}-spin-${jackpot.playedSpins}`,
        targetSide: "winnings",
      },
    );
    player.balance += prizeAmount;

    await ctx.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "PAYOUT",
      amount: prizeAmount,
      createdAtMs: Date.now(),
    });
    await ctx.ledger.recordComplianceLedgerEvent({
      hallId: room.hallId,
      gameType,
      channel,
      eventType: "PRIZE",
      amount: prizeAmount,
      roomCode: room.code,
      gameId: game.id,
      claimId: `jackpot-${game.id}-spin-${jackpot.playedSpins}`,
      playerId,
      walletId: player.walletId,
      sourceAccountId: transfer.fromTx.accountId,
      targetAccountId: transfer.toTx.accountId,
      policyVersion: "jackpot-v1",
    });
  }

  return {
    segmentIndex,
    prizeAmount,
    playedSpins: jackpot.playedSpins,
    totalSpins: jackpot.totalSpins,
    isComplete: jackpot.isComplete,
    spinHistory: jackpot.spinHistory,
  };
}

/**
 * State-container for the mini-game rotation counter. Engine beholder én
 * instans og sender til `activateMiniGame` så rotasjonen er per-engine
 * (matcher tidligere `this.miniGameCounter`-semantikk).
 */
export interface MiniGameRotationState {
  counter: number;
}

/**
 * Activate a mini-game for a player (called after BINGO win in Game 1).
 * Rotates wheelOfFortune → treasureChest → mysteryGame → colorDraft.
 *
 * `rotationState.counter` mutates in place so successive calls produce the
 * rotation sequence (samme semantikk som `this.miniGameCounter += 1` tidligere).
 */
export function activateMiniGame(
  ctx: MiniGamesContext,
  rotationState: MiniGameRotationState,
  roomCode: string,
  playerId: string,
): MiniGameState | null {
  const room = ctx.requireRoom(roomCode);
  const game = room.currentGame;
  if (!game) return null;
  if (game.miniGame) return game.miniGame; // Already activated

  const rotation = MINIGAME_ROTATION;
  const type: MiniGameType = rotation[rotationState.counter % rotation.length];
  rotationState.counter += 1;

  const miniGame: MiniGameState = {
    playerId,
    type,
    prizeList: [...MINIGAME_PRIZES],
    isPlayed: false,
  };
  game.miniGame = miniGame;
  return miniGame;
}

/**
 * Play the mini-game. Server picks the winning segment/chest.
 * For treasureChest, selectedIndex is the player's pick (cosmetic only — prize is server-determined).
 */
export async function playMiniGame(
  ctx: MiniGamesContext,
  roomCode: string,
  playerId: string,
  _selectedIndex?: number,
): Promise<{
  type: MiniGameType;
  segmentIndex: number;
  prizeAmount: number;
  prizeList: number[];
}> {
  const room = ctx.requireRoom(roomCode);
  const game = room.currentGame;
  if (!game || !game.miniGame) {
    throw new DomainError("NO_MINIGAME", "Ingen aktiv mini-game.");
  }
  const miniGame = game.miniGame;
  if (miniGame.playerId !== playerId) {
    throw new DomainError("NOT_MINIGAME_PLAYER", "Mini-game tilhører en annen spiller.");
  }
  if (miniGame.isPlayed) {
    throw new DomainError("MINIGAME_PLAYED", "Mini-game er allerede spilt.");
  }

  // Server-authoritative random segment
  const segmentIndex = Math.floor(Math.random() * miniGame.prizeList.length);
  const prizeAmount = miniGame.prizeList[segmentIndex];
  miniGame.isPlayed = true;
  miniGame.result = { segmentIndex, prizeAmount };

  // Credit prize to player balance
  if (prizeAmount > 0) {
    const player = ctx.requirePlayer(room, playerId);
    const gameType = "DATABINGO" as const;
    const channel = "INTERNET" as const;
    const houseAccountId = ctx.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
    const transfer = await ctx.walletAdapter.transfer(
      houseAccountId,
      player.walletId,
      prizeAmount,
      `Mini-game ${miniGame.type} prize ${room.code}`,
      { idempotencyKey: `minigame-${game.id}-${miniGame.type}`, targetSide: "winnings" },
    );
    player.balance += prizeAmount;

    await ctx.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "PAYOUT",
      amount: prizeAmount,
      createdAtMs: Date.now(),
    });
    await ctx.ledger.recordComplianceLedgerEvent({
      hallId: room.hallId,
      gameType,
      channel,
      eventType: "PRIZE",
      amount: prizeAmount,
      roomCode: room.code,
      gameId: game.id,
      claimId: `minigame-${game.id}-${miniGame.type}`,
      playerId,
      walletId: player.walletId,
      sourceAccountId: transfer.fromTx.accountId,
      targetAccountId: transfer.toTx.accountId,
      policyVersion: "minigame-v1",
    });
  }

  return {
    type: miniGame.type,
    segmentIndex,
    prizeAmount,
    prizeList: miniGame.prizeList,
  };
}

// Type re-export for tests that destructure `MiniGameType` via this module.
export type { GameState, JackpotState, MiniGameState, MiniGameType };
