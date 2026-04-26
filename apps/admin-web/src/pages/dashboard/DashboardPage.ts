// Renders 4 info-boxes + 1 latest-requests table + 1 top-5-players widget +
// 1 ongoing-games tabbed table. Auto-refreshes every 10s (matches legacy-v1).

import { t } from "../../i18n/I18n.js";
import type { Session } from "../../auth/Session.js";
import { fetchDashboardData, startPolling, type DashboardData, type PollController } from "./DashboardState.js";
import { renderInfoBox } from "./widgets/InfoBox.js";
import { renderLatestRequestsBox } from "./widgets/LatestRequestsBox.js";
import { renderTopPlayersBox } from "./widgets/TopPlayersBox.js";
import { renderOngoingGamesTabs } from "./widgets/OngoingGamesTabs.js";

const REFRESH_MS = 10_000;

let activeController: PollController | null = null;
// Mount-generation marker. Incremented on every mountDashboard() call so a
// pending fetchDashboardData() promise from a previous mount can detect it has
// been replaced (or unmounted) and bail out before overwriting the DOM.
// Without this, navigating away before the initial fetch resolves lets a stale
// promise run renderAll() on a container now owned by another route.
let activeMountId = 0;

export async function mountDashboard(container: HTMLElement, session: Session): Promise<void> {
  stopActivePolling();
  const mountId = ++activeMountId;
  container.innerHTML = "";
  container.setAttribute("data-page", "dashboard");

  // Skeleton
  const skeleton = document.createElement("div");
  skeleton.className = "dashboard-skeleton";
  skeleton.innerHTML = `<div class="box box-default"><div class="box-body text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i><br><br>${escapeHtml(t("loading"))}</div></div>`;
  container.append(skeleton);

  let initial: DashboardData;
  try {
    initial = await fetchDashboardData({ hallId: session.hall[0]?.id });
  } catch (err) {
    // Bail if we've been unmounted/replaced while fetching — don't overwrite
    // another route's DOM with an error box.
    if (mountId !== activeMountId) return;
    renderError(container, err);
    return;
  }
  // Bail if we've been unmounted/replaced while awaiting the initial fetch.
  if (mountId !== activeMountId) return;
  renderAll(container, session, initial);

  activeController = startPolling(
    REFRESH_MS,
    (data) => renderAll(container, session, data),
    (err) => {
      // Polling-errors are non-fatal; keep the last good snapshot on screen and
      // surface the issue in the console so admins see it in DevTools.
      console.warn("[dashboard] poll failed", err);
    },
    { hallId: session.hall[0]?.id }
  );
}

export function unmountDashboard(): void {
  stopActivePolling();
  // Invalidate any pending initial-fetch promise from mountDashboard() so it
  // won't render on a container that now belongs to another route.
  activeMountId++;
  // Clear the dashboard-marker from whichever container still has it so
  // renderAll()'s safety check fails fast if a stale poll-callback somehow
  // slips through (defense-in-depth).
  const stale = document.querySelector('[data-page="dashboard"]');
  stale?.removeAttribute("data-page");
}

function stopActivePolling(): void {
  if (activeController) {
    activeController.stop();
    activeController = null;
  }
}

function renderAll(container: HTMLElement, session: Session, data: DashboardData): void {
  // Defense-in-depth: bail if the container is no longer the dashboard.
  // This catches pending fetchDashboardData() promises inside startPolling()
  // that resolved after the user navigated away — without this, a polling
  // tick can overwrite a foreign route's DOM (observed: navigate to /hall,
  // ~4 s later the container is wiped and replaced with dashboard widgets).
  if (container.getAttribute("data-page") !== "dashboard") return;
  container.innerHTML = "";

  // ── Row 1: info-boxes ──────────────────────────────────────────────────────
  const row1 = document.createElement("div");
  row1.className = "row";

  const showApprovedPlayers = session.role === "admin" || session.role === "super-admin" || canViewPlayers(session);
  if (showApprovedPlayers) {
    row1.append(
      renderInfoBox({
        labelLine1: t("total_numbers_of"),
        labelLine2: t("approved_players").trim(),
        value: data.summary.totalApprovedPlayers ?? "—",
        icon: "fa fa-users",
        color: "blue",
        href: "#/player",
      })
    );
  }

  if (session.role === "admin" || session.role === "super-admin") {
    row1.append(
      renderInfoBox({
        labelLine1: t("total_numbers_of_active"),
        labelLine2: t("agents"),
        value: data.summary.activeAgents ? `${data.summary.activeAgents.active}/${data.summary.activeAgents.total}` : "—",
        icon: "fa fa-user-secret",
        color: "blue",
        href: "#/agent",
      })
    );
    row1.append(
      renderInfoBox({
        labelLine1: t("total_numbers_of_active"),
        labelLine2: t("group_of_halls"),
        value: data.summary.activeHallGroups ? `${data.summary.activeHallGroups.active}/${data.summary.activeHallGroups.total}` : "—",
        icon: "fa fa-building",
        color: "yellow",
        href: "#/groupHall",
      })
    );
    row1.append(
      renderInfoBox({
        labelLine1: t("total_numbers_of_active"),
        labelLine2: t("halls"),
        value: `${data.summary.activeHalls.active}/${data.summary.activeHalls.total}`,
        icon: "fa fa-building",
        color: "green",
        href: "#/hall",
      })
    );
  }
  container.append(row1);

  // ── Row 2: latest requests (left 8/12) + top 5 players (right 4/12) ────────
  const row2 = document.createElement("div");
  row2.className = "row";

  const leftCol = document.createElement("div");
  leftCol.className = "col-md-8";
  leftCol.append(
    renderLatestRequestsBox({
      requests: data.latestRequests,
      role: session.role,
      totalPending: data.latestRequests.length,
    })
  );
  row2.append(leftCol);

  const rightCol = document.createElement("div");
  rightCol.className = "col-md-4";
  rightCol.append(renderTopPlayersBox({ players: data.topPlayers, role: session.role }));
  row2.append(rightCol);
  container.append(row2);

  // ── Row 3: ongoing games tabbed table ──────────────────────────────────────
  const row3 = document.createElement("div");
  row3.className = "row";
  const fullCol = document.createElement("div");
  fullCol.className = "col-md-12";
  fullCol.append(renderOngoingGamesTabs({ games: data.ongoingGames }));
  row3.append(fullCol);
  container.append(row3);

  container.setAttribute("data-last-refresh", String(data.fetchedAt));
}

function renderError(container: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("dashboard"))} — ${escapeHtml(t("error"))}</h3>
      </div>
      <div class="box-body">
        <p>${escapeHtml(msg)}</p>
      </div>
    </div>`;
}

function canViewPlayers(session: Session): boolean {
  const p = session.permissions["Players Management"];
  return Boolean(p?.view);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
