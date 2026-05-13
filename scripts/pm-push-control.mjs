#!/usr/bin/env node
/**
 * PM Push Control — Spillorama
 *
 * Centralized control of git-pushes during multi-agent operations.
 *
 * Commands:
 *   list                    Show all active agents + their declared scope
 *   register <id> <branch> <scope-globs...>  Register new in-flight agent
 *   unregister <id>         Remove agent (when PR delivered/closed)
 *   conflicts               Compute file-overlap matrix (in-flight + open PRs)
 *   merge-order             Recommend merge order based on dependencies
 *   diff <id>               Show actual files in agent branch vs declared scope
 *   poll                    One-shot poll: check what's been pushed since last call
 *   watch                   Daemon: poll every 30s, alert on changes
 *
 * Registry: /tmp/active-agents.json (ephemeral, lives for active session)
 * Audit-trail: /tmp/pm-push-control.log
 *
 * Spillorama-specific:
 *   - Reads open PRs via `gh pr list`
 *   - Cross-references in-flight registry with open PRs
 *   - Catches collisions BEFORE merge
 */

import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_PATH = "/tmp/active-agents.json";
const LOG_PATH = "/tmp/pm-push-control.log";
const LAST_POLL_PATH = "/tmp/pm-push-control.last-poll.json";

// ─── Helpers ────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.log(line.trim());
}

function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { version: 1, updatedAt: new Date().toISOString(), agents: [], conflictsAcknowledged: [] };
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

function writeRegistry(reg) {
  reg.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
}

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
  } catch (err) {
    if (opts.allowFail) return "";
    throw err;
  }
}

/**
 * Match path against glob pattern.
 * Supports: *, **, exact match
 */
function globMatch(path, glob) {
  if (glob === path) return true;
  // Convert simple glob to regex
  const pat = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${pat}$`).test(path);
}

function filesOverlap(files1, files2) {
  const matches = [];
  for (const f1 of files1) {
    for (const f2 of files2) {
      if (f1 === f2 || globMatch(f1, f2) || globMatch(f2, f1)) {
        matches.push({ a: f1, b: f2 });
      }
    }
  }
  return matches;
}

// ─── Commands ───────────────────────────────────────────────────────────

function cmdList() {
  const reg = readRegistry();
  console.log(`\n📋 Active agents (${reg.agents.length})`);
  console.log(`Updated: ${reg.updatedAt}\n`);

  if (reg.agents.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const a of reg.agents) {
    console.log(`  [${a.shortname || a.id.slice(0, 8)}] ${a.status.padEnd(12)} ${a.topic}`);
    console.log(`         Branch: ${a.branch}`);
    console.log(`         Scope:  ${a.scope.length} files/globs`);
    a.scope.slice(0, 3).forEach((s) => console.log(`           - ${s}`));
    if (a.scope.length > 3) console.log(`           - ... +${a.scope.length - 3} more`);
    console.log();
  }

  // Acknowledged conflicts
  if (reg.conflictsAcknowledged?.length) {
    console.log(`\n⚠️  Acknowledged conflicts (will need manual merge):`);
    for (const c of reg.conflictsAcknowledged) {
      console.log(`  - ${c.files.join(", ")}`);
      console.log(`    Agents: ${c.agents.join(", ")}`);
      console.log(`    Type: ${c.type}`);
      console.log(`    Resolution: ${c.resolution}`);
      console.log();
    }
  }
}

function cmdRegister(args) {
  const [id, branch, ...scope] = args;
  if (!id || !branch || scope.length === 0) {
    console.error("Usage: register <id> <branch> <scope-glob>...");
    process.exit(2);
  }
  const reg = readRegistry();
  // Remove if already there
  reg.agents = reg.agents.filter((a) => a.id !== id);
  reg.agents.push({
    id,
    shortname: id.slice(0, 6),
    topic: "(unknown)",
    branch,
    scope,
    spawnedAt: new Date().toISOString(),
    status: "in-flight",
  });
  writeRegistry(reg);
  log(`Registered ${id} on ${branch} with ${scope.length} scope-entries`);
}

function cmdUnregister(args) {
  const [id] = args;
  if (!id) {
    console.error("Usage: unregister <id>");
    process.exit(2);
  }
  const reg = readRegistry();
  const before = reg.agents.length;
  reg.agents = reg.agents.filter((a) => a.id !== id && a.shortname !== id);
  if (reg.agents.length === before) {
    console.error(`No agent with id/shortname ${id}`);
    process.exit(1);
  }
  writeRegistry(reg);
  log(`Unregistered ${id}`);
}

function getOpenPrs() {
  const json = sh(
    "gh pr list --state open --limit 50 --json number,title,headRefName,files,mergeStateStatus",
    { allowFail: true }
  );
  if (!json) return [];
  return JSON.parse(json);
}

function cmdConflicts() {
  const reg = readRegistry();
  const openPrs = getOpenPrs();

  console.log("\n🔍 Conflict matrix\n");

  // Build all "actors" — in-flight agents + open PRs
  const actors = [
    ...reg.agents.map((a) => ({
      kind: "agent",
      label: `Agent-${a.shortname || a.id.slice(0, 6)}`,
      branch: a.branch,
      scope: a.scope,
      topic: a.topic,
    })),
    ...openPrs.map((p) => ({
      kind: "pr",
      label: `PR-#${p.number}`,
      branch: p.headRefName,
      scope: (p.files || []).map((f) => f.path),
      topic: p.title,
      mergeState: p.mergeStateStatus,
    })),
  ];

  // Dedupe by branch (in-flight agent + their pushed PR may collide)
  const byBranch = {};
  for (const a of actors) {
    if (!byBranch[a.branch]) {
      byBranch[a.branch] = a;
    } else {
      // Prefer PR over in-flight if both exist (PR has real files)
      if (a.kind === "pr") byBranch[a.branch] = a;
    }
  }
  const uniq = Object.values(byBranch);

  // Compute pairwise overlaps
  const conflicts = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const overlaps = filesOverlap(uniq[i].scope, uniq[j].scope);
      if (overlaps.length > 0) {
        conflicts.push({
          a: uniq[i],
          b: uniq[j],
          overlaps,
        });
      }
    }
  }

  if (conflicts.length === 0) {
    console.log("  ✅ No file-overlaps detected — agents are working in non-conflicting scopes.");
    return;
  }

  console.log(`Found ${conflicts.length} pair-wise overlaps:\n`);
  for (const c of conflicts) {
    console.log(`  ${c.a.label} ↔ ${c.b.label}`);
    console.log(`    "${c.a.topic}"`);
    console.log(`    "${c.b.topic}"`);
    for (const o of c.overlaps.slice(0, 5)) {
      console.log(`    📁 ${o.a === o.b ? o.a : `${o.a} ↔ ${o.b}`}`);
    }
    if (c.overlaps.length > 5) console.log(`    📁 ... +${c.overlaps.length - 5} more`);
    console.log();
  }

  // Check against acknowledged conflicts
  if (reg.conflictsAcknowledged?.length) {
    console.log(`\nAcknowledged conflicts (already planned for):\n`);
    for (const ack of reg.conflictsAcknowledged) {
      console.log(`  ${ack.agents.join(", ")} on ${ack.files.join(", ")}`);
      console.log(`    Resolution: ${ack.resolution}`);
    }
  }
}

