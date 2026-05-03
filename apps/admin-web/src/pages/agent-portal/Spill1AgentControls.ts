/**
 * Task 1.4 (2026-04-24): Spill 1 agent-kontrollpanel.
 *
 * Rendrer Start / Resume-knapper for agent-portalen. Knappene er kun
 * aktive hvis:
 *   - isMasterAgent === true (ellers viser vi en text-muted-melding
 *     "Kun master-hall kan starte runden").
 *   - Start: current-game.status er `purchase_open` eller `ready_to_start`.
 *   - Resume: current-game.status er `paused`.
 *
 * Event-delegation skjer i NextGamePanel via `data-action`-attributter.
 */

import type { Spill1CurrentGame } from "../../api/agent-game1.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

export interface Spill1AgentControlsProps {
  currentGame: Spill1CurrentGame;
  isMasterAgent: boolean;
  allReady: boolean;
  excludedHallIds: string[];
  /**
   * 2026-05-02 (Tobias UX-feedback): for non-master agents, vis Klar/Ikke-klar-
   * knapp slik at de kan signalisere ready-status til master. Backend-rute:
   * `POST /api/admin/game1/halls/:hallId/ready` (AGENT har
   * GAME1_HALL_READY_WRITE-permission + hall-scope).
   */
  selfHallReady?: boolean;
  selfHallId?: string;
}

export function renderSpill1AgentControls(
  props: Spill1AgentControlsProps
): string {
  // allReady ekstraheres ikke lenger — etter Tobias UX 2026-05-03 kan
  // master starte uavhengig av allReady (confirmUnreadyHalls-flow ekskluderer
  // ikke-klare haller). Beholder feltet i interface for kallere som måtte
  // bruke det andre steder.
  const { currentGame, isMasterAgent, excludedHallIds, selfHallReady, selfHallId } = props;

  if (!isMasterAgent) {
    // 2026-05-02: Non-master agent har Klar/Ikke-klar-knapp. Status-pill
    // viser nåværende ready-state for egen hall. Backend-call skjer i
    // NextGamePanel via data-action-attributter.
    const statusPill = selfHallReady
      ? `<span class="label label-success" data-marker="spill1-self-ready-yes">
           <i class="fa fa-check" aria-hidden="true"></i> Klar
         </span>`
      : `<span class="label label-warning" data-marker="spill1-self-ready-no">
           <i class="fa fa-clock-o" aria-hidden="true"></i> Ikke klar
         </span>`;
    const buttonHtml = selfHallReady
      ? `<button class="btn btn-default"
                  data-action="spill1-unmark-ready"
                  data-marker="spill1-unmark-ready-btn"
                  data-game-id="${escapeHtml(currentGame.id)}"
                  data-hall-id="${escapeHtml(selfHallId ?? "")}">
           <i class="fa fa-undo" aria-hidden="true"></i> Angre Klar
         </button>`
      : `<button class="btn btn-success"
                  data-action="spill1-mark-ready"
                  data-marker="spill1-mark-ready-btn"
                  data-game-id="${escapeHtml(currentGame.id)}"
                  data-hall-id="${escapeHtml(selfHallId ?? "")}">
           <i class="fa fa-check-circle" aria-hidden="true"></i> Marker hall som Klar
         </button>`;
    return `
      <div class="box box-info" data-marker="spill1-agent-controls">
        <div class="box-header with-border">
          <h3 class="box-title">Klar-status for din hall</h3>
        </div>
        <div class="box-body">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <span>Hall-status:</span> ${statusPill}
          </div>
          ${buttonHtml}
          <p class="text-muted small" style="margin-top:12px;">
            <i class="fa fa-info-circle" aria-hidden="true"></i>
            Master-hallen (<code>${escapeHtml(currentGame.masterHallId)}</code>) kan starte spillet
            når alle deltakende haller har trykket Klar.
          </p>
        </div>
      </div>`;
  }

  // 2026-05-03 (Tobias UX): master kan starte under scheduled / purchase_open /
  // ready_to_start uavhengig av om alle haller er klare. Backend's
  // confirmUnreadyHalls-flow ekskluderer ikke-klare haller automatisk.
  const canStart =
    currentGame.status === "scheduled" ||
    currentGame.status === "ready_to_start" ||
    currentGame.status === "purchase_open";
  const canResume = currentGame.status === "paused";
  const excludedNotice =
    excludedHallIds.length > 0
      ? `<p class="text-muted small" data-marker="spill1-excluded-notice">
           <i class="fa fa-warning" aria-hidden="true"></i>
           Ekskluderte haller som må bekreftes: <code>${excludedHallIds
             .map((h) => escapeHtml(h))
             .join(", ")}</code>
         </p>`
      : "";
  return `
    <div class="box box-primary" data-marker="spill1-agent-controls">
      <div class="box-header with-border">
        <h3 class="box-title">Spill 1 master-handlinger</h3>
      </div>
      <div class="box-body">
        <div class="btn-group" role="group" style="gap:8px;">
          <button class="btn btn-success"
                  data-action="spill1-start"
                  data-marker="spill1-start-btn"
                  data-game-id="${escapeHtml(currentGame.id)}"
                  ${canStart ? "" : "disabled"}>
            <i class="fa fa-play" aria-hidden="true"></i> Start Spill 1
          </button>
          <button class="btn btn-info"
                  data-action="spill1-resume"
                  data-marker="spill1-resume-btn"
                  data-game-id="${escapeHtml(currentGame.id)}"
                  ${canResume ? "" : "disabled"}>
            <i class="fa fa-play" aria-hidden="true"></i> Resume
          </button>
        </div>
        ${excludedNotice}
        <p class="text-muted small" style="margin-top:12px;">
          Start-knappen blir aktiv når alle deltakende haller har trykket "Klar" (eller master har ekskludert
          ikke-klare haller).
        </p>
      </div>
    </div>`;
}

export const __test = {
  renderSpill1AgentControls,
};
