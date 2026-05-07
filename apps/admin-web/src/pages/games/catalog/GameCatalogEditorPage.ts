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
  type CatalogFormPayload,
} from "./GameCatalogState.js";
import {
  BONUS_GAME_SLUG_VALUES,
  TICKET_COLOR_VALUES,
  type BonusGameSlug,
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
                ${renderTicketColorsSection(payload)}
                ${renderTicketPricesSection(payload)}
                ${renderPrizesSection(payload)}
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
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">4. Premier (kr)</legend>
      ${radField("rad1", "Rad 1")}
      ${radField("rad2", "Rad 2")}
      ${radField("rad3", "Rad 3")}
      ${radField("rad4", "Rad 4")}
      <p class="help-block" style="padding-left:25%">Bingo (fullt hus) varierer per bongfarge:</p>
      ${TICKET_COLOR_VALUES.map(bingoRow).join("")}
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
    });
  });

  // Toggle bonus-slug row
  const bonusEnabled = form.querySelector<HTMLInputElement>("#cat-bonusEnabled");
  const bonusRow = form.querySelector<HTMLElement>(".bonus-slug-row");
  bonusEnabled?.addEventListener("change", () => {
    if (bonusRow) bonusRow.style.display = bonusEnabled.checked ? "" : "none";
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, initial, existingId);
  });
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

  // Ticket prices (kun for valgte farger)
  const ticketPricesKr: Partial<Record<TicketColor, number>> = {};
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

  // Prizes
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
    bingo: {} as Partial<Record<TicketColor, number>>,
  };
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
    prizesKr,
    bonusGameEnabled,
    bonusGameSlug,
    requiresJackpotSetup,
    isActive,
    sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
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
