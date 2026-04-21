import { t } from "../../i18n/I18n.js";
import { validateResetToken, resetPassword } from "../../api/auth.js";
import { ApiError } from "../../api/client.js";

// PR-B7 (BIN-675) — consolidates three legacy reset-password views:
//
// All three mapped to role-specific Unity endpoints. The modern backend
// uses a single rolle-agnostic endpoint (apps/backend/src/routes/auth.ts:
// 269-294): token is validated against user-id, not role. resetPasswordSuc.html
// was an email template and is inlined here as a success panel.
//
// 3-state machine:
//   1. "validating" — GET /api/auth/reset-password/:token; never touch form
//   2. "form"       — token valid: show new + confirm password fields
//   3. "success"    — POST succeeded: "Passord oppdatert" + back-to-login
// Failure at state 1 shows an "invalid/expired" panel with a link to
// ForgotPasswordPage so the user can request a fresh link.

type ViewState =
  | { kind: "validating" }
  | { kind: "invalid" }
  | { kind: "form" }
  | { kind: "success" };

/**
 * Render the reset-password page, starting in "validating" state. The
 * `token` is taken from the hash path (`#/reset-password/:token`) by the
 * dispatcher in pages/login/index.ts.
 */
export function renderResetPasswordPage(root: HTMLElement, token: string): void {
  root.removeAttribute("data-state");
  document.body.classList.remove("skin-blue", "sidebar-mini", "sidebar-collapse");
  document.body.classList.add("hold-transition", "login-page");

  let state: ViewState = { kind: "validating" };
  render();

  // Kick off token validation. We DO NOT render the form until GET succeeds
  // — this prevents the user from typing a password only to get an
  // "expired token" error on submit (worse UX + wasted keystrokes).
  void (async () => {
    if (!token) {
      state = { kind: "invalid" };
      render();
      return;
    }
    try {
      await validateResetToken(token);
      state = { kind: "form" };
      render();
    } catch (err) {
      // Any backend error here is treated as invalid-or-expired. We don't
      // leak the specific code to the UI because all recovery paths are
      // the same: send the user to ForgotPasswordPage for a fresh link.
      state = { kind: "invalid" };
      render();
      // Log to console for dev visibility.
      // eslint-disable-next-line no-console
      console.warn("[ResetPasswordPage] token validation failed", err);
    }
  })();

  function render(): void {
    root.innerHTML = `
      <div class="login-box">
        <div class="login-logo">
          <img class="brand-img mr-10" src="/admin/legacy-skin/img/logo.png" alt="brand" width="170px" height="140px" /><br>
          <a href="#/login"><b>Spillorama</b></a>
        </div>
        <div class="login-box-body" data-reset-state="${state.kind}">
          ${bodyFor(state)}
        </div>
      </div>`;

    if (state.kind === "form") wireForm();
  }

  function wireForm(): void {
    const form = root.querySelector<HTMLFormElement>("#resetForm")!;
    const alert = root.querySelector<HTMLElement>("#resetAlert")!;
    const submit = root.querySelector<HTMLButtonElement>("#resetSubmit")!;
    const newPwd = root.querySelector<HTMLInputElement>("#resetNew")!;
    const confirm = root.querySelector<HTMLInputElement>("#resetConfirm")!;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      alert.style.display = "none";
      const a = newPwd.value;
      const b = confirm.value;
      if (!a || !b) {
        alert.textContent = t("reset_password_mismatch");
        alert.style.display = "";
        return;
      }
      if (a !== b) {
        alert.textContent = t("reset_password_mismatch");
        alert.style.display = "";
        return;
      }
      // Progressive frontend guard mirroring PlatformService.assertPassword
      // at apps/backend/src/platform/PlatformService.ts:3567-3580. Backend
      // is authoritative; this is just to save a round-trip.
      if (a.length < 12 || a.length > 128 || !/[A-ZÆØÅ]/.test(a) || !/[a-zæøå]/.test(a) || !/\d/.test(a)) {
        alert.textContent = t("register_password_too_weak");
        alert.style.display = "";
        return;
      }

      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      try {
        await resetPassword(token, a);
        state = { kind: "success" };
        render();
      } catch (err) {
        // Token-consume errors here are unusual (we just validated the
        // same token) — surface as a generic error. If the backend says
        // the token is expired mid-flow, tell the user to request a new
        // one instead of silently succeeding.
        if (err instanceof ApiError && (err.code === "INVALID_TOKEN" || err.code === "TOKEN_EXPIRED")) {
          state = { kind: "invalid" };
          render();
          return;
        }
        const msg = err instanceof Error ? err.message : t("reset_password_error");
        alert.textContent = msg;
        alert.style.display = "";
      } finally {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    });
  }
}

