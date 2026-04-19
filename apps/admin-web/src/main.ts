import "./styles/shell.css";
import { initI18n, t } from "./i18n/I18n.js";
import { bootstrapAuth } from "./auth/AuthGuard.js";
import { getSession, type Session } from "./auth/Session.js";
import { Router } from "./router/Router.js";
import { findRoute, type RouteDef } from "./router/routes.js";
import { mountLayout, renderLayoutChrome, type LayoutRefs } from "./shell/Layout.js";
import { renderPlaceholder, renderUnknown } from "./pages/Placeholder.js";
import { renderLoginPage } from "./pages/login/LoginPage.js";
import { mountLegacySection, isLegacySectionRoute } from "./pages/legacy-sections/LegacySectionMount.js";
import { isCashInOutRoute, mountCashInOutRoute } from "./pages/cash-inout/index.js";
import { isPlayerRoute, mountPlayerRoute } from "./pages/players/index.js";
import { isPendingRoute, mountPendingRoute } from "./pages/pending/index.js";
import { isRejectedRoute, mountRejectedRoute } from "./pages/rejected/index.js";
import { isBankIdRoute, mountBankIdRoute } from "./pages/bankid/index.js";
import { isTrackSpendingRoute, mountTrackSpendingRoute } from "./pages/track-spending/index.js";
import { isGamesRoute, mountGamesRoute } from "./pages/games/index.js";
import { isPhysicalTicketsRoute, mountPhysicalTicketsRoute } from "./pages/physical-tickets/index.js";
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
import { mountDashboard, unmountDashboard } from "./pages/dashboard/DashboardPage.js";

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
  renderLoginPage(root, () => {
    const session = getSession();
    if (session) mountShell(root, session);
  });
}

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
  if (isLegacySectionRoute(route.path)) {
    mountLegacySection(container, route.path);
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
  renderPlaceholder(container, route);
}

void bootstrap();
