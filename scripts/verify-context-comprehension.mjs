#!/usr/bin/env node
/**
 * verify-context-comprehension.mjs
 *
 * Tobias-direktiv 2026-05-13 — vanntett enforcement av "fragility-lese"
 * er kun en lese-bekreftelse, ikke en comprehension-bekreftelse.
 *
 * Tier-3 i autonomi-pyramiden: krever at commits som tagger
 * `[context-read: F-NN]` ALSO inneholder en `## Comprehension`-blokk i
 * commit-message som paraphraserer entry-en. Heuristisk validering
 * (uten LLM-kall) sjekker:
 *
 *   1. Minst én filsti fra F-NNs "Filer:"-seksjon er nevnt
 *   2. Minst én regel fra "Hva ALDRI gjøre:" er paraphrasert (3+ ord overlap)
 *   3. Total comprehension-tekst er 100..2000 chars
 *   4. Tekst matcher IKKE generic patterns ("jeg leste", "OK", "lest", ...)
 *
 * Modi:
 *   --commit-msg <path>   Validér commit-msg fra fil (pre-commit-hook-mode)
 *   --test                Kjør innebygd test-suite via node:test
 *   --help                Vis hjelp
 *
 * Override: commit-message kan inkludere
 *   [comprehension-bypass: <begrunnelse min 20 tegn>]
 * for å skippe sjekken (med WARNING logged til stderr).
 *
 * Performance:
 *   - Uten [context-read: F-NN]: regex-check + early exit (< 50ms)
 *   - Med [context-read: F-NN]:  full validering (< 1s for typisk FRAGILITY_LOG)
 *
 * Skriver til .git/notes/comprehension-<sha> (best-effort, fail-soft).
 *
 * Komplementerer:
 *   - .husky/pre-commit-fragility-check.sh (Tier-2: krever marker)
 *   - .github/workflows/ai-fragility-review.yml (post-PR feedback)
 *   - docs/engineering/COMPREHENSION_VERIFICATION.md (denne fila beskrevet)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const FRAGILITY_LOG_PATH = join(REPO_ROOT, "docs/engineering/FRAGILITY_LOG.md");

const MIN_COMPREHENSION_CHARS = 100;
const MAX_COMPREHENSION_CHARS = 2000;

const MIN_OVERLAP_WORDS = 3;

const MIN_BYPASS_REASON_CHARS = 20;

/**
 * Generic patterns som indikerer at comprehension-blokken er fluff.
 * Matcher hele blokken eller første linje når trimmet og lowercased.
 */
const GENERIC_PATTERNS = [
  /^(jeg leste|ok|lest|done|read it|sett|skjønner|forstått|ja|yes)\.?$/i,
  /^(read|leste)\s+(it|den)\.?$/i,
  /^(have read|har lest|leste den|leste det)\.?$/i,
];

/**
 * Norwegian stop-words som ikke teller mot 3-ord-overlap.
 * Holdes minimal — utvid hvis vi ser false-positives.
 */
const STOP_WORDS = new Set([
  // Norwegian
  "og", "i", "å", "er", "en", "et", "den", "det", "som", "på", "av", "for",
  "med", "til", "fra", "har", "var", "vi", "de", "ikke", "kan", "men", "om",
  "så", "vil", "skal", "ble", "blir", "blitt", "være", "vært", "hvor",
  "når", "hva", "hvis", "ja", "nei", "der", "her", "hvordan", "denne",
  "dette", "disse", "noe", "noen", "alle", "alt", "bare", "også", "mer",
  "mange", "mye", "lite", "stor", "stort", "store", "ny", "nytt", "nye",
  // English
  "the", "is", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "through", "during",
  "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "will", "would", "should", "could", "may", "might", "must",
  "this", "that", "these", "those", "all", "any", "no", "not", "yes", "if",
]);

// ────────────────────────────────────────────────────────────────────────
// FRAGILITY_LOG parsing
// ────────────────────────────────────────────────────────────────────────

/**
 * Parse FRAGILITY_LOG.md til struktur:
 *   Map<F-NN, { id, title, files: string[], neverDo: string[], rawBlock: string }>
 *
 * @param {string} content
 * @returns {Map<string, FragilityEntry>}
 */
