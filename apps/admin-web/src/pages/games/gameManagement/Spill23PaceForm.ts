// Tobias 2026-05-04 (admin-config-round-pace): forenklet add-form for
// Spill 2 (`rocket`) og Spill 3 (`monsterbingo`). Eksponerer kun de to
// admin-konfigurerbare runde-pace-feltene som er aktuelle for perpetual-
// loop-spillene:
//   - "Pause mellom runder (sekunder)"  → config.spill{2|3}.roundPauseMs (ms)
//   - "Pause mellom baller (sekunder)"  → config.spill{2|3}.ballIntervalMs (ms)
//
// Spill 2/3 har ETT globalt rom (ROCKET / MONSTERBINGO) og perpetual auto-
// restart drevet av PerpetualRoundService + Game2/3AutoDrawTickService.
// Tidligere kunne disse pace-verdiene bare endres via env-vars
// (PERPETUAL_LOOP_DELAY_MS, AUTO_DRAW_INTERVAL_MS); admin-UI gir oss nå
// per-game overrides uten Render-deploy.
//
// Backend-validering: 1-300 sek (roundPauseMs) og 1-10 sek (ballIntervalMs).
// UI bruker sekunder for menneskelig lesbarhet, men payload til backend
// lagres som millisekunder (×1000) i config_json under spill2/spill3.
//
// Flyten erstatter "kommer senere"-placeholderet for game_2 / game_5
// i GameManagementAddForm.

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../common/escape.js";
import { saveGameManagement } from "./GameManagementState.js";
import type { GameType } from "../common/types.js";

/**
 * Min/max-grenser. Disse må holdes synkrone med backend
 * `apps/backend/src/game/variantConfig.ts` (ROUND_PAUSE_MS_MIN/MAX +
 * BALL_INTERVAL_MS_MIN/MAX). Vi duplicerer dem i UI-laget for at
 * input-attributtet `min`/`max` skal kunne brukes i stedet for å
 * importere backend-pakke direkte i frontend-bundle.
 */
const ROUND_PAUSE_SECONDS_MIN = 1;
const ROUND_PAUSE_SECONDS_MAX = 300;
const BALL_INTERVAL_SECONDS_MIN = 1;
const BALL_INTERVAL_SECONDS_MAX = 10;

/** Default-verdier i UI hvis admin oppretter helt nytt spill. */
const ROUND_PAUSE_SECONDS_DEFAULT = 30;
const BALL_INTERVAL_SECONDS_DEFAULT = 2;

/**
 * Mapper internt slug ("rocket"/"monsterbingo"/"game_2"/"game_5") til
 * config-nøkkel under config_json. Backend-binderen i roomState.ts leser
 * `config.spill2` for rocket og `config.spill3` for monsterbingo.
 */
function configSubKeyForSlug(slugOrType: string): "spill2" | "spill3" {
  const normalized = slugOrType.toLowerCase().trim();
  if (normalized === "monsterbingo" || normalized === "mønsterbingo" || normalized === "game_3") {
    return "spill3";
  }
  // game_2 / rocket / tallspill — også fallback for ukjente Spill 2-aliaser.
  return "spill2";
}

/** Hvilke gameType.type-verdier denne form-en støtter. */
export function isSpill23Variant(gt: Pick<GameType, "type"> | null | undefined): boolean {
  if (!gt) return false;
  // Backend-DB bruker "game_2" / "game_5" (legacy-navn) for gameType.type;
  // "game_5" er historisk SpinnGo. For runde-pace-formen er kun Spill 2/3
  // aktuelt — SpinnGo (player-startet) håndteres ikke her.
  return gt.type === "game_2" || gt.type === "game_3";
}

