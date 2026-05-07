/**
 * Fase 2 (2026-05-07): GameCatalog editor (add + edit i samme komponent).
 *
 * URLer:
 *   /admin/#/games/catalog/new   — opprett ny entry
 *   /admin/#/games/catalog/:id   — rediger eksisterende
 *
 * Seksjoner:
 *   1. Grunnleggende: navn, slug, beskrivelse, aktiv
 *   2. Bongkonfigurasjon: bongfarger (multi-checkbox) + pris pr. valgt farge
 *   3. Premier: Rad 1-4 (flat) + Bingo per valgt farge
 *   4. Bonus-spill: toggle + dropdown
 *   5. Spesial: jackpot-setup-toggle
 *
 * Beløp i UI er i KR; konvertering til ØRE skjer i GameCatalogState før
 * sending til backend.
 */

import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { t } from "../../../i18n/I18n.js";
import {
  defaultCatalogPayload,
  entryToFormPayload,
  fetchCatalogEntry,
  saveCatalogEntry,
  GAME_VARIANT_VALUES,
  TRAFIKKLYS_ROW_COLORS,
  type CatalogFormPayload,
  type GameVariant,
  type TrafikklysRowColor,
} from "./GameCatalogState.js";
import {
  BONUS_GAME_SLUG_VALUES,
  PRIZE_MULTIPLIER_MODE_VALUES,
  TICKET_COLOR_VALUES,
  type BonusGameSlug,
  type PrizeMultiplierMode,
  type TicketColor,
} from "../../../api/admin-game-catalog.js";

const COLOR_LABELS: Record<TicketColor, string> = {
  gul: "Gul",
  hvit: "Hvit",
  lilla: "Lilla",
};

const BONUS_LABELS: Record<BonusGameSlug, string> = {
  mystery: "Mystery",
  wheel_of_fortune: "Lykkehjul (Wheel of Fortune)",
  treasure_chest: "Skattkiste (Treasure Chest)",
  color_draft: "Color Draft",
};

const PRIZE_MODE_LABELS: Record<PrizeMultiplierMode, string> = {
  auto: "Auto-multiplikator (én base, dyrere bonger får mer)",
  explicit_per_color: "Spesialpris (eksplisitt per bongfarge)",
};

const GAME_VARIANT_LABELS: Record<GameVariant, string> = {
  standard: "Standard",
  trafikklys: "Trafikklys (spesial)",
  oddsen: "Oddsen (spesial)",
};

const TRAFIKKLYS_ROW_COLOR_LABELS: Record<TrafikklysRowColor, string> = {
  grønn: "Grønn",
  gul: "Gul",
  rød: "Rød",
};

/**
 * Tobias 2026-05-07 (premise): billigste bong er ALLTID 5 kr (500 øre).
 * Multiplikator: faktor = ticketPriceCents / 500.
 */
const CHEAPEST_PRICE_CENTS = 500;

/** Tobias 2026-05-07: billigste bong er ALLTID 5 kr (500 øre) — Oddsen-base. */
const ODDSEN_CHEAPEST_PRICE_KR = 5;

export async function renderGameCatalogNewPage(
  container: HTMLElement,
): Promise<void> {
  const payload = defaultCatalogPayload();
  container.innerHTML = renderShell(payload, false, null);
  wireForm(container, payload, null);
}

