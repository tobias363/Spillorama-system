// PR-A5 (BIN-663) — /adminUser/editRole/:id.
// Port of legacy/unity-backend/App/Views/admin/editRole.html.
//
// Shows the currently-assigned static role for the admin + the permission
// grid for the new role (read-only preview — matches static backend policy),
// and lets the admin reassign via PUT /api/admin/users/:id/role.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  getAdminUser,
  assignUserRole,
  getAdminPermissions,
  type AdminUser,
  type UserRole,
  type AdminPermissionsResponse,
} from "../../api/admin-users.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  roleLabel,
} from "./shared.js";

const ASSIGNABLE_ROLES: readonly UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT"];

export function renderAdminEditRolePage(container: HTMLElement, userId: string | null): void {
  container.innerHTML = `
    ${contentHeader("assign_role_to_admin", "admin_management")}
    <section class="content">
      ${boxOpen("assign_role_to_admin", "primary")}
        <div id="edit-role-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#edit-role-host")!;
  if (!userId) {
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(t("something_went_wrong"))}</div>`;
    return;
  }
  void mount(host, userId);
}

async function mount(host: HTMLElement, userId: string): Promise<void> {
  let user: AdminUser;
  let perms: AdminPermissionsResponse;
  try {
    [user, perms] = await Promise.all([getAdminUser(userId), getAdminPermissions()]);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    return;
  }

  let previewRole: UserRole = user.role;

  function render(): void {
    host.innerHTML = `
      <form id="edit-role-form" class="form-horizontal" data-testid="edit-role-form">
        <div class="form-group">
          <label class="col-sm-3 control-label">${escapeHtml(t("admin_name"))}</label>
          <div class="col-sm-9">
            <p class="form-control-static">${escapeHtml(`${user.displayName}${user.surname ? " " + user.surname : ""}`)}</p>
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-3 control-label">${escapeHtml(t("current_role"))}</label>
          <div class="col-sm-9">
            <p class="form-control-static"><strong>${escapeHtml(roleLabel(user.role))}</strong></p>
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-3 control-label" for="er-role">${escapeHtml(t("new_role"))}</label>
          <div class="col-sm-9">
            <select id="er-role" name="role" class="form-control" data-testid="edit-role-select">
              ${ASSIGNABLE_ROLES.map(
                (r) =>
                  `<option value="${escapeHtml(r)}"${r === previewRole ? " selected" : ""}>${escapeHtml(roleLabel(r))}</option>`
              ).join("")}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-3 control-label">${escapeHtml(t("permissions"))}</label>
          <div class="col-sm-9">
            <div class="callout callout-info" style="padding:8px;margin-bottom:8px;">
              <small>${escapeHtml(t("role_info_static_banner"))}</small>
            </div>
            <table class="table table-bordered table-condensed" data-testid="edit-role-preview-matrix">
              <thead><tr>
                <th>${escapeHtml(t("permission"))}</th>
                <th class="text-center">${escapeHtml(t("granted"))}</th>
              </tr></thead>
              <tbody>
                ${Object.keys(perms.policy)
                  .sort()
                  .map((perm) => {
                    const granted = (perms.policy[perm] ?? []).includes(previewRole);
                    const cls = granted ? "label-success" : "label-default";
                    const icon = granted ? "fa-check" : "fa-minus";
                    const label = granted ? t("granted") : t("denied");
                    return `<tr><td><code>${escapeHtml(perm)}</code></td>
                      <td class="text-center"><span class="label ${cls}"><i class="fa ${icon}"></i> ${escapeHtml(label)}</span></td></tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="form-group">
          <div class="col-sm-offset-3 col-sm-9">
            <button type="submit" class="btn btn-success" data-action="save-role">
              <i class="fa fa-save"></i> ${escapeHtml(t("update_role"))}
            </button>
            <a class="btn btn-default" href="#/adminUser">${escapeHtml(t("cancel"))}</a>
          </div>
        </div>
      </form>`;

    const form = host.querySelector<HTMLFormElement>("#edit-role-form")!;
    const select = form.querySelector<HTMLSelectElement>("#er-role")!;
    select.addEventListener("change", () => {
      previewRole = select.value as UserRole;
      render();
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void submit(user, previewRole);
    });
  }

  render();
}

async function submit(user: AdminUser, role: UserRole): Promise<void> {
  if (role === user.role) {
    Toast.success(t("success"));
    window.location.hash = "#/adminUser";
    return;
  }
  try {
    await assignUserRole(user.id, role);
    Toast.success(t("success"));
    window.location.hash = "#/adminUser";
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  }
}
