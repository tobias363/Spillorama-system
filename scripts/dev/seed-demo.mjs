#!/usr/bin/env node
/**
 * scripts/dev/seed-demo.mjs
 *
 * Wrapper rundt `apps/backend/scripts/seed-demo-pilot-day.ts` som også
 * kjører migrasjoner først hvis det trengs, og som skriver et fint sammendrag
 * etter at seedingen er ferdig.
 *
 * Idempotent — kan kjøres flere ganger trygt.
 *
 * Bruk:
 *   npm run dev:seed
 *
 * Forutsetninger:
 *   - Postgres + Redis kjører (npm run dev:all eller docker-compose up).
 *   - apps/backend/.env har APP_PG_CONNECTION_STRING.
 *
 * Hva som skjer:
 *   1. Kjør node-pg-migrate (idempotent — applikerer kun manglende migrasjoner)
 *   2. Kjør seed-demo-pilot-day.ts — oppretter:
 *      - 1 single-hall (demo-hall-999) + 3 spillere + admin + agent
 *      - 4-hall pilot (demo-hall-001..004) + 12 spillere + 4 agenter
 *      - GameManagement (Spill 1) + sub-games + daily schedules
 *   3. Print credentials-sammendrag
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BACKEND_DIR = path.join(ROOT, "apps/backend");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function color(name, text) {
  if (!process.stdout.isTTY) return text;
  return `${COLORS[name] ?? ""}${text}${COLORS.reset}`;
}

function step(label) {
  console.log("");
  console.log(color("cyan", `▸ ${label}`));
}

function runOrExit(command, args, opts = {}) {
  const res = spawnSync(command, args, {
    stdio: "inherit",
    cwd: BACKEND_DIR,
    ...opts,
  });
  if (res.status !== 0) {
    console.error(
      color("red", `[seed] kommando feilet: ${command} ${args.join(" ")}`)
    );
    process.exit(res.status ?? 1);
  }
}

function main() {
  console.log(color("bold", "Spillorama Demo Seed"));
  console.log(color("dim", "Idempotent — trygg å kjøre flere ganger"));

  step("1/3  Kjør migrasjoner (idempotent)");
  runOrExit("npm", ["run", "migrate", "--silent"]);

  step("2/3  Seed demo-pilot-day data");
  runOrExit("npm", ["run", "seed:demo-pilot-day", "--silent"]);

  step("3/3  Ferdig");
  console.log("");
  console.log(color("green", "✓ Demo-data seedet"));
  console.log("");
  console.log(color("bold", "Kjør 'npm run dev:credentials' for test-brukerlister."));
  console.log("");
}

main();
