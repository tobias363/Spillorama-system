# Release Gate — E2E pengeflyt (BIN-526)

**Linear:** [BIN-526](https://linear.app/bingosystem/issue/BIN-526)
**Owner:** Technical lead (Tobias Haugen)
**Last updated:** 2026-04-18

This document explains the single hardest release-gate the Spillorama backend has: `apps/backend/src/compliance/__tests__/pengeflyt-e2e.test.ts`. If this test fails, **nothing ships**, regardless of product pressure or staging signal.

---

## 1. What it asserts

The test parametrises across every supported game slug (`bingo`, `rocket`, `monsterbingo`, `spillorama`) and, for each one, runs the full in-memory pengeflyt path:

1. **Seed** — two players with 1000 NOK each; house account empty.
2. **Stake** — `startGame({ entryFee: 10 })` debits both players, credits the hall's house account.
3. **Play** — drain the deterministic draw bag, mark every grid number on the winning ticket.
4. **Settle** — `submitClaim(LINE)` then `submitClaim(BINGO)` — house → winner transfers.
5. **Verify**:
   - **Conservation** — `Σ initialBalance === Σ finalBalance` across all accounts. If this fails, we either created or destroyed money — regulatory-level bug.
   - **Ledger linkage** — at least 2 `STAKE` entries (one per player) and at least 1 `PRIZE` entry; all entries share the same `hallId` (correlation via `gameId` is implicit because every entry for the round has one).
   - **Winner balance** — host ends strictly above guest (host won both claims; guest only staked).

A **sixth** test exercises the checkpoint-recovery path on `bingo` (largest state, 75-ball variant): serialize the live game, build a fresh engine, `restoreRoomFromSnapshot`, continue drawing on the recovered engine. If restore is lossy, drawing on the recovered engine either drifts or throws.

---

## 2. Why these invariants

| Invariant | What it catches |
| --- | --- |
| **Conservation** | Any transfer that only debits or only credits one side. The classic "money printing" bug. |
| **Ledger linkage** | Any path where wallet state updates but the compliance ledger does not — spillemyndigheten-level audit failure. |
| **Hall correlation** | A regression that mixes hall ledger streams, which would quietly corrupt the nightly settlement reports. |
| **Winner balance strict-gt** | A regression where `payoutAmount` is zero or negative — surfaces quickly because it's easier to diagnose than "the total is off by a penny". |
| **Checkpoint recovery** | Any schema-level drift in `GameSnapshot` serialization that would make a crashed game unrecoverable. Pilot-halt incident. |

Each invariant is narrow and actionable. A failure points to a specific class of bug, not "something is wrong somewhere in the money flow".

---

## 3. How to run

### Local

```bash
npm --prefix apps/backend run test:compliance
```

No Postgres, Redis, or Docker required. Everything runs against in-memory adapters, so the test suite finishes in under a second.

### CI

The existing GitHub Actions workflows (`.github/workflows/ci.yml`, `.github/workflows/compliance-gate.yml`) already run this script. The compliance workflow is the stricter of the two and is the one wired to the branch-protection check `compliance`.

**To make the compliance workflow a blocking required-status-check on main**, go to:

> GitHub → Settings → Branches → Branch protection rules → `main` → Require status checks to pass before merging → **add `compliance`**.

If the check is ticked, a PR cannot merge without all 11 compliance tests green. This step is a one-time repo-settings change; no code change is needed beyond the existing workflows. Document here the date the setting was toggled:

- Enabled: **_TBD_ — set on first pilot rollout day.** Paste the PR/commit that produced the enablement in this line.

### Running just the pengeflyt scenarios

```bash
npx --prefix apps/backend tsx --test 'apps/backend/src/compliance/__tests__/pengeflyt-e2e.test.ts'
```

This is useful when iterating on the pengeflyt path itself. The full compliance suite stays fast (< 1 s) so there's rarely a reason to skip the rest.

---

## 4. Failure triage

When this test fails, the likely causes in priority order:

1. **Wallet adapter regression.** Look for recent changes to `apps/backend/src/adapters/WalletAdapter.ts` or the concrete adapters. A silent `try`/`catch` in `transfer` is a classic cause of conservation failures.
2. **Compliance ledger regression.** Look for recent changes to `apps/backend/src/game/ComplianceLedger.ts` or any engine call site that adds a transfer without a matching `recordComplianceLedgerEvent`. The ledger is narrow by design: every STAKE and PRIZE must be paired.
3. **Engine variant divergence.** One slug fails but the others pass → the variant config changed. Check `apps/backend/src/game/variantConfig.ts` and any admin-panel migration that edits `hall_game_schedules.variant_config`.
4. **Checkpoint shape drift.** The recovery sub-test fails but the money-flow tests pass → `GameSnapshot` gained a field that isn't in `restoreRoomFromSnapshot`. Add the field on both sides.
5. **Flaky-looking test.** The test is deterministic: seeded draw bag, fixed ticket, no randomness in the assertion path. If it "sometimes passes", something outside the test (Date.now(), global Maps) is leaking state. Look for a test earlier in the file list that forgot to clean up.

---

## 7. Pre-pilot acceptance checklist (BIN-533)

Before pilot go-live (hall-for-hall cutover), all rows below must be ticked. Any unticked row is a pilot-blocker.

- [ ] **Risk-register closure** ([`RISK_REGISTER_CLOSURE.md`](./RISK_REGISTER_CLOSURE.md)) approved by technical lead. At doc-v1 (2026-04-18): 9 Mitigated / 2 Accepted / 1 Open. The Open risk (R11 — GSAP licence) must be resolved or explicitly accepted with a time-bounded waiver before pilot.
- [ ] **Unity build reproducibility** ([BIN-532](https://linear.app/bingosystem/issue/BIN-532)) — CI job produces a deployable Unity WebGL bundle from `legacy/unity-client/` on demand. Required so BIN-540's `unity-fallback` flag has something to fall back to.
- [ ] **Spillvett cross-game test** green in CI (BIN-541, merged `cac67dec`).
- [ ] **Pengeflyt E2E gate** green in CI (BIN-526, merged `3bca6da0`); `compliance` status check marked required in branch-protection.
- [ ] **Observability** ([BIN-539](https://linear.app/bingosystem/issue/BIN-539)) wired: Sentry DSN set in staging + production; Grafana pilot dashboard provisioned.
- [ ] **Rollback runbook** ([`ROLLBACK_RUNBOOK.md`](../operations/ROLLBACK_RUNBOOK.md)) staging-smoke passed at least once (§7 of that runbook).
- [ ] **Load-test baseline** ([BIN-508](https://linear.app/bingosystem/issue/BIN-508)) — first three nightly 1000-VU runs logged with p99 < 500 ms.

Sign-off format:

```
Pre-pilot acceptance approved by: <name>
Date: YYYY-MM-DD
Open items: <list or "none">
```

---

## 5. Scope limits

This gate covers **backend money flow only**. It does NOT cover:

- The Socket.IO wire layer (covered by `apps/backend/src/sockets/__tests__/wireContract.test.ts` + `packages/game-client/src/bridge/__tests__/wireContract.test.ts` per BIN-527).
- The Postgres/Redis persistence layer (covered by integration tests that do spin up Docker — separate follow-up).
- The client-side rendering (covered by vitest suites in `packages/game-client/`).
- Spillvett cross-game limits — covered by BIN-541 (`apps/backend/src/spillevett/__tests__/cross-game.test.ts`, 20 tests across 4 game slugs × 4 rules + 4 fail-closed). Runs as part of `test:compliance`.

When one of those layers breaks, their own tests fail — this test stays green because it exercises a layer below.

Conversely, when this test fails, it's the backend money flow. Don't spend an afternoon debugging the client — look at the engine + wallet + ledger triangle.
