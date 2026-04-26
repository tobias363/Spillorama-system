// /schedules — wired for BIN-625 Schedule CRUD.
//
// Legacy: legacy/unity-backend/App/Views/schedules/schedule.html.
// Backend: apps/backend/src/routes/adminSchedules.ts.
//
// Funksjonalitet i denne porten:
//   - Fetcher Schedule-maler via `/api/admin/schedules`
//   - Add-knapp åpner CreateScheduleModal (POST)
//   - Rediger-knapp åpner EditScheduleModal (PATCH)
//   - Slett-knapp åpner bekreft-dialog + DELETE (soft-delete default)
//
// Schedule-builder med full nested subgame-editor (legacy create.html = 5 382 L)
// ligger fortsatt som follow-up. Her dekker vi kjerne-feltene (scheduleName,
// scheduleType, luckyNumberPrize, manualStart/EndTime, status) + en enkel
// subgames-editor som round-trippes via JSON.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../common/escape.js";
import { ApiError } from "../../../api/client.js";
import {
  fetchScheduleList,
  deleteSchedule as deleteScheduleState,
  type ScheduleRow,
} from "./ScheduleState.js";
import { openScheduleEditorModal } from "./ScheduleEditorModal.js";

export async function renderScheduleListPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();
  wireAddButton(container);
  await reloadList(container);
}

async function reloadList(container: HTMLElement): Promise<void> {
  const tableHost = container.querySelector<HTMLElement>("#schedule-list-table");
  if (!tableHost) return;
  tableHost.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
  try {
    const rows = await fetchScheduleList();
    renderTable(container, tableHost, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function wireAddButton(container: HTMLElement): void {
  const addBtn = container.querySelector<HTMLAnchorElement>("#schedule-add-btn");
  if (!addBtn) return;
  addBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openScheduleEditorModal({
      mode: "create",
      onSaved: () => {
        Toast.success(t("schedule_created_success"));
        void reloadList(container);
      },
    });
  });
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("schedule_management"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li class="active">${escapeHtml(t("schedule_management"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("schedule_management"))}</h6></div>
              <div class="pull-right">
                <a href="#/schedules/create" id="schedule-add-btn" class="btn btn-primary btn-md">
                  <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
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

function renderTable(container: HTMLElement, host: HTMLElement, rows: ScheduleRow[]): void {
  DataTable.mount(host, {
    className: "schedule-list pb-30",
    emptyMessage: t("no_data_available"),
    rows,
    columns: [
      { key: "scheduleName", title: t("schedules_name") },
      {
        key: "scheduleNumber",
        title: t("schedules_id"),
        render: (r) => escapeHtml(r.scheduleNumber),
      },
      {
        key: "scheduleType",
        title: t("schedules_type"),
        render: (r) => escapeHtml(r.scheduleType),
      },
      {
        key: "status",
        title: t("status"),
        render: (r) =>
          r.status === "active"
            ? `<span class="label label-success">${escapeHtml(t("active"))}</span>`
            : `<span class="label label-danger">${escapeHtml(t("inactive"))}</span>`,
      },
      {
        key: "createdAt",
        title: t("creation_date_time"),
        render: (r) => escapeHtml(formatIso(r.createdAt)),
      },
      {
        key: "_id",
        title: t("action"),
        align: "center",
        render: (r) => `
          <a href="#/schedules/view/${encodeURIComponent(r._id)}"
             class="btn btn-info btn-xs btn-rounded" title="${escapeHtml(t("view"))}">
            <i class="fa fa-eye" aria-hidden="true"></i>
          </a>
          <button type="button" class="btn btn-warning btn-xs btn-rounded m-lr-3"
            data-action="schedule-edit" data-id="${escapeHtml(r._id)}"
            title="${escapeHtml(t("edit_schedule"))}">
            <i class="fa fa-edit" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-danger btn-xs btn-rounded"
            data-action="schedule-delete" data-id="${escapeHtml(r._id)}"
            data-name="${escapeHtml(r.scheduleName)}"
            title="${escapeHtml(t("delete_schedule"))}">
            <i class="fa fa-trash" aria-hidden="true"></i>
          </button>`,
      },
    ],
  });

  // Delegate click for edit/delete.
  host.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.dataset.action === "schedule-edit") {
      openScheduleEditorModal({
        mode: "edit",
        scheduleId: id,
        onSaved: () => {
          Toast.success(t("schedule_updated_success"));
          void reloadList(container);
        },
      });
    } else if (btn.dataset.action === "schedule-delete") {
      const name = btn.dataset.name ?? id;
      confirmDelete(container, id, name);
    }
  });
}

function confirmDelete(container: HTMLElement, id: string, name: string): void {
  const body = document.createElement("div");
  body.innerHTML = `
    <p>${escapeHtml(t("confirm_delete_schedule_body"))}</p>
    <p><strong>${escapeHtml(name)}</strong></p>
    <p class="text-warning">${escapeHtml(t("schedule_soft_delete_hint"))}</p>
  `;
  Modal.open({
    title: t("delete_schedule"),
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
            await deleteScheduleState(id);
            Toast.success(t("schedules_has_been_deleted"));
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

function formatIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return iso;
  }
}
