// PR-B2: Pending KYC requests list — port of
// Source: GET /api/admin/players/pending.

import { t } from "../../i18n/I18n.js";
import { DataTable } from "../../components/DataTable.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { listPending, type PlayerSummary } from "../../api/admin-players.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatDateTime,
  viewPendingHash,
} from "../players/shared.js";

export function renderPendingListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("pending_requests_table", t("pending_requests"))}
    <section class="content">
      ${boxOpen("pending_requests_table", "warning")}
        <div class="box-tools pull-right" style="margin-bottom:8px;">
          <button class="btn btn-default btn-sm" id="pending-refresh">
            <i class="fa fa-refresh"></i> ${escapeHtml(t("refresh"))}
          </button>
        </div>
        <div id="pending-table"><p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p></div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#pending-table")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("#pending-refresh")!;

  function renderRows(rows: PlayerSummary[]): void {
    if (rows.length === 0) {
      tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("no_data_available_in_table"))}</p>`;
      return;
    }
    DataTable.mount<PlayerSummary>(tableHost, {
      className: "table-striped",
      columns: [
        { key: "id", title: t("customer_number"), render: (r) => escapeHtml(r.id.slice(-8)) },
        {
          key: "displayName",
          title: t("username"),
          render: (r) =>
            `<a href="${viewPendingHash(r.id)}">${escapeHtml(r.displayName || r.email)}</a>`,
        },
        {
          key: "createdAt",
          title: t("request_date_time"),
          render: (r) => escapeHtml(formatDateTime(r.createdAt)),
        },
        { key: "email", title: t("email_address"), render: (r) => escapeHtml(r.email) },
        { key: "phone", title: t("mobile_number"), render: (r) => escapeHtml(r.phone ?? "—") },
        { key: "hallId", title: t("hall_name"), render: (r) => escapeHtml(r.hallId ?? "—") },
        {
          key: "kycStatus",
          title: t("status"),
          render: () =>
            `<span class="label label-warning">${escapeHtml(t("kyc_status_pending"))}</span>`,
        },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (r) =>
            `<a href="${viewPendingHash(r.id)}" class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view_player"))}">
               <i class="fa fa-eye"></i>
             </a>`,
        },
      ],
      rows,
      emptyMessage: t("no_data_available_in_table"),
    });
  }

  async function load(): Promise<void> {
    tableHost.innerHTML = `<p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await listPending();
      renderRows(res.players);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<p class="text-danger">${escapeHtml(msg)}</p>`;
    }
  }

  refreshBtn.addEventListener("click", () => void load());
  void load();
}
