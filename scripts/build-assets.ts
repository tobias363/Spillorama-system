#!/usr/bin/env tsx
/**
 * BIN-543: Asset pipeline — Unity sprites → PixiJS-servable assets.
 *
 * Reads a manifest of Unity sprite-directories under
 * `legacy/unity-client/Assets/_Project/Sprites/`, copies PNG/JPG files
 * to `apps/backend/public/web/games/assets/<group>/`, strips Unity-specific
 * `.meta` files, and generates an index.json per group so PixiJS can load
 * via `Assets.loadBundle`.
 *
 * True atlas-packing (single-PNG combined spritesheet) is a future
 * optimization — see BIN-543 follow-up. The current pipeline is sufficient
 * for pilot because (a) HTTP/2 multiplexing reduces request-overhead cost,
 * (b) individual PNGs compress better than combined atlas for our use case
 * (~50 sprites total), (c) no native deps needed.
 *
 * Usage: npm run assets:build
 *
 * Idempotent — reruns are safe. Output is gitignored; build as part of
 * pilot deploy.
 */

import { readdirSync, copyFileSync, mkdirSync, statSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SOURCE_ROOT = resolve(REPO_ROOT, "legacy/unity-client/Assets/_Project/Sprites");
const TARGET_ROOT = resolve(REPO_ROOT, "apps/backend/public/web/games/assets");

/**
 * Asset groups — which Unity sprite dirs to copy and what slug to use
 * for the output dir.
 *
 * Keys map 1:1 to groupings in the game-client (e.g. `game1`, `shared/buttons`).
 * Values are source subdir-names relative to SOURCE_ROOT; copying recurses
 * into subdirs so multi-level Unity layouts collapse to flat output.
 *
 * Game 4 is intentionally absent — BIN-496 removed it from the product.
 */
const ASSET_GROUPS: Array<{ slug: string; source: string }> = [
  { slug: "game1", source: "48 Game 1" },
  { slug: "game1-start", source: "9 Game 1 Start" },
  { slug: "game1-purchase", source: "51 Game 1 Ticket Purchase Panel" },
  { slug: "game2", source: "18 Bingo game 2" },
  { slug: "game5-wheel", source: "14 Spin Wheel" },
  { slug: "treasure-chest", source: "16 Treasure Chest" },
  { slug: "mystery-game", source: "Mystery Game Sprites" },
  { slug: "lucky-number", source: "10 select lucky number" },
  { slug: "buttons", source: "Buttons" },
  { slug: "patterns", source: "Patterns" },
  { slug: "admin-display", source: "Admin Display" },
  { slug: "leader-board", source: "35 Leader Board" },
];

interface AssetEntry {
  /** Filename at output path. */
  name: string;
  /** Path relative to TARGET_ROOT (for use with PixiJS Assets.load). */
  path: string;
  /** File size in bytes. */
  bytes: number;
}

interface GroupIndex {
  slug: string;
  source: string;
  assets: AssetEntry[];
  totalBytes: number;
  generatedAt: string;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function collectImages(dir: string, baseDir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Recurse — Unity nests sprites in subdirs (e.g. Buttons/Button Remove/)
      out.push(...collectImages(full, baseDir));
      continue;
    }
    // Only include real image files; Unity .meta files are stripped
    const ext = extname(entry).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      out.push(full);
    }
  }
  return out;
}

function slugifyName(original: string): string {
  // Flatten spaces + odd characters so HTTP paths are clean
  return original.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function processGroup(group: { slug: string; source: string }): GroupIndex | null {
  const sourceDir = resolve(SOURCE_ROOT, group.source);
  if (!existsSync(sourceDir)) {
    console.warn(`  ⚠ Source dir missing: ${group.source} (skipping)`);
    return null;
  }

  const targetDir = resolve(TARGET_ROOT, group.slug);
  // Clean + recreate target so stale files from previous runs don't accumulate
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const images = collectImages(sourceDir, sourceDir);
  const assets: AssetEntry[] = [];
  let totalBytes = 0;

  for (const src of images) {
    const cleanName = slugifyName(basename(src));
    const dst = resolve(targetDir, cleanName);
    copyFileSync(src, dst);
    const size = statSync(dst).size;
    assets.push({
      name: cleanName,
      path: `${group.slug}/${cleanName}`,
      bytes: size,
    });
    totalBytes += size;
  }

  const index: GroupIndex = {
    slug: group.slug,
    source: group.source,
    assets,
    totalBytes,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(resolve(targetDir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}

function main(): void {
  console.log(`Asset pipeline — Unity → PixiJS`);
  console.log(`  source: ${SOURCE_ROOT}`);
  console.log(`  target: ${TARGET_ROOT}\n`);

  mkdirSync(TARGET_ROOT, { recursive: true });

  const summaries: GroupIndex[] = [];
  let totalAssets = 0;
  let totalBytes = 0;

  for (const group of ASSET_GROUPS) {
    console.log(`[${group.slug}] ${group.source}`);
    const summary = processGroup(group);
    if (!summary) continue;
    summaries.push(summary);
    console.log(`  ✓ ${summary.assets.length} assets, ${(summary.totalBytes / 1024).toFixed(1)} KB`);
    totalAssets += summary.assets.length;
    totalBytes += summary.totalBytes;
  }

  // Top-level manifest — one entry per group for client-side bundle-loader
  const manifest = {
    generatedAt: new Date().toISOString(),
    groups: summaries.map((s) => ({
      slug: s.slug,
      source: s.source,
      assetCount: s.assets.length,
      totalBytes: s.totalBytes,
    })),
  };
  writeFileSync(resolve(TARGET_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nSummary:`);
  console.log(`  ${summaries.length}/${ASSET_GROUPS.length} groups processed`);
  console.log(`  ${totalAssets} assets (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  manifest.json written to ${TARGET_ROOT}`);
}

main();
