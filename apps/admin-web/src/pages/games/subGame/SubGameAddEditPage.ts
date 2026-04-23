// /subGame/add and /subGame/edit/:id — wired to BIN-621 backend
// (`/api/admin/sub-games/*` via admin-sub-games.ts).
//
// Edit-mode: pre-fills values from fetchSubGame(id). Add-mode: blank form.

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import {
  fetchSubGame,
  saveSubGame,
  isGameNameLocallyValid,
  LEGACY_TICKET_COLOR_OPTIONS,
  type SubGameRow,
} from "./SubGameState.js";
import { fetchGameTypeList } from "../gameType/GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderSubGameAddPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(null, null, []);
  try {
    const gameTypes = await fetchGameTypeList();
    container.innerHTML = renderShell(null, null, gameTypes);
    wireForm(container, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg, []);
  }
}

export async function renderSubGameEditPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, "(loading)", []);
  try {
    const [sg, gameTypes] = await Promise.all([fetchSubGame(id), fetchGameTypeList()]);
    if (!sg) {
      container.innerHTML = renderShell(null, `Sub-game "${id}" not found`, gameTypes);
      return;
    }
    container.innerHTML = renderShell(sg, null, gameTypes);
    wireForm(container, sg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg, []);
  }
}

function renderShell(
  sg: SubGameRow | null,
  error: string | null,
  gameTypes: GameType[]
): string {
  const isEdit = sg !== null;
  const heading = isEdit ? t("edit_sub_game") : t("add_sub_game");

  const selectedColors = new Set(sg?.ticketColor.map((c) => c.name) ?? []);

  // Default to bingo (game_1) for new sub-games.
  const currentGameTypeId = sg?.gameTypeId ?? (gameTypes.find((g) => g.type === "game_1")?._id ?? gameTypes[0]?._id ?? "");

  const body = `
    <div class="col-sm-8"><div class="panel-wrapper collapse in"><div class="panel-body">

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="gameTypeId">${escapeHtml(t("game_type"))}:</label>
          <div class="col-sm-6">
            <select class="form-control" id="gameTypeId" name="gameTypeId" ${isEdit ? "disabled" : ""}>
              ${gameTypes
                .map(
                  (gt) =>
                    `<option value="${escapeHtml(gt._id)}"${gt._id === currentGameTypeId ? " selected" : ""}>${escapeHtml(gt.name)}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="gameName">${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}:</label>
          <div class="col-sm-6">
            <input type="text" class="form-control" name="gameName" id="gameName"
              value="${escapeHtml(sg?.gameName ?? "")}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}"
              maxlength="40" required>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="selectPatternRow">${escapeHtml(t("select_pattern_row"))}:</label>
          <div class="col-sm-6">
            <input type="text" class="form-control" id="selectPatternRow" name="selectPatternRow"
              value="${escapeHtml(sg?.patternRow.map((p) => p.patternId).join(",") ?? "")}"
              placeholder="pattern-id,pattern-id">
            <p class="help-block">${escapeHtml(t("pattern_ids_comma_separated_hint"))}</p>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="ticketColorSelected">${escapeHtml(t("select_ticket_color"))}:</label>
          <div class="col-sm-6">
            <select class="form-control" multiple id="ticketColorSelected" name="selectTicketColor" style="height:120px;">
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
              <select class="form-control" name="status" id="status">
                <option value="active"${sg?.status !== "inactive" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
                <option value="inactive"${sg?.status === "inactive" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div></div></div>`;

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
            ${errorBlock}
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <form id="subGameForm" class="form-horizontal"
                    data-existing-id="${escapeHtml(sg?._id ?? "")}">
                    ${body}
                    <div style="clear:both;padding-top:16px;padding-left:16px;">
                      <button type="submit" class="btn btn-success btn-flat" data-action="save-sub-game">
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

export function wireForm(container: HTMLElement, existing: SubGameRow | null): void {
  const form = container.querySelector<HTMLFormElement>("#subGameForm");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, existing);
  });
}

async function submitForm(form: HTMLFormElement, existing: SubGameRow | null): Promise<void> {
  const gameTypeIdEl = form.querySelector<HTMLSelectElement>("#gameTypeId");
  const gameNameEl = form.querySelector<HTMLInputElement>("#gameName");
  const patternRowEl = form.querySelector<HTMLInputElement>("#selectPatternRow");
  const ticketColorEl = form.querySelector<HTMLSelectElement>("#ticketColorSelected");
  const statusEl = form.querySelector<HTMLSelectElement>("#status");
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const gameTypeId = gameTypeIdEl?.value.trim() ?? "";
  const gameName = gameNameEl?.value.trim() ?? "";
  const patternRowStr = patternRowEl?.value.trim() ?? "";
  const selectPatternRow = patternRowStr
    ? patternRowStr.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const selectTicketColor = ticketColorEl
    ? Array.from(ticketColorEl.selectedOptions).map((o) => o.value)
    : [];
  const status = (statusEl?.value === "inactive" ? "inactive" : "active") as "active" | "inactive";

  if (!isGameNameLocallyValid(gameName)) {
    Toast.error(t("all_fields_are_required"));
    return;
  }
  if (!existing && !gameTypeId) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await saveSubGame(
      {
        gameTypeId,
        gameName,
        selectPatternRow,
        selectTicketColor,
        status,
      },
      existing?._id
    );
    if (result.ok) {
      Toast.success(t("success"));
      window.location.hash = "#/subGame";
      return;
    }
    Toast.error(result.message ?? t("something_went_wrong"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
