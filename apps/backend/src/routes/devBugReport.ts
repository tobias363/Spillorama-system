/**
 * 2026-05-13 (Tobias-direktiv) — Bug-rapport-bundler-route.
 *
 * Bakgrunn:
 *   "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   informasjon" — Tobias 2026-05-13.
 *
 *   Live-monitor poller events kontinuerlig, og EventStreamer flusher
 *   klient-events til /api/_dev/debug/events. Når Tobias treffer en bug
 *   trenger PM-agenten ALT i én samlet rapport. Denne ruten bundler:
 *
 *     1. Klient-state-snapshot (fra POST-body — sendt av "Rapporter bug"-knapp)
 *     2. Siste anomalier fra /tmp/pilot-monitor.log
 *     3. Siste klient-events fra /tmp/spillorama-debug-events.jsonl
 *     4. Backend-stdout fra /tmp/spillorama-backend.log
 *     5. DB-state-dump: aktive plan-runs, scheduled-games, room-snapshots,
 *        players
 *     6. DB-audit (OBS-6 sin --quick --json)
 *     7. Sentry-issues siste 10 min (OBS-10, server- og klient-feil)
 *     8. PostHog-events siste 10 min for spillerens distinct_id (OBS-10)
 *     9. Rrweb DOM-replay-link (OBS-10)
 *    10. Auto-diagnose-heuristikker
 *
 *   Output skrives til /tmp/bug-report-<timestamp>.md slik at PM-agenten
 *   kan lese hele rapporten med ett verktøykall.
 *
 * Sikkerhet:
 *   Token-gated samme som /api/_dev/debug/events. Hvis env mangler → 503.
 *
 * Endepunkt:
 *   POST /api/_dev/debug/bug-report?token=<TOKEN>
 *
 *   Body (alt valgfritt):
 *     {
 *       title?: string,
 *       notes?: string,
 *       sessionContext?: { ... },
 *       clientState?: { ... },        // serialized client snapshot
 *       currentScreen?: string,
 *       lastUserAction?: string,
 *       lastEvents?: TrackedEvent[],  // siste N klient-events (in-memory ringbuf)
 *       url?: string,
 *       userAgent?: string,
 *     }
 *
 *   Response:
 *     200 { ok: true, data: { reportPath, timestamp, sizeBytes } }
 *     401/403 token-feil
 *     503 env ikke konfigurert
 *
 * Personvern:
 *   Klient-events er allerede sanitized i EventTracker. Vi re-sanitiser
 *   ikke — payload kommer fra trusted klient-side singleton.
 */

import express from "express";
import type { Pool } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  fetchSentryIssues,
  buildSentryFetcherConfigFromEnv,
  type SentryIssue,
  type SentryFetcherConfig,
  type FetchFn as SentryFetchFn,
} from "../observability/sentryFetcher.js";
import {
  fetchPostHogEvents,
  buildPostHogFetcherConfigFromEnv,
  buildPostHogEventsLink,
  type PostHogEvent,
  type PostHogFetcherConfig,
  type FetchFn as PostHogFetchFn,
} from "../observability/posthogFetcher.js";

export interface DevBugReportRouterDeps {
  pool: Pool;
  schema?: string;
}

interface BugReportBody {
  title?: unknown;
  notes?: unknown;
  sessionContext?: unknown;
  clientState?: unknown;
  currentScreen?: unknown;
  lastUserAction?: unknown;
  lastEvents?: unknown;
  url?: unknown;
  userAgent?: unknown;
}

/** Default lokasjon for bug-report-output. Tester kan override. */
const DEFAULT_REPORT_DIR = "/tmp";

/** Default lokasjon for pilot-monitor-log. */
const DEFAULT_PILOT_MONITOR_LOG = "/tmp/pilot-monitor.log";

/** Default lokasjon for backend-stdout-log. */
const DEFAULT_BACKEND_LOG = "/tmp/spillorama-backend.log";

/** Default lokasjon for klient-event-log. */
const DEFAULT_CLIENT_EVENT_LOG = "/tmp/spillorama-debug-events.jsonl";

/** Max linjer fra hver log som inkluderes i rapporten. */
const MAX_PILOT_MONITOR_LINES = 200;
const MAX_BACKEND_LOG_LINES = 200;
const MAX_CLIENT_EVENTS = 500;

/** Max 30 sek for audit-db-kjøring. Hvis den henger, dropper vi audit. */
const DEFAULT_AUDIT_DB_TIMEOUT_MS = 30_000;

/** OBS-10 — defaults for Sentry/PostHog/Rrweb-seksjonen.
 *
 * NB om SENTRY_STATS_PERIOD: Sentry's `statsPeriod`-felt godtar IKKE
 * minutter (vi prøvde "10m" men fikk 400 "Invalid stats_period").
 * Gyldige verdier inkluderer "1h", "24h", "14d". Vi bruker 1h som
 * en god default for "rundt bug-tidspunktet".
 */
const DEFAULT_SENTRY_STATS_PERIOD = "1h";
const DEFAULT_SENTRY_LIMIT = 25;
const DEFAULT_SENTRY_TIMEOUT_MS = 10_000;
const DEFAULT_POSTHOG_AFTER_MINUTES = 10;
const DEFAULT_POSTHOG_LIMIT = 50;
const DEFAULT_POSTHOG_TIMEOUT_MS = 10_000;
/** Hvor vi leter etter rrweb-session-filer. */
const DEFAULT_RRWEB_SESSIONS_DIR = "/tmp";
/** URL-path til den statiske replayer-siden (apps/backend/public/). */
const DEFAULT_RRWEB_REPLAYER_PATH = "/rrweb-replayer.html";

/** Default path til audit-db.mjs (kan overrides for tester). */
const DEFAULT_AUDIT_DB_SCRIPT = path.join(
  // process.cwd() ved hot-reload er apps/backend. I tester kan path overrides.
  process.cwd(),
  "scripts",
  "audit-db.mjs",
);

