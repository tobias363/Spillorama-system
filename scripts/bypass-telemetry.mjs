#!/usr/bin/env node
/**
 * bypass-telemetry.mjs
 *
 * Fase A av ADR-0024 follow-up. Genererer ukentlig rapport over bypass-bruk
 * på tvers av alle PM-håndhevings-gates.
 *
 * Bakgrunn:
 * ADR-0024 §"Bypass-policy" satte konsolideringskriterier som krever data:
 *   - > 20% bypass-frekvens for én gate i 30 dager → for streng eller feil scope
 *   - 0% bypass + 0 blokkeringer i 60 dager → gate fanger ingenting reelt
 *
 * Uten telemetri kan ikke kriteriene utløses automatisk. Dette scriptet
 * er den manglende komponenten.
 *
 * Modus:
 *   --report             Generer Markdown-rapport for siste N dager (default 30)
 *   --json               Generer JSON output (for CI/Linear-integrasjon)
 *   --days N             Tidsvindu (default 30)
 *   --output <path>      Skriv rapport til fil
 *   --input-file <path>  Bruk JSON-fil med PR-er som input (for testing)
 *
 * Standard kjøring (henter PR-er via gh CLI):
 *   node scripts/bypass-telemetry.mjs --report --days 30 --output /tmp/bypass-30d.md
 *
 * Test/CI med pre-fetched data:
 *   gh pr list --state closed --json number,title,body,author,labels,mergedAt,headRefName --limit 500 > /tmp/prs.json
 *   node scripts/bypass-telemetry.mjs --input-file /tmp/prs.json --json
 *
 * Bruker ingen MCP eller eksterne integrasjoner — kun gh CLI + Node.
 * Designet for å kjøres i GitHub Actions cron (.github/workflows/bypass-telemetry-weekly.yml).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

// ────────────────────────────────────────────────────────────────────────
// Bypass markers — alle 17 dokumentert i ADR-0024 + denne PR
// ────────────────────────────────────────────────────────────────────────

export const BYPASS_MARKERS = [
  // PR-body markers
  {
    gate: "pm-gate",
    pattern: /\[bypass-pm-gate:\s*[^\]]+\]/i,
    location: "commit-msg",
  },
  {
    gate: "pm-gate",
    pattern: /gate-bypass:\s*\S+/i,
    location: "pr-body",
  },
  {
    gate: "pm-gate",
    pattern: /gate-not-applicable:\s*(tobias|docs-only|dependabot|ci-bot)/i,
    location: "pr-body",
  },
  {
    gate: "knowledge-protocol",
    pattern: /\[bypass-knowledge-protocol:\s*[^\]]+\]/i,
    location: "pr-body",
  },
  {
    gate: "knowledge-protocol",
    pattern: /knowledge-not-applicable:\s*\S+/i,
    location: "pr-body",
  },
  {
    gate: "delivery-report",
    pattern: /\[delivery-report-not-applicable:\s*[^\]]+\]/i,
    location: "pr-body",
  },
  {
    gate: "delta-report",
    pattern: /\[bypass-delta-report:\s*[^\]]+\]/i,
    location: "pr-body",
  },
  {
    gate: "agent-contract",
    pattern: /\[agent-contract-not-applicable:\s*[^\]]+\]/i,
    location: "pr-body",
  },
  {
    gate: "fragility-check",
    pattern: /\[bypass-fragility-check:\s*[^\]]+\]/i,
    location: "commit-msg",
  },
  {
    gate: "comprehension",
    pattern: /\[comprehension-bypass:\s*[^\]]+\]/i,
    location: "commit-msg",
  },
  {
    gate: "bug-resurrection",
    pattern: /\[resurrection-acknowledged:\s*[^\]]+\]/i,
    location: "commit-msg",
  },
  {
    gate: "intent",
    pattern: /\[bypass-intent:\s*[^\]]+\]/i,
    location: "commit-msg",
  },
];

// Labels that grant elevated bypass (require Tobias/CODEOWNER approval)
const APPROVED_BYPASS_LABELS = [
  "approved-pm-bypass",
  "approved-knowledge-bypass",
  "approved-delivery-report-bypass",
  "approved-agent-contract-bypass",
  "approved-emergency-merge",
];

// ────────────────────────────────────────────────────────────────────────
// Core analysis
// ────────────────────────────────────────────────────────────────────────

/**
 * Detect which bypasses are present in a PR body.
 * Returns array of { gate, location, marker, reason }.
 */
