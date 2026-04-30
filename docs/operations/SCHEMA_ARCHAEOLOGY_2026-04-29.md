# Schema-archaeology — 2026-04-29

**Owner:** Schema-archaeology agent (read-only investigation)
**Status:** v2 (post-PM-dryrun-fixes). Inspection-script + fix-script bug-fixed. Eksekusjon fortsatt ikke utført — venter på conflict-verification i §6.1–6.4.
**Linked:**
- `docs/operations/schema-archaeology-inspect.sql` — read-only inspection, run first.
- `docs/operations/SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md` — verification queries for §6.1–6.4, run BEFORE fix-script.
- `docs/operations/schema-archaeology-fix.sql` — INSERT INTO pgmigrations, run after PM-godkjenning av conflict-verifications.
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — generic migration-deploy runbook.
- `docs/audit/DATABASE_AUDIT_2026-04-28.md` — orphan tables (DB-P2-1) confirms divergence.
- Tidligere: `ops/schema-sync-plan-2026-04-26` (branch). Ble ikke merget. Denne PR-en er en mer kirurgisk follow-up etter PR #715-incidenten.

## v2-endringer (2026-04-29)

PM kjørte dry-run mot prod og oppdaget at fix-scriptet hadde flere SQL-bugs. Detaljer:

1. **3 missing-FROM-clause-bugs** i `WITH numbered AS (...) SELECT count(*) ...` order-check-spørringene (STEP 4 og STEP 5/5b post-backdate-checks). PostgreSQL kastet `column "pos_by_run_on" does not exist` som ABORTET hele transaksjonen (uten ON_ERROR_STOP=1 gikk feilen til stderr og forsvant fra `tee`-output). Effekt: STEP 5 backdate-UPDATE ble silent skippet, og en COMMIT-kjøring ville ha registrert STEP 2-INSERTene med `run_on = now()` — uten backdate. Det ville bevart order-feilen for neste deploy.

2. **2 to_timestamp-overflow-bugs** i STEP 5 og STEP 5b parser. Original kode brukte `to_timestamp(prefix, 'YYYYMMDDHH24MISS')` som rejecter HH > 23. Men 5 migrasjoner i kode-treet har intentionally-overflowed prefiks for ordering: `20260418240000_*`, `20260418250000_*`, `20260418250100_*`, `20260418250200_*`, `20260418250300_*`. Fix: parse date som midnight + add HHMMSS som seconds-interval (250200 → 25h2m → next day 01:02).

3. **Ny STEP 0 sanity-check**: verifiserer (a) connected-DB matcher expected (default `bingo_db_64tj`, override via `-v expected_db=<name>`), (b) `pgmigrations`-tabellen har 3 forventede kolonner, (c) `pgmigrations` er ikke-tom (warning hvis empty). Aborterer med tydelig feilmelding hvis (a) eller (b) feiler.

4. **Ny conflicts-verification-doc** (`SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md`) som lister eksakt SELECT-only-spørring per §6.1–6.4 + decision-tree for å avgjøre om hver migrasjon er trygg å registrere.

Alle endringer i `docs/operations/schema-archaeology-fix.sql` og `docs/operations/SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md`. Inspect-scriptet er uendret (det fungerte korrekt).

---

## 1. Executive summary

**Symptom:** PR #715-deploy 2026-04-29 07:12 UTC feilet med:

```
Error: Not run migration 20260416000001_multi_hall_linked_draws is preceding
already run migration 20260417120000_deactivate_game4_temabingo
```

**Diagnose:** node-pg-migrate's `checkOrder()` finner mismatch mellom (a) sortert filnavn-liste fra `apps/backend/migrations/*.sql` og (b) `pgmigrations`-tabellen sortert etter `(run_on, id)`. Konkret: filen `20260416000001_multi_hall_linked_draws.sql` finnes på disk og har den eldste timestamp-prefiksen i den ikke-registrerte gruppen, men prod's `pgmigrations` har en SENERE migrasjon (`20260417120000_deactivate_game4_temabingo`) registrert. Det betyr at minst én migration mellom disse er **schema-live på prod, men ikke registrert i pgmigrations**.

**Rotsak:** To historiske mekanismer har lagt til schema uten å oppdatere `pgmigrations`:

1. **Boot-time `initializeSchema()`** i 38+ services — `CREATE TABLE IF NOT EXISTS` ved cold-boot. Adresseres av PR #715 (DB-P0-001), men før det kjørte mye DDL ut-av-bånd ved hver Render-restart i en periode der `npm run migrate` ikke kjørte i build (rettet i `1ccb65e3` 2026-04-26).
2. **Partial commit 2026-04-26 ~18:30–18:35** — under utvikling av `tools/schema-sync-2026-04-26.sql` ble 44 nye `pgmigrations`-entries og 37 nye tabeller utilsiktet committet til prod fordi `psql --single-transaction` interagerte uventet med scriptets egne `BEGIN`/`ROLLBACK` (dokumentert i `SCHEMA_SYNC_PLAN_2026-04-26.md` §11).

