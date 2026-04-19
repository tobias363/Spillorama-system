// Audit tab — GET /api/admin/players/:id/audit.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { getPlayerAudit, type AuditEvent } from "../../../api/admin-players.js";
import { escapeHtml, formatDateTime } from "../shared.js";

export function mountAuditTab(host: HTMLElement, userId: string): void {
  host.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
  void (async () => {
    try {
      const res = await getPlayerAudit(userId);
      if (res.events.length === 0) {
        host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
        return;
      }
      DataTable.mount<AuditEvent>(host, {
        className: "table-striped",
        columns: [
          {
            key: "createdAt",
            title: t("date_time"),
            render: (r) => escapeHtml(formatDateTime(r.createdAt)),
          },
          { key: "action", title: t("action"), render: (r) => escapeHtml(r.action) },
          { key: "actorType", title: t("actor"), render: (r) => escapeHtml(r.actorType) },
          { key: "actorId", title: t("actor_id"), render: (r) => escapeHtml(r.actorId ?? "—") },
          {
            key: "details",
            title: t("details"),
            render: (r) =>
              `<code style="font-size:11px;">${escapeHtml(JSON.stringify(r.details ?? {}))}</code>`,
          },
        ],
        rows: res.events,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      host.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  })();
}
