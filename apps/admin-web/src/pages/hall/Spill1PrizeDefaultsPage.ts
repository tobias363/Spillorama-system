// HV2-B3 (Tobias 2026-04-30) — admin-UI for per-hall Spill 1
// default gevinst-floors.
//
// Route: /hall/spill1-prize-defaults/:hallId
//
// Form med 5 inputs (Rad 1, 2, 3, 4, Fullt Hus). Hentes via
// `GET /api/admin/halls/:hallId/spill1-prize-defaults`; lagres via
// `PUT /api/admin/halls/:hallId/spill1-prize-defaults` (partial update —
// kun endrete felt sendes).
//
// Validering:
//   - Hver fase: 0 ≤ verdi ≤ 2500 kr (pengespillforskriften enkelt-premie-cap).
//   - Minst én fase må endres for å aktivere "Lagre".
//
// Hjelpetekst (over hver input): "Default: X kr (per-spill kan ØKE
// men ikke senke)". Sub-variant-presets (Wheel of Fortune, Mystery,
// etc.) kan ØKE floor-en per spill, men aldri senke under hall-baseline
// — håndheving skjer i ScheduleService (HV2-B4 follow-up).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { listHalls, type AdminHall } from "../../api/admin-halls.js";
import {
  getSpill1PrizeDefaults,
  updateSpill1PrizeDefaults,
  SPILL1_MAX_PRIZE_NOK,
  type Spill1PrizeDefaults,
  type Spill1PrizeDefaultsPatch,
} from "../../api/admin-spill1-prize-defaults.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";

/**
 * Phase metadata — UI-rekkefølge, label-key, og DOM-id-suffix.
 * Stable rekkefølge så audit-trail blir lik på tvers av sessions.
 */
const PHASES = [
  { key: "phase1" as const, label: "Rad 1", inputId: "p1" },
  { key: "phase2" as const, label: "Rad 2", inputId: "p2" },
  { key: "phase3" as const, label: "Rad 3", inputId: "p3" },
  { key: "phase4" as const, label: "Rad 4", inputId: "p4" },
  { key: "phase5" as const, label: "Fullt Hus", inputId: "p5" },
];

export function renderSpill1PrizeDefaultsPage(
  container: HTMLElement,
  hallId: string,
): void {
  container.innerHTML = `
    ${contentHeader("spill1_prize_defaults_title", "hall_management")}
    <section class="content">
      ${boxOpen("spill1_prize_defaults_title", "primary")}
        <div id="spill1-prize-defaults-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#spill1-prize-defaults-host")!;
  void mount(host, hallId);
}

async function mount(host: HTMLElement, hallId: string): Promise<void> {
  // Hent hall-info + defaults parallelt for raskere første render.
  let hall: AdminHall | null = null;
  let defaults: Spill1PrizeDefaults;
  try {
    const [halls, fetched] = await Promise.all([
      listHalls({ includeInactive: true }),
      getSpill1PrizeDefaults(hallId),
    ]);
    hall = halls.find((h) => h.id === hallId || h.slug === hallId) ?? null;
    // Kopi uten hallId-feltet — det går separat i page-headeren.
    defaults = {
      phase1: fetched.phase1,
      phase2: fetched.phase2,
      phase3: fetched.phase3,
      phase4: fetched.phase4,
      phase5: fetched.phase5,
    };
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="spill1-prize-defaults-error">${escapeHtml(msg)}</div>`;
    return;
  }

  const hallLabel = hall ? hall.name : hallId;
  const helpText = t("spill1_prize_defaults_help");

  host.innerHTML = `
    <div class="callout callout-info" data-testid="spill1-prize-defaults-help">
      <p><strong>${escapeHtml(hallLabel)}</strong></p>
      <p>${escapeHtml(helpText)}</p>
    </div>
    <form id="spill1-prize-form" class="form-horizontal" data-testid="spill1-prize-form">
      ${PHASES.map((p) => renderPhaseInput(p, defaults[p.key])).join("")}
      <div class="form-group">
        <div class="col-sm-offset-3 col-sm-9">
          <button type="submit" class="btn btn-success" data-action="save-prize-defaults" data-testid="spill1-prize-save">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("save"))}
          </button>
          <a class="btn btn-default" href="#/hall" data-testid="spill1-prize-cancel">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#spill1-prize-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, hallId, defaults);
  });
}

function renderPhaseInput(
  phase: { key: keyof Spill1PrizeDefaults; label: string; inputId: string },
  currentValue: number,
): string {
  const phaseHelp = t("spill1_prize_defaults_phase_hint");
  return `
    <div class="form-group" data-testid="phase-${phase.inputId}-group">
      <label class="col-sm-3 control-label" for="${phase.inputId}">
        ${escapeHtml(phase.label)}
      </label>
      <div class="col-sm-9">
        <div class="input-group" style="max-width: 240px;">
          <input
            type="number"
            min="0"
            max="${SPILL1_MAX_PRIZE_NOK}"
            step="1"
            id="${phase.inputId}"
            name="${phase.key}"
            class="form-control"
            data-testid="phase-${phase.inputId}-input"
            value="${currentValue}"
            required
          />
          <span class="input-group-addon">kr</span>
        </div>
        <p class="help-block" data-testid="phase-${phase.inputId}-hint">
          ${escapeHtml(phaseHelp.replace("{value}", String(currentValue)))}
        </p>
      </div>
    </div>`;
}

async function submit(
  form: HTMLFormElement,
  hallId: string,
  before: Spill1PrizeDefaults,
): Promise<void> {
  const patch: Spill1PrizeDefaultsPatch = {};
  // Bygg patch fra kun de feltene som faktisk endret seg — backend audit
  // skipper events for unchanged-felt likevel, men vi sender minimum payload
  // for minst-overraskelse-prinsippet.
  for (const phase of PHASES) {
    const input = form.querySelector<HTMLInputElement>(`#${phase.inputId}`);
    if (!input) continue;
    const raw = input.value.trim();
    if (raw === "") {
      Toast.error(t("spill1_prize_defaults_required").replace("{phase}", phase.label));
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      Toast.error(t("spill1_prize_defaults_invalid").replace("{phase}", phase.label));
      return;
    }
    if (parsed > SPILL1_MAX_PRIZE_NOK) {
      Toast.error(
        t("spill1_prize_defaults_above_cap")
          .replace("{phase}", phase.label)
          .replace("{cap}", String(SPILL1_MAX_PRIZE_NOK)),
      );
      return;
    }
    if (parsed !== before[phase.key]) {
      patch[phase.key] = parsed;
    }
  }

  if (Object.keys(patch).length === 0) {
    Toast.info(t("spill1_prize_defaults_no_change"));
    return;
  }

  try {
    await updateSpill1PrizeDefaults(hallId, patch);
    Toast.success(t("success"));
    // Re-mount for å hente fresh state — admin-UI viser nye verdier
    // uten å navigere bort fra siden.
    const host = form.closest<HTMLElement>("#spill1-prize-defaults-host");
    if (host) {
      host.innerHTML = `${escapeHtml(t("loading_ellipsis"))}`;
      void mount(host, hallId);
    }
  } catch (err) {
    Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
  }
}
