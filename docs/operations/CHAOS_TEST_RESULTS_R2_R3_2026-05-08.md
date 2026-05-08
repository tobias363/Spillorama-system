# Chaos-test-resultater — R2 + R3

**Dato:** 2026-05-08
**Test-runner:** AI-agent (Opus 4.7)
**Infrastruktur:** docker-compose lokalt (`infra/chaos-tests/`)
**Mandat-ref:** [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §6.1 (pilot-go-live-gating)

---

## TL;DR

| Test | Status | Pilot-blokker? |
|---|---|---|
| R2 — Failover-test (BIN-811) | **BLOCKED** — kunne ikke kjøres | Ja, indirekte |
| R3 — Klient-reconnect-test (BIN-812) | **BLOCKED** — kunne ikke kjøres | Ja, indirekte |

**Begge tester er blokkert av en infrastruktur-feil i `infra/chaos-tests/docker-compose.chaos.yml` + `apps/backend/Dockerfile`.** Den underliggende arkitekturen (failover-flyt, reconnect-flyt) er ikke testet og dermed ikke verifisert. **Pilot-go-live er ikke godkjent på R2/R3 etter denne kjøringen.**

Strukturelt arkitektur-problem? **Ukjent — testene fikk ikke gjøre jobben sin.** Vi vet ikke om kjernen er trygg eller utrygg før infra-feilen er løst og testene faktisk har kjørt.

---

## R2 — Failover-test (BIN-811)

**Status:** BLOCKED — kunne ikke kjøres pga. infra-feil.

### Hva som ble forsøkt

1. Pre-flight: `jq`, `curl`, `docker-compose`, `node`, `npm`, `docker info` — alle OK.
2. Opprettet `apps/backend/.env.production` (manglet i repo) med strict-mode-kompatible secrets.
3. Opprettet symlink `.claude/apps → .claude/worktrees/<id>/apps` for å løse en bonus-bug i compose-path-resolusjon (se §"Annen finding" nedenfor).
4. Kjørte `bash infra/chaos-tests/r2-failover-test.sh`.

### Hva som feilet

Docker-build av `backend-1`-image feilet under `npm ci --ignore-scripts` i `apps/backend/Dockerfile`-stage 1:

```
#9 [backend-2 builder 4/7] RUN npm ci --ignore-scripts
#9 0.840 npm error code EUSAGE
#9 0.841 npm error
#9 0.841 npm error The `npm ci` command can only install with an existing package-lock.json or
#9 0.841 npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or
#9 0.841 npm error later to generate a package-lock.json file, then try again.
[...]
target backend-1: failed to solve: process "/bin/sh -c npm ci --ignore-scripts" did not complete successfully: exit code: 1
```

### Root-cause — verifisert ved isolasjons-repro

Replikert isolert med kun `apps/backend/package.json` + `apps/backend/package-lock.json` i en clean `node:22-alpine`-container — samme feil. Lockfile-inspeksjon avdekker årsaken:

```
lockfileVersion: 3
packages keys count: 1194
first 3 keys: [
  '',
  '../../packages/shared-types',
  'node_modules/@artilleryio/int-commons'
]
```

`apps/backend/package.json` har en workspace-binding `"@spillorama/shared-types": "file:../../packages/shared-types"`. Lockfilen registrerer denne som en pakke ved relativ path `../../packages/shared-types`. Når Dockerfilen bare COPY-er `apps/backend/`-contents inn i build-context, finnes ikke `../../packages/shared-types` der — npm-ci feiler. Feilmeldingen er misvisende ("ingen lockfile") men reell årsak er **ureduserbar workspace-referanse**.

Til sammenligning: `render.yaml` (prod-deploy) bygger fra **repo-rot** med `npm install --include=dev && npm --prefix apps/backend install --include=dev && npm run build` — og fungerer fordi hele monorepo-treet er tilgjengelig.

### Konklusjon

**`apps/backend/Dockerfile` har vært inkonsistent med monorepo-strukturen siden workspace-refactoren landet, og chaos-tester har aldri kunnet bygge backend-imaget på main.** R2-failover-pathen i koden (Redis-state replay, draws-konsistens, wallet-konsistens) er **ikke verifisert** i en automatisert chaos-kjøring.

### Akseptkriterier

- [ ] **Ikke testet:** Ingen draws mistet
- [ ] **Ikke testet:** Plan-state konsistent etter failover
- [ ] **Ikke testet:** Recovery innen 30s
- [ ] **Ikke testet:** Wallet-konsistens etter SIGKILL
- [ ] **Ikke testet:** Compliance-ledger intakt

### Pilot-konsekvens

Per [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md#61-gono-go-policy-tobias-2026-05-08): **R2 må være kjørt og grønn FØR pilot-go-live-møte.** Status er ikke oppfylt — vi har verken bevis for "grønt" eller "rødt", bare "ukjent".

---

## R3 — Klient-reconnect-test (BIN-812)

**Status:** BLOCKED — kunne ikke kjøres pga. samme infra-feil som R2.

### Hva som ble forsøkt

Samme pre-flight-flyt som R2. Forsøk på å kjøre `bash infra/chaos-tests/r3-reconnect-test.sh` (default scenarioene `5 15 60` sekunder).

### Hva som feilet

R3 deler `infra/chaos-tests/docker-compose.chaos.yml` med R2 og lider av samme Docker-build-feil. Kjørte ~16 sekunder før build feilet på `npm ci`. Fra `/tmp/r3-result.log`:

```
target backend-2: failed to solve: process "/bin/sh -c npm ci --ignore-scripts" did not complete successfully: exit code: 1
```

### Root-cause

Identisk med R2 (se §R2 over).

### Akseptkriterier

- [ ] **Ikke testet:** Klient kan replay-e state etter 5s nett-glipp
- [ ] **Ikke testet:** Klient kan replay-e state etter 15s nett-glipp
- [ ] **Ikke testet:** Klient kan replay-e state etter 60s nett-glipp
- [ ] **Ikke testet:** Marks fra før disconnect mistes ikke
- [ ] **Ikke testet:** `PLAYER_ALREADY_IN_RUNNING_GAME` blokkerer ikke reconnect

### Pilot-konsekvens

Per [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md#61-gono-go-policy-tobias-2026-05-08): **R3 må være kjørt og grønn FØR pilot-go-live-møte.** Status ikke oppfylt.

---

## Annen finding — compose-path-bug (workaround in place)

`infra/chaos-tests/docker-compose.chaos.yml` bruker relative paths `../../apps/backend` for `context:` og `env_file:`. Med docker-compose v5.1.3 og verktoyets project-directory-resolution blir disse pathene tolket relativt til **prosjekt-rot (worktree-rot)**, ikke compose-filens egen plassering. Resultat:

```
env file /Users/.../.claude/apps/backend/.env.production not found
```

Det vil si: compose ser etter `../../apps/backend` fra worktree-rot = `.claude/apps/backend` (utenfor worktreet).

**Workaround for denne kjøringen:** symlink `ln -sf <worktree>/apps .claude/apps` slik at `.claude/apps/backend` peker tilbake til worktreet. Dette er en kjørings-hack, ikke en fix.

**Reell fix:** endre paths i `docker-compose.chaos.yml` til `apps/backend` (uten `../../`-prefiks) slik at de er relative til prosjekt-rot. Det er en 4-linjes endring, men jeg gjorde det IKKE per oppdrags-instruks ("ikke modifiser chaos-test-skriptene").

Selv etter denne pathen er løst, blokker Dockerfile-feilen (§R2) hovedkjøringen.

---

## Annen finding — `apps/backend/.env.production` manglet i repo

`docker-compose.yml` (rot) og `infra/chaos-tests/docker-compose.chaos.yml` `env_file:` peker mot `apps/backend/.env.production` som ikke finnes i repo. Filen er sannsynligvis i `.gitignore` for å unngå sjekking-inn av secrets — men det betyr at chaos-tests ikke kan kjøres uten manuell oppretting.

**Workaround for denne kjøringen:** opprettet `apps/backend/.env.production` med strict-mode-kompatible dummy-secrets (32+ tegn) basert på `.env.example`.

**Reell fix:** lag `apps/backend/.env.chaos` (eller bruk `apps/backend/.env.example` som template via `cp`-step) som chaos-test-skriptene kan generere ved oppstart med non-secret defaults. Tilsvarende det e2e-testen i `apps/backend/src/__tests__/e2e/Spill1FullDay.e2e.test.ts:326-328` gjør i sin egen `env`-konstruksjon.

---

## Pilot-readiness etter denne kjøringen

| R-tiltak | Status |
|---|---|
| R2 — Failover-test | **BLOCKED** (infra) |
| R3 — Klient-reconnect-test | **BLOCKED** (infra) |
| Pilot-go-live | **IKKE KLAR** for R2/R3-gating |

Dette betyr **ikke** at koden er feilaktig — vi vet rett og slett ikke fordi tester ikke har kjørt. Wallet-fundament (BIN-761→764), outbox-pattern, og REPEATABLE READ er alle på plass og brukt av rom-eventene. Men ifølge mandat-§6.1 ("ikke best effort, fikser i drift") trenger pilot-go-live faktiske grønne testkjøringer.

---

## Anbefalt fix-agent-oppdrag

Kort oppdrag (anslag 2-4 dev-timer):

1. **Fix Dockerfile for monorepo:** endre `apps/backend/Dockerfile` slik at den bygger fra repo-rot (mirror render.yaml-flyten). Alternativ: bruk multi-stage build der stage 1 kjører `npm install` på hele tre + bygger `shared-types` + `backend`, stage 2 produksjons-image kun med `apps/backend/dist/` + nødvendige `node_modules`.

2. **Fix compose-paths:** `infra/chaos-tests/docker-compose.chaos.yml` skal bruke paths relative til repo-rot (`apps/backend`, ikke `../../apps/backend`). Verifiser med `docker-compose -f docker-compose.yml -f infra/chaos-tests/docker-compose.chaos.yml config | grep context`.

3. **Auto-generate `.env.chaos`:** Legg til steg i begge chaos-skript som genererer minimum env med dummy-secrets hvis `.env.production` ikke finnes — eller dokumenter at kjørerne MÅ ha satt opp env-filen først.

4. **Re-kjør R2 + R3** og oppdater dette dokumentet med faktiske resultater.

5. **Linear-issues å opprette** (PM kan opprette via MCP):
   - "Fix chaos-test Docker build for monorepo workspaces" (BIN-???)
   - "Fix relative paths in docker-compose.chaos.yml" (samme issue eller separat)
   - Linkes mot BIN-810 (R-mandat parent), BIN-811 (R2), BIN-812 (R3)

Når disse er fikset må R2 + R3 kjøres på ny og dette dokumentet oppdateres.

---

## Output-filer fra denne kjøringen

| Fil | Innhold |
|---|---|
| `/tmp/r2-result.log` | Full stdout fra R2-skript inkl. Docker-build-feil |
| `/tmp/r3-result.log` | Full stdout fra R3-skript inkl. samme Docker-build-feil |
| `apps/backend/.env.production` | Dummy-env opprettet for kjøringen (kan slettes) |

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial. R2/R3 BLOCKED av Dockerfile-monorepo-feil. Pilot-readiness-stempel ikke satt. | AI-agent (Opus 4.7) |
