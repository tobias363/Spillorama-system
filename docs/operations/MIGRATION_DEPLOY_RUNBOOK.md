# Migration Deploy Runbook

**Owner:** Technical lead (Tobias Haugen)
**Last updated:** 2026-04-26
**Linked:** `render.yaml` `buildCommand`, `apps/backend/package.json` (`migrate`-script), `docs/operations/ROLLBACK_RUNBOOK.md`

Denne runbooken beskriver hvordan database-migrasjoner kjører som del av Render-deploy, hva som skjer når noe feiler, og hvordan en feilende migration håndteres trygt i produksjon.

> **Bakgrunn (2026-04-26):** Tidligere kjørte ikke `npm run migrate` i Render-build-pipelinen, og prod-DB drev seg vekk fra koden. 95 pending migrations akkumulerte seg, og en spiller traff "Uventet feil i server" på Spill 1 fordi `app_user_profile_settings` aldri var blitt opprettet på prod. Etter denne endringen kjører migrate ved hver build, og en feilende migration **stopper deploy** før den nye versjonen tar over.

---

## 1. Hva skjer ved hvert deploy

`render.yaml` `buildCommand` (gjeldende fra 2026-04-26):

```
npm install --include=dev
  && npm --prefix apps/backend install --include=dev
  && npm run build
  && npm --prefix apps/backend run migrate
```

`migrate`-scriptet kaller `node-pg-migrate -d APP_PG_CONNECTION_STRING -m migrations ... up` mot prod-databasen som er pekt ut av env-var-en `APP_PG_CONNECTION_STRING` (definert i `render.yaml`, `sync: false`).

Sekvensen er:

1. Render trekker ny commit fra `main`.
2. Avhengigheter installeres.
3. TypeScript bygges (`npm run build`).
4. **Migrate kjører** — alle pending migrations i `apps/backend/migrations/` applies i rekkefølge.
5. Hvis migrate exit-koden er `0`: build lykkes, ny container starter, helsechecker, gammel container avvikles.
6. Hvis migrate exit-koden er `!= 0`: build feiler, deploy avbrytes, **app forblir på forrige versjon**.

Dette er fail-fast og er ønsket adferd — det er bedre å holde forrige versjon enn å la en halv-migrert DB møte prod-trafikk.

---

## 2. Hva skjer når en migration feiler i build

### Symptomer i Render-dashboardet

- Build-loggen viser feilen fra `node-pg-migrate` (typisk SQL-error eller transaksjonsavbrudd).
- Deploy-status: **Build failed**.
- Live service viser fortsatt forrige commit som `Live` — ingen rollback nødvendig, ingen nedetid.

### Hva er IKKE skjedd

- Den nye container-imagen er ikke startet.
- `/health` på prod treffer fortsatt forrige versjon.
- Brukerne merker ingenting.

### Hva ER skjedd

- En eller flere migrationer kan ha kjørt vellykket før den feilende. `node-pg-migrate` kjører hver migration i en transaksjon, så **den feilende selv er rullet tilbake**, men eventuelle migrationer som kjørte først er commitet til DB.
- DB-en kan dermed være delvis migrert — viktig å vite før neste forsøk.

### Verifiser DB-tilstand

```sql
-- Hvilke migrationer er applied?
SELECT name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 20;
```

Sammenlign mot filene i `apps/backend/migrations/` — den siste applied-raden + 1 er den som feilet.

---

## 3. Rull tilbake til forrige versjon (Render dashboard)

> Dette er ikke nødvendig hvis build feilet — appen er allerede på forrige versjon. Bruk dette kun hvis en deploy gikk gjennom og senere viste seg ødelagt.

