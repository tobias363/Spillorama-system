// /patternManagement/:typeId/add and /patternManagement/:typeId/edit/:id — 1:1
// port of legacy/unity-backend/App/Views/patternManagement/addPattern.html (604 lines).
//
// Renders the full legacy form read-only with a disabled Submit button and
// "Venter på backend-endpoint — BIN-627" banner. When BIN-627 ships, flip the
// disabled-flag + wire the submit handler in PatternState.savePattern.
//
// The 5x5 bitmask-grid is interactive — clicking a cell toggles its bit and
// updates the hidden mask-input. This provides full pattern-editing capability
// *in the UI* even though the save-action is gated behind BIN-627. The
// PatternMask value flows through toggleCell() from PatternState so the same
// encoding is used end-to-end with the Game 3 backend (PR-C3).
//
// Edit-mode: pre-fills values from fetchPattern(typeId, id). Add-mode: blank grid.

import { t } from "../../../i18n/I18n.js";
import {
  fetchPattern,
  toggleCell,
  isCellSet,
  countCells,
  maxPatternsForGameType,
  type PatternRow,
} from "./PatternState.js";
import { fetchGameType } from "../gameType/GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType, PatternMask } from "../common/types.js";

export async function renderPatternAddPage(
  container: HTMLElement,
  typeId: string
): Promise<void> {
  container.innerHTML = renderLoadingShell();
  try {
    const gameType = await fetchGameType(typeId);
    if (!gameType) {
      container.innerHTML = renderShell(null, null, `Game type "${typeId}" not found`, false);
      return;
    }
    container.innerHTML = renderShell(gameType, null, null, false);
    wireGrid(container, gameType, 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, null, msg, false);
  }
}

export async function renderPatternEditPage(
  container: HTMLElement,
  typeId: string,
  patternId: string
): Promise<void> {
  container.innerHTML = renderLoadingShell();
  try {
    const [gameType, row] = await Promise.all([
      fetchGameType(typeId),
      fetchPattern(typeId, patternId),
    ]);
    if (!gameType) {
      container.innerHTML = renderShell(null, null, `Game type "${typeId}" not found`, true);
      return;
    }
    // row is null until BIN-627 lands → render a blank-grid edit-shell anyway
    container.innerHTML = renderShell(gameType, row, null, true);
    wireGrid(container, gameType, row?.mask ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, null, msg, true);
  }
}