Som følge: prod har en pgmigrations-tabell som er en blanding av ekte registreringer og partial-commit-leftovers, mens schema-tilstanden er "stort sett komplett" men mangler enhetlig registrering.

**Konsekvens av deploy-feilen:** PR #715-imagen er ikke startet. Live service kjører fortsatt på forrige versjon. Brukerne merker ingenting. **Men:** alle nye PR-er som lander på `main` blokkeres frem til pgmigrations bringes i lock-step. ComplianceOutboxWorker-loggene som Tobias har observert er en bivirkning av den utdaterte versjonen.

**Risiko:** Lav. Fix-scriptet skriver KUN til `pgmigrations`-tabellen — ingen schema-mutasjon, ingen brukerdata-touch. Default er ROLLBACK; Tobias må eksplisitt flippe til COMMIT etter dry-run.

**Anbefaling:** Kjør inspection-script i dag. Hvis Section 6-output bekrefter sannsynlige orphan migrations, kjør dry-run av fix-script. Hvis dry-run-loggen ser fornuftig ut, flipp til COMMIT og redeploy. Total kalender-tid: ~30 minutter inkl. backup.

---

## 2. Sannsynlige orphan migrations

Disse er **mest sannsynlig** schema-live men ikke registrert. Inspection-scriptet (Section 4 + 6) bekrefter dette mot prod.

| Migration | Type | Object | Begrunnelse for at den er schema-live |
|---|---|---|---|
| `20260416000001_multi_hall_linked_draws` | TABLE | `app_hall_groups`, `app_draw_sessions`, `app_draw_session_halls`, `app_draw_session_events` | Eksplisitt navngitt i deploy-feilen. DATABASE_AUDIT_2026-04-28 §"Suspected orphans" bekrefter at `app_draw_sessions*` finnes på prod uten produsent-kode. |
| `20260417000001_ticket_draw_session_binding` | COLUMN | `game_sessions.draw_session_id` | Migrasjonen selv kommenterer "PostgresBingoSystemAdapter kaller `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` selv ved oppstart" — boot-DDL. |
| `20260417000002_static_tickets` | TABLE | `app_static_tickets` | DB-audit bekrefter den brukes av PT1-PT5 fysisk-bong-flyt på prod. |
| `20260417000003_agent_ticket_ranges` | TABLE | `app_agent_ticket_ranges` | DB-audit bekrefter aktiv bruk. |
| `20260417000004_idempotency_records` | TABLE | `app_idempotency_records` | DB-audit lister den som "Active" wallet-domene. |
| `20260417000005_regulatory_ledger` | TABLE | `app_regulatory_ledger` | Aktiv bruk på prod (§ 71-compliance ledger). |
| `20260417000006_daily_regulatory_reports` | TABLE | `app_daily_regulatory_reports` | Daglig cron generer rapporter — kan ikke kjøre uten tabellen. |
| `20260417000007_user_hall_binding` | COLUMN | `app_users.hall_id` | NB: kolonnen lages ALSO av `20260418170000_user_hall_scope` med konflikterende FK-policy. Se §6 nedenfor. |
| `20260417000008_draw_session_tickets` | TABLE | `app_draw_session_tickets` | Orphan-table (DB-P2-1). |

Inspection-scriptet (Section 4) probber alle 127 migrations-filer mot prod og rapporterer hver enkelts (schema_live, registered)-tilstand. Section 5 oppsummerer i totaler. Section 6 lister de eksakte navnene som er trygge å registrere via fix-scriptet.

---

## 3. Fix-strategi

### 3.1 Hva fix-scriptet GJØR

For hver migration i `apps/backend/migrations/` der:
- migration ER IKKE i `pgmigrations` (idempotent guard), OG
- migration's "fingerprint object" (TABLE eller COLUMN) eksisterer på prod RIGHT NOW

→ kjør `INSERT INTO pgmigrations (name, run_on) VALUES (...)`.

Etter alle INSERTs kjører STEP 5 et `UPDATE pgmigrations SET run_on = <parsed timestamp from name>` på de nye radene, slik at `(run_on, id)`-sortering og `(name)`-sortering blir like — som er nettopp det node-pg-migrate's `checkOrder()` krever.

### 3.2 Hva fix-scriptet IKKE gjør

- **Ingen DDL.** `CREATE TABLE`/`ALTER TABLE`/`DROP`/`CREATE INDEX`/`ADD CONSTRAINT` forekommer ikke. Kun `INSERT INTO pgmigrations` + idempotency-guards.
- **Ingen brukerdata-mutasjon.** Ingen `UPDATE`/`DELETE` på app-data — kun på `pgmigrations.run_on` for nye registreringer (metadata, ikke applikasjonsdata).
- **Ingen registrering av DATA-only migrations.** 15 migrations er reine `UPDATE`/`INSERT` mot data-tabeller (f.eks. `20260417120000_deactivate_game4_temabingo`, `20260421130000_purge_legacy_bingo1_no_gameslug`). Disse har ingen schema-fingerprint å probbe, og auto-registrering uten verifisering kan skjule manglende data-endringer. Tobias må håndtere disse manuelt — se §3.4.
- **Ingen reparasjon av orphan-tables (`app_draw_session_*`).** DB-P2-1 fra audit forblir åpen. Eget post-pilot-arbeid.
- **Ingen sletting av entries fra `pgmigrations`.** Hvis prod har "spøkelses-rader" (registrert men ikke på disk) flagger Section 8 i inspection-scriptet dem — men fix-scriptet rører dem ikke.

