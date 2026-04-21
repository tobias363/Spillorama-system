// /gameManagement/:typeId/add — Spill 1 (Bingo 75-ball)-oppretting.
//
// Erstatter placeholder-siden i GameManagementDetailPages.ts. Når en admin
// velger Spill 1 fra dropdownen på /gameManagement, går de til denne siden
// for å konfigurere et nytt spill.
//
// Seksjoner:
//   1. Grunnleggende (name, custom name, start-dato, start-tid, slutt-tid, status)
//   2. Timing (min/max/seconds + notificationStartTime)
//   3. Billett-farger (multi-select + per-farge pris-input)
//   4. Pattern-gevinst-matrise (Row 1-4 + Full House, % av pot per farge)
//   5. Jackpot (per-farge premie + draw-antall)
//   6. Elvis (replaceTicketPrice)
//   7. Lucky number (prize)
//
// Alle Spill 1-spesifikke felter går til `config.spill1` via
// `buildSpill1Payload`. Backend-schema (BIN-622) tillater fri-form config.
//
// Submit-handler valdierer først lokalt, så POST-er til
// `/api/admin/game-management`. På suksess redirecter vi til list-siden.
// På feil vises feilmelding basert på backend `error.code` når mulig.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";
import { fetchGameType } from "../gameType/GameTypeState.js";
import { createGameManagement } from "./GameManagementState.js";
import type { GameType } from "../common/types.js";
import {
  SPILL1_TICKET_COLORS,
  SPILL1_PATTERNS,
  emptySpill1Config,
  validateSpill1Config,
  buildSpill1Payload,
  type Spill1Config,
  type Spill1TicketColor,
  type Spill1Pattern,
  type ValidationError,
} from "./Spill1Config.js";

/** Render Add-form for Spill 1. Andre gameType-varianter faller tilbake til placeholder. */
export async function renderGameManagementAddPage(
  container: HTMLElement,
  typeId: string
): Promise<void> {
  container.innerHTML = renderLoading();
  let gt: GameType | null = null;
  try {
    gt = await fetchGameType(typeId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderError(typeId, msg);
    return;
  }
  if (!gt) {
    container.innerHTML = renderError(typeId, t("no_data_available"));
    return;
  }

  // Bare Spill 1 (game_1) har den store 5x5-konfigurasjonen her. Andre
  // typer får en forenklet "kommer senere"-side inntil de også er wired.
  if (gt.type !== "game_1") {
    container.innerHTML = renderNotYetSupportedShell(gt);
    return;
  }

  const state: FormState = {
    gameType: gt,
    name: "",
    startDateIso: todayIso(),
    status: "active",
    spill1: emptySpill1Config(),
    submitting: false,
    errors: [],
    globalError: null,
    successMessage: null,
  };

  container.innerHTML = renderFormShell(state);
  wireForm(container, state);
}

function renderLoading(): string {
  return `<div class="text-center" style="padding:24px;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>`;
}

function renderError(typeId: string, message: string): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header"><h1>${escapeHtml(t("add_game"))}</h1></section>
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="alert alert-danger">${escapeHtml(message)}</div>
        <a href="#/gameManagement?typeId=${encodeURIComponent(typeId)}" class="btn btn-default">
          <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
        </a>
      </div></div></section>
    </div></div>`;
}

function renderNotYetSupportedShell(gt: GameType): string {
  const title = `${t("add_game")} — ${gt.name}`;
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin">${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/gameManagement?typeId=${encodeURIComponent(gt._id)}">${escapeHtml(gt.name)}</a></li>
          <li class="active">${escapeHtml(t("add_game"))}</li>
        </ol>
      </section>
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="alert alert-info">
          <i class="fa fa-info-circle"></i>
          Add-skjema for ${escapeHtml(gt.name)} er ikke wired ennå. Bare Spill 1
          (Bingo 75-ball) er fullt konfigurerbart i denne iterasjonen.
        </div>
        <a href="#/gameManagement?typeId=${encodeURIComponent(gt._id)}" class="btn btn-default">
          <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
        </a>
      </div></div></section>
    </div></div>`;
}