export async function renderGameCatalogEditPage(
  container: HTMLElement,
  id: string,
): Promise<void> {
  container.innerHTML = renderLoading();
  try {
    const entry = await fetchCatalogEntry(id);
    if (!entry) {
      container.innerHTML = renderShell(
        defaultCatalogPayload(),
        true,
        `Ingen katalog-entry med id ${id}.`,
      );
      return;
    }
    const payload = entryToFormPayload(entry);
    container.innerHTML = renderShell(payload, true, null);
    wireForm(container, payload, entry.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = renderShell(defaultCatalogPayload(), true, msg);
  }
}

function renderLoading(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content"><div class="row"><div class="col-sm-12">
        <div class="text-center" style="padding:48px"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>
      </div></div></section>
    </div></div>`;
}

function renderShell(
  payload: CatalogFormPayload,
  isEdit: boolean,
  error: string | null,
): string {
  const heading = isEdit ? "Rediger spill" : "Legg til spill";
  const cancelHash = "#/games/catalog";

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;">${escapeHtml(error)}</div>`
    : "";

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/games/catalog">Spillkatalog</a></li>
          <li class="active">${escapeHtml(heading)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(heading)}</h6></div>
              <div class="clearfix"></div>
            </div>
            ${errorBlock}
            <div class="panel-wrapper collapse in"><div class="panel-body">
              <form id="game-catalog-form" class="form-horizontal" data-existing-id="${escapeHtml(isEdit ? "edit" : "new")}">
                ${renderBasicSection(payload, isEdit)}
                ${renderGameVariantSection(payload)}
                ${renderTicketColorsSection(payload)}
                ${renderTicketPricesSection(payload)}
                ${renderTrafikklysFlatPriceSection(payload)}
                ${renderPrizesSection(payload)}
                ${renderTrafikklysPrizesSection(payload)}
                ${renderOddsenSection(payload)}
                ${renderBonusSection(payload)}
                ${renderSpecialSection(payload)}
                <div style="padding:16px;border-top:1px solid #eee;margin-top:16px">
                  <button type="submit" class="btn btn-success btn-flat" data-action="save-catalog">
                    Lagre
                  </button>
                  <a href="${cancelHash}" class="btn btn-default btn-flat">Avbryt</a>
                </div>
              </form>
            </div></div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderBasicSection(
  p: CatalogFormPayload,
  isEdit: boolean,
): string {
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">1. Grunnleggende</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-displayName">Navn <span class="text-danger">*</span></label>
        <div class="col-sm-9">
          <input type="text" class="form-control" id="cat-displayName" name="displayName"
            value="${escapeHtml(p.displayName)}"
            placeholder="Eks. Jackpot, Innsatsen, Trafikklys"
            maxlength="200" required>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-slug">Slug <span class="text-danger">*</span></label>
        <div class="col-sm-9">
          <input type="text" class="form-control" id="cat-slug" name="slug"
            value="${escapeHtml(p.slug)}"
            placeholder="eks. jackpot"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxlength="80" required ${isEdit ? "" : ""}>
          <p class="help-block">Lowercase, alfanumerisk og bindestrek (eks. <code>jackpot-1</code>). Unik per katalog.</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-description">Beskrivelse</label>
        <div class="col-sm-9">
          <textarea class="form-control" id="cat-description" name="description" rows="2" maxlength="2000"
            placeholder="Frittekst-beskrivelse av spillet (valgfritt)">${escapeHtml(p.description ?? "")}</textarea>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label">Aktiv</label>
        <div class="col-sm-9">
          <label class="switch">
            <input type="checkbox" id="cat-isActive"${p.isActive ? " checked" : ""}>
            <span class="slider round"></span>
          </label>
          <span class="text-muted" style="margin-left:8px">Inaktive entries kan ikke legges i nye sekvenser.</span>
        </div>
      </div>
    </fieldset>`;
}

/**
 * Spilltype-velger. Standard/Trafikklys/Oddsen (radio).
 *
 * Når brukeren bytter variant, JS-en i wireForm() viser/skjuler de
 * relevante seksjonene (trafikklys-flat-pris, trafikklys-premier,
 * oddsen-felter, og standard pris/premier-seksjoner).
 */
function renderGameVariantSection(p: CatalogFormPayload): string {
  const radios = GAME_VARIANT_VALUES.map(
    (variant) => `
      <label class="radio-inline" style="margin-right:16px">
        <input type="radio" name="gameVariant" value="${variant}"
          data-variant="${variant}"
          ${p.gameVariant === variant ? "checked" : ""}>
        ${escapeHtml(GAME_VARIANT_LABELS[variant])}
      </label>`,
  ).join("");
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px"
              id="cat-variant-fieldset">
      <legend style="font-size:14px;width:auto;padding:0 8px">Spilltype</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Variant</label>
        <div class="col-sm-9">
          ${radios}
          <p class="help-block">
            <strong>Standard</strong> bruker pris pr. bongfarge + rad-premier.
            <strong>Trafikklys</strong> har én flat pris og premier per rad-farge
            (grønn/gul/rød). <strong>Oddsen</strong> har høy bingo-premie ved
            fullt hus på et bestemt trekk, lav ellers.
          </p>
        </div>
      </div>
    </fieldset>`;
}

/**
 * Trafikklys: én flat pris alle bonger (15 kr default).
 * Vises kun når gameVariant=trafikklys; skjuler standard pris-pr-farge.
 */
function renderTrafikklysFlatPriceSection(p: CatalogFormPayload): string {
  const visible = p.gameVariant === "trafikklys";
  return `
    <fieldset class="cat-trafikklys-flat-price"
              style="border:1px solid #ddd;padding:12px;margin-bottom:16px;${visible ? "" : "display:none"}">
      <legend style="font-size:14px;width:auto;padding:0 8px">Pris alle bonger (Trafikklys)</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-trafikklys-ticketPrice">Pris (kr)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="cat-trafikklys-ticketPrice"
            name="trafikklysTicketPrice"
            value="${p.trafikklys.ticketPriceKr}"
            min="0" step="1" style="max-width:140px">
          <p class="help-block">Trafikklys har samme pris for alle bongfarger (default 15 kr).</p>
        </div>
      </div>
    </fieldset>`;
}

/**
 * Trafikklys: premier per RAD-FARGE (grønn/gul/rød) — ikke per bongfarge.
 * Vises kun når gameVariant=trafikklys.
 */
function renderTrafikklysPrizesSection(p: CatalogFormPayload): string {
  const visible = p.gameVariant === "trafikklys";
  const colorChip = (rc: TrafikklysRowColor): string => {
    const checked = p.trafikklys.rowColors.includes(rc);
    return `
      <label class="checkbox-inline" style="margin-right:12px">
        <input type="checkbox" name="trafikklysRowColor" value="${rc}" data-row-color="${rc}"${checked ? " checked" : ""}>
        ${escapeHtml(TRAFIKKLYS_ROW_COLOR_LABELS[rc])}
      </label>`;
  };
  const prizeRow = (
    rc: TrafikklysRowColor,
    field: "prize" | "bingo",
    label: string,
  ): string => {
    const value =
      field === "prize"
        ? p.trafikklys.prizesPerRowColorKr[rc] ?? 0
        : p.trafikklys.bingoPerRowColorKr[rc] ?? 0;
    const rowClass =
      field === "prize"
        ? "trafikklys-prize-row"
        : "trafikklys-bingo-row";
    const isActive = p.trafikklys.rowColors.includes(rc);
    return `
      <div class="form-group ${rowClass}" data-row-color="${rc}"
           style="${isActive ? "" : "display:none"}">
        <label class="col-sm-3 control-label">${escapeHtml(label)} ${escapeHtml(TRAFIKKLYS_ROW_COLOR_LABELS[rc])} (kr)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control"
            name="trafikklys${field === "prize" ? "Prize" : "Bingo"}-${rc}"
            data-row-color="${rc}"
            value="${value}"
            min="0" step="1" style="max-width:140px">
        </div>
      </div>`;
  };
  return `
    <fieldset class="cat-trafikklys-prizes"
              style="border:1px solid #ddd;padding:12px;margin-bottom:16px;${visible ? "" : "display:none"}">
      <legend style="font-size:14px;width:auto;padding:0 8px">Trafikklys-premier</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Aktive rad-farger</label>
        <div class="col-sm-9">
          ${TRAFIKKLYS_ROW_COLORS.map(colorChip).join("")}
          <p class="help-block">Premier defineres pr. rad-farge (rød/grønn/gul) — ikke pr. bongfarge.</p>
        </div>
      </div>
      <p class="help-block" style="padding-left:25%;margin-top:8px">Premie ved rad/full house pr. rad-farge:</p>
      ${TRAFIKKLYS_ROW_COLORS.map((rc) => prizeRow(rc, "prize", "Premie")).join("")}
      <p class="help-block" style="padding-left:25%;margin-top:8px">Bingo (fullt hus) pr. rad-farge:</p>
      ${TRAFIKKLYS_ROW_COLORS.map((rc) => prizeRow(rc, "bingo", "Bingo")).join("")}
    </fieldset>`;
}

/**
 * Oddsen: target-trekk + lav/høy base. Vises kun når gameVariant=oddsen.
 *
 * Viser preview-tabell som regner ut per-farge low/high via multiplikator
 * (pris / 5 kr). Brukerne ser konkret hva spillerne vil få.
 */
function renderOddsenSection(p: CatalogFormPayload): string {
  const visible = p.gameVariant === "oddsen";
  return `
    <fieldset class="cat-oddsen"
              style="border:1px solid #ddd;padding:12px;margin-bottom:16px;${visible ? "" : "display:none"}">
      <legend style="font-size:14px;width:auto;padding:0 8px">Oddsen-spesial</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-oddsen-targetDraw">Target-trekk</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="cat-oddsen-targetDraw"
            name="oddsenTargetDraw"
            value="${p.oddsen.targetDraw}"
            min="1" max="90" step="1" style="max-width:120px">
          <p class="help-block">Trekk-nummer (1-90) som gir HØY bingo-premie ved fullt hus.</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-oddsen-bingoBaseLow">Bingo lav (5 kr-bong, base)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="cat-oddsen-bingoBaseLow"
            name="oddsenBingoBaseLow"
            value="${p.oddsen.bingoBaseLowKr}"
            min="0" step="1" style="max-width:140px">
          <p class="help-block">Premie hvis fullt hus IKKE på target-trekk.</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-oddsen-bingoBaseHigh">Bingo høy (5 kr-bong, base)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="cat-oddsen-bingoBaseHigh"
            name="oddsenBingoBaseHigh"
            value="${p.oddsen.bingoBaseHighKr}"
            min="0" step="1" style="max-width:140px">
          <p class="help-block">Premie hvis fullt hus PÅ target-trekk.</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label">Forhåndsvisning</label>
        <div class="col-sm-9">
          <table class="table table-condensed table-bordered" style="margin-bottom:0;max-width:520px"
                 id="cat-oddsen-preview"
                 aria-label="Forhåndsvisning av oddsen-premier">
            <thead>
              <tr>
                <th>Bongfarge</th>
                <th>Pris</th>
                <th>Multiplikator</th>
                <th>Bingo lav</th>
                <th>Bingo høy</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
          <p class="help-block">Per-farge premier regnes ut som <code>base × (pris / 5 kr)</code>.</p>
        </div>
      </div>
    </fieldset>`;
}

function renderTicketColorsSection(p: CatalogFormPayload): string {
  const cb = (color: TicketColor): string => {
    const checked = p.ticketColors.includes(color);
    return `
      <label class="checkbox-inline" style="margin-right:12px">
        <input type="checkbox" name="ticketColor" value="${color}" data-color="${color}"${checked ? " checked" : ""}>
        ${escapeHtml(COLOR_LABELS[color])}
      </label>`;
  };
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">2. Bongfarger</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Bongfarger <span class="text-danger">*</span></label>
        <div class="col-sm-9">
          ${TICKET_COLOR_VALUES.map(cb).join("")}
          <p class="help-block">Velg minst én bongfarge. Pris og bingo-premie defineres pr. farge.</p>
        </div>
      </div>
    </fieldset>`;
}

function renderTicketPricesSection(p: CatalogFormPayload): string {
  const row = (color: TicketColor): string => {
    const value =
      p.ticketPricesKr[color] !== undefined ? String(p.ticketPricesKr[color]) : "";
    const visible = p.ticketColors.includes(color);
    return `
      <div class="form-group ticket-price-row" data-color="${color}" style="${visible ? "" : "display:none"}">
        <label class="col-sm-3 control-label">${escapeHtml(COLOR_LABELS[color])} (kr)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" name="ticketPrice-${color}"
            data-color="${color}"
            value="${escapeHtml(value)}"
            min="0" step="1" placeholder="Pr. bong">
        </div>
      </div>`;
  };
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">3. Pris pr. bongfarge (kr)</legend>
      ${TICKET_COLOR_VALUES.map(row).join("")}
    </fieldset>`;
}

function renderPrizesSection(p: CatalogFormPayload): string {
  const radField = (field: "rad1" | "rad2" | "rad3" | "rad4", label: string): string => {
    const value = p.prizesKr[field];
    return `
      <div class="form-group">
        <label class="col-sm-3 control-label">${escapeHtml(label)} (kr)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" name="prize-${field}"
            value="${value}"
            min="0" step="1" placeholder="Premie ved ${escapeHtml(label.toLowerCase())}">
        </div>
      </div>`;
  };
  const bingoRow = (color: TicketColor): string => {
    const visible = p.ticketColors.includes(color);
    const value =
      p.prizesKr.bingo[color] !== undefined ? String(p.prizesKr.bingo[color]) : "";
    return `
      <div class="form-group bingo-prize-row" data-color="${color}" style="${visible ? "" : "display:none"}">
        <label class="col-sm-3 control-label">Bingo — ${escapeHtml(COLOR_LABELS[color])} (kr)</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" name="bingoPrize-${color}"
            data-color="${color}"
            value="${escapeHtml(value)}"
            min="0" step="1" placeholder="Premie pr. valgt farge">
        </div>
      </div>`;
  };

  // Mode-radio: switch between auto-multiplikator (default) og spesialpris.
  const modeRadios = PRIZE_MULTIPLIER_MODE_VALUES.map(
    (mode) => `
      <label class="radio-inline" style="margin-right:16px">
        <input type="radio" name="prizeMultiplierMode" value="${mode}"
          data-mode="${mode}"
          ${p.prizeMultiplierMode === mode ? "checked" : ""}>
        ${escapeHtml(PRIZE_MODE_LABELS[mode])}
      </label>`,
  ).join("");

  const isAuto = p.prizeMultiplierMode === "auto";

  // Auto-modus: én bingoBase + preview-tabell
  const autoBingoBlock = `
    <div class="form-group prize-auto-block" style="${isAuto ? "" : "display:none"}">
      <label class="col-sm-3 control-label">Bingo base (kr)</label>
      <div class="col-sm-9">
        <input type="number" class="form-control" name="prize-bingoBase"
          value="${p.prizesKr.bingoBase}"
          min="0" step="1" placeholder="Base for billigste bong (5 kr)">
        <p class="help-block">
          Gjelder billigste bong (5 kr). Backend regner premie for dyrere
          bonger som <code>base × (pris / 5 kr)</code>.
        </p>
      </div>
    </div>
    <div class="form-group prize-auto-preview" style="${isAuto ? "" : "display:none"}">
      <label class="col-sm-3 control-label">Forhåndsvisning</label>
      <div class="col-sm-9">
        <table class="table table-condensed table-bordered" style="margin-bottom:0;max-width:520px"
               id="cat-prize-preview"
               aria-label="Forhåndsvisning av auto-multiplikator">
          <thead>
            <tr>
              <th>Bongfarge</th>
              <th>Pris</th>
              <th>Multiplikator</th>
              <th>Bingo-premie</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  // Explicit-modus: per-bongfarge bingo-felter (gammel shape)
  const explicitBingoBlock = `
    <div class="prize-explicit-block" style="${isAuto ? "display:none" : ""}">
      <p class="help-block" style="padding-left:25%">Bingo (fullt hus) per bongfarge — flat pris fra dette skjemaet:</p>
      ${TICKET_COLOR_VALUES.map(bingoRow).join("")}
    </div>`;

  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">4. Premier (kr)</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Premie-modus</label>
        <div class="col-sm-9">
          ${modeRadios}
          <p class="help-block">
            Auto-multiplikator (anbefalt for hovedspill): én base som
            multipliseres opp etter bong-pris. Spesialpris: eksplisitt per
            bongfarge — bruk dette for Trafikklys og lignende spesialspill.
          </p>
        </div>
      </div>
      ${radField("rad1", "Rad 1")}
      ${radField("rad2", "Rad 2")}
      ${radField("rad3", "Rad 3")}
      ${radField("rad4", "Rad 4")}
      ${autoBingoBlock}
      ${explicitBingoBlock}
    </fieldset>`;
}

function renderBonusSection(p: CatalogFormPayload): string {
  const opts = BONUS_GAME_SLUG_VALUES.map(
    (slug) =>
      `<option value="${slug}"${p.bonusGameSlug === slug ? " selected" : ""}>${escapeHtml(BONUS_LABELS[slug])}</option>`,
  ).join("");
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">5. Bonus-spill (ved fullt hus)</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Aktiver bonus-spill</label>
        <div class="col-sm-9">
          <label class="switch">
            <input type="checkbox" id="cat-bonusEnabled"${p.bonusGameEnabled ? " checked" : ""}>
            <span class="slider round"></span>
          </label>
        </div>
      </div>
      <div class="form-group bonus-slug-row" style="${p.bonusGameEnabled ? "" : "display:none"}">
        <label class="col-sm-3 control-label" for="cat-bonusSlug">Velg bonus-spill</label>
        <div class="col-sm-9">
          <select class="form-control" id="cat-bonusSlug">
            <option value="">—</option>
            ${opts}
          </select>
        </div>
      </div>
    </fieldset>`;
}

function renderSpecialSection(p: CatalogFormPayload): string {
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">6. Spesial</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Krever jackpot-setup ved start</label>
        <div class="col-sm-9">
          <label class="switch">
            <input type="checkbox" id="cat-requiresJackpotSetup"${p.requiresJackpotSetup ? " checked" : ""}>
            <span class="slider round"></span>
          </label>
          <p class="help-block" style="margin-top:8px">
            Hvis på: master-agenten får popup ved start for å sette trekk og jackpot-premier per bongfarge.
          </p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="cat-sortOrder">Sortering</label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="cat-sortOrder" name="sortOrder"
            value="${p.sortOrder}" min="0" step="1" style="max-width:120px">
          <p class="help-block">Lavere tall = vises først i lister/dropdowns.</p>
        </div>
      </div>
    </fieldset>`;
}

function wireForm(
  container: HTMLElement,
  initial: CatalogFormPayload,
  existingId: string | null,
): void {
  const form = container.querySelector<HTMLFormElement>("#game-catalog-form");
  if (!form) return;

  // Toggle ticket-color rows when checkboxes change
  const colorCheckboxes = form.querySelectorAll<HTMLInputElement>(
    'input[name="ticketColor"]',
  );
  colorCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      const color = cb.dataset.color as TicketColor;
      const checked = cb.checked;
      const priceRow = form.querySelector<HTMLElement>(
        `.ticket-price-row[data-color="${color}"]`,
      );
      const bingoRow = form.querySelector<HTMLElement>(
        `.bingo-prize-row[data-color="${color}"]`,
      );
      if (priceRow) priceRow.style.display = checked ? "" : "none";
      if (bingoRow) bingoRow.style.display = checked ? "" : "none";
      // Auto-modus preview re-rendres når aktive farger endres
      renderAutoPreview(form);
      // Oddsen-preview re-rendres når aktive farger endres
      renderOddsenPreview(form);
    });
  });

  // Toggle bonus-slug row
  const bonusEnabled = form.querySelector<HTMLInputElement>("#cat-bonusEnabled");
  const bonusRow = form.querySelector<HTMLElement>(".bonus-slug-row");
  bonusEnabled?.addEventListener("change", () => {
    if (bonusRow) bonusRow.style.display = bonusEnabled.checked ? "" : "none";
  });

  // Prize-mode-radio: switch synlighet på auto vs explicit blokker
  const modeRadios = form.querySelectorAll<HTMLInputElement>(
    'input[name="prizeMultiplierMode"]',
  );
  const autoBlocks = form.querySelectorAll<HTMLElement>(
    ".prize-auto-block, .prize-auto-preview",
  );
  const explicitBlock = form.querySelector<HTMLElement>(".prize-explicit-block");
  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const isAuto = radio.value === "auto";
      autoBlocks.forEach((el) => {
        el.style.display = isAuto ? "" : "none";
      });
      if (explicitBlock) explicitBlock.style.display = isAuto ? "none" : "";
      if (isAuto) renderAutoPreview(form);
    });
  });

  // Live-preview: oppdater når bingoBase endres eller bong-pris endres
  const bingoBaseEl = form.querySelector<HTMLInputElement>(
    'input[name="prize-bingoBase"]',
  );
  bingoBaseEl?.addEventListener("input", () => renderAutoPreview(form));
  const priceInputs = form.querySelectorAll<HTMLInputElement>(
    'input[name^="ticketPrice-"]',
  );
  priceInputs.forEach((el) => {
    el.addEventListener("input", () => renderAutoPreview(form));
  });

  // Initial auto-preview-render
  renderAutoPreview(form);

  // Variant-radio: viser/skjuler standard vs spesial-blokker
  const variantRadios = form.querySelectorAll<HTMLInputElement>(
    'input[name="gameVariant"]',
  );
  variantRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      applyVariantVisibility(form, radio.value as GameVariant);
      if ((radio.value as GameVariant) === "oddsen") {
        renderOddsenPreview(form);
      }
    });
  });

  // Trafikklys rad-farge-chips: viser/skjuler enkelt-rader
  const rcCheckboxes = form.querySelectorAll<HTMLInputElement>(
    'input[name="trafikklysRowColor"]',
  );
  rcCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      const rc = cb.dataset.rowColor as TrafikklysRowColor;
      const visible = cb.checked;
      const prizeRow = form.querySelector<HTMLElement>(
        `.trafikklys-prize-row[data-row-color="${rc}"]`,
      );
      const bingoRow = form.querySelector<HTMLElement>(
        `.trafikklys-bingo-row[data-row-color="${rc}"]`,
      );
      if (prizeRow) prizeRow.style.display = visible ? "" : "none";
      if (bingoRow) bingoRow.style.display = visible ? "" : "none";
    });
  });

  // Oddsen live-preview: når base-input eller priser endres, re-rendre
  const oddsenInputs = form.querySelectorAll<HTMLInputElement>(
    'input[name="oddsenBingoBaseLow"], input[name="oddsenBingoBaseHigh"], input[name^="ticketPrice-"]',
  );
  oddsenInputs.forEach((el) => {
    el.addEventListener("input", () => renderOddsenPreview(form));
  });

  // Initial preview-render (oddsen)
  renderOddsenPreview(form);

  // Apply initial visibility for the loaded variant
  applyVariantVisibility(form, initial.gameVariant);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, initial, existingId);
  });
}

