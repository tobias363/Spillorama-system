#!/usr/bin/env node
/**
 * check-skill-freshness.mjs
 *
 * Tobias-direktiv 2026-05-13 (Tier 3-C / B3): "Skills get stale over time
 * as the code evolves. Detect: 'skill X has not been modified in 60+ days,
 * AND files in its scope have had 30+ commits in same period' → flag for
 * review."
 *
 * Bruker `<!-- scope: <comma-separated globs> -->` header i hver SKILL.md
 * for å definere hvilke filer/moduler skillen dekker. Scope-header er
 * forventet å lande via B2 (skill-file-mapping). Inntil da: skip skills
 * uten header (mark som "scope-undefined" i rapport).
 *
 * Algoritme:
 *   1. Liste alle `.claude/skills/<name>/SKILL.md`
 *   2. For hver skill:
 *      - Les scope-header hvis finnes
 *      - Få sist git-modifikasjon (timestamp)
 *      - Beregn `ageDays` = dager siden sist endring
 *      - Hvis scope: tell commits siste 60 dager som rører scope-filer
 *   3. Klassifiser:
 *      - fresh:      < 30 dager
 *      - aging:      30-60 dager
 *      - stale:      60-90 dager
 *      - very-stale: 90+ dager AND 50+ commits til scope → flag
 *   4. Output JSON-rapport (eller markdown med --markdown)
 *
 * CLI:
 *   node scripts/check-skill-freshness.mjs                    # JSON til stdout
 *   node scripts/check-skill-freshness.mjs --markdown         # Markdown til stdout
 *   node scripts/check-skill-freshness.mjs --output=path.json # JSON til fil
 *   node scripts/check-skill-freshness.mjs --pr-mode          # PR-tid: sjekk om endrede filer i denne PR-en
 *                                                              # tilhører scope av en stale skill
 *   node scripts/check-skill-freshness.mjs --pr-base=main     # base-ref for --pr-mode (default: origin/main)
 *   node scripts/check-skill-freshness.mjs --very-stale-only  # bare flagg very-stale skills (for issue-trigger)
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Built-in fs.globSync er tilgjengelig fra Node 22+
import { globSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");

// Tersklene (i dager). Matcher SKILL_FRESHNESS.md.
const THRESHOLDS = {
  fresh: 30,
  aging: 60,
  stale: 90,
};

// Very-stale = 90+ dager OG 50+ commits til scope = flag for review
const VERY_STALE_AGE_DAYS = 90;
const VERY_STALE_COMMIT_COUNT = 50;

// Default window for å telle scope-commits
const SCOPE_COMMIT_WINDOW_DAYS = 60;

// ---------- CLI-parsing ----------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) =>
  args.find((a) => a.startsWith(`${name}=`))?.split("=").slice(1).join("=");

const MARKDOWN = flag("--markdown");
const OUTPUT_PATH = value("--output");
const PR_MODE = flag("--pr-mode");
const PR_BASE = value("--pr-base") ?? "origin/main";
const VERY_STALE_ONLY = flag("--very-stale-only");
const QUIET = flag("--quiet");

// ---------- Utility-funksjoner ----------

function log(...msg) {
  if (!QUIET) console.error(...msg);
}

/**
 * Henter sist git-modifikasjons-timestamp (unix-sekunder) for en fil.
 * Returnerer null hvis filen ikke har historie (f.eks. nylig opprettet,
 * ikke commit-et).
 */