interface FormState {
  gameType: GameType;
  name: string;
  startDateIso: string; // YYYY-MM-DD
  status: "active" | "inactive";
  spill1: Spill1Config;
  submitting: boolean;
  errors: ValidationError[];
  globalError: string | null;
  successMessage: string | null;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function renderFormShell(s: FormState): string {
  const title = `${t("add_game")} — ${s.gameType.name}`;
  const backHref = `#/gameManagement?typeId=${encodeURIComponent(s.gameType._id)}`;
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin">${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="${backHref}">${escapeHtml(s.gameType.name)}</a></li>
          <li class="active">${escapeHtml(t("add_game"))}</li>
        </ol>
      </section>
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="panel panel-default card-view">
          <div class="panel-heading">
            <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
            <div class="pull-right">
              <a href="${backHref}" class="btn btn-default btn-sm">
                <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
              </a>
            </div>
            <div class="clearfix"></div>
          </div>
          <div class="panel-wrapper collapse in">
            <div class="panel-body">
              <form id="gm-add-form" onsubmit="return false;">
                <div id="gm-global-alert"></div>
                ${renderSectionBasics(s)}
                ${renderSectionTiming(s)}
                ${renderSectionTicketColors(s)}
                ${renderSectionPatternPrizes(s)}
                ${renderSectionJackpot(s)}
                ${renderSectionElvis(s)}
                ${renderSectionLuckyNumber(s)}
                <div id="gm-field-errors"></div>
                <div style="padding-top:16px;">
                  <button type="submit" id="gm-submit" class="btn btn-success btn-flat">
                    <i class="fa fa-save"></i> ${escapeHtml(t("submit"))}
                  </button>
                  <a href="${backHref}" class="btn btn-danger btn-flat">${escapeHtml(t("cancel"))}</a>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div></div></section>
    </div></div>`;
}

function renderSectionBasics(s: FormState): string {
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("game_name"))}
      </legend>
      <div class="row">
        <div class="col-sm-6">
          <label for="gm-name">${escapeHtml(t("game_name"))} *</label>
          <input type="text" class="form-control" id="gm-name"
            value="${escapeHtml(s.name)}" maxlength="200"
            placeholder="${escapeHtml(t("enter"))} ${escapeHtml(t("game_name"))}">
        </div>
        <div class="col-sm-6">
          <label for="gm-custom-name">${escapeHtml(t("custom_game_name"))}</label>
          <input type="text" class="form-control" id="gm-custom-name"
            value="${escapeHtml(s.spill1.customGameName)}" maxlength="200"
            placeholder="${escapeHtml(t("custom_game_name"))}">
        </div>
      </div>
      <div class="row" style="margin-top:8px;">
        <div class="col-sm-4">
          <label for="gm-start-date">${escapeHtml(t("start_date"))} *</label>
          <input type="date" class="form-control" id="gm-start-date"
            value="${escapeHtml(s.startDateIso)}">
        </div>
        <div class="col-sm-4">
          <label for="gm-start-time">${escapeHtml(t("start_time"))} *</label>
          <input type="time" class="form-control" id="gm-start-time"
            value="${escapeHtml(s.spill1.startTime)}">
        </div>
        <div class="col-sm-4">
          <label for="gm-end-time">${escapeHtml(t("end_time"))}</label>
          <input type="time" class="form-control" id="gm-end-time"
            value="${escapeHtml(s.spill1.endTime)}">
        </div>
      </div>
    </fieldset>`;
}

function renderSectionTiming(s: FormState): string {
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("second_to_display_single_ball"))}
      </legend>
      <div class="row">
        <div class="col-sm-3">
          <label for="gm-minseconds">${escapeHtml(t("minimum_seconds_to_display_single_ball"))}</label>
          <input type="number" class="form-control" id="gm-minseconds" min="3"
            value="${s.spill1.timing.minseconds}">
        </div>
        <div class="col-sm-3">
          <label for="gm-maxseconds">${escapeHtml(t("maximum_seconds_to_display_single_ball"))}</label>
          <input type="number" class="form-control" id="gm-maxseconds" min="3"
            value="${s.spill1.timing.maxseconds}">
        </div>
        <div class="col-sm-3">
          <label for="gm-seconds">${escapeHtml(t("total_second_to_display_single_ball"))}</label>
          <input type="number" class="form-control" id="gm-seconds" min="1"
            value="${s.spill1.timing.seconds}">
        </div>
        <div class="col-sm-3">
          <label for="gm-notification">${escapeHtml(t("notification_start_time"))} (sek)</label>
          <input type="number" class="form-control" id="gm-notification" min="1"
            value="${s.spill1.timing.notificationStartTimeSeconds}">
        </div>
      </div>
    </fieldset>`;
}

function renderSectionTicketColors(s: FormState): string {
  // Multi-select checkbox-grid + per-farge pris-input rendered in place.
  const selectedSet = new Set(s.spill1.ticketColors.map((tc) => tc.color));
  const items = SPILL1_TICKET_COLORS.map((color) => {
    const checked = selectedSet.has(color);
    const existing = s.spill1.ticketColors.find((tc) => tc.color === color);
    const price = existing?.priceNok ?? 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <label style="min-width:160px;">
          <input type="checkbox" class="gm-ticket-color-check"
            data-color="${escapeHtml(color)}"${checked ? " checked" : ""}>
          ${escapeHtml(t(color))}
        </label>
        <label style="font-size:12px;color:#666;">${escapeHtml(t("ticket_price"))} (NOK):</label>
        <input type="number" class="form-control gm-ticket-color-price" style="width:100px;"
          data-color="${escapeHtml(color)}" min="0" step="1"
          value="${price}"${checked ? "" : " disabled"}>
      </div>`;
  }).join("");
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("ticket_type"))} *
      </legend>
      <div id="gm-ticket-colors">${items}</div>
    </fieldset>`;
}

function renderSectionPatternPrizes(s: FormState): string {
  // Matrix of (ticketColor × pattern) → prize %.
  // Only renders rows for selected colors; empty state if none selected.
  if (s.spill1.ticketColors.length === 0) {
    return `
      <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
        <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
          ${escapeHtml(t("row_pattern"))} / ${escapeHtml(t("prize"))}
        </legend>
        <div id="gm-pattern-prizes">
          <p class="text-muted">Velg minst én billett-farge for å konfigurere pattern-gevinst.</p>
        </div>
      </fieldset>`;
  }

  const header =
    `<thead><tr><th style="min-width:140px;">${escapeHtml(t("ticket_type"))}</th>` +
    SPILL1_PATTERNS.map((p) => `<th>${escapeHtml(t(p))}</th>`).join("") +
    `<th>%-sum</th></tr></thead>`;
  const rows = s.spill1.ticketColors
    .map((tc) => {
      const cells = SPILL1_PATTERNS.map((p) => {
        const val = tc.prizePerPattern[p] ?? 0;
        return `<td>
          <input type="number" class="form-control gm-prize-cell" style="width:80px;"
            data-color="${escapeHtml(tc.color)}" data-pattern="${escapeHtml(p)}"
            min="0" max="100" step="1" value="${val}">
        </td>`;
      }).join("");
      const sum = Object.values(tc.prizePerPattern).reduce<number>(
        (acc, v) => acc + (Number.isFinite(v) ? (v ?? 0) : 0),
        0
      );
      return `<tr>
        <td><strong>${escapeHtml(t(tc.color))}</strong></td>
        ${cells}
        <td id="gm-prize-sum-${escapeHtml(tc.color)}" style="font-weight:bold;${sum > 100 ? "color:#d9534f;" : ""}">${sum}%</td>
      </tr>`;
    })
    .join("");
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("row_pattern"))} / ${escapeHtml(t("prize"))} (% av pot)
      </legend>
      <div class="table-responsive" id="gm-pattern-prizes">
        <table class="table table-bordered table-condensed">
          ${header}
          <tbody>${rows}</tbody>
        </table>
      </div>
    </fieldset>`;
}