### 3.3 Hvorfor `INSERT` er trygg

Hvis schema-effekten allerede er live på prod (verifisert via `information_schema.tables`/`columns`), er det semantisk korrekt å si "denne migrasjonen har kjørt". Det vi gjør er å bringe `pgmigrations` i samsvar med faktisk schema-tilstand — ikke å hoppe over en faktisk migration-kjøring. Migration-bodyen er allerede applisert ut-av-bånd.

Hvis schema-effekten IKKE er live, hopper fix-scriptet over registreringen. Ved neste Render-deploy vil `npm run migrate up` kjøre migration-bodyen som vanlig.

### 3.4 DATA-only migrations som krever manuell verifisering

| Migration | Hva den gjør | Hvordan verifisere |
|---|---|---|
| `20260413000002_max_tickets_30_all_games` | UPDATE max-tickets på alle eksisterende games | `SELECT name, max_tickets_per_player FROM app_games;` |
| `20260417120000_deactivate_game4_temabingo` | `UPDATE app_games SET is_enabled = false WHERE slug = 'temabingo'` | `SELECT slug, is_enabled FROM app_games WHERE slug = 'temabingo';` |
| `20260418220300_audit_log_agent_actor_type` | Endrer enum/CHECK på audit-log | Verifiser at `app_audit_log.actor_type` aksepterer 'AGENT'-verdi. |
| `20260420000050_agent_tx_product_sale` | Endrer enum/CHECK på agent_transactions | Verifiser at `app_agent_transactions.action_type` aksepterer 'PRODUCT_SALE'. |
| `20260420100100_agent_tx_machine_actions` | Samme som over | Verifiser machine-action-enums. |
| `20260421000100_set_bingo_client_engine_web` | UPDATE av client-config | Verifiser feltverdier. |
| `20260421130000_purge_legacy_bingo1_no_gameslug` | DELETE av legacy-rader | Verifiser at radene er borte. |
| `20260425000000_wallet_reservations_numeric` | NUMERIC type-endring | Verifiser kolonne-type på `app_wallet_reservations`. |
| `20260429000100_drop_hall_client_variant` | `DROP COLUMN app_halls.client_variant` | `SELECT column_name FROM information_schema.columns WHERE table_name='app_halls' AND column_name='client_variant';` Skal returnere 0 rader. |
| `20260430000100_physical_tickets_scheduled_game_fk` | FK-tillegg | Verifiser FK-constraint på `app_physical_tickets`. |
| `20260724000000_game1_mini_game_mystery` | INSERT av Mystery-config | Verifiser config-rader. |
| `20260726000000_settlement_breakdown_k1b_fields` | UPDATE av settlement-skjema | Verifiser felter. |
| `20260727000001_game1_master_audit_add_transfer_actions` | Enum/CHECK-tillegg | Verifiser audit-action-enums. |
| `20261001000000_ticket_ranges_11_color_palette` | INSERT/UPDATE av farge-rad | Verifiser farge-katalog. |
| `20261103000000_default_kiosk_products` | INSERT av default produkter | `SELECT count(*) FROM app_products;` skal være > 0. |

For hver av disse: hvis verifisering bekrefter at endringen ER på prod, kjør:

```sql
-- ETTER manuell verifisering, én og én:
INSERT INTO pgmigrations (name, run_on)
SELECT '20260417120000_deactivate_game4_temabingo',
       to_timestamp('20260417120000', 'YYYYMMDDHH24MISS') AT TIME ZONE 'UTC'
WHERE NOT EXISTS (
  SELECT 1 FROM pgmigrations
  WHERE name = '20260417120000_deactivate_game4_temabingo'
);
```

Notér at `run_on` settes til parsed timestamp-prefiks for å bevare order-check-invariansen (samme strategi som STEP 5 i fix-scriptet).

---

## 4. Risk-matrix

