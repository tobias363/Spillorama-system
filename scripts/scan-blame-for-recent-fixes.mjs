#!/usr/bin/env node
/**
 * scan-blame-for-recent-fixes.mjs
 *
 * Bug-resurrection detector (2026-05-13).
 *
 * Konsept: Når du modifiserer linjer i en fil, blame-er vi linjene mot
 * HEAD~1 og finner kommiten som SIST endret dem. Hvis den kommiten har
 * en `fix(...)`-prefix (Conventional Commits) OG er innenfor det siste
 * `--days`-vinduet (default 30 dager), så er det en POTENSIELL bug-
 * resurrection. PM må eksplisitt bekrefte med
 * `[resurrection-acknowledged: <grunn>]` i commit-meldingen.
 *
 * Bakgrunn: Spillorama-pilot hadde i mai 2026 et "2 skritt frem 1 tilbake"-
 * problem hvor agenter introduserte gamle bugs på nytt ved å redigere
 * regioner som nylig var bug-fixet. Denne detektoren tvinger eksplisitt
 * bekreftelse før commit, slik at endringer er bevisste.
 *
 * CLI:
 *   node scripts/scan-blame-for-recent-fixes.mjs                       # default: HEAD vs HEAD~1
 *   node scripts/scan-blame-for-recent-fixes.mjs --ref HEAD             # commit-mode
 *   node scripts/scan-blame-for-recent-fixes.mjs --staged               # staged-mode (pre-commit hook)
 *   node scripts/scan-blame-for-recent-fixes.mjs --days 30              # recency window
 *   node scripts/scan-blame-for-recent-fixes.mjs --format json          # JSON output
 *   node scripts/scan-blame-for-recent-fixes.mjs --quiet                # only print if matches
 *
 * Exit-koder:
 *   0  — ingen resurrection-candidates (eller acknowledgment satt)
 *   1  — resurrection-candidates funnet uten acknowledgment
 *   2  — script-feil (git ikke tilgjengelig, ugyldig ref, etc.)
 *
 * Acknowledgment-format i commit-msg:
 *   [resurrection-acknowledged: <begrunnelse>]
 *
 * Eksempel:
 *   fix(spill1): nytt edge-case i room-join
 *
 *   [resurrection-acknowledged: I-15 fix var én del; fikser nå sibling-bug i samme region]
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// REPO_ROOT defaults to process.cwd() so scripts can be invoked from any
// repo (e.g. test fixtures with their own git history). Falls back to
// SCRIPT_DIR/.. only if `git rev-parse` fails from cwd.
function detectRepoRoot() {
  // Try cwd first (test-friendly)
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout.trim()) {
    return r.stdout.trim();
  }
  // Fallback to script-dir-relative
  return resolve(__dirname, "..");
}
const REPO_ROOT = detectRepoRoot();

// ── CLI-parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {
  ref: null, // null = staged-mode by default
  days: 30,
  format: "human",
  quiet: false,
  staged: false,
  // Allow override of commit-msg for hook integration (when committing via
  // husky, the commit-msg file is at .git/COMMIT_EDITMSG).
  commitMsgFile: null,
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--ref") {
    opts.ref = args[++i] || "HEAD";
  } else if (a === "--days") {
    opts.days = parseInt(args[++i] || "30", 10);
    if (Number.isNaN(opts.days) || opts.days < 0) {
      console.error("--days må være et positivt heltall");
      process.exit(2);
    }
  } else if (a === "--format") {
    opts.format = args[++i] || "human";
    if (!["human", "json"].includes(opts.format)) {
      console.error("--format må være 'human' eller 'json'");
      process.exit(2);
    }
  } else if (a === "--quiet") {
    opts.quiet = true;
  } else if (a === "--staged") {
    opts.staged = true;
  } else if (a === "--commit-msg-file") {
    opts.commitMsgFile = args[++i];
  } else if (a === "--help" || a === "-h") {
    printHelp();
    process.exit(0);
  } else if (a.startsWith("--")) {
    console.error(`Ukjent flag: ${a}`);
    printHelp();
    process.exit(2);
  }
}

// Default: hvis ingen --ref og ingen --staged, bruk staged-mode
if (opts.ref === null && !opts.staged) {
  opts.staged = true;
}

function printHelp() {
  console.log(`scan-blame-for-recent-fixes.mjs — Bug-resurrection detector

Usage:
  scan-blame-for-recent-fixes.mjs [options]

Options:
  --ref <ref>             Git ref å scanne (default: staged endringer)
                          Eksempler: HEAD, abc1234, origin/main..HEAD
  --staged                Scann staged endringer (default)
  --days <N>              Recency-vindu i dager (default: 30)
  --format <human|json>   Output-format (default: human)
  --quiet                 Skriv kun ut hvis match
  --commit-msg-file <p>   Path til commit-msg fil (for hook-integrasjon)
  --help, -h              Vis hjelp

Exit codes:
  0  — ingen resurrection-candidates
  1  — resurrection-candidates funnet
  2  — script-feil
`);
}

// ── Utilities ────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function color(c, s) { return useColor ? `${c}${s}${C.reset}` : s; }

function git(args, opts = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd: opts.cwd || REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${result.status}): ${result.stderr}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

// Conventional Commits fix-pattern. Matcher:
//   fix: ...
//   fix(scope): ...
//   fix(scope-with-dashes/slashes): ...
// Note: Matches start of line (after optional whitespace). Case-sensitive
// per Conventional Commits spec, but we tolerate uppercase Fix as well.
const FIX_PATTERN = /^(fix|Fix)(\([^)]+\))?:\s/;

function isFixCommit(subject) {
  return FIX_PATTERN.test(subject);
}

// ── Step 1: Hent endrede filer + line-ranges ─────────────────────────────

function getChangedFiles() {
  if (opts.staged) {
    // Staged-mode: diff index mot HEAD
    const r = git(["diff", "--name-only", "--diff-filter=ACM", "--cached"]);
    return r.stdout.split("\n").filter(Boolean);
  } else {
    // Ref-mode: diff <ref>~1 mot <ref>
    const r = git([
      "diff", "--name-only", "--diff-filter=ACM",
      `${opts.ref}~1`, opts.ref,
    ]);
    return r.stdout.split("\n").filter(Boolean);
  }
}

function isBinaryFile(filePath) {
  // Heuristikk: les første kB, sjekk for null-byte. Skip filer som er for
  // store til å være tekst.
  try {
    const fullPath = resolve(REPO_ROOT, filePath);
    if (!existsSync(fullPath)) return false; // Deleted files handle elsewhere
    const buf = readFileSync(fullPath, null);
    // Filer > 5MB regnes som binary (sanity-cap)
    if (buf.length > 5 * 1024 * 1024) return true;
    const sample = buf.slice(0, Math.min(8192, buf.length));
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function fileWasDeleted(filePath) {
  if (opts.staged) {
    const r = git(["diff", "--name-only", "--diff-filter=D", "--cached"]);
    return r.stdout.split("\n").includes(filePath);
  } else {
    const r = git([
      "diff", "--name-only", "--diff-filter=D",
      `${opts.ref}~1`, opts.ref,
    ]);
    return r.stdout.split("\n").includes(filePath);
  }
}

/**
 * Get the OLD (pre-change) line ranges that were modified.
 * Parses `git diff --unified=0` hunks:
 *   @@ -<old_start>,<old_count> +<new_start>,<new_count> @@
 * Returns an array of {oldStart, oldCount} objects.
 *
 * We want OLD-side line numbers because we need to blame against the
 * parent commit to find which commit originally introduced those lines.
 */
