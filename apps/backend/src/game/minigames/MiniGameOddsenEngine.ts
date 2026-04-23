/**
 * BIN-690 Spor 3 M5: MiniGameOddsenEngine — konkret Oddsen-implementasjon av
 * `MiniGame`-interfacet fra M1-framework.
 *
 * Kobler admin-konfig (`MiniGamesConfigService.getConfig("oddsen")`) mot
 * orchestrator (`Game1MiniGameOrchestrator`). Forrige Fullt Hus-vinner velger
 * ETT av tallene 55/56/57 (default). Valget persisteres cross-round i
 * `app_game1_oddsen_state` og resolves når NESTE spill i samme hall trekker
 * det valgte tallet ved terskel-draw.
 *
 * Forskjell fra M2/M3/M4:
 *   - Wheel (M2): server avgjør alt, spiller trykker kun "Snurr".
 *     Payout skjer øyeblikkelig via orchestrator.creditPayout.
 *   - Chest (M3): spiller velger luke, server trekker alle N verdier.
 *     Payout skjer øyeblikkelig for valgt luke.
 *   - Colordraft (M4): spiller observerer farger og velger luke som matcher.
 *     Payout skjer øyeblikkelig ved match/mismatch.
 *   - Oddsen (M5): CROSS-ROUND state. Spiller velger tall (55/56/57),
 *     persisteres per-hall, resolves i NESTE spill. Payout skjer i
 *     `resolveForGame()`-hook som kalles fra `Game1DrawEngineService`
 *     ved terskel-draw i neste spill (IKKE via orchestrator.creditPayout).
 *
 * Livsyklus (via orchestrator + draw-engine):
 *   1. Fullt Hus vinner i spill N → orchestrator kaller `trigger(context)`
 *      → vi returnerer `TriggerPayload` med `{ validNumbers: [55,56,57],
 *      potSmall: 1500, potLarge: 3000, eligibleTicketSize }`.
 *   2. Klient viser valgknapper for 55/56/57; vinner trykker ett tall →
 *      socket sender `mini_game:choice { chosenNumber: 55 }`.
 *   3. Orchestrator kaller `handleChoice(input)` → vi:
 *        a) Validerer `chosenNumber ∈ [55,56,57]`.
 *        b) Finner NESTE planlagte spill i samme hall via `pool`.
 *        c) Slår opp ticket-size-ved-win via phase-winners/ticket-assignments.
 *        d) INSERT i `app_game1_oddsen_state` med alle felt.
 *        e) Returnerer `{ payoutCents: 0, resultJson: {...} }`. INGEN
 *           umiddelbar payout — den skjer i resolveForGame() ved neste spill.
 *   4. Spill N+1 starter, draws skjer. Ved terskel-draw (draw #57 default)
 *      kaller `Game1DrawEngineService.drawNext` → `resolveForGame()` →
 *        a) SELECT aktiv Oddsen-state for dette spillet.
 *        b) Hvis ingen state → return (INGEN pengeflyt, INGEN audit).
 *        c) Hvis state finnes: sjekk om chosen_number ∈ drawnNumbers.
 *        d) Hvis hit → walletAdapter.credit(pot, idempotencyKey=`g1-oddsen-{id}`)
 *           til vinnerens winnings-konto.
 *        e) UPDATE oddsen_state: resolved_at, resolved_outcome, pot_amount_cents.
 *        f) Audit-event `mini_game.oddsen_resolved_hit` eller `_miss`.
 *   5. Hvis neste spill fullfører uten å nå terskel-draw → `_expired`-flyt.
 *      Ikke implementert som separat cron i M5 (fail-open: state forblir
 *      ikke-resolved til fremtidig clean-up-PR).
 *
 * Regulatoriske krav:
 *   - Server-autoritativ: spiller velger tall, men pot-beløp + hall + neste-
 *     spill resolves av server. Klient kan IKKE bestemme pot-størrelse eller
 *     force hit.
 *   - Payout til `winnings`-konto (`to: "winnings"`) — matcher W1 wallet-
 *     split-pattern fra andre mini-games.
 *   - Fail-closed: hvis `chosenNumber` er ugyldig, eller ingen neste spill
 *     finnes, INSERT rejectes med DomainError. Orchestrator fanger og
 *     audit-logger.
 *   - Idempotency: `g1-oddsen-{oddsenStateId}` hindrer dobbel credit ved
 *     draw-retry eller engine-restart. Kontrastert med M2/M3/M4 som bruker
 *     `g1-minigame-{resultId}` (orchestrator-scope).
 *   - Cross-round state bevares gjennom server-restart (DB-persistert).
 *   - Audit-events:
 *       * `mini_game.oddsen_number_chosen` ved handleChoice-INSERT
 *       * `mini_game.oddsen_resolved_hit` ved resolve med treff
 *       * `mini_game.oddsen_resolved_miss` ved resolve uten treff
 *       * `mini_game.oddsen_resolved_expired` ved cleanup (fremtid)
 *
 * Default-config:
 *   `{ validNumbers: [55, 56, 57],
 *      potSmallNok: 1500,
 *      potLargeNok: 3000,
 *      resolveAtDraw: 57 }`
 *   → Terskel-draw er #57 (matcher "Oddsen 55/56/57" semantikk). Klient må
 *     kunne ta et av tre tall. Pot-størrelse bestemmes ved ticket_size-
 *     snapshot av forrige-vinner.
 *
 * Tester: `MiniGameOddsenEngine.test.ts` + `.integration.test.ts`.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../BingoEngine.js";
import { IdempotencyKeys } from "../idempotency.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
} from "./types.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import { logger as rootLogger } from "../../util/logger.js";

const log = rootLogger.child({ module: "minigame-oddsen-engine" });

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Full oddsen-config, slik admin lagrer i `app_mini_games_config.config_json`.
 *
 * `validNumbers`: array av tall spilleren kan velge mellom (default [55,56,57]).
 * `potSmallNok`: pot i kroner hvis forrige-vinner hadde ticket_size='small'.
 * `potLargeNok`: pot i kroner hvis forrige-vinner hadde ticket_size='large'.
 * `resolveAtDraw`: draw-sekvens der state evalueres (default 57). Når engine
 *   har gjort denne trekkingen og `drawnNumbers.length === resolveAtDraw`
 *   kalles resolveForGame().
 */
