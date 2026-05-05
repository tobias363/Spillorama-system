/**
 * DrawOrchestrationService — extracted from BingoEngine.ts in F2-D
 * (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3).
 *
 * Owns the **draw-orchestration flow** that was previously inline on BingoEngine:
 *   - `drawNext` — public entry-point. Per-room mutex (HIGH-5) so two parallel
 *     `draw:next` calls against the same room never both mutate
 *     `currentGame.drawBag`/`drawnNumbers`. In-flight draws short-circuit
 *     with `DRAW_IN_PROGRESS` instead of queueing.
 *   - `_drawNextLocked` — full draw pipeline. Validates the room state,
 *     enforces draw-interval (MEDIUM-1/BIN-253), shifts the next ball off
 *     the draw bag, fires the post-draw hook chain (`onDrawCompleted` →
 *     `evaluateActivePhase` → `onLuckyNumberDrawn`), persists the
 *     checkpoint, and ends the round on `MAX_DRAWS_REACHED` /
 *     `DRAW_BAG_EMPTY` if the bag is exhausted.
 *
 * **Responsibilities:**
 *   - HIGH-5 per-room mutex (`drawLocksByRoom`).
 *   - MEDIUM-1/BIN-253 draw-interval enforcement (`lastDrawAtByRoom` +
 *     `minDrawIntervalMs`).
 *   - BIN-460 paused-game guard.
 *   - CRIT-4 / K3 scheduled / production-runtime guards (delegated to
 *     engine via `assertNotScheduled` / `assertSpill1NotAdHoc` callbacks).
 *   - K5 (CRIT-4) circuit-breaker error-handling on hook failures
 *     (`handleHookError`) — the engine still owns the counter + halt path.
 *   - Variant-config cache-miss auto-bind for Spill 1 rooms (Tobias
 *     2026-04-27 fail-loud guard) — engine owns the actual cache via
 *     callbacks.
 *   - Lucky-number fan-out per drawn ball (BIN-615 / PR-C3).
 *   - HOEY-3 per-draw checkpoint + HOEY-6/BIN-248 game-end checkpoint.
 *   - PHASE3-FIX last-chance `evaluateActivePhase` calls before ending
 *     the round on `MAX_DRAWS_REACHED` / `DRAW_BAG_EMPTY` so Phase 5 can
 *     still claim Fullt Hus on ball 75 (FULLTHUS-FIX 2026-04-27).
 *   - LIVE_ROOM_OBSERVABILITY 2026-04-29 per-draw `game.draw` log event.
 *
 * **NOT this service's responsibility:**
 *   - The actual `evaluateActivePhase` implementation — it stays on the
 *     engine (and inside `BingoEnginePatternEval`) because it owns wallet
 *     transfers + ledger writes for auto-claim payouts. Service routes
 *     through `evaluateActivePhase` callback.
 *   - Variant hooks (`onDrawCompleted`, `onLuckyNumberDrawn`) — they're
 *     subclass-overrideable on the engine (Game2Engine, Game3Engine
 *     override) so the service receives them via callbacks.
 *   - K5 circuit-breaker counter (`roomErrorCounter`) and halt-the-room
 *     plumbing (`handleHookError`) — engine owns those because they
 *     write `EngineDegradedEvent` to a port and pause `currentGame`.
 *   - Per-room caches that aren't draw-related (`variantConfigByRoom`,
 *     `variantGameTypeByRoom`, `luckyNumbersByPlayer`) — engine owns
 *     those because they're populated in `startGame` / `setLuckyNumber`
 *     and read by other engine methods.
 *   - `requireRoom`/`requirePlayer`/`requireRunningGame` lookups — kept
 *     on engine because the same helpers are reused by other engine
 *     methods (assertHost, etc).
 *
 * Behavior is fully equivalent to the pre-extraction inline logic. All
 * log fields, error codes, ordering of side-effects, and idempotency
 * semantics are preserved byte-for-byte.
 *
 * Note: BingoEngine still wraps `drawNextNumber` as a thin delegate so
 * the public API (and Game2Engine/Game3Engine inheritance + Socket.IO
 * `draw:next` handler + Game1DrawEngineService + schedulerSetup
 * `onAutoDraw` wiring) is unchanged.
 *
 * **Cleanup contract:** the engine's `cleanupRoomLocalCaches` callback
 * (passed to {@link RoomLifecycleService}) MUST also call
 * {@link DrawOrchestrationService.cleanupRoomCaches} so the service's
 * `drawLocksByRoom` + `lastDrawAtByRoom` Maps don't leak after
 * `destroyRoom`.
 */

