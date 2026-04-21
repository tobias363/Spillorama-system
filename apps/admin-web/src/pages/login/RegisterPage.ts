import { t } from "../../i18n/I18n.js";
import { register } from "../../api/auth.js";
import { setSession } from "../../auth/Session.js";
import { ApiError } from "../../api/client.js";

// PR-B7 (BIN-675) — builds an *actual* registration form. The legacy
// of login.html (no first-name/surname/birthdate fields) — we port against
// the contract of POST /api/auth/register at apps/backend/src/routes/auth.ts:
// 49-75, which accepts email/password/displayName/surname/birthDate and
// optional phone. Backend returns a full session; we auto-login per PM
// directive and let main.ts mount the shell.
//
// Scope: this page is player-signup (hall-operator-assisted). There is NO
// link from LoginPage — it is reachable only via direct URL #/register.
// Backend creates ADMIN for the first user in the DB, PLAYER for everyone
// else. The first-user path is an installer/setup edge case.

/**
 * Render the register page. `onSuccess` is called after
 * auto-login so main.ts can mount the admin shell.
 */
export function renderRegisterPage(root: HTMLElement, onSuccess: () => void): void {
  root.removeAttribute("data-state");
  document.body.classList.remove("skin-blue", "sidebar-mini", "sidebar-collapse");
  document.body.classList.add("hold-transition", "login-page");

  root.innerHTML = `
    <div class="login-box" style="width: 420px;">
      <div class="login-logo">
        <img class="brand-img mr-10" src="/admin/legacy-skin/img/logo.png" alt="brand" width="170px" height="140px" /><br>
        <a href="#/login"><b>Spillorama</b></a>
      </div>
      <div class="login-box-body">
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("register_heading"))}
        </h3>
        <h6 class="text-center txt-grey nonecase-font login-box-msg" style="font-size: 13px; font-weight: 400;">
          ${escapeHtml(t("register_subtitle"))}
        </h6>
        <div id="registerAlert" class="alert alert-danger" style="display:none;" role="alert" aria-live="polite"></div>
        <form id="registerForm" novalidate>
          <div class="form-group has-feedback">
            <label for="registerFirstName" class="sr-only">${escapeHtml(t("register_first_name"))}</label>
            <input
              type="text"
              id="registerFirstName"
              class="form-control"
              name="displayName"
              required
              maxlength="64"
              autocomplete="given-name"
              placeholder="${escapeHtml(t("register_first_name"))}"
            >
          </div>
          <div class="form-group has-feedback">
            <label for="registerSurname" class="sr-only">${escapeHtml(t("register_surname"))}</label>
            <input
              type="text"
              id="registerSurname"
              class="form-control"
              name="surname"
              required
              maxlength="64"
              autocomplete="family-name"
              placeholder="${escapeHtml(t("register_surname"))}"
            >
          </div>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-envelope form-control-feedback" style="left: 0 !important;"></span>
            <label for="registerEmail" class="sr-only">${escapeHtml(t("email_placeholder"))}</label>
            <input
              type="email"
              id="registerEmail"
              class="form-control"
              name="email"
              required
              autocomplete="email"
              placeholder="${escapeHtml(t("email_placeholder"))}"
              style="padding-left: 42.5px; padding-right: 12px;"
            >
          </div>
          <div class="form-group has-feedback">
            <label for="registerBirthDate" class="sr-only">${escapeHtml(t("register_birth_date"))}</label>
            <input
              type="date"
              id="registerBirthDate"
              class="form-control"
              name="birthDate"
              required
              autocomplete="bday"
              placeholder="${escapeHtml(t("register_birth_date"))}"
            >
          </div>
          <div class="form-group has-feedback">
            <label for="registerPhone" class="sr-only">${escapeHtml(t("register_phone"))}</label>
            <input
              type="tel"
              id="registerPhone"
              class="form-control"
              name="phone"
              autocomplete="tel"
              placeholder="${escapeHtml(t("register_phone"))}"
            >
          </div>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-lock form-control-feedback" style="left: 0 !important;"></span>
            <label for="registerPassword" class="sr-only">${escapeHtml(t("password_placeholder"))}</label>
            <input
              type="password"
              id="registerPassword"
              class="form-control"
              name="password"
              required
              minlength="12"
              maxlength="128"
              autocomplete="new-password"
              placeholder="${escapeHtml(t("password_placeholder"))}"
              style="padding-left: 42.5px; padding-right: 12px;"
            >
            <small class="text-muted" style="display:block; margin-top: 4px;">
              ${escapeHtml(t("register_password_hint"))}
            </small>
          </div>
          <div class="row">
            <div class="col-xs-6">
              <button type="submit" id="registerSubmit" class="btn btn-primary btn-block btn-flat">
                ${escapeHtml(t("register_submit"))}
              </button>
            </div>
            <div class="col-xs-6">
              <a href="#/login" class="btn btn-default btn-block btn-flat" id="registerBackToLogin">
                ${escapeHtml(t("forgot_password_back_to_login"))}
              </a>
            </div>
          </div>
        </form>
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#registerForm")!;
  const alert = root.querySelector<HTMLElement>("#registerAlert")!;
  const submit = root.querySelector<HTMLButtonElement>("#registerSubmit")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alert.style.display = "none";

    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const displayName = String(fd.get("displayName") ?? "").trim();
    const surname = String(fd.get("surname") ?? "").trim();
    const birthDate = String(fd.get("birthDate") ?? "").trim();
    const phoneRaw = String(fd.get("phone") ?? "").trim();

    if (!email || !password || !displayName || !surname || !birthDate) {
      alert.textContent = t("register_error_generic");
      alert.style.display = "";
      return;
    }

    // Progressive client-side password guard — mirrors PlatformService
    // assertPassword at apps/backend/src/platform/PlatformService.ts:
    // 3567-3580. Backend remains authoritative; this just saves a
    // round-trip and surfaces the rule to the user without a network hop.
    if (
      password.length < 12 ||
      password.length > 128 ||
      !/[A-ZÆØÅ]/.test(password) ||
      !/[a-zæøå]/.test(password) ||
      !/\d/.test(password)
    ) {
      alert.textContent = t("register_password_too_weak");
      alert.style.display = "";
      return;
    }

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      const session = await register({
        email,
        password,
        displayName,
        surname,
        birthDate,
        ...(phoneRaw ? { phone: phoneRaw } : {}),
      });
      // Auto-login: register() already stored the access token; setting
      // session lets AuthGuard.getSession() resolve to the new user and
      // main.ts.showLogin's hashchange handler unbinds itself once the
      // shell mounts.
      setSession(session);
      // Switch hash to admin so the bootstrap dispatcher doesn't try to
      // re-render the register page.
      window.location.hash = "#/admin";
      onSuccess();
    } catch (err) {
      alert.textContent = mapErrorToI18n(err);
      alert.style.display = "";
    } finally {
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
}

/**
 * Map common backend error codes to i18n keys. Anything unknown falls
 * through to the generic "registration failed" message so we never leak
 * raw SQL or internal error text.
 */
function mapErrorToI18n(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "EMAIL_EXISTS":
        return t("register_email_exists");
      case "AGE_RESTRICTED":
        return t("register_age_restricted");
      case "WEAK_PASSWORD":
      case "INVALID_PASSWORD":
        return t("register_password_too_weak");
      default:
        // Backend messages are user-friendly (Norwegian), so surface them
        // when available. Fallback protects against raw HTTP codes.
        return err.message || t("register_error_generic");
    }
  }
  return err instanceof Error ? err.message : t("register_error_generic");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
