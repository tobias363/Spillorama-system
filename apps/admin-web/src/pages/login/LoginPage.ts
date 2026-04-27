// REQ-129: LoginPage handles two-step login when 2FA is enabled.
//   Step 1: email + password -> POST /api/auth/login
//     - Returns Session immediately if 2FA is off.
//     - Returns { requires2FA, challengeId } if 2FA is on -> render Step 2.
//   Step 2: 6-digit TOTP code (or 10-char backup code) -> /api/auth/2fa/login.

import { t } from "../../i18n/I18n.js";
import { login, loginPhone, completeTwoFALogin } from "../../api/auth.js";
import { setSession } from "../../auth/Session.js";

type LoginMethod = "email" | "phone";

export function renderLoginPage(root: HTMLElement, onSuccess: () => void): void {
  root.removeAttribute("data-state");
  document.body.classList.remove("skin-blue", "sidebar-mini", "sidebar-collapse");
  document.body.classList.add("hold-transition", "login-page");

  // REQ-130 (PDF 9 Frontend CR): metode-velger E-post / Mobil. Default email.
  let method: LoginMethod = "email";

  root.innerHTML = `
    <div class="login-box">
      <div class="login-logo">
        <img class="brand-img mr-10" src="/admin/legacy-skin/img/logo.png" alt="brand" width="170px" height="140px" /><br>
        <a href="#/admin"><b>Spillorama</b></a>
      </div>
      <div class="login-box-body">
        <p class="login-box-msg" id="loginBoxMsg">${escapeHtml(t("sign_in_to_start"))}</p>
        <div class="form-group">
          <label for="loginMethod" style="font-weight:normal;">${escapeHtml(t("login_method") || "Innloggings­metode")}</label>
          <select class="form-control" id="loginMethod" name="loginMethod">
            <option value="email" selected>${escapeHtml(t("login_method_email") || "E-post + passord")}</option>
            <option value="phone">${escapeHtml(t("login_method_phone") || "Mobil + PIN")}</option>
          </select>
        </div>
        <div id="loginAlert" class="alert alert-danger" style="display:none;"></div>
        <form id="loginForm" data-testid="login-form">
          <!-- E-post + passord (default) -->
          <div class="form-group has-feedback" data-method="email">
            <span class="glyphicon glyphicon-envelope form-control-feedback" style="left: 0 !important;"></span>
            <input type="email" class="form-control" name="email" autocomplete="email"
                   placeholder="${escapeHtml(t("email_placeholder"))}" style="padding-left: 42.5px; padding-right: 12px;">
          </div>
          <div class="form-group has-feedback" data-method="email">
            <span class="glyphicon glyphicon-lock form-control-feedback" style="left: 0 !important;"></span>
            <input type="password" class="form-control" id="password" name="password" minlength="6" autocomplete="current-password"
                   placeholder="${escapeHtml(t("password_placeholder"))}" style="padding-left: 42.5px;">
            <span class="glyphicon glyphicon-eye-open form-control-feedback" id="viewpassword"
                  style="cursor: pointer; pointer-events: all;"></span>
          </div>

          <!-- Mobil + PIN (REQ-130) -->
          <div class="form-group has-feedback" data-method="phone" style="display:none;">
            <span class="glyphicon glyphicon-earphone form-control-feedback" style="left: 0 !important;"></span>
            <input type="tel" class="form-control" name="phone" autocomplete="tel"
                   placeholder="${escapeHtml(t("phone_placeholder") || "+47XXXXXXXX")}" style="padding-left: 42.5px;">
          </div>
          <div class="form-group has-feedback" data-method="phone" style="display:none;">
            <span class="glyphicon glyphicon-asterisk form-control-feedback" style="left: 0 !important;"></span>
            <input type="password" class="form-control" name="pin" inputmode="numeric" maxlength="6" pattern="\\d{4,6}"
                   autocomplete="one-time-code"
                   placeholder="${escapeHtml(t("pin_placeholder") || "PIN (4-6 siffer)")}" style="padding-left: 42.5px;">
          </div>

          <div class="row">
            <div class="col-xs-12">
              <button type="submit" id="loginSubmit" class="btn btn-primary btn-block btn-flat">${escapeHtml(t("sign_in"))}</button>
            </div>
          </div>
          <div class="row">
            <div class="col-xs-12">
              <div class="checkbox">
                <label>
                  <input type="checkbox" name="remember"> &nbsp; ${escapeHtml(t("keep_me_logged_in"))}
                </label>
                <a href="#/forgot-password" style="float: right;">${escapeHtml(t("forgot_password"))}</a>
              </div>
            </div>
          </div>
        </form>

        <!-- 2FA-trinn skjult inntil challenge er aktiv -->
        <form id="twoFAForm" data-testid="login-2fa-form" style="display:none;">
          <p>Skriv inn 6-sifret kode fra autentiserings-appen din, eller en backup-kode.</p>
          <div class="form-group has-feedback">
            <input type="text" class="form-control" id="twoFACode" name="code" required
                   placeholder="123456 eller xxxxx-xxxxx"
                   autocomplete="one-time-code"
                   inputmode="numeric"
                   data-testid="login-2fa-code"
                   style="padding-left: 12px;">
          </div>
          <div class="row">
            <div class="col-xs-12">
              <button type="submit" id="twoFASubmit"
                      class="btn btn-primary btn-block btn-flat"
                      data-testid="login-2fa-submit">Bekreft kode</button>
            </div>
          </div>
          <div class="row" style="margin-top:8px;">
            <div class="col-xs-12">
              <button type="button" id="twoFACancel" class="btn btn-default btn-block btn-flat"
                      data-testid="login-2fa-cancel">Avbryt</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#loginForm")!;
  const twoFAForm = root.querySelector<HTMLFormElement>("#twoFAForm")!;
  const twoFACancel = root.querySelector<HTMLButtonElement>("#twoFACancel")!;
  const twoFACode = root.querySelector<HTMLInputElement>("#twoFACode")!;
  const twoFASubmit = root.querySelector<HTMLButtonElement>("#twoFASubmit")!;
  const alert = root.querySelector<HTMLElement>("#loginAlert")!;
  const submit = root.querySelector<HTMLButtonElement>("#loginSubmit")!;
  const pwd = root.querySelector<HTMLInputElement>("#password")!;
  const eye = root.querySelector<HTMLElement>("#viewpassword")!;
  const methodSelect = root.querySelector<HTMLSelectElement>("#loginMethod")!;
  const msg = root.querySelector<HTMLElement>("#loginBoxMsg")!;

  let activeChallengeId: string | null = null;

  function showAlert(text: string): void {
    alert.textContent = text;
    alert.style.display = "";
  }

  function hideAlert(): void {
    alert.style.display = "none";
  }

  function showCredentialsStep(): void {
    activeChallengeId = null;
    form.style.display = "";
    twoFAForm.style.display = "none";
    msg.textContent = t("sign_in_to_start");
    twoFACode.value = "";
  }

  function showTwoFAStep(challengeId: string): void {
    activeChallengeId = challengeId;
    form.style.display = "none";
    twoFAForm.style.display = "";
    msg.textContent = "Bekreft med to-faktor-autentisering";
    twoFACode.value = "";
    setTimeout(() => twoFACode.focus(), 0);
  }

  function applyMethodVisibility(): void {
    const fields = root.querySelectorAll<HTMLElement>("[data-method]");
    fields.forEach((el) => {
      const elMethod = el.getAttribute("data-method") as LoginMethod;
      const visible = elMethod === method;
      el.style.display = visible ? "" : "none";
      // Toggle required-attr på input-er så HTML-validering matcher metode.
      const inputs = el.querySelectorAll<HTMLInputElement>("input");
      inputs.forEach((input) => {
        if (visible) {
          input.setAttribute("required", "required");
        } else {
          input.removeAttribute("required");
          // Tøm verdien for å unngå at usynlig data sendes ved metode-bytte.
          if (input.type !== "checkbox") input.value = "";
        }
      });
    });
  }
  applyMethodVisibility();

  methodSelect.addEventListener("change", () => {
    method = (methodSelect.value as LoginMethod) || "email";
    hideAlert();
    applyMethodVisibility();
  });

  eye.addEventListener("click", () => {
    if (eye.classList.contains("glyphicon-eye-open")) {
      pwd.type = "text";
      eye.classList.remove("glyphicon-eye-open");
      eye.classList.add("glyphicon-eye-close");
    } else {
      pwd.type = "password";
      eye.classList.remove("glyphicon-eye-close");
      eye.classList.add("glyphicon-eye-open");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();
    submit.disabled = true;
    const fd = new FormData(form);
    try {
      if (method === "phone") {
        const phone = String(fd.get("phone") ?? "").trim();
        const pin = String(fd.get("pin") ?? "").trim();
        if (!/^\d{4,6}$/.test(pin)) {
          throw new Error(t("pin_invalid") || "PIN må være 4-6 siffer.");
        }
        const session = await loginPhone(phone, pin);
        setSession(session);
      } else {
        const email = String(fd.get("email") ?? "").trim();
        const password = String(fd.get("password") ?? "");
        const result = await login(email, password);
        if (result.kind === "twoFAChallenge") {
          showTwoFAStep(result.challengeId);
          return;
        }
        setSession(result.session);
      }
      onSuccess();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t("login_failed");
      showAlert(errMsg);
    } finally {
      submit.disabled = false;
    }
  });

  twoFAForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();
    if (!activeChallengeId) {
      showCredentialsStep();
      return;
    }
    const code = twoFACode.value.trim();
    if (!code) {
      showAlert("Skriv inn koden.");
      return;
    }
    twoFASubmit.disabled = true;
    try {
      const session = await completeTwoFALogin(activeChallengeId, code);
      setSession(session);
      onSuccess();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Ugyldig kode.";
      showAlert(errMsg);
    } finally {
      twoFASubmit.disabled = false;
    }
  });

  twoFACancel.addEventListener("click", () => {
    hideAlert();
    showCredentialsStep();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
