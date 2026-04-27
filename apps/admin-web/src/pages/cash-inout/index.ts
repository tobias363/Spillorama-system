// Cash-in/out route dispatcher. Følger samme dispatcher-mønster som
// admin-pages forøvrig (router kaller `isCashInOutRoute(path)` og, hvis true,
// dispatcher inn til en per-page renderer). Tidligere referert til
// `legacy-sections/LegacySectionMount`-iframe-mønsteret som ble fjernet
// 2026-04-27 sammen med resten av "Spillorama Live"-section.
// See PR-B1-PLAN.md §5 (URLs) og §9 for full rute-liste.

import { renderCashInOutPage } from "./CashInOutPage.js";
import { renderBalancePage, type BalanceAction, type BalanceMode } from "./BalancePage.js";
import { renderSellTicketPage } from "./SellTicketPage.js";
import { renderSoldTicketsPage } from "./SoldTicketsPage.js";
import { renderProductCartPage } from "./ProductCartPage.js";
import { renderPhysicalCashoutPage } from "./PhysicalCashoutPage.js";
import { renderPhysicalCashoutSubGameDetailPage } from "./PhysicalCashoutSubGameDetailPage.js";
import { renderCashoutDetailsPage } from "./CashoutDetailsPage.js";

const CASH_INOUT_ROUTES = new Set<string>([
  "/agent/cashinout",
  "/agent/sellPhysicalTickets",
  "/agent/sellProduct",
  "/agent/unique-id/add",
  "/agent/unique-id/withdraw",
  "/agent/register-user/add",
  "/agent/register-user/withdraw",
  "/agent/physicalCashOut",
  "/agent/cashout-details",
  "/sold-tickets",
  // Wireframe §17.31 — agent-alias for sold-tickets, routes-guard krever
  // `/agent/*`-prefiks for AGENT/HALL_OPERATOR.
  "/agent/sold-tickets",
]);

// Dynamic route: `/agent/physical-cashout/sub-game/:id` (wireframe §17.34).
// FOLLOWUP-12 — sub-game cashout detail page.
const SUB_GAME_DETAIL_RE = /^\/agent\/physical-cashout\/sub-game\/[^/]+$/;

export function isCashInOutRoute(path: string): boolean {
  if (CASH_INOUT_ROUTES.has(path)) return true;
  return SUB_GAME_DETAIL_RE.test(path);
}

export function mountCashInOutRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (SUB_GAME_DETAIL_RE.test(path)) {
    renderPhysicalCashoutSubGameDetailPage(container);
    return;
  }
  switch (path) {
    case "/agent/cashinout":
      renderCashInOutPage(container);
      return;
    case "/agent/sellPhysicalTickets":
      renderSellTicketPage(container);
      return;
    case "/agent/sellProduct":
      renderProductCartPage(container);
      return;
    case "/sold-tickets":
      renderSoldTicketsPage(container);
      return;
    case "/agent/sold-tickets":
      // Wireframe §17.31 — agent ser shift-scoped sold-tickets-list. Samme
      // page som admin-routen `/sold-tickets`, men under agent-portalens
      // route-tre slik at routes-guarden tillater AGENT/HALL_OPERATOR-tilgang.
      renderSoldTicketsPage(container);
      return;
    case "/agent/physicalCashOut":
      renderPhysicalCashoutPage(container);
      return;
    case "/agent/cashout-details":
      renderCashoutDetailsPage(container);
      return;
    case "/agent/unique-id/add":
      return renderBalancePageFor(container, "unique-id", "add");
    case "/agent/unique-id/withdraw":
      return renderBalancePageFor(container, "unique-id", "withdraw");
    case "/agent/register-user/add":
      return renderBalancePageFor(container, "register-user", "add");
    case "/agent/register-user/withdraw":
      return renderBalancePageFor(container, "register-user", "withdraw");
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown cash-inout route: ${path}</div></div>`;
  }
}

function renderBalancePageFor(container: HTMLElement, mode: BalanceMode, action: BalanceAction): void {
  renderBalancePage(container, mode, action);
}
