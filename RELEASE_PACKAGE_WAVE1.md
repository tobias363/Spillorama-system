# Release Package - Wave 1 Pilot

Version: `0.2.0-wave1`
Prepared: `2026-03-04`
Target rollout window: `2026-03-09` (Wave 1 pilot hall)

## 1. Scope Included In This Package

- Spillorama client/editor updates for realtime play flow and safer scene cleanup.
- Backend runtime hardening for local env loading and configurable minimum players.
- Compliance gate and dedicated compliance test suite.
- Pilot operations documentation (`BG-027`, `BG-028`, sign-off docs).

## 2. Recommended Commit Structure

Commit order is optimized for review and rollback isolation.

### Commit 1: `spillorama: realtime play flow + editor cleanup guardrails`

Files:

- `Spillorama/Assets/Script/APIManager.cs`
- `Spillorama/Assets/Script/BingoRealtimeClient.cs`
- `Spillorama/Assets/Script/UIManager.cs`
- `Spillorama/Assets/Editor/RemoveMissingScriptsTool.cs`

Intent:

- Make Play button able to start/draw realtime round deterministically.
- Add safer join/create pending behavior and bootstrap logging controls.
- Add optional auto cleanup of missing scripts before Play mode.

### Commit 2: `backend: runtime config hardening + min players control`

Files:

- `backend/src/index.ts`
- `backend/src/game/BingoEngine.ts`
- `backend/src/game/BingoEngine.test.ts`
- `backend/scripts/dev-single.sh`
- `backend/package.json`
- `backend/package-lock.json`
- `package.json`

Intent:

- Load backend `.env` via `dotenv`.
- Add `BINGO_MIN_PLAYERS_TO_START` policy (dev allows `>=1`, prod enforces `>=2`).
- Add single-instance dev watcher script to avoid duplicate backend watch processes.

### Commit 3: `qa: compliance gate and dedicated compliance suite`

Files:

- `.github/workflows/compliance-gate.yml`
- `backend/src/compliance/compliance-suite.test.ts`

Intent:

- CI gate requiring green compliance suite before merge/deploy.
- Focused tests for limits, pause, exclusion, timing, ticket caps, prize caps.

### Commit 4: `ops: pilot/runbook/rollout/signoff documentation`

Files:

- `HALL_PILOT_RUNBOOK.md`
- `ROLLOUT_PLAN_1_3_20.md`
- `P0_SIGNOFF.md`
- `WAVE1_GO_NO_GO_SIGNOFF_2026-03-09.md`
- `CHANGELOG.md`
- `RELEASE_NOTES_WAVE1.md`
- `README.md`

Intent:

- Operationalize pilot and staged rollout with explicit go/no-go/rollback.
- Provide auditable sign-off checklist and evidence expectations.

## 3. Pre-Release Verification Commands

Run from project root:

```bash
npm --prefix backend run check
npm --prefix backend run build
npm --prefix backend run test
npm --prefix backend run test:compliance
```

## 4. Release Branch And Tag (Suggested)

```bash
git checkout -b codex/release-wave1-2026-03-09
# apply commit plan above
git tag -a v0.2.0-wave1 -m "Wave 1 pilot release"
```

## 5. Required Manual Inputs Before Go-Live

- Fill real contact names/phones in `HALL_PILOT_RUNBOOK.md`.
- Fill hall id/name and approvers in `WAVE1_GO_NO_GO_SIGNOFF_2026-03-09.md`.
- Ensure branch protection requires `Compliance Gate`.