function bodyFor(state: ViewState): string {
  switch (state.kind) {
    case "validating":
      return `
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("reset_password_heading"))}
        </h3>
        <p class="text-center txt-grey" role="status" aria-live="polite">
          ${escapeHtml(t("reset_password_validating"))}
        </p>`;
    case "invalid":
      return `
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("reset_password_heading"))}
        </h3>
        <div class="alert alert-danger" role="alert" id="resetTokenError">
          ${escapeHtml(t("reset_password_token_invalid"))}
        </div>
        <div class="row">
          <div class="col-xs-6">
            <a href="#/forgot-password" class="btn btn-primary btn-block btn-flat">
              ${escapeHtml(t("forgot_password_heading"))}
            </a>
          </div>
          <div class="col-xs-6">
            <a href="#/login" class="btn btn-default btn-block btn-flat">
              ${escapeHtml(t("forgot_password_back_to_login"))}
            </a>
          </div>
        </div>`;
    case "form":
      return `
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("reset_password_heading"))}
        </h3>
        <h6 class="text-center txt-grey nonecase-font login-box-msg" style="font-size: 13px; font-weight: 400;">
          ${escapeHtml(t("reset_password_subtitle"))}
        </h6>
        <div id="resetAlert" class="alert alert-danger" style="display:none;" role="alert" aria-live="polite"></div>
        <form id="resetForm" novalidate>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-lock form-control-feedback" style="left: 0 !important;"></span>
            <label for="resetNew" class="sr-only">${escapeHtml(t("reset_password_new"))}</label>
            <input
              type="password"
              id="resetNew"
              class="form-control"
              name="newPassword"
              required
              minlength="12"
              maxlength="128"
              autocomplete="new-password"
              placeholder="${escapeHtml(t("reset_password_new"))}"
              style="padding-left: 42.5px; padding-right: 12px;"
            >
            <small class="text-muted" style="display:block; margin-top: 4px;">
              ${escapeHtml(t("register_password_hint"))}
            </small>
          </div>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-lock form-control-feedback" style="left: 0 !important;"></span>
            <label for="resetConfirm" class="sr-only">${escapeHtml(t("reset_password_confirm"))}</label>
            <input
              type="password"
              id="resetConfirm"
              class="form-control"
              name="confirmPassword"
              required
              minlength="12"
              maxlength="128"
              autocomplete="new-password"
              placeholder="${escapeHtml(t("reset_password_confirm"))}"
              style="padding-left: 42.5px; padding-right: 12px;"
            >
          </div>
          <div class="row">
            <div class="col-xs-6">
              <button type="submit" id="resetSubmit" class="btn btn-primary btn-block btn-flat">
                ${escapeHtml(t("reset_password_submit"))}
              </button>
            </div>
            <div class="col-xs-6">
              <a href="#/login" class="btn btn-default btn-block btn-flat">
                ${escapeHtml(t("forgot_password_back_to_login"))}
              </a>
            </div>
          </div>
        </form>`;
    case "success":
      return `
        <h3 class="text-center txt-dark mb-10 login-box-msg" style="font-size: 18px; font-weight: 600;">
          ${escapeHtml(t("reset_password_success_heading"))}
        </h3>
        <div class="alert alert-success" role="status" aria-live="polite">
          ${escapeHtml(t("reset_password_success_body"))}
        </div>
        <div class="row">
          <div class="col-xs-12">
            <a href="#/login" class="btn btn-primary btn-block btn-flat" id="resetSuccessCta">
              ${escapeHtml(t("reset_password_success_cta"))}
            </a>
          </div>
        </div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
