#!/usr/bin/env node
/**
 * validate-migration-name.mjs
 *
 * Enforces the migration-naming convention for `apps/backend/migrations/*.sql`:
 *
 *   YYYYMMDDhhmmss_<snake_case_description>.sql
 *
 * Examples:
 *   20260417000002_static_tickets.sql      OK
 *   20261210010300_app_game_catalog_prize_multiplier_mode.sql  OK
 *   2026-04-17_static_tickets.sql           BAD (dashes in timestamp)
 *   20260417_StaticTickets.sql              BAD (camelCase, missing time)
 *
 * In addition to format, we check that the new file's timestamp is
 * strictly greater than the largest existing timestamp in the migrations
 * directory. node-pg-migrate runs files in lexicographic order, so a
 * back-dated migration would silently re-shuffle the apply-order on a
 * fresh DB.
 *
 * Receives staged file paths as argv (lint-staged forwards them).
 *
 * Exit code 0 = pass; 1 = at least one violation.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";

const NAME_RE = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const files = process.argv.slice(2);
let errorCount = 0;

// Cache: directory -> max-existing-timestamp (excluding files we are
// about to commit). Computed on first access per dir.
const maxTsCache = new Map();

for (const rel of files) {
  const abs = resolve(rel);
  const name = basename(abs);
  const dir = dirname(abs);

  // 1. Format check.
  const m = name.match(NAME_RE);
  if (!m) {
    console.error(
      `X ${rel}: name must be YYYYMMDDhhmmss_snake_case.sql (got '${name}')`,
    );
    errorCount++;
    continue;
  }

  const ts = m[1];

  // 2. Calendar-date sanity.
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const second = Number(ts.slice(12, 14));

  if (
    year < 2024 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    console.error(
      `X ${rel}: timestamp '${ts}' is out of plausible range (YYYY in 2024..2099, valid m/d/h/m/s)`,
    );
    errorCount++;
    continue;
  }

  // 3. Chronological-ordering check vs existing migrations.
  const newSet = new Set(files.map((f) => basename(resolve(f))));
  const maxExisting = getMaxExistingTimestamp(dir, newSet, maxTsCache);
  if (maxExisting !== null && ts <= maxExisting) {
    console.error(
      `X ${rel}: timestamp '${ts}' is not greater than newest existing migration '${maxExisting}'. ` +
        `Bump the timestamp so node-pg-migrate runs it last on a fresh DB.`,
    );
    errorCount++;
    continue;
  }
}

process.exit(errorCount > 0 ? 1 : 0);

function getMaxExistingTimestamp(dir, exclude, cache) {
  if (cache.has(dir)) return cache.get(dir);

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    cache.set(dir, null);
    return null;
  }

  let max = null;
  for (const entry of entries) {
    if (exclude.has(entry)) continue;
    const m = entry.match(NAME_RE);
    if (!m) continue;
    let isFile = false;
    try {
      isFile = statSync(resolve(dir, entry)).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    if (max === null || m[1] > max) max = m[1];
  }

  cache.set(dir, max);
  return max;
}
