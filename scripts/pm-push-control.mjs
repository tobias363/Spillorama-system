#!/usr/bin/env node
/**
 * PM Push Control — Spillorama (Phase 2)
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
 *   scope-check <branch> <file...>  Check files against agent scope (used by pre-push hook)
 *   dashboard               Generate HTML dashboard at /tmp/pm-push-control-dashboard.html
 *   notify <severity> <msg> Emit mac-notif (severity: P0|P1|P2|P3)
 *   monitor-correlate       Correlate live-monitor P0/P1 with active agents
 *
 * Options:
 *   --registry <path>       Override registry location (default: .claude/active-agents.json)
 *   --silent                Suppress non-essential output
 *
 * Registry priority:
 *   1. --registry CLI flag
 *   2. PM_PUSH_CONTROL_REGISTRY env-var
 *   3. .claude/active-agents.json (committed, persistent)
 *   4. /tmp/active-agents.json (legacy, auto-migrated to .claude if exists)
 *
 * Audit-trail: /tmp/pm-push-control.log (ephemeral per-machine log)
 *
 * Spillorama-specific:
 *   - Reads open PRs via `gh pr list`
 *   - Cross-references in-flight registry with open PRs
 *   - Catches collisions BEFORE merge
 *   - Pre-push hook can warn/block agent scope-creep
 *   - Mac-notif on macOS (graceful skip on Linux/CI)
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ─── Path resolution ────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const CANONICAL_REGISTRY = path.join(REPO_ROOT, ".claude", "active-agents.json");
const LEGACY_TMP_REGISTRY = "/tmp/active-agents.json";
const LOG_PATH = "/tmp/pm-push-control.log";
const LAST_POLL_PATH = "/tmp/pm-push-control.last-poll.json";
const DASHBOARD_PATH = "/tmp/pm-push-control-dashboard.html";
const PILOT_MONITOR_LOG = "/tmp/pilot-monitor.log";

// ─── CLI flag parsing ───────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = { silent: false, registry: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--silent") {
      flags.silent = true;
    } else if (a === "--registry") {
      flags.registry = argv[++i];
    } else if (a.startsWith("--registry=")) {
      flags.registry = a.slice("--registry=".length);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const { flags: GLOBAL_FLAGS, positional: GLOBAL_POSITIONAL } = parseFlags(
  process.argv.slice(2)
);

/**
 * Resolve registry path with priority:
 *   1. --registry CLI flag (highest)
 *   2. PM_PUSH_CONTROL_REGISTRY env-var
 *   3. .claude/active-agents.json (default — committed, persistent)
 *
 * Migration from legacy /tmp/active-agents.json is handled at first read.
 */
function resolveRegistryPath() {
  if (GLOBAL_FLAGS.registry) return path.resolve(GLOBAL_FLAGS.registry);
  if (process.env.PM_PUSH_CONTROL_REGISTRY) {
    return path.resolve(process.env.PM_PUSH_CONTROL_REGISTRY);
  }
  return CANONICAL_REGISTRY;
}

const REGISTRY_PATH = resolveRegistryPath();

// ─── Helpers ────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) {
    // ignore log-write failure (e.g. /tmp full)
  }
  if (!GLOBAL_FLAGS.silent) console.log(line.trim());
}

function info(msg) {
  if (!GLOBAL_FLAGS.silent) console.log(msg);
}

function migrateLegacyRegistryIfNeeded() {
  // If canonical doesn't exist BUT legacy does → migrate
  if (REGISTRY_PATH !== CANONICAL_REGISTRY) return; // Only migrate to canonical
  if (fs.existsSync(REGISTRY_PATH)) return; // Already migrated
  if (!fs.existsSync(LEGACY_TMP_REGISTRY)) return; // Nothing to migrate

  try {
    const content = fs.readFileSync(LEGACY_TMP_REGISTRY, "utf8");
    const parsed = JSON.parse(content);
    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    parsed.migratedFrom = LEGACY_TMP_REGISTRY;
    parsed.migratedAt = new Date().toISOString();
    fs.writeFileSync(
      REGISTRY_PATH,
      JSON.stringify(parsed, null, 2) + "\n"
    );
    log(`Migrated legacy registry from ${LEGACY_TMP_REGISTRY} → ${REGISTRY_PATH}`);
  } catch (e) {
    log(`Migration from ${LEGACY_TMP_REGISTRY} failed: ${e.message}`);
  }
}