function cmdMergeOrder() {
  const reg = readRegistry();
  const openPrs = getOpenPrs();

  console.log("\n📐 Recommended merge order\n");

  // Build PR list
  const prs = openPrs.map((p) => ({
    number: p.number,
    branch: p.headRefName,
    title: p.title,
    files: (p.files || []).map((f) => f.path),
    mergeState: p.mergeStateStatus,
  }));

  if (prs.length === 0) {
    console.log("  (no open PRs)");
    return;
  }

  // Strategy: merge "leaf" PRs first (those that don't share files with many others)
  // Score = how many other PRs share files
  const scored = prs.map((pr) => {
    let conflictScore = 0;
    for (const other of prs) {
      if (other.number === pr.number) continue;
      const overlap = pr.files.filter((f) => other.files.includes(f));
      conflictScore += overlap.length;
    }
    return { ...pr, conflictScore };
  });

  // Sort by score ascending (least conflicts first — they're "leaves")
  scored.sort((a, b) => a.conflictScore - b.conflictScore);

  console.log("Suggested order (least-conflicting first):\n");
  scored.forEach((pr, idx) => {
    const marker =
      pr.mergeState === "CLEAN"
        ? "✅"
        : pr.mergeState === "BLOCKED"
        ? "🟡"
        : pr.mergeState === "DIRTY"
        ? "🔴"
        : "?";
    console.log(`  ${idx + 1}. ${marker} PR #${pr.number} (overlap-score: ${pr.conflictScore})`);
    console.log(`     "${pr.title.slice(0, 70)}"`);
    console.log(`     State: ${pr.mergeState}, files: ${pr.files.length}`);
    console.log();
  });

  console.log(`Total: ${scored.length} open PRs`);
  console.log(`Strategy: merge leaves first (low score). Each merge may cause higher-scored PRs to need rebase.`);
}

