// /gameManagement — 1:1 port of legacy/unity-backend/App/Views/GameManagement/game.html (1457 lines).
//
// BIN-684 wire-up (bolk 1): Add-knapp er nå aktiv (BIN-622 levert).
// BIN-623 CloseDay og tickets-per-game endpoints er fortsatt ikke levert —
// row-actions for de peker på detail-sider som viser eget placeholder-banner.
//
// feat/game-management-daily-schedules (pilot-blokker 2026-04-23):
// Legacy-admin viste en DailySchedule-tabell når type var valgt. Ny admin
// hadde tom panel — legger til DailySchedule-tabellen i tillegg til
// eksisterende GameManagement-listing slik at admin kan se daglige
// timeplaner fra gameManagement-siden (den naturlige innfallsporten).
// GameManagement-listen blir stående slik at BIN-684-wire-up fortsatt
// fungerer.
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
//   - DailySchedule-scope: backend listDailySchedules filtrerer kun på
//     gameManagementId, ikke gameTypeId. Vi henter GM-ids for typen og
//     filtrerer schedules client-side på membership.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
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
import {
  fetchDailyScheduleList,
  patchDailySchedule,
  deleteDailySchedule as deleteDailyScheduleApi,
  type DailyScheduleRow,
} from "../dailySchedules/DailyScheduleState.js";
import { openDailyScheduleEditorModal } from "../dailySchedules/DailyScheduleEditorModal.js";

export async function renderGameManagementPage(container: HTMLElement, typeId?: string): Promise<void> {
  container.innerHTML = renderShell();

  const selectEl = container.querySelector<HTMLSelectElement>("#gm-type-picker");
  const tableHost = container.querySelector<HTMLElement>("#gm-list-table");
  const headerHost = container.querySelector<HTMLElement>("#gm-list-header");
  const addBtnHost = container.querySelector<HTMLElement>("#gm-add-btn-host");
  const hintHost = container.querySelector<HTMLElement>("#gm-choose-type-hint");
  const dsSection = container.querySelector<HTMLElement>("#gm-ds-section");
  const dsActionsHost = container.querySelector<HTMLElement>("#gm-ds-actions");
  const dsTableHost = container.querySelector<HTMLElement>("#gm-ds-table");
  const dsHeadingHost = container.querySelector<HTMLElement>("#gm-ds-heading");
  if (
    !selectEl ||
    !tableHost ||
    !headerHost ||
    !addBtnHost ||
    !hintHost ||
    !dsSection ||
    !dsActionsHost ||
    !dsTableHost ||
    !dsHeadingHost
  ) {
    return;
  }

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
    hintHost.style.display = "none";
    renderAddButton(addBtnHost, typeId, types);
    await renderList(typeId, types, headerHost, tableHost);
    const gt = types.find((x) => x._id === typeId);
    if (gt) {
      dsSection.style.display = "";
      renderDsHeading(dsHeadingHost, gt);
      renderDsActions(dsActionsHost, typeId, () => {
        void reloadDailySchedules(typeId, dsTableHost);
      });
      await reloadDailySchedules(typeId, dsTableHost);
    } else {
      dsSection.style.display = "none";
    }
  } else {
    addBtnHost.innerHTML = "";
    hintHost.style.display = "";
    dsSection.style.display = "none";
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
        <div id="gm-choose-type-hint" class="alert alert-info" data-testid="gm-choose-type-hint"
             style="margin-top:12px;display:none;">
          <i class="fa fa-info-circle" aria-hidden="true"></i>
          ${escapeHtml(t("gm_choose_type_hint"))}
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
      <section class="content" id="gm-ds-section"
               data-testid="gm-ds-section" style="display:none;">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left">
                <h6 class="panel-title txt-dark" id="gm-ds-heading"></h6>
              </div>
              <div class="pull-right" id="gm-ds-actions"
                   data-testid="gm-ds-actions"></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <div id="gm-ds-table" data-testid="gm-ds-table"></div>
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
      <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_game"))}
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
      <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
      <li class="active">${escapeHtml(gt.name)}</li>
    </ol>`;

  tableHost.innerHTML = `<div class="text-center" data-testid="gm-loading"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
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
      <i class="fa fa-eye" aria-hidden="true"></i>
    </a>
    <a href="${ticketsRoute}" class="btn btn-success btn-xs btn-rounded" title="${escapeHtml(t("ticket"))}">
      <i class="fa fa-ticket" aria-hidden="true"></i>
    </a>
    <a href="${subGamesRoute}" class="btn btn-default btn-xs btn-rounded" title="${escapeHtml(t("sub_game"))}">
      <i class="fa fa-list" aria-hidden="true"></i>
    </a>
    <a href="${closeDayRoute}" class="btn btn-warning btn-xs btn-rounded" title="${escapeHtml(t("close_day"))}">
      <i class="fa fa-calendar-times-o" aria-hidden="true"></i>
    </a>
    <button type="button"
      class="btn btn-danger btn-xs btn-rounded"
      data-action="gm-delete"
      data-id="${escapeHtml(row._id)}"
      title="${escapeHtml(t("delete"))}">
      <i class="fa fa-trash" aria-hidden="true"></i>
    </button>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DailySchedule-seksjonen (pilot-blokker 2026-04-23).
// Viser <type.name> Tabell + 2 knapper (Legg til spesialspill / Lag daglig
// tidsplan) + datatabell over schedules knyttet til GameManagement-rader for
// valgt type. Backend-listen filtrerer kun på gameManagementId, så vi
// filtrerer client-side mot GM-listen for typen.
// ─────────────────────────────────────────────────────────────────────────────

function renderDsHeading(host: HTMLElement, gt: GameType): void {
  host.textContent = `${gt.name} ${t("game_table")}`;
}

/**
 * Rendrer de to legacy-knappene (Legg til spesialspill / Lag daglig
 * tidsplan) og wirer click-handlere til DailyScheduleEditorModal. Modalen
 * håndterer selve form-rendringen (19 felter); vi trigger bare riktig mode.
 * Etter save → `onSaved()` (reload av tabellen).
 *
 * typeId holdes i scope for fremtidig pre-fill hvis modalen utvides med
 * typeId-prop. Ingen pre-fill i dag — EditorModal har ingen slik knagg.
 */
function renderDsActions(host: HTMLElement, typeId: string, onSaved: () => void): void {
  host.innerHTML = `
    <a href="#" class="btn btn-primary btn-md" id="gm-ds-special-btn"
       data-testid="gm-ds-special-btn" style="margin-right:8px;">
      <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_special_game"))}
    </a>
    <a href="#" class="btn btn-primary btn-md" id="gm-ds-daily-btn"
       data-testid="gm-ds-daily-btn">
      <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("create_daily_schedule"))}
    </a>`;

  const specialBtn = host.querySelector<HTMLAnchorElement>("#gm-ds-special-btn");
  specialBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openDailyScheduleEditorModal({
      mode: "special",
      onSaved: () => {
        Toast.success(t("daily_schedule_created_success"));
        onSaved();
      },
    });
  });
  const dailyBtn = host.querySelector<HTMLAnchorElement>("#gm-ds-daily-btn");
  dailyBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openDailyScheduleEditorModal({
      mode: "create",
      onSaved: () => {
        Toast.success(t("daily_schedule_created_success"));
        onSaved();
      },
    });
  });

  void typeId;
}

