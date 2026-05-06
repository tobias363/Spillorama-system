# ADR-012: Idempotente migrasjoner — CREATE TABLE IF NOT EXISTS før ALTER

**Status:** Accepted
**Dato:** 2026-05-06
**Forfatter:** Tobias Haugen (MED-2 fix-runde)
**Driver:** Lokal-dev-bug på fersk DB; node-pg-migrate krasjet med "relation does not exist" fordi en ALTER-migrasjon hadde tidligere timestamp enn den CREATE-migrasjonen den endret.

## Kontekst

Spillorama bruker `node-pg-migrate` med timestamp-prefiksede SQL-filer i `apps/backend/migrations/`. Migrasjons-rekkefølgen er ren leksikografisk på filnavn — `node-pg-migrate` kjører hver migrasjon i timestamp-rekkefølge og registrerer kjørte navn i `pgmigrations`-tabellen.

På prod er rekkefølgen ikke et problem så lenge alle filer applies *kontinuerlig*: hver gang et Render-deploy kjører, kjøres kun nye migrasjoner siden forrige deploy. Men på **fersk DB** (utvikler som starter `docker compose up` for første gang) kjøres alle migrasjoner i én batch fra ingenting — og da må timestamp-rekkefølgen matche faktisk avhengighets-rekkefølge.

Bugen 2026-05-06 (MED-2): `20260425000000_wallet_reservations_numeric.sql` (april) ALTER-et tabellen `app_wallet_reservations`, men tabellen ble først skapt i `20260724100000_wallet_reservations.sql` (juli). På prod fungerte det fordi tabellen allerede eksisterte fra en tidligere kjøring. På fersk DB feilet `npm run migrate` med:

```
ERROR: relation "app_wallet_reservations" does not exist
```

Vi kunne ikke renamere filen: `pgmigrations` på prod har allerede `20260425000000_wallet_reservations_numeric` registrert som applied. Hvis vi renamerer fila, ville node-pg-migrate anse det som en helt ny migrasjon og prøve å re-applye den.

## Beslutning

**Mønster: «Idempotente migrasjoner — CREATE TABLE IF NOT EXISTS før ALTER.»**

Hver ALTER-migrasjon som potensielt kjører før sin "kanoniske" CREATE-migrasjon (eller på en fersk DB der de skal kjøre i samme batch) skal:

1. **Inkludere en `CREATE TABLE IF NOT EXISTS`** øverst med skjemaet *etter* ALTER. På fersk DB skapes tabellen direkte med endelig skjema. På prod-DB der tabellen allerede eksisterer, er CREATE no-op.
2. **La ALTER-statementene stå** som-er. På fersk DB blir `ALTER COLUMN ... TYPE` no-op (samme target-type). På prod-DB konverterer ALTER eksisterende skjema til endelig skjema.
3. **Bruke `DROP CONSTRAINT IF EXISTS` foran `ADD CONSTRAINT`** for navngitte constraints, slik at re-runs ikke krasjer (PG støtter ikke `ADD CONSTRAINT IF NOT EXISTS`).
4. **Holde skjema-ene synkronisert.** Den autoritative CREATE-migrasjonen forblir den senere fila; ALTER-migrasjonens defensive CREATE må manuelt holdes synkronisert med den når nye kolonner/indekser legges til.

Mønsteret er anvendt i `apps/backend/migrations/20260425000000_wallet_reservations_numeric.sql`.

For nye migrasjoner gjelder:

- ALTER-migrasjoner skal alltid ha *senere* timestamp enn sin CREATE-migrasjon. Dette er primær-regelen.
- Hvis en ALTER ved en feil får tidligere timestamp enn sin CREATE (eller hvis ordensfeilen først oppdages etter at filen er deployet til prod), bruk dette mønsteret som retroaktiv fix istedenfor å renamere filen.

## Konsekvenser

**Positive:**
+ Fersk-DB-flyt fungerer: `docker compose up && npm run migrate` på et tomt skjema kjører clean.
+ Prod-DB-state bevares: `pgmigrations`-tabellen rør ikke; ingen migrasjoner re-applies.
+ Mønsteret er enkelt å anvende defensivt: alle ALTER-migrasjoner kan skrives med `CREATE TABLE IF NOT EXISTS` foran uten skade på prod.

**Negative:**
- Den defensive `CREATE TABLE IF NOT EXISTS` duplikerer skjemaet fra den senere CREATE-migrasjonen. Hvis den senere migrasjonen får nye kolonner, må vi huske å oppdatere den defensive også (eller akseptere at fersk DB får et delvis skjema som korrigeres senere). Vi har lagt til en kommentar i den fix-ede migrasjonen som påminner om dette.

**Nøytrale:**
~ Migrasjons-filer blir litt lengre på grunn av den defensive CREATE-blokken.
~ Lint kan fange ALTER-før-CREATE-bugs i fremtiden — se `Operasjonelt`.

