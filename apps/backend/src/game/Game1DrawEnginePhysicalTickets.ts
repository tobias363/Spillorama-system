/**
 * Game1DrawEnginePhysicalTickets — PT4 fysisk-bong-evaluering.
 *
 * Ekstrahert fra `Game1DrawEngineService.ts` i refactor/s4-draw-engine-split
 * (Forslag A) for å redusere god-class-størrelsen uten å endre offentlig
 * API eller subklasse-inheritance.
 *
 * **Scope:**
 *   - `evaluatePhysicalTicketsForPhase` (hovedfunksjonen som leser
 *     `app_static_tickets`, bygger markings fra trukne kuler og kaller
 *     `PhysicalTicketPayoutService.createPendingPayout` per vinner)
 *   - `loadDrawnBallsSet` (hjelper som leser alle trukne baller som Set)
 *   - `parsePhysicalCardMatrix` (parser for legacy CSV-bong-format)
 *   - `buildMarkingsFromGrid` (bygger markings-array fra grid + drawnBalls)
 *   - `PhysicalTicketWinInfo` (offentlig type for post-commit broadcast)
 *
 * **Kontrakt:**
 *   - Ren pure-funksjon-modul. Mottar alt den trenger via
 *     `EvaluatePhysicalTicketsDeps`-objekt (narrow port).
 *   - Byte-identisk flytting — SQL-queries, log-meldinger, audit-rekkefølge
 *     alle bevart.
 *
 * **Regulatorisk:** fysisk-bong-matching er uendret. Fail-closed-kontrakten
 * (SQL-feil → log warning, returner tom liste) er bevart slik at draw-flyten
 * aldri blokkeres av fysisk-bong-feil.
 */

import type { PoolClient } from "pg";
import type { PhysicalTicketPayoutService } from "../compliance/PhysicalTicketPayoutService.js";
import { evaluatePhase } from "./Game1PatternEvaluator.js";
import { resolvePatternsForColor } from "./spill1VariantMapper.js";
import type { GameVariantConfig } from "./variantConfig.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-physical-tickets" });

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * PT4: Utfall per fysisk vinner — returnert fra `evaluatePhysicalTicketsForPhase`,
 * brukt av drawNext for post-commit broadcast og audit.
 */
export interface PhysicalTicketWinInfo {
  pendingPayoutId: string;
  ticketId: string;
  hallId: string;
  phase: number;
  patternName: string;
  responsibleUserId: string;
  expectedPayoutCents: number;
  color: string;
  adminApprovalRequired: boolean;
}

/**
 * Deps-port for `evaluatePhysicalTicketsForPhase`. Oppstår som narrow
 * kontrakt som helper-en trenger — injisert av service-en som har den
 * fulle state.
 */
export interface EvaluatePhysicalTicketsDeps {
  /** PT4-service (påkrevd — caller må sjekke null før denne funksjonen kalles). */
  physicalTicketPayoutService: PhysicalTicketPayoutService;
  /** `app_static_tickets` tabell-referanse (allerede skjema-kvotert). */
  staticTicketsTable: string;
  /** Pot-kalkulasjon (samme som digital-path). */
  computePotCents: (client: PoolClient, scheduledGameId: string) => Promise<number>;
  /** Drawn-balls-set (PT4-spesifikk; leser `app_game1_draws`). */
  loadDrawnBallsSet: (client: PoolClient, scheduledGameId: string) => Promise<Set<number>>;
  /** Fire-and-forget audit-log (samme som andre engine-audit-hooks). */
  fireAudit: (event: {
    actorId: string | null;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }) => void;
  /** Pure helpers fra main-fila (re-eksportert). */
  buildVariantConfigFromGameConfigJson: (raw: unknown) => GameVariantConfig | null;
  resolvePhaseConfig: (
    raw: unknown,
    phase: number
  ) => { kind: "percent"; percent: number } | { kind: "fixed"; amountCents: number };
  phaseToConfigKey: (phase: number) => string;
  phaseDisplayName: (phase: number) => string;
  resolveEngineColorName: (ticketColor: string) => string | null;
  patternPrizeToCents: (
    pattern: import("./variantConfig.js").PatternConfig,
    potCents: number
  ) => number;
}

// ── Internal shapes ──────────────────────────────────────────────────────────

/**
 * PT4: Internal shape for static ticket-query i `evaluatePhysicalTicketsForPhase`.
 */
