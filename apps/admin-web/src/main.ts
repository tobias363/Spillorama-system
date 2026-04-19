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
    renderer: (container, route) => renderPage(container, route),
    onUnknown: (path, container) => {
      renderUnknown(container, path);
    },
    onChange: (route, path) => {
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
    void renderPage(refs.contentHost, route ?? { path, titleKey: "dashboard" });
  });

  // Unused but referenced for type-safety of LayoutRefs
  void (refs satisfies LayoutRefs);
}

function renderPage(container: HTMLElement, route: RouteDef): void | Promise<void> {
  if (isLegacySectionRoute(route.path)) {
    mountLegacySection(container, route.path);
    return;
  }
  renderPlaceholder(container, route);
  // 'loaded' marker for tests/debug
  container.setAttribute("data-route", route.path);
  container.setAttribute("data-title", t(route.titleKey));
}

void bootstrap();