function emptyRegistry() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    agents: [],
    conflictsAcknowledged: [],
  };
}

function readRegistry() {
  migrateLegacyRegistryIfNeeded();
  if (!fs.existsSync(REGISTRY_PATH)) {
    return emptyRegistry();
  }
  let content;
  try {
    content = fs.readFileSync(REGISTRY_PATH, "utf8");
  } catch (e) {
    log(`Registry read error at ${REGISTRY_PATH}: ${e.message}`);
    return emptyRegistry();
  }
  if (!content.trim()) {
    // Empty file — treat as new
    return emptyRegistry();
  }
  try {
    const parsed = JSON.parse(content);
    if (!parsed.version) parsed.version = 2;
    if (!parsed.agents) parsed.agents = [];
    if (!parsed.conflictsAcknowledged) parsed.conflictsAcknowledged = [];
    return parsed;
  } catch (e) {
    log(`Registry parse error at ${REGISTRY_PATH}: ${e.message}`);
    return emptyRegistry();
  }
}

function writeRegistry(reg) {
  reg.updatedAt = new Date().toISOString();
  reg.version = 2;
  // Ensure parent dir exists
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
}

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.allowFail) return "";
    throw err;
  }
}

/**
 * Match path against glob pattern.
 * Supports: single-star, double-star, exact match.
 *
 * Examples:
 *   globMatch("apps/backend/src/foo.ts", "apps/backend/[[double-star]]") -> true
 *   globMatch("apps/backend/src/foo.ts", "apps/admin-web/[[double-star]]") -> false
 *   globMatch("scripts/foo.mjs", "scripts/[[star]].mjs") -> true
 *   globMatch("scripts/sub/foo.mjs", "scripts/[[star]].mjs") -> false (single star)
 *   globMatch("scripts/sub/foo.mjs", "scripts/[[double-star]]/[[star]].mjs") -> true
 */
