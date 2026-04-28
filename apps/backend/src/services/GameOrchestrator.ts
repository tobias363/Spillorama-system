/**
 * Unified pipeline refactor — Fase 4 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.7).
 *
 * Sentral orchestrator som koordinerer "advance the game by one draw" ved
 * å vire sammen Fase 1-3-tjenestene:
 *
 *   1. `DrawingService.drawNext(state)` — pure beslutning om neste ball.
 *   2. State-applisering — pure transformasjon (drawnNumbers + drawsCompleted).
 *   3. `PatternEvalService.evaluateAfterDraw(state)` — pure beslutning om
 *      hvilke patterns som er klare til auto-claim.
 *   4. `PayoutService.payoutPhase(input)` — atomisk wallet-credit + ledger
 *      + audit per phase advance.
 *   5. Per-orchestration audit-summary.
 *
 * **Scope:**
 *
 *   GameOrchestrator er en pure coordination-tjeneste. Den eier IKKE:
 *   - DB-transaksjoner (caller wrapper med `runInTransaction(...)`).
 *   - Socket broadcasts (caller emiterer POST-orchestration).
 *   - Mini-game/jackpot/oddsen/lucky-bonus (DB-bound side-effects som
 *     fortsatt eier av `Game1DrawEngineService` post-orchestration).
 *   - Auto-pause (Spill 1-spesifikk side-effect; orchestrator rapporterer
 *     `phaseWonInThisDraw=true` så caller kan bestemme).
 *   - End-of-round-håndtering (caller setter `game.status='completed'` når
 *     `result.allCardsClosed === true`).
 *
 * **Determinisme:**
 *
 *   For en gitt input-state gir tjenesten ALLTID samme output:
 *   - DrawingService: deterministisk fra `drawBag[drawsCompleted]`.
 *   - PatternEvalService: deterministisk lex-sort av winners + colors.
 *   - PayoutService: floor-split, deterministisk allokering.
 *
 *   Dette gjør equivalence-tester (Old==New) trygge — samme bag + samme
 *   tickets + samme idempotency-key gir nøyaktig samme wallet-credit-
 *   sekvens og ledger-events.
 *
 * **Atomicity-kontrakt:**
 *
 *   Caller forventes å wrappe `advanceGameByOneDraw(...)` i en outer DB-
 *   transaksjon (typisk `wallet.withTransaction(...)` eller
 *   `pool.transaction(...)`). Inne i orchestrator-en kjøres alle
 *   service-kall sekvensielt — feil i et tidlig steg propagerer ut og
 *   caller ruller tilbake. Hvis PayoutService kaster `PayoutWalletCreditError`
 *   propagerer det videre slik at hele draw-en ruller tilbake.
 *
 *   Compliance- og audit-feil er soft-fail (PayoutService-policy) — payout
 *   fortsetter selv om de feiler, men en warning logges.
 *
 * **Idempotency:**
 *
 *   Pure-funksjons-natur via 3-services + IdempotencyKeyPort gjør at
 *   gjentatte kall med samme `(gameId, drawsCompleted)` gir samme output.
 *   Wallet- og compliance-skriving er idempotent på key (UNIQUE-constraint).
 *   Audit-log er fire-and-forget — re-kall skriver flere rader (akseptert
 *   for audit-strøm).
 *
 * **Hvordan caller wirer dette opp** (Fase 4 wire-up):
 *
 *   ```ts
 *   // I Game1DrawEngineService.drawNext (in-transaction):
 *   const drawingState = buildDrawingState(scheduledGame);
 *   const orchestratorResult = await orchestrator.advanceGameByOneDraw({
 *     drawingState,
 *     buildPatternEvalState: (afterDraw) => buildPatternEvalState(scheduledGame, afterDraw),
 *     buildPayoutInput: (advance, drawnBall) => buildPayoutInput(scheduledGame, advance, drawnBall),
 *   });
 *
 *   // Persist DB-state-endringer (caller-eier).
 *   await persistDrawAndClaims(client, scheduledGameId, orchestratorResult);
 *
 *   // POST-commit broadcasts (caller-eier).
 *   broadcastDrawAndPhaseWon(orchestratorResult);
 *   ```
 *
 *   Eksisterende `Game1DrawEngineService.evaluateAndPayoutPhase` kan
 *   beholdes uendret i Fase 4 — orchestrator-en er additive og opt-in.
 *   Migrering av call-sites skjer inkrementelt med equivalence-test som
 *   safety-net.
 *
 * **Hvorfor IKKE slett `Game1DrawEngineService` i Fase 4:**
 *
 *   Game1DrawEngineService eier 3103 LOC med DB-spesifikke mutations
 *   (mini-games, jackpots, lucky-bonus, oddsen, physical tickets,
 *   auto-pause, room-cleanup) som IKKE er i scope for Fase 1-3-services.
 *   Å erstatte det med kun orchestrator + ports ville kreve full DB→port-
 *   adapter-bridges for hvert subdomain — utenfor Fase 4-budsjett (1-2
 *   dev-dager).
 *
 *   Per casino-research §6 ("Module boundaries") og handoff-brief §6
 *   ("Game1DrawEngineService er ALLEREDE atomisk via runInTransaction"),
 *   prioriterer vi å la prod-flyten bestå og bygge GameOrchestrator som
 *   ny opt-in primitive som senere faser kan migrere til.
 *
 *   Equivalence-testen verifiserer at orchestrator-flyten produserer
 *   identiske wallet-credits og compliance-events som den ad-hoc
 *   BingoEngine-flyten gjør. Det er kontrakt-baseline-en for fremtidig
 *   migrasjon.
 */

