// PR-B2: Pending KYC routes dispatcher.

import { renderPendingListPage } from "./PendingListPage.js";
import { renderPendingDetailPage } from "./PendingDetailPage.js";

const PENDING_ROUTES = new Set<string>(["/pendingRequests", "/pending/view"]);

export function isPendingRoute(path: string): boolean {
  return PENDING_ROUTES.has(path);
}

export function mountPendingRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/pendingRequests":
      renderPendingListPage(container);
      return;
    case "/pending/view":
      renderPendingDetailPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown pending route: ${path}</div></div>`;
  }
}
