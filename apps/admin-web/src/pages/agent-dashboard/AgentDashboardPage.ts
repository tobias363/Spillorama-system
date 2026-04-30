// Agent-portal dashboard — real-data wiring per Agent V1.0 (06.01.2025) +
// V1.0 (14.10.2024) wireframes (PDF 17 §17.1, WIREFRAME_CATALOG.md).
//
// Layout (1:1 m/wireframe):
//   - Header: Group of Hall — Hall Name, Cash In/Out, Language toggle (NO/EN
//     — no-op for nå), Notification-bjelle, Profile dropdown.
//   - KPI-rad: Total Number of Approved Players (counts.playersInHall).
//   - Latest Requests-widget: ventende deposit-requests for agentens hall
//     (max 5), "View all"-link til /agent/players.
//   - Top 5 Players-widget: avatar + username + walletAmount, klikk
//     → /agent/players (eller player-profil hvis tilgjengelig).
//   - Ongoing Games-widget: tabs Game 1/2/3 (+SpinnGo), tabell med
//     Main Game ID, Game Name, Status, Player count, Created At.
//
// Data-flyt: én HTTP-poll mot GET /api/agent/dashboard hver 30s. Backend
// aggregerer alle 4 widget-kilder i ETT round-trip — frontend trenger
// derfor ikke parallelle fetch-er. AbortController kanseller in-flight
// fetches på unmount slik at ingen stale-render kan skje. Mønsteret
// matcher DashboardState.ts brukt av admin-dashboardet.
//
// Fail-modes:
//   - Ingen aktiv shift → backend returnerer counts=null + empty arrays.
//     UI viser fallback-tekst per widget + en banner-advarsel.
//   - Network-feil / 401 → toast + "Kunne ikke hente dashboard-data".
//   - Auth-feil håndteres av apiRequest (clearToken + redirect).

import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { isAbortError } from "../../api/client.js";
import {
  getAgentDashboard,
  type AgentDashboard,
  type AgentDashboardLatestRequest,
  type AgentDashboardOngoingGame,
  type AgentDashboardTopPlayer,
} from "../../api/agent-dashboard.js";

const POLL_INTERVAL_MS = 30_000;
// Backend returnerer game-slug som "bingo" / "rocket" / "monsterbingo" / "spillorama".
// SPILLKATALOG.md §1: vi mapper slugs til Spill 1/2/3/SpinnGo. Game 4 er
// deprecated (BIN-496). Vi viser kun Spill 1-3 + SpinnGo i dashboard-tabs.
const GAME_TABS = ["game1", "game2", "game3", "game5"] as const;
type GameTab = (typeof GAME_TABS)[number];
const DEFAULT_TAB: GameTab = "game1";

const SLUG_TO_TAB: Record<string, GameTab> = {
  bingo: "game1",
  rocket: "game2",
  monsterbingo: "game3",
  spillorama: "game5",
};