1. Logg inn på [Render dashboard](https://dashboard.render.com/).
2. Velg `spillorama-system`-tjenesten.
3. Gå til **Deploys**-fanen.
4. Finn forrige `Live`-deploy.
5. Klikk **... → Redeploy**.
6. Bekreft.
7. Vent 2–3 minutter, deretter verifiser `/health` returnerer 200 og en kjent endpoint (f.eks. `/api/games`) svarer som forventet.

Render bygger ikke på nytt — den restarter forrige image. Migrate kjører **ikke** på rollback (siden buildCommand ikke kjøres), så DB-en blir værende på den nyere migrate-tilstanden. Det er trygt så lenge migrationene er reversible / additive.

Se også `docs/operations/ROLLBACK_RUNBOOK.md` for hall-spesifikk rollback (client variant flag) som er en separat mekanisme.

---

## 4. Fikse en feilende migration manuelt

Når en migration feiler i build, er framgangsmåten:

### 4.1 Identifiser hva som feilet

Les Render build-loggen. Vanlige årsaker:

| Feiltype | Eksempel | Fiks |
|---|---|---|
| Tabell finnes allerede | `relation "app_xyz" already exists` | Bruk `CREATE TABLE IF NOT EXISTS` i migration |
| Kolonne mangler i ALTER | `column "xyz" does not exist` | Sjekk om en tidligere migration faktisk har kjørt på prod |
| Constraint-conflict | `duplicate key value violates unique constraint` | Rydde data først, eller gjør constraint deferrable |
| Out-of-band schema | `relation already exists with different definition` | Skjema-arkeolog: bring legacy-DB i lock-step før neste deploy |

### 4.2 Fikse i kode

1. Lag ny branch: `git checkout -b fix/migration-<n>-<beskrivelse>`.
2. Rediger den feilende migration-filen (eller legg til en korrigerende ny en hvis den allerede er forsøkt på staging).
3. Test lokalt mot en ren DB:
   ```bash
   docker-compose down -v && docker-compose up -d postgres
   APP_PG_CONNECTION_STRING=postgres://localhost/spillorama npm --prefix apps/backend run migrate
   ```
4. Test på staging FØR prod (se §6).

### 4.3 Hvis migration allerede har kjørt vellykket på staging men feiler på prod

Det betyr prod-DB har ut-av-bånd-skjema. Da er det **ikke** trygt å bare retry — du må bringe prod og kode i samsvar:

1. Identifiser hvilke migrationer som er applied på prod (se §2).
2. Hvis prod har en tabell/kolonne som migration prøver å opprette: marker migration som applied uten å kjøre SQL:
   ```sql
   -- Manuelt på prod (kun ADMIN, kun etter verifisering):
   INSERT INTO pgmigrations (name, run_on) VALUES ('<migration-filnavn-uten-.sql>', NOW());
   ```
3. Trigger ny deploy — neste pending migration kjører nå.
4. **Skriv hendelsen i Linear** med commit-SHA, hvilken migration som ble manuelt markert, og hvorfor.

Denne manuelle prosedyren er **siste utvei** og skal kun gjøres av technical lead. Foretrukket alternativ er å lande skjema-sync-PR-en (`ops/schema-sync-plan-2026-04-26`) som bringer prod og kode i samsvar.

### 4.4 Redeploy

Etter at fixen er merget til `main`:

1. Render auto-deployer fra `main`.
2. `migrate` kjører som del av build.
3. Verifiser at deploy går grønt og `/health` svarer.
4. Sjekk at den feilende migration nå er i `pgmigrations`-tabellen.

---

## 5. Sjekkliste: skrive en ny migration

Hver migration skal være **trygg å kjøre på prod uten manuell intervensjon**. Sjekkliste:

- [ ] Bruk `IF NOT EXISTS` på `CREATE TABLE`, `CREATE INDEX`, `CREATE TYPE`.
- [ ] Bruk `IF EXISTS` på `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`.
- [ ] Bruk `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+).
- [ ] Migration er **reversibel** — `down`-blokken faktisk angrer `up`-blokken (eller dokumenter hvorfor det ikke er mulig).
- [ ] Ingen `DROP TABLE` uten advarsel og deploy-vindu — sletting av data kan ikke reverseres.
- [ ] Indekser på store tabeller (>100k rader) bruker `CREATE INDEX CONCURRENTLY` for å unngå write-lock under deploy. Merk: `CONCURRENTLY` kan ikke kjøre i en transaksjon, så slike migrationer må stå alene.
- [ ] Schema-endringer som krever data-backfill: dele i to migrationer (1: ADD COLUMN nullable, 2: backfill + NOT NULL etter at gammel kode-versjon er ute av drift).
- [ ] Testet lokalt mot ren DB.
- [ ] Testet på staging — kjør deploy mot staging, verifiser at migrate går grønt og at app starter.
- [ ] Filnavn følger konvensjon: `<timestamp>_<beskrivelse>.sql` eller `<timestamp>_<beskrivelse>.js`.
- [ ] Dokumenter eventuelle deploy-vinduskrav (f.eks. "kjør utenom åpningstid for haller") i PR-beskrivelsen.
- [ ] **Migration-rekkefølge sanity-check (BIN-778):** Hvis migrasjonen ALTER-er en tabell, verifiser at tabell-CREATE har et timestamp som er TIDLIGERE enn ALTER. `node-pg-migrate` kjører lexicographisk, så filnavn-rekkefølge = run-rekkefølge på frisk DB. Sjekk:
  ```bash
  # Finn migrasjon som opprettet tabellen
  grep -l "CREATE TABLE.*app_<navn>" apps/backend/migrations/*.sql
  # Sammenlign timestamp med din egen migrasjon
  ```
  Hvis CREATE har senere timestamp: rename din migrasjon til timestamp ETTER CREATE, eller flytt ALTER til egen migrasjon.

### Anti-mønstre å unngå

- ❌ `CREATE TABLE app_xyz (...)` uten `IF NOT EXISTS` — kræsjer hvis migration delvis har kjørt før.
- ❌ `DELETE FROM app_xyz WHERE ...` i en migration uten dokumentert datafix-grunn.
- ❌ Migration som forutsetter at prod-DB er i en spesifikk seed-tilstand uten å sjekke.
- ❌ Migration som modifiserer schema **og** seeder data i samme transaksjon — split.
- ❌ **(BIN-778)** Migration som ALTER-er en tabell som opprettes i en SENERE migrasjon (lexicographisk timestamp). Schema-CI-gate kjører på frisk shadow-DB og fanger dette, men det blokkerer PR. Når en eksisterende ALTER feilet på shadow-DB fordi tabellen opprettes senere, er fix-en å splitte ALTER-en ut til en ny migrasjon med timestamp etter CREATE — den nye migrasjonen MÅ være idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) så prod (som allerede har kjørt den opprinnelige ALTER-en) ikke regresseres.

---

## 6. Test på staging først

Før en migration når prod, skal den ha kjørt vellykket på staging:

1. Push branch til GitHub.
2. Merg til `staging`-branchen (eller bruk en feature-branch hvis staging er konfigurert til å auto-deploye fra annen kilde).
3. Render staging-tjeneste auto-bygger med samme buildCommand som prod.
4. Verifiser staging-build går grønt.
5. Sjekk `/health` på staging.
6. Eventuelt røyk-test: login, wallet-balance, game-join.
7. Først da merge til `main`.

Hvis staging-DB er signifikant forskjellig fra prod-DB (f.eks. mye mindre data eller annen seed), kan en migration lykkes på staging og feile på prod. I så fall: vurder å lage en seed-script som speiler relevant prod-tilstand i staging.

---

## 7. Eskalering

Hvis migrate har feilet på prod og du ikke kan fikse innen 30 minutter:

1. Bekreft at app fortsatt kjører på forrige versjon (`/health` returnerer 200).
2. Marker incident i Linear med tag `incident:deploy`.
3. Kontakt technical lead.
4. Hvis nye features/fixes haster: vurder å revertere PR-en som introduserte den feilende migration, slik at neste deploy går grønt igjen uten å kjøre den.

---

## 8. Referanser

- `render.yaml` — `buildCommand` med `npm run migrate`-step.
- `apps/backend/package.json` — `migrate`-script-definisjon.
- `apps/backend/migrations/` — alle migration-filer.
- `docs/operations/ROLLBACK_RUNBOOK.md` — hall-rollback (separat mekanisme).
- `docs/operations/PILOT_CUTOVER_RUNBOOK.md` — kontekst for hall-cutover.
- `node-pg-migrate` docs: https://salsita.github.io/node-pg-migrate/
