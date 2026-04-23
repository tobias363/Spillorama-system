// Strukturert redigering av sub-games i Schedule-malen. Erstatter den
// gamle rå-JSON-textareaen med én rad per underspill + strukturerte felter.
// Power-brukere kan fortsatt hoppe til rå JSON via "Vis JSON"-toggle i
// ScheduleEditorModal (behold bakoverkompat).
//
// Vi eksponerer tre operasjoner:
//   mountSubGamesListEditor(host, initial) → oppretter UI og returnerer
//     et handle med .getSubGames() / .setSubGames() / .getJson() /
//     .setFromJson() + .validate() (returnerer null eller feilmelding).
//
// Feltene mappes 1:1 mot `ScheduleSubgame` i ScheduleState (som igjen
// matcher backend `ScheduleService`-kontrakten). Felter vi ikke eksponerer
// direkte i UI (ticketTypesData / jackpotData / elvisData / extra) bevares
// via en hidden JSON-textarea per rad som kun er synlig under "Avansert".
//
// Round-trip: lesing av eksisterende `ScheduleRow` → vises i UI →
// skrives tilbake via getSubGames() uten data-tap.
//
// Bevisst scope-avgrensning: vi bygger ikke en full ticketTypesData-tabell
// eller jackpot-redigering her (det er post-pilot follow-up — legacy
// create.html = 5 382L). Målet er at admin slipper å kunne JSON-shape for
// kjerne-felter (navn + tider), men kan lime inn JSON for spesialfelter.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";
import type { ScheduleSubgame } from "./ScheduleState.js";

const TIME_RE = /^$|^[0-9]{2}:[0-9]{2}$/;

/**
 * Intern row-state: matcher ScheduleSubgame, men beholder JSON-strenger
 * for de nested feltene slik at brukeren kan redigere dem som tekst uten
 * at vi må bygge dypere UI. Tomme strenger serialiseres ikke.
 */
interface SubGameRowState {
  name: string;
  customGameName: string;
  startTime: string;
  endTime: string;
  notificationStartTime: string;
  minseconds: string;
  maxseconds: string;
  seconds: string;
  ticketTypesDataJson: string;
  jackpotDataJson: string;
  elvisDataJson: string;
  extraJson: string;
}

function emptyRow(): SubGameRowState {
  return {
    name: "",
    customGameName: "",
    startTime: "",
    endTime: "",
    notificationStartTime: "",
    minseconds: "",
    maxseconds: "",
    seconds: "",
    ticketTypesDataJson: "",
    jackpotDataJson: "",
    elvisDataJson: "",
    extraJson: "",
  };
}

function subgameToRowState(sg: ScheduleSubgame): SubGameRowState {
  return {
    name: sg.name ?? "",
    customGameName: sg.customGameName ?? "",
    startTime: sg.startTime ?? "",
    endTime: sg.endTime ?? "",
    notificationStartTime: sg.notificationStartTime ?? "",
    minseconds: sg.minseconds !== undefined ? String(sg.minseconds) : "",
    maxseconds: sg.maxseconds !== undefined ? String(sg.maxseconds) : "",
    seconds: sg.seconds !== undefined ? String(sg.seconds) : "",
    ticketTypesDataJson:
      sg.ticketTypesData && Object.keys(sg.ticketTypesData).length > 0
        ? JSON.stringify(sg.ticketTypesData, null, 2)
        : "",
    jackpotDataJson:
      sg.jackpotData && Object.keys(sg.jackpotData).length > 0
        ? JSON.stringify(sg.jackpotData, null, 2)
        : "",
    elvisDataJson:
      sg.elvisData && Object.keys(sg.elvisData).length > 0
        ? JSON.stringify(sg.elvisData, null, 2)
        : "",
    extraJson:
      sg.extra && Object.keys(sg.extra).length > 0
        ? JSON.stringify(sg.extra, null, 2)
        : "",
  };
}

/**
 * Konverter row-state → ScheduleSubgame. Kaster Error med forståelig
 * melding hvis noe er ugyldig (tid uten HH:MM, tall som ikke er tall,
 * JSON som ikke parser).
 */
