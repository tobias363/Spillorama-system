# Codex / Claude Worktree Routine

**Status:** Mandatory from 2026-05-17.
**Owner:** PM on duty.
**Purpose:** Make parallel Codex + Claude work predictable, conflict-safe, and auditable.
**Full protocol:** [`AI_BRANCH_COORDINATION_PROTOCOL.md`](./AI_BRANCH_COORDINATION_PROTOCOL.md).

This is the short operational routine. If this document and chat disagree, this document wins after merge to `main`.

---

## 1. Fixed worktree lanes

Use separate local worktrees. Do not let Codex and Claude work in the same checkout.

| Lane | Worktree | Branch prefix | Primary scope |
|---|---|---|---|
| Codex | `/Users/tobiashaugen/Projects/Spillorama-system-codex` | `codex/<scope>-YYYY-MM-DD` | Runtime fixes, backend/frontend code, live tests, DB/Sentry/PostHog verification, CI fixes |
| Claude | `/Users/tobiashaugen/Projects/Spillorama-system-claude` | `claude/<scope>-YYYY-MM-DD` | PM structure, knowledge flow, governance, playbooks, skills, agent-contract gates |
| Main/admin | `/Users/tobiashaugen/Projects/Spillorama-system` | `main` or active PM PR branch only | PM review, merge prep, emergency handoff |

The locked `.claude/worktrees/agent-*` directories are ephemeral agent worktrees. They are not PM lanes and must not be used as the Codex or Claude main workspace.

Temporary exception on 2026-05-17: Codex already has the active PR branch `codex/goh-4x80-rerun-2026-05-17` in `/Users/tobiashaugen/Projects/Spillorama-system`. After that PR is merged, future Codex work should start in `/Users/tobiashaugen/Projects/Spillorama-system-codex`.

---

## 2. Fresh-main rule before every work block

Before any Codex or Claude session edits files:

```bash
git fetch origin main --prune
git status -sb
gh pr list --state open --json number,title,headRefName,isDraft,mergeStateStatus
```

If starting from `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/<scope>-YYYY-MM-DD
# or:
git switch -c claude/<scope>-YYYY-MM-DD
```

If already on a feature branch:

```bash
git fetch origin main --prune
git rebase origin/main
```

If the feature branch was already pushed:

```bash
git push --force-with-lease
```

Use `git merge origin/main` only when rebasing would rewrite another actor's published work. If merge is used, explain why in the PR body.

---

## 3. Conflict-sensitive files

Only one lane may own these files at a time:

```text
docs/engineering/PITFALLS_LOG.md
docs/engineering/AGENT_EXECUTION_LOG.md
.claude/skills/pm-orchestration-pattern/SKILL.md
.github/workflows/**
package.json
package-lock.json
docs/auto-generated/SKILL_FILE_MAP.md
scripts/pm-knowledge-continuity.mjs
scripts/__tests__/pm-knowledge-continuity.test.mjs
scripts/validate-delivery-report.mjs
scripts/validate-pr-agent-contract.mjs
```

Rule:

1. Check open PRs before touching any file above.
2. If the other lane already touches the same file, wait for merge or agree explicit ownership.
3. After the other lane merges, run `git fetch origin main --prune` + `git rebase origin/main`.
4. For logs, only append new entries. Do not rewrite old entries.
5. For workflows/package files, one PR owns the whole change until merged.

---

## 4. Append-only log rule

`PITFALLS_LOG.md` and `AGENT_EXECUTION_LOG.md` are append-only operational memory.

Allowed:

- Add a new entry.
- Renumber only your own new entry after rebase.
- Add PR or commit reference to your own new entry.
- Add a correction entry that points to an older entry.

Not allowed without explicit PM/Tobias decision:

- Delete old entries.
- Rewrite another session's conclusion.
- Merge old entries for cleanup.
- Renumber old sections just to make a PR look cleaner.

---

## 5. If both lanes need the same file

Use this sequence:

1. Decide owner: `Codex owns <file>` or `Claude owns <file>`.
2. Non-owner parks that file and continues only on non-overlapping files.
3. Owner opens PR and gets it merged first.
4. Non-owner runs:

   ```bash
   git fetch origin main --prune
   git rebase origin/main
   ```

5. Non-owner applies only the remaining delta.
6. PR body explains the sequence.

Do not let both lanes independently edit `PITFALLS_LOG.md`, `AGENT_EXECUTION_LOG.md`, `pm-orchestration-pattern`, workflows, or package files and hope Git resolves it cleanly.

---

## 6. Required PR-body coordination block

Every PR must include this block. For PRs touching conflict-sensitive files, fill it out with exact paths.

```markdown
Fresh-main sync: fetched origin/main and rebased|merged at <short-sha>
Branch lane: codex|claude
Worktree: /Users/tobiashaugen/Projects/Spillorama-system-codex|/Users/tobiashaugen/Projects/Spillorama-system-claude
Shared-file rebase: origin/main@<short-sha>
Shared files touched:
- <path or none>
Coordination note: <who owns overlap / why no overlap>
```

If no conflict-sensitive files are touched:

```markdown
Shared files touched: none
Coordination note: no Codex/Claude overlap
```

---

## 7. Claude answer when Codex has an active PR

If Claude asks whether it can continue while Codex has an active PR touching shared files, Tobias/PM should answer:

```text
Vent med alle filer som overlapper Codex sin PR til den er merget. Du kan jobbe på egen claude/<scope>-branch i /Users/tobiashaugen/Projects/Spillorama-system-claude hvis scope ikke rører samme lock-filer.

Før første filendring:
git fetch origin main --prune
git rebase origin/main
gh pr list --state open --json number,title,headRefName,isDraft,mergeStateStatus

Hvis du må røre PITFALLS_LOG, AGENT_EXECUTION_LOG, pm-orchestration-pattern, workflows eller package.json/package-lock.json: stopp og avklar owner først. Etter Codex-merge skal du rebase mot origin/main før du gjør append-only endringer.

PR-body må inneholde fresh-main sync, shared files touched og coordination note.
```

---

## 8. Codex answer when Claude has an active PR

If Codex starts while Claude has an active PR touching shared files:

```text
Codex skal ikke røre Claude-eide shared files før Claude-PR er merged eller parkert. Runtime-fiks kan fortsette på codex/<scope>-branch bare hvis diffen ikke overlapper.

Før første filendring:
git fetch origin main --prune
git rebase origin/main
gh pr list --state open --json number,title,headRefName,isDraft,mergeStateStatus

Hvis runtime-fiksen krever skill/PITFALLS/AGENT_EXECUTION_LOG, gjør det i samme PR bare hvis Claude ikke eier filene. Hvis Claude eier dem, merge/rebase først og legg deretter append-only knowledge update.
```

---

## 9. Merge order

Default order when both lanes are active:

1. P0/P1 runtime safety PR.
2. CI/gate fix required to merge runtime PR.
3. Knowledge/governance PR that does not block runtime safety.
4. Cleanup/docs-only PR.

Exception: If a governance PR changes CI gates or PR templates that affect the runtime PR, merge governance first only when it has green CI and no shared-file conflict.

---

## 10. Handoff sentence

At session end, PM should include this in handoff:

```text
Codex/Claude coordination: current Codex branch <branch or none>, current Claude branch <branch or none>, shared-file owner <owner or none>, last fresh-main base origin/main@<short-sha>, and whether the next PM must rebase before touching shared files.
```

---

## Endringslogg

| Date | Change |
|---|---|
| 2026-05-17 | Initial mandatory worktree routine added after parallel Codex/Claude work created repeated overlap risk around knowledge logs, workflow gates, and package files. |