function getChangedLineRanges(filePath) {
  let diffArgs;
  if (opts.staged) {
    diffArgs = ["diff", "--unified=0", "--cached", "--", filePath];
  } else {
    diffArgs = ["diff", "--unified=0", `${opts.ref}~1`, opts.ref, "--", filePath];
  }
  const r = git(diffArgs);
  const ranges = [];
  // Parse hunk-headers
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of r.stdout.split("\n")) {
    const m = hunkRe.exec(line);
    if (!m) continue;
    const oldStart = parseInt(m[1], 10);
    // Default count is 1 if not specified
    const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    // Pure insertions have oldCount=0 — skip (no old lines to blame)
    if (oldCount === 0) continue;
    ranges.push({ oldStart, oldCount });
  }
  return ranges;
}

// ── Step 2: Blame hver line-range mot parent ─────────────────────────────

/**
 * Get the commits that last touched the given line range against the
 * parent commit. Returns an array of unique commit SHAs.
 *
 * Note: `--root` allows blaming files that go all the way back to the
 * initial commit. We use --line-porcelain to get one block per line.
 */
function blameLineRange(filePath, range, parentRef) {
  const lineSpec = `${range.oldStart},${range.oldStart + range.oldCount - 1}`;
  // Use git blame --porcelain so each block starts with SHA + line info.
  // The first line of each block is `<sha> <orig-line> <final-line> [<group-size>]`.
  let blameArgs;
  if (opts.staged) {
    // Blame against HEAD (since staged changes haven't been committed yet)
    blameArgs = [
      "blame",
      "-L", lineSpec,
      "--porcelain",
      "HEAD",
      "--", filePath,
    ];
  } else {
    blameArgs = [
      "blame",
      "-L", lineSpec,
      "--porcelain",
      parentRef,
      "--", filePath,
    ];
  }
  const r = git(blameArgs, { allowFail: true });
  if (r.status !== 0) {
    // File might be new (no parent blame) or path-error. Return empty.
    return [];
  }
  const shas = new Set();
  for (const line of r.stdout.split("\n")) {
    // Match SHA at start of line (40 hex chars + space + digits)
    const m = /^([0-9a-f]{40})\s+\d+\s+\d+/.exec(line);
    if (m) {
      // Skip "boundary" commits (start of history) which are valid SHAs
      shas.add(m[1]);
    }
  }
  return Array.from(shas);
}

