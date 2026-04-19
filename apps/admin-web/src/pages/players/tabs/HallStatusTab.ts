// Hall-status tab — GET/PUT /api/admin/players/:id/hall-status.
// Admin can enable/disable player per hall with audit-logged reason.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  listHallStatus,
  setHallStatus,
  type PlayerHallStatus,
} from "../../../api/admin-players.js";
import { escapeHtml, formatDateTime } from "../shared.js";

export function mountHallStatusTab(host: HTMLElement, userId: string): void {
  host.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;

  async function load(): Promise<void> {
    try {
      const res = await listHallStatus(userId);
      if (res.statuses.length === 0) {
        host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_hall_status"))}</p>`;
        return;
      }
      DataTable.mount<PlayerHallStatus>(host, {
        className: "table-striped",
        columns: [
          { key: "hallId", title: t("hall_id"), render: (r) => escapeHtml(r.hallId) },
          { key: "hallName", title: t("hall_name"), render: (r) => escapeHtml(r.hallName ?? "—") },
          {
            key: "isActive",
            title: t("state"),
            render: (r) =>
              r.isActive
                ? `<span class="label label-success">${escapeHtml(t("hall_status_active"))}</span>`
                : `<span class="label label-danger">${escapeHtml(t("hall_status_inactive"))}</span>`,
          },
          {
            key: "updatedAt",
            title: t("updated_at"),
            render: (r) => escapeHtml(formatDateTime(r.updatedAt)),
          },
          { key: "reason", title: t("rejection_reason"), render: (r) => escapeHtml(r.reason ?? "—") },
          {
            key: "hallId",
            title: t("action"),
            render: (r) => {
              const action = r.isActive ? "disable" : "enable";
              const variant = r.isActive ? "warning" : "success";
              const label = r.isActive ? t("disable") : t("enable");
              return `<button class="btn btn-${variant} btn-xs" data-hall="${escapeHtml(r.hallId)}" data-action="${action}">
                ${escapeHtml(label)}
              </button>`;
            },
          },
        ],
        rows: res.statuses,
        emptyMessage: t("no_hall_status"),
      });

      host.querySelectorAll<HTMLButtonElement>("button[data-hall]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const hallId = btn.dataset.hall!;
          const action = btn.dataset.action!;
          const nextActive = action === "enable";
          const reason = window.prompt(t("reason_optional") + " (" + t("toggle_hall_status") + ")") || undefined;
          btn.disabled = true;
          try {
            await setHallStatus(userId, hallId, nextActive, reason);
            Toast.success(t("hall_status_updated"));
            await load();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      host.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  void load();
}
