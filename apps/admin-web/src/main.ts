import "./styles/shell.css";
import { initI18n, t } from "./i18n/I18n.js";
import { bootstrapAuth } from "./auth/AuthGuard.js";
import { getSession, type Session } from "./auth/Session.js";
import { Router } from "./router/Router.js";
import { findRoute, type RouteDef } from "./router/routes.js";
import { mountLayout, renderLayoutChrome, type LayoutRefs } from "./shell/Layout.js";
import { renderPlaceholder, renderUnknown } from "./pages/Placeholder.js";
import { mountPreAuthRoute, parsePreAuthRoute } from "./pages/login/index.js";
import { mountLegacySection, isLegacySectionRoute } from "./pages/legacy-sections/LegacySectionMount.js";
import { isCashInOutRoute, mountCashInOutRoute } from "./pages/cash-inout/index.js";
import { isPlayerRoute, mountPlayerRoute } from "./pages/players/index.js";
import { isPendingRoute, mountPendingRoute } from "./pages/pending/index.js";
import { isRejectedRoute, mountRejectedRoute } from "./pages/rejected/index.js";
import { isBankIdRoute, mountBankIdRoute } from "./pages/bankid/index.js";
import { isTrackSpendingRoute, mountTrackSpendingRoute } from "./pages/track-spending/index.js";
import { isGamesRoute, mountGamesRoute } from "./pages/games/index.js";
import { isPhysicalTicketsRoute, mountPhysicalTicketsRoute } from "./pages/physical-tickets/index.js";
import { isUniqueIdRoute, mountUniqueIdRoute } from "./pages/unique-ids/index.js";
import { isReportRoute, mountReportRoute } from "./pages/reports/index.js";
import { isHallAccountRoute, mountHallAccountRoute } from "./pages/hallAccountReport/index.js";
import { isPayoutRoute, mountPayoutRoute } from "./pages/payout/index.js";
import { isAmountwithdrawRoute, mountAmountwithdrawRoute } from "./pages/amountwithdraw/index.js";
import { isTransactionRoute, mountTransactionRoute } from "./pages/transactions/index.js";
import { isWalletRoute, mountWalletRoute } from "./pages/wallets/index.js";
import { isProductsRoute, mountProductsRoute } from "./pages/products/index.js";
import { isSecurityRoute, mountSecurityRoute } from "./pages/security/index.js";
import { isRiskCountryRoute, mountRiskCountryRoute } from "./pages/riskCountry/index.js";
import { isLeaderboardRoute, mountLeaderboardRoute } from "./pages/leaderboard/index.js";
import { isAdminUsersRoute, mountAdminUsersRoute } from "./pages/adminUsers/index.js";
import { isRoleRoute, mountRoleRoute } from "./pages/role/index.js";
import { isHallRoute, mountHallRoute } from "./pages/hall/index.js";
import { isGroupHallRoute, mountGroupHallRoute } from "./pages/groupHall/index.js";
import { isCmsRoute, mountCmsRoute } from "./pages/cms/index.js";
import { isSettingsRoute, mountSettingsRoute } from "./pages/settings/index.js";
import { isSystemInformationRoute, mountSystemInformationRoute } from "./pages/systemInformation/index.js";
import { isOtherGamesRoute, mountOtherGamesRoute } from "./pages/otherGames/index.js";
import { mountDashboard, unmountDashboard } from "./pages/dashboard/DashboardPage.js";
import { mountAgentDashboard, unmountAgentDashboard } from "./pages/agent-dashboard/AgentDashboardPage.js";
import { mountAgentPlayers } from "./pages/agent-players/AgentPlayersPage.js";

const MAINTENANCE_MODE = false;

async function bootstrap(): Promise<void> {
  initI18n();
  const state = await bootstrapAuth();
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");

  if (state !== "authenticated") {
    showLogin(root);
    return;
  }

  const session = getSession();
  if (!session) {
    showLogin(root);
    return;
  }

  mountShell(root, session);
}

function showLogin(root: HTMLElement): void {
  const onAuthenticated = (): void => {
    const session = getSession();
    if (session) mountShell(root, session);
  };

  // PR-B7 (BIN-675): pre-auth dispatcher. When unauthenticated and the hash
  // points at /register, /forgot-password or /reset-password/:token, mount
  // the matching page instead of LoginPage. Re-dispatch on hashchange so
  // clicking e.g. "Tilbake til login" from ForgotPasswordPage updates the
  // view without a full reload.
  const render = (): void => {
    mountPreAuthRoute(root, window.location.hash, { onAuthenticated });
  };
  render();

  const onHashChange = (): void => {
    // Only re-render while still unauthenticated — once mountShell takes
    // over, it owns the hash listener (via Router) and we want to unbind.
    if (getSession()) {
      window.removeEventListener("hashchange", onHashChange);
      return;
    }
    render();
  };
  window.addEventListener("hashchange", onHashChange);
}

