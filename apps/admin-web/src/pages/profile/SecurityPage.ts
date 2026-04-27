// REQ-129/132: Profile → Security-side med 2FA + active sessions.
//
// 2 hovedseksjoner:
//   - Two-Factor Authentication (TOTP):
//       Off:  vis "Aktiver 2FA" → setup → QR-code (Google Charts API) +
//             secret + verifiser-input → 10 backup-codes vises engangs.
//       On:   vis status, "Deaktiver" (krever passord + TOTP-kode) og
//             "Regenerer backup-codes" (krever passord).
//   - Active sessions: tabell med device, IP, last-activity, isCurrent.
//             Per-rad "Logg ut", + "Logg ut alle andre"-knapp.
//
// QR-code rendres via Google Charts API som speedy fallback uten ny npm-dep
// (matcher mønster fra spillvett.js shell). otpauth-URI url-encodes inn i:
//   https://chart.googleapis.com/chart?cht=qr&chl=<URI>&chs=220x220
//
// Audit-log: alle handlinger gir Toast-feedback.

import { escapeHtml } from "../adminUsers/shared.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  getTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
  regenerateBackupCodes,
  listSessions,
  logoutSession,
  logoutAllSessions,
  type TwoFAStatus,
  type ActiveSession,
} from "../../api/auth-2fa.js";

// ── Page entrypoint ──────────────────────────────────────────────────────

export function renderSecurityPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content">
      <div class="content-header">
        <h1>Sikkerhet <small>To-faktor &amp; aktive sesjoner</small></h1>
      </div>
      <div id="security-host" class="box-body">Laster...</div>
    </section>`;
  const host = container.querySelector<HTMLElement>("#security-host")!;
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  await refresh(host);
}

async function refresh(host: HTMLElement): Promise<void> {
  let status: TwoFAStatus;
  let sessions: ActiveSession[];
  try {
    [status, sessions] = await Promise.all([
      getTwoFAStatus(),
      listSessions().then((r) => r.sessions),
    ]);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Klarte ikke laste sikkerhetsdata.";
    host.innerHTML = `<div class="callout callout-danger" data-testid="security-load-error">${escapeHtml(
      message
    )}</div>`;
    return;
  }
  render(host, status, sessions);
}

function render(host: HTMLElement, status: TwoFAStatus, sessions: ActiveSession[]): void {
  host.innerHTML = `
    <div class="row">
      <div class="col-md-6" data-testid="security-2fa-col">${render2FASection(status)}</div>
      <div class="col-md-6" data-testid="security-sessions-col">${renderSessionsSection(sessions)}</div>
    </div>`;
  wire2FA(host, status);
  wireSessions(host);
}

// ── 2FA-seksjon ──────────────────────────────────────────────────────────

function render2FASection(s: TwoFAStatus): string {
  if (s.enabled) {
    return `
      <div class="box box-success" data-testid="security-2fa-enabled">
        <div class="box-header with-border"><h3 class="box-title">To-faktor-autentisering</h3></div>
        <div class="box-body">
          <p>
            <span class="label label-success">Aktivert</span>
            ${s.enabledAt ? `siden ${escapeHtml(new Date(s.enabledAt).toLocaleString("nb-NO"))}` : ""}
          </p>
          <p>Backup-koder igjen: <strong data-testid="security-2fa-backup-remaining">${s.backupCodesRemaining}</strong></p>

          <hr>
          <h4>Regenerer backup-koder</h4>
          <p class="help-block">Gamle koder blir ugyldige. Krever passord.</p>
          <form id="regen-form" data-testid="security-2fa-regen-form" class="form-inline">
            <input type="password" name="password" class="form-control"
                   placeholder="Passord" required data-testid="security-2fa-regen-password" />
            <button type="submit" class="btn btn-warning" data-testid="security-2fa-regen-submit">
              Regenerer
            </button>
          </form>
          <div id="regen-result" class="callout callout-info" style="display:none;margin-top:12px;"
               data-testid="security-2fa-regen-result"></div>

          <hr>
          <h4>Deaktiver 2FA</h4>
          <p class="help-block">Krever passord og en gyldig TOTP-kode.</p>
          <form id="disable-form" data-testid="security-2fa-disable-form">
            <div class="form-group">
              <input type="password" name="password" class="form-control"
                     placeholder="Passord" required data-testid="security-2fa-disable-password" />
            </div>
            <div class="form-group">
              <input type="text" name="code" class="form-control"
                     placeholder="6-sifret TOTP-kode" required pattern="\\d{6}"
                     inputmode="numeric" data-testid="security-2fa-disable-code" />
            </div>
            <button type="submit" class="btn btn-danger" data-testid="security-2fa-disable-submit">
              Deaktiver
            </button>
          </form>
        </div>
      </div>`;
  }

  return `
    <div class="box box-default" data-testid="security-2fa-disabled">
      <div class="box-header with-border"><h3 class="box-title">To-faktor-autentisering</h3></div>
      <div class="box-body">
        <p>2FA er <span class="label label-default">ikke aktivert</span>.</p>
        <p class="help-block">
          Beskytt kontoen din med en autentiserings-app som Google Authenticator,
          Authy eller 1Password. Du blir bedt om en 6-sifret kode hver gang du logger inn.
        </p>
        ${s.hasPendingSetup
          ? `<p class="help-block"><em>Du har en uferdig setup. Klikk "Aktiver 2FA" for å starte på nytt.</em></p>`
          : ""}
        <button type="button" class="btn btn-primary" id="setup-btn" data-testid="security-2fa-setup-btn">
          Aktiver 2FA
        </button>

        <div id="setup-pane" style="display:none;margin-top:16px;" data-testid="security-2fa-setup-pane">
          <!-- Fylles inn etter /setup-kall -->
        </div>
      </div>
    </div>`;
}

function wire2FA(host: HTMLElement, status: TwoFAStatus): void {
  if (!status.enabled) {
    const setupBtn = host.querySelector<HTMLButtonElement>("#setup-btn");
    setupBtn?.addEventListener("click", () => void onSetup(host));
    return;
  }
  const regenForm = host.querySelector<HTMLFormElement>("#regen-form");
  regenForm?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void onRegenerate(host, regenForm);
  });
  const disableForm = host.querySelector<HTMLFormElement>("#disable-form");
  disableForm?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void onDisable(host, disableForm);
  });
}

async function onSetup(host: HTMLElement): Promise<void> {
  const pane = host.querySelector<HTMLElement>("#setup-pane");
  if (!pane) return;
  pane.style.display = "";
  pane.innerHTML = `<p>Henter QR-kode...</p>`;
  try {
    const result = await setupTwoFA();
    const qrSrc = `https://chart.googleapis.com/chart?cht=qr&chs=220x220&chl=${encodeURIComponent(result.otpauthUri)}`;
    pane.innerHTML = `
      <div class="callout callout-info">
        <h4>Skann QR-koden i autentiserings-appen</h4>
        <p>
          <img src="${qrSrc}" alt="QR-kode for 2FA-setup" data-testid="security-2fa-qr"
               width="220" height="220" />
        </p>
        <p>Eller skriv inn nøkkelen manuelt:
          <code data-testid="security-2fa-secret">${escapeHtml(result.secret)}</code>
        </p>
      </div>
      <form id="verify-form" class="form-inline" data-testid="security-2fa-verify-form">
        <div class="form-group">
          <label for="verify-code">Skriv inn 6-sifret kode fra appen:</label>
          <input type="text" id="verify-code" name="code" class="form-control"
                 pattern="\\d{6}" required inputmode="numeric"
                 placeholder="123456" data-testid="security-2fa-verify-code"
                 style="margin:0 8px;" />
        </div>
        <button type="submit" class="btn btn-success" data-testid="security-2fa-verify-submit">
          Verifiser og aktiver
        </button>
      </form>
      <div id="verify-result" class="callout callout-success" style="display:none;margin-top:16px;"
           data-testid="security-2fa-verify-result"></div>`;
    const verifyForm = pane.querySelector<HTMLFormElement>("#verify-form")!;
    verifyForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      void onVerify(host, verifyForm);
    });
  } catch (err) {
    pane.innerHTML = `<div class="callout callout-danger">${escapeHtml(errorMessage(err, "Kunne ikke starte setup."))}</div>`;
  }
}

