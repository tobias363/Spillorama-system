// /schedules — 1:1 port of legacy/unity-backend/App/Views/schedules/schedule.html (246 lines).
//
// Legacy layout: DataTable with Name, Start/End date, HallGroup, Status, Action.
// Action column: view/edit/delete; "Create" button top-right.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { escapeHtml } from "../common/escape.js";
import { fetchScheduleList, type ScheduleRow } from "./ScheduleState.js";

export async function renderScheduleListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  const tableHost = container.querySelector<HTMLElement>("#schedule-list-table");
  if (!tableHost) return;
  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const rows = await fetchScheduleList();
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
        <h1>${escapeHtml(t("schedule_management"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("schedule_management"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("schedule_management"))}</h6></div>
              <div class="pull-right">
                <a href="#/schedules/create" class="btn btn-primary btn-md"
                   title="Venter på backend-endpoint — BIN-625 (UI-shell tilgjengelig)">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("add"))}
                  <small style="opacity:0.75;margin-left:6px;">(BIN-625)</small>
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning" style="margin:0 0 12px;">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint.
                  <strong>BIN-625</strong> Schedule CRUD må leveres før listen viser data.
                </div>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="schedule-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(host: HTMLElement, rows: ScheduleRow[]): void {
  DataTable.mount(host, {
    className: "schedule-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "name", title: t("game_name") },
      { key: "startDate", title: t("start_date") },
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
          <a href="#/schedules/view/${encodeURIComponent(r._id)}"
             class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view"))}">
            <i class="fa fa-eye"></i>
          </a>
          <button type="button" class="btn btn-warning btn-xs btn-rounded m-lr-3" disabled
            title="Venter på backend-endpoint — BIN-625">
            <i class="fa fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-xs btn-rounded" disabled
            title="Venter på backend-endpoint — BIN-625">
            <i class="fa fa-trash"></i>
          </button>`,
      },
    ],
  });
}
