// GameManagement-stack route dispatcher (PR-A3).
//
// Handles both statically-registered routes (in routes.ts) AND dynamic routes
// of the shape `/gameType/view/:id`, `/gameManagement/:typeId/view/:id`, etc.
// Mirrors the cash-inout dispatcher pattern from PR-B1.
//
// Dynamic routes arrive via `onUnknown` in main.ts — we match by regex below
// and dispatch to per-page render functions.

import { renderGameTypeListPage } from "./gameType/GameTypeListPage.js";
import { renderGameTypeAddPage, renderGameTypeEditPage } from "./gameType/GameTypeAddEditPage.js";
import { renderGameTypeViewPage } from "./gameType/GameTypeViewPage.js";
import { renderGameTypeTestPage } from "./gameType/GameTypeTestPage.js";
import { renderSubGameListPage } from "./subGame/SubGameListPage.js";
import { renderSubGameAddPage, renderSubGameEditPage } from "./subGame/SubGameAddEditPage.js";
import { renderSubGameViewPage } from "./subGame/SubGameViewPage.js";
import { renderPatternListPage } from "./patternManagement/PatternListPage.js";
import { renderPatternAddPage, renderPatternEditPage } from "./patternManagement/PatternAddPage.js";
import { renderPatternViewPage } from "./patternManagement/PatternViewPage.js";
import { renderGameManagementPage } from "./gameManagement/GameManagementPage.js";
import {
  renderGameManagementAddPage,
  renderGameManagementAddG3Page,
  renderGameManagementViewPage,
  renderGameManagementViewG3Page,
  renderGameManagementTicketsPage,
  renderGameManagementSubGamesPage,
  renderGameManagementCloseDayPage,
} from "./gameManagement/GameManagementDetailPages.js";
import { renderSavedGameListPage } from "./savedGame/SavedGameListPage.js";
import { renderSavedGameDetailPages } from "./savedGame/SavedGameDetailPages.js";
import { renderScheduleListPage } from "./schedules/ScheduleListPage.js";
import { renderScheduleDetailPages } from "./schedules/ScheduleDetailPages.js";
import { renderDailyScheduleDetailPages } from "./dailySchedules/DailyScheduleDetailPages.js";
import { renderGame1MasterConsole } from "./master/Game1MasterConsole.js";

/** Static routes that resolve via routes.ts directly (no params). */
const STATIC_GAMES_ROUTES = new Set<string>([
  "/gameType",
  "/gameType/add",
  "/gameType/test",
  // subGame — bolk 2 (PR-A3a)
  "/subGame",
  "/subGame/add",
  // patternManagement — bolk 3 uses typeId-scoped dynamic routes only; no static.
  // gameManagement — bolk 4 (PR-A3b)
  "/gameManagement",
  // savedGameList — bolk 5 (PR-A3b)
  "/savedGameList",
  // schedules — bolk 6 (PR-A3b)
  "/schedules",
  "/schedules/create",
  // dailySchedules — bolk 7 (PR-A3b) — all dynamic/typeId-scoped.
]);

/**
 * True if `path` is any route handled by this dispatcher — both static and
 * dynamic (`/gameType/view/:id`, etc.). main.ts uses this from both the
 * static-renderer (via renderGamesRoute) and onUnknown.
 */
