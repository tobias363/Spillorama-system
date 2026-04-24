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
import {
  TICKET_COLORS,
  SUB_GAME_TYPES,
  validateMysteryConfig,
  validateRowPrizesByColor,
  type TicketColor,
  type RowPrizesByColor,
  type TicketColorRowPrizes,
  type MysterySubGameConfig,
  type SubGameType,
} from "../../../../../../packages/shared-types/src/ticket-colors.js";

const TIME_RE = /^$|^[0-9]{2}:[0-9]{2}$/;

/**
 * Map fra canonical ticket-color-kode til i18n-nøkkel for display-navn.
 * i18n-oppslaget gjøres ved render-tid slik at admin kan bytte språk
 * uten å refreshe UI-state.
 */
const COLOR_I18N_KEY: Record<TicketColor, string> = {
  SMALL_YELLOW: "ticket_color_small_yellow",
  LARGE_YELLOW: "ticket_color_large_yellow",
  SMALL_WHITE: "ticket_color_small_white",
  LARGE_WHITE: "ticket_color_large_white",
  SMALL_PURPLE: "ticket_color_small_purple",
  LARGE_PURPLE: "ticket_color_large_purple",
  RED: "ticket_color_red",
  GREEN: "ticket_color_green",
  BLUE: "ticket_color_blue",
};

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
  /**
   * Agent IJ — Innsatsen/Jackpot port: strukturert draw-threshold-input (1..75).
   * Legacy-felt `jackpotData.jackpotDraw` gir ball-nummer hvor Fullt Hus
   * må være truffet for at jackpot/pot-utbetaling skal trigges. Vi eksponerer
   * både dette og `jackpotPrize` (premie-beløp) som strukturerte felter i
   * tillegg til å bevare bakoverkompat med jackpotData-JSON (advanced-section).
   * Begge speiles inn i/ut av `jackpotData`-objektet ved round-trip.
   */
  jackpotDraw: string;
  jackpotPrize: string;
  /**
   * K1-C: Lucky Number Bonus-konfig. `luckyBonusAmount` i kr (admin-input),
   * konverteres til øre ved persist. Kun utløses ved Fullt Hus hvor ballen
   * som traff winnet === spillerens valgte lykketall.
   *
   * `luckyBonusEnabled` er eksplisitt av/på-bryter — selv om beløp > 0 må
   * admin sette enabled=true for at bonus skal utløses (samme mønster som
   * andre feature-flags i sub-game-config).
   *
   * Speiles inn/ut av `slot.extra.luckyBonus = { amountCents, enabled }`
   * for å ikke konflikte med eksisterende `jackpotData`-struktur. Mapperen
   * leser `luckyBonus` fra ticket_config_json ved game-spawn.
   */
  luckyBonusAmount: string;
  luckyBonusEnabled: boolean;
  /**
   * feat/schedule-8-colors-mystery: STANDARD (pattern-sub-game) eller
   * MYSTERY (priceOptions-sub-game). Rendrer forskjellig UI.
   */
  subGameType: SubGameType;
  /** Valgte farger (subset av TICKET_COLORS). Stables i samme rekkefølge. */
  selectedColors: Set<TicketColor>;
  /** Per-farge rad-pris-innputt (alle som strings for å kunne være tomme). */
  rowPrizesByColor: Partial<
    Record<TicketColor, { ticketPrice: string; row1: string; row2: string; row3: string; row4: string; fullHouse: string }>
  >;
  /** Komma-separert liste av Mystery-priser ("1000,1500,2000"). */
  mysteryPriceOptions: string;
  mysteryYellowDoubles: boolean;
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
    jackpotDraw: "",
    jackpotPrize: "",
    luckyBonusAmount: "",
    luckyBonusEnabled: false,
    subGameType: "STANDARD",
    selectedColors: new Set(),
    rowPrizesByColor: {},
    mysteryPriceOptions: "",
    mysteryYellowDoubles: false,
  };
}

/** Tom pris-oppføring per farge — admin fyller ut progressivt. */
function emptyColorPrize(): {
  ticketPrice: string;
  row1: string;
  row2: string;
  row3: string;
  row4: string;
  fullHouse: string;
} {
  return { ticketPrice: "", row1: "", row2: "", row3: "", row4: "", fullHouse: "" };
}