import type {
  AuditPort,
  CompliancePort,
  IdempotencyKeyPort,
  WalletPort,
} from "../ports/index.js";
import {
  DrawingError,
  DrawingService,
  type DrawingGameState,
  type DrawingResult,
} from "./DrawingService.js";
import {
  PatternEvalService,
  type NewClaim,
  type PatternEvalResult,
  type PatternEvalState,
  type PhaseAdvance,
} from "./PatternEvalService.js";
import {
  PayoutService,
  PayoutWalletCreditError,
  type PayoutPhaseInput,
  type PayoutPhaseResult,
  type PayoutWinner,
} from "./PayoutService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game-orchestrator" });

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Per-phase-payout-builder. Caller bestemmer hvordan vinnere skal mappes
 * fra `PhaseAdvance` til `PayoutPhaseInput` (resolver wallet-IDer, hall-IDer,
 * pris-beregning, multi-color-split osv.).
 *
 * Returner `null` for å skippe payout for denne phase advance (e.g. hvis
 * caller-side har egne payout-flow som ikke matcher PayoutService-kontrakten).
 */
export type BuildPayoutInputFn = (
  advance: PhaseAdvance,
  context: { gameId: string; drawnBall: number; drawSequenceNumber: number },
) => PayoutPhaseInput | null;

/**
 * Lazy-konstruksjon av PatternEvalState etter at draw er anvendt. Caller
 * bygger state med oppdatert drawn-set + tickets + patternResults.
 *
 * Returner `null` for å skippe pattern-eval (e.g. hvis spillet er på
 * status-ENDED eller har ingen aktive patterns).
 */
export type BuildPatternEvalStateFn = (
  afterDraw: { drawnBall: number; drawSequenceNumber: number },
) => PatternEvalState | null;

export interface AdvanceGameByOneDrawInput {
  /**
   * State-snapshot for DrawingService. Caller bygger denne fra DB-state
   * via egen helper (typisk `parseDrawBag(state.draw_bag_json)` +
   * `state.draws_completed`).
   */
  drawingState: DrawingGameState;
  /**
   * Builder for PatternEvalState — kalles ETTER at DrawingService har
   * returnert resultatet, slik at caller kan inkludere den nye ballen i
   * drawnNumbers.
   */
  buildPatternEvalState: BuildPatternEvalStateFn;
  /**
   * Builder for payout-input per phase advance. Kalles ÉN gang per
   * PhaseAdvance i resultatet.
   */
  buildPayoutInput: BuildPayoutInputFn;
}

export interface PhasePayoutSummary {
  /** Phase-advance fra PatternEvalService. */
  advance: PhaseAdvance;
  /** Result fra PayoutService.payoutPhase, eller null hvis caller skippet. */
  payout: PayoutPhaseResult | null;
}