export interface DevBugReportRouterOptions {
  /** Output-mappe for bug-reports. Default `/tmp`. */
  reportDir?: string;
  /** Path til pilot-monitor-log. Default `/tmp/pilot-monitor.log`. */
  pilotMonitorLogPath?: string;
  /** Path til backend stdout-log. Default `/tmp/spillorama-backend.log`. */
  backendLogPath?: string;
  /** Path til klient-event-log. Default `/tmp/spillorama-debug-events.jsonl`. */
  clientEventLogPath?: string;
  /** Override clock for tester. */
  now?: () => number;
  /** Override fs for tester. */
  fsImpl?: typeof fs;
  /**
   * Path til audit-db.mjs (default: cwd/scripts/audit-db.mjs).
   * Pass `null` for å skru av DB-audit-integrasjon helt (tester).
   */
  auditDbScriptPath?: string | null;
  /** DB connection string for audit-db (default: env APP_PG_CONNECTION_STRING). */
  auditDbConnectionString?: string;
  /** Postgres schema for audit-db (default: env APP_PG_SCHEMA eller 'public'). */
  auditDbSchema?: string;
  /** Timeout for audit-db-child-process i ms (default 30 000). */
  auditDbTimeoutMs?: number;
  /**
   * OBS-10 — Sentry-fetcher-konfig. Hvis `null` skrur av Sentry-seksjonen
   * helt (tester). Hvis `undefined` bygger vi config fra env.
   */
  sentryConfig?: SentryFetcherConfig | null;
  /** Statsperiod for Sentry-issues (default "10m"). */
  sentryStatsPeriod?: string;
  /** Limit for Sentry-issues (default 25). */
  sentryLimit?: number;
  /** Timeout for Sentry-fetch i ms (default 10 000). */
  sentryTimeoutMs?: number;
  /** Sentry fetch-impl (default globalThis.fetch). */
  sentryFetchFn?: SentryFetchFn;
  /**
   * OBS-10 — PostHog-fetcher-konfig. Hvis `null` skrur av PostHog-seksjonen
   * helt (tester). Hvis `undefined` bygger vi config fra env.
   */
  posthogConfig?: PostHogFetcherConfig | null;
  /** afterMinutes for PostHog-events (default 10). */
  posthogAfterMinutes?: number;
  /** Limit for PostHog-events (default 50). */
  posthogLimit?: number;
  /** Timeout for PostHog-fetch i ms (default 10 000). */
  posthogTimeoutMs?: number;
  /** PostHog fetch-impl (default globalThis.fetch). */
  posthogFetchFn?: PostHogFetchFn;
  /** OBS-10 — sessions-dir for rrweb-session-filer (default /tmp). */
  rrwebSessionsDir?: string;
  /** OBS-10 — URL-path til replayer-siden (default /rrweb-replayer.html). */
  rrwebReplayerPath?: string;
  /**
   * OBS-10 — base-URL for replayer-link. Settes typisk fra request-host;
   * når null bygges link uten host-prefix (`/rrweb-replayer.html?...`).
   */
  rrwebBaseUrl?: string;
}

function extractToken(req: express.Request): string {
  const q = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (q) return q;
  const b = req.body as { token?: unknown } | undefined;
  if (typeof b?.token === "string") return b.token.trim();
  return "";
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env["RESET_TEST_PLAYERS_TOKEN"] ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — bug-report disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: { code: "TOKEN_REQUIRED", message: "Mangler ?token-query." },
    });
    return false;
  }
  if (provided !== expected) {
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Invalid token" },
    });
    return false;
  }
  return true;
}

/**
 * Tail siste `n` linjer fra fil. Returnerer tom array hvis fila mangler.
 * Bruker fs.readFileSync for enkelhet — vi tror filene er små nok (typisk
 * < 50 MB pga rotering).
 */
function tailFileLines(
  filePath: string,
  maxLines: number,
  fsImpl: typeof fs = fs,
): string[] {
  try {
    const content = fsImpl.readFileSync(filePath, { encoding: "utf8" });
    const lines = content.split("\n").filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    // Annet feil — logg men ikke fail hele bug-rapporten.
    console.warn(`[devBugReport] tailFileLines(${filePath}) feilet:`, err);
    return [];
  }
}

/**
 * Les klient-events fra JSONL-fil. Returnerer parsed events sortert
 * etter receivedAt (eldste først).
 */
function loadClientEvents(
  filePath: string,
  maxEvents: number,
  fsImpl: typeof fs = fs,
): Array<Record<string, unknown>> {
  try {
    const content = fsImpl.readFileSync(filePath, { encoding: "utf8" });
    const lines = content.split("\n").filter((l) => l.length > 0);
    // Ta siste N for å begrense memory.
    const tail = lines.slice(-maxEvents);
    const parsed: Array<Record<string, unknown>> = [];
    for (const line of tail) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        parsed.push(obj);
      } catch {
        // Hopp over ødelagte linjer.
      }
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    console.warn(`[devBugReport] loadClientEvents(${filePath}) feilet:`, err);
    return [];
  }
}

interface PlanRunRow {
  id: string;
  status: string;
  plan_id: string;
  master_hall_id: string | null;
  current_position: number;
  current_scheduled_game_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string | null;
  catalog_entry_id: string | null;
  plan_run_id: string | null;
  plan_position: number | null;
  scheduled_start_time: Date | string | null;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
  pause_reason: string | null;
  room_code: string | null;
}

interface PlayerRow {
  id: string;
  username: string | null;
  hall_id: string | null;
  current_balance_cents: number | null;
}

async function queryActivePlanRuns(
  pool: Pool,
  schema: string,
): Promise<{ rows: PlanRunRow[]; error: string | null }> {
  try {
    const result = await pool.query<PlanRunRow>(
      `SELECT id, status, plan_id, master_hall_id, current_position,
              current_scheduled_game_id, created_at, updated_at
       FROM ${schema}.app_game_plan_run
       WHERE status IN ('running', 'paused', 'idle')
       ORDER BY updated_at DESC
       LIMIT 50`,
    );
    return { rows: result.rows, error: null };
  } catch (err) {
    return { rows: [], error: String((err as Error).message ?? err) };
  }
}

async function queryRecentScheduledGames(
  pool: Pool,
  schema: string,
): Promise<{ rows: ScheduledGameRow[]; error: string | null }> {
  try {
    const result = await pool.query<ScheduledGameRow>(
      `SELECT id, status, master_hall_id, group_hall_id, catalog_entry_id,
              plan_run_id, plan_position, scheduled_start_time,
              actual_start_time, actual_end_time, pause_reason, room_code
       FROM ${schema}.app_game1_scheduled_games
       WHERE status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running', 'paused')
          OR (actual_end_time IS NOT NULL AND actual_end_time > NOW() - INTERVAL '1 hour')
       ORDER BY COALESCE(actual_start_time, scheduled_start_time) DESC
       LIMIT 20`,
    );
    return { rows: result.rows, error: null };
  } catch (err) {
    return { rows: [], error: String((err as Error).message ?? err) };
  }
}

