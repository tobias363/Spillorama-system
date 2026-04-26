// DailySchedule detail pages — wired for BIN-626.
//
// Kinds:
//   view          → /dailySchedule/view (list-oversikt)
//   create        → /dailySchedule/create/:typeId (trigger create-modal)
//   special       → /dailySchedule/special/:typeId (trigger special-modal)
//   scheduleGame  → /dailySchedule/scheduleGame/:id (vis + rediger)
//   subgame-edit  → /dailySchedule/subgame/edit/:id (vis + rediger)
//   subgame-view  → /dailySchedule/subgame/view/:id (read-only detaljer)

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchDailySchedule,
  fetchDailyScheduleDetails,
  daysFromMask,
  type DailyScheduleRow,
  type DailyScheduleDetailsResponse,
} from "./DailyScheduleState.js";
import { openDailyScheduleEditorModal } from "./DailyScheduleEditorModal.js";
import { renderDailyScheduleListPage } from "./DailyScheduleListPage.js";

export type DailyScheduleKind =
  | "view"
  | "create"
  | "special"
  | "scheduleGame"
  | "subgame-edit"
  | "subgame-view";

export interface DailyScheduleDetailOpts {
  kind: DailyScheduleKind;
  typeId?: string;
  id?: string;
}

export async function renderDailyScheduleDetailPages(
  container: HTMLElement,
  opts: DailyScheduleDetailOpts
): Promise<void> {
  if (opts.kind === "view") {
    await renderDailyScheduleListPage(container);
    return;
  }
  if (opts.kind === "create") {
    renderRedirectShell(container, "create_daily_schedule", "create");
    await openDailyScheduleEditorModal({
      mode: "create",
      onSaved: (row) => {
        Toast.success(t("daily_schedule_created_success"));
        window.location.hash = `#/dailySchedule/subgame/view/${encodeURIComponent(row.id)}`;
      },
    });
    return;
  }
  if (opts.kind === "special") {
    renderRedirectShell(container, "add_special_game", "special");
    await openDailyScheduleEditorModal({
      mode: "special",
      onSaved: (row) => {
        Toast.success(t("daily_schedule_created_success"));
        window.location.hash = `#/dailySchedule/subgame/view/${encodeURIComponent(row.id)}`;
      },
    });
    return;
  }
  if (opts.kind === "subgame-edit" || opts.kind === "scheduleGame") {
    if (!opts.id) {
      renderNotFound(container, t("daily_schedule_not_found"));
      return;
    }
    renderRedirectShell(container, "edit_daily_schedule", "edit");
    await openDailyScheduleEditorModal({
      mode: "edit",
      dailyScheduleId: opts.id,
      onSaved: (row) => {
        Toast.success(t("daily_schedule_updated_success"));
        window.location.hash = `#/dailySchedule/subgame/view/${encodeURIComponent(row.id)}`;
      },
    });
    return;
  }
  if (opts.kind === "subgame-view") {
    await renderSubgameView(container, opts.id ?? "");
    return;
  }
  renderNotFound(container, t("page_not_found"));
}

function renderRedirectShell(
  container: HTMLElement,
  titleKey: string,
  mode: "create" | "edit" | "special"
): void {
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t(titleKey))}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/dailySchedule/view">${escapeHtml(t("daily_schedule_management"))}</a></li>
          <li class="active">${escapeHtml(t(titleKey))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t(titleKey))}</h6></div>
              <div class="pull-right">
                <a href="#/dailySchedule/view" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <p class="text-muted" data-mode="${escapeHtml(mode)}">${escapeHtml(t("daily_schedule_editor_hint"))}</p>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderNotFound(container: HTMLElement, message: string): void {
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content">
        <div class="alert alert-warning">${escapeHtml(message)}</div>
        <a href="#/dailySchedule/view" class="btn btn-primary btn-sm">
          <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
        </a>
      </section>
    </div></div>`;
}

async function renderSubgameView(container: HTMLElement, id: string): Promise<void> {
  const title = `${t("view_daily_schedule")}${id ? ` #${id}` : ""}`;
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/dailySchedule/view">${escapeHtml(t("daily_schedule_management"))}</a></li>
          <li class="active">${escapeHtml(title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
              <div class="pull-right">
                <a href="#/dailySchedule/view" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body" id="ds-view-body">
                <div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;

  const body = container.querySelector<HTMLElement>("#ds-view-body");
  if (!body || !id) {
    if (body)
      body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("daily_schedule_not_found"))}</div>`;
    return;
  }
  try {
    const details = await fetchDailyScheduleDetails(id);
    if (details) {
      body.innerHTML = renderDetailedView(details);
      return;
    }
    // Fallback til basic get hvis /details skulle feile.
    const row = await fetchDailySchedule(id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("daily_schedule_not_found"))}</div>`;
      return;
    }
    body.innerHTML = renderRowView(row);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderDetailedView(details: DailyScheduleDetailsResponse): string {
  const gm = details.gameManagement
    ? `<h4>${escapeHtml(t("game_creation_management"))}</h4>
       <table class="table table-striped">
         <tr><th>${escapeHtml(t("name"))}</th><td>${escapeHtml(details.gameManagement.name)}</td></tr>
         <tr><th>${escapeHtml(t("status"))}</th><td>${escapeHtml(details.gameManagement.status)}</td></tr>
         <tr><th>${escapeHtml(t("ticket_price"))}</th><td>${escapeHtml(String(details.gameManagement.ticketPrice))}</td></tr>
       </table>`
    : "";
  const rowHtml = renderRowView({ ...details.schedule, _id: details.schedule.id });
  const subgamesJson = JSON.stringify(details.subgames, null, 2);
  return `
    ${rowHtml}
    ${gm}
    <h4>${escapeHtml(t("sub_games"))} (${details.subgames.length})</h4>
    <pre style="max-height:400px;overflow:auto;background:#f5f5f5;padding:12px;border-radius:3px;">${escapeHtml(subgamesJson)}</pre>`;
}

function renderRowView(row: DailyScheduleRow): string {
  const weekdays = row.day
    ? t(`weekday_${row.day}`)
    : row.weekDays === 0
      ? "—"
      : daysFromMask(row.weekDays).map((k) => t(`weekday_${k}`)).join(", ");
  const hallIds = row.hallIds.hallIds?.join(", ") ?? "";
  const groupHallIds = row.hallIds.groupHallIds?.join(", ") ?? "";
  const rows: Array<[string, string]> = [
    [t("schedules_name"), row.name],
    [t("start_date"), row.startDate],
    [t("end_date"), row.endDate ?? "—"],
    [t("start_time"), row.startTime || "—"],
    [t("end_time"), row.endTime || "—"],
    [t("weekdays"), weekdays],
    [t("hall"), row.hallId ?? "—"],
    [t("master_hall_id"), row.hallIds.masterHallId ?? "—"],
    [t("halls_csv"), hallIds || "—"],
    [t("group_hall_ids_csv"), groupHallIds || "—"],
    [t("status"), row.status],
    [t("special_game"), row.specialGame ? "✓" : "—"],
    [t("creation_date_time"), row.createdAt],
  ];
  const html = rows
    .map(
      ([label, value]) =>
        `<tr><th style="width:30%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");
  return `<table class="table table-striped">${html}</table>`;
}