export function parseFragilityLog(content) {
  /** @type {Map<string, any>} */
  const entries = new Map();

  /** @type {any} */
  let current = null;
  let inNeverDoSection = false;
  let inFilerSection = false;
  let neverDoBuffer = [];

  const lines = content.split("\n");

  function commit() {
    if (current && current.id) {
      // Flush neverDo if still open
      if (inNeverDoSection && neverDoBuffer.length > 0) {
        current.neverDo.push(...neverDoBuffer);
      }
      neverDoBuffer = [];
      inNeverDoSection = false;
      inFilerSection = false;
      entries.set(current.id, current);
    }
  }

  /**
   * Extract file paths from a string. Handles backtick-wrapped + bare paths.
   * Strips :line-range suffix.
   * @param {string} text
   * @returns {string[]}
   */
  function extractFilePaths(text) {
    /** @type {string[]} */
    const found = [];
    const extPattern = "(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|md|yml|yaml|sh|sql|json)";

    // Backtick-wrapped — supports `*` glob in path-segment
    const backtickRegex = new RegExp(
      "`([a-zA-Z0-9_/.\\-*]+\\." + extPattern + ")(?::\\d+(?:-\\d+)?)?`",
      "g",
    );
    for (const m of text.matchAll(backtickRegex)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    // Bare paths (containing at least one /)
    const bareRegex = new RegExp(
      "(?:^|\\s)([a-zA-Z0-9_/.\\-*]+/[a-zA-Z0-9_/.\\-*]+\\." + extPattern + ")(?::\\d+(?:-\\d+)?)?(?:\\s|$|[,;])",
      "g",
    );
    for (const m of text.matchAll(bareRegex)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
  }

  for (const line of lines) {
    // Match "## F-NN: title" (entry header)
    const headerMatch = line.match(/^## (F-\d+):\s*(.+?)\s*$/);
    if (headerMatch) {
      commit();
      current = {
        id: headerMatch[1],
        title: headerMatch[2],
        files: [],
        neverDo: [],
        rawBlock: "",
      };
      inNeverDoSection = false;
      inFilerSection = false;
      neverDoBuffer = [];
      continue;
    }

    // Section-break (another ## that's NOT F-NN) → close current
    if (line.startsWith("## ") && !line.match(/^## F-\d+/)) {
      commit();
      current = null;
      continue;
    }

    if (!current) continue;

    current.rawBlock += line + "\n";

    // Detect any **Bold-header:**-line to close non-Filer sections
    const boldHeader = line.match(/^\*\*([^*]+?):\*\*/);

    // "**Filer:**" section start
    if (boldHeader && /^Filer$/i.test(boldHeader[1])) {
      inFilerSection = true;
      inNeverDoSection = false;
      // Filer-content may be on same line as header
      const inlineContent = line.replace(/^\*\*Filer:\*\*\s*/, "");
      if (inlineContent.trim().length > 0) {
        for (const p of extractFilePaths(inlineContent)) {
          if (!current.files.includes(p)) current.files.push(p);
        }
      }
      continue;
    }

    // Continue collecting Filer-bullets across multiple lines
    if (inFilerSection) {
      // Bullet line OR continuation (indented or plain text with backticks)
      if (line.match(/^[-*]\s+/) || /`[a-zA-Z0-9_/.\-]+\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|md|yml|yaml|sh|sql|json)/.test(line)) {
        for (const p of extractFilePaths(line)) {
          if (!current.files.includes(p)) current.files.push(p);
        }
        continue;
      }
      // Empty line — stay in Filer section (next bullet may come)
      if (line.trim() === "") {
        continue;
      }
      // Anything else closes the Filer section
      inFilerSection = false;
    }

    // "**Hva ALDRI gjøre:**" section
    if (boldHeader && /^Hva ALDRI gj(ø|o)re$/i.test(boldHeader[1])) {
      inNeverDoSection = true;
      neverDoBuffer = [];
      continue;
    }

    // Any OTHER bold-header → close NeverDo section
    if (boldHeader && inNeverDoSection) {
      current.neverDo.push(...neverDoBuffer);
      neverDoBuffer = [];
      inNeverDoSection = false;
      // Don't continue — fall through so we don't double-process
    }

    if (inNeverDoSection) {
      // Bullet item — continue collecting
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        neverDoBuffer.push(bullet[1].trim());
        continue;
      }
      // Empty line — keep section open
      if (line.trim() === "") {
        continue;
      }
    }
  }

  commit();

  return entries;
}

// ────────────────────────────────────────────────────────────────────────
// Comprehension block extraction
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract `## Comprehension` block from commit message.
 * Reads until next `##`-heading or `[bracket-tag]` line at start.
 *
 * @param {string} commitMsg
 * @returns {string | null}
 */
export function extractComprehensionBlock(commitMsg) {
  const lines = commitMsg.split("\n");
  /** @type {string[]} */
  const buffer = [];
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock) {
      if (line.match(/^##\s+Comprehension\s*$/i)) {
        inBlock = true;
      }
      continue;
    }

    // End-conditions: another ## heading OR Co-Authored-By/sign-off
    if (line.match(/^##\s/) || line.match(/^(Co-Authored-By|Signed-off-by):/i)) {
      break;
    }

    buffer.push(line);
  }

  if (!inBlock) return null;

  // Strip leading/trailing empty lines
  while (buffer.length > 0 && buffer[0].trim() === "") buffer.shift();
  while (buffer.length > 0 && buffer[buffer.length - 1].trim() === "") buffer.pop();

  return buffer.length > 0 ? buffer.join("\n") : null;
}

/**
 * Extract `[context-read: F-NN]` references from commit message.
 * Supports multiple FIDs in one tag: `[context-read: F-01, F-02]`
 *
 * @param {string} commitMsg
 * @returns {string[]} list of F-NN identifiers
 */
export function extractContextReadFids(commitMsg) {
  /** @type {Set<string>} */
  const fids = new Set();
  const matches = [...commitMsg.matchAll(/\[context-read:\s*([^\]]+)\]/gi)];
  for (const m of matches) {
    const inner = m[1];
    const idMatches = [...inner.matchAll(/F-\d+/gi)];
    for (const id of idMatches) {
      fids.add(id[0].toUpperCase());
    }
  }
  return [...fids];
}

/**
 * Extract `[comprehension-bypass: reason]` tag.
 *
 * @param {string} commitMsg
 * @returns {string | null} reason text, or null if no bypass
 */
export function extractBypassReason(commitMsg) {
  const match = commitMsg.match(/\[comprehension-bypass:\s*([^\]]+)\]/i);
  if (!match) return null;
  return match[1].trim();
}

// ────────────────────────────────────────────────────────────────────────
// Heuristic validation
// ────────────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @returns {string[]} content words (lowercase, length ≥ 3, not stop-word)
 */
function contentWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Check overlap: at least 3 content-words shared between rule and text.
 *
 * @param {string} rule
 * @param {string} comprehensionText
 * @returns {{ overlap: number, sharedWords: string[] }}
 */
export function ruleOverlap(rule, comprehensionText) {
  const ruleWords = new Set(contentWords(rule));
  const textWords = new Set(contentWords(comprehensionText));
  const shared = [...ruleWords].filter((w) => textWords.has(w));
  return { overlap: shared.length, sharedWords: shared };
}

/**
 * Check filename presence: at least one file from entry.files must appear.
 *
 * Match strategies (any matches counts):
 *   - Exact substring (e.g. "PlayScreen.ts")
 *   - Basename (last segment after `/`)
 *   - Glob match (entry file contains `*` → convert to regex, match comprehension)
 *
 * @param {string[]} entryFiles
 * @param {string} text
 * @returns {string | null} matched filename, or null
 */
export function findFileMention(entryFiles, text) {
  const lowText = text.toLowerCase();
  for (const f of entryFiles) {
    const fLow = f.toLowerCase();

    // Glob in path → convert to regex
    if (fLow.includes("*")) {
      // Escape regex specials except `*`, then replace `*` with `[^/\s]*`
      const pattern = fLow
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/\\s]*");
      const re = new RegExp(pattern);
      if (re.test(lowText)) return f;
      // Also try matching just the basename pattern (after last `/`)
      const baseGlob = fLow.split("/").pop() || "";
      if (baseGlob.length >= 5 && baseGlob.includes("*")) {
        const basePattern = baseGlob
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, "[^/\\s]*");
        const baseRe = new RegExp(basePattern);
        if (baseRe.test(lowText)) return f;
      }
      // Glob present but no match → continue to next entry-file (skip basename-check)
      continue;
    }

    if (lowText.includes(fLow)) return f;
    const basename = f.split("/").pop() || f;
    if (basename.length >= 5 && lowText.includes(basename.toLowerCase())) {
      return f;
    }
  }
  return null;
}

/**
 * Check generic-pattern match: if comprehension is "jeg leste" or similar,
 * reject. We test the first non-empty line and the full block (collapsed).
 *
 * @param {string} text
 * @returns {boolean} true if matches a generic pattern
 */
export function isGenericText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  // Take first line (trimmed)
  const firstLine = trimmed.split("\n")[0].trim();

  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(firstLine)) return true;
    // Also test whole block when it's short
    if (trimmed.length < 50 && pattern.test(trimmed)) return true;
  }
  return false;
}

/**
 * Validate one fragility entry against comprehension text.
 *
 * @param {object} entry
 * @param {string} comprehensionText
 * @returns {{ ok: boolean, errors: string[], matchedFile?: string, matchedRule?: { rule: string, sharedWords: string[] } }}
 */
export function validateEntryAgainstComprehension(entry, comprehensionText) {
  /** @type {string[]} */
  const errors = [];

  // 1. Length check
  if (comprehensionText.length < MIN_COMPREHENSION_CHARS) {
    errors.push(
      `Comprehension-blokk for kort (${comprehensionText.length} chars, krever ≥ ${MIN_COMPREHENSION_CHARS}).`,
    );
  }
  if (comprehensionText.length > MAX_COMPREHENSION_CHARS) {
    errors.push(
      `Comprehension-blokk for lang (${comprehensionText.length} chars, krever ≤ ${MAX_COMPREHENSION_CHARS}).`,
    );
  }

  // 2. Generic-pattern check
  if (isGenericText(comprehensionText)) {
    errors.push(
      `Comprehension matcher generic pattern (eks. "jeg leste", "OK", "lest"). Skriv konkret hva ${entry.id} sier.`,
    );
  }

  // 3. Filename mention
  const matchedFile = findFileMention(entry.files, comprehensionText);
  if (!matchedFile) {
    errors.push(
      `Comprehension nevner ingen filsti fra ${entry.id}. Filer: ${entry.files.slice(0, 3).join(", ")}${entry.files.length > 3 ? ", ..." : ""}.`,
    );
  }

  // 4. Rule paraphrase
  /** @type {{ rule: string, sharedWords: string[] } | undefined} */
  let matchedRule;
  if (entry.neverDo.length === 0) {
    // No rules to paraphrase — pass on this check
  } else {
    let bestOverlap = 0;
    let best = null;
    for (const rule of entry.neverDo) {
      const result = ruleOverlap(rule, comprehensionText);
      if (result.overlap > bestOverlap) {
        bestOverlap = result.overlap;
        best = { rule, sharedWords: result.sharedWords };
      }
    }
    if (bestOverlap < MIN_OVERLAP_WORDS) {
      errors.push(
        `Comprehension paraphraserer ingen regel fra ${entry.id} sin "Hva ALDRI gjøre". Krever ${MIN_OVERLAP_WORDS}+ ord overlap; beste match: ${bestOverlap}. Regler: ${entry.neverDo.slice(0, 2).map((r) => `"${r.slice(0, 60)}..."`).join("; ")}`,
      );
    } else {
      matchedRule = best ?? undefined;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    matchedFile: matchedFile ?? undefined,
    matchedRule,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Main validation entry point
// ────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidateOptions
 * @property {string} commitMsg
 * @property {Map<string, any>} fragilityEntries
 */

/**
 * @typedef {Object} ValidateResult
 * @property {boolean} ok
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {string[]} verifiedFids
 * @property {boolean} bypassed
 * @property {string | null} bypassReason
 */

/**
 * Validate a commit-message against FRAGILITY_LOG entries.
 *
 * @param {ValidateOptions} opts
 * @returns {ValidateResult}
 */
export function validateCommitMessage({ commitMsg, fragilityEntries }) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const verifiedFids = [];

  // 1. Check for bypass
  const bypassReason = extractBypassReason(commitMsg);
  if (bypassReason !== null) {
    if (bypassReason.length < MIN_BYPASS_REASON_CHARS) {
      errors.push(
        `[comprehension-bypass: ...]-begrunnelse for kort (${bypassReason.length} chars, krever ≥ ${MIN_BYPASS_REASON_CHARS}).`,
      );
      return {
        ok: false,
        errors,
        warnings,
        verifiedFids: [],
        bypassed: false,
        bypassReason,
      };
    }
    warnings.push(
      `Comprehension-bypass aktivert: "${bypassReason}". Sjekken hoppes over.`,
    );
    return {
      ok: true,
      errors,
      warnings,
      verifiedFids: [],
      bypassed: true,
      bypassReason,
    };
  }

  // 2. Extract context-read FIDs
  const fids = extractContextReadFids(commitMsg);
  if (fids.length === 0) {
    // No fragility-tag → nothing to verify
    return { ok: true, errors, warnings, verifiedFids: [], bypassed: false, bypassReason: null };
  }

  // 3. Extract comprehension block
  const comprehensionText = extractComprehensionBlock(commitMsg);
  if (!comprehensionText) {
    errors.push(
      `Commit-message inneholder [context-read: ${fids.join(", ")}] men mangler '## Comprehension'-blokk. Legg til en seksjon som paraphraserer F-NN-entry'en.`,
    );
    return {
      ok: false,
      errors,
      warnings,
      verifiedFids: [],
      bypassed: false,
      bypassReason: null,
    };
  }

  // 4. Validate each FID
  for (const fid of fids) {
    const entry = fragilityEntries.get(fid);
    if (!entry) {
      warnings.push(
        `${fid} er referert i [context-read: ...] men finnes ikke i FRAGILITY_LOG.md. (Stavefeil? Slettet entry?)`,
      );
      continue;
    }

    const result = validateEntryAgainstComprehension(entry, comprehensionText);
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `[${fid}] ${e}`));
    } else {
      verifiedFids.push(fid);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    verifiedFids,
    bypassed: false,
    bypassReason: null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// CLI / hook entry-point
// ────────────────────────────────────────────────────────────────────────

function readCommitMessage(path) {
  if (!existsSync(path)) {
    throw new Error(`Commit-message-fil ikke funnet: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function readFragilityLog() {
  if (!existsSync(FRAGILITY_LOG_PATH)) {
    return null;
  }
  return readFileSync(FRAGILITY_LOG_PATH, "utf8");
}

function writeGitNote(fids, comprehensionPreview) {
  // Best-effort: skriv til .git/notes/comprehension-<short-sha>
  // Hvis ingen HEAD-commit enda, hopp over.
  try {
    const shortSha = execSync("git rev-parse --short HEAD 2>/dev/null", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!shortSha) return;
    const notesDir = join(REPO_ROOT, ".git", "comprehension-notes");
    if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
    const notePath = join(notesDir, `comprehension-${shortSha}.txt`);
    const content = [
      `Verified FIDs: ${fids.join(", ")}`,
      `Timestamp: ${new Date().toISOString()}`,
      "",
      "Comprehension (first 500 chars):",
      comprehensionPreview.slice(0, 500),
    ].join("\n");
    writeFileSync(notePath, content);
  } catch {
    // Fail-soft
  }
}

function printError(result, fragilityEntries) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════════╗");
  console.error("║  🛑 COMPREHENSION-CHECK FEILET                                   ║");
  console.error("╚══════════════════════════════════════════════════════════════════╝");
  console.error("");
  console.error("Commit-message inneholder [context-read: F-NN] men comprehension-");
  console.error("blokken bestod ikke heuristiske sjekker. Du må enten:");
  console.error("");
  console.error("  1. Skrive en ekte ## Comprehension-blokk i commit-message");
  console.error("  2. Eller bruke [comprehension-bypass: <begrunnelse min 20 tegn>]");
  console.error("");
  console.error("Feil:");
  for (const err of result.errors) {
    console.error(`  • ${err}`);
  }
  console.error("");
  console.error("Eksempel-format på commit-message:");
  console.error("");
  console.error("    fix(scope): kort beskrivelse");
  console.error("");
  console.error("    [context-read: F-01]");
  console.error("");
  console.error("    Lengre forklaring av hva du endret.");
  console.error("");
  console.error("    ## Comprehension");
  console.error("");
  console.error("    F-01 dekker PlayScreen.ts og popup-auto-show-gate. Jeg har");
  console.error("    sjekket at jeg ikke fjerner getEventTracker().track-callen og at");
  console.error("    autoShowBuyPopupDone-flagget reset-es per runde, ikke per session.");
  console.error("");
  console.error("    Co-Authored-By: ...");
  console.error("");
  console.error("Detaljer:");
  console.error(`  docs/engineering/COMPREHENSION_VERIFICATION.md`);
  console.error(`  ${FRAGILITY_LOG_PATH}`);
  console.error("");
}

async function runHookMode(commitMsgPath) {
  const start = Date.now();

  const commitMsg = readCommitMessage(commitMsgPath);
  const fragilityRaw = readFragilityLog();

  if (fragilityRaw === null) {
    // FRAGILITY_LOG mangler — kan ikke validere. Fail-soft (komplement i pre-commit hopper også over).
    return 0;
  }

  // FAST PATH: hvis ingen [context-read: F-NN]-marker, exit umiddelbart
  if (!/\[context-read:/i.test(commitMsg) && !/\[comprehension-bypass:/i.test(commitMsg)) {
    return 0;
  }

  const fragilityEntries = parseFragilityLog(fragilityRaw);
  const result = validateCommitMessage({ commitMsg, fragilityEntries });

  const elapsed = Date.now() - start;

  if (result.bypassed) {
    console.error(`⚠️  COMPREHENSION-BYPASS aktivert: "${result.bypassReason}"`);
    console.error(`    (PR-reviewer skal verifisere at bypass er legitim)`);
    return 0;
  }

  for (const w of result.warnings) {
    console.error(`⚠️  ${w}`);
  }

  if (!result.ok) {
    printError(result, fragilityEntries);
    return 1;
  }

  if (result.verifiedFids.length > 0) {
    const compText = extractComprehensionBlock(commitMsg);
    writeGitNote(result.verifiedFids, compText ?? "");
    console.error(
      `✅ Comprehension verifisert for ${result.verifiedFids.length} entry/-ies (${result.verifiedFids.join(", ")}) — ${elapsed}ms`,
    );
  }

  return 0;
}

function printHelp() {
  console.log(`
verify-context-comprehension.mjs — heuristisk validering av comprehension-
blokk for FRAGILITY-tagged commits.

Usage:
  node scripts/verify-context-comprehension.mjs --commit-msg <path>
      Validér commit-message fra fil (typisk .git/COMMIT_EDITMSG).
      Exit-koder: 0 = pass, 1 = fail.

  node scripts/verify-context-comprehension.mjs --test
      Kjør innebygd test-suite via node:test.

  node scripts/verify-context-comprehension.mjs --help
      Vis denne hjelpen.

Format på commit-message som passer sjekken:

  fix(scope): kort beskrivelse

  [context-read: F-01]

  Lengre forklaring av hva du endret og hvorfor.

  ## Comprehension

  F-01 dekker PlayScreen.ts og 5-conditions-gate-en for popup-auto-show.
  Jeg har sjekket at jeg ikke endrer autoShowBuyPopupDone-reset-logikken og
  at getEventTracker().track-callen er beholdt.

  Co-Authored-By: ...

Override (logged til stderr, akseptert):

  [comprehension-bypass: <begrunnelse min 20 tegn>]

Detaljer: docs/engineering/COMPREHENSION_VERIFICATION.md
`);
}

async function runTestMode() {
  // Run sibling test-file via node:test
  const testFile = join(REPO_ROOT, "scripts/__tests__/verify-context-comprehension.test.mjs");
  if (!existsSync(testFile)) {
    console.error(`Test-fil ikke funnet: ${testFile}`);
    return 1;
  }
  try {
    execSync(`node --test "${testFile}"`, {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    return 0;
  } catch (err) {
    return /** @type {any} */ (err).status ?? 1;
  }
}

// Run only when executed directly (not when imported)
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1] === __filename;

if (isMain) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--test")) {
    const code = await runTestMode();
    process.exit(code);
  }

  const commitMsgIdx = args.indexOf("--commit-msg");
  if (commitMsgIdx === -1 || commitMsgIdx === args.length - 1) {
    console.error("Mangler --commit-msg <path>. Bruk --help for usage.");
    process.exit(2);
  }
  const commitMsgPath = args[commitMsgIdx + 1];

  try {
    const code = await runHookMode(commitMsgPath);
    process.exit(code);
  } catch (err) {
    console.error(`Fatal feil i comprehension-check: ${/** @type {any} */ (err).message}`);
    // Fail-soft på interne feil — vi vil ikke blokkere alle commits hvis scriptet er buggy.
    process.exit(0);
  }
}
