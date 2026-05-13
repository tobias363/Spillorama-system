#!/usr/bin/env node
/**
 * diagnose-pilot.mjs — komplett pilot-bug-rapport generator
 * (Tobias-direktiv 2026-05-13: observability fix-PR for å slutte å gjette
 * på pilot-bugs).
 *
 * Genererer én markdown-rapport som Tobias kan dele med PM/agent ved
 * pilot-bug:
 *   - Backend stdout/stderr (siste 200 linjer)
 *   - Klient EventTracker-events (siste 500, via /api/_dev/debug/events/tail)
 *   - DB-state for aktive plan-runs + scheduled-games + hall-ready + tickets
 *   - Game-end-snapshots fra /tmp/game-end-snapshot-*.json (siste 10)
 *
 * Output:
 *   /tmp/pilot-diagnose-{timestamp}.md
 *
 * Bruk:
 *   npm run diagnose:pilot
 *   # eller direkte:
 *   node scripts/diagnose-pilot.mjs
 *
 * Forutsetninger:
 *   - Backend på localhost:4000 (eller PORT env)
 *   - PGPASSWORD=spillorama (eller fra env)
 *   - psql tilgjengelig i PATH
 *   - RESET_TEST_PLAYERS_TOKEN i apps/backend/.env (default spillorama-2026-test)
 *
 * Fail-soft:
 *   Hver seksjon er try/catch. Hvis backend er nede / DB ikke svarer / fila
 *   ikke finnes, skriver vi "(ikke tilgjengelig)" og fortsetter. PM får en
 *   delvis rapport heller enn ingen.
 */

import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = (() => {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
    }).trim();
  } catch {
    return process.cwd();
  }
})();

const PORT = process.env.PORT ?? "4000";
const BACKEND_URL = `http://localhost:${PORT}`;
const BACKEND_LOG = "/tmp/spillorama-backend.log";
const ADMIN_LOG = "/tmp/spillorama-admin.log";
const PGPASSWORD = process.env.PGPASSWORD ?? "spillorama";

// Token leses fra .env eller env-var. Default spillorama-2026-test for dev.
function resolveToken() {
  if (process.env.RESET_TEST_PLAYERS_TOKEN) {
    return process.env.RESET_TEST_PLAYERS_TOKEN;
  }
  try {
    const envPath = path.join(REPO_ROOT, "apps/backend/.env");
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, "utf8");
      const match = env.match(/^RESET_TEST_PLAYERS_TOKEN\s*=\s*(.+)$/m);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* fall-through */
  }
  return "spillorama-2026-test";
}

const TOKEN = resolveToken();

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .slice(0, 19);
const OUTPUT_PATH = `/tmp/pilot-diagnose-${timestamp}.md`;

const sections = [];

