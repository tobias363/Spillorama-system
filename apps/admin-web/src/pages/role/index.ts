// PR-A5 (BIN-663) — role dispatcher (read-only static role display + assign).
//
// Routes:
//   /role           → RoleListPage      (5 static roles + description + banner)
//   /role/matrix    → RoleMatrixPage    (permission grid per role, read-only)
//   /role/assign    → AssignRolePage    (user-role assignment, write-enabled)
//
// Dynamic role-CRUD is deferred to post-pilot (Linear BIN-667) — we deliver
// read-only visualisation + existing PUT /api/admin/users/:id/role write
// endpoint for role-assignment.

import { renderRoleListPage } from "./RoleListPage.js";
import { renderRoleMatrixPage } from "./RoleMatrixPage.js";
import { renderAssignRolePage } from "./AssignRolePage.js";

const ROLE_ROUTES = new Set<string>(["/role", "/role/matrix", "/role/assign"]);

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
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown role route: ${path}</div></div>`;
  }
}
