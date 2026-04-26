/**
 * BIN-690 Spor 3 M1: Game1MiniGameOrchestrator.
 *
 * Koordinerer mini-game-lifecycle etter Fullt Hus i Spill 1 scheduled-games.
 *
 * Ansvar:
 *   1) `maybeTriggerFor(context)` — kalles fra Game1DrawEngineService etter
 *      Fullt Hus detektert. Sjekker:
 *        - `config.spill1.miniGames` inneholder minst én aktiv type.
 *        - Finn neste type i rotasjonen (FIFO per scheduled_game).
 *        - INSERT app_game1_mini_game_results (status=triggered).
 *        - Send socket-event `mini_game:trigger` til vinner.
 *        - Fire-and-forget: feil logges men krasher IKKE draw-transaksjonen
 *          som trigget den (den er allerede committed på dette punktet).
 *
 *   2) `handleChoice(resultId, userId, choiceJson)` — kalles av socket-
 *      handler når klient svarer. Sjekker:
 *        - resultId finnes og tilhører userId.
 *        - completed_at er NULL (idempotent — dobbel-submit blir rejectet).
 *        - Dispatch til riktig MiniGame-implementasjon.
 *        - Utfør wallet-credit (hvis payoutCents > 0).
 *        - UPDATE result + payout_cents + completed_at i én transaksjon.
 *        - Send socket-event `mini_game:result` til vinner.
 *
 *   3) `listPending()` / `markAbandoned()` — M2+ kan legge til cleanup-jobb
 *      for ufullførte mini-games etter X minutter. I M1 kun stubber.
 *
 * Designvalg:
 *   - Mini-games-registry er en `Map<MiniGameType, MiniGame>` injisert via
 *     konstruktør. Tom-map = ingen mini-games registrert (M2 legger til
 *     `wheel`, M3 `chest`, osv. uten å endre orchestrator).
 *   - Dispatch via MiniGameType-discriminator — type-safe.
 *   - Fire-and-forget på trigger-siden: orchestrator skal IKKE kaste når
 *     Game1DrawEngineService kaller `maybeTriggerFor()`. Feil logges som
 *     warn + audit-event "game1_minigame.trigger_failed".
 *   - handleChoice er SERVER-autoritativ: resultat beregnes server-side,
 *     klient kan ikke bestemme payout.
 *
 * Socket-events (M1):
 *   Server → klient: `mini_game:trigger { type, resultId, payload, timeoutSeconds? }`
 *   Klient → server: `mini_game:choice { resultId, choice }`
 *   Server → klient: `mini_game:result { resultId, type, payoutCents, resultJson }`
 *
 * Denne filen eksporterer service-klassen. Socket-handlers + admin-broadcaster
 * lander i `src/sockets/miniGameEvents.ts` (M1) / utvides i M2-M5.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../BingoEngine.js";
import { IdempotencyKeys } from "../idempotency.js";
import type { MiniGame, MiniGameTriggerContext, MiniGameType } from "./types.js";
import { MINI_GAME_TYPES } from "./types.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import {
  NoopComplianceLedgerPort,
  type ComplianceLedgerPort,
} from "../../adapters/ComplianceLedgerPort.js";
import {
  NoopPrizePolicyPort,
  type PrizePolicyPort,
} from "../../adapters/PrizePolicyPort.js";
import { ledgerGameTypeForSlug } from "../ledgerGameTypeForSlug.js";
import { logger as rootLogger } from "../../util/logger.js";

const log = rootLogger.child({ module: "game1-mini-game-orchestrator" });

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Input til `maybeTriggerFor()`. Kalles fra Game1DrawEngineService etter
 * Fullt Hus detektert, post-commit (så mini-game-feil ikke ruller draw tilbake).
 */
export interface MaybeTriggerInput {
  /** ID på scheduled-game som vant Fullt Hus. */
  readonly scheduledGameId: string;
  /** Bruker-ID til Fullt Hus-vinneren. */
  readonly winnerUserId: string;
  /** Wallet-ID til vinneren. */
  readonly winnerWalletId: string;
  /** Hall-ID vinneren spilte fra. */
  readonly hallId: string;
  /** Draw-sekvens da Fullt Hus ble vunnet. */
  readonly drawSequenceAtWin: number;
  /**
   * `game_config_json` fra scheduled-game. Inneholder typisk
   * `{spill1: {miniGames: ["wheel", "chest", ...]}}`. Hvis tom → skip.
   */
  readonly gameConfigJson: unknown;
}

