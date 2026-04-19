// DailySchedule detail pages — placeholders for 6 legacy views.
//
// Legacy files covered:
//   - view.html                   (385L)  → /dailySchedule/view
//   - create.html                 (878L)  → /dailySchedule/create/:typeId
//   - createSpecialSchedules.html (951L)  → /dailySchedule/special/:typeId
//   - scheduleGame.html           (1221L) → /dailySchedule/scheduleGame/:id
//   - editSubgame.html            (1336L) → /dailySchedule/subgame/edit/:id
//   - viewSubgame.html            (2220L) → /dailySchedule/subgame/view/:id
//
// All pages placeholder-mounted with BIN-626 backend-missing banner per the
// same pattern as the GameManagement/SavedGame detail pages.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";

export type DailyScheduleKind =
  | "view"
  | "create"
  | "special"
  | "scheduleGame"
  | "subgame-edit"
  | "subgame-view";

export interface DailyScheduleDetailOpts {
  kind: DailyScheduleKind;
  /** typeId — only used for create/special. */
  typeId?: string;
  /** Subgame/scheduleGame row id. */
  id?: string;
}

const KIND_TITLES: Record<DailyScheduleKind, string> = {
  view: "Daglig tidsplan — oversikt",
  create: "Daglig tidsplan — opprett",
  special: "Daglig tidsplan — spesialdag",
  scheduleGame: "Planlegg spill",
  "subgame-edit": "Rediger underspill",
  "subgame-view": "Vis underspill",
};

export async function renderDailyScheduleDetailPages(
  container: HTMLElement,
  opts: DailyScheduleDetailOpts
): Promise<void> {
  const title = KIND_TITLES[opts.kind];
  const paramLine = [
    opts.typeId ? `typeId: <code>${escapeHtml(opts.typeId)}</code>` : "",
    opts.id ? `id: <code>${escapeHtml(opts.id)}</code>` : "",
  ]
    .filter(Boolean)
    .join(" — ");
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/dailySchedule/view">${escapeHtml("Daglig tidsplan")}</a></li>
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
                  <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint for DailySchedule-stacken.
                  <strong>BIN-626</strong> må leveres før denne siden er funksjonell.
                </div>
                ${paramLine ? `<p class="text-muted">${paramLine}</p>` : ""}
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}