import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import type { EngineHookName } from "../adapters/EngineCircuitBreakerPort.js";
import { logger as rootLogger } from "../util/logger.js";
import { logRoomEvent } from "../util/roomLogVerbose.js";
import * as variantConfigModule from "./variantConfig.js";
import { DomainError } from "../errors/DomainError.js";
import { isPerpetualSlug } from "./PerpetualRoundService.js";
import { isSystemActor } from "./SystemActor.js";
import type {
  GameState,
  Player,
  RoomState,
} from "./types.js";

const logger = rootLogger.child({ module: "draw-orchestration-service" });

/**
 * Inputs accepted by {@link DrawOrchestrationService.drawNext}. Mirrors
 * the inline `DrawNextInput` interface in `BingoEngine.ts` so the engine
 * can pass through unchanged.
 */
export interface DrawOrchestrationInput {
  roomCode: string;
  actorPlayerId: string;
}

/**
 * Engine-internal helpers that the service needs but cannot easily own
 * itself (they touch private engine state — assertion helpers, K5
 * circuit-breaker, variant hooks, per-room caches owned by the engine).
 *
 * Same callback-port pattern used by {@link EvaluatePhaseCallbacks} +
 * {@link ClaimSubmitterCallbacks} + {@link RoomLifecycleCallbacks}.
 */
export interface DrawOrchestrationCallbacks {
  /** Engine `requireRoom` lookup — throws `ROOM_NOT_FOUND`. */
  requireRoom(roomCode: string): RoomState;
  /** Engine `requirePlayer` lookup — throws `PLAYER_NOT_FOUND`. */
  requirePlayer(room: RoomState, playerId: string): Player;
  /** Engine `requireRunningGame` lookup — throws `GAME_NOT_RUNNING`. */
  requireRunningGame(room: RoomState): GameState;
  /** CRIT-4 guard — scheduled Spill 1 must use Game1DrawEngineService. */
  assertNotScheduled(room: RoomState): void;
  /** K3 guard — production-runtime Spill 1 must be scheduled (or test-hall). */
  assertSpill1NotAdHoc(room: RoomState): void;
  /** Host-only guard for `draw:next`. */
  assertHost(room: RoomState, actorPlayerId: string): void;
  /** Wallet KYC / play-block / pause / loss-limit pre-check. */
  assertWalletAllowedForGameplay(walletId: string, nowMs: number): void;
  /**
   * BIN-694 active-phase evaluation. Stays on the engine because it
   * touches wallet transfers + ledger writes + audit events when a phase
   * is auto-claimed.
   */
  evaluateActivePhase(room: RoomState, game: GameState): Promise<void>;
  /**
   * BIN-615 / PR-C1 post-draw hook (variant-overridable). G2/G3 use this
   * for their own auto-claim / pattern-cycling logic.
   */
  onDrawCompleted(ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("./variantConfig.js").GameVariantConfig | undefined;
  }): Promise<void>;
  /**
   * BIN-615 / PR-C3 lucky-number fan-out hook (variant-overridable).
   * Default no-op on BingoEngine; G3 uses it for stand-alone bonus.
   */
  onLuckyNumberDrawn(ctx: {
    room: RoomState;
    game: GameState;
    player: Player;
    luckyNumber: number;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("./variantConfig.js").GameVariantConfig;
  }): Promise<void>;
  /** K5 (CRIT-4) circuit-breaker entry. */
  handleHookError(
    hook: EngineHookName,
    room: RoomState,
    game: GameState | undefined,
    err: unknown,
  ): void;
  /**
   * K5 same-cause-counter reset. Called by service after a hook
   * succeeds so historical errors don't trip the threshold later.
   */
  resetHookErrorCounter(roomCode: string, hook: EngineHookName): void;
  /** HOEY-3 per-draw checkpoint write. */
  writeDrawCheckpoint(room: RoomState, game: GameState): Promise<void>;
  /** HOEY-6 / BIN-248 game-end checkpoint write. */
  writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void>;
  /** Finalize per-player play-sessions when the round ends. */
  finishPlaySessionsForGame(
    room: RoomState,
    game: GameState,
    endedAtMs: number,
  ): Promise<void>;
  /**
   * BIN-615 / PR-C1 variant-config lookup (engine-cached). Returns
   * `undefined` on cache-miss; the service may auto-bind for Spill 1
   * via {@link DrawOrchestrationCallbacks.autoBindSpill1VariantConfig}.
   */
  getVariantConfigForRoom(
    roomCode: string,
  ): import("./variantConfig.js").GameVariantConfig | undefined;
  /**
   * Defense-in-depth auto-bind path (Tobias 2026-04-27): when a Spill 1
   * room reaches `drawNext` with no `variantConfig` cached (Render
   * restart or cache-tap), the service tells the engine to bind
   * `DEFAULT_NORSK_BINGO_CONFIG` so auto-claim phase mode keeps working.
   * Engine logs the `[CRIT] VARIANT_CONFIG_AUTO_BOUND` event itself —
   * the service simply asks for the bind.
   */
  autoBindSpill1VariantConfig(
    roomCode: string,
  ): import("./variantConfig.js").GameVariantConfig;
  /**
   * BIN-615 / PR-C3 lucky-number registry lookup. Returns the per-room
   * map of `playerId → luckyNumber`, or `undefined` if no players have
   * registered a lucky number for this room.
   */
  getLuckyNumbersForRoom(roomCode: string): Map<string, number> | undefined;
}

