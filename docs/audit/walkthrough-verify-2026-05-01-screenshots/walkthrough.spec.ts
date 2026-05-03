/**
 * Walkthrough verification — 2026-05-01.
 * Tests 5 bug fixes (PR #799-#803) against live prod.
 */
import { test, expect, Page, Request, Response } from "@playwright/test";

const BASE_URL = "https://spillorama-system.onrender.com";
const SCREENSHOTS_DIR = "/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/charming-fermat-ba9e69/docs/audit/walkthrough-verify-2026-05-01-screenshots";

// NOTE: Prompt said Admin123!/Demo123! but seed-demo-pilot-day.ts shows DEMO_PASSWORD="Spillorama123!"
// and agents are numbered (demo-agent-1..4@spillorama.no), not named (arnes/bodo/...).
const ADMIN = { email: "demo-admin@spillorama.no", password: "Spillorama123!" };
// Agent 1 is mapped to first hall in seed (with shift presumably). Try them all.
const AGENT_WITH_SHIFT = { email: "demo-agent-1@spillorama.no", password: "Spillorama123!" };
const AGENT_BODO = { email: "demo-agent-2@spillorama.no", password: "Spillorama123!" };

type Findings = { id: string; status: string; details: string };
const findings: Findings[] = [];
const consoleErrors: { test: string; message: string }[] = [];
const network400s: { test: string; url: string; status: number; body?: string }[] = [];

let currentTestName = "";

const allRequests: { test: string; url: string; status: number }[] = [];

function attachListeners(page: Page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ test: currentTestName, message: msg.text().slice(0, 300) });
    }
  });
  page.on("response", async (resp) => {
    if (resp.url().includes("/api/")) {
      allRequests.push({ test: currentTestName, url: resp.url(), status: resp.status() });
    }
    if (resp.status() >= 400 && resp.url().includes("/api/")) {
      let body = "";
      try { body = (await resp.text()).slice(0, 600); } catch {}
      network400s.push({ test: currentTestName, url: resp.url(), status: resp.status(), body });
    }
  });
}

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto(`${BASE_URL}/admin/`, { waitUntil: "domcontentloaded" });
  // Wait for login form
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const emailInput = page.locator('input[type="email"]').first();
  if (!(await emailInput.isVisible().catch(() => false))) {
    // Maybe already logged in?
    return false;
  }
  await emailInput.fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);

  // Wait for an /api/auth/login response after click
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") || r.url().includes("/api/agent/auth/login"),
    { timeout: 30_000 }
  ).catch(() => null);

  await page.locator('button[type="submit"], button:has-text("Logg inn")').first().click();
  const resp = await responsePromise;
  if (resp) {
    const status = resp.status();
    if (status >= 400) {
      console.log(`Login failed for ${creds.email}: ${status} ${await resp.text().catch(() => "")}`);
      return false;
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return true;
}

async function logout(page: Page) {
  await page.context().clearCookies();
  try {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch {}
  // Avoid rate-limit between role-switches
  await page.waitForTimeout(15_000);
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  attachListeners(page);
});

// ============================================================
// DEL 1 — Bug-fix verification
// ============================================================

test("Bug #1 — Rapport-Spill 1-5 sender korrekt gameType (PR #799)", async ({ page }) => {
  currentTestName = "bug1";
  const ok = await login(page, ADMIN);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug1-after-login.png`, fullPage: true });
  if (!ok) {
    findings.push({ id: "bug1", status: "🟡 LOGIN_FAILED", details: "Could not login as admin" });
    return;
  }

  // Try each /admin/#/reportGame{1..5} (hash router)
  const games = ["reportGame1", "reportGame2", "reportGame3", "reportGame5"];
  const reportNetwork400Count: Record<string, number> = {};
  for (const g of games) {
    network400s.length = 0; // reset
    await page.goto(`${BASE_URL}/admin/#/${g}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug1-${g}.png`, fullPage: true });
    const reportApi400 = network400s.filter(n => n.url.includes("/api/admin/reports/games/"));
    reportNetwork400Count[g] = reportApi400.length;
  }
  const bodyText = (await page.locator("body").textContent()) || "";
  const hasGameTypeError = bodyText.includes("gameType må være") || bodyText.includes("gameType maa være");
  const totalErrors = Object.values(reportNetwork400Count).reduce((a, b) => a + b, 0);

  findings.push({
    id: "bug1",
    status: !hasGameTypeError && totalErrors === 0 ? "✅ FIXED" : "❌ STILL BROKEN",
    details: `gameType-banner synlig: ${hasGameTypeError}; per-rute 400-count: ${JSON.stringify(reportNetwork400Count)}`
  });
});

