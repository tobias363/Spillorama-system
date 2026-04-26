// SavedGame detail pages — view + edit form for SavedGame templates.
//
// Wired to BIN-624 backend per admin-saved-games API. `add` is no longer a
// distinct flow — new templates are created from GameManagement by saving a
// running game (legacy behavior). So renderSavedGameDetailPages handles:
//   - view: read-only snapshot of the saved-game config
//   - view-g3: Game 3 variant (same layout, different header)
//   - edit: rename + status toggle (config is opaque JSON)
//   - add: returns a placeholder for now — the "save" flow is initiated from
//          GameManagement, not from this page.
//
// Legacy files covered:
//   - savedGame/gameView.html       (1 578L) → view
//   - savedGame/game3View.html      (  445L) → view-g3
//   - savedGame/editSaveGame3.html  (1 874L) → edit (collapsed to rename+status)
//   - savedGame/gameAdd.html        (2 043L) → add (referred to GameManagement)

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../common/escape.js";
import { fetchSavedGame, saveSavedGame, type SavedGameRow } from "./SavedGameState.js";
import { ApiError } from "../../../api/client.js";

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

  if (opts.kind === "add") {
    container.innerHTML = renderAddShell(title);
    return;
  }

  container.innerHTML = renderShell(title, loadingBody());
  const body = container.querySelector<HTMLElement>(".panel-body");
  if (!body) return;

  if (!opts.id) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(t("not_found"))}</div>`;
    return;
  }

  try {
    const sg = await fetchSavedGame(opts.id);
    if (!sg) {
      body.innerHTML = `<div class="alert alert-warning" data-testid="savedGame-not-found">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    if (opts.kind === "edit") {
      body.innerHTML = renderEditBody(sg);
      wireEditForm(container, sg);
    } else {
      body.innerHTML = renderViewBody(sg);
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function loadingBody(): string {
  return `<div class="text-center" style="padding:24px;"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
}

function renderShell(title: string, body: string): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
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
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">${body}</div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderAddShell(title: string): string {
  // Legacy "add" was driven from game config UI — not from this page.
  return renderShell(
    title,
    `<div class="alert alert-info">
       <i class="fa fa-info-circle" aria-hidden="true"></i>
       ${escapeHtml(t("saved_game_add_via_gm_hint"))}
       <a href="#/gameManagement" class="btn btn-primary btn-sm" style="margin-left:8px;">
         ${escapeHtml(t("game_creation_management"))}
       </a>
     </div>`
  );
}

function renderViewBody(sg: SavedGameRow): string {
  return `
    <div data-testid="savedGame-view">
      <table class="table table-bordered" style="max-width:700px;">
        <tbody>
          <tr><th style="width:30%;">${escapeHtml(t("game_name"))}</th><td>${escapeHtml(sg.name)}</td></tr>
          <tr><th>${escapeHtml(t("game_type"))}</th><td>${escapeHtml(sg.gameTypeId)}</td></tr>
          <tr><th>${escapeHtml(t("status"))}</th><td>${escapeHtml(sg.status === "active" ? t("active") : t("inactive"))}</td></tr>
          <tr><th>${escapeHtml(t("created_at"))}</th><td>${escapeHtml(sg.createdAt)}</td></tr>
        </tbody>
      </table>
      <p class="text-muted"><i class="fa fa-info-circle" aria-hidden="true"></i> ${escapeHtml(t("saved_game_config_opaque_hint"))}</p>
    </div>`;
}

function renderEditBody(sg: SavedGameRow): string {
  return `
    <form id="savedGameForm" class="form-horizontal" data-existing-id="${escapeHtml(sg._id)}">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="sg-name">${escapeHtml(t("game_name"))}</label>
        <div class="col-sm-9">
          <input type="text" id="sg-name" class="form-control" value="${escapeHtml(sg.name)}" maxlength="80" required>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="sg-status">${escapeHtml(t("status"))}</label>
        <div class="col-sm-9">
          <select id="sg-status" class="form-control">
            <option value="active"${sg.status === "active" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="inactive"${sg.status === "inactive" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-saved-game">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("submit"))}
          </button>
          <a href="#/savedGameList" class="btn btn-default">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;
}

function wireEditForm(container: HTMLElement, existing: SavedGameRow): void {
  const form = container.querySelector<HTMLFormElement>("#savedGameForm");
  if (!form) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitEdit(form, existing);
  });
}

async function submitEdit(form: HTMLFormElement, existing: SavedGameRow): Promise<void> {
  const nameEl = form.querySelector<HTMLInputElement>("#sg-name");
  const statusEl = form.querySelector<HTMLSelectElement>("#sg-status");
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const name = nameEl?.value.trim() ?? "";
  const status = statusEl?.value === "inactive" ? "inactive" : "active";

  if (!name) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await saveSavedGame(
      {
        gameTypeId: existing.gameTypeId,
        name,
        status: status as "active" | "inactive",
      },
      existing._id
    );
    if (result.ok) {
      Toast.success(t("success"));
      window.location.hash = "#/savedGameList";
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