function gitLastModifiedTimestamp(relPath) {
  try {
    const ts = execSync(`git log -1 --format=%ct -- "${relPath}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!ts) return null;
    const n = parseInt(ts, 10);
    if (Number.isNaN(n)) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Teller commits i siste `sinceDays` dager som rører noen av glob-pattern-ene.
 * Bruker `git log --since="N.days.ago" -- pattern1 pattern2 ...`.
 * Returnerer 0 hvis ingenting matchet eller git feiler.
 */
function countCommitsToScope(patterns, sinceDays) {
  if (!patterns || patterns.length === 0) return 0;

  // Vi sender pathene direkte til git log. Git aksepterer pathspecs som
  // matcher både filer og glob-pattern (med ** i pathspec hvis vi
  // bruker `:(glob)` magic-prefix). For å være kompatibel med ulike
  // git-versjoner, prøver vi pattern direkte. Hvis ingen match → 0.
  try {
    // Bygg `-- pattern1 pattern2 ...`. Wrap i quotes for å beskytte
    // shell-tegn som * og **.
    const quoted = patterns.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(" ");
    const cmd = `git log --since="${sinceDays}.days.ago" --pretty=oneline -- ${quoted}`;
    const out = execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return 0;
    return out.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Leser scope-header fra SKILL.md.
 * Format: `<!-- scope: glob1, glob2, glob3 -->` (kan være på en hvilken
 * som helst linje, vanligvis rett etter front-matter).
 * Returnerer array av glob-pattern (trimmet), eller null hvis ikke funnet.
 */
function readScopeHeader(skillMdPath) {
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const match = content.match(/<!--\s*scope:\s*([^>]+?)\s*-->/);
    if (!match) return null;
    const patterns = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return patterns.length > 0 ? patterns : null;
  } catch {
    return null;
  }
}

/**
 * Klassifiserer skill basert på alder + commits.
 */
function classify(ageDays, commitsInScope) {
  if (ageDays >= VERY_STALE_AGE_DAYS && commitsInScope >= VERY_STALE_COMMIT_COUNT) {
    return "very-stale";
  }
  if (ageDays >= THRESHOLDS.stale) return "stale";
  if (ageDays >= THRESHOLDS.aging) return "aging";
  if (ageDays >= THRESHOLDS.fresh) return "fresh-but-aging";
  return "fresh";
}

/**
 * Henter listen over filer endret i PR (mellom merge-base og HEAD).
 */
function getPrChangedFiles(baseRef) {
  try {
    // Finn merge-base mellom HEAD og base-ref
    const mergeBase = execSync(`git merge-base HEAD ${baseRef}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!mergeBase) return [];

    const out = execSync(
      `git diff --name-only ${mergeBase}..HEAD`,
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (!out) return [];
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    log(`[pr-mode] Kunne ikke finne PR-endringer: ${err.message}`);
    return [];
  }
}

/**
 * Sjekker om en fil matcher en av glob-pattern-ene.
 * Bruker fs.globSync for å hente alle matchende filer for pattern, og
 * sjekker om relPath er i den listen.
 *
 * Dette er O(N) per pattern men kjøres bare i pr-mode der vi har få
 * patterns + få changed-files.
 */
function fileMatchesPatterns(relPath, patterns) {
  for (const pattern of patterns) {
    try {
      const matches = globSync(pattern, { cwd: REPO_ROOT });
      // Normaliser slashes (Windows safety) og sjekk inkludering
      const normalizedRel = relPath.replace(/\\/g, "/");
      const normalizedMatches = matches.map((m) => m.replace(/\\/g, "/"));
      if (normalizedMatches.includes(normalizedRel)) return true;
      // Hvis pattern ikke har wildcards og matcher prefix → også treff
      // (eks. scope=apps/backend/src og fil=apps/backend/src/foo.ts)
      if (!pattern.includes("*") && normalizedRel.startsWith(pattern.replace(/\\/g, "/"))) {
        return true;
      }
    } catch {
      // Ignorer ugyldige patterns
    }
  }
  return false;
}

// ---------- Hoved-flyt ----------

function listSkills() {
  if (!existsSync(SKILLS_DIR)) {
    log(`[check-skill-freshness] SKILLS_DIR finnes ikke: ${SKILLS_DIR}`);
    return [];
  }
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    log(`[check-skill-freshness] Kunne ikke liste skills: ${err.message}`);
    return [];
  }
}

function analyzeSkill(skillName) {
  const skillMdRel = `.claude/skills/${skillName}/SKILL.md`;
  const skillMdAbs = join(REPO_ROOT, skillMdRel);

  if (!existsSync(skillMdAbs)) {
    return null; // Ikke en gyldig skill (mangler SKILL.md)
  }

  const scope = readScopeHeader(skillMdAbs);
  const lastModifiedTs = gitLastModifiedTimestamp(skillMdRel);

  // Hvis ingen git-historikk: fersk fil, mark som "fresh" med 0 dager.
  // Dette håndterer edge-case der skill er nylig opprettet men ikke
  // commit-et enda.
  let ageDays;
  if (lastModifiedTs === null) {
    ageDays = 0;
  } else {
    const nowSec = Math.floor(Date.now() / 1000);
    ageDays = Math.floor((nowSec - lastModifiedTs) / 86400);
  }

  const hasScope = scope !== null;
  const commitsInScope = hasScope
    ? countCommitsToScope(scope, SCOPE_COMMIT_WINDOW_DAYS)
    : 0;

  // Hvis scope-header mangler: klassifiser kun basert på alder, men
  // marker "scope-undefined" så PM kan se hvilke skills som mangler header.
  let status;
  if (!hasScope) {
    status = "scope-undefined";
  } else {
    status = classify(ageDays, commitsInScope);
  }

  return {
    name: skillName,
    skillMdPath: skillMdRel,
    ageDays,
    lastModifiedTs,
    hasScope,
    scope: scope ?? [],
    commitsInScope,
    scopeWindowDays: SCOPE_COMMIT_WINDOW_DAYS,
    status,
  };
}