| Risiko | Sannsynlighet | Konsekvens | Mitigering |
|---|---|---|---|
| Fix-scriptet registrerer en migration hvis schema-fingerprint er live, men en SENERE migration har endret schema bak fingerprintet | Lav | Fix-scriptet ville feilaktig si "har kjørt" for en migration som ikke kjørte komplett | Multiple migrations som rører samme objekt er sjelden i denne katalogen. Section 5 i inspection-scriptet hjelper å se mønsteret; §6 nedenfor lister kjente konflikter. |
| Render auto-deploy starter midt i fix-scriptets kjøring | Veldig lav | Race på pgmigrations | `LOCK TABLE pgmigrations IN EXCLUSIVE MODE` + Tobias koordinerer 5-min vindu med deploy-pipeline |
| Backdate av run_on bryter en eksternt-rapporterende analyse | Lav | Rapporter som joiner pgmigrations.run_on med driftsdata kan vise feilaktig "applied at" | Pgmigrations brukes kun internt av node-pg-migrate; ingen rapport bruker run_on. Verifiser via `git grep "pgmigrations" apps/`. |
| Idempotency-guard misser en kant | Veldig lav | Statement feiler, transaksjonen rulles tilbake | Default er ROLLBACK uansett — dry-run viser feilen før COMMIT |
| Inspection-scriptet feiler underveis | Veldig lav | Tobias får ufullstendig diagnose | Scriptet er strukturert med `\echo`-overskrifter; alvorlige feil stopper psql via `-v ON_ERROR_STOP=1` |
| Schema endres mellom inspect og fix | Lav | Fingerprint som var live ved inspect er ikke live ved fix | Fix-scriptet probber fingerprintet selv (samme query som inspect) før hver INSERT — selvkorrigerende |
| Order-check feiler etter COMMIT fordi backdate ikke fanget alle | Veldig lav | Neste deploy får samme order-error | STEP 4-5 i fix-scriptet rapporterer rows_out_of_order; Tobias kan kjøre ROLLBACK hvis count != 0 |

**Totalt risk-bilde:** Lavt. Fix-scriptet kjører i én transaksjon, rører kun én tabell (`pgmigrations`), default er ROLLBACK, og ingen brukerdata kommer i fare. Det verste som kan skje ved en feil er at deploy fortsatt feiler (no-op).

**Regulatory-rationale:** Schema-divergens i seg selv er ikke en compliance-risiko fordi `app_audit_log`, `app_regulatory_ledger`, `wallet_entries` og lignende append-only tabeller har sine egne hash-chains som garanterer integritet uavhengig av om en migration er registrert. Men: hvis en compliance-tabell skulle få en column-endring som ikke kjørte fordi migration ble hoppet over, ville det være alvorlig. Inspection-scriptets §1-7 dekker compliance-tabellene eksplisitt slik at vi kan verifisere før commit.

---

## 5. Steg-for-steg playbook

> **CRITICAL:** Backup prod-DB før commit. Ingen unntak.

### Six-step PM playbook (overview)

1. **inspect** — kjør `schema-archaeology-inspect.sql` (READ-ONLY)
2. **verify-conflicts** — for hver §6.1–6.4 kjør queries i `SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md` + walk decision tree
3. **decide** — basert på conflict-verifications, evt. kommentér ut rader fra fix-scriptets STEP 2 candidate-list før dry-run
4. **re-DRY-RUN fix** — kjør fix-script med `-v ON_ERROR_STOP=1`, default ROLLBACK
5. **review proposal** — Tobias verifiserer dry-run-loggen og signerer av
6. **COMMIT** — flipp ROLLBACK→COMMIT, kjør for ekte, restore script, trigger Render-deploy

### 5.1 Forutsetninger

- [ ] Tobias har lest dette dokumentet og §6 (kjente konflikter)
- [ ] Tobias har lest fix-scriptet (`docs/operations/schema-archaeology-fix.sql`)
- [ ] Tobias har lest `SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md`
- [ ] Render auto-deploy er pauset (eller koordinert vindue avtalt)
- [ ] Backup tatt (`pg_dump`)
- [ ] PROD_PG_URL eksportert i terminal
- [ ] Migrate er fortsatt enablet i `render.yaml` `buildCommand` (ikke kommenter den ut — fix-scriptet er complementær)

### 5.2 Eksekverings-rekkefølge