export function isGamesRoute(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  if (STATIC_GAMES_ROUTES.has(bare)) return true;
  // Dynamic patterns — keep in sync with renderGamesRoute below.
  return (
    /^\/gameType\/view\/[^/]+$/.test(bare) ||
    /^\/gameType\/edit\/[^/]+$/.test(bare) ||
    /^\/subGame\/view\/[^/]+$/.test(bare) ||
    /^\/subGame\/edit\/[^/]+$/.test(bare) ||
    /^\/patternManagement\/[^/]+$/.test(bare) ||
    /^\/patternManagement\/[^/]+\/add$/.test(bare) ||
    /^\/patternManagement\/[^/]+\/edit\/[^/]+$/.test(bare) ||
    /^\/patternManagement\/[^/]+\/view\/[^/]+$/.test(bare) ||
    // gameManagement — bolk 4 (PR-A3b)
    /^\/gameManagement\/[^/]+\/add$/.test(bare) ||
    /^\/gameManagement\/[^/]+\/add-g3$/.test(bare) ||
    /^\/gameManagement\/[^/]+\/view\/[^/]+$/.test(bare) ||
    /^\/gameManagement\/[^/]+\/view-g3\/[^/]+$/.test(bare) ||
    /^\/gameManagement\/[^/]+\/tickets\/[^/]+$/.test(bare) ||
    /^\/gameManagement\/subGames\/[^/]+\/[^/]+$/.test(bare) ||
    /^\/gameManagement\/closeDay\/[^/]+\/[^/]+$/.test(bare) ||
    // savedGameList — bolk 5 (PR-A3b)
    /^\/savedGameList\/[^/]+\/add$/.test(bare) ||
    /^\/savedGameList\/[^/]+\/view\/[^/]+$/.test(bare) ||
    /^\/savedGameList\/[^/]+\/view-g3\/[^/]+$/.test(bare) ||
    /^\/savedGameList\/[^/]+\/edit\/[^/]+$/.test(bare) ||
    // schedules — bolk 6 (PR-A3b)
    /^\/schedules\/view\/[^/]+$/.test(bare) ||
    // dailySchedules — bolk 7 (PR-A3b)
    /^\/dailySchedule\/view$/.test(bare) ||
    /^\/dailySchedule\/create\/[^/]+$/.test(bare) ||
    /^\/dailySchedule\/special\/[^/]+$/.test(bare) ||
    /^\/dailySchedule\/scheduleGame\/[^/]+$/.test(bare) ||
    /^\/dailySchedule\/subgame\/edit\/[^/]+$/.test(bare) ||
    /^\/dailySchedule\/subgame\/view\/[^/]+$/.test(bare) ||
    // GAME1_SCHEDULE PR 3: master-konsoll for Game 1
    /^\/game1\/master\/[^/]+$/.test(bare)
  );
}

/**
 * Render the games-stack page for `path`. Caller owns `container` clearing —
 * we set innerHTML internally via the per-page render functions.
 */
