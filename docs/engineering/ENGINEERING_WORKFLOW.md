# Engineering Workflow (GitHub + Render)

This repository uses a PR-first workflow with protected `main` and automated CI/release checks.

## 1) Branch and commit model

- Never work directly on `main`.
- Create branches with prefix: `codex/<short-topic>`.
- Keep commits small and atomic.
- Use conventional commit style:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `chore(scope): ...`
  - `docs(scope): ...`

Example:

```bash
git checkout -b codex/wallet-transfer-ui
# work
git add frontend/index.html frontend/app.js frontend/style.css
git commit -m "feat(frontend): add transfer amount chooser modal"
git push -u origin codex/wallet-transfer-ui
```

## 2) Pull request flow

1. Open PR from `codex/*` to `main`.
2. Fill out `.github/pull_request_template.md`.
3. CI must be green:
   - `backend`
   - `compliance`
4. Approval policy is controlled in branch protection script:
   - full-control mode: `REQUIRED_APPROVALS=0`
   - stricter mode: `REQUIRED_APPROVALS=1` (or more)
5. Use **Squash and merge**.

## 3) Deployment flow

Recommended Render setup:

- `staging` service deploys from `staging` branch.
- `production` service deploys from `main` only.
- GitHub Actions workflows:
  - `.github/workflows/deploy-staging.yml`
  - `.github/workflows/deploy-production.yml`

Minimum production gate:

1. PR merged to `main`.
2. Render deploy starts automatically.
3. Health-check passes (`/health`).
4. Post-deploy smoke check:
   - login
   - wallet balance fetch
   - Swedbank top-up intent create
   - one game join/start flow

Setup av Render-secrets/variables er dokumentert i:

- `docs/RENDER_GITHUB_SETUP.md`

## 4) Release and rollback tracking

Tag production releases from `main`:

```bash
git checkout main
git pull
git tag v2026.03.05.1
git push origin v2026.03.05.1
```

`Release` workflow will create a GitHub Release with generated notes.

Rollback options:

- Render: redeploy previous successful deploy.
- Git: create hotfix PR or revert merge commit.

## 5) Work tracking standard

- Use GitHub Issues (templates included for bug/feature).
- Every PR must link issue/ticket.
- Every production deploy must reference:
  - merge commit SHA
  - release tag
  - health-check result
  - any incident/rollback notes

## 6) Local quality gates before push

```bash
npm --prefix apps/backend run check
npm --prefix apps/backend run test
npm --prefix apps/backend run test:compliance
npm --prefix apps/backend run build
```

> Note: The legacy Unity project lives under `legacy/unity-client/` and has its
> own test tooling. See [legacy/README.md](../../legacy/README.md) for details.

## 7) Legacy-avkobling Done-policy

**Applies only to issues in the Linear project [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a).**

Vedtatt 2026-04-17 etter senior-PM-review som avdekket at fire issues (BIN-494, 498, 501, 520) var merket Done uten at koden var merget til `main`. Dette er formalisert i BIN-534.

### Tre krav før en legacy-avkobling-task kan lukkes

1. **Commit merget til `main`.** Issues kan ikke lukkes basert på PR-åpning eller feature-branch-commit. Merge-commit-SHA må dokumenteres i en kommentar på issuen.
2. **`file:line`-bevis i ny struktur.** En kommentar med eksakt path (`apps/backend/...`, `packages/...`, `legacy/...` osv.) som viser endringen, ikke bare en generell beskrivelse.
3. **Verifiserende test er grønn i CI.** Enten ny test, eller eksisterende test oppdatert, som fanger regresjon av oppførselen. Link til CI-kjøring er anbefalt.

### Hvorfor

Spillorama er et regulert pengespillsystem. Å påstå at et kontrollpunkt er lukket uten at koden er i drift, er en revisjonsrisiko:

- Regulatorisk revisjon (Lotteritilsynet) kan kreve bevis på at funn er lukket.
- Interne audits av legacy-avkobling trenger én sannhets-kilde.
- Prosjekt-DoD ([prosjektbeskrivelse](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)) avhenger av at parity-matrix (BIN-525) er korrekt — som igjen avhenger av at Done er ekte Done.

### Hva skjer hvis en issue lukkes feilaktig

1. Reviewer/PM reåpner issuen og legger inn kommentar med kravet som mangler.
2. Prioritet kan justeres (f.eks. ned til Low hvis lite kritisk, eller opp til Urgent hvis den blokkerer release-gate).
3. Hvis mønsteret gjentar seg, eskaleres til prosjektlederen.

### PR-template

`.github/pull_request_template.md` har en egen seksjon "Legacy-avkobling Done-policy" med sjekkliste for å huske kravene.

### Retrospektiv validering

Ved prosjektets oppstart (2026-04-17) ble alle eksisterende Done-issues i prosjektet validert mot policyen. Fire ble reåpnet (BIN-494, 498, 501, 520). BIN-495 ble bekreftet OK.
