// BIN-668 — Leaderboard tier route dispatcher.
//
// Routes:
//   /leaderboard                      → LeaderboardPage (list + delete)
//   /addLeaderboard                   → AddLeaderboardPage (create)
//   /leaderboard/edit/:id             → AddLeaderboardPage (update)

import { renderLeaderboardPage } from "./LeaderboardPage.js";
import { renderAddLeaderboardPage } from "./AddLeaderboardPage.js";

const LEADERBOARD_EDIT_RE = /^\/leaderboard\/edit\/[^/]+$/;

export function isLeaderboardRoute(path: string): boolean {
  if (path === "/leaderboard" || path === "/addLeaderboard") return true;
  return LEADERBOARD_EDIT_RE.test(path);
}

export function mountLeaderboardRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/leaderboard") return renderLeaderboardPage(container);
  if (path === "/addLeaderboard") return renderAddLeaderboardPage(container, null);
  if (LEADERBOARD_EDIT_RE.test(path)) {
    const id = decodeURIComponent(path.slice("/leaderboard/edit/".length));
    return renderAddLeaderboardPage(container, id);
  }
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown leaderboard route: ${path}</div></div>`;
}
