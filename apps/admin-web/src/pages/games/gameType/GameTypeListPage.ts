//
// Legacy layout:
//   - Content-header with title + breadcrumb (Dashboard → Spilltabell)
//   - Panel with "Games" heading + right-aligned "Add Game" button (permission-gated)
//   - DataTable with 5 cols: Name, Photo, Row, Column, Action
//   - Action column: View / Edit buttons (superadmin sees both; non-super gated)
//
// Port notes:
//   - DataTables.net server-side was unnecessary — our list is small (<10 entries)
//     and the platform-games endpoint returns the full set; we render client-side.
//   - Delete was commented out in legacy (line 156-160) — we omit it.
//   - Add/Edit write-ops are BIN-620 placeholders — Add button shows informative
//     disabled-state.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { fetchGameTypeList } from "./GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderGameTypeListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>("#gameType-list-table");
  if (!tableHost) return;

  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;

  try {
    const rows = await fetchGameTypeList();
    renderTable(tableHost, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderShell(): string {
  // Title: {{game.game_table}} → "Spilltabell".
  // Add-button is BIN-620 placeholder — disabled with tooltip.
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("game_table"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("game_table"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("games"))}</h6></div>
              <div class="pull-right">
                <button type="button"
                  class="btn btn-primary btn-md"
                  disabled
                  title="Venter på backend-endpoint — BIN-620">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add_game"))}
                  <small style="opacity:0.75;margin-left:6px;">(BIN-620)</small>
                </button>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <div id="gameType-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(host: HTMLElement, rows: GameType[]): void {
  DataTable.mount(host, {
    className: "gameType-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "name", title: t("game_name") },
      {
        key: "photo",
        title: t("photo"),
        render: (row) => `
          <div class="image imagewidthSet fix_list_img">
            <img src="/profile/bingo/${encodeURIComponent(row.photo)}" alt="${escapeHtml(row.name)}" style="max-height:40px"/>
          </div>`,
      },
      { key: "row", title: t("row"), align: "center" },
      { key: "columns", title: t("column"), align: "center" },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (row) => `
          <a href="#/gameType/view/${encodeURIComponent(row._id)}"
             class="btn btn-info btn-xs btn-rounded"
             title="${escapeHtml(t("view_game"))}">
            <i class="fa fa-eye" aria-hidden="true"></i>
          </a>
          <button type="button"
            class="btn btn-warning btn-xs btn-rounded"
            disabled
            title="Venter på backend-endpoint — BIN-620">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });
}
