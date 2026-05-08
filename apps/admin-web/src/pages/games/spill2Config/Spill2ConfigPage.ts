/**
 * Admin-UI for Spill 2 (rocket) global singleton-konfig
 * (Tobias-direktiv 2026-05-08, parallel til Spill 3).
 *
 * URL: /admin/#/games/spill2-config
 *
 * Layout (matches admin-web pattern):
 *   - Content header med tittel + breadcrumb
 *   - Panel "Spill 2 — Globalt rom"
 *   - Form-seksjoner:
 *       1. Åpningstider (start/end HH:MM, eller blank for alltid åpent)
 *       2. Runde-konfig (min-tickets, ticket-pris, runde-pause, ball-intervall)
 *       3. Jackpot-tabell (6 prize-tiers per draw-count)
 *       4. Lucky-number-bonus (på/av + premie i kr)
 *   - Lagre-knapp (kun ADMIN — disabled ellers)
 *
 * Backend: PUT /api/admin/spill2/config (ADMIN-only, GAME_CATALOG_WRITE)
 */

import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { getSession } from "../../../auth/Session.js";
import {
  getSpill2Config,
  updateSpill2Config,
  centsToKr,
  krToCents,
  type Spill2Config,
  type Spill2ConfigPatch,
  type Spill2JackpotTable,
} from "../../../api/admin-spill2-config.js";
import { ApiError } from "../../../api/client.js";

function canWrite(): boolean {
  const session = getSession();
  if (!session) return false;
  return session.role === "admin" || session.role === "super-admin";
}

/** Labels for jackpot-tabell-rader (samme som Spill23PaceForm). */
const JACKPOT_ROW_LABELS: Array<{ key: keyof Spill2JackpotTable; label: string }> = [
  { key: "9",    label: "Trekk 9" },
  { key: "10",   label: "Trekk 10" },
  { key: "11",   label: "Trekk 11" },
  { key: "12",   label: "Trekk 12" },
  { key: "13",   label: "Trekk 13" },
  { key: "1421", label: "Trekk 14–21" },
];