test("Bug #2+#4+#6 — Sidebar RBAC (PR #800)", async ({ page }) => {
  // Admin first
  currentTestName = "bug2_admin";
  await logout(page);
  const okAdmin = await login(page, ADMIN);
  if (!okAdmin) {
    findings.push({ id: "bug2_4_6", status: "🟡 LOGIN_FAILED", details: "Admin login failed" });
    return;
  }
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug2-admin-sidebar.png`, fullPage: true });

  // Try to expand all sidebar groups by clicking each section header / detail button
  const sidebarHTML = await page.locator("aside, nav").first().innerHTML().catch(() => "");
  const fullHTML = await page.content();

  const adminHasMasterConsole = /Master[\s-]?konsoll|Master Console/i.test(sidebarHTML) || /\/game1\/master\/placeholder/.test(sidebarHTML);
  // Bug #6 was specifically about /agent/cashinout (the overview page that admin shouldn't see).
  // /sold-tickets is admin-OK. So check for the literal /agent/cashinout link in sidebar HTML.
  const adminHasCashInOutOverview = /href[^"]*"#?\/agent\/cashinout/.test(sidebarHTML) || /data-path[^"]*"\/agent\/cashinout"/.test(sidebarHTML);

  // Now agent
  currentTestName = "bug2_agent";
  await logout(page);
  const okAgent = await login(page, AGENT_WITH_SHIFT);
  if (!okAgent) {
    findings.push({ id: "bug2_4_6", status: "🟡 AGENT_LOGIN_FAILED", details: `admin master=${adminHasMasterConsole}, admin cashinout-overview=${adminHasCashInOutOverview}` });
    return;
  }
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug2-agent-arnes-sidebar.png`, fullPage: true });
  const agentSidebarHTML = await page.locator("aside, nav").first().innerHTML().catch(() => "");

  const agentHasPending = /\/pendingRequests|Pending Request/i.test(agentSidebarHTML);
  const agentHasRejected = /\/rejectedRequests|Rejected Request/i.test(agentSidebarHTML);
  const agentHasCashInOut = /cash[\s-]?in[\s-]?out|Kontant inn|Cash In/i.test(agentSidebarHTML);

  const allFixed = !adminHasMasterConsole && !adminHasCashInOutOverview && !agentHasPending && !agentHasRejected && agentHasCashInOut;

  findings.push({
    id: "bug2_4_6",
    status: allFixed ? "✅ FIXED" : "❌ STILL BROKEN",
    details: `Admin Master-konsoll: ${adminHasMasterConsole} (skal være false); admin /agent/cashinout-link: ${adminHasCashInOutOverview} (skal være false); agent Pending: ${agentHasPending} (skal være false); agent Rejected: ${agentHasRejected} (skal være false); agent har Kontant inn/ut: ${agentHasCashInOut} (skal være true)`
  });
});