interface StaticTicketForEvaluation {
  id: string;
  ticket_serial: string;
  hall_id: string;
  ticket_color: string;
  card_matrix: unknown;
  responsible_user_id: string | null;
  sold_by_user_id: string | null;
  paid_out_at: Date | string | null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * PT4: Evaluér fysiske bonger for aktiv fase. Returnerer liste over
 * fysisk-bong-vinnere med opprettet pending-row pr bong. Transaksjonsbruk:
 *
 *   - Selecter `app_static_tickets` (samme client som draw-en kjører i
 *     slik at lesingen ser konsistent state etter markings-oppdatering).
 *     Men merk: `app_static_tickets` har ikke `markings_json` — vi må
 *     bygge markings fra trukne kuler i `app_game1_draws`.
 *   - Kaller `PhysicalTicketPayoutService.createPendingPayout` for hver
 *     vinner (idempotent ON CONFLICT DO NOTHING, men det gjøres IKKE via
 *     `client` → ny pool-tilkobling). Dette er OK fordi pending-tabellen
 *     er uavhengig av draw-state — en rollback av draw-en skal IKKE slette
 *     pending-rader som er opprettet, men det er heller ikke kritisk
 *     siden draw-en er idempotent (neste kjøring finner samme match).
 *
 * Fail-closed: hvis service kaster → logg warning og returnér tom liste.
 * Fysisk-bong-vinn-flyt SKAL IKKE blokkere draw-en (viktig: vi bryter ikke
 * digital wallet-payout). Fysisk-bong-feil er manuelle gjenopprettinger.
 */
export async function evaluatePhysicalTicketsForPhase(
  deps: EvaluatePhysicalTicketsDeps,
  client: PoolClient,
  scheduledGameId: string,
  currentPhase: number,
  ticketConfigJson: unknown,
  gameConfigJson: unknown
): Promise<PhysicalTicketWinInfo[]> {
  let staticRows: StaticTicketForEvaluation[];
  try {
    const { rows } = await client.query<StaticTicketForEvaluation>(
      `SELECT id,
              ticket_serial,
              hall_id,
              ticket_color,
              card_matrix,
              responsible_user_id,
              sold_by_user_id,
              paid_out_at
         FROM ${deps.staticTicketsTable}
        WHERE sold_to_scheduled_game_id = $1
          AND is_purchased = true
          AND paid_out_at IS NULL`,
      [scheduledGameId]
    );
    staticRows = rows;
  } catch (err) {
    log.warn(
      { err, scheduledGameId, currentPhase },
      "[PT4] Feil ved lesing av fysiske bonger — skipper fysisk-pattern-match"
    );
    return [];
  }

  if (staticRows.length === 0) {
    return [];
  }

  // Last trukne kuler i rekkefølge (inkluderer den akkurat trukne — som
  // draws-INSERT skjedde før denne funksjonen kalles).
  const drawnBalls = await deps.loadDrawnBallsSet(client, scheduledGameId);

  // Pot + variantConfig for å beregne expected_payout per farge-gruppe.
  // Samme kildedata som digital-path — konsistens er viktig.
  const potCents = await deps.computePotCents(client, scheduledGameId);
  let variantConfig: GameVariantConfig | null = null;
  try {
    variantConfig = deps.buildVariantConfigFromGameConfigJson(gameConfigJson);
  } catch {
    variantConfig = null;
  }

  const perColor = Boolean(variantConfig?.patternsByColor);
  let flatPrizeCents = 0;
  if (!perColor) {
    const resolved = deps.resolvePhaseConfig(ticketConfigJson, currentPhase);
    flatPrizeCents =
      resolved.kind === "percent"
        ? Math.floor((potCents * resolved.percent) / 100)
        : resolved.amountCents;
  }

  const results: PhysicalTicketWinInfo[] = [];
  const patternKey = deps.phaseToConfigKey(currentPhase);

  for (const row of staticRows) {
    const grid = parsePhysicalCardMatrix(row.card_matrix);
    if (grid.length !== 25) continue;
    const markings = buildMarkingsFromGrid(grid, drawnBalls);
    const eval_ = evaluatePhase(grid, markings, currentPhase);
    if (!eval_.isWinner) continue;

    // Beregn expected payout. Per farge → slå opp pattern for bongens
    // farge; flat → bruk beregnet flat-pris. Physical bonger bruker
    // family-farge (small/large/traffic-light); matcher digital
    // `ticketColor` på legacy-path.
    let expectedCents: number;
    if (perColor && variantConfig) {
      const engineColorName = deps.resolveEngineColorName(row.ticket_color) ?? row.ticket_color;
      const patterns = resolvePatternsForColor(
        variantConfig,
        engineColorName,
        undefined // ikke logg — vi har allerede loggit for digital
      );
      const phasePattern = patterns[currentPhase - 1];
      expectedCents = phasePattern
        ? deps.patternPrizeToCents(phasePattern, potCents)
        : 0;
    } else {
      expectedCents = flatPrizeCents;
    }

    // Responsible user: handover kan ha flyttet ansvar fra sold_by til
    // handover-to-user. Fall tilbake til sold_by_user_id hvis
    // responsible_user_id mangler (defensivt — ikke alle legacy-rader
    // har begge satt).
    const responsibleUserId =
      row.responsible_user_id?.trim()
        ? row.responsible_user_id
        : row.sold_by_user_id?.trim()
          ? row.sold_by_user_id
          : null;
    if (!responsibleUserId) {
      log.warn(
        {
          scheduledGameId,
          ticketSerial: row.ticket_serial,
          hallId: row.hall_id,
          phase: currentPhase,
        },
        "[PT4] Fysisk bong mangler responsible_user_id+sold_by_user_id — skipper vinn-registrering"
      );
      continue;
    }

    try {
      const pending = await deps.physicalTicketPayoutService.createPendingPayout({
        ticketId: row.ticket_serial,
        hallId: row.hall_id,
        scheduledGameId,
        patternPhase: patternKey,
        expectedPayoutCents: expectedCents,
        responsibleUserId,
        color: row.ticket_color,
      });

      results.push({
        pendingPayoutId: pending.id,
        ticketId: pending.ticketId,
        hallId: pending.hallId,
        phase: currentPhase,
        patternName: deps.phaseDisplayName(currentPhase),
        responsibleUserId: pending.responsibleUserId,
        expectedPayoutCents: pending.expectedPayoutCents,
        color: pending.color,
        adminApprovalRequired: pending.adminApprovalRequired,
      });

      // Audit-log detect (fire-and-forget).
      deps.fireAudit({
        actorId: null,
        action: "physical_ticket.pending_detected",
        resourceId: scheduledGameId,
        details: {
          pendingPayoutId: pending.id,
          ticketId: pending.ticketId,
          hallId: pending.hallId,
          pattern: patternKey,
          phase: currentPhase,
          expectedPayoutCents: pending.expectedPayoutCents,
          responsibleUserId: pending.responsibleUserId,
          color: pending.color,
          adminApprovalRequired: pending.adminApprovalRequired,
        },
      });
    } catch (err) {
      log.warn(
        {
          err,
          scheduledGameId,
          ticketSerial: row.ticket_serial,
          phase: currentPhase,
        },
        "[PT4] createPendingPayout feilet — skipper denne bongen"
      );
    }
  }

  return results;
}

/**
 * PT4: Last alle trukne kuler for spillet som Set<number>. Brukes for å
 * bygge markings mot fysiske kort på evaluering-tidspunkt.
 *
 * Helper-funksjonen er eksportert slik at service-en kan sende den inn
 * som `deps.loadDrawnBallsSet`-callback — dette lar service-en bruke
 * samme query-pattern på andre PT4-helpers fremover.
 */
export async function loadDrawnBallsSet(
  client: PoolClient,
  drawsTable: string,
  scheduledGameId: string
): Promise<Set<number>> {
  const { rows } = await client.query<{ ball_value: number }>(
    `SELECT ball_value
       FROM ${drawsTable}
      WHERE scheduled_game_id = $1`,
    [scheduledGameId]
  );
  const out = new Set<number>();
  for (const r of rows) {
    const n = Number(r.ball_value);
    if (Number.isInteger(n)) out.add(n);
  }
  return out;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * PT4: Parser `card_matrix`-JSONB fra `app_static_tickets`. Legacy-format
 * (CSV-import) er 25 integer (5x5 row-major, ingen free-centre i dataen —
 * men bingo-evaluatoren tolker `0` som free centre).
 *
 * Fysisk bong har IKKE free-centre i CSV-en — men legacy-tradisjon er at
 * midten teller som markert. For sikkerhet: ikke injiser 0 (vi lar 0
 * behandles av buildTicketMask / evaluatePhase som free centre).
 */
export function parsePhysicalCardMatrix(raw: unknown): Array<number | null> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isInteger(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseInt(v, 10);
      if (Number.isInteger(n)) return n;
    }
    return null;
  });
}

/**
 * PT4: Bygg markings-array (length === grid.length, typisk 25) ut fra grid-
 * verdier og mengden trukne kuler. En celle er markert hvis dens tall er
 * trukket. Celle-verdi 0 regnes som free centre og eksplisitt markert
 * (matcher `evaluatePhase`-semantikken). null-celler forblir umarkert.
 */
export function buildMarkingsFromGrid(
  grid: ReadonlyArray<number | null>,
  drawnBalls: Set<number>
): boolean[] {
  const out = Array(grid.length).fill(false) as boolean[];
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    if (cell === 0) {
      out[i] = true; // free-centre
      continue;
    }
    if (typeof cell === "number" && drawnBalls.has(cell)) {
      out[i] = true;
    }
  }
  return out;
}