/**
 * Stand-alone draw-orchestration service. Constructed once per
 * BingoEngine instance. Owns two pieces of state:
 *   - `drawLocksByRoom`: HIGH-5 per-room draw mutex.
 *   - `lastDrawAtByRoom`: MEDIUM-1/BIN-253 per-room last-draw timestamp.
 *
 * Both are evicted via {@link cleanupRoomCaches} which the engine
 * invokes from its `cleanupRoomLocalCaches` callback on `destroyRoom`.
 *
 * All side-effects on `RoomState` / `GameState` happen on the references
 * supplied by callbacks — no internal copies of game state.
 */
export class DrawOrchestrationService {
  /**
   * HIGH-5 (Casino Review): per-room draw mutex. Hindrer at to samtidige
   * `draw:next`-events fra samme rom begge passerer `assertHost` og
   * deretter muterer `currentGame.drawBag`/`drawnNumbers` parallelt.
   * Per-socket-rate-limit (`socketRateLimit.ts:23`, 5/2s) er ikke nok —
   * to ulike sockets (samme host i to faner, eller to admin-tilgangs-
   * paneler) kan kalle samtidig.
   *
   * Verdien er den pågående draw-promisen. Når neste kall kommer mens
   * en draw er in-flight, kaster vi `DRAW_IN_PROGRESS` istedenfor å
   * vente — dette hindrer at request-køen vokser ukontrollert hvis et
   * nettverks-tregt admin-panel sender retries før forrige har
   * returnert.
   *
   * Cleared i `finally` etter hver draw og via {@link cleanupRoomCaches}
   * i `destroyRoom`.
   */
  private readonly drawLocksByRoom = new Map<string, Promise<unknown>>();

  /**
   * MEDIUM-1/BIN-253: per-room last-draw timestamp for interval
   * enforcement. Set on the success-path of every draw and consulted at
   * the start of the next draw.
   */
  private readonly lastDrawAtByRoom = new Map<string, number>();

