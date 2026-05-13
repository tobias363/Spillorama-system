#!/usr/bin/env node
/**
 * cross-knowledge-audit.mjs
 *
 * Detekterer drift mellom Spillorama-pilotens kunnskaps-kilder:
 *   - Linear-issues (BIN-NNN)
 *   - BACKLOG.md
 *   - docs/engineering/PITFALLS_LOG.md
 *   - docs/engineering/FRAGILITY_LOG.md
 *   - docs/adr/NNNN-*.md
 *   - tests/e2e/BUG_CATALOG.md
 *   - docs/operations/PM_HANDOFF_*.md
 *   - .github/pull_request_template.md
 *
 * Etablert 2026-05-13 etter Tobias-direktiv:
 *   "Kan du anbefale noe annet her for at dette skal gå av seg selv
 *    og at da agentene blir smartere utifra arbeid som blir gjort fordi
 *    dokumentasjon alltid oppdateres?"
 *
 * Kjøres ukentlig av .github/workflows/cross-knowledge-audit-weekly.yml.
 *
 * CLI:
 *   node scripts/cross-knowledge-audit.mjs
 *   node scripts/cross-knowledge-audit.mjs --output=docs/auto-generated/CROSS_KNOWLEDGE_AUDIT.md
 *   node scripts/cross-knowledge-audit.mjs --no-linear
 *   node scripts/cross-knowledge-audit.mjs --fail-on-findings
 *   node scripts/cross-knowledge-audit.mjs --json
 */

import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const outputPath = args.find((a) => a.startsWith("--output="))?.split("=")[1];
const noLinear = args.includes("--no-linear");
const failOnFindings = args.includes("--fail-on-findings");
const jsonOutput = args.includes("--json");
const verbose = args.includes("--verbose") || args.includes("-v");

// ── Constants ───────────────────────────────────────────────────────────

const SEVERITY = {
  RED: "🔴",
  YELLOW: "🟡",
  INFO: "ℹ️",
};

const SOURCE_PATHS = {
  pitfalls: "docs/engineering/PITFALLS_LOG.md",
  fragility: "docs/engineering/FRAGILITY_LOG.md",
  backlog: "BACKLOG.md",
  adrDir: "docs/adr",
  bugCatalog: "tests/e2e/BUG_CATALOG.md",
  pmHandoffDir: "docs/operations",
  prTemplate: ".github/pull_request_template.md",
  skillsDir: ".claude/skills",
};

// ── Helpers ─────────────────────────────────────────────────────────────

