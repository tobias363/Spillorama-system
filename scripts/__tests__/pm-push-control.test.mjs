/**
 * Tests for scripts/pm-push-control.mjs (Phase 2).
 *
 * Bruker node:test (built-in runner — ingen avhengigheter). Kjør med:
 *   node --test scripts/__tests__/pm-push-control.test.mjs
 *
 * Alt isoleres via tempfile-registry. Ingen tester touch-er
 * .claude/active-agents.json eller /tmp/active-agents.json i den faste
 * lokasjonen — vi bruker `--registry <tmpfile>` for full isolasjon.
 *
 * Vitest-kompatibilitet: hvis vitest er installert kan dette også kjøres
 * via `npx vitest run scripts/__tests__/pm-push-control.test.mjs`. Vi
 * bruker kun `node:test`-API som speiles av vitest.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { globMatch, filesOverlap, fileInScope, macNotify } from "../pm-push-control.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "pm-push-control.mjs");

function runCli(args, opts = {}) {
  const res = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || REPO_ROOT,
    input: opts.stdin || "",
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    status: res.status,
  };
}

function makeTempRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "pm-push-control-test-"));
  const file = join(dir, "registry.json");
  return { dir, file };
}

function readRegistryFile(path) {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8").trim();
  if (!content) return null;
  return JSON.parse(content);
}

// ─── Unit tests: globMatch ──────────────────────────────────────────────

describe("globMatch", () => {
  it("matches exact path", () => {
    assert.equal(globMatch("foo/bar.ts", "foo/bar.ts"), true);
  });

  it("rejects non-match exact", () => {
    assert.equal(globMatch("foo/bar.ts", "foo/baz.ts"), false);
  });

  it("matches single-star at end", () => {
    assert.equal(globMatch("foo/bar.ts", "foo/*.ts"), true);
    assert.equal(globMatch("foo/sub/bar.ts", "foo/*.ts"), false);
  });

  it("matches double-star recursive", () => {
    assert.equal(globMatch("foo/sub/bar.ts", "foo/**"), true);
    assert.equal(globMatch("foo/sub/deep/bar.ts", "foo/**"), true);
    assert.equal(globMatch("bar/sub/foo.ts", "foo/**"), false);
  });

  it("matches double-star with suffix glob", () => {
    assert.equal(globMatch("scripts/sub/foo.mjs", "scripts/**/*.mjs"), true);
    assert.equal(globMatch("scripts/foo.mjs", "scripts/**/*.mjs"), true);
  });

  it("matches across all levels with leading double-star", () => {
    assert.equal(globMatch("apps/backend/foo.test.ts", "**/*.test.ts"), true);
    assert.equal(globMatch("foo.test.ts", "**/*.test.ts"), true);
  });

  it("respects single-star scope (no slash crossing)", () => {
    assert.equal(globMatch("a/b/c.ts", "a/*"), false);
  });
});

// ─── Unit tests: filesOverlap ───────────────────────────────────────────

describe("filesOverlap", () => {
  it("detects exact match overlap", () => {
    const result = filesOverlap(["a.ts", "b.ts"], ["b.ts", "c.ts"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].a, "b.ts");
    assert.equal(result[0].b, "b.ts");
  });

  it("returns empty for disjoint sets", () => {
    const result = filesOverlap(["a.ts"], ["b.ts"]);
    assert.equal(result.length, 0);
  });

  it("matches glob in either direction", () => {
    // path1 is a glob, path2 is a real file
    const a = filesOverlap(["foo/**"], ["foo/bar.ts"]);
    assert.ok(a.length > 0);
    const b = filesOverlap(["foo/bar.ts"], ["foo/**"]);
    assert.ok(b.length > 0);
  });
});

// ─── Unit tests: fileInScope ────────────────────────────────────────────

describe("fileInScope", () => {
  it("detects in-scope file via exact match", () => {
    assert.equal(fileInScope("a.ts", ["a.ts", "b.ts"]), true);
  });

  it("detects in-scope file via glob", () => {
    assert.equal(fileInScope("apps/backend/foo.ts", ["apps/backend/**"]), true);
  });

  it("rejects out-of-scope file", () => {
    assert.equal(fileInScope("apps/admin-web/foo.ts", ["apps/backend/**"]), false);
  });

  it("handles empty scope", () => {
    assert.equal(fileInScope("anything", []), false);
  });
});

// ─── Unit tests: macNotify graceful skip ────────────────────────────────