export interface OddsenConfig {
  readonly validNumbers: readonly number[];
  readonly potSmallNok: number;
  readonly potLargeNok: number;
  readonly resolveAtDraw: number;
}

/** Default-config brukes når admin ikke har konfigurert oddsen. */
export const DEFAULT_ODDSEN_CONFIG: OddsenConfig = {
  validNumbers: [55, 56, 57],
  potSmallNok: 1500,
  potLargeNok: 3000,
  resolveAtDraw: 57,
};

/**
 * Resultat-payload lagret i `app_game1_mini_game_results.result_json` etter
 * `handleChoice`. Dette er state FØR resolving — `pot_amount_cents` + faktisk
 * outcome finnes i `app_game1_oddsen_state` når neste spill kjører.
 *
 * `payoutCents` i MiniGameResult er 0 fra handleChoice — det betyr IKKE at
 * Oddsen aldri betaler, men at payout er deferred til resolveForGame().
 */
export interface OddsenChoiceResultJson extends Record<string, unknown> {
  readonly chosenNumber: number;
  readonly oddsenStateId: string;
  readonly chosenForGameId: string;
  readonly ticketSizeAtWin: "small" | "large";
  readonly potAmountNokIfHit: number;
  readonly validNumbers: readonly number[];
  /** Informativ: payout er deferred til resolveForGame() i neste spill. */
  readonly payoutDeferred: true;
}

/**
 * Resultat av `resolveForGame()` — kalles fra Game1DrawEngineService ved
 * terskel-draw i neste spill. Engine bruker dette for audit-logging +
 * admin-broadcast.
 */
