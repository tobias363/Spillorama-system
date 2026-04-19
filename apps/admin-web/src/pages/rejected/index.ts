// PR-B2: Rejected KYC routes dispatcher.

import { renderRejectedListPage } from "./RejectedListPage.js";
import { renderRejectedDetailPage } from "./RejectedDetailPage.js";

const REJECTED_ROUTES = new Set<string>(["/rejectedRequests", "/rejected/view"]);

export function isRejectedRoute(path: string): boolean {
  return REJECTED_ROUTES.has(path);
}

export function mountRejectedRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/rejectedRequests":
      renderRejectedListPage(container);
      return;
    case "/rejected/view":
      renderRejectedDetailPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown rejected route: ${path}</div></div>`;
  }
}
