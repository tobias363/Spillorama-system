import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function handoffCount(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => /^PM_HANDOFF_.*\.md$/.test(name)).length;
}

test("pm-checkpoint --list includes active and archived handoffs", () => {
  const active = handoffCount(resolve(repoRoot, "docs", "operations"));
  const archived = handoffCount(resolve(repoRoot, "docs", "operations", "archive"));
  assert.ok(active > 0, "expected active PM_HANDOFF files");
  assert.ok(archived > 0, "expected archived PM_HANDOFF files");

  const output = run("bash", ["scripts/pm-checkpoint.sh", "--list"]);
  assert.match(output, /docs\/operations\/PM_HANDOFF_/);
  assert.match(output, /docs\/operations\/archive\/PM_HANDOFF_/);
  assert.match(output, new RegExp(`Totalt: ${active + archived} handoff-filer`));
});

test("pm-doc-absorption-gate --list covers canonical knowledge sources", () => {
  const output = run("bash", ["scripts/pm-doc-absorption-gate.sh", "--list"]);
  assert.match(output, /\[ADR\] docs\/adr\/0001-/);
  assert.match(output, /\[KNOWLEDGE_EXPORT\] docs\/operations\/PM_SESSION_KNOWLEDGE_EXPORT_/);
  assert.match(output, /\[SKILL\] \.claude\/skills\/wallet-outbox-pattern\/SKILL\.md/);
  assert.match(output, /\[PITFALLS_SECTION\] docs\/engineering\/PITFALLS_LOG\.md:/);
  assert.match(output, /\[AGENT_EXECUTION_LOG\] docs\/engineering\/AGENT_EXECUTION_LOG\.md/);
});

test("PITFALLS IDs are unique", () => {
  const output = run("node", ["scripts/check-pitfalls-ids.mjs"]);
  assert.match(output, /PITFALLS IDs valid/);
});