export interface OddsenResolveResult {
  readonly oddsenStateId: string;
  readonly chosenNumber: number;
  readonly chosenByPlayerId: string;
  readonly outcome: "hit" | "miss";
  readonly potAmountCents: number;
  readonly walletTransactionId: string | null;
  readonly hallId: string;
}

// ── Config parsing / validation ──────────────────────────────────────────────

/**
 * Parser og validerer et `configSnapshot`-objekt fra orchestrator. Faller
 * tilbake til `DEFAULT_ODDSEN_CONFIG` hvis feltet mangler eller er tomt
 * (fail-closed mot client, men ikke mot runtime — vi har alltid en gyldig
 * default så spillet aldri henger).
 *
 * Valideringsregler:
 *   - `validNumbers` må være non-empty array av positive heltall.
 *   - `potSmallNok` / `potLargeNok` må være heltall >= 0.
 *   - `resolveAtDraw` må være positivt heltall (typisk 57).
 *
 * Kaster `DomainError("INVALID_ODDSEN_CONFIG", ...)` ved strukturelle feil
 * slik at orchestrator kan logge + audit-loge.
 */
export function parseOddsenConfig(
  configSnapshot: Readonly<Record<string, unknown>>,
): OddsenConfig {
  // Tom config = default. Dekker {} og { active: true } uten oddsen-felt.
  if (!configSnapshot || Object.keys(configSnapshot).length === 0) {
    return DEFAULT_ODDSEN_CONFIG;
  }

  const hasAny =
    configSnapshot.validNumbers !== undefined ||
    configSnapshot.potSmallNok !== undefined ||
    configSnapshot.potLargeNok !== undefined ||
    configSnapshot.resolveAtDraw !== undefined;
  if (!hasAny) {
    return DEFAULT_ODDSEN_CONFIG;
  }

  // validNumbers
  const rawNums = configSnapshot.validNumbers;
  let validNumbers: number[];
  if (rawNums === undefined) {
    validNumbers = [...DEFAULT_ODDSEN_CONFIG.validNumbers];
  } else if (!Array.isArray(rawNums)) {
    throw new DomainError(
      "INVALID_ODDSEN_CONFIG",
      "validNumbers må være et array.",
    );
  } else if (rawNums.length === 0) {
    throw new DomainError(
      "INVALID_ODDSEN_CONFIG",
      "validNumbers må ha minst ett tall.",
    );
  } else {
    validNumbers = [];
    for (let i = 0; i < rawNums.length; i += 1) {
      const v = rawNums[i];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        throw new DomainError(
          "INVALID_ODDSEN_CONFIG",
          `validNumbers[${i}] må være et positivt heltall.`,
        );
      }
      validNumbers.push(v);
    }
  }

  // potSmallNok
  const rawSmall = configSnapshot.potSmallNok;
  let potSmallNok: number;
  if (rawSmall === undefined) {
    potSmallNok = DEFAULT_ODDSEN_CONFIG.potSmallNok;
  } else if (
    typeof rawSmall !== "number" ||
    !Number.isInteger(rawSmall) ||
    rawSmall < 0
  ) {
    throw new DomainError(
      "INVALID_ODDSEN_CONFIG",
      "potSmallNok må være et heltall >= 0.",
    );
  } else {
    potSmallNok = rawSmall;
  }

  // potLargeNok
  const rawLarge = configSnapshot.potLargeNok;
  let potLargeNok: number;
  if (rawLarge === undefined) {
    potLargeNok = DEFAULT_ODDSEN_CONFIG.potLargeNok;
  } else if (
    typeof rawLarge !== "number" ||
    !Number.isInteger(rawLarge) ||
    rawLarge < 0
  ) {
    throw new DomainError(
      "INVALID_ODDSEN_CONFIG",
      "potLargeNok må være et heltall >= 0.",
    );
  } else {
    potLargeNok = rawLarge;
  }

  // resolveAtDraw
  const rawResolve = configSnapshot.resolveAtDraw;
  let resolveAtDraw: number;
  if (rawResolve === undefined) {
    resolveAtDraw = DEFAULT_ODDSEN_CONFIG.resolveAtDraw;
  } else if (
    typeof rawResolve !== "number" ||
    !Number.isInteger(rawResolve) ||
    rawResolve <= 0
  ) {
    throw new DomainError(
      "INVALID_ODDSEN_CONFIG",
      "resolveAtDraw må være et positivt heltall.",
    );
  } else {
    resolveAtDraw = rawResolve;
  }

  return { validNumbers, potSmallNok, potLargeNok, resolveAtDraw };
}

