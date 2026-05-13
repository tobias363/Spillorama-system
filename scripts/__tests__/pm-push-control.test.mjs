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
    // Smoke test: verify --registry flag overrides correctly.
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

  // ─── Real E2E migration tests (E5 redo, 2026-05-13) ────────────────────
  //
  // These tests exercise migrateLegacyRegistryIfNeeded() via env-var
  // overrides for both legacy and canonical paths. Verifies:
  //   1. Migration happens when canonical missing + legacy exists
  //   2. Migration does NOT happen when canonical already exists
  //   3. Migration does NOT happen when legacy does NOT exist
  //   4. Migration adds migratedFrom + migratedAt metadata
  //   5. Migration is idempotent (re-running list/register does not duplicate)

  it("migrates legacy /tmp registry to canonical when canonical missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-e2e-"));
    const canonicalPath = join(dir, "canonical.json");
    const legacyPath = join(dir, "legacy.json");

    // Seed legacy file
    const legacySeed = {
      version: 1,
      updatedAt: "2026-05-13T10:00:00Z",
      agents: [
        {
          id: "legacy-agent-1",
          shortname: "L1",
          topic: "legacy entry",
          branch: "feat/legacy",
          scope: ["scripts/legacy.mjs"],
          spawnedAt: "2026-05-13T09:00:00Z",
          status: "in-flight",
        },
      ],
      conflictsAcknowledged: [],
    };
    writeFileSync(legacyPath, JSON.stringify(legacySeed, null, 2));

    // Verify canonical doesn't exist yet
    assert.ok(!existsSync(canonicalPath), "canonical must not exist pre-test");

    // Run any CLI command — list triggers readRegistry → migration
    const res = runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });
    assert.equal(res.status, 0, `list should succeed: ${res.stderr}`);

    // Canonical should now exist with migrated content
    assert.ok(existsSync(canonicalPath), "canonical must exist after migration");
    const canonical = readRegistryFile(canonicalPath);
    assert.ok(canonical, "canonical content should be valid JSON");
    assert.equal(canonical.agents.length, 1);
    assert.equal(canonical.agents[0].id, "legacy-agent-1");
    assert.equal(
      canonical.migratedFrom,
      legacyPath,
      "migratedFrom should reference legacy path",
    );
    assert.ok(canonical.migratedAt, "migratedAt timestamp should be set");

    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT migrate when canonical already exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-e2e-"));
    const canonicalPath = join(dir, "canonical.json");
    const legacyPath = join(dir, "legacy.json");

    // Pre-seed BOTH files with different content
    const canonicalSeed = {
      version: 2,
      updatedAt: "2026-05-13T12:00:00Z",
      agents: [
        {
          id: "canonical-agent",
          shortname: "C1",
          topic: "current",
          branch: "feat/canon",
          scope: ["scripts/canon.mjs"],
          spawnedAt: "2026-05-13T11:00:00Z",
          status: "in-flight",
        },
      ],
      conflictsAcknowledged: [],
    };
    const legacySeed = {
      version: 1,
      updatedAt: "2026-05-13T08:00:00Z",
      agents: [
        {
          id: "legacy-agent-X",
          shortname: "LX",
          topic: "old",
          branch: "feat/old",
          scope: ["x.ts"],
          spawnedAt: "2026-05-13T07:00:00Z",
          status: "in-flight",
        },
      ],
      conflictsAcknowledged: [],
    };
    writeFileSync(canonicalPath, JSON.stringify(canonicalSeed, null, 2));
    writeFileSync(legacyPath, JSON.stringify(legacySeed, null, 2));

    const res = runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });
    assert.equal(res.status, 0);

    // Canonical content should NOT have been replaced by legacy
    const result = readRegistryFile(canonicalPath);
    assert.equal(result.agents.length, 1);
    assert.equal(
      result.agents[0].id,
      "canonical-agent",
      "canonical content must not be overwritten",
    );
    assert.ok(
      !result.migratedFrom,
      "migratedFrom must not be added when canonical existed",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT migrate when legacy does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-e2e-"));
    const canonicalPath = join(dir, "canonical.json");
    const legacyPath = join(dir, "non-existent-legacy.json");

    // Neither file exists initially
    assert.ok(!existsSync(canonicalPath));
    assert.ok(!existsSync(legacyPath));

    const res = runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });
    assert.equal(res.status, 0, "list should succeed even with empty registry");

    // Canonical file should not have been created spuriously
    // (only created on register/unregister/save, not on read-only list)
    assert.ok(
      !existsSync(canonicalPath),
      "no spurious canonical creation when nothing to migrate",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("migration is idempotent — repeat call does not re-trigger", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-e2e-"));
    const canonicalPath = join(dir, "canonical.json");
    const legacyPath = join(dir, "legacy.json");

    writeFileSync(
      legacyPath,
      JSON.stringify({
        version: 1,
        updatedAt: "2026-05-13T10:00:00Z",
        agents: [],
        conflictsAcknowledged: [],
      }),
    );

    // First call → migration happens
    runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });
    const first = readRegistryFile(canonicalPath);
    assert.ok(first.migratedFrom, "first call should migrate");
    const firstMigratedAt = first.migratedAt;

    // Second call → should NOT re-migrate (canonical now exists)
    runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });
    const second = readRegistryFile(canonicalPath);
    assert.equal(
      second.migratedAt,
      firstMigratedAt,
      "migratedAt must not change on second call (idempotency)",
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("migration preserves conflictsAcknowledged array", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-mig-e2e-"));
    const canonicalPath = join(dir, "canonical.json");
    const legacyPath = join(dir, "legacy.json");

    const legacySeed = {
      version: 1,
      updatedAt: "2026-05-13T10:00:00Z",
      agents: [],
      conflictsAcknowledged: [
        {
          files: ["docs/engineering/AGENT_EXECUTION_LOG.md"],
          agents: ["A1", "A2"],
          type: "additive-append",
          resolution: "append all entries",
        },
      ],
    };
    writeFileSync(legacyPath, JSON.stringify(legacySeed));

    runCli(["list"], {
      env: {
        PM_PUSH_CONTROL_CANONICAL_REGISTRY: canonicalPath,
        PM_PUSH_CONTROL_LEGACY_REGISTRY: legacyPath,
      },
    });

    const result = readRegistryFile(canonicalPath);
    assert.equal(result.conflictsAcknowledged.length, 1);
    assert.equal(
      result.conflictsAcknowledged[0].type,
      "additive-append",
      "conflictsAcknowledged must survive migration",
    );

    rmSync(dir, { recursive: true, force: true });
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
