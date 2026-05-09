## Summary
- 

## Scope
- [ ] apps/backend
- [ ] apps/admin-web
- [ ] packages/game-client
- [ ] packages/shared-types
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

## Done-policy

Before marking a Linear issue **Done**, all three must be true:

- [ ] Commit-SHA is **merged to `main`** (not only on a feature-branch). Paste the merge commit SHA in the closing comment.
- [ ] Exact `file:line` reference (`apps/backend/...`, `packages/...`) is in the issue comment, proving the change.
- [ ] Test that verifies the behaviour is green in CI (link to CI run if possible).

"Implemented on feature-branch" is **NOT** Done. See [docs/engineering/ENGINEERING_WORKFLOW.md §7](../docs/engineering/ENGINEERING_WORKFLOW.md#7-legacy-avkobling-done-policy) for the full policy.

## Architecture Decision Records (ADR)

- [ ] Hvis denne PR-en tar en beslutning som påvirker ≥ 2 agenter eller services, har en ADR blitt opprettet i `docs/adr/`? (N/A for ren bug-fix, polish, eller implementasjon av eksisterende ADR. Se `docs/adr/README.md` for når ADR kreves.)

## Tracking
- Linear issue: 
- Release note entry:
- Screenshots/video (if UI change):
