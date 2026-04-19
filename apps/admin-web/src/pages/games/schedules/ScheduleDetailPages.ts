// Schedule detail pages — placeholders for create (5 382L legacy) and view (902L).
//
// Risk per PR-A3-PLAN.md §6.3: schedules/create.html is the largest legacy file.
// The full scheduler-builder lands in BIN-625 follow-up; this placeholder keeps
// the route mounted with the correct breadcrumb and backend-missing banner.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";

export type ScheduleDetailKind = "create" | "view";

export interface ScheduleDetailOpts {
  kind: ScheduleDetailKind;
  id?: string;
}

export async function renderScheduleDetailPages(
  container: HTMLElement,
  opts: ScheduleDetailOpts
): Promise<void> {
  const title =
    opts.kind === "create"
      ? `${t("add")} — ${t("schedule_management")}`
      : `${t("view")} — ${t("schedule_management")} #${opts.id ?? ""}`;
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
                <div class="alert alert-warning">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint for Schedule-stacken.
                  <strong>BIN-625</strong> må leveres før denne siden er funksjonell.
                  ${
                    opts.kind === "create"
                      ? '<br><small class="text-muted">Legacy create.html er 5 382 linjer — kompleksbyggeren lander i BIN-625 oppfølger.</small>'
                      : ""
                  }
                </div>
                ${opts.id ? `<p class="text-muted">id: <code>${escapeHtml(opts.id)}</code></p>` : ""}
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}
