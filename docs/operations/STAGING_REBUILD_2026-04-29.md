# Staging-branch rebuild — 2026-04-29

**Status:** Utført. `staging` på origin er nå identisk med `main`.
**Autorisasjon:** Tobias (Option A) 2026-04-29.

---

## TL;DR

`staging`-branchen var to uker gammel og hadde divergert fra `main`. Den lå
på pre-monorepo flat-struktur (`frontend/`, `backend/`) mens `main` har
kanonisk `apps/`-layout. Render staging-deploy fra denne branchen ga derfor
gammel kode = ubrukelig som smoke-test-mål.

Vi har force-resatt `staging` til å matche `main` (`b2b64e6f`). De 271
unike staging-commitene er bevart i en arkiv-branch.

---

## Hva ble gjort

1. **Verifisert divergens:**
   - `git log --oneline origin/main..origin/staging | wc -l` → **271** unike på staging
   - `git log --oneline origin/staging..origin/main | wc -l` → **646** unike på main
   - Staging-tip var `6ad54858 merge: sync main fixes into staging (resolve all conflicts)`
   - Main-tip var `b2b64e6f refactor(unified-pipeline): Fase 4 — GameOrchestrator + equivalence test (#708)`

2. **Opprettet arkiv-branch:**
   ```
   git push origin refs/remotes/origin/staging:refs/heads/staging-archive-2026-04-29-pre-rebuild
   ```
   - Branch: `staging-archive-2026-04-29-pre-rebuild`
   - Tip: `6ad54858`
   - URL: https://github.com/tobias363/Spillorama-system/tree/staging-archive-2026-04-29-pre-rebuild
   - Innhold: Hele den gamle staging-historikken inkludert alle 271 unike commits.

3. **Force-reset av staging til main:**
   ```
   git push origin +refs/remotes/origin/main:refs/heads/staging
   ```
   - `staging` peker nå på `b2b64e6f` (samme som `main`).
   - Verifisert: 0 commits unike i hver retning.

---

## Hvorfor

- Render staging-deploy fyrer på push til `staging`. Den gamle staging-koden
  lå på pre-monorepo struktur og deployen var derfor verdiløs som
  smoke-test før real-money launch.
- De 271 unike commitene på gammel staging var stort sett legacy-fiks fra
  `frontend/`/`backend/`-tiden + Candy-launch-fixer som er irrelevante for
  nåværende `apps/backend`-stack.
- Arkiv-branchen er bevart hvis vi senere må arkeologisere noe spesifikt.
  Forventet bruk: 0 ganger.

---

## Render-config — handling Tobias må gjøre manuelt

Render-tjenesten `spillorama-staging` (eller hva den nå heter på Render-dashboardet)
skal **ikke** trenge endringer for at neste push til `staging` skal funke,
men sjekk følgende én gang:

### Sjekk-liste (Render dashboard)

1. **Render staging-service finnes:** `spillorama-staging` skal være satt
   opp som egen Render-service (separat fra `spillorama-system` som er prod).
   - Hvis ikke: `render.yaml` i repoet definerer KUN prod-tjenesten.
     Staging må være konfigurert manuelt i Render dashboardet (Render
     Blueprint sync gjelder bare for `spillorama-system`).

2. **Branch-binding:** Render staging-service skal være bundet til branch
   `staging`. Verifiser i Render → service settings → Build & Deploy.

3. **Build/Start-kommandoer matcher main:** Render staging-service må bruke
   samme build/start som prod (siden koden nå er identisk):
   - Build: `npm install --include=dev && npm --prefix apps/backend install --include=dev && npm run build && npm --prefix apps/backend run migrate`
   - Start: `npm --prefix apps/backend run start`
   - Hvis Render staging fortsatt har gamle pre-monorepo-kommandoer
     (eks: `npm run build && node backend/dist/index.js`), må de
     **oppdateres manuelt nå** ellers feiler første staging-deploy.

4. **Database:** Staging må ha **EGEN Postgres-instans** (`APP_PG_CONNECTION_STRING`
   må peke på en staging-DB, IKKE prod). Hvis staging ved et uhell deler
   prod-DB vil migrate-stegene i build-kommandoen kunne mutere prod-skjema.
   Sjekk dette FØR du pusher noe nytt til staging.

5. **GitHub Secrets:** Påkrevde secrets eksisterer fra før — verifiser:
   - `RENDER_STAGING_DEPLOY_HOOK_URL`
   - `RENDER_STAGING_HEALTHCHECK_URL`
   - Disse brukes av `.github/workflows/deploy-staging.yml`.

---

## Bivirkning: auto-promotering-PR

`.github/workflows/promote-staging-to-main.yml` trigger på hver push til
`staging` og oppretter automatisk en `staging → main` PR.

Etter denne rebuildet kommer det altså til å bli laget en PR der staging
allerede er identisk med main. Forventet utfall:

- PR opprettes automatisk
- Diff er **tom** → GitHub viser "no changes"
- Auto-merge (squash) kan ikke fullføres siden det ikke er noe å merge
- PR vil enten lukkes manuelt eller henge åpen til neste reelle staging-push

**Handling:** Lukk den tomme PR-en hvis den dukker opp. Ingen reell skade.

---

## Hvordan staging skal brukes fremover

Standard flyt for å smoke-teste en endring før prod:

1. **Lag/merge endringen til en feature-branch** (vanlig PR-flyt mot main).
2. **Cherry-pick eller merge feature-branchen til `staging`:**
   ```bash
   git fetch origin
   git checkout staging
   git pull
   git merge origin/<feature-branch>  # eller cherry-pick spesifikke commits
   git push origin staging
   ```
3. **Render staging deployer automatisk** via GitHub Actions
   (`deploy-staging.yml`) → Render deploy hook → healthcheck.
4. **Smoke-test** på staging-URL (samme funksjonalitet som prod, egen DB).
5. **Når smoke-test grønn:** merge feature-branchen til `main` via vanlig PR.
   Promote-workflowen oppretter også en staging→main PR automatisk, men
   den anbefalte flyten er å merge feature-branchen direkte til main.

### Når staging og main divergerer igjen

Hvis staging samler opp flere uker med endringer som aldri kommer til main
(slik den var før denne rebuilden), gjenta denne prosessen:

1. Arkiv-branch: `staging-archive-YYYY-MM-DD-pre-rebuild`
2. Force-reset: `git push origin +origin/main:refs/heads/staging`
3. Logg i denne mappen.

---

## Referanser

- Render/GitHub-oppsett: [`docs/operations/RENDER_GITHUB_SETUP.md`](./RENDER_GITHUB_SETUP.md)
- Migration deploy runbook: [`docs/operations/MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md)
- Pilot smoke-test checklist: [`docs/operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md`](./PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md)
- Arkiv-branch (staging pre-rebuild): https://github.com/tobias363/Spillorama-system/tree/staging-archive-2026-04-29-pre-rebuild
