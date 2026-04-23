#!/usr/bin/env tsx
/**
 * BIN-528: Parity-matrix generator.
 *
 * Reads docs/engineering/PARITY_MATRIX.md, parses all per-game tables,
 * recomputes aggregate totals (fixing drift from manual editing), and writes
 * back the normalized markdown. Preserves the revisjonshistorikk + manual
 * sections untouched.
 *
 * Usage: npm run matrix:generate
 *
 * This script is the source-of-truth enforcer for parity-matrix counts.
 * Run it after editing per-row statuses — CI should fail if the file is
 * not normalized (see scripts/generate-parity-matrix-check.ts).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = resolve(__dirname, "../docs/engineering/PARITY_MATRIX.md");

type Status = "✅" | "🟡" | "❌" | "🔵" | "🔴";

interface StatusCell {
  status: Status;
  /** Raw cell text (may include annotations like "🟡 (stub)"). */
  raw: string;
}

interface ParityRow {
  feature: string;
  legacyInUse: StatusCell;
  backendParity: StatusCell;
  clientParity: StatusCell;
  legacyRefsRemoved: StatusCell;
  releaseReady: StatusCell;
  issueRef: string;
}

interface Subsection {
  heading: string;        // e.g. "### 2.1 Kjerne-features"
  preamble: string;       // any prose before the table
  /** If this subsection has a data table. */
  hasTable: boolean;
  headerRow?: string;
  separator?: string;
  rows?: ParityRow[];
  /** Raw content for tableless subsections (e.g. "### N.3 Canonical spec status"). */
  rawContent?: string;
}

interface GameSection {
  sectionNumber: string;
  heading: string;
  intro: string;
  subsections: Subsection[];
  trailing: string;
  shortName: string;
  gameKey: "game1" | "game2" | "game3" | "game5";
}

const GAME_CONFIGS: Record<string, { shortName: string; gameKey: GameSection["gameKey"] }> = {
  "Game 1 — Hovedspill (Classic Bingo)": { shortName: "Game 1 (Hovedspill)", gameKey: "game1" },
  "Game 2 — Rocket Bingo": { shortName: "Game 2 (Rocket)", gameKey: "game2" },
  "Game 3 — Monster Bingo / Mønsterbingo": { shortName: "Game 3 (Monster)", gameKey: "game3" },
  "Game 5 — Spillorama Bingo": { shortName: "Game 5 (Spillorama)", gameKey: "game5" },
};

const STATUS_SET = new Set<Status>(["✅", "🟡", "❌", "🔵", "🔴"]);

function parseStatusCell(cell: string): StatusCell {
  const raw = cell.trim();
  // Cell may contain just "✅" or "🟡 (stub)" or similar — extract first status emoji.
  for (const status of STATUS_SET) {
    if (raw.includes(status)) return { status, raw };
  }
  throw new Error(`Invalid status cell: "${cell}"`);
}

function splitRow(line: string): string[] {
  // Pipe-delimited row. Skip leading/trailing empty splits (pipe at edges).
  const parts = line.split("|").map((s) => s);
  if (parts[0] === "" || /^\s*$/.test(parts[0])) parts.shift();
  if (parts.length > 0 && (parts[parts.length - 1] === "" || /^\s*$/.test(parts[parts.length - 1]))) parts.pop();
  return parts;
}

function isSeparator(line: string): boolean {
  return /^\|[\s:|\-]+\|$/.test(line.trim());
}

function parseTableRow(line: string): ParityRow {
  const cells = splitRow(line);
  if (cells.length !== 7) {
    throw new Error(`Expected 7 cells, got ${cells.length}: ${line}`);
  }
  return {
    feature: cells[0].trim(),
    legacyInUse: parseStatusCell(cells[1]),
    backendParity: parseStatusCell(cells[2]),
    clientParity: parseStatusCell(cells[3]),
    legacyRefsRemoved: parseStatusCell(cells[4]),
    releaseReady: parseStatusCell(cells[5]),
    issueRef: cells[6].trim(),
  };
}