function renderSectionJackpot(s: FormState): string {
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("jackpot_prize_and_draws"))}
      </legend>
      <div class="row">
        <div class="col-sm-3">
          <label>${escapeHtml(t("jackpot_white_prize"))} (NOK)</label>
          <input type="number" class="form-control" id="gm-jackpot-white"
            min="0" step="1" value="${s.spill1.jackpot.prizeByColor.white}">
        </div>
        <div class="col-sm-3">
          <label>${escapeHtml(t("jackpot_yellow_prize"))} (NOK)</label>
          <input type="number" class="form-control" id="gm-jackpot-yellow"
            min="0" step="1" value="${s.spill1.jackpot.prizeByColor.yellow}">
        </div>
        <div class="col-sm-3">
          <label>${escapeHtml(t("jackpot_purple_prize"))} (NOK)</label>
          <input type="number" class="form-control" id="gm-jackpot-purple"
            min="0" step="1" value="${s.spill1.jackpot.prizeByColor.purple}">
        </div>
        <div class="col-sm-3">
          <label>${escapeHtml(t("jackpot_draw"))} (50-59)</label>
          <input type="number" class="form-control" id="gm-jackpot-draw"
            min="50" max="59" step="1" value="${s.spill1.jackpot.draw}">
        </div>
      </div>
    </fieldset>`;
}

function renderSectionElvis(s: FormState): string {
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        Elvis
      </legend>
      <div class="row">
        <div class="col-sm-6">
          <label>${escapeHtml(t("price_to_replace_elvis_tickets"))} (NOK)</label>
          <input type="number" class="form-control" id="gm-elvis-replace"
            min="0" step="1" value="${s.spill1.elvis.replaceTicketPriceNok}">
        </div>
      </div>
    </fieldset>`;
}

