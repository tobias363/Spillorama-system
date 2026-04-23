//
// Legacy layout:
//   - Content-header with title + breadcrumb (Dashboard → Spilltabell)
//   - Panel with "Games" heading + right-aligned "Add Game" button
//   - DataTable with 5 cols: Name, Photo, Row, Column, Action
//   - Action column: View / Edit / Delete buttons
//
// Wired to BIN-620 backend per admin-game-types API.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import {
  fetchGameTypeList,
  deleteGameType,
} from "./GameTypeState.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderGameTypeListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>("#gameType-list-table");
  if (!tableHost) return;

  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;

  await loadAndRender(tableHost);

  // Wire Add-button
  const addBtn = container.querySelector<HTMLAnchorElement>('[data-action="add-game-type"]');
  if (addBtn) {
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.hash = "#/gameType/add";
    });
  }
}

async function loadAndRender(tableHost: HTMLElement): Promise<void> {
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
                <a href="#/gameType/add"
                  class="btn btn-primary btn-md"
                  data-action="add-game-type">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add_game"))}
                </a>
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
          <a href="#/gameType/edit/${encodeURIComponent(row._id)}"
             class="btn btn-warning btn-xs btn-rounded m-lr-3"
             title="${escapeHtml(t("edit_game"))}"
             data-action="edit-game-type">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </a>
          <button type="button"
             class="btn btn-danger btn-xs btn-rounded"
             title="${escapeHtml(t("confirm_delete"))}"
             data-action="delete-game-type"
             data-id="${escapeHtml(row._id)}"
             data-name="${escapeHtml(row.name)}">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });

  // Wire delete buttons
  host.querySelectorAll<HTMLButtonElement>('button[data-action="delete-game-type"]').forEach((btn) => {
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
    const result = await deleteGameType(id);
    if ("ok" in result && result.ok) {
      Toast.success(t("success"));
      await loadAndRender(tableHost);
      return;
    }
    if ("reason" in result) {
      Toast.error(result.message ?? t("something_went_wrong"));
      return;
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : String(err));
    Toast.error(msg);
  }
}