export interface MaybeTriggerResult {
  readonly triggered: boolean;
  readonly resultId: string | null;
  readonly miniGameType: MiniGameType | null;
  readonly reason?: string;
}

export interface HandleChoiceInput {
  readonly resultId: string;
  readonly userId: string;
  readonly choiceJson: Readonly<Record<string, unknown>>;
}

export interface HandleChoiceResult {
  readonly resultId: string;
  readonly miniGameType: MiniGameType;
  readonly payoutCents: number;
  readonly resultJson: Readonly<Record<string, unknown>>;
}

/** Port for å sende mini-game-events til klient (fire-and-forget socket-wrapper). */
export interface MiniGameBroadcaster {
  /** Send `mini_game:trigger` til vinneren. */
  onTrigger(event: MiniGameTriggerBroadcast): void;
  /** Send `mini_game:result` til vinneren. */
  onResult(event: MiniGameResultBroadcast): void;
}

export interface MiniGameTriggerBroadcast {
  readonly scheduledGameId: string;
  readonly winnerUserId: string;
  readonly resultId: string;
  readonly miniGameType: MiniGameType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly timeoutSeconds?: number;
}

export interface MiniGameResultBroadcast {
  readonly scheduledGameId: string;
  readonly winnerUserId: string;
  readonly resultId: string;
  readonly miniGameType: MiniGameType;
  readonly payoutCents: number;
  readonly resultJson: Readonly<Record<string, unknown>>;
}

/** No-op broadcaster — default i tester + når io ikke er wired opp enda. */
export const NoopMiniGameBroadcaster: MiniGameBroadcaster = {
  onTrigger: () => undefined,
  onResult: () => undefined,
};

export interface Game1MiniGameOrchestratorOptions {
  readonly pool: Pool;
  readonly schema?: string;
  readonly auditLog: AuditLogService;
  readonly walletAdapter: WalletAdapter;
  /**
   * Map av konkrete mini-game-implementasjoner. M1 leveres med tom map;
   * M2-M5 registrerer hver sin implementasjon via `registerMiniGame()`.
   */
  readonly miniGames?: ReadonlyMap<MiniGameType, MiniGame>;
  /** Fire-and-forget socket-broadcast. Default no-op. */
  readonly broadcaster?: MiniGameBroadcaster;
  /**
   * K2-A CRIT-2: ComplianceLedger-port for å skrive EXTRA_PRIZE-entry
   * for mini-game-payouts. §71 daily-rapporter må reflektere mini-game-
   * utbetalinger som kommer i tillegg til ordinær fase-payout. Default
   * no-op = ingen ledger-skriv (bakoverkompat for tester).
   *
   * Soft-fail: ledger-skrivefeil ruller IKKE tilbake wallet-credit
   * (matcher mønsteret i Game1PayoutService.payoutPhase). Idempotency-
   * key hindrer dobbel-credit ved retry; ledger-entry kan re-kjøres
   * manuelt ved feil.
   */
  readonly complianceLedgerPort?: ComplianceLedgerPort;
  /**
   * K2-A CRIT-3: PrizePolicy-port for single-prize-cap (2500 kr per
   * pengespillforskriften §11). MÅ kalles før wallet-credit slik at
   * mini-game-payout aldri overstiger lovlig maks-premie. Default no-op
   * = ingen cap (bakoverkompat for tester) — produksjon skal ALLTID
   * wire `engine.getPrizePolicyPort()`.
   */
  readonly prizePolicyPort?: PrizePolicyPort;
}

// ── Internal row shape ───────────────────────────────────────────────────────