async function onVerify(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  const fd = new FormData(form);
  const code = String(fd.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    Toast.warning("Ugyldig 6-sifret kode.");
    return;
  }
  try {
    const result = await verifyTwoFA(code);
    Toast.success("2FA aktivert. Lagre backup-kodene trygt.");
    const pane = host.querySelector<HTMLElement>("#setup-pane");
    if (pane) {
      pane.innerHTML = renderBackupCodes(result.backupCodes, host);
      const continueBtn = pane.querySelector<HTMLButtonElement>("#backup-continue-btn");
      continueBtn?.addEventListener("click", () => void refresh(host));
    }
  } catch (err) {
    Toast.error(errorMessage(err, "Kunne ikke verifisere kode."));
  }
}

async function onRegenerate(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  const fd = new FormData(form);
  const password = String(fd.get("password") ?? "");
  if (!password) {
    Toast.warning("Skriv inn passord.");
    return;
  }
  try {
    const result = await regenerateBackupCodes(password);
    const target = host.querySelector<HTMLElement>("#regen-result");
    if (target) {
      target.style.display = "";
      target.innerHTML = renderBackupCodes(result.backupCodes, host, /*standalone=*/ true);
    }
    Toast.success("Backup-koder regenerert. Gamle koder er nå ugyldige.");
    form.reset();
  } catch (err) {
    Toast.error(errorMessage(err, "Kunne ikke regenerere backup-koder."));
  }
}

