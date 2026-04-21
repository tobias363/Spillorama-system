// /gameType/add and /gameType/edit/:id — 1:1 port of
//
// Renders the full legacy form read-only with a disabled Submit button and
// "Venter på backend-endpoint — BIN-620" banner. When BIN-620 ships, flip the
// disabled-flag + wire the submit handler in GameTypeState.saveGameType.
//
// Edit-mode: pre-fills values from fetchGameType(id). Add-mode: blank form.
// Both modes are non-functional for writes in PR-A3 per PM placeholder mönster.

import { t } from "../../../i18n/I18n.js";
import { fetchGameType } from "./GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderGameTypeAddPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(null, null, null);
}

export async function renderGameTypeEditPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, null, "(loading)");
  try {
    const gt = await fetchGameType(id);
    if (!gt) {
      container.innerHTML = renderShell(null, `Game type "${id}" not found`, null);
      return;
    }
    container.innerHTML = renderShell(gt, null, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg, null);
  }
}

function renderShell(gt: GameType | null, error: string | null, _loading: string | null): string {
  const isEdit = gt !== null;
  const heading = isEdit ? t("edit_game") : t("add_game");

  const showPattern =
    gt && (gt.type === "game_1" || gt.type === "game_3" || gt.type === "game_4" || gt.type === "game_5");

  // Matches legacy form shape (name, photo, optional pattern, row, columns, submit, cancel).
  const body = `
    <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">
      <div class="form-group">
        <div class="row">
          <label for="name" class="mb-10 col-sm-12">${escapeHtml(t("game_name"))}:</label>
          <div class="col-sm-12">
            <div class="input-group">
              <div class="input-group-addon"><i class="glyphicon glyphicon-user"></i></div>
              <input type="text" class="form-control" name="name" id="name"
                value="${escapeHtml(gt?.name ?? "")}"
                placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}"
                maxlength="20" disabled>
            </div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label for="avatar" class="mb-10 col-sm-12">${escapeHtml(t("photo"))}</label>
          <div class="col-sm-12">
            <div class="input-group">
              <div class="input-group-addon"><i class="glyphicon glyphicon-picture"></i></div>
              <input type="file" class="form-control" id="avatar" name="avatar" accept="image/png, image/jpeg" disabled>
            </div>
          </div>
        </div>
      </div>

      ${
        showPattern
          ? `<div class="form-group">
               <div class="row">
                 <div class="col col-md-2"><label for="pattern" class="form-control-label">${escapeHtml(t("pattern"))}</label></div>
                 <div class="col-10 col-md-6">
                   <label class="switch">
                     <input type="checkbox" name="pattern" disabled${gt?.pattern ? " checked" : ""}>
                     <span class="slider round"></span>
                   </label>
                 </div>
               </div>
             </div>`
          : ""
      }

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12">${escapeHtml(t("how_many_rows_allocate_in_a_ticket"))}:</label>
          <div class="col-sm-12">
            <input type="number" class="form-control" name="row" min="1"
              value="${escapeHtml(gt?.row ?? "")}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("row"))}"
              ${isEdit ? "readonly" : ""} disabled>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12">${escapeHtml(t("how_many_column_allocate_in_a_ticket"))}:</label>
          <div class="col-sm-12">
            <input type="number" class="form-control" name="columns" min="1"
              value="${escapeHtml(gt?.columns ?? "")}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("column"))}"
              ${isEdit ? "readonly" : ""} disabled>
          </div>
        </div>
      </div>
    </div></div></div>`;

  const banner = `
    <div class="alert alert-warning" role="alert" style="margin:8px 16px;">
      <i class="fa fa-info-circle"></i>
      Venter på backend-endpoint.
      <strong>BIN-620</strong> GameType CRUD må leveres før lagring er mulig.
    </div>`;

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;">${escapeHtml(error)}</div>`
    : "";

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/gameType">${escapeHtml(t("games"))}</a></li>
          <li class="active">${escapeHtml(heading)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading"><div class="pull-left">
              <h6 class="panel-title txt-dark">${escapeHtml(heading)}</h6>
            </div><div class="clearfix"></div></div>
            ${banner}
            ${errorBlock}
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <form class="form-horizontal" onsubmit="return false;" enctype="multipart/form-data">
                    ${body}
                    <div style="clear:both;padding-top:16px;">
                      <button type="submit" class="btn btn-success btn-flat" disabled
                        title="Venter på backend-endpoint — BIN-620">
                        ${escapeHtml(t("submit"))}
                      </button>
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
