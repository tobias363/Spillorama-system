/**
 * Spill 3 (Monsterbingo) admin-konfigurasjon — Tobias-direktiv 2026-05-08.
 *
 * Route: /admin/#/games/spill3-config
 *
 * Form-felter:
 *   - Åpningstid (start + slutt, HH:MM)
 *   - Min antall bonger før spillet starter (heltall)
 *   - Bong-pris (kr) — vises som kr i UI, lagres som øre
 *   - Pause mellom rader (sek) — vises som sek i UI, lagres som ms
 *   - Premie-modus (radio: fast / prosent)
 *   - Premier per fase (Rad 1-4 + Fullt Hus) — kr eller %, conditional
 *
 * Backend:
 *   GET /api/admin/spill3/config
 *   PUT /api/admin/spill3/config (partial patch)
 *
 * Engine-integrasjon:
 *   `Spill3ConfigService.update` invaliderer service-cache (5s TTL); ny
 *   konfig slår inn på neste runde i det globale rommet uten restart.
 *
 * Live-preview: viser "ved X solgte bonger blir Rad 1 = Y kr" basert på
 * gjeldende prize-mode + bongpris (samme formel som
 * `calculatePhasePrizeCents` i backend).
 */

import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { t } from "../../../i18n/I18n.js";
import {
  getSpill3Config,
  updateSpill3Config,
  type Spill3Config,
  type Spill3PrizeMode,
  type UpdateSpill3ConfigInput,
} from "../../../api/admin-spill3-config.js";

/**
 * Stable fase-rekkefølge for UI + payload-bygging. Matcher
 * SPILL3_PHASE_NAMES i backend.
 */
interface PhaseSpec {
  /** UI-label */
  label: string;
  /** Stable id-suffix på <input>-felter. */
  inputId: string;
  /** Felt-suffiks i Spill3Config (Cents/Pct). */
  fieldSuffix: "Rad1" | "Rad2" | "Rad3" | "Rad4" | "FullHouse";
}

const PHASES: PhaseSpec[] = [
  { label: "Rad 1", inputId: "p1", fieldSuffix: "Rad1" },
  { label: "Rad 2", inputId: "p2", fieldSuffix: "Rad2" },
  { label: "Rad 3", inputId: "p3", fieldSuffix: "Rad3" },
  { label: "Rad 4", inputId: "p4", fieldSuffix: "Rad4" },
  { label: "Fullt Hus", inputId: "p5", fieldSuffix: "FullHouse" },
];

/** Live-preview-eksempel: hvor mange bonger som vises i preview-tabellen. */
const PREVIEW_TICKET_COUNTS: number[] = [20, 50, 100, 200];

export async function renderSpill3ConfigPage(
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = renderShell(null, false, null);
  const host = container.querySelector<HTMLElement>("#spill3-config-host");
  if (!host) return;
  host.innerHTML = `<div class="text-center" style="padding:48px"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
  try {
    const config = await getSpill3Config();
    container.innerHTML = renderShell(config, true, null);
    wireForm(container, config);
  } catch (err) {
    const msg =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Ukjent feil";
    container.innerHTML = renderShell(null, false, msg);
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderShell(
  config: Spill3Config | null,
  isLoaded: boolean,
  error: string | null,
): string {
  const heading = "Spill 3 (Monsterbingo) — global konfigurasjon";

  const errorBlock = error
    ? `<div class="alert alert-danger" style="margin:8px 16px;" data-testid="spill3-config-error">${escapeHtml(error)}</div>`
    : "";

  const body = isLoaded && config ? renderForm(config) : "";

  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(heading)}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
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
              <p class="help-block" style="margin-bottom:16px">
                Spill 3 er ETT globalt rom alltid aktivt for alle haller innenfor åpningstid.
                Endringer her gjelder for alle haller og slår inn på neste runde uten restart.
              </p>
              <div id="spill3-config-host">${body}</div>
            </div></div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderForm(config: Spill3Config): string {
  return `
    <form id="spill3-config-form" class="form-horizontal" data-testid="spill3-config-form">
      ${renderOpeningTimesSection(config)}
      ${renderBasicSection(config)}
      ${renderPrizeModeSection(config)}
      ${renderPrizesFixedSection(config)}
      ${renderPrizesPercentageSection(config)}
      ${renderPreviewSection(config)}
      <div style="padding:16px;border-top:1px solid #eee;margin-top:16px">
        <button type="submit" class="btn btn-success btn-flat" data-action="save-spill3-config" data-testid="spill3-config-save">
          <i class="fa fa-save" aria-hidden="true"></i> Lagre
        </button>
      </div>
    </form>`;
}

function renderOpeningTimesSection(config: Spill3Config): string {
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">Åpningstid</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-openingTimeStart">Starttid (HH:MM)</label>
        <div class="col-sm-3">
          <input type="time" class="form-control" id="spill3-openingTimeStart"
            name="openingTimeStart"
            value="${escapeHtml(config.openingTimeStart)}"
            data-testid="spill3-openingTimeStart-input"
            required>
        </div>
        <label class="col-sm-2 control-label" for="spill3-openingTimeEnd">Slutttid (HH:MM)</label>
        <div class="col-sm-3">
          <input type="time" class="form-control" id="spill3-openingTimeEnd"
            name="openingTimeEnd"
            value="${escapeHtml(config.openingTimeEnd)}"
            data-testid="spill3-openingTimeEnd-input"
            required>
        </div>
      </div>
      <p class="help-block" style="padding-left:25%;margin-top:0">
        Daglig vindu (Europe/Oslo) hvor nye runder kan starte. Utenfor vinduet venter rommet
        på neste åpning. Default: 11:00–23:00.
      </p>
    </fieldset>`;
}

