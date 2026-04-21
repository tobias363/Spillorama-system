//
// Legacy layout: panel with DataTable of saved-game snapshots, Add button,
// per-row View / Edit / Delete actions.
//
// Port notes:
//   - List empty until BIN-624 backend ships; shows informative banner.
//   - Add/Edit/Delete are BIN-624 placeholders.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { escapeHtml } from "../common/escape.js";
import { fetchSavedGameList, type SavedGameRow } from "./SavedGameState.js";

export async function renderSavedGameListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  const tableHost = container.querySelector<HTMLElement>("#saved-game-list-table");
  if (!tableHost) return;
  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const rows = await fetchSavedGameList();
    renderTable(tableHost, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("saved_game_list"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("saved_game_list"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("saved_game_list"))}</h6></div>
              <div class="pull-right">
                <button type="button" class="btn btn-primary btn-md" disabled
                  title="Venter på backend-endpoint — BIN-624">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add_game"))}
                  <small style="opacity:0.75;margin-left:6px;">(BIN-624)</small>
                </button>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning" style="margin:0 0 12px;">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint.
                  <strong>BIN-624</strong> SavedGame CRUD må leveres før listen viser data.
                </div>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="saved-game-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(host: HTMLElement, rows: SavedGameRow[]): void {
  DataTable.mount(host, {
    className: "saved-game-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "name", title: t("game_name") },
      {
        key: "status",
        title: t("status"),
        render: (r) =>
          r.status === "active"
            ? `<span style="color:green;">${escapeHtml(t("active"))}</span>`
            : `<span style="color:red;">${escapeHtml(t("inactive"))}</span>`,
      },
      { key: "createdAt", title: t("creation_date_time") },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (r) => `
          <a href="#/savedGameList/${encodeURIComponent(r.gameTypeId)}/view/${encodeURIComponent(r._id)}"
             class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view"))}">
            <i class="fa fa-eye"></i>
          </a>
          <button type="button" class="btn btn-warning btn-xs btn-rounded m-lr-3" disabled
            title="Venter på backend-endpoint — BIN-624">
            <i class="fa fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-xs btn-rounded" disabled
            title="Venter på backend-endpoint — BIN-624">
            <i class="fa fa-trash"></i>
          </button>`,
      },
    ],
  });
}