interface FormState {
  gameType: GameType;
  name: string;
  startDateIso: string;
  roundPauseSeconds: number;
  ballIntervalSeconds: number;
  submitting: boolean;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Render Add-form for Spill 2/3 i container. */
export function renderSpill23PaceAddPage(container: HTMLElement, gt: GameType): void {
  const state: FormState = {
    gameType: gt,
    name: "",
    startDateIso: todayIso(),
    roundPauseSeconds: ROUND_PAUSE_SECONDS_DEFAULT,
    ballIntervalSeconds: BALL_INTERVAL_SECONDS_DEFAULT,
    submitting: false,
  };
  container.innerHTML = renderShell(state);
  wireForm(container, state);
}

function renderShell(s: FormState): string {
  // t() returnerer alltid string (key som fallback hvis nøkkel mangler).
  const title = `${t("add_game")} — ${s.gameType.name}`;
  const backHref = `#/gameManagement?typeId=${encodeURIComponent(s.gameType._id)}`;
  return `
    <div class="page-wrapper" data-testid="gm-add-pace-root"><div class="container-fluid">
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
                <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
              </a>
            </div>
            <div class="clearfix"></div>
          </div>
          <div class="panel-wrapper collapse in">
            <div class="panel-body">
              <p class="text-muted" style="margin-bottom:16px;">
                Per-spill konfigurasjon for runde-pace. Verdiene overstyrer
                env-default (PERPETUAL_LOOP_DELAY_MS / AUTO_DRAW_INTERVAL_MS)
                for det globale rommet (ROCKET / MONSTERBINGO).
              </p>
              <form id="gm-add-pace-form" onsubmit="return false;" novalidate>
                <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
                  <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">Grunnleggende</legend>
                  <div class="row">
                    <div class="col-sm-6">
                      <label for="gm-pace-name">${escapeHtml(t("game_name"))} *</label>
                      <input type="text" class="form-control" id="gm-pace-name"
                        data-testid="gm-pace-name" maxlength="200"
                        value="${escapeHtml(s.name)}">
                    </div>
                    <div class="col-sm-6">
                      <label for="gm-pace-start-date">${escapeHtml(t("start_date"))} *</label>
                      <input type="date" class="form-control" id="gm-pace-start-date"
                        data-testid="gm-pace-start-date"
                        value="${escapeHtml(s.startDateIso)}">
                    </div>
                  </div>
                </fieldset>
                <fieldset class="form-group" style="border:1px solid #eee;padding:12px;margin-bottom:12px;">
                  <legend style="font-size:14px;font-weight:bold;padding:0 8px;width:auto;border:0;">
                    Runde-pace
                  </legend>
                  <div class="row">
                    <div class="col-sm-6">
                      <label for="gm-round-pause">
                        Pause mellom runder (sekunder) *
                      </label>
                      <input type="number" class="form-control" id="gm-round-pause"
                        data-testid="gm-round-pause"
                        min="${ROUND_PAUSE_SECONDS_MIN}" max="${ROUND_PAUSE_SECONDS_MAX}"
                        step="1" required
                        value="${s.roundPauseSeconds}">
                      <p class="text-muted" style="font-size:12px;margin-top:4px;">
                        Tid fra siste utbetaling til neste runde starter.
                        Område: ${ROUND_PAUSE_SECONDS_MIN}-${ROUND_PAUSE_SECONDS_MAX} sek.
                        Default: ${ROUND_PAUSE_SECONDS_DEFAULT} sek.
                      </p>
                    </div>
                    <div class="col-sm-6">
                      <label for="gm-ball-interval">
                        Pause mellom baller (sekunder) *
                      </label>
                      <input type="number" class="form-control" id="gm-ball-interval"
                        data-testid="gm-ball-interval"
                        min="${BALL_INTERVAL_SECONDS_MIN}" max="${BALL_INTERVAL_SECONDS_MAX}"
                        step="1" required
                        value="${s.ballIntervalSeconds}">
                      <p class="text-muted" style="font-size:12px;margin-top:4px;">
                        Minimum tid mellom kule-trekninger.
                        Område: ${BALL_INTERVAL_SECONDS_MIN}-${BALL_INTERVAL_SECONDS_MAX} sek.
                        Default: ${BALL_INTERVAL_SECONDS_DEFAULT} sek.
                      </p>
                    </div>
                  </div>
                </fieldset>
                <div id="gm-pace-errors" data-testid="gm-pace-errors" style="margin-bottom:12px;"></div>
                <div style="padding-top:8px;">
                  <button type="submit" id="gm-pace-submit" data-testid="gm-pace-submit"
                    class="btn btn-success btn-flat">
                    <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("submit"))}
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

function getInputValue(host: HTMLElement, id: string): string {
  const el = host.querySelector<HTMLInputElement>(`#${id}`);
  return el?.value ?? "";
}

function setErrorBlock(host: HTMLElement, messages: string[]): void {
  const slot = host.querySelector<HTMLElement>("#gm-pace-errors");
  if (!slot) return;
  if (messages.length === 0) {
    slot.innerHTML = "";
    return;
  }
  const items = messages.map((m) => `<li>${escapeHtml(m)}</li>`).join("");
  slot.innerHTML = `<div class="alert alert-danger" role="alert"><ul style="margin:0;padding-left:20px;">${items}</ul></div>`;
}

function wireForm(container: HTMLElement, state: FormState): void {
  const form = container.querySelector<HTMLFormElement>("#gm-add-pace-form");
  if (!form) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void handleSubmit(container, state);
  });
}

