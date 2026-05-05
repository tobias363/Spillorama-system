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
 *   2. Starter backend (tsx --watch på port 4000), admin-web (Vite på 5174),
 *      game-client (Vite på default 5173) og visual-harness (Node på 4173)
 *      parallelt med farge-kodet output-prefiks.
 *   3. Helsesjekker hver port etter ~10 sek — printer en fin status-tabell.
 *   4. Ctrl+C dreper alle barneprosesser rent (SIGTERM først, så SIGKILL
 *      etter 3 sek hvis noe henger).
 *
 * Bruk:
 *   npm run dev:all
 *
 * Flagg:
 *   --no-docker    Hopp Docker-sjekk (hvis du har Postgres/Redis lokalt)
 *   --no-harness   Skip visual-harness (sparer en port)
 *   --no-admin     Skip admin-web (kun backend + game-client)
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

  // ── Backend ───────────────────────────────────────────────────────────
  spawnChild({
    name: "backend",
    colorName: "magenta",
    command: "npm",
    args: ["--prefix", "apps/backend", "run", "dev"],
    env: {
      // Sørg for at admin-web's vite-proxy treffer riktig port
      PORT: process.env.PORT ?? "4000",
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