// ── Data port for cross-round persistens + context-lookup ────────────────────

/**
 * Lookup-result for "finn neste planlagte spill i hall". Returnerer ID'en
 * engine skal bruke som `chosen_for_game_id` i oddsen_state-raden.
 */
interface NextGameLookup {
  readonly scheduledGameId: string;
}

/**
 * Lookup-result for "hva er ticket-size til denne vinneren i forrige spill?"
 * Nødvendig for pot-størrelse-avgjørelse ved resolve.
 */
interface WinnerTicketSizeLookup {
  readonly ticketSize: "small" | "large";
}

// ── MiniGame-implementasjon ──────────────────────────────────────────────────

export interface MiniGameOddsenEngineOptions {
  /**
   * Pool for DB-lookup + cross-round INSERT. Kreves fordi Oddsen persisterer
   * state mellom spill (i motsetning til M2/M3/M4 som er stateless per
   * spill).
   */
  readonly pool: Pool;
  /** Schema-navn (default "public"). */
  readonly schema?: string;
  /**
   * WalletAdapter for pot-credit ved resolve-hit. Oddsen bruker EGEN credit-
   * path (ikke orchestrator.creditPayout) fordi payout er deferred til
   * neste spill.
   */
  readonly walletAdapter: WalletAdapter;
  /**
   * Audit-log for oddsen-spesifikke events (number_chosen, resolved_hit,
   * resolved_miss, resolved_expired).
   */
  readonly auditLog: AuditLogService;
}

/** Svak validering av schema-navn (SQL-injection-defens). */
function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

export class MiniGameOddsenEngine implements MiniGame {
  readonly type = "oddsen" as const;

  private readonly pool: Pool;
  private readonly schema: string;
  private readonly walletAdapter: WalletAdapter;
  private readonly auditLog: AuditLogService;

  constructor(options: MiniGameOddsenEngineOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.walletAdapter = options.walletAdapter;
    this.auditLog = options.auditLog;
  }