```bash
# 1. Backup prod-DB
export PROD_PG_URL="postgresql://...@dpg-...frankfurt-postgres.render.com:5432/...?sslmode=require"
pg_dump "$PROD_PG_URL" --no-owner --no-acl --format=custom \
  > /tmp/spillorama-pre-archaeology-$(date +%s).dump
ls -lh /tmp/spillorama-pre-archaeology-*.dump  # bekreft fil > 0 B

# 2. STEG 1: Kjør inspection-scriptet (READ-ONLY — ingen risiko)
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 \
  -f docs/operations/schema-archaeology-inspect.sql \
  | tee /tmp/schema-archaeology-inspect-$(date +%s).log

# 3. REVIEW inspection-loggen:
#    - Section 1: pgmigrations_count og public_tables_count gir baseline
#    - Section 4: scroll for "schema_live=YES + registered=NO" — disse er fix-kandidater
#    - Section 5: oppsummering — bekreft at YES/NO-kombinasjonene gir mening
#    - Section 6: eksplisitt liste av navn fix-scriptet vil registrere
#    - Section 7: app_draw_session_* skal være EXISTS (bekrefter audit-funn)

# 4. Hvis Section 6-listen er overraskende lang (>50 rader) eller inneholder
#    migrations som IKKE finnes på disk, STOPP og eskaler til Tobias.

# 5. STEG 2: Verifiser §6.1–6.4 conflicts.
#    Kjør hver SELECT-query i SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md
#    og walk decision-tree per § for å avgjøre Case A/B/C/etc.
#    Eksempel:
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 \
  -f /tmp/conflicts-6.1-app-users-hall-id.sql \
  | tee /tmp/conflicts-6.1-$(date +%s).log
# (Tilsvarende for 6.2, 6.3, 6.4 — kopier queries fra
#  SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md inn i egne files eller `psql -c`.)

# 6. STEG 3: Beslutt. For hvert STOP-utfall i 6.1-6.4, kommentér ut den
#    aktuelle migrasjonsraden i fix-scriptets STEP 2 candidate-list:
#      - §6.1 Case B → kommentér ut '20260417000007_user_hall_binding'
#                      og '20260418170000_user_hall_scope'
#      - §6.2 Case B → kommentér ut '20260424000000_hall_groups'
#      - §6.3 Case B/C → kommentér ut '20260417000005_regulatory_ledger'
#      - §6.4 Case B → kommentér ut '20260926000000_wallet_currency_readiness'
#    (Ved Case A/C der det er trygt: ingen endring, fortsett.)

# 7. STEG 4: DRY-RUN av fix-scriptet (ROLLBACK er default)
#    Default expected_db er bingo_db_64tj. Override hvis du har endret
#    DB-navn (sjelden):
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 \
  -f docs/operations/schema-archaeology-fix.sql \
  | tee /tmp/schema-archaeology-fix-dry-$(date +%s).log

# 8. STEG 5: REVIEW dry-run-loggen:
#    - STEP 0: 0.1 OK + 0.2 OK + 0.3 OK (eller WARN hvis empty)
#    - STEP 1: pgmigrations_before viser baseline
#    - STEP 2: RETURNING-output viser hver innsatte rad
#    - STEP 3: pgmigrations_after = before + antall innsatte
#    - STEP 4: rows_out_of_order > 0 = forventet (før backdate)
#    - STEP 5: rows_out_of_order = 0 = forventet (etter backdate). HVIS != 0,
#             vurder STEP 5b (opt-in) eller eskaler til Tobias.
#    - STEP 5b: skipped (1=0) by default, no-op
#    - STEP 6: ROLLBACK utført — ingen permanent endring
#    Hvis noe ser uventet ut, STOPP og eskaler.

# 9. STEG 6 — del 1: flipp scriptet fra ROLLBACK til COMMIT:
sed -i.bak 's/^ROLLBACK; -- DEFAULT/COMMIT; -- COMMITTED/' \
  docs/operations/schema-archaeology-fix.sql

# 10. STEG 6 — del 2: KJØR FOR ECHTE
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 \
  -f docs/operations/schema-archaeology-fix.sql \
  | tee /tmp/schema-archaeology-fix-commit-$(date +%s).log

# 11. Restaurer fix-scriptet (slik at git-diff viser ROLLBACK-default)
mv docs/operations/schema-archaeology-fix.sql.bak \
   docs/operations/schema-archaeology-fix.sql

# 12. (Optional men anbefalt) verifiser order-checken bestått
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 -c "
WITH numbered AS (
  SELECT name, run_on,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT count(*) FILTER (WHERE pos_by_run_on <> pos_by_name) AS rows_out_of_order
FROM numbered;
"
# Forventet output: rows_out_of_order = 0

# 13. (Optional men anbefalt for §6.3/§6.4) — re-kjør conflict-verifications
#    som post-commit smoke check. Output bør være identisk med STEG 2.
#    (Hvis det er endret, har fix-scriptet utilsiktet rørt schema —
#    rapportér umiddelbart.)

# 14. Trigger ny Render-deploy
# Via Render-dashboardet → Manual Deploy → "Clear build cache and deploy" på 'main'
# (Eller via "Redeploy" på siste failed deploy)

# 15. Følg deploy-loggen i Render. Forventet:
#     "node-pg-migrate up" kjører gjennom uten "preceding already run"-feil.
#     For DATA-only migrations som ikke ble registrert i §3.4, vil bodyen
#     re-kjøre. De er idempotente (UPDATE av eksisterende rader, eller
#     INSERT med ON CONFLICT der relevant). Verifiser at de kjører grønt.

# 16. Etter deploy: verifiser at ComplianceOutboxWorker logger stopper å throw
# (Render-loggene → Live tail på 'spillorama-system')

# 17. (Valgfritt — DATA-only registrering)
# Kjør kommandoene i §3.4 én og én etter manuell verifisering
# av hver migrasjons data-state.
```

### 5.3 Hvis dry-run viser noe uventet