async function onDisable(host: HTMLElement, form: HTMLFormElement): Promise<void> {
  if (!window.confirm("Er du sikker på at du vil deaktivere 2FA?")) return;
  const fd = new FormData(form);
  const password = String(fd.get("password") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  if (!password || !/^\d{6}$/.test(code)) {
    Toast.warning("Passord og 6-sifret kode kreves.");
    return;
  }
  try {
    await disableTwoFA(password, code);
    Toast.success("2FA deaktivert.");
    await refresh(host);
  } catch (err) {
    Toast.error(errorMessage(err, "Kunne ikke deaktivere 2FA."));
  }
}

function renderBackupCodes(codes: string[], _host: HTMLElement, standalone = false): string {
  const items = codes
    .map((c) => `<li><code>${escapeHtml(c)}</code></li>`)
    .join("");
  return `
    <h4>Backup-koder</h4>
    <p class="help-block">
      Skriv ned eller print disse <strong>nå</strong>. Hver kode kan brukes
      én gang hvis du mister tilgangen til autentiserings-appen.
    </p>
    <ol data-testid="security-2fa-backup-codes" style="font-family:monospace;font-size:14px;">
      ${items}
    </ol>
    ${standalone
      ? ""
      : `<button type="button" class="btn btn-primary" id="backup-continue-btn"
              data-testid="security-2fa-backup-continue">
          Jeg har lagret kodene — fortsett
         </button>`}`;
}

// ── Sessions-seksjon ─────────────────────────────────────────────────────

function renderSessionsSection(sessions: ActiveSession[]): string {
  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;
  const rows = sessions
    .map((s) => {
      const device = s.deviceUserAgent
        ? abbreviateUA(s.deviceUserAgent)
        : "Ukjent enhet";
      const ip = s.ipAddress ?? "—";
      const last = new Date(s.lastActivityAt).toLocaleString("nb-NO");
      const created = new Date(s.createdAt).toLocaleString("nb-NO");
      const tag = s.isCurrent
        ? `<span class="label label-success" data-testid="session-current-tag">Denne sesjonen</span>`
        : `<button type="button" class="btn btn-xs btn-default"
                   data-action="logout-session" data-session-id="${escapeHtml(s.id)}"
                   data-testid="session-logout-${escapeHtml(s.id)}">Logg ut</button>`;
      return `
        <tr data-testid="session-row-${escapeHtml(s.id)}" ${s.isCurrent ? `class="success"` : ""}>
          <td title="${escapeHtml(s.deviceUserAgent ?? "")}">${escapeHtml(device)}</td>
          <td>${escapeHtml(ip)}</td>
          <td>${escapeHtml(last)}</td>
          <td>${escapeHtml(created)}</td>
          <td>${tag}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="box box-info" data-testid="security-sessions-box">
      <div class="box-header with-border">
        <h3 class="box-title">Aktive sesjoner</h3>
        <div class="box-tools pull-right">
          <button type="button" class="btn btn-warning btn-sm"
                  id="logout-all-btn"
                  data-testid="security-logout-all-btn"
                  ${otherSessionsCount === 0 ? "disabled" : ""}>
            Logg ut alle andre (${otherSessionsCount})
          </button>
        </div>
      </div>
      <div class="box-body table-responsive no-padding">
        <table class="table table-condensed table-striped">
          <thead>
            <tr>
              <th>Enhet</th>
              <th>IP</th>
              <th>Siste aktivitet</th>
              <th>Opprettet</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

function wireSessions(host: HTMLElement): void {
  const logoutAllBtn = host.querySelector<HTMLButtonElement>("#logout-all-btn");
  logoutAllBtn?.addEventListener("click", () => void onLogoutAll(host));

  host.querySelectorAll<HTMLButtonElement>("[data-action='logout-session']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sessionId = btn.getAttribute("data-session-id") ?? "";
      if (!sessionId) return;
      void onLogoutSession(host, sessionId);
    });
  });
}

async function onLogoutAll(host: HTMLElement): Promise<void> {
  if (!window.confirm("Logge ut alle andre sesjoner?")) return;
  try {
    const result = await logoutAllSessions(false);
    Toast.success(`${result.count} sesjon(er) logget ut.`);
    await refresh(host);
  } catch (err) {
    Toast.error(errorMessage(err, "Kunne ikke logge ut sesjoner."));
  }
}

async function onLogoutSession(host: HTMLElement, sessionId: string): Promise<void> {
  if (!window.confirm("Logge ut denne sesjonen?")) return;
  try {
    await logoutSession(sessionId);
    Toast.success("Sesjon logget ut.");
    await refresh(host);
  } catch (err) {
    Toast.error(errorMessage(err, "Kunne ikke logge ut sesjonen."));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function abbreviateUA(ua: string): string {
  // Plukk ut typiske browser/OS-tokens for kort visning. Behold full UA i title.
  const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[/ ][\d.]+/i);
  const os = ua.match(/(Windows NT [\d.]+|Mac OS X [\d_.]+|Linux|Android [\d.]+|iPhone|iPad)/i);
  const parts: string[] = [];
  if (match) parts.push(match[0].split("/")[0]!);
  if (os) parts.push(os[0]);
  if (parts.length === 0) return ua.slice(0, 60);
  return parts.join(" · ");
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
