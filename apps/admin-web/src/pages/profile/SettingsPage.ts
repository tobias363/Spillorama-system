// BIN-720: Profile Settings page (self-service) — PDF 8 (Frontend CR 21.02.2024)
// + PDF 9 (Frontend CR 2024).
//
// 4 seksjoner:
//   - Loss Limits (daily / monthly)
//   - Self-Exclude (1d / 7d / 30d / 1y / permanent)
//   - Language (nb-NO / en-US)
//   - Pause (cooldown-minutes)
//
// NB: denne siden er delt av admin-web-bundle fordi admin-web-shellen også
// brukes av spillers profil-side i MVP. Senere kan profile-UX flyttes til
// player-shell når den finnes. I mellomtiden gjenbruker vi admin-apiRequest
// og auth-token (spilleren logger inn i samme admin-web shell).

import { escapeHtml } from "../adminUsers/shared.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  getProfileSettings,
  selfExclude,
  setLanguage,
  setPause,
  updateLossLimits,
  type ProfileSettingsView,
  type SelfExcludeDuration,
  type SupportedLanguage,
} from "../../api/user-profile-settings.js";

const SELF_EXCLUDE_OPTIONS: Array<{ value: SelfExcludeDuration; label: string }> = [
  { value: "1d", label: "1 dag" },
  { value: "7d", label: "7 dager" },
  { value: "30d", label: "30 dager" },
  { value: "1y", label: "1 år" },
  { value: "permanent", label: "Permanent" },
];

const PAUSE_OPTIONS = [15, 30, 60, 120];

export function renderProfileSettingsPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content">
      <div class="content-header">
        <h1>Profilinnstillinger <small>Selv-service</small></h1>
      </div>
      <div id="profile-settings-host" class="box-body">Laster...</div>
    </section>`;
  const host = container.querySelector<HTMLElement>("#profile-settings-host")!;
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  let settings: ProfileSettingsView;
  try {
    settings = await getProfileSettings();
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Klarte ikke hente innstillinger.";
    host.innerHTML = `<div class="callout callout-danger" data-testid="profile-settings-load-error">${escapeHtml(message)}</div>`;
    return;
  }
  render(host, settings);
}

function render(host: HTMLElement, s: ProfileSettingsView): void {
  host.innerHTML = `
    <div class="row">
      <div class="col-md-6">${renderLossLimitsSection(s)}</div>
      <div class="col-md-6">${renderSelfExcludeSection(s)}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${renderLanguageSection(s)}</div>
      <div class="col-md-6">${renderPauseSection(s)}</div>
    </div>`;

  // Loss limits.
  const lossForm = host.querySelector<HTMLFormElement>("#profile-loss-limits-form")!;
  lossForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitLossLimits(host, lossForm);
  });

  // Self-exclude.
  const excludeButtons = host.querySelectorAll<HTMLButtonElement>("[data-self-exclude]");
  excludeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const duration = btn.getAttribute("data-self-exclude") as SelfExcludeDuration;
      void submitSelfExclude(host, duration);
    });
  });

  // Language.
  const langForm = host.querySelector<HTMLFormElement>("#profile-language-form")!;
  langForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitLanguage(host, langForm);
  });

  // Pause.
  const pauseForm = host.querySelector<HTMLFormElement>("#profile-pause-form")!;
  pauseForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitPause(host, pauseForm);
  });
}

// ── Section renderers ─────────────────────────────────────────────────────

function renderLossLimitsSection(s: ProfileSettingsView): string {
  const daily = Math.round(s.lossLimits.daily);
  const monthly = Math.round(s.lossLimits.monthly);
  const regDaily = Math.round(s.lossLimits.regulatory.daily);
  const regMonthly = Math.round(s.lossLimits.regulatory.monthly);

  const pendingLines: string[] = [];
  if (s.pendingLossLimits.daily) {
    pendingLines.push(
      `<div class="callout callout-warning" data-testid="pending-daily">
        Venter: daglig grense → <strong>${Math.round(s.pendingLossLimits.daily.value)}</strong> kr
        (aktiveres ${escapeHtml(new Date(s.pendingLossLimits.daily.effectiveAt).toLocaleString("nb-NO"))})
       </div>`
    );
  }
  if (s.pendingLossLimits.monthly) {
    pendingLines.push(
      `<div class="callout callout-warning" data-testid="pending-monthly">
        Venter: månedlig grense → <strong>${Math.round(s.pendingLossLimits.monthly.value)}</strong> kr
        (aktiveres ${escapeHtml(new Date(s.pendingLossLimits.monthly.effectiveAt).toLocaleString("nb-NO"))})
       </div>`
    );
  }

  return `
    <div class="box box-primary" data-testid="profile-loss-limits-box">
      <div class="box-header with-border"><h3 class="box-title">Tapsgrenser</h3></div>
      <div class="box-body">
        <p class="help-block">
          Senking aktiveres umiddelbart. Økning aktiveres etter 48 timer (pengespillforskriften).
        </p>
        ${pendingLines.join("")}
        <form id="profile-loss-limits-form" class="form-horizontal">
          <div class="form-group">
            <label class="col-sm-5 control-label" for="pls-daily">Daglig grense (kr)</label>
            <div class="col-sm-7">
              <input type="number" min="0" max="${regDaily}" step="1"
                     id="pls-daily" name="daily"
                     class="form-control"
                     value="${daily}"
                     data-testid="pls-daily">
              <p class="help-block"><small>Regulatorisk tak: ${regDaily} kr</small></p>
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-5 control-label" for="pls-monthly">Månedlig grense (kr)</label>
            <div class="col-sm-7">
              <input type="number" min="0" max="${regMonthly}" step="1"
                     id="pls-monthly" name="monthly"
                     class="form-control"
                     value="${monthly}"
                     data-testid="pls-monthly">
              <p class="help-block"><small>Regulatorisk tak: ${regMonthly} kr</small></p>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-5 col-sm-7">
              <button type="submit" class="btn btn-success" data-testid="pls-submit">Lagre grenser</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
}

