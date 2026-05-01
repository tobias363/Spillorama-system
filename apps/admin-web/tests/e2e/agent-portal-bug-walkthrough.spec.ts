/**
 * Bug-walkthrough mot LIVE prod (https://spillorama-system.onrender.com/admin/).
 *
 * Formål: Klikk gjennom alle sidebar-modulene som ulike roller, capture
 * 4xx/5xx-responser, console-errors, "Du har ikke tilgang"-tekst, blanke
 * sider, auto-redirects og overtatte sider.
 *
 * KJØRER MOT PROD-DB. Ingen mutating actions — kun navigasjon + read.
 *
 * Run:
 *   npx playwright test apps/admin-web/tests/e2e/agent-portal-bug-walkthrough.spec.ts \
 *     --config=apps/admin-web/tests/e2e/walkthrough.config.ts \
 *     --project=chromium
 */
import { test, expect, type Page, type ConsoleMessage, type Response } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://spillorama-system.onrender.com/admin/";
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const RESULTS_FILE = path.join(__dirname, "walkthrough-results.json");

// Login-credentials per rolle
const ACCOUNTS = {
  ADMIN_DEMO: {
    label: "ADMIN-demo",
    email: "demo-admin@spillorama.no",
    password: "Spillorama123!",
    expectedLanding: "/admin",
  },
  ADMIN_TOBIAS: {
    label: "ADMIN-tobias",
    email: "tobias@nordicprofil.no",
    password: "Spillorama2026Admin!",
    expectedLanding: "/admin",
  },
  AGENT_ARNES: {
    label: "AGENT-arnes",
    email: "tobias-arnes@spillorama.no",
    password: "Spillorama2026Agent!",
    expectedLanding: "/agent/dashboard",
  },
  AGENT_BODO: {
    label: "AGENT-bodo",
    email: "agent-bodo@spillorama.no",
    password: "Spillorama2026Agent!",
    expectedLanding: "/agent/dashboard",
  },
} as const;

type AccountKey = keyof typeof ACCOUNTS;

