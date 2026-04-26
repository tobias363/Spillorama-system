// PR-B6 (BIN-664) — Blocked-IP list (admin-only).
//
// Data:
//   GET    /api/admin/security/blocked-ips              → ListBlockedIpsResponse
//   POST   /api/admin/security/blocked-ips              → add (SECURITY_WRITE)
//   DELETE /api/admin/security/blocked-ips/:id          → delete (SECURITY_WRITE)
//
// Edit: backend has no PATCH. Frontend does DELETE + POST (GAP-G1 in
// PR-B6-PLAN §2.1). Two audit-events is MORE traceable than one in-place
// PATCH — acceptable per PM decision.
//
// Regulatorisk:
//   - SECURITY_READ for listing (ADMIN, HALL_OPERATOR, SUPPORT)
//   - SECURITY_WRITE for mutations (ADMIN only)
//   - All mutations audit-logged by backend (adminSecurity.ts:257-295)
//   - Fail-closed: backend-500 shows callout-danger, NOT a silent empty list.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listBlockedIps,
  deleteBlockedIp,
  type BlockedIp,
} from "../../api/admin-security-blocked-ips.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";
import { openAddBlockedIpModal } from "./AddBlockedIpPage.js";

interface PageState {
  rows: BlockedIp[];
}

export function renderBlockedIpsPage(container: HTMLElement): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Security Management", "edit");

  container.innerHTML = `
    ${contentHeader("blocked_ip_table")}
    <section class="content">
      ${boxOpen("blocked_ip", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-12 text-right">
            ${
              canWrite
                ? `<button type="button" class="btn btn-primary" data-action="add-blocked-ip">
                    <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_blocked_ip"))}
                  </button>`
                : ""
            }
          </div>
        </div>
        <div id="blocked-ips-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#blocked-ips-table")!;
  container
    .querySelector<HTMLButtonElement>('[data-action="add-blocked-ip"]')
    ?.addEventListener("click", () => openAddBlockedIpModal(null, () => void refresh()));

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listBlockedIps();
      state.rows = res.ips;
      DataTable.mount<BlockedIp>(tableHost, {
        id: "blocked-ips-datatable",
        columns: [
          {
            key: "ipAddress",
            title: t("ip_address"),
            render: (r) => escapeHtml(r.ipAddress),
          },
          {
            key: "reason",
            title: t("reason"),
            render: (r) => escapeHtml(r.reason ?? ""),
          },
          {
            key: "createdAt",
            title: t("created_at"),
            render: (r) => escapeHtml(new Date(r.createdAt).toISOString().slice(0, 10)),
          },
          {
            key: "expiresAt",
            title: t("expires_at"),
            render: (r) =>
              r.expiresAt ? escapeHtml(new Date(r.expiresAt).toISOString().slice(0, 10)) : "",
          },
          ...(canWrite
            ? [
                {
                  key: "id" as const,
                  title: t("action"),
                  align: "center" as const,
                  render: (r: BlockedIp) => renderActions(r),
                },
              ]
            : []),
        ],
        rows: state.rows,
        emptyMessage: t("no_data_available_in_table"),
        csvExport: {
          filename: "blocked-ips",
          transform: (r) => ({
            id: r.id,
            ipAddress: r.ipAddress,
            reason: r.reason ?? "",
            blockedBy: r.blockedBy ?? "",
            expiresAt: r.expiresAt ?? "",
            createdAt: r.createdAt,
          }),
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function renderActions(row: BlockedIp): Node {
    const wrap = document.createElement("div");
    wrap.style.whiteSpace = "nowrap";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-warning btn-xs";
    edit.setAttribute("data-action", "edit-blocked-ip");
    edit.setAttribute("data-id", row.id);
    edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
    edit.title = t("edit_blocked_ip");
    edit.setAttribute("aria-label", t("edit_blocked_ip"));
    edit.addEventListener("click", () =>
      openAddBlockedIpModal(row, () => void refresh())
    );
    wrap.append(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.setAttribute("data-action", "delete-blocked-ip");
    del.setAttribute("data-id", row.id);
    del.innerHTML = ` <i class="fa fa-trash" aria-hidden="true"></i>`;
    del.title = t("delete_button");
    del.setAttribute("aria-label", t("delete_button"));
    del.style.marginLeft = "4px";
    del.addEventListener("click", () => openDeleteModal(row));
    wrap.append(del);
    return wrap;
  }

  function openDeleteModal(row: BlockedIp): void {
    Modal.open({
      title: t("are_you_sure"),
      content: `<p>${escapeHtml(t("you_will_not_be_able_to_recover_this_request"))}</p>
        <p><strong>${escapeHtml(row.ipAddress)}</strong></p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("delete_button"),
          variant: "danger",
          action: "confirm",
          onClick: async () => {
            try {
              await deleteBlockedIp(row.id);
              Toast.success(t("delete_button"));
              await refresh();
            } catch (err) {
              Toast.error(
                err instanceof ApiError ? err.message : t("something_went_wrong")
              );
            }
          },
        },
      ],
    });
  }

  void refresh();
}
