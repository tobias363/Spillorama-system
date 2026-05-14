#!/usr/bin/env node
/**
 * check-markdown-links.mjs
 *
 * Validates that relative links in changed markdown files actually resolve
 * to a file or directory in the repo. Catches stale `@docs/...` and
 * `[label](path/to/file.md)` references that broke when the source moved.
 *
 * Receives staged file paths as argv (lint-staged forwards them).
 *
 * Skips:
 *  - http(s) URLs (we don't hit the network from a pre-commit hook)
 *  - mailto: / tel: schemes
 *  - inline code blocks (between ``` fences)
 *  - in-page anchors (#section-id)
 *  - intentional placeholder links (path starts with `<` or contains `${`)
 *
 * Exit code 0 = pass; 1 = at least one broken link.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, isAbsolute, normalize } from "node:path";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
const files = process.argv.slice(2);
let errorCount = 0;

// Skip files in archive/-folders. Archived docs are immutable historical
// snapshots — links inside them captured state at write-time and may not
// resolve after subsequent file moves. We intentionally don't lint them
// to avoid blocking legitimate consolidation/archival commits.
const ARCHIVE_SEGMENT = /(^|\/)archive\//;

for (const rel of files) {
  if (ARCHIVE_SEGMENT.test(rel)) {
    continue;
  }
  const file = resolve(rel);
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`X ${rel}: cannot read file (${err.message})`);
    errorCount++;
    continue;
  }

  const fileDir = dirname(file);
  const links = extractLinks(content);

  for (const { href, line } of links) {
    if (shouldSkip(href)) {
      continue;
    }

    const cleaned = stripFragment(href);
    if (cleaned === "") {
      // Pure anchor link, already filtered by shouldSkip but be safe.
      continue;
    }

    const resolved = resolveLink(cleaned, fileDir);
    if (resolved === null) {
      // Outside repo root or path was unsafe — skip silently rather than
      // false-flag.
      continue;
    }

    if (!existsSync(resolved)) {
      console.error(`X ${rel}:${line}: broken link '${href}' -> ${pathRelative(resolved)} not found`);
      errorCount++;
      continue;
    }

    // Resolve directories to README.md / index.md if the link targets a folder.
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      const readme1 = join(resolved, "README.md");
      const readme2 = join(resolved, "index.md");
      if (!existsSync(readme1) && !existsSync(readme2)) {
        // Acceptable to link to a directory, just note it informationally.
        // Don't fail.
      }
    }
  }
}

process.exit(errorCount > 0 ? 1 : 0);

/**
 * Strip code fences and inline code, then extract `[label](href)` links
 * AND `@path/...` references that point to files in the repo.
 *
 * Returns array of `{ href, line }`.
 */
function extractLinks(content) {
  const out = [];

  // Remove triple-fenced code blocks
  let stripped = content.replace(/```[\s\S]*?```/g, (block) => "\n".repeat(block.split("\n").length - 1));

  // Remove inline `code` spans
  stripped = stripped.replace(/`[^`]*`/g, "");

  const lines = stripped.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // [label](href) — only capture (href), and ignore image links since
    // they often point to assets which we still care about; but at least
    // skip empty hrefs.
    const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = linkRe.exec(line)) !== null) {
      const href = m[1].trim();
      if (href !== "") {
        out.push({ href, line: i + 1 });
      }
    }

    // @docs/foo/bar.md or @apps/backend/src/x.ts at start of token.
    // Used by Spillorama CLAUDE.md style refs. We accept @<path> if the
    // first segment is a known top-level folder.
    const atRe = /(?:^|[\s(])(@(?:docs|apps|packages|legacy|infra|scripts)\/[^\s()'"`,;]+)/g;
    let n;
    while ((n = atRe.exec(line)) !== null) {
      const href = n[1].slice(1); // drop leading '@'
      out.push({ href, line: i + 1 });
    }
  }

  return out;
}

function shouldSkip(href) {
  if (href.startsWith("http://") || href.startsWith("https://")) return true;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return true;
  if (href.startsWith("//")) return true;
  if (href.startsWith("#")) return true;
  if (href.startsWith("<")) return true; // template placeholder
  if (href.includes("${")) return true; // ${var} interpolation
  if (href.startsWith("data:")) return true;
  return false;
}

function stripFragment(href) {
  const i = href.indexOf("#");
  return i >= 0 ? href.slice(0, i) : href;
}

function resolveLink(href, fromDir) {
  // Treat absolute paths as repo-rooted (common Spillorama convention).
  if (isAbsolute(href)) {
    const candidate = normalize(join(REPO_ROOT, "." + href));
    return ensureInsideRepo(candidate);
  }

  const candidate = normalize(join(fromDir, href));
  return ensureInsideRepo(candidate);
}

function ensureInsideRepo(p) {
  const rooted = normalize(p);
  if (!rooted.startsWith(REPO_ROOT)) return null;
  return rooted;
}

function pathRelative(p) {
  if (p.startsWith(REPO_ROOT + "/")) return p.slice(REPO_ROOT.length + 1);
  return p;
}