export function mountGamesRoute(container: HTMLElement, path: string): void {
  const bare = path.split("?")[0] ?? path;
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";

  // Static routes
  switch (bare) {
    case "/gameType":
      void renderGameTypeListPage(container);
      return;
    case "/gameType/add":
      void renderGameTypeAddPage(container);
      return;
    case "/gameType/test":
      void renderGameTypeTestPage(container);
      return;
    case "/subGame":
      void renderSubGameListPage(container);
      return;
    case "/subGame/add":
      void renderSubGameAddPage(container);
      return;
    case "/gameManagement": {
      // Optional ?typeId=X query param for pre-selection.
      const typeId = new URLSearchParams(query).get("typeId") ?? undefined;
      void renderGameManagementPage(container, typeId);
      return;
    }
    case "/savedGameList":
      void renderSavedGameListPage(container);
      return;
    case "/schedules":
      void renderScheduleListPage(container);
      return;
    case "/schedules/create":
      void renderScheduleDetailPages(container, { kind: "create" });
      return;
    case "/dailySchedule/view":
      void renderDailyScheduleDetailPages(container, { kind: "view" });
      return;
  }

  // Dynamic: /gameType/view/:id
  const viewMatch = /^\/gameType\/view\/([^/]+)$/.exec(bare);
  if (viewMatch && viewMatch[1]) {
    void renderGameTypeViewPage(container, decodeURIComponent(viewMatch[1]));
    return;
  }

  // Dynamic: /gameType/edit/:id
  const editMatch = /^\/gameType\/edit\/([^/]+)$/.exec(bare);
  if (editMatch && editMatch[1]) {
    void renderGameTypeEditPage(container, decodeURIComponent(editMatch[1]));
    return;
  }

  // Dynamic: /subGame/view/:id
  const subViewMatch = /^\/subGame\/view\/([^/]+)$/.exec(bare);
  if (subViewMatch && subViewMatch[1]) {
    void renderSubGameViewPage(container, decodeURIComponent(subViewMatch[1]));
    return;
  }

  // Dynamic: /subGame/edit/:id
  const subEditMatch = /^\/subGame\/edit\/([^/]+)$/.exec(bare);
  if (subEditMatch && subEditMatch[1]) {
    void renderSubGameEditPage(container, decodeURIComponent(subEditMatch[1]));
    return;
  }

  // Dynamic: /patternManagement/:typeId/add
  const patternAddMatch = /^\/patternManagement\/([^/]+)\/add$/.exec(bare);
  if (patternAddMatch && patternAddMatch[1]) {
    void renderPatternAddPage(container, decodeURIComponent(patternAddMatch[1]));
    return;
  }

  // Dynamic: /patternManagement/:typeId/edit/:id
  const patternEditMatch = /^\/patternManagement\/([^/]+)\/edit\/([^/]+)$/.exec(bare);
  if (patternEditMatch && patternEditMatch[1] && patternEditMatch[2]) {
    void renderPatternEditPage(
      container,
      decodeURIComponent(patternEditMatch[1]),
      decodeURIComponent(patternEditMatch[2])
    );
    return;
  }

  // Dynamic: /patternManagement/:typeId/view/:id
  const patternViewMatch = /^\/patternManagement\/([^/]+)\/view\/([^/]+)$/.exec(bare);
  if (patternViewMatch && patternViewMatch[1] && patternViewMatch[2]) {
    void renderPatternViewPage(
      container,
      decodeURIComponent(patternViewMatch[1]),
      decodeURIComponent(patternViewMatch[2])
    );
    return;
  }

  // Dynamic: /patternManagement/:typeId (list) — must be after /add, /edit, /view
  const patternListMatch = /^\/patternManagement\/([^/]+)$/.exec(bare);
  if (patternListMatch && patternListMatch[1]) {
    void renderPatternListPage(container, decodeURIComponent(patternListMatch[1]));
    return;
  }

  // --- gameManagement ---
  const gmAddMatch = /^\/gameManagement\/([^/]+)\/add$/.exec(bare);
  if (gmAddMatch && gmAddMatch[1]) {
    void renderGameManagementAddPage(container, decodeURIComponent(gmAddMatch[1]));
    return;
  }
  const gmAddG3Match = /^\/gameManagement\/([^/]+)\/add-g3$/.exec(bare);
  if (gmAddG3Match && gmAddG3Match[1]) {
    void renderGameManagementAddG3Page(container, decodeURIComponent(gmAddG3Match[1]));
    return;
  }
  const gmViewMatch = /^\/gameManagement\/([^/]+)\/view\/([^/]+)$/.exec(bare);
  if (gmViewMatch && gmViewMatch[1] && gmViewMatch[2]) {
    void renderGameManagementViewPage(
      container,
      decodeURIComponent(gmViewMatch[1]),
      decodeURIComponent(gmViewMatch[2])
    );
    return;
  }
  const gmViewG3Match = /^\/gameManagement\/([^/]+)\/view-g3\/([^/]+)$/.exec(bare);
  if (gmViewG3Match && gmViewG3Match[1] && gmViewG3Match[2]) {
    void renderGameManagementViewG3Page(
      container,
      decodeURIComponent(gmViewG3Match[1]),
      decodeURIComponent(gmViewG3Match[2])
    );
    return;
  }
  const gmTicketsMatch = /^\/gameManagement\/([^/]+)\/tickets\/([^/]+)$/.exec(bare);
  if (gmTicketsMatch && gmTicketsMatch[1] && gmTicketsMatch[2]) {
    void renderGameManagementTicketsPage(
      container,
      decodeURIComponent(gmTicketsMatch[1]),
      decodeURIComponent(gmTicketsMatch[2])
    );
    return;
  }
  const gmSubGamesMatch = /^\/gameManagement\/subGames\/([^/]+)\/([^/]+)$/.exec(bare);
  if (gmSubGamesMatch && gmSubGamesMatch[1] && gmSubGamesMatch[2]) {
    void renderGameManagementSubGamesPage(
      container,
      decodeURIComponent(gmSubGamesMatch[1]),
      decodeURIComponent(gmSubGamesMatch[2])
    );
    return;
  }
  const gmCloseDayMatch = /^\/gameManagement\/closeDay\/([^/]+)\/([^/]+)$/.exec(bare);
  if (gmCloseDayMatch && gmCloseDayMatch[1] && gmCloseDayMatch[2]) {
    void renderGameManagementCloseDayPage(
      container,
      decodeURIComponent(gmCloseDayMatch[1]),
      decodeURIComponent(gmCloseDayMatch[2])
    );
    return;
  }

  // --- savedGameList ---
  const sgAddMatch = /^\/savedGameList\/([^/]+)\/add$/.exec(bare);
  if (sgAddMatch && sgAddMatch[1]) {
    void renderSavedGameDetailPages(container, { kind: "add", typeId: decodeURIComponent(sgAddMatch[1]) });
    return;
  }
  const sgViewMatch = /^\/savedGameList\/([^/]+)\/view\/([^/]+)$/.exec(bare);
  if (sgViewMatch && sgViewMatch[1] && sgViewMatch[2]) {
    void renderSavedGameDetailPages(container, {
      kind: "view",
      typeId: decodeURIComponent(sgViewMatch[1]),
      id: decodeURIComponent(sgViewMatch[2]),
    });
    return;
  }
  const sgViewG3Match = /^\/savedGameList\/([^/]+)\/view-g3\/([^/]+)$/.exec(bare);
  if (sgViewG3Match && sgViewG3Match[1] && sgViewG3Match[2]) {
    void renderSavedGameDetailPages(container, {
      kind: "view-g3",
      typeId: decodeURIComponent(sgViewG3Match[1]),
      id: decodeURIComponent(sgViewG3Match[2]),
    });
    return;
  }
  const sgEditMatch = /^\/savedGameList\/([^/]+)\/edit\/([^/]+)$/.exec(bare);
  if (sgEditMatch && sgEditMatch[1] && sgEditMatch[2]) {
    void renderSavedGameDetailPages(container, {
      kind: "edit",
      typeId: decodeURIComponent(sgEditMatch[1]),
      id: decodeURIComponent(sgEditMatch[2]),
    });
    return;
  }

  // --- schedules ---
  const schedViewMatch = /^\/schedules\/view\/([^/]+)$/.exec(bare);
  if (schedViewMatch && schedViewMatch[1]) {
    void renderScheduleDetailPages(container, { kind: "view", id: decodeURIComponent(schedViewMatch[1]) });
    return;
  }

  // --- dailySchedules ---
  const dsCreateMatch = /^\/dailySchedule\/create\/([^/]+)$/.exec(bare);
  if (dsCreateMatch && dsCreateMatch[1]) {
    void renderDailyScheduleDetailPages(container, {
      kind: "create",
      typeId: decodeURIComponent(dsCreateMatch[1]),
    });
    return;
  }
  const dsSpecialMatch = /^\/dailySchedule\/special\/([^/]+)$/.exec(bare);
  if (dsSpecialMatch && dsSpecialMatch[1]) {
    void renderDailyScheduleDetailPages(container, {
      kind: "special",
      typeId: decodeURIComponent(dsSpecialMatch[1]),
    });
    return;
  }
  const dsScheduleGameMatch = /^\/dailySchedule\/scheduleGame\/([^/]+)$/.exec(bare);
  if (dsScheduleGameMatch && dsScheduleGameMatch[1]) {
    void renderDailyScheduleDetailPages(container, {
      kind: "scheduleGame",
      id: decodeURIComponent(dsScheduleGameMatch[1]),
    });
    return;
  }
  const dsSubgameEditMatch = /^\/dailySchedule\/subgame\/edit\/([^/]+)$/.exec(bare);
  if (dsSubgameEditMatch && dsSubgameEditMatch[1]) {
    void renderDailyScheduleDetailPages(container, {
      kind: "subgame-edit",
      id: decodeURIComponent(dsSubgameEditMatch[1]),
    });
    return;
  }
  const dsSubgameViewMatch = /^\/dailySchedule\/subgame\/view\/([^/]+)$/.exec(bare);
  if (dsSubgameViewMatch && dsSubgameViewMatch[1]) {
    void renderDailyScheduleDetailPages(container, {
      kind: "subgame-view",
      id: decodeURIComponent(dsSubgameViewMatch[1]),
    });
    return;
  }

  // --- GAME1_SCHEDULE PR 3: master-konsoll ---
  const masterMatch = /^\/game1\/master\/([^/]+)$/.exec(bare);
  if (masterMatch && masterMatch[1]) {
    void renderGame1MasterConsole(container, decodeURIComponent(masterMatch[1]));
    return;
  }

  // Shouldn't happen if isGamesRoute matched — fall back to 404.
  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border"><h3 class="box-title">404</h3></div>
      <div class="box-body">
        <p>Ukjent games-rute: <code>${escapeAttr(path)}</code></p>
        <a href="#/admin" class="btn btn-primary btn-sm">← Dashbord</a>
      </div>
    </div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
