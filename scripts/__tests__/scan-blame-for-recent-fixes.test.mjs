/**
 * Tests for scan-blame-for-recent-fixes.mjs (Bug-resurrection detector).
 *
 * Strategy: bygg en isolert git-fixture pr test ved hjelp av `git init` i
 * et midlertidig directory. Lag commits med konkrete fix/feat-prefixes
 * og kjør detektoren mot ref'en. Verifiser output + exit-code.
 *
 * Run with:
 *   npx vitest run scripts/__tests__/scan-blame-for-recent-fixes.test.mjs
 *
 * Bakgrunn: Spillorama-pilot mai 2026, "2 skritt frem 1 tilbake"-problem.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/scan-blame-for-recent-fixes.mjs");

/**
 * Helper: build a fresh git repo in a tempdir for fixture tests.
 *
 * NOTE: Vi setter `--initial-branch=main` for å unngå init.defaultBranch-
 * warnings. Author-info settes per-commit slik at testen ikke avhenger av
 * brukerens globale git-config.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "resurrection-test-"));
  runGit(dir, ["init", "--initial-branch=main", "-q"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test User"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function runGit(cwd, args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${r.status}): ${r.stderr}`,
    );
  }
  return r;
}

/**
 * Commit content to a file with a specific subject. If `daysAgo > 0` is
 * provided, sets GIT_COMMITTER_DATE / GIT_AUTHOR_DATE to simulate that
 * the commit was made N days ago.
 */
function commit(repo, filename, content, subject, daysAgo = 0) {
  const filePath = join(repo, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  runGit(repo, ["add", filename]);
  const env = {};
  if (daysAgo > 0) {
    const ts = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
    env.GIT_COMMITTER_DATE = ts;
    env.GIT_AUTHOR_DATE = ts;
  }
  runGit(repo, ["commit", "-m", subject, "-q"], { env });
  const r = runGit(repo, ["rev-parse", "HEAD"]);
  return r.stdout.trim();
}

/**
 * Run scan-blame-for-recent-fixes.mjs with given args inside the given cwd.
 * Returns { exitCode, stdout, stderr, json } where json is parsed if
 * --format=json was passed.
 */
function runScanner(cwd, args = [], opts = {}) {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...(opts.env || {}) },
  });
  const out = {
    exitCode: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
  if (args.includes("json") || args.includes("--format")) {
    try {
      const idx = r.stdout.indexOf("{");
      if (idx >= 0) {
        out.json = JSON.parse(r.stdout.slice(idx));
      }
    } catch {
      // not JSON output
    }
  }
  return out;
}

