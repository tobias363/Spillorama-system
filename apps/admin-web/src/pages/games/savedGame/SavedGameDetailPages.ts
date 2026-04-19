// SavedGame detail pages — placeholders for add / view / view-g3 / edit.
//
// Legacy files covered:
//   - savedGame/gameAdd.html        (2 043L) → add (BIN-624)
//   - savedGame/gameView.html       (1 578L) → view  (BIN-624)
//   - savedGame/game3View.html      (  445L) → view-g3 (BIN-624)
//   - savedGame/editSaveGame3.html  (1 874L) → edit (BIN-624)
//
// Detail list (legacy `/savedGameDetailList/:id`) is inline with the main list
// in the legacy UI and is not a separate ported page.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";

export type SavedGameDetailKind = "add" | "view" | "view-g3" | "edit";

export interface SavedGameDetailOpts {
  kind: SavedGameDetailKind;
  typeId: string;
  id?: string;
}

export async function renderSavedGameDetailPages(
  container: HTMLElement,
  opts: SavedGameDetailOpts
): Promise<void> {
  const titles: Record<SavedGameDetailKind, string> = {
    add: `${t("add")} — ${t("saved_game_list")}`,
    view: `${t("view")} — ${t("saved_game_list")} #${opts.id ?? ""}`,
    "view-g3": `${t("view")} (Spill 3) — ${t("saved_game_list")} #${opts.id ?? ""}`,
    edit: `${t("edit")} — ${t("saved_game_list")} #${opts.id ?? ""}`,
  };
  const title = titles[opts.kind];
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/savedGameList">${escapeHtml(t("saved_game_list"))}</a></li>
          <li class="active">${escapeHtml(title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
              <div class="pull-right">
                <a href="#/savedGameList" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning">
                  <i class="fa fa-info-circle"></i>
                  Venter på backend-endpoint for SavedGame-stacken.
                  <strong>BIN-624</strong> må leveres før denne siden er funksjonell.
                </div>
                <p class="text-muted">typeId: <code>${escapeHtml(opts.typeId)}</code>${
                  opts.id ? ` — id: <code>${escapeHtml(opts.id)}</code>` : ""
                }</p>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}