async function queryRecentPlayers(
  pool: Pool,
  schema: string,
): Promise<{ rows: PlayerRow[]; error: string | null }> {
  try {
    // Best-effort — bruk app_users + tilkoblet wallet hvis schema-en støtter det.
    const result = await pool.query<PlayerRow>(
      `SELECT u.id, u.username, u.hall_id,
              w.balance_cents::int AS current_balance_cents
       FROM ${schema}.app_users u
       LEFT JOIN ${schema}.app_wallet_accounts w ON w.user_id = u.id
       WHERE u.role = 'PLAYER' AND u.is_active = true
       ORDER BY u.updated_at DESC
       LIMIT 20`,
    );
    return { rows: result.rows, error: null };
  } catch (err) {
    return { rows: [], error: String((err as Error).message ?? err) };
  }
}

/**
 * Resultat fra audit-db-child-process. Brukes for bug-report-integrasjon.
 *
 * `ok=true` betyr at scriptet kjørte uten throw (men kan ha P1-funn).
 * `ok=false` betyr at scriptet feilet (ENOENT, timeout, etc.).
 */
interface AuditDbResult {
  ok: boolean;
  error: string | null;
  /** JSON-output fra audit-db.mjs --json. Null hvis ikke kjørt. */
  report:
    | {
        timestamp: string;
        summary: {
          totalQueries: number;
          totalFindings: number;
          totalErrors: number;
          okCount: number;
          findingsByTier: { P1?: number; P2?: number; P3?: number };
        };
        results: Array<{
          id: string;
          tier: string;
          rowCount: number;
          ok: boolean;
          error: string | null;
          rows: Array<Record<string, unknown>>;
          fixAdvice?: string;
          description?: string;
        }>;
      }
    | null;
  /** Hvor lenge scriptet brukte i ms. */
  elapsedMs: number;
}

/**
 * Kjør audit-db.mjs som child_process med --quick --json og les JSON-output.
 *
 * Fail-soft: hvis scriptet ikke eksisterer, henger eller crasher, returnerer
 * vi { ok: false, error: "..." } og bug-report fortsetter uten audit-seksjon.
 *
 * Bruker DEFAULT_AUDIT_DB_TIMEOUT_MS (30s) for å unngå at bug-rapporten
 * henger i evig tid hvis audit-db har en treg query.
 */
async function runAuditDb(opts: {
  scriptPath: string;
  connectionString?: string;
  schema?: string;
  timeoutMs: number;
}): Promise<AuditDbResult> {
  const start = Date.now();

  if (!opts.scriptPath) {
    return {
      ok: false,
      error: "audit-db script path mangler",
      report: null,
      elapsedMs: 0,
    };
  }

  if (!fs.existsSync(opts.scriptPath)) {
    return {
      ok: false,
      error: `audit-db script ikke funnet på ${opts.scriptPath}`,
      report: null,
      elapsedMs: 0,
    };
  }

  return await new Promise<AuditDbResult>((resolve) => {
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;
    if (opts.connectionString) {
      env["APP_PG_CONNECTION_STRING"] = opts.connectionString;
    }
    if (opts.schema) {
      env["APP_PG_SCHEMA"] = opts.schema;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const proc = spawn(
      "node",
      [opts.scriptPath, "--json", "--quick", "--silent"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ok */
      }
      resolve({
        ok: false,
        error: `audit-db timeout etter ${opts.timeoutMs}ms`,
        report: null,
        elapsedMs: Date.now() - start,
      });
    }, opts.timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        ok: false,
        error: `audit-db spawn-feil: ${err.message}`,
        report: null,
        elapsedMs: Date.now() - start,
      });
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - start;
      // audit-db.mjs exit-codes: 0 = OK, 1 = P1-funn (men output er gyldig), 2 = error
      if (code === 2) {
        resolve({
          ok: false,
          error: `audit-db runtime-feil (exit 2): ${stderr.slice(-500)}`,
          report: null,
          elapsedMs,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ ok: true, error: null, report: parsed, elapsedMs });
      } catch (parseErr) {
        resolve({
          ok: false,
          error: `audit-db output kunne ikke parses som JSON: ${String((parseErr as Error).message)}`,
          report: null,
          elapsedMs,
        });
      }
    });
  });
}

/**
 * Bygg markdown-seksjonen for audit-db-funn. Returnerer tom streng-array
 * hvis audit-db ikke ble kjørt eller feilet (caller logger advarsel).
 */
function buildAuditDbSection(result: AuditDbResult): string[] {
  const lines: string[] = [];
  lines.push("## 🗄️ DB-audit (quick)");
  lines.push("");

  if (!result.ok) {
    lines.push(`⚠️ DB-audit kjørte ikke: ${result.error ?? "(ukjent feil)"}`);
    lines.push("");
    return lines;
  }
  if (!result.report) {
    lines.push("⚠️ DB-audit returnerte ingen data.");
    lines.push("");
    return lines;
  }

  const r = result.report;
  lines.push(
    `**Quick-audit:** ${r.summary.totalQueries} queries kjørt, ${result.elapsedMs}ms total.`,
  );
  lines.push(
    `**Funn:** P1×${r.summary.findingsByTier.P1 ?? 0}, P2×${r.summary.findingsByTier.P2 ?? 0}, P3×${r.summary.findingsByTier.P3 ?? 0}`,
  );
  if (r.summary.totalErrors > 0) {
    lines.push(`**⚠️ Query-feil:** ${r.summary.totalErrors}`);
  }
  lines.push("");

  const findings = r.results.filter((x) => x.ok && x.rowCount > 0);
  if (findings.length === 0) {
    lines.push("_Ingen funn — DB-helse OK på alle quick-queries._");
    lines.push("");
    return lines;
  }

  // Render funn sortert P1 → P2 → P3
  const tierRank: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
  findings.sort(
    (a, b) =>
      (tierRank[a.tier] ?? 99) - (tierRank[b.tier] ?? 99) ||
      b.rowCount - a.rowCount,
  );

  for (const f of findings) {
    lines.push(`### ${f.id} (${f.tier}) — ${f.rowCount} rader`);
    lines.push("");
    if (f.description) {
      lines.push(f.description);
      lines.push("");
    }
    // Render første 5 rader som JSON for kompakt visning
    const sample = f.rows.slice(0, 5);
    if (sample.length > 0) {
      lines.push("```json");
      lines.push(JSON.stringify(sample, null, 2));
      lines.push("```");
      if (f.rows.length > sample.length) {
        lines.push(`_(viser ${sample.length} av ${f.rowCount} rader)_`);
      }
      lines.push("");
    }
    if (f.fixAdvice) {
      lines.push(`**Fix:** ${f.fixAdvice}`);
      lines.push("");
    }
  }

  const failed = r.results.filter((x) => !x.ok);
  if (failed.length > 0) {
    lines.push(`**Query-feil:**`);
    for (const x of failed) {
      lines.push(`- \`${x.id}\`: ${x.error}`);
    }
    lines.push("");
  }

  return lines;
}

