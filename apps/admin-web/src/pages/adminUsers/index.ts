// PR-A5 (BIN-663) — admin/user/agent dispatcher.
//
// Routes owned (add/edit use hash-regex for :id segment — same pattern as
// games-dispatcher):
//   /adminUser                    → AdminListPage
//   /adminUser/add                → UserFormPage (variant="admin")
//   /adminUser/edit/:id           → UserFormPage (variant="admin", edit)
//   /adminUser/editRole/:id       → AdminEditRolePage   (added in commit 4)
//   /agent                        → AgentListPage       (added in commit 3)
//   /agent/add                    → AgentFormPage       (added in commit 3)
//   /agent/edit/:id               → AgentFormPage       (added in commit 3)
//   /user                         → UserListPage
//   /user/add                     → UserFormPage (variant="user")
//   /user/edit/:id                → UserFormPage (variant="user", edit)

import { renderAdminListPage } from "./AdminListPage.js";
import { renderUserFormPage } from "./UserFormPage.js";
import { renderUserListPage } from "./UserListPage.js";
import { renderAgentListPage } from "./AgentListPage.js";
import { renderAgentFormPage } from "./AgentFormPage.js";
import { renderAdminEditRolePage } from "./AdminEditRolePage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const STATIC_ROUTES = new Set<string>([
  "/adminUser",
  "/adminUser/add",
  "/agent",
  "/agent/add",
  "/user",
  "/user/add",
]);

const ADMIN_EDIT_RE = /^\/adminUser\/edit\/[^/]+$/;
const ADMIN_EDIT_ROLE_RE = /^\/adminUser\/editRole\/[^/]+$/;
const AGENT_EDIT_RE = /^\/agent\/edit\/[^/]+$/;
const USER_EDIT_RE = /^\/user\/edit\/[^/]+$/;

export function isAdminUsersRoute(path: string): boolean {
  if (STATIC_ROUTES.has(path)) return true;
  return (
    ADMIN_EDIT_RE.test(path) ||
    ADMIN_EDIT_ROLE_RE.test(path) ||
    AGENT_EDIT_RE.test(path) ||
    USER_EDIT_RE.test(path)
  );
}

function extractId(path: string, prefix: string): string | null {
  const rest = path.slice(prefix.length);
  const id = rest.split("/")[0];
  return id ? decodeURIComponent(id) : null;
}

export function mountAdminUsersRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";

  if (path === "/adminUser") return renderAdminListPage(container);
  if (path === "/adminUser/add") return renderUserFormPage(container, { variant: "admin", editId: null });
  if (ADMIN_EDIT_RE.test(path)) {
    return renderUserFormPage(container, {
      variant: "admin",
      editId: extractId(path, "/adminUser/edit/"),
    });
  }
  if (ADMIN_EDIT_ROLE_RE.test(path)) {
    return renderAdminEditRolePage(container, extractId(path, "/adminUser/editRole/"));
  }

  if (path === "/agent") return renderAgentListPage(container);
  if (path === "/agent/add") return renderAgentFormPage(container, null);
  if (AGENT_EDIT_RE.test(path)) {
    return renderAgentFormPage(container, extractId(path, "/agent/edit/"));
  }

  if (path === "/user") return renderUserListPage(container);
  if (path === "/user/add") return renderUserFormPage(container, { variant: "user", editId: null });
  if (USER_EDIT_RE.test(path)) {
    return renderUserFormPage(container, {
      variant: "user",
      editId: extractId(path, "/user/edit/"),
    });
  }

  container.innerHTML = renderUnknownRoute("admin-users", path);
}