function renderBasicSection(config: Spill3Config): string {
  const ticketPriceKr = (config.ticketPriceCents / 100).toFixed(2).replace(/\.00$/, "");
  const pauseSec = (config.pauseBetweenRowsMs / 1000).toFixed(2).replace(/\.00$/, "");
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">Grunnleggende</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-minTicketsToStart">
          Min antall bonger før start
        </label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="spill3-minTicketsToStart"
            name="minTicketsToStart"
            value="${config.minTicketsToStart}"
            min="0" max="1000" step="1" style="max-width:140px"
            data-testid="spill3-minTicketsToStart-input"
            required>
          <p class="help-block">
            Runden auto-starter når X bonger er solgt totalt. 0 = umiddelbar start.
          </p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-ticketPriceKr">
          Bong-pris (kr)
        </label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="spill3-ticketPriceKr"
            name="ticketPriceKr"
            value="${escapeHtml(ticketPriceKr)}"
            min="0.01" step="0.01" style="max-width:140px"
            data-testid="spill3-ticketPriceKr-input"
            required>
          <p class="help-block">Kun én bong-type. Default 5 kr.</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-pauseSec">
          Pause mellom rader (sekunder)
        </label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="spill3-pauseSec"
            name="pauseSec"
            value="${escapeHtml(pauseSec)}"
            min="0" max="60" step="0.5" style="max-width:140px"
            data-testid="spill3-pauseSec-input"
            required>
          <p class="help-block">Pause før neste rad-fase trekkes (Rad 1 → 2 → 3 → 4 → Fullt Hus). Default 3 sek.</p>
        </div>
      </div>
    </fieldset>`;
}

function renderPrizeModeSection(config: Spill3Config): string {
  const isFixed = config.prizeMode === "fixed";
  const isPct = config.prizeMode === "percentage";
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px"
              id="spill3-prizeMode-fieldset">
      <legend style="font-size:14px;width:auto;padding:0 8px">Premie-modus</legend>
      <div class="form-group">
        <label class="col-sm-3 control-label">Modus</label>
        <div class="col-sm-9">
          <label class="radio-inline" style="margin-right:16px">
            <input type="radio" name="prizeMode" value="fixed"
              data-testid="spill3-prizeMode-fixed"
              data-mode="fixed"${isFixed ? " checked" : ""}>
            Fast (kr per fase, uavhengig av omsetning)
          </label>
          <label class="radio-inline" style="margin-right:16px">
            <input type="radio" name="prizeMode" value="percentage"
              data-testid="spill3-prizeMode-percentage"
              data-mode="percentage"${isPct ? " checked" : ""}>
            Prosent (av total bong-omsetning for runden)
          </label>
        </div>
      </div>
    </fieldset>`;
}

