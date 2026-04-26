// PR-A5 (BIN-663) — /user list (SUPPORT + HALL_OPERATOR roles).
//
// Data:
//   GET /api/admin/users?role=SUPPORT   ∪   ?role=HALL_OPERATOR
//   (backend filters one role at a time — api/admin-users.ts wraps both calls)
//   DELETE /api/admin/users/:id

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listAdminUsersMultiRole,
  deleteAdminUser,
  type AdminUser,
} from "../../api/admin-users.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, roleLabel } from "./shared.js";

export function renderUserListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("user_management", "user_management")}
    <section class="content">
      ${boxOpen("user_management", "primary")}
        <div id="user-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#user-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listAdminUsersMultiRole(["SUPPORT", "HALL_OPERATOR"]);
      DataTable.mount<AdminUser>(tableHost, {
        id: "user-datatable",
        columns: [
          {
            key: "displayName",
            title: t("name"),
            render: (r) => escapeHtml(`${r.displayName}${r.surname ? " " + r.surname : ""}`),
          },
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
            addBtn.setAttribute("data-action", "add-user");
            addBtn.href = "#/user/add";
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_user"))}`;
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
  edit.setAttribute("data-action", "edit-user");
  edit.setAttribute("data-id", row.id);
  edit.href = `#/user/edit/${encodeURIComponent(row.id)}`;
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.title = t("edit_user");
  edit.setAttribute("aria-label", t("edit_user"));
  wrap.append(edit);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger btn-xs";
  del.setAttribute("data-action", "delete-user");
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