function rowStateToSubgame(
  state: SubGameRowState,
  rowIndex: number
): ScheduleSubgame {
  const slot: ScheduleSubgame = {};
  if (state.name.trim()) slot.name = state.name.trim();
  if (state.customGameName.trim()) slot.customGameName = state.customGameName.trim();
  if (state.startTime.trim()) {
    if (!TIME_RE.test(state.startTime.trim())) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("invalid_time_format_hh_mm")} (startTime)`
      );
    }
    slot.startTime = state.startTime.trim();
  }
  if (state.endTime.trim()) {
    if (!TIME_RE.test(state.endTime.trim())) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("invalid_time_format_hh_mm")} (endTime)`
      );
    }
    slot.endTime = state.endTime.trim();
  }
  if (state.notificationStartTime.trim()) {
    slot.notificationStartTime = state.notificationStartTime.trim();
  }
  const assignInt = (
    value: string,
    field: "minseconds" | "maxseconds" | "seconds"
  ): void => {
    const raw = value.trim();
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("schedule_subgames_invalid_int")} (${field})`
      );
    }
    slot[field] = n;
  };
  assignInt(state.minseconds, "minseconds");
  assignInt(state.maxseconds, "maxseconds");
  assignInt(state.seconds, "seconds");

  const parseJsonObj = (
    raw: string,
    field: "ticketTypesData" | "jackpotData" | "elvisData" | "extra"
  ): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("schedule_subgames_invalid_json_field")} (${field}): ${msg}`
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("schedule_subgames_field_must_be_object")} (${field})`
      );
    }
    slot[field] = parsed as Record<string, unknown>;
  };
  parseJsonObj(state.ticketTypesDataJson, "ticketTypesData");
  parseJsonObj(state.jackpotDataJson, "jackpotData");
  parseJsonObj(state.elvisDataJson, "elvisData");
  parseJsonObj(state.extraJson, "extra");

  return slot;
}

export interface SubGamesListEditorHandle {
  /** Hent gjeldende liste. Kaster hvis input er ugyldig. */
  getSubGames(): ScheduleSubgame[];
  /** Bytt hele listen (brukes når bruker importerer fra JSON-fallback). */
  setSubGames(list: ScheduleSubgame[]): void;
  /** Validér alle rader, returner null eller feilmelding. */
  validate(): string | null;
  /** Antall rader (0 når tom). */
  count(): number;
}

export function mountSubGamesListEditor(
  host: HTMLElement,
  initial: ScheduleSubgame[]
): SubGamesListEditorHandle {
  const rows: SubGameRowState[] = initial.map((sg) => subgameToRowState(sg));

  function render(): void {
    if (rows.length === 0) {
      host.innerHTML = `
        <div id="sch-subgames-empty" class="help-block"
             style="padding:8px 10px;border:1px dashed #ccc;border-radius:3px;">
          ${escapeHtml(t("schedule_subgames_empty_hint"))}
        </div>
        <div style="margin-top:6px;">
          <button type="button" class="btn btn-sm btn-default" data-sg-action="add">
            + ${escapeHtml(t("schedule_subgames_add_btn"))}
          </button>
        </div>`;
    } else {
      host.innerHTML = `
        <div id="sch-subgames-rows">
          ${rows.map((row, i) => renderRow(row, i)).join("")}
        </div>
        <div style="margin-top:6px;">
          <button type="button" class="btn btn-sm btn-default" data-sg-action="add">
            + ${escapeHtml(t("schedule_subgames_add_btn"))}
          </button>
        </div>`;
    }
    wire();
  }

  function renderRow(row: SubGameRowState, index: number): string {
    const title = row.name.trim()
      ? escapeHtml(row.name.trim())
      : `${escapeHtml(t("schedule_subgames_row_label"))} ${index + 1}`;
    return `
      <div class="sg-row" data-sg-index="${index}"
           style="border:1px solid #e5e5e5;border-radius:3px;padding:10px;margin-bottom:8px;background:#fafafa;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${title}</strong>
          <button type="button" class="btn btn-xs btn-danger" data-sg-action="remove"
                  aria-label="${escapeHtml(t("schedule_subgames_remove_btn"))}"
                  title="${escapeHtml(t("schedule_subgames_remove_btn"))}">×</button>
        </div>
        <div class="row">
          <div class="form-group col-sm-6">
            <label for="sg-name-${index}">${escapeHtml(t("schedule_subgames_field_name"))}</label>
            <input type="text" id="sg-name-${index}" class="form-control input-sm"
                   data-sg-field="name" maxlength="200"
                   value="${escapeHtml(row.name)}">
          </div>
          <div class="form-group col-sm-6">
            <label for="sg-custom-${index}">${escapeHtml(t("schedule_subgames_field_custom_game_name"))}</label>
            <input type="text" id="sg-custom-${index}" class="form-control input-sm"
                   data-sg-field="customGameName" maxlength="200"
                   value="${escapeHtml(row.customGameName)}">
          </div>
        </div>
        <div class="row">
          <div class="form-group col-sm-4">
            <label for="sg-start-${index}">${escapeHtml(t("schedule_subgames_field_start_time"))}</label>
            <input type="text" id="sg-start-${index}" class="form-control input-sm"
                   data-sg-field="startTime" placeholder="HH:MM"
                   pattern="^[0-9]{2}:[0-9]{2}$"
                   value="${escapeHtml(row.startTime)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="sg-end-${index}">${escapeHtml(t("schedule_subgames_field_end_time"))}</label>
            <input type="text" id="sg-end-${index}" class="form-control input-sm"
                   data-sg-field="endTime" placeholder="HH:MM"
                   pattern="^[0-9]{2}:[0-9]{2}$"
                   value="${escapeHtml(row.endTime)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="sg-notif-${index}">${escapeHtml(t("schedule_subgames_field_notif_start_time"))}</label>
            <input type="text" id="sg-notif-${index}" class="form-control input-sm"
                   data-sg-field="notificationStartTime"
                   value="${escapeHtml(row.notificationStartTime)}">
          </div>
        </div>
        <div class="row">
          <div class="form-group col-sm-4">
            <label for="sg-min-${index}">${escapeHtml(t("schedule_subgames_field_minseconds"))}</label>
            <input type="number" id="sg-min-${index}" class="form-control input-sm"
                   data-sg-field="minseconds" min="0" step="1"
                   value="${escapeHtml(row.minseconds)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="sg-max-${index}">${escapeHtml(t("schedule_subgames_field_maxseconds"))}</label>
            <input type="number" id="sg-max-${index}" class="form-control input-sm"
                   data-sg-field="maxseconds" min="0" step="1"
                   value="${escapeHtml(row.maxseconds)}">
          </div>
          <div class="form-group col-sm-4">
            <label for="sg-sec-${index}">${escapeHtml(t("schedule_subgames_field_seconds"))}</label>
            <input type="number" id="sg-sec-${index}" class="form-control input-sm"
                   data-sg-field="seconds" min="0" step="1"
                   value="${escapeHtml(row.seconds)}">
          </div>
        </div>
        <details class="sg-advanced" style="margin-top:4px;">
          <summary style="cursor:pointer;font-size:12px;color:#555;">
            ${escapeHtml(t("schedule_subgames_advanced_toggle"))}
          </summary>
          <div style="padding-top:8px;">
            <div class="form-group">
              <label for="sg-tt-${index}">
                ${escapeHtml(t("schedule_subgames_field_ticket_types_data"))} (JSON)
              </label>
              <textarea id="sg-tt-${index}" class="form-control input-sm"
                        data-sg-field="ticketTypesDataJson" rows="3"
                        spellcheck="false" style="font-family:monospace;font-size:11px;"
                        placeholder='{"colorName":{...}}'>${escapeHtml(row.ticketTypesDataJson)}</textarea>
            </div>
            <div class="form-group">
              <label for="sg-jp-${index}">
                ${escapeHtml(t("schedule_subgames_field_jackpot_data"))} (JSON)
              </label>
              <textarea id="sg-jp-${index}" class="form-control input-sm"
                        data-sg-field="jackpotDataJson" rows="3"
                        spellcheck="false" style="font-family:monospace;font-size:11px;"
                        placeholder='{}'>${escapeHtml(row.jackpotDataJson)}</textarea>
            </div>
            <div class="form-group">
              <label for="sg-el-${index}">
                ${escapeHtml(t("schedule_subgames_field_elvis_data"))} (JSON)
              </label>
              <textarea id="sg-el-${index}" class="form-control input-sm"
                        data-sg-field="elvisDataJson" rows="2"
                        spellcheck="false" style="font-family:monospace;font-size:11px;"
                        placeholder='{}'>${escapeHtml(row.elvisDataJson)}</textarea>
            </div>
            <div class="form-group">
              <label for="sg-ex-${index}">
                ${escapeHtml(t("schedule_subgames_field_extra"))} (JSON)
              </label>
              <textarea id="sg-ex-${index}" class="form-control input-sm"
                        data-sg-field="extraJson" rows="2"
                        spellcheck="false" style="font-family:monospace;font-size:11px;"
                        placeholder='{}'>${escapeHtml(row.extraJson)}</textarea>
            </div>
          </div>
        </details>
      </div>`;
  }

  function wire(): void {
    host.querySelectorAll<HTMLButtonElement>('[data-sg-action="add"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        rows.push(emptyRow());
        render();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('[data-sg-action="remove"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const container = (ev.currentTarget as HTMLElement).closest(".sg-row");
        if (!container) return;
        const idx = Number(container.getAttribute("data-sg-index") ?? "-1");
        if (idx >= 0 && idx < rows.length) {
          rows.splice(idx, 1);
          render();
        }
      });
    });
    host
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-sg-field]")
      .forEach((el) => {
        const onChange = (): void => {
          const container = el.closest(".sg-row");
          if (!container) return;
          const idx = Number(container.getAttribute("data-sg-index") ?? "-1");
          if (idx < 0 || idx >= rows.length) return;
          const field = el.getAttribute("data-sg-field") as
            | keyof SubGameRowState
            | null;
          if (!field) return;
          rows[idx]![field] = el.value;
        };
        el.addEventListener("input", onChange);
        el.addEventListener("change", onChange);
      });
  }

  render();

  return {
    getSubGames(): ScheduleSubgame[] {
      return rows.map((r, i) => rowStateToSubgame(r, i));
    },
    setSubGames(list: ScheduleSubgame[]): void {
      rows.splice(0, rows.length, ...list.map((sg) => subgameToRowState(sg)));
      render();
    },
    validate(): string | null {
      try {
        for (let i = 0; i < rows.length; i++) {
          rowStateToSubgame(rows[i]!, i);
        }
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    count(): number {
      return rows.length;
    },
  };
}
