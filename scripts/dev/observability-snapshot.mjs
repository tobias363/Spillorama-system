#!/usr/bin/env node
/**
 * Capture a read-only observability snapshot for live-test evidence.
 *
 * Sources:
 * - Sentry unresolved issues for backend/frontend
 * - PostHog event counts for the recent test window
 * - Local pilot-monitor severity lines
 * - Lightweight Postgres status counts
 *
 * Secrets are read from env or ~/.spillorama-secrets/*.env and are never
 * written to the generated JSON/Markdown reports.
 */

import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
loadLocalEnv("sentry.env");
loadLocalEnv("posthog.env");
loadLocalEnv("postgres-readonly.env");
loadLocalEnv("postgres.env");

const now = new Date();
const label = sanitizeSlug(String(args.label ?? "manual"));
const requestedWindowMinutes = Number(args["window-minutes"] ?? 60);
const windowMinutes = Number.isFinite(requestedWindowMinutes)
  ? Math.max(1, Math.round(requestedWindowMinutes))
  : 60;
const sentryStatsPeriod = String(args["sentry-stats-period"] ?? "24h");
const sentryQuery = String(args["sentry-query"] ?? "is:unresolved");
const outputDir = path.resolve(
  String(
    args["output-dir"] ??
      `docs/evidence/${dateStamp(now)}-observability-${label}-${fileStamp(now)}`,
  ),
);
const comparePath = args.compare ? path.resolve(String(args.compare)) : null;
const monitorLogPath = String(args["monitor-log"] ?? "/tmp/pilot-monitor.log");

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/dev/observability-snapshot.mjs",
  label,
  generatedAt: now.toISOString(),
  windowMinutes,
  window: {
    approxStart: new Date(now.getTime() - windowMinutes * 60_000).toISOString(),
    end: now.toISOString(),
  },
  repo: await repoMetadata(),
  credentials: credentialStatus(),
  sentry: null,
  posthog: null,
  pilotMonitor: null,
  database: null,
  comparison: null,
  output: {},
};

await fs.mkdir(outputDir, { recursive: true });

if (process.env.SENTRY_AUTH_TOKEN) {
  report.sentry = await collectSentry({
    org: process.env.SENTRY_ORG ?? "spillorama",
    baseUrl: process.env.SENTRY_BASE_URL ?? "https://sentry.io",
    token: process.env.SENTRY_AUTH_TOKEN,
    projects: parseList(process.env.SENTRY_PROJECTS ?? "spillorama-backend,spillorama-frontend"),
    query: sentryQuery,
    statsPeriod: sentryStatsPeriod,
  });
} else {
  report.sentry = { ok: false, skipped: true, reason: "SENTRY_AUTH_TOKEN missing" };
}

if (process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_HOST && process.env.POSTHOG_PROJECT_ID) {
  report.posthog = await collectPostHog({
    host: process.env.POSTHOG_HOST,
    token: process.env.POSTHOG_PERSONAL_API_KEY,
    projectId: process.env.POSTHOG_PROJECT_ID,
    windowMinutes,
  });
} else {
  report.posthog = {
    ok: false,
    skipped: true,
    reason: "POSTHOG_HOST, POSTHOG_PROJECT_ID or POSTHOG_PERSONAL_API_KEY missing",
  };
}

report.pilotMonitor = await collectPilotMonitor(monitorLogPath, report.window.approxStart);
report.database = await collectDatabase();

if (comparePath) {
  const before = JSON.parse(await fs.readFile(comparePath, "utf8"));
  report.comparison = compareReports(before, report);
}

const jsonPath = path.join(outputDir, `${fileStamp(now)}-${label}.json`);
const mdPath = path.join(outputDir, `${fileStamp(now)}-${label}.md`);
const readmePath = path.join(outputDir, "README.md");
report.output = { jsonPath, mdPath, readmePath };

await fs.writeFile(jsonPath, `${JSON.stringify(redactReport(report), null, 2)}\n`);
await fs.writeFile(mdPath, renderMarkdown(report));
await fs.writeFile(readmePath, renderEvidenceReadme(report));