function renderSectionLuckyNumber(s: FormState): string {
  return `
    <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
      <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
        ${escapeHtml(t("prize_of_lucky_number"))}
      </legend>
      <div class="row">
        <div class="col-sm-6">
          <label>${escapeHtml(t("prize_of_lucky_number"))} (NOK)</label>
          <input type="number" class="form-control" id="gm-lucky-prize"
            min="0" step="1" value="${s.spill1.luckyNumberPrizeNok}">
        </div>
      </div>
    </fieldset>`;
}

/** Wire events + submit-handler. */
export function wireForm(container: HTMLElement, state: FormState): void {
  // Basics
  const nameEl = container.querySelector<HTMLInputElement>("#gm-name");
  nameEl?.addEventListener("input", () => {
    state.name = nameEl.value;
  });
  container.querySelector<HTMLInputElement>("#gm-custom-name")?.addEventListener("input", (ev) => {
    state.spill1.customGameName = (ev.target as HTMLInputElement).value;
  });
  container.querySelector<HTMLInputElement>("#gm-start-date")?.addEventListener("input", (ev) => {
    state.startDateIso = (ev.target as HTMLInputElement).value;
  });
  container.querySelector<HTMLInputElement>("#gm-start-time")?.addEventListener("input", (ev) => {
    state.spill1.startTime = (ev.target as HTMLInputElement).value;
  });
  container.querySelector<HTMLInputElement>("#gm-end-time")?.addEventListener("input", (ev) => {
    state.spill1.endTime = (ev.target as HTMLInputElement).value;
  });

  // Timing
  container.querySelector<HTMLInputElement>("#gm-minseconds")?.addEventListener("input", (ev) => {
    state.spill1.timing.minseconds = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-maxseconds")?.addEventListener("input", (ev) => {
    state.spill1.timing.maxseconds = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-seconds")?.addEventListener("input", (ev) => {
    state.spill1.timing.seconds = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-notification")?.addEventListener("input", (ev) => {
    state.spill1.timing.notificationStartTimeSeconds = Number((ev.target as HTMLInputElement).value);
  });

  // Ticket color checkboxes
  container.querySelectorAll<HTMLInputElement>(".gm-ticket-color-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const color = cb.dataset.color as Spill1TicketColor | undefined;
      if (!color) return;
      const priceInput = container.querySelector<HTMLInputElement>(
        `.gm-ticket-color-price[data-color="${color}"]`
      );
      if (cb.checked) {
        // Add or enable.
        if (!state.spill1.ticketColors.some((tc) => tc.color === color)) {
          state.spill1.ticketColors.push({
            color,
            priceNok: priceInput ? Number(priceInput.value) : 0,
            prizePerPattern: {},
          });
        }
        if (priceInput) priceInput.disabled = false;
      } else {
        // Remove.
        state.spill1.ticketColors = state.spill1.ticketColors.filter((tc) => tc.color !== color);
        if (priceInput) priceInput.disabled = true;
      }
      refreshPatternPrizeTable(container, state);
    });
  });

  // Ticket color price inputs
  container.querySelectorAll<HTMLInputElement>(".gm-ticket-color-price").forEach((inp) => {
    inp.addEventListener("input", () => {
      const color = inp.dataset.color as Spill1TicketColor | undefined;
      if (!color) return;
      const entry = state.spill1.ticketColors.find((tc) => tc.color === color);
      if (entry) entry.priceNok = Number(inp.value);
    });
  });

  // Wire pattern-prize cells initially + whenever table is refreshed.
  wirePatternPrizeCells(container, state);

  // Jackpot
  container.querySelector<HTMLInputElement>("#gm-jackpot-white")?.addEventListener("input", (ev) => {
    state.spill1.jackpot.prizeByColor.white = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-jackpot-yellow")?.addEventListener("input", (ev) => {
    state.spill1.jackpot.prizeByColor.yellow = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-jackpot-purple")?.addEventListener("input", (ev) => {
    state.spill1.jackpot.prizeByColor.purple = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-jackpot-draw")?.addEventListener("input", (ev) => {
    state.spill1.jackpot.draw = Number((ev.target as HTMLInputElement).value);
  });

  // Elvis + Lucky number
  container.querySelector<HTMLInputElement>("#gm-elvis-replace")?.addEventListener("input", (ev) => {
    state.spill1.elvis.replaceTicketPriceNok = Number((ev.target as HTMLInputElement).value);
  });
  container.querySelector<HTMLInputElement>("#gm-lucky-prize")?.addEventListener("input", (ev) => {
    state.spill1.luckyNumberPrizeNok = Number((ev.target as HTMLInputElement).value);
  });

  // Submit.
  const submitBtn = container.querySelector<HTMLButtonElement>("#gm-submit");
  submitBtn?.addEventListener("click", async () => {
    await handleSubmit(container, state);
  });
  const form = container.querySelector<HTMLFormElement>("#gm-add-form");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await handleSubmit(container, state);
  });
}