function renderRow(row: ParityRow): string {
  return `| ${row.feature} | ${row.legacyInUse.raw} | ${row.backendParity.raw} | ${row.clientParity.raw} | ${row.legacyRefsRemoved.raw} | ${row.releaseReady.raw} | ${row.issueRef} |`;
}

/** Parse full document into per-game sections + surrounding content. */
function parseMatrix(md: string): {
  preamble: string;
  games: GameSection[];
  postamble: string;
} {
  const lines = md.split("\n");
  let i = 0;

  // Find first game section start: "## 2." or similar
  const gameStartRegex = /^## (\d+)\. (Game .+)$/;
  while (i < lines.length && !gameStartRegex.test(lines[i])) i++;

  const preamble = lines.slice(0, i).join("\n");
  const games: GameSection[] = [];

  while (i < lines.length) {
    const match = lines[i].match(gameStartRegex);
    if (!match) break;

    const sectionNumber = match[1];
    const gameTitle = match[2];
    const heading = lines[i];
    const config = GAME_CONFIGS[gameTitle];
    if (!config) {
      throw new Error(`Unknown game title: "${gameTitle}"`);
    }
    i++;

    // Find subsection starts (### x.y)
    const subsectionRegex = new RegExp(`^### ${sectionNumber}\\.(\\d+) `);
    const introStart = i;
    while (i < lines.length && !subsectionRegex.test(lines[i])) i++;
    const intro = lines.slice(introStart, i).join("\n");

    const subsections: Subsection[] = [];

    while (i < lines.length && subsectionRegex.test(lines[i])) {
      const subHeading = lines[i];
      i++;

      const contentStart = i;
      // Scan ahead to next subsection or section boundary, or a table header.
      let tableHeaderIdx = -1;
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) break;
        if (trimmed.startsWith("|") && tableHeaderIdx === -1 && !isSeparator(line)) {
          tableHeaderIdx = i;
        }
        i++;
      }
      // `i` now points at next subsection / section / EOF.
      const contentEnd = i;

      if (tableHeaderIdx === -1) {
        // Tableless subsection — preserve raw content.
        const rawContent = lines.slice(contentStart, contentEnd).join("\n");
        subsections.push({ heading: subHeading, preamble: "", hasTable: false, rawContent });
      } else {
        const preamble = lines.slice(contentStart, tableHeaderIdx).join("\n");
        const headerRow = lines[tableHeaderIdx];
        if (tableHeaderIdx + 1 >= lines.length || !isSeparator(lines[tableHeaderIdx + 1])) {
          throw new Error(`Expected separator at line ${tableHeaderIdx + 1}`);
        }
        const separator = lines[tableHeaderIdx + 1];
        const rows: ParityRow[] = [];
        let k = tableHeaderIdx + 2;
        while (k < contentEnd && lines[k].trim().startsWith("|") && !isSeparator(lines[k])) {
          rows.push(parseTableRow(lines[k]));
          k++;
        }
        // Any trailing prose after the table but before next subsection is preserved
        // as a "post-table" block appended to the subsection's rawContent.
        const postTable = lines.slice(k, contentEnd).join("\n");
        subsections.push({
          heading: subHeading,
          preamble,
          hasTable: true,
          headerRow,
          separator,
          rows,
          rawContent: postTable,
        });
      }

      // Skip blank lines between subsections
      while (i < lines.length && lines[i].trim() === "") i++;
    }

    // Trailing = everything up to next "## N." or "---" at section boundary
    const trailingStart = i;
    while (i < lines.length) {
      if (gameStartRegex.test(lines[i])) break;
      if (/^## \d+\. /.test(lines[i]) && !gameStartRegex.test(lines[i])) break; // next non-game section
      i++;
    }
    const trailing = lines.slice(trailingStart, i).join("\n");

    games.push({
      sectionNumber,
      heading,
      intro,
      subsections,
      trailing,
      shortName: config.shortName,
      gameKey: config.gameKey,
    });
  }

  const postamble = lines.slice(i).join("\n");

  return { preamble, games, postamble };
}