function renderSelfExcludeSection(s: ProfileSettingsView): string {
  const blockedNote = s.block.blockedUntil
    ? `<div class="callout callout-danger" data-testid="blocked-until">
        Du er blokkert til ${escapeHtml(new Date(s.block.blockedUntil).toLocaleString("nb-NO"))}.
       </div>`
    : "";
  const selfExcludedNote = s.block.selfExcludedUntil
    ? `<div class="callout callout-danger" data-testid="self-excluded-until">
        Selvutelukkelse aktiv minimum til ${escapeHtml(new Date(s.block.selfExcludedUntil).toLocaleString("nb-NO"))}.
       </div>`
    : "";

  const buttons = SELF_EXCLUDE_OPTIONS.map(
    (opt) =>
      `<button type="button" class="btn btn-warning" style="margin-right:8px;margin-bottom:8px;"
               data-self-exclude="${opt.value}"
               data-testid="self-exclude-${opt.value}">
         Blokker meg i ${escapeHtml(opt.label)}
       </button>`
  ).join("");

  return `
    <div class="box box-warning" data-testid="profile-self-exclude-box">
      <div class="box-header with-border"><h3 class="box-title">Blokker meg</h3></div>
      <div class="box-body">
        <p class="help-block">
          Velg varighet. Blokkeringen kan ikke oppheves før perioden er utløpt.
        </p>
        ${blockedNote}
        ${selfExcludedNote}
        <div data-testid="self-exclude-options">${buttons}</div>
      </div>
    </div>`;
}

