// Agent dashboard-side — viser shift-info + cash-totals + nøkkeltall + siste
// transaksjoner. Treffer /api/agent/dashboard. Polling hver 15 sek slik at
// agent ser oppdatert daglig balanse etter kolleger har kjørt transaksjoner.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { getAgentDashboard, type AgentDashboard } from "../../api/agent-dashboard.js";

const POLL_MS = 15_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function mountAgentDashboard(container: HTMLElement): void {
  unmountAgentDashboard();
  container.innerHTML = skeleton();
  void refresh(container);
  pollTimer = setInterval(() => {
    if (!container.isConnected) {
      unmountAgentDashboard();
      return;
    }
    void refresh(container);
  }, POLL_MS);
}

export function unmountAgentDashboard(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function skeleton(): string {
  return `
    ${contentHeader("agent_dashboard")}
    <section class="content">
      <div class="row"><div class="col-sm-12">
        <div class="box box-default"><div class="box-body text-center">
          <i class="fa fa-spinner fa-spin fa-2x"></i><br><br>${escapeHtml(t("loading"))}
        </div></div>
      </div></div>
    </section>`;
}

async function refresh(container: HTMLElement): Promise<void> {
  try {
    const data = await getAgentDashboard();
    render(container, data);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    container.innerHTML = `
      ${contentHeader("agent_dashboard")}
      <section class="content">
        <div class="box box-danger"><div class="box-body">
          <p>${escapeHtml(msg)}</p>
        </div></div>
      </section>`;
  }
}

function render(container: HTMLElement, data: AgentDashboard): void {
  const shiftHtml = data.shift ? renderShift(data.shift) : renderNoShift();
  container.innerHTML = `
    ${contentHeader("agent_dashboard")}
    <section class="content">
      <div class="row">
        <div class="col-md-6">
          ${boxOpen("agent_dashboard_shift_info", "primary")}
            ${shiftHtml}
          ${boxClose()}
        </div>
        <div class="col-md-6">
          ${boxOpen("agent_dashboard_counts", "info")}
            <table class="table table-bordered table-striped" id="agent-dashboard-counts">
              <tbody>
                <tr><td>${escapeHtml(t("agent_dashboard_transactions_today"))}</td><td style="text-align:right;"><strong>${data.counts.transactionsToday}</strong></td></tr>
                <tr><td>${escapeHtml(t("agent_dashboard_players_in_hall"))}</td><td style="text-align:right;"><strong>${data.counts.playersInHall ?? "—"}</strong></td></tr>
                <tr><td>${escapeHtml(t("agent_dashboard_active_shifts_in_hall"))}</td><td style="text-align:right;"><strong>${data.counts.activeShiftsInHall ?? "—"}</strong></td></tr>
              </tbody>
            </table>
            <div class="muted"><small>${escapeHtml(t("agent"))}: <strong>${escapeHtml(data.agent.displayName)}</strong></small></div>
          ${boxClose()}
        </div>
      </div>
      <div class="row"><div class="col-sm-12">
        ${boxOpen("agent_dashboard_recent_transactions", "default")}
          ${renderRecent(data.recentTransactions)}
        ${boxClose()}
      </div></div>
    </section>`;
}

function renderShift(shift: NonNullable<AgentDashboard["shift"]>): string {
  return `
    <table class="table table-bordered table-striped" id="agent-dashboard-shift">
      <tbody>
        <tr><td>${escapeHtml(t("hall_name"))}</td><td style="text-align:right;">${escapeHtml(shift.hallId)}</td></tr>
        <tr><td>${escapeHtml(t("total_cash_in"))}</td><td style="text-align:right;">${formatNOK(shift.totalCashIn)}</td></tr>
        <tr><td>${escapeHtml(t("total_cash_out"))}</td><td style="text-align:right;">${formatNOK(shift.totalCashOut)}</td></tr>
        <tr><td>${escapeHtml(t("daily_balance"))}</td><td style="text-align:right;"><strong>${formatNOK(shift.dailyBalance)}</strong></td></tr>
        <tr><td>${escapeHtml(t("total_hall_cash_balance"))}</td><td style="text-align:right;">${formatNOK(shift.hallCashBalance)}</td></tr>
        <tr><td>Started at</td><td style="text-align:right;">${escapeHtml(formatDateTime(shift.startedAt))}</td></tr>
      </tbody>
    </table>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <a class="btn btn-success" href="#/agent/cashinout"><i class="fa fa-exchange"></i> ${escapeHtml(t("cash_in_out"))}</a>
      <a class="btn btn-primary" href="#/agent/players"><i class="fa fa-users"></i> ${escapeHtml(t("agent_players_title"))}</a>
    </div>`;
}

function renderNoShift(): string {
  return `
    <div class="callout callout-warning">
      <p>${escapeHtml(t("agent_dashboard_no_shift"))}</p>
      <a class="btn btn-success" href="#/agent/cashinout"><i class="fa fa-sign-in"></i> ${escapeHtml(t("agent_dashboard_start_shift"))}</a>
    </div>`;
}

function renderRecent(txs: AgentDashboard["recentTransactions"]): string {
  if (txs.length === 0) {
    return `<p class="muted">${escapeHtml(t("agent_dashboard_no_transactions"))}</p>`;
  }
  const rows = txs
    .map(
      (tx) => `
    <tr>
      <td>${escapeHtml(formatDateTime(tx.createdAt))}</td>
      <td>${escapeHtml(tx.actionType)}</td>
      <td>${escapeHtml(tx.paymentMethod)}</td>
      <td style="text-align:right;">${formatNOK(tx.amount)}</td>
      <td><small class="muted">${escapeHtml(tx.id)}</small></td>
    </tr>`
    )
    .join("");
  return `
    <table class="table table-striped">
      <thead>
        <tr>
          <th>${escapeHtml(t("date"))}</th>
          <th>${escapeHtml(t("type"))}</th>
          <th>${escapeHtml(t("payment_type"))}</th>
          <th style="text-align:right;">${escapeHtml(t("amount"))}</th>
          <th>ID</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function contentHeader(titleKey: string): string {
  const title = escapeHtml(t(titleKey));
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${title}</li>
      </ol>
    </section>`;
}

function boxOpen(titleKey: string, variant: "default" | "primary" | "info" | "danger" | "success"): string {
  return `
    <div class="box box-${variant}">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t(titleKey))}</h3>
      </div>
      <div class="box-body">`;
}

function boxClose(): string {
  return `</div></div>`;
}

function formatNOK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "00.00";
  return n.toFixed(2);
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Use Toast import to avoid "unused" error — expose for callers if needed.
void Toast;