export function globMatch(filePath, glob) {
  if (glob === filePath) return true;
  // Convert simple glob to regex.
  //
  // Special tokens (in priority order):
  //   `**/`  → matches zero or more path segments (including no segments)
  //   `**`   → matches any path content (including slashes)
  //   `*`    → matches any non-slash characters (within a single segment)
  //
  // Escape order:
  //   1. Escape regex metacharacters EXCEPT the star (we handle * ourselves)
  //   2. Replace `**/` → DS_SLASH placeholder (consumes optional slash)
  //   3. Replace `**`  → DS placeholder
  //   4. Replace `*`   → [^/]*
  //   5. Restore DS placeholders to their regex equivalents
  const pat = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "___DOUBLESTARSLASH___")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTARSLASH___/g, "(?:.*/)?")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${pat}$`).test(filePath);
}

export function filesOverlap(files1, files2) {
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

/**
 * Check if a file is in any of the scope globs.
 */
export function fileInScope(filePath, scopeGlobs) {
  return scopeGlobs.some((g) => globMatch(filePath, g) || g === filePath);
}

// ─── Mac-notification (graceful skip on non-macOS) ──────────────────────

const SEVERITY_SOUNDS = {
  P0: "Sosumi",
  P1: "Submarine",
  P2: "Pop",
  P3: "Glass",
};

/**
 * Emit native macOS notification via osascript.
 * Returns { delivered: bool, reason: string }.
 * Graceful skip on non-macOS or if osascript fails.
 */
export function macNotify(severity, message, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== "darwin") {
    return { delivered: false, reason: "non-macOS platform" };
  }
  const sound = SEVERITY_SOUNDS[severity] || "Glass";
  const title = `PM Push-Control ${severity}`;
  // Escape double-quotes in message for osascript
  const safeMsg = String(message).replace(/"/g, '\\"').slice(0, 200);
  const safeTitle = title.replace(/"/g, '\\"');
  const script = `display notification "${safeMsg}" with title "${safeTitle}" sound name "${sound}"`;
  try {
    sh(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { allowFail: false });
    log(`mac-notif ${severity}: ${message.slice(0, 100)}`);
    return { delivered: true, reason: "ok" };
  } catch (e) {
    return { delivered: false, reason: e.message };
  }
}

// ─── Commands ───────────────────────────────────────────────────────────

function cmdList() {
  const reg = readRegistry();
  info(`\n📋 Active agents (${reg.agents.length})`);
  info(`Registry: ${REGISTRY_PATH}`);
  info(`Updated: ${reg.updatedAt}\n`);

  if (reg.agents.length === 0) {
    info("  (none)");
    return;
  }

  for (const a of reg.agents) {
    info(`  [${a.shortname || a.id.slice(0, 8)}] ${a.status.padEnd(12)} ${a.topic}`);
    info(`         Branch: ${a.branch}`);
    info(`         Scope:  ${a.scope.length} files/globs`);
    a.scope.slice(0, 3).forEach((s) => info(`           - ${s}`));
    if (a.scope.length > 3) info(`           - ... +${a.scope.length - 3} more`);
    info("");
  }

  // Acknowledged conflicts
  if (reg.conflictsAcknowledged?.length) {
    info(`\n⚠️  Acknowledged conflicts (will need manual merge):`);
    for (const c of reg.conflictsAcknowledged) {
      info(`  - ${c.files.join(", ")}`);
      info(`    Agents: ${c.agents.join(", ")}`);
      info(`    Type: ${c.type}`);
      info(`    Resolution: ${c.resolution}`);
      info("");
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
  try {
    return JSON.parse(json);
  } catch (e) {
    log(`getOpenPrs parse error: ${e.message}`);
    return [];
  }
}

function cmdConflicts() {
  const reg = readRegistry();
  const openPrs = getOpenPrs();

  info("\n🔍 Conflict matrix\n");

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

  const byBranch = {};
  for (const a of actors) {
    if (!byBranch[a.branch]) {
      byBranch[a.branch] = a;
    } else {
      if (a.kind === "pr") byBranch[a.branch] = a;
    }
  }
  const uniq = Object.values(byBranch);

  const conflicts = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const overlaps = filesOverlap(uniq[i].scope, uniq[j].scope);
      if (overlaps.length > 0) {
        conflicts.push({ a: uniq[i], b: uniq[j], overlaps });
      }
    }
  }

  if (conflicts.length === 0) {
    info("  ✅ No file-overlaps detected — agents are working in non-conflicting scopes.");
    return { conflicts: [] };
  }

  info(`Found ${conflicts.length} pair-wise overlaps:\n`);
  for (const c of conflicts) {
    info(`  ${c.a.label} ↔ ${c.b.label}`);
    info(`    "${c.a.topic}"`);
    info(`    "${c.b.topic}"`);
    for (const o of c.overlaps.slice(0, 5)) {
      info(`    📁 ${o.a === o.b ? o.a : `${o.a} ↔ ${o.b}`}`);
    }
    if (c.overlaps.length > 5) info(`    📁 ... +${c.overlaps.length - 5} more`);
    info("");
  }

  if (reg.conflictsAcknowledged?.length) {
    info(`\nAcknowledged conflicts (already planned for):\n`);
    for (const ack of reg.conflictsAcknowledged) {
      info(`  ${ack.agents.join(", ")} on ${ack.files.join(", ")}`);
      info(`    Resolution: ${ack.resolution}`);
    }
  }
  return { conflicts };
}

function cmdMergeOrder() {
  const openPrs = getOpenPrs();

  info("\n📐 Recommended merge order\n");

  const prs = openPrs.map((p) => ({
    number: p.number,
    branch: p.headRefName,
    title: p.title,
    files: (p.files || []).map((f) => f.path),
    mergeState: p.mergeStateStatus,
  }));

  if (prs.length === 0) {
    info("  (no open PRs)");
    return [];
  }

  const scored = prs.map((pr) => {
    let conflictScore = 0;
    for (const other of prs) {
      if (other.number === pr.number) continue;
      const overlap = pr.files.filter((f) => other.files.includes(f));
      conflictScore += overlap.length;
    }
    return { ...pr, conflictScore };
  });

  scored.sort((a, b) => a.conflictScore - b.conflictScore);

  info("Suggested order (least-conflicting first):\n");
  scored.forEach((pr, idx) => {
    const marker =
      pr.mergeState === "CLEAN"
        ? "✅"
        : pr.mergeState === "BLOCKED"
        ? "🟡"
        : pr.mergeState === "DIRTY"
        ? "🔴"
        : "?";
    info(`  ${idx + 1}. ${marker} PR #${pr.number} (overlap-score: ${pr.conflictScore})`);
    info(`     "${pr.title.slice(0, 70)}"`);
    info(`     State: ${pr.mergeState}, files: ${pr.files.length}`);
    info("");
  });

  info(`Total: ${scored.length} open PRs`);
  info(`Strategy: merge leaves first (low score). Each merge may cause higher-scored PRs to need rebase.`);
  return scored;
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
        mergeState: pr.mergeStateStatus,
      });
    }
  }

  for (const [branch, prNumber] of Object.entries(lastPoll.branches)) {
    if (!currentBranches[branch]) {
      events.push({ type: "pr-gone", prNumber, branch });
    }
  }

  if (events.length === 0) {
    info(`📡 Poll OK — no changes since last poll.`);
  } else {
    info(`📡 Poll detected ${events.length} change(s):`);
    for (const e of events) {
      if (e.type === "new-pr") {
        const agentTag = e.agent ? `[${e.agent}] ` : "[?] ";
        info(`  🆕 ${agentTag}New PR #${e.prNumber}: ${e.title.slice(0, 70)}`);
        log(`new-pr #${e.prNumber} on ${e.branch}${e.agent ? ` (agent ${e.agent})` : ""}`);
        // Mac-notif for new PR — severity P3 (info)
        const severity = e.mergeState === "DIRTY" || e.mergeState === "BLOCKED" ? "P1" : "P3";
        macNotify(severity, `New PR #${e.prNumber}: ${e.title.slice(0, 80)}`);
      } else if (e.type === "pr-gone") {
        info(`  ✅ PR #${e.prNumber} no longer open (merged/closed)`);
        log(`pr-gone #${e.prNumber} on ${e.branch}`);
      }
    }

    // After poll: re-check conflicts. If any → P1 notif.
    try {
      const { conflicts } = cmdConflicts() || { conflicts: [] };
      if (conflicts.length > 0) {
        macNotify(
          "P1",
          `${conflicts.length} conflict(s) detected — run 'pm-push-control conflicts'`
        );
      }
    } catch (e) {
      log(`Post-poll conflict-check failed: ${e.message}`);
    }
  }

  fs.writeFileSync(
    LAST_POLL_PATH,
    JSON.stringify({ branches: currentBranches, pollAt: new Date().toISOString() }, null, 2)
  );
}