function renderPrizesFixedSection(config: Spill3Config): string {
  const visible = config.prizeMode === "fixed";
  const row = (phase: PhaseSpec): string => {
    const cents = (config[`prize${phase.fieldSuffix}Cents`] as number | null) ?? 0;
    const kr = (cents / 100).toFixed(2).replace(/\.00$/, "");
    return `
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-fixed-${phase.inputId}">
          ${escapeHtml(phase.label)} (kr)
        </label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="spill3-fixed-${phase.inputId}"
            name="fixed-${phase.inputId}"
            data-testid="spill3-fixed-${phase.inputId}-input"
            value="${escapeHtml(kr)}"
            min="0" step="1" style="max-width:140px">
        </div>
      </div>`;
  };
  return `
    <fieldset class="spill3-prizes-fixed"
              style="border:1px solid #ddd;padding:12px;margin-bottom:16px;${visible ? "" : "display:none"}">
      <legend style="font-size:14px;width:auto;padding:0 8px">Faste premier (kr)</legend>
      ${PHASES.map(row).join("")}
    </fieldset>`;
}

function renderPrizesPercentageSection(config: Spill3Config): string {
  const visible = config.prizeMode === "percentage";
  const row = (phase: PhaseSpec): string => {
    const pct = (config[`prize${phase.fieldSuffix}Pct`] as number | null) ?? 0;
    return `
      <div class="form-group">
        <label class="col-sm-3 control-label" for="spill3-pct-${phase.inputId}">
          ${escapeHtml(phase.label)} (%)
        </label>
        <div class="col-sm-9">
          <input type="number" class="form-control" id="spill3-pct-${phase.inputId}"
            name="pct-${phase.inputId}"
            data-testid="spill3-pct-${phase.inputId}-input"
            value="${pct}"
            min="0" max="100" step="0.5" style="max-width:140px">
        </div>
      </div>`;
  };
  return `
    <fieldset class="spill3-prizes-percentage"
              style="border:1px solid #ddd;padding:12px;margin-bottom:16px;${visible ? "" : "display:none"}">
      <legend style="font-size:14px;width:auto;padding:0 8px">Prosent-premier (% av runde-omsetning)</legend>
      ${PHASES.map(row).join("")}
      <p class="help-block" style="padding-left:25%;margin-top:8px"
         data-testid="spill3-pct-sum-hint">
        Sum av prosenter må være ≤ 100%. Resten (over 100%) går ikke til premier.
      </p>
    </fieldset>`;
}