console.log(
  JSON.stringify(
    {
      ok: true,
      label,
      json: jsonPath,
      markdown: mdPath,
      readme: readmePath,
      sentryOk: Boolean(report.sentry?.ok),
      posthogOk: Boolean(report.posthog?.ok),
      pilotMonitorP0P1: (report.pilotMonitor?.severityCounts?.P0 ?? 0) + (report.pilotMonitor?.severityCounts?.P1 ?? 0),
      comparison: report.comparison
        ? {
            newSentryIssues: report.comparison.sentry.newIssues.length,
            increasedSentryIssues: report.comparison.sentry.increasedIssues.length,
            posthogEventDeltas: report.comparison.posthog.eventDeltas.length,
          }
        : null,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    if (body.includes("=")) {
      const [key, ...rest] = body.split("=");
      out[key] = rest.join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[body] = argv[i + 1];
      i += 1;
    } else {
      out[body] = true;
    }
  }
  return out;
}

function loadLocalEnv(fileName) {
  const envPath = path.join(os.homedir(), ".spillorama-secrets", fileName);
  try {
    const text = readFileSync(envPath, "utf8");
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^export\s+([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key]) continue;
      process.env[key] = unquoteShellValue(raw.trim());
    }
  } catch {
    // Local secrets are optional. The report will mark missing credentials.
  }
}

function unquoteShellValue(value) {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function fileStamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function repoMetadata() {
  const root = await git(["rev-parse", "--show-toplevel"]).catch(() => process.cwd());
  return {
    root,
    branch: await git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "unknown"),
    head: await git(["rev-parse", "HEAD"]).catch(() => "unknown"),
    dirty: (await git(["status", "--short"]).catch(() => "")).trim().length > 0,
  };
}

async function git(params) {
  const { stdout } = await execFileAsync("git", params, { cwd: process.cwd(), timeout: 10_000 });
  return stdout.trim();
}

function credentialStatus() {
  return {
    sentry: {
      tokenPresent: Boolean(process.env.SENTRY_AUTH_TOKEN),
      org: process.env.SENTRY_ORG ?? "spillorama",
      projects: parseList(process.env.SENTRY_PROJECTS ?? "spillorama-backend,spillorama-frontend"),
    },
    posthog: {
      tokenPresent: Boolean(process.env.POSTHOG_PERSONAL_API_KEY),
      host: process.env.POSTHOG_HOST ?? null,
      projectId: process.env.POSTHOG_PROJECT_ID ?? null,
    },
  };
}

