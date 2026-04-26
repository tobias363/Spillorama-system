/**
 * TASK HS: scan-panel for agent/bingovert.
 *
 * Flyt:
 *   1. Start-scan (før salg) — skann første bong øverst i bunken
 *   2. (Agent selger bonger)
 *   3. Slutt-scan (etter salg) — skann neste usolgte bong
 *   4. Bekreft Klar (markReady)
 *
 * Panelet eier sin egen state og rendrer i tre steg basert på
 * `lastHallStatus`. Hallen kan være i én av disse UI-tilstandene:
 *
 *   a) Ingen start-scan lagret            → vis start-scan-input
 *   b) Start-scan + ingen final-scan      → vis pending-state + final-input
 *   c) Final-scan gjort + !readyConfirmed → vis "Klar"-knapp
 *   d) Ready-confirmed                    → vis grønn badge + solgt-range
 *
 * Kalles fra NextGamePanel.ts eller tilsvarende vert-container med
 * `mountGame1ScanPanel(container, {gameId, hallId})`.
 */

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  fetchGame1HallStatus,
  recordGame1StartScan,
  recordGame1FinalScan,
  type Game1HallStatus,
} from "../../api/admin-game1-master.js";
import { apiRequest } from "../../api/client.js";

const POLL_INTERVAL_MS = 5_000;

interface Game1ReadyResponse {
  gameId: string;
  hallId: string;
  isReady: boolean;
  digitalSold: number;
  physicalSold: number;
}

async function markHallReady(
  gameId: string,
  hallId: string
): Promise<Game1ReadyResponse> {
  return apiRequest<Game1ReadyResponse>(
    `/api/admin/game1/halls/${encodeURIComponent(hallId)}/ready`,
    { method: "POST", auth: true, body: { gameId } }
  );
}

export interface Game1ScanPanelOptions {
  gameId: string;
  hallId: string;
}

interface PanelState {
  hallStatus: Game1HallStatus | null;
  error: string | null;
  busy: boolean;
}

const panelStates = new WeakMap<HTMLElement, PanelState>();
const panelPollers = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>();
const panelOpts = new WeakMap<HTMLElement, Game1ScanPanelOptions>();