function renderPreviewSection(_config: Spill3Config): string {
  return `
    <fieldset style="border:1px solid #ddd;padding:12px;margin-bottom:16px">
      <legend style="font-size:14px;width:auto;padding:0 8px">Forhåndsvisning</legend>
      <p class="help-block">Eksempel-utbetaling per fase ved gitt antall solgte bonger:</p>
      <table class="table table-condensed table-bordered" style="max-width:640px"
             data-testid="spill3-preview-table">
        <thead>
          <tr>
            <th>Solgte bonger</th>
            ${PHASES.map((p) => `<th>${escapeHtml(p.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody id="spill3-preview-tbody"></tbody>
      </table>
    </fieldset>`;
}

// ── Wiring ─────────────────────────────────────────────────────────────────

function wireForm(container: HTMLElement, initial: Spill3Config): void {
  const form = container.querySelector<HTMLFormElement>("#spill3-config-form");
  if (!form) return;

  // Toggle prize-mode-sektioner ved radio-endring.
  form.querySelectorAll<HTMLInputElement>('input[name="prizeMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = radio.value as Spill3PrizeMode;
      const fixedSection = container.querySelector<HTMLElement>(".spill3-prizes-fixed");
      const pctSection = container.querySelector<HTMLElement>(".spill3-prizes-percentage");
      if (fixedSection) fixedSection.style.display = mode === "fixed" ? "" : "none";
      if (pctSection) pctSection.style.display = mode === "percentage" ? "" : "none";
      refreshPreview(form);
    });
  });

  // Live-preview ved input-endring.
  form.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.addEventListener("input", () => refreshPreview(form));
  });

  refreshPreview(form);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, initial);
  });
}

/**
 * Bygg en delvis Spill3Config-snapshot fra DOM (kun feltene som vises i
 * gjeldende mode) og oppdater preview-tabellen. Brukes både for første
 * render og ved hver input-endring.
 */
function refreshPreview(form: HTMLFormElement): void {
  const tbody = form.querySelector<HTMLTableSectionElement>("#spill3-preview-tbody");
  if (!tbody) return;
  const ticketPriceKr = parseFloat(
    (form.querySelector<HTMLInputElement>("#spill3-ticketPriceKr")?.value ?? "0").replace(",", "."),
  );
  const ticketPriceCents = Math.round((Number.isFinite(ticketPriceKr) ? ticketPriceKr : 0) * 100);
  const mode =
    (form.querySelector<HTMLInputElement>('input[name="prizeMode"]:checked')?.value as Spill3PrizeMode) ??
    "percentage";

  const phaseValues = PHASES.map((phase) => {
    if (mode === "fixed") {
      const raw = form.querySelector<HTMLInputElement>(`#spill3-fixed-${phase.inputId}`)?.value ?? "0";
      const kr = parseFloat(raw.replace(",", "."));
      return { fixedCents: Math.round((Number.isFinite(kr) ? kr : 0) * 100), pct: 0 };
    }
    const raw = form.querySelector<HTMLInputElement>(`#spill3-pct-${phase.inputId}`)?.value ?? "0";
    const pct = parseFloat(raw.replace(",", "."));
    return { fixedCents: 0, pct: Number.isFinite(pct) ? pct : 0 };
  });

  // Sum av prosenter (sanity-hint, vises som tekst i pct-sum-hint).
  const pctSum = phaseValues.reduce((s, v) => s + v.pct, 0);
  const sumHint = form.querySelector<HTMLElement>('[data-testid="spill3-pct-sum-hint"]');
  if (sumHint && mode === "percentage") {
    const formattedSum = pctSum.toFixed(1).replace(/\.0$/, "");
    sumHint.textContent = `Sum: ${formattedSum}% — må være ≤ 100% (resten går ikke til premier).`;
    sumHint.style.color = pctSum > 100 ? "#d9534f" : "";
  }

  // Bygg preview-rader.
  const rows = PREVIEW_TICKET_COUNTS.map((count) => {
    const totalSoldCents = count * ticketPriceCents;
    const cells = phaseValues.map((v) => {
      const cents = mode === "fixed" ? v.fixedCents : Math.floor((totalSoldCents * v.pct) / 100);
      const kr = (cents / 100).toFixed(0);
      return `<td data-testid="preview-${count}">${escapeHtml(kr)} kr</td>`;
    });
    return `<tr><th>${count}</th>${cells.join("")}</tr>`;
  });
  tbody.innerHTML = rows.join("");
}