function subgameToRowState(sg: ScheduleSubgame): SubGameRowState {
  // Pakk ut per-color + Mystery-config fra extra hvis de er satt.
  // Ikke-genkjente farger ignoreres (fail-open for legacy data).
  const selectedColors = new Set<TicketColor>();
  const rowPrizesByColor: Partial<
    Record<TicketColor, { ticketPrice: string; row1: string; row2: string; row3: string; row4: string; fullHouse: string }>
  > = {};
  let mysteryPriceOptions = "";
  let mysteryYellowDoubles = false;
  let luckyBonusAmount = "";
  let luckyBonusEnabled = false;
  let extraForJson: Record<string, unknown> | undefined = sg.extra;

  if (sg.extra) {
    const rp = sg.extra.rowPrizesByColor as RowPrizesByColor | undefined;
    if (rp && typeof rp === "object" && !Array.isArray(rp)) {
      for (const color of TICKET_COLORS) {
        const p = rp[color];
        if (!p) continue;
        selectedColors.add(color);
        rowPrizesByColor[color] = {
          ticketPrice: p.ticketPrice !== undefined ? String(p.ticketPrice) : "",
          row1: p.row1 !== undefined ? String(p.row1) : "",
          row2: p.row2 !== undefined ? String(p.row2) : "",
          row3: p.row3 !== undefined ? String(p.row3) : "",
          row4: p.row4 !== undefined ? String(p.row4) : "",
          fullHouse: p.fullHouse !== undefined ? String(p.fullHouse) : "",
        };
      }
    }
    const mc = sg.extra.mysteryConfig as MysterySubGameConfig | undefined;
    if (mc && typeof mc === "object" && !Array.isArray(mc)) {
      if (Array.isArray(mc.priceOptions)) {
        mysteryPriceOptions = mc.priceOptions.join(",");
      }
      if (typeof mc.yellowDoubles === "boolean") {
        mysteryYellowDoubles = mc.yellowDoubles;
      }
    }
    // K1-C: Lucky Number Bonus. Stored i extra.luckyBonus som
    // { amountCents, enabled }. UI tar kr-input (delt på 100).
    const lb = sg.extra.luckyBonus as
      | { amountCents?: number; enabled?: boolean }
      | undefined;
    if (lb && typeof lb === "object" && !Array.isArray(lb)) {
      if (typeof lb.amountCents === "number" && lb.amountCents > 0) {
        luckyBonusAmount = String(Math.round(lb.amountCents / 100));
      }
      if (typeof lb.enabled === "boolean") {
        luckyBonusEnabled = lb.enabled;
      }
    }
    // Ekstra-JSON-visning skal ikke duplisere strukturerte felter.
    // Lag en kopi uten rowPrizesByColor + mysteryConfig + luckyBonus.
    const rest: Record<string, unknown> = { ...sg.extra };
    delete rest.rowPrizesByColor;
    delete rest.mysteryConfig;
    delete rest.luckyBonus;
    extraForJson = Object.keys(rest).length > 0 ? rest : undefined;
  }

  // Agent IJ — hent ut strukturerte jackpotDraw/jackpotPrize hvis satt.
  // Resten av jackpotData (f.eks. jackpotEnabled-flags eller legacy-keys) skal
  // fortsatt være tilgjengelig i Avansert-textareaen så vi ikke mister data.
  let jackpotDraw = "";
  let jackpotPrize = "";
  let jackpotDataForJson: Record<string, unknown> | undefined = sg.jackpotData;
  if (sg.jackpotData && typeof sg.jackpotData === "object") {
    const jd = sg.jackpotData as Record<string, unknown>;
    if (jd.jackpotDraw !== undefined && jd.jackpotDraw !== null) {
      jackpotDraw = String(jd.jackpotDraw);
    }
    if (jd.jackpotPrize !== undefined && jd.jackpotPrize !== null) {
      jackpotPrize = String(jd.jackpotPrize);
    }
    const rest: Record<string, unknown> = { ...jd };
    delete rest.jackpotDraw;
    delete rest.jackpotPrize;
    jackpotDataForJson = Object.keys(rest).length > 0 ? rest : undefined;
  }

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
      jackpotDataForJson && Object.keys(jackpotDataForJson).length > 0
        ? JSON.stringify(jackpotDataForJson, null, 2)
        : "",
    elvisDataJson:
      sg.elvisData && Object.keys(sg.elvisData).length > 0
        ? JSON.stringify(sg.elvisData, null, 2)
        : "",
    extraJson:
      extraForJson && Object.keys(extraForJson).length > 0
        ? JSON.stringify(extraForJson, null, 2)
        : "",
    jackpotDraw,
    jackpotPrize,
    luckyBonusAmount,
    luckyBonusEnabled,
    subGameType: sg.subGameType === "MYSTERY" ? "MYSTERY" : "STANDARD",
    selectedColors,
    rowPrizesByColor,
    mysteryPriceOptions,
    mysteryYellowDoubles,
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

  // feat/schedule-8-colors-mystery: strukturert subGameType + per-color
  // rad-premier + Mystery-konfig. Disse merges inn i `extra` slik at
  // backend-kontrakten (fri-form extra JSONB) ikke brytes. subGameType
  // settes som top-level-felt (speiles av ScheduleService).
  slot.subGameType = state.subGameType;

  const rowPrizesByColor: Partial<Record<TicketColor, TicketColorRowPrizes>> = {};
  for (const color of state.selectedColors) {
    const entry = state.rowPrizesByColor[color];
    if (!entry) continue;
    const prize: TicketColorRowPrizes = {};
    const assignNum = (
      raw: string,
      field: keyof TicketColorRowPrizes
    ): void => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(
          `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${color} — ${t("schedule_subgames_invalid_amount")} (${field})`
        );
      }
      prize[field] = n;
    };
    assignNum(entry.ticketPrice, "ticketPrice");
    assignNum(entry.row1, "row1");
    assignNum(entry.row2, "row2");
    assignNum(entry.row3, "row3");
    assignNum(entry.row4, "row4");
    assignNum(entry.fullHouse, "fullHouse");
    if (Object.keys(prize).length > 0) {
      rowPrizesByColor[color] = prize;
    }
  }
  const hasColorPrizes = Object.keys(rowPrizesByColor).length > 0;

  // Mystery-konfig bygges kun når subGameType = MYSTERY (UI skjuler feltet
  // ellers). Validering via shared helper.
  let mysteryConfig: MysterySubGameConfig | undefined;
  if (state.subGameType === "MYSTERY") {
    const raw = state.mysteryPriceOptions.trim();
    if (!raw) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("mystery_price_options_required")}`
      );
    }
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const nums: number[] = [];
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new Error(
          `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${t("mystery_price_options_invalid")} (${part})`
        );
      }
      nums.push(n);
    }
    mysteryConfig = { priceOptions: nums, yellowDoubles: state.mysteryYellowDoubles };
    const err = validateMysteryConfig(mysteryConfig);
    if (err) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${err}`
      );
    }
  }

  // K1-C: Lucky Number Bonus. Strukturert felt konverteres fra kr (admin)
  // til øre og serialiseres i slot.extra.luckyBonus = {amountCents, enabled}.
  let luckyBonusForExtra: { amountCents: number; enabled: boolean } | null = null;
  const lbRaw = state.luckyBonusAmount.trim();
  if (lbRaw || state.luckyBonusEnabled) {
    let amountKr = 0;
    if (lbRaw) {
      const n = Number(lbRaw);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(
          `${t("schedule_subgames_row_label")} ${rowIndex + 1}: luckyBonusAmount må være >= 0`
        );
      }
      amountKr = n;
    }
    // amountCents = round(amountKr * 100) for å unngå flyttal-drift.
    const amountCents = Math.round(amountKr * 100);
    luckyBonusForExtra = { amountCents, enabled: state.luckyBonusEnabled };
  }

  if (hasColorPrizes || mysteryConfig || luckyBonusForExtra) {
    const merged: Record<string, unknown> = { ...(slot.extra ?? {}) };
    if (hasColorPrizes) merged.rowPrizesByColor = rowPrizesByColor;
    if (mysteryConfig) merged.mysteryConfig = mysteryConfig;
    if (luckyBonusForExtra) merged.luckyBonus = luckyBonusForExtra;
    slot.extra = merged;
    // Bruk shared validator for å fail-fast før POST — gir sam e feilmelding
    // som backend ville gitt.
    if (hasColorPrizes) {
      const err = validateRowPrizesByColor(rowPrizesByColor);
      if (err) {
        throw new Error(
          `${t("schedule_subgames_row_label")} ${rowIndex + 1}: ${err}`
        );
      }
    }
  }

  // Agent IJ — Innsatsen-jackpot: strukturerte jackpotDraw/jackpotPrize
  // speiles inn i slot.jackpotData. Legacy-felter i jackpotData-JSON er
  // allerede parset via parseJsonObj; vi merger strukturerte felter oppå
  // slik at den strukturerte UI-en vinner over eventuelle duplikate
  // legacy-verdier.
  const structuredJackpot: Record<string, unknown> = {};
  if (state.jackpotDraw.trim()) {
    const n = Number(state.jackpotDraw.trim());
    if (!Number.isInteger(n) || n < 1 || n > 75) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: jackpotDraw må være heltall 1..75`
      );
    }
    structuredJackpot.jackpotDraw = n;
  }
  if (state.jackpotPrize.trim()) {
    const n = Number(state.jackpotPrize.trim());
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(
        `${t("schedule_subgames_row_label")} ${rowIndex + 1}: jackpotPrize må være >= 0`
      );
    }
    structuredJackpot.jackpotPrize = n;
  }
  if (Object.keys(structuredJackpot).length > 0) {
    slot.jackpotData = { ...(slot.jackpotData ?? {}), ...structuredJackpot };
  }

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

  /**
   * feat/schedule-8-colors-mystery: sub-game-type-select + 9-color multi-
   * select med per-color rad-premier. Rendrer forskjellig UI når type=MYSTERY.
   * Bruker `data-sg-color`/`data-sg-color-field` for event-bindings.
   */
  function renderSubGameTypeAndColors(row: SubGameRowState, index: number): string {
    const typeOptions = SUB_GAME_TYPES.map((tp) => {
      const selected = row.subGameType === tp ? " selected" : "";
      const label =
        tp === "MYSTERY"
          ? escapeHtml(t("sub_game_type_mystery"))
          : escapeHtml(t("sub_game_type_standard"));
      return `<option value="${tp}"${selected}>${label}</option>`;
    }).join("");

    const colorsPanel =
      row.subGameType === "STANDARD"
        ? renderColorsPanel(row, index)
        : renderMysteryPanel(row, index);

    return `
      <div class="row" style="margin-top:6px;">
        <div class="form-group col-sm-4">
          <label for="sg-type-${index}">${escapeHtml(t("schedule_subgames_field_type"))}</label>
          <select id="sg-type-${index}" class="form-control input-sm" data-sg-field="subGameType">
            ${typeOptions}
          </select>
        </div>
      </div>
      <div class="sg-colors-panel" data-sg-index="${index}">
        ${colorsPanel}
      </div>`;
  }

  function renderColorsPanel(row: SubGameRowState, index: number): string {
    const checkboxes = TICKET_COLORS.map((color) => {
      const checked = row.selectedColors.has(color) ? " checked" : "";
      const label = escapeHtml(t(COLOR_I18N_KEY[color]));
      return `
        <label class="sg-color-toggle"
               style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;">
          <input type="checkbox" data-sg-color="${color}"${checked}>
          <span>${label}</span>
        </label>`;
    }).join("");

    const rowsForColors = Array.from(row.selectedColors)
      .map((color) => renderColorPriceRow(row, index, color))
      .join("");

    return `
      <fieldset style="border:1px solid #e8e8e8;border-radius:3px;padding:6px 8px;margin-top:4px;background:#fff;">
        <legend style="font-size:12px;padding:0 4px;color:#333;">
          ${escapeHtml(t("schedule_subgames_colors_legend"))}
        </legend>
        <div class="sg-color-toggles">${checkboxes}</div>
        ${rowsForColors ? `<div class="sg-color-prices" style="margin-top:6px;">${rowsForColors}</div>` : ""}
      </fieldset>`;
  }

  function renderColorPriceRow(
    row: SubGameRowState,
    _index: number,
    color: TicketColor
  ): string {
    const prize = row.rowPrizesByColor[color] ?? emptyColorPrize();
    const label = escapeHtml(t(COLOR_I18N_KEY[color]));
    const fields: Array<[keyof typeof prize, string]> = [
      ["ticketPrice", t("schedule_subgames_field_ticket_price")],
      ["row1", t("schedule_subgames_field_row1_prize")],
      ["row2", t("schedule_subgames_field_row2_prize")],
      ["row3", t("schedule_subgames_field_row3_prize")],
      ["row4", t("schedule_subgames_field_row4_prize")],
      ["fullHouse", t("schedule_subgames_field_full_house_prize")],
    ];
    const inputs = fields
      .map(
        ([key, placeholder]) => `
        <input type="number" class="form-control input-sm"
               data-sg-color="${color}"
               data-sg-color-field="${key}"
               min="0" step="1"
               placeholder="${escapeHtml(placeholder)}"
               value="${escapeHtml(prize[key])}"
               style="display:inline-block;width:100px;margin-right:4px;margin-bottom:4px;"
               aria-label="${escapeHtml(label)} ${escapeHtml(placeholder)}">`
      )
      .join("");
    return `
      <div class="sg-color-row" style="padding:4px 0;border-top:1px dashed #eee;">
        <strong style="font-size:12px;">${label}</strong>
        <div style="margin-top:2px;">${inputs}</div>
      </div>`;
  }

  function renderMysteryPanel(row: SubGameRowState, index: number): string {
    const checked = row.mysteryYellowDoubles ? " checked" : "";
    return `
      <fieldset style="border:1px solid #e8e8e8;border-radius:3px;padding:6px 8px;margin-top:4px;background:#fff;">
        <legend style="font-size:12px;padding:0 4px;color:#333;">
          ${escapeHtml(t("schedule_subgames_mystery_legend"))}
        </legend>
        <div class="form-group">
          <label for="sg-mp-${index}" style="font-size:12px;">
            ${escapeHtml(t("mystery_price_options_label"))}
          </label>
          <input type="text" id="sg-mp-${index}" class="form-control input-sm"
                 data-sg-field="mysteryPriceOptions"
                 placeholder="1000,1500,2000,2500,3000,4000"
                 value="${escapeHtml(row.mysteryPriceOptions)}">
          <p class="help-block" style="margin-top:2px;font-size:11px;">
            ${escapeHtml(t("mystery_price_options_hint"))}
          </p>
        </div>
        <div class="form-group">
          <label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;">
            <input type="checkbox" data-sg-field="mysteryYellowDoubles"${checked}>
            <span>${escapeHtml(t("mystery_yellow_doubles_label"))}</span>
          </label>
        </div>
      </fieldset>`;
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
        <fieldset style="border:1px solid #e8e8e8;border-radius:3px;padding:6px 8px;margin-top:4px;background:#fff;">
          <legend style="font-size:12px;padding:0 4px;color:#333;">
            ${escapeHtml(t("schedule_subgames_jackpot_legend"))}
          </legend>
          <div class="row">
            <div class="form-group col-sm-6">
              <label for="sg-jpdraw-${index}" style="font-size:12px;">
                ${escapeHtml(t("schedule_subgames_jackpot_draw_threshold"))}
              </label>
              <input type="number" id="sg-jpdraw-${index}"
                     class="form-control input-sm"
                     data-sg-field="jackpotDraw"
                     min="1" max="75" step="1"
                     placeholder="1..75"
                     value="${escapeHtml(row.jackpotDraw)}">
              <p class="help-block" style="margin-top:2px;font-size:11px;">
                ${escapeHtml(t("schedule_subgames_jackpot_draw_threshold_hint"))}
              </p>
            </div>
            <div class="form-group col-sm-6">
              <label for="sg-jpprize-${index}" style="font-size:12px;">
                ${escapeHtml(t("schedule_subgames_jackpot_prize"))}
              </label>
              <input type="number" id="sg-jpprize-${index}"
                     class="form-control input-sm"
                     data-sg-field="jackpotPrize"
                     min="0" step="1"
                     value="${escapeHtml(row.jackpotPrize)}">
              <p class="help-block" style="margin-top:2px;font-size:11px;">
                ${escapeHtml(t("schedule_subgames_jackpot_prize_hint"))}
              </p>
            </div>
          </div>
        </fieldset>
        <fieldset style="border:1px solid #e8e8e8;border-radius:3px;padding:6px 8px;margin-top:4px;background:#fff;">
          <legend style="font-size:12px;padding:0 4px;color:#333;">
            ${escapeHtml(t("schedule_subgames_lucky_bonus_legend"))}
          </legend>
          <div class="row">
            <div class="form-group col-sm-6">
              <label for="sg-lbamt-${index}" style="font-size:12px;">
                ${escapeHtml(t("schedule_subgames_lucky_bonus_amount"))}
              </label>
              <input type="number" id="sg-lbamt-${index}"
                     class="form-control input-sm"
                     data-sg-field="luckyBonusAmount"
                     min="0" step="1"
                     placeholder="0"
                     value="${escapeHtml(row.luckyBonusAmount)}">
              <p class="help-block" style="margin-top:2px;font-size:11px;">
                ${escapeHtml(t("schedule_subgames_lucky_bonus_amount_hint"))}
              </p>
            </div>
            <div class="form-group col-sm-6">
              <label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;margin-top:22px;">
                <input type="checkbox" id="sg-lben-${index}"
                       data-sg-field="luckyBonusEnabled"
                       ${row.luckyBonusEnabled ? "checked" : ""}>
                <span>${escapeHtml(t("schedule_subgames_lucky_bonus_enabled"))}</span>
              </label>
              <p class="help-block" style="margin-top:2px;font-size:11px;">
                ${escapeHtml(t("schedule_subgames_lucky_bonus_enabled_hint"))}
              </p>
            </div>
          </div>
        </fieldset>
        ${renderSubGameTypeAndColors(row, index)}
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
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "[data-sg-field]"
      )
      .forEach((el) => {
        const onChange = (): void => {
          const container = el.closest(".sg-row");
          if (!container) return;
          const idx = Number(container.getAttribute("data-sg-index") ?? "-1");
          if (idx < 0 || idx >= rows.length) return;
          const field = el.getAttribute("data-sg-field");
          if (!field) return;
          const row = rows[idx]!;
          // feat/8-colors: typed fields som ikke er strings.
          if (field === "subGameType") {
            const v = (el as HTMLSelectElement).value;
            row.subGameType = v === "MYSTERY" ? "MYSTERY" : "STANDARD";
            render(); // re-rendre for å bytte panel (farger <-> mystery)
            return;
          }
          if (field === "mysteryYellowDoubles") {
            row.mysteryYellowDoubles = (el as HTMLInputElement).checked;
            return;
          }
          if (field === "luckyBonusEnabled") {
            row.luckyBonusEnabled = (el as HTMLInputElement).checked;
            return;
          }
          // Default: string-field.
          (row as unknown as Record<string, string>)[field] = (
            el as HTMLInputElement
          ).value;
        };
        el.addEventListener("input", onChange);
        el.addEventListener("change", onChange);
      });

    // feat/8-colors: farge-toggle-checkboxes (legg til / fjern farge fra
    // selectedColors). Må re-rendre slik at per-color-prisinput vises.
    host
      .querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-sg-color]:not([data-sg-color-field])'
      )
      .forEach((cb) => {
        cb.addEventListener("change", () => {
          const container = cb.closest(".sg-row");
          if (!container) return;
          const idx = Number(container.getAttribute("data-sg-index") ?? "-1");
          if (idx < 0 || idx >= rows.length) return;
          const color = cb.getAttribute("data-sg-color") as TicketColor | null;
          if (!color || !(TICKET_COLORS as readonly string[]).includes(color)) return;
          const row = rows[idx]!;
          if (cb.checked) {
            row.selectedColors.add(color);
            if (!row.rowPrizesByColor[color]) {
              row.rowPrizesByColor[color] = emptyColorPrize();
            }
          } else {
            row.selectedColors.delete(color);
            delete row.rowPrizesByColor[color];
          }
          render();
        });
      });

    // feat/8-colors: per-color pris-input (ticketPrice, row1..row4, fullHouse).
    host
      .querySelectorAll<HTMLInputElement>(
        "input[data-sg-color][data-sg-color-field]"
      )
      .forEach((input) => {
        const onChange = (): void => {
          const container = input.closest(".sg-row");
          if (!container) return;
          const idx = Number(container.getAttribute("data-sg-index") ?? "-1");
          if (idx < 0 || idx >= rows.length) return;
          const color = input.getAttribute("data-sg-color") as TicketColor | null;
          const field = input.getAttribute("data-sg-color-field") as
            | "ticketPrice"
            | "row1"
            | "row2"
            | "row3"
            | "row4"
            | "fullHouse"
            | null;
          if (!color || !field) return;
          const row = rows[idx]!;
          if (!row.rowPrizesByColor[color]) {
            row.rowPrizesByColor[color] = emptyColorPrize();
          }
          row.rowPrizesByColor[color]![field] = input.value;
        };
        input.addEventListener("input", onChange);
        input.addEventListener("change", onChange);
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