async function reloadDailySchedules(typeId: string, host: HTMLElement): Promise<void> {
  host.innerHTML = `<div class="text-center" data-testid="gm-ds-loading"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
  try {
    // 1) Finn alle GameManagement-ids for typen (backend filter på gameTypeId).
    const gmRows = await fetchGameManagementList(typeId);
    const gmIds = new Set(gmRows.map((r) => r._id));
    // 2) Hent alle schedules (backend filtrerer kun på gameManagementId,
    //    ikke typeId). Fetch et romslig batch og filtrer klient-side.
    const all = await fetchDailyScheduleList({ limit: 500 });
    const rows = all.filter((ds) => {
      // Inkluder hvis knyttet til en GM av denne typen.
      if (ds.gameManagementId && gmIds.has(ds.gameManagementId)) return true;
      return false;
    });
    renderDsTable(host, typeId, rows);
  } catch (err) {
    const msg =
      err instanceof ApiError
        ? err.status === 403
          ? t("permission_denied")
          : err.message
        : err instanceof Error
          ? err.message
          : String(err);
    host.innerHTML = `<div class="alert alert-danger" data-testid="gm-ds-error">${escapeHtml(msg)}</div>`;
  }
}

function renderDsTable(
  host: HTMLElement,
  typeId: string,
  rows: DailyScheduleRow[]
): void {
  DataTable.mount(host, {
    className: "gm-ds-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "_id", title: t("daily_schedule_id") },
      {
        key: "startDate",
        title: t("date_range"),
        render: (r) => escapeHtml(formatDateRange(r.startDate, r.endDate)),
      },
      {
        key: "startTime",
        title: t("time_slot"),
        render: (r) => escapeHtml(formatTimeSlot(r.startTime, r.endTime)),
      },
      {
        key: "hallIds",
        title: t("group_of_halls"),
        render: (r) => escapeHtml(formatHallGroups(r)),
      },
      {
        key: "hallIds",
        title: t("master_hall"),
        render: (r) => escapeHtml(r.hallIds.masterHallId ?? "—"),
      },
      {
        key: "specialGame",
        title: t("game_type"),
        render: (r) => escapeHtml(r.specialGame ? t("special_game") : t("normal_game")),
      },
      {
        key: "status",
        title: t("status"),
        render: (r) => renderDsStatusBadge(r.status),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (r) => renderDsRowActions(r),
      },
    ],
  });
  // Wire row actions via event delegation.
  host.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>("[data-action^='ds-']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const action = btn.getAttribute("data-action");
    if (action === "ds-edit") {
      e.preventDefault();
      openDailyScheduleEditorModal({
        mode: "edit",
        dailyScheduleId: id,
        onSaved: () => {
          Toast.success(t("daily_schedule_updated_success"));
          void reloadDailySchedules(typeId, host);
        },
      });
    } else if (action === "ds-delete") {
      e.preventDefault();
      const name = btn.getAttribute("data-name") ?? id;
      confirmDsDelete(host, typeId, id, name);
    } else if (action === "ds-toggle") {
      e.preventDefault();
      const currentStatus = btn.getAttribute("data-status");
      const nextStatus =
        currentStatus === "active" || currentStatus === "running" ? "inactive" : "active";
      void toggleDsStatus(host, typeId, id, nextStatus);
    }
  });
}

function renderDsStatusBadge(status: string): string {
  switch (status) {
    case "active":
      return `<span class="label label-success">${escapeHtml(t("active"))}</span>`;
    case "running":
      return `<span class="label label-info">${escapeHtml(t("running"))}</span>`;
    case "finish":
      return `<span class="label label-default">${escapeHtml(t("finish"))}</span>`;
    case "inactive":
    default:
      return `<span class="label label-danger">${escapeHtml(t("inactive"))}</span>`;
  }
}

/**
 * Row-actions for DS-tabellen: view (ekstern route) + edit/delete/toggle
 * (intern modal + API). Klikk-håndtering går via event delegation i
 * renderDsTable.
 */
function renderDsRowActions(row: DailyScheduleRow): string {
  const viewHref = `#/dailySchedule/subgame/view/${encodeURIComponent(row._id)}`;
  const toggleTitle =
    row.status === "active" || row.status === "running"
      ? t("deactivate_daily_schedule")
      : t("activate_daily_schedule");
  const toggleIcon =
    row.status === "active" || row.status === "running" ? "fa-toggle-on" : "fa-toggle-off";
  return `
    <a href="${viewHref}" class="btn btn-info btn-xs btn-rounded"
       title="${escapeHtml(t("view"))}" data-testid="gm-ds-view">
      <i class="fa fa-eye" aria-hidden="true"></i>
    </a>
    <button type="button" class="btn btn-warning btn-xs btn-rounded m-lr-3"
      data-action="ds-edit" data-id="${escapeHtml(row._id)}"
      title="${escapeHtml(t("edit_daily_schedule"))}"
      data-testid="gm-ds-edit">
      <i class="fa fa-edit" aria-hidden="true"></i>
    </button>
    <button type="button" class="btn btn-default btn-xs btn-rounded m-lr-3"
      data-action="ds-toggle" data-id="${escapeHtml(row._id)}"
      data-status="${escapeHtml(row.status)}"
      title="${escapeHtml(toggleTitle)}"
      data-testid="gm-ds-toggle">
      <i class="fa ${toggleIcon}" aria-hidden="true"></i>
    </button>
    <button type="button" class="btn btn-danger btn-xs btn-rounded"
      data-action="ds-delete" data-id="${escapeHtml(row._id)}"
      data-name="${escapeHtml(row.name)}"
      title="${escapeHtml(t("delete"))}"
      data-testid="gm-ds-delete">
      <i class="fa fa-trash" aria-hidden="true"></i>
    </button>`;
}

