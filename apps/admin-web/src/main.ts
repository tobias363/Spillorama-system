import "./styles/shell.css";
import { initI18n, t } from "./i18n/I18n.js";
import { bootstrapAuth } from "./auth/AuthGuard.js";
import {
  getSession,
  isAdminPanelRole,
  isAgentPortalRole,
  landingRouteForRole,
  type Session,
} from "./auth/Session.js";
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
import { isLoyaltyRoute, mountLoyaltyRoute } from "./pages/loyalty/index.js";
import { isAdminUsersRoute, mountAdminUsersRoute } from "./pages/adminUsers/index.js";
import { isRoleRoute, mountRoleRoute } from "./pages/role/index.js";
import { isHallRoute, mountHallRoute } from "./pages/hall/index.js";
import { isGroupHallRoute, mountGroupHallRoute } from "./pages/groupHall/index.js";
import { isCmsRoute, mountCmsRoute } from "./pages/cms/index.js";
import { isSettingsRoute, mountSettingsRoute } from "./pages/settings/index.js";
import { isProfileRoute, mountProfileRoute } from "./pages/profile/index.js";
import { isSystemInformationRoute, mountSystemInformationRoute } from "./pages/systemInformation/index.js";
import { isAuditLogRoute, mountAuditLogRoute } from "./pages/auditLog/index.js";
import { isOtherGamesRoute, mountOtherGamesRoute } from "./pages/otherGames/index.js";
import { mountDashboard, unmountDashboard } from "./pages/dashboard/DashboardPage.js";
import { mountAgentDashboard, unmountAgentDashboard } from "./pages/agent-dashboard/AgentDashboardPage.js";
import { mountAgentPlayers } from "./pages/agent-players/AgentPlayersPage.js";
import { mountAgentPhysicalTickets } from "./pages/agent-portal/AgentPhysicalTicketsPage.js";
import { mountAgentGames } from "./pages/agent-portal/AgentGamesPage.js";
import { mountAgentCashInOut } from "./pages/agent-portal/AgentCashInOutPage.js";
import { mountAgentUniqueId } from "./pages/agent-portal/AgentUniqueIdPage.js";
import { mountAgentPhysicalCashout } from "./pages/agent-portal/AgentPhysicalCashoutPage.js";
import { mountAgentCheckForBingo } from "./pages/agent-portal/AgentCheckForBingoPage.js";
import { isTvRoute, mountTvRoute } from "./pages/tv/index.js";

const MAINTENANCE_MODE = false;

