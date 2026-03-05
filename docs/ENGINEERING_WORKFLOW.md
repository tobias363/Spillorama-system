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

- `staging` service deploys from PR branch or `develop` branch.
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
npm --prefix backend run check
npm --prefix backend run test
npm --prefix backend run test:compliance
npm --prefix backend run build
```

If Unity/Candy changed, also run:

```bash
npm run check:unity
```
