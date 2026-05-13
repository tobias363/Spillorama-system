# Cross-Knowledge Audit Report

**Date:** 2026-05-13
**Generated:** 2026-05-13T13:15:12.923Z
**Drift findings:** 1
**Architectural concerns:** 0
**Info-notices:** 3

## Findings

### Check 1

#### ℹ️ Linear access unavailable

Skipped Check 1 (PITFALLS-§ references closed Linear issue) — Linear API key not configured. Run with LINEAR_API_KEY env var or add secrets/linear-api.local.md to enable.

### Check 7

#### ℹ️ PM_HANDOFF PM_HANDOFF_2026-05-13_AUTONOMY_COMPLETE.md may reference merged PR #1320 as open

#1320 is mentioned in a context suggesting "open" or "pending" status, but `gh pr view` reports state=MERGED. This is informational — handoff docs naturally go stale.

**File:** `docs/operations/PM_HANDOFF_2026-05-13_AUTONOMY_COMPLETE.md`

#### ℹ️ PM_HANDOFF PM_HANDOFF_2026-05-13_AUTONOMY_COMPLETE.md may reference merged PR #1323 as open

#1323 is mentioned in a context suggesting "open" or "pending" status, but `gh pr view` reports state=MERGED. This is informational — handoff docs naturally go stale.

**File:** `docs/operations/PM_HANDOFF_2026-05-13_AUTONOMY_COMPLETE.md`

### Check 8

#### 🟡 PR template missing 4/4 knowledge-protocol checkboxes

Missing: PITFALLS_LOG, FRAGILITY_LOG, SKILL update, AGENT_EXECUTION_LOG. Each acts as a manual reminder of the knowledge-protocol (KNOWLEDGE_AUTONOMY_PROTOCOL.md). Suggested additions:
  - Add a checkbox referencing PITFALLS_LOG (e.g. 'I have read relevant PITFALLS_LOG sections').
  - Add a checkbox referencing FRAGILITY_LOG (e.g. 'I have read FRAGILITY_LOG F-NN for changed files').
  - Add a checkbox prompting for skill-update if generalizable knowledge was learned (e.g. 'I have updated relevant `.claude/skills/*/SKILL.md` if applicable').
  - Add a checkbox prompting for AGENT_EXECUTION_LOG entry (e.g. 'I have appended an entry to AGENT_EXECUTION_LOG.md').

**File:** `.github/pull_request_template.md`

## Architectural fragility summary

| File | FRAGILITY entries | Count |
|---|---|---:|
| `tests/e2e/spill1-pilot-flow.spec.ts` | F-01, F-02 | 2 |
| `packages/game-client/src/games/game1/screens/PlayScreen.ts` | F-01 | 1 |
| `tests/e2e/spill1-no-auto-start.spec.ts` | F-01 | 1 |
| `tests/e2e/spill1-wallet-flow.spec.ts` | F-01 | 1 |
| `tests/e2e/spill1-rad-vinst-flow.spec.ts` | F-01 | 1 |
| `apps/backend/src/game/GamePlanRunService.ts` | F-02 | 1 |
| `apps/backend/src/game/MasterActionService.ts` | F-02 | 1 |
| `tests/e2e/helpers/rest.ts` | F-02 | 1 |
| `tests/e2e/*.spec.ts` | F-03 | 1 |
| `packages/game-client/src/games/game1/debug/ConsoleBridge.ts` | F-04 | 1 |

_(Top 20 by entry-count. Files appearing in 3+ entries are flagged as architectural concerns above.)_

## Recommended actions

- **Update PR template:** Knowledge-protocol checkboxes missing — see Check 8 finding for exact additions.

---

## How to act on these findings

1. Review each finding in order of severity (🔴 > 🟡 > ℹ️).
2. For each, either:
   - **Fix:** Update the source document/code to resolve the drift.
   - **Suppress:** If the finding is a known false-positive, document the rationale.
3. Re-run the audit locally: `node scripts/cross-knowledge-audit.mjs`.
4. If running via CI: a GitHub issue has been created automatically.

## How to add new drift-checks

See [`docs/engineering/CROSS_KNOWLEDGE_AUDIT.md`](../../docs/engineering/CROSS_KNOWLEDGE_AUDIT.md) for the contributor guide.
