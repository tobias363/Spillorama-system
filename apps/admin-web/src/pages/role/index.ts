// PR-A5 (BIN-663) — role dispatcher (read-only static role display + assign).
//
// Routes:
//   /role           → RoleListPage             (5 static roles + description + banner)
//   /role/matrix    → RoleMatrixPage           (permission grid per role, read-only)
//   /role/assign    → AssignRolePage           (user-role assignment, write-enabled)
//   /role/agent     → AgentRolePermissionsPage (per-agent permission matrix)
//
// Role-CRUD is static (5 roles fra AdminAccessPolicy.ts). /role/agent
// dekker Admin CR 21.02.2024 side 5 — per-agent permission-matrix editor.

import { renderRoleListPage } from "./RoleListPage.js";
import { renderRoleMatrixPage } from "./RoleMatrixPage.js";
import { renderAssignRolePage } from "./AssignRolePage.js";
import { renderAgentRolePermissionsPage } from "./AgentRolePermissionsPage.js";

const ROLE_ROUTES = new Set<string>([
  "/role",
  "/role/matrix",
  "/role/assign",
  "/role/agent",
]);

export function isRoleRoute(path: string): boolean {
  return ROLE_ROUTES.has(path);
}

export function mountRoleRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/role":
      renderRoleListPage(container);
      return;
    case "/role/matrix":
      renderRoleMatrixPage(container);
      return;
    case "/role/assign":
      renderAssignRolePage(container);
      return;
    case "/role/agent":
      renderAgentRolePermissionsPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown role route: ${path}</div></div>`;
  }
}
