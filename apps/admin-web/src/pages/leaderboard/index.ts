// PR-B6 (BIN-664) — Leaderboard tier route dispatcher (PLACEHOLDER).
//
// Routes:
//   /leaderboard        → LeaderboardPage (list placeholder)
//   /addLeaderboard     → AddLeaderboardPage (form placeholder)
//
// Backend CRUD is tracked as BIN-668 (P3). When backend merges:
//   1. Replace stubbed wrappers in src/api/admin-leaderboard.ts
//   2. Remove `backendPendingBanner()` calls from both pages
//   3. Wire add/edit/delete actions

import { renderLeaderboardPage } from "./LeaderboardPage.js";
import { renderAddLeaderboardPage } from "./AddLeaderboardPage.js";

const LEADERBOARD_ROUTES = new Set<string>(["/leaderboard", "/addLeaderboard"]);

export function isLeaderboardRoute(path: string): boolean {
  return LEADERBOARD_ROUTES.has(path);
}

export function mountLeaderboardRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/leaderboard":
      renderLeaderboardPage(container);
      return;
    case "/addLeaderboard":
      renderAddLeaderboardPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown leaderboard route: ${path}</div></div>`;
  }
}