async function readFileSafe(path) {
  try {
    return await readFile(resolve(REPO_ROOT, path), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function pathExists(path) {
  try {
    await access(resolve(REPO_ROOT, path), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function log(msg) {
  if (verbose) console.error(`[audit] ${msg}`);
}

function findBinRefs(text) {
  return [...text.matchAll(/BIN-\d+/g)].map((m) => m[0]);
}

function findPrRefs(text) {
  return [...text.matchAll(/(?<![\w-])#(\d{3,5})\b/g)].map((m) => `#${m[1]}`);
}

function findCommitSha(text) {
  // 7-40 hex chars, surrounded by non-hex (or start/end of line)
  return [...text.matchAll(/(?:^|[^0-9a-f])([0-9a-f]{7,40})(?:[^0-9a-f]|$)/gi)]
    .map((m) => m[1])
    .filter((sha) => sha.length >= 7);
}

function findAdrRefs(text) {
  // Match ADR-NNN or ADR-NNNN
  return [...text.matchAll(/ADR-(\d{3,4})/g)].map((m) => ({
    raw: m[0],
    num: parseInt(m[1], 10),
  }));
}

// ── Linear API client (optional) ────────────────────────────────────────

class LinearClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.cache = new Map();
  }

  async query(graphql) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query: graphql }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }

  async getIssue(identifier) {
    if (this.cache.has(identifier)) return this.cache.get(identifier);
    const data = await this.query(`{
      issue(id: "${identifier}") {
        identifier
        title
        state { name type }
      }
    }`).catch((err) => {
      log(`Linear lookup failed for ${identifier}: ${err.message}`);
      return null;
    });
    const issue = data?.issue ?? null;
    this.cache.set(identifier, issue);
    return issue;
  }
}

async function loadLinearKey() {
  if (process.env.LINEAR_API_KEY) {
    return process.env.LINEAR_API_KEY.trim();
  }
  const localPath = "secrets/linear-api.local.md";
  const content = await readFileSafe(localPath);
  if (!content) return null;
  // Try to extract from code block (matches the template format)
  const m = content.match(/```(?:[^\n]*)\n([^\n]*)\n```/);
  if (m && m[1] && !m[1].includes("<")) {
    const key = m[1].trim();
    if (key.length > 10) return key;
  }
  return null;
}

// ── Check 1: PITFALLS-§ references closed Linear issue as open ──────────

async function check1PitfallsClosedLinear(state) {
  const findings = [];
  const pitfallsContent = state.sources.pitfalls;
  if (!pitfallsContent) return findings;

  if (!state.linearClient) {
    findings.push({
      check: 1,
      severity: SEVERITY.INFO,
      title: "Linear access unavailable",
      detail:
        "Skipped Check 1 (PITFALLS-§ references closed Linear issue) — Linear API key not configured. Run with LINEAR_API_KEY env var or add secrets/linear-api.local.md to enable.",
    });
    return findings;
  }

  // Split into sections (### headers)
  const sections = pitfallsContent.split(/^###\s+/m);
  for (const section of sections) {
    const titleMatch = section.match(/^(.+)$/m);
    if (!titleMatch) continue;
    const sectionTitle = titleMatch[1].trim();
    const binRefs = [...new Set(findBinRefs(section))];
    for (const binRef of binRefs) {
      const issue = await state.linearClient.getIssue(binRef);
      if (!issue) continue;
      const stateType = issue.state?.type ?? "";
      // Linear state types: "triage", "backlog", "unstarted", "started", "completed", "canceled"
      if (stateType === "completed" || stateType === "canceled") {
        findings.push({
          check: 1,
          severity: SEVERITY.YELLOW,
          title: `PITFALLS section references closed/canceled Linear issue ${binRef}`,
          detail: `Section "${sectionTitle}" references ${binRef} (state: ${issue.state.name}). Suggested fix: update the section to note that the issue is closed, or remove the reference.`,
          file: SOURCE_PATHS.pitfalls,
          binRef,
          sectionTitle,
        });
      }
    }
  }

  return findings;
}

// ── Check 2: FRAGILITY-file-cluster (architectural fragility) ───────────

async function check2FragilityCluster(state) {
  const findings = [];
  const fragilityContent = state.sources.fragility;
  if (!fragilityContent) return findings;

  // Parse entries: ## F-NN: <title>
  const entryPattern = /^## (F-\d+):\s*(.+?)$/gm;
  const entries = [];
  let match;
  const lines = fragilityContent.split("\n");
  let currentEntry = null;
  for (const line of lines) {
    const headerMatch = line.match(/^## (F-\d+):\s*(.+)$/);
    if (headerMatch) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = {
        id: headerMatch[1],
        title: headerMatch[2].trim(),
        files: [],
      };
      continue;
    }
    if (!currentEntry) continue;
    // Look for **Filer:** line and any subsequent bullet lines referencing files
    const filerMatch = line.match(/^\*\*Filer:\*\*\s*(.+)$/);
    if (filerMatch) {
      // Extract file paths (typically backtick-wrapped or path-like)
      const filerLine = filerMatch[1];
      // Match `apps/...` or `packages/...` or `tests/...`
      const fileMatches = [
        ...filerLine.matchAll(/[`"']?((?:apps|packages|tests|scripts|docs|infra|\.github)\/[^\s`"'\n]+?\.(?:ts|tsx|js|jsx|mjs|sql|yml|yaml|md|json|sh))(?:[:\d-]+)?[`"']?/g),
      ];
      for (const m of fileMatches) {
        // Strip line/char suffixes
        const file = m[1].replace(/:.+$/, "");
        currentEntry.files.push(file);
      }
    }
    // Also catch list-form refs (- `apps/backend/...`)
    const bulletMatch = line.match(/^-\s+[`"']?((?:apps|packages|tests|scripts|docs|infra|\.github)\/[^\s`"'\n]+?\.(?:ts|tsx|js|jsx|mjs|sql|yml|yaml|md|json|sh))[`"']?/);
    if (bulletMatch) {
      currentEntry.files.push(bulletMatch[1].replace(/:.+$/, ""));
    }
  }
  if (currentEntry) entries.push(currentEntry);

  // Count file appearances across entries
  const fileToEntries = new Map();
  for (const entry of entries) {
    for (const file of new Set(entry.files)) {
      if (!fileToEntries.has(file)) fileToEntries.set(file, []);
      fileToEntries.get(file).push(entry.id);
    }
  }

  // Files referenced in 3+ entries are flagged
  const clusters = [];
  for (const [file, entryIds] of fileToEntries.entries()) {
    if (entryIds.length >= 3) {
      clusters.push({ file, entryIds });
    }
  }

  if (clusters.length > 0) {
    for (const { file, entryIds } of clusters) {
      findings.push({
        check: 2,
        severity: SEVERITY.RED,
        title: `Architectural fragility: \`${file}\` appears in ${entryIds.length} FRAGILITY entries`,
        detail: `File \`${file}\` is referenced in ${entryIds.join(", ")}. This indicates an architectural hot-spot — consider refactor or arkitektur-review.`,
        file,
        entryIds,
      });
    }
  }

  // Also export the full fragility map for summary
  state.fragilityFileMap = fileToEntries;

  return findings;
}

// ── Check 3: BACKLOG-item without Linear-link ───────────────────────────

async function check3BacklogWithoutLinear(state) {
  const findings = [];
  const backlogContent = state.sources.backlog;
  if (!backlogContent) return findings;

  const lines = backlogContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match checkbox-style backlog items
    const checkMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (!checkMatch) continue;
    const isChecked = checkMatch[1] === "x";
    const text = checkMatch[2];
    // Skip items that are part of a deeper paragraph or already reference BIN
    if (findBinRefs(text).length > 0) continue;
    // Skip purely-doc-reference items (e.g. links to architecture docs)
    if (text.match(/^\[`.+?`\]\(.+?\)$/)) continue;
    if (text.match(/^\[Linear:/)) continue;
    // Skip ✅-marked items (those have status info, often historical)
    if (text.startsWith("✅") || text.startsWith("🟢")) continue;
    findings.push({
      check: 3,
      severity: SEVERITY.YELLOW,
      title: `Backlog item without Linear-link (line ${i + 1})`,
      detail: `\`${text.length > 120 ? text.slice(0, 117) + "..." : text}\` — ${isChecked ? "completed" : "open"}, but no BIN-reference. Consider linking to a Linear issue, or document why no issue exists.`,
      file: SOURCE_PATHS.backlog,
      line: i + 1,
      checked: isChecked,
    });
  }

  return findings;
}

// ── Check 4: BUG_CATALOG ✅ Merged without commit-SHA ───────────────────

async function check4BugCatalogMissingSha(state) {
  const findings = [];
  const bugContent = state.sources.bugCatalog;
  if (!bugContent) return findings;

  const lines = bugContent.split("\n");
  let currentTableHeaders = null; // tracks columns of the current markdown table
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) {
      currentTableHeaders = null;
      inTable = false;
      continue;
    }
    // Header row: first |...| after a non-table line, followed by a separator row.
    if (!inTable) {
      const headerCells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // Next line should be the |---| separator
      if (lines[i + 1] && /^\|[\s\-:|]+$/.test(lines[i + 1])) {
        currentTableHeaders = headerCells;
        inTable = true;
        continue;
      }
    }
    // Skip the separator row right after header
    if (/^\|[\s\-:|]+$/.test(line)) continue;
    // Only flag rows in tables that explicitly have a Fix-PR column
    // (i.e. tables that track fix-references; otherwise we'd false-positive on
    // test-harness-only rows whose ✅ refers to inline test-code fixes).
    if (!currentTableHeaders) continue;
    const hasFixPrColumn = currentTableHeaders.some((h) =>
      /fix[\s-]?pr|commit|pr[\s-]?nr|merge[d]?/i.test(h),
    );
    if (!hasFixPrColumn) continue;
    if (!line.includes("✅") && !line.toLowerCase().includes("merged")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const idCell = cells[1] ?? "";
    const finnCell = cells[2] ?? "";
    const rowText = line;
    const prRefs = findPrRefs(rowText);
    const commitShas = findCommitSha(rowText);
    // Also detect branch-name fix-refs like "feat/...-2026-05-13" — these are
    // valid Done-policy markers (PR is open on that branch).
    const hasBranchRef = /(?:feat|fix|chore|docs|test|refactor)\/[\w-]+-\d{4}-\d{2}-\d{2}/.test(rowText);
    if (commitShas.length === 0 && prRefs.length === 0 && !hasBranchRef) {
      findings.push({
        check: 4,
        severity: SEVERITY.YELLOW,
        title: `BUG_CATALOG ${idCell || "row"} marked ✅ Merged without commit-SHA or PR-ref`,
        detail: `Row at line ${i + 1}: "${finnCell.length > 80 ? finnCell.slice(0, 77) + "..." : finnCell}" — no commit-SHA, #PR-ref, or branch-name found in row. Add SHA/PR-ref/branch in Fix-PR column for Done-policy compliance.`,
        file: SOURCE_PATHS.bugCatalog,
        line: i + 1,
        rowId: idCell,
      });
    }
  }

  return findings;
}

// ── Check 5: ADR contradicted by newer (broken Superseded chain) ────────

async function check5AdrSupersededChain(state) {
  const findings = [];
  const adrFiles = await readdir(resolve(REPO_ROOT, SOURCE_PATHS.adrDir)).catch(() => []);
  const adrs = new Map(); // num → { num, path, status, supersededBy, content }

  for (const file of adrFiles) {
    if (!/^\d{4}-.*\.md$/.test(file)) continue;
    const numMatch = file.match(/^(\d{4})/);
    if (!numMatch) continue;
    const num = parseInt(numMatch[1], 10);
    const content = await readFileSafe(`${SOURCE_PATHS.adrDir}/${file}`);
    if (!content) continue;
    const statusMatch = content.match(/^\*\*Status:\*\*\s*(.+)$/m);
    const status = statusMatch ? statusMatch[1].trim() : "Unknown";
    const supersededMatch = status.match(/Superseded by ADR-(\d{3,4})/i);
    const supersededBy = supersededMatch ? parseInt(supersededMatch[1], 10) : null;
    adrs.set(num, {
      num,
      file,
      path: `${SOURCE_PATHS.adrDir}/${file}`,
      status,
      supersededBy,
      content,
    });
  }

  state.adrs = adrs;

  // Check for broken supersession chains
  for (const adr of adrs.values()) {
    if (!adr.supersededBy) continue;
    const successor = adrs.get(adr.supersededBy);
    if (!successor) {
      findings.push({
        check: 5,
        severity: SEVERITY.RED,
        title: `ADR-${String(adr.num).padStart(4, "0")} says "Superseded by ADR-${String(adr.supersededBy).padStart(4, "0")}" but successor not found`,
        detail: `${adr.path} declares supersession by ADR-${adr.supersededBy}, but no such ADR file exists. Either the reference is wrong, or the successor ADR is missing.`,
        file: adr.path,
        supersededBy: adr.supersededBy,
      });
      continue;
    }
    // Successor should ideally reference back to predecessor
    const refsBack = successor.content.match(new RegExp(`ADR-0?${adr.num}\\b`));
    if (!refsBack) {
      findings.push({
        check: 5,
        severity: SEVERITY.YELLOW,
        title: `ADR-${String(adr.num).padStart(4, "0")} → ADR-${String(adr.supersededBy).padStart(4, "0")}: successor missing back-reference`,
        detail: `${adr.path} marks itself superseded by ADR-${adr.supersededBy}, but the successor (\`${successor.path}\`) does not reference back to ADR-${adr.num}. Consider documenting the supersession in both directions.`,
        file: successor.path,
        supersededBy: adr.supersededBy,
        predecessor: adr.num,
      });
    }
  }

  return findings;
}

// ── Check 6: Skills referencing dead ADRs ───────────────────────────────

async function check6SkillsDeadAdrRefs(state) {
  const findings = [];
  const skillDirs = await readdir(resolve(REPO_ROOT, SOURCE_PATHS.skillsDir)).catch(() => []);

  for (const dir of skillDirs) {
    const skillPath = `${SOURCE_PATHS.skillsDir}/${dir}/SKILL.md`;
    const content = await readFileSafe(skillPath);
    if (!content) continue;
    const refs = findAdrRefs(content);
    const seen = new Set();
    for (const ref of refs) {
      if (seen.has(ref.num)) continue;
      seen.add(ref.num);
      // Check if ADR file exists. ADR-NNN (3-digit) and ADR-NNNN (4-digit) both map
      // to current docs/adr/NNNN- format (4-digit padded).
      const padded = String(ref.num).padStart(4, "0");
      const adr = state.adrs?.get(ref.num);
      if (!adr) {
        findings.push({
          check: 6,
          severity: SEVERITY.YELLOW,
          title: `Skill \`${dir}\` references missing ${ref.raw}`,
          detail: `Skill at \`${skillPath}\` references ${ref.raw} but no matching ADR file found in \`docs/adr/${padded}-*.md\`. Either the ADR was removed, the reference is wrong, or ADR-numbering changed.`,
          file: skillPath,
          adrRef: ref.raw,
          adrNum: ref.num,
        });
      }
    }
  }

  return findings;
}

// ── Check 7: PM_HANDOFF mentions OPEN PR that's been merged ─────────────

async function check7PmHandoffStalePrs(state) {
  const findings = [];
  // Find most recent PM_HANDOFF
  const handoffFiles = (
    await readdir(resolve(REPO_ROOT, SOURCE_PATHS.pmHandoffDir)).catch(() => [])
  )
    .filter((f) => /^PM_HANDOFF_\d{4}-\d{2}-\d{2}/.test(f))
    .sort();
  if (handoffFiles.length === 0) {
    findings.push({
      check: 7,
      severity: SEVERITY.INFO,
      title: "No PM_HANDOFF files found",
      detail: `No \`PM_HANDOFF_*.md\` files in ${SOURCE_PATHS.pmHandoffDir}. Skipping Check 7.`,
    });
    return findings;
  }
  const mostRecent = handoffFiles[handoffFiles.length - 1];
  const content = await readFileSafe(`${SOURCE_PATHS.pmHandoffDir}/${mostRecent}`);
  if (!content) return findings;

  // Extract PR refs (#NNNN)
  const prRefs = [...new Set(findPrRefs(content))];

  // For each, query gh CLI for state
  const ghAvailable = (() => {
    try {
      execSync("gh --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (!ghAvailable) {
    findings.push({
      check: 7,
      severity: SEVERITY.INFO,
      title: "`gh` CLI unavailable",
      detail: `Cannot verify PR-state references in ${mostRecent}. Install \`gh\` CLI to enable Check 7.`,
    });
    return findings;
  }

  // Look for "open" / "OPEN" mentions near PR refs (context-sensitive)
  for (const prRef of prRefs) {
    const num = prRef.slice(1);
    // Skip if PR ref is clearly mentioned as merged (✅/Merget/Merged context)
    const idx = content.indexOf(prRef);
    if (idx === -1) continue;
    const context = content.slice(Math.max(0, idx - 200), Math.min(content.length, idx + 200));
    const mentionsOpen = /\bopen\b|\båpen\b|\båpne\b|pending/i.test(context);
    const mentionsMerged = /merged|merget|✅|🟢/i.test(context);
    if (!mentionsOpen || mentionsMerged) continue;

    // Query gh for actual PR state
    try {
      const result = execSync(`gh pr view ${num} --json state,number 2>/dev/null`, {
        encoding: "utf8",
      });
      const parsed = JSON.parse(result);
      if (parsed.state === "MERGED") {
        findings.push({
          check: 7,
          severity: SEVERITY.INFO,
          title: `PM_HANDOFF ${mostRecent} may reference merged PR ${prRef} as open`,
          detail: `${prRef} is mentioned in a context suggesting "open" or "pending" status, but \`gh pr view\` reports state=MERGED. This is informational — handoff docs naturally go stale.`,
          file: `${SOURCE_PATHS.pmHandoffDir}/${mostRecent}`,
          prRef,
          actualState: "MERGED",
        });
      }
    } catch {
      // Silently skip — PR may not exist or gh unavailable
    }
  }

  return findings;
}

// ── Check 8: PR template knowledge-protocol checklist completeness ──────

async function check8PrTemplateChecklist(state) {
  const findings = [];
  const content = state.sources.prTemplate;
  if (!content) {
    findings.push({
      check: 8,
      severity: SEVERITY.YELLOW,
      title: "PR template file missing",
      detail: `\`${SOURCE_PATHS.prTemplate}\` not found. Cannot verify knowledge-protocol checklist.`,
      file: SOURCE_PATHS.prTemplate,
    });
    return findings;
  }

  const requiredCheckboxes = [
    {
      label: "PITFALLS_LOG",
      pattern: /PITFALLS[_\s-]?LOG/i,
      description: "Add a checkbox referencing PITFALLS_LOG (e.g. 'I have read relevant PITFALLS_LOG sections').",
    },
    {
      label: "FRAGILITY_LOG",
      pattern: /FRAGILITY[_\s-]?LOG/i,
      description: "Add a checkbox referencing FRAGILITY_LOG (e.g. 'I have read FRAGILITY_LOG F-NN for changed files').",
    },
    {
      label: "SKILL update",
      pattern: /skill[\w-]*\.md|SKILL\.md|update\s+(a\s+)?skill/i,
      description: "Add a checkbox prompting for skill-update if generalizable knowledge was learned (e.g. 'I have updated relevant `.claude/skills/*/SKILL.md` if applicable').",
    },
    {
      label: "AGENT_EXECUTION_LOG",
      pattern: /AGENT[_\s-]?EXECUTION[_\s-]?LOG/i,
      description: "Add a checkbox prompting for AGENT_EXECUTION_LOG entry (e.g. 'I have appended an entry to AGENT_EXECUTION_LOG.md').",
    },
  ];

  const missing = requiredCheckboxes.filter((c) => !c.pattern.test(content));
  if (missing.length > 0) {
    findings.push({
      check: 8,
      severity: SEVERITY.YELLOW,
      title: `PR template missing ${missing.length}/${requiredCheckboxes.length} knowledge-protocol checkboxes`,
      detail: `Missing: ${missing.map((m) => m.label).join(", ")}. Each acts as a manual reminder of the knowledge-protocol (KNOWLEDGE_AUTONOMY_PROTOCOL.md). Suggested additions:\n${missing.map((m) => `  - ${m.description}`).join("\n")}`,
      file: SOURCE_PATHS.prTemplate,
      missing: missing.map((m) => m.label),
    });
  }

  return findings;
}

// ── Run all checks + report ─────────────────────────────────────────────

async function runAudit() {
  const linearKey = noLinear ? null : await loadLinearKey();
  const linearClient = linearKey ? new LinearClient(linearKey) : null;

  log(`Linear access: ${linearClient ? "enabled" : "disabled"} (--no-linear=${noLinear})`);

  const state = {
    linearClient,
    sources: {
      pitfalls: await readFileSafe(SOURCE_PATHS.pitfalls),
      fragility: await readFileSafe(SOURCE_PATHS.fragility),
      backlog: await readFileSafe(SOURCE_PATHS.backlog),
      bugCatalog: await readFileSafe(SOURCE_PATHS.bugCatalog),
      prTemplate: await readFileSafe(SOURCE_PATHS.prTemplate),
    },
    adrs: null,
    fragilityFileMap: null,
  };

  const checks = [
    { id: 1, name: "PITFALLS-§ references closed Linear issue", fn: check1PitfallsClosedLinear },
    { id: 2, name: "FRAGILITY-file-cluster (architectural fragility)", fn: check2FragilityCluster },
    { id: 3, name: "BACKLOG-item without Linear-link", fn: check3BacklogWithoutLinear },
    { id: 4, name: "BUG_CATALOG ✅ Merged without commit-SHA", fn: check4BugCatalogMissingSha },
    { id: 5, name: "ADR Superseded chain integrity", fn: check5AdrSupersededChain },
    { id: 6, name: "Skills referencing dead ADRs", fn: check6SkillsDeadAdrRefs },
    { id: 7, name: "PM_HANDOFF mentions OPEN PR that's merged", fn: check7PmHandoffStalePrs },
    { id: 8, name: "PR template knowledge-protocol checklist", fn: check8PrTemplateChecklist },
  ];

  const allFindings = [];
  for (const check of checks) {
    log(`Running check ${check.id}: ${check.name}`);
    try {
      const findings = await check.fn(state);
      allFindings.push(...findings);
      log(`  → ${findings.length} finding(s)`);
    } catch (err) {
      allFindings.push({
        check: check.id,
        severity: SEVERITY.RED,
        title: `Check ${check.id} crashed: ${err.message}`,
        detail: `Internal error in audit logic. Stack: ${err.stack?.split("\n").slice(0, 3).join("\n") ?? "(no stack)"}`,
      });
    }
  }

  return { findings: allFindings, state };
}

// ── Report formatter ────────────────────────────────────────────────────

function formatReport({ findings, state }) {
  const now = new Date().toISOString();
  const date = now.split("T")[0];
  const drift = findings.filter((f) => f.severity !== SEVERITY.INFO);
  const arch = findings.filter((f) => f.check === 2);

  let report = "";
  report += `# Cross-Knowledge Audit Report\n\n`;
  report += `**Date:** ${date}\n`;
  report += `**Generated:** ${now}\n`;
  report += `**Drift findings:** ${drift.length}\n`;
  report += `**Architectural concerns:** ${arch.length}\n`;
  report += `**Info-notices:** ${findings.length - drift.length}\n\n`;

  if (findings.length === 0) {
    report += `_No drift detected. All knowledge sources are aligned._\n\n`;
  } else {
    report += `## Findings\n\n`;
    // Group by check
    const byCheck = new Map();
    for (const f of findings) {
      if (!byCheck.has(f.check)) byCheck.set(f.check, []);
      byCheck.get(f.check).push(f);
    }
    const sortedCheckIds = [...byCheck.keys()].sort((a, b) => a - b);
    for (const checkId of sortedCheckIds) {
      const items = byCheck.get(checkId);
      report += `### Check ${checkId}\n\n`;
      for (const f of items) {
        report += `#### ${f.severity} ${f.title}\n\n`;
        report += `${f.detail}\n\n`;
        if (f.file) {
          report += `**File:** \`${f.file}\`${f.line ? `:${f.line}` : ""}\n\n`;
        }
      }
    }
  }

  // Architectural fragility summary
  if (state.fragilityFileMap && state.fragilityFileMap.size > 0) {
    report += `## Architectural fragility summary\n\n`;
    const rows = [...state.fragilityFileMap.entries()]
      .map(([file, ids]) => ({ file, ids }))
      .sort((a, b) => b.ids.length - a.ids.length)
      .slice(0, 20);
    report += `| File | FRAGILITY entries | Count |\n`;
    report += `|---|---|---:|\n`;
    for (const { file, ids } of rows) {
      report += `| \`${file}\` | ${ids.join(", ")} | ${ids.length} |\n`;
    }
    report += `\n_(Top 20 by entry-count. Files appearing in 3+ entries are flagged as architectural concerns above.)_\n\n`;
  }

  // Recommended actions
  if (drift.length > 0) {
    report += `## Recommended actions\n\n`;
    if (arch.length > 0) {
      report += `- **Architectural review:** ${arch.length} file(s) flagged with 3+ FRAGILITY entries — schedule a refactor session with Tobias.\n`;
    }
    const closedLinearCount = findings.filter(
      (f) => f.check === 1 && f.severity !== SEVERITY.INFO,
    ).length;
    if (closedLinearCount > 0) {
      report += `- **Update PITFALLS_LOG:** ${closedLinearCount} section(s) reference closed Linear issues — refresh status or remove.\n`;
    }
    const backlogCount = findings.filter(
      (f) => f.check === 3 && f.severity !== SEVERITY.INFO,
    ).length;
    if (backlogCount > 0) {
      report += `- **Link BACKLOG items to Linear:** ${backlogCount} backlog item(s) lack BIN-references — add issue-links or document why no issue.\n`;
    }
    const sha4Count = findings.filter(
      (f) => f.check === 4 && f.severity !== SEVERITY.INFO,
    ).length;
    if (sha4Count > 0) {
      report += `- **Document commit-SHA for merged bugs:** ${sha4Count} BUG_CATALOG row(s) lack commit-SHA — Done-policy requires it.\n`;
    }
    const adrCount = findings.filter(
      (f) => (f.check === 5 || f.check === 6) && f.severity !== SEVERITY.INFO,
    ).length;
    if (adrCount > 0) {
      report += `- **Repair ADR chain:** ${adrCount} ADR-reference issue(s) — verify superseded chains and skill-doc references.\n`;
    }
    const templateCount = findings.filter(
      (f) => f.check === 8 && f.severity !== SEVERITY.INFO,
    ).length;
    if (templateCount > 0) {
      report += `- **Update PR template:** Knowledge-protocol checkboxes missing — see Check 8 finding for exact additions.\n`;
    }
  }

  report += `\n---\n\n`;
  report += `## How to act on these findings\n\n`;
  report += `1. Review each finding in order of severity (🔴 > 🟡 > ℹ️).\n`;
  report += `2. For each, either:\n`;
  report += `   - **Fix:** Update the source document/code to resolve the drift.\n`;
  report += `   - **Suppress:** If the finding is a known false-positive, document the rationale.\n`;
  report += `3. Re-run the audit locally: \`node scripts/cross-knowledge-audit.mjs\`.\n`;
  report += `4. If running via CI: a GitHub issue has been created automatically.\n\n`;
  report += `## How to add new drift-checks\n\n`;
  report += `See [\`docs/engineering/CROSS_KNOWLEDGE_AUDIT.md\`](../../docs/engineering/CROSS_KNOWLEDGE_AUDIT.md) for the contributor guide.\n`;

  return report;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const result = await runAudit();
  const driftCount = result.findings.filter((f) => f.severity !== SEVERITY.INFO).length;

  if (jsonOutput) {
    const json = {
      generatedAt: new Date().toISOString(),
      driftCount,
      totalFindings: result.findings.length,
      findings: result.findings.map((f) => ({
        check: f.check,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        file: f.file ?? null,
        line: f.line ?? null,
      })),
    };
    const jsonStr = JSON.stringify(json, null, 2);
    if (outputPath) {
      await writeFile(resolve(REPO_ROOT, outputPath), jsonStr);
      console.error(`Wrote JSON report to ${outputPath}`);
    } else {
      console.log(jsonStr);
    }
  } else {
    const report = formatReport(result);
    if (outputPath) {
      await writeFile(resolve(REPO_ROOT, outputPath), report);
      console.error(`Wrote markdown report to ${outputPath} (${driftCount} drift findings)`);
    } else {
      console.log(report);
    }
  }

  if (failOnFindings && driftCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[audit] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});
