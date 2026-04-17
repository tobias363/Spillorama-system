## Summary
- 

## Scope
- [ ] apps/backend
- [ ] apps/admin-web
- [ ] packages/game-client
- [ ] packages/shared-types
- [ ] legacy/unity-client
- [ ] DevOps/CI
- [ ] docs/

## Risk
- [ ] Low
- [ ] Medium
- [ ] High

## Testing
- [ ] `npm --prefix apps/backend run check`
- [ ] `npm --prefix apps/backend run test`
- [ ] `npm --prefix apps/backend run test:compliance`
- [ ] `npm --prefix apps/backend run build`
- [ ] Manual verification completed

## Deploy Plan
- Render environment: `staging` / `production`
- Health endpoint checked: `/health`
- Rollback plan:

## Legacy-avkobling Done-policy (BIN-534)

If this PR closes a Linear issue in the **Legacy-avkobling: Game 1–5 + backend-paritet** project, all three must be true before the issue may be marked Done:

- [ ] Commit-SHA is **merged to `main`** (not only on a feature-branch). Paste the merge commit SHA in the closing comment.
- [ ] Exact `file:line` reference in the new structure (`apps/backend/...`, `packages/...`, `legacy/...`) is in the issue comment, proving the change.
- [ ] Test that verifies the behaviour is green in CI (link to CI run if possible).

"Implemented on feature-branch" is **NOT** Done. See [docs/engineering/ENGINEERING_WORKFLOW.md §7](../docs/engineering/ENGINEERING_WORKFLOW.md#7-legacy-avkobling-done-policy) for the full policy.

## Tracking
- Linear issue: 
- Release note entry:
- Screenshots/video (if UI change):
