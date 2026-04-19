// /patternManagement/:typeId — 1:1 port of
// legacy/unity-backend/App/Views/patternManagement/pattern.html (345 lines).
//
// Legacy layout:
//   - Content-header: "{gameName} Pattern Management" + breadcrumb
//   - Panel heading with right-aligned "Add Pattern"-button (permission+count-gated)
//   - DataTable with per-game-type column-sets:
//       Game 1: Name, Number, Pattern Name, Status, Created, Action (view/edit/delete)
//       Game 3: Name, Number, Pattern Name, Created, Action (view/edit/delete)
//       Game 4: Name, Number, Pattern Name, Created, Action (view-only; edit/delete commented out)
//       Game 5: Name, Number, Pattern Name, Created, Action
//
// Per legacy §1.7 count-gates apply to the Add-button:
//   Game 1: unlimited
//   Game 3: hidden at 32 (MAX 32)
//   Game 4: hidden at 15 (DEPRECATED)
//   Game 5: hidden at 17
//
// All write actions are BIN-627 placeholders. The list itself renders empty
// until BIN-627 backend ships.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import {
  fetchPatternList,
  maxPatternsForGameType,
  type PatternRow,
} from "./PatternState.js";
import { fetchGameType } from "../gameType/GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import { formatLegacyDateTime } from "../subGame/SubGameListPage.js";
import type { GameType } from "../common/types.js";

export async function renderPatternListPage(
  container: HTMLElement,
  typeId: string
): Promise<void> {
  container.innerHTML = renderShell(null, null);

  try {
    const [gameType, rows] = await Promise.all([fetchGameType(typeId), fetchPatternList(typeId)]);
    if (!gameType) {
      container.innerHTML = renderShell(null, `Game type "${typeId}" not found`);
      return;
    }
    container.innerHTML = renderShell({ gameType, rows }, null);

    const tableHost = container.querySelector<HTMLElement>("#pattern-list-table");
    if (tableHost) renderTable(tableHost, gameType, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg);
  }
}

interface ShellArgs {
  gameType: GameType;
  rows: PatternRow[];
}

function renderShell(args: ShellArgs | null, error: string | null): string {
  const gameName = args?.gameType.name ?? "";
  const title = args
    ? `${gameName} ${t("pattern_management")}`
    : t("pattern_management");

  const max = args ? maxPatternsForGameType(args.gameType.type) : null;
  const count = args?.rows.length ?? 0;
  const canAdd = args && (max === null || count < max);

  const addButton = canAdd
    ? `<button type="button"
           class="btn btn-primary btn-md"
           disabled
           title="Venter på backend-endpoint — BIN-627">
           <i class="fa fa-plus"></i> ${escapeHtml(t("add_pattern"))} ${escapeHtml(gameName)}
           <small style="opacity:0.75;margin-left:6px;">(BIN-627)</small>
         </button>`
    : "";

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;">${escapeHtml(error)}</div>`
    : "";

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left">
                <h6 class="panel-title txt-dark">${escapeHtml(title)}</h6>
              </div>
              <div class="pull-right">${addButton}</div>
              <div class="clearfix"></div>
            </div>
            ${errorBlock}
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning" style="margin:0 0 12px;">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint.
                  <strong>BIN-627</strong> Pattern CRUD må leveres før listen viser data.
                </div>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="pattern-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(host: HTMLElement, gameType: GameType, rows: PatternRow[]): void {
  // Column set depends on game-type per legacy pattern.html:103-242.
  const isGame1 = gameType.type === "game_1";

  DataTable.mount(host, {
    className: "pattern-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "gameName", title: t("game_name") },
      { key: "patternNumber", title: t("pattern_number"), align: "center" },
      { key: "patternName", title: t("pattern_name") },
      // Game 1 has an extra Status column; Games 3/4/5 skip it.
      ...(isGame1
        ? [
            {
              key: "status" as const,
              title: t("status"),
              render: (row: PatternRow) =>
                row.status === "active"
                  ? `<span style="color:green;">${escapeHtml(t("active"))}</span>`
                  : `<span style="color:red;">${escapeHtml(t("inactive"))}</span>`,
            },
          ]
        : []),
      {
        key: "createdAt",
        title: t("creation_date_time"),
        render: (row) => formatLegacyDateTime(row.createdAt),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (row) => renderActionButtons(gameType.type, gameType._id, row._id),
      },
    ],
  });
}

function renderActionButtons(gameType: string, typeId: string, patternId: string): string {
  // Game 4 (DEPRECATED) shows only view per legacy §208-238; others show view+edit+delete
  // all disabled as BIN-627 placeholders.
  const viewBtn = `
    <a href="#/patternManagement/${encodeURIComponent(typeId)}/view/${encodeURIComponent(patternId)}"
       class="btn btn-info btn-xs btn-rounded"
       title="${escapeHtml(t("view_pattern"))}">
       <i class="fa fa-eye" aria-hidden="true"></i>
    </a>`;

  if (gameType === "game_4") return viewBtn;

  const editBtn = `
    <button type="button"
      class="btn btn-warning btn-xs btn-rounded m-lr-3"
      disabled
      title="Venter på backend-endpoint — BIN-627">
      <i class="fa fa-edit" aria-hidden="true"></i>
    </button>`;
  const deleteBtn = `
    <button type="button"
      class="btn btn-danger btn-xs btn-rounded"
      disabled
      title="Venter på backend-endpoint — BIN-627">
      <i class="fa fa-trash" aria-hidden="true"></i>
    </button>`;
  return `${viewBtn}${editBtn}${deleteBtn}`;
}