function renderLoadingShell(): string {
  return `<div class="text-center" style="padding:24px;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
}

function renderShell(
  gameType: GameType | null,
  pattern: PatternRow | null,
  error: string | null,
  isEdit: boolean
): string {
  const gameName = gameType?.name ?? "";
  const heading = `${isEdit ? t("edit") : t("add")} ${gameName} ${t("pattern_management")}`.trim();

  // Grid dimensions — default 5x5; rocket (game_2) 3x3, databingo60 3x5 etc.
  // Legacy inlined `gameData.row` + `gameData.columns`.
  const rows = gameType?.row ?? 5;
  const cols = gameType?.columns ?? 5;

  const mask = pattern?.mask ?? 0;
  const showGame1Flags = gameType?.type === "game_1";

  const gridHtml = renderGridHtml(rows, cols, mask);
  const flagsHtml = showGame1Flags ? renderGame1Flags(pattern) : "";

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;">${escapeHtml(error)}</div>`
    : "";

  const banner = `
    <div class="alert alert-warning" role="alert" style="margin:8px 16px;">
      <i class="fa fa-info-circle"></i>
      Venter på backend-endpoint.
      <strong>BIN-627</strong> Pattern CRUD må leveres før lagring er mulig.
      Rutenettet er interaktivt for å forhåndsvise mønster-bitmasken (grønn = satt).
    </div>`;

  // Max-patterns warning (Game 3: 32, Game 5: 17, etc.)
  const max = gameType ? maxPatternsForGameType(gameType.type) : null;
  const maxBlock =
    max !== null
      ? `<div class="alert alert-info" style="margin:8px 16px;">
           <i class="fa fa-info-circle"></i>
           Maks ${max} mønstre for ${escapeHtml(gameName)} (per legacy business-rule).
         </div>`
      : "";

  const typeIdAttr = gameType?._id ?? "";
  const backHref = typeIdAttr
    ? `#/patternManagement/${encodeURIComponent(typeIdAttr)}`
    : "#/admin";

  return `
    <style>
      .pattern-grid { border-collapse: separate; border-spacing: 4px; }
      .pattern-grid td { padding: 0; }
      .pattern-cell {
        display: inline-block; width: 50px; height: 50px;
        border: 2px solid #666; border-radius: 10px;
        cursor: pointer; transition: background 0.1s;
      }
      .pattern-cell.cell-on  { background: #5cb85c; border-color: #3a873a; }
      .pattern-cell.cell-off { background: #f3f3f3; }
      .pattern-cell:focus { outline: 2px solid #337ab7; }
    </style>
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="${backHref}">${escapeHtml(gameName)} ${escapeHtml(t("pattern_management"))}</a></li>
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
            ${maxBlock}
            ${errorBlock}
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <form class="form-horizontal" id="PatternForm" onsubmit="return false;">
                  <input type="hidden" id="patternId" value="${escapeHtml(pattern?._id ?? "")}">
                  <input type="hidden" id="maskValue" name="mask" value="${mask}">

                  <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">
                    <div class="form-group">
                      <div class="row">
                        <label class="mb-10 col-sm-12" for="patternName">${escapeHtml(t("pattern_name"))}:</label>
                        <div class="col-sm-12">
                          <input type="text" class="form-control" name="patternName" id="patternName"
                            value="${escapeHtml(pattern?.patternName ?? "")}"
                            placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("pattern_name"))}"
                            maxlength="40" disabled>
                        </div>
                      </div>
                    </div>

                    <div class="form-group">
                      <div class="row">
                        <label class="mb-10 col-sm-12">${escapeHtml(t("pattern_draw"))}:</label>
                        <div class="col-sm-12">
                          <div id="container">${gridHtml}</div>
                          <p class="text-muted" style="margin-top:8px;">
                            <span id="pattern-cell-count">${countCells(mask)}</span> / ${rows * cols} celler
                          </p>
                        </div>
                      </div>
                    </div>

                    ${flagsHtml}

                    <div class="form-group">
                      <div class="row">
                        <label class="mb-10 col-sm-12" for="status">${escapeHtml(t("status"))}:</label>
                        <div class="col-sm-12">
                          <div class="input-group">
                            <div class="input-group-addon"><i class="glyphicon glyphicon-thumbs-up"></i></div>
                            <select class="form-control" name="status" id="status" disabled>
                              <option value="active"${pattern?.status === "active" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
                              <option value="inactive"${pattern?.status === "inactive" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div></div></div>

                  <div style="clear:both;padding-top:16px;padding-left:16px;">
                    <button type="submit" class="btn btn-success btn-flat" disabled
                      title="Venter på backend-endpoint — BIN-627">
                      ${escapeHtml(t("submit"))}
                    </button>
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

/** Render the 5x5 (or NxM) bitmask-grid as a clickable table. */
function renderGridHtml(rows: number, cols: number, mask: PatternMask): string {
  let html = '<table class="pattern-grid" role="grid" aria-label="Pattern bitmask editor">';
  for (let r = 0; r < rows; r++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      const on = isCellSet(mask, r, c, cols);
      html += `<td><button type="button"
        class="pattern-cell ${on ? "cell-on" : "cell-off"}"
        data-row="${r}" data-col="${c}"
        aria-pressed="${on}"
        aria-label="Row ${r + 1} col ${c + 1}"></button></td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

/** Game 1 specific toggle flags (WoF, TChest, Mystery, RowPr, Jackpot, ExtraGame, LuckyBonus). */
function renderGame1Flags(pattern: PatternRow | null): string {
  const flag = (labelKey: string, name: string, value: boolean | undefined): string => `
    <div class="form-group">
      <div class="row">
        <label class="mb-10 col-sm-12">${escapeHtml(t(labelKey))}:</label>
        <div class="col-sm-12">
          <label style="margin-right:24px;">
            <input type="checkbox" name="${name}-yes" value="yes" disabled${value === true ? " checked" : ""}>
            ${escapeHtml(t("yes"))}
          </label>
          <label>
            <input type="checkbox" name="${name}-no" value="no" disabled${value === false ? " checked" : ""}>
            ${escapeHtml(t("no"))}
          </label>
        </div>
      </div>
    </div>`;
  return `
    ${flag("wheel_of_fortune", "wheelOfFortune", pattern?.isWoF)}
    ${flag("treasure_chest", "treasureChest", pattern?.isTchest)}
    ${flag("mystery_game", "mystery", pattern?.isMys)}
    ${flag("row_pattern_prize", "rowPrize", pattern?.isRowPr)}`;
}

/**
 * Wire up click-handlers on the bitmask-grid cells. The mask is stored as a
 * closure + synced to the hidden input so a future backend-save would pick
 * it up via FormData.get("mask").
 *
 * Exported so tests can drive it directly against a detached container.
 */
export function wireGrid(container: HTMLElement, gameType: GameType, initialMask: PatternMask): void {
  let mask: PatternMask = initialMask;
  const cols = gameType.columns;
  const maskInput = container.querySelector<HTMLInputElement>("#maskValue");
  const countEl = container.querySelector<HTMLElement>("#pattern-cell-count");

  const cells = container.querySelectorAll<HTMLButtonElement>(".pattern-cell");
  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      mask = toggleCell(mask, row, col, cols);
      const on = isCellSet(mask, row, col, cols);
      cell.classList.toggle("cell-on", on);
      cell.classList.toggle("cell-off", !on);
      cell.setAttribute("aria-pressed", String(on));
      if (maskInput) maskInput.value = String(mask);
      if (countEl) countEl.textContent = String(countCells(mask));
    });
  });
}