// Named export so tests can verify dispatcher wiring without bootstrapping.
export { parsePreAuthRoute };

function mountShell(_root: HTMLElement, session: Session): void {
  const refs = mountLayout("#app");
  const router = new Router({
    container: refs.contentHost,
    renderer: (container, route) => renderPage(container, route, session),
    onUnknown: (path, container) => {
      unmountDashboard();
      // Strip query string for routes that carry params
      // (e.g. `/agent/sellPhysicalTickets?gameId=X`, `/players/view?id=X`,
      // `/bankid/verify?sessionId=Y`, `/gameType/view/:id`).
      const bare = path.split("?")[0] ?? path;
      if (isCashInOutRoute(bare)) {
        mountCashInOutRoute(container, bare);
        return;
      }
      if (isPlayerRoute(bare)) {
        mountPlayerRoute(container, bare);
        return;
      }
      if (isPendingRoute(bare)) {
        mountPendingRoute(container, bare);
        return;
      }
      if (isRejectedRoute(bare)) {
        mountRejectedRoute(container, bare);
        return;
      }
      if (isBankIdRoute(bare)) {
        mountBankIdRoute(container, bare);
        return;
      }
      if (isTrackSpendingRoute(bare)) {
        mountTrackSpendingRoute(container, bare);
        return;
      }
      if (isGamesRoute(bare)) {
        // Dynamic games-stack routes (view/:id, edit/:id, typeId-scoped).
        mountGamesRoute(container, bare);
        return;
      }
      if (isPhysicalTicketsRoute(bare)) {
        mountPhysicalTicketsRoute(container, bare);
        return;
      }
      if (isUniqueIdRoute(bare)) {
        mountUniqueIdRoute(container, bare);
        return;
      }
      if (isReportRoute(bare)) {
        mountReportRoute(container, bare);
        return;
      }
      if (isHallAccountRoute(bare)) {
        mountHallAccountRoute(container, bare);
        return;
      }
      if (isPayoutRoute(bare)) {
        mountPayoutRoute(container, bare);
        return;
      }
      if (isAmountwithdrawRoute(bare)) {
        mountAmountwithdrawRoute(container, bare);
        return;
      }
      if (isTransactionRoute(bare)) {
        mountTransactionRoute(container, bare);
        return;
      }
      if (isWalletRoute(bare)) {
        mountWalletRoute(container, bare);
        return;
      }
      if (isProductsRoute(bare)) {
        mountProductsRoute(container, bare);
        return;
      }
      if (isSecurityRoute(bare)) {
        mountSecurityRoute(container, bare);
        return;
      }
      if (isRiskCountryRoute(bare)) {
        mountRiskCountryRoute(container, bare);
        return;
      }
      if (isLeaderboardRoute(bare)) {
        mountLeaderboardRoute(container, bare);
        return;
      }
      if (isAdminUsersRoute(bare)) {
        mountAdminUsersRoute(container, bare);
        return;
      }
      if (isRoleRoute(bare)) {
        mountRoleRoute(container, bare);
        return;
      }
      if (isHallRoute(bare)) {
        mountHallRoute(container, bare);
        return;
      }
      if (isGroupHallRoute(bare)) {
        mountGroupHallRoute(container, bare);
        return;
      }
      if (isCmsRoute(bare)) {
        mountCmsRoute(container, bare);
        return;
      }
      if (isSettingsRoute(bare)) {
        mountSettingsRoute(container, bare);
        return;
      }
      if (isSystemInformationRoute(bare)) {
        mountSystemInformationRoute(container, bare);
        return;
      }
      if (isOtherGamesRoute(bare)) {
        mountOtherGamesRoute(container, bare);
        return;
      }
      renderUnknown(container, path);
    },
    onChange: (route, path) => {
      // Stop dashboard-polling when navigating away from the dashboard route.
      if (route?.path !== "/admin" && route?.path !== "/") unmountDashboard();
      renderLayoutChrome(refs, session, route, path, MAINTENANCE_MODE);
    },
  });

  // Guard for legacy hash-less deep-links (e.g., `/admin` direct)
  if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = "#/admin";
  }

  // Initial chrome render (router.start fires onChange immediately)
  const initialPath = router.currentPath();
  const initialRoute = findRoute(initialPath);
  renderLayoutChrome(refs, session, initialRoute, initialPath, MAINTENANCE_MODE);

  router.start();

  // Auth invalidation handler
  window.addEventListener("auth:unauthorized", () => {
    window.location.hash = "#/login";
    window.location.reload();
  });

  // Global re-render on language change
  window.addEventListener("i18n:changed", () => {
    const path = router.currentPath();
    const route = findRoute(path);
    renderLayoutChrome(refs, session, route, path, MAINTENANCE_MODE);
    void renderPage(refs.contentHost, route ?? { path, titleKey: "dashboard" }, session);
  });

  // Unused but referenced for type-safety of LayoutRefs
  void (refs satisfies LayoutRefs);
}

