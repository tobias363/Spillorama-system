import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
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

test("pm-knowledge-continuity generates evidence pack and self-test template", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-knowledge-continuity-"));
  try {
    const pack = join(dir, "pack.md");
    const selfTest = join(dir, "self-test.md");

    const packOutput = run("node", [
      "scripts/pm-knowledge-continuity.mjs",
      "--generate-pack",
      "--output",
      pack,
    ]);
    assert.match(packOutput, /Wrote /);

    const packText = readFileSync(pack, "utf8");
    assert.match(packText, /# PM Knowledge Continuity Evidence Pack/);
    assert.match(packText, /## Latest PM Handoff/);
    assert.match(packText, /## Top PM Self-Test Questions/);

    const templateOutput = run("node", [
      "scripts/pm-knowledge-continuity.mjs",
      "--self-test-template",
      "--pack",
      pack,
      "--output",
      selfTest,
    ]);
    assert.match(templateOutput, /Wrote /);

    const templateText = readFileSync(selfTest, "utf8");
    assert.match(templateText, /# PM Knowledge Continuity Self-Test/);
    assert.match(templateText, /### Q1\./);
    assert.match(templateText, /\*\*Answer:\*\* TODO/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pm-knowledge-continuity rejects placeholders and accepts concrete answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-knowledge-continuity-"));
  try {
    const pack = join(dir, "pack.md");
    const selfTest = join(dir, "self-test.md");
    const valid = join(dir, "valid-self-test.md");

    run("node", ["scripts/pm-knowledge-continuity.mjs", "--generate-pack", "--output", pack]);
    run("node", [
      "scripts/pm-knowledge-continuity.mjs",
      "--self-test-template",
      "--pack",
      pack,
      "--output",
      selfTest,
    ]);

    let rejected = false;
    try {
      run("node", ["scripts/pm-knowledge-continuity.mjs", "--validate-self-test", selfTest]);
    } catch (error) {
      rejected = true;
      assert.match(error.stderr.toString(), /Self-test validation failed/);
    }
    assert.equal(rejected, true, "template with TODO answers must be rejected");

    const templateText = readFileSync(selfTest, "utf8");
    const answers = Array.from({ length: 12 }, (_, index) => {
      return `**Answer:** Svar ${index + 1} viser konkret operativ forståelse fra evidence pack, siste handoff, knowledge export, PITFALLS, skills, observability og git-state før første kodehandling.`;
    });
    let answerIndex = 0;
    const validText = templateText.replace(/\*\*Answer:\*\* TODO/g, () => answers[answerIndex++]);
    writeFileSync(valid, validText);

    const output = run("node", ["scripts/pm-knowledge-continuity.mjs", "--validate-self-test", valid]);
    assert.match(output, /Self-test valid \(12 answers\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