export async function renderSpill2ConfigPage(
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = renderShellLoading();
  try {
    const config = await getSpill2Config();
    container.innerHTML = renderShell(config);
    wireForm(container, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShellError(msg);
  }
}

// ── Shell-templates ────────────────────────────────────────────────────────

function renderShellLoading(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>Spill 2 — Globalt rom</h1>
      </section>
      <section class="content">
        <div class="text-center" style="padding:40px">
          <i class="fa fa-spinner fa-spin fa-3x" aria-hidden="true"></i>
          <p class="text-muted">Laster konfig …</p>
        </div>
      </section>
    </div></div>`;
}

function renderShellError(msg: string): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>Spill 2 — Globalt rom</h1>
      </section>
      <section class="content">
        <div class="alert alert-danger">
          <strong>Kunne ikke laste konfig.</strong> ${escapeHtml(msg)}
        </div>
      </section>
    </div></div>`;
}

function renderShell(config: Spill2Config): string {
  const writeAccess = canWrite();
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>Spill 2 — Globalt rom <small>(Rocket / Tallspill)</small></h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> Dashboard</a></li>
          <li>Spilladministrasjon</li>
          <li class="active">Spill 2 — Globalt rom</li>
        </ol>
      </section>

      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">Global konfig</h6></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                ${
                  !writeAccess
                    ? `<div class="alert alert-warning">
                        <i class="fa fa-info-circle"></i>
                        Du har lese-tilgang. Endringer krever ADMIN-rolle.
                      </div>`
                    : ""
                }
                <p class="text-muted">
                  Spill 2 (Rocket / Tallspill) er ETT globalt rom som er
                  alltid aktivt mellom åpningstider. Endringer her gjelder
                  for ALLE haller — det er én sannhet for hele plattformen.
                </p>

                <form id="spill2-config-form" novalidate>
                  ${renderOpeningHoursSection(config, writeAccess)}
                  ${renderRoundConfigSection(config, writeAccess)}
                  ${renderJackpotSection(config, writeAccess)}
                  ${renderLuckyNumberSection(config, writeAccess)}

                  <div class="form-actions" style="margin-top:24px;border-top:1px solid #eee;padding-top:16px">
                    <button type="submit"
                            class="btn btn-primary btn-md"
                            data-action="save"
                            ${writeAccess ? "" : "disabled"}>
                      <i class="fa fa-save" aria-hidden="true"></i>
                      Lagre konfig
                    </button>
                    <button type="button"
                            class="btn btn-default btn-md"
                            data-action="reset"
                            ${writeAccess ? "" : "disabled"}>
                      Tilbakestill
                    </button>
                    <span class="text-muted" style="margin-left:16px">
                      Sist oppdatert:
                      ${escapeHtml(new Date(config.updatedAt).toLocaleString("nb-NO"))}
                    </span>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

// ── Section-renderers ──────────────────────────────────────────────────────

function renderOpeningHoursSection(config: Spill2Config, writeAccess: boolean): string {
  const startVal = config.openingTimeStart ?? "";
  const endVal = config.openingTimeEnd ?? "";
  return `
    <fieldset class="form-section" style="margin-top:16px">
      <legend>Åpningstider</legend>
      <p class="text-muted small">
        HH:MM-format (Europe/Oslo). La begge stå tomme for at rommet er
        alltid aktivt.
      </p>
      <div class="row">
        <div class="col-sm-6">
          <label for="spill2-opening-start">Åpner</label>
          <input type="text"
                 class="form-control"
                 id="spill2-opening-start"
                 name="openingTimeStart"
                 placeholder="HH:MM (eks. 10:00)"
                 pattern="^([0-9]{1,2}):([0-9]{2})$"
                 value="${escapeHtml(startVal)}"
                 ${writeAccess ? "" : "disabled"}>
        </div>
        <div class="col-sm-6">
          <label for="spill2-opening-end">Stenger</label>
          <input type="text"
                 class="form-control"
                 id="spill2-opening-end"
                 name="openingTimeEnd"
                 placeholder="HH:MM (eks. 22:00)"
                 pattern="^([0-9]{1,2}):([0-9]{2})$"
                 value="${escapeHtml(endVal)}"
                 ${writeAccess ? "" : "disabled"}>
        </div>
      </div>
    </fieldset>`;
}

function renderRoundConfigSection(config: Spill2Config, writeAccess: boolean): string {
  return `
    <fieldset class="form-section" style="margin-top:16px">
      <legend>Runde-konfig</legend>
      <div class="row">
        <div class="col-sm-3">
          <label for="spill2-min-tickets">Min. bonger før start</label>
          <input type="number"
                 class="form-control"
                 id="spill2-min-tickets"
                 name="minTicketsToStart"
                 min="0"
                 max="1000"
                 step="1"
                 value="${config.minTicketsToStart}"
                 ${writeAccess ? "" : "disabled"}>
          <span class="help-block small">Bonger som må selges før runden starter (0 = umiddelbar).</span>
        </div>
        <div class="col-sm-3">
          <label for="spill2-ticket-price">Bongpris (kr)</label>
          <input type="number"
                 class="form-control"
                 id="spill2-ticket-price"
                 name="ticketPriceKr"
                 min="1"
                 max="1000"
                 step="1"
                 value="${centsToKr(config.ticketPriceCents)}"
                 ${writeAccess ? "" : "disabled"}>
          <span class="help-block small">Lagres som ${config.ticketPriceCents} øre.</span>
        </div>
        <div class="col-sm-3">
          <label for="spill2-round-pause">Pause mellom runder (sek)</label>
          <input type="number"
                 class="form-control"
                 id="spill2-round-pause"
                 name="roundPauseSeconds"
                 min="1"
                 max="300"
                 step="1"
                 value="${Math.floor(config.roundPauseMs / 1000)}"
                 ${writeAccess ? "" : "disabled"}>
        </div>
        <div class="col-sm-3">
          <label for="spill2-ball-interval">Pause mellom baller (sek)</label>
          <input type="number"
                 class="form-control"
                 id="spill2-ball-interval"
                 name="ballIntervalSeconds"
                 min="1"
                 max="10"
                 step="1"
                 value="${Math.floor(config.ballIntervalMs / 1000)}"
                 ${writeAccess ? "" : "disabled"}>
        </div>
      </div>
    </fieldset>`;
}

function renderJackpotSection(config: Spill2Config, writeAccess: boolean): string {
  const rows = JACKPOT_ROW_LABELS.map(({ key, label }) => {
    const entry = config.jackpotNumberTable[key];
    const price = entry?.price ?? 0;
    const isCash = entry?.isCash ?? true;
    return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>
          <select class="form-control jackpot-isCash"
                  data-key="${escapeHtml(key)}"
                  ${writeAccess ? "" : "disabled"}>
            <option value="cash" ${isCash ? "selected" : ""}>Fast (kr)</option>
            <option value="percent" ${!isCash ? "selected" : ""}>% av omsetning</option>
          </select>
        </td>
        <td>
          <input type="number"
                 class="form-control jackpot-price"
                 data-key="${escapeHtml(key)}"
                 min="0"
                 step="${isCash ? "1" : "0.01"}"
                 value="${price}"
                 ${writeAccess ? "" : "disabled"}>
        </td>
      </tr>`;
  }).join("");

  return `
    <fieldset class="form-section" style="margin-top:16px">
      <legend>Jackpot-tabell</legend>
      <p class="text-muted small">
        Premie-tier per antall trekk når full plate vinnes.
        <strong>Fast (kr)</strong> = flatt beløp delt på antall vinnere.
        <strong>% av omsetning</strong> = prosent av (antall solgte bonger × bongpris).
      </p>
      <div class="table-responsive">
        <table class="table table-bordered" style="margin-bottom:0">
          <thead>
            <tr>
              <th style="width:25%">Trekk</th>
              <th style="width:30%">Type</th>
              <th style="width:45%">Verdi</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </fieldset>`;
}

function renderLuckyNumberSection(config: Spill2Config, writeAccess: boolean): string {
  const enabled = config.luckyNumberEnabled;
  const prizeKr = centsToKr(config.luckyNumberPrizeCents);
  return `
    <fieldset class="form-section" style="margin-top:16px">
      <legend>Lucky number-bonus</legend>
      <p class="text-muted small">
        Når aktivert utbetales tilleggspremie hvis siste trukne ball ved
        seier matcher rundens lucky-number.
      </p>
      <div class="row">
        <div class="col-sm-4">
          <div class="checkbox">
            <label>
              <input type="checkbox"
                     id="spill2-lucky-enabled"
                     name="luckyNumberEnabled"
                     ${enabled ? "checked" : ""}
                     ${writeAccess ? "" : "disabled"}>
              Aktivér lucky-number-bonus
            </label>
          </div>
        </div>
        <div class="col-sm-4">
          <label for="spill2-lucky-prize">Bonus-premie (kr)</label>
          <input type="number"
                 class="form-control"
                 id="spill2-lucky-prize"
                 name="luckyNumberPrizeKr"
                 min="0"
                 step="1"
                 value="${prizeKr}"
                 ${writeAccess && enabled ? "" : "disabled"}>
        </div>
      </div>
    </fieldset>`;
}

// ── Form-wiring ────────────────────────────────────────────────────────────

function wireForm(container: HTMLElement, original: Spill2Config): void {
  const form = container.querySelector<HTMLFormElement>("#spill2-config-form");
  if (!form) return;

  // Lucky-number toggle: enable/disable prize-input dynamisk.
  const luckyCheckbox = form.querySelector<HTMLInputElement>("#spill2-lucky-enabled");
  const luckyPriceInput = form.querySelector<HTMLInputElement>("#spill2-lucky-prize");
  if (luckyCheckbox && luckyPriceInput) {
    luckyCheckbox.addEventListener("change", () => {
      luckyPriceInput.disabled = !luckyCheckbox.checked || !canWrite();
    });
  }

  // Jackpot-isCash-dropdown: toggle step-attributtet på price-input.
  for (const select of form.querySelectorAll<HTMLSelectElement>(".jackpot-isCash")) {
    select.addEventListener("change", () => {
      const key = select.dataset.key;
      const priceInput = form.querySelector<HTMLInputElement>(
        `.jackpot-price[data-key="${key}"]`,
      );
      if (priceInput) {
        priceInput.step = select.value === "cash" ? "1" : "0.01";
      }
    });
  }

  // Reset-knapp: re-render hele page med original config.
  const resetBtn = form.querySelector<HTMLButtonElement>('[data-action="reset"]');
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      void renderSpill2ConfigPage(container);
    });
  }

  // Submit-handler.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canWrite()) return;
    const submitBtn = form.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const patch = collectPatch(form, original);
      const updated = await updateSpill2Config(patch);
      Toast.success("Spill 2-konfig oppdatert.");
      // Re-render med ny config så updatedAt-timestamp + alle felter er friske.
      container.innerHTML = renderShell(updated);
      wireForm(container, updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      Toast.error(`Lagring feilet: ${msg}`);
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

/**
 * Samle alle felter fra form-elementene til en partial patch.
 * Sender alltid komplett patch (alle felt) — backend ignorerer
 * uendrede felter via merge-pathen, men det er enklere å la admin-UI
 * sende hele tilstanden enn å diff'e mot original.
 */
function collectPatch(form: HTMLFormElement, original: Spill2Config): Spill2ConfigPatch {
  const startInput = form.querySelector<HTMLInputElement>("#spill2-opening-start");
  const endInput = form.querySelector<HTMLInputElement>("#spill2-opening-end");
  const minTicketsInput = form.querySelector<HTMLInputElement>("#spill2-min-tickets");
  const priceInput = form.querySelector<HTMLInputElement>("#spill2-ticket-price");
  const roundPauseInput = form.querySelector<HTMLInputElement>("#spill2-round-pause");
  const ballIntervalInput = form.querySelector<HTMLInputElement>("#spill2-ball-interval");
  const luckyCheckbox = form.querySelector<HTMLInputElement>("#spill2-lucky-enabled");
  const luckyPriceInput = form.querySelector<HTMLInputElement>("#spill2-lucky-prize");

  // Åpningstider: tom-streng → null. Backend håndterer normalisering.
  const startRaw = startInput?.value.trim() ?? "";
  const endRaw = endInput?.value.trim() ?? "";

  // Jackpot-tabell: rebuild fra DOM. Hver rad har en isCash-select og
  // en price-input. Hvis noen er savnet, fall-back til original-verdien
  // for den nøkkelen (defensiv).
  const jackpotTable: Spill2JackpotTable = {
    "9":    { ...original.jackpotNumberTable["9"] },
    "10":   { ...original.jackpotNumberTable["10"] },
    "11":   { ...original.jackpotNumberTable["11"] },
    "12":   { ...original.jackpotNumberTable["12"] },
    "13":   { ...original.jackpotNumberTable["13"] },
    "1421": { ...original.jackpotNumberTable["1421"] },
  };
  for (const select of form.querySelectorAll<HTMLSelectElement>(".jackpot-isCash")) {
    const key = select.dataset.key as keyof Spill2JackpotTable | undefined;
    if (!key) continue;
    const priceInput = form.querySelector<HTMLInputElement>(
      `.jackpot-price[data-key="${key}"]`,
    );
    const isCash = select.value === "cash";
    const priceVal = Number(priceInput?.value ?? 0);
    jackpotTable[key] = {
      price: Number.isFinite(priceVal) ? priceVal : 0,
      isCash,
    };
  }

  const luckyEnabled = luckyCheckbox?.checked ?? false;
  // Lucky-prize: kun include når enabled (ellers null så backend
  // konsistens-validering ikke krasjer).
  const luckyPrizeKr = Number(luckyPriceInput?.value ?? 0);
  const luckyPrizeCents = luckyEnabled
    ? Number.isFinite(luckyPrizeKr) ? krToCents(luckyPrizeKr) : 0
    : null;

  return {
    openingTimeStart: startRaw === "" ? null : startRaw,
    openingTimeEnd: endRaw === "" ? null : endRaw,
    minTicketsToStart: parseIntOrDefault(minTicketsInput?.value, original.minTicketsToStart),
    ticketPriceCents: krToCents(parseFloatOrDefault(priceInput?.value, centsToKr(original.ticketPriceCents))),
    roundPauseMs: parseIntOrDefault(roundPauseInput?.value, original.roundPauseMs / 1000) * 1000,
    ballIntervalMs: parseIntOrDefault(ballIntervalInput?.value, original.ballIntervalMs / 1000) * 1000,
    jackpotNumberTable: jackpotTable,
    luckyNumberEnabled: luckyEnabled,
    luckyNumberPrizeCents: luckyPrizeCents,
  };
}

function parseIntOrDefault(s: string | undefined, fallback: number): number {
  if (s === undefined || s.trim() === "") return Math.floor(fallback);
  const n = Number(s.trim());
  if (!Number.isFinite(n)) return Math.floor(fallback);
  return Math.floor(n);
}

function parseFloatOrDefault(s: string | undefined, fallback: number): number {
  if (s === undefined || s.trim() === "") return fallback;
  const n = Number(s.trim());
  if (!Number.isFinite(n)) return fallback;
  return n;
}