function cmdWatch() {
  info(`👁️  Watching for git-push events (poll every 30s)...`);
  info(`    Registry: ${REGISTRY_PATH}`);
  info(`    Log: ${LOG_PATH}`);
  info(`    Ctrl+C to stop\n`);
  log("watch-mode-started");
  while (true) {
    try {
      cmdPoll();
    } catch (e) {
      console.error(`Poll-error: ${e.message}`);
      log(`poll-error: ${e.message}`);
    }
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

  info(`\n🔬 Scope-diff for ${agent.shortname || agent.id.slice(0, 8)}\n`);
  info(`Branch: ${agent.branch}`);
  info(`Declared scope: ${agent.scope.length} entries\n`);

  const actualFiles = sh(
    `git fetch origin ${agent.branch} 2>&1 >/dev/null; git diff --name-only origin/main..origin/${agent.branch}`,
    { allowFail: true }
  );

  if (!actualFiles) {
    info("  (branch not pushed yet, or no diff vs main)");
    return;
  }

  const actualList = actualFiles.split("\n").filter(Boolean);
  info(`Actual changed files (${actualList.length}):\n`);

  for (const f of actualList) {
    const inScope = agent.scope.some((g) => globMatch(f, g));
    info(`  ${inScope ? "✅" : "⚠️ "} ${f}`);
  }

  const declaredButNotChanged = agent.scope.filter(
    (g) => !actualList.some((f) => globMatch(f, g))
  );
  if (declaredButNotChanged.length > 0) {
    info(`\nDeclared but not changed (${declaredButNotChanged.length}):`);
    for (const g of declaredButNotChanged) info(`  💤 ${g}`);
  }
}

/**
 * Pre-push hook helper: check if files in a push fit the agent's declared scope.
 *
 * Used by .husky/pre-push-agent-scope-check.sh.
 *
 * Usage: pm-push-control.mjs scope-check <branch> <file1> [<file2>...]
 *
 * Exit codes:
 *   0 — branch not registered (not an agent) OR all files in scope
 *   1 — out-of-scope files detected; warning printed (does NOT block by default)
 *   2 — usage error
 *
 * Strict mode: set env-var PM_PUSH_STRICT_SCOPE=1 to make exit 1 ABORT the push.
 * Without strict mode, exit 1 just warns the agent.
 */
function cmdScopeCheck(args) {
  const [branch, ...files] = args;
  if (!branch) {
    console.error("Usage: scope-check <branch> <file>... (or read from stdin if no files)");
    process.exit(2);
  }

  let fileList = files;
  // If no files provided, read newline-separated paths from stdin
  if (fileList.length === 0) {
    try {
      const stdin = fs.readFileSync(0, "utf8");
      fileList = stdin.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch (e) {
      // No stdin — nothing to check
    }
  }

  const reg = readRegistry();
  const agent = reg.agents.find((a) => a.branch === branch);

  if (!agent) {
    // Not a registered agent branch — pass silently
    info(`(branch ${branch} not registered as in-flight agent — no scope to check)`);
    process.exit(0);
  }

  if (fileList.length === 0) {
    info(`(no files to check for ${agent.shortname || agent.id})`);
    process.exit(0);
  }

  const outOfScope = [];
  for (const f of fileList) {
    if (!fileInScope(f, agent.scope)) {
      outOfScope.push(f);
    }
  }

  if (outOfScope.length === 0) {
    info(
      `✅ All ${fileList.length} file(s) within declared scope for ${agent.shortname || agent.id}`
    );
    process.exit(0);
  }

  const isStrict = process.env.PM_PUSH_STRICT_SCOPE === "1";
  const tag = isStrict ? "ABORT" : "WARN";

  console.error(`\n⚠️  PM PUSH-CONTROL ${tag} — scope-creep detected\n`);
  console.error(`  Agent:  ${agent.shortname || agent.id} (${agent.topic})`);
  console.error(`  Branch: ${agent.branch}`);
  console.error(`  Declared scope (${agent.scope.length}):`);
  for (const g of agent.scope.slice(0, 5)) console.error(`    - ${g}`);
  if (agent.scope.length > 5) console.error(`    - ... +${agent.scope.length - 5}`);
  console.error(`\n  Out-of-scope files (${outOfScope.length}):`);
  for (const f of outOfScope.slice(0, 10)) console.error(`    ⚠️  ${f}`);
  if (outOfScope.length > 10) console.error(`    ⚠️  ... +${outOfScope.length - 10} more`);
  console.error(``);

  log(
    `scope-check ${tag} ${agent.shortname || agent.id}: ${outOfScope.length}/${fileList.length} out-of-scope on ${branch}`
  );

  // Best-effort mac-notif for scope-creep — P2 by default
  macNotify(
    "P2",
    `Scope-creep: ${agent.shortname || agent.id} pushing ${outOfScope.length} out-of-scope file(s) to ${branch}`
  );

  if (isStrict) {
    console.error("  PM_PUSH_STRICT_SCOPE=1 — push BLOCKED.\n");
    process.exit(1);
  } else {
    console.error("  PM_PUSH_STRICT_SCOPE not set — push allowed (warning only).");
    console.error("  Set PM_PUSH_STRICT_SCOPE=1 to enforce.\n");
    process.exit(0);
  }
}

function cmdDashboard() {
  const reg = readRegistry();
  const openPrs = getOpenPrs();
  const conflictsResult = (() => {
    try {
      return cmdConflicts();
    } catch (e) {
      return { conflicts: [] };
    }
  })();
  const mergeOrder = (() => {
    try {
      return cmdMergeOrder();
    } catch (e) {
      return [];
    }
  })();

  // Read last 10 push events from log
  let recentEvents = [];
  if (fs.existsSync(LOG_PATH)) {
    try {
      const lines = fs.readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean);
      recentEvents = lines.slice(-15).reverse();
    } catch (e) {
      // ignore
    }
  }

  const html = renderDashboardHtml({
    reg,
    openPrs,
    conflicts: conflictsResult.conflicts || [],
    mergeOrder,
    recentEvents,
  });

  fs.writeFileSync(DASHBOARD_PATH, html);
  info(`✅ Dashboard generated: ${DASHBOARD_PATH}`);
  info(`   Open with:  open ${DASHBOARD_PATH}`);
  info(`   Auto-refresh: 30s`);
  return DASHBOARD_PATH;
}

function renderDashboardHtml({ reg, openPrs, conflicts, mergeOrder, recentEvents }) {
  const ts = new Date().toISOString();
  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const agentRows = reg.agents
    .map(
      (a) => `
    <tr>
      <td><code>${escapeHtml(a.shortname || a.id.slice(0, 8))}</code></td>
      <td><span class="status ${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td>
      <td>${escapeHtml(a.topic)}</td>
      <td><code>${escapeHtml(a.branch)}</code></td>
      <td>${a.scope.length}</td>
      <td title="${escapeHtml(a.spawnedAt)}">${new Date(a.spawnedAt).toLocaleTimeString()}</td>
    </tr>`
    )
    .join("");

  const prRows = mergeOrder
    .map((pr, idx) => {
      const stateClass = pr.mergeState === "CLEAN" ? "ok" : pr.mergeState === "DIRTY" ? "bad" : "warn";
      return `
    <tr>
      <td>${idx + 1}</td>
      <td><a href="https://github.com/tobias363/Spillorama-system/pull/${pr.number}" target="_blank">#${pr.number}</a></td>
      <td>${escapeHtml(pr.title.slice(0, 80))}</td>
      <td><span class="state ${stateClass}">${escapeHtml(pr.mergeState)}</span></td>
      <td>${pr.conflictScore}</td>
      <td>${pr.files.length}</td>
    </tr>`;
    })
    .join("");

  const conflictBlocks = conflicts.length === 0
    ? `<p class="empty">✅ No file-overlaps detected</p>`
    : conflicts
        .map(
          (c) => `
    <div class="conflict-card">
      <div class="conflict-pair">${escapeHtml(c.a.label)} ↔ ${escapeHtml(c.b.label)}</div>
      <div class="conflict-topics">
        <div>"${escapeHtml(c.a.topic)}"</div>
        <div>"${escapeHtml(c.b.topic)}"</div>
      </div>
      <div class="conflict-files">
        ${c.overlaps
          .slice(0, 5)
          .map((o) => `<code>${escapeHtml(o.a === o.b ? o.a : `${o.a} ↔ ${o.b}`)}</code>`)
          .join("")}
        ${c.overlaps.length > 5 ? `<span class="more">+${c.overlaps.length - 5}</span>` : ""}
      </div>
    </div>`
        )
        .join("");

  const eventLis = recentEvents.map((e) => `<li><code>${escapeHtml(e)}</code></li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PM Push-Control Dashboard — Spillorama</title>
<meta http-equiv="refresh" content="30">
<style>
  :root {
    --bg: #0a0e1a;
    --bg-card: #131826;
    --bg-elev: #1a2030;
    --fg: #d8e2ee;
    --fg-dim: #8593a8;
    --accent: #6ab1ff;
    --ok: #4ade80;
    --warn: #fbbf24;
    --bad: #f87171;
    --border: #243049;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 24px; line-height: 1.5; }
  h1 { margin: 0 0 8px; color: var(--accent); font-size: 24px; }
  h2 { margin: 24px 0 12px; font-size: 18px; color: var(--fg); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .meta { color: var(--fg-dim); font-size: 13px; margin-bottom: 24px; }
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; background: var(--bg-elev); color: var(--fg-dim); font-weight: 600; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  code { font-family: "SF Mono", Menlo, monospace; font-size: 12px; color: var(--accent); background: var(--bg-elev); padding: 2px 6px; border-radius: 3px; }
  .status { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .status.in-flight { background: rgba(106, 177, 255, 0.15); color: var(--accent); }
  .status.delivered { background: rgba(74, 222, 128, 0.15); color: var(--ok); }
  .status.merged { background: rgba(132, 132, 132, 0.2); color: var(--fg-dim); }
  .state { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .state.ok { background: rgba(74, 222, 128, 0.15); color: var(--ok); }
  .state.warn { background: rgba(251, 191, 36, 0.15); color: var(--warn); }
  .state.bad { background: rgba(248, 113, 113, 0.15); color: var(--bad); }
  .empty { color: var(--ok); font-style: italic; }
  .conflict-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
  .conflict-pair { font-weight: 600; color: var(--warn); margin-bottom: 4px; }
  .conflict-topics { color: var(--fg-dim); font-size: 12px; margin-bottom: 8px; }
  .conflict-files { display: flex; flex-wrap: wrap; gap: 6px; }
  .conflict-files .more { color: var(--fg-dim); font-size: 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  ul li { padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  ul li:last-child { border-bottom: none; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-cell { background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .summary-cell .label { color: var(--fg-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-cell .value { color: var(--fg); font-size: 28px; font-weight: 700; }
  .summary-cell.warn .value { color: var(--warn); }
  .summary-cell.bad .value { color: var(--bad); }
</style>
</head>
<body>
  <h1>📊 PM Push-Control Dashboard</h1>
  <p class="meta">Spillorama · Generated ${escapeHtml(ts)} · Auto-refresh: 30s</p>

  <div class="summary-grid">
    <div class="summary-cell">
      <div class="label">Active agents</div>
      <div class="value">${reg.agents.length}</div>
    </div>
    <div class="summary-cell">
      <div class="label">Open PRs</div>
      <div class="value">${openPrs.length}</div>
    </div>
    <div class="summary-cell ${conflicts.length > 0 ? "warn" : ""}">
      <div class="label">Conflicts</div>
      <div class="value">${conflicts.length}</div>
    </div>
    <div class="summary-cell ${mergeOrder.filter((p) => p.mergeState === "DIRTY").length > 0 ? "bad" : ""}">
      <div class="label">Dirty PRs</div>
      <div class="value">${mergeOrder.filter((p) => p.mergeState === "DIRTY").length}</div>
    </div>
  </div>

  <h2>Active agents</h2>
  <div class="card">
    ${reg.agents.length === 0
      ? '<p class="empty">No active agents</p>'
      : `<table>
        <thead><tr><th>Short</th><th>Status</th><th>Topic</th><th>Branch</th><th>Scope</th><th>Spawned</th></tr></thead>
        <tbody>${agentRows}</tbody>
      </table>`}
  </div>

  <h2>Open PRs (sorted by merge-order)</h2>
  <div class="card">
    ${openPrs.length === 0
      ? '<p class="empty">No open PRs</p>'
      : `<table>
        <thead><tr><th>#</th><th>PR</th><th>Title</th><th>State</th><th>Overlap</th><th>Files</th></tr></thead>
        <tbody>${prRows}</tbody>
      </table>`}
  </div>

  <h2>Conflict matrix</h2>
  <div class="card">${conflictBlocks}</div>

  <h2>Recent push-events (last 15)</h2>
  <div class="card">
    ${recentEvents.length === 0
      ? '<p class="empty">No events yet</p>'
      : `<ul>${eventLis}</ul>`}
  </div>
</body>
</html>
`;
}

function cmdNotify(args) {
  const [severity, ...rest] = args;
  if (!severity || rest.length === 0) {
    console.error("Usage: notify <P0|P1|P2|P3> <message>");
    process.exit(2);
  }
  const message = rest.join(" ");
  const result = macNotify(severity, message);
  if (result.delivered) {
    info(`✅ Notification sent (${severity})`);
  } else {
    info(`⏭️  Notification skipped: ${result.reason}`);
  }
}

/**
 * Correlate live-monitor events with active agents.
 * Reads /tmp/pilot-monitor.log, finds P0/P1 events from last 5 min,
 * checks if any active agent's scope overlaps with files mentioned in the event.
 */
function cmdMonitorCorrelate() {
  info("\n🔗 Live-monitor correlation\n");

  if (!fs.existsSync(PILOT_MONITOR_LOG)) {
    info(`  (no live-monitor log at ${PILOT_MONITOR_LOG})`);
    info(`  TODO: live-monitor integration awaits B1 — design ready, no events yet`);
    return;
  }

  const reg = readRegistry();
  if (reg.agents.length === 0) {
    info("  (no active agents to correlate)");
    return;
  }

  let logContent;
  try {
    logContent = fs.readFileSync(PILOT_MONITOR_LOG, "utf8");
  } catch (e) {
    info(`  Failed to read monitor log: ${e.message}`);
    return;
  }

  const lines = logContent.split("\n").filter(Boolean);
  const recentLines = lines.slice(-200);

  // Parse P0/P1 markers (heuristic — actual format defined by B1)
  const events = [];
  for (const line of recentLines) {
    const severityMatch = line.match(/\b(P0|P1)\b/);
    if (!severityMatch) continue;
    const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    const ts = tsMatch ? tsMatch[1] : null;
    // Heuristic file-extraction: anything that looks like a path
    const fileMatches = [...line.matchAll(/[\w./_-]+\.(?:ts|tsx|js|mjs|json|md|yml|yaml|sh|sql)/g)].map(
      (m) => m[0]
    );
    events.push({ severity: severityMatch[1], ts, files: fileMatches, line });
  }

  if (events.length === 0) {
    info("  (no recent P0/P1 events in monitor log)");
    return;
  }

  let correlated = 0;
  for (const event of events) {
    const matchingAgents = reg.agents.filter((a) =>
      event.files.some((f) => fileInScope(f, a.scope))
    );
    if (matchingAgents.length > 0) {
      correlated++;
      info(`\n  ⚠️  ${event.severity} event correlates with active agent(s)`);
      info(`     Event: ${event.line.slice(0, 100)}`);
      info(`     Files: ${event.files.join(", ")}`);
      info(`     Agents:`);
      for (const a of matchingAgents) {
        info(`       - ${a.shortname || a.id}: ${a.topic}`);
      }
      log(
        `monitor-correlate ${event.severity} → agents=${matchingAgents.map((a) => a.shortname).join(",")}`
      );
    }
  }

  if (correlated === 0) {
    info(`  ✅ ${events.length} P0/P1 event(s) found but none correlate with active agents`);
  } else {
    info(`\n  Found ${correlated} correlation(s) — agents may need to investigate`);
    macNotify(
      "P1",
      `${correlated} live-monitor event(s) correlate with active agent code`
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

const commands = {
  list: cmdList,
  register: cmdRegister,
  unregister: cmdUnregister,
  conflicts: cmdConflicts,
  "merge-order": cmdMergeOrder,
  diff: cmdDiff,
  poll: cmdPoll,
  watch: cmdWatch,
  "scope-check": cmdScopeCheck,
  dashboard: cmdDashboard,
  notify: cmdNotify,
  "monitor-correlate": cmdMonitorCorrelate,
};

function printUsage() {
  console.log(`Usage: pm-push-control [--registry <path>] [--silent] <command> [args]

Commands:
  list                                 Show active agents + scope
  register <id> <branch> <globs...>    Register in-flight agent
  unregister <id-or-shortname>         Remove agent
  conflicts                            Compute file-overlap matrix
  merge-order                          Recommend merge order
  diff <id-or-shortname>               Show declared vs actual scope
  poll                                 One-shot poll for new pushes (+ mac-notif)
  watch                                Daemon-mode (poll every 30s)
  scope-check <branch> [<files...>]    Check files against agent scope (pre-push hook)
  dashboard                            Generate HTML dashboard
  notify <severity> <message>          Emit mac-notif (P0|P1|P2|P3)
  monitor-correlate                    Correlate live-monitor events with active agents

Options:
  --registry <path>                    Override registry location (default: .claude/active-agents.json)
  --silent                             Suppress non-essential output

Registry: ${REGISTRY_PATH}
Log:      ${LOG_PATH}
`);
}

// Only dispatch on direct invocation, not on import. ESM:
//   - import.meta.url === pathToFileURL(process.argv[1]).href when run directly.
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("pm-push-control.mjs");

if (isDirectInvocation) {
  const cmd = GLOBAL_POSITIONAL[0];
  const args = GLOBAL_POSITIONAL.slice(1);

  if (!cmd || cmd === "--help" || cmd === "-h" || !commands[cmd]) {
    printUsage();
    process.exit(cmd ? 1 : 0);
  }

  commands[cmd](args);
}