test("Bug #3 — Agent dashboard viser hall-navn ikke UUID (PR #801)", async ({ page }) => {
  currentTestName = "bug3";
  await logout(page);
  const ok = await login(page, AGENT_WITH_SHIFT);
  if (!ok) {
    findings.push({ id: "bug3", status: "🟡 LOGIN_FAILED", details: "Agent login failed" });
    return;
  }

  // Wait for agent-context API call before navigating, to ensure session.hall is populated
  await page.waitForResponse(r => r.url().includes("/api/agent/context"), { timeout: 30_000 }).catch(() => {});
  await page.goto(`${BASE_URL}/admin/#/agent/dashboard`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(8000); // extra wait for SPA hydrate
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug3-agent-dashboard.png`, fullPage: true });

  // Inspect data-marker hall-context to see what's rendered
  const hallCtxText = await page.locator('[data-marker="hall-context"]').first().textContent().catch(() => "");
  console.log(`[bug3] data-marker=hall-context text: "${hallCtxText.replace(/\s+/g, " ").trim()}"`);

  // Inspect actual network behaviour after navigate
  const ctxResponses = network400s.filter(n => n.url.includes("/agent/context"));
  console.log(`[bug3] context 4xx responses: ${ctxResponses.length}`);
  // Dump token presence
  const tokenPresent = await page.evaluate(() => {
    return !!window.localStorage.getItem("bingo_admin_access_token");
  });
  console.log(`[bug3] token in localStorage: ${tokenPresent}`);

  // Inspect window-level session if exposed
  const sessionInfo = await page.evaluate(async () => {
    try {
      // Try fetching directly
      const token = window.localStorage.getItem("bingo_admin_access_token");
      const ctxResp = await fetch("/api/agent/context", { headers: { Authorization: `Bearer ${token}` }});
      const ctxJson = await ctxResp.json();
      return JSON.stringify({ status: ctxResp.status, hall: ctxJson?.data?.hall, assigned: ctxJson?.data?.assignedHalls?.length });
    } catch (e) { return String(e); }
  }).catch(() => "EVAL_ERR");
  console.log(`[bug3] direct /api/agent/context: ${sessionInfo}`);

  // Trigger a forced re-render by triggering hashchange (simulate)
  await page.evaluate(() => { window.location.hash = "#/agent/dashboard?refresh=1"; });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.location.hash = "#/agent/dashboard"; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug3-agent-dashboard-after-rerender.png`, fullPage: true });
  const hallCtxText2 = await page.locator('[data-marker="hall-context"]').first().textContent().catch(() => "");
  console.log(`[bug3] after rerender, hall-context: "${hallCtxText2.replace(/\s+/g, " ").trim()}"`);
  // Print all requests during this test
  const bug3Requests = allRequests.filter(r => r.test === "bug3");
  console.log(`[bug3] all api requests during test: ${bug3Requests.length}`);
  for (const r of bug3Requests) console.log(`   ${r.status} ${r.url}`);

  // Check window.__SESSION__ or anything
  const internalSession = await page.evaluate(() => {
    // @ts-ignore - exploit module-eval to get session getter
    try {
      return JSON.stringify({
        url: window.location.href,
        hasToken: !!window.localStorage.getItem("bingo_admin_access_token"),
      });
    } catch (e) { return String(e); }
  });
  console.log(`[bug3] page state: ${internalSession}`);

  const bodyText = (await page.locator("body").textContent()) || "";
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const hasUuidVisible = uuidPattern.test(bodyText);
  const hasFriendlyName = /Bingohall|Bingo Hall|Årnes|Teknobingo/i.test(bodyText);

  findings.push({
    id: "bug3",
    status: !hasUuidVisible && hasFriendlyName ? "✅ FIXED" : "❌ STILL BROKEN",
    details: `UUID synlig: ${hasUuidVisible}; hall-navn synlig: ${hasFriendlyName}; tekst-snippet: ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`
  });
});

test("Bug #5 — No-shift fallback-banner på 4 agent-sider (PR #802)", async ({ page }) => {
  currentTestName = "bug5";
  await logout(page);
  const ok = await login(page, AGENT_BODO);
  if (!ok) {
    findings.push({ id: "bug5", status: "🟡 LOGIN_FAILED", details: "Agent Bodo login failed" });
    return;
  }
  await page.waitForTimeout(2000);

  // The 4 routes per Bug #5 (PR #802). All hash-routed.
  const sites = [
    { hashPath: "/agent/players", name: "agent-players" },
    { hashPath: "/agent/sellProduct", name: "sell-products" },
    { hashPath: "/agent/orders/history", name: "order-history" },
    { hashPath: "/agent/past-winning-history", name: "past-winning" },
  ];

  const results: { site: string; usedPath: string; hasBanner: boolean; hasError: boolean; bodyHint: string }[] = [];
  for (const site of sites) {
    network400s.length = 0;
    await page.goto(`${BASE_URL}/admin/#${site.hashPath}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug5-${site.name}.png`, fullPage: true });

    const bodyText = (await page.locator("body").textContent()) || "";
    const hasBanner = /(åpne|start)\s+(et\s+|en\s+)?(skift|vakt|shift)/i.test(bodyText) || /ingen aktiv (skift|vakt)/i.test(bodyText) || /trenger.{0,30}(åpent skift|aktivt skift|skift)/i.test(bodyText);
    const has400Toast = /noe gikk galt|en feil oppsto|kunne ikke|feilet/i.test(bodyText);
    const has400Network = network400s.some(n => n.body?.includes("NO_ACTIVE_SHIFT") || n.body?.includes("SHIFT_NOT_ACTIVE"));
    const hasError = has400Toast && !hasBanner; // toast is OK if banner is also there
    results.push({ site: site.name, usedPath: site.hashPath, hasBanner, hasError, bodyHint: bodyText.slice(0, 200).replace(/\s+/g, " ") });
  }

  const allFixed = results.every(r => r.hasBanner && !r.hasError);
  const partial = results.some(r => r.hasBanner);

  findings.push({
    id: "bug5",
    status: allFixed ? "✅ FIXED" : (partial ? "🟡 PARTIAL" : "❌ STILL BROKEN"),
    details: results.map(r => `${r.site} (${r.usedPath}): banner=${r.hasBanner}, error=${r.hasError}`).join("; ")
  });
});

