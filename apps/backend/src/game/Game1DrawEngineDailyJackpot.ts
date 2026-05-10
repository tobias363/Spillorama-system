/**
 * ADR-0017 (2026-05-10) — DrawEngine-hook for per-spill Jackpott.
 *
 * Tobias-direktiv 2026-05-10:
 *   "Jackpot-popup gjelder kun for Jackpot-katalog-spillet (pos 7), og
 *    bingoverten setter ALLTID jackpot manuelt før spillet starter. Det
 *    skal IKKE være automatisk akkumulering."
 *
 * Forhistorie:
 *   Tidligere kjørte denne hooken auto-utbetaling fra `app_game1_jackpot_state`
 *   (daglig akkumulering +4000 kr/dag, max 30 000 kr). Per ADR-0017 er den
 *   automatiske akkumuleringen fjernet — jackpot leses nå direkte fra
 *   `app_game_plan_run.jackpot_overrides_json[currentPosition]` som master
 *   setter via `JackpotSetupModal` før Jackpot-spillet starter.
 *
 * Når kalles dette?
 *   Etter at `Game1DrawEngineService.payoutPhase` har utbetalt Fullt Hus
 *   (phase === 5) sin ordinære gevinst + per-farge jackpot, kjøres denne
 *   hooken én gang per Fullt Hus-event. Hooken er separat fra:
 *
 *     - `Game1JackpotService` (per-farge fixed-amount jackpot)
 *     - `Game1PotService` (Innsatsen + akkumulerende pot per hall)
 *
 * Jackpot-override-shape (lagret i `plan_run.jackpot_overrides_json`):
 *   {
 *     "<position>": {
 *       "draw":        <ball-trekning hvor jackpot-pattern slår inn (1-90)>,
 *       "prizesCents": { "hvit": <øre>, "gul": <øre>, "lilla": <øre> }
 *     }
 *   }
 *
 *   Eksempel:
 *     { "7": { "draw": 47, "prizesCents": { "hvit": 50000, "gul": 100000, "lilla": 150000 } } }
 *
 * Auto-utbetaling skjer KUN når:
 *   1) Vi finner aktiv plan-run for scheduled-game (via plan_run_id +
 *      plan_position kolonner på `app_game1_scheduled_games`).
 *   2) Plan-run.jackpot_overrides[currentPosition] eksisterer.
 *   3) `drawSequenceAtWin <= override.draw` (vinning innen jackpot-vinduet).
 *   4) Vinneren har en bongfarge som er i `prizesCents`-mappingen.
 *
 * Hvis noen av disse mangler er det fail-quiet (info-event logget). Auto-
 * utbetaling for Spill 1 sin spill-sekvens er derfor opt-in per Jackpot-
 * spill — andre katalog-spill (Bingo, 1000-spill, etc.) har ingen
 * jackpot-override og evaluator-en gjør no-op.
 *
 * Audit:
 *   `game1_jackpot.auto_award` skrives som best-effort etter wallet-credit
 *   (samme idempotency-key-format som før: `g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}`).
 *   Detaljene inkluderer planRunId, planPosition, override.draw, og per-farge
 *   prize-summer for Lotteritilsynet-sporbarhet.
 */

import type { PoolClient } from "pg";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-daily-jackpot" });

export interface DailyJackpotWinner {
  /** assignment-id fra app_game1_ticket_assignments. */
  assignmentId: string;
  /** wallet-id til eieren. */
  walletId: string;
  /** bruker-id (audit). */
  userId: string;
  /** hall-id (audit). */
  hallId: string;
  /**
   * ADR-0017 (2026-05-10): bongfarge-slug ("small_yellow", "small_white",
   * "large_yellow", etc.). Vi mapper familie-prefiks ("yellow"|"white"|"purple")
   * til admin-overridens bongfarge-keys ("gul"|"hvit"|"lilla").
   */
  ticketColor: string;
}

export interface RunDailyJackpotEvaluationInput {
  /** Postgres-client fra ytre transaksjon — brukes til å lese plan-run-state. */
  client: PoolClient;
  /** Schema-prefiks ("public" eller annet). */
  schema: string;
  /** Wallet for credit til vinner. */
  walletAdapter: WalletAdapter;
  /** Audit-tjeneste for fire-and-forget logg. */
  audit: AuditLogService;
  /** Spillet som ble vunnet. */
  scheduledGameId: string;
  /** Draw-sekvens (1-indexed) som utløste Fullt Hus. */
  drawSequenceAtWin: number;
  /** Vinnere som faktisk fikk Fullt Hus utbetalt i denne fasen. */
  winners: DailyJackpotWinner[];
}

