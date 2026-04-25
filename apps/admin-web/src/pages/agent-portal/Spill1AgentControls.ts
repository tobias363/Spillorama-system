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

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!)
  );
}

export interface Spill1AgentControlsProps {
  currentGame: Spill1CurrentGame;
  isMasterAgent: boolean;
  allReady: boolean;
  excludedHallIds: string[];
}

export function renderSpill1AgentControls(
  props: Spill1AgentControlsProps
): string {
  const { currentGame, isMasterAgent, allReady, excludedHallIds } = props;

  if (!isMasterAgent) {
    return `
      <div class="box box-default" data-marker="spill1-agent-controls">
        <div class="box-header with-border">
          <h3 class="box-title">Handlinger</h3>
        </div>
        <div class="box-body">
          <p class="text-muted" data-marker="spill1-slave-notice">
            <i class="fa fa-info-circle"></i>
            Din hall er deltaker i runden. Kun master-hallen (<code>${escapeHtml(currentGame.masterHallId)}</code>)
            kan starte, pause, resume eller stoppe spillet.
          </p>
        </div>
      </div>`;
  }

  const canStart =
    currentGame.status === "ready_to_start" ||
    (currentGame.status === "purchase_open" && allReady);
  const canResume = currentGame.status === "paused";
  const excludedNotice =
    excludedHallIds.length > 0
      ? `<p class="text-muted small" data-marker="spill1-excluded-notice">
           <i class="fa fa-warning"></i>
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
            <i class="fa fa-play"></i> Start Spill 1
          </button>
          <button class="btn btn-info"
                  data-action="spill1-resume"
                  data-marker="spill1-resume-btn"
                  data-game-id="${escapeHtml(currentGame.id)}"
                  ${canResume ? "" : "disabled"}>
            <i class="fa fa-play"></i> Resume
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