/**
 * OBS-10 — Bygg Sentry-seksjonen. Inkluderer tagging-filter på user.id /
 * hall_id når disse er tilgjengelige i sessionContext.
 *
 * `issues` blir tom ved enhver feil (fetcher er fail-soft), så denne
 * funksjonen rendrer alltid ut markdown — enten med data eller en
 * "ingen issues"-melding.
 */
function buildSentryIssuesSection(args: {
  issues: SentryIssue[];
  statsPeriod: string;
  config: SentryFetcherConfig | null;
  userId: string | null;
  hallId: string | null;
  fetchSkipped: boolean;
}): string[] {
  const lines: string[] = [];
  const filterParts: string[] = [];
  if (args.userId) filterParts.push(`user.id=${args.userId}`);
  if (args.hallId) filterParts.push(`hall_id=${args.hallId}`);
  const filterStr =
    filterParts.length > 0 ? `, filtrert på ${filterParts.join(" + ")}` : "";

  lines.push(`## 🛰️ Sentry-issues (siste ${args.statsPeriod}${filterStr})`);
  lines.push("");

  if (args.fetchSkipped || !args.config) {
    lines.push(
      "_Sentry-fetch hoppet over — SENTRY_AUTH_TOKEN/SENTRY_ORG ikke konfigurert i `apps/backend/.env.local`._",
    );
    lines.push("");
    return lines;
  }

  if (args.issues.length === 0) {
    lines.push(
      "_Ingen issues funnet i periode/filter — eller fetch feilet (sjekk backend-stdout for warn)._",
    );
    lines.push("");
    return lines;
  }

  for (const issue of args.issues) {
    const tagPreview = issue.tags
      .slice(0, 6)
      .map((t) => `${t.key}=${t.value}`)
      .join(", ");
    lines.push(`- **[${issue.shortId || issue.id}]** ${issue.title}`);
    if (issue.culprit) {
      lines.push(`  - Culprit: \`${issue.culprit}\``);
    }
    lines.push(`  - Level: ${issue.level} · Count: ${issue.count}`);
    if (issue.lastSeen) {
      lines.push(`  - Last seen: ${issue.lastSeen}`);
    }
    if (tagPreview) {
      lines.push(`  - Tags: ${tagPreview}`);
    }
    if (issue.permalink) {
      lines.push(`  - Sentry: ${issue.permalink}`);
    }
  }
  lines.push("");
  return lines;
}

/**
 * OBS-10 — Bygg PostHog-seksjonen. Tabell + dashboard-link.
 */
function buildPostHogSection(args: {
  events: PostHogEvent[];
  config: PostHogFetcherConfig | null;
  distinctId: string | null;
  afterMinutes: number;
  fetchSkipped: boolean;
}): string[] {
  const lines: string[] = [];
  const target = args.distinctId
    ? `distinct_id=${args.distinctId}`
    : "alle distinct_ids";

  lines.push(`## 📊 PostHog-events (siste ${args.afterMinutes} min, ${target})`);
  lines.push("");

  if (args.fetchSkipped || !args.config) {
    lines.push(
      "_PostHog-fetch hoppet over — POSTHOG_PERSONAL_API_KEY/POSTHOG_PROJECT_ID ikke konfigurert i `apps/backend/.env.local`._",
    );
    lines.push("");
    return lines;
  }

  if (args.events.length === 0) {
    lines.push(
      "_Ingen events funnet i periode/filter — eller fetch feilet (sjekk backend-stdout for warn)._",
    );
    lines.push("");
    // Likevel — tilby dashbord-link så PM kan utforske manuelt
    if (args.config) {
      const link = buildPostHogEventsLink(args.config, {
        distinctId: args.distinctId ?? undefined,
      });
      lines.push(`PostHog: ${link}`);
      lines.push("");
    }
    return lines;
  }

  lines.push("| Timestamp | Event | Properties (preview) |");
  lines.push("|---|---|---|");
  for (const ev of args.events) {
    const ts = (ev.timestamp ?? "").slice(11, 19) || "—";
    // Compact JSON i tabellen — trunkér til 120 tegn så markdown ikke
    // sprenger linjebredden.
    let propsPreview = "";
    try {
      propsPreview = JSON.stringify(ev.properties ?? {});
    } catch {
      propsPreview = "(unserializable)";
    }
    if (propsPreview.length > 120) {
      propsPreview = `${propsPreview.slice(0, 117)}...`;
    }
    // Escape pipes så markdown-tabellen ikke brytes.
    const escapedProps = propsPreview.replace(/\|/g, "\\|");
    lines.push(`| ${ts} | \`${ev.event}\` | \`${escapedProps}\` |`);
  }
  lines.push("");

  const link = buildPostHogEventsLink(args.config, {
    distinctId: args.distinctId ?? undefined,
  });
  lines.push(`PostHog: ${link}`);
  lines.push("");
  return lines;
}

/**
 * OBS-10 — Discover rrweb-session-id og bygg replay-link.
 *
 * Strategi:
 *   1. Hvis klienten har sendt `sessionContext.rrwebSessionId`, bruk den.
 *   2. Ellers se etter `/tmp/rrweb-session-*.jsonl` der filnavn-id
 *      matcher noen del av `userId` eller `playerId` fra sessionContext.
 *      Fallback til siste-modifiserte session-fil.
 */