export interface AdvanceGameByOneDrawResult {
  /** Resultat fra DrawingService — neste ball + sequence + isLastDraw. */
  drawing: DrawingResult;
  /**
   * Resultat fra PatternEvalService — alle nye claims + phasesAdvanced +
   * allCardsClosed. `null` hvis caller skippet eval (returnerte null fra
   * `buildPatternEvalState`).
   */
  patternEval: PatternEvalResult | null;
  /**
   * Per-phase payout-resultater — én entry per `phasesAdvanced` fra
   * patternEval. Tom array hvis ingen phases avanserte.
   */
  payouts: readonly PhasePayoutSummary[];
  /**
   * `true` hvis spillet skal regnes som ferdig:
   *   - DrawingResult.isLastDraw, ELLER
   *   - PatternEvalResult.allCardsClosed.
   *
   * Caller bruker dette til å sette `game.status='completed'` /
   * `game.status='ENDED'` post-orchestration.
   */
  shouldEndGame: boolean;
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Pure orchestrator. Konstruktør tar 4 ports (samme som PayoutService) og
 * (valgfritt) custom DrawingService/PatternEvalService-instanser for
 * testbarhet.
 *
 * Bruk:
 * ```ts
 * const orchestrator = new GameOrchestrator({
 *   wallet, compliance, audit, keys,
 * });
 * const result = await orchestrator.advanceGameByOneDraw({
 *   drawingState: { ... },
 *   buildPatternEvalState: (afterDraw) => ({ ... }),
 *   buildPayoutInput: (advance, ctx) => ({ ... }),
 * });
 * ```
 */
export class GameOrchestrator {
  private readonly drawingService: DrawingService;
  private readonly patternEvalService: PatternEvalService;
  private readonly payoutService: PayoutService;

  constructor(
    private readonly deps: {
      wallet: WalletPort;
      compliance: CompliancePort;
      audit: AuditPort;
      keys: IdempotencyKeyPort;
      /**
       * Optional custom DrawingService — default ny instans. Tester kan
       * injisere en stub for å forsere DrawingError-grener uten å mocke
       * state-validering.
       */
      drawingService?: DrawingService;
      /**
       * Optional custom PatternEvalService — default ny instans.
       */
      patternEvalService?: PatternEvalService;
      /**
       * Optional custom PayoutService — default ny instans bygd med
       * deps.wallet/compliance/audit/keys. Tester kan injisere en stub
       * for å verifisere idempotency-key-kall uten å gå gjennom hele
       * payout-flyten.
       */
      payoutService?: PayoutService;
    },
  ) {
    this.drawingService = deps.drawingService ?? new DrawingService();
    this.patternEvalService =
      deps.patternEvalService ?? new PatternEvalService();
    this.payoutService =
      deps.payoutService ??
      new PayoutService({
        wallet: deps.wallet,
        compliance: deps.compliance,
        audit: deps.audit,
        keys: deps.keys,
      });
  }