function wirePatternPrizeCells(container: HTMLElement, state: FormState): void {
  container.querySelectorAll<HTMLInputElement>(".gm-prize-cell").forEach((inp) => {
    inp.addEventListener("input", () => {
      const color = inp.dataset.color as Spill1TicketColor | undefined;
      const pattern = inp.dataset.pattern as Spill1Pattern | undefined;
      if (!color || !pattern) return;
      const entry = state.spill1.ticketColors.find((tc) => tc.color === color);
      if (!entry) return;
      const v = Number(inp.value);
      if (Number.isFinite(v) && v >= 0) {
        entry.prizePerPattern[pattern] = v;
      } else {
        delete entry.prizePerPattern[pattern];
      }
      // Update sum-cell.
      const sum = Object.values(entry.prizePerPattern).reduce<number>(
        (acc, vv) => acc + (Number.isFinite(vv) ? (vv ?? 0) : 0),
        0
      );
      const sumCell = container.querySelector<HTMLElement>(`#gm-prize-sum-${color}`);
      if (sumCell) {
        sumCell.textContent = `${sum}%`;
        sumCell.style.color = sum > 100 ? "#d9534f" : "";
      }
    });
  });
}

function refreshPatternPrizeTable(container: HTMLElement, state: FormState): void {
  const host = container.querySelector<HTMLElement>("#gm-pattern-prizes");
  if (!host) return;
  // Re-render sub-section in place.
  const newHtml = renderSectionPatternPrizes(state);
  // Extract the inner div to replace without rewriting the fieldset.
  const tmp = document.createElement("div");
  tmp.innerHTML = newHtml;
  const inner = tmp.querySelector<HTMLElement>("#gm-pattern-prizes");
  if (inner) host.innerHTML = inner.innerHTML;
  wirePatternPrizeCells(container, state);
}

