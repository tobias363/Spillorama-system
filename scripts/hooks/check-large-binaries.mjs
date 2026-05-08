#!/usr/bin/env node
/**
 * check-large-binaries.mjs
 *
 * Blocks accidental commit of large binary files. Intended trigger from
 * lint-staged on extensions like png/jpg/mp3/mp4/zip/pdf — the per-file
 * size limit is enforced here so reviewers don't have to spot a 12 MB
 * asset in a PR.
 *
 *   - Default limit: 1 MB per file.
 *   - Override per-file by adding the path to `.lfs-allowed-paths` (one
 *     glob per line). This is intentional opt-in — the typical correct
 *     answer for a >1 MB asset is "use Git LFS or external CDN", not
 *     "make the limit higher".
 *
 * Receives staged file paths as argv (lint-staged forwards them).
 *
 * Exit code 0 = pass; 1 = at least one file is too large.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const ALLOWLIST_FILE = resolve(new URL("../..", import.meta.url).pathname, ".lfs-allowed-paths");

const allowlist = loadAllowlist();
const files = process.argv.slice(2);
let errorCount = 0;

for (const rel of files) {
  const abs = resolve(rel);
  let size;
  try {
    size = statSync(abs).size;
  } catch (err) {
    console.error(`X ${rel}: cannot stat (${err.message})`);
    errorCount++;
    continue;
  }

  if (size <= MAX_BYTES) continue;

  if (allowlist.some((pat) => globMatch(pat, rel))) {
    // Allowed by .lfs-allowed-paths, skip silently.
    continue;
  }

  console.error(
    `X ${rel}: ${formatBytes(size)} exceeds ${formatBytes(MAX_BYTES)} ` +
      `binary-size limit. Use Git LFS, a CDN, or add the path to .lfs-allowed-paths if intentional.`,
  );
  errorCount++;
}

process.exit(errorCount > 0 ? 1 : 0);

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return [];
  try {
    const raw = readFileSync(ALLOWLIST_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Minimal glob matcher: supports `*` (no slash) and `**` (cross-slash).
 * Sufficient for path patterns like `assets/**` or `*.png`.
 */
function globMatch(pattern, path) {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "::DOUBLESTAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/::DOUBLESTAR::/g, ".*") +
      "$",
  );
  return re.test(path);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
