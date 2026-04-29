// BIN-655 (alt) — auditLog dispatcher.
//
// Path: /auditLog → AuditLogPage
// Path: /admin/replay/:gameId → GameReplayPage (LOW-1)

import { renderAuditLogPage } from "./AuditLogPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";
import {
  isGameReplayRoute,
  mountGameReplayRoute,
} from "./GameReplayPage.js";

export function isAuditLogRoute(path: string): boolean {
  return path === "/auditLog" || isGameReplayRoute(path);
}

export function mountAuditLogRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/auditLog") return renderAuditLogPage(container);
  if (isGameReplayRoute(path)) return mountGameReplayRoute(container, path);
  container.innerHTML = renderUnknownRoute("audit-log", path);
}