## Alternativer vurdert

1. **Rename `20260425` til `20260725` (etter CREATE).** Avvist:
   - `pgmigrations` på Render har allerede registrert `20260425000000_wallet_reservations_numeric` som applied.
   - Rename ville få node-pg-migrate til å se det nye filnavnet som ny migrasjon → forsøk på re-apply → feil siden ALTER allerede er gjort.
   - Workaround ville kreve en manuell SQL i prod for å rename i `pgmigrations` — fragilt.

2. **Slett 20260425-filen og inline endringene i 20260724.** Avvist:
   - Samme problem: prod har allerede 20260425 i `pgmigrations`. Sletting ville få neste deploy til å spørre seg om en migrasjon som "burde være kjørt" plutselig ikke finnes.
   - Brudd med immutable-migration-prinsipp.

3. **Skriv en separat "fix-up"-migrasjon (ny timestamp etter 20260724).** Avvist:
   - Løser ikke fersh-DB-problemet — 20260425 ville fortsatt feile før fix-en kjører.

4. **Gjør 20260425 helt tom (`-- noop on prod`) og inline ALTER inn i 20260724.** Avvist:
   - 20260724 har sin egen CREATE — vi ville lagt en ALTER inne i en CREATE-migrasjon, som er rart å lese.
   - Brudd med "én migrasjon = én konseptuell endring".

## Operasjonelt

**For framtidige migrasjoner:**

Følg disse reglene når du skriver ALTER-migrasjoner:

- Sjekk at filnavn-timestamp er *etter* CREATE-migrasjonens timestamp.
- Hvis du må endre en tabell skapt i en senere migrasjon (som denne bugen), bruk det idempotente mønsteret beskrevet over.
- Bruk `DROP CONSTRAINT IF EXISTS` før `ADD CONSTRAINT <name>` for å gjøre constraint-changes idempotente.
- Bruk `CREATE INDEX IF NOT EXISTS` for indekser.

**Lint-script (anbefalt fremover):**

`scripts/check-migration-order.sh` (ikke implementert i denne fix-PR-en — kan legges til som separat PR):

```bash
#!/bin/bash
# Scan apps/backend/migrations/ for ALTER-before-CREATE bugs.
python3 - <<'EOF'
import os, re, glob, sys
files = sorted(glob.glob("apps/backend/migrations/*.sql"))
table_create = {}
table_alter = {}
for f in files:
    fname = os.path.basename(f)
    content = re.sub(r'--[^\n]*', '', open(f).read())
    for m in re.finditer(r'CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)', content, re.I):
        table_create.setdefault(m.group(1).lower(), fname)
    for m in re.finditer(r'ALTER TABLE(?:\s+IF EXISTS)?\s+(\w+)', content, re.I):
        t = m.group(1).lower()
        if t in ('if', 'foo'): continue
        table_alter.setdefault(t, fname)
issues = [(t, a, table_create[t]) for t, a in table_alter.items() if t in table_create and table_create[t] > a]
if issues:
    for t, a, c in issues:
        print(f"BUG: ALTER ({a}) before CREATE ({c}) for table {t}")
    sys.exit(1)
print("OK")
EOF
```

**Sjekkliste når MED-2-mønsteret anvendes:**

- [ ] Defensiv `CREATE TABLE IF NOT EXISTS` lagt til øverst med endelig skjema.
- [ ] `DROP CONSTRAINT IF EXISTS` foran enhver `ADD CONSTRAINT` for å gjøre re-runs trygge.
- [ ] Fresh-DB-test: `docker compose down -v && docker compose up -d postgres && npm --prefix apps/backend run migrate` kjører clean.
- [ ] Prod-state-test: lag en test-DB hvor tabellen er pre-skapt med gammelt skjema (eks BIGINT), kjør migrate, verifiser at ALTER konverterer til nytt skjema og data-rader er bevart.
- [ ] Idempotency-test: re-kjør hele migrate-batch — skal være no-op andre gang.
- [ ] Kommentar i migrasjons-filen som peker til ADR-012 og forklarer mønsteret.

## Referanser

- [`apps/backend/migrations/20260425000000_wallet_reservations_numeric.sql`](../../apps/backend/migrations/20260425000000_wallet_reservations_numeric.sql) — fix anvendt
- [`apps/backend/migrations/20260724100000_wallet_reservations.sql`](../../apps/backend/migrations/20260724100000_wallet_reservations.sql) — autoritativ CREATE
- [`docs/operations/LOCAL_DEV_QUICKSTART.md`](../operations/LOCAL_DEV_QUICKSTART.md) — Troubleshooting-seksjon oppdatert
- node-pg-migrate dokumentasjon: <https://salsita.github.io/node-pg-migrate/>
