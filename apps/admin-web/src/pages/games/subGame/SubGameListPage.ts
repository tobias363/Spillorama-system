//
// Legacy layout:
//   - Content-header with title "Sub Game [ Game 1 ] Table" + breadcrumb
//   - Panel with "Sub Game [ Game 1 ]" heading + right-aligned "Add Sub Game" button
//   - DataTable with 5 cols: Game Name, Number of Pattern/Rows, Status, Creation Date, Action
//   - Action column: View / Edit / Delete
//
// Wired to BIN-621 backend per admin-sub-games API.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import {
  fetchSubGameList,
  deleteSubGame,
  type SubGameRow,
} from "./SubGameState.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import { isDropdownVisible } from "../common/types.js";

export async function renderSubGameListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>("#subGame-list-table");
  if (!tableHost) return;

  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;

  await loadAndRender(tableHost);
}

async function loadAndRender(tableHost: HTMLElement): Promise<void> {
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
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
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
                <a href="#/subGame/add"
                  class="btn btn-primary btn-md"
                  data-action="add-sub-game">
                  <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_sub_game"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
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
          <a href="#/subGame/edit/${encodeURIComponent(row._id)}"
             class="btn btn-warning btn-xs btn-rounded m-lr-3"
             title="${escapeHtml(t("edit"))}">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </a>
          <button type="button"
             class="btn btn-danger btn-xs btn-rounded"
             title="${escapeHtml(t("confirm_delete"))}"
             data-action="delete-sub-game"
             data-id="${escapeHtml(row._id)}"
             data-name="${escapeHtml(row.gameName)}">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });

  // Wire delete buttons
  host.querySelectorAll<HTMLButtonElement>('button[data-action="delete-sub-game"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = btn.dataset.id;
      const name = btn.dataset.name ?? "";
      if (!id) return;
      if (!window.confirm(`${t("confirm_delete")}\n${name}`)) return;
      void handleDelete(host, id);
    });
  });
}

async function handleDelete(tableHost: HTMLElement, id: string): Promise<void> {
  try {
    const result = await deleteSubGame(id);
    if ("ok" in result && result.ok) {
      Toast.success(t("sub_game_deleted"));
      await loadAndRender(tableHost);
      return;
    }
    if ("reason" in result) {
      Toast.error(result.message ?? t("something_went_wrong"));
      return;
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
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