async function collectSentry({ org, baseUrl, token, projects, query, statsPeriod }) {
  const output = {
    ok: true,
    org,
    baseUrl,
    query,
    statsPeriod,
    projects: [],
    errors: [],
  };

  for (const project of projects) {
    try {
      const url = new URL(`/api/0/projects/${org}/${project}/issues/`, baseUrl);
      url.searchParams.set("query", query);
      url.searchParams.set("statsPeriod", statsPeriod);
      url.searchParams.set("limit", "50");
      const issues = await fetchJson(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      output.projects.push({
        slug: project,
        issues: issues.map((issue) => ({
          id: String(issue.id ?? ""),
          shortId: issue.shortId ?? null,
          title: redactText(issue.title ?? ""),
          status: issue.status ?? null,
          count: Number(issue.count ?? 0),
          firstSeen: issue.firstSeen ?? null,
          lastSeen: issue.lastSeen ?? null,
          level: issue.level ?? null,
          culprit: redactText(issue.culprit ?? ""),
          permalink: issue.permalink ?? null,
        })),
      });
    } catch (err) {
      output.ok = false;
      output.errors.push({ project, error: serializeError(err) });
    }
  }

  return output;
}

async function collectPostHog({ host, token, projectId, windowMinutes }) {
  const output = {
    ok: true,
    host: String(host).replace(/\/$/, ""),
    projectId: String(projectId),
    project: null,
    eventCounts: [],
    recentEvents: [],
    errors: [],
  };

  try {
    output.project = await posthogGet(output.host, token, `/api/projects/${projectId}/`);
  } catch (err) {
    output.ok = false;
    output.errors.push({ endpoint: "project", error: serializeError(err) });
  }

  try {
    const data = await posthogHogQl(
      output.host,
      token,
      projectId,
      `select event, count() as count, max(timestamp) as last_seen
       from events
       where timestamp >= now() - interval ${windowMinutes} minute
       group by event
       order by count desc
       limit 50`,
    );
    output.eventCounts = rowsToObjects(data.columns, data.results).map((row) => ({
      event: redactText(row.event),
      count: Number(row.count ?? 0),
      lastSeen: row.last_seen ?? null,
    }));
  } catch (err) {
    output.ok = false;
    output.errors.push({ endpoint: "eventCounts", error: serializeError(err) });
  }

  try {
    const data = await posthogHogQl(
      output.host,
      token,
      projectId,
      `select event, timestamp
       from events
       where timestamp >= now() - interval ${windowMinutes} minute
       order by timestamp desc
       limit 30`,
    );
    output.recentEvents = rowsToObjects(data.columns, data.results).map((row) => ({
      event: redactText(row.event),
      timestamp: row.timestamp ?? null,
    }));
  } catch (err) {
    output.ok = false;
    output.errors.push({ endpoint: "recentEvents", error: serializeError(err) });
  }

  if (output.project) {
    output.project = {
      id: output.project.id,
      name: output.project.name,
      timezone: output.project.timezone,
    };
  }

  return output;
}

async function posthogGet(host, token, apiPath) {
  const url = new URL(apiPath, host);
  return fetchJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

async function posthogHogQl(host, token, projectId, query) {
  const url = new URL(`/api/projects/${projectId}/query/`, host);
  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
}

function rowsToObjects(columns = [], rows = []) {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
}

async function collectPilotMonitor(logPath, sinceIso) {
  const result = {
    ok: true,
    logPath,
    sinceIso,
    exists: false,
    severityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
    p0p1: [],
    recent: [],
  };
  try {
    const text = await fs.readFile(logPath, "utf8");
    result.exists = true;
    const since = Date.parse(sinceIso);
    const lines = text.split(/\r?\n/).filter(Boolean);
    const scoped = lines.filter((line) => {
      const match = line.match(/^\[([^\]]+)\]/);
      if (!match) return true;
      return Number.isNaN(since) || Date.parse(match[1]) >= since;
    });
    for (const line of scoped) {
      const severity = line.match(/\[(P[0-3])\]/)?.[1];
      if (severity) result.severityCounts[severity] += 1;
      if (severity === "P0" || severity === "P1") result.p0p1.push(redactText(line));
    }
    result.recent = scoped.slice(-40).map(redactText);
  } catch (err) {
    result.ok = false;
    result.error = serializeError(err);
  }
  return result;
}

async function collectDatabase() {
  const databaseUrl =
    process.env.SPILLORAMA_READONLY_DATABASE_URL ??
    process.env.SPILLORAMA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    null;
  const env = {
    ...process.env,
    PGHOST: process.env.PGHOST ?? "localhost",
    PGPORT: process.env.PGPORT ?? "5432",
    PGUSER: process.env.PGUSER ?? "spillorama",
    PGPASSWORD: process.env.PGPASSWORD ?? "spillorama",
    PGDATABASE: process.env.PGDATABASE ?? "spillorama",
  };
  const queries = [
    {
      name: "pg_stat_activity",
      sql: "select state, count(*)::int from pg_stat_activity group by state order by state;",
    },
    {
      name: "game1_scheduled_status_24h",
      sql: "select status, count(*)::int from app_game1_scheduled_games where created_at >= now() - interval '24 hours' group by status order by status;",
    },
    {
      name: "game_plan_run_status_24h",
      sql: "select status, count(*)::int from app_game_plan_run where created_at >= now() - interval '24 hours' group by status order by status;",
    },
  ];
  const output = {
    ok: true,
    postgres: databaseUrl
      ? redactDatabaseUrl(databaseUrl)
      : `${env.PGUSER}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`,
    source: databaseUrl ? "database_url" : "pg_env_or_local_defaults",
    queries: [],
  };

  for (const query of queries) {
    try {
      const params = databaseUrl
        ? [databaseUrl, "-X", "-tA", "-F", "\t", "-c", query.sql]
        : ["-X", "-tA", "-F", "\t", "-c", query.sql];
      const { stdout } = await execFileAsync("psql", params, { env, timeout: 15_000 });
      output.queries.push({
        name: query.name,
        ok: true,
        rows: stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.split("\t")),
      });
    } catch (err) {
      output.ok = false;
      output.queries.push({ name: query.name, ok: false, error: serializeError(err) });
    }
  }

  return output;
}

function redactDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : "";
    const query = url.search || "";
    const user = url.username || "unknown";
    return `${url.protocol}//${url.hostname}${port}${url.pathname}${query} (user=${user})`;
  } catch {
    return "[redacted-database-url]";
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function compareReports(before, after) {
  return {
    before: {
      label: before.label,
      generatedAt: before.generatedAt,
      jsonPath: before.output?.jsonPath ?? null,
    },
    after: {
      label: after.label,
      generatedAt: after.generatedAt,
    },
    sentry: compareSentry(before.sentry, after.sentry),
    posthog: comparePostHog(before.posthog, after.posthog),
    pilotMonitor: {
      p0Delta:
        (after.pilotMonitor?.severityCounts?.P0 ?? 0) -
        (before.pilotMonitor?.severityCounts?.P0 ?? 0),
      p1Delta:
        (after.pilotMonitor?.severityCounts?.P1 ?? 0) -
        (before.pilotMonitor?.severityCounts?.P1 ?? 0),
    },
  };
}

function compareSentry(before, after) {
  const beforeIssues = sentryIssueMap(before);
  const afterIssues = sentryIssueMap(after);
  const newIssues = [];
  const increasedIssues = [];

  for (const [key, issue] of afterIssues.entries()) {
    const previous = beforeIssues.get(key);
    if (!previous) {
      newIssues.push(issue);
      continue;
    }
    const delta = Number(issue.count ?? 0) - Number(previous.count ?? 0);
    if (delta > 0) {
      increasedIssues.push({ ...issue, countDelta: delta, previousCount: previous.count });
    }
  }

  return { newIssues, increasedIssues };
}

function sentryIssueMap(sentry) {
  const map = new Map();
  for (const project of sentry?.projects ?? []) {
    for (const issue of project.issues ?? []) {
      map.set(issue.id || `${project.slug}:${issue.shortId}`, { ...issue, project: project.slug });
    }
  }
  return map;
}

function comparePostHog(before, after) {
  const beforeCounts = eventCountMap(before);
  const afterCounts = eventCountMap(after);
  const eventDeltas = [];
  for (const [event, count] of afterCounts.entries()) {
    const delta = count - (beforeCounts.get(event) ?? 0);
    if (delta > 0) {
      eventDeltas.push({ event, countDelta: delta, afterCount: count });
    }
  }
  eventDeltas.sort((a, b) => b.countDelta - a.countDelta);
  return { eventDeltas };
}

function eventCountMap(posthog) {
  const map = new Map();
  for (const row of posthog?.eventCounts ?? []) {
    map.set(row.event, Number(row.count ?? 0));
  }
  return map;
}

function redactReport(reportValue) {
  return JSON.parse(JSON.stringify(reportValue, (_key, value) => {
    if (typeof value === "string") return redactText(value);
    return value;
  }));
}

function redactText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(sntrys|phx|phc|phs)_[A-Za-z0-9_-]{16,}/g, "[redacted-token]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[redacted-ip]");
}

function serializeError(err) {
  return {
    name: err?.name ?? "Error",
    message: redactText(err?.message ?? String(err)),
  };
}

