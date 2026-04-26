// Agent-portal skeleton-dashboard per Agent V1.0 (06.01.2025) + V2.0 wireframes.
//
// Skjelett-strukturen i denne PR-en:
//   - KPI-boks ("Total Number of Approved Players") — dummy-tall inntil
//     backend-integrasjon fylles inn i oppfølger-PR
//   - Latest Requests-widget — placeholder med 5 rader dummy-data
//   - Top 5 Players-widget — placeholder med 5 avatarer
//   - Ongoing Games tabs (Game 1/2/3/4) — placeholder-bokser "Kommer snart"
//
// Den tidligere shift-info-varianten (med polling mot /api/agent/dashboard)
// er flyttet til /agent/cashinout-flyten som del av Cash In/Out Management —
// shift-info hører hjemme der per legacy V1.0.

import { t } from "../../i18n/I18n.js";

const GAME_TABS = ["game1", "game2", "game3", "game4"] as const;
type GameTab = (typeof GAME_TABS)[number];
const DEFAULT_TAB: GameTab = "game1";

/**
 * Mount the agent-portal skeleton-dashboard. Idempotent — safe to call on
 * route re-entry. Unmount is a no-op (no timers, no listeners beyond tab-
 * clicks which the renderer cleans up via DOM re-creation).
 */
export function mountAgentDashboard(container: HTMLElement): void {
  unmountAgentDashboard();
  render(container);
}

/**
 * Retained for backwards-compat with main.ts which called this on route-
 * leave. The new skeleton-dashboard has no polling / timers, so this is a
 * no-op; we keep the symbol so legacy callers don't break.
 */
export function unmountAgentDashboard(): void {
  // no-op — skeleton has no timers to clear
}

function render(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader()}
    <section class="content" data-marker="agent-dashboard">
      ${kpiRow()}
      ${widgetsRow()}
      ${ongoingGamesRow()}
    </section>`;
  wireTabs(container);
}

function contentHeader(): string {
  const title = escapeHtml(t("agent_dashboard"));
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${title}</li>
      </ol>
    </section>`;
}

// ── KPI-row (per legacy Agent V1.0 "Total Number of Approved Players: 250") ──
function kpiRow(): string {
  return `
    <div class="row" data-marker="agent-dashboard-kpis">
      <div class="col-md-3 col-sm-6 col-xs-12">
        <a href="#/agent/players" style="text-decoration:none;color:inherit;">
          <div class="info-box">
            <span class="info-box-icon bg-blue"><i class="fa fa-users" aria-hidden="true"></i></span>
            <div class="info-box-content">
              <span class="info-box-text" style="font-size:11px;">
                ${escapeHtml(t("agent_dashboard_kpi_approved_players"))}
              </span>
              <span class="info-box-number" data-kpi="approved-players">250</span>
            </div>
          </div>
        </a>
      </div>
    </div>`;
}

// ── Latest Requests + Top 5 Players (placeholders med dummy-rader) ──
function widgetsRow(): string {
  return `
    <div class="row">
      <div class="col-md-8">
        ${latestRequestsBox()}
      </div>
      <div class="col-md-4">
        ${topPlayersBox()}
      </div>
    </div>`;
}

function latestRequestsBox(): string {
  const dummyRows = [1, 2, 3, 4, 5]
    .map(
      (i) => `
    <tr data-marker="latest-request-row">
      <td>#${i}</td>
      <td>${escapeHtml(t("agent_dashboard_placeholder_player"))} ${i}</td>
      <td><span class="label label-warning">${escapeHtml(t("agent_placeholder_coming_soon"))}</span></td>
      <td>—</td>
    </tr>`
    )
    .join("");
  return `
    <div class="box box-default" data-marker="agent-dashboard-latest-requests">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_dashboard_latest_requests"))}</h3>
        <div class="box-tools pull-right">
          <span class="label label-warning">${escapeHtml(t("agent_placeholder_coming_soon"))}</span>
        </div>
      </div>
      <div class="box-body table-responsive">
        <table class="table no-margin">
          <thead>
            <tr>
              <th>#</th>
              <th>${escapeHtml(t("agent_dashboard_placeholder_player"))}</th>
              <th>${escapeHtml(t("status"))}</th>
              <th>${escapeHtml(t("amount"))}</th>
            </tr>
          </thead>
          <tbody>${dummyRows}</tbody>
        </table>
      </div>
    </div>`;
}

function topPlayersBox(): string {
  const dummyAvatars = [1, 2, 3, 4, 5]
    .map(
      (i) => `
    <li data-marker="top-player-row" style="padding:6px 0;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px;">
      <i class="fa fa-user-circle-o" style="font-size:28px;color:#999;"></i>
      <span>${escapeHtml(t("agent_dashboard_placeholder_player"))} ${i}</span>
    </li>`
    )
    .join("");
  return `
    <div class="box box-default" data-marker="agent-dashboard-top-players">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_dashboard_top_players"))}</h3>
        <div class="box-tools pull-right">
          <span class="label label-warning">${escapeHtml(t("agent_placeholder_coming_soon"))}</span>
        </div>
      </div>
      <div class="box-body">
        <ul style="list-style:none;padding:0;margin:0;">${dummyAvatars}</ul>
      </div>
    </div>`;
}

// ── Ongoing Games tabs (4 tabs, alle placeholder "Kommer snart") ──
function ongoingGamesRow(): string {
  const tabs = GAME_TABS.map(
    (tab) => `
    <li class="${tab === DEFAULT_TAB ? "active" : ""}">
      <a href="#tab-${tab}" data-game-tab="${tab}">${escapeHtml(t(tab))}</a>
    </li>`
  ).join("");
  const panes = GAME_TABS.map(
    (tab) => `
    <div id="tab-${tab}" class="tab-pane ${tab === DEFAULT_TAB ? "active" : ""}" data-marker="ongoing-games-pane">
      <div class="text-center" style="padding:40px;">
        <span class="label label-warning" style="font-size:14px;">${escapeHtml(t("agent_placeholder_coming_soon"))}</span>
      </div>
    </div>`
  ).join("");
  return `
    <div class="row">
      <div class="col-md-12">
        <div class="box box-info" data-marker="agent-dashboard-ongoing-games">
          <div class="box-header with-border text-center">
            <h3 class="box-title text-bold">${escapeHtml(t("ongoing_game"))}</h3>
          </div>
          <div class="box-body">
            <ul class="nav nav-tabs" style="display:flex;justify-content:center;">${tabs}</ul>
            <div class="tab-content">${panes}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function wireTabs(container: HTMLElement): void {
  const tabs = container.querySelectorAll<HTMLAnchorElement>("a[data-game-tab]");
  const panes = container.querySelectorAll<HTMLElement>(".tab-pane");
  tabs.forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const which = a.getAttribute("data-game-tab");
      if (!which) return;
      tabs.forEach((x) => x.closest("li")?.classList.remove("active"));
      a.closest("li")?.classList.add("active");
      panes.forEach((p) => p.classList.remove("active"));
      container.querySelector(`#tab-${which}`)?.classList.add("active");
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
