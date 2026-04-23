//
// All fields rendered read-only (matches legacy `readonly disabled` attrs).
// Cancel-button navigates back to list. No edit-link — the edit-button on the
// list-page is a BIN-621 placeholder anyway.

import { t } from "../../../i18n/I18n.js";
import { fetchSubGame, type SubGameRow } from "./SubGameState.js";
import { escapeHtml } from "../common/escape.js";

export async function renderSubGameViewPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, null);

  try {
    const sg = await fetchSubGame(id);
    if (!sg) {
      // Until BIN-621 backend lands, every view comes up empty — show a
      // pending-banner rather than a hard 404.
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
  const patternList = sg?.patternRow ?? [];
  const colorList = sg?.ticketColor ?? [];

  const list = (items: Array<{ name: string }>, emptyLabel: string): string => {
    if (items.length === 0) return `<span class="text-muted">${escapeHtml(emptyLabel)}</span>`;
    return items
      .map(
        (it, idx) =>
          `<div class="col-lg-2 m-b-1" style="font-weight:bold;text-align:center;">${
            idx + 1
          }] ${escapeHtml(it.name)}</div>`
      )
      .join("");
  };

  const body = sg
    ? `
      <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">

        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}:</label>
            <div class="col-sm-6">
              <input type="text" class="form-control" readonly disabled value="${escapeHtml(sg.gameName)}">
            </div>
          </div>
        </div>

        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("selected_pattern_row"))}:</label>
            <div class="col-sm-12">${list(patternList, t("no_data_available"))}</div>
          </div>
        </div>

        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("number_of_pattern_rows"))}:</label>
            <div class="col-sm-6">
              <span style="font-weight:bold;text-align:center;">${patternList.length}</span>
            </div>
          </div>
        </div>

        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("selected_ticket_color"))}:</label>
            <div class="col-sm-12">${list(colorList, t("no_data_available"))}</div>
          </div>
        </div>

        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("status"))}:</label>
            <div class="col-sm-6">
              <div class="input-group">
                <div class="input-group-addon"><i class="glyphicon glyphicon-thumbs-up"></i></div>
                <input type="text" class="form-control" readonly disabled
                  value="${escapeHtml(sg.status === "active" ? t("active") : t("inactive"))}">
              </div>
            </div>
          </div>
        </div>

      </div></div></div>`
    : error
      ? `<div class="alert alert-danger" style="margin:16px;">${escapeHtml(error)}</div>`
      : `<div class="alert alert-warning" style="margin:16px;" data-testid="subGame-not-found">
           <i class="fa fa-info-circle"></i>
           ${escapeHtml(t("not_found"))}
           <small style="opacity:0.75;margin-left:6px;">(BIN-621)</small>
         </div>`;

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("sub_game_table"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/subGame">${escapeHtml(t("sub_game"))}</a></li>
          <li class="active">${escapeHtml(t("view_sub_game"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-md-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading"><div class="pull-left">
              <h6 class="panel-title txt-dark">${escapeHtml(t("view_sub_game"))}</h6>
            </div><div class="clearfix"></div></div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="row"><div class="col-sm-12 col-xs-12"><div class="form-wrap">
                  <form class="form-horizontal" onsubmit="return false;">
                    ${body}
                    <div style="clear:both;padding-top:16px;padding-left:16px;">
                      <a href="#/subGame" class="btn btn-danger btn-flat">${escapeHtml(t("cancel"))}</a>
                    </div>
                  </form>
                </div></div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}
