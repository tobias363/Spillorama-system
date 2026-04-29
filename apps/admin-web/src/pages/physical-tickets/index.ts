// Physical tickets route dispatcher.
//
// Scope:
//   - /addPhysicalTickets             → AddPage (batch CRUD + generate)
//   - /physicalTicketManagement       → GameTicketListPage (BIN-638 aggregate +
//                                        BIN-639 reward-all)
//   - /physical/cash-out              → CashOutPage (BIN-640 single-ticket payout)
//   - /physical/check-bingo           → CheckBingoPage (BIN-641 stamp winners)
//   - /physical/import                → ImportCsvPage (PT1 — CSV-inventar)
//   - /physical/ranges/register       → RangeRegisterPage (PT2)
//   - /physical/ranges                → ActiveRangesPage (PT2/3/5 actions)
//   - /physical/payouts               → PendingPayoutsPage (PT4)
//
// `/agent/physicalCashOut` er bevisst IKKE håndtert her — det er agent-shift-
// scoped view rendret av cash-inout/PhysicalCashoutPage.ts.

import { renderAddPage } from "./AddPage.js";
import { renderCashOutPage } from "./CashOutPage.js";
import { renderGameTicketListPage } from "./GameTicketListPage.js";
import { renderCheckBingoPage } from "./CheckBingoPage.js";
import { renderImportCsvPage } from "./ImportCsvPage.js";
import { renderRangeRegisterPage } from "./RangeRegisterPage.js";
import { renderActiveRangesPage } from "./ActiveRangesPage.js";
import { renderPendingPayoutsPage } from "./PendingPayoutsPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const PHYSICAL_TICKETS_ROUTES = new Set<string>([
  "/addPhysicalTickets",
  "/physicalTicketManagement",
  "/physical/cash-out",
  "/physical/check-bingo",
  "/physical/import",
  "/physical/ranges/register",
  "/physical/ranges",
  "/physical/payouts",
]);

// Tear-down for pages som registrerer side-effekter (sockets). Kalles før
// neste page mountes så vi ikke lekker socket-tilkoblinger.
let currentCleanup: (() => void) | null = null;

export function isPhysicalTicketsRoute(path: string): boolean {
  return PHYSICAL_TICKETS_ROUTES.has(path);
}

export function mountPhysicalTicketsRoute(container: HTMLElement, path: string): void {
  currentCleanup?.();
  currentCleanup = null;
  container.innerHTML = "";
  switch (path) {
    case "/addPhysicalTickets":
      renderAddPage(container);
      return;
    case "/physicalTicketManagement":
      renderGameTicketListPage(container);
      return;
    case "/physical/cash-out":
      renderCashOutPage(container);
      return;
    case "/physical/check-bingo":
      renderCheckBingoPage(container);
      return;
    case "/physical/import":
      renderImportCsvPage(container);
      return;
    case "/physical/ranges/register":
      renderRangeRegisterPage(container);
      return;
    case "/physical/ranges":
      renderActiveRangesPage(container);
      return;
    case "/physical/payouts":
      currentCleanup = renderPendingPayoutsPage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("physical-tickets", path);
  }
}
