// PR-B6 (BIN-664) — Security (blocked-IP) route dispatcher.
//
// Routes:
//   /blockedIp            → BlockedIpsPage (list + add/edit/delete via modal)
//
// Legacy /blockedIp/add and /blockedIp/edit/:id are NOT separate routes in
// the modern admin — add/edit opens a modal over the list page (matches the
// riskCountry + PR-B4 email patterns, reduces hash surface).
//
// security/security.html and security/securityList.html (poker-stacks
// tables) are intentionally NOT ported — see PR-B6-PLAN §2.5 and
// docs/archive/legacy-admin-bkp/README.md.

import { renderBlockedIpsPage } from "./BlockedIpsPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const SECURITY_ROUTES = new Set<string>(["/blockedIp"]);

export function isSecurityRoute(path: string): boolean {
  return SECURITY_ROUTES.has(path);
}

export function mountSecurityRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/blockedIp":
      renderBlockedIpsPage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("security", path);
  }
}