// Sidebar-routes hentet fra apps/admin-web/src/shell/sidebarSpec.ts
// Vi tester de mest sentrale rutene per rolle.
const ADMIN_ROUTES: Array<{ id: string; path: string; label: string }> = [
  { id: "dashboard", path: "/admin", label: "Dashboard" },
  { id: "admin-ops", path: "/admin/ops", label: "Ops Console" },
  { id: "cash-inout-overview", path: "/agent/cashinout", label: "Kontant inn/ut oversikt" },
  { id: "cash-inout-sold-tickets", path: "/sold-tickets", label: "Solgte billetter" },
  { id: "game1-master-console", path: "/game1/master/placeholder", label: "Game 1 master-konsoll" },
  { id: "player", path: "/player", label: "Approved Players" },
  { id: "pendingRequests", path: "/pendingRequests", label: "Pending Requests" },
  { id: "rejectedRequests", path: "/rejectedRequests", label: "Rejected Requests" },
  { id: "schedules", path: "/schedules", label: "Schedule Management" },
  { id: "gameManagement", path: "/gameManagement", label: "Game Creation Management" },
  { id: "savedGameList", path: "/savedGameList", label: "Saved Game List" },
  { id: "addPhysicalTickets", path: "/addPhysicalTickets", label: "Add Physical Tickets" },
  { id: "physicalTicketManagement", path: "/physicalTicketManagement", label: "Physical Ticket Management" },
  { id: "physicalCashOut", path: "/physical/cash-out", label: "Physical Cash Out" },
  { id: "productList", path: "/productList", label: "Product List" },
  { id: "categoryList", path: "/categoryList", label: "Category List" },
  { id: "orderHistory", path: "/orderHistory", label: "Order History" },
  { id: "reportGame1", path: "/reportGame1", label: "Report Game 1" },
  { id: "reportManagementGame1", path: "/reportManagement/game1", label: "Report Mgmt Game 1" },
  { id: "reportGame2", path: "/reportGame2", label: "Report Game 2" },
  { id: "reportGame3", path: "/reportGame3", label: "Report Game 3" },
  { id: "reportGame4", path: "/reportGame4", label: "Report Game 4" },
  { id: "reportGame5", path: "/reportGame5", label: "Report Game 5" },
  { id: "physicalTicketReport", path: "/physicalTicketReport", label: "Physical Ticket Report" },
  { id: "uniqueGameReport", path: "/uniqueGameReport", label: "Unique Game Report" },
  { id: "redFlagCategory", path: "/redFlagCategory", label: "Red Flag Category" },
  { id: "totalRevenueReport", path: "/totalRevenueReport", label: "Total Revenue Report" },
  { id: "payoutPlayer", path: "/payoutPlayer", label: "Payout Player" },
  { id: "payoutTickets", path: "/payoutTickets", label: "Payout Tickets" },
  { id: "hallSpecificReport", path: "/hallSpecificReport", label: "Hall Specific Report" },
  { id: "wallet", path: "/wallet", label: "Wallet Management" },
  { id: "depositRequests", path: "/deposit/requests", label: "Deposit Requests" },
  { id: "depositHistory", path: "/deposit/history", label: "Deposit History" },
  { id: "transactionsLog", path: "/transactions/log", label: "Transactions Log" },
  { id: "withdrawInHall", path: "/withdraw/requests/hall", label: "Withdraw Requests Hall" },
  { id: "withdrawInBank", path: "/withdraw/requests/bank", label: "Withdraw Requests Bank" },
  { id: "withdrawHistoryHall", path: "/withdraw/history/hall", label: "Withdraw History Hall" },
  { id: "withdrawHistoryBank", path: "/withdraw/history/bank", label: "Withdraw History Bank" },
  { id: "withdrawEmails", path: "/withdraw/list/emails", label: "Withdraw Emails" },
  { id: "withdrawXmlBatches", path: "/withdraw/xml-batches", label: "Withdraw XML Batches" },
  { id: "track-spending", path: "/players/track-spending", label: "Track Spending" },
  { id: "gameType", path: "/gameType", label: "Game Type" },
  { id: "wheelOfFortune", path: "/wheelOfFortune", label: "Wheel of Fortune" },
  { id: "treasureChest", path: "/treasureChest", label: "Treasure Chest" },
  { id: "mysteryGame", path: "/mystery", label: "Mystery Game" },
  { id: "colorDraft", path: "/colorDraft", label: "Color Draft" },
  { id: "physicalCheckBingo", path: "/physical/check-bingo", label: "Check Bingo Stamp" },
  { id: "physical-import", path: "/physical/import", label: "PT Import CSV" },
  { id: "physical-range-register", path: "/physical/ranges/register", label: "PT Range Register" },
  { id: "physical-active-ranges", path: "/physical/ranges", label: "PT Active Ranges" },
  { id: "physical-pending-payouts", path: "/physical/payouts", label: "PT Pending Payouts" },
  { id: "uniqueId", path: "/uniqueId", label: "Generate Unique ID" },
  { id: "uniqueIdList", path: "/uniqueIdList", label: "Unique ID List" },
  { id: "theme", path: "/theme", label: "Theme" },
  { id: "patternMenu", path: "/patternMenu", label: "Pattern Management" },
  { id: "adminUser", path: "/adminUser", label: "Admin Management" },
  { id: "agent", path: "/agent", label: "Agent Management" },
  { id: "hall", path: "/hall", label: "Hall Management" },
  { id: "groupHall", path: "/groupHall", label: "Group of Halls" },
  { id: "role", path: "/role", label: "Role List" },
  { id: "role-matrix", path: "/role/matrix", label: "Role Matrix" },
  { id: "role-assign", path: "/role/assign", label: "Role Assign" },
  { id: "role-agent", path: "/role/agent", label: "Agent Role Permissions" },
  { id: "riskCountry", path: "/riskCountry", label: "Risk Country" },
  { id: "blockedIp", path: "/blockedIp", label: "Blocked IP" },
  { id: "hallAccountReport", path: "/hallAccountReport", label: "Hall Account Report" },
  { id: "leaderboard", path: "/leaderboard", label: "Leaderboard" },
  { id: "voucher", path: "/voucher", label: "Voucher Management" },
  { id: "loyaltyManagement", path: "/loyaltyManagement", label: "Loyalty Tier List" },
  { id: "loyaltyPlayers", path: "/loyaltyManagement/players", label: "Loyalty Players" },
  { id: "sms-advertisement", path: "/sms-advertisement", label: "SMS Advertisement" },
  { id: "cms", path: "/cms", label: "CMS Management" },
  { id: "settings", path: "/settings", label: "Settings" },
  { id: "screen-saver", path: "/screen-saver", label: "Screen Saver" },
  { id: "system-information", path: "/system/systemInformation", label: "System Information" },
  { id: "system-diagnostics", path: "/system/info", label: "System Diagnostics" },
  { id: "audit-log", path: "/auditLog", label: "Audit Log" },
  { id: "chat-moderation", path: "/admin/chat-moderation", label: "Chat Moderation" },
];

