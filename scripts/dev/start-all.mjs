#!/usr/bin/env node
/**
 * scripts/dev/start-all.mjs
 *
 * Local-test-stack one-command launcher (Tobias-direktiv 2026-05-05 + 2026-05-09).
 *
 * Mål: redusere iterasjon fra 5-7 min Render-deploy til 2-sek hot-reload.
 * Alltid sluttresultat: et fungerende, kjent state — uten manuell SQL-cleanup.
 *
 * Hva den gjør:
 *   1. Sjekker at Docker (Postgres + Redis) kjører — starter dem hvis de
 *      er nede (via docker-compose up postgres redis).
 *   2. Venter på at Postgres er klar og kjører `npm run migrate`
 *      idempotent (henter manglende migrasjoner).
 *   3. Stale-state-cleanup: scanner DB for plan-runs og scheduled-games
 *      som henger fra tidligere business-dato med åpen status. Slike
 *      rader oppdateres til 'finished'/'cancelled' så lokal pilot-flow
 *      aldri lar deg treffe stale state.
 *   4. Heuristikk-sjekk: hvis DB er tom (ingen rader i app_halls), kjør
 *      `npm run seed:demo-pilot-day` automatisk slik at admin/agent/spillere
 *      kan logge inn etter første-gangs-startup.
 *   5. Starter backend (tsx --watch på port 4000), admin-web (Vite på 5174),
 *      game-client (Vite på default 5173) og visual-harness (Node på 4173)
 *      parallelt med farge-kodet output-prefiks.
 *   6. Helsesjekker hver port etter ~10 sek — printer en utvidet status-tabell
 *      med PIDs, DB-state, antall haller/spillere/plan-runs og test-URL-er
 *      med dynamisk hentet TV-token.
 *   7. Ctrl+C dreper alle barneprosesser rent (SIGTERM først, så SIGKILL
 *      etter 3 sek hvis noe henger).
 *
 * Bruk:
 *   npm run dev:all
 *
 * Flagg:
 *   --no-docker      Hopp Docker-sjekk (hvis du har Postgres/Redis lokalt)
 *   --no-harness     Skip visual-harness (sparer en port)
 *   --no-admin       Skip admin-web (kun backend + game-client)
 *   --skip-migrate   Hopp over migrate (bruk hvis du allerede har kjørt det)
 *   --force-seed     Re-seed selv om DB ikke er tom (idempotent)
 *   --reset-state    Tøm runtime-state (plan-runs, scheduled-games, tickets,
 *                    redis-state, demo-saldoer) FØR oppstart, slik at dev-
 *                    stack alltid starter på en kjent fersk pilot-state.
 *                    Tilsvarer å kjøre `npm run dev:reset` automatisk pluss
 *                    DELETE av plan-runs/scheduled-games + force-reseede.
 *                    Trygt — rører kun runtime-data, ikke katalog/halls/users.
 *
 * Backwards-compat: `npm run dev` (alene) fungerer fortsatt som før — denne
 * scripten er additiv og endrer ingen eksisterende workflows. Eksisterende
 * `dev:all`-flow er bevart; nye funksjoner (cleanup + utvidet status) er
 * lagt til uten å endre call-signaturen.
 */

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ── Args ────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const SKIP_DOCKER = args.has("--no-docker");
const SKIP_HARNESS = args.has("--no-harness");
const SKIP_ADMIN = args.has("--no-admin");
const SKIP_MIGRATE = args.has("--skip-migrate");
const FORCE_SEED = args.has("--force-seed");
const RESET_STATE = args.has("--reset-state");

// Default-DSN for local Docker-Postgres (matcher docker-compose.yml).
// Override hvis brukeren allerede har APP_PG_CONNECTION_STRING satt i env.
const PG_DSN =
  process.env.APP_PG_CONNECTION_STRING ??
  "postgres://spillorama:spillorama@localhost:5432/spillorama";

// ── Color helpers (no chalk dep — tiny ANSI wrapper) ────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function color(name, text) {
  if (!process.stdout.isTTY) return text;
  const c = COLORS[name] ?? "";
  return `${c}${text}${COLORS.reset}`;
}

function banner(text) {
  const line = "─".repeat(Math.max(60, text.length + 4));
  console.log("");
  console.log(color("cyan", line));
  console.log(color("cyan", `  ${color("bold", text)}`));
  console.log(color("cyan", line));
}

// ── Port-sjekk ──────────────────────────────────────────────────────────────

/**
 * Resolves true hvis noen lytter på porten lokalt, false ellers.
 * Vi bruker en kort socket-connect-attempt med 500ms timeout.
 */
function isPortOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPort(port, label, maxSeconds = 60) {
  const start = Date.now();
  while (Date.now() - start < maxSeconds * 1000) {
    if (await isPortOpen(port)) return true;
    await delay(500);
  }
  return false;
}

// ── Docker-håndtering ───────────────────────────────────────────────────────

function ensureDockerInfra() {
  if (SKIP_DOCKER) {
    console.log(color("yellow", "[docker] hoppet over (--no-docker)"));
    return true;
  }
  const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (dockerCheck.status !== 0) {
    console.log(
      color(
        "red",
        "[docker] Docker-daemonen svarer ikke. Start Docker Desktop og prøv igjen, eller bruk --no-docker hvis Postgres/Redis kjører lokalt utenfor Docker."
      )
    );
    return false;
  }
  // Sjekk om Postgres + Redis allerede kjører (port 5432 + 6379)
  // Vi vil starte dem uansett om de ikke kjører fra THIS docker-compose.
  console.log(color("blue", "[docker] starter postgres + redis (idempotent)"));
  const up = spawnSync(
    "docker",
    ["compose", "-f", path.join(ROOT, "docker-compose.yml"), "up", "-d", "postgres", "redis"],
    { cwd: ROOT, stdio: "inherit" }
  );
  if (up.status !== 0) {
    console.log(color("red", "[docker] docker compose up feilet"));
    return false;
  }
  return true;
}

// ── Postgres-readiness + migrate + smart-seed ──────────────────────────────

/**
 * Kort polling-loop som venter til Postgres svarer på pg_isready (foretrukket
 * via docker exec, fallback til en TCP-handshake som proxy hvis docker-CLI
 * ikke er tilgjengelig). Returnerer true når klart, false ved timeout.
 */
async function waitForPostgresReady(maxSeconds = 30) {
  const start = Date.now();
  let usedDocker = false;
  // Først: prøv docker exec pg_isready (mest pålitelig)
  const dockerHas = spawnSync("docker", ["info"], { stdio: "ignore" });
  const containerLookup = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      path.join(ROOT, "docker-compose.yml"),
      "ps",
      "-q",
      "postgres",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const containerId =
    dockerHas.status === 0 && containerLookup.status === 0
      ? (containerLookup.stdout?.toString().trim() ?? "")
      : "";
  if (containerId) {
    usedDocker = true;
  }

  while (Date.now() - start < maxSeconds * 1000) {
    if (usedDocker) {
      const ready = spawnSync(
        "docker",
        ["exec", containerId, "pg_isready", "-U", "spillorama"],
        { stdio: "ignore" }
      );
      if (ready.status === 0) return true;
    } else {
      // Fallback: TCP-connect til 5432 — dette betyr ikke at PG er ferdig
      // med initdb, men det er bedre enn ingenting hvis brukeren har
      // --no-docker eller en alternativ Postgres.
      if (await isPortOpen(5432)) return true;
    }
    await delay(500);
  }
  return false;
}

/**
 * Kjør node-pg-migrate idempotent. Returnerer true ved suksess, false ved feil.
 */
function runMigrate() {
  if (SKIP_MIGRATE) {
    console.log(color("yellow", "[migrate] hoppet over (--skip-migrate)"));
    return true;
  }
  console.log(color("blue", "[migrate] kjører node-pg-migrate"));
  const res = spawnSync(
    "npm",
    ["--prefix", "apps/backend", "run", "migrate", "--silent"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, APP_PG_CONNECTION_STRING: PG_DSN },
    }
  );
  if (res.status !== 0) {
    console.log(
      color(
        "red",
        "[migrate] node-pg-migrate feilet — fix migrasjonen og prøv igjen, " +
          "eller bruk --skip-migrate hvis du har kjørt det manuelt."
      )
    );
    return false;
  }
  console.log(color("green", "[migrate] ✓ ferdig (idempotent)"));
  return true;
}

// ── DB-spørring helper ─────────────────────────────────────────────────────

/**
 * Generic helper: kjør en SQL-spørring (eller batch) via en out-of-process
 * `pg`-klient og returner JSON-resultat fra første radens første kolonne,
 * eller hele rows-array (hvis fullRows=true). Helper-en bruker `node -e`
 * fordi vi vil holde dette scriptet pure-ESM uten å kreve at brukeren
 * bygger backend først.
 *
 * Returnerer { ok: true, value } ved suksess. Returnerer { ok: false,
 * error } hvis noe feilet — vi kaster ikke; caller bestemmer om feilen
 * skal blokkere oppstart eller bare logges.
 */
