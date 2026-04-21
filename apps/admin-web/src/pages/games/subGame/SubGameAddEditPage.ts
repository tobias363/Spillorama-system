// /subGame/add and /subGame/edit/:id — 1:1 port of
//
// Renders the full legacy form read-only with a disabled Submit button and
// "Venter på backend-endpoint — BIN-621" banner. When BIN-621 ships, flip the
// disabled-flag + wire the submit handler in SubGameState.saveSubGame.
//
// Edit-mode: pre-fills values from fetchSubGame(id). Add-mode: blank form.
// Both modes are non-functional for writes in PR-A3 per PM placeholder mönster.
//
// Legacy had two multi-select dropdowns (pattern-rows + ticket colors) backed
// by Select2. We render them as disabled <select multiple> — the underlying
// options are shown so admins can see the legacy vocabulary.

import { t } from "../../../i18n/I18n.js";
import {
  fetchSubGame,
  LEGACY_TICKET_COLOR_OPTIONS,
  type SubGameRow,
} from "./SubGameState.js";
import { escapeHtml } from "../common/escape.js";

export async function renderSubGameAddPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(null, null);
}

export async function renderSubGameEditPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, "(loading)");
  try {
    const sg = await fetchSubGame(id);
    if (!sg) {
      // PLACEHOLDER: fetchSubGame returns null until BIN-621. Show a
      // distinct banner so the admin knows this is backend-pending, not a
      // "really not found" 404.
      container.innerHTML = renderShell(null, null);
      return;
    }
    container.innerHTML = renderShell(sg, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg);
  }
}

function renderShell(sg: SubGameRow | null, error: string | null): string {
  const isEdit = sg !== null;
  const heading = isEdit ? t("edit_sub_game") : t("add_sub_game");

  const selectedPatternIds = new Set(sg?.patternRow.map((p) => p.patternId) ?? []);
  const selectedColors = new Set(sg?.ticketColor.map((c) => c.name) ?? []);

  // Pattern-row options: until BIN-621 exposes the catalog via API, we
  // render whatever is already referenced by the current sub-game plus
  // a hint that options are pending. This keeps edit-view correct.
  const patternOptions = sg?.patternRow.map((p) => ({ id: p.patternId, name: p.name })) ?? [];

  const body = `
    <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="gameName">${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}:</label>
          <div class="col-sm-6">
            <input type="text" class="form-control" name="gameName" id="gameName"
              value="${escapeHtml(sg?.gameName ?? "")}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}"
              maxlength="40" disabled>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="patternRowSelected">${escapeHtml(t("select_pattern_row"))}:</label>
          <div class="col-sm-6">
            <select class="form-control" multiple disabled id="patternRowSelected" name="selectPatternRow">
              ${
                patternOptions.length > 0
                  ? patternOptions
                      .map(
                        (p) =>
                          `<option value="${escapeHtml(p.id)}"${
                            selectedPatternIds.has(p.id) ? " selected" : ""
                          }>${escapeHtml(p.name)}</option>`
                      )
                      .join("")
                  : `<option disabled>${escapeHtml(t("no_data_available"))} (BIN-621)</option>`
              }
            </select>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="ticketColorSelected">${escapeHtml(t("select_ticket_color"))}:</label>
          <div class="col-sm-6">
            <select class="form-control" multiple disabled id="ticketColorSelected" name="selectTicketColor">
              ${LEGACY_TICKET_COLOR_OPTIONS.map(
                (c) =>
                  `<option value="${escapeHtml(c)}"${selectedColors.has(c) ? " selected" : ""}>${escapeHtml(c)}</option>`
              ).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="status">${escapeHtml(t("status"))}:</label>
          <div class="col-sm-6">
            <div class="input-group">
              <div class="input-group-addon"><i class="glyphicon glyphicon-thumbs-up"></i></div>
              <select class="form-control" name="status" id="status" disabled>
                <option value="active"${sg?.status === "active" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
                <option value="inactive"${sg?.status === "inactive" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div></div></div>`;

  const banner = `
    <div class="alert alert-warning" role="alert" style="margin:8px 16px;">
      <i class="fa fa-info-circle"></i>
      Venter på backend-endpoint.
      <strong>BIN-621</strong> SubGame CRUD må leveres før lagring er mulig.
    </div>`;

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;">${escapeHtml(error)}</div>`
    : "";

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("sub_game_table"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/subGame">${escapeHtml(t("sub_game"))}</a></li>
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
                  <form class="form-horizontal" onsubmit="return false;">
                    ${body}
                    <div style="clear:both;padding-top:16px;padding-left:16px;">
                      <button type="submit" class="btn btn-success btn-flat" disabled
                        title="Venter på backend-endpoint — BIN-621">
                        ${escapeHtml(t("submit"))}
                      </button>
                      <a href="#/subGame" class="btn btn-danger btn-flat">${escapeHtml(t("cancel"))}</a>
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