test("Bug #7 — Physical-ranges krever hall-filter (PR #803)", async ({ page }) => {
  currentTestName = "bug7";
  await logout(page);
  const ok = await login(page, ADMIN);
  if (!ok) {
    findings.push({ id: "bug7", status: "🟡 LOGIN_FAILED", details: "Admin login failed" });
    return;
  }
  network400s.length = 0;
  await page.goto(`${BASE_URL}/admin/#/physical/ranges`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/bug7-physical-ranges.png`, fullPage: true });

  const bodyText = (await page.locator("body").textContent()) || "";
  const hasInfoCallout = /velg (en )?hall|hall først|hall for å/i.test(bodyText);
  const hasOldError = bodyText.includes("Minst én av agentId eller hallId");
  const network400OnRanges = network400s.filter(n => n.url.includes("physical-tickets/ranges"));

  findings.push({
    id: "bug7",
    status: hasInfoCallout && !hasOldError && network400OnRanges.length === 0 ? "✅ FIXED" :
            (hasInfoCallout ? "🟡 PARTIAL" : "❌ STILL BROKEN"),
    details: `Info-callout synlig: ${hasInfoCallout}; gammel 400-banner synlig: ${hasOldError}; physical-tickets/ranges 400-count: ${network400OnRanges.length}; tekst-snippet: ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`
  });
});

// ============================================================
// DEL 2 — Walkthrough "dag-i-bingohallen" (read-only navigasjon)
// ============================================================

test("Walkthrough: Agent-portal full sweep", async ({ page }) => {
  currentTestName = "walkthrough";
  await logout(page);
  const ok = await login(page, AGENT_WITH_SHIFT);
  if (!ok) {
    findings.push({ id: "walkthrough", status: "🟡 LOGIN_FAILED", details: "Agent login failed" });
    return;
  }
  await page.waitForTimeout(2000);

  const sites = [
    { path: "/admin/#/agent/dashboard", name: "wt1-dashboard" },
    { path: "/admin/#/agent/cash-in-out", name: "wt2-cash-in-out" },
    { path: "/admin/#/agent/cashinout", name: "wt2b-cashinout-overview" },
    { path: "/admin/#/agent/unique-id", name: "wt3-unique-id" },
    { path: "/admin/#/agent/players", name: "wt4-agent-players" },
    { path: "/admin/#/agent/sellProduct", name: "wt6-sell-products" },
    { path: "/admin/#/agent/orders/history", name: "wt7-order-history" },
    { path: "/admin/#/agent/physical-cashout", name: "wt9-physical-cashout" },
    { path: "/admin/#/agent/past-winning-history", name: "wt10-past-history" },
    { path: "/admin/#/agent/sold-tickets", name: "wt11-sold-tickets" },
    { path: "/admin/#/agent/bingo-check", name: "wt12-bingo-check" },
  ];

  const wtResults: { name: string; bodyHint: string }[] = [];
  for (const site of sites) {
    await page.goto(`${BASE_URL}${site.path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/${site.name}.png`, fullPage: true });
    const bodyText = (await page.locator("body").textContent()) || "";
    wtResults.push({ name: site.name, bodyHint: bodyText.slice(0, 200).replace(/\s+/g, " ") });
  }
  findings.push({
    id: "walkthrough",
    status: "ℹ️ INFO",
    details: wtResults.map(r => `${r.name}: ${r.bodyHint.slice(0, 80)}`).join("\n        ")
  });
});

test.afterAll(async () => {
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    `${SCREENSHOTS_DIR}/findings.json`,
    JSON.stringify({ findings, consoleErrors, network400s }, null, 2)
  );
  console.log("\n=== FINDINGS ===");
  for (const f of findings) {
    console.log(`${f.id}: ${f.status}\n    ${f.details}`);
  }
  console.log(`\n=== CONSOLE ERRORS: ${consoleErrors.length} ===`);
  console.log(`=== NETWORK 4xx/5xx: ${network400s.length} ===`);
  if (network400s.length > 0) {
    console.log("Sample 400s:");
    for (const n of network400s.slice(0, 10)) {
      console.log(`  [${n.test}] ${n.status} ${n.url} → ${(n.body || "").slice(0, 150)}`);
    }
  }
});