function confirmDsDelete(host: HTMLElement, typeId: string, id: string, name: string): void {
  const body = document.createElement("div");
  body.innerHTML = `
    <p>${escapeHtml(t("confirm_delete_daily_schedule_body"))}</p>
    <p><strong>${escapeHtml(name)}</strong></p>`;
  Modal.open({
    title: t("delete"),
    content: body,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("delete"),
        variant: "danger",
        action: "confirm",
        dismiss: false,
        onClick: async (instance) => {
          try {
            await deleteDailyScheduleApi(id);
            Toast.success(t("daily_schedule_deleted_success"));
            instance.close("button");
            void reloadDailySchedules(typeId, host);
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });
}

async function toggleDsStatus(
  host: HTMLElement,
  typeId: string,
  id: string,
  nextStatus: "active" | "inactive"
): Promise<void> {
  try {
    await patchDailySchedule(id, { status: nextStatus });
    Toast.success(t("daily_schedule_updated_success"));
    void reloadDailySchedules(typeId, host);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

function formatDateRange(startIso: string, endIso: string | null): string {
  const start = formatDate(startIso);
  const end = endIso ? formatDate(endIso) : null;
  if (!end) return start;
  return `${start}-${end}`;
}

function formatDate(iso: string): string {
  // Inputs can be full ISO (YYYY-MM-DDTHH:MM:SSZ) or date-only strings.
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  // m[1..3] are guaranteed to exist since the regex matched.
  return `${m[3]!}/${m[2]!}/${m[1]!}`;
}

function formatTimeSlot(start: string, end: string): string {
  const s = start || "—";
  const e = end || "—";
  if (s === "—" && e === "—") return "—";
  return `${s} - ${e}`;
}

function formatHallGroups(row: DailyScheduleRow): string {
  const groups = row.hallIds.groupHallIds ?? [];
  const halls = row.hallIds.hallIds ?? [];
  if (groups.length > 0) return groups.join(", ");
  if (halls.length > 0) return halls.join(", ");
  if (row.hallId) return row.hallId;
  return "—";
}