function discoverRrwebSessionId(args: {
  sessionContext: Record<string, unknown> | null;
  sessionsDir: string;
  fsImpl: typeof fs;
}): string | null {
  // 1. Eksplisitt fra klient
  const ctx = args.sessionContext;
  if (ctx) {
    const explicit = ctx["rrwebSessionId"];
    if (typeof explicit === "string" && explicit.trim().length > 0) {
      return explicit.trim();
    }
  }

  // 2. Lookup på disk
  let entries: string[] = [];
  try {
    entries = args.fsImpl.readdirSync(args.sessionsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(
        `[devBugReport] readdir(${args.sessionsDir}) feilet:`,
        err,
      );
    }
    return null;
  }
  const sessionFiles = entries.filter(
    (n) => n.startsWith("rrweb-session-") && n.endsWith(".jsonl"),
  );
  if (sessionFiles.length === 0) {
    return null;
  }

  // Sorter etter mtime descending (nyeste først).
  type FileMtime = { name: string; mtimeMs: number };
  const withMtime: FileMtime[] = [];
  for (const name of sessionFiles) {
    try {
      const st = args.fsImpl.statSync(path.join(args.sessionsDir, name));
      withMtime.push({ name, mtimeMs: st.mtimeMs });
    } catch {
      /* ignorer */
    }
  }
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (withMtime.length === 0) return null;

  const newestFirst = withMtime[0];
  if (!newestFirst) return null;

  // Default: bare bruk nyeste (sikrest når vi ikke har explicit hint).
  const newest = newestFirst.name;
  const match = /^rrweb-session-(.+)\.jsonl$/.exec(newest);
  return match?.[1] ?? null;
}

/**
 * OBS-10 — Bygg Rrweb-seksjonen. Linker direkte til replayer-siden.
 */
function buildRrwebSection(args: {
  sessionId: string | null;
  sessionsDir: string;
  replayerPath: string;
  baseUrl: string | null;
}): string[] {
  const lines: string[] = [];
  lines.push("## 🎥 Rrweb DOM-replay");
  lines.push("");

  if (!args.sessionId) {
    lines.push(
      `_Ingen rrweb-session funnet — verifiser at klienten er startet med \`?debug=1\` og at events er flushet til \`${args.sessionsDir}/rrweb-session-*.jsonl\`._`,
    );
    lines.push("");
    return lines;
  }

  const jsonlPath = path.join(
    args.sessionsDir,
    `rrweb-session-${args.sessionId}.jsonl`,
  );
  const linkBase = (args.baseUrl ?? "").replace(/\/$/, "");
  const replayerLink = `${linkBase}${args.replayerPath}?session=${encodeURIComponent(args.sessionId)}`;

  lines.push(`- **Session:** \`${args.sessionId}\``);
  lines.push(`- **Replayer:** ${replayerLink}`);
  lines.push(`- **JSONL:** \`${jsonlPath}\``);
  lines.push("");
  return lines;
}

/**
 * OBS-10 — plukk første ikke-tomme string-felt fra et objekt blant en
 * liste av kandidat-keys. Tåler null + manglende nøkler.
 */
function pickStringField(
  obj: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return null;
}

/**
 * OBS-10 — utled base-URL ("http(s)://host[:port]") fra Express-request.
 * Returnerer null hvis vi ikke kan resolve.
 */