export function detectBypasses(body) {
  if (!body) return [];
  const found = [];
  for (const def of BYPASS_MARKERS) {
    const m = def.pattern.exec(body);
    if (m) {
      found.push({
        gate: def.gate,
        location: def.location,
        marker: m[0],
        reason: extractReason(m[0]),
      });
    }
  }
  return found;
}

function extractReason(marker) {
  // Extract content between : and end-of-marker, trimmed
  const m = /:\s*([^\]]+?)(?:\]|$)/.exec(marker);
  return m ? m[1].trim() : "";
}

/**
 * Detect approved-bypass labels.
 */
export function detectApprovedLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter((name) => APPROVED_BYPASS_LABELS.includes(name));
}

/**
 * Process raw PR list (from gh CLI) into aggregated stats.
 *
 * Input shape (per gh pr list --json):
 *   [{ number, title, body, author: { login }, labels: [{ name }],
 *      mergedAt, headRefName }]
 *
 * Returns:
 *   {
 *     totalPrs: N,
 *     bypassPrs: N,
 *     bypassRate: 0..1,
 *     perGate: { 'pm-gate': { count, prs: [#, #], topReasons: [...] }, ... },
 *     perAuthor: { 'tobias50': N, ... },
 *     consolidationFlags: [...],  // ADR-0024-trigger-warnings
 *   }
 */
export function analyzePrs(prs, options = {}) {
  const windowDays = options.windowDays || 30;
  const totalPrs = prs.length;

  const perGate = {};
  const perAuthor = {};
  const bypassPrNumbers = new Set();
  const reasonsPerGate = {};

  for (const pr of prs) {
    const bypasses = detectBypasses(pr.body || "");
    if (bypasses.length > 0) {
      bypassPrNumbers.add(pr.number);
      const author = pr.author?.login || "unknown";
      perAuthor[author] = (perAuthor[author] || 0) + 1;

      for (const b of bypasses) {
        if (!perGate[b.gate]) {
          perGate[b.gate] = { count: 0, prs: [] };
          reasonsPerGate[b.gate] = [];
        }
        perGate[b.gate].count++;
        perGate[b.gate].prs.push(pr.number);
        if (b.reason && b.reason.length > 0) {
          reasonsPerGate[b.gate].push(b.reason);
        }
      }
    }
  }

  // Top 3 reasons per gate
  for (const gate of Object.keys(perGate)) {
    const counts = {};
    for (const r of reasonsPerGate[gate]) {
      counts[r] = (counts[r] || 0) + 1;
    }
    perGate[gate].topReasons = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));
  }

  // ADR-0024 konsolideringskriterier
  const consolidationFlags = [];
  for (const [gate, stats] of Object.entries(perGate)) {
    const rate = totalPrs > 0 ? stats.count / totalPrs : 0;
    if (rate > 0.2 && windowDays <= 30) {
      consolidationFlags.push({
        gate,
        kind: "HIGH_BYPASS_RATE",
        rate,
        message: `Gate "${gate}" has ${(rate * 100).toFixed(1)}% bypass rate (${stats.count}/${totalPrs}) in last ${windowDays} days. ADR-0024 trigger: > 20% = gate may be too strict or have wrong scope.`,
      });
    }
  }

  // Check for unused gates (0% bypass + presumably 0 blocks)
  const allKnownGates = ["pm-gate", "knowledge-protocol", "delivery-report", "delta-report", "agent-contract", "fragility-check", "comprehension", "bug-resurrection", "intent"];
  if (windowDays >= 60) {
    for (const gate of allKnownGates) {
      if (!perGate[gate] || perGate[gate].count === 0) {
        consolidationFlags.push({
          gate,
          kind: "ZERO_USAGE",
          message: `Gate "${gate}" had 0 bypass uses in last ${windowDays} days. If also 0 blocks (not measured here), ADR-0024 trigger: consider removing.`,
        });
      }
    }
  }

  return {
    totalPrs,
    bypassPrs: bypassPrNumbers.size,
    bypassRate: totalPrs > 0 ? bypassPrNumbers.size / totalPrs : 0,
    perGate,
    perAuthor,
    consolidationFlags,
    windowDays,
  };
}

/**
 * Generate Markdown report.
 */
