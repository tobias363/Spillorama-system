// /patternManagement/:typeId/view/:id — 1:1 port of
// legacy/unity-backend/App/Views/patternManagement/viewPatternDetails.html (345 lines).
//
// All fields rendered read-only. The bitmask-grid is rendered as a static
// visual (same boxes as the editor, but non-interactive) so an admin can see
// exactly which cells the pattern claims. Cancel-button navigates back to list.
//
// Until BIN-627 backend lands, this page shows a pending-banner + empty grid.

import { t } from "../../../i18n/I18n.js";
import { fetchPattern, isCellSet, countCells, type PatternRow } from "./PatternState.js";
import { fetchGameType } from "../gameType/GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType, PatternMask } from "../common/types.js";

export async function renderPatternViewPage(
  container: HTMLElement,
  typeId: string,
  patternId: string
): Promise<void> {
  container.innerHTML = `<div class="text-center" style="padding:24px;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;

  try {
    const [gameType, pattern] = await Promise.all([
      fetchGameType(typeId),
      fetchPattern(typeId, patternId),
    ]);
    if (!gameType) {
      container.innerHTML = renderShell(null, null, `Game type "${typeId}" not found`);
      return;
    }
    container.innerHTML = renderShell(gameType, pattern, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, null, msg);
  }
}

function renderShell(
  gameType: GameType | null,
  pattern: PatternRow | null,
  error: string | null
): string {
  const gameName = gameType?.name ?? "";
  const heading = `${t("view")} ${gameName} ${t("pattern_management")}`.trim();

  const rows = gameType?.row ?? 5;
  const cols = gameType?.columns ?? 5;
  const mask = pattern?.mask ?? 0;

  const typeIdAttr = gameType?._id ?? "";
  const backHref = typeIdAttr
    ? `#/patternManagement/${encodeURIComponent(typeIdAttr)}`
    : "#/admin";

  const gridHtml = renderGridHtml(rows, cols, mask);
  const showGame1 = gameType?.type === "game_1";
  const flagsHtml = showGame1 ? renderFlags(pattern) : "";

  const body = pattern
    ? `
      <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">
        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("pattern_name"))}:</label>
            <div class="col-sm-12">
              <input type="text" class="form-control" readonly disabled value="${escapeHtml(pattern.patternName)}">
            </div>
          </div>
        </div>
        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("pattern_draw"))}:</label>
            <div class="col-sm-12">
              <div id="container">${gridHtml}</div>
              <p class="text-muted" style="margin-top:8px;">${countCells(mask)} / ${rows * cols} celler</p>
            </div>
          </div>
        </div>
        ${flagsHtml}
        <div class="form-group">
          <div class="row">
            <label class="mb-10 col-sm-12">${escapeHtml(t("status"))}:</label>
            <div class="col-sm-12">
              <input type="text" class="form-control" readonly disabled
                value="${escapeHtml(pattern.status === "active" ? t("active") : t("inactive"))}">
            </div>
          </div>
        </div>
      </div></div></div>`
    : error
      ? `<div class="alert alert-danger" style="margin:16px;">${escapeHtml(error)}</div>`
      : `<div class="alert alert-warning" style="margin:16px;">
           <i class="fa fa-info-circle"></i>
           Venter på backend-endpoint.
           <strong>BIN-627</strong> Pattern view må leveres før data vises.
         </div>`;

  return `
    <style>
      .pattern-grid-view { border-collapse: separate; border-spacing: 4px; }
      .pattern-grid-view td { padding: 0; }
      .pattern-cell-view {
        display: inline-block; width: 50px; height: 50px;
        border: 2px solid #666; border-radius: 10px;
      }
      .pattern-cell-view.cell-on  { background: #5cb85c; border-color: #3a873a; }
      .pattern-cell-view.cell-off { background: #f3f3f3; }
    </style>
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="${backHref}">${escapeHtml(gameName)}</a></li>
          <li class="active">${escapeHtml(heading)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading"><div class="pull-left">
              <h6 class="panel-title txt-dark">${escapeHtml(heading)}</h6>
            </div><div class="clearfix"></div></div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <form class="form-horizontal" onsubmit="return false;">
                  ${body}
                  <div style="clear:both;padding-top:16px;padding-left:16px;">
                    <a href="${backHref}" class="btn btn-danger btn-flat">${escapeHtml(t("cancel"))}</a>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderGridHtml(rows: number, cols: number, mask: PatternMask): string {
  let html = '<table class="pattern-grid-view" role="grid" aria-label="Pattern bitmask (read-only)">';
  for (let r = 0; r < rows; r++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      const on = isCellSet(mask, r, c, cols);
      html += `<td><span class="pattern-cell-view ${on ? "cell-on" : "cell-off"}"
        aria-label="Row ${r + 1} col ${c + 1} ${on ? "set" : "off"}"></span></td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

function renderFlags(pattern: PatternRow | null): string {
  if (!pattern) return "";
  const flag = (labelKey: string, value: boolean | undefined): string => {
    const yes = value === true;
    const no = value === false;
    return `
      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12">${escapeHtml(t(labelKey))}:</label>
          <div class="col-sm-12">
            <label style="margin-right:24px;">
              <input type="checkbox" disabled${yes ? " checked" : ""}>
              ${escapeHtml(t("yes"))}
            </label>
            <label>
              <input type="checkbox" disabled${no ? " checked" : ""}>
              ${escapeHtml(t("no"))}
            </label>
          </div>
        </div>
      </div>`;
  };
  return `
    ${flag("wheel_of_fortune", pattern.isWoF)}
    ${flag("treasure_chest", pattern.isTchest)}
    ${flag("mystery_game", pattern.isMys)}
    ${flag("row_pattern_prize", pattern.isRowPr)}`;
}