  constructor(
    private readonly bingoAdapter: BingoSystemAdapter,
    /** MEDIUM-1: minimum interval between manual draws (ms). 0 disables. */
    private readonly minDrawIntervalMs: number,
    /** MAX_BINGO_BALLS_75 cap on `drawnNumbers.length` per round. */
    private readonly maxDrawsPerRound: number,
    private readonly callbacks: DrawOrchestrationCallbacks,
  ) {}

  /**
   * Public entry point for a single `draw:next`.
   *
   * Behavior is byte-identical to the pre-extraction
   * {@link BingoEngine.drawNextNumber}:
   *   - HIGH-5 per-room mutex check (`DRAW_IN_PROGRESS` if a draw is
   *     already in flight).
   *   - Sets the in-flight promise into `drawLocksByRoom`.
   *   - Awaits the locked path.
   *   - On finally, clears the lock entry only if it's still the same
   *     promise (defensive against destroyRoom-races).
   *
   * @throws `DomainError("DRAW_IN_PROGRESS")` if another draw for the
   *   same room is in-flight.
   */
  async drawNext(
    input: DrawOrchestrationInput,
  ): Promise<{ number: number; drawIndex: number; gameId: string }> {
    // HIGH-5: per-room mutex. To parallelle `draw:next` mot samme rom
    // skal aldri begge mutere `currentGame.drawBag`. Hvis lock pågår,
    // reject med rate-limit-aktig DomainError istedenfor å queue (queue
    // ville økt latency + risiko for back-to-back duplikat-draws hvis
    // klienten retry'er).
    const lockKey = input.roomCode.trim().toUpperCase();
    const inFlight = this.drawLocksByRoom.get(lockKey);
    if (inFlight !== undefined) {
      throw new DomainError(
        "DRAW_IN_PROGRESS",
        "Et annet trekk for dette rommet pågår allerede. Vent til det er ferdig.",
      );
    }
    const drawPromise = this._drawNextLocked(input);
    this.drawLocksByRoom.set(lockKey, drawPromise);
    try {
      return await drawPromise;
    } finally {
      // Kun fjern hvis det fortsatt er VÅR promise — defensiv mot
      // teoretisk race der destroyRoom har kjørt og en ny lock kunne
      // vært satt (kan ikke skje med dagens API, men billig å sjekke).
      if (this.drawLocksByRoom.get(lockKey) === drawPromise) {
        this.drawLocksByRoom.delete(lockKey);
      }
    }
  }