export function mountGame1ScanPanel(
  container: HTMLElement,
  opts: Game1ScanPanelOptions
): void {
  unmountGame1ScanPanel(container);
  panelStates.set(container, { hallStatus: null, error: null, busy: false });
  panelOpts.set(container, opts);
  void refreshPanel(container);
  const poller = setInterval(() => {
    void refreshPanel(container);
  }, POLL_INTERVAL_MS);
  panelPollers.set(container, poller);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      unmountGame1ScanPanel(container);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function unmountGame1ScanPanel(container: HTMLElement): void {
  const poller = panelPollers.get(container);
  if (poller) {
    clearInterval(poller);
    panelPollers.delete(container);
  }
  panelStates.delete(container);
  panelOpts.delete(container);
}

async function refreshPanel(container: HTMLElement): Promise<void> {
  const opts = panelOpts.get(container);
  const state = panelStates.get(container);
  if (!opts || !state) return;
  try {
    const resp = await fetchGame1HallStatus(opts.gameId);
    const hallStatus = resp.halls.find((h) => h.hallId === opts.hallId) ?? null;
    state.hallStatus = hallStatus;
    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderPanel(container);
}

function renderPanel(container: HTMLElement): void {
  const state = panelStates.get(container);
  const opts = panelOpts.get(container);
  if (!state || !opts) return;

  const status = state.hallStatus;
  const errorHtml = state.error
    ? `<div class="alert alert-danger" data-marker="scan-error">${escapeHtml(state.error)}</div>`
    : "";

  const statusBadgeHtml = status
    ? `<div data-marker="agent-scan-status-badge" style="margin-bottom:12px;">
         ${renderTrafficLight(status)}
         <small class="text-muted">${escapeHtml(hallStatusSubtitle(status))}</small>
       </div>`
    : "";

  const scanBody = status ? renderScanBody(status) : renderLoading();

  container.innerHTML = `
    <div class="box box-default" data-marker="agent-scan-panel">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_ng_scan_title"))}</h3>
      </div>
      <div class="box-body">
        ${errorHtml}
        ${statusBadgeHtml}
        ${scanBody}
      </div>
    </div>`;

  wireEvents(container);
}

function renderLoading(): string {
  return `<p class="text-muted"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> ...</p>`;
}

function renderScanBody(status: Game1HallStatus): string {
  // Steg a: ingen start-scan
  if (!status.startScanDone) {
    return `
      <p>${escapeHtml(t("agent_ng_scan_start_prompt"))}</p>
      <small class="text-muted">${escapeHtml(t("agent_ng_scan_start_hint"))}</small>
      <div class="form-group" style="margin-top:12px;">
        <input type="text" class="form-control" id="agent-scan-start-input"
               data-marker="scan-start-input"
               placeholder="Bong-ID"
               autocomplete="off">
      </div>
      <button class="btn btn-primary" data-action="scan-start"
              data-marker="scan-start-button">
        <i class="fa fa-barcode" aria-hidden="true"></i> ${escapeHtml(t("agent_ng_scan_start_button"))}
      </button>`;
  }

  // Steg b: start gjort, ingen final
  if (!status.finalScanDone) {
    return `
      <div class="alert alert-info" data-marker="scan-pending-final">
        <strong>${escapeHtml(t("agent_ng_scan_start_label"))}:</strong>
        <code>${escapeHtml(status.startTicketId ?? "")}</code>
        <br>
        <small>${escapeHtml(t("agent_ng_scan_selling_body"))}</small>
      </div>
      <p>${escapeHtml(t("agent_ng_scan_final_prompt"))}</p>
      <small class="text-muted">${escapeHtml(t("agent_ng_scan_final_hint"))}</small>
      <div class="form-group" style="margin-top:12px;">
        <input type="text" class="form-control" id="agent-scan-final-input"
               data-marker="scan-final-input"
               placeholder="Bong-ID"
               autocomplete="off">
      </div>
      <button class="btn btn-primary" data-action="scan-final"
              data-marker="scan-final-button">
        <i class="fa fa-barcode" aria-hidden="true"></i> ${escapeHtml(t("agent_ng_scan_final_button"))}
      </button>`;
  }

  // Steg c: alt scannet, ikke klar enda
  if (!status.readyConfirmed) {
    return `
      <div class="alert alert-success" data-marker="scan-range-info">
        <strong>${escapeHtml(t("agent_ng_scan_range_label"))}:</strong>
        ${escapeHtml(formatRange(status))}
        (${status.soldCount} ${escapeHtml(t("game1_master_hall_sold_suffix"))})
      </div>
      <p>${escapeHtml(t("agent_ng_scan_ready_hint"))}</p>
      <button class="btn btn-success btn-lg" data-action="mark-ready"
              data-marker="scan-mark-ready-button">
        <i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("agent_ng_scan_mark_ready"))}
      </button>`;
  }

  // Steg d: grønn — alt klart
  return `
    <div class="alert alert-success" data-marker="scan-ready-done">
      <i class="fa fa-check-circle" aria-hidden="true"></i>
      <strong>${escapeHtml(t("agent_ng_status_green"))}</strong>
      <br>
      <small>${escapeHtml(t("agent_ng_scan_range_label"))}:
        ${escapeHtml(formatRange(status))}
        (${status.soldCount} ${escapeHtml(t("game1_master_hall_sold_suffix"))})</small>
    </div>`;
}

function renderTrafficLight(status: Game1HallStatus): string {
  if (status.excludedFromGame) {
    return `<span class="label label-default">⚫ ekskludert</span>`;
  }
  switch (status.color) {
    case "red":
      return `<span class="label label-danger" data-marker="agent-status-red">🔴 ${escapeHtml(
        t("agent_ng_status_red")
      )}</span>`;
    case "orange":
      return `<span class="label label-warning" data-marker="agent-status-orange">🟠 ${escapeHtml(
        t("agent_ng_status_orange")
      )}</span>`;
    case "green":
      return `<span class="label label-success" data-marker="agent-status-green">🟢 ${escapeHtml(
        t("agent_ng_status_green")
      )}</span>`;
  }
}

function hallStatusSubtitle(status: Game1HallStatus): string {
  return ` ${status.playerCount} ${t("game1_master_players")}`;
}

function formatRange(status: Game1HallStatus): string {
  if (!status.startTicketId || !status.finalScanTicketId) return "—";
  const startNum = Number(status.startTicketId);
  const finalNum = Number(status.finalScanTicketId);
  if (Number.isFinite(startNum) && Number.isFinite(finalNum) && finalNum > startNum) {
    return `#${status.startTicketId} — #${finalNum - 1}`;
  }
  return `${status.startTicketId} — ${status.finalScanTicketId}`;
}

function wireEvents(container: HTMLElement): void {
  container
    .querySelector<HTMLButtonElement>('[data-action="scan-start"]')
    ?.addEventListener("click", () => {
      void onScanStart(container);
    });
  container
    .querySelector<HTMLButtonElement>('[data-action="scan-final"]')
    ?.addEventListener("click", () => {
      void onScanFinal(container);
    });
  container
    .querySelector<HTMLButtonElement>('[data-action="mark-ready"]')
    ?.addEventListener("click", () => {
      void onMarkReady(container);
    });

  // Enter i input-felt trigger scan
  container
    .querySelector<HTMLInputElement>("#agent-scan-start-input")
    ?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void onScanStart(container);
      }
    });
  container
    .querySelector<HTMLInputElement>("#agent-scan-final-input")
    ?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void onScanFinal(container);
      }
    });
}

