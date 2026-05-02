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
import {
  isChatModerationRoute,
  mountChatModerationRoute,
} from "./pages/chatModeration/index.js";
import {
  isAdminOpsRoute,
  mountAdminOpsRoute,
  unmountAdminOps,
} from "./pages/admin-ops/index.js";
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
import { renderPastGameWinningHistoryPage } from "./pages/agent-portal/PastGameWinningHistoryPage.js";
import { renderOrderHistoryPage } from "./pages/agent-portal/OrderHistoryPage.js";
import { renderSoldTicketUiPage } from "./pages/agent-portal/SoldTicketUiPage.js";
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
      const debug = (window as { __SPILL_DEBUG__?: boolean }).__SPILL_DEBUG__ !== false;
      if (debug) console.log("[router-onUnknown] path=%s — searching dispatchers", path);
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
        // Pass full `path` (incl. query string) — dispatcher needs `?typeId=`
        // for /gameManagement to render the selected game-type. The dispatcher
        // strips the query itself for route-matching. Forrige bug: `bare` ble
        // sendt så typeId alltid var undefined → dropdown hoppet tilbake til
        // "Velg Spilltype" når brukeren valgte en variant.
        mountGamesRoute(container, path);
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
      if (isChatModerationRoute(bare)) {
        mountChatModerationRoute(container, bare);
        return;
      }
      if (isAdminOpsRoute(bare)) {
        mountAdminOpsRoute(container, bare);
        return;
      }
      if (isOtherGamesRoute(bare)) {
        mountOtherGamesRoute(container, bare);
        return;
      }
      renderUnknown(container, path);
    },
    onChange: (route, path) => {
      const debug = (window as { __SPILL_DEBUG__?: boolean }).__SPILL_DEBUG__ !== false;
      if (debug) {
        console.log("[router-onChange] path=%s route=%s found=%s", path, route?.path, route ? "YES" : "NO (will fall to onUnknown)");
      }
      // Stop dashboard-polling when navigating away from the dashboard route.
      if (route?.path !== "/admin" && route?.path !== "/") unmountDashboard();
      // Dispose admin-ops socket when navigating away from /admin/ops.
      if (route?.path !== "/admin/ops") unmountAdminOps();
      // Role-guard: redirect if the hash points to a route the current role
      // isn't allowed into (AGENT/HALL_OPERATOR into /admin, ADMIN into
      // /agent/*). The guard updates window.location.hash which re-triggers
      // the router; we return early here so we don't render the forbidden
      // page before the redirect lands.
      const redirected = guardRouteForRole(path, session);
      if (redirected !== path) {
        if (debug) console.log("[router-onChange] GUARD REDIRECT %s → %s", path, redirected);
        window.location.hash = `#${redirected}`;
        return;
      }
      if (debug) console.log("[router-onChange] no redirect, rendering chrome");
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

  // FE-P0-004 (Bølge 2B pilot-blocker): Hall-context refresh.
  // ADMIN super-user / HALL_OPERATOR switches between assigned halls via
  // the impersonation banner. `setAdminActiveHall()` (Session.ts:84) fires
  // `session:admin-active-hall-changed` — but BEFORE this listener was
  // wired, the open admin page did NOT re-fetch its hall-scoped data.
  //
  // The race in audit-finding FE-P0-04: an operator on the cash-inout
  // page switches active hall, expects the page to refresh — but the
  // already-rendered DOM still shows Hall A's daily-balance numbers
  // while the hall-context has flipped to Hall B underneath. Real-money
  // downstream actions (close-day, settlement, withdraw approval) on
  // the wrong hall.
  //
  // Fix: rerender the chrome AND the page. Same pattern as `i18n:changed`.
  // Pages that use `getEffectiveHall()` at render-time (which is the
  // pattern documented in Session.ts:133) will pick up the new hall on
  // their next mount. The audit also recommends auditing pages that
  // cache hallId at mount-time — those should call getEffectiveHall()
  // each render, but the safety-net here is the full re-render.
  window.addEventListener("session:admin-active-hall-changed", () => {
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
 * Policy (Tobias 2026-04-27 — pilot-blokker):
 *   - ADMIN / super-admin: SUPER-USER. Får besøke ALLE ruter inkludert
 *     agent-portal-skeleton-sider. Disse sidene rendrer en hall-velger
 *     inline når ADMIN ikke har en primær-hall. Tidligere ble admin
 *     redirectet til `/admin` (krasjet header "Kontant inn/ut"-knappen).
 *   - AGENT / hall-operator: må holde seg inne i `/agent/*`.
 */
function guardRouteForRole(path: string, session: Session): string {
  const bare = path.split("?")[0] ?? path;
  // Debug-logging — sett window.__SPILL_DEBUG__ = false i console for å skru av
  const debug = (window as { __SPILL_DEBUG__?: boolean }).__SPILL_DEBUG__ !== false;
  if (debug) {
    console.log("[router-guard] path=%s bare=%s role=%s", path, bare, session.role);
  }
  if (isAgentPortalRole(session.role)) {
    // Agent-portal users (AGENT, HALL_OPERATOR) — landing-redirect for `/`
    // og `/admin`, men ALLE andre paths tillates. Sidebar (sidebarSpec.ts)
    // filtrerer hva AGENT ser, og backend (AdminAccessPolicy + hall-scope-
    // guards) håndhever hva de faktisk får tilgang til via RBAC.
    //
    // Pilot-fix 2026-05-01: tidligere bounce-back til /agent/dashboard på
    // alle non-/agent-paths brakk navigasjon for AGENT på sidebar-leaves
    // som peker på legacy-paths (/uniqueId, /withdraw/*, /physical/*,
    // /sold-tickets etc.). Disse er gyldige sider AGENT skal kunne åpne
    // — RBAC + hall-scope tar hand om autorisasjon serverside.
    if (bare === "/" || bare === "/admin") {
      if (debug) console.log("[router-guard] AGENT root/admin → redirect to /agent/dashboard");
      return "/agent/dashboard";
    }
    if (debug) console.log("[router-guard] AGENT path allowed → %s", path);
    return path;
  }
  if (isAdminPanelRole(session.role)) {
    // ADMIN super-user — alle ruter åpne. Agent-portal-sider rendrer en
    // hall-velger inline når admin har behov for hall-kontekst (se
    // CashInOutPage.renderAdminSuperUserBanner / Session.getEffectiveHall).
    return path;
  }
  return path;
}

function renderPage(container: HTMLElement, route: RouteDef, session: Session): void | Promise<void> {
  // Debug-logging — sett window.__SPILL_DEBUG__ = false i console for å skru av
  const debug = (window as { __SPILL_DEBUG__?: boolean }).__SPILL_DEBUG__ !== false;
  if (debug) {
    console.log("[render-page] route.path=%s titleKey=%s role=%s", route.path, route.titleKey, session.role);
  }
  container.setAttribute("data-route", route.path);
  container.setAttribute("data-title", t(route.titleKey));
  if (route.path === "/admin" || route.path === "/") {
    return mountDashboard(container, session);
  }
  unmountDashboard();
  if (route.path !== "/agent/dashboard") {
    unmountAgentDashboard();
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
  if (route.path === "/agent/past-winning-history") {
    void renderPastGameWinningHistoryPage(container);
    return;
  }
  if (route.path === "/agent/orders/history" || route.path === "/orderHistory") {
    // Wireframe §17.29 + §17.30: same OrderHistoryPage serves both agent
    // (auto-scoped to own shift) and admin / hall-operator (all sales).
    // Backend RBAC in /api/agent/orders/history handles scope.
    void renderOrderHistoryPage(container);
    return;
  }
  if (route.path === "/agent/sold-tickets-ui") {
    void renderSoldTicketUiPage(container);
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
  if (isChatModerationRoute(route.path)) {
    mountChatModerationRoute(container, route.path);
    return;
  }
  if (isAdminOpsRoute(route.path)) {
    mountAdminOpsRoute(container, route.path);
    return;
  }
  if (isOtherGamesRoute(route.path)) {
    mountOtherGamesRoute(container, route.path);
    return;
  }
  renderPlaceholder(container, route);
}

void bootstrap();
