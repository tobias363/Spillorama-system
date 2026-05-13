---
name: database-migration-policy
description: When the user/agent works with database schema migrations in the Spillorama bingo platform. Also use when they mention migration, app_*-tabell, CREATE TABLE, ALTER TABLE, schema-evolution, MED-2, idempotent migration, render-deploy, prod-migrate, ADR-0014, node-pg-migrate, fersh DB, pgmigrations, schema-arkeolog, FK-cascade, partial unique index, CHECK-constraint, deprecate-table, schema-snapshot. Defines migration ordering, idempotent CREATE+ALTER patterns, and immutability rules for prod migrations. Make sure to use this skill whenever someone touches apps/backend/migrations/ or render.yaml's buildCommand even if they don't explicitly ask for it — a single bad migration can either crash a deploy (fail-fast) or silently drift prod from code (worst case).
metadata:
  version: 1.1.0
  project: spillorama
---

<!-- scope: apps/backend/migrations/**, apps/backend/src/scripts/migrate.ts, render.yaml -->

# Database Migration Policy

## Kontekst

Spillorama bruker `node-pg-migrate` med timestamp-prefiksede SQL-filer i `apps/backend/migrations/`. Migrasjons-rekkefølge er ren leksikografisk på filnavn — `node-pg-migrate` kjører hver migrasjon i timestamp-rekkefølge og registrerer kjørte navn i `pgmigrations`-tabellen.

Render auto-migrerer ved hvert deploy som del av `buildCommand`. Hvis migrate feiler stopper deploy og prod forblir på forrige versjon (fail-fast). Tidligere drev prod-DB seg vekk fra koden i 95 pending migrations fordi migrate ikke kjørte i pipelinen — dette er nå løst, men gjør at hver enkelt migrasjon må holde mål.

To bug-typer som har tatt oss tidligere:
- **MED-2 (2026-05-06):** ALTER-migrasjon med tidligere timestamp enn sin CREATE → krasj på fersh DB. Fix: idempotent CREATE+ALTER-mønster (ADR-012).
- **Schema-archaeology (2026-04-29):** Prod hadde out-of-band-skjema som ikke matcher commit-historikken. Krever skjema-arkeolog-PR før neste deploy.

## Kjerne-arkitektur

### Filnavn-konvensjon

```
apps/backend/migrations/YYYYMMDDhhmmss_<description>.sql
```

Eksempel: `20260425000000_wallet_reservations_numeric.sql`

Reglene:

- 14-sifret timestamp-prefiks (sortable som streng).
- snake_case beskrivelse.
- `.sql` extension.
- ASCII only.

### Render build-pipeline (gjeldende fra 2026-04-26)

`render.yaml` `buildCommand`:

```
npm install --include=dev
  && npm --prefix apps/backend install --include=dev
  && npm run build
  && npm --prefix apps/backend run migrate
```

`migrate`-scriptet kaller `node-pg-migrate -d APP_PG_CONNECTION_STRING -m migrations --ignore-pattern '.*\.md$|^\..*' up`.

Fail-fast-flow:

1. Render trekker ny commit fra `main`.
2. Avhengigheter installeres + TypeScript bygges.
3. **Migrate kjører** mot `APP_PG_CONNECTION_STRING`.
4. Exit `0` → ny container starter, helsesjekkes, gammel avvikles.
5. Exit `≠ 0` → build feiler, deploy avbrytes, **app forblir på forrige versjon**.

Dette er ønsket adferd — bedre å holde forrige versjon enn å la halv-migrert DB møte prod-trafikk.

### Idempotent CREATE + ALTER (ADR-012)

For ALTER-migrasjoner som potensielt kjører før sin "kanoniske" CREATE-migrasjon (eller på en fersk DB der de skal kjøre i samme batch):

```sql
-- 20260425000000_wallet_reservations_numeric.sql (fix for MED-2)

-- Idempotent CREATE-blokk: speiler endelig skjema etter ALTER.
-- På fersk DB skapes tabellen direkte. På prod-DB der tabellen
-- allerede eksisterer, er CREATE no-op.
CREATE TABLE IF NOT EXISTS app_wallet_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC(20, 2) NOT NULL,  -- endelig type etter ALTER
  ...
);

-- ALTER-statementer kjører som-er. På fersk DB blir de no-op
-- (samme target-type). På prod-DB konverterer ALTER til endelig.
ALTER TABLE app_wallet_reservations
  ALTER COLUMN amount TYPE NUMERIC(20, 2);

-- DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT for idempotens
-- (PG støtter ikke ADD CONSTRAINT IF NOT EXISTS for navngitte).
ALTER TABLE app_wallet_reservations
  DROP CONSTRAINT IF EXISTS chk_amount_positive;
ALTER TABLE app_wallet_reservations
  ADD CONSTRAINT chk_amount_positive CHECK (amount > 0);
```

Mønsteret er anvendt i `apps/backend/migrations/20260425000000_wallet_reservations_numeric.sql`.

## Immutable beslutninger

### Aldri rename eller flytt en eksisterende migrasjon

Migrasjoner som er deployed til prod er immutable. `pgmigrations`-tabellen på prod har de nøyaktige filnavnene som `name`. Hvis du renamerer en fil:

- node-pg-migrate ser det nye navnet som ny migrasjon
- Forsøker å re-applye → krasj med "tabell finnes allerede"
- Workaround krever manuell SQL i prod for å rename i `pgmigrations` — fragilt

Fix-mønsteret når en bug oppdages: skriv en NY migrasjon med senere timestamp, eller bruk idempotent CREATE+ALTER hvis ALTER må stå i tidlig-timestamp-fil.

### CREATE skal alltid komme før ALTER (timestamp-rekkefølge)

Primær-regelen for nye migrasjoner: ALTER-migrasjonens timestamp må være **senere** enn CREATE-migrasjonens timestamp.

Hvis en ALTER ved feil får tidligere timestamp enn sin CREATE, og dette først oppdages etter deploy: bruk idempotent-mønsteret retroaktivt.

### En migrasjon = en konseptuell endring

Ikke pakk inn flere uavhengige skjema-endringer i samme fil. Dette gjør:
- Diffs vanskelig å reviewe
- Rollback umulig (rollback per fil)
- Audit-trail uleselig

Foretrekk 5 små filer over 1 stor.

### Migrate er forward-only i prod

`node-pg-migrate down` er IKKE en del av prod-flyt. Hvis en migrasjon må reverseres:

1. Skriv en NY forward-migrasjon som undoer endringen.
2. Deploy som vanlig (ny commit, fail-fast hvis den feiler).

Dette er fordi:
- Prod-data kan ikke alltid roll-backes uten data-tap.
- `down`-scripts er ofte ikke testet like grundig som `up`.
- Render auto-migrate kjører kun `up`.

### Partial unique indexes for singleton-tabeller

Spill 2 og Spill 3 har global singleton-config med kun ÉN aktiv rad globalt. Håndhevet via partial unique index:

```sql
-- apps/backend/migrations/20261213000000_app_spill2_config.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill2_config_singleton_active
  ON app_spill2_config((active))
  WHERE active = TRUE;
```

DB avviser INSERT/UPDATE som ville gi mer enn én `active=TRUE`-rad.

### CHECK-constraints — alltid med DROP IF EXISTS før ADD (fix 2026-05-09)

PR #1143 fixet pilot-blokker: ALTER TABLE som la til CHECK-constraint feilet pga existing constraint.

```sql
-- Korrekt mønster:
ALTER TABLE app_game1_master_audit
  DROP CONSTRAINT IF EXISTS app_game1_master_audit_action_check;
ALTER TABLE app_game1_master_audit
  ADD CONSTRAINT app_game1_master_audit_action_check
  CHECK (action IN ('start','pause','resume','stop','jackpot_set','finish','transfer','set_jackpot','advance'));
```

Spill 1 master-actions har **9 verdier** (CRIT-7-utvidelse 2026-05-09): `start, pause, resume, stop, jackpot_set, finish, transfer, set_jackpot, advance`.

### Deprecate-table-mønster (ADR-0017, 2026-05-09)

Når en tabell ikke lenger er i bruk men har historiske data: lag deprecate-migration som dokumenterer + freezer tabellen, ikke `DROP TABLE`:

```sql
-- 20261220000000_deprecate_game1_daily_jackpot_state.sql (ADR-0017)
COMMENT ON TABLE app_game1_daily_jackpot_state IS
  'DEPRECATED 2026-05-09 per ADR-0017 — bingovert setter jackpot manuelt. Historiske data beholdes for audit.';
```

Tabellen forblir i schema (read-only via app-laget). Rådata kan slettes i fremtidig cleanup-migration etter regulatorisk retention-periode.

### FK-cascade — default ON DELETE CASCADE (PR #1038)

Spill 1 GoH-relasjoner cascader sletting for defense-in-depth:

```sql
-- 20261216000000_app_hall_groups_cascade_fk.sql
ALTER TABLE app_hall_group_members
  DROP CONSTRAINT app_hall_group_members_group_id_fkey;
ALTER TABLE app_hall_group_members
  ADD CONSTRAINT app_hall_group_members_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES app_hall_groups(id) ON DELETE CASCADE;
```

Når en GoH slettes, fjernes alle relaterte rader automatisk. Forhindrer orphan-data og dangling references i `app_game1_scheduled_games.group_hall_id`.

### Skjema-arkeolog-policy (2026-04-29)

Hvis prod-DB har out-of-band-skjema (skapt utenom migrasjons-historikken), må dette korrigeres FØR neste vanlige deploy:

1. Identifiser divergens med skjema-archaeology-script (`docs/operations/SCHEMA_ARCHAEOLOGY_2026-04-29.md`).
2. Skriv idempotent fix-up-migrasjon som bringer prod i lock-step.
3. Deploy fix-up alene FØR den feature-PR-en som avhengig av riktig skjema.

Ellers: feature-PR-en feiler på prod selv om alle dev-CI er grønne.

### Disaster recovery: PITR krever Render Pro plan

For point-in-time-restore:
- Render Postgres `pro`-plan har PITR aktivert.
- RPO ≤ 5 min (kontinuerlig WAL-arkivering).
- RTO database-restore ≤ 2 timer (managed restore + DNS-flip).

Dette må verifiseres pre-pilot — vi har aldri test-restored prod-Postgres til en kjent timestamp (jf. `DISASTER_RECOVERY_PLAN_2026-04-25.md` §10 risiko #2).

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| ALTER med tidligere timestamp enn CREATE | "relation does not exist" på fersk DB | Idempotent CREATE+ALTER-mønster (ADR-012) |
| ADD CONSTRAINT uten DROP IF EXISTS | "constraint already exists" på re-run | Bruk DROP CONSTRAINT IF EXISTS først |
| Renamed migrasjon etter prod-deploy | "relation already exists" eller missing-migration-warning | Aldri rename — skriv ny migrasjon |
| Glemt å pushe migrasjon før deploy | Build feiler i Render med "missing migration" | Render bygger fra git — verifiser commit pushed |
| Multiple endringer i én fil | Vanskelig diff + umulig rollback | Splitt i konseptuelle enheter |
| Out-of-band SQL i prod | Neste migrasjon krasjer på "different definition" | Skjema-arkeolog-PR først |
| `ON DELETE` mangler på FK-er | Sletting av parent-rader krasjer pga FK-violation | Default `ON DELETE CASCADE` med mindre forretning sier nei |

## Kanonisk referanse

- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — flyt + fail-håndtering
- [ADR-0014 — Idempotente migrasjoner](../../../docs/adr/0014-idempotent-migrations.md) — CREATE TABLE IF NOT EXISTS før ALTER (MED-2)
- [ADR-0017 — Fjerne daglig jackpot-akkumulering](../../../docs/adr/0017-remove-daily-jackpot-accumulation.md) — deprecate-table-mønster
- `apps/backend/migrations/20260425000000_wallet_reservations_numeric.sql` — idempotent CREATE+ALTER referanse-implementasjon
- `apps/backend/migrations/20261213000000_app_spill2_config.sql` — partial unique index for singleton
- `apps/backend/migrations/20261216000000_app_hall_groups_cascade_fk.sql` — FK CASCADE-pattern
- `apps/backend/migrations/20261220000000_deprecate_game1_daily_jackpot_state.sql` — deprecate-pattern
- `apps/backend/migrations/20261222000000_game1_stuck_recovery.sql` — ADR-0022 stuck-game-recovery support
- `docs/operations/SCHEMA_ARCHAEOLOGY_2026-04-29.md` — out-of-band-skjema-fix
- `docs/operations/SCHEMA_CI_RUNBOOK.md` — CI-validering av migrasjoner
- `docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md` §4 — PITR-prosedyre
- `docs/auto-generated/DB_SCHEMA_SNAPSHOT.md` — auto-generert snapshot av alle 161 tabeller
- `docs/auto-generated/MIGRATIONS_LOG.md` — kronologisk migration-log
- `render.yaml` — buildCommand som auto-kjører migrate

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial — idempotent CREATE+ALTER + skjema-arkeolog |
| 2026-05-13 | v1.1.0 — la til partial unique index-mønster (singleton-config), CHECK-constraint DROP-FIRST (CRIT-7), deprecate-table-mønster (ADR-0017), FK-CASCADE-pattern (PR #1038), auto-genererte snapshot-referanser |

## Når denne skill-en er aktiv

- Skrive ny migrasjon (CREATE TABLE, ALTER TABLE, INDEX, FK)
- Reviewe en migration-PR fra annen agent
- Feilsøke "relation does not exist" på fersk DB (ADR-012-mønster)
- Verifisere at en migrasjon er idempotent for å trygt re-runs
- Vurdere om en endring krever skjema-arkeolog-PR først
- Endre `render.yaml` buildCommand
- Endre `apps/backend/package.json` migrate-script
- Pre-pilot DR-drill (test-restore til kjent timestamp)
- Diskutere migration-rollback-strategi (alltid forward-only)
