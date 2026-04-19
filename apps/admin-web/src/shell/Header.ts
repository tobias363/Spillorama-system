import { t } from "../i18n/I18n.js";
import type { Session } from "../auth/Session.js";
import { apiRequest } from "../api/client.js";
import { logout } from "../api/auth.js";

interface NotificationCount {
  depositCount: number;
  withdrawCount: number;
}

export function renderHeader(container: HTMLElement, session: Session, maintenanceMode: boolean): void {
  container.innerHTML = "";
  const header = document.createElement("header");
  header.className = "main-header";

  // Logo
  const logo = document.createElement("a");
  logo.href = "#/admin";
  logo.className = "logo";
  logo.setAttribute("style", "background-color: #1a2226;");
  logo.innerHTML = `<span class="logo-mini">BG</span><span class="logo-lg">Bingo Game</span>`;
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

  if (session.role === "agent") {
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
  const avatarSrc = session.avatar ? `/profile/${session.avatar}` : "/admin/legacy-skin/img/user.png";
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

  if (session.isSuperAdmin) {
    const gearLi = document.createElement("li");
    gearLi.innerHTML = `<a href="#/settings"><i class="fa fa-gears"></i></a>`;
    ul.append(gearLi);
  }

  rightMenu.append(ul);
  nav.append(rightMenu);
  header.append(nav);
  container.append(header);
}

async function refreshNotifications(session: Session, bellLi: HTMLElement): Promise<void> {
  if (!session.hall[0]) return;
  try {
    const counts = await apiRequest<NotificationCount>(
      `/notifications/count/hall/${session.hall[0].id}`,
      { auth: true }
    );
    const total = (counts.depositCount ?? 0) + (counts.withdrawCount ?? 0);
    bellLi.querySelectorAll<HTMLElement>(".depositPendingCount").forEach((n) => (n.textContent = String(counts.depositCount ?? 0)));
    bellLi.querySelectorAll<HTMLElement>(".withdrawPendingCount").forEach((n) => (n.textContent = String(counts.withdrawCount ?? 0)));
    bellLi.querySelectorAll<HTMLElement>(".notificationsCount").forEach((n) => (n.textContent = String(total)));
  } catch {
    // silent — endpoint may not exist yet
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
