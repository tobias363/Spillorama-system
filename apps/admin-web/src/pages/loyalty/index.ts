// BIN-700 — Loyalty admin route dispatcher.
//
// Routes:
//   /loyaltyManagement                         → LoyaltyManagementPage (tier-list)
//   /loyaltyManagement/new                     → AddLoyaltyTierPage (create)
//   /loyaltyManagement/edit/:id                → AddLoyaltyTierPage (update)
//   /loyaltyManagement/players                 → LoyaltyPlayersPage (spillerliste)
//   /loyaltyManagement/players/:userId         → LoyaltyPlayerDetailPage
//
// Legacy `/loyalty` route dispatches til LoyaltyManagementPage (samme side,
// siden legacy-menyen hadde "loyalty" og "players loyalty management" som
// to oppføringer — begge ender i samme tier-CRUD).

import { renderLoyaltyManagementPage } from "./LoyaltyManagementPage.js";
import { renderAddLoyaltyTierPage } from "./AddLoyaltyTierPage.js";
import { renderLoyaltyPlayersPage } from "./LoyaltyPlayersPage.js";
import { renderLoyaltyPlayerDetailPage } from "./LoyaltyPlayerDetailPage.js";

const LOYALTY_EDIT_RE = /^\/loyaltyManagement\/edit\/[^/]+$/;
const LOYALTY_PLAYER_DETAIL_RE = /^\/loyaltyManagement\/players\/[^/]+$/;

export function isLoyaltyRoute(path: string): boolean {
  if (
    path === "/loyaltyManagement" ||
    path === "/loyaltyManagement/new" ||
    path === "/loyaltyManagement/players" ||
    path === "/loyalty"
  ) {
    return true;
  }
  return LOYALTY_EDIT_RE.test(path) || LOYALTY_PLAYER_DETAIL_RE.test(path);
}

export function mountLoyaltyRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/loyaltyManagement" || path === "/loyalty") {
    return renderLoyaltyManagementPage(container);
  }
  if (path === "/loyaltyManagement/new") {
    return renderAddLoyaltyTierPage(container, null);
  }
  if (LOYALTY_EDIT_RE.test(path)) {
    const id = decodeURIComponent(path.slice("/loyaltyManagement/edit/".length));
    return renderAddLoyaltyTierPage(container, id);
  }
  if (path === "/loyaltyManagement/players") {
    return renderLoyaltyPlayersPage(container);
  }
  if (LOYALTY_PLAYER_DETAIL_RE.test(path)) {
    const userId = decodeURIComponent(
      path.slice("/loyaltyManagement/players/".length)
    );
    return renderLoyaltyPlayerDetailPage(container, userId);
  }
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown loyalty route: ${path}</div></div>`;
}