function generateReport(results) {
  // Grupper på status
  const byStatus = {};
  for (const r of results) {
    if (!byStatus[r.status]) byStatus[r.status] = [];
    byStatus[r.status].push(r);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalSkills: results.length,
    counts: {
      fresh: byStatus.fresh?.length ?? 0,
      "fresh-but-aging": byStatus["fresh-but-aging"]?.length ?? 0,
      aging: byStatus.aging?.length ?? 0,
      stale: byStatus.stale?.length ?? 0,
      "very-stale": byStatus["very-stale"]?.length ?? 0,
      "scope-undefined": byStatus["scope-undefined"]?.length ?? 0,
    },
    thresholds: {
      ...THRESHOLDS,
      veryStaleAgeDays: VERY_STALE_AGE_DAYS,
      veryStaleCommitCount: VERY_STALE_COMMIT_COUNT,
      scopeCommitWindowDays: SCOPE_COMMIT_WINDOW_DAYS,
    },
    skills: results,
  };

  return summary;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Skill Freshness Report");
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Total skills:** ${report.totalSkills}`);
  lines.push("");
  lines.push("## Sammendrag");
  lines.push("");
  lines.push("| Status | Antall |");
  lines.push("|---|---:|");
  lines.push(`| Fresh (< 30d) | ${report.counts.fresh} |`);
  lines.push(`| Fresh-but-aging (30-60d) | ${report.counts["fresh-but-aging"]} |`);
  lines.push(`| Aging (60-90d) | ${report.counts.aging} |`);
  lines.push(`| Stale (90+d) | ${report.counts.stale} |`);
  lines.push(`| **Very-stale (90+d AND 50+ scope-commits)** | **${report.counts["very-stale"]}** |`);
  lines.push(`| Scope-undefined (mangler header) | ${report.counts["scope-undefined"]} |`);
  lines.push("");
  lines.push("## Terskler");
  lines.push("");
  lines.push("- Fresh: < 30 dager siden modifikasjon");
  lines.push("- Aging: 30-60 dager");
  lines.push("- Stale: 60-90 dager");
  lines.push(`- Very-stale: 90+ dager AND 50+ commits til scope siste ${SCOPE_COMMIT_WINDOW_DAYS} dager`);
  lines.push("");

  const veryStale = report.skills.filter((s) => s.status === "very-stale");
  if (veryStale.length > 0) {
    lines.push("## 🚨 Very-stale skills (krever review)");
    lines.push("");
    lines.push("| Skill | Alder (dager) | Commits til scope | Scope-globs |");
    lines.push("|---|---:|---:|---|");
    for (const s of veryStale) {
      lines.push(
        `| \`${s.name}\` | ${s.ageDays} | ${s.commitsInScope} | ${s.scope.join(", ")} |`,
      );
    }
    lines.push("");
  }

  const stale = report.skills.filter((s) => s.status === "stale");
  if (stale.length > 0) {
    lines.push("## ⚠️ Stale skills (90+ dager uten oppdatering)");
    lines.push("");
    lines.push("| Skill | Alder (dager) | Commits til scope | Scope-globs |");
    lines.push("|---|---:|---:|---|");
    for (const s of stale) {
      lines.push(
        `| \`${s.name}\` | ${s.ageDays} | ${s.commitsInScope} | ${s.scope.join(", ") || "(ingen)"} |`,
      );
    }
    lines.push("");
  }

  const aging = report.skills.filter((s) => s.status === "aging");
  if (aging.length > 0) {
    lines.push("## Aging skills (60-90 dager)");
    lines.push("");
    lines.push("| Skill | Alder (dager) | Commits til scope |");
    lines.push("|---|---:|---:|");
    for (const s of aging) {
      lines.push(`| \`${s.name}\` | ${s.ageDays} | ${s.commitsInScope} |`);
    }
    lines.push("");
  }

  const scopeUndefined = report.skills.filter((s) => s.status === "scope-undefined");
  if (scopeUndefined.length > 0) {
    lines.push("## ℹ️ Skills uten scope-header");
    lines.push("");
    lines.push("Disse mangler `<!-- scope: ... -->` header og kan ikke analyseres for code-aktivitet:");
    lines.push("");
    for (const s of scopeUndefined) {
      lines.push(`- \`${s.name}\` (sist endret ${s.ageDays} dager siden)`);
    }
    lines.push("");
    lines.push("Se [SKILL_FRESHNESS.md](../engineering/SKILL_FRESHNESS.md) for hvordan legge til scope-header.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Generert av `scripts/check-skill-freshness.mjs`. Se [SKILL_FRESHNESS.md](../engineering/SKILL_FRESHNESS.md) for hvordan refresh en skill._");
  lines.push("");
  return lines.join("\n");
}