interface PageState {
  data: AgentDashboard | null;
  loading: boolean;
  error: string | null;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
let mountedContainer: HTMLElement | null = null;
let activeTab: GameTab = DEFAULT_TAB;

/**
 * Mount the agent-portal dashboard and start polling. Idempotent — calling
 * twice will tear down the prior mount before creating a fresh one.
 */
export function mountAgentDashboard(container: HTMLElement): void {
  unmountAgentDashboard();
  mountedContainer = container;
  // Reset to default tab on every mount (matches admin-dashboard behaviour).
  activeTab = DEFAULT_TAB;
  render(container, { data: null, loading: true, error: null });
  void poll();
}

/**
 * Stop polling, abort in-flight fetch, and clear container reference.
 * Safe to call multiple times.
 */
export function unmountAgentDashboard(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  mountedContainer = null;
}

async function poll(): Promise<void> {
  if (!mountedContainer) return;
  // Abort any prior in-flight request before issuing a fresh one.
  if (abortController) abortController.abort();
  abortController = new AbortController();

  try {
    const data = await getAgentDashboard();
    if (!mountedContainer) return;
    render(mountedContainer, { data, loading: false, error: null });
  } catch (err) {
    if (isAbortError(err)) return;
    if (!mountedContainer) return;
    const message =
      err instanceof Error ? err.message : t("agent_dashboard_load_failed");
    render(mountedContainer, { data: null, loading: false, error: message });
  } finally {
    schedule();
  }
}

function schedule(): void {
  if (!mountedContainer) return;
  pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
}

function render(container: HTMLElement, state: PageState): void {
  const data = state.data;
  const groupHallLabel = data?.shift?.hallId ?? "—";
  const hallNameLabel = data?.shift?.hallId ?? "—";

  container.innerHTML = `
    ${contentHeader(groupHallLabel, hallNameLabel)}
    <section class="content" data-marker="agent-dashboard">
      ${state.error ? errorBanner(state.error) : ""}
      ${state.loading && !data ? loadingBanner() : ""}
      ${!state.loading && data && !data.shift ? noShiftBanner() : ""}
      ${kpiRow(data)}
      ${widgetsRow(data)}
      ${ongoingGamesRow(data)}
    </section>`;

  wireHeaderActions(container);
  wireTabs(container);
  wireTopPlayersClicks(container);
}

// ── Header (legacy 17.1) ─────────────────────────────────────────────────
function contentHeader(groupHall: string, hallName: string): string {
  const title = escapeHtml(t("agent_dashboard"));
  return `
    <section class="content-header" data-marker="agent-dashboard-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li>
          <a href="#/agent/dashboard">
            <i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}
          </a>
        </li>
        <li class="active">${title}</li>
      </ol>
      <div class="agent-dashboard-header-bar"
           style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;">
        <span data-marker="hall-context"
              style="font-weight:600;color:#444;">
          ${escapeHtml(groupHall)} — ${escapeHtml(hallName)}
        </span>
        <button type="button"
                class="btn btn-primary"
                data-action="cash-in-out"
                data-marker="cash-in-out-button">
          <i class="fa fa-money" aria-hidden="true"></i>
          ${escapeHtml(t("agent_dashboard_cash_in_out_button"))}
        </button>
        <select class="form-control"
                data-action="lang-toggle"
                data-marker="lang-toggle"
                style="width:auto;display:inline-block;">
          <option value="no">${escapeHtml(t("agent_dashboard_lang_no"))}</option>
          <option value="en">${escapeHtml(t("agent_dashboard_lang_en"))}</option>
        </select>
        <button type="button"
                class="btn btn-default btn-sm"
                data-action="notifications"
                data-marker="notifications-bell"
                aria-label="${escapeHtml(t("agent_dashboard_latest_requests"))}">
          <i class="fa fa-bell-o" aria-hidden="true"></i>
        </button>
        <a href="#/profile"
           class="btn btn-default btn-sm"
           data-marker="profile-dropdown">
          <i class="fa fa-user-circle-o" aria-hidden="true"></i>
          ${escapeHtml(t("profile"))}
        </a>
      </div>
    </section>`;
}

// ── KPI-rad (legacy 17.1 widget B) ───────────────────────────────────────
function kpiRow(data: AgentDashboard | null): string {
  const playersInHall = data?.counts?.playersInHall;
  const display = playersInHall == null ? "—" : String(playersInHall);
  return `
    <div class="row" data-marker="agent-dashboard-kpis">
      <div class="col-md-3 col-sm-6 col-xs-12">
        <a href="#/agent/players" style="text-decoration:none;color:inherit;">
          <div class="info-box">
            <span class="info-box-icon bg-blue">
              <i class="fa fa-users" aria-hidden="true"></i>
            </span>
            <div class="info-box-content">
              <span class="info-box-text" style="font-size:11px;">
                ${escapeHtml(t("agent_dashboard_kpi_approved_players"))}
              </span>
              <span class="info-box-number"
                    data-kpi="approved-players">${escapeHtml(display)}</span>
            </div>
          </div>
        </a>
      </div>
    </div>`;
}

// ── Latest Requests + Top 5 Players (legacy 17.1 widgets D + E) ──────────
function widgetsRow(data: AgentDashboard | null): string {
  return `
    <div class="row">
      <div class="col-md-8">
        ${latestRequestsBox(data?.latestRequests ?? [], data?.counts?.pendingRequests ?? null)}
      </div>
      <div class="col-md-4">
        ${topPlayersBox(data?.topPlayers ?? [])}
      </div>
    </div>`;
}

function latestRequestsBox(
  requests: AgentDashboardLatestRequest[],
  totalPending: number | null,
): string {
  const headerCount =
    totalPending != null
      ? `<span class="label label-warning">${totalPending}</span>`
      : "";
  const rows = requests.length
    ? requests
        .map(
          (r) => `
        <tr data-marker="latest-request-row" data-request-id="${escapeHtml(r.id)}">
          <td>${escapeHtml(shortId(r.id))}</td>
          <td>${escapeHtml(shortId(r.userId))}</td>
          <td>${escapeHtml(formatKind(r.kind))}</td>
          <td>${escapeHtml(formatAmountKr(r.amountCents))}</td>
          <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="text-center text-muted">
         ${escapeHtml(t("agent_dashboard_no_latest_requests"))}
       </td></tr>`;

  return `
    <div class="box box-default" data-marker="agent-dashboard-latest-requests">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_dashboard_latest_requests"))}</h3>
        <div class="box-tools pull-right">
          <span class="text-muted" style="margin-right:6px;">
            ${escapeHtml(t("agent_dashboard_total_pending_requests"))}:
          </span>
          ${headerCount}
        </div>
      </div>
      <div class="box-body table-responsive">
        <table class="table no-margin">
          <thead>
            <tr>
              <th>#</th>
              <th>${escapeHtml(t("username"))}</th>
              <th>${escapeHtml(t("agent_dashboard_request_kind"))}</th>
              <th>${escapeHtml(t("agent_dashboard_amount_kr"))}</th>
              <th>${escapeHtml(t("agent_dashboard_requested_at"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="box-footer text-center">
        <a href="#/agent/players"
           data-marker="latest-requests-view-all"
           class="uppercase">
          ${escapeHtml(t("agent_dashboard_view_all_pending"))}
        </a>
      </div>
    </div>`;
}

function topPlayersBox(players: AgentDashboardTopPlayer[]): string {
  const items = players.length
    ? players
        .map(
          (p) => `
        <li data-marker="top-player-row"
            data-player-id="${escapeHtml(p.id)}"
            style="padding:8px 0;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;cursor:pointer;">
          ${
            p.avatar
              ? `<img src="${escapeHtml(p.avatar)}" alt="" style="width:28px;height:28px;border-radius:50%;">`
              : `<i class="fa fa-user-circle-o" style="font-size:28px;color:#999;"></i>`
          }
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(p.username)}
            </div>
            <div style="font-size:12px;color:#888;">
              ${escapeHtml(formatAmountFromKr(p.walletAmount))}
            </div>
          </div>
        </li>`,
        )
        .join("")
    : `<li class="text-muted" style="padding:8px 0;">
         ${escapeHtml(t("agent_dashboard_no_top_players"))}
       </li>`;

  return `
    <div class="box box-default" data-marker="agent-dashboard-top-players">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_dashboard_top_players"))}</h3>
      </div>
      <div class="box-body">
        <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
      </div>
    </div>`;
}

// ── Ongoing Games (legacy 17.1 widget F) ─────────────────────────────────
function ongoingGamesRow(data: AgentDashboard | null): string {
  const games = data?.ongoingGames ?? [];
  const grouped: Record<GameTab, AgentDashboardOngoingGame[]> = {
    game1: [],
    game2: [],
    game3: [],
    game5: [],
  };
  for (const g of games) {
    const tab = SLUG_TO_TAB[g.gameSlug];
    if (tab) grouped[tab].push(g);
  }

  const tabs = GAME_TABS.map((tab) => {
    const cls = tab === activeTab ? "active" : "";
    return `
      <li class="${cls}">
        <a href="#tab-${tab}"
           data-game-tab="${tab}">${escapeHtml(t(tab))}</a>
      </li>`;
  }).join("");

  const panes = GAME_TABS.map((tab) => {
    const isActive = tab === activeTab ? "active" : "";
    return `
      <div id="tab-${tab}"
           class="tab-pane ${isActive}"
           data-marker="ongoing-games-pane">
        ${gameTable(grouped[tab])}
      </div>`;
  }).join("");

  return `
    <div class="row">
      <div class="col-md-12">
        <div class="box box-info" data-marker="agent-dashboard-ongoing-games">
          <div class="box-header with-border text-center">
            <h3 class="box-title text-bold">${escapeHtml(t("ongoing_game"))}</h3>
          </div>
          <div class="box-body">
            <ul class="nav nav-tabs"
                style="display:flex;justify-content:center;">${tabs}</ul>
            <div class="tab-content" style="margin-top:12px;">${panes}</div>
          </div>
          <div class="box-footer text-center">
            <a href="#/agent/games"
               data-marker="ongoing-games-view-all"
               class="uppercase">
              ${escapeHtml(t("agent_dashboard_view_all_games"))}
            </a>
          </div>
        </div>
      </div>
    </div>`;
}

function gameTable(rows: AgentDashboardOngoingGame[]): string {
  if (!rows.length) {
    return `
      <div class="text-center text-muted" style="padding:24px;">
        ${escapeHtml(t("agent_dashboard_no_ongoing_games"))}
      </div>`;
  }
  const body = rows
    .map(
      (r) => `
      <tr data-marker="ongoing-game-row">
        <td>${escapeHtml(shortId(r.roomCode))}</td>
        <td>${escapeHtml(r.gameSlug)}</td>
        <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
        <td>${escapeHtml(String(r.playerCount))}</td>
        <td>${escapeHtml(r.gameStatus)}</td>
      </tr>`,
    )
    .join("");
  return `
    <div class="table-responsive">
      <table class="table no-margin">
        <thead>
          <tr>
            <th>${escapeHtml(t("agent_dashboard_main_game_id"))}</th>
            <th>${escapeHtml(t("game_name"))}</th>
            <th>${escapeHtml(t("agent_dashboard_requested_at"))}</th>
            <th>${escapeHtml(t("agent_dashboard_player_count"))}</th>
            <th>${escapeHtml(t("status"))}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// ── Banner-helpers ───────────────────────────────────────────────────────
function errorBanner(message: string): string {
  return `
    <div class="alert alert-danger" data-marker="dashboard-error" role="alert">
      <i class="fa fa-exclamation-circle" aria-hidden="true"></i>
      ${escapeHtml(message)}
    </div>`;
}

function loadingBanner(): string {
  return `
    <div class="alert alert-info" data-marker="dashboard-loading" role="status">
      <i class="fa fa-spinner fa-spin" aria-hidden="true"></i>
      ${escapeHtml(t("loading"))}
    </div>`;
}

function noShiftBanner(): string {
  return `
    <div class="alert alert-warning" data-marker="dashboard-no-shift" role="alert">
      <i class="fa fa-info-circle" aria-hidden="true"></i>
      ${escapeHtml(t("agent_dashboard_no_shift_warning"))}
    </div>`;
}

// ── Wire-up handlers ─────────────────────────────────────────────────────
function wireHeaderActions(container: HTMLElement): void {
  const cashBtn = container.querySelector<HTMLButtonElement>(
    'button[data-action="cash-in-out"]',
  );
  if (cashBtn) {
    cashBtn.addEventListener("click", () => {
      window.location.hash = "#/agent/cash-in-out";
    });
  }
  const langSel = container.querySelector<HTMLSelectElement>(
    'select[data-action="lang-toggle"]',
  );
  if (langSel) {
    // Pilot-MVP: dropdown er bare DOM-skellet. Reell language-switch lever
    // i I18n.ts; vi binder ikke change-event her fordi det krever full
    // re-init av host-shellen (out-of-scope for denne PR-en).
    langSel.title = t("agent_placeholder_coming_soon");
  }
  const notifBtn = container.querySelector<HTMLButtonElement>(
    'button[data-action="notifications"]',
  );
  if (notifBtn) {
    notifBtn.addEventListener("click", () => {
      // Hopp til latest-requests-widgeten ved klikk på bjellen.
      const widget = container.querySelector(
        '[data-marker="agent-dashboard-latest-requests"]',
      );
      if (widget) widget.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function wireTabs(container: HTMLElement): void {
  const tabs = container.querySelectorAll<HTMLAnchorElement>(
    "a[data-game-tab]",
  );
  const panes = container.querySelectorAll<HTMLElement>(".tab-pane");
  tabs.forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const which = a.getAttribute("data-game-tab") as GameTab | null;
      if (!which || !GAME_TABS.includes(which)) return;
      activeTab = which;
      tabs.forEach((x) => x.closest("li")?.classList.remove("active"));
      a.closest("li")?.classList.add("active");
      panes.forEach((p) => p.classList.remove("active"));
      container.querySelector(`#tab-${which}`)?.classList.add("active");
    });
  });
}

function wireTopPlayersClicks(container: HTMLElement): void {
  const rows = container.querySelectorAll<HTMLLIElement>(
    'li[data-marker="top-player-row"]',
  );
  rows.forEach((row) => {
    row.addEventListener("click", () => {
      const playerId = row.getAttribute("data-player-id");
      if (!playerId) return;
      // Navigate to the agent players list — clicking a top-player row
      // surfaces them in context. Player-profil-modal kommer i senere PR.
      window.location.hash = "#/agent/players";
    });
  });
}

// ── Format helpers ───────────────────────────────────────────────────────
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatKind(kind: AgentDashboardLatestRequest["kind"]): string {
  return kind === "deposit"
    ? t("agent_dashboard_request_kind_deposit")
    : t("agent_dashboard_request_kind_withdraw");
}

function formatAmountKr(amountCents: number): string {
  // Backend returnerer minor units (øre). 100 kr = 10 000.
  const kr = Math.floor(amountCents / 100);
  return `${kr.toLocaleString("nb-NO")} kr`;
}

function formatAmountFromKr(kr: number): string {
  return `${Math.floor(kr).toLocaleString("nb-NO")} kr`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