async function submitForm(
  form: HTMLFormElement,
  before: Spill3Config,
): Promise<void> {
  const patch: UpdateSpill3ConfigInput = {};

  // Åpningstider — sendes alltid hvis endret.
  const startInput = form.querySelector<HTMLInputElement>("#spill3-openingTimeStart");
  const endInput = form.querySelector<HTMLInputElement>("#spill3-openingTimeEnd");
  const start = startInput?.value.trim() ?? "";
  const end = endInput?.value.trim() ?? "";
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(start)) {
    Toast.error("Starttid må være på formatet HH:MM (24t).");
    return;
  }
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(end)) {
    Toast.error("Slutttid må være på formatet HH:MM (24t).");
    return;
  }
  if (start >= end) {
    Toast.error("Starttid må være før slutttid (samme dag).");
    return;
  }
  if (start !== before.openingTimeStart) patch.openingTimeStart = start;
  if (end !== before.openingTimeEnd) patch.openingTimeEnd = end;

  // minTicketsToStart
  const minT = parseIntInput(form, "#spill3-minTicketsToStart");
  if (minT === null || minT < 0 || minT > 1000) {
    Toast.error("Min antall bonger må være et heltall mellom 0 og 1000.");
    return;
  }
  if (minT !== before.minTicketsToStart) patch.minTicketsToStart = minT;

  // ticketPriceCents (input i kr)
  const ticketPriceKr = parseFloatInput(form, "#spill3-ticketPriceKr");
  if (ticketPriceKr === null || ticketPriceKr <= 0 || ticketPriceKr > 1000) {
    Toast.error("Bong-pris må være > 0 kr og ≤ 1000 kr.");
    return;
  }
  const ticketPriceCents = Math.round(ticketPriceKr * 100);
  if (ticketPriceCents !== before.ticketPriceCents) patch.ticketPriceCents = ticketPriceCents;

  // pauseSec → ms
  const pauseSec = parseFloatInput(form, "#spill3-pauseSec");
  if (pauseSec === null || pauseSec < 0 || pauseSec > 60) {
    Toast.error("Pause mellom rader må være 0-60 sekunder.");
    return;
  }
  const pauseMs = Math.round(pauseSec * 1000);
  if (pauseMs !== before.pauseBetweenRowsMs) patch.pauseBetweenRowsMs = pauseMs;

  // Prize-mode + per-fase-felter
  const modeInput = form.querySelector<HTMLInputElement>('input[name="prizeMode"]:checked');
  const mode = (modeInput?.value as Spill3PrizeMode) ?? before.prizeMode;
  if (mode !== before.prizeMode) patch.prizeMode = mode;

  if (mode === "fixed") {
    for (const phase of PHASES) {
      const cents = parseFloatInput(form, `#spill3-fixed-${phase.inputId}`);
      if (cents === null || cents < 0) {
        Toast.error(`${phase.label}-premie må være ≥ 0 kr.`);
        return;
      }
      const cci = Math.round(cents * 100);
      const beforeCents = (before[`prize${phase.fieldSuffix}Cents`] as number | null) ?? 0;
      // Send alltid alle 5 fixed-cents når mode er fixed (selv om beforeMode
      // var percentage), for at backend-validering skal passere.
      if (cci !== beforeCents || before.prizeMode !== "fixed") {
        // Type-narrow workaround: typesystemet ser ikke sammenhengen
        // mellom suffix og felt-navn, så vi caster eksplisitt.
        (patch as Record<string, unknown>)[`prize${phase.fieldSuffix}Cents`] = cci;
      }
    }
    // Når mode bytter til fixed: sett alle pct-felter til null.
    if (before.prizeMode !== "fixed") {
      patch.prizeRad1Pct = null;
      patch.prizeRad2Pct = null;
      patch.prizeRad3Pct = null;
      patch.prizeRad4Pct = null;
      patch.prizeFullHousePct = null;
    }
  } else {
    let pctSum = 0;
    for (const phase of PHASES) {
      const pct = parseFloatInput(form, `#spill3-pct-${phase.inputId}`);
      if (pct === null || pct < 0 || pct > 100) {
        Toast.error(`${phase.label}-prosent må være 0-100.`);
        return;
      }
      pctSum += pct;
      const beforePct = (before[`prize${phase.fieldSuffix}Pct`] as number | null) ?? 0;
      if (pct !== beforePct || before.prizeMode !== "percentage") {
        (patch as Record<string, unknown>)[`prize${phase.fieldSuffix}Pct`] = pct;
      }
    }
    if (pctSum > 100) {
      Toast.error(`Sum av prosenter (${pctSum.toFixed(1)}%) må være ≤ 100%.`);
      return;
    }
    if (before.prizeMode !== "percentage") {
      patch.prizeRad1Cents = null;
      patch.prizeRad2Cents = null;
      patch.prizeRad3Cents = null;
      patch.prizeRad4Cents = null;
      patch.prizeFullHouseCents = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    Toast.info("Ingen endringer å lagre.");
    return;
  }

  try {
    const updated = await updateSpill3Config(patch);
    Toast.success("Konfigurasjon lagret. Endringer slår inn på neste runde.");
    // Re-mount med fresh state så preview-tabellen og alle inputs reflekterer
    // server-truth (i tilfelle backend normaliserer verdier).
    const container = form.closest<HTMLElement>(".page-wrapper")?.parentElement;
    if (container) {
      container.innerHTML = renderShell(updated, true, null);
      wireForm(container, updated);
    }
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : "Kunne ikke lagre konfigurasjonen.");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseIntInput(form: HTMLFormElement, selector: string): number | null {
  const input = form.querySelector<HTMLInputElement>(selector);
  if (!input) return null;
  const raw = input.value.trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function parseFloatInput(form: HTMLFormElement, selector: string): number | null {
  const input = form.querySelector<HTMLInputElement>(selector);
  if (!input) return null;
  const raw = input.value.trim().replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}
