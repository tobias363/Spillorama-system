/**
 * Reads walkthrough-results.json + classifies findings into severity buckets.
 *
 * Run: npx tsx apps/admin-web/tests/e2e/analyze.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_FILE = path.join(__dirname, "walkthrough-results.json");

interface NetErr {
  url: string;
  status: number;
  statusText: string;
  body?: string;
}
interface ConsoleErr {
  type: string;
  text: string;
  location?: string;
}
interface Finding {
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
  consoleErrors: ConsoleErr[];
  consoleWarnings: ConsoleErr[];
  networkErrors: NetErr[];
  screenshotPath: string | null;
  notes: string[];
}

type Sev = "critical" | "high" | "medium" | "low" | "info";

interface Issue {
  sev: Sev;
  category: string;
  finding: Finding;
  evidence: string[];
}

function classify(f: Finding): Issue[] {
  const issues: Issue[] = [];
  const expectedAdminBounce = f.account.startsWith("AGENT") && f.path !== "/agent/dashboard";
  const isAgentRoute = f.path.startsWith("/agent/");

  // 5xx network errors - always critical
  const fiveXX = f.networkErrors.filter(n => n.status >= 500);
  if (fiveXX.length) {
    issues.push({
      sev: "critical",
      category: "5xx server error",
      finding: f,
      evidence: fiveXX.slice(0, 3).map(n => `${n.status} ${n.statusText} ${n.url}${n.body ? " :: " + n.body.slice(0, 200) : ""}`),
    });
  }

  // 401/403 forbidden errors - high if expected for role, but flag visibility
  const forbidden = f.networkErrors.filter(n => n.status === 401 || n.status === 403);
  if (forbidden.length) {
    // For ADMIN accounts these are likely real bugs (admin should have access).
    const sev: Sev = f.account.startsWith("ADMIN") ? "high" : "medium";
    issues.push({
      sev,
      category: "FORBIDDEN/UNAUTHORIZED API call",
      finding: f,
      evidence: forbidden.slice(0, 5).map(n => `${n.status} ${n.url}${n.body ? " :: " + n.body.slice(0, 200) : ""}`),
    });
  }

  // 4xx other (bad request, not-found, etc.) — VISIBLE to user via banner = HIGH
  // (page is broken). Otherwise medium.
  const otherFour = f.networkErrors.filter(n => n.status >= 400 && n.status < 500 && n.status !== 401 && n.status !== 403);
  if (otherFour.length) {
    const visibleErr = f.visibleErrorBanners.length > 0;
    issues.push({
      sev: visibleErr ? "high" : "medium",
      category: `${otherFour[0].status} client error${visibleErr ? " (page broken)" : ""}`,
      finding: f,
      evidence: otherFour.slice(0, 5).map(n => `${n.status} ${n.url}${n.body ? " :: " + n.body.slice(0, 200) : ""}`),
    });
  }

  // Forbidden TEXT visible on page (not in network) - means renderer hit FORBIDDEN
  if (f.hasForbiddenText) {
    issues.push({
      sev: f.account.startsWith("ADMIN") ? "high" : "medium",
      category: "Forbidden text rendered",
      finding: f,
      evidence: [f.forbiddenTextSnippet || "(no snippet)"],
    });
  }

  // Visible error banners — already accounted for under 4xx (avoid double-count)
  // Only flag here if it's a banner WITHOUT a network error (e.g. a thrown JS error)
  if (f.visibleErrorBanners.length && !otherFour.length && !fiveXX.length) {
    issues.push({
      sev: "medium",
      category: "Visible error banner (no underlying API error)",
      finding: f,
      evidence: f.visibleErrorBanners.slice(0, 3),
    });
  }

  // Blank page
  if (f.isBlankPage && !expectedAdminBounce) {
    issues.push({
      sev: "medium",
      category: "Blank/empty content area",
      finding: f,
      evidence: f.notes,
    });
  }

  // Unexpected redirect
  if (f.redirected && !expectedAdminBounce) {
    issues.push({
      sev: "low",
      category: "Auto-redirected",
      finding: f,
      evidence: [`requested ${f.path} -> redirected to ${f.redirectedTo}`],
    });
  }

  // Console errors
  if (f.consoleErrors.length) {
    // Filter out third-party noise
    const significant = f.consoleErrors.filter(e => {
      const t = e.text.toLowerCase();
      if (t.includes("favicon")) return false;
      if (t.includes("autocomplete")) return false;
      if (t.includes("manifest")) return false;
      return true;
    });
    if (significant.length) {
      issues.push({
        sev: "low",
        category: "Console error",
        finding: f,
        evidence: significant.slice(0, 3).map(e => `${e.text} @ ${e.location || "?"}`),
      });
    }
  }

  return issues;
}

function main() {
  const raw = fs.readFileSync(RESULTS_FILE, "utf-8");
  const findings: Finding[] = JSON.parse(raw);
  console.log(`Loaded ${findings.length} findings`);

  const allIssues: Issue[] = [];
  for (const f of findings) {
    allIssues.push(...classify(f));
  }

  const buckets: Record<Sev, Issue[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  };
  for (const i of allIssues) buckets[i.sev].push(i);

  console.log("Total issues:", allIssues.length);
  for (const sev of ["critical", "high", "medium", "low", "info"] as Sev[]) {
    console.log(`  ${sev}: ${buckets[sev].length}`);
  }

  // Group by route+account to dedupe
  const grouped = new Map<string, Issue[]>();
  for (const i of allIssues) {
    const k = `${i.finding.account}::${i.finding.path}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(i);
  }

  fs.writeFileSync(
    path.join(__dirname, "issues-classified.json"),
    JSON.stringify({ summary: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), total: allIssues.length, issues: allIssues }, null, 2)
  );

  console.log("Wrote issues-classified.json");

  // Print top criticals/highs for quick triage
  console.log("\n=== CRITICAL ===");
  for (const i of buckets.critical) {
    console.log(`[${i.finding.account}] ${i.finding.path} (${i.finding.label}) — ${i.category}`);
    for (const e of i.evidence) console.log(`    ${e}`);
  }
  console.log("\n=== HIGH ===");
  for (const i of buckets.high) {
    console.log(`[${i.finding.account}] ${i.finding.path} (${i.finding.label}) — ${i.category}`);
    for (const e of i.evidence) console.log(`    ${e}`);
  }
}

main();