export interface RunDailyJackpotEvaluationResult {
  /** True når evaluering trigget en award. */
  awarded: boolean;
  /** Beløp som ble distribuert (sum av credits til alle vinnere, øre). */
  totalAwardedCents: number;
  /** Plan-run som potten ble lest fra (null hvis ikke matchet). */
  planRunId: string | null;
  /** Plan-position på scheduled-game (null hvis manglende). */
  planPosition: number | null;
  /** Override.draw som var satt for denne posisjonen (null hvis ingen). */
  triggerDraw: number | null;
  /** Grunn til at award ikke ble trigget (audit). */
  skipReason?:
    | "NO_PLAN_RUN_BINDING"
    | "NO_PLAN_RUN_FOUND"
    | "NO_OVERRIDE_FOR_POSITION"
    | "ABOVE_THRESHOLD"
    | "NO_WINNERS"
    | "NO_PRIZE_FOR_COLOR";
}

/**
 * ADR-0017: map ticket-color slug-form (engine) til bongfarge-key (admin
 * override). Engine bruker `small_yellow`/`large_yellow`/`small_white`/etc.
 * mens admin lagrer `gul`/`hvit`/`lilla`. Familie-prefiks bestemmer mapping.
 *
 * Returnerer null hvis bongfargen ikke gjenkjennes — caller skipper credit
 * for den vinneren.
 */
function ticketColorToOverrideKey(ticketColor: string): string | null {
  const normalized = ticketColor.toLowerCase().trim();
  if (normalized.includes("yellow")) return "gul";
  if (normalized.includes("white")) return "hvit";
  if (normalized.includes("purple")) return "lilla";
  return null;
}

interface PlanRunRow {
  plan_run_id: string;
  plan_position: number;
  jackpot_overrides_json: unknown;
}

interface ScheduledGameRow {
  plan_run_id: string | null;
  plan_position: number | null;
}

interface JackpotOverridePayload {
  draw: number;
  prizesCents: Record<string, number>;
}

/**
 * ADR-0017: les plan-run-id + plan-position fra scheduled-game, deretter hent
 * jackpot-override-objektet fra plan-run for nåværende posisjon. Returnerer
 * null hvis bindingen mangler eller plan-runen ikke har override for posisjonen.
 */
async function loadActiveJackpotOverride(
  client: PoolClient,
  schema: string,
  scheduledGameId: string,
): Promise<{
  planRunId: string;
  planPosition: number;
  override: JackpotOverridePayload;
} | { planRunId: string | null; planPosition: number | null; override: null }> {
  // 1) Hent plan_run_id + plan_position fra scheduled-game.
  const sgRow = await client.query<ScheduledGameRow>(
    `SELECT plan_run_id, plan_position
       FROM "${schema}"."app_game1_scheduled_games"
      WHERE id = $1`,
    [scheduledGameId],
  );
  const sg = sgRow.rows[0];
  if (!sg || !sg.plan_run_id || sg.plan_position == null) {
    return { planRunId: null, planPosition: null, override: null };
  }

  // 2) Hent plan-runens jackpot-overrides JSON.
  const prRow = await client.query<PlanRunRow>(
    `SELECT id AS plan_run_id, current_position AS plan_position,
            jackpot_overrides_json
       FROM "${schema}"."app_game_plan_run"
      WHERE id = $1`,
    [sg.plan_run_id],
  );
  const pr = prRow.rows[0];
  if (!pr) {
    return { planRunId: sg.plan_run_id, planPosition: sg.plan_position, override: null };
  }

  // 3) Resolve override for plan_position på scheduled-game (NB: bruker
  //    scheduled-gamens position, ikke plan-runens current_position. Dette
  //    er for å være robust mot at master har klikket /advance før
  //    Fullt Hus-eventet ble committet til DB).
  const overrides = pr.jackpot_overrides_json;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { planRunId: pr.plan_run_id, planPosition: sg.plan_position, override: null };
  }
  const positionKey = String(sg.plan_position);
  const raw = (overrides as Record<string, unknown>)[positionKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { planRunId: pr.plan_run_id, planPosition: sg.plan_position, override: null };
  }

  // 4) Parse override-shape. Tolerer både camelCase og snake_case (matcher
  //    GamePlanRunService.parseJackpotOverrides).
  const obj = raw as Record<string, unknown>;
  const drawN = Number(obj.draw);
  if (!Number.isFinite(drawN) || !Number.isInteger(drawN) || drawN <= 0) {
    return { planRunId: pr.plan_run_id, planPosition: sg.plan_position, override: null };
  }
  let prizesRaw: unknown = obj.prizesCents;
  if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
  if (!prizesRaw || typeof prizesRaw !== "object" || Array.isArray(prizesRaw)) {
    return { planRunId: pr.plan_run_id, planPosition: sg.plan_position, override: null };
  }
  const prizes: Record<string, number> = {};
  for (const [key, val] of Object.entries(prizesRaw as Record<string, unknown>)) {
    const n = Number(val);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      prizes[key] = n;
    }
  }
  if (Object.keys(prizes).length === 0) {
    return { planRunId: pr.plan_run_id, planPosition: sg.plan_position, override: null };
  }

  return {
    planRunId: pr.plan_run_id,
    planPosition: sg.plan_position,
    override: { draw: drawN, prizesCents: prizes },
  };
}

