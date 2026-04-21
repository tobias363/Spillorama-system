// BIN-655 (alt) — auditLog dispatcher.
//
// Path: /auditLog → AuditLogPage

import { renderAuditLogPage } from "./AuditLogPage.js";

export function isAuditLogRoute(path: string): boolean {
  return path === "/auditLog";
}

export function mountAuditLogRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/auditLog") return renderAuditLogPage(container);
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown audit-log route: ${path}</div></div>`;
}
