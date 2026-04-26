//
// Legacy layout: panel with DataTable of saved-game snapshots, Add button,
// per-row View / Edit / Delete actions.
//
// Wired to BIN-624 backend per admin-saved-games API.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchSavedGameList,
  deleteSavedGame,
  loadSavedGameToGame,
  type SavedGameRow,
} from "./SavedGameState.js";
import { ApiError } from "../../../api/client.js";

export async function renderSavedGameListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  const tableHost = container.querySelector<HTMLElement>("#saved-game-list-table");
  if (!tableHost) return;
  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
  await loadAndRender(tableHost);
}

async function loadAndRender(tableHost: HTMLElement): Promise<void> {
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
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("saved_game_list"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("saved_game_list"))}</h6></div>
              <div class="pull-right">
                <a href="#/gameManagement" class="btn btn-primary btn-md"
                  data-action="back-to-gm">
                  <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_game"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
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
            <i class="fa fa-eye" aria-hidden="true"></i>
          </a>
          <button type="button"
            class="btn btn-success btn-xs btn-rounded m-lr-3"
            data-action="load-saved-game"
            data-id="${escapeHtml(r._id)}"
            data-name="${escapeHtml(r.name)}"
            title="${escapeHtml(t("load_to_game"))}">
            <i class="fa fa-cloud-download" aria-hidden="true"></i>
          </button>
          <a href="#/savedGameList/${encodeURIComponent(r.gameTypeId)}/edit/${encodeURIComponent(r._id)}"
             class="btn btn-warning btn-xs btn-rounded"
             title="${escapeHtml(t("edit"))}">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </a>
          <button type="button" class="btn btn-danger btn-xs btn-rounded m-lr-3"
            data-action="delete-saved-game"
            data-id="${escapeHtml(r._id)}"
            data-name="${escapeHtml(r.name)}"
            title="${escapeHtml(t("confirm_delete"))}">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });

  host.querySelectorAll<HTMLButtonElement>('button[data-action="delete-saved-game"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = btn.dataset.id;
      const name = btn.dataset.name ?? "";
      if (!id) return;
      if (!window.confirm(`${t("confirm_delete")}\n${name}`)) return;
      void handleDelete(host, id);
    });
  });

  host.querySelectorAll<HTMLButtonElement>('button[data-action="load-saved-game"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = btn.dataset.id;
      if (!id) return;
      void handleLoad(btn, id);
    });
  });
}

async function handleDelete(tableHost: HTMLElement, id: string): Promise<void> {
  try {
    const result = await deleteSavedGame(id);
    if ("ok" in result && result.ok) {
      Toast.success(t("saved_game_deleted"));
      await loadAndRender(tableHost);
      return;
    }
    if ("reason" in result) {
      Toast.error(result.message ?? t("something_went_wrong"));
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

async function handleLoad(btn: HTMLButtonElement, id: string): Promise<void> {
  btn.disabled = true;
  try {
    const payload = await loadSavedGameToGame(id);
    if (!payload) {
      Toast.error(t("not_found"));
      return;
    }
    Toast.success(t("saved_game_loaded"));
    // Navigate to GameManagement add page with gameTypeId scoped.
    window.location.hash = `#/gameManagement/${encodeURIComponent(payload.gameTypeId)}/add`;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  } finally {
    btn.disabled = false;
  }
}
