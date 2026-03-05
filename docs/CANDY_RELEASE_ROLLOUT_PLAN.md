# Candy Release Rollout Plan (Chat 1)

## Branches
1. Integration branch: `codex/candy-c1-bonus-integration-step1`
2. Base branch for prod release: `main`

## Included Work
Integrasjonsbranch inkluderer:
1. Chat 1: 30-draw cap + bonus bridge + docs.
2. Chat 2: near-win/pattern visibility fixes.
3. Chat 3: realtime bonus flow + bonus payout in winning sum.

## Pre-merge QA
1. Backend checks:
```bash
npm --prefix backend run check
npm --prefix backend run build
```
2. Smoke-test etter runbook:
- `docs/CANDY_SMOKE_RUNBOOK.md`
3. Preflight for Candy launch API på deploy target:
```bash
curl -i -X POST "$CANDY_API_BASE_URL/api/games/candy/launch-token" \
  -H "Authorization: Bearer $CANDY_TEST_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Forventet: HTTP `200` + JSON payload med `launchToken`.

## Merge Order
1. Opprett PR: `codex/candy-c1-bonus-integration-step1` -> `main`
2. Review gate:
- Ingen merge-conflicts.
- Smoke-test sign-off.
3. Merge til `main`.
4. Trigger deploy på Render.
5. Kjør smoke-test i prod umiddelbart.

## Suggested Commands
```bash
git checkout main
git pull origin main
git merge --no-ff origin/codex/candy-c1-bonus-integration-step1
git push origin main
```

## Rollback Plan
Hvis prod feiler:
1. Umiddelbar app-rollback i Render til forrige grønne deploy.
2. Git rollback med revert av merge commit:
```bash
git checkout main
git pull origin main
git log --oneline -n 5
git revert -m 1 <merge_commit_sha>
git push origin main
```
3. Verifiser `/health` + Candy smoke-test etter rollback.
4. Rollback-eier må dokumentere tidspunkt + deploy-id + resultat av:
   - `GET /health`
   - `POST /api/games/candy/launch-token`
   - `POST /api/games/candy/launch-resolve`

## Post-release Validation
1. `/health` returnerer `ok:true`.
2. Candy launch fungerer for testbruker.
3. Runde avsluttes ved 30 trekk.
4. Bonus/winning oppdatering er konsistent.
5. Ingen nye kritiske feil i Render logs.