async function handleSubmit(container: HTMLElement, state: FormState): Promise<void> {
  const errors: string[] = [];
  const name = getInputValue(container, "gm-pace-name").trim();
  const startDate = getInputValue(container, "gm-pace-start-date").trim();
  const roundPauseRaw = getInputValue(container, "gm-round-pause").trim();
  const ballIntervalRaw = getInputValue(container, "gm-ball-interval").trim();

  if (!name) errors.push("Navn er påkrevd.");
  if (!startDate) errors.push("Startdato er påkrevd.");

  const roundPauseSec = Number(roundPauseRaw);
  if (!Number.isFinite(roundPauseSec) || roundPauseSec < ROUND_PAUSE_SECONDS_MIN || roundPauseSec > ROUND_PAUSE_SECONDS_MAX) {
    errors.push(
      `Pause mellom runder må være ${ROUND_PAUSE_SECONDS_MIN}-${ROUND_PAUSE_SECONDS_MAX} sekunder.`,
    );
  }
  const ballIntervalSec = Number(ballIntervalRaw);
  if (!Number.isFinite(ballIntervalSec) || ballIntervalSec < BALL_INTERVAL_SECONDS_MIN || ballIntervalSec > BALL_INTERVAL_SECONDS_MAX) {
    errors.push(
      `Pause mellom baller må være ${BALL_INTERVAL_SECONDS_MIN}-${BALL_INTERVAL_SECONDS_MAX} sekunder.`,
    );
  }
  if (errors.length > 0) {
    setErrorBlock(container, errors);
    return;
  }
  setErrorBlock(container, []);

  const subKey = configSubKeyForSlug(state.gameType.type ?? state.gameType.slug ?? "");
  const config: Record<string, unknown> = {
    [subKey]: {
      // Lagres som ms i DB så backend kan validere mot variantConfig-grenser
      // direkte. UI viser sekunder for menneskelig lesbarhet.
      roundPauseMs: Math.floor(roundPauseSec) * 1000,
      ballIntervalMs: Math.floor(ballIntervalSec) * 1000,
    },
  };

  state.submitting = true;
  const submitBtn = container.querySelector<HTMLButtonElement>("#gm-pace-submit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const result = await saveGameManagement({
      gameTypeId: state.gameType._id,
      name,
      ticketType: "Small",
      ticketPrice: 0,
      // Konverterer YYYY-MM-DD → ISO timestamp så backend kan parse den.
      startDate: new Date(`${startDate}T00:00:00`).toISOString(),
      status: "active",
      config,
    });
    if (result.ok) {
      Toast.success(t("submit_success"));
      window.location.hash = `#/gameManagement?typeId=${encodeURIComponent(state.gameType._id)}`;
      return;
    }
    Toast.error(result.message ?? t("something_went_wrong"));
    setErrorBlock(container, [result.message ?? "Ukjent feil ved lagring"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
    setErrorBlock(container, [msg]);
  } finally {
    state.submitting = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}
