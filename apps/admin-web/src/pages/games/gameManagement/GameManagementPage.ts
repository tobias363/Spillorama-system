// /gameManagement — 1:1 port of legacy/unity-backend/App/Views/GameManagement/game.html (1457 lines).
//
// BIN-684 wire-up (bolk 1): Add-knapp er nå aktiv (BIN-622 levert).
// BIN-623 CloseDay og tickets-per-game endpoints er fortsatt ikke levert —
// row-actions for de peker på detail-sider som viser eget placeholder-banner.
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
//   - Delete is wired but triggers a confirm-dialog + soft-delete via API.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { escapeHtml } from "../common/escape.js";
import { fetchGameTypeList } from "../gameType/GameTypeState.js";
import { isDropdownVisible, type GameType } from "../common/types.js";
import {
  fetchGameManagementList,
  isGame3Variant,
  deleteGameManagement,
  type GameManagementRow,
} from "./GameManagementState.js";
import { ApiError } from "../../../api/client.js";

export async function renderGameManagementPage(container: HTMLElement, typeId?: string): Promise<void> {
  container.innerHTML = renderShell();

  const selectEl = container.querySelector<HTMLSelectElement>("#gm-type-picker");
  const tableHost = container.querySelector<HTMLElement>("#gm-list-table");
  const headerHost = container.querySelector<HTMLElement>("#gm-list-header");
  const addBtnHost = container.querySelector<HTMLElement>("#gm-add-btn-host");
  if (!selectEl || !tableHost || !headerHost || !addBtnHost) return;

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
    renderAddButton(addBtnHost, typeId, types);
    await renderList(typeId, types, headerHost, tableHost);
  } else {
    addBtnHost.innerHTML = "";
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
              <div class="pull-right" id="gm-add-btn-host"></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
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

function renderAddButton(host: HTMLElement, typeId: string, types: GameType[]): void {
  const gt = types.find((x) => x._id === typeId);
  const isG3 = isGame3Variant(gt);
  const href = isG3
    ? `#/gameManagement/${encodeURIComponent(typeId)}/add-g3`
    : `#/gameManagement/${encodeURIComponent(typeId)}/add`;
  host.innerHTML = `
    <a href="${href}" class="btn btn-primary btn-md" data-testid="gm-add-btn">
      <i class="fa fa-plus"></i> ${escapeHtml(t("add_game"))}
    </a>`;
}

async function renderList(
  typeId: string,
  types: GameType[],
  headerHost: HTMLElement,
  tableHost: HTMLElement
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

  tableHost.innerHTML = `<div class="text-center" data-testid="gm-loading"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const rows = await fetchGameManagementList(typeId);
    renderTable(tableHost, rows, gt, typeId, types, headerHost);
  } catch (err) {
    const msg = err instanceof ApiError
      ? err.status === 403
        ? t("permission_denied")
        : err.message
      : err instanceof Error
        ? err.message
        : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger" data-testid="gm-error">${escapeHtml(msg)}</div>`;
  }
}

function renderTable(
  host: HTMLElement,
  rows: GameManagementRow[],
  gt: GameType,
  typeId: string,
  types: GameType[],
  headerHost: HTMLElement
): void {
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

  // Wire delete buttons — soft-delete via API, then reload.
  host.querySelectorAll<HTMLButtonElement>("button[data-action='gm-delete']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!window.confirm(t("confirm_delete"))) return;
      btn.disabled = true;
      const result = await deleteGameManagement(gt._id, id);
      if (result.ok) {
        await renderList(typeId, types, headerHost, host);
      } else {
        const msg =
          result.reason === "PERMISSION_DENIED"
            ? t("permission_denied")
            : result.reason === "NOT_FOUND"
              ? t("not_found")
              : "message" in result
                ? result.message
                : t("pending_backend_endpoint");
        window.alert(msg);
        btn.disabled = false;
      }
    });
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
    <button type="button"
      class="btn btn-danger btn-xs btn-rounded"
      data-action="gm-delete"
      data-id="${escapeHtml(row._id)}"
      title="${escapeHtml(t("delete"))}">
      <i class="fa fa-trash"></i>
    </button>`;
}
