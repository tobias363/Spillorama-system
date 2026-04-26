// PR-A5 (BIN-663) — /role/assign.
//
// Lists ADMIN/SUPPORT/HALL_OPERATOR users and lets an admin reassign the
// static role via PUT /api/admin/users/:id/role.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  listAdminUsersMultiRole,
  assignUserRole,
  type AdminUser,
  type UserRole,
} from "../../api/admin-users.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  roleLabel,
} from "../adminUsers/shared.js";

const ASSIGNABLE_ROLES: readonly UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT"];

export function renderAssignRolePage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("assign_role_title", "role_management")}
    <section class="content">
      ${boxOpen("assign_role_title", "primary")}
        <div id="assign-role-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#assign-role-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listAdminUsersMultiRole(["ADMIN", "SUPPORT", "HALL_OPERATOR"]);
      DataTable.mount<AdminUser>(tableHost, {
        id: "assign-role-datatable",
        columns: [
          {
            key: "displayName",
            title: t("name"),
            render: (r) => escapeHtml(`${r.displayName}${r.surname ? " " + r.surname : ""}`),
          },
          { key: "email", title: t("email"), render: (r) => escapeHtml(r.email) },
          {
            key: "role",
            title: t("current_role"),
            render: (r) => escapeHtml(roleLabel(r.role)),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "btn btn-primary btn-xs";
              btn.setAttribute("data-action", "update-role");
              btn.setAttribute("data-id", r.id);
              btn.innerHTML = `<i class="fa fa-key" aria-hidden="true"></i> ${escapeHtml(t("update_role"))}`;
              btn.addEventListener("click", () => openModal(r, () => void refresh()));
              return btn;
            },
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function openModal(user: AdminUser, onDone: () => void): void {
  const form = document.createElement("form");
  form.setAttribute("data-testid", "assign-role-form");
  form.innerHTML = `
    <div class="form-group">
      <label>${escapeHtml(t("current_role"))}</label>
      <p><strong>${escapeHtml(roleLabel(user.role))}</strong></p>
    </div>
    <div class="form-group">
      <label for="ar-role">${escapeHtml(t("new_role"))}</label>
      <select id="ar-role" name="role" class="form-control">
        ${ASSIGNABLE_ROLES.map(
          (r) =>
            `<option value="${escapeHtml(r)}"${r === user.role ? " selected" : ""}>${escapeHtml(roleLabel(r))}</option>`
        ).join("")}
      </select>
    </div>`;

  const instance = Modal.open({
    title: t("assign_role_title"),
    content: form,
    buttons: [
      { label: t("cancel"), variant: "default", action: "cancel" },
      {
        label: t("update_role"),
        variant: "primary",
        action: "submit",
        dismiss: false,
        onClick: async () => {
          const sel = form.querySelector<HTMLSelectElement>("#ar-role")!;
          const newRole = sel.value as UserRole;
          if (newRole === user.role) {
            instance.close("button");
            return;
          }
          try {
            await assignUserRole(user.id, newRole);
            Toast.success(t("success"));
            instance.close("button");
            onDone();
          } catch (err) {
            Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
          }
        },
      },
    ],
  });
}