// ── Step 3: Sjekk om commit er en recent fix ─────────────────────────────

const commitInfoCache = new Map();

function getCommitInfo(sha) {
  if (commitInfoCache.has(sha)) return commitInfoCache.get(sha);
  const r = git(["log", "-1", "--format=%H%x09%ct%x09%s", sha], { allowFail: true });
  if (r.status !== 0) {
    commitInfoCache.set(sha, null);
    return null;
  }
  const line = r.stdout.trim();
  if (!line) {
    commitInfoCache.set(sha, null);
    return null;
  }
  const [fullSha, ctStr, subject] = line.split("\t");
  const info = {
    sha: fullSha,
    shortSha: fullSha.slice(0, 8),
    timestamp: parseInt(ctStr, 10), // unix seconds
    subject: subject || "",
    isFix: isFixCommit(subject || ""),
  };
  commitInfoCache.set(sha, info);
  return info;
}

function ageDays(timestamp) {
  return (Date.now() / 1000 - timestamp) / (60 * 60 * 24);
}

// ── Step 4: Hovedalgoritme ───────────────────────────────────────────────

function scan() {
  const files = getChangedFiles();
  const parentRef = opts.staged ? "HEAD" : `${opts.ref}~1`;
  const candidates = []; // { file, ranges: [{range, blameCommits: [info...]}] }

  for (const file of files) {
    if (fileWasDeleted(file)) continue;
    if (isBinaryFile(file)) continue;
    const ranges = getChangedLineRanges(file);
    if (ranges.length === 0) continue; // pure additions

    const fileMatches = [];
    for (const range of ranges) {
      const shas = blameLineRange(file, range, parentRef);
      const recentFixes = [];
      for (const sha of shas) {
        const info = getCommitInfo(sha);
        if (!info) continue;
        if (!info.isFix) continue;
        const age = ageDays(info.timestamp);
        if (age > opts.days) continue;
        recentFixes.push({ ...info, ageDays: age });
      }
      if (recentFixes.length > 0) {
        fileMatches.push({ range, recentFixes });
      }
    }

    if (fileMatches.length > 0) {
      candidates.push({ file, matches: fileMatches });
    }
  }

  return candidates;
}

// ── Step 5: Sjekk om acknowledgment er satt ──────────────────────────────

function getGitDir() {
  try {
    const r = git(["rev-parse", "--git-dir"]);
    return resolve(REPO_ROOT, r.stdout.trim());
  } catch {
    return resolve(REPO_ROOT, ".git");
  }
}