function cmdPoll() {
  const reg = readRegistry();
  const openPrs = getOpenPrs();

  let lastPoll = { branches: {} };
  if (fs.existsSync(LAST_POLL_PATH)) {
    try {
      lastPoll = JSON.parse(fs.readFileSync(LAST_POLL_PATH, "utf8"));
    } catch (e) {
      // ignore corrupted
    }
  }

  const events = [];
  const currentBranches = {};

  // Detect new PRs (in-flight → PR)
  for (const pr of openPrs) {
    currentBranches[pr.headRefName] = pr.number;
    if (!lastPoll.branches[pr.headRefName]) {
      const matchedAgent = reg.agents.find((a) => a.branch === pr.headRefName);
      events.push({
        type: "new-pr",
        prNumber: pr.number,
        branch: pr.headRefName,
        agent: matchedAgent?.shortname || null,
        title: pr.title,
      });
    }
  }

  // Detect PRs that merged/closed (no longer open)
  for (const [branch, prNumber] of Object.entries(lastPoll.branches)) {
    if (!currentBranches[branch]) {
      events.push({
        type: "pr-gone",
        prNumber,
        branch,
      });
    }
  }

  if (events.length === 0) {
    console.log(`📡 Poll OK — no changes since last poll.`);
  } else {
    console.log(`📡 Poll detected ${events.length} change(s):`);
    for (const e of events) {
      if (e.type === "new-pr") {
        const agentTag = e.agent ? `[${e.agent}] ` : "[?] ";
        console.log(`  🆕 ${agentTag}New PR #${e.prNumber}: ${e.title.slice(0, 70)}`);
        log(`new-pr #${e.prNumber} on ${e.branch}${e.agent ? ` (agent ${e.agent})` : ""}`);
      } else if (e.type === "pr-gone") {
        console.log(`  ✅ PR #${e.prNumber} no longer open (merged/closed)`);
        log(`pr-gone #${e.prNumber} on ${e.branch}`);
      }
    }
  }

  // Save current state
  fs.writeFileSync(
    LAST_POLL_PATH,
    JSON.stringify({ branches: currentBranches, pollAt: new Date().toISOString() }, null, 2)
  );
}

function cmdWatch() {
  console.log(`👁️  Watching for git-push events (poll every 30s)...`);
  console.log(`    Registry: ${REGISTRY_PATH}`);
  console.log(`    Log: ${LOG_PATH}`);
  console.log(`    Ctrl+C to stop\n`);
  log("watch-mode-started");
  while (true) {
    try {
      cmdPoll();
    } catch (e) {
      console.error(`Poll-error: ${e.message}`);
      log(`poll-error: ${e.message}`);
    }
    // Sleep 30s
    execSync("sleep 30");
  }
}

function cmdDiff(args) {
  const [id] = args;
  if (!id) {
    console.error("Usage: diff <id-or-shortname>");
    process.exit(2);
  }
  const reg = readRegistry();
  const agent = reg.agents.find((a) => a.id === id || a.shortname === id);
  if (!agent) {
    console.error(`No agent ${id}`);
    process.exit(1);
  }

  console.log(`\n🔬 Scope-diff for ${agent.shortname || agent.id.slice(0, 8)}\n`);
  console.log(`Branch: ${agent.branch}`);
  console.log(`Declared scope: ${agent.scope.length} entries\n`);

  // Try to get actual changed files from the branch
  const actualFiles = sh(
    `git fetch origin ${agent.branch} 2>&1 >/dev/null; git diff --name-only origin/main..origin/${agent.branch}`,
    { allowFail: true }
  );

  if (!actualFiles) {
    console.log("  (branch not pushed yet, or no diff vs main)");
    return;
  }

  const actualList = actualFiles.split("\n").filter(Boolean);
  console.log(`Actual changed files (${actualList.length}):\n`);

  for (const f of actualList) {
    const inScope = agent.scope.some((g) => globMatch(f, g));
    console.log(`  ${inScope ? "✅" : "⚠️ "} ${f}`);
  }

  const declaredButNotChanged = agent.scope.filter(
    (g) => !actualList.some((f) => globMatch(f, g))
  );
  if (declaredButNotChanged.length > 0) {
    console.log(`\nDeclared but not changed (${declaredButNotChanged.length}):`);
    for (const g of declaredButNotChanged) console.log(`  💤 ${g}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

const commands = {
  list: cmdList,
  register: cmdRegister,
  unregister: cmdUnregister,
  conflicts: cmdConflicts,
  "merge-order": cmdMergeOrder,
  diff: cmdDiff,
  poll: cmdPoll,
  watch: cmdWatch,
};

if (!cmd || cmd === "--help" || cmd === "-h" || !commands[cmd]) {
  console.log(`Usage: pm-push-control <command> [args]

Commands:
  list                                 Show active agents + scope
  register <id> <branch> <globs...>    Register in-flight agent
  unregister <id-or-shortname>         Remove agent
  conflicts                            Compute file-overlap matrix
  merge-order                          Recommend merge order
  diff <id-or-shortname>               Show declared vs actual scope
  poll                                 One-shot poll for new pushes
  watch                                Daemon-mode (poll every 30s)

Registry: /tmp/active-agents.json
Log:      /tmp/pm-push-control.log
`);
  process.exit(cmd ? 1 : 0);
}

commands[cmd](args);
