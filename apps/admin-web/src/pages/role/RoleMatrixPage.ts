// PR-A5 (BIN-663) — /role/matrix.
// Read-only permission grid per static role.
// but wired to GET /api/admin/permissions so grid reflects backend truth.
//
// Rows: AdminPermission keys. Columns: 5 static roles. Cell: granted/denied.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  getAdminPermissions,
  type UserRole,
} from "../../api/admin-users.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  roleLabel,
} from "../adminUsers/shared.js";

const COLUMN_ROLES: readonly UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "AGENT", "PLAYER"];

export function renderRoleMatrixPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("role_matrix_title", "role_management")}
    <section class="content">
      <div class="callout callout-info">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("role_info_static_banner"))}
      </div>
      ${boxOpen("role_matrix_title", "primary")}
        <div id="role-matrix-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#role-matrix-host")!;
  void render(host);
}

async function render(host: HTMLElement): Promise<void> {
  try {
    const resp = await getAdminPermissions();
    const permissions = Object.keys(resp.policy).sort();

    const header = `
      <tr>
        <th>${escapeHtml(t("permission"))}</th>
        ${COLUMN_ROLES.map(
          (r) => `<th class="text-center">${escapeHtml(roleLabel(r))}</th>`
        ).join("")}
      </tr>`;

    const rows = permissions
      .map((perm) => {
        const allowed = resp.policy[perm] ?? [];
        const cells = COLUMN_ROLES.map((role) => {
          const granted = allowed.includes(role);
          const label = granted ? t("granted") : t("denied");
          const cls = granted ? "label-success" : "label-default";
          const icon = granted ? "fa-check" : "fa-minus";
          return `<td class="text-center" data-role="${escapeHtml(role)}" data-perm="${escapeHtml(perm)}"
                      data-granted="${granted ? "true" : "false"}">
                    <span class="label ${cls}"><i class="fa ${icon}" aria-hidden="true"></i> ${escapeHtml(label)}</span>
                  </td>`;
        }).join("");
        return `<tr><td><code>${escapeHtml(perm)}</code></td>${cells}</tr>`;
      })
      .join("");

    host.innerHTML = `
      <table class="table table-bordered table-condensed" data-testid="role-matrix-table">
        <thead>${header}</thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
    host.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
  }
}
