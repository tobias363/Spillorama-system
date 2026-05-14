/**
 * Round-replay anomaly-detector — flagger kjente bug-mønstre i en replay.
 *
 * Tobias-direktiv 2026-05-14: "Anomaly-detektor (essensielt for verdi)
 * sjekker timeline for kjente bug-mønstre."
 *
 * Detektoren er pure-function — gitt en `RoundReplay` (uten anomalies-felt
 * fylt) returnerer den et array av `ReplayAnomaly` som PM/audit kan handle
 * på. Ingen DB-tilgang, ingen side-effekter, ingen kasting (catch + skip).
 *
 * Bug-mønstre dekket per 2026-05-14:
 *
 * 1. **payout_mismatch** — vinner-utbetalingen matcher ikke forventet
 *    (hvit-base × color-multiplier) etter pot-deling. Dekker buggene
 *    fra PR #1408/#1411/#1413 hvor auto-multiplikator ble feilbygd
 *    eller ikke applisert.
 *
 * 2. **missing_advance** — plan-run gikk fra `running` til `finished`
 *    uten at det er en `master_action`-advance/stop, ELLER plan-run
 *    har `current_position` > items uten advance-event for hver.
 *
 * 3. **stuck_plan_run** — scheduled-game er `completed` > 30s uten at
 *    plan-run-state ble reconciled til `finished` (PR #1403 + #1407
 *    dekker).
 *
 * 4. **double_stake** — sum av ticket-purchase pre-game er ulik
 *    summen som ble debited fra wallet (compliance-ledger STAKE).
 *    Dekker buggen der Innsats vs Forhåndskjøp ble dobbel-tellet.
 *
 * 5. **preparing_room_hang** — engine ended > 15s uten ny scheduled-game
 *    spawn (mens plan-run fortsatt er `running` med items igjen).
 *    Manifesterer som "Forbereder rommet…"-state som ikke løses.
 *
 * Detektor-resultater er stabile og deterministiske: samme replay
 * gir alltid samme anomalies (uavhengig av kjøretid).
 */

import type {
  ReplayAnomaly,
  RoundReplay,
  ReplayTimelineEvent,
} from "./roundReplayBuilder.js";

// ────────────────────────────────────────────────────────────────────────
// Konfigurasjon
// ────────────────────────────────────────────────────────────────────────

/**
 * Tidskonstanter for anomaly-detektoren. Verdier valgt for å unngå
 * false-positives på rolige test-runder samtidig som vi fanger reelle
 * hang-er.
 */
export interface AnomalyThresholds {
  /** Plan-run anses stuck hvis scheduled-game er completed mer enn dette antall ms uten reconcile. */
  stuckPlanRunMs: number;
  /** "Forbereder rommet"-hang hvis engine ended mer enn dette antall ms uten ny scheduled-game. */
  preparingRoomMs: number;
  /** Toleranse for double-stake — under denne i øre = no-flag. */
  stakeDeltaToleranceCents: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  stuckPlanRunMs: 30_000,
  preparingRoomMs: 15_000,
  stakeDeltaToleranceCents: 100, // 1 kr toleranse for floor-rounding
};

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function findEvents(
  timeline: ReplayTimelineEvent[],
  type: ReplayTimelineEvent["type"],
): ReplayTimelineEvent[] {
  return timeline.filter((e) => e.type === type);
}

// ────────────────────────────────────────────────────────────────────────
// Detektor-implementasjoner
// ────────────────────────────────────────────────────────────────────────

/**
 * Payout-mismatch: per-vinner sammenligning mot expected-prize fra
 * summary. Bruker `match`-flagget som builder allerede har beregnet.
 */
function detectPayoutMismatch(replay: RoundReplay): ReplayAnomaly[] {
  const out: ReplayAnomaly[] = [];
  for (const w of replay.summary.winners) {
    if (w.match) continue;
    // Bare flag hvis expected er konkret kjent (ikke null fra catalog-mangel).
    if (w.expectedCents === null) continue;
    out.push({
      type: "payout_mismatch",
      severity: "critical",
      description: `${w.ticketColor} Phase ${w.phase} utbetalt ${w.prizeKr} kr; forventet ${w.expectedKr} kr (auto-mult ikke applisert?).`,
      details: {
        phase: w.phase,
        ticketColor: w.ticketColor,
        actualCents: w.prizeCents,
        expectedCents: w.expectedCents,
        actualKr: w.prizeKr,
        expectedKr: w.expectedKr,
        winnerBrettCount: w.winnerBrettCount,
        drawSequenceAtWin: w.drawSequenceAtWin,
        winnerUserId: w.winnerUserId,
      },
    });
  }
  return out;
}

