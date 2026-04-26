// /gameType/add and /gameType/edit/:id — wired to BIN-620 backend
// (`/api/admin/game-types/*` via admin-game-types.ts).
//
// Edit-mode: pre-fills values from fetchGameType(id). Add-mode: blank form.
// On submit posts to backend via saveGameType and navigates back to list.

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { fetchGameType, saveGameType } from "./GameTypeState.js";
import { escapeHtml } from "../common/escape.js";
import type { GameType } from "../common/types.js";

export async function renderGameTypeAddPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell(null, null, null, false);
  wireForm(container, null);
}

export async function renderGameTypeEditPage(container: HTMLElement, id: string): Promise<void> {
  container.innerHTML = renderShell(null, null, "(loading)", true);
  try {
    const gt = await fetchGameType(id);
    if (!gt) {
      container.innerHTML = renderShell(null, `Game type "${id}" not found`, null, true);
      return;
    }
    container.innerHTML = renderShell(gt, null, null, true);
    wireForm(container, gt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(null, msg, null, true);
  }
}

function renderShell(
  gt: GameType | null,
  error: string | null,
  _loading: string | null,
  isEdit: boolean
): string {
  const heading = isEdit ? t("edit_game") : t("add_game");

  const showPattern =
    !gt ||
    gt.type === "game_1" ||
    gt.type === "game_3" ||
    gt.type === "game_4" ||
    gt.type === "game_5";

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
                maxlength="40" required>
            </div>
          </div>
        </div>
      </div>

      ${
        !isEdit
          ? `
      <div class="form-group">
        <div class="row">
          <label for="typeSlug" class="mb-10 col-sm-12">${escapeHtml(t("slug"))}:</label>
          <div class="col-sm-12">
            <div class="input-group">
              <div class="input-group-addon"><i class="glyphicon glyphicon-link"></i></div>
              <input type="text" class="form-control" name="typeSlug" id="typeSlug"
                value=""
                placeholder="bingo, rocket, ..."
                pattern="[a-z0-9-]+"
                maxlength="40">
            </div>
            <p class="help-block">${escapeHtml(t("slug_auto_generated_hint"))}</p>
          </div>
        </div>
      </div>`
          : ""
      }

      <div class="form-group">
        <div class="row">
          <label for="photo" class="mb-10 col-sm-12">${escapeHtml(t("photo"))} (${escapeHtml(t("filename"))}):</label>
          <div class="col-sm-12">
            <div class="input-group">
              <div class="input-group-addon"><i class="glyphicon glyphicon-picture"></i></div>
              <input type="text" class="form-control" id="photo" name="photo"
                value="${escapeHtml(gt?.photo ?? "")}"
                placeholder="bingo.png">
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
                     <input type="checkbox" name="pattern" id="pattern"${gt?.pattern ? " checked" : ""}>
                     <span class="slider round"></span>
                   </label>
                 </div>
               </div>
             </div>`
          : ""
      }

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="row">${escapeHtml(t("how_many_rows_allocate_in_a_ticket"))}:</label>
          <div class="col-sm-12">
            <input type="number" class="form-control" name="row" id="row" min="1"
              value="${escapeHtml(String(gt?.row ?? ""))}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("row"))}"
              required>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="row">
          <label class="mb-10 col-sm-12" for="columns">${escapeHtml(t("how_many_column_allocate_in_a_ticket"))}:</label>
          <div class="col-sm-12">
            <input type="number" class="form-control" name="columns" id="columns" min="1"
              value="${escapeHtml(String(gt?.columns ?? ""))}"
              placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("column"))}"
              required>
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
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
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
            ${errorBlock}
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="table-wrap"><div class="table-responsive">
                  <form id="gameTypeForm" class="form-horizontal"
                    data-existing-id="${escapeHtml(gt?._id ?? "")}">
                    ${body}
                    <div style="clear:both;padding-top:16px;padding-left:16px;">
                      <button type="submit" class="btn btn-success btn-flat" data-action="save-game-type">
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

export function wireForm(container: HTMLElement, existing: GameType | null): void {
  const form = container.querySelector<HTMLFormElement>("#gameTypeForm");
  if (!form) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, existing);
  });
}

async function submitForm(form: HTMLFormElement, existing: GameType | null): Promise<void> {
  const nameEl = form.querySelector<HTMLInputElement>("#name");
  const rowEl = form.querySelector<HTMLInputElement>("#row");
  const columnsEl = form.querySelector<HTMLInputElement>("#columns");
  const patternEl = form.querySelector<HTMLInputElement>("#pattern");
  const photoEl = form.querySelector<HTMLInputElement>("#photo");
  const typeSlugEl = form.querySelector<HTMLInputElement>("#typeSlug");
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const name = nameEl?.value.trim() ?? "";
  const rowNum = Number(rowEl?.value);
  const columnsNum = Number(columnsEl?.value);
  const pattern = patternEl?.checked ?? false;
  const photo = photoEl?.value.trim() || undefined;
  const typeSlug = typeSlugEl?.value.trim() || undefined;

  if (!name) {
    Toast.error(t("all_fields_are_required"));
    return;
  }
  if (!Number.isFinite(rowNum) || rowNum < 1) {
    Toast.error(t("all_fields_are_required"));
    return;
  }
  if (!Number.isFinite(columnsNum) || columnsNum < 1) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await saveGameType(
      {
        name,
        row: rowNum,
        columns: columnsNum,
        pattern,
        ...(photo !== undefined ? { photo } : {}),
        ...(typeSlug !== undefined ? { typeSlug } : {}),
      },
      existing?._id
    );
    if (result.ok) {
      Toast.success(t("success"));
      window.location.hash = "#/gameType";
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