  private oddsenStateTable(): string {
    return `"${this.schema}"."app_game1_oddsen_state"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private phaseWinnersTable(): string {
    return `"${this.schema}"."app_game1_phase_winners"`;
  }

  private assignmentsTable(): string {
    return `"${this.schema}"."app_game1_ticket_assignments"`;
  }

  private usersTable(): string {
    return `"${this.schema}"."app_users"`;
  }

  /**
   * Trigger — kalt av orchestrator når Fullt Hus er vunnet. Returnerer
   * payload som socket-broadcast videre til klient. Klient får validNumbers
   * (tall spilleren kan velge mellom) + pot-preview.
   *
   * Rent funksjonell: ingen state-mutasjon, ingen IO. Selve persisteringen
   * skjer i handleChoice.
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
    const config = parseOddsenConfig(context.configSnapshot);
    return {
      type: "oddsen",
      resultId: context.resultId,
      timeoutSeconds: 60,
      payload: {
        validNumbers: config.validNumbers,
        potSmallNok: config.potSmallNok,
        potLargeNok: config.potLargeNok,
        resolveAtDraw: config.resolveAtDraw,
      },
    };
  }

  /**
   * handleChoice — kalt av orchestrator når klient har sendt
   * `{ chosenNumber: 55 }`. Persisterer cross-round state og returnerer
   * `payoutCents: 0` fordi faktisk payout skjer først ved resolveForGame()
   * i neste spill.
   *
   * Fail-closed:
   *   - Invalid chosenNumber → DomainError("INVALID_CHOICE")
   *   - Ingen neste spill i hallen → DomainError("ODDSEN_NO_NEXT_GAME")
   *   - Ticket-size ikke funnet → DomainError("ODDSEN_TICKET_SIZE_MISSING")
   *   - Dobbel INSERT (hall, chosen_for_game_id) → DomainError via UNIQUE
   *
   * Kaster ikke på DB-transient errors — de propagerer normalt og
   * orchestrator ruller tilbake raden.
   */
  async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
    const config = parseOddsenConfig(input.context.configSnapshot);
    const chosenNumber = this.assertChosenNumber(
      input.choiceJson,
      config.validNumbers,
    );

    // 1) Slå opp ticket-size for forrige-vinnerens billett.
    const ticketSizeLookup = await this.lookupWinnerTicketSize(
      input.context.scheduledGameId,
      input.context.winnerUserId,
    );
    if (!ticketSizeLookup) {
      throw new DomainError(
        "ODDSEN_TICKET_SIZE_MISSING",
        "Kunne ikke finne ticket-størrelse for Fullt Hus-vinner.",
      );
    }

    // 2) Finn neste planlagte spill i samme hall (der state skal resolveres).
    const nextGame = await this.lookupNextGameInHall(
      input.context.hallId,
      input.context.scheduledGameId,
    );
    if (!nextGame) {
      throw new DomainError(
        "ODDSEN_NO_NEXT_GAME",
        "Ingen planlagt neste spill i hallen — Oddsen-state kan ikke registreres.",
      );
    }

    // 3) Persister state. `id` er TEXT-PK; vi bruker prefix for sporbarhet.
    const oddsenStateId = `oddsen-${randomUUID()}`;
    try {
      await this.pool.query(
        `INSERT INTO ${this.oddsenStateTable()}
           (id, hall_id, chosen_number, chosen_by_player_id,
            chosen_for_game_id, set_by_game_id, ticket_size_at_win,
            set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [
          oddsenStateId,
          input.context.hallId,
          chosenNumber,
          input.context.winnerUserId,
          nextGame.scheduledGameId,
          input.context.scheduledGameId,
          ticketSizeLookup.ticketSize,
        ],
      );
    } catch (err) {
      // UNIQUE-violation = duplicate state for (hall, chosen_for_game_id).
      // Dette er "first-write-wins" — andre forsøk må rejectes slik at det
      // ikke blir to aktive valg for samme neste-spill.
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "ODDSEN_STATE_ALREADY_EXISTS",
          "Oddsen-state eksisterer allerede for neste spill i hallen.",
        );
      }
      throw err;
    }

    // 4) Audit: number_chosen (fire-and-forget).
    this.fireAudit({
      actorId: input.context.winnerUserId,
      action: "mini_game.oddsen_number_chosen",
      resourceId: oddsenStateId,
      details: {
        chosenNumber,
        chosenByPlayerId: input.context.winnerUserId,
        chosenForGameId: nextGame.scheduledGameId,
        setByGameId: input.context.scheduledGameId,
        hallId: input.context.hallId,
        ticketSizeAtWin: ticketSizeLookup.ticketSize,
      },
    });

    const potAmountNokIfHit =
      ticketSizeLookup.ticketSize === "small"
        ? config.potSmallNok
        : config.potLargeNok;

    const resultJson: OddsenChoiceResultJson = {
      chosenNumber,
      oddsenStateId,
      chosenForGameId: nextGame.scheduledGameId,
      ticketSizeAtWin: ticketSizeLookup.ticketSize,
      potAmountNokIfHit,
      validNumbers: config.validNumbers,
      payoutDeferred: true,
    };

    // Viktig: payoutCents er 0 fordi faktisk payout skjer ved resolveForGame
    // i neste spill. Orchestrator vil IKKE kalle creditPayout (siden 0), og
    // raden i mini_game_results markeres completed med payout_cents=0.
    // Den faktiske pot-utbetalingen spores i oddsen_state.pot_amount_cents.
    return {
      payoutCents: 0,
      resultJson,
    };
  }

  /**
   * resolveForGame — kalles av Game1DrawEngineService (eller test) når en
   * scheduled_game har gjort den terskel-drawen Oddsen er bundet til.
   *
   * Spec:
   *   * Kalles fra drawNext POST-state-check når `drawsCompleted ==
   *     resolveAtDraw` (default 57) for det nåværende spillet.
   *   * Tar en PoolClient (transaksjon) slik at resolveForGame kan kjøres
   *     ATOMISK sammen med draw-persistensen. Hvis resolve feiler, rulles
   *     drawet tilbake (fail-closed).
   *
   * Flyt:
   *   1. SELECT oddsen_state WHERE chosen_for_game_id = $1 AND resolved_at IS NULL
   *      FOR UPDATE. Hvis ingen rad → return null (ingen Oddsen for dette spillet).
   *   2. Sjekk om chosen_number ∈ drawnNumbers.
   *   3. Hvis hit: walletAdapter.credit(pot, idempotencyKey=`g1-oddsen-{id}`,
   *      to='winnings') til vinnerens wallet. Pot = pot_small/large basert på
   *      ticket_size_at_win.
   *   4. UPDATE oddsen_state: resolved_at, resolved_outcome, pot_amount_cents,
   *      wallet_transaction_id.
   *   5. Audit-event `mini_game.oddsen_resolved_hit` eller `_miss`.
   *
   * Returnerer OddsenResolveResult | null. `null` = ingen state å resolve.
   */
  async resolveForGame(
    scheduledGameId: string,
    drawnNumbers: readonly number[],
    config: OddsenConfig,
    client: PoolClient,
  ): Promise<OddsenResolveResult | null> {
    // Lock raden slik at parallelle draws ikke resolver samme state to ganger.
    const { rows } = await client.query<{
      id: string;
      hall_id: string;
      chosen_number: number;
      chosen_by_player_id: string;
      ticket_size_at_win: "small" | "large";
    }>(
      `SELECT id, hall_id, chosen_number, chosen_by_player_id, ticket_size_at_win
         FROM ${this.oddsenStateTable()}
        WHERE chosen_for_game_id = $1
          AND resolved_at IS NULL
        FOR UPDATE`,
      [scheduledGameId],
    );

    if (rows.length === 0) return null;

    const state = rows[0]!;
    const potNok =
      state.ticket_size_at_win === "small"
        ? config.potSmallNok
        : config.potLargeNok;
    const potCents = potNok * 100;

    const isHit = drawnNumbers.includes(state.chosen_number);
    const outcome: "hit" | "miss" = isHit ? "hit" : "miss";

    let walletTransactionId: string | null = null;

    if (isHit && potCents > 0) {
      // Slå opp vinnerens wallet-ID.
      const userRes = await client.query<{ wallet_id: string | null }>(
        `SELECT wallet_id FROM ${this.usersTable()} WHERE id = $1 LIMIT 1`,
        [state.chosen_by_player_id],
      );
      const walletId = userRes.rows[0]?.wallet_id;
      if (!walletId) {
        // Fail-closed: ingen wallet → kast, rull tilbake draw-transaksjonen.
        // Oddsen-state forblir unresolved slik at admin kan rydde manuelt.
        throw new DomainError(
          "ODDSEN_WALLET_MISSING",
          `Vinnerens wallet-ID ble ikke funnet for ${state.chosen_by_player_id}.`,
        );
      }

      const creditResult = await this.walletAdapter.credit(
        walletId,
        potNok,
        `Oddsen-pot (tall ${state.chosen_number})`,
        {
          idempotencyKey: IdempotencyKeys.game1Oddsen({ stateId: state.id }),
          to: "winnings",
        },
      );
      walletTransactionId =
        (creditResult as { id?: string } | undefined)?.id ?? null;
    }

    // UPDATE: mark resolved.
    await client.query(
      `UPDATE ${this.oddsenStateTable()}
          SET resolved_at           = now(),
              resolved_outcome      = $2,
              pot_amount_cents      = $3,
              wallet_transaction_id = $4
        WHERE id = $1`,
      [
        state.id,
        outcome,
        isHit ? potCents : 0,
        walletTransactionId,
      ],
    );

    // Audit fire-and-forget. Hit-tilfellet bruker egen action-kode slik at
    // compliance-rapporter kan aggregere hits vs misses uten LIKE-matching.
    this.fireAudit({
      actorId: null,
      action: isHit
        ? "mini_game.oddsen_resolved_hit"
        : "mini_game.oddsen_resolved_miss",
      resourceId: state.id,
      details: {
        chosenNumber: state.chosen_number,
        chosenByPlayerId: state.chosen_by_player_id,
        hallId: state.hall_id,
        ticketSizeAtWin: state.ticket_size_at_win,
        potAmountCents: isHit ? potCents : 0,
        scheduledGameId,
        drawsCount: drawnNumbers.length,
        walletTransactionId,
      },
    });

    return {
      oddsenStateId: state.id,
      chosenNumber: state.chosen_number,
      chosenByPlayerId: state.chosen_by_player_id,
      outcome,
      potAmountCents: isHit ? potCents : 0,
      walletTransactionId,
      hallId: state.hall_id,
    };
  }

  /**
   * Marker alle ikke-resolvede states for ferdige spill som 'expired'.
   * Brukes av en fremtidig cron-job eller ved neste trigger hvis engine har
   * detektert at et spill fullførte uten å nå terskel-draw.
   *
   * M5 inkluderer ikke cron — denne metoden eksisterer for test-dekning og
   * fremtidig kobling. Fail-open: tom rad-liste ved ingen kandidater.
   */
  async expireStateForGame(
    scheduledGameId: string,
    client: PoolClient,
  ): Promise<{ expiredCount: number }> {
    const { rowCount } = await client.query(
      `UPDATE ${this.oddsenStateTable()}
          SET resolved_at      = now(),
              resolved_outcome = 'expired',
              pot_amount_cents = 0
        WHERE chosen_for_game_id = $1
          AND resolved_at IS NULL`,
      [scheduledGameId],
    );
    const expiredCount = rowCount ?? 0;
    if (expiredCount > 0) {
      this.fireAudit({
        actorId: null,
        action: "mini_game.oddsen_resolved_expired",
        resourceId: scheduledGameId,
        details: { expiredCount, scheduledGameId },
      });
    }
    return { expiredCount };
  }

  /**
   * Validér at klient-sendt choiceJson inneholder en gyldig `chosenNumber`.
   *
   * Aksepterer:
   *   - `{ chosenNumber: 55 }` der 55 ∈ validNumbers
   *
   * Kaster INVALID_CHOICE ved:
   *   - Manglende felt
   *   - Ikke-heltall
   *   - Tall ikke i validNumbers
   */
  private assertChosenNumber(
    choiceJson: Readonly<Record<string, unknown>>,
    validNumbers: readonly number[],
  ): number {
    const raw = choiceJson.chosenNumber;
    if (raw === undefined || raw === null) {
      throw new DomainError(
        "INVALID_CHOICE",
        "chosenNumber er påkrevd i choice-payload.",
      );
    }
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      throw new DomainError(
        "INVALID_CHOICE",
        "chosenNumber må være et heltall.",
      );
    }
    if (!validNumbers.includes(raw)) {
      throw new DomainError(
        "INVALID_CHOICE",
        `chosenNumber ${raw} er ikke i validNumbers [${validNumbers.join(", ")}].`,
      );
    }
    return raw;
  }

  /**
   * Slå opp vinnerens ticket-size fra forrige-spillets phase-winners.
   * Phase-winners lagrer `assignment_id` og `ticket_color`, men ikke size
   * direkte — vi joinbruker mot ticket-assignments.
   *
   * Fallback: hvis vi av en eller annen grunn ikke finner phase_winners
   * (f.eks. test-fikstur uten den raden), prøv ticket-assignments direkte
   * for vinneren.
   *
   * Returnerer null hvis ingen match finnes.
   */
  private async lookupWinnerTicketSize(
    scheduledGameId: string,
    winnerUserId: string,
  ): Promise<WinnerTicketSizeLookup | null> {
    // 1) Primær: phase_winners → assignment → ticket_size.
    try {
      const { rows } = await this.pool.query<{ ticket_size: string }>(
        `SELECT a.ticket_size
           FROM ${this.phaseWinnersTable()} pw
           JOIN ${this.assignmentsTable()} a
             ON a.id = pw.assignment_id
          WHERE pw.scheduled_game_id = $1
            AND pw.winner_user_id = $2
            AND pw.phase = 5
          ORDER BY pw.created_at DESC
          LIMIT 1`,
        [scheduledGameId, winnerUserId],
      );
      if (rows.length > 0 && this.isTicketSize(rows[0]!.ticket_size)) {
        return { ticketSize: rows[0]!.ticket_size };
      }
    } catch (err) {
      log.warn(
        { err, scheduledGameId, winnerUserId },
        "lookupWinnerTicketSize phase_winners-join feilet — prøver fallback",
      );
    }

    // 2) Fallback: assignments direkte på (game, buyer).
    try {
      const { rows } = await this.pool.query<{ ticket_size: string }>(
        `SELECT ticket_size
           FROM ${this.assignmentsTable()}
          WHERE scheduled_game_id = $1
            AND buyer_user_id = $2
          ORDER BY generated_at DESC
          LIMIT 1`,
        [scheduledGameId, winnerUserId],
      );
      if (rows.length > 0 && this.isTicketSize(rows[0]!.ticket_size)) {
        return { ticketSize: rows[0]!.ticket_size };
      }
    } catch (err) {
      log.warn(
        { err, scheduledGameId, winnerUserId },
        "lookupWinnerTicketSize fallback assignments feilet",
      );
    }

    return null;
  }

  private isTicketSize(value: unknown): value is "small" | "large" {
    return value === "small" || value === "large";
  }

  /**
   * Finn neste planlagte spill i samme hall. "Neste" = tidligst
   * `scheduled_start_time > now()` der hallen deltar (via group_hall_id
   * eller participating_halls_json) og status ∈ ('scheduled','purchase_open',
   * 'ready_to_start'). Ekskluderer det nåværende spillet.
   *
   * Returnerer null hvis ingen kandidat finnes (spiller/hall har ikke
   * flere planlagte spill i skjemaet).
   */
  private async lookupNextGameInHall(
    hallId: string,
    currentScheduledGameId: string,
  ): Promise<NextGameLookup | null> {
    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `SELECT id
           FROM ${this.scheduledGamesTable()}
          WHERE id <> $2
            AND scheduled_start_time > now()
            AND status IN ('scheduled','purchase_open','ready_to_start')
            AND (
              group_hall_id = $1
              OR participating_halls_json @> to_jsonb($1::text)
            )
          ORDER BY scheduled_start_time ASC
          LIMIT 1`,
        [hallId, currentScheduledGameId],
      );
      if (rows.length === 0) return null;
      return { scheduledGameId: rows[0]!.id };
    } catch (err) {
      log.warn(
        { err, hallId, currentScheduledGameId },
        "lookupNextGameInHall feilet",
      );
      return null;
    }
  }

  private fireAudit(entry: {
    actorId: string | null;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    // Fire-and-forget.
    Promise.resolve()
      .then(() =>
        this.auditLog.record({
          actorId: entry.actorId,
          actorType: "SYSTEM",
          action: entry.action,
          resource: "game1_minigame_oddsen",
          resourceId: entry.resourceId,
          details: entry.details,
        }),
      )
      .catch((err) =>
        log.warn({ err, action: entry.action }, "audit.record feilet — ignorert"),
      );
  }
}

/**
 * Hjelper for å detektere unique-violation i pg-drivers error-payload.
 * PostgreSQL error-code '23505' er unique_violation.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}
