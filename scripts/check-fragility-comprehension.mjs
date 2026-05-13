#!/usr/bin/env node
/**
 * check-fragility-comprehension.mjs
 *
 * Tier-2 i autonomi-pyramiden: vanntett enforcement av FRAGILITY_LOG-lese.
 *
 * Sjekker hver staged fil mot FRAGILITY_LOG.md. Hvis filen er nevnt i en
 * F-NN-entry, MÅ commit-message inneholde `[context-read: F-NN]`-marker.
 * Manglende = commit blokkert.
 *
 * Port fra bash til Node 2026-05-13 (PITFALLS §5.8) — den opprinnelige
 * `pre-commit-fragility-check.sh` brukte `declare -A` (bash 4 associative
 * arrays) som ikke fungerer på macOS' default bash 3.2. Node-porten
 * matcher mønsteret fra `scripts/verify-context-comprehension.mjs` og
 * `scripts/check-pm-gate.mjs`.
 *
 * Aktiveres ved at `.husky/pre-commit-fragility-check.sh` (thin bash 3.2
 * wrapper) kaller dette scriptet.
 *
 * Bypass:
 *   - `[bypass-fragility-check: <begrunnelse>]` i commit-message
 *   - `FRAGILITY_BYPASS=1 git commit ...`
 *   - `--no-verify` skipper hele pre-commit
 *
 * CLI:
 *   node scripts/check-fragility-comprehension.mjs --commit-msg <path>
 *       Validér commit-msg (typisk .git/COMMIT_EDITMSG)
 *       Exit: 0 = pass, 1 = blokker
 *   node scripts/check-fragility-comprehension.mjs --help
 *
 * Performance:
 *   - < 50ms hvis ingen staged filer matcher FRAGILITY-entries
 *   - < 500ms ellers
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const FILE_EXT_PATTERN =
  "(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|md|yml|yaml|sh|sql|json)";

// ────────────────────────────────────────────────────────────────────────
// Fragility parsing
// ────────────────────────────────────────────────────────────────────────

/**
 * Parse FRAGILITY_LOG.md til en Map<F-NN, string[]> av filstier.
 *
 * Speiler bash-versjonens logikk:
 *   - Match "## F-NN" på heading-linje for å åpne en entry
 *   - Match "**Filer:**" for å starte file-section
 *   - Trekke ut backtick-wrapped paths med whitelisted file-extensions
 *
 * Bevisst utvidet over bash-versjonen: aksepterer også file-stier på
 * `**Filer:**`-linjer som strekker seg over flere linjer (bullet-format).
 *
 * @param {string} content
 * @returns {Map<string, string[]>}
 */
export function parseFragilityFiles(content) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  /** @type {string | null} */
  let currentFid = null;
  /** @type {string[]} */
  let currentFiles = [];
  let inFilerSection = false;

  const headerRe = /^## (F-\d+)\b/;
  const sectionRe = /^## /;
  const filerHeaderRe = /^\*\*Filer:\*\*\s*(.*)$/;
  const otherBoldHeaderRe = /^\*\*[^*]+:\*\*/;

  // Backtick-wrapped path som slutter på whitelistet extension
  const backtickRe = new RegExp(
    "`([a-zA-Z0-9_/.\\-]+\\." + FILE_EXT_PATTERN + ")(?::\\d+(?:-\\d+)?)?`",
    "g",
  );

  function extractFilesFromLine(line) {
    /** @type {string[]} */
    const found = [];
    for (const m of line.matchAll(backtickRe)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
  }

  function commitEntry() {
    if (currentFid !== null && currentFiles.length > 0) {
      map.set(currentFid, [...new Set(currentFiles)]);
    }
    currentFid = null;
    currentFiles = [];
    inFilerSection = false;
  }

  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine;
    const headerMatch = line.match(headerRe);
    if (headerMatch) {
      commitEntry();
      currentFid = headerMatch[1];
      continue;
    }

    if (currentFid === null) continue;

    // Annet ## heading lukker entry-en
    if (sectionRe.test(line) && !headerMatch) {
      commitEntry();
      continue;
    }

    const filerMatch = line.match(filerHeaderRe);
    if (filerMatch) {
      inFilerSection = true;
      const inline = filerMatch[1];
      if (inline.trim().length > 0) {
        currentFiles.push(...extractFilesFromLine(inline));
      }
      continue;
    }

    if (inFilerSection) {
      const otherBold = otherBoldHeaderRe.test(line);
      if (otherBold) {
        inFilerSection = false;
        // Fall gjennom — kan likevel ikke matche fler ting i denne loopen
        continue;
      }
      // Aksepter bullets eller continuation-linjer som inneholder backtick-paths
      currentFiles.push(...extractFilesFromLine(line));
    }
  }

  commitEntry();

  return map;
}

