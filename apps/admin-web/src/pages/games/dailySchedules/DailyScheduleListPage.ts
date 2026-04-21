// /dailySchedule/view — wired for BIN-626 DailySchedule CRUD.
//
// Legacy: legacy/unity-backend/App/Views/dailySchedules/view.html (385L).
// Backend: apps/backend/src/routes/adminDailySchedules.ts.
//
// Denne siden viser listen over daglige timeplan-rader med kjerne-kolonner
// + action-knapper for rediger/slett. Create-knapp åpner editor-modalen.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchDailyScheduleList,
  deleteDailySchedule as deleteDailyScheduleState,
  daysFromMask,
  type DailyScheduleRow,
} from "./DailyScheduleState.js";
import { openDailyScheduleEditorModal } from "./DailyScheduleEditorModal.js";

export async function renderDailyScheduleListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  wireAddButton(container);
  await reloadList(container);
}

async function reloadList(container: HTMLElement): Promise<void> {
  const tableHost = container.querySelector<HTMLElement>("#daily-schedule-list-table");
  if (!tableHost) return;
  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const rows = await fetchDailyScheduleList();
    renderTable(container, tableHost, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function wireAddButton(container: HTMLElement): void {
  const addBtn = container.querySelector<HTMLAnchorElement>("#daily-schedule-add-btn");
  if (!addBtn) return;
  addBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openDailyScheduleEditorModal({
      mode: "create",
      onSaved: () => {
        Toast.success(t("daily_schedule_created_success"));
        void reloadList(container);
      },
    });
  });
  const specialBtn = container.querySelector<HTMLAnchorElement>("#daily-schedule-special-btn");
  specialBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openDailyScheduleEditorModal({
      mode: "special",
      onSaved: () => {
        Toast.success(t("daily_schedule_created_success"));
        void reloadList(container);
      },
    });
  });
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("daily_schedule_management"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/schedules">${escapeHtml(t("schedule_management"))}</a></li>
          <li class="active">${escapeHtml(t("daily_schedule_management"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("daily_schedule_management"))}</h6></div>
              <div class="pull-right">
                <a href="#" id="daily-schedule-special-btn" class="btn btn-warning btn-md" style="margin-right:8px;">
                  <i class="fa fa-star"></i> ${escapeHtml(t("add_special_game"))}
                </a>
                <a href="#" id="daily-schedule-add-btn" class="btn btn-primary btn-md">
                  <i class="fa fa-plus"></i> ${escapeHtml(t("create_daily_schedule"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <div id="daily-schedule-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderTable(container: HTMLElement, host: HTMLElement, rows: DailyScheduleRow[]): void {
  DataTable.mount(host, {
    className: "daily-schedule-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "name", title: t("schedules_name") },
      {
        key: "startDate",
        title: t("start_date"),
        render: (r) => escapeHtml(r.startDate),
      },
      {
        key: "endDate",
        title: t("end_date"),
        render: (r) => escapeHtml(r.endDate ?? "—"),
      },
      {
        key: "weekDays",
        title: t("weekdays"),
        render: (r) => {
          if (r.day) return escapeHtml(t(`weekday_${r.day}`));
          if (r.weekDays === 0) return "—";
          return daysFromMask(r.weekDays).map((k) => escapeHtml(t(`weekday_${k}`))).join(", ");
        },
      },
      {
        key: "startTime",
        title: t("start_time"),
        render: (r) => escapeHtml(r.startTime || "—"),
      },
      {
        key: "endTime",
        title: t("end_time"),
        render: (r) => escapeHtml(r.endTime || "—"),
      },
      {
        key: "specialGame",
        title: t("special_game"),
        align: "center",
        render: (r) => (r.specialGame ? `<i class="fa fa-star text-warning"></i>` : ""),
      },
      {
        key: "status",
        title: t("status"),
        render: (r) => renderStatusLabel(r.status),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (r) => `
          <a href="#/dailySchedule/subgame/view/${encodeURIComponent(r._id)}"
             class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view"))}">
            <i class="fa fa-eye"></i>
          </a>
          <button type="button" class="btn btn-warning btn-xs btn-rounded m-lr-3"
            data-action="ds-edit" data-id="${escapeHtml(r._id)}"
            title="${escapeHtml(t("edit_daily_schedule"))}">
            <i class="fa fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-xs btn-rounded"
            data-action="ds-delete" data-id="${escapeHtml(r._id)}"
            data-name="${escapeHtml(r.name)}"
            title="${escapeHtml(t("delete"))}">
            <i class="fa fa-trash"></i>
          </button>`,
      },
    ],
  });

  host.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.dataset.action === "ds-edit") {
      openDailyScheduleEditorModal({
        mode: "edit",
        dailyScheduleId: id,
        onSaved: () => {
          Toast.success(t("daily_schedule_updated_success"));
          void reloadList(container);
        },
      });
    } else if (btn.dataset.action === "ds-delete") {
      const name = btn.dataset.name ?? id;
      confirmDelete(container, id, name);
    }
  });
}

function renderStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return `<span class="label label-success">${escapeHtml(status)}</span>`;
    case "running":
      return `<span class="label label-info">${escapeHtml(status)}</span>`;
    case "finish":
      return `<span class="label label-default">${escapeHtml(status)}</span>`;
    case "inactive":
    default:
      return `<span class="label label-danger">${escapeHtml(status)}</span>`;
  }
}

function confirmDelete(container: HTMLElement, id: string, name: string): void {
  const body = document.createElement("div");
  body.innerHTML = `
    <p>${escapeHtml(t("confirm_delete_daily_schedule_body"))}</p>
    <p><strong>${escapeHtml(name)}</strong></p>
  `;
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
            await deleteDailyScheduleState(id);
            Toast.success(t("daily_schedule_deleted_success"));
            instance.close("button");
            void reloadList(container);
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });
}
