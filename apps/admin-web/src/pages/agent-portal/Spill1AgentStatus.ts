/**
 * Task 1.4 (2026-04-24): Spill 1 agent-status-komponent.
 *
 * Isolerer render-logikken for den Spill 1-spesifikke state-visningen i
 * agent-portalen. Bruker samme data-kontrakt som master-konsollet
 * (current-game fra `/api/agent/game1/current-game`) og matcher
 * hall-status-stripen fra TV #457 når den er tilgjengelig.
 *
 * Import-bar fra `NextGamePanel.ts` slik at agent-portalen velger render
 * dynamisk: hvis agentens hall har et aktivt Spill 1 scheduled_game,
 * rendrer vi Spill1-vinduet; ellers faller vi tilbake til room-code-
 * basert view for Spill 2/3 (uendret pre-Task 1.4-flyt).
 */

import type {
  Spill1CurrentGame,
  Spill1CurrentGameHall,
} from "../../api/agent-game1.js";

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

function statusBadge(status: string): string {
  const cls = (() => {
    switch (status) {
      case "running":
        return "label-success";
      case "ready_to_start":
        return "label-info";
      case "paused":
        return "label-warning";
      case "cancelled":
      case "completed":
        return "label-default";
      default:
        return "label-primary";
    }
  })();
  return `<span class="label ${cls}" data-field="spill1-status-badge">${escapeHtml(status)}</span>`;
}

function hallStatusDot(h: Spill1CurrentGameHall): string {
  // Fargekode: grønn = klar, gul = venter, grå = ekskludert.
  const color = h.excludedFromGame
    ? "#aaa"
    : h.isReady
    ? "#5cb85c"
    : "#f0ad4e";
  const title = h.excludedFromGame
    ? `${h.hallName} — ekskludert${h.excludedReason ? `: ${h.excludedReason}` : ""}`
    : h.isReady
    ? `${h.hallName} — klar`
    : `${h.hallName} — venter`;
  return `<span
    class="spill1-hall-dot"
    data-hall-id="${escapeHtml(h.hallId)}"
    data-ready="${h.isReady ? "1" : "0"}"
    data-excluded="${h.excludedFromGame ? "1" : "0"}"
    title="${escapeHtml(title)}"
    style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"
  ></span>`;
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("no");
  } catch {
    return iso;
  }
}

export interface Spill1AgentStatusProps {
  currentGame: Spill1CurrentGame;
  halls: Spill1CurrentGameHall[];
  hallId: string;
  isMasterAgent: boolean;
  allReady: boolean;
}

export function renderSpill1AgentStatus(
  props: Spill1AgentStatusProps
): string {
  const { currentGame, halls, hallId, isMasterAgent, allReady } = props;
  const name = currentGame.customGameName ?? currentGame.subGameName;
  const displayName = escapeHtml(name);
  const roleLabel = isMasterAgent
    ? `<span class="label label-primary" data-marker="spill1-role-master" style="margin-left:6px;">Master-hall</span>`
    : `<span class="label label-default" data-marker="spill1-role-slave" style="margin-left:6px;">Deltaker-hall</span>`;
  const hallDots = halls
    .map(
      (h) =>
        `${hallStatusDot(h)}<small data-hall-id="${escapeHtml(h.hallId)}">${escapeHtml(
          h.hallName
        )}</small>`
    )
    .join(" &nbsp; ");
  const allReadyBadge = allReady
    ? `<span class="label label-success" data-marker="spill1-all-ready">ALLE KLARE</span>`
    : `<span class="label label-warning" data-marker="spill1-some-waiting">VENTER</span>`;
  return `
    <div class="box box-primary" data-marker="spill1-agent-status">
      <div class="box-header with-border">
        <h3 class="box-title">Spill 1 — ${displayName}${roleLabel}</h3>
        <div class="box-tools pull-right">${allReadyBadge}</div>
      </div>
      <div class="box-body">
        <table class="table table-condensed" style="margin-bottom:8px;">
          <tbody>
            <tr>
              <td style="width:180px;">Status</td>
              <td data-field="spill1-status">${statusBadge(currentGame.status)}</td>
            </tr>
            <tr>
              <td>Spill-ID</td>
              <td><small><code data-field="spill1-game-id">${escapeHtml(currentGame.id)}</code></small></td>
            </tr>
            <tr>
              <td>Master-hall</td>
              <td>
                <code data-field="spill1-master-hall-id">${escapeHtml(currentGame.masterHallId)}</code>
                ${currentGame.masterHallId === hallId ? " (deg)" : ""}
              </td>
            </tr>
            <tr>
              <td>Planlagt start</td>
              <td data-field="spill1-scheduled-start">${escapeHtml(formatIso(currentGame.scheduledStartTime))}</td>
            </tr>
            <tr>
              <td>Faktisk start</td>
              <td data-field="spill1-actual-start">${escapeHtml(formatIso(currentGame.actualStartTime))}</td>
            </tr>
          </tbody>
        </table>
        <div data-marker="spill1-hall-stripe" style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">
          <small class="text-muted" style="margin-right:8px;">Deltakende haller:</small>
          ${hallDots || '<small class="text-muted">—</small>'}
        </div>
      </div>
    </div>`;
}

// Test-only API-re-exports (så tester kan asserte DOM-struktur).
export const __test = {
  renderSpill1AgentStatus,
};
