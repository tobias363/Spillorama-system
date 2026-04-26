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
import { IdempotencyKeys } from "./idempotency.js";

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
 *
 * `refreshPlayerBalancesForWallet` brukes etter wallet-transfer på
 * payout-paths (jackpot + mini-game) for å sikre at `player.balance`
 * reflekterer faktisk available_balance fra wallet-adapteren — ikke en
 * optimistisk `+= payout` som taper deposit/winnings-split-info og gir
 * stale balance på 2.+ vinn (ad-hoc-engine-paritet, Tobias 2026-04-26).
 */
export interface MiniGamesContext {
  readonly walletAdapter: WalletAdapter;
  readonly compliance: ComplianceManager;
  readonly ledger: ComplianceLedger;
  requireRoom(roomCode: string): RoomState;
  requirePlayer(room: RoomState, playerId: string): Player;
  /**
   * Best-effort: oppdater `player.balance` fra wallet-adapteren etter
   * payout. Fail-soft — caller skal logge og fortsette ved feil (vinneren
   * er allerede betalt, kun visningen kan være stale til neste refresh).
   */
  refreshPlayerBalancesForWallet(walletId: string): Promise<string[]>;
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
        idempotencyKey: IdempotencyKeys.adhocJackpot({
          gameId: game.id,
          playedSpins: jackpot.playedSpins,
        }),
        targetSide: "winnings",
      },
    );
    // Hot-fix Tobias 2026-04-26: bytt optimistisk `player.balance += prize`
    // mot autoritativ refresh fra wallet-adapter. Optimistisk += taper
    // deposit/winnings-split-info → stale balance i room:update på 2.+ vinn.
    // Fail-soft: hvis refresh kaster (Postgres flap, lock-timeout) er
    // pengene allerede transferert; logger og fortsetter.
    try {
      await ctx.refreshPlayerBalancesForWallet(player.walletId);
    } catch (err) {
      // Ikke-fatalt: vinneren er kreditert, kun lokal cache er stale.
      // Neste room:update / wallet:update vil korrigere.
      // eslint-disable-next-line no-console
      console.warn(
        "[BingoEngineMiniGames.spinJackpot] refresh feilet (best-effort):",
        err,
      );
    }

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
 * Testing-flag: tving Mystery som default mini-game ved Fullt Hus
 * i ad-hoc-engine. Speiler scheduled-engine sin
 * `Game1MiniGameOrchestrator.maybeTriggerFor` (PR #555 d4a7f16a) slik at
 * Tobias' QA-sesjoner får forutsigbar Mystery-aktivering uten å avhenge
 * av rotasjonens posisjon. Settes til `false` for å gjenoppta
 * wheelOfFortune → treasureChest → mysteryGame → colorDraft-rotasjonen.
 *
 * **Note:** ad-hoc-engine bruker legacy-unionen `"mysteryGame"` (ikke
 * scheduled-engine sin `"mystery"`-union). Verdien er hardkodet i
 * `MINIGAME_ROTATION` over og brukes ved string-lookup nedenfor.
 */
const MYSTERY_FORCE_DEFAULT_FOR_TESTING = true;

/**
 * Activate a mini-game for a player (called after BINGO win in Game 1).
 * Default-rotasjon: wheelOfFortune → treasureChest → mysteryGame → colorDraft.
 * Når `MYSTERY_FORCE_DEFAULT_FOR_TESTING` er aktiv → tving alltid mysteryGame
 * (testing-only — backport av PR #555).
 *
 * `rotationState.counter` mutates in place så rotasjonen er stabil mellom
 * runder også når mystery-flagget er av (samme semantikk som tidligere
 * `this.miniGameCounter += 1`).
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
  // Backport PR #555: tving Mystery som default ved Fullt Hus så lenge
  // testing-flagget er aktivt. Rotasjons-counteren tikker uansett — hvis
  // flagget slås av igjen, fortsetter rotasjonen fra forventet posisjon.
  let type: MiniGameType;
  if (
    MYSTERY_FORCE_DEFAULT_FOR_TESTING &&
    rotation.includes("mysteryGame" as MiniGameType)
  ) {
    type = "mysteryGame";
  } else {
    type = rotation[rotationState.counter % rotation.length];
  }
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
      {
        idempotencyKey: IdempotencyKeys.adhocMiniGame({
          gameId: game.id,
          miniGameType: miniGame.type,
        }),
        targetSide: "winnings",
      },
    );
    // Hot-fix Tobias 2026-04-26: autoritativ refresh i stedet for `+= prize`.
    // Se kommentar i `spinJackpot` for begrunnelse.
    try {
      await ctx.refreshPlayerBalancesForWallet(player.walletId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[BingoEngineMiniGames.playMiniGame] refresh feilet (best-effort):",
        err,
      );
    }

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