async function bootstrap(): Promise<void> {
  initI18n();
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");

  // TV Screen + Winners: public routes utenfor auth-gate. Bingoverten åpner
  // `/admin/#/tv/<hallId>/<tvToken>` på hall-TV-skjermen; siden skal kunne
  // bootstrappe uten login. Dispatcheren re-kjører på hashchange så
  // WinnersPage↔TVScreenPage-switching fungerer uten reload.
  const dispatchTv = (): boolean => {
    const hashPath = window.location.hash.replace(/^#/, "") || "/";
    if (isTvRoute(hashPath)) {
      mountTvRoute(root, hashPath);
      return true;
    }
    return false;
  };
  if (dispatchTv()) {
    window.addEventListener("hashchange", () => {
      if (!dispatchTv()) {
        // Brukeren navigerte ut av TV-flyten — gi oppførselen videre til
        // normal bootstrap (reload er enklest siden vi aldri har løftet
        // auth-staten). Dette treffer kun hvis noen manuelt endrer hashen.
        window.location.reload();
      }
    });
    return;
  }

  const state = await bootstrapAuth();

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
    if (!session) return;
    // Role-based redirect immediately after login — AGENT/HALL_OPERATOR
    // lands on /agent/dashboard, ADMIN/super-admin lands on /admin. We
    // set the hash before mountShell() so the router's first render picks
    // up the correct route.
    const landing = landingRouteForRole(session.role);
    const currentHash = window.location.hash.replace(/^#/, "");
    const onPreAuthRoute =
      currentHash === "" ||
      currentHash === "/login" ||
      currentHash === "/register" ||
      currentHash === "/forgot-password" ||
      currentHash.startsWith("/reset-password/");
    if (onPreAuthRoute) {
      window.location.hash = `#${landing}`;
    }
    mountShell(root, session);
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
      if (isLoyaltyRoute(bare)) {
        mountLoyaltyRoute(container, bare);
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
      if (isProfileRoute(bare)) {
        mountProfileRoute(container, bare);
        return;
      }
      if (isSystemInformationRoute(bare)) {
        mountSystemInformationRoute(container, bare);
        return;
      }
      if (isAuditLogRoute(bare)) {
        mountAuditLogRoute(container, bare);
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
      // Role-guard: redirect if the hash points to a route the current role
      // isn't allowed into (AGENT/HALL_OPERATOR into /admin, ADMIN into
      // /agent/*). The guard updates window.location.hash which re-triggers
      // the router; we return early here so we don't render the forbidden
      // page before the redirect lands.
      const redirected = guardRouteForRole(path, session);
      if (redirected !== path) {
        window.location.hash = `#${redirected}`;
        return;
      }
      renderLayoutChrome(refs, session, route, path, MAINTENANCE_MODE);
    },
  });

  // Role-based landing-route: ADMIN lands on /admin, AGENT/HALL_OPERATOR
  // lands on /agent/dashboard. Respect deep-links only if they're allowed
  // for the current role (guard applied in `guardRouteForRole()` below).
  if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = `#${landingRouteForRole(session.role)}`;
  } else {
    // If the user deep-linked to a route their role can't access, redirect.
    const initialPath = router.currentPath();
    const redirected = guardRouteForRole(initialPath, session);
    if (redirected !== initialPath) {
      window.location.hash = `#${redirected}`;
    }
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

/**
 * Role-based route-guard. Returns the path the user should see — either
 * the requested path (if allowed) or the landing-route for their role.
 *
 * Policy:
 *   - ADMIN / super-admin: may visit everything EXCEPT the agent-portal-
 *     skeleton pages under /agent/dashboard, /agent/players, /agent/physical-
 *     tickets, /agent/games, /agent/cash-in-out, /agent/unique-id, and
 *     /agent/physical-cashout. Those are AGENT-only per spec. Other
 *     /agent/* routes (e.g. /agent management list at `/agent`, /agent/add,
 *     /agent/cashinout legacy) remain admin-accessible.
 *   - AGENT / hall-operator: may visit /agent/* only. /admin + every other
 *     legacy-admin route redirects back to the agent-portal landing.
 */
function guardRouteForRole(path: string, session: Session): string {
  const bare = path.split("?")[0] ?? path;
  if (isAgentPortalRole(session.role)) {
    // Agent-portal users stay inside /agent/*. /admin and / redirect to
    // their landing. Legacy /agent/* (cashinout, physicalCashOut, etc.)
    // stays accessible since those are agent-specific anyway.
    if (bare === "/" || bare === "/admin") return "/agent/dashboard";
    if (bare.startsWith("/agent/")) return path;
    // Anything else is an admin-panel route — bounce back.
    return "/agent/dashboard";
  }
  if (isAdminPanelRole(session.role)) {
    // Admin/super-admin cannot visit the dedicated agent-portal-skeleton
    // pages. They retain access to admin-side /agent routes (like /agent
    // management).
    if (AGENT_PORTAL_PATHS.has(bare)) return "/admin";
    return path;
  }
  return path;
}

/**
 * Routes that belong to the agent-portal skeleton (AGENT/HALL_OPERATOR only).
 * Does NOT include legacy admin-side /agent routes like /agent (agent-
 * management list) or /agent/add.
 */
const AGENT_PORTAL_PATHS = new Set<string>([
  "/agent/dashboard",
  "/agent/players",
  "/agent/physical-tickets",
  "/agent/games",
  "/agent/cash-in-out",
  "/agent/unique-id",
  "/agent/physical-cashout",
  "/agent/bingo-check",
]);

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
  if (route.path === "/agent/physical-tickets") {
    mountAgentPhysicalTickets(container);
    return;
  }
  if (route.path === "/agent/games") {
    mountAgentGames(container);
    return;
  }
  if (route.path === "/agent/cash-in-out") {
    mountAgentCashInOut(container);
    return;
  }
  if (route.path === "/agent/unique-id") {
    mountAgentUniqueId(container);
    return;
  }
  if (route.path === "/agent/physical-cashout") {
    mountAgentPhysicalCashout(container);
    return;
  }
  if (route.path === "/agent/bingo-check") {
    mountAgentCheckForBingo(container);
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
  if (isLoyaltyRoute(route.path)) {
    mountLoyaltyRoute(container, route.path);
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
  if (isProfileRoute(route.path)) {
    mountProfileRoute(container, route.path);
    return;
  }
  if (isSystemInformationRoute(route.path)) {
    mountSystemInformationRoute(container, route.path);
    return;
  }
  if (isAuditLogRoute(route.path)) {
    mountAuditLogRoute(container, route.path);
    return;
  }
  if (isOtherGamesRoute(route.path)) {
    mountOtherGamesRoute(container, route.path);
    return;
  }
  renderPlaceholder(container, route);
}

void bootstrap();