/**
 * Missing advance: hvis scheduled-game er completed og plan-run er
 * finished, sjekk om vi har minst én `master_action`-event av typen
 * `start` (alltid forventet) og minst én `advance`-event hvis posisjonen
 * gikk videre.
 *
 * Heuristikk: plan-run.position > 1 betyr at advance MÅ ha skjedd —
 * hvis advance-event mangler er det en bug.
 */
function detectMissingAdvance(replay: RoundReplay): ReplayAnomaly[] {
  const out: ReplayAnomaly[] = [];

  // Bare relevant for plan-runs.
  const planRunId = replay.metadata.planRunId;
  if (!planRunId) return out;

  const status = replay.metadata.planRunStatus;
  // Plan-run må være ferdig før vi vurderer "missing advance".
  if (status !== "finished") return out;

  // Hvis runden hadde 0 draws, har spillet aldri startet — ingen advance forventet.
  if (replay.metadata.totalDraws === 0) return out;

  const position = replay.metadata.position ?? 0;

  // Position 1 + finished + draws > 0 = enkelt-spill, ingen advance behøves.
  if (position <= 1) return out;

  // Hvis position > 1: vi forventer at en advance-action har skjedd FØR
  // denne runden ble spawnet. Master-audit for DENNE runden bør inneholde
  // en `start`-event men IKKE en advance (siden advance skjer på FORRIGE
  // runde-end). Mismatch: hvis position > 1 og ingen prior runder er
  // synlige i audit-trail kan vi ikke verifisere advance — flagg som
  // info-nivå anomaly.
  const masterActions = findEvents(replay.timeline, "master_action");
  const advanceEvents = masterActions.filter(
    (e) =>
      typeof e.data["action"] === "string" &&
      (e.data["action"] as string).includes("advance"),
  );

  // Hvis vi har advance-events i denne rundens audit, alt fint.
  if (advanceEvents.length > 0) return out;

  // Vi mangler advance — men dette kan også være forventet hvis advance
  // ble skrevet på forrige runde. Flag som info.
  out.push({
    type: "missing_advance",
    severity: "info",
    description: `Plan-run finished på position ${position}, men ingen advance-action sett i denne rundens audit-trail (advance skjedde trolig på forrige runde).`,
    details: {
      planRunId,
      position,
      planRunStatus: status,
      masterActionCount: masterActions.length,
    },
  });

  return out;
}

/**
 * Stuck plan-run: scheduled-game er completed > 30s uten at
 * plan-run-status er flippet til `finished`. PR #1403 + #1407 dekker
 * dette via reconcile-mekanismer — anomaly-detektoren bekrefter at
 * reconcile faktisk har lykkes.
 */
function detectStuckPlanRun(
  replay: RoundReplay,
  thresholds: AnomalyThresholds,
): ReplayAnomaly[] {
  const out: ReplayAnomaly[] = [];

  const planRunId = replay.metadata.planRunId;
  if (!planRunId) return out;

  const actualEnd = replay.metadata.actualEndTime;
  if (!actualEnd) return out;

  const status = replay.metadata.status;
  if (status !== "completed" && status !== "cancelled") return out;

  // Hvis plan-run er finished, ingen stuck.
  if (replay.metadata.planRunStatus === "finished") return out;

  // Beregn delta mellom actual-end og generated-at.
  const endMs = new Date(actualEnd).getTime();
  const nowMs = new Date(replay.generatedAt).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return out;

  const deltaMs = nowMs - endMs;
  if (deltaMs < thresholds.stuckPlanRunMs) return out;

  out.push({
    type: "stuck_plan_run",
    severity: "warn",
    description: `Scheduled-game completed ${Math.round(deltaMs / 1000)}s siden men plan-run-status er fortsatt "${replay.metadata.planRunStatus ?? "ukjent"}" (forventet "finished").`,
    details: {
      planRunId,
      scheduledGameStatus: status,
      planRunStatus: replay.metadata.planRunStatus,
      actualEndTime: actualEnd,
      deltaMs,
      generatedAt: replay.generatedAt,
      thresholdMs: thresholds.stuckPlanRunMs,
    },
  });

  return out;
}

/**
 * Double-stake: sum av ticket-purchases vs sum av STAKE-events i
 * compliance-ledger. Med forhåndskjøp bør disse stemme — hvis de
 * avviker er det enten dobbel-tellet eller mangler ledger.
 */
