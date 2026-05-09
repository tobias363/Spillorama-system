#!/usr/bin/env node
/**
 * scripts/dev/start-all.mjs
 *
 * Local-test-stack one-command launcher (Tobias-direktiv 2026-05-05).
 *
 * Mål: redusere iterasjon fra 5-7 min Render-deploy til 2-sek hot-reload.
 *
 * Hva den gjør:
 *   1. Sjekker at Docker (Postgres + Redis) kjører — starter dem hvis de
 *      er nede (via docker-compose up postgres redis).
 *   2. Venter på at Postgres er klar og kjører `npm run migrate`
 *      idempotent (henter manglende migrasjoner).
 *   3. Heuristikk-sjekk: hvis DB er tom (ingen rader i app_halls), kjør
 *      `npm run seed:demo-pilot-day` automatisk slik at admin/agent/spillere
 *      kan logge inn etter første-gangs-startup.
 *   4. Bygger @spillorama/shared-types (idempotent tsc) — slik at backend
 *      ikke krasjer ved oppstart med "module does not provide an export
 *      named X" når src/ har nye exports som ikke er i dist/.
 *   5. Starter backend (tsx --watch på port 4000), admin-web (Vite på 5174),
 *      game-client (Vite på default 5173) og visual-harness (Node på 4173)
 *      parallelt med farge-kodet output-prefiks.
 *   6. Helsesjekker hver port etter ~10 sek — printer en fin status-tabell.
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
 *   --skip-build     Hopp over shared-types-build (hvis dist/ er ferskt)
 *   --force-seed     Re-seed selv om DB ikke er tom (idempotent)
 *
 * Backwards-compat: `npm run dev` (alene) fungerer fortsatt som før — denne
 * scripten er additiv og endrer ingen eksisterende workflows.
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
const SKIP_BUILD = args.has("--skip-build");

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

/**
 * Bygg shared-types før backend starter (Tobias-direktiv 2026-05-09).
 *
 * Hvorfor: backend importerer fra `@spillorama/shared-types` som peker på
 * `packages/shared-types/dist/`. Hvis kildekoden i `src/` har nye exports
 * som ikke er bygd til `dist/`, krasjer backend ved oppstart med:
 *
 *   SyntaxError: The requested module '@spillorama/shared-types' does not
 *   provide an export named 'XXX'
 *
 * Vi kjører tsc-build på shared-types før backend spawn for å garantere
 * at `dist/` er friskt. Idempotent — typescript hopper over uendrede filer.
 */
function buildSharedTypes() {
  if (SKIP_BUILD) {
    console.log(color("yellow", "[build] hoppet over (--skip-build)"));
    return true;
  }
  console.log(color("blue", "[build] bygger @spillorama/shared-types"));
  const res = spawnSync(
    "npm",
    ["--prefix", "packages/shared-types", "run", "build", "--silent"],
    {
      cwd: ROOT,
      stdio: "inherit",
    }
  );
  if (res.status !== 0) {
    console.log(
      color(
        "red",
        "[build] shared-types-build feilet — sjekk TypeScript-feil i packages/shared-types/src/, " +
          "eller bruk --skip-build hvis dist/ er ferskt."
      )
    );
    return false;
  }
  console.log(color("green", "[build] ✓ shared-types bygd"));
  return true;
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
  const sql = "SELECT COUNT(*)::int AS n FROM app_halls;";
  const node = spawnSync(
    "node",
    [
      "-e",
      `import("pg").then(async ({default: pg}) => {
        const c = new pg.Client({connectionString: process.env.APP_PG_CONNECTION_STRING});
        await c.connect();
        try {
          const r = await c.query(${JSON.stringify(sql)});
          process.stdout.write(String(r.rows[0]?.n ?? 0));
          await c.end();
        } catch (err) {
          process.stderr.write(String(err.message || err));
          await c.end();
          process.exit(2);
        }
      }).catch(err => { process.stderr.write(String(err.message || err)); process.exit(3); });`,
    ],
    {
      // ROOT har hoisted node_modules (pg) — apps/backend har ingen lokal
      // node_modules siden prosjektet bruker workspace-hoisting.
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, APP_PG_CONNECTION_STRING: PG_DSN },
    }
  );
  if (node.status !== 0) {
    const errOut = node.stderr?.toString().trim() ?? "";
    console.log(
      color(
        "yellow",
        `[seed] kunne ikke sjekke DB-tilstand (${errOut || `exit ${node.status}`}) — hopper over seed`
      )
    );
    return false;
  }
  const count = Number(node.stdout?.toString().trim() ?? "0");
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