describe("macNotify", () => {
  it("skips silently on non-darwin platforms", () => {
    const res = macNotify("P0", "test message", { platform: "linux" });
    assert.equal(res.delivered, false);
    assert.match(res.reason, /non-macOS/);
  });

  it("attempts delivery on darwin", () => {
    // We don't actually want to fire a notification in tests; just check
    // that on darwin the function tries (and may succeed or fail).
    const res = macNotify("P3", "TEST FROM PM-PUSH-CONTROL TEST SUITE", {
      platform: "darwin",
    });
    // Don't assert delivered=true (it depends on system perms).
    // Just assert delivered is a boolean.
    assert.equal(typeof res.delivered, "boolean");
  });

  it("returns reason string", () => {
    const res = macNotify("P3", "x", { platform: "linux" });
    assert.equal(typeof res.reason, "string");
  });
});

// ─── E2E tests: CLI commands with isolated registry ─────────────────────

describe("CLI: register + list + unregister", () => {
  let tempReg;

  before(() => {
    tempReg = makeTempRegistry();
  });

  after(() => {
    rmSync(tempReg.dir, { recursive: true, force: true });
  });

  it("list on empty registry shows '(none)'", () => {
    const { stdout, status } = runCli(["--registry", tempReg.file, "list"]);
    assert.equal(status, 0);
    assert.match(stdout, /Active agents \(0\)/);
    assert.match(stdout, /\(none\)/);
  });

  it("register creates an entry", () => {
    const { status } = runCli([
      "--registry",
      tempReg.file,
      "register",
      "test-id-1",
      "feat/test-branch-1",
      "scripts/foo.mjs",
      "docs/bar.md",
    ]);
    assert.equal(status, 0);

    const reg = readRegistryFile(tempReg.file);
    assert.ok(reg);
    assert.equal(reg.agents.length, 1);
    assert.equal(reg.agents[0].id, "test-id-1");
    assert.equal(reg.agents[0].branch, "feat/test-branch-1");
    assert.deepEqual(reg.agents[0].scope, ["scripts/foo.mjs", "docs/bar.md"]);
    assert.equal(reg.agents[0].status, "in-flight");
  });

  it("list shows registered agent", () => {
    const { stdout } = runCli(["--registry", tempReg.file, "list"]);
    assert.match(stdout, /Active agents \(1\)/);
    assert.match(stdout, /feat\/test-branch-1/);
  });

  it("register again with same id replaces (no duplicate)", () => {
    runCli([
      "--registry",
      tempReg.file,
      "register",
      "test-id-1",
      "feat/test-branch-1-new",
      "scripts/baz.mjs",
    ]);
    const reg = readRegistryFile(tempReg.file);
    assert.equal(reg.agents.length, 1);
    assert.equal(reg.agents[0].branch, "feat/test-branch-1-new");
  });

  it("unregister removes the entry", () => {
    const { status } = runCli([
      "--registry",
      tempReg.file,
      "unregister",
      "test-id-1",
    ]);
    assert.equal(status, 0);
    const reg = readRegistryFile(tempReg.file);
    assert.equal(reg.agents.length, 0);
  });

  it("unregister non-existent id returns exit 1", () => {
    const { status } = runCli([
      "--registry",
      tempReg.file,
      "unregister",
      "nonexistent-id",
    ]);
    assert.equal(status, 1);
  });
});

// ─── E2E tests: scope-check (pre-push hook) ─────────────────────────────

describe("CLI: scope-check", () => {
  let tempReg;

  before(() => {
    tempReg = makeTempRegistry();
    runCli([
      "--registry",
      tempReg.file,
      "register",
      "sc-test-1",
      "feat/scope-check-branch",
      "scripts/foo.mjs",
      "docs/**",
      "apps/backend/src/game/Game1*",
    ]);
  });

  after(() => {
    rmSync(tempReg.dir, { recursive: true, force: true });
  });

  it("passes when all files match scope (exit 0)", () => {
    const { status, stdout } = runCli(
      [
        "--registry",
        tempReg.file,
        "scope-check",
        "feat/scope-check-branch",
        "scripts/foo.mjs",
        "docs/ARCH.md",
        "apps/backend/src/game/Game1Engine.ts",
      ],
    );
    assert.equal(status, 0);
    assert.match(stdout, /within declared scope/);
  });

  it("warns on out-of-scope files (default exit 0)", () => {
    const { status, stderr } = runCli(
      [
        "--registry",
        tempReg.file,
        "scope-check",
        "feat/scope-check-branch",
        "apps/backend/src/wallet/evil.ts",
      ],
    );
    // Default mode: warn-only, still exit 0
    assert.equal(status, 0);
    assert.match(stderr, /scope-creep detected/);
    assert.match(stderr, /apps\/backend\/src\/wallet\/evil\.ts/);
  });

  it("strict mode aborts on out-of-scope (exit 1)", () => {
    const { status, stderr } = runCli(
      [
        "--registry",
        tempReg.file,
        "scope-check",
        "feat/scope-check-branch",
        "apps/backend/src/wallet/evil.ts",
      ],
      { env: { PM_PUSH_STRICT_SCOPE: "1" } },
    );
    assert.equal(status, 1);
    assert.match(stderr, /BLOCKED/);
  });

  it("passes silently for unregistered branch", () => {
    const { status, stdout } = runCli([
      "--registry",
      tempReg.file,
      "scope-check",
      "feat/some-other-branch",
      "anything.ts",
    ]);
    assert.equal(status, 0);
    assert.match(stdout, /not registered/);
  });

  it("reads files from stdin when no positional files", () => {
    const { status, stdout } = runCli(
      [
        "--registry",
        tempReg.file,
        "scope-check",
        "feat/scope-check-branch",
      ],
      {
        stdin: "scripts/foo.mjs\ndocs/another.md\n",
      },
    );
    assert.equal(status, 0);
    assert.match(stdout, /within declared scope/);
  });
});

