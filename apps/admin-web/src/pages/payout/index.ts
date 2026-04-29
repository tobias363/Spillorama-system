// PR-A4b (BIN-659) — payout dispatcher.
//
// Handles 4 payout routes:
//   - /payoutPlayer                 (list)
//   - /payoutTickets                (list)
//   - /payoutPlayer/view/:userId    (detail)
//   - /payoutTickets/view/:ticketId (detail)

import { renderPayoutPlayerPage } from "./PayoutPlayerPage.js";
import { renderPayoutTicketsPage } from "./PayoutTicketsPage.js";
import { renderViewPayoutPlayerPage } from "./ViewPayoutPlayerPage.js";
import { renderViewPayoutTicketsPage } from "./ViewPayoutTicketsPage.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

const STATIC_ROUTES = new Set<string>(["/payoutPlayer", "/payoutTickets"]);

export function isPayoutRoute(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  if (STATIC_ROUTES.has(bare)) return true;
  return (
    /^\/payoutPlayer\/view\/[^/]+$/.test(bare) ||
    /^\/payoutTickets\/view\/[^/]+$/.test(bare)
  );
}

export function mountPayoutRoute(container: HTMLElement, path: string): void {
  const bare = path.split("?")[0] ?? path;

  if (bare === "/payoutPlayer") {
    void renderPayoutPlayerPage(container);
    return;
  }
  if (bare === "/payoutTickets") {
    void renderPayoutTicketsPage(container);
    return;
  }
  const vp = /^\/payoutPlayer\/view\/([^/]+)$/.exec(bare);
  if (vp && vp[1]) {
    void renderViewPayoutPlayerPage(container, decodeURIComponent(vp[1]));
    return;
  }
  const vt = /^\/payoutTickets\/view\/([^/]+)$/.exec(bare);
  if (vt && vt[1]) {
    void renderViewPayoutTicketsPage(container, decodeURIComponent(vt[1]));
    return;
  }

  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border"><h3 class="box-title">404</h3></div>
      <div class="box-body">
        <p>Ukjent rute: <code>${escapeHtml(path)}</code></p>
        <a href="#/admin" class="btn btn-primary btn-sm">← Dashbord</a>
      </div>
    </div>`;
}