// Helper: tail siste N linjer fra en fil. Fail-soft.
function tailFile(filePath, lines = 200) {
  try {
    if (!fs.existsSync(filePath)) {
      return `(filen ${filePath} eksisterer ikke)`;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch (err) {
    return `(kunne ikke lese ${filePath}: ${err.message})`;
  }
}

// Helper: query backend via fetch. Fail-soft.
async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) };
    } catch {
      return { ok: res.ok, status: res.status, body: text };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Helper: psql-query. Fail-soft.
function psql(query) {
  const result = spawnSync(
    "psql",
    [
      "-h",
      "localhost",
      "-U",
      "spillorama",
      "-d",
      "spillorama",
      "-t",
      "-A",
      "-F",
      "\t",
      "-c",
      query,
    ],
    {
      env: { ...process.env, PGPASSWORD },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return `(psql feilet: ${result.stderr || result.stdout})`;
  }
  return result.stdout || "(tom resultat)";
}

// ── 1. Header ─────────────────────────────────────────────────────────────

sections.push(`# Pilot diagnose-rapport — ${timestamp}

**Generert av:** \`scripts/diagnose-pilot.mjs\`
**Backend:** ${BACKEND_URL}
**Repo:** ${REPO_ROOT}
**Git HEAD:** ${(() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "(ukjent)";
  }
})()}
**Branch:** ${(() => {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "(ukjent)";
  }
})()}
`);

// ── 2. Backend stdout/stderr ──────────────────────────────────────────────

sections.push(`## 1. Backend stdout/stderr (siste 200 linjer)

Fil: \`${BACKEND_LOG}\`

\`\`\`
${tailFile(BACKEND_LOG, 200)}
\`\`\`

## 1b. Admin-web stdout (siste 50 linjer)

Fil: \`${ADMIN_LOG}\`

\`\`\`
${tailFile(ADMIN_LOG, 50)}
\`\`\`
`);

// ── 3. Klient EventTracker-events ─────────────────────────────────────────

async function fetchClientEvents() {
  // Hent events siden 5 minutter siden (rikelig)
  const since = Date.now() - 5 * 60 * 1000;
  const url = `${BACKEND_URL}/api/_dev/debug/events/tail?token=${encodeURIComponent(
    TOKEN,
  )}&since=${since}`;
  const result = await fetchJson(url);
  if (!result.ok) {
    return `(kunne ikke hente events: ${
      result.error || result.status || "ukjent feil"
    })`;
  }
  const data = result.body?.data?.events;
  if (!Array.isArray(data)) {
    return `(ingen events i siste 5 min, eller endpoint returnerte uventet shape)`;
  }
  // Begrens til siste 500 og format pent.
  const events = data.slice(-500);
  return events
    .map((e) => {
      const iso = e.iso ?? new Date(e.timestamp ?? 0).toISOString();
      const type = e.type ?? "(unknown)";
      const payload = JSON.stringify(e.payload ?? {});
      const corr = e.correlationId ? ` [${e.correlationId}]` : "";
      return `${iso} ${type}${corr} ${payload.slice(0, 200)}`;
    })
    .join("\n");
}

// ── 4. DB-state ────────────────────────────────────────────────────────────

function dbState() {
  const planRuns = psql(`
    SELECT id, plan_id, hall_id, business_date, current_position, status,
           started_at, finished_at
      FROM app_game_plan_run
     WHERE status NOT IN ('finished','idle')
        OR business_date >= CURRENT_DATE - INTERVAL '1 day'
     ORDER BY updated_at DESC
     LIMIT 20;
  `);

  const scheduledGames = psql(`
    SELECT id, master_hall_id, group_hall_id, status, plan_run_id, plan_position,
           scheduled_start_time, actual_start_time, actual_end_time
      FROM app_game1_scheduled_games
     WHERE status NOT IN ('completed','cancelled')
        OR (actual_end_time IS NOT NULL AND actual_end_time >= now() - INTERVAL '1 hour')
     ORDER BY scheduled_start_time DESC
     LIMIT 20;
  `);

  const recentTickets = psql(`
    SELECT id, scheduled_game_id, buyer_user_id, hall_id, total_amount_cents,
           payment_method, purchased_at
      FROM app_game1_ticket_purchases
     WHERE purchased_at >= now() - INTERVAL '5 minutes'
     ORDER BY purchased_at DESC
     LIMIT 30;
  `);

  const hallReady = psql(`
    SELECT game_id, hall_id, is_ready, excluded_from_game,
           digital_tickets_sold, physical_tickets_sold
      FROM app_game1_hall_ready_status
     WHERE game_id IN (
       SELECT id FROM app_game1_scheduled_games
        WHERE status NOT IN ('completed','cancelled')
        ORDER BY scheduled_start_time DESC
        LIMIT 5
     )
     ORDER BY game_id, hall_id;
  `);

  return { planRuns, scheduledGames, recentTickets, hallReady };
}

// ── 5. Game-end snapshots ─────────────────────────────────────────────────

function gameEndSnapshots() {
  try {
    const dir = "/tmp";
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("game-end-snapshot-") && f.endsWith(".json"))
      .map((f) => ({
        f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10);

    if (files.length === 0) {
      return "(ingen /tmp/game-end-snapshot-*.json-filer funnet)";
    }

    return files
      .map((entry) => {
        try {
          const stat = fs.statSync(entry.path);
          const content = fs.readFileSync(entry.path, "utf8");
          let json;
          try {
            json = JSON.parse(content);
          } catch {
            return `### ${entry.f}\n(kunne ikke parse JSON)\n`;
          }
          return `### ${entry.f}
- generatedAt: ${json.generatedAt}
- gameId: ${json.gameId}
- reason: ${json.reason}
- context: ${JSON.stringify(json.context)}
- scheduledGame.status: ${json.scheduledGame?.status ?? "(null)"}
- planRun.status: ${json.planRun?.status ?? "(null)"}
- hallReadyRows: ${json.hallReadyRows?.length ?? 0}
- activeTickets: ${json.activeTickets?.length ?? 0}
- filsize: ${stat.size} bytes
`;
        } catch (err) {
          return `### ${entry.f}\n(error: ${err.message})\n`;
        }
      })
      .join("\n");
  } catch (err) {
    return `(kunne ikke liste game-end-snapshots: ${err.message})`;
  }
}

// ── 6. Run ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`[diagnose-pilot] Genererer rapport til ${OUTPUT_PATH}…`);

  let clientEvents = "";
  try {
    clientEvents = await fetchClientEvents();
  } catch (err) {
    clientEvents = `(fetch feilet: ${err.message})`;
  }

  let db;
  try {
    db = dbState();
  } catch (err) {
    db = {
      planRuns: `(error: ${err.message})`,
      scheduledGames: "",
      recentTickets: "",
      hallReady: "",
    };
  }

  sections.push(`## 2. Klient EventTracker-events (siste 500 events fra siste 5 min)

\`\`\`
${clientEvents}
\`\`\`
`);

  sections.push(`## 3. DB-state — aktive plan-runs

\`\`\`
${db.planRuns}
\`\`\`

## 4. DB-state — aktive scheduled-games

\`\`\`
${db.scheduledGames}
\`\`\`

## 5. DB-state — hall-ready-status for aktive runder

\`\`\`
${db.hallReady}
\`\`\`

## 6. DB-state — ticket-purchases siste 5 min

\`\`\`
${db.recentTickets}
\`\`\`

## 7. Game-end-snapshots (/tmp/game-end-snapshot-*.json)

${gameEndSnapshots()}
`);

  sections.push(`## 8. Backend health-check

`);

  const health = await fetchJson(`${BACKEND_URL}/health`);
  sections.push(
    `\`\`\`json\n${JSON.stringify(health.body ?? health.error, null, 2)}\n\`\`\`\n`,
  );

  // Skriv rapport
  fs.writeFileSync(OUTPUT_PATH, sections.join("\n"), "utf8");
  console.log(`[diagnose-pilot] Rapport ferdig: ${OUTPUT_PATH}`);
  console.log(`[diagnose-pilot] Send fila til PM/agent for diagnose.`);
}

main().catch((err) => {
  console.error("[diagnose-pilot] Fatal feil:", err);
  process.exit(1);
});