function renderPage(container: HTMLElement, route: RouteDef, session: Session): void | Promise<void> {
  container.setAttribute("data-route", route.path);
  container.setAttribute("data-title", t(route.titleKey));
  if (route.path === "/admin" || route.path === "/") {
    return mountDashboard(container, session);
  }
  unmountDashboard();
  if (route.path !== "/agent/dashboard") {
    unmountAgentDashboard();
  }
  if (isLegacySectionRoute(route.path)) {
    mountLegacySection(container, route.path);
    return;
  }
  if (route.path === "/agent/dashboard") {
    mountAgentDashboard(container);
    return;
  }
  if (route.path === "/agent/players") {
    mountAgentPlayers(container);
    return;
  }
  if (isCashInOutRoute(route.path)) {
    mountCashInOutRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isPlayerRoute(route.path)) {
    mountPlayerRoute(container, route.path);
    return;
  }
  if (isPendingRoute(route.path)) {
    mountPendingRoute(container, route.path);
    return;
  }
  if (isRejectedRoute(route.path)) {
    mountRejectedRoute(container, route.path);
    return;
  }
  if (isBankIdRoute(route.path)) {
    mountBankIdRoute(container, route.path);
    return;
  }
  if (isTrackSpendingRoute(route.path)) {
    mountTrackSpendingRoute(container, route.path);
    return;
  }
  if (isGamesRoute(route.path)) {
    mountGamesRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isPhysicalTicketsRoute(route.path)) {
    mountPhysicalTicketsRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isUniqueIdRoute(route.path)) {
    mountUniqueIdRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isReportRoute(route.path)) {
    mountReportRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isHallAccountRoute(route.path)) {
    mountHallAccountRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isPayoutRoute(route.path)) {
    mountPayoutRoute(container, route.path);
    container.setAttribute("data-route", route.path);
    container.setAttribute("data-title", t(route.titleKey));
    return;
  }
  if (isAmountwithdrawRoute(route.path)) {
    mountAmountwithdrawRoute(container, route.path);
    return;
  }
  if (isTransactionRoute(route.path)) {
    mountTransactionRoute(container, route.path);
    return;
  }
  if (isWalletRoute(route.path)) {
    mountWalletRoute(container, route.path);
    return;
  }
  if (isProductsRoute(route.path)) {
    mountProductsRoute(container, route.path);
    return;
  }
  if (isSecurityRoute(route.path)) {
    mountSecurityRoute(container, route.path);
    return;
  }
  if (isRiskCountryRoute(route.path)) {
    mountRiskCountryRoute(container, route.path);
    return;
  }
  if (isLeaderboardRoute(route.path)) {
    mountLeaderboardRoute(container, route.path);
    return;
  }
  if (isAdminUsersRoute(route.path)) {
    mountAdminUsersRoute(container, route.path);
    return;
  }
  if (isRoleRoute(route.path)) {
    mountRoleRoute(container, route.path);
    return;
  }
  if (isHallRoute(route.path)) {
    mountHallRoute(container, route.path);
    return;
  }
  if (isGroupHallRoute(route.path)) {
    mountGroupHallRoute(container, route.path);
    return;
  }
  if (isCmsRoute(route.path)) {
    mountCmsRoute(container, route.path);
    return;
  }
  if (isSettingsRoute(route.path)) {
    mountSettingsRoute(container, route.path);
    return;
  }
  if (isSystemInformationRoute(route.path)) {
    mountSystemInformationRoute(container, route.path);
    return;
  }
  if (isOtherGamesRoute(route.path)) {
    mountOtherGamesRoute(container, route.path);
    return;
  }
  renderPlaceholder(container, route);
}

void bootstrap();