// ────────────────────────────────────────────────────────────────────────
// Staged-file matching
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve hvilke F-NN-entries som matcher de staged filene.
 *
 * Match-strategi (alle som treffer teller):
 *   1. Eksakt match (staged === fragile)
 *   2. Prefix (staged starter med fragile/ — for directory-baserte entries)
 *   3. Omvendt prefix (fragile starter med staged/) — for hierarkiske paths
 *
 * @param {string[]} stagedFiles
 * @param {Map<string, string[]>} fragilityMap
 * @returns {Set<string>} matched FID-set
 */
export function findRequiredFids(stagedFiles, fragilityMap) {
  /** @type {Set<string>} */
  const required = new Set();
  for (const staged of stagedFiles) {
    if (!staged) continue;
    for (const [fid, fragileFiles] of fragilityMap.entries()) {
      for (const fragile of fragileFiles) {
        if (matchesPath(staged, fragile)) {
          required.add(fid);
          break;
        }
      }
    }
  }
  return required;
}

/**
 * @param {string} staged
 * @param {string} fragile
 * @returns {boolean}
 */
function matchesPath(staged, fragile) {
  if (staged === fragile) return true;
  // staged ligger inni fragile-dir
  if (staged.startsWith(fragile + "/")) return true;
  // fragile ligger inni staged-dir (sjelden men matcher bash-versjonens semantikk)
  if (fragile.startsWith(staged + "/")) return true;
  // Bash-versjonen brukte også [[ "$staged" == "$fragile"* ]] som matcher
  // ren prefix. For å unngå false-positive ("foo.ts" matcher "foo.test.ts")
  // krever vi at neste tegn etter prefix er enten "/" eller slutten av strengen.
  if (staged.length > fragile.length && staged.startsWith(fragile)) {
    const next = staged.charAt(fragile.length);
    if (next === "/") return true;
  }
  if (fragile.length > staged.length && fragile.startsWith(staged)) {
    const next = fragile.charAt(staged.length);
    if (next === "/") return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Commit-message inspection
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract `[context-read: F-NN, F-MM, ...]` references fra commit-message.
 * Tagger kan repeteres og inneholde flere FIDs separert med komma/whitespace.
 *
 * @param {string} commitMsg
 * @returns {Set<string>}
 */
export function extractContextReadFids(commitMsg) {
  /** @type {Set<string>} */
  const fids = new Set();
  const matches = commitMsg.matchAll(/\[context-read:\s*([^\]]+)\]/gi);
  for (const m of matches) {
    const inner = m[1];
    const ids = inner.matchAll(/F-\d+/gi);
    for (const id of ids) {
      fids.add(id[0].toUpperCase());
    }
  }
  return fids;
}

/**
 * @param {string} commitMsg
 * @returns {string | null} bypass-reason eller null
 */
export function extractBypassReason(commitMsg) {
  const match = commitMsg.match(/\[bypass-fragility-check:\s*([^\]]+)\]/i);
  if (!match) return null;
  return match[1].trim();
}

// ────────────────────────────────────────────────────────────────────────
// Main validation
// ────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidateInput
 * @property {string} commitMsg
 * @property {string[]} stagedFiles
 * @property {string} fragilityRaw  Innholdet i FRAGILITY_LOG.md
 */

/**
 * @typedef {Object} ValidateResult
 * @property {boolean} ok
 * @property {string[]} missingFids
 * @property {string[]} verifiedFids
 * @property {boolean} bypassed
 * @property {string | null} bypassReason
 */

/**
 * @param {ValidateInput} input
 * @returns {ValidateResult}
 */
export function validateStagedAgainstFragility({
  commitMsg,
  stagedFiles,
  fragilityRaw,
}) {
  // Tomme staged filer → ingenting å sjekke
  if (stagedFiles.length === 0) {
    return {
      ok: true,
      missingFids: [],
      verifiedFids: [],
      bypassed: false,
      bypassReason: null,
    };
  }

  const fragilityMap = parseFragilityFiles(fragilityRaw);
  const requiredFids = findRequiredFids(stagedFiles, fragilityMap);

  if (requiredFids.size === 0) {
    return {
      ok: true,
      missingFids: [],
      verifiedFids: [],
      bypassed: false,
      bypassReason: null,
    };
  }

  // Sjekk bypass FØR vi krever context-read — bypass overstyrer alt
  const bypassReason = extractBypassReason(commitMsg);
  if (bypassReason !== null && bypassReason.length > 0) {
    return {
      ok: true,
      missingFids: [],
      verifiedFids: [],
      bypassed: true,
      bypassReason,
    };
  }

  const taggedFids = extractContextReadFids(commitMsg);
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const verified = [];
  for (const fid of requiredFids) {
    if (taggedFids.has(fid)) {
      verified.push(fid);
    } else {
      missing.push(fid);
    }
  }

  // Sortér deterministisk så output er stabil
  missing.sort();
  verified.sort();

  return {
    ok: missing.length === 0,
    missingFids: missing,
    verifiedFids: verified,
    bypassed: false,
    bypassReason: null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Output helpers
// ────────────────────────────────────────────────────────────────────────

function printError(missingFids, fragilityLogPath) {
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════╗",
    "║  🛑 FRAGILITY-CHECK FEILET                                       ║",
    "╚══════════════════════════════════════════════════════════════════╝",
    "",
    "Filer du staged matcher FRAGILITY_LOG-entries. Du MÅ bekrefte at du",
    "har lest dem ved å inkludere markører i commit-message:",
    "",
    ...missingFids.map((fid) => `  [context-read: ${fid}]`),
    "",
    "Eksempel-commit-message:",
    "",
    "    fix(scope): kort beskrivelse",
    "",
    `    [context-read: ${missingFids[0]}]`,
    "",
    "    Lengre forklaring...",
    "",
    "Detaljer om F-NN-entries:",
    `  ${fragilityLogPath}`,
    "",
    "For emergency-bypass (dokumenter i commit-message):",
    "  [bypass-fragility-check: <begrunnelse>]",
    "",
    "ELLER:",
    "  FRAGILITY_BYPASS=1 git commit ...",
    "",
  ];
  for (const l of lines) {
    console.error(l);
  }
}

// ────────────────────────────────────────────────────────────────────────
// CLI entry point
// ────────────────────────────────────────────────────────────────────────

function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return resolve(__dirname, "..");
  }
}