function renderMarkdown(snapshot) {
  const lines = [];
  lines.push(`# Observability Snapshot — ${snapshot.label}`);
  lines.push("");
  lines.push(`**Generated:** ${snapshot.generatedAt}`);
  lines.push(`**Event window:** last ${snapshot.windowMinutes} minutes (${snapshot.window.approxStart} → ${snapshot.window.end})`);
  lines.push(`**Git:** ${snapshot.repo.branch} @ ${String(snapshot.repo.head).slice(0, 12)}${snapshot.repo.dirty ? " (dirty)" : ""}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Sentry: ${snapshot.sentry?.ok ? "OK" : `NOT OK (${snapshot.sentry?.reason ?? "see errors"})`}`);
  lines.push(`- PostHog: ${snapshot.posthog?.ok ? "OK" : `NOT OK (${snapshot.posthog?.reason ?? "see errors"})`}`);
  lines.push(`- Pilot-monitor P0/P1: ${(snapshot.pilotMonitor?.severityCounts?.P0 ?? 0) + (snapshot.pilotMonitor?.severityCounts?.P1 ?? 0)}`);
  lines.push(`- Database snapshot: ${snapshot.database?.ok ? "OK" : "PARTIAL/FAILED"}`);
  lines.push("");

  renderSentry(lines, snapshot.sentry);
  renderPostHog(lines, snapshot.posthog);
  renderPilotMonitor(lines, snapshot.pilotMonitor);
  renderDatabase(lines, snapshot.database);
  renderComparison(lines, snapshot.comparison);

  lines.push("## Files");
  lines.push("");
  lines.push(`- JSON: \`${snapshot.output.jsonPath}\``);
  lines.push(`- Markdown: \`${snapshot.output.mdPath}\``);
  lines.push(`- README: \`${snapshot.output.readmePath}\``);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderEvidenceReadme(snapshot) {
  return `# Observability Evidence — ${snapshot.label}

**Generated:** ${snapshot.generatedAt}
**Event window:** last ${snapshot.windowMinutes} minutes
**Purpose:** Frozen Sentry/PostHog/pilot-monitor/DB snapshot for PM/live-test evidence.

## Files

- \`${path.basename(snapshot.output.mdPath)}\` — human-readable report
- \`${path.basename(snapshot.output.jsonPath)}\` — machine-readable report

## PM Notes

- Secrets were read locally from \`~/.spillorama-secrets/\`; credentials are not stored here.
- Use the JSON file with \`npm run observability:snapshot -- --compare <json>\` for after-test diffs.
- Attach this directory to agent-contracts when the test result drives P0/P1 implementation work.
`;
}

function renderSentry(lines, sentry) {
  lines.push("## Sentry");
  lines.push("");
  if (!sentry?.ok && sentry?.skipped) {
    lines.push(`Skipped: ${sentry.reason}`);
    lines.push("");
    return;
  }
  lines.push(`Query: \`${sentry?.query ?? "unknown"}\`, statsPeriod: \`${sentry?.statsPeriod ?? "unknown"}\``);
  lines.push("");
  for (const project of sentry?.projects ?? []) {
    lines.push(`### ${project.slug}`);
    lines.push("");
    if (!project.issues?.length) {
      lines.push("No matching issues.");
      lines.push("");
      continue;
    }
    lines.push("| Issue | Count | Last seen | Title |");
    lines.push("|---|---:|---|---|");
    for (const issue of project.issues.slice(0, 20)) {
      lines.push(
        `| ${issue.shortId ?? issue.id} | ${issue.count ?? 0} | ${issue.lastSeen ?? ""} | ${escapeMd(issue.title ?? "")} |`,
      );
    }
    lines.push("");
  }
}

function renderPostHog(lines, posthog) {
  lines.push("## PostHog");
  lines.push("");
  if (!posthog?.ok && posthog?.skipped) {
    lines.push(`Skipped: ${posthog.reason}`);
    lines.push("");
    return;
  }
  lines.push(`Project: ${posthog?.project?.name ?? posthog?.projectId ?? "unknown"}`);
  lines.push("");
  lines.push("| Event | Count | Last seen |");
  lines.push("|---|---:|---|");
  for (const row of posthog?.eventCounts?.slice(0, 25) ?? []) {
    lines.push(`| ${escapeMd(row.event)} | ${row.count} | ${row.lastSeen ?? ""} |`);
  }
  if (!posthog?.eventCounts?.length) lines.push("| No events | 0 | |");
  lines.push("");
}

function renderPilotMonitor(lines, monitor) {
  lines.push("## Pilot Monitor");
  lines.push("");
  lines.push(`Log: \`${monitor?.logPath ?? "unknown"}\``);
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|---|---:|");
  for (const sev of ["P0", "P1", "P2", "P3"]) {
    lines.push(`| ${sev} | ${monitor?.severityCounts?.[sev] ?? 0} |`);
  }
  lines.push("");
  if (monitor?.p0p1?.length) {
    lines.push("### P0/P1 Lines");
    lines.push("");
    lines.push("```text");
    lines.push(...monitor.p0p1.slice(-30));
    lines.push("```");
    lines.push("");
  }
}

function renderDatabase(lines, database) {
  lines.push("## Database");
  lines.push("");
  lines.push(`Postgres: \`${database?.postgres ?? "unknown"}\``);
  lines.push("");
  for (const query of database?.queries ?? []) {
    lines.push(`### ${query.name}`);
    lines.push("");
    if (!query.ok) {
      lines.push(`Failed: ${query.error?.message ?? "unknown error"}`);
      lines.push("");
      continue;
    }
    lines.push("```text");
    for (const row of query.rows) lines.push(row.join(" | "));
    if (!query.rows.length) lines.push("(no rows)");
    lines.push("```");
    lines.push("");
  }
}

function renderComparison(lines, comparison) {
  if (!comparison) return;
  lines.push("## Comparison");
  lines.push("");
  lines.push(`Compared with: ${comparison.before.label} (${comparison.before.generatedAt})`);
  lines.push("");
  lines.push("### Sentry New Issues");
  lines.push("");
  if (!comparison.sentry.newIssues.length) {
    lines.push("No new Sentry issues.");
  } else {
    lines.push("| Issue | Project | Count | Title |");
    lines.push("|---|---|---:|---|");
    for (const issue of comparison.sentry.newIssues) {
      lines.push(`| ${issue.shortId ?? issue.id} | ${issue.project} | ${issue.count} | ${escapeMd(issue.title)} |`);
    }
  }
  lines.push("");
  lines.push("### Sentry Count Increases");
  lines.push("");
  if (!comparison.sentry.increasedIssues.length) {
    lines.push("No issue count increases.");
  } else {
    lines.push("| Issue | Project | Delta | Count | Title |");
    lines.push("|---|---|---:|---:|---|");
    for (const issue of comparison.sentry.increasedIssues) {
      lines.push(
        `| ${issue.shortId ?? issue.id} | ${issue.project} | +${issue.countDelta} | ${issue.count} | ${escapeMd(issue.title)} |`,
      );
    }
  }
  lines.push("");
  lines.push("### PostHog Event Deltas");
  lines.push("");
  if (!comparison.posthog.eventDeltas.length) {
    lines.push("No positive PostHog event deltas.");
  } else {
    lines.push("| Event | Delta |");
    lines.push("|---|---:|");
    for (const row of comparison.posthog.eventDeltas.slice(0, 30)) {
      lines.push(`| ${escapeMd(row.event)} | +${row.countDelta} |`);
    }
  }
  lines.push("");
  lines.push("### Pilot Monitor Delta");
  lines.push("");
  lines.push(`- P0 delta: ${comparison.pilotMonitor.p0Delta}`);
  lines.push(`- P1 delta: ${comparison.pilotMonitor.p1Delta}`);
  lines.push("");
}

function escapeMd(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