function runQuery(sql, opts = {}) {
  const { fullRows = false, params = [] } = opts;
  // SQL og params serialiseres inn i den child-prosessen vi spawn'er.
  // JSON.stringify gir oss safe escaping av embedded quotes.
  const code =
    `import("pg").then(async ({default: pg}) => {
      const c = new pg.Client({connectionString: process.env.APP_PG_CONNECTION_STRING});
      await c.connect();
      try {
        const r = await c.query(${JSON.stringify(sql)}, ${JSON.stringify(params)});
        if (${fullRows ? "true" : "false"}) {
          process.stdout.write(JSON.stringify(r.rows));
        } else {
          const first = r.rows[0];
          if (!first) {
            process.stdout.write("null");
          } else {
            const k = Object.keys(first)[0];
            process.stdout.write(JSON.stringify(first[k]));
          }
        }
        await c.end();
      } catch (err) {
        process.stderr.write(String(err.message || err));
        await c.end();
        process.exit(2);
      }
    }).catch(err => { process.stderr.write(String(err.message || err)); process.exit(3); });`;
  const node = spawnSync("node", ["-e", code], {
    // ROOT har hoisted node_modules (pg) — apps/backend har ingen lokal
    // node_modules siden prosjektet bruker workspace-hoisting.
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, APP_PG_CONNECTION_STRING: PG_DSN },
  });
  if (node.status !== 0) {
    const errOut = node.stderr?.toString().trim() ?? "";
    return { ok: false, error: errOut || `exit ${node.status}` };
  }
  const raw = node.stdout?.toString().trim() ?? "";
  if (!raw || raw === "null") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `parse-failure: ${err.message} (raw=${raw.slice(0, 80)})` };
  }
}

/**
 * Sjekk om en gitt tabell finnes i `public`-skjemaet. Brukes som guard
 * før vi prøver å rydde stale state — fersk DB hvor migrasjonene ikke
 * har kjørt enda, har ingen av tabellene og skal ikke trigge advarsel.
 */
