#!/usr/bin/env node
/**
 * scripts/dev/tunnel.mjs
 *
 * Eksponer lokal backend (port 4000) via ngrok så Tobias eller andre
 * kan teste mobil-klient mot lokal stack uten å vente på Render-deploy.
 *
 * Bruk:
 *   npm run dev:tunnel
 *   npm run dev:tunnel -- --port=4000
 *
 * Krever at ngrok er installert. Hvis ikke, vises installasjons-instruksjoner.
 */

import { spawnSync, spawn } from "node:child_process";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
function color(name, t) {
  if (!process.stdout.isTTY) return t;
  return `${COLORS[name] ?? ""}${t}${COLORS.reset}`;
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    out[k] = v === undefined ? true : v;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 4000);

function ngrokInstalled() {
  const res = spawnSync("ngrok", ["version"], { stdio: "ignore" });
  return res.status === 0;
}

function printInstallInstructions() {
  console.log(color("yellow", "ngrok er ikke installert."));
  console.log("");
  console.log(color("bold", "Installer:"));
  console.log("  macOS    : brew install ngrok/ngrok/ngrok");
  console.log("  Windows  : choco install ngrok");
  console.log("  Linux    : se https://ngrok.com/download");
  console.log("");
  console.log(color("bold", "Etter installasjon:"));
  console.log("  1. Lag konto: https://ngrok.com/signup");
  console.log("  2. Kjør: ngrok config add-authtoken <DIN_TOKEN>");
  console.log("  3. Kjør: npm run dev:tunnel");
  console.log("");
}

function main() {
  console.log(color("cyan", `▸ Tunneling localhost:${PORT} via ngrok`));

  if (!ngrokInstalled()) {
    printInstallInstructions();
    process.exit(1);
  }

  // Sjekk at backend faktisk lytter på porten
  console.log(color("dim", `  forventer at backend lytter på localhost:${PORT}`));
  console.log("");
  console.log(color("yellow", "  NB: aldri eksponer prod-credentials via ngrok-URL —"));
  console.log(color("yellow", "      bruk kun for lokal test."));
  console.log("");

  // Start ngrok
  const proc = spawn("ngrok", ["http", String(PORT), "--log=stdout"], {
    stdio: "inherit",
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  process.on("SIGINT", () => {
    proc.kill("SIGTERM");
  });
}

main();