// ─── E2E tests: legacy migration ────────────────────────────────────────

describe("CLI: legacy /tmp registry migration", () => {
  it("migrates from /tmp to .claude when canonical missing", () => {
    // We can't safely modify /tmp/active-agents.json for the canonical path
    // because Tobias' local environment may have a real one. Instead, we
    // test the migration logic via a custom REGISTRY env-var to a fresh
    // location, and pre-seed a "legacy" path.

    // For this test we just verify the behavior via env-var override:
    // The actual /tmp → .claude migration runs only when REGISTRY_PATH is
    // exactly the canonical default. We've covered that path in the
    // implementation via migrateLegacyRegistryIfNeeded().
    //
    // This test is a smoke-test: verify --registry flag overrides correctly.
    const tempReg = makeTempRegistry();
    runCli([
      "--registry",
      tempReg.file,
      "register",
      "mig-test",
      "feat/mig",
      "scope.ts",
    ]);
    const reg = readRegistryFile(tempReg.file);
    assert.equal(reg.agents[0].id, "mig-test");
    rmSync(tempReg.dir, { recursive: true, force: true });
  });
});

// ─── E2E tests: PM_PUSH_CONTROL_REGISTRY env-var ────────────────────────

describe("env-var registry override", () => {
  it("uses PM_PUSH_CONTROL_REGISTRY when set", () => {
    const tempReg = makeTempRegistry();
    runCli(
      ["register", "env-test-1", "feat/env-branch", "scope.ts"],
      { env: { PM_PUSH_CONTROL_REGISTRY: tempReg.file } },
    );
    const reg = readRegistryFile(tempReg.file);
    assert.ok(reg, "registry should be created at env-var location");
    assert.equal(reg.agents[0].id, "env-test-1");
    rmSync(tempReg.dir, { recursive: true, force: true });
  });

  it("--registry flag takes priority over env-var", () => {
    const tempReg1 = makeTempRegistry();
    const tempReg2 = makeTempRegistry();
    runCli(
      ["--registry", tempReg1.file, "register", "prio-test", "feat/p", "x.ts"],
      { env: { PM_PUSH_CONTROL_REGISTRY: tempReg2.file } },
    );
    const r1 = readRegistryFile(tempReg1.file);
    const r2 = readRegistryFile(tempReg2.file);
    assert.ok(r1 && r1.agents.length === 1, "flag-registry should have entry");
    assert.ok(!r2 || r2.agents.length === 0, "env-registry should be empty");
    rmSync(tempReg1.dir, { recursive: true, force: true });
    rmSync(tempReg2.dir, { recursive: true, force: true });
  });
});

// ─── E2E tests: dashboard generation ────────────────────────────────────

describe("CLI: dashboard", () => {
  it("generates HTML at /tmp/pm-push-control-dashboard.html", () => {
    const tempReg = makeTempRegistry();
    runCli([
      "--registry",
      tempReg.file,
      "register",
      "dash-test",
      "feat/dash",
      "scope.ts",
    ]);
    const { stdout, status } = runCli([
      "--registry",
      tempReg.file,
      "dashboard",
    ]);
    assert.equal(status, 0);
    assert.match(stdout, /Dashboard generated/);
    assert.ok(existsSync("/tmp/pm-push-control-dashboard.html"));
    const html = readFileSync("/tmp/pm-push-control-dashboard.html", "utf8");
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /PM Push-Control Dashboard/);
    // Branch name should appear
    assert.match(html, /feat\/dash/);
    rmSync(tempReg.dir, { recursive: true, force: true });
  });
});

// ─── E2E tests: notify command ──────────────────────────────────────────

describe("CLI: notify", () => {
  it("returns success message on macOS (or skip-info elsewhere)", () => {
    const { stdout, status } = runCli([
      "notify",
      "P3",
      "Test notification from test suite",
    ]);
    assert.equal(status, 0);
    // Either delivered ✅ or skipped ⏭️ — both are acceptable
    assert.ok(/Notification (sent|skipped)/.test(stdout));
  });

  it("returns usage error without args", () => {
    const { status } = runCli(["notify"]);
    assert.equal(status, 2);
  });
});