export function renderMarkdown(stats, options = {}) {
  const lines = [];
  const generated = options.generated || new Date().toISOString();
  lines.push(`# Bypass Telemetry — last ${stats.windowDays} days`);
  lines.push("");
  lines.push(`**Generated:** ${generated}`);
  lines.push(`**Total PRs:** ${stats.totalPrs}`);
  lines.push(
    `**PRs with at least one bypass:** ${stats.bypassPrs} (${(stats.bypassRate * 100).toFixed(1)}%)`,
  );
  lines.push("");

  if (stats.consolidationFlags.length > 0) {
    lines.push("## ⚠ ADR-0024 consolidation-trigger flags");
    lines.push("");
    for (const f of stats.consolidationFlags) {
      lines.push(`- **${f.kind}** [${f.gate}] — ${f.message}`);
    }
    lines.push("");
  }

  // Per-gate breakdown
  lines.push("## Per-gate breakdown");
  lines.push("");
  lines.push("| Gate | Count | Rate | Top reasons |");
  lines.push("|---|---:|---:|---|");
  const gates = Object.entries(stats.perGate).sort((a, b) => b[1].count - a[1].count);
  for (const [gate, data] of gates) {
    const rate = stats.totalPrs > 0 ? ((data.count / stats.totalPrs) * 100).toFixed(1) + "%" : "—";
    const reasons = (data.topReasons || [])
      .map((r) => `${r.reason.slice(0, 50)}${r.reason.length > 50 ? "…" : ""} (${r.count})`)
      .join(" / ");
    lines.push(`| ${gate} | ${data.count} | ${rate} | ${reasons || "—"} |`);
  }
  lines.push("");

  // Per-author breakdown
  lines.push("## Per-author bypass count");
  lines.push("");
  lines.push("| Author | Bypass PRs |");
  lines.push("|---|---:|");
  const authors = Object.entries(stats.perAuthor).sort((a, b) => b[1] - a[1]);
  for (const [author, count] of authors) {
    lines.push(`| ${author} | ${count} |`);
  }
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push("- Source: `gh pr list --state closed --json ...`");
  lines.push("- Detection: 12 PR-body and commit-msg regex-mønstre per `BYPASS_MARKERS` i `scripts/bypass-telemetry.mjs`");
  lines.push("- Konsolideringskriterier: ADR-0024 §\"Bypass-policy\"");
  lines.push("");
  lines.push("Note: This report counts PR-body markers only. Commit-msg markers (fragility-check, comprehension, bug-resurrection, intent) are detected when present in PR-body but not when only in individual commit messages within the PR. For full commit-msg coverage, use `git log --grep` separately.");

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    report: false,
    json: false,
    days: 30,
    output: null,
    inputFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") opts.report = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--days") opts.days = Number.parseInt(argv[++i], 10);
    else if (a === "--output") opts.output = argv[++i];
    else if (a === "--input-file") opts.inputFile = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

const USAGE = `Usage:
  node scripts/bypass-telemetry.mjs --report [--days 30] [--output <path>]
  node scripts/bypass-telemetry.mjs --json [--days 30]
  node scripts/bypass-telemetry.mjs --input-file <prs.json> --json
`;

function fetchPrs(days) {
  // Use gh CLI to fetch PRs merged in window
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const cmd = `gh pr list --state closed --search "is:merged merged:>${since.slice(0, 10)}" --json number,title,body,author,labels,mergedAt,headRefName --limit 500`;
  try {
    const out = execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (err) {
    process.stderr.write(`Failed to fetch PRs: ${err.message}\n`);
    process.stderr.write(`Tip: ensure gh CLI is authenticated (gh auth status).\n`);
    process.exit(2);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));

  let prs;
  if (opts.inputFile) {
    if (!existsSync(opts.inputFile)) {
      process.stderr.write(`Input file not found: ${opts.inputFile}\n`);
      process.exit(2);
    }
    prs = JSON.parse(readFileSync(opts.inputFile, "utf8"));
  } else {
    prs = fetchPrs(opts.days);
  }

  const stats = analyzePrs(prs, { windowDays: opts.days });

  let output;
  if (opts.json) {
    output = JSON.stringify(stats, null, 2);
  } else {
    output = renderMarkdown(stats);
  }

  if (opts.output) {
    writeFileSync(opts.output, output);
    process.stdout.write(`Wrote report to ${opts.output}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}