function tableExists(tableName) {
  const res = runQuery(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     )::boolean AS exists;`,
    { params: [tableName] }
  );
  if (!res.ok) return false;
  return res.value === true;
}

/**
 * Sjekk om DB er tom — heuristikk: COUNT(*) FROM app_halls. Hvis ingen haller
 * er seedet, antar vi at DB er fersk og kjører seed automatisk.
 *
 * Hvis sjekken feiler (tabellen finnes ikke, etc.), antar vi at noe er
 * uventet og skipper seed for å unngå å overskrive ekte data — men logger
 * feilen.
 */
function isDatabaseEmpty() {
  const res = runQuery("SELECT COUNT(*)::int AS n FROM app_halls;");
  if (!res.ok) {
    console.log(
      color(
        "yellow",
        `[seed] kunne ikke sjekke DB-tilstand (${res.error}) — hopper over seed`
      )
    );
    return false;
  }
  const count = Number(res.value ?? 0);
  return Number.isFinite(count) && count === 0;
}

/**
 * Kjør seed-demo-pilot-day idempotent. Returnerer true ved suksess.
 */
function runSeed() {
  console.log(color("blue", "[seed] kjører seed:demo-pilot-day (idempotent)"));
  const res = spawnSync(
    "npm",
    ["--prefix", "apps/backend", "run", "seed:demo-pilot-day", "--silent"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, APP_PG_CONNECTION_STRING: PG_DSN },
    }
  );
  if (res.status !== 0) {
    console.log(color("red", "[seed] seed-script feilet"));
    return false;
  }
  console.log(color("green", "[seed] ✓ demo-data seedet"));
  return true;
}

// ── Stale-state-cleanup (Tobias-direktiv 2026-05-09) ────────────────────────

/**
 * Stale-state-cleanup:
 *
 * Etter at Tobias har kjørt `npm run dev:all`, kan han havne i en stale
 * plan-run-state hvis han hadde kjørt en runde gårsdag eller en pilot-
 * smoke som ikke nådde finished-state. Tidligere måtte han manuelt åpne
 * psql og oppdatere status — det fjerner vi nå.
 *
 * Heuristikk: alle rader i `app_game_plan_run` med status ∈ {idle, running,
 * paused} OG business_date < CURRENT_DATE er stale. Tilsvarende for
 * `app_game1_scheduled_games` med status ∈ {scheduled, purchase_open,
 * ready_to_start, running, paused} OG scheduled_day < CURRENT_DATE.
 *
 * Vi UPDATEr dem til finished/cancelled (med finished_at/actual_end_time
 * = now()) — sletter ikke (audit-trail beholdes). Helt idempotent.
 *
 * Returnerer { planRuns: number, scheduledGames: number } for status-tabellen.
 */
function cleanupStaleDevState() {
  const result = { planRuns: 0, scheduledGames: 0 };

  // Guard: hvis tabellene ikke finnes (fersk DB før migrate har lagt dem
  // inn), returner 0 og hopp. Dette unngår "tabell finnes ikke"-advarsler
  // ved første-gangs-startup.
  const planRunExists = tableExists("app_game_plan_run");
  const scheduledGamesExists = tableExists("app_game1_scheduled_games");
  if (!planRunExists && !scheduledGamesExists) {
    return result;
  }

  // 1) Stale plan-runs (fra tidligere business-dato med åpen status)
  if (planRunExists) {
    const stalePlanRunsRes = runQuery(
      `SELECT COUNT(*)::int AS n FROM app_game_plan_run
        WHERE status IN ('idle', 'running', 'paused')
          AND business_date < (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date;`
    );
    if (stalePlanRunsRes.ok) {
      const n = Number(stalePlanRunsRes.value ?? 0);
      if (n > 0) {
        console.log(
          color(
            "yellow",
            `[dev] ${n} stale plan-runs detektert (fra tidligere business-dato) — rydder opp før dev-start`
          )
        );
        const updateRes = runQuery(
          `UPDATE app_game_plan_run
              SET status = 'finished',
                  finished_at = COALESCE(finished_at, now()),
                  updated_at = now()
            WHERE status IN ('idle', 'running', 'paused')
              AND business_date < (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date
            RETURNING id;`,
          { fullRows: true }
        );
        if (updateRes.ok) {
          const rows = Array.isArray(updateRes.value) ? updateRes.value : [];
          result.planRuns = rows.length;
          console.log(
            color("green", `[dev] ✓ ryddet ${rows.length} stale plan-runs`)
          );
        } else {
          console.log(
            color(
              "yellow",
              `[dev] kunne ikke rydde stale plan-runs (${updateRes.error}) — fortsetter`
            )
          );
        }
      }
    } else {
      console.log(
        color(
          "yellow",
          `[dev] kunne ikke sjekke stale plan-runs (${stalePlanRunsRes.error}) — fortsetter`
        )
      );
    }
  }

  // 2) Stale scheduled-games (fra tidligere scheduled_day med åpen status)
  if (scheduledGamesExists) {
    const staleScheduledRes = runQuery(
      `SELECT COUNT(*)::int AS n FROM app_game1_scheduled_games
        WHERE status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running', 'paused')
          AND scheduled_day < (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date;`
    );
    if (staleScheduledRes.ok) {
      const n = Number(staleScheduledRes.value ?? 0);
      if (n > 0) {
        console.log(
          color(
            "yellow",
            `[dev] ${n} stale scheduled-games detektert (fra tidligere dato) — rydder opp`
          )
        );
        const updateRes = runQuery(
          `UPDATE app_game1_scheduled_games
              SET status = 'cancelled',
                  actual_end_time = COALESCE(actual_end_time, now()),
                  stop_reason = COALESCE(stop_reason, 'auto_cleanup_stale_dev_state'),
                  updated_at = now()
            WHERE status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running', 'paused')
              AND scheduled_day < (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date
            RETURNING id;`,
          { fullRows: true }
        );
        if (updateRes.ok) {
          const rows = Array.isArray(updateRes.value) ? updateRes.value : [];
          result.scheduledGames = rows.length;
          console.log(
            color("green", `[dev] ✓ ryddet ${rows.length} stale scheduled-games`)
          );
        } else {
          console.log(
            color(
              "yellow",
              `[dev] kunne ikke rydde stale scheduled-games (${updateRes.error}) — fortsetter`
            )
          );
        }
      }
    } else {
      console.log(
        color(
          "yellow",
          `[dev] kunne ikke sjekke stale scheduled-games (${staleScheduledRes.error}) — fortsetter`
        )
      );
    }
  }

  return result;
}

/**
 * Full reset av runtime-state (--reset-state-flagget).
 *
 * Dette er pragmatisk: `npm run dev:reset` finnes allerede og rydder
 * pågående runder, redis-state og demo-saldoer. Vi delegerer til den —
 * pluss DELETE av plan-runs/scheduled-games + force-reseede for å gi et
 * alltid-fersh pilot-state.
 *
 * NB: --reset-state rører IKKE selve schema (ingen DROP/migrate-roll-back),
 * så katalog-spill, haller og brukere bevares. Audit-log og §71-rapporter
 * røres heller aldri (append-only invariant). Kun runtime-data slettes.
 */
function runResetState() {
  banner("Reset state — full opprydning av runtime-data");
  console.log(
    color(
      "dim",
      "[reset-state] kjører dev:reset (game_sessions + redis + demo-saldoer) + force-reseed"
    )
  );
  const resetRes = spawnSync("npm", ["run", "dev:reset", "--silent"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, APP_PG_CONNECTION_STRING: PG_DSN },
  });
  if (resetRes.status !== 0) {
    console.log(color("red", "[reset-state] dev:reset feilet"));
    return false;
  }
  // Tøm også plan-runs + scheduled-games selv om de ikke er "stale" —
  // --reset-state betyr full reset til pilot-fersh.
  const wipeStmts = [
    `DELETE FROM app_game1_scheduled_games WHERE TRUE;`,
    `DELETE FROM app_game_plan_run WHERE TRUE;`,
  ];
  // app_game1_tickets eier wallet-koblinger — vi sletter kun siste 24t for
  // å unngå å bryte FK fra rapporter, og audit-log røres aldri (append-
  // only invariant).
  if (tableExists("app_game1_tickets")) {
    wipeStmts.push(
      `DELETE FROM app_game1_tickets WHERE created_at > now() - interval '24 hours';`
    );
  }
  for (const sql of wipeStmts) {
    if (
      (sql.includes("app_game_plan_run") && !tableExists("app_game_plan_run")) ||
      (sql.includes("app_game1_scheduled_games") &&
        !tableExists("app_game1_scheduled_games"))
    ) {
      // Fersk DB uten denne tabellen — hopp graceful
      continue;
    }
    const res = runQuery(sql);
    if (!res.ok) {
      console.log(
        color(
          "yellow",
          `[reset-state] kunne ikke kjøre '${sql.slice(0, 60)}...' (${res.error}) — fortsetter`
        )
      );
    }
  }
  console.log(color("green", "[reset-state] ✓ runtime-data tømt"));
  // Force-reseed så pilot-data er garantert til stede.
  if (!runSeed()) {
    console.log(
      color(
        "yellow",
        "[reset-state] reseed feilet — DB er tom for pilot-data, må reseedes manuelt"
      )
    );
    return false;
  }
  console.log(color("green", "[reset-state] ✓ DB resatt til pilot-fersh state"));
  return true;
}

// ── DB-stats + URL-helpers (status-tabell) ──────────────────────────────────

/**
 * Hent en samling DB-stats brukt i status-tabellen som vises etter at
 * alt har startet. Returnerer null hvis sjekken feiler — vi vil ikke
 * blokkere status-tabellen på en stats-feil.
 */
function getDbStateStats() {
  const stats = {
    halls: null,
    players: null,
    planRunsToday: null,
    scheduledGamesToday: null,
    activePlanRunStatus: null,
  };
  if (!tableExists("app_halls")) return stats;

  const hallsRes = runQuery(
    `SELECT COUNT(*)::int FROM app_halls WHERE is_active = TRUE;`
  );
  if (hallsRes.ok) stats.halls = Number(hallsRes.value ?? 0);

  if (tableExists("app_users")) {
    // app_users har ikke deleted_at i alle migrasjoner — fall back hvis kolonne
    // mangler. Vi bruker information_schema for å sjekke kolonnen før COUNT.
    const colRes = runQuery(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'app_users'
            AND column_name = 'deleted_at'
       )::boolean AS x;`
    );
    const hasDeletedAt = colRes.ok && colRes.value === true;
    const playersRes = runQuery(
      hasDeletedAt
        ? `SELECT COUNT(*)::int FROM app_users WHERE deleted_at IS NULL;`
        : `SELECT COUNT(*)::int FROM app_users;`
    );
    if (playersRes.ok) stats.players = Number(playersRes.value ?? 0);
  }

  if (tableExists("app_game_plan_run")) {
    const planRunsRes = runQuery(
      `SELECT COUNT(*)::int FROM app_game_plan_run
        WHERE business_date = (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date;`
    );
    if (planRunsRes.ok) stats.planRunsToday = Number(planRunsRes.value ?? 0);

    const activeStatusRes = runQuery(
      `SELECT status FROM app_game_plan_run
        WHERE business_date = (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date
        ORDER BY updated_at DESC
        LIMIT 1;`,
      { fullRows: true }
    );
    if (activeStatusRes.ok && Array.isArray(activeStatusRes.value)) {
      const row = activeStatusRes.value[0];
      stats.activePlanRunStatus = row?.status ?? null;
    }
  }

  if (tableExists("app_game1_scheduled_games")) {
    const scheduledRes = runQuery(
      `SELECT COUNT(*)::int FROM app_game1_scheduled_games
        WHERE scheduled_day = (CURRENT_DATE AT TIME ZONE 'Europe/Oslo')::date;`
    );
    if (scheduledRes.ok) stats.scheduledGamesToday = Number(scheduledRes.value ?? 0);
  }
  return stats;
}

/**
 * Hent test-URL-er dynamisk fra DB. Henter TV-token for demo-hall-001
 * (master-hall) hvis den finnes, ellers fallback til en hvilken som helst
 * aktiv hall med satt token.
 *
 * Tobias-direktiv: ALDRI hardkode tokens — alltid hent dynamisk så vi
 * unngår "stale token i doc"-feilkilden.
 */
function getTestUrls(port) {
  const urls = {
    masterAdmin: `http://localhost:5174/admin/agent/cashinout`,
    spillerShell: `http://localhost:${port}/web/?dev-user=demo-pilot-spiller-1`,
    tvScreen: null,
  };
  if (!tableExists("app_halls")) return urls;
  const hallRes = runQuery(
    `SELECT id, tv_token FROM app_halls
      WHERE is_active = TRUE
        AND tv_token IS NOT NULL
      ORDER BY
        CASE id
          WHEN 'demo-hall-001' THEN 1
          WHEN 'demo-hall-master' THEN 2
          ELSE 9
        END,
        created_at ASC
      LIMIT 1;`,
    { fullRows: true }
  );
  if (hallRes.ok && Array.isArray(hallRes.value) && hallRes.value.length > 0) {
    const row = hallRes.value[0];
    if (row.id && row.tv_token) {
      urls.tvScreen = `http://localhost:${port}/tv/${row.id}/${row.tv_token}`;
    }
  }
  return urls;
}

/**
 * Kombinert helper: vent på PG, kjør migrate, sjekk om DB er tom, kjør seed.
 * Returnerer { ok: true, cleanupResult } eller { ok: false }.
 *
 * cleanupResult: { planRuns, scheduledGames } for status-tabellen.
 */
async function ensureDatabaseReady() {
  if (SKIP_MIGRATE && !FORCE_SEED && !RESET_STATE) {
    console.log(
      color(
        "yellow",
        "[db] --skip-migrate satt — hopper også over auto-seed-sjekk. Bruk --force-seed for å re-seede."
      )
    );
    return { ok: true, cleanupResult: { planRuns: 0, scheduledGames: 0 } };
  }
  console.log(color("blue", "[migrate] venter på Postgres…"));
  const ready = await waitForPostgresReady(30);
  if (!ready) {
    console.log(
      color(
        "red",
        "[migrate] Postgres ble ikke klar innen 30s — sjekk `docker compose logs postgres`."
      )
    );
    return { ok: false };
  }
  console.log(color("green", "[migrate] Postgres klar"));
  if (!runMigrate()) return { ok: false };

  // ── --reset-state har høyest prioritet — tøm alt før evt. cleanup ────
  if (RESET_STATE) {
    if (!runResetState()) return { ok: false };
    return { ok: true, cleanupResult: { planRuns: 0, scheduledGames: 0 } };
  }

  // ── Stale-state-cleanup (Tobias-direktiv 2026-05-09) ─────────────────
  // Etter migrate, før seed-sjekk: rydd plan-runs/scheduled-games som
  // henger fra en tidligere business-dato med åpen status.
  let cleanupResult = { planRuns: 0, scheduledGames: 0 };
  try {
    cleanupResult = cleanupStaleDevState();
  } catch (err) {
    console.log(
      color(
        "yellow",
        `[dev] cleanup feilet uventet (${err.message ?? err}) — fortsetter dev-start`
      )
    );
  }

  if (FORCE_SEED) {
    console.log(color("yellow", "[seed] --force-seed satt — kjører seed uansett"));
    if (!runSeed()) return { ok: false };
    return { ok: true, cleanupResult };
  }
  if (SKIP_MIGRATE) {
    // Brukeren vil ikke ha auto-DB-håndtering
    return { ok: true, cleanupResult };
  }
  if (isDatabaseEmpty()) {
    console.log(color("yellow", "[seed] DB tom — kjører førstegangs-seed"));
    if (!runSeed()) return { ok: false };
  } else {
    console.log(color("dim", "[seed] DB allerede seedet, hopper over"));
  }
  return { ok: true, cleanupResult };
}

// ── Child-process management ────────────────────────────────────────────────

const children = [];
let shuttingDown = false;

/**
 * Spawn en navngitt prosess med farge-prefiks-pipe på stdout/stderr.
 * Hver linje blir prefixet med [name] i en gitt farge.
 */
function spawnChild({ name, colorName, command, args: childArgs, cwd, env }) {
  const prefix = color(colorName, `[${name}]`);
  const proc = spawn(command, childArgs, {
    cwd: cwd ?? ROOT,
    env: { ...process.env, FORCE_COLOR: "1", ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  function pipeStream(stream, isErr) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const out = `${prefix} ${line}`;
        if (isErr) process.stderr.write(out + "\n");
        else process.stdout.write(out + "\n");
      }
    });
    stream.on("end", () => {
      if (buf) {
        const out = `${prefix} ${buf}`;
        if (isErr) process.stderr.write(out + "\n");
        else process.stdout.write(out + "\n");
      }
    });
  }

  pipeStream(proc.stdout, false);
  pipeStream(proc.stderr, true);

  proc.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`${prefix} ${color("red", `prosess avsluttet (${reason})`)}`);
    // Hvis backend dør, skru av alt (spillet kan ikke fungere uten)
    if (name === "backend" && code !== 0) {
      console.log(color("red", "[dev:all] backend-dø → tar ned alt"));
      shutdown(1);
    }
  });

  children.push({ name, proc });
  return proc;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  console.log(color("yellow", "[dev:all] avslutter alle prosesser…"));
  for (const { name, proc } of children) {
    if (proc.exitCode !== null) continue;
    try {
      proc.kill("SIGTERM");
    } catch (err) {
      console.log(color("red", `[dev:all] feil ved SIGTERM på ${name}: ${err.message}`));
    }
  }
  // Gi prosessene 3 sek på å avslutte rent, så hard-kill
  setTimeout(() => {
    for (const { name, proc } of children) {
      if (proc.exitCode !== null) continue;
      try {
        proc.kill("SIGKILL");
        console.log(color("yellow", `[dev:all] SIGKILL → ${name}`));
      } catch {
        /* swallow */
      }
    }
    process.exit(exitCode);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (err) => {
  console.error(color("red", `[dev:all] uncaught: ${err.stack ?? err.message}`));
  shutdown(1);
});

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  banner("Spillorama Local Dev Stack");
  console.log(color("dim", "Tobias-direktiv 2026-05-05/2026-05-09 — én-kommando-startup, alltid fersh state"));
  console.log(color("dim", "Ctrl+C avslutter alt"));
  console.log("");

  if (!ensureDockerInfra()) {
    process.exit(1);
  }

  // ── Migrate + smart-seed + stale-state-cleanup ────────────────────────
  // Hvis brukeren har --no-docker satt antar vi at de selv styrer Postgres
  // og vil typisk også styre migrate/seed manuelt — hopp over.
  let cleanupResult = { planRuns: 0, scheduledGames: 0 };
  if (!SKIP_DOCKER) {
    const dbResult = await ensureDatabaseReady();
    if (!dbResult.ok) {
      process.exit(1);
    }
    cleanupResult = dbResult.cleanupResult;
  } else {
    console.log(
      color(
        "yellow",
        "[db] --no-docker satt — hopper over auto-migrate/seed. Kjør 'npm run dev:seed' manuelt om nødvendig."
      )
    );
  }

  // ── Backend ───────────────────────────────────────────────────────────
  spawnChild({
    name: "backend",
    colorName: "magenta",
    command: "npm",
    args: ["--prefix", "apps/backend", "run", "dev"],
    env: {
      // Sørg for at admin-web's vite-proxy treffer riktig port
      PORT: process.env.PORT ?? "4000",
      // Bruk samme DSN som migrate/seed-stegene — `apps/backend/.env`
      // overstyrer fortsatt hvis den finnes (dotenv lastes inne i backend).
      APP_PG_CONNECTION_STRING: PG_DSN,
    },
  });

  // ── Game-client (Vite) ────────────────────────────────────────────────
  spawnChild({
    name: "games",
    colorName: "green",
    command: "npm",
    args: ["-w", "@spillorama/game-client", "run", "dev"],
  });

  // ── Admin-web (Vite) ──────────────────────────────────────────────────
  if (!SKIP_ADMIN) {
    spawnChild({
      name: "admin",
      colorName: "blue",
      command: "npm",
      args: ["-w", "@spillorama/admin-web", "run", "dev"],
      env: {
        // Default i admin-web er localhost:3000 — vi peker den til vår
        // backend på 4000 (eller PORT)
        VITE_DEV_BACKEND_URL: `http://localhost:${process.env.PORT ?? "4000"}`,
      },
    });
  }

  // ── Visual harness ────────────────────────────────────────────────────
  if (!SKIP_HARNESS) {
    spawnChild({
      name: "harness",
      colorName: "cyan",
      command: "node",
      args: ["scripts/serve-visual-harness.mjs"],
    });
  }

  // ── Healthchecks etter ~10s grace period ──────────────────────────────
  console.log("");
  console.log(color("dim", "[dev:all] venter på healthchecks (max 60s)…"));

  const port = Number(process.env.PORT ?? 4000);
  const checks = [
    { name: "backend", port, critical: true, urlPath: "/health" },
    { name: "games", port: 5173, critical: false, urlPath: "/" },
  ];
  if (!SKIP_ADMIN) checks.push({ name: "admin", port: 5174, critical: false, urlPath: "/admin/" });
  if (!SKIP_HARNESS) checks.push({ name: "harness", port: 4173, critical: false, urlPath: "/" });

  const results = await Promise.all(
    checks.map(async (c) => ({
      ...c,
      open: await waitForPort(c.port, c.name, 60),
    }))
  );

  // ── Utvidet status-tabell ─────────────────────────────────────────────
  console.log("");
  banner("Status");
  // PIDs for hver service finnes i `children`-arrayet med samme navn
  for (const r of results) {
    const child = children.find((c) => c.name === r.name);
    const pid = child?.proc?.pid ?? "?";
    const icon = r.open ? color("green", "✓") : color("red", "✗");
    const url = `http://localhost:${r.port}${r.urlPath ?? "/"}`;
    const status = r.open ? color("green", "OK") : color("red", "TIMEOUT");
    console.log(
      `  ${icon}  ${r.name.padEnd(10)} ${url.padEnd(36)} ${status.padEnd(15)} ${color("dim", `(PID ${pid})`)}`
    );
  }

  // ── DB-state seksjon ───────────────────────────────────────────────────
  if (!SKIP_DOCKER) {
    console.log("");
    console.log(color("bold", "DB-state:"));
    let stats = null;
    try {
      stats = getDbStateStats();
    } catch (err) {
      console.log(color("yellow", `   (kunne ikke hente DB-stats: ${err.message ?? err})`));
    }
    if (stats) {
      const fmt = (n) => (n === null ? color("dim", "?") : String(n));
      console.log(`   Halls:                  ${fmt(stats.halls)}`);
      console.log(`   Players:                ${fmt(stats.players)}`);
      const planSuffix = stats.activePlanRunStatus
        ? color("dim", ` (status=${stats.activePlanRunStatus})`)
        : "";
      console.log(`   Plan-runs today:        ${fmt(stats.planRunsToday)}${planSuffix}`);
      console.log(`   Scheduled-games today:  ${fmt(stats.scheduledGamesToday)}`);
      const cleanupTotal = cleanupResult.planRuns + cleanupResult.scheduledGames;
      const cleanupColor = cleanupTotal > 0 ? "yellow" : "dim";
      console.log(
        `   ${color(
          cleanupColor,
          `Stale items cleaned:    ${cleanupResult.planRuns} plan-runs, ${cleanupResult.scheduledGames} scheduled-games`
        )}`
      );
    }
  }

  // ── Test-URL-er (med dynamisk hentet TV-token) ─────────────────────────
  console.log("");
  console.log(color("bold", "Test-URL-er:"));
  let testUrls = null;
  try {
    testUrls = SKIP_DOCKER ? null : getTestUrls(port);
  } catch {
    /* swallow — dynamic URL-fetch er nice-to-have */
  }
  console.log(`   • Backend API     : http://localhost:${port}/health`);
  console.log(`   • Web shell       : http://localhost:${port}/web/`);
  if (!SKIP_ADMIN) console.log(`   • Admin           : http://localhost:5174/admin/`);
  console.log(`   • Game client dev : http://localhost:5173/`);
  if (!SKIP_HARNESS) console.log(`   • Visual harness  : http://localhost:4173/`);
  if (testUrls) {
    console.log("");
    console.log(color("bold", "Pilot-flyt (login: tobias@nordicprofil.no / Spillorama123!):"));
    console.log(
      `   Master:  ${testUrls.masterAdmin}  ${color("dim", "(login: demo-agent-1@spillorama.no / Spillorama123!)")}`
    );
    console.log(`   Spiller: ${testUrls.spillerShell}`);
    if (testUrls.tvScreen) {
      console.log(`   TV:      ${testUrls.tvScreen}`);
    } else {
      console.log(
        `   TV:      ${color("dim", "(ingen aktiv hall med tv_token i DB — kjør 'npm run dev:seed')")}`
      );
    }
  }
  console.log("");
  console.log(
    color(
      "yellow",
      "Tip: kjør 'npm run dev:credentials' for test-bruker-credentials, " +
        "'npm run dev:reset' for å rydde state, eller 'npm run dev:all -- --reset-state' " +
        "for å starte med fersh pilot-state."
    )
  );
  console.log("");

  // Sjekk at minst backend kom opp; ellers krasj
  const backend = results.find((r) => r.name === "backend");
  if (!backend?.open) {
    console.log(color("red", "[dev:all] backend startet ikke — ta ned alt"));
    shutdown(1);
    return;
  }
}

main().catch((err) => {
  console.error(color("red", `[dev:all] start-all feilet: ${err.stack ?? err.message}`));
  shutdown(1);
});
