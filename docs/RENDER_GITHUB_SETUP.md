# Render + GitHub Actions Setup

Dette dokumentet beskriver minimum oppsett for automatisk staging/production deploy fra GitHub Actions.

## 1) Opprett to Render services

Anbefalt:

- `bingosystem-staging` (staging)
- `bingosystem-production` (production)

Hver service skal ha egen deploy hook URL og health endpoint.

## 2) Legg inn GitHub Secrets (repo)

På GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

Påkrevde secrets:

- `RENDER_STAGING_DEPLOY_HOOK_URL`
- `RENDER_STAGING_HEALTHCHECK_URL`
- `RENDER_PRODUCTION_DEPLOY_HOOK_URL`
- `RENDER_PRODUCTION_HEALTHCHECK_URL`

Anbefalt health-endpoint:

- `https://<service-domain>/health`

## 3) (Valgfritt) GitHub Variables for timeouts

Repo variables (`Settings` -> `Secrets and variables` -> `Actions` -> `Variables`):

- `RENDER_STAGING_WAIT_TIMEOUT_SECONDS` (default `600`)
- `RENDER_STAGING_POLL_INTERVAL_SECONDS` (default `10`)
- `RENDER_STAGING_CURL_RETRIES` (default `3`)
- `RENDER_PRODUCTION_WAIT_TIMEOUT_SECONDS` (default `900`)
- `RENDER_PRODUCTION_POLL_INTERVAL_SECONDS` (default `10`)
- `RENDER_PRODUCTION_CURL_RETRIES` (default `3`)

## 4) Workflow trigger-regler

- `Deploy Staging`:
  - trigges automatisk etter grønn `CI` på PR (`workflow_run`)
  - kan også kjøres manuelt (`workflow_dispatch`)
- `Deploy Production`:
  - trigges automatisk etter grønn `CI` på `main`
  - kan også kjøres manuelt (`workflow_dispatch`)

## 5) Sikkerhet

- Branch protection på `main` må være aktiv.
- Required checks må minst inkludere:
  - `backend`
  - `compliance`
- Sett GitHub Environment protection for `production` med required reviewers hvis ønskelig.

## 6) Verifisering etter oppsett

1. Lag en test-PR fra `codex/*`.
2. Verifiser at `CI` blir grønn.
3. Verifiser at `Deploy Staging` starter og passerer healthcheck.
4. Merge PR til `main`.
5. Verifiser at `Deploy Production` starter og passerer healthcheck.