function getCommitMessage() {
  // Priority:
  // 1. Explicit --commit-msg-file (from hook)
  // 2. <git-dir>/COMMIT_EDITMSG (in-progress commit) — staged-mode only
  // 3. Last commit message via git log — ref-mode
  if (opts.commitMsgFile && existsSync(opts.commitMsgFile)) {
    return readFileSync(opts.commitMsgFile, "utf8");
  }
  if (opts.staged) {
    const editMsg = resolve(getGitDir(), "COMMIT_EDITMSG");
    if (existsSync(editMsg)) {
      return readFileSync(editMsg, "utf8");
    }
  }
  if (!opts.staged && opts.ref) {
    const r = git(["log", "-1", "--format=%B", opts.ref], { allowFail: true });
    if (r.status === 0) return r.stdout;
  }
  return "";
}

const ACK_PATTERN = /\[resurrection-acknowledged:\s*([^\]]+)\]/i;

function hasAcknowledgment() {
  const msg = getCommitMessage();
  return ACK_PATTERN.test(msg);
}

function getAcknowledgmentReason() {
  const msg = getCommitMessage();
  const m = ACK_PATTERN.exec(msg);
  return m ? m[1].trim() : null;
}

// ── Output formatting ────────────────────────────────────────────────────

function formatHuman(candidates) {
  if (candidates.length === 0) {
    if (!opts.quiet) {
      console.log(color(C.green, "✓ Ingen bug-resurrection-candidates funnet."));
    }
    return;
  }

  console.log("");
  console.log(color(C.yellow + C.bold, "⚠️  Bug-resurrection candidates detected:"));
  console.log("");

  for (const cand of candidates) {
    console.log(color(C.bold, `  ${cand.file}`));
    for (const m of cand.matches) {
      const endLine = m.range.oldStart + m.range.oldCount - 1;
      console.log(
        color(C.dim, `    Linjer ${m.range.oldStart}-${endLine} sist endret av:`),
      );
      for (const fix of m.recentFixes) {
        const ageStr = formatAge(fix.ageDays);
        console.log(
          `      ${color(C.cyan, fix.shortSha)} (${ageStr})`,
        );
        console.log(`        "${truncate(fix.subject, 80)}"`);
      }
    }
    console.log("");
  }

  console.log(color(C.dim,
    "  Vurder: har du lest relevante FRAGILITY-entries? Hvis du fikser",
  ));
  console.log(color(C.dim,
    "  EN ANNEN bug i samme region, legg til:",
  ));
  console.log(color(C.cyan,
    "    [resurrection-acknowledged: <grunn>]",
  ));
  console.log(color(C.dim, "  i commit-meldingen."));
  console.log("");
}

function formatAge(days) {
  if (days < 1) return "i dag";
  if (days < 2) return "i går";
  const d = Math.floor(days);
  return `${d} dager siden`;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatJson(candidates) {
  const out = {
    resurrectionCandidates: candidates.length > 0,
    daysWindow: opts.days,
    acknowledgmentPresent: hasAcknowledgment(),
    acknowledgmentReason: getAcknowledgmentReason(),
    candidates: candidates.map((c) => ({
      file: c.file,
      matches: c.matches.map((m) => ({
        oldStart: m.range.oldStart,
        oldCount: m.range.oldCount,
        oldEnd: m.range.oldStart + m.range.oldCount - 1,
        recentFixes: m.recentFixes.map((f) => ({
          sha: f.sha,
          shortSha: f.shortSha,
          subject: f.subject,
          timestamp: f.timestamp,
          ageDays: f.ageDays,
        })),
      })),
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  let candidates;
  try {
    candidates = scan();
  } catch (err) {
    console.error(`scan-blame-for-recent-fixes.mjs: error: ${err.message}`);
    process.exit(2);
  }

  if (opts.format === "json") {
    formatJson(candidates);
  } else {
    formatHuman(candidates);
  }

  if (candidates.length === 0) {
    process.exit(0);
  }
  if (hasAcknowledgment()) {
    if (!opts.quiet && opts.format !== "json") {
      console.log(
        color(C.green,
          `✓ Acknowledgment satt: [resurrection-acknowledged: ${getAcknowledgmentReason()}]`,
        ),
      );
    }
    process.exit(0);
  }
  process.exit(1);
}

main();
