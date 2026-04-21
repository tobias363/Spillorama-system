//
// All fields rendered read-only (matches legacy `readonly` attrs). Cancel-button
// navigates back to list. No edit-link — the edit-button on list-page is a
// BIN-620 placeholder anyway.

import { t } from "../../../i18n/I18n.js";
import { fetchGameType } from "./GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderGameTypeViewPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, null);

  try {
    const gt = await fetchGameType(id);
    if (!gt) {
      container.innerHTML = renderShell(null, `Game type "${id}" not found`);
      return;
    }
    container.innerHTML = renderShell(gt, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg);
  }
}

function renderShell(gt: GameType | null, error: string | null): string {
  const field = (label: string, value: unknown, type: "text" | "number" = "text"): string => `
    <div class="form-group">
      <div class="row">
        <label class="mb-10 col-sm-12">${escapeHtml(label)}:</label>
        <div class="col-sm-12">
          <input type="${type}" class="form-control" readonly value="${escapeHtml(value ?? "—")}">
        </div>
      </div>
    </div>`;

  const patternRow =
    gt && (gt.type === "game_1" || gt.type === "game_3")
      ? `<div class="form-group">
           <div class="row">
             <div class="col col-md-2"><label class="form-control-label">${escapeHtml(t("pattern"))}</label></div>
             <div class="col-10 col-md-6">
               <label class="switch">
                 <input type="checkbox" disabled${gt.pattern ? " checked" : ""}>
                 <span class="slider round"></span>
               </label>
             </div>
           </div>
         </div>`
      : "";

  const body = gt
    ? `
      <div class="col-sm-6">
        <div class="panel-wrapper collapse in"><div class="panel-body">
          ${field(t("game_name"), gt.name)}
          ${patternRow}
          ${field(t("how_many_rows_allocate_in_a_ticket"), gt.row, "number")}
          ${field(t("how_many_column_allocate_in_a_ticket"), gt.columns, "number")}
        </div></div>
      </div>
      <div class="col-md-6">
        <div class="row form-group m-t-20">
          <div class="col-12 col-md-12 text-center">
            <div class="profile_img">
              <img src="/profile/bingo/${encodeURIComponent(gt.photo)}" alt="${escapeHtml(gt.name)}"
                style="height:300px;max-width:100%;object-fit:contain"/>
            </div>
          </div>
          <div class="col-12 col-md-12">
            <input type="text" disabled readonly style="text-align:center;"
              class="form-control input_button" value="${escapeHtml(gt.name)}">
          </div>
        </div>
      </div>`
    : error
      ? `<div class="alert alert-danger" style="margin:16px;">${escapeHtml(error)}</div>`
      : `<div class="text-center" style="padding:24px;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("view_game"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/gameType">${escapeHtml(t("games"))}</a></li>
          <li class="active">${escapeHtml(t("view_game"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading"><div class="pull-left">
              <h6 class="panel-title txt-dark">${escapeHtml(t("view_game"))}</h6>
            </div><div class="clearfix"></div></div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <form class="form-horizontal" onsubmit="return false;">
                    ${body}
                    <div style="clear:both;padding-top:16px;">
                      <a href="#/gameType" class="btn btn-danger btn-flat">${escapeHtml(t("cancel"))}</a>
                    </div>
                  </form>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}