/**
 * Kombinert helper: vent på PG, kjør migrate, sjekk om DB er tom, kjør seed.
 * Returnerer true hvis alt gikk bra (eller ble skippet trygt).
 */
async function ensureDatabaseReady() {
  if (SKIP_MIGRATE && !FORCE_SEED) {
    console.log(
      color(
        "yellow",
        "[db] --skip-migrate satt — hopper også over auto-seed-sjekk. Bruk --force-seed for å re-seede."
      )
    );
    return true;
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
    return false;
  }
  console.log(color("green", "[migrate] Postgres klar"));
  if (!runMigrate()) return false;

  if (FORCE_SEED) {
    console.log(color("yellow", "[seed] --force-seed satt — kjører seed uansett"));
    if (!runSeed()) return false;
    return true;
  }
  if (SKIP_MIGRATE) {
    // Brukeren vil ikke ha auto-DB-håndtering
    return true;
  }
  if (isDatabaseEmpty()) {
    console.log(color("yellow", "[seed] DB tom — kjører førstegangs-seed"));
    if (!runSeed()) return false;
  } else {
    console.log(color("dim", "[seed] DB allerede seedet, hopper over"));
  }
  return true;
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
  console.log(color("dim", "Tobias-direktiv 2026-05-05 — én-kommando-startup"));
  console.log(color("dim", "Ctrl+C avslutter alt"));
  console.log("");

  if (!ensureDockerInfra()) {
    process.exit(1);
  }

  // ── Migrate + smart-seed (Tobias-direktiv 2026-05-08) ─────────────────
  // Hvis brukeren har --no-docker satt antar vi at de selv styrer Postgres
  // og vil typisk også styre migrate/seed manuelt — hopp over.
  if (!SKIP_DOCKER) {
    const dbOk = await ensureDatabaseReady();
    if (!dbOk) {
      process.exit(1);
    }
  } else {
    console.log(
      color(
        "yellow",
        "[db] --no-docker satt — hopper over auto-migrate/seed. Kjør 'npm run dev:seed' manuelt om nødvendig."
      )
    );
  }

  // ── Build shared-types (Tobias-direktiv 2026-05-09) ──────────────────
  // Backend importerer fra @spillorama/shared-types/dist. Hvis dist/ er
  // stale relative til src/ (eks. nye exports som GameLobbyAggregator-
  // refactor sin Spill1AgentLobbyStateSchema), krasjer backend på oppstart.
  // tsc-build er idempotent — uendrede filer hoppes over.
  if (!buildSharedTypes()) {
    process.exit(1);
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

  const checks = [
    { name: "backend", port: Number(process.env.PORT ?? 4000), critical: true },
    { name: "games", port: 5173, critical: false },
  ];
  if (!SKIP_ADMIN) checks.push({ name: "admin", port: 5174, critical: false });
  if (!SKIP_HARNESS) checks.push({ name: "harness", port: 4173, critical: false });

  const results = await Promise.all(
    checks.map(async (c) => ({
      ...c,
      open: await waitForPort(c.port, c.name, 60),
    }))
  );

  console.log("");
  banner("Status");
  for (const r of results) {
    const icon = r.open ? color("green", "✓") : color("red", "✗");
    const portStr = `localhost:${r.port}`;
    const status = r.open ? color("green", "OK") : color("red", "TIMEOUT");
    console.log(`  ${icon}  ${r.name.padEnd(10)} ${portStr.padEnd(20)} ${status}`);
  }
  console.log("");
  console.log(color("bold", "URLs:"));
  console.log(`  • Backend API     : http://localhost:${process.env.PORT ?? 4000}/health`);
  console.log(`  • Web shell       : http://localhost:${process.env.PORT ?? 4000}/web/`);
  if (!SKIP_ADMIN) console.log(`  • Admin           : http://localhost:5174/admin/`);
  console.log(`  • Game client dev : http://localhost:5173/`);
  if (!SKIP_HARNESS) console.log(`  • Visual harness  : http://localhost:4173/`);
  console.log("");
  console.log(
    color(
      "yellow",
      "Tip: kjør 'npm run dev:credentials' for test-bruker-credentials, eller " +
        "'npm run dev:seed' for demo-data."
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
