# Cross-Knowledge Audit Report

**Date:** 2026-05-13
**Generated:** 2026-05-13T15:38:43.567Z
**Drift findings:** 0
**Architectural concerns:** 0
**Info-notices:** 1

## Findings

### Check 1

#### ℹ️ Linear access unavailable

Skipped Check 1 (PITFALLS-§ references closed Linear issue) — Linear API key not configured. Run with LINEAR_API_KEY env var or add secrets/linear-api.local.md to enable.

## Architectural fragility summary

| File | FRAGILITY entries | Count |
|---|---|---:|
| `tests/e2e/spill1-pilot-flow.spec.ts` | F-01, F-02 | 2 |
| `tests/e2e/spill1-manual-flow.spec.ts` | F-02, F-03 | 2 |
| `packages/game-client/src/games/game1/screens/PlayScreen.ts` | F-01 | 1 |
| `tests/e2e/spill1-no-auto-start.spec.ts` | F-01 | 1 |
| `tests/e2e/spill1-wallet-flow.spec.ts` | F-01 | 1 |
| `tests/e2e/spill1-rad-vinst-flow.spec.ts` | F-01 | 1 |
| `apps/backend/src/game/GamePlanRunService.ts` | F-02 | 1 |
| `apps/backend/src/game/MasterActionService.ts` | F-02 | 1 |
| `apps/backend/src/game/Game1LobbyService.ts` | F-02 | 1 |
| `tests/e2e/helpers/rest.ts` | F-02 | 1 |
| `apps/backend/src/game/__tests__/Game1LobbyService.reconcile.test.ts` | F-02 | 1 |
| `apps/backend/src/game/Game1LobbyService.test.ts` | F-02 | 1 |
| `apps/backend/src/routes/__tests__/spill1Lobby.test.ts` | F-02 | 1 |
| `tests/e2e/helpers/manual-flow.ts` | F-03 | 1 |
| `packages/game-client/src/games/game1/debug/ConsoleBridge.ts` | F-04 | 1 |
| `apps/backend/src/sockets/game1ScheduledEvents.ts` | F-05 | 1 |
| `apps/backend/src/sockets/gameEvents/roomEvents.ts` | F-05 | 1 |
| `apps/backend/src/game/BingoEngine.ts` | F-05 | 1 |
| `apps/backend/src/util/roomHelpers.ts` | F-05 | 1 |
| `apps/backend/src/sockets/__tests__/game1ScheduledEvents.reconnect.test.ts` | F-05 | 1 |

_(Top 20 by entry-count. Files appearing in 3+ entries are flagged as architectural concerns above.)_


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
