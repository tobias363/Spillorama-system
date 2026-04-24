#!/usr/bin/env node
/**
 * CSS-in-JS scanner for backdrop-filter: blur() patterns
 *
 * Stylelint scanner CSS-filer. Men Spillorama bruker mye CSS-in-JS
 * (`Object.assign(el.style, { backdropFilter: "blur(...)" })` og
 * template-strenger som settes som `cssText` eller `textContent` på
 * <style>-elementer). Disse går utenom stylelint.
 *
 * Dette scriptet grep-er .ts-filer i packages/game-client/src for
 * `backdropFilter` eller `backdrop-filter`-forekomster og feiler hvis
 * de ikke er:
 *  1. I en fil som er i allowlist (kort-levde popup-backdrops), eller
 *  2. Foregått av en `// stylelint-disable-line no-backdrop-js` kommentar
 *     med en klar begrunnelse.
 *
 * Regelen er basert på `packages/game-client/src/games/game1/ARCHITECTURE.md`.
 *
 * Usage:
 *   node scripts/stylelint-rules/lint-no-backdrop-js.mjs
 *
 * Exits 0 on success, 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(__filename, "../../../");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Filer som har lov til å sette backdropFilter i JS. Disse er kort-levde
 * popup-backdrops hvor Pixi-canvas er maskert bak popup, jfr. allow-list
 * i Game 1 ARCHITECTURE.md.
 */
const ALLOWED_FILES = [
  "packages/game-client/src/games/game1/components/Game1BuyPopup.ts",
  "packages/game-client/src/games/game1/components/WinPopup.ts",
  "packages/game-client/src/games/game1/components/LuckyNumberPicker.ts",
  "packages/game-client/src/games/game1/components/CalledNumbersOverlay.ts",
];

/**
 * Directories to scan. Relative to repo root.
 */
const SCAN_DIRS = [
  "packages/game-client/src",
  "apps/admin-web/src",
];

/**
 * File extensions to scan.
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Skip test files — de må eksplisitt snakke om backdropFilter for å verifisere
 * regresjonstesten. De er ikke produksjonskode.
 */
const SKIP_PATTERNS = [
  /__tests__\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /node_modules/,
];

/**
 * Regex som matcher en problematisk backdrop-filter-bruk:
 *   backdropFilter: "blur(..."
 *   backdropFilter: `blur(...)`
 *   "backdrop-filter: blur(..."
 *   'backdrop-filter: blur(...)'
 *
 * Vi fanger også `webkitBackdropFilter`.
 */
const PATTERN = /(backdrop[-_]?filter|webkitBackdropFilter)\s*[:=]\s*[`"']?[^`"']*\bblur\s*\(/i;

/**
 * Line-level escape: `// lint-no-backdrop-js: <begrunnelse>` på
 * linjen over eller samme linje = tillatt unntak.
 */
const ESCAPE_COMMENT = /\/\/\s*lint-no-backdrop-js:\s*\S/;

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

function isSkipped(relPath) {
  return SKIP_PATTERNS.some((r) => r.test(relPath));
}

function isAllowedFile(relPath) {
  // Normalize for cross-platform path handling
  const normalized = relPath.split(sep).join("/");
  return ALLOWED_FILES.includes(normalized);
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build") {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some((e) => full.endsWith(e))) {
      out.push(full);
    }
  }
}

function scanFile(absPath, relPath) {
  const content = readFileSync(absPath, "utf8");
  const lines = content.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!PATTERN.test(line)) continue;

    // Check if the line above has an escape comment
    const prev = i > 0 ? lines[i - 1] : "";
    if (ESCAPE_COMMENT.test(line) || ESCAPE_COMMENT.test(prev)) continue;

    // Skip inside a block/line comment that's describing the ban itself
    // (heuristic: line starts with //, /*, or * — pure comment contexts).
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }

    violations.push({ line: i + 1, text: line.trim() });
  }

  return violations;
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    walk(abs, files);
  }

  let totalViolations = 0;
  const report = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs);
    if (isSkipped(rel)) continue;

    const violations = scanFile(abs, rel);
    if (violations.length === 0) continue;

    if (isAllowedFile(rel)) {
      // Known-OK file; still log so we can audit.
      continue;
    }

    totalViolations += violations.length;
    for (const v of violations) {
      report.push(`${rel}:${v.line}: ${v.text}`);
    }
  }

  if (totalViolations === 0) {
    // eslint-disable-next-line no-console
    console.log(
      "lint-no-backdrop-js: OK — ingen uautoriserte backdropFilter/blur-mønstre i CSS-in-JS.",
    );
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(
    "lint-no-backdrop-js: FAIL — " +
      `fant ${totalViolations} uautorisert${totalViolations === 1 ? "" : "e"} ` +
      "backdropFilter-bruk i CSS-in-JS.\n\n" +
      "Tillatte filer (popup-backdrops):\n" +
      ALLOWED_FILES.map((f) => "  - " + f).join("\n") +
      "\n\nFor å legge til unntak: sett `// lint-no-backdrop-js: <begrunnelse>` " +
      "på linjen over, ELLER legg filen til ALLOWED_FILES i scripts/stylelint-rules/lint-no-backdrop-js.mjs.\n\n" +
      "Overtredelser:\n" +
      report.map((r) => "  " + r).join("\n") +
      "\n\nSe packages/game-client/src/games/game1/ARCHITECTURE.md for bakgrunn.",
  );
  process.exit(1);
}

main();