interface Counts {
  total: number;
  readyGreen: number;  // ✅
  readyYellow: number; // 🟡
  readyRed: number;    // ❌
  readyBlue: number;   // 🔵
}

function countRows(rows: ParityRow[]): Counts {
  const counts: Counts = { total: 0, readyGreen: 0, readyYellow: 0, readyRed: 0, readyBlue: 0 };
  for (const r of rows) {
    counts.total++;
    switch (r.releaseReady.status) {
      case "✅": counts.readyGreen++; break;
      case "🟡": counts.readyYellow++; break;
      case "❌": counts.readyRed++; break;
      case "🔵": counts.readyBlue++; break;
    }
  }
  return counts;
}

function formatCountFragment(counts: Counts): string {
  const pct = counts.total === 0 ? 0 : Math.round((counts.readyGreen / counts.total) * 100);
  return `${counts.total} rader — ${counts.readyGreen} ✅, ${counts.readyYellow} 🟡, ${counts.readyRed} ❌. Release-klar: ${counts.readyGreen} / ${counts.total} (${pct} %)`;
}

/**
 * Update count fragment inside an existing summary line, preserving narrative.
 * Summary lines look like:
 *   **Game N totalt:** 33 rader — 16 ✅, 17 🟡, 0 ❌. Release-klar: 12 / 33 (36 %). <narrative...>
 * We replace "<count fragment>" and keep "<narrative...>" intact.
 */
function updateSummaryLineCounts(line: string, counts: Counts): string {
  const gamePrefixMatch = line.match(/^(\*\*Game \d+[^*]*totalt:\*\*\s*)/);
  if (!gamePrefixMatch) return line;
  const prefix = gamePrefixMatch[1];
  const rest = line.slice(prefix.length);
  // Match count portion up to and including release-klar percent. Allow optional bold,
  // optional comma-annotation, and optional trailing ".".
  const countRegex = /^\d+\s*rader\s*—.*?\*{0,2}Release-klar:\s*\d+\s*\/\s*\d+\s*\(\s*\d+\s*%\s*\)\*{0,2}\.?\s*/;
  if (countRegex.test(rest)) {
    const narrative = rest.replace(countRegex, "").trim();
    return `${prefix}${formatCountFragment(counts)}.${narrative ? " " + narrative : ""}`;
  }
  return `${prefix}${formatCountFragment(counts)}.`;
}

function formatOverallSummary(games: GameSection[]): string {
  const rows = games.map((game) => {
    const all = game.subsections.flatMap((s) => s.rows ?? []);
    const counts = countRows(all);
    const pct = counts.total === 0 ? 0 : Math.round((counts.readyGreen / counts.total) * 100);
    return `| ${game.shortName} | ${counts.total} | ${counts.readyGreen} | ${counts.readyYellow} | ${counts.readyRed} | ${pct} % |`;
  });

  const all = games.flatMap((g) => g.subsections.flatMap((s) => s.rows ?? []));
  const total = countRows(all);
  const totalPct = total.total === 0 ? 0 : Math.round((total.readyGreen / total.total) * 100);

  return [
    "| Spill | Rader | ✅ | 🟡 | ❌ | Release-klar % |",
    "|-------|------:|---:|---:|---:|---------------:|",
    ...rows,
    `| **Totalt** | **${total.total}** | **${total.readyGreen}** | **${total.readyYellow}** | **${total.readyRed}** | **${totalPct} %** |`,
  ].join("\n");
}