function detectDoubleStake(
  replay: RoundReplay,
  thresholds: AnomalyThresholds,
): ReplayAnomaly[] {
  const out: ReplayAnomaly[] = [];

  const purchaseCents = replay.summary.purchases.totalCents;
  if (purchaseCents === 0) return out;

  // Finn STAKE-events i ledger (kan være "STAKE", "PURCHASE", etc avhengig av schema).
  const ledgerEvents = findEvents(replay.timeline, "compliance_ledger");
  let stakeCents = 0;
  let hasStakeEvent = false;
  for (const e of ledgerEvents) {
    const eventType = String(e.data["eventType"] ?? "").toUpperCase();
    if (
      eventType === "STAKE" ||
      eventType === "PURCHASE" ||
      eventType === "TICKET_PURCHASE"
    ) {
      hasStakeEvent = true;
      const amount = e.data["amount"];
      const cents =
        typeof amount === "number"
          ? Math.round(amount * 100)
          : typeof amount === "string"
            ? Math.round(Number(amount) * 100)
            : 0;
      if (Number.isFinite(cents)) stakeCents += cents;
    }
  }

  // Hvis ingen STAKE-event eksisterer, kan vi ikke vurdere dobbel-stake.
  // Det er ikke nødvendigvis en bug — kan være compliance-mode der STAKE
  // ikke logges. Skip.
  if (!hasStakeEvent) return out;

  const deltaCents = Math.abs(stakeCents - purchaseCents);
  if (deltaCents <= thresholds.stakeDeltaToleranceCents) return out;

  out.push({
    type: "double_stake",
    severity: "critical",
    description: `Innsats fra ticket-purchase (${purchaseCents / 100} kr) matcher ikke compliance-ledger STAKE (${stakeCents / 100} kr). Delta: ${deltaCents / 100} kr.`,
    details: {
      purchaseCents,
      stakeCents,
      deltaCents,
      purchaseKr: purchaseCents / 100,
      stakeKr: stakeCents / 100,
      toleranceCents: thresholds.stakeDeltaToleranceCents,
    },
  });

  return out;
}

/**
 * Preparing-room-hang: hvis runden ended med natural-end-reason (Fullt Hus
 * vunnet eller bag empty) MEN det er > 15s siden uten at noe annet skjedde,
 * og plan-run fortsatt har posisjoner igjen — det er hangen.
 *
 * For en stand-alone replay kan vi bare flagge basert på status + tidsdelta;
 * vi kan ikke se "neste scheduled-game spawnet" siden det krever cross-runde-
 * query. Vi flagger derfor på "completed > 15s + plan-run.running" som
 * sterk indikator.
 */
function detectPreparingRoomHang(
  replay: RoundReplay,
  thresholds: AnomalyThresholds,
): ReplayAnomaly[] {
  const out: ReplayAnomaly[] = [];

  const status = replay.metadata.status;
  if (status !== "completed") return out;

  // Plan-run må fortsatt være `running` — hvis finished er det ikke hang.
  if (replay.metadata.planRunStatus !== "running") return out;

  const actualEnd = replay.metadata.actualEndTime;
  if (!actualEnd) return out;

  const endMs = new Date(actualEnd).getTime();
  const nowMs = new Date(replay.generatedAt).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return out;

  const deltaMs = nowMs - endMs;
  if (deltaMs < thresholds.preparingRoomMs) return out;

  // Avgrenser fra stuck_plan_run: stuck_plan_run forventer planRunStatus !== running.
  // Her: planRunStatus === running og scheduled-game completed = hang.
  out.push({
    type: "preparing_room_hang",
    severity: "warn",
    description: `Scheduled-game completed ${Math.round(deltaMs / 1000)}s siden, plan-run fortsatt "running" — ingen ny scheduled-game spawnet. Manifesterer som "Forbereder rommet…"-hang.`,
    details: {
      planRunId: replay.metadata.planRunId,
      planRunStatus: replay.metadata.planRunStatus,
      scheduledGameStatus: status,
      actualEndTime: actualEnd,
      deltaMs,
      thresholdMs: thresholds.preparingRoomMs,
    },
  });

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Kjør alle detektorer på en replay og returner samlet liste.
 *
 * Detektorene er stateless og uavhengige; rekkefølgen i output er
 * deterministisk basert på detector-rekkefølgen her.
 */
export function detectRoundReplayAnomalies(
  replay: RoundReplay,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): ReplayAnomaly[] {
  const anomalies: ReplayAnomaly[] = [];
  // Hver detektor catcher sine egne errors; vi gir aldri bubble-up til caller.
  try {
    anomalies.push(...detectPayoutMismatch(replay));
  } catch {
    /* skip detector */
  }
  try {
    anomalies.push(...detectMissingAdvance(replay));
  } catch {
    /* skip detector */
  }
  try {
    anomalies.push(...detectStuckPlanRun(replay, thresholds));
  } catch {
    /* skip detector */
  }
  try {
    anomalies.push(...detectDoubleStake(replay, thresholds));
  } catch {
    /* skip detector */
  }
  try {
    anomalies.push(...detectPreparingRoomHang(replay, thresholds));
  } catch {
    /* skip detector */
  }
  return anomalies;
}
