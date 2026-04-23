// PR-A4a (BIN-645) — reports-dispatcher.
//
// Mirrors pages/games/index.ts dispatcher pattern (PR-A3a).
// Handles all 15 report routes (static + dynamic).

import { renderGame1ReportPage } from "./game1/Game1ReportPage.js";
import { renderGame1ManagementReportPage } from "./game1/Game1ManagementReportPage.js";
import { renderGame1SubgamesPage } from "./game1/Game1SubgamesPage.js";
import { renderGame1HistoryPage } from "./game1/Game1HistoryPage.js";
import { renderGame2ReportPage } from "./game2/Game2ReportPage.js";
import { renderGame2HistoryPage } from "./game2/Game2HistoryPage.js";
import { renderGame3ReportPage } from "./game3/Game3ReportPage.js";
import { renderGame3HistoryPage } from "./game3/Game3HistoryPage.js";
import { renderGame4ReportPage } from "./game4/Game4ReportPage.js";
import { renderGame5ReportPage } from "./game5/Game5ReportPage.js";
import { renderHallSpecificReportPage } from "./hallSpecific/HallSpecificReportPage.js";
import { renderPhysicalTicketReportPage } from "./physicalTicket/PhysicalTicketReportPage.js";
import { renderUniqueGameReportPage } from "./uniqueGame/UniqueGameReportPage.js";
import { renderRedFlagCategoryPage } from "./redFlag/RedFlagCategoryPage.js";
import { renderViewUserTransactionPage } from "./redFlag/ViewUserTransactionPage.js";
import { renderTotalRevenueReportPage } from "./totalRevenue/TotalRevenueReportPage.js";

const STATIC_REPORT_ROUTES = new Set<string>([
  "/reportGame1",
  "/reportManagement/game1",
  "/reportGame2",
  "/reportGame3",
  "/reportGame4",
  "/reportGame5",
  "/hallSpecificReport",
  "/physicalTicketReport",
  "/uniqueGameReport",
  "/redFlagCategory",
  "/totalRevenueReport",
]);

/** True if `path` is any route handled by this dispatcher. */
export function isReportRoute(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  if (STATIC_REPORT_ROUTES.has(bare)) return true;
  return (
    /^\/reportGame1\/subgames\/[^/]+$/.test(bare) ||
    /^\/reportGame1\/history\/[^/]+\/[^/]+\/[^/]+$/.test(bare) ||
    /^\/reportGame2\/history\/[^/]+\/[^/]+\/[^/]+$/.test(bare) ||
    /^\/reportGame3\/history\/[^/]+\/[^/]+\/[^/]+$/.test(bare) ||
    /^\/redFlagCategory\/[^/]+\/players$/.test(bare) ||
    /^\/redFlagCategory\/userTransaction\/[^/]+$/.test(bare)
  );
}

/** Render the report page for `path`. */
export function mountReportRoute(container: HTMLElement, path: string): void {
  const bare = path.split("?")[0] ?? path;

  switch (bare) {
    case "/reportGame1":
      void renderGame1ReportPage(container);
      return;
    case "/reportManagement/game1":
      void renderGame1ManagementReportPage(container);
      return;
    case "/reportGame2":
      void renderGame2ReportPage(container);
      return;
    case "/reportGame3":
      void renderGame3ReportPage(container);
      return;
    case "/reportGame4":
      void renderGame4ReportPage(container);
      return;
    case "/reportGame5":
      void renderGame5ReportPage(container);
      return;
    case "/hallSpecificReport":
      void renderHallSpecificReportPage(container);
      return;
    case "/physicalTicketReport":
      void renderPhysicalTicketReportPage(container);
      return;
    case "/uniqueGameReport":
      void renderUniqueGameReportPage(container);
      return;
    case "/redFlagCategory":
      void renderRedFlagCategoryPage(container);
      return;
    case "/totalRevenueReport":
      void renderTotalRevenueReportPage(container);
      return;
  }

  // Dynamic: /reportGame1/subgames/:id
  const sub1 = /^\/reportGame1\/subgames\/([^/]+)$/.exec(bare);
  if (sub1 && sub1[1]) {
    void renderGame1SubgamesPage(container, decodeURIComponent(sub1[1]));
    return;
  }

  // Dynamic: /reportGameN/history/:gameId/:grpId/:hallname
  const hist1 = /^\/reportGame1\/history\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(bare);
  if (hist1 && hist1[1] && hist1[2] && hist1[3]) {
    void renderGame1HistoryPage(
      container,
      decodeURIComponent(hist1[1]),
      decodeURIComponent(hist1[2]),
      decodeURIComponent(hist1[3])
    );
    return;
  }
  const hist2 = /^\/reportGame2\/history\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(bare);
  if (hist2 && hist2[1] && hist2[2] && hist2[3]) {
    void renderGame2HistoryPage(
      container,
      decodeURIComponent(hist2[1]),
      decodeURIComponent(hist2[2]),
      decodeURIComponent(hist2[3])
    );
    return;
  }
  const hist3 = /^\/reportGame3\/history\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(bare);
  if (hist3 && hist3[1] && hist3[2] && hist3[3]) {
    void renderGame3HistoryPage(
      container,
      decodeURIComponent(hist3[1]),
      decodeURIComponent(hist3[2]),
      decodeURIComponent(hist3[3])
    );
    return;
  }

  // Dynamic: /redFlagCategory/:id/players
  const rfPlayers = /^\/redFlagCategory\/([^/]+)\/players$/.exec(bare);
  if (rfPlayers && rfPlayers[1]) {
    void renderRedFlagCategoryPage(container, decodeURIComponent(rfPlayers[1]));
    return;
  }
  // Dynamic: /redFlagCategory/userTransaction/:userId
  const rfTx = /^\/redFlagCategory\/userTransaction\/([^/]+)$/.exec(bare);
  if (rfTx && rfTx[1]) {
    void renderViewUserTransactionPage(container, decodeURIComponent(rfTx[1]));
    return;
  }

  // Fallback 404.
  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border"><h3 class="box-title">404</h3></div>
      <div class="box-body">
        <p>Ukjent rapport-rute: <code>${escapeAttr(path)}</code></p>
        <a href="#/admin" class="btn btn-primary btn-sm">← Dashbord</a>
      </div>
    </div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