/** Render a game section with recomputed summary. */
function renderGame(game: GameSection): string {
  const allRows = game.subsections.flatMap((s) => s.rows ?? []);
  const counts = countRows(allRows);

  const subsectionStrs = game.subsections.map((s) => {
    if (!s.hasTable) {
      return [s.heading, s.rawContent ?? ""].join("\n").trim();
    }
    const rowsStr = (s.rows ?? []).map(renderRow).join("\n");
    const pieces = [s.heading];
    if (s.preamble.trim()) pieces.push(s.preamble);
    pieces.push(s.headerRow ?? "");
    pieces.push(s.separator ?? "");
    pieces.push(rowsStr);
    if (s.rawContent && s.rawContent.trim()) pieces.push(s.rawContent.trimEnd());
    return pieces.join("\n");
  });

  let rendered = [
    game.heading,
    game.intro.trimEnd(),
    ...subsectionStrs,
    game.trailing.trimEnd(),
  ].filter(Boolean).join("\n\n");

  // Post-process: find summary line anywhere in rendered game and update counts.
  // If missing, append before the trailing `---` separator (or at end).
  const summaryRegex = /^\*\*Game \d+[^*]*totalt:\*\*.*$/m;
  if (summaryRegex.test(rendered)) {
    rendered = rendered.replace(summaryRegex, (line) => updateSummaryLineCounts(line, counts));
  } else {
    const gameLabel = game.shortName.split(" (")[0];
    const newLine = `**${gameLabel} totalt:** ${formatCountFragment(counts)}.`;
    // Insert before last `---` if present, else append
    const lastSeparatorIdx = rendered.lastIndexOf("\n---");
    if (lastSeparatorIdx !== -1) {
      rendered = rendered.slice(0, lastSeparatorIdx) + `\n\n${newLine}` + rendered.slice(lastSeparatorIdx);
    } else {
      rendered = rendered + `\n\n${newLine}`;
    }
  }

  return rendered;
}

/** Replace the overall-summary table (section 6) in postamble. */
function replaceOverallSummary(postamble: string, games: GameSection[]): string {
  const newSummary = formatOverallSummary(games);

  // Find the overall-summary table by its header pattern.
  const lines = postamble.split("\n");
  const tableHeaderIdx = lines.findIndex((l) => l.trim().startsWith("| Spill |"));
  if (tableHeaderIdx === -1) {
    console.warn("⚠ Could not find overall-summary table in postamble; skipping");
    return postamble;
  }

  // Table spans from header to first line that's not pipe-delimited
  let endIdx = tableHeaderIdx;
  while (endIdx < lines.length && lines[endIdx].trim().startsWith("|")) endIdx++;

  return [
    ...lines.slice(0, tableHeaderIdx),
    newSummary,
    ...lines.slice(endIdx),
  ].join("\n");
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  const md = readFileSync(MATRIX_PATH, "utf8");
  const { preamble, games, postamble } = parseMatrix(md);

  console.log(`Parsed ${games.length} games:`);
  for (const game of games) {
    const allRows = game.subsections.flatMap((s) => s.rows ?? []);
    const counts = countRows(allRows);
    console.log(
      `  ${game.shortName}: ${counts.total} rows → ${counts.readyGreen} ✅ / ${counts.readyYellow} 🟡 / ${counts.readyRed} ❌ / ${counts.readyBlue} 🔵`,
    );
  }

  // Game trailings already contain their own `---` separators from source doc;
  // join with just blank line to avoid duplication.
  const renderedGames = games.map(renderGame).join("\n\n");
  const normalizedPostamble = replaceOverallSummary(postamble, games);

  const output = [preamble, renderedGames, normalizedPostamble]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";

  if (checkMode) {
    if (md === output) {
      console.log("\n✅ Matrix is normalized — counts match tables.");
      process.exit(0);
    }
    console.error("\n❌ Matrix is NOT normalized. Run `npm run matrix:generate` to fix counts.");
    process.exit(1);
  }

  writeFileSync(MATRIX_PATH, output);
  console.log(`\n✅ Wrote ${MATRIX_PATH}`);
}

main();
