#!/usr/bin/env node
/**
 * check-pitfalls-ids.mjs
 *
 * Validates that docs/engineering/PITFALLS_LOG.md has unique pitfall IDs.
 * Fenced code blocks are ignored so the "How to add" template can keep
 * showing `§X.Y` as an example.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PITFALLS = resolve(REPO_ROOT, "docs", "engineering", "PITFALLS_LOG.md");

const content = readFileSync(PITFALLS, "utf8");
const lines = content.split(/\r?\n/);
const idToLines = new Map();
const placeholders = [];
let inFence = false;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (/^```/.test(line.trim())) {
    inFence = !inFence;
    continue;
  }
  if (inFence) continue;

  const heading = line.match(/^###\s+(§(?:[0-9]+\.[0-9]+[a-z]?|X\.Y))\b/);
  if (!heading) continue;

  const id = heading[1];
  const lineNo = i + 1;
  if (id === "§X.Y") {
    placeholders.push(lineNo);
    continue;
  }
  const arr = idToLines.get(id) ?? [];
  arr.push(lineNo);
  idToLines.set(id, arr);
}

const duplicates = [...idToLines.entries()].filter(([, refs]) => refs.length > 1);

if (duplicates.length === 0 && placeholders.length === 0) {
  console.log(`✓ PITFALLS IDs valid (${idToLines.size} unique IDs)`);
  process.exit(0);
}

if (duplicates.length > 0) {
  console.error("Duplicate PITFALLS IDs:");
  for (const [id, refs] of duplicates) {
    console.error(`  ${id}: lines ${refs.join(", ")}`);
  }
}

if (placeholders.length > 0) {
  console.error(`Placeholder PITFALLS IDs outside code fences: lines ${placeholders.join(", ")}`);
}

process.exit(1);
