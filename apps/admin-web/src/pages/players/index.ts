// PR-B2: Player routes dispatcher.
// Mirrors the cash-inout-module pattern established in PR-B1.
//
// Routes:
//   /player                  → all-players list (search-driven)
//   /players/view            → detail (mode: all)
//   /players/approved        → approved (VERIFIED) list
//   /players/approved/view   → detail (mode: approved)

import { renderPlayerListPage } from "./PlayerListPage.js";
import { renderPlayerDetailPage } from "./PlayerDetailPage.js";
import { renderApprovedPlayerListPage } from "./approved/ApprovedPlayerListPage.js";

const PLAYER_ROUTES = new Set<string>([
  "/player",
  "/players/view",
  "/players/approved",
  "/players/approved/view",
]);

export function isPlayerRoute(path: string): boolean {
  return PLAYER_ROUTES.has(path);
}

export function mountPlayerRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/player":
      renderPlayerListPage(container);
      return;
    case "/players/view":
      renderPlayerDetailPage(container, { mode: "all" });
      return;
    case "/players/approved":
      renderApprovedPlayerListPage(container);
      return;
    case "/players/approved/view":
      renderPlayerDetailPage(container, { mode: "approved" });
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown player route: ${path}</div></div>`;
  }
}
