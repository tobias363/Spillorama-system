#!/usr/bin/env node
/**
 * Documentation validation script.
 *
 * Sjekker at:
 *   1. Hver større modul (>1000 LOC) har README.md
 *   2. README har påkrevde seksjoner (Ansvar, Public API, Invariants)
 *   3. ADR-numbering er kontinuerlig
 *   4. Kjernedocs eksisterer (MASTER_README.md, SYSTEM_DESIGN_PRINCIPLES.md, BACKLOG.md)
 *   5. Mermaid-diagrammer eksisterer
 *
 * Output: warnings (ikke errors) — CI passerer alltid. Brukes for å gradvis
 * stramme opp dokumentasjon over tid.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const MIN_LOC_FOR_README = 1000;

let warnings = 0;
let errors = 0;

const log = {
  warn: (msg) => {
    warnings++;
    console.warn(`WARN: ${msg}`);
  },
  err: (msg) => {
    errors++;
    console.error(`ERR:  ${msg}`);
  },
  ok: (msg) => console.log(`OK:   ${msg}`),
};

// ---------- 1. Core docs ----------

const CORE_DOCS = [
  "MASTER_README.md",
  "BACKLOG.md",
  "docs/SYSTEM_DESIGN_PRINCIPLES.md",
  "docs/SESSION_HANDOFF_PROTOCOL.md",
  "docs/decisions/README.md",
  "docs/diagrams/README.md",
];

console.log("Checking core documentation files...");
for (const path of CORE_DOCS) {
  if (!existsSync(join(REPO_ROOT, path))) {
    log.err(`Missing core doc: ${path}`);
  } else {
    log.ok(path);
  }
}

// ---------- 2. ADR-er ----------

console.log("\nChecking ADR continuity...");
const ADR_DIR = join(REPO_ROOT, "docs/decisions");
if (existsSync(ADR_DIR)) {
  const adrFiles = readdirSync(ADR_DIR)
    .filter((f) => f.match(/^ADR-(\d+)-/))
    .sort();

  const adrNumbers = adrFiles.map((f) => parseInt(f.match(/^ADR-(\d+)-/)[1], 10));

  for (let i = 0; i < adrNumbers.length; i++) {
    if (adrNumbers[i] !== i + 1) {
      log.warn(`ADR-numbering hopp: expected ${i + 1}, found ${adrNumbers[i]}`);
    }
  }
  console.log(`Found ${adrFiles.length} ADRs (${adrFiles[0]} ... ${adrFiles[adrFiles.length - 1] || "-"})`);
}

// ---------- 3. Mermaid-diagrammer ----------

console.log("\nChecking Mermaid diagrams...");
const DIAGRAMS_DIR = join(REPO_ROOT, "docs/diagrams");
const EXPECTED_DIAGRAMS = [
  "01-system-tiers.md",
  "02-login-flow.md",
  "03-draw-flow-spill1.md",
  "04-perpetual-loop-spill2-3.md",
  "05-master-handover.md",
];

if (existsSync(DIAGRAMS_DIR)) {
  for (const fname of EXPECTED_DIAGRAMS) {
    if (!existsSync(join(DIAGRAMS_DIR, fname))) {
      log.warn(`Missing diagram: docs/diagrams/${fname}`);
    } else {
      // Sjekk at filen inneholder mermaid-block
      const content = readFileSync(join(DIAGRAMS_DIR, fname), "utf-8");
      if (!content.includes("```mermaid")) {
        log.warn(`Diagram ${fname} har ikke mermaid-blokk`);
      }
    }
  }
}

// ---------- 4. Per-modul README for store moduler ----------

console.log("\nChecking per-module READMEs...");

const MODULE_DIRS = [
  "apps/backend/src/game",
  "apps/backend/src/wallet",
  "apps/backend/src/compliance",
  "apps/backend/src/auth",
  "apps/backend/src/sockets",
  "apps/backend/src/routes",
  "apps/backend/src/platform",
  "apps/backend/src/middleware",
  "apps/backend/src/admin",
  "apps/backend/src/agent",
  "apps/backend/src/spillevett",
  "apps/backend/src/payments",
  "apps/backend/src/observability",
  "apps/backend/src/services",
  "apps/backend/src/adapters",
  "apps/backend/src/draw-engine",
  "apps/backend/src/jobs",
  "apps/backend/src/integration",
  "apps/backend/src/notifications",
  "packages/game-client/src",
  "packages/game-client/src/games",
  "packages/shared-types/src",
  "apps/admin-web/src",
];

function countLOC(dir) {
  let loc = 0;
  function walk(d) {
    try {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry);
        const stat = statSync(full);
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules" && entry !== "__tests__") {
          walk(full);
        } else if (stat.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js"))) {
          if (!entry.endsWith(".test.ts") && !entry.endsWith(".spec.ts")) {
            const content = readFileSync(full, "utf-8");
            loc += content.split("\n").length;
          }
        }
      }
    } catch {
      // dir ikke tilgjengelig — hopp
    }
  }
  walk(dir);
  return loc;
}

for (const moduleDir of MODULE_DIRS) {
  const fullPath = join(REPO_ROOT, moduleDir);
  if (!existsSync(fullPath)) continue;

  const readmePath = join(fullPath, "README.md");
  const loc = countLOC(fullPath);

  if (loc < MIN_LOC_FOR_README) continue;

  if (!existsSync(readmePath)) {
    log.warn(`Module without README: ${moduleDir} (${loc} LOC)`);
    continue;
  }

  // Sjekk for påkrevde seksjoner
  const content = readFileSync(readmePath, "utf-8");
  const requiredSections = ["## Ansvar", "## Public API", "## Referanser"];
  const missingSection = requiredSections.find((s) => !content.includes(s));
  if (missingSection) {
    log.warn(`${moduleDir}/README.md mangler seksjon: ${missingSection}`);
  } else {
    log.ok(`${moduleDir} (${loc} LOC)`);
  }
}

// ---------- Output summary ----------

console.log("\n--- Summary ---");
console.log(`Warnings: ${warnings}`);
console.log(`Errors: ${errors}`);

// Vi exitter alltid 0 — dette er kun warnings.
// Når dokumentasjon er stabil, kan vi flippe til exit 1 for å enforce.
console.log("\nNote: This is a warning-only validation. CI passes regardless.");
process.exit(0);