  /**
   * Trekk neste ball + evaluér patterns + utbetal vinnere atomisk.
   *
   * Ordre:
   *   1. DrawingService.drawNext — kan kaste DrawingError (caller propagerer).
   *   2. buildPatternEvalState — caller-eid; hvis null returnerer vi tidlig
   *      (ingen patterns å evaluere).
   *   3. PatternEvalService.evaluateAfterDraw — pure beregning.
   *   4. For hver phase advance: buildPayoutInput → PayoutService.payoutPhase.
   *      Hvis buildPayoutInput returnerer null, skipper vi payout for den
   *      advance-en (men registrerer den fortsatt i resultatet).
   *   5. Audit-summary for hele orchestrationen.
   *
   * Atomicity-kontrakt:
   *   - DrawingError → caller-tx ruller tilbake (forventet sti).
   *   - PayoutWalletCreditError → caller-tx ruller tilbake (PayoutService-
   *     policy).
   *   - Compliance/audit-feil → soft-fail, payout fortsetter (PayoutService-
   *     policy).
   *
   * Throws:
   *   - DrawingError (re-thrown fra DrawingService).
   *   - PayoutWalletCreditError (re-thrown fra PayoutService).
   */
  async advanceGameByOneDraw(
    input: AdvanceGameByOneDrawInput,
  ): Promise<AdvanceGameByOneDrawResult> {
    // ── Step 1: Drawing ────────────────────────────────────────────────────
    const drawing = this.drawingService.drawNext(input.drawingState);

    // ── Step 2: Build PatternEvalState ─────────────────────────────────────
    //
    // Caller bestemmer om pattern-eval skal kjøres (typisk hopper de over
    // hvis spillet er på en variant uten patterns, e.g. Spill 2 free-roll).
    const patternEvalState = input.buildPatternEvalState({
      drawnBall: drawing.nextBall,
      drawSequenceNumber: drawing.drawSequenceNumber,
    });

    if (patternEvalState === null) {
      // Ingen pattern-eval → bare draw + skill ferdig hvis siste.
      await this.logOrchestrationSummary({
        gameId: input.drawingState.gameId,
        drawing,
        patternEval: null,
        payouts: [],
      });
      return {
        drawing,
        patternEval: null,
        payouts: [],
        shouldEndGame: drawing.isLastDraw,
      };
    }

    // ── Step 3: Pattern eval ───────────────────────────────────────────────
    const patternEval = this.patternEvalService.evaluateAfterDraw(patternEvalState);

    // ── Step 4: Payouts per phase advance ──────────────────────────────────
    const payouts: PhasePayoutSummary[] = [];
    for (const advance of patternEval.phasesAdvanced) {
      const payoutInput = input.buildPayoutInput(advance, {
        gameId: input.drawingState.gameId,
        drawnBall: drawing.nextBall,
        drawSequenceNumber: drawing.drawSequenceNumber,
      });

      if (payoutInput === null) {
        // Caller skippet payout (e.g. fysiske bonger som har egen payout-
        // pipeline). Registrer advance uten payout-resultat.
        payouts.push({ advance, payout: null });
        continue;
      }

      // PayoutService kaster PayoutWalletCreditError ved wallet-feil.
      // Vi propagerer videre slik at caller-tx ruller tilbake.
      const payout = await this.payoutService.payoutPhase(payoutInput);
      payouts.push({ advance, payout });
    }

    // ── Step 5: Orchestration-summary audit ────────────────────────────────
    await this.logOrchestrationSummary({
      gameId: input.drawingState.gameId,
      drawing,
      patternEval,
      payouts,
    });

    // ── Step 6: shouldEndGame-flag ─────────────────────────────────────────
    //
    // Spillet skal ende hvis:
    //   - Siste draw (drawing.isLastDraw), ELLER
    //   - PatternEvalResult.allCardsClosed (BINGO/Fullt Hus vunnet, eller
    //     alle patterns er vunnet i concurrent-mode).
    //
    // Caller bestemmer hvilke side-effekter (UPDATE scheduled_game.status,
    // game.status='ENDED', destroyRoom osv.) som skal kjøres.
    const shouldEndGame = drawing.isLastDraw || patternEval.allCardsClosed;

    return {
      drawing,
      patternEval,
      payouts,
      shouldEndGame,
    };
  }

  /**
   * Skriv én summary-event per orchestration. Ikke per draw — caller har
   * sin egen `game1_engine.draw`-audit i prod-flyten. Vi logger
   * `game.orchestration.advance` med metadata om alle 3 trinnene for
   * korrelasjon.
   *
   * Fire-and-forget — feil her ruller IKKE tilbake noe (audit er allerede
   * fire-and-forget på AuditPort-kontrakten).
   */
  private async logOrchestrationSummary(args: {
    gameId: string;
    drawing: DrawingResult;
    patternEval: PatternEvalResult | null;
    payouts: readonly PhasePayoutSummary[];
  }): Promise<void> {
    try {
      const totalPaidCents = args.payouts.reduce((sum, p) => {
        if (!p.payout) return sum;
        const phaseSum =
          p.payout.prizePerWinnerCents * p.payout.totalWinners +
          p.payout.houseRetainedCents;
        return sum + phaseSum;
      }, 0);

      await this.deps.audit.log({
        actorId: null,
        actorType: "SYSTEM",
        action: "game.orchestration.advance",
        resource: "game",
        resourceId: args.gameId,
        details: {
          drawnBall: args.drawing.nextBall,
          drawSequenceNumber: args.drawing.drawSequenceNumber,
          isLastDraw: args.drawing.isLastDraw,
          phasesAdvancedCount: args.patternEval?.phasesAdvanced.length ?? 0,
          newClaimsCount: args.patternEval?.newClaims.length ?? 0,
          allCardsClosed: args.patternEval?.allCardsClosed ?? false,
          payoutCount: args.payouts.length,
          totalPaidCents,
        },
      });
    } catch (err) {
      log.warn(
        { err, gameId: args.gameId },
        "[GAME-ORCHESTRATOR] audit.log feilet — fire-and-forget",
      );
    }
  }
}

// ── Re-exports for caller convenience ────────────────────────────────────────

/**
 * Re-eksport av sentrale typer slik at caller-kode kan importere alt fra
 * ett sted i Fase 4+ wire-up.
 */
export type {
  DrawingGameState,
  DrawingResult,
  NewClaim,
  PatternEvalResult,
  PatternEvalState,
  PhaseAdvance,
  PayoutPhaseInput,
  PayoutPhaseResult,
  PayoutWinner,
};

export { DrawingError, PayoutWalletCreditError };