const AGENT_ROUTES: Array<{ id: string; path: string; label: string }> = [
  { id: "agent-dashboard", path: "/agent/dashboard", label: "Agent Dashboard" },
  { id: "agent-players", path: "/agent/players", label: "Agent Approved Players" },
  { id: "agent-pending", path: "/pendingRequests", label: "Pending Requests (agent)" },
  { id: "agent-rejected", path: "/rejectedRequests", label: "Rejected Requests (agent)" },
  { id: "agent-physical-tickets", path: "/agent/physical-tickets", label: "Add Physical Tickets (agent)" },
  { id: "agent-games-overview", path: "/agent/games", label: "Games Overview (agent)" },
  { id: "agent-cash-overview", path: "/agent/cash-in-out", label: "Cash In/Out (agent)" },
  { id: "agent-sell-products", path: "/agent/sellProduct", label: "Sell Products" },
  { id: "agent-order-history", path: "/agent/orders/history", label: "Order History (agent)" },
  { id: "agent-unique-id", path: "/agent/unique-id", label: "Unique ID Management" },
  { id: "agent-bingo-check", path: "/agent/bingo-check", label: "Check for Bingo" },
  { id: "agent-physical-cashout", path: "/agent/physical-cashout", label: "Physical Cashout" },
  { id: "agent-past-winning-history", path: "/agent/past-winning-history", label: "Past Winning History" },
  { id: "agent-sold-tickets", path: "/agent/sold-tickets", label: "Sold Tickets (agent)" },
];

interface NetworkErrorEvent {
  url: string;
  status: number;
  statusText: string;
  body?: string;
}

interface ConsoleErrorEvent {
  type: string;
  text: string;
  location?: string;
}

interface RouteFinding {
  account: string;
  routeId: string;
  path: string;
  label: string;
  finalUrl: string;
  redirected: boolean;
  redirectedTo: string | null;
  isBlankPage: boolean;
  hasForbiddenText: boolean;
  forbiddenTextSnippet: string | null;
  visibleErrorBanners: string[];
  consoleErrors: ConsoleErrorEvent[];
  consoleWarnings: ConsoleErrorEvent[];
  networkErrors: NetworkErrorEvent[];
  screenshotPath: string | null;
  notes: string[];
}

const allFindings: RouteFinding[] = [];

async function login(page: Page, account: typeof ACCOUNTS[AccountKey]): Promise<boolean> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  // Vent på at LoginPage er montert
  try {
    await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  } catch {
    return false;
  }
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click("#loginSubmit");
  // Vent på post-login redirect (away from login form)
  try {
    await page.waitForFunction(
      () => !document.querySelector("#loginForm") || (document.querySelector("#loginForm") as HTMLElement)?.offsetParent === null,
      { timeout: 20_000 }
    );
  } catch {
    return false;
  }
  // Gi LayoutShell tid til å montere sidebar
  await page.waitForTimeout(2000);
  return true;
}

