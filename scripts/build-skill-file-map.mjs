#!/usr/bin/env node
/**
 * build-skill-file-map.mjs — generer docs/auto-generated/SKILL_FILE_MAP.md
 *
 * Leser scope-headers fra hver SKILL.md, lister hvilke filer i repoet
 * som matcher hvert mønster, og skriver et oppslagsverk.
 *
 * Brukes av:
 *   - PM som vil se hvor bredt en skill plukker opp filer
 *   - CI for å validere at scopes ikke er over-aggressive (>= 500 filer)
 *   - Agent som vil se hvilken skill som "eier" en path
 *
 * Output: `docs/auto-generated/SKILL_FILE_MAP.md`
 * Auto-overskrives — IKKE rediger manuelt.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillScopes, fileMatchesGlob } from "./find-skills-for-file.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const OUT_FILE = join(REPO_ROOT, "docs", "auto-generated", "SKILL_FILE_MAP.md");

// Directories we walk to count file-matches. We intentionally skip
// node_modules and build-output to keep the scan fast.
const WALK_ROOTS = [
  "apps",
  "packages",
  "infra",
  "docs",
  "scripts",
  ".github",
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
  ".pgmigrations",
  "playwright-report",
  "test-results",
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      // Allow .github + .claude but skip everything else dot-prefixed
      if (entry.name !== ".github" && entry.name !== ".claude") continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function collectAllFiles() {
  const all = [];
  for (const root of WALK_ROOTS) {
    const absRoot = join(REPO_ROOT, root);
    try {
      statSync(absRoot);
    } catch {
      continue;
    }
    for (const file of walk(absRoot)) {
      all.push(relative(REPO_ROOT, file).replace(/\\/g, "/"));
    }
  }
  // Also include known top-level files (render.yaml etc)
  const topLevel = ["render.yaml", "BACKLOG.md", "package.json"];
  for (const f of topLevel) {
    try {
      statSync(join(REPO_ROOT, f));
      all.push(f);
    } catch {
      // skip
    }
  }
  return all;
}

function main() {
  const scopes = loadSkillScopes();
  const allFiles = collectAllFiles();

  // For each skill, count how many files match each pattern (and total)
  const rows = [];
  for (const skill of [...scopes.keys()].sort()) {
    const patterns = scopes.get(skill);
    if (patterns === null) {
      rows.push({ skill, patterns: [], totalMatches: 0, missingHeader: true });
      continue;
    }
    if (patterns.length === 0) {
      rows.push({ skill, patterns: [], totalMatches: 0, missingHeader: false });
      continue;
    }
    const matched = new Set();
    for (const file of allFiles) {
      for (const glob of patterns) {
        if (fileMatchesGlob(file, glob)) {
          matched.add(file);
          break;
        }
      }
    }
    rows.push({
      skill,
      patterns,
      totalMatches: matched.size,
      missingHeader: false,
    });
  }

  // Output is intentionally deterministic — no timestamp, no SHA.
  // CI runs `build-skill-file-map.mjs` and diffs against committed
  // HEAD; any non-deterministic field would cause spurious "stale"
  // failures. The map content itself (skills + scopes + match counts)
  // is the provenance.
  const lines = [];
  lines.push("# Skill → File Mapping (auto-generated)");
  lines.push("");
  lines.push(
    "> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av",
  );
  lines.push("> `scripts/build-skill-file-map.mjs`. Kjør `npm run build:skill-map`");
  lines.push("> eller `node scripts/build-skill-file-map.mjs` lokalt.");
  lines.push(">");
  lines.push(
    "> Tabellen oppdateres automatisk ved hver endring i `.claude/skills/`.",
  );
  lines.push("");
  lines.push("Hver skill har en `<!-- scope: glob1, glob2 -->`-header i sin");
  lines.push("`.claude/skills/<name>/SKILL.md`. Denne tabellen viser scope-mønstre");
  lines.push("og antall filer som matcher i nåværende HEAD.");
  lines.push("");
  lines.push(
    "Antall skills totalt: **" + rows.length + "** — varsel hvis noen mangler scope-header:",
  );
  lines.push("");
  const missing = rows.filter((r) => r.missingHeader);
  if (missing.length === 0) {
    lines.push("> ✓ Alle skills har scope-header.");
  } else {
    lines.push("> ⚠ Følgende mangler scope-header:");
    for (const r of missing) lines.push(`>  - ${r.skill}`);
  }
  lines.push("");
  lines.push("## Skill-katalog");
  lines.push("");
  lines.push("| Skill | Antall mønstre | Filer matchet | Scope-mønstre |");
  lines.push("|---|---:|---:|---|");
  for (const r of rows) {
    const patternCount = r.patterns.length;
    const matches = r.missingHeader ? "—" : r.totalMatches;
    let patternCell;
    if (r.missingHeader) {
      patternCell = "**(mangler scope-header)**";
    } else if (r.patterns.length === 0) {
      patternCell = "_(empty — intentional skip)_";
    } else {
      // Show globs in a compact way (clip long lists)
      const shown = r.patterns.slice(0, 4).map((g) => "`" + g + "`");
      const rest = r.patterns.length - shown.length;
      patternCell = shown.join("<br>") + (rest > 0 ? `<br>_(+${rest} more)_` : "");
    }
    lines.push(`| \`${r.skill}\` | ${patternCount} | ${matches} | ${patternCell} |`);
  }
  lines.push("");
  lines.push("## Per-skill detalj");
  lines.push("");
  for (const r of rows) {
    lines.push(`### \`${r.skill}\``);
    lines.push("");
    if (r.missingHeader) {
      lines.push("⚠ Scope-header mangler. Legg til `<!-- scope: ... -->` rett etter YAML-frontmatter.");
      lines.push("");
      continue;
    }
    if (r.patterns.length === 0) {
      lines.push(
        "Empty scope — intentional. Skill loaded eksplisitt eller via PM-judgement.",
      );
      lines.push("");
      continue;
    }
    lines.push("**Scope-mønstre:**");
    lines.push("");
    for (const glob of r.patterns) {
      lines.push("- `" + glob + "`");
    }
    lines.push("");
    lines.push(`**Filer matchet i HEAD:** ${r.totalMatches}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Slik bruker du dette");
  lines.push("");
  lines.push("Når du skal røre en fil, finn relevante skills med:");
  lines.push("");
  lines.push("```bash");
  lines.push("node scripts/find-skills-for-file.mjs apps/backend/src/game/Game2Engine.ts");
  lines.push("# → spill2-perpetual-loop");
  lines.push("```");
  lines.push("");
  lines.push("Når PM spawner agent på en file-pattern, kjør:");
  lines.push("");
  lines.push("```bash");
  lines.push("bash scripts/generate-context-pack.sh apps/backend/src/game/Game2Engine.ts");
  lines.push("# → inkluderer FRAGILITY + PITFALLS + relevant skill-content");
  lines.push("```");
  lines.push("");

  writeFileSync(OUT_FILE, lines.join("\n") + "\n");
  const totalMatched = rows.reduce(
    (acc, r) => acc + (r.missingHeader ? 0 : r.totalMatches),
    0,
  );
  console.log(
    `Wrote ${OUT_FILE}: ${rows.length} skills, ${totalMatched} total matches across ${allFiles.length} files.`,
  );
}

main();