**`rows_out_of_order > 0` etter STEP 5:** Det betyr at backdate ikke fanger alle inkonsistenser. Sannsynlig årsak: noen pre-eksisterende `pgmigrations`-rader har `run_on` som ikke matcher deres timestamp-prefiks (f.eks. fra partial-commit-leftovers 2026-04-26).

Fix-scriptet inkluderer en **opt-in STEP 5b** som normaliserer `run_on` for ALLE pgmigrations-rader til parsed-timestamp + per-name microsecond offset. Default er no-op (`AND 1=0`). For å aktivere:

1. ROLLBACK den nåværende kjøringen (default).
2. Editer scriptet og endre `AND 1=0` til `AND 1=1` i STEP 5b.
3. Kjør dry-run igjen og bekreft at `rows_out_of_order = 0` etter STEP 5b.
4. Hvis grønt, flipp ROLLBACK → COMMIT og kjør for ekte.

Aktivering av STEP 5b rewriter `run_on` på pre-eksisterende rader. Det er metadata-only (ikke schema, ikke brukerdata), men det endrer hvordan deploy-loggen viser "applied at"-tidspunkter for rader som ble registrert tidligere. Dette er én-veis: når run_on er rewritten, er den opprinnelige tidsstemplingen tapt fra pgmigrations. PR-bodyen bør dokumentere hvis STEP 5b aktiveres.

For å manuelt inspisere ute-av-fase-radene før beslutning:

```sql
-- INSPEKSJON: hvilke pre-eksisterende rader er ute-av-fase?
WITH numbered AS (
  SELECT name, run_on, id,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT name, run_on, pos_by_run_on, pos_by_name
FROM numbered
WHERE pos_by_run_on <> pos_by_name
ORDER BY pos_by_name;
```

Hvis det er <10 slike, kan Tobias kjøre tilsvarende UPDATE på dem også — men det er en større beslutning fordi det rewriter eksisterende registreringers `run_on`. Eskaler til PM først.

**Section 6 har 0 rader (ingen kandidater):** Det betyr enten at problemet allerede er løst, eller at fingerprint-mappingen er feil. Sannsynligvis det første hvis noen har gjort manuelt arbeid mot prod siden PR #715-feilen.

**Section 8 viser pgmigrations-rader som ikke finnes på disk:** Disse er "spøkelses-registreringer" — node-pg-migrate vil ikke feile direkte på dem (de sorteres bare på `name`), men det indikerer at noen har slettet en migration-fil. Fix-scriptet rører dem ikke; flag for separat oppfølging.

---

## 6. Kjente konflikter / advarsler

> **VIKTIG:** Hver av §6.1–6.4 har en **eksakt SELECT-only verifiserings-spørring + decision-tree** i `SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md`. Kjør disse FØR fix-scriptet. Hvis decision-tree lander på STOP-case, kommentér ut den aktuelle migrasjonsraden i fix-scriptets STEP 2 candidate-list.
>
> Sammenfatning nedenfor er kontekst og rasjonale; den OPERATIVE oppskriften er i conflicts-verification-dokumentet.

### 6.1 `app_users.hall_id` lages av to migrations

Både `20260417000007_user_hall_binding` og `20260418170000_user_hall_scope` legger til `app_users.hall_id`. De har ulik FK-policy:

- `20260417000007`: `REFERENCES app_halls(id) ON DELETE RESTRICT` + `CHECK (role = 'HALL_OPERATOR' AND hall_id IS NOT NULL OR role <> 'HALL_OPERATOR')`
- `20260418170000`: `REFERENCES app_halls(id) ON DELETE SET NULL` (ingen CHECK), kommentar: "BIN-657: IF NOT EXISTS — this migration was partially applied to dev DB during earlier failed migrate attempts"

`20260418170000`-kommentaren bekrefter at dette er en kjent re-applikasjons-historie. **Inspection-scriptet kan ikke skille de to via sin TABLE/COLUMN-fingerprint**. Tobias må manuelt verifisere FK-policy på prod:

```sql
SELECT
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'app_users'
  AND tc.constraint_type = 'FOREIGN KEY';
```

Hvis `delete_rule = 'SET NULL'`, er `20260418170000` den siste som kjørte. Hvis `RESTRICT`, er det `20260417000007`. Begge migrations-radene kan registreres uavhengig (ingen risiko — `pgmigrations` er kun en logg) men skjema-tilstanden er én av de to.

**Anbefaling:** Registrer begge via fix-scriptet (begge fingerprintene returnerer YES). Dokumentér i Linear-issue at `app_users.hall_id` har de-facto `SET NULL`-policy fra det siste kjøret. Ikke-kritisk for pilot.

### 6.2 `app_hall_groups` lages av to migrations

`20260416000001_multi_hall_linked_draws` og `20260424000000_hall_groups` lager begge `app_hall_groups`. Ulike skjemaer mellom dem (sjekk filene). Inspection-scriptet vil rapportere "schema_live=YES" for begge fordi tabellen finnes. Den faktiske skjema-tilstanden er hva-enn den siste kjørte var.

