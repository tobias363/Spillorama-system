// PR-B4 (BIN-646) — Amountwithdraw route dispatcher.
//
// Routes (matches legacy /withdraw/* + eksisterende routes.ts entries):
//   /withdraw/requests/bank    → bank-withdraw pending queue
//   /withdraw/requests/hall    → hall-withdraw pending queue
//   /withdraw/history/bank     → bank-withdraw history
//   /withdraw/history/hall     → hall-withdraw history
//   /withdraw/list/emails      → accountant-CC email allowlist
//
// Scope-drop (PR-B4-PLAN §1, PM-beslutning):
//   - withdrawAmount.html (legacy duplicate av bank+hall requests)
//   - withdrawHistory.html (legacy duplicate av history-sider)

import { renderRequestsPage } from "./RequestsPage.js";
import { renderHistoryPage } from "./HistoryPage.js";
import { renderEmailsPage } from "./EmailsPage.js";

const AMOUNTWITHDRAW_ROUTES = new Set<string>([
  "/withdraw/requests/bank",
  "/withdraw/requests/hall",
  "/withdraw/history/bank",
  "/withdraw/history/hall",
  "/withdraw/list/emails",
]);

export function isAmountwithdrawRoute(path: string): boolean {
  return AMOUNTWITHDRAW_ROUTES.has(path);
}

export function mountAmountwithdrawRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/withdraw/requests/bank":
      renderRequestsPage(container, {
        destinationType: "bank",
        titleKey: "withdraw_request_in_bank",
      });
      return;
    case "/withdraw/requests/hall":
      renderRequestsPage(container, {
        destinationType: "hall",
        titleKey: "withdraw_request_in_hall",
      });
      return;
    case "/withdraw/history/bank":
      renderHistoryPage(container, {
        destinationType: "bank",
        titleKey: "withdraw_history_bank",
      });
      return;
    case "/withdraw/history/hall":
      renderHistoryPage(container, {
        destinationType: "hall",
        titleKey: "withdraw_history_hall",
      });
      return;
    case "/withdraw/list/emails":
      renderEmailsPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown amountwithdraw route: ${path}</div></div>`;
  }
}