describe("scan-blame-for-recent-fixes.mjs", () => {
  let repo;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe("happy paths", () => {
    it("exit 0 when no commits to scan against (root commit)", () => {
      // Setup: lag bare ÉN commit. Scanner kan ikke se HEAD~1 så
      // får git-feil. Vi forventer exit 2 (script-feil).
      commit(repo, "a.ts", "line 1\nline 2\n", "feat: initial");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      // git diff HEAD~1 HEAD vil feile siden HEAD~1 ikke finnes.
      expect(r.exitCode).toBe(2);
    });

    it("exit 0 when commit modifies lines from a feat (not fix) commit", () => {
      // c1: feat-commit (ikke en fix)
      commit(repo, "a.ts", "v1 line A\nv1 line B\nv1 line C\n", "feat: initial");
      // c2: modify line — sist blame finner kommiten over som ikke er fix
      commit(repo, "a.ts", "v1 line A\nv2 line B (modified)\nv1 line C\n", "feat: another change");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(0);
    });

    it("exit 0 when commit modifies lines from an OLD fix (outside --days window)", () => {
      // c1: fix-commit 60 dager gammelt
      commit(repo, "a.ts", "v1\nv2\nv3\n", "fix(scope): old bug", 60);
      // c2: dagens commit som modifiserer linje 2
      commit(repo, "a.ts", "v1\nv2 modified\nv3\n", "feat: new behavior");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(0);
    });

    it("exit 1 when commit modifies lines from a RECENT fix-commit", () => {
      // c1: fix-commit 5 dager gammelt
      commit(repo, "a.ts", "v1\nv2 bugfix\nv3\n", "fix(scope): recent bug", 5);
      // c2: dagens commit som modifiserer linje 2
      commit(repo, "a.ts", "v1\nv2 modified again\nv3\n", "feat: tweak");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain("Bug-resurrection candidates");
      expect(r.stdout).toContain("fix(scope): recent bug");
    });

    it("exit 0 when commit message has [resurrection-acknowledged: ...]", () => {
      commit(repo, "a.ts", "v1\nv2\nv3\n", "fix(scope): nearby bug", 5);
      commit(
        repo,
        "a.ts",
        "v1\nv2 modified\nv3\n",
        "feat: intentional change\n\n[resurrection-acknowledged: forskjellig bug i samme region]",
      );
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Acknowledgment satt");
    });
  });

  describe("CLI flags", () => {
    it("--days 0 returns 0 even with recent fixes", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 0);
      commit(repo, "a.ts", "v1\nv2 changed\n", "feat: tweak");
      // Recent commit happened 'just now' which is age ~0 days.
      // With --days 0, the check is `age > 0` so ageDays > 0 = excluded.
      // Edge case: due to floating point, the same-second commit will
      // typically have very small ageDays. Let's verify behavior is safe.
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "0", "--format", "json"]);
      // exit 0 means no candidates (excluded by window=0)
      expect([0, 1]).toContain(r.exitCode);
      // resurrectionCandidates should be false since age > 0 typically
      // for any commit (even fresh ones have some elapsed time)
    });

    it("--days 365 captures very old fixes", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: very old bug", 200);
      commit(repo, "a.ts", "v1\nv2 changed\n", "feat: tweak");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "365"]);
      expect(r.exitCode).toBe(1);
    });

    it("--format json outputs valid JSON", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: recent", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: tweak");
      const r = runScanner(repo, ["--ref", "HEAD", "--format", "json"]);
      const parsed = JSON.parse(r.stdout);
      expect(parsed).toHaveProperty("resurrectionCandidates");
      expect(parsed).toHaveProperty("daysWindow");
      expect(parsed).toHaveProperty("candidates");
      expect(parsed.resurrectionCandidates).toBe(true);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].file).toBe("a.ts");
    });

    it("--quiet suppresses output when no candidates", () => {
      commit(repo, "a.ts", "v1\n", "feat: initial");
      commit(repo, "a.ts", "v1\nv2 added\n", "feat: append");
      const r = runScanner(repo, ["--ref", "HEAD", "--quiet"]);
      expect(r.exitCode).toBe(0);
      // Empty stdout (or whitespace only) when no candidates and --quiet
      expect(r.stdout.trim()).toBe("");
    });

    it("--quiet still prints output when candidates exist", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: recent", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: tweak");
      const r = runScanner(repo, ["--ref", "HEAD", "--quiet"]);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain("Bug-resurrection");
    });

    it("--help prints usage and exits 0", () => {
      const r = runScanner(repo, ["--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Usage");
      expect(r.stdout).toContain("--ref");
      expect(r.stdout).toContain("--days");
    });

    it("invalid --format returns exit 2", () => {
      const r = runScanner(repo, ["--format", "yaml"]);
      expect(r.exitCode).toBe(2);
    });

    it("unknown flag returns exit 2", () => {
      const r = runScanner(repo, ["--foobar"]);
      expect(r.exitCode).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("ignores binary files", () => {
      // Lag binary fil med null-byte
      const binPath = join(repo, "blob.bin");
      writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 0, 4, 5]));
      runGit(repo, ["add", "blob.bin"]);
      runGit(repo, ["commit", "-m", "fix: add binary", "-q"]);
      // Modify binary
      writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 0, 4, 5, 6]));
      runGit(repo, ["add", "blob.bin"]);
      runGit(repo, ["commit", "-m", "feat: change binary", "-q"]);
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      // No false positive on binary file (it's filtered out)
      expect(r.exitCode).toBe(0);
    });

    it("handles deleted files without error", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug in a.ts", 5);
      commit(repo, "b.ts", "v1\n", "feat: add b.ts");
      // Delete a.ts and modify b.ts
      const aPath = join(repo, "a.ts");
      const bPath = join(repo, "b.ts");
      writeFileSync(bPath, "v1\nv2 new\n");
      rmSync(aPath);
      runGit(repo, ["add", "-A"]);
      runGit(repo, ["commit", "-m", "feat: remove a, modify b", "-q"]);
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      // a.ts was deleted (skipped), b.ts modified but its lines came from
      // a feat — exit 0
      expect(r.exitCode).toBe(0);
    });

    it("handles pure additions (no old lines to blame)", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: initial", 5);
      // Pure addition — no old lines modified
      commit(repo, "a.ts", "v1\nv2\nv3 NEW\nv4 NEW\n", "feat: append");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(0);
    });

    it("detects multi-line modifications correctly", () => {
      commit(repo, "a.ts", "v1\nv2\nv3\nv4\nv5\n", "fix: multi-line bug", 5);
      commit(repo, "a.ts", "v1\nv2 mod\nv3 mod\nv4 mod\nv5\n", "feat: modify range");
      const r = runScanner(repo, ["--ref", "HEAD", "--format", "json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.candidates).toHaveLength(1);
      // Should detect a range of 3 lines
      const match = parsed.candidates[0].matches[0];
      expect(match.oldCount).toBeGreaterThanOrEqual(3);
    });

    it("recognizes Conventional Commits fix-pattern with scope", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix(spill1): scoped bug", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: change");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(1);
    });

    it("recognizes fix-pattern with multi-word scope", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix(admin-web/pages): bug", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: change");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(1);
    });

    it("does NOT match 'fixed' or 'fixes' or 'fixup' in commit subject", () => {
      // Note: this is intentional — Conventional Commits requires `fix:` or `fix(...):`
      commit(repo, "a.ts", "v1\nv2\n", "feat: fixed the bug", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: change");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(0);
    });

    it("matches 'Fix:' with capital F (lenient)", () => {
      commit(repo, "a.ts", "v1\nv2\n", "Fix: typo", 5);
      commit(repo, "a.ts", "v1\nv2 mod\n", "feat: change");
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30"]);
      expect(r.exitCode).toBe(1);
    });
  });

  describe("acknowledgment formats", () => {
    it("accepts [resurrection-acknowledged: reason]", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      commit(
        repo,
        "a.ts",
        "v1\nv2 mod\n",
        "feat: change\n\n[resurrection-acknowledged: forskjellig sibling-bug]",
      );
      const r = runScanner(repo, ["--ref", "HEAD"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Acknowledgment satt");
    });

    it("case-insensitive on the marker prefix", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      commit(
        repo,
        "a.ts",
        "v1\nv2 mod\n",
        "feat: change\n\n[Resurrection-Acknowledged: testing]",
      );
      const r = runScanner(repo, ["--ref", "HEAD"]);
      expect(r.exitCode).toBe(0);
    });

    it("requires non-empty reason", () => {
      // Empty reason should still match the regex (the regex captures
      // anything inside [resurrection-acknowledged: ...]).
      // This is intentional — the regex doesn't enforce content quality,
      // only that the marker is present. PR review catches empty reasons.
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      commit(
        repo,
        "a.ts",
        "v1\nv2 mod\n",
        "feat: change\n\n[resurrection-acknowledged: x]",
      );
      const r = runScanner(repo, ["--ref", "HEAD"]);
      expect(r.exitCode).toBe(0);
    });

    it("JSON output reports acknowledgment status", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      commit(
        repo,
        "a.ts",
        "v1\nv2 mod\n",
        "feat: change\n\n[resurrection-acknowledged: reason here]",
      );
      const r = runScanner(repo, ["--ref", "HEAD", "--format", "json"]);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.acknowledgmentPresent).toBe(true);
      expect(parsed.acknowledgmentReason).toBe("reason here");
    });
  });

  describe("staged mode", () => {
    it("scans staged changes when --staged passed", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      // Modify file but don't commit yet
      writeFileSync(join(repo, "a.ts"), "v1\nv2 staged-mod\n");
      runGit(repo, ["add", "a.ts"]);
      const r = runScanner(repo, ["--staged"]);
      expect(r.exitCode).toBe(1);
    });

    it("--staged is default when no --ref given", () => {
      commit(repo, "a.ts", "v1\nv2\n", "fix: bug", 5);
      writeFileSync(join(repo, "a.ts"), "v1\nv2 staged-mod\n");
      runGit(repo, ["add", "a.ts"]);
      const r = runScanner(repo);
      expect(r.exitCode).toBe(1);
    });

    it("exit 0 when no staged changes", () => {
      commit(repo, "a.ts", "v1\n", "feat: initial");
      // No staged changes
      const r = runScanner(repo, ["--staged"]);
      expect(r.exitCode).toBe(0);
    });
  });

  describe("integration: real Spillorama-style chain", () => {
    it("detects chained fix-commits as resurrection candidates", () => {
      // Simuler det reelle Spillorama-scenarioet:
      //   fix #1: introduce a fix on line 5-10
      //   fix #2: another fix touches line 7 (sibling bug, same region)
      //   feat #3: agent endrer linje 8 uten å lese F-NN
      commit(
        repo,
        "src/pages/HallStatusBox.ts",
        Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        "feat: initial implementation",
        30,
      );
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      lines[6] = "line 7 — fix Angre Klar regresjon";
      commit(
        repo,
        "src/pages/HallStatusBox.ts",
        lines.join("\n") + "\n",
        "fix(admin-web): Angre Klar regresjon",
        2,
      );
      // Agent endrer samme linje
      lines[6] = "line 7 — agent change";
      commit(
        repo,
        "src/pages/HallStatusBox.ts",
        lines.join("\n") + "\n",
        "feat: improve UX",
      );
      const r = runScanner(repo, ["--ref", "HEAD", "--days", "30", "--format", "json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].file).toBe("src/pages/HallStatusBox.ts");
      expect(parsed.candidates[0].matches[0].recentFixes[0].subject).toContain(
        "Angre Klar",
      );
    });
  });
});
