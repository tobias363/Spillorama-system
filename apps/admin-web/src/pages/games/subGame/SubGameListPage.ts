//
// Legacy layout:
//   - Content-header with title "Sub Game [ Game 1 ] Table" + breadcrumb
//   - Panel with "Sub Game [ Game 1 ]" heading + right-aligned "Add Sub Game" button
//     (permission-gated by `addFlag`)
//   - DataTable with 5 cols: Game Name, Number of Pattern/Rows, Status, Creation Date, Action
//   - Action column: View / Edit / Delete — all BIN-621 placeholders in PR-A3
//
// Port notes:
//   - DataTables.net server-side in legacy; in PR-A3 we render client-side with
//     the shared DataTable component since the sub-game table is small.
//   - The list is empty until BIN-621 lands the backend endpoint — shows the
//     legacy empty-state translation.
//   - Game 4 rows filtered via GAME_TYPE_HIDDEN_FROM_DROPDOWN (no-op today since
//     legacy sub-games were always Game 1 anyway, but keeps the invariant
//     explicit).

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { fetchSubGameList, type SubGameRow } from "./SubGameState.js";
import { escapeHtml } from "../common/escape.js";
import { isDropdownVisible } from "../common/types.js";

export async function renderSubGameListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>("#subGame-list-table");
  if (!tableHost) return;

  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;

  try {
    const rows = await fetchSubGameList();
    // Game 4 guard: drop rows whose gameTypeRef resolves to hidden types.
    const visible = rows.filter((r) => !r.gameTypeRef || isDropdownVisible(r.gameTypeRef));
    renderTable(tableHost, visible);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderShell(): string {
  // Title: "Sub Game [ Game 1 ] Table" → we use the generic "sub_game" + qualifier,
  // matching the legacy NO translation ("Underspill").
  const title = `${t("sub_game")} [ ${t("game1")} ] — ${t("sub_game_table")}`;
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("sub_game"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left">
                <h6 class="panel-title txt-dark">${escapeHtml(t("sub_game"))} [ ${escapeHtml(t("game1"))} ]</h6>
              </div>
              <div class="pull-right">
                <button type="button"
                  class="btn btn-primary btn-md"
                  disabled
                  title="Venter på backend-endpoint — BIN-621">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add_sub_game"))}
                  <small style="opacity:0.75;margin-left:6px;">(BIN-621)</small>
                </button>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning" style="margin:0 0 12px;">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint.
                  <strong>BIN-621</strong> SubGame CRUD må leveres før listen viser data.
                </div>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="subGame-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(host: HTMLElement, rows: SubGameRow[]): void {
  DataTable.mount(host, {
    className: "subGame-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "gameName", title: t("game_name") },
      {
        key: "patternRow",
        title: t("number_of_pattern_rows"),
        align: "center",
        render: (row) => String(row.patternRow.length),
      },
      {
        key: "status",
        title: t("status"),
        render: (row) =>
          row.status === "active"
            ? `<span style="color:green;">${escapeHtml(t("active"))}</span>`
            : `<span style="color:red;">${escapeHtml(t("inactive"))}</span>`,
      },
      {
        key: "createdAt",
        title: t("creation_date_time"),
        render: (row) => formatLegacyDateTime(row.createdAt),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (row) => `
          <a href="#/subGame/view/${encodeURIComponent(row._id)}"
             class="btn btn-info btn-xs btn-rounded"
             title="${escapeHtml(t("view"))}">
            <i class="fa fa-eye" aria-hidden="true"></i>
          </a>
          <button type="button"
            class="btn btn-warning btn-xs btn-rounded m-lr-3"
            disabled
            title="Venter på backend-endpoint — BIN-621">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </button>
          <button type="button"
            class="btn btn-danger btn-xs btn-rounded"
            disabled
            title="Venter på backend-endpoint — BIN-621">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });
}

/**
 * Legacy `gamelist.html:108-124` date render — kept 1:1 for pixel-paritet.
 * Outputs e.g. "2026/04/19 02:15 pm".
 *
 * Exported for unit testing — DST/boundary cases in subGamePages.test.ts.
 */
export function formatLegacyDateTime(raw: string): string {
  if (!raw) return "—";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return "—";
  const year = dt.getFullYear();
  const monthNum = dt.getMonth() + 1;
  const month = monthNum < 10 ? `0${monthNum}` : String(monthNum);
  const date = dt.getDate();
  let hours = dt.getHours();
  const minsNum = dt.getMinutes();
  const mins = minsNum < 10 ? `0${minsNum}` : String(minsNum);
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  hours = hours || 12;
  return `${year}/${month}/${date} ${hours}:${mins} ${ampm}`;
}