**Anbefaling:** Registrer begge. Kommentér i Linear hvilken som faktisk er aktiv (f.eks. ved å sjekke kolonner mot begge filenes definisjoner og se hvilken som matcher).

### 6.3 Compliance-tabeller har triggers

`20260417000005_regulatory_ledger` lager triggers som blokkerer `UPDATE`/`DELETE`/`TRUNCATE` på `app_regulatory_ledger`. Hvis migrasjonen kjørte ut-av-bånd via boot-DDL, har den IKKE skapt triggerne (boot-DDL i `PostgresBingoSystemAdapter` lager bare tabellen + indexer). I så fall mangler triggerne på prod, og ledgeren kan teoretisk muteres.

**Verifiser:**
```sql
SELECT trigger_name, action_orientation, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'app_regulatory_ledger';
```

Forventet: 3 triggers (UPDATE/DELETE/TRUNCATE). Hvis 0, regulatorisk-blokker aktive. Eskaler umiddelbart — fix-scriptet vil registrere migrationen som "applied" og forhindre at triggerne blir skapt ved neste deploy.

**Anbefaling før commit:** Kjør verifiserings-spørringen ovenfor. Hvis triggerne mangler, IKKE kjør fix-scriptet — i stedet la Render-deploy kjøre migrasjonen som vanlig (etter at ordering-feilen ellers er løst på en annen måte).

### 6.4 `wallet_*` tabeller har boot-DDL i PostgresWalletAdapter (PR #715)

PR #715 fikset DB-P0-001 — fjerner DROP+RE-ADD CONSTRAINT-mønsteret i `PostgresWalletAdapter.initializeSchema()`. Men før PR #715 var dette en kilde til schema-drift på `wallet_accounts`/`wallet_transactions`/`wallet_entries`. CHECK-constraints navngitt `wallet_accounts_currency_nok_only` osv. var manuelt droppet+re-applied ved hver cold-boot.

**Anbefaling:** Verifiser før commit at `wallet_accounts.currency` har CHECK-constrainten:
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.wallet_accounts'::regclass
  AND contype = 'c';
```

Hvis CHECK mangler, IKKE kjør fix-scriptet for `20260926000000_wallet_currency_readiness` — la Render-deploy kjøre den. Vi kan kommentere ut den ENE raden i fix-scriptet (eller la fingerprintet `wallet_accounts.currency` returnere YES og la migrasjonen kjøre BODYEN på neste deploy uansett, da bodyen er idempotent via `ADD COLUMN IF NOT EXISTS` + `ADD CONSTRAINT IF NOT EXISTS`).

---

## 7. Hva med PR #715-feilmeldingen spesifikt?

Fix-scriptet løser **direkte** den feilmeldingen ved å registrere `20260416000001_multi_hall_linked_draws` (og alle andre i samme tilstand) i pgmigrations. Etter STEP 5 backdate vil `(run_on, id)`-sortering matche `(name)`-sortering, og node-pg-migrate's `checkOrder()` vil passere på neste deploy.

Konkret:
- Før fix: pgmigrations har f.eks. 80 rader hvorav `20260417120000_deactivate_game4_temabingo` er der men `20260416000001_multi_hall_linked_draws` ikke. checkOrder finner mismatch.
- Etter fix (forventet): pgmigrations har 80 + ~10–20 nye rader. Backdate setter run_on til de respektive timestamp-prefikser. checkOrder ser nå at hver `migrations[i].name = runNames[i]` — passerer.

---

## 8. Anbefaling: nå eller post-pilot?

Brief sier «Vær konservativ. Hvis i tvil — STOPP og dokumenter i PR-body i stedet for å fortsette.»

**Min anbefaling:** Tobias bør gjøre dette **før neste pilot-cutover**, men IKKE rett før et pilot-vindu. Konkret:

- **Nå (i dag):** Lese PR + inspection-script. Kjøre inspection-scriptet mot prod (READ-ONLY, ingen risiko). Verifisere at Section 6 ikke har overraskelser.
- **Innen 24t:** Hvis inspection ser fornuftig ut, kjøre dry-run + commit av fix-scriptet i et 30-min vindu med backup. Verifisere at deploy går grønn.
- **Bør skje før pilot:** PR #715-deployen kan ikke nå prod uten dette fixet. Hvis fix-en ikke skjer før pilot, vil hver påfølgende main-merge sitte fast i samme order-feil.

**Hvorfor ikke utsette:** Hver dag som går uten fix låser nye PR-er ute av deploy-pipelinen. ComplianceOutboxWorker som logger feil er en bivirkning av at PR #714's commit (som introduserte tabellen `app_compliance_outbox`) ikke kjører i live-versjonen. Dette akkumulerer arbeid, og noen oppdager det ved at en compliance-rapport mangler en hall-rad.

**Hvorfor IKKE under pilot:** Hvis backup misslykkes eller dry-run viser noe uventet, må vi ROLLBACK alt — det er null-impact, men medfører ekstra pulslag i et pilot-kritisk vindu. Bedre å gjøre dette i en stille 30-min slot.

---

## 9. Verifikasjon at inspection-scriptet er read-only

**Linje-bevis:**

```sql
-- linje 31 (etter \echo-blokken):
BEGIN;
SET TRANSACTION READ ONLY;