/**
 * Tegn auto-multiplikator-forhåndsvisning. Leser bingoBase + aktive farger
 * + per-farge ticket-pris, regner ut multiplikator og skriver tabell-rader.
 */
function renderAutoPreview(form: HTMLFormElement): void {
  const tbody = form.querySelector<HTMLTableSectionElement>(
    "#cat-prize-preview tbody",
  );
  if (!tbody) return;
  const baseEl = form.querySelector<HTMLInputElement>(
    'input[name="prize-bingoBase"]',
  );
  const baseKr = Number(baseEl?.value ?? 0);
  const baseCents = Number.isFinite(baseKr) ? Math.round(baseKr * 100) : 0;
  const activeColors: TicketColor[] = [];
  for (const color of TICKET_COLOR_VALUES) {
    const cb = form.querySelector<HTMLInputElement>(
      `input[name="ticketColor"][value="${color}"]`,
    );
    if (cb?.checked) activeColors.push(color);
  }
  const rows: string[] = [];
  for (const color of activeColors) {
    const priceEl = form.querySelector<HTMLInputElement>(
      `input[name="ticketPrice-${color}"]`,
    );
    const priceKr = Number(priceEl?.value ?? 0);
    const priceCents = Number.isFinite(priceKr) ? Math.round(priceKr * 100) : 0;
    if (priceCents <= 0 || baseCents <= 0) {
      rows.push(`
        <tr>
          <td>${escapeHtml(COLOR_LABELS[color])}</td>
          <td>${priceCents > 0 ? priceKr + " kr" : "—"}</td>
          <td>—</td>
          <td>—</td>
        </tr>`);
      continue;
    }
    const multiplier = priceCents / CHEAPEST_PRICE_CENTS;
    const actualCents = Math.round(baseCents * multiplier);
    const actualKr = actualCents / 100;
    rows.push(`
      <tr>
        <td>${escapeHtml(COLOR_LABELS[color])}</td>
        <td>${priceKr} kr</td>
        <td>×${multiplier % 1 === 0 ? multiplier : multiplier.toFixed(2)}</td>
        <td><strong>${actualKr} kr</strong></td>
      </tr>`);
  }
  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-muted text-center">Velg bongfarger for forhåndsvisning</td>
      </tr>`;
  } else {
    tbody.innerHTML = rows.join("");
  }
}

/**
 * Vis/skjul seksjoner basert på valgt variant.
 *
 * - `standard`: vis standard pris-pr-farge + premier-pr-farge; skjul spesial-felter
 * - `trafikklys`: skjul standard pris-pr-farge fieldset + bingo-rader; vis trafikklys-blokker
 * - `oddsen`: vis standard pris-pr-farge (Oddsen bruker dem), skjul standard
 *   bingo-rader (Oddsen overskriver bingo via rules), vis oddsen-fieldset
 */
function applyVariantVisibility(form: HTMLFormElement, variant: GameVariant): void {
  const isTrafikklys = variant === "trafikklys";
  const isOddsen = variant === "oddsen";

  // Standard pris-pr-farge-fieldset — finn via .ticket-price-row.closest("fieldset").
  // For Trafikklys skjules hele seksjonen siden flat-pris brukes i stedet.
  const ticketPriceRow0 = form.querySelector<HTMLElement>(".ticket-price-row");
  const standardPricesField = ticketPriceRow0?.closest("fieldset") ?? null;
  if (standardPricesField) {
    (standardPricesField as HTMLElement).style.display = isTrafikklys
      ? "none"
      : "";
  }

  // Standard bingo-pris-rader. For Trafikklys og Oddsen skjules de helt
  // (bingo-premier styres via rules-blob i stedet).
  const bingoRows = form.querySelectorAll<HTMLElement>(".bingo-prize-row");
  bingoRows.forEach((row) => {
    if (isTrafikklys || isOddsen) {
      row.style.display = "none";
    } else {
      const color = row.dataset.color as TicketColor | undefined;
      if (!color) return;
      const cb = form.querySelector<HTMLInputElement>(
        `input[name="ticketColor"][value="${color}"]`,
      );
      row.style.display = cb?.checked ? "" : "none";
    }
  });

  // Spesial-fieldsets
  const trafikklysFlat = form.querySelector<HTMLElement>(
    ".cat-trafikklys-flat-price",
  );
  if (trafikklysFlat) trafikklysFlat.style.display = isTrafikklys ? "" : "none";
  const trafikklysPrizes = form.querySelector<HTMLElement>(
    ".cat-trafikklys-prizes",
  );
  if (trafikklysPrizes) trafikklysPrizes.style.display = isTrafikklys ? "" : "none";
  const oddsen = form.querySelector<HTMLElement>(".cat-oddsen");
  if (oddsen) oddsen.style.display = isOddsen ? "" : "none";
}

/**
 * Tegn oddsen-preview-tabell. Leser bingoBaseLow/High + per-farge ticket-pris,
 * regner ut multiplikator (pris / 5 kr) og tegner per-farge low/high.
 */
function renderOddsenPreview(form: HTMLFormElement): void {
  const tbody = form.querySelector<HTMLTableSectionElement>(
    "#cat-oddsen-preview tbody",
  );
  if (!tbody) return;

  const lowEl = form.querySelector<HTMLInputElement>(
    'input[name="oddsenBingoBaseLow"]',
  );
  const highEl = form.querySelector<HTMLInputElement>(
    'input[name="oddsenBingoBaseHigh"]',
  );
  const lowKr = Number(lowEl?.value ?? 0);
  const highKr = Number(highEl?.value ?? 0);

  const activeColors: TicketColor[] = [];
  for (const color of TICKET_COLOR_VALUES) {
    const cb = form.querySelector<HTMLInputElement>(
      `input[name="ticketColor"][value="${color}"]`,
    );
    if (cb?.checked) activeColors.push(color);
  }

  const rows: string[] = [];
  for (const color of activeColors) {
    const priceEl = form.querySelector<HTMLInputElement>(
      `input[name="ticketPrice-${color}"]`,
    );
    const priceKr = Number(priceEl?.value ?? 0);
    if (!Number.isFinite(priceKr) || priceKr <= 0) {
      rows.push(`
        <tr>
          <td>${escapeHtml(COLOR_LABELS[color])}</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>`);
      continue;
    }
    const multiplier = priceKr / ODDSEN_CHEAPEST_PRICE_KR;
    const lowOut = Number.isFinite(lowKr) && lowKr > 0
      ? Math.round(lowKr * multiplier)
      : 0;
    const highOut = Number.isFinite(highKr) && highKr > 0
      ? Math.round(highKr * multiplier)
      : 0;
    rows.push(`
      <tr>
        <td>${escapeHtml(COLOR_LABELS[color])}</td>
        <td>${priceKr} kr</td>
        <td>×${multiplier % 1 === 0 ? multiplier : multiplier.toFixed(2)}</td>
        <td>${lowOut > 0 ? `<strong>${lowOut} kr</strong>` : "—"}</td>
        <td>${highOut > 0 ? `<strong>${highOut} kr</strong>` : "—"}</td>
      </tr>`);
  }
  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-muted text-center">Velg bongfarger for forhåndsvisning</td>
      </tr>`;
  } else {
    tbody.innerHTML = rows.join("");
  }
}