async function visitRoute(
  page: Page,
  account: typeof ACCOUNTS[AccountKey],
  route: { id: string; path: string; label: string }
): Promise<RouteFinding> {
  const finding: RouteFinding = {
    account: account.label,
    routeId: route.id,
    path: route.path,
    label: route.label,
    finalUrl: "",
    redirected: false,
    redirectedTo: null,
    isBlankPage: false,
    hasForbiddenText: false,
    forbiddenTextSnippet: null,
    visibleErrorBanners: [],
    consoleErrors: [],
    consoleWarnings: [],
    networkErrors: [],
    screenshotPath: null,
    notes: [],
  };

  const consoleErrors: ConsoleErrorEvent[] = [];
  const consoleWarnings: ConsoleErrorEvent[] = [];
  const networkErrors: NetworkErrorEvent[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    const t = msg.type();
    const text = msg.text();
    if (t === "error") {
      consoleErrors.push({ type: t, text, location: msg.location()?.url });
    } else if (t === "warning") {
      // Filter ut støy
      if (
        text.includes("favicon") ||
        text.includes("DevTools") ||
        text.includes("Download the React DevTools") ||
        text.toLowerCase().includes("deprecat")
      ) {
        return;
      }
      consoleWarnings.push({ type: t, text, location: msg.location()?.url });
    }
  };
  const onResponse = async (resp: Response) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 400 && status < 600) {
      // Skip "favicon", static og service-worker-fetches
      if (url.includes(".png") || url.includes(".ico") || url.includes(".jpg") || url.includes(".woff")) return;
      let body: string | undefined;
      try {
        const t = await resp.text();
        body = t.length > 500 ? t.slice(0, 500) + "..." : t;
      } catch {
        body = "(could not read body)";
      }
      networkErrors.push({ url, status, statusText: resp.statusText(), body });
    }
  };

  page.on("console", onConsole);
  page.on("response", onResponse);

  try {
    // Navigate via hash
    const hashUrl = `${BASE_URL}#${route.path}`;
    await page.goto(hashUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Vent litt mer for SPA-render og polling
    await page.waitForTimeout(6000);

    finding.finalUrl = page.url();
    const expectedHash = `#${route.path}`;
    if (!finding.finalUrl.includes(expectedHash)) {
      finding.redirected = true;
      const m = finding.finalUrl.match(/#(.*)$/);
      finding.redirectedTo = m ? m[1] : null;
    }

    // Sjekk om main content er blank
    const bodyTextLength = await page.evaluate(() => {
      const main = document.querySelector("main") || document.querySelector(".content-wrapper") || document.querySelector("#root") || document.body;
      return (main?.textContent || "").trim().length;
    });
    if (bodyTextLength < 50) {
      finding.isBlankPage = true;
      finding.notes.push(`Body text length only ${bodyTextLength} chars`);
    }

    // Sjekk forbidden-tekst
    const fullText = await page.evaluate(() => document.body.textContent || "");
    const forbiddenPatterns = [
      /Du har ikke tilgang/i,
      /Forbidden/i,
      /Access denied/i,
      /Ikke autorisert/i,
      /Permission denied/i,
      /Unauthorized/i,
      /Mangler tilgang/i,
    ];
    for (const pat of forbiddenPatterns) {
      const m = fullText.match(pat);
      if (m) {
        finding.hasForbiddenText = true;
        const idx = fullText.indexOf(m[0]);
        finding.forbiddenTextSnippet = fullText.slice(Math.max(0, idx - 60), Math.min(fullText.length, idx + 120)).replace(/\s+/g, " ").trim();
        break;
      }
    }

    // Synlige error-bannere
    const errorBanners = await page.evaluate(() => {
      const sels = [
        ".alert-danger",
        ".alert-error",
        ".toast-error",
        ".error-banner",
        '[role="alert"]',
        ".text-danger",
      ];
      const out: string[] = [];
      for (const s of sels) {
        document.querySelectorAll(s).forEach(el => {
          const e = el as HTMLElement;
          if (e.offsetParent !== null) {
            const txt = (e.textContent || "").trim();
            if (txt && txt.length > 2 && txt.length < 400) out.push(`[${s}] ${txt}`);
          }
        });
      }
      return out;
    });
    finding.visibleErrorBanners = errorBanners;
    finding.consoleErrors = consoleErrors;
    finding.consoleWarnings = consoleWarnings;
    finding.networkErrors = networkErrors;

    // Screenshot
    const safeId = `${account.label}_${route.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const screenshotPath = path.join(SCREENSHOT_DIR, `${safeId}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 10_000 });
      finding.screenshotPath = path.relative(process.cwd(), screenshotPath);
    } catch (e) {
      finding.notes.push(`Screenshot failed: ${(e as Error).message}`);
    }
  } catch (e) {
    finding.notes.push(`Navigation error: ${(e as Error).message}`);
  } finally {
    page.off("console", onConsole);
    page.off("response", onResponse);
  }

  return finding;
}

function ensureDirs() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

test.describe.configure({ mode: "serial" });

for (const accountKey of Object.keys(ACCOUNTS) as AccountKey[]) {
  const account = ACCOUNTS[accountKey];
  const routes = account.expectedLanding.startsWith("/agent") ? AGENT_ROUTES : ADMIN_ROUTES;

  test(`walkthrough: ${account.label}`, async ({ page }) => {
    test.setTimeout(20 * 60_000); // 20 min for full sweep

    ensureDirs();

    const ok = await login(page, account);
    if (!ok) {
      const safe = account.label.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sp = path.join(SCREENSHOT_DIR, `${safe}_LOGIN_FAILED.png`);
      await page.screenshot({ path: sp, fullPage: true }).catch(() => {});
      allFindings.push({
        account: account.label,
        routeId: "LOGIN",
        path: "/login",
        label: "Login",
        finalUrl: page.url(),
        redirected: false,
        redirectedTo: null,
        isBlankPage: false,
        hasForbiddenText: false,
        forbiddenTextSnippet: null,
        visibleErrorBanners: [],
        consoleErrors: [],
        consoleWarnings: [],
        networkErrors: [],
        screenshotPath: path.relative(process.cwd(), sp),
        notes: ["LOGIN FAILED — could not authenticate or post-login redirect did not happen"],
      });
      // Persist what we have, then bail
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(allFindings, null, 2));
      throw new Error(`Login failed for ${account.label}`);
    }

    for (const route of routes) {
      const finding = await visitRoute(page, account, route);
      allFindings.push(finding);
      // Persist incrementally so vi ikke mister data ved crash
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(allFindings, null, 2));
    }

    // Logout via clearing storage (siden vi tester med samme account-context)
    await page.context().clearCookies();
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    });

    expect(allFindings.length).toBeGreaterThan(0);
  });
}
