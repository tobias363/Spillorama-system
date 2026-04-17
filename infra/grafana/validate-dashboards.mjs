#!/usr/bin/env node
/**
 * BIN-539: Structural check for infra/grafana/dashboards/*.json.
 *
 * Catches the most common shape-drift errors without a full Grafana JSON
 * schema dependency: valid JSON, required top-level keys, at least one
 * panel, each panel has an id/type/title, each target references a uid
 * via ${DS_PROM} or "Prometheus", and the uid/title pair is unique per
 * dashboard. Fails non-zero on any miss so CI can gate on it.
 *
 * Usage:
 *   node infra/grafana/validate-dashboards.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardsDir = resolve(here, "dashboards");
const files = readdirSync(dashboardsDir).filter((f) => f.endsWith(".json"));

let failed = 0;
const seenUids = new Set();
const seenTitles = new Set();

for (const file of files) {
  const path = join(dashboardsDir, file);
  const report = [];
  let dash;
  try {
    dash = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`✗ ${file}: invalid JSON — ${err.message}`);
    failed += 1;
    continue;
  }

  // Required top-level keys.
  for (const key of ["title", "uid", "panels", "schemaVersion", "templating", "tags"]) {
    if (dash[key] === undefined) report.push(`missing top-level "${key}"`);
  }
  if (!Array.isArray(dash.panels) || dash.panels.length === 0) {
    report.push("no panels");
  }

  // Uid / title uniqueness across the provisioned set.
  if (dash.uid) {
    if (seenUids.has(dash.uid)) report.push(`duplicate uid "${dash.uid}"`);
    seenUids.add(dash.uid);
  }
  if (dash.title) {
    if (seenTitles.has(dash.title)) report.push(`duplicate title "${dash.title}"`);
    seenTitles.add(dash.title);
  }

  // Tag hygiene — every Spillorama dashboard must carry the spillorama +
  // BIN-539 tags so folder-scope and provenance queries work.
  const tags = new Set(Array.isArray(dash.tags) ? dash.tags : []);
  for (const required of ["spillorama", "BIN-539"]) {
    if (!tags.has(required)) report.push(`missing tag "${required}"`);
  }

  // Per-panel + per-target checks.
  const panelIds = new Set();
  for (const panel of dash.panels ?? []) {
    if (typeof panel.id !== "number") report.push(`panel without numeric id: ${JSON.stringify(panel.title ?? panel)}`);
    if (typeof panel.title !== "string" || panel.title.trim() === "") {
      report.push(`panel id=${panel.id} has empty title`);
    }
    if (typeof panel.type !== "string") {
      report.push(`panel id=${panel.id} has no type`);
    }
    if (panelIds.has(panel.id)) report.push(`panel id ${panel.id} is duplicated`);
    panelIds.add(panel.id);

    const targets = Array.isArray(panel.targets) ? panel.targets : [];
    // Pure stat/text/row panels can have zero targets — only flag if the
    // panel is a query-type and still has none.
    if (["timeseries", "stat", "table", "bargauge", "gauge"].includes(panel.type) && targets.length === 0) {
      report.push(`panel "${panel.title}" (${panel.type}) has no targets`);
    }
    for (const [i, t] of targets.entries()) {
      if (!t.expr || typeof t.expr !== "string") {
        report.push(`panel "${panel.title}" target[${i}] has no expr`);
        continue;
      }
      // Every target must point at the templated Prometheus datasource so
      // the same JSON works across envs (staging / prod).
      if (!t.datasource?.uid || !/\$\{?DS_PROM\}?/.test(String(t.datasource.uid))) {
        report.push(`panel "${panel.title}" target[${i}] not bound to \${DS_PROM}`);
      }
    }
  }

  if (report.length === 0) {
    console.log(`✓ ${file}  (uid=${dash.uid}, panels=${dash.panels?.length ?? 0})`);
  } else {
    console.error(`✗ ${file}`);
    for (const msg of report) console.error(`  - ${msg}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} dashboard(s) failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} dashboard(s) OK.`);
