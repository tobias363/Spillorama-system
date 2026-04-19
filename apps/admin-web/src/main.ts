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
      // (e.g. `/players/view?id=X` or `/bankid/verify?sessionId=Y`).
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
  renderPlaceholder(container, route);
}

void bootstrap();