function deriveBaseUrl(req: express.Request): string | null {
  try {
    const host = req.get("host");
    if (!host) return null;
    const proto = req.protocol || "http";
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/** Konvertér Date|string|null til ISO-string eller "—". */
function isoOrDash(v: Date | string | null | undefined): string {
  if (!v) return "—";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Auto-diagnose-heuristikker. Returnerer en liste av observasjoner som
 * PM-agenten kan bruke som startpunkt.
 */
function deriveDiagnose(args: {
  body: BugReportBody;
  pilotAnomalies: string[];
  clientEvents: Array<Record<string, unknown>>;
  planRuns: PlanRunRow[];
  scheduledGames: ScheduledGameRow[];
}): string[] {
  const out: string[] = [];

  // 1. Stale plan-run uten scheduled-game
  for (const run of args.planRuns) {
    if (run.status === "running" && !run.current_scheduled_game_id) {
      out.push(
        `🚨 PLAN_RUN_STUCK: plan-run ${run.id} er 'running' men har ingen current_scheduled_game_id`,
      );
    }
  }

  // 2. Scheduled-game stuck i ready_to_start > 5 min
  const now = Date.now();
  for (const game of args.scheduledGames) {
    if (game.status === "ready_to_start" && game.scheduled_start_time) {
      const startTs =
        game.scheduled_start_time instanceof Date
          ? game.scheduled_start_time.getTime()
          : new Date(String(game.scheduled_start_time)).getTime();
      if (now - startTs > 5 * 60 * 1000) {
        out.push(
          `🚨 GAME_STUCK_READY: ${game.id} har vært 'ready_to_start' > 5 min`,
        );
      }
    }
  }

  // 3. Klient-events viser screen.mount=play men ingen popup.show etterpå
  const eventsArr = Array.isArray(args.clientEvents) ? args.clientEvents : [];
  let lastPlayMount: number | null = null;
  let popupShownAfterPlay = false;
  for (const ev of eventsArr.slice(-100)) {
    const t = ev["type"];
    const payload = ev["payload"] as Record<string, unknown> | undefined;
    const ts = typeof ev["timestamp"] === "number" ? ev["timestamp"] : 0;
    if (t === "screen.mount" && payload?.["screen"] === "play") {
      lastPlayMount = ts;
      popupShownAfterPlay = false;
    } else if (
      t === "popup.show" &&
      lastPlayMount !== null &&
      ts > lastPlayMount
    ) {
      popupShownAfterPlay = true;
    }
  }
  if (lastPlayMount !== null && !popupShownAfterPlay) {
    const ageSec = Math.floor((Date.now() - lastPlayMount) / 1000);
    if (ageSec > 5) {
      out.push(
        `🚨 POPUP_BLOCKED: screen.mount=play observed ${ageSec}s ago men ingen popup.show etterpå`,
      );
    }
  }

  // 4. Pilot-monitor har flagget anomalier siste 10 linjer
  const recentAnomalies = args.pilotAnomalies.slice(-10);
  for (const line of recentAnomalies) {
    if (/\[P0\]|\[P1\]/.test(line)) {
      out.push(`⚠️ MONITOR_FLAG: ${line.trim().slice(0, 200)}`);
    }
  }

  // 5. Client-error events
  const clientErrors = eventsArr.filter(
    (ev) => ev["type"] === "error.client" || ev["type"] === "console.error",
  );
  if (clientErrors.length > 0) {
    out.push(
      `⚠️ CLIENT_ERRORS: ${clientErrors.length} client-error events i siste ${eventsArr.length}`,
    );
  }

  // 6. Notes fra brukeren
  if (typeof args.body.notes === "string" && args.body.notes.trim().length > 0) {
    out.push(`📝 USER_NOTES: ${args.body.notes.trim().slice(0, 500)}`);
  }

  if (out.length === 0) {
    out.push(
      "ℹ️ Ingen åpenbare anomalier oppdaget av heuristikkene — PM må gjennomgå manuelt.",
    );
  }

  return out;
}

/** Bygg markdown-rapport. */
function buildReportMarkdown(args: {
  timestamp: string;
  body: BugReportBody;
  pilotMonitorTail: string[];
  backendLogTail: string[];
  clientEvents: Array<Record<string, unknown>>;
  planRuns: { rows: PlanRunRow[]; error: string | null };
  scheduledGames: { rows: ScheduledGameRow[]; error: string | null };
  players: { rows: PlayerRow[]; error: string | null };
  diagnose: string[];
  auditDb?: AuditDbResult;
  /** OBS-10 — Sentry-data + meta. */
  sentry?: {
    issues: SentryIssue[];
    statsPeriod: string;
    config: SentryFetcherConfig | null;
    userId: string | null;
    hallId: string | null;
    fetchSkipped: boolean;
  };
  /** OBS-10 — PostHog-data + meta. */
  posthog?: {
    events: PostHogEvent[];
    config: PostHogFetcherConfig | null;
    distinctId: string | null;
    afterMinutes: number;
    fetchSkipped: boolean;
  };
  /** OBS-10 — Rrweb-session-link. */
  rrweb?: {
    sessionId: string | null;
    sessionsDir: string;
    replayerPath: string;
    baseUrl: string | null;
  };
}): string {
  const {
    timestamp,
    body,
    pilotMonitorTail,
    backendLogTail,
    clientEvents,
    planRuns,
    scheduledGames,
    players,
    diagnose,
    auditDb,
    sentry,
    posthog,
    rrweb,
  } = args;

  const titleStr =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "(uten tittel)";
  const screenStr =
    typeof body.currentScreen === "string" ? body.currentScreen : "(ukjent)";
  const actionStr =
    typeof body.lastUserAction === "string"
      ? body.lastUserAction
      : "(ukjent)";
  const urlStr = typeof body.url === "string" ? body.url : "(ukjent)";
  const uaStr = typeof body.userAgent === "string" ? body.userAgent : "(ukjent)";

  const lines: string[] = [];
  lines.push(`# Bug-rapport — ${titleStr}`);
  lines.push("");
  lines.push(`**Generert:** ${timestamp}`);
  lines.push(`**URL:** ${urlStr}`);
  lines.push(`**User-Agent:** ${uaStr}`);
  lines.push(`**Currentscreen:** ${screenStr}`);
  lines.push(`**Siste user action:** ${actionStr}`);
  lines.push("");

  lines.push("## 🤖 Auto-diagnose");
  lines.push("");
  for (const d of diagnose) {
    lines.push(`- ${d}`);
  }
  lines.push("");

  // Session-context
  lines.push("## Session-context");
  lines.push("");
  lines.push("```json");
  try {
    lines.push(JSON.stringify(body.sessionContext ?? null, null, 2));
  } catch {
    lines.push("(unserializable)");
  }
  lines.push("```");
  lines.push("");

  // Klient-state
  lines.push("## Klient-state-snapshot");
  lines.push("");
  lines.push("```json");
  try {
    lines.push(JSON.stringify(body.clientState ?? null, null, 2));
  } catch {
    lines.push("(unserializable)");
  }
  lines.push("```");
  lines.push("");

  // Plan-runs
  lines.push("## DB: Aktive plan-runs");
  lines.push("");
  if (planRuns.error) {
    lines.push(`⚠️ Query feilet: ${planRuns.error}`);
  } else if (planRuns.rows.length === 0) {
    lines.push("(ingen aktive plan-runs)");
  } else {
    lines.push("| id | status | master_hall_id | pos | current_sg_id | updated |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of planRuns.rows) {
      lines.push(
        `| ${r.id} | ${r.status} | ${r.master_hall_id ?? "—"} | ${r.current_position} | ${r.current_scheduled_game_id ?? "—"} | ${isoOrDash(r.updated_at)} |`,
      );
    }
  }
  lines.push("");

  // Scheduled-games
  lines.push("## DB: Scheduled-games (aktive + nylig avsluttede)");
  lines.push("");
  if (scheduledGames.error) {
    lines.push(`⚠️ Query feilet: ${scheduledGames.error}`);
  } else if (scheduledGames.rows.length === 0) {
    lines.push("(ingen scheduled-games)");
  } else {
    lines.push("| id | status | master_hall | plan_run | pos | start | end |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const g of scheduledGames.rows) {
      lines.push(
        `| ${g.id} | ${g.status} | ${g.master_hall_id} | ${g.plan_run_id ?? "—"} | ${g.plan_position ?? "—"} | ${isoOrDash(g.actual_start_time)} | ${isoOrDash(g.actual_end_time)} |`,
      );
    }
  }
  lines.push("");

  // Players
  lines.push("## DB: Aktive players");
  lines.push("");
  if (players.error) {
    lines.push(`⚠️ Query feilet: ${players.error}`);
  } else if (players.rows.length === 0) {
    lines.push("(ingen)");
  } else {
    lines.push("| id | username | hall_id | balance_cents |");
    lines.push("|---|---|---|---|");
    for (const p of players.rows) {
      lines.push(
        `| ${p.id} | ${p.username ?? "—"} | ${p.hall_id ?? "—"} | ${p.current_balance_cents ?? "—"} |`,
      );
    }
  }
  lines.push("");

  // DB-audit (static auditor — quick-mode kjørt som child_process)
  if (auditDb !== undefined) {
    const auditLines = buildAuditDbSection(auditDb);
    for (const l of auditLines) {
      lines.push(l);
    }
  }

  // OBS-10 — Sentry-issues
  if (sentry) {
    const sentryLines = buildSentryIssuesSection({
      issues: sentry.issues,
      statsPeriod: sentry.statsPeriod,
      config: sentry.config,
      userId: sentry.userId,
      hallId: sentry.hallId,
      fetchSkipped: sentry.fetchSkipped,
    });
    for (const l of sentryLines) lines.push(l);
  }

  // OBS-10 — PostHog-events
  if (posthog) {
    const posthogLines = buildPostHogSection({
      events: posthog.events,
      config: posthog.config,
      distinctId: posthog.distinctId,
      afterMinutes: posthog.afterMinutes,
      fetchSkipped: posthog.fetchSkipped,
    });
    for (const l of posthogLines) lines.push(l);
  }

  // OBS-10 — Rrweb DOM-replay
  if (rrweb) {
    const rrwebLines = buildRrwebSection({
      sessionId: rrweb.sessionId,
      sessionsDir: rrweb.sessionsDir,
      replayerPath: rrweb.replayerPath,
      baseUrl: rrweb.baseUrl,
    });
    for (const l of rrwebLines) lines.push(l);
  }

  // Pilot-monitor anomalier
  lines.push("## Pilot-monitor (siste 200 linjer)");
  lines.push("");
  if (pilotMonitorTail.length === 0) {
    lines.push("(ingen — /tmp/pilot-monitor.log mangler eller er tom)");
  } else {
    lines.push("```");
    for (const line of pilotMonitorTail) {
      lines.push(line);
    }
    lines.push("```");
  }
  lines.push("");

  // Backend stdout
  lines.push("## Backend stdout (siste 200 linjer)");
  lines.push("");
  if (backendLogTail.length === 0) {
    lines.push(
      "(ingen — /tmp/spillorama-backend.log mangler — start backend med `npm run dev:nuke` for å få denne)",
    );
  } else {
    lines.push("```");
    for (const line of backendLogTail) {
      lines.push(line);
    }
    lines.push("```");
  }
  lines.push("");

  // Klient-events fra streamer
  lines.push(`## Klient-events fra streamer (siste ${clientEvents.length})`);
  lines.push("");
  if (clientEvents.length === 0) {
    lines.push("(ingen — start klient med `?debug=1` for å aktivere streamer)");
  } else {
    lines.push("```json");
    try {
      lines.push(JSON.stringify(clientEvents.slice(-100), null, 2));
    } catch {
      lines.push("(unserializable)");
    }
    lines.push("```");
  }
  lines.push("");

  // Last-known klient-events (fra inline ringbuf — kan overlappe streamer)
  if (Array.isArray(body.lastEvents) && body.lastEvents.length > 0) {
    lines.push("## Klient-ringbuffer (in-memory ved klikk-tidspunkt)");
    lines.push("");
    lines.push("```json");
    try {
      lines.push(JSON.stringify(body.lastEvents.slice(-200), null, 2));
    } catch {
      lines.push("(unserializable)");
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Generert av `/api/_dev/debug/bug-report` — Tobias-direktiv 2026-05-13._");

  return lines.join("\n");
}

/**
 * Lag Express-router for bug-report-bundler. Mounter:
 *   POST /api/_dev/debug/bug-report
 */
export function createDevBugReportRouter(
  deps: DevBugReportRouterDeps,
  opts: DevBugReportRouterOptions = {},
): express.Router {
  const router = express.Router();
  const schema = deps.schema ?? "public";

  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name: ${schema}`);
  }

  const reportDir = opts.reportDir ?? DEFAULT_REPORT_DIR;
  const pilotMonitorLog = opts.pilotMonitorLogPath ?? DEFAULT_PILOT_MONITOR_LOG;
  const backendLog = opts.backendLogPath ?? DEFAULT_BACKEND_LOG;
  const clientEventLog = opts.clientEventLogPath ?? DEFAULT_CLIENT_EVENT_LOG;
  const now = opts.now ?? Date.now;
  const fsImpl = opts.fsImpl ?? fs;
  // audit-db-integrasjon: null = skru av (tester), undefined = bruk default.
  const auditDbScriptPath =
    opts.auditDbScriptPath === null
      ? null
      : (opts.auditDbScriptPath ?? DEFAULT_AUDIT_DB_SCRIPT);
  const auditDbTimeoutMs =
    opts.auditDbTimeoutMs ?? DEFAULT_AUDIT_DB_TIMEOUT_MS;

  // ── OBS-10 — Sentry / PostHog / Rrweb-konfig ──────────────────────────
  // `null` skrur av seksjonen (tester). `undefined` bygger fra env.
  const sentryConfig: SentryFetcherConfig | null =
    opts.sentryConfig === null
      ? null
      : (opts.sentryConfig ?? buildSentryFetcherConfigFromEnv());
  const sentryStatsPeriod =
    opts.sentryStatsPeriod ?? DEFAULT_SENTRY_STATS_PERIOD;
  const sentryLimit = opts.sentryLimit ?? DEFAULT_SENTRY_LIMIT;
  const sentryTimeoutMs = opts.sentryTimeoutMs ?? DEFAULT_SENTRY_TIMEOUT_MS;

  const posthogConfig: PostHogFetcherConfig | null =
    opts.posthogConfig === null
      ? null
      : (opts.posthogConfig ?? buildPostHogFetcherConfigFromEnv());
  const posthogAfterMinutes =
    opts.posthogAfterMinutes ?? DEFAULT_POSTHOG_AFTER_MINUTES;
  const posthogLimit = opts.posthogLimit ?? DEFAULT_POSTHOG_LIMIT;
  const posthogTimeoutMs =
    opts.posthogTimeoutMs ?? DEFAULT_POSTHOG_TIMEOUT_MS;

  const rrwebSessionsDir =
    opts.rrwebSessionsDir ?? DEFAULT_RRWEB_SESSIONS_DIR;
  const rrwebReplayerPath =
    opts.rrwebReplayerPath ?? DEFAULT_RRWEB_REPLAYER_PATH;

  router.post("/api/_dev/debug/bug-report", async (req, res) => {
    if (!checkToken(req, res)) return;

    const body = (req.body ?? {}) as BugReportBody;
    const tsMs = now();
    const timestamp = new Date(tsMs).toISOString();
    const safeTimestamp = timestamp.replace(/[:.]/g, "-");
    const fileName = `bug-report-${safeTimestamp}.md`;
    const filePath = path.join(reportDir, fileName);

    try {
      // Sørg for at mappa eksisterer.
      try {
        fsImpl.mkdirSync(reportDir, { recursive: true });
      } catch {
        /* ignorerer EEXIST */
      }

      // 1. Tail pilot-monitor + backend-log
      const pilotMonitorTail = tailFileLines(
        pilotMonitorLog,
        MAX_PILOT_MONITOR_LINES,
        fsImpl,
      );
      const backendLogTail = tailFileLines(
        backendLog,
        MAX_BACKEND_LOG_LINES,
        fsImpl,
      );

      // 2. Klient-events fra JSONL
      const clientEvents = loadClientEvents(
        clientEventLog,
        MAX_CLIENT_EVENTS,
        fsImpl,
      );

      // 3. DB-state parallelt + audit-db-quick (kjører som child_process)
      const auditDbPromise: Promise<AuditDbResult | undefined> =
        auditDbScriptPath === null
          ? Promise.resolve(undefined)
          : runAuditDb({
              scriptPath: auditDbScriptPath,
              connectionString:
                opts.auditDbConnectionString ??
                process.env["APP_PG_CONNECTION_STRING"],
              schema: opts.auditDbSchema ?? schema,
              timeoutMs: auditDbTimeoutMs,
            }).catch((err) => {
              // Triple-defense: aldri la audit-feil drepe bug-rapporten.
              console.warn(
                "[devBugReport] runAuditDb krasjet uventet:",
                err,
              );
              return {
                ok: false,
                error: `unexpected crash: ${String((err as Error).message ?? err)}`,
                report: null,
                elapsedMs: 0,
              };
            });

      // 3b. OBS-10 — utled userId/hallId/distinctId fra body
      const sessionCtx =
        body.sessionContext && typeof body.sessionContext === "object"
          ? (body.sessionContext as Record<string, unknown>)
          : null;
      const userId = pickStringField(sessionCtx, ["userId", "user_id", "playerId"]);
      const hallId = pickStringField(sessionCtx, ["hallId", "hall_id"]);
      // PostHog identifiserer på distinct_id; spillerklienten setter den
      // til userId, men vi tar høyde for at den kan være annerledes.
      const distinctId = pickStringField(sessionCtx, [
        "distinctId",
        "distinct_id",
        "userId",
        "user_id",
      ]);

      // 3c. OBS-10 — Sentry-fetch (fail-soft; aldri throw til catch).
      const sentryPromise: Promise<SentryIssue[]> = sentryConfig
        ? fetchSentryIssues(
            sentryConfig,
            {
              statsPeriod: sentryStatsPeriod,
              limit: sentryLimit,
              ...(userId ? { userId } : {}),
              ...(hallId ? { hallId } : {}),
              timeoutMs: sentryTimeoutMs,
            },
            {
              ...(opts.sentryFetchFn ? { fetchFn: opts.sentryFetchFn } : {}),
            },
          ).catch((err) => {
            console.warn(
              "[devBugReport] sentryFetch krasjet uventet:",
              err,
            );
            return [] as SentryIssue[];
          })
        : Promise.resolve<SentryIssue[]>([]);

      // 3d. OBS-10 — PostHog-fetch (fail-soft).
      const posthogPromise: Promise<PostHogEvent[]> = posthogConfig
        ? fetchPostHogEvents(
            posthogConfig,
            {
              ...(distinctId ? { distinctId } : {}),
              afterMinutes: posthogAfterMinutes,
              limit: posthogLimit,
              now,
              timeoutMs: posthogTimeoutMs,
            },
            {
              ...(opts.posthogFetchFn ? { fetchFn: opts.posthogFetchFn } : {}),
            },
          ).catch((err) => {
            console.warn(
              "[devBugReport] posthogFetch krasjet uventet:",
              err,
            );
            return [] as PostHogEvent[];
          })
        : Promise.resolve<PostHogEvent[]>([]);

      const [
        planRuns,
        scheduledGames,
        players,
        auditDb,
        sentryIssues,
        posthogEvents,
      ] = await Promise.all([
        queryActivePlanRuns(deps.pool, schema),
        queryRecentScheduledGames(deps.pool, schema),
        queryRecentPlayers(deps.pool, schema),
        auditDbPromise,
        sentryPromise,
        posthogPromise,
      ]);

      // 3e. OBS-10 — Rrweb-session-id discovery (synkron — leser disk).
      const rrwebSessionId = discoverRrwebSessionId({
        sessionContext: sessionCtx,
        sessionsDir: rrwebSessionsDir,
        fsImpl,
      });
      // Bygg base-URL fra request. `req.protocol` + `req.get('host')` gir
      // f.eks. "http://localhost:4000". Tester kan overstyre via
      // `opts.rrwebBaseUrl`.
      const inferredBaseUrl = opts.rrwebBaseUrl ?? deriveBaseUrl(req);

      // 4. Auto-diagnose
      const diagnose = deriveDiagnose({
        body,
        pilotAnomalies: pilotMonitorTail,
        clientEvents,
        planRuns: planRuns.rows,
        scheduledGames: scheduledGames.rows,
      });

      // 5. Bygg markdown
      const md = buildReportMarkdown({
        timestamp,
        body,
        pilotMonitorTail,
        backendLogTail,
        clientEvents,
        planRuns,
        scheduledGames,
        players,
        diagnose,
        auditDb,
        sentry: {
          issues: sentryIssues,
          statsPeriod: sentryStatsPeriod,
          config: sentryConfig,
          userId,
          hallId,
          fetchSkipped: sentryConfig === null,
        },
        posthog: {
          events: posthogEvents,
          config: posthogConfig,
          distinctId,
          afterMinutes: posthogAfterMinutes,
          fetchSkipped: posthogConfig === null,
        },
        rrweb: {
          sessionId: rrwebSessionId,
          sessionsDir: rrwebSessionsDir,
          replayerPath: rrwebReplayerPath,
          baseUrl: inferredBaseUrl,
        },
      });

      // 6. Skriv fil
      fsImpl.writeFileSync(filePath, md, { encoding: "utf8" });
      const sizeBytes = fsImpl.statSync(filePath).size;

      res.status(200).json({
        ok: true,
        data: {
          reportPath: filePath,
          fileName,
          timestamp,
          sizeBytes,
          diagnoseHeadlines: diagnose,
        },
      });
    } catch (err) {
      console.warn("[devBugReport] feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  return router;
}

// Test-exports
export const __TEST_ONLY__ = {
  tailFileLines,
  loadClientEvents,
  deriveDiagnose,
  buildReportMarkdown,
  buildAuditDbSection,
  runAuditDb,
  isoOrDash,
  // OBS-10
  buildSentryIssuesSection,
  buildPostHogSection,
  buildRrwebSection,
  discoverRrwebSessionId,
  pickStringField,
};