interface MiniGameResultRow {
  id: string;
  scheduled_game_id: string;
  mini_game_type: string;
  winner_user_id: string;
  config_snapshot_json: Record<string, unknown>;
  choice_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  payout_cents: number;
  triggered_at: Date;
  completed_at: Date | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse `gameConfigJson` for å finne aktive mini-game-typer.
 *
 * Forventet shape:
 *   `{ spill1: { miniGames: ["wheel", "chest", ...] } }`
 *
 * Returnerer tom liste hvis config mangler eller er malformed — mini-game
 * trigges ikke i slike tilfeller (fail-closed, ikke fail-loud).
 */
export function extractActiveMiniGameTypes(
  gameConfigJson: unknown,
): MiniGameType[] {
  if (!gameConfigJson || typeof gameConfigJson !== "object") return [];
  const spill1 = (gameConfigJson as { spill1?: unknown }).spill1;
  if (!spill1 || typeof spill1 !== "object") return [];
  const miniGames = (spill1 as { miniGames?: unknown }).miniGames;
  if (!Array.isArray(miniGames)) return [];
  const out: MiniGameType[] = [];
  for (const v of miniGames) {
    if (typeof v === "string" && (MINI_GAME_TYPES as readonly string[]).includes(v)) {
      out.push(v as MiniGameType);
    }
  }
  return out;
}

/** Svak validering av schema-navn (SQL-injection-defens). */
function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class Game1MiniGameOrchestrator {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly auditLog: AuditLogService;
  private readonly walletAdapter: WalletAdapter;
  private readonly miniGames: Map<MiniGameType, MiniGame>;
  private broadcaster: MiniGameBroadcaster;
  /** K2-A CRIT-2: compliance ledger-port for EXTRA_PRIZE-entries. */
  private readonly complianceLedgerPort: ComplianceLedgerPort;
  /** K2-A CRIT-3: prize policy-port for single-prize-cap (2500 kr). */
  private readonly prizePolicyPort: PrizePolicyPort;

  constructor(options: Game1MiniGameOrchestratorOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.auditLog = options.auditLog;
    this.walletAdapter = options.walletAdapter;
    this.miniGames = new Map(options.miniGames ?? []);
    this.broadcaster = options.broadcaster ?? NoopMiniGameBroadcaster;
    this.complianceLedgerPort =
      options.complianceLedgerPort ?? new NoopComplianceLedgerPort();
    this.prizePolicyPort =
      options.prizePolicyPort ?? new NoopPrizePolicyPort();
  }

  /**
   * Late-binding for socket-broadcaster (io må finnes først).
   */
  setBroadcaster(broadcaster: MiniGameBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * Registrer en konkret mini-game-implementasjon. Kalles fra M2-M5.
   * Kaster DomainError ved duplikat-registrering.
   */
  registerMiniGame(miniGame: MiniGame): void {
    if (this.miniGames.has(miniGame.type)) {
      throw new DomainError(
        "MINIGAME_ALREADY_REGISTERED",
        `Mini-game '${miniGame.type}' er allerede registrert.`,
      );
    }
    this.miniGames.set(miniGame.type, miniGame);
  }

  /** Test-hook: liste registrerte typer. */
  getRegisteredTypes(): MiniGameType[] {
    return Array.from(this.miniGames.keys());
  }

  private resultsTable(): string {
    return `"${this.schema}"."app_game1_mini_game_results"`;
  }

  private configTable(): string {
    return `"${this.schema}"."app_mini_games_config"`;
  }

  /**
   * Trigg mini-game hvis admin har konfigurert det. Fire-and-forget:
   * kastes IKKE selv ved feil. Kalles fra Game1DrawEngineService post-commit.
   *
   * Returnerer MaybeTriggerResult for testbarhet + logging i caller.
   */
  async maybeTriggerFor(input: MaybeTriggerInput): Promise<MaybeTriggerResult> {
    const activeTypes = extractActiveMiniGameTypes(input.gameConfigJson);

    // ─────────────────────────────────────────────────────────────────────
    // TESTING-OVERRIDE (Tobias 2026-04-26):
    //
    // Inntil admin-UI for å styre per-spill mini-game-valg er på plass,
    // bruker vi Mystery som default mini-game for ALLE Fullt Hus-vinster
    // (uavhengig av admin-config). Når admin-control lander, settes
    // `MYSTERY_FORCE_DEFAULT_FOR_TESTING` til false og logikken under
    // returnerer til vanlig FIFO-rotasjon basert på `extractActiveMiniGameTypes`.
    //
    // Hvorfor: orchestrator picker per i dag activeTypes[0]; hvis admin har
    // konfigurert wheel + mystery vil aldri mystery trigges. For testing
    // ønsker vi at mystery alltid kommer opp.
    //
    // Rollback: sett konstanten under til `false` (eller fjern hele blokken
    // fra `if (MYSTERY_FORCE_DEFAULT_FOR_TESTING && ...)` til og med
    // `} else {` og dropp den ekstra `}` på slutten).
    // ─────────────────────────────────────────────────────────────────────
    const MYSTERY_FORCE_DEFAULT_FOR_TESTING = true;

    let nextType: MiniGameType;
    if (
      MYSTERY_FORCE_DEFAULT_FOR_TESTING &&
      this.miniGames.has("mystery")
    ) {
      // Force Mystery — bypass admin-config-tom-sjekk.
      nextType = "mystery";
    } else {
      if (activeTypes.length === 0) {
        return {
          triggered: false,
          resultId: null,
          miniGameType: null,
          reason: "NO_MINI_GAMES_CONFIGURED",
        };
      }
      // Velg neste type i rotasjonen. FIFO per scheduled-game: hent antall
      // tidligere mini-games trigget for dette spillet og bruk count % N.
      // (Typisk kun én mini-game per spill, men rotasjon trer inn hvis
      // Fullt Hus vinnes av flere i samme multi-winner-scenario → M2+.)
      nextType = activeTypes[0]!; // M1: alltid første aktive type.
      // Merk: orchestrator støtter rotasjon senere (basert på
      // count-of-previous-mini-games) uten framework-endring.
    }

    const implementation = this.miniGames.get(nextType);
    if (!implementation) {
      log.warn(
        { scheduledGameId: input.scheduledGameId, miniGameType: nextType },
        "Mini-game-type konfigurert men ingen implementasjon registrert — skipper",
      );
      this.fireAudit({
        actorId: null,
        action: "game1_minigame.trigger_skipped",
        resourceId: input.scheduledGameId,
        details: {
          reason: "IMPLEMENTATION_NOT_REGISTERED",
          miniGameType: nextType,
          configuredTypes: activeTypes,
        },
      });
      return {
        triggered: false,
        resultId: null,
        miniGameType: nextType,
        reason: "IMPLEMENTATION_NOT_REGISTERED",
      };
    }

    const resultId = `mgr-${randomUUID()}`;

    try {
      // Hent admin-config for denne typen. M1: fall tilbake til tom-object
      // hvis admin ikke har konfigurert (implementasjon må ha sane defaults).
      const configSnapshot = await this.fetchConfigSnapshot(nextType);

      const context: MiniGameTriggerContext = {
        resultId,
        scheduledGameId: input.scheduledGameId,
        winnerUserId: input.winnerUserId,
        winnerWalletId: input.winnerWalletId,
        hallId: input.hallId,
        drawSequenceAtWin: input.drawSequenceAtWin,
        configSnapshot,
      };

      // Kall implementasjonen for å generere trigger-payload.
      const triggerPayload = implementation.trigger(context);

      // INSERT rad med status=triggered (completed_at=NULL).
      await this.pool.query(
        `INSERT INTO ${this.resultsTable()}
           (id, scheduled_game_id, mini_game_type, winner_user_id,
            config_snapshot_json, triggered_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (scheduled_game_id, winner_user_id) DO NOTHING`,
        [
          resultId,
          input.scheduledGameId,
          nextType,
          input.winnerUserId,
          JSON.stringify(configSnapshot),
        ],
      );

      // Fire-and-forget socket-broadcast.
      try {
        this.broadcaster.onTrigger({
          scheduledGameId: input.scheduledGameId,
          winnerUserId: input.winnerUserId,
          resultId,
          miniGameType: nextType,
          payload: triggerPayload.payload,
          timeoutSeconds: triggerPayload.timeoutSeconds,
        });
      } catch (err) {
        log.warn(
          { err, resultId, scheduledGameId: input.scheduledGameId },
          "MiniGameBroadcaster.onTrigger kastet — ignorert",
        );
      }

      this.fireAudit({
        actorId: null,
        action: "game1_minigame.triggered",
        resourceId: input.scheduledGameId,
        details: {
          resultId,
          miniGameType: nextType,
          winnerUserId: input.winnerUserId,
          drawSequenceAtWin: input.drawSequenceAtWin,
        },
      });

      return {
        triggered: true,
        resultId,
        miniGameType: nextType,
      };
    } catch (err) {
      // Fail-closed mot caller: ingen kast. Draw-transaksjonen er allerede
      // committed så payout + bingo-resultat er intakt.
      log.error(
        { err, scheduledGameId: input.scheduledGameId, winnerUserId: input.winnerUserId },
        "maybeTriggerFor feilet — draw-transaksjon er intakt, mini-game skippes",
      );
      this.fireAudit({
        actorId: null,
        action: "game1_minigame.trigger_failed",
        resourceId: input.scheduledGameId,
        details: {
          reason: err instanceof Error ? err.message : String(err),
          miniGameType: nextType,
        },
      });
      return {
        triggered: false,
        resultId: null,
        miniGameType: nextType,
        reason: "TRIGGER_FAILED",
      };
    }
  }

  /**
   * Spiller gjør sitt valg. Server-autoritativt: beregner resultat,
   * utbetaler payout, persisterer i DB, broadcaster resultat.
   *
   * Kaster DomainError ved:
   *   - resultId finnes ikke
   *   - userId != winner_user_id
   *   - completed_at ikke er NULL (allerede spilt)
   *   - mini-game-type-implementasjon ikke registrert
   *
   * Sub-DomainError fra konkrete implementasjoner (INVALID_CHOICE osv.)
   * bobler opp uendret.
   */
  async handleChoice(input: HandleChoiceInput): Promise<HandleChoiceResult> {
    // Hent + verifiser raden. Gjør dette i transaksjon slik at selv ved
    // parallelle kall blir kun én operert på (FOR UPDATE-lås).
    return this.runInTransaction(async (client) => {
      const row = await this.lockResultRow(client, input.resultId);
      if (!row) {
        throw new DomainError("MINIGAME_NOT_FOUND", "Mini-game finnes ikke.");
      }
      if (row.winner_user_id !== input.userId) {
        throw new DomainError(
          "MINIGAME_NOT_OWNER",
          "Denne mini-gamen tilhører en annen spiller.",
        );
      }
      if (row.completed_at !== null) {
        throw new DomainError(
          "MINIGAME_ALREADY_COMPLETED",
          "Mini-game er allerede spilt.",
        );
      }

      const miniGameType = row.mini_game_type as MiniGameType;
      const implementation = this.miniGames.get(miniGameType);
      if (!implementation) {
        throw new DomainError(
          "MINIGAME_NO_IMPLEMENTATION",
          `Mini-game-type '${miniGameType}' er ikke registrert.`,
        );
      }

      // Hent nødvendige context-felt fra scheduled_game (hall + draw-seq).
      const ctxRow = await this.loadContextForResult(client, row);

      const context: MiniGameTriggerContext = {
        resultId: row.id,
        scheduledGameId: row.scheduled_game_id,
        winnerUserId: row.winner_user_id,
        winnerWalletId: ctxRow.winnerWalletId,
        hallId: ctxRow.hallId,
        drawSequenceAtWin: ctxRow.drawSequenceAtWin,
        configSnapshot: row.config_snapshot_json,
      };

      // Kall konkret implementasjon. Kan kaste DomainError (INVALID_CHOICE).
      const result = await implementation.handleChoice({
        resultId: row.id,
        context,
        choiceJson: input.choiceJson,
      });

      // K2-A CRIT-3: håndhev single-prize-cap (2500 kr) FØR wallet-credit.
      // Mini-game-payouts hadde tidligere ingen cap → Wheel-buckets på
      // 4000 kr, Chest 4000 kr osv. kunne overstige lovlig maks-premie
      // (pengespillforskriften §11). Cap-en bruker hall fra context.
      const requestedCents = result.payoutCents;
      let cappedCents = requestedCents;
      let policyId: string | null = null;
      let houseRetainedCents = 0;
      if (requestedCents > 0) {
        const capResult = this.prizePolicyPort.applySinglePrizeCap({
          hallId: context.hallId,
          amount: requestedCents / 100, // PrizePolicyPort tar kroner
        });
        cappedCents = Math.floor(capResult.cappedAmount * 100);
        policyId = capResult.policyId;
        if (capResult.wasCapped) {
          houseRetainedCents = requestedCents - cappedCents;
          log.info(
            {
              resultId: row.id,
              miniGameType,
              hallId: context.hallId,
              requestedCents,
              cappedCents,
              houseRetainedCents,
              policyId,
            },
            "[K2-A CRIT-3] Mini-game payout single-prize-cap applied",
          );
        }
      }

      // K2-B CRIT-5: wallet-credit skjer i SAMME transaksjon som UPDATE av
      // completed_at, slik at payout-rad og status er atomisk. Tidligere
      // brukte vi walletAdapter.credit() som åpnet egen tx — hvis den
      // committet og UPDATE feilet (DB-connection drop, lock timeout),
      // var pengene betalt ut men completed_at fortsatt NULL. Neste retry
      // kalte handleChoice på nytt → ulik RNG → loggboken viste siste
      // resultat, men payout hadde første resultat. Audit-trail
      // divergerte (regulatorisk issue).
      //
      // Bruker creditWithClient når adapteret støtter det (Postgres),
      // ellers fall back til legacy credit() for InMemory/Http/File
      // (de har ingen reelle tx-grenser, så atomicity-gapet er ikke
      // observerbart der).
      //
      // Krediterer cappedCents (K2-A) for å respektere single-prize-cap.
      if (cappedCents > 0) {
        await this.creditPayoutWithClient(client, context, miniGameType, cappedCents);
      }

      // K2-A CRIT-2: skriv EXTRA_PRIZE-entry til ComplianceLedger §71.
      // Soft-fail: ledger-feil ruller IKKE tilbake wallet-credit
      // (matcher Game1PayoutService.payoutPhase-mønsteret). Bruker capped-
      // beløp slik at §71-rapport reflekterer faktisk utbetalt sum.
      if (cappedCents > 0) {
        try {
          await this.complianceLedgerPort.recordComplianceLedgerEvent({
            hallId: context.hallId,
            // Spill 1 (hovedspill) — slug hardkodet siden orchestrator
            // er Spill-1-spesifikk.
            gameType: ledgerGameTypeForSlug("bingo"),
            channel: "INTERNET",
            eventType: "EXTRA_PRIZE",
            amount: cappedCents / 100, // ledger forventer kroner
            gameId: context.scheduledGameId,
            claimId: row.id, // mini-game-result-id som claim-referanse
            playerId: context.winnerUserId,
            walletId: context.winnerWalletId,
            policyVersion: policyId ?? undefined,
            metadata: {
              reason: "GAME1_MINI_GAME_PAYOUT",
              miniGameType,
              drawSequenceAtWin: context.drawSequenceAtWin,
              requestedCents,
              cappedCents,
              houseRetainedCents,
            },
          });
        } catch (err) {
          log.warn(
            {
              err,
              resultId: row.id,
              miniGameType,
              hallId: context.hallId,
              cappedCents,
            },
            "[K2-A CRIT-2] complianceLedger.recordComplianceLedgerEvent EXTRA_PRIZE feilet — payout fortsetter uansett",
          );
        }
      }

      // UPDATE: sett choice + result + payout + completed_at. Persistert
      // payout_cents = capped (faktisk utbetalt) — ikke requested. Dette
      // matcher wallet_transactions så audit-rapporter ikke divergerer.
      // Hvis denne UPDATE feiler nå, ruller hele transaksjonen tilbake
      // — inkludert credit-en (K2-B CRIT-5) — så audit-trail forblir
      // konsistent.
      await client.query(
        `UPDATE ${this.resultsTable()}
            SET choice_json   = $2::jsonb,
                result_json   = $3::jsonb,
                payout_cents  = $4,
                completed_at  = now()
          WHERE id = $1`,
        [
          row.id,
          JSON.stringify(input.choiceJson),
          JSON.stringify(result.resultJson),
          cappedCents,
        ],
      );

      // Broadcast POST-commit effectively: siden vi er i transaksjon her,
      // må broadcast gjøres etter commit. Bruk "return then" pattern.
      return {
        resultId: row.id,
        miniGameType,
        payoutCents: cappedCents,
        resultJson: result.resultJson,
      };
    }).then((res) => {
      // POST-commit broadcast.
      try {
        this.broadcaster.onResult({
          scheduledGameId: this.lastScheduledGameId ?? "",
          winnerUserId: input.userId,
          resultId: res.resultId,
          miniGameType: res.miniGameType,
          payoutCents: res.payoutCents,
          resultJson: res.resultJson,
        });
      } catch (err) {
        log.warn(
          { err, resultId: res.resultId },
          "MiniGameBroadcaster.onResult kastet — ignorert",
        );
      }
      this.fireAudit({
        actorId: input.userId,
        action: "game1_minigame.completed",
        resourceId: res.resultId,
        details: {
          miniGameType: res.miniGameType,
          payoutCents: res.payoutCents,
        },
      });
      return res;
    });
  }

  /** Liste ufullførte mini-games (admin-helper + cleanup i M2+). */
  async listPending(
    scheduledGameId?: string,
  ): Promise<Array<{ id: string; scheduledGameId: string; winnerUserId: string; miniGameType: MiniGameType; triggeredAt: Date }>> {
    const params: unknown[] = [];
    let where = "completed_at IS NULL";
    if (scheduledGameId) {
      params.push(scheduledGameId);
      where += ` AND scheduled_game_id = $${params.length}`;
    }
    const { rows } = await this.pool.query<MiniGameResultRow>(
      `SELECT id, scheduled_game_id, mini_game_type, winner_user_id, triggered_at
         FROM ${this.resultsTable()}
        WHERE ${where}
        ORDER BY triggered_at ASC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      scheduledGameId: r.scheduled_game_id,
      winnerUserId: r.winner_user_id,
      miniGameType: r.mini_game_type as MiniGameType,
      triggeredAt: r.triggered_at,
    }));
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private lastScheduledGameId: string | null = null;

  private async fetchConfigSnapshot(
    miniGameType: MiniGameType,
  ): Promise<Readonly<Record<string, unknown>>> {
    // M1: mapper framework-type → BIN-679-type-nøkkel. "wheel"/"chest" er
    // direkte match; "colordraft"/"oddsen" kan eksistere i BIN-679 eller
    // legges til når M4/M5 lander. Fall tilbake til tom-object.
    try {
      const { rows } = await this.pool.query<{ config_json: Record<string, unknown> | null }>(
        `SELECT config_json FROM ${this.configTable()} WHERE game_type = $1 AND active = true LIMIT 1`,
        [miniGameType],
      );
      if (rows.length === 0 || !rows[0]!.config_json) {
        return {};
      }
      return rows[0]!.config_json;
    } catch (err) {
      log.warn(
        { err, miniGameType },
        "fetchConfigSnapshot feilet — faller tilbake til tom config",
      );
      return {};
    }
  }

  private async lockResultRow(
    client: PoolClient,
    resultId: string,
  ): Promise<MiniGameResultRow | null> {
    const { rows } = await client.query<MiniGameResultRow>(
      `SELECT id, scheduled_game_id, mini_game_type, winner_user_id,
              config_snapshot_json, choice_json, result_json, payout_cents,
              triggered_at, completed_at
         FROM ${this.resultsTable()}
        WHERE id = $1
        FOR UPDATE`,
      [resultId],
    );
    if (rows.length === 0) return null;
    this.lastScheduledGameId = rows[0]!.scheduled_game_id;
    return rows[0]!;
  }

  /**
   * Hent winnerWalletId + hallId + drawSequenceAtWin fra relaterte tabeller.
   * M1 bruker assignments-tabellen for walletId + hall (buyer_user_id match).
   */
  private async loadContextForResult(
    client: PoolClient,
    row: MiniGameResultRow,
  ): Promise<{ winnerWalletId: string; hallId: string; drawSequenceAtWin: number }> {
    // 1) walletId fra app_users.
    const userRes = await client.query<{ wallet_id: string | null }>(
      `SELECT wallet_id FROM "${this.schema}"."app_users" WHERE id = $1 LIMIT 1`,
      [row.winner_user_id],
    );
    if (userRes.rows.length === 0 || !userRes.rows[0]!.wallet_id) {
      throw new DomainError(
        "MINIGAME_USER_NOT_FOUND",
        "Vinnerens wallet-ID ble ikke funnet.",
      );
    }
    const winnerWalletId = userRes.rows[0]!.wallet_id;

    // 2) hallId + drawSequenceAtWin fra phase-winners eller assignments.
    //    Først prøv phase-winners (nærmere metadata).
    const pwRes = await client.query<{ hall_id: string; draw_sequence_at_win: number }>(
      `SELECT hall_id, draw_sequence_at_win
         FROM "${this.schema}"."app_game1_phase_winners"
        WHERE scheduled_game_id = $1 AND winner_user_id = $2
        ORDER BY draw_sequence_at_win DESC
        LIMIT 1`,
      [row.scheduled_game_id, row.winner_user_id],
    );
    if (pwRes.rows.length > 0) {
      return {
        winnerWalletId,
        hallId: pwRes.rows[0]!.hall_id,
        drawSequenceAtWin: pwRes.rows[0]!.draw_sequence_at_win,
      };
    }

    // 3) Fallback: hent hall fra assignments; drawSequenceAtWin = 0 (ukjent).
    const aRes = await client.query<{ hall_id: string }>(
      `SELECT hall_id
         FROM "${this.schema}"."app_game1_ticket_assignments"
        WHERE scheduled_game_id = $1 AND buyer_user_id = $2
        LIMIT 1`,
      [row.scheduled_game_id, row.winner_user_id],
    );
    if (aRes.rows.length === 0) {
      throw new DomainError(
        "MINIGAME_ASSIGNMENT_MISSING",
        "Kunne ikke finne assignment for mini-game-kontekst.",
      );
    }
    return {
      winnerWalletId,
      hallId: aRes.rows[0]!.hall_id,
      drawSequenceAtWin: 0,
    };
  }

  /**
   * Utbetal mini-game-premie. Bruker samme wallet.credit-pattern som
   * Game1PayoutService for konsistens (én felles wallet-adapter med
   * idempotency-key; regulatorisk ledger er ikke i scope her — følger
   * samme mønster som fase-payouts).
   *
   * `payoutCents` konverteres til kroner for wallet.credit (legacy API
   * forventer kroner). Idempotency-key er resultId-scoped.
   *
   * PR-M2 regulatorisk: mål-konto er `"winnings"` (ikke `"deposit"`) slik
   * at mini-game-premier teller som gevinst (ikke innskudd) i netto-
   * tap-beregning. Matcher BIN-690-spec + W1 wallet-split-regel om at
   * game-engine er eneste kilde til `to: "winnings"`-credits.
   */
  private async creditPayout(
    context: MiniGameTriggerContext,
    miniGameType: MiniGameType,
    payoutCents: number,
  ): Promise<void> {
    const amountKroner = payoutCents / 100;
    // PR-W2 wallet-split: mini-game-payout er gevinst fra spill → krediter
    // til winnings-siden. Samme regel som Game1PayoutService.payoutPhase.
    await this.walletAdapter.credit(
      context.winnerWalletId,
      amountKroner,
      `Mini-game ${miniGameType} premie`,
      {
        idempotencyKey: IdempotencyKeys.game1MiniGame({
          resultId: context.resultId,
        }),
        to: "winnings",
      },
    );
  }

  /**
   * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): payout som deltar i
   * caller's allerede-åpne transaksjon. Brukes fra `handleChoice` slik
   * at credit + UPDATE er atomisk.
   *
   * Faller tilbake til legacy `creditPayout` (egen tx) hvis adapteret
   * ikke implementerer `creditWithClient`. Fallback betyr at split-tx-
   * gapet fortsatt finnes for non-Postgres-adaptere — men InMemory/File/
   * Http har ikke samme tx-grenser, så atomicity-issuet er ikke reelt
   * der.
   */
  private async creditPayoutWithClient(
    client: PoolClient,
    context: MiniGameTriggerContext,
    miniGameType: MiniGameType,
    payoutCents: number,
  ): Promise<void> {
    const amountKroner = payoutCents / 100;
    const idempotencyKey = IdempotencyKeys.game1MiniGame({
      resultId: context.resultId,
    });
    const reason = `Mini-game ${miniGameType} premie`;

    if (this.walletAdapter.creditWithClient) {
      await this.walletAdapter.creditWithClient(
        context.winnerWalletId,
        amountKroner,
        reason,
        {
          client,
          idempotencyKey,
          to: "winnings",
        },
      );
      return;
    }

    // Fallback for adaptere uten creditWithClient (InMemory/File/Http).
    // For disse er atomicity-gapet ikke observerbart fordi de ikke har
    // ekte transaksjons-grenser. Vi bruker legacy `credit()`.
    log.debug(
      { miniGameType, resultId: context.resultId },
      "[CRIT-5] walletAdapter har ikke creditWithClient — fall back til credit()",
    );
    await this.walletAdapter.credit(
      context.winnerWalletId,
      amountKroner,
      reason,
      {
        idempotencyKey,
        to: "winnings",
      },
    );
  }

  private async runInTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // noop — primary error bobler opp.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private fireAudit(entry: {
    actorId: string | null;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    // Fire-and-forget: logg men ikke kast.
    Promise.resolve()
      .then(() =>
        this.auditLog.record({
          actorId: entry.actorId,
          actorType: "SYSTEM",
          action: entry.action,
          resource: "game1_minigame",
          resourceId: entry.resourceId,
          details: entry.details,
        }),
      )
      .catch((err) =>
        log.warn({ err, action: entry.action }, "audit.record feilet — ignorert"),
      );
  }
}