  /**
   * HIGH-5: faktisk draw-implementasjon. Kalles kun fra
   * {@link drawNext} som holder per-room-mutex rundt dette.
   */
  private async _drawNextLocked(
    input: DrawOrchestrationInput,
  ): Promise<{ number: number; drawIndex: number; gameId: string }> {
    const room = this.callbacks.requireRoom(input.roomCode);
    // CRIT-4: scheduled Spill 1 må trekkes via Game1DrawEngineService.
    // Defensiv guard mot dual-engine state-divergens.
    this.callbacks.assertNotScheduled(room);
    // K3: production retail Spill 1 må kjøre via scheduled-engine.
    this.callbacks.assertSpill1NotAdHoc(room);
    this.callbacks.assertHost(room, input.actorPlayerId);

    // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.6):
    // For system-driven kall til perpetual-rom (auto-draw-tick) er det
    // ingen spesifikk spiller å validere — actor er sentinel-en
    // SYSTEM_ACTOR_ID. Skip requirePlayer + wallet-check; assertHost
    // har allerede tillatt dette via slug-guard. Spill 1 (master-flow)
    // tillater IKKE system-actor (assertHost ville kastet NOT_HOST før
    // vi når hit), så denne grenen er strikt scoped til Spill 2/3.
    const isSystemDriven =
      isSystemActor(input.actorPlayerId) && isPerpetualSlug(room.gameSlug);
    if (!isSystemDriven) {
      const host = this.callbacks.requirePlayer(room, input.actorPlayerId);
      this.callbacks.assertWalletAllowedForGameplay(host.walletId, Date.now());
    }
    const nowMs = Date.now();

    // BIN-460: Block draws while game is paused
    if (room.currentGame?.isPaused) {
      throw new DomainError("GAME_PAUSED", "Spillet er pauset — trekking ikke tillatt.");
    }

    // MEDIUM-1/BIN-253: Enforce minimum interval between manual draws
    if (this.minDrawIntervalMs > 0) {
      const lastDraw = this.lastDrawAtByRoom.get(room.code);
      if (lastDraw !== undefined) {
        const elapsed = nowMs - lastDraw;
        if (elapsed < this.minDrawIntervalMs) {
          const waitSec = ((this.minDrawIntervalMs - elapsed) / 1000).toFixed(1);
          throw new DomainError("DRAW_TOO_FAST", `Vent ${waitSec}s mellom trekninger.`);
        }
      }
    }

    const game = this.callbacks.requireRunningGame(room);
    if (game.drawnNumbers.length >= this.maxDrawsPerRound) {
      // PHASE3-FIX (2026-04-27): Last-chance også her, symmetri med
      // MAX_DRAWS-grenen post-draw nedenfor. Defense-in-depth.
      const variantConfigForPreDrawMax = this.callbacks.getVariantConfigForRoom(room.code);
      if (variantConfigForPreDrawMax?.autoClaimPhaseMode) {
        try {
          await this.callbacks.evaluateActivePhase(room, game);
          this.callbacks.resetHookErrorCounter(
            room.code,
            "evaluateActivePhase.preDrawMaxDraws",
          );
        } catch (err) {
          // K5: same-cause-tracking + halt-the-room.
          this.callbacks.handleHookError(
            "evaluateActivePhase.preDrawMaxDraws",
            room,
            game,
            err,
          );
        }
      }
      if ((game.status as string) === "RUNNING") {
        const endedAtMs = Date.now();
        const endedAt = new Date(endedAtMs);
        game.status = "ENDED";
        game.endedAt = endedAt.toISOString();
        game.endedReason = "MAX_DRAWS_REACHED";
        await this.callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
        // HOEY-6/BIN-248: Write GAME_END checkpoint for MAX_DRAWS_REACHED
        await this.callbacks.writeGameEndCheckpoint(room, game);
      }
      throw new DomainError("NO_MORE_NUMBERS", `Maks antall trekk (${this.maxDrawsPerRound}) er nådd.`);
    }

    const nextNumber = game.drawBag.shift();
    if (!nextNumber) {
      // PHASE3-FIX (2026-04-27): Last-chance evaluateActivePhase også her
      // — symmetri med MAX_DRAWS_REACHED-grenen lenger ned. Hvis siste
      // trukne ball fullførte alle phaser men recursion ble avbrutt før
      // neste fase ble vunnet, gir vi det én siste sjanse.
      const variantConfigForBagEmpty = this.callbacks.getVariantConfigForRoom(room.code);
      if (variantConfigForBagEmpty?.autoClaimPhaseMode) {
        try {
          await this.callbacks.evaluateActivePhase(room, game);
          this.callbacks.resetHookErrorCounter(
            room.code,
            "evaluateActivePhase.drawBagEmpty",
          );
        } catch (err) {
          // K5: same-cause-tracking + halt-the-room.
          this.callbacks.handleHookError(
            "evaluateActivePhase.drawBagEmpty",
            room,
            game,
            err,
          );
        }
      }
      // Re-sjekk status: hvis Phase 5 vant, ikke overskriv BINGO_CLAIMED.
      if ((game.status as string) === "RUNNING") {
        const endedAtMs = Date.now();
        const endedAt = new Date(endedAtMs);
        game.status = "ENDED";
        game.endedAt = endedAt.toISOString();
        game.endedReason = "DRAW_BAG_EMPTY";
        await this.callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
        // HOEY-6/BIN-248: Write GAME_END checkpoint for DRAW_BAG_EMPTY
        await this.callbacks.writeGameEndCheckpoint(room, game);
      }
      throw new DomainError("NO_MORE_NUMBERS", "Ingen tall igjen i trekken.");
    }

    game.drawnNumbers.push(nextNumber);
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: per-draw INFO-log. Default-på via
    // BINGO_VERBOSE_ROOM_LOGS — kan slås AV (eks. for batch-rerun-tester) hvis
    // log-volum blir et problem. drawIndex er 1-basert (matcher socket-payload).
    // `source` settes på socket/scheduler-laget — engine selv vet ikke om det
    // var auto vs manual draw.
    logRoomEvent(
      logger,
      {
        roomCode: room.code,
        gameId: game.id,
        drawIndex: game.drawnNumbers.length,
        number: nextNumber,
      },
      "game.draw",
    );
    if (this.bingoAdapter.onNumberDrawn) {
      await this.bingoAdapter.onNumberDrawn({
        roomCode: room.code,
        gameId: game.id,
        number: nextNumber,
        drawIndex: game.drawnNumbers.length
      });
    }
    // BIN-615 / PR-C1: variant-specific post-draw hook (no-op by default).
    // Subclasses (Game3Engine in PR-C3) override to implement auto-claim /
    // pattern-cycling after each ball. Errors are logged but do not fail the draw.
    let variantConfigForDraw = this.callbacks.getVariantConfigForRoom(room.code);
    // VARIANT-CONFIG GUARD: defense-in-depth (Tobias 2026-04-27, narrowed 2026-04-27)
    //
    // Etter Render-restart (eller ethvert in-memory cache-tap) kan
    // `variantConfigByRoom` være helt tom for et eksisterende rom som
    // fortsatt tar imot `drawNextNumber`-call. For Spill 1 (`bingo` /
    // `game_1`) ville dette gjort at `autoClaimPhaseMode` ikke kjørte →
    // 3-fase auto-claim (BIN-694) ville stille feilet, og
    // `evaluateActivePhase` ville aldri markert vinnere. Vi velger
    // fail-loud + auto-bind kun ved cache-miss:
    //
    //   1. Engine logger CRIT-event slik at ops kan se at fallback brukes.
    //   2. Engine setter inn `DEFAULT_NORSK_BINGO_CONFIG` så draw-flyten
    //      kan fortsette med korrekt variant-config istedenfor å degrade
    //      til standard-mode uten fasestyring.
    //
    // VIKTIG: guarden fyrer KUN når `variantConfigForDraw` er helt
    // undefined (cache-miss). Hvis operator har satt en valid config
    // med `autoClaimPhaseMode=false` (f.eks. for testing av custom
    // mode), respekteres den — guarden skal aldri overstyre operator-
    // satt config stille.
    //
    // Andre spill (rocket/monsterbingo/spillorama) skipper auto-bind —
    // de har sin egen variant-config og skal ikke få Spill 1-default.
    if (
      (room.gameSlug === "bingo" || room.gameSlug === "game_1") &&
      !variantConfigForDraw
    ) {
      logger.error(
        {
          roomCode: room.code,
          gameId: game.id,
          gameSlug: room.gameSlug,
          hasConfig: false,
        },
        "[CRIT] VARIANT_CONFIG_AUTO_BOUND — Spill 1 room mangler variantConfig (cache-miss), auto-binder DEFAULT_NORSK_BINGO_CONFIG",
      );
      variantConfigForDraw = this.callbacks.autoBindSpill1VariantConfig(room.code);
    }
    try {
      await this.callbacks.onDrawCompleted({
        room,
        game,
        lastBall: nextNumber,
        drawIndex: game.drawnNumbers.length,
        variantConfig: variantConfigForDraw
      });
      // K5: hook lykkes — resett same-cause-counter så historiske feil
      // ikke teller mot terskelen.
      this.callbacks.resetHookErrorCounter(room.code, "onDrawCompleted");
    } catch (err) {
      // K5 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.4 / CRIT-4): erstatter
      // tidligere log-then-continue-mønster. handleHookError lager same-
      // cause-fingerprint, halter rommet ved wallet-shortage eller etter
      // N consecutive failures, og emitterer EngineDegradedEvent.
      this.callbacks.handleHookError("onDrawCompleted", room, game, err);
    }
    // BIN-694: 3-fase norsk 75-ball bingo auto-claim. Gates bak
    // `autoClaimPhaseMode` (ny flag i variantConfig, satt kun av
    // DEFAULT_NORSK_BINGO_CONFIG). G2/G3 har sin egen auto-claim via
    // onDrawCompleted-override og skal IKKE kjøre denne pathen.
    //
    // Kjører etter hver ball: sjekker om noen brett oppfyller aktiv
    // fase (1 Rad / 2 Rader / Fullt Hus), splitter premien mellom
    // samtidige vinnere, markerer fasen som vunnet. Kun Fullt Hus-
    // fasen avslutter runden.
    if (variantConfigForDraw?.autoClaimPhaseMode && game.status === "RUNNING") {
      try {
        await this.callbacks.evaluateActivePhase(room, game);
        this.callbacks.resetHookErrorCounter(room.code, "evaluateActivePhase");
      } catch (err) {
        // K5: same-cause-tracking + halt-the-room. Wallet-shortage halter
        // umiddelbart; andre feil kreves >=N consecutive innen 60s-vindu.
        this.callbacks.handleHookError("evaluateActivePhase", room, game, err);
      }
    }
    // BIN-615 / PR-C3: Fan-out lucky-number hook. Fires per-player when the
    // player's registered luckyNumber matches lastBall AND the variant enables
    // lucky numbers (luckyNumberPrize > 0). Default onLuckyNumberDrawn is
    // no-op — G1 (no luckyNumberPrize) and G2 (uses inline coupling) unchanged.
    if (variantConfigForDraw && (variantConfigForDraw.luckyNumberPrize ?? 0) > 0) {
      const roomLucky = this.callbacks.getLuckyNumbersForRoom(room.code);
      if (roomLucky && roomLucky.size > 0) {
        for (const [playerId, luckyNumber] of roomLucky) {
          if (luckyNumber !== nextNumber) continue;
          const player = room.players.get(playerId);
          if (!player) continue;
          try {
            await this.callbacks.onLuckyNumberDrawn({
              room,
              game,
              player,
              luckyNumber,
              lastBall: nextNumber,
              drawIndex: game.drawnNumbers.length,
              variantConfig: variantConfigForDraw
            });
          } catch (err) {
            logger.error({ err, gameId: game.id, roomCode: room.code, playerId }, "onLuckyNumberDrawn hook failed");
          }
        }
      }
    }
    // HOEY-3: Checkpoint after each draw — persists draw sequence state
    await this.callbacks.writeDrawCheckpoint(room, game);
    // FULLTHUS-FIX (2026-04-27): Phase 5 (Fullt Hus) MÅ vinnes hvis alle
    // 75 baller er trukket — for 75-ball bingo dekker drawnSet alltid hele
    // 5×5-grid (kun cell 0 er free centre). Hvis `evaluateActivePhase`
    // over har lagt evaluering bak ENDED-flag for Phase 5, må vi IKKE
    // overskrive `game.endedReason` med MAX_DRAWS_REACHED.
    //
    // ROOT CAUSE: før denne fixen overskrev MAX_DRAWS_REACHED-blokken
    // ubetinget `game.status="ENDED"` og `game.endedReason` selv om
    // Phase 5 nettopp hadde satt `BINGO_CLAIMED`. User-rapportert bug
    // 2026-04-27: ad-hoc bingo der user vant 1-4 Rader, men Fullt Hus
    // forble won=False fordi MAX_DRAWS_REACHED skrev over BINGO_CLAIMED-
    // status fra evaluateActivePhase i samme drawNextNumber-call.
    //
    // Defensiv tiltak: hvis `evaluateActivePhase` ikke fikk fullført
    // Phase 5 (f.eks. transient ledger-feil ble swallowed av try/catch
    // over), kjør én siste evaluering FØR vi ender med MAX_DRAWS. Dette
    // er trygt: hvis Phase 5 ikke kan vinnes (ingen tickets med fullt
    // hus), returnerer evaluateActivePhase uten side-effekter.
    if (game.drawnNumbers.length >= this.maxDrawsPerRound && game.status === "RUNNING") {
      // Last-chance Phase 5 evaluation before MAX_DRAWS_REACHED. Hvis
      // evaluateActivePhase tidligere kastet en transient feil, gir vi
      // det én siste sjanse her — særlig viktig på ball 75 der ALL non-
      // free celler i 5×5-grid garantert er dekket av drawnSet.
      if (variantConfigForDraw?.autoClaimPhaseMode) {
        try {
          await this.callbacks.evaluateActivePhase(room, game);
          this.callbacks.resetHookErrorCounter(
            room.code,
            "evaluateActivePhase.lastChanceMaxDraws",
          );
        } catch (err) {
          // K5: same-cause-tracking + halt-the-room. Last-chance-pathen er
          // sjelden — terskelen passeres bare hvis evaluateActivePhase virkelig
          // er stuck samme cause på flere draws.
          this.callbacks.handleHookError(
            "evaluateActivePhase.lastChanceMaxDraws",
            room,
            game,
            err,
          );
        }
      }
    }
    // Re-sjekk status: hvis Phase 5 vant i evaluateActivePhase (enten
    // det første kallet over eller last-chance-kallet), er game.status
    // allerede "ENDED" med endedReason="BINGO_CLAIMED". Da MÅ vi IKKE
    // overskrive til MAX_DRAWS_REACHED.
    if (game.drawnNumbers.length >= this.maxDrawsPerRound && game.status === "RUNNING") {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "MAX_DRAWS_REACHED";
      await this.callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
      // HOEY-6/BIN-248: Write GAME_END checkpoint for MAX_DRAWS_REACHED (post-draw)
      await this.callbacks.writeGameEndCheckpoint(room, game);
    }
    // MEDIUM-1/BIN-253: Record draw timestamp for interval enforcement
    this.lastDrawAtByRoom.set(room.code, Date.now());
    // BIN-689: The **wire-level** `drawIndex` is the 0-based array index of
    // the ball in `drawnNumbers` (i.e. `length - 1`). The client's
    // GameBridge gap-detection contract (BIN-502) is 0-based —
    // `lastAppliedDrawIndex = -1` means no draws yet, so the first ball is
    // expected at drawIndex=0. Previously we returned `length`, which is
    // 1-based (first ball drawIndex=1), causing every draw to look like a
    // gap → infinite resync loop on staging (BallTube empty, no animation
    // fired). Ref: GameBridge.ts:355 + GameBridge.test.ts.
    //
    // NB: Engine-internal hooks (`onDrawCompleted`, `onLuckyNumberDrawn`)
    // and the `onNumberDrawn` bingoAdapter callback keep the 1-based
    // "drawnCount" semantics above — PatternCycler.step() and
    // GAME2_MIN_DRAWS_FOR_CHECK both depend on that.
    return { number: nextNumber, drawIndex: game.drawnNumbers.length - 1, gameId: game.id };
  }

  /**
   * Per-room cache eviction. Called from the engine's
   * `cleanupRoomLocalCaches` callback in `RoomLifecycleService.destroyRoom`
   * so the service's `drawLocksByRoom` + `lastDrawAtByRoom` Maps don't
   * leak after a room is destroyed.
   *
   * Idempotent — safe to call multiple times for the same room code.
   */
  cleanupRoomCaches(roomCode: string): void {
    this.drawLocksByRoom.delete(roomCode);
    this.lastDrawAtByRoom.delete(roomCode);
  }

  /**
   * Test-only introspection: expose the current draw-lock map state for
   * unit tests that need to assert lock acquisition / release. Hidden
   * from public API on purpose; tests cast through `unknown`.
   */
  __getLockState(roomCode: string): Promise<unknown> | undefined {
    return this.drawLocksByRoom.get(roomCode.trim().toUpperCase());
  }

  /**
   * Test-only introspection: expose the recorded last-draw timestamp
   * for a given room so tests can verify MEDIUM-1/BIN-253 interval
   * enforcement is wired through the service.
   */
  __getLastDrawAt(roomCode: string): number | undefined {
    return this.lastDrawAtByRoom.get(roomCode);
  }
}
