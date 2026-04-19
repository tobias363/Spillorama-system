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

/** Static routes that resolve via routes.ts directly (no params). */
const STATIC_GAMES_ROUTES = new Set<string>([
  "/gameType",
  "/gameType/add",
  "/gameType/test",
  // subGame — bolk 2 (PR-A3)
  "/subGame",
  "/subGame/add",
  // patternManagement — bolk 3 uses typeId-scoped dynamic routes only; no static.
  // gameManagement — bolk 4
  // savedGameList — bolk 5
  // dailySchedule — bolk 6
  // schedules — bolk 7
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
    /^\/patternManagement\/[^/]+\/view\/[^/]+$/.test(bare)
    // Extended per bolk:
    //   /gameManagement/:typeId/(list|add|view|...)
    //   /savedGameList/:typeId/(add|view|edit)
    //   /dailySchedule/(create|special|scheduleGame|subgame)/:typeId?/:id?
    //   /schedules/(create|view/:id)
  );
}

/**
 * Render the games-stack page for `path`. Caller owns `container` clearing —
 * we set innerHTML internally via the per-page render functions.
 */
export function mountGamesRoute(container: HTMLElement, path: string): void {
  const bare = path.split("?")[0] ?? path;

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
