import { t } from "../../i18n/I18n.js";
import { login } from "../../api/auth.js";
import { setSession } from "../../auth/Session.js";

// Matches legacy/unity-backend/App/Views/login.html:36-78 pixel-near.
export function renderLoginPage(root: HTMLElement, onSuccess: () => void): void {
  root.removeAttribute("data-state");
  document.body.classList.remove("skin-blue", "sidebar-mini", "sidebar-collapse");
  document.body.classList.add("hold-transition", "login-page");

  root.innerHTML = `
    <div class="login-box">
      <div class="login-logo">
        <img class="brand-img mr-10" src="/admin/legacy-skin/img/logo.png" alt="brand" width="170px" height="140px" /><br>
        <a href="#/admin"><b>Spillorama</b></a>
      </div>
      <div class="login-box-body">
        <p class="login-box-msg">${escapeHtml(t("sign_in_to_start"))}</p>
        <div id="loginAlert" class="alert alert-danger" style="display:none;"></div>
        <form id="loginForm">
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-envelope form-control-feedback" style="left: 0 !important;"></span>
            <input type="email" class="form-control" name="email" required autocomplete="email"
                   placeholder="${escapeHtml(t("email_placeholder"))}" style="padding-left: 42.5px; padding-right: 12px;">
          </div>
          <div class="form-group has-feedback">
            <span class="glyphicon glyphicon-lock form-control-feedback" style="left: 0 !important;"></span>
            <input type="password" class="form-control" id="password" name="password" required minlength="6" autocomplete="current-password"
                   placeholder="${escapeHtml(t("password_placeholder"))}" style="padding-left: 42.5px;">
            <span class="glyphicon glyphicon-eye-open form-control-feedback" id="viewpassword"
                  style="cursor: pointer; pointer-events: all;"></span>
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
      </div>
    </div>`;

  const form = root.querySelector<HTMLFormElement>("#loginForm")!;
  const alert = root.querySelector<HTMLElement>("#loginAlert")!;
  const submit = root.querySelector<HTMLButtonElement>("#loginSubmit")!;
  const pwd = root.querySelector<HTMLInputElement>("#password")!;
  const eye = root.querySelector<HTMLElement>("#viewpassword")!;

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
    alert.style.display = "none";
    submit.disabled = true;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    try {
      const session = await login(email, password);
      setSession(session);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("login_failed");
      alert.textContent = msg;
      alert.style.display = "";
    } finally {
      submit.disabled = false;
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
