// BIN-679 — otherGames delte helpers.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getMiniGameConfig,
  updateMiniGameConfig,
  type MiniGameConfig,
  type MiniGameType,
} from "../../api/admin-other-games.js";
import { ApiError } from "../../api/client.js";

/** Render page shell med banner + box + form-host. */
export function renderOtherGamesShell(
  container: HTMLElement,
  titleKey: string,
  moduleKey: string,
  formHostId: string,
  testIdPrefix: string
): HTMLElement {
  container.innerHTML = `
    ${contentHeader(titleKey, moduleKey)}
    <section class="content">
      <div class="callout callout-info" data-testid="${escapeHtml(testIdPrefix)}-wired-banner">
        <i class="fa fa-info-circle"></i>
        ${escapeHtml(t("mini_games_wired_banner"))}
      </div>
      ${boxOpen(titleKey, "primary")}
        <div id="${escapeHtml(formHostId)}">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;
  return container.querySelector<HTMLElement>(`#${formHostId}`)!;
}

/** Render strukturert numeric prize grid med `count` inputs. */
export function renderPrizeGrid(
  values: number[],
  count: number,
  namePrefix: string,
  colSize: "col-lg-1" | "col-lg-2"
): string {
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = values[i] ?? 0;
    items.push(`
      <li class="${colSize} m-b-1" style="display:inline-block;padding:4px;">
        <input type="number"
               class="form-control"
               name="${escapeHtml(namePrefix)}-${i}"
               data-index="${i}"
               min="0"
               required
               value="${escapeHtml(String(v))}">
      </li>`);
  }
  return `<ul style="list-style:none;padding:0;margin:0;">${items.join("")}</ul>`;
}

/** Collect prize values fra en form input-set med data-index. */
export function collectPrizes(form: HTMLFormElement, namePrefix: string, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const el = form.querySelector<HTMLInputElement>(`input[name="${namePrefix}-${i}"]`);
    out.push(el ? Number(el.value) || 0 : 0);
  }
  return out;
}

/** Active-flagg + JSON-preview + submit-row. */
export function activeAndJsonRow(
  active: boolean,
  config: Record<string, unknown>
): string {
  const originalJson = JSON.stringify(config, null, 2);
  return `
    <hr>
    <div class="form-group">
      <label class="col-sm-2 control-label" for="mg-active">${escapeHtml(t("mini_games_active"))}</label>
      <div class="col-sm-10">
        <input type="checkbox" id="mg-active" name="active" data-testid="mg-active" ${active ? "checked" : ""}>
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-2 control-label" for="mg-config-json">${escapeHtml(t("mini_games_config_json"))}</label>
      <div class="col-sm-10">
        <textarea id="mg-config-json"
                  name="config"
                  class="form-control"
                  rows="8"
                  data-testid="mg-config-json"
                  data-original-json="${escapeHtml(originalJson)}">${escapeHtml(originalJson)}</textarea>
        <p class="help-block"><small>${escapeHtml(t("mini_games_config_json_help"))}</small></p>
      </div>
    </div>`;
}

/** Submit-button row (shared). */
export function submitRow(backHash: string = "#/admin"): string {
  return `
    <div class="form-group">
      <div class="col-sm-offset-2 col-sm-10">
        <button type="submit" class="btn btn-success" data-action="save-prizes" data-testid="mg-submit">
          <i class="fa fa-save"></i> ${escapeHtml(t("save"))}
        </button>
        <a class="btn btn-default" href="${escapeHtml(backHash)}">${escapeHtml(t("cancel"))}</a>
      </div>
    </div>`;
}

/**
 * Load-helper: Henter config + håndterer load-fail med banner.
 * Returnerer `null` hvis load feilet (caller skal stoppe).
 */
export async function loadMiniGameConfig(
  host: HTMLElement,
  gameType: MiniGameType
): Promise<MiniGameConfig | null> {
  try {
    return await getMiniGameConfig(gameType);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="mg-load-error">${escapeHtml(message)}</div>`;
    return null;
  }
}

/**
 * Save-helper: serialiserer form-state (strukturert del + JSON-del) og
 * PUT-er til backend. Returnerer true ved suksess.
 */
export async function saveMiniGameFromForm(
  gameType: MiniGameType,
  form: HTMLFormElement,
  structuredConfig: Record<string, unknown>
): Promise<boolean> {
  // Active-flagg fra checkbox.
  const activeEl = form.querySelector<HTMLInputElement>("#mg-active");
  const active = activeEl ? activeEl.checked : true;

  // Config-prioritet: strukturert-editor vinner alltid, MEN hvis bruker
  // har redigert JSON-editoren (verdi != data-original-json), bruker vi
  // JSON-editor-verdien. Dette sikrer at både kollisjoner med strukturert
  // form og power-user JSON-edits håndteres korrekt.
  let config: Record<string, unknown> = structuredConfig;
  const jsonEl = form.querySelector<HTMLTextAreaElement>("#mg-config-json");
  if (jsonEl) {
    const raw = jsonEl.value.trim();
    const original = (jsonEl.dataset.originalJson ?? "").trim();
    const jsonEdited = raw !== original;
    if (jsonEdited) {
      if (!raw) {
        config = {};
      } else {
        try {
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            Toast.error(t("setting_json_parse_error"));
            return false;
          }
          config = parsed as Record<string, unknown>;
        } catch {
          Toast.error(t("setting_json_parse_error"));
          return false;
        }
      }
    }
  }

  try {
    await updateMiniGameConfig(gameType, { config, active });
    Toast.success(t("setting_save_success"));
    return true;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(message);
    return false;
  }
}
