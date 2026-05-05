#!/usr/bin/env node
/**
 * scripts/dev/credentials.mjs
 *
 * Skriver ut alle test-bruker-credentials for lokal utvikling. Henter live
 * data fra DB hvis tilgjengelig, ellers faller tilbake til static seed-info.
 *
 * Bruk:
 *   npm run dev:credentials
 *
 * Output:
 *   - Demo Hall + 3 spillere
 *   - 4-hall pilot + 12 spillere
 *   - Admin og agent-credentials
 *   - Auto-login URL-eksempler (for ?dev-user=X-flagget)
 *   - URL-er til admin, web shell og visual harness
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

// pg + dotenv ligger i root node_modules (workspace-hoisted) eller i
// apps/backend/node_modules. Vi prøver root først, så fallback. Vi bruker
// createRequire fordi root-package.json ikke deklarerer disse selv.
const require = createRequire(import.meta.url);

function resolveDep(name) {
  const candidates = [
    path.join(ROOT, "node_modules", name),
    path.join(ROOT, "apps/backend/node_modules", name),
  ];
  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* fall through */
    }
  }
  throw new Error(
    `Kunne ikke laste '${name}' fra ${candidates.join(" eller ")}. Kjør 'npm install' fra root.`,
  );
}

const dotenv = resolveDep("dotenv");
const pg = resolveDep("pg");

dotenv.config({ path: path.join(ROOT, "apps/backend/.env") });

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};
function color(name, t) {
  if (!process.stdout.isTTY) return t;
  return `${COLORS[name] ?? ""}${t}${COLORS.reset}`;
}

const PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";
const PORT = process.env.PORT ?? "4000";
const ADMIN_PORT = "5174";
const GAMES_PORT = "5173";
const HARNESS_PORT = "4173";

// Default seed-data — matcher seed-demo-pilot-day.ts
const SEED_INFO = {
  admin: { email: "demo-admin@spillorama.no", role: "ADMIN" },
  tobias: { email: "tobias@nordicprofil.no", role: "ADMIN" },
  agentSingle: { email: "demo-agent@spillorama.no", primaryHall: "demo-hall-999" },
  pilotAgents: [1, 2, 3, 4].map((n) => ({
    email: `demo-agent-${n}@spillorama.no`,
    primaryHall: `demo-hall-00${n}`,
  })),
  singlePlayers: [1, 2, 3].map((n) => ({
    email: `demo-spiller-${n}@example.com`,
    hall: "demo-hall-999",
  })),
  pilotPlayers: Array.from({ length: 12 }, (_, i) => {
    const num = i + 1;
    const hallIdx = Math.floor(i / 3) + 1;
    return {
      email: `demo-pilot-spiller-${num}@example.com`,
      hall: `demo-hall-00${hallIdx}`,
    };
  }),
};

function divider(text) {
  const line = "─".repeat(72);
  console.log("");
  console.log(color("cyan", line));
  console.log(color("cyan", `  ${color("bold", text)}`));
  console.log(color("cyan", line));
}

function printRow(label, value, valueColor = "green") {
  console.log(`  ${label.padEnd(30)} ${color(valueColor, value)}`);
}

async function fetchLiveCredentials() {
  const conn =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING;
  if (!conn) return null;
  try {
    const client = new pg.Client({ connectionString: conn, connectionTimeoutMillis: 2000 });
    await client.connect();
    const { rows } = await client.query(
      `SELECT email, role, hall_id
         FROM app_users
        WHERE email LIKE 'demo-%@%'
           OR email LIKE '%@example.com'
           OR email = 'tobias@nordicprofil.no'
        ORDER BY role DESC, email`
    );
    await client.end();
    return rows;
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log(color("bold", "Spillorama Lokal-Test Credentials"));
  console.log(color("dim", `Default-passord: ${PASSWORD}`));

  const live = await fetchLiveCredentials();
  if (live === null) {
    console.log(
      color(
        "yellow",
        "(DB-en ikke tilgjengelig — viser seed-default. Kjør 'npm run dev:seed' for live data.)"
      )
    );
  } else if (live.length === 0) {
    console.log(
      color(
        "yellow",
        "(Ingen demo-brukere i DB ennå. Kjør 'npm run dev:seed' for å seede.)"
      )
    );
  } else {
    console.log(color("dim", `(viser ${live.length} live demo-brukere fra DB)`));
  }

  // ── ADMIN ─────────────────────────────────────────────────────────────
  divider("ADMIN-tilgang");
  printRow(SEED_INFO.admin.email, PASSWORD, "green");
  printRow(SEED_INFO.tobias.email, PASSWORD, "green");
  console.log(
    color(
      "dim",
      `  Logg inn på: http://localhost:${ADMIN_PORT}/admin/`
    )
  );

  // ── AGENTER ───────────────────────────────────────────────────────────
  divider("AGENTER (bingoverter)");
  printRow(SEED_INFO.agentSingle.email, PASSWORD, "blue");
  console.log(
    color("dim", `  Primary hall: ${SEED_INFO.agentSingle.primaryHall} (single-hall)`)
  );
  console.log("");
  for (const a of SEED_INFO.pilotAgents) {
    printRow(a.email, PASSWORD, "blue");
    console.log(color("dim", `  Primary hall: ${a.primaryHall} (pilot)`));
  }
  console.log("");
  console.log(
    color(
      "dim",
      `  Logg inn på: http://localhost:${ADMIN_PORT}/admin/   (admin redirecter til /agent/)`
    )
  );

  // ── SPILLERE ──────────────────────────────────────────────────────────
  divider("SPILLERE — single hall (demo-hall-999)");
  for (const p of SEED_INFO.singlePlayers) {
    printRow(p.email, PASSWORD, "magenta");
  }

  divider("SPILLERE — 4-hall pilot");
  for (const p of SEED_INFO.pilotPlayers) {
    printRow(p.email.padEnd(40), p.hall, "magenta");
  }

  // ── AUTO-LOGIN URL-er ─────────────────────────────────────────────────
  divider("Dev auto-login (NODE_ENV=development only)");
  console.log(color("yellow", "  Auto-login hopper login-skjerm. KUN for lokal dev."));
  console.log("");
  console.log(`  ${color("dim", "Spiller 1 (single hall):")}`);
  console.log(
    `    http://localhost:${PORT}/web/?dev-user=demo-spiller-1@example.com`
  );
  console.log(`  ${color("dim", "Pilot agent 1:")}`);
  console.log(
    `    http://localhost:${ADMIN_PORT}/admin/?dev-user=demo-agent-1@spillorama.no`
  );
  console.log(`  ${color("dim", "Tobias-admin:")}`);
  console.log(
    `    http://localhost:${ADMIN_PORT}/admin/?dev-user=tobias@nordicprofil.no`
  );

  // ── URL-er ────────────────────────────────────────────────────────────
  divider("Dev URL-er");
  console.log(`  ${color("dim", "Backend health:")} http://localhost:${PORT}/health`);
  console.log(`  ${color("dim", "Web shell    :")} http://localhost:${PORT}/web/`);
  console.log(`  ${color("dim", "Admin        :")} http://localhost:${ADMIN_PORT}/admin/`);
  console.log(`  ${color("dim", "Game-client  :")} http://localhost:${GAMES_PORT}/`);
  console.log(`  ${color("dim", "Visual harn. :")} http://localhost:${HARNESS_PORT}/`);
  console.log("");
}

main().catch((err) => {
  console.error(color("red", `[credentials] feil: ${err.stack ?? err.message}`));
  process.exit(1);
});
