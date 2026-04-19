// PR-A5 (BIN-663) — /role.
// Read-only list of the five static AdminAccessPolicy roles.
// Port of legacy/unity-backend/App/Views/role/list.html.
//
// Unlike legacy (which stored dynamic role documents in MongoDB), the new
// backend uses a static enum (ADMIN|SUPPORT|HALL_OPERATOR|AGENT|PLAYER) with
// hard-coded permission matrix in AdminAccessPolicy.ts. We render an info-
// banner pointing to BIN-667 for dynamic role-CRUD post-pilot.

import { t } from "../../i18n/I18n.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  roleLabel,
} from "../adminUsers/shared.js";

interface StaticRoleInfo {
  role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "AGENT" | "PLAYER";
  descriptionKey: string;
}

const STATIC_ROLES: readonly StaticRoleInfo[] = [
  { role: "ADMIN", descriptionKey: "role_desc_admin" },
  { role: "SUPPORT", descriptionKey: "role_desc_support" },
  { role: "HALL_OPERATOR", descriptionKey: "role_desc_hall_operator" },
  { role: "AGENT", descriptionKey: "role_desc_agent" },
  { role: "PLAYER", descriptionKey: "role_desc_player" },
];

export function renderRoleListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("role_list_title", "role_management")}
    <section class="content">
      <div class="callout callout-info" data-testid="role-info-banner">
        <i class="fa fa-info-circle"></i>
        ${escapeHtml(t("role_info_static_banner"))}
      </div>
      ${boxOpen("role_list_title", "primary")}
        <table class="table table-bordered table-striped" data-testid="role-list-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("role"))}</th>
              <th>${escapeHtml(t("description"))}</th>
              <th class="text-center">${escapeHtml(t("action"))}</th>
            </tr>
          </thead>
          <tbody>
            ${STATIC_ROLES.map(
              (r) => `
              <tr data-role="${escapeHtml(r.role)}">
                <td><strong>${escapeHtml(roleLabel(r.role))}</strong></td>
                <td>${escapeHtml(t(r.descriptionKey))}</td>
                <td class="text-center">
                  <a class="btn btn-info btn-xs" href="#/role/matrix" data-action="view-matrix">
                    <i class="fa fa-table"></i> ${escapeHtml(t("role_matrix_title"))}
                  </a>
                </td>
              </tr>`
            ).join("")}
          </tbody>
        </table>
        <p>
          <a class="btn btn-primary" href="#/role/assign" data-action="assign-role">
            <i class="fa fa-user-plus"></i> ${escapeHtml(t("assign_role_title"))}
          </a>
        </p>
      ${boxClose()}
    </section>`;
}