async function onScanStart(container: HTMLElement): Promise<void> {
  const opts = panelOpts.get(container);
  const state = panelStates.get(container);
  if (!opts || !state || state.busy) return;
  const input = container.querySelector<HTMLInputElement>(
    "#agent-scan-start-input"
  );
  const ticketId = input?.value.trim() ?? "";
  if (!ticketId) {
    Toast.warning(t("agent_ng_scan_start_prompt"));
    return;
  }
  state.busy = true;
  try {
    await recordGame1StartScan(opts.gameId, opts.hallId, ticketId);
    Toast.success(t("agent_ng_scan_start_ok"));
    await refreshPanel(container);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  } finally {
    state.busy = false;
  }
}

async function onScanFinal(container: HTMLElement): Promise<void> {
  const opts = panelOpts.get(container);
  const state = panelStates.get(container);
  if (!opts || !state || state.busy) return;
  const input = container.querySelector<HTMLInputElement>(
    "#agent-scan-final-input"
  );
  const ticketId = input?.value.trim() ?? "";
  if (!ticketId) {
    Toast.warning(t("agent_ng_scan_final_prompt"));
    return;
  }
  state.busy = true;
  try {
    await recordGame1FinalScan(opts.gameId, opts.hallId, ticketId);
    Toast.success(t("agent_ng_scan_final_ok"));
    await refreshPanel(container);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  } finally {
    state.busy = false;
  }
}

async function onMarkReady(container: HTMLElement): Promise<void> {
  const opts = panelOpts.get(container);
  const state = panelStates.get(container);
  if (!opts || !state || state.busy) return;
  state.busy = true;
  try {
    await markHallReady(opts.gameId, opts.hallId);
    Toast.success(t("agent_ng_scan_mark_ready_ok"));
    await refreshPanel(container);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  } finally {
    state.busy = false;
  }
}

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

// Test-only exports
export const __test = {
  renderPanel,
  renderScanBody,
  hallStatusSubtitle,
  formatRange,
  panelStates,
  panelOpts,
};
