//
// Legacy layout:
//   - Top bar: "Choose a game" dropdown (game-type picker)
//   - Panel: per-type title + right-aligned "Add Game" + "Repeat Game" buttons
//   - DataTable: type-scoped columns (Game 2 gets score col; Game 3 gets patterns col)
//
// Port notes:
//   - Type picker uses hash query string `#/gameManagement?typeId=X` — pattern
//     matches cash-inout's `?gameId=X` (see PR-B1 §6.7 in PR-A3-PLAN.md).
//   - Client-side render; DataTable component handles the grid.
//   - Add/Repeat/CloseDay are BIN-622/BIN-623 placeholders (disabled buttons
//     with tooltip). Row actions (view/edit/tickets/subgames/closeDay) are
//     wired but only View+Tickets+SubGames land pages in PR-A3b; Edit and
//     delete are disabled placeholders.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { escapeHtml } from "../common/escape.js";
import { fetchGameTypeList } from "../gameType/GameTypeState.js";
import { isDropdownVisible, type GameType } from "../common/types.js";
import { fetchGameManagementList, isGame3Variant, type GameManagementRow } from "./GameManagementState.js";

export async function renderGameManagementPage(container: HTMLElement, typeId?: string): Promise<void> {
  container.innerHTML = renderShell();

  const selectEl = container.querySelector<HTMLSelectElement>("#gm-type-picker");
  const tableHost = container.querySelector<HTMLElement>("#gm-list-table");
  const headerHost = container.querySelector<HTMLElement>("#gm-list-header");
  const bannerHost = container.querySelector<HTMLElement>("#gm-backend-banner");
  if (!selectEl || !tableHost || !headerHost || !bannerHost) return;

  let types: GameType[] = [];
  try {
    types = (await fetchGameTypeList()).filter(isDropdownVisible);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    return;
  }

  // Populate the type-picker.
  selectEl.innerHTML =
    `<option value="">${escapeHtml(t("choose_game_type"))}</option>` +
    types
      .map((gt) => `<option value="${escapeHtml(gt._id)}">${escapeHtml(gt.name)}</option>`)
      .join("");

  // Pre-select from typeId query param.
  if (typeId) {
    selectEl.value = typeId;
    await renderList(typeId, types, headerHost, tableHost, bannerHost);
  }

  selectEl.addEventListener("change", () => {
    const next = selectEl.value;
    if (next) {
      // Keep hash-query in sync with dropdown for shareable URLs.
      window.location.hash = `#/gameManagement?typeId=${encodeURIComponent(next)}`;
    } else {
      window.location.hash = `#/gameManagement`;
    }
  });
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <div class="content-header">
        <div class="choose-game">
          <label>${escapeHtml(t("choose_a_game"))}:-</label>
          <select id="gm-type-picker" name="gamesList"></select>
        </div>
      </div>
      <section class="content-header" id="gm-list-header"></section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left">
                <h6 class="panel-title txt-dark">${escapeHtml(t("game_creation_management"))}</h6>
              </div>
              <div class="pull-right">
                <button type="button"
                  class="btn btn-primary btn-md"
                  disabled
                  title="Venter på backend-endpoint — BIN-622">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add_game"))}
                  <small style="opacity:0.75;margin-left:6px;">(BIN-622)</small>
                </button>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div id="gm-backend-banner"></div>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="gm-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

async function renderList(
  typeId: string,
  types: GameType[],
  headerHost: HTMLElement,
  tableHost: HTMLElement,
  bannerHost: HTMLElement
): Promise<void> {
  const gt = types.find((t) => t._id === typeId);
  if (!gt) {
    tableHost.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("no_data_available"))}</div>`;
    return;
  }

  // Sub-header: "{game.name} Table" with breadcrumb.
  headerHost.innerHTML = `
    <h1>${escapeHtml(gt.name)} ${escapeHtml(t("game_table"))}</h1>
    <ol class="breadcrumb pull-right">
      <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
      <li class="active">${escapeHtml(gt.name)}</li>
    </ol>`;

  bannerHost.innerHTML = `
    <div class="alert alert-warning" style="margin:0 0 12px;">
      <i class="fa fa-info-circle"></i>
      Venter på backend-endpoint.
      <strong>BIN-622</strong> GameManagement CRUD må leveres før listen viser data.
    </div>`;

  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
  const rows = await fetchGameManagementList(typeId);
  renderTable(tableHost, rows, gt);
}

function renderTable(host: HTMLElement, rows: GameManagementRow[], gt: GameType): void {
  DataTable.mount(host, {
    className: "gm-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "_id", title: t("game_id") },
      { key: "childId", title: t("child_id") },
      { key: "name", title: t("game_name") },
      { key: "ticketPrice", title: t("ticket_price"), align: "right" },
      { key: "startDate", title: t("start_date") },
      {
        key: "status",
        title: t("status"),
        render: (row) => statusBadge(row.status),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (row) => renderRowActions(gt, row),
      },
    ],
  });
}

function statusBadge(s: GameManagementRow["status"]): string {
  const color = s === "running" ? "#2196F3" : s === "active" ? "green" : s === "closed" ? "#888" : "red";
  return `<span style="color:${color};">${escapeHtml(s)}</span>`;
}

function renderRowActions(gt: GameType, row: GameManagementRow): string {
  const viewRoute = isGame3Variant(gt)
    ? `#/gameManagement/${encodeURIComponent(gt._id)}/view-g3/${encodeURIComponent(row._id)}`
    : `#/gameManagement/${encodeURIComponent(gt._id)}/view/${encodeURIComponent(row._id)}`;
  const ticketsRoute = `#/gameManagement/${encodeURIComponent(gt._id)}/tickets/${encodeURIComponent(row._id)}`;
  const subGamesRoute = `#/gameManagement/subGames/${encodeURIComponent(gt._id)}/${encodeURIComponent(row._id)}`;
  const closeDayRoute = `#/gameManagement/closeDay/${encodeURIComponent(gt._id)}/${encodeURIComponent(row._id)}`;
  return `
    <a href="${viewRoute}" class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view"))}">
      <i class="fa fa-eye"></i>
    </a>
    <a href="${ticketsRoute}" class="btn btn-success btn-xs btn-rounded" title="${escapeHtml(t("ticket"))}">
      <i class="fa fa-ticket"></i>
    </a>
    <a href="${subGamesRoute}" class="btn btn-default btn-xs btn-rounded" title="${escapeHtml(t("sub_game"))}">
      <i class="fa fa-list"></i>
    </a>
    <a href="${closeDayRoute}" class="btn btn-warning btn-xs btn-rounded" title="${escapeHtml(t("close_day"))}">
      <i class="fa fa-calendar-times-o"></i>
    </a>
    <button type="button" class="btn btn-danger btn-xs btn-rounded" disabled
      title="Venter på backend-endpoint — BIN-622">
      <i class="fa fa-trash"></i>
    </button>`;
}