/**
 * Hovedfunksjon. Kalles fra `Game1DrawEngineService.payoutPhase` når
 * `currentPhase === TOTAL_PHASES (5)` og `winners.length > 0`.
 *
 * ADR-0017 (2026-05-10): Leser per-spill jackpot-override fra
 * `app_game_plan_run.jackpot_overrides_json` i stedet for daglig akkumulering.
 */
export async function runDailyJackpotEvaluation(
  input: RunDailyJackpotEvaluationInput,
): Promise<RunDailyJackpotEvaluationResult> {
  const empty: RunDailyJackpotEvaluationResult = {
    awarded: false,
    totalAwardedCents: 0,
    planRunId: null,
    planPosition: null,
    triggerDraw: null,
  };

  if (input.winners.length === 0) {
    return { ...empty, skipReason: "NO_WINNERS" };
  }

  // 1) Resolve jackpot-override fra plan-run.
  const lookup = await loadActiveJackpotOverride(
    input.client,
    input.schema,
    input.scheduledGameId,
  );

  if (lookup.override === null) {
    if (lookup.planRunId === null) {
      log.info(
        { scheduledGameId: input.scheduledGameId },
        "[ADR-0017] no plan-run binding on scheduled-game — skipping daily jackpot",
      );
      return { ...empty, skipReason: "NO_PLAN_RUN_BINDING" };
    }
    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        planRunId: lookup.planRunId,
        planPosition: lookup.planPosition,
      },
      "[ADR-0017] no jackpot-override for plan-position — skipping daily jackpot",
    );
    return {
      ...empty,
      planRunId: lookup.planRunId,
      planPosition: lookup.planPosition,
      skipReason: "NO_OVERRIDE_FOR_POSITION",
    };
  }

  const { planRunId, planPosition, override } = lookup;

  // 2) Sjekk at vinning skjedde innen override.draw.
  if (input.drawSequenceAtWin > override.draw) {
    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        planRunId,
        planPosition,
        triggerDraw: override.draw,
        drawSequenceAtWin: input.drawSequenceAtWin,
      },
      "[ADR-0017] win above threshold — no jackpot award",
    );
    return {
      ...empty,
      planRunId,
      planPosition,
      triggerDraw: override.draw,
      skipReason: "ABOVE_THRESHOLD",
    };
  }

  // 3) Beregn per-vinner-credit. Hver vinner får sin bongfarges prize-beløp;
  //    vinnere med samme bongfarge deler den fargens pot likt (floor-rounding,
  //    rest til hus). Dette matcher pot-per-bongstørrelse-regelen i
  //    `SPILL_REGLER_OG_PAYOUT.md` §9.
  const winnersByColor = new Map<string, DailyJackpotWinner[]>();
  for (const winner of input.winners) {
    const colorKey = ticketColorToOverrideKey(winner.ticketColor);
    if (!colorKey) {
      log.warn(
        { winnerAssignmentId: winner.assignmentId, ticketColor: winner.ticketColor },
        "[ADR-0017] unknown ticket-color — skipping winner",
      );
      continue;
    }
    const list = winnersByColor.get(colorKey) ?? [];
    list.push(winner);
    winnersByColor.set(colorKey, list);
  }

  if (winnersByColor.size === 0) {
    return {
      ...empty,
      planRunId,
      planPosition,
      triggerDraw: override.draw,
      skipReason: "NO_PRIZE_FOR_COLOR",
    };
  }

  let totalCreditedCents = 0;
  const auditPerColor: Array<{
    colorKey: string;
    potCents: number;
    winnerCount: number;
    perWinnerCents: number;
    houseRetainedCents: number;
  }> = [];

  for (const [colorKey, colorWinners] of winnersByColor.entries()) {
    const potCents = override.prizesCents[colorKey];
    if (potCents == null || potCents <= 0) {
      // Ingen prize for denne bongfargen — fail-quiet, fortsett til neste.
      log.info(
        {
          scheduledGameId: input.scheduledGameId,
          planRunId,
          colorKey,
          winnerCount: colorWinners.length,
        },
        "[ADR-0017] no prize configured for ticket-color — skipping",
      );
      continue;
    }

    const winnerCount = colorWinners.length;
    const perWinnerCents = Math.floor(potCents / winnerCount);
    const houseRetainedCents = potCents - perWinnerCents * winnerCount;

    if (perWinnerCents <= 0) {
      log.warn(
        { potCents, winnerCount, colorKey },
        "[ADR-0017] perWinnerCents=0 — too many winners for pot; no credit",
      );
      auditPerColor.push({
        colorKey,
        potCents,
        winnerCount,
        perWinnerCents: 0,
        houseRetainedCents: potCents,
      });
      continue;
    }

    for (const winner of colorWinners) {
      const creditKey =
        `g1-jackpot-credit-${input.scheduledGameId}-${input.drawSequenceAtWin}-${winner.assignmentId}`;
      try {
        await input.walletAdapter.credit(
          winner.walletId,
          perWinnerCents / 100,
          `Spill 1 Jackpott — spill ${input.scheduledGameId}`,
          {
            idempotencyKey: creditKey,
            to: "winnings",
          },
        );
        totalCreditedCents += perWinnerCents;
      } catch (err) {
        // Wallet-feil propageres — caller (drawNext) ruller tilbake draw-tx.
        log.error(
          {
            err,
            scheduledGameId: input.scheduledGameId,
            planRunId,
            winnerAssignmentId: winner.assignmentId,
            colorKey,
            perWinnerCents,
          },
          "[ADR-0017] wallet.credit failed during jackpot payout",
        );
        throw err;
      }
    }

    auditPerColor.push({
      colorKey,
      potCents,
      winnerCount,
      perWinnerCents,
      houseRetainedCents,
    });
  }

  // 4) Audit (fire-and-forget). Ingen state-debit-rad lenger — `app_game1_jackpot_state`
  //    er deprecated. Idempotency-key på audit-eventet matcher pre-ADR-format
  //    så eksisterende ops-dashbord fortsatt fungerer.
  input.audit
    .record({
      actorId: null,
      actorType: "SYSTEM",
      action: "game1_jackpot.auto_award",
      resource: "game1_scheduled_game",
      resourceId: input.scheduledGameId,
      details: {
        planRunId,
        planPosition,
        triggerDraw: override.draw,
        drawSequenceAtWin: input.drawSequenceAtWin,
        totalAwardedCents: totalCreditedCents,
        perColor: auditPerColor,
        idempotencyKey: `g1-jackpot-${input.scheduledGameId}-${input.drawSequenceAtWin}`,
        adrReference: "ADR-0017",
      },
    })
    .catch((err) => {
      log.warn(
        {
          err,
          scheduledGameId: input.scheduledGameId,
          planRunId,
          planPosition,
        },
        "[ADR-0017] audit append failed",
      );
    });

  log.info(
    {
      scheduledGameId: input.scheduledGameId,
      planRunId,
      planPosition,
      triggerDraw: override.draw,
      drawSequenceAtWin: input.drawSequenceAtWin,
      totalAwardedCents: totalCreditedCents,
      perColorCount: auditPerColor.length,
    },
    "[ADR-0017] per-spill jackpot awarded",
  );

  return {
    awarded: totalCreditedCents > 0,
    totalAwardedCents: totalCreditedCents,
    planRunId,
    planPosition,
    triggerDraw: override.draw,
  };
}
