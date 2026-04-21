import { t } from "../../i18n/I18n.js";
import { forgotPassword } from "../../api/auth.js";

//
// Enumeration-safe UX: the backend at apps/backend/src/routes/auth.ts:227-267
// always returns `{ sent: true }` regardless of whether the e-mail exists.
// The UI MUST mirror this — we render the same success panel on every
// successful 2xx response, no branching on user-presence. Only truly broken
// network/4xx/5xx errors surface a generic error.

/**
 * Render the "forgot password" pre-auth page. The view is self-contained
 * (no session, no chrome) and styled via the legacy login-page CSS bundle
 * already loaded for LoginPage.
 */
export function renderForgotPasswordPage(root: HTMLElement): void {
  root.removeAttribute("data-state");
  document.body.classList.remove("skin-blue", "sidebar-mini", "sidebar-collapse");
  document.body.classList.add("hold-transition", "login-page");

  root.innerHTML = `
    <div class="login-box">
      <div class="login-logo">
        <img class="brand-img mr-10" src="/admin/legacy-skin/img/logo.png" alt="brand" width="170px" height="140px" /><br>
        <a href="#/login"><b>Spillorama</b></a>
      </div>
      <div class="login-box-body">
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("forgot_password_heading"))}
        </h3>
        <h6 class="text-center txt-grey nonecase-font login-box-msg" style="font-size: 13px; font-weight: 400;">
          ${escapeHtml(t("forgot_password_subtitle"))}
        </h6>
        <div id="forgotAlert" class="alert alert-danger" style="display:none;" role="alert" aria-live="polite"></div>
        <div id="forgotSuccess" class="alert alert-success" style="display:none;" role="status" aria-live="polite"></div>
        <form id="forgotForm" novalidate>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-envelope form-control-feedback" style="left: 0 !important;"></span>
            <label for="forgotEmail" class="sr-only">${escapeHtml(t("email_placeholder"))}</label>
            <input
              type="email"
              id="forgotEmail"
              class="form-control"
              name="email"
              required
              autocomplete="email"
              aria-describedby="forgotAlert"
              placeholder="${escapeHtml(t("email_placeholder"))}"
              style="padding-left: 42.5px; padding-right: 12px;"
            >
          </div>
          <div class="row">
            <div class="col-xs-6">
              <button type="submit" id="forgotSubmit" class="btn btn-primary btn-block btn-flat">
                ${escapeHtml(t("forgot_password_send"))}
              </button>
            </div>
            <div class="col-xs-6">
              <a href="#/login" class="btn btn-default btn-block btn-flat" id="forgotBackToLogin">
                ${escapeHtml(t("forgot_password_back_to_login"))}
              </a>
            </div>
          </div>
        </form>
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#forgotForm")!;
  const alert = root.querySelector<HTMLElement>("#forgotAlert")!;
  const success = root.querySelector<HTMLElement>("#forgotSuccess")!;
  const submit = root.querySelector<HTMLButtonElement>("#forgotSubmit")!;
  const email = root.querySelector<HTMLInputElement>("#forgotEmail")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alert.style.display = "none";
    success.style.display = "none";
    const value = email.value.trim();
    if (!value) {
      alert.textContent = t("email_required");
      alert.style.display = "";
      return;
    }

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      await forgotPassword(value);
      // Enumeration-safe: always the same message regardless of backend
      // outcome. Form is hidden to prevent the user from spamming the
      // submit button against the rate-limiter.
      success.textContent = t("forgot_password_sent_generic");
      success.style.display = "";
      form.style.display = "none";
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("forgot_password_error");
      alert.textContent = msg;
      alert.style.display = "";
    } finally {
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