function renderLanguageSection(s: ProfileSettingsView): string {
  return `
    <div class="box box-default" data-testid="profile-language-box">
      <div class="box-header with-border"><h3 class="box-title">Språk</h3></div>
      <div class="box-body">
        <form id="profile-language-form" class="form-horizontal">
          <div class="form-group">
            <label class="col-sm-4 control-label" for="pls-language">Språk</label>
            <div class="col-sm-8">
              <select id="pls-language" name="language" class="form-control" data-testid="pls-language">
                <option value="nb-NO" ${s.language === "nb-NO" ? "selected" : ""}>Norsk (Bokmål)</option>
                <option value="en-US" ${s.language === "en-US" ? "selected" : ""}>English (US)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-4 col-sm-8">
              <button type="submit" class="btn btn-primary" data-testid="pls-language-submit">Lagre språk</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
}

function renderPauseSection(s: ProfileSettingsView): string {
  const pauseNote = s.pause.pausedUntil
    ? `<div class="callout callout-info" data-testid="paused-until">
        Pause aktiv til ${escapeHtml(new Date(s.pause.pausedUntil).toLocaleString("nb-NO"))}.
       </div>`
    : "";
  const options = PAUSE_OPTIONS.map(
    (m) => `<option value="${m}">${m} minutter</option>`
  ).join("");
  return `
    <div class="box box-info" data-testid="profile-pause-box">
      <div class="box-header with-border"><h3 class="box-title">Frivillig pause</h3></div>
      <div class="box-body">
        <p class="help-block">
          Kort pause-periode. Kan ikke oppheves før tiden er ute.
        </p>
        ${pauseNote}
        <form id="profile-pause-form" class="form-horizontal">
          <div class="form-group">
            <label class="col-sm-4 control-label" for="pls-pause">Varighet</label>
            <div class="col-sm-8">
              <select id="pls-pause" name="durationMinutes" class="form-control" data-testid="pls-pause">
                ${options}
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-4 col-sm-8">
              <button type="submit" class="btn btn-info" data-testid="pls-pause-submit">Start pause</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
}

// ── Submit handlers ───────────────────────────────────────────────────────

async function submitLossLimits(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const daily = parseOptionalInt(data.get("daily"));
  const monthly = parseOptionalInt(data.get("monthly"));
  const body: { daily?: number; monthly?: number } = {};
  if (daily !== undefined) body.daily = daily;
  if (monthly !== undefined) body.monthly = monthly;
  if (daily === undefined && monthly === undefined) {
    Toast.warning("Ingen endringer å lagre.");
    return;
  }
  try {
    const updated = await updateLossLimits(body);
    Toast.success("Tapsgrenser oppdatert.");
    render(host, updated);
  } catch (err) {
    showError(err);
  }
}

async function submitSelfExclude(host: HTMLElement, duration: SelfExcludeDuration): Promise<void> {
  const confirmMsg = `Er du sikker på at du vil blokkere deg selv ${describeDuration(duration)}? Kan ikke oppheves før perioden er over.`;
  if (!window.confirm(confirmMsg)) return;
  try {
    const updated = await selfExclude(duration);
    Toast.success("Blokkering aktivert.");
    render(host, updated);
  } catch (err) {
    showError(err);
  }
}

async function submitLanguage(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const lang = String(data.get("language") ?? "");
  if (lang !== "nb-NO" && lang !== "en-US") {
    Toast.warning("Ugyldig språk-valg.");
    return;
  }
  try {
    const updated = await setLanguage(lang as SupportedLanguage);
    Toast.success("Språk oppdatert.");
    render(host, updated);
  } catch (err) {
    showError(err);
  }
}

async function submitPause(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const minutes = parseOptionalInt(data.get("durationMinutes"));
  if (minutes === undefined || minutes <= 0) {
    Toast.warning("Velg varighet.");
    return;
  }
  try {
    const updated = await setPause(minutes);
    Toast.success("Pause startet.");
    render(host, updated);
  } catch (err) {
    showError(err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseOptionalInt(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function describeDuration(d: SelfExcludeDuration): string {
  switch (d) {
    case "1d": return "i 1 dag";
    case "7d": return "i 7 dager";
    case "30d": return "i 30 dager";
    case "1y": return "i 1 år";
    case "permanent": return "permanent";
  }
}

function showError(err: unknown): void {
  const message = err instanceof ApiError ? err.message : "Noe gikk galt. Prøv igjen.";
  Toast.error(message);
}
