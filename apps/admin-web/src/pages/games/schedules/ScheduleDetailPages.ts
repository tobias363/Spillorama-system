// Schedule detail pages — create (router-navigated) and view (read-only).
//
// `#/schedules/create` renders a thin wrapper that triggers the modal-based
// editor (same code path som list-siden sin Add-knapp). Dette matcher
// BIN-625-scope der den store legacy-builderen (5 382L) fortsatt er
// follow-up — de essensielle CRUD-feltene dekkes av modalen.
//
// `#/schedules/view/:id` viser read-only detalj + sub-games for malen.

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { Modal } from "../../../components/Modal.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import { fetchSchedule, type ScheduleRow } from "./ScheduleState.js";
import { openScheduleEditorModal } from "./ScheduleEditorModal.js";

export type ScheduleDetailKind = "create" | "view";

export interface ScheduleDetailOpts {
  kind: ScheduleDetailKind;
  id?: string;
}

/**
 * Rydder opp rester av modal-DOM fra tidligere besøk. Uten dette stacker
 * `.modal.fade.in` + `.modal-backdrop` seg opp når admin navigerer
 * tilbake/frem til `/schedules/create` (memory-leak observert i QA).
 *
 * Vi bruker `Modal.closeAll(true)` for properly registrerte instanser, og
 * følger opp med et DOM-sweep for foreldreløse noder (f.eks. hvis en gammel
 * modal ble lagt til av legacy bootstrap.min.js eller en tidligere
 * feilhåndtering droppet referansen).
 */
function cleanupStaleModals(): void {
  Modal.closeAll(true);
  document
    .querySelectorAll(".modal.fade.in, .modal-backdrop")
    .forEach((el) => el.remove());
  document.body.classList.remove("modal-open");
}

export async function renderScheduleDetailPages(
  container: HTMLElement,
  opts: ScheduleDetailOpts
): Promise<void> {
  cleanupStaleModals();
  if (opts.kind === "create") {
    renderCreateShell(container);
    // Åpner modalen automatisk slik at URL-routen /schedules/create fortsatt
    // starter opprettingsflyten. Siden bak ligger som fallback hvis modalen
    // lukkes uten å lagre.
    await openScheduleEditorModal({
      mode: "create",
      onSaved: (row: ScheduleRow) => {
        Toast.success(t("schedule_created_success"));
        window.location.hash = `#/schedules/view/${encodeURIComponent(row.id)}`;
      },
    });
    return;
  }
  await renderViewPage(container, opts.id ?? "");
}

function renderCreateShell(container: HTMLElement): void {
  const title = `${t("add")} — ${t("schedule_management")}`;
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/schedules">${escapeHtml(t("schedule_management"))}</a></li>
          <li class="active">${escapeHtml(t("create_schedule"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
              <div class="pull-right">
                <a href="#/schedules" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <p class="text-muted">${escapeHtml(t("schedule_create_redirect_hint"))}</p>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

async function renderViewPage(container: HTMLElement, id: string): Promise<void> {
  const title = `${t("view_schedule")}${id ? ` #${id}` : ""}`;
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/schedules">${escapeHtml(t("schedule_management"))}</a></li>
          <li class="active">${escapeHtml(title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("view_schedule"))}</h6></div>
              <div class="pull-right">
                <a href="#/schedules" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body" id="schedule-view-body">
                <div class="text-center"><i class="fa fa-spinner fa-spin fa-2x"></i></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;

  const body = container.querySelector<HTMLElement>("#schedule-view-body");
  if (!body || !id) {
    if (body) body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("schedule_not_found"))}</div>`;
    return;
  }
  try {
    const row = await fetchSchedule(id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("schedule_not_found"))}</div>`;
      return;
    }
    body.innerHTML = renderDetail(row);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderDetail(row: ScheduleRow): string {
  const rows = [
    [t("schedules_name"), row.scheduleName],
    [t("schedules_id"), row.scheduleNumber],
    [t("schedules_type"), row.scheduleType],
    [t("lucky_number_prize"), String(row.luckyNumberPrize)],
    [t("status"), row.status],
    [t("manual_start_time"), row.manualStartTime || "—"],
    [t("manual_end_time"), row.manualEndTime || "—"],
    [t("creation_date_time"), row.createdAt],
  ];
  const detailHtml = rows
    .map(
      ([label, value]) =>
        `<tr><th style="width:30%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");
  const subgamesCount = row.subGames.length;
  const subgamesJson = JSON.stringify(row.subGames, null, 2);
  return `
    <table class="table table-striped">${detailHtml}</table>
    <h4>${escapeHtml(t("sub_games"))} (${subgamesCount})</h4>
    <pre style="max-height:400px;overflow:auto;background:#f5f5f5;padding:12px;border-radius:3px;">${escapeHtml(subgamesJson)}</pre>`;
}