function readForm(form: HTMLFormElement): CatalogFormPayload | null {
  const slugEl = form.querySelector<HTMLInputElement>("#cat-slug");
  const displayNameEl = form.querySelector<HTMLInputElement>("#cat-displayName");
  const descriptionEl = form.querySelector<HTMLTextAreaElement>("#cat-description");
  const isActiveEl = form.querySelector<HTMLInputElement>("#cat-isActive");
  const bonusEnabledEl = form.querySelector<HTMLInputElement>("#cat-bonusEnabled");
  const bonusSlugEl = form.querySelector<HTMLSelectElement>("#cat-bonusSlug");
  const jackpotEl = form.querySelector<HTMLInputElement>(
    "#cat-requiresJackpotSetup",
  );
  const sortOrderEl = form.querySelector<HTMLInputElement>("#cat-sortOrder");

  const slug = (slugEl?.value ?? "").trim();
  const displayName = (displayNameEl?.value ?? "").trim();
  const description = (descriptionEl?.value ?? "").trim();
  const isActive = isActiveEl?.checked ?? true;
  const bonusGameEnabled = bonusEnabledEl?.checked ?? false;
  const requiresJackpotSetup = jackpotEl?.checked ?? false;
  const sortOrder = Number(sortOrderEl?.value ?? 0);

  if (!slug) {
    Toast.error("Slug er påkrevd.");
    return null;
  }
  if (!displayName) {
    Toast.error("Navn er påkrevd.");
    return null;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    Toast.error("Slug må være lowercase, alfanumerisk eller bindestrek.");
    return null;
  }

  // Variant (default standard)
  const variantRadio = form.querySelector<HTMLInputElement>(
    'input[name="gameVariant"]:checked',
  );
  const gameVariant: GameVariant =
    (variantRadio?.value as GameVariant) ?? "standard";

  // Ticket colors
  const colorCbs = form.querySelectorAll<HTMLInputElement>(
    'input[name="ticketColor"]:checked',
  );
  const ticketColors = Array.from(colorCbs)
    .map((cb) => cb.value as TicketColor)
    .filter((c) => TICKET_COLOR_VALUES.includes(c));
  if (ticketColors.length === 0) {
    Toast.error("Velg minst én bongfarge.");
    return null;
  }

  // Ticket prices — for Trafikklys leser vi flat-pris og fanner ut til alle farger
  const ticketPricesKr: Partial<Record<TicketColor, number>> = {};
  if (gameVariant === "trafikklys") {
    const flatEl = form.querySelector<HTMLInputElement>(
      'input[name="trafikklysTicketPrice"]',
    );
    const flat = Number(flatEl?.value ?? 0);
    if (!Number.isFinite(flat) || flat <= 0) {
      Toast.error("Trafikklys-pris må være > 0.");
      return null;
    }
    for (const color of ticketColors) {
      ticketPricesKr[color] = flat;
    }
  } else {
    for (const color of ticketColors) {
      const el = form.querySelector<HTMLInputElement>(
        `input[name="ticketPrice-${color}"]`,
      );
      const v = Number(el?.value ?? 0);
      if (!Number.isFinite(v) || v <= 0) {
        Toast.error(`Pris for ${COLOR_LABELS[color]} må være > 0.`);
        return null;
      }
      ticketPricesKr[color] = v;
    }
  }

  // Prize-mode (Tobias 2026-05-07)
  const modeRadio = form.querySelector<HTMLInputElement>(
    'input[name="prizeMultiplierMode"]:checked',
  );
  const prizeMultiplierMode: PrizeMultiplierMode =
    modeRadio?.value === "explicit_per_color" ? "explicit_per_color" : "auto";

  // Standard rad-premier (alle varianter — Oddsen og Trafikklys overrider
  // bare bingo-delen via rules-blob)
  const radNum = (field: string): number => {
    const el = form.querySelector<HTMLInputElement>(`input[name="prize-${field}"]`);
    const n = Number(el?.value ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const prizesKr = {
    rad1: radNum("rad1"),
    rad2: radNum("rad2"),
    rad3: radNum("rad3"),
    rad4: radNum("rad4"),
    bingoBase: 0,
    bingo: {} as Partial<Record<TicketColor, number>>,
  };

  // Bingo-premie-håndtering avhenger av variant.
  // - Standard: prize-mode (auto/explicit) styrer hvordan bingo leses.
  // - Trafikklys/Oddsen: fallback-tall (1) per farge — bingo styres via
  //   rules-blob på backend.
  if (gameVariant === "standard") {
    if (prizeMultiplierMode === "auto") {
      // Auto-modus: én base — bingoBase. Per-farge bingo regnes ut backend.
      const baseEl = form.querySelector<HTMLInputElement>(
        'input[name="prize-bingoBase"]',
      );
      const v = Number(baseEl?.value ?? 0);
      if (!Number.isFinite(v) || v <= 0) {
        Toast.error("Bingo base må være > 0 i auto-multiplikator-modus.");
        return null;
      }
      prizesKr.bingoBase = v;
    } else {
      // Explicit-modus: per-bongfarge bingo (Trafikklys-stil)
      for (const color of ticketColors) {
        const el = form.querySelector<HTMLInputElement>(
          `input[name="bingoPrize-${color}"]`,
        );
        const v = Number(el?.value ?? 0);
        if (!Number.isFinite(v) || v <= 0) {
          Toast.error(`Bingo-premie for ${COLOR_LABELS[color]} må være > 0.`);
          return null;
        }
        prizesKr.bingo[color] = v;
      }
    }
  } else {
    // Spesial-varianter (Trafikklys/Oddsen): fallback-tall, backend bruker rules-blob
    for (const color of ticketColors) {
      prizesKr.bingo[color] = 1;
    }
  }

  // Trafikklys-spesifikke felter
  let trafikklys: CatalogFormPayload["trafikklys"];
  if (gameVariant === "trafikklys") {
    const flatEl = form.querySelector<HTMLInputElement>(
      'input[name="trafikklysTicketPrice"]',
    );
    const ticketPriceKr = Number(flatEl?.value ?? 0);
    const rcCbs = form.querySelectorAll<HTMLInputElement>(
      'input[name="trafikklysRowColor"]:checked',
    );
    const rowColors = Array.from(rcCbs)
      .map((cb) => cb.value as TrafikklysRowColor)
      .filter((c): c is TrafikklysRowColor =>
        (TRAFIKKLYS_ROW_COLORS as readonly string[]).includes(c),
      );
    if (rowColors.length === 0) {
      Toast.error("Velg minst én rad-farge for Trafikklys.");
      return null;
    }
    const prizesPerRowColorKr: Partial<Record<TrafikklysRowColor, number>> = {};
    const bingoPerRowColorKr: Partial<Record<TrafikklysRowColor, number>> = {};
    for (const rc of rowColors) {
      const prizeEl = form.querySelector<HTMLInputElement>(
        `input[name="trafikklysPrize-${rc}"]`,
      );
      const bingoEl = form.querySelector<HTMLInputElement>(
        `input[name="trafikklysBingo-${rc}"]`,
      );
      const prizeV = Number(prizeEl?.value ?? 0);
      const bingoV = Number(bingoEl?.value ?? 0);
      if (!Number.isFinite(prizeV) || prizeV <= 0) {
        Toast.error(
          `Trafikklys-premie for ${TRAFIKKLYS_ROW_COLOR_LABELS[rc]} må være > 0.`,
        );
        return null;
      }
      if (!Number.isFinite(bingoV) || bingoV <= 0) {
        Toast.error(
          `Trafikklys-bingo for ${TRAFIKKLYS_ROW_COLOR_LABELS[rc]} må være > 0.`,
        );
        return null;
      }
      prizesPerRowColorKr[rc] = prizeV;
      bingoPerRowColorKr[rc] = bingoV;
    }
    trafikklys = {
      ticketPriceKr,
      rowColors,
      prizesPerRowColorKr,
      bingoPerRowColorKr,
    };
  } else {
    // Bevar siste-leste verdier hvis variant er noe annet —
    // bruker default som er trygg fallback.
    const flatEl = form.querySelector<HTMLInputElement>(
      'input[name="trafikklysTicketPrice"]',
    );
    const ticketPriceKr = Number(flatEl?.value ?? 0) || 15;
    trafikklys = {
      ticketPriceKr: ticketPriceKr > 0 ? ticketPriceKr : 15,
      rowColors: [...TRAFIKKLYS_ROW_COLORS],
      prizesPerRowColorKr: { grønn: 100, gul: 150, rød: 50 },
      bingoPerRowColorKr: { grønn: 1000, gul: 1500, rød: 500 },
    };
  }

  // Oddsen-spesifikke felter
  let oddsen: CatalogFormPayload["oddsen"];
  if (gameVariant === "oddsen") {
    const targetEl = form.querySelector<HTMLInputElement>(
      'input[name="oddsenTargetDraw"]',
    );
    const lowEl = form.querySelector<HTMLInputElement>(
      'input[name="oddsenBingoBaseLow"]',
    );
    const highEl = form.querySelector<HTMLInputElement>(
      'input[name="oddsenBingoBaseHigh"]',
    );
    const targetDraw = Number(targetEl?.value ?? 0);
    const bingoBaseLowKr = Number(lowEl?.value ?? 0);
    const bingoBaseHighKr = Number(highEl?.value ?? 0);
    if (!Number.isFinite(targetDraw) || targetDraw < 1 || targetDraw > 90) {
      Toast.error("Oddsen target-trekk må være mellom 1 og 90.");
      return null;
    }
    if (!Number.isFinite(bingoBaseLowKr) || bingoBaseLowKr <= 0) {
      Toast.error("Oddsen bingo-lav må være > 0.");
      return null;
    }
    if (!Number.isFinite(bingoBaseHighKr) || bingoBaseHighKr <= 0) {
      Toast.error("Oddsen bingo-høy må være > 0.");
      return null;
    }
    // Per-farge: regn ut via multiplikator (pris / 5 kr)
    const bingoLowPerColorKr: Partial<Record<TicketColor, number>> = {};
    const bingoHighPerColorKr: Partial<Record<TicketColor, number>> = {};
    for (const color of ticketColors) {
      const priceKr = ticketPricesKr[color] ?? 0;
      if (priceKr > 0) {
        const multiplier = priceKr / ODDSEN_CHEAPEST_PRICE_KR;
        bingoLowPerColorKr[color] = Math.round(bingoBaseLowKr * multiplier);
        bingoHighPerColorKr[color] = Math.round(bingoBaseHighKr * multiplier);
      }
    }
    oddsen = {
      targetDraw: Math.round(targetDraw),
      bingoBaseLowKr,
      bingoBaseHighKr,
      bingoLowPerColorKr,
      bingoHighPerColorKr,
    };
  } else {
    // Default fallback for non-Oddsen variants
    oddsen = {
      targetDraw: 55,
      bingoBaseLowKr: 500,
      bingoBaseHighKr: 1500,
      bingoLowPerColorKr: { hvit: 500, gul: 1000, lilla: 1500 },
      bingoHighPerColorKr: { hvit: 1500, gul: 3000, lilla: 4500 },
    };
  }

  // Bonus
  let bonusGameSlug: BonusGameSlug | null = null;
  if (bonusGameEnabled) {
    const raw = bonusSlugEl?.value ?? "";
    if (!raw) {
      Toast.error("Velg et bonus-spill når 'Aktiver bonus-spill' er på.");
      return null;
    }
    if (!BONUS_GAME_SLUG_VALUES.includes(raw as BonusGameSlug)) {
      Toast.error("Ukjent bonus-spill.");
      return null;
    }
    bonusGameSlug = raw as BonusGameSlug;
  }

  return {
    slug,
    displayName,
    description: description.length > 0 ? description : null,
    ticketColors,
    ticketPricesKr,
    prizeMultiplierMode,
    prizesKr,
    bonusGameEnabled,
    bonusGameSlug,
    requiresJackpotSetup,
    isActive,
    sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    gameVariant,
    trafikklys,
    oddsen,
  };
}

async function submitForm(
  form: HTMLFormElement,
  _initial: CatalogFormPayload,
  existingId: string | null,
): Promise<void> {
  const payload = readForm(form);
  if (!payload) return;
  const submitBtn = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await saveCatalogEntry(payload, existingId ?? undefined);
    if (result.ok) {
      Toast.success(existingId ? "Oppdatert." : "Opprettet.");
      window.location.hash = "#/games/catalog";
      return;
    }
    Toast.error(result.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
