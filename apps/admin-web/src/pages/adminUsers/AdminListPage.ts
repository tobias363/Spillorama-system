// PR-A5 (BIN-663) — /adminUser list.
//
// Data:
//   GET /api/admin/users?role=ADMIN
//   DELETE /api/admin/users/:id
// Add/edit handled via navigation to /adminUser/add and /adminUser/edit/:id.
// Role-reassignment (/adminUser/editRole/:id) handled in AdminEditRolePage.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listAdminUsers,
  deleteAdminUser,
  resetAdminUserPassword,
  type AdminUser,
} from "../../api/admin-users.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, roleLabel } from "./shared.js";

export function renderAdminListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("admin_management", "admin_management")}
    <section class="content">
      ${boxOpen("admin_management", "primary")}
        <div id="admin-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#admin-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listAdminUsers({ role: "ADMIN" });
      DataTable.mount<AdminUser>(tableHost, {
        id: "admin-datatable",
        columns: [
          { key: "displayName", title: t("admin_name"), render: (r) => escapeHtml(`${r.displayName}${r.surname ? " " + r.surname : ""}`) },
          { key: "email", title: t("email"), render: (r) => escapeHtml(r.email) },
          { key: "role", title: t("role"), render: (r) => escapeHtml(roleLabel(r.role)) },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => rowActions(r, () => void refresh()),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const addBtn = document.createElement("a");
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-admin");
            addBtn.href = "#/adminUser/add";
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_admin"))}`;
            host.append(addBtn);
          },
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function rowActions(row: AdminUser, onChange: () => void): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const edit = document.createElement("a");
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "edit-admin");
  edit.setAttribute("data-id", row.id);
  edit.href = `#/adminUser/edit/${encodeURIComponent(row.id)}`;
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.title = t("edit_admin");
  edit.setAttribute("aria-label", t("edit_admin"));
  wrap.append(edit);

  const role = document.createElement("a");
  role.className = "btn btn-info btn-xs";
  role.setAttribute("data-action", "edit-role");
  role.setAttribute("data-id", row.id);
  role.href = `#/adminUser/editRole/${encodeURIComponent(row.id)}`;
  role.innerHTML = `<i class="fa fa-key" aria-hidden="true"></i>`;
  role.title = t("assign_role_to_admin");
  role.setAttribute("aria-label", t("assign_role_to_admin"));
  role.style.marginLeft = "4px";
  wrap.append(role);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn btn-default btn-xs";
  reset.setAttribute("data-action", "reset-password");
  reset.setAttribute("data-id", row.id);
  reset.innerHTML = `<i class="fa fa-envelope" aria-hidden="true"></i>`;
  reset.title = t("reset_password");
  reset.setAttribute("aria-label", t("reset_password"));
  reset.style.marginLeft = "4px";
  reset.addEventListener("click", () => {
    if (!window.confirm(t("are_you_sure"))) return;
    void (async () => {
      try {
        await resetAdminUserPassword(row.id);
        Toast.success(t("success"));
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      }
    })();
  });
  wrap.append(reset);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger btn-xs";
  del.setAttribute("data-action", "delete-admin");
  del.setAttribute("data-id", row.id);
  del.innerHTML = `<i class="fa fa-trash" aria-hidden="true"></i>`;
  del.title = t("delete");
  del.setAttribute("aria-label", t("delete"));
  del.style.marginLeft = "4px";
  del.addEventListener("click", () => {
    if (!window.confirm(t("delete_message"))) return;
    void (async () => {
      try {
        await deleteAdminUser(row.id);
        Toast.success(t("success"));
        onChange();
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      }
    })();
  });
  wrap.append(del);

  return wrap;
}
