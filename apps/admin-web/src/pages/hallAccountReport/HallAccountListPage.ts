// PR-A4b (BIN-659) — /hallAccountReport list page.
//
// lines). Presents a list of halls as a link-grid that jumps to per-hall
// account history + settlement report.
//
// Backend: GET /api/admin/halls?includeInactive=true

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import { renderReportShell } from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

export async function renderHallAccountListPage(container: HTMLElement): Promise<void> {
  const tableHostId = "hall-account-list-table";
  container.innerHTML = renderReportShell({
    title: t("hall_account_report"),
    moduleTitleKey: "hall_account_report",
    tableHostId,
  });
  const host = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!host) return;

  try {
    const halls = await listHalls();
    DataTable.mount<AdminHall>(host, {
      rows: halls,
      emptyMessage: t("no_data_available_in_table"),
      className: "hall-account-list",
      columns: [
        { key: "id", title: t("hall_id") },
        { key: "name", title: t("hall_name") },
        {
          key: "id",
          title: t("actions"),
          align: "center",
          render: (row) => {
            const id = encodeURIComponent(row.id);
            return (
              `<a href="#/hallAccountReport/${id}" class="btn btn-info btn-xs btn-rounded" ` +
              `title="${escapeHtml(t("view"))}">` +
              `<i class="fa fa-eye" aria-hidden="true"></i></a> ` +
              `<a href="#/report/settlement/${id}" class="btn btn-danger btn-xs btn-rounded" ` +
              `title="${escapeHtml(t("settlement_report"))}">` +
              `<i class="fa fa-file" aria-hidden="true"></i></a>`
            );
          },
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}
