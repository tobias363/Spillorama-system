#!/usr/bin/env node
/**
 * a11y-fix-icon-buttons.cjs
 *
 * Adds aria-label and aria-hidden to icon-only Font Awesome buttons across
 * admin-web. Idempotent — only adds attrs that are missing.
 *
 * Pattern detected:
 *   <element>.innerHTML = `<i class="fa fa-X"></i>` (icon-only)
 *   <element>.innerHTML = ` <i class="fa fa-X"></i>` (variants)
 *   <element>.innerHTML = `<i class="fa fa-X"></i> Label` (icon+label, just aria-hidden the icon)
 *
 * Logic for icon-only buttons (no text after </i>):
 *  - Add aria-label using nearby `.title = t("...")` if present
 *  - Add aria-hidden="true" to the <i> tag
 *
 * Run: node tools/a11y-fix-icon-buttons.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "apps/admin-web/src");

let filesChanged = 0;
let totalEdits = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) processFile(full);
  }
}

function processFile(file) {
  const original = fs.readFileSync(file, "utf8");
  let src = original;
  let edits = 0;

  // First, replace `<i class="fa ..."></i>` to include aria-hidden="true"
  // (skip if already has aria-hidden)
  src = src.replace(/<i class="fa([^"]*)"(\s*)><\/i>/g, (m, cls, sp) => {
    edits++;
    return `<i class="fa${cls}" aria-hidden="true"${sp}></i>`;
  });

  // Pattern: button/anchor variable assigned innerHTML with icon and a title set —
  // we add `setAttribute("aria-label", title-value)`.
  // Match block:
  //   <var>.innerHTML = `... <i class="fa fa-X" ...></i> ...`;
  //   <var>.title = t("...");
  // Insert after .title:  <var>.setAttribute("aria-label", t("..."));
  // Skip if already has aria-label

  src = src.replace(
    /(\b(\w+)\.title\s*=\s*(t\([^)]+\)|"[^"]+"|'[^']+');)/g,
    (whole, _stmt, varName, value, off, fullStr) => {
      // Look-back to verify this var has innerHTML with <i class="fa
      const lookbackStart = Math.max(0, off - 800);
      const segment = fullStr.slice(lookbackStart, off);
      if (!new RegExp(`\\b${varName}\\.innerHTML\\s*=\\s*[\`\"'][^\`\"']*<i class="fa`).test(segment)) {
        return whole;
      }
      // Check if aria-label already set somewhere nearby for this var
      const lookahead = fullStr.slice(off, Math.min(fullStr.length, off + 400));
      if (new RegExp(`\\b${varName}\\.setAttribute\\(\\s*["']aria-label["']`).test(lookahead) ||
          new RegExp(`\\b${varName}\\.setAttribute\\(\\s*["']aria-label["']`).test(segment)) {
        return whole;
      }
      // Determine the indent before the .title statement
      const lineStart = fullStr.lastIndexOf("\n", off) + 1;
      const indent = fullStr.slice(lineStart, off).match(/^\s*/)[0];
      edits++;
      return `${whole}\n${indent}${varName}.setAttribute("aria-label", ${value});`;
    }
  );

  if (src !== original) {
    fs.writeFileSync(file, src, "utf8");
    filesChanged++;
    totalEdits += edits;
    console.log(`  fixed ${edits} in ${path.relative(ROOT, file)}`);
  }
}

console.log(`Scanning ${ROOT}…`);
walk(ROOT);
console.log(`\nDone. ${filesChanged} files changed, ${totalEdits} attributes added.`);