// ---------- Run ----------

function runDefaultMode() {
  const skills = listSkills();
  log(`[check-skill-freshness] Analyserer ${skills.length} skills...`);

  const results = [];
  for (const name of skills) {
    const result = analyzeSkill(name);
    if (result !== null) {
      results.push(result);
    }
  }

  // Sorter etter status-prioritet (very-stale først), så på alder synkende
  const statusOrder = {
    "very-stale": 0,
    stale: 1,
    aging: 2,
    "fresh-but-aging": 3,
    "scope-undefined": 4,
    fresh: 5,
  };
  results.sort((a, b) => {
    const so = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (so !== 0) return so;
    return b.ageDays - a.ageDays;
  });

  const report = generateReport(results);

  // Filter til very-stale only hvis ønsket
  if (VERY_STALE_ONLY) {
    const filtered = results.filter((r) => r.status === "very-stale");
    return { ...report, skills: filtered };
  }

  return report;
}

function runPrMode() {
  const changedFiles = getPrChangedFiles(PR_BASE);
  log(`[pr-mode] Fant ${changedFiles.length} endrede filer mot ${PR_BASE}`);

  if (changedFiles.length === 0) {
    return {
      mode: "pr",
      base: PR_BASE,
      changedFiles: [],
      matchedStaleSkills: [],
      message: "Ingen endrede filer å sjekke",
    };
  }

  const skills = listSkills();
  const results = [];
  for (const name of skills) {
    const r = analyzeSkill(name);
    if (r !== null) results.push(r);
  }

  // Filter til stale + very-stale skills som har scope
  const candidates = results.filter(
    (r) => (r.status === "stale" || r.status === "very-stale") && r.hasScope,
  );

  // For hver kandidat: sjekk om noen av endrede filer matcher scope
  const matched = [];
  for (const skill of candidates) {
    const matchingFiles = changedFiles.filter((f) =>
      fileMatchesPatterns(f, skill.scope),
    );
    if (matchingFiles.length > 0) {
      matched.push({
        skill: skill.name,
        status: skill.status,
        ageDays: skill.ageDays,
        scope: skill.scope,
        matchingFiles,
        skillMdPath: skill.skillMdPath,
      });
    }
  }

  return {
    mode: "pr",
    base: PR_BASE,
    changedFiles,
    matchedStaleSkills: matched,
    message:
      matched.length > 0
        ? `${matched.length} stale skill(s) dekker filer i denne PR-en — vurder å refreshe`
        : "Ingen stale skills dekker endrede filer",
  };
}

// ---------- Main ----------

const report = PR_MODE ? runPrMode() : runDefaultMode();

let output;
if (MARKDOWN && !PR_MODE) {
  output = renderMarkdown(report);
} else if (PR_MODE && MARKDOWN) {
  // PR-mode markdown er en mindre comment-friendly variant
  const lines = [];
  lines.push("## Skill freshness check");
  lines.push("");
  if (report.matchedStaleSkills.length === 0) {
    lines.push("✅ Ingen stale skills dekker endrede filer i denne PR-en.");
  } else {
    lines.push(`⚠️ **${report.matchedStaleSkills.length} stale skill(s)** dekker filer i denne PR-en:`);
    lines.push("");
    for (const m of report.matchedStaleSkills) {
      lines.push(`### \`${m.skill}\` (${m.status}, ${m.ageDays} dager gammel)`);
      lines.push("");
      lines.push(`**Skill-fil:** [\`${m.skillMdPath}\`](${m.skillMdPath})`);
      lines.push("");
      lines.push("**Endrede filer i scope:**");
      for (const f of m.matchingFiles) lines.push(`- \`${f}\``);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push("Dette er **informasjonelt** — ikke blokkerende. Hvis arbeidet ditt endrer fundamentet for en skill, vurder å oppdatere SKILL.md med samme PR (commit-message med `[skill-refreshed: <name>]`).");
    lines.push("");
    lines.push("Se [`docs/engineering/SKILL_FRESHNESS.md`](docs/engineering/SKILL_FRESHNESS.md) for guidance.");
  }
  output = lines.join("\n");
} else {
  output = JSON.stringify(report, null, 2);
}

if (OUTPUT_PATH) {
  writeFileSync(OUTPUT_PATH, output, "utf8");
  log(`[check-skill-freshness] Skrev rapport til ${OUTPUT_PATH}`);
} else {
  process.stdout.write(output + "\n");
}

// Exit-kode: 0 alltid i default-mode (ikke-blokkerende), 0 i pr-mode
// (informasjonelt only)
process.exit(0);