/** Mapper backend-feilkoder til i18n-nøkler, med fallback til backend-meldingen. */
function mapErrorCodeToMessage(code: string, message: string): string {
  const map: Record<string, string> = {
    INVALID_INPUT: message,
    VALIDATION_ERROR: message,
    GAME_TYPE_NOT_FOUND: t("game_type_not_found_fallback"),
    GAME_MANAGEMENT_NOT_FOUND: t("no_data_available"),
    UNAUTHORIZED: t("UnAuthorized"),
    FORBIDDEN: t("forbidden") || message,
  };
  return map[code] ?? message;
}

function showFieldErrors(container: HTMLElement, errors: ValidationError[]): void {
  const host = container.querySelector<HTMLElement>("#gm-field-errors");
  if (!host) return;
  if (errors.length === 0) {
    host.innerHTML = "";
    return;
  }
  const items = errors
    .map((e) => `<li><code>${escapeHtml(e.path)}</code>: ${escapeHtml(t(e.message) || e.message)}</li>`)
    .join("");
  host.innerHTML = `
    <div class="alert alert-danger" style="margin-top:12px;">
      <strong>${escapeHtml(t("pls_fill_all_form_field") || "Vennligst sjekk skjemaet")}:</strong>
      <ul style="margin:4px 0 0 20px;">${items}</ul>
    </div>`;
}

function showGlobalAlert(container: HTMLElement, message: string, type: "success" | "danger"): void {
  const host = container.querySelector<HTMLElement>("#gm-global-alert");
  if (!host) return;
  host.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}

function clearGlobalAlert(container: HTMLElement): void {
  const host = container.querySelector<HTMLElement>("#gm-global-alert");
  if (host) host.innerHTML = "";
}

async function handleSubmit(container: HTMLElement, state: FormState): Promise<void> {
  if (state.submitting) return;
  clearGlobalAlert(container);

  // Lokal validering.
  const v = validateSpill1Config(state.spill1, state.name);
  if (!v.ok) {
    state.errors = v.errors;
    showFieldErrors(container, v.errors);
    return;
  }
  state.errors = [];
  showFieldErrors(container, []);

  // Bygg payload + submit.
  const payload = buildSpill1Payload({
    gameTypeId: state.gameType._id,
    name: state.name.trim(),
    isoDate: state.startDateIso,
    spill1: state.spill1,
  });

  state.submitting = true;
  const submitBtn = container.querySelector<HTMLButtonElement>("#gm-submit");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> ${escapeHtml(t("loading"))}`;
  }

  const res = await createGameManagement(payload);

  state.submitting = false;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa fa-save"></i> ${escapeHtml(t("submit"))}`;
  }

  if (res.ok) {
    const msg = `${t("game_name") || "Spill"} "${state.name}" ${t("added_successfully") || "opprettet"}`;
    showGlobalAlert(container, msg, "success");
    // Redirect til list-siden etter kort delay.
    setTimeout(() => {
      window.location.hash = `#/gameManagement?typeId=${encodeURIComponent(state.gameType._id)}`;
    }, 800);
    return;
  }

  if (res.reason === "API_ERROR") {
    const mapped = mapErrorCodeToMessage(res.code, res.message);
    showGlobalAlert(container, `[${res.code}] ${mapped}`, "danger");
    return;
  }
  showGlobalAlert(container, "Ukjent feil ved lagring.", "danger");
}

// Export helpers for tests.
export const __test__ = {
  handleSubmit,
  showFieldErrors,
  showGlobalAlert,
  mapErrorCodeToMessage,
};