function getStagedFiles(repoRoot) {
  try {
    const out = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      {
        encoding: "utf8",
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function printHelp() {
  console.log(`
check-fragility-comprehension.mjs — vanntett FRAGILITY_LOG-enforcement

Usage:
  node scripts/check-fragility-comprehension.mjs --commit-msg <path>
      Validér commit-msg (typisk .git/COMMIT_EDITMSG).
      Exit: 0 = pass, 1 = blokker.

  node scripts/check-fragility-comprehension.mjs --help
      Vis denne hjelpen.

Hvordan markere comprehension (i commit-message):

    fix(scope): kort beskrivelse

    [context-read: F-NN]

    Lengre forklaring...

Bypass (alle akseptert):
    [bypass-fragility-check: <begrunnelse>]
    FRAGILITY_BYPASS=1 git commit ...
    --no-verify   (skipper hele pre-commit)

Detaljer: docs/engineering/FRAGILITY_LOG.md
`);
}

async function runHookMode(commitMsgPath) {
  const repoRoot = getRepoRoot();
  const fragilityLogPath = resolve(
    repoRoot,
    "docs/engineering/FRAGILITY_LOG.md",
  );

  // Fail-soft hvis FRAGILITY_LOG mangler (matchet av bash-original)
  if (!existsSync(fragilityLogPath)) {
    return 0;
  }

  // Env-bypass
  if (process.env.FRAGILITY_BYPASS === "1") {
    console.error(
      "⚠️  FRAGILITY_BYPASS=1 satt — sjekken hoppes over. Begrunn i commit-message.",
    );
    return 0;
  }

  const stagedFiles = getStagedFiles(repoRoot);
  if (stagedFiles.length === 0) {
    return 0;
  }

  /** @type {string} */
  let commitMsg = "";
  if (existsSync(commitMsgPath)) {
    commitMsg = readFileSync(commitMsgPath, "utf8");
  }

  const fragilityRaw = readFileSync(fragilityLogPath, "utf8");

  const result = validateStagedAgainstFragility({
    commitMsg,
    stagedFiles,
    fragilityRaw,
  });

  if (result.bypassed) {
    console.error(
      `⚠️  bypass-fragility-check aktivert: "${result.bypassReason}"`,
    );
    return 0;
  }

  if (!result.ok) {
    printError(result.missingFids, fragilityLogPath);
    return 1;
  }

  if (result.verifiedFids.length > 0) {
    console.error(
      `✅ FRAGILITY-check passert (${result.verifiedFids.length} entries verifisert: ${result.verifiedFids.join(", ")})`,
    );
  }

  return 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === __filename;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const commitMsgIdx = args.indexOf("--commit-msg");
  if (commitMsgIdx === -1 || commitMsgIdx === args.length - 1) {
    // Default-vei: bruk .git/COMMIT_EDITMSG hvis ikke spesifisert
    const repoRoot = getRepoRoot();
    const defaultPath = resolve(repoRoot, ".git/COMMIT_EDITMSG");
    try {
      const code = await runHookMode(defaultPath);
      process.exit(code);
    } catch (err) {
      console.error(
        `Fatal feil i fragility-check: ${/** @type {any} */ (err).message}`,
      );
      // Fail-soft på interne feil — vi vil ikke blokkere alle commits hvis scriptet er buggy.
      process.exit(0);
    }
  }

  const commitMsgPath = args[commitMsgIdx + 1];
  try {
    const code = await runHookMode(commitMsgPath);
    process.exit(code);
  } catch (err) {
    console.error(
      `Fatal feil i fragility-check: ${/** @type {any} */ (err).message}`,
    );
    process.exit(0);
  }
}