-- siste linje før EOF:
ROLLBACK;
```

`SET TRANSACTION READ ONLY` gjør at PostgreSQL avviser ENHVER `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`COPY FROM`/`CREATE`/`ALTER`/`DROP` med feilen `ERROR: cannot execute X in a read-only transaction`. Det er en server-side enforced garanti — ikke avhengig av at scriptet selv ikke skriver.

Pluss: `ROLLBACK` på slutten dobbler-up garantien selv om en fremtidig editor av scriptet skulle prøve å fjerne `SET TRANSACTION READ ONLY`.

Inspection-scriptet er **kategorisk read-only**.

---

## 10. Output etter fix (forventet)

```
═══════════════════════════════════════════════════════════════════════════
STEP 1: Pre-flight
═══════════════════════════════════════════════════════════════════════════
 pgmigrations_before | public_tables_now | executing_role | db                       | executed_at
                  82 |               125 | bingo_db_64tj  | bingo_db_64tj            | 2026-04-29 12:00:00+00

═══════════════════════════════════════════════════════════════════════════
STEP 2: Conditional registration
═══════════════════════════════════════════════════════════════════════════
 id  | name                                                  | run_on
 124 | 20260416000001_multi_hall_linked_draws                | 2026-04-29 12:00:00+00
 125 | 20260417000001_ticket_draw_session_binding            | 2026-04-29 12:00:00+00
 ...
(N rows)
INSERT 0 N

═══════════════════════════════════════════════════════════════════════════
STEP 3: Post-flight
═══════════════════════════════════════════════════════════════════════════
 pgmigrations_after | public_tables_after
                 82+N |                125

═══════════════════════════════════════════════════════════════════════════
STEP 4: Order-check simulation (the actual node-pg-migrate gate)
═══════════════════════════════════════════════════════════════════════════
 total_rows | rows_in_agreement | rows_out_of_order
       82+N |              82+N |                 0   ← MUST be 0 for deploy to pass

═══════════════════════════════════════════════════════════════════════════
STEP 6: Final action
═══════════════════════════════════════════════════════════════════════════
ROLLBACK   ← (or COMMIT if Tobias edited the file)
```

---

## 11. Postscript: hvorfor ikke gjenbruke schema-sync-2026-04-26?

Den tidligere `tools/schema-sync-2026-04-26.sql` kjørte:
- per-statement idempotency-guards via DO-blocks
- transformerte ADD COLUMN → ADD COLUMN IF NOT EXISTS
- transformerte DROP COLUMN → DROP COLUMN IF EXISTS
- + INSERT INTO pgmigrations

Det var et **mer ambisiøst** script — det forsøkte både å (a) re-applikere migrasjonsbody-er med idempotency og (b) registrere navnene. Det var nødvendig fordi pgmigrations da hadde 52 manglende registreringer.

**Etter den partial-committen 2026-04-26 ~18:30:** 44 av de 52 ble committet til prod (per `SCHEMA_SYNC_PLAN_2026-04-26.md` §11). Status etter det er ukjent uten inspection.

**Min anbefaling:** Vår 2026-04-29-tilnærming er **mer konservativ** — vi rører ikke migration-bodyer. Hvis fingerprintet er live, registrerer vi bare. Hvis fingerprintet ikke er live, lar vi Render-deploy kjøre bodyen som vanlig.

Det er fordeler og ulemper:
- **Fordel:** Mindre kompleksitet, mindre risiko, lettere å reviewe.
- **Ulempe:** Hvis en migration har "delvis" schema-effekt (noen indexer mangler men tabellen finnes), vil fix-scriptet registrere den som "applied" og deploy-pipelinen vil aldri kjøre bodyen for å fylle de manglende indexene.

For Spillorama-tilfellet er ulempen **lav**: de fleste indexer er `CREATE INDEX IF NOT EXISTS` så gjentatt kjøring av migration-body er trygg. Men hvis det viser seg at noen indexer mangler etter fix, kan en fremtidig migration-fil legge dem til eksplisitt.

---

## 12. Vedlegg

- `docs/operations/schema-archaeology-inspect.sql` — read-only inspection
- `docs/operations/schema-archaeology-fix.sql` — INSERT-only fix (default ROLLBACK; v2 post-PM-dryrun-fixes)
- `docs/operations/SCHEMA_CONFLICTS_VERIFICATION_2026-04-29.md` — eksakte SELECT-only queries + decision-trees for §6.1–6.4 (kjør FØR fix-script)
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — generic migration-deploy
- `docs/audit/DATABASE_AUDIT_2026-04-28.md` — orphan tables (DB-P2-1)
- `apps/backend/migrations/` — 127 migration-filer
- `apps/backend/migrations/README.md` — forward-only-konvensjon (BIN-661)
