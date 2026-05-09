# Pilot Q3 2026 — prod-seeding av pilot-data

**Status:** Aktiv. Brukes ved pilot-go-live for 4 Teknobingo-haller.
**Dato:** 2026-05-09
**Eier:** Tobias Haugen
**Relaterte issues:** Pilot Q3 2026 (BIN-810 R-mandat parent)

Dette dokumentet beskriver hvordan pilot-data seedes inn i prod-DB før
pilot-go-live, og hvordan test-data ryddes etter pilot.

> **Viktig:** Selve seedingen skal gjøres av Tobias manuelt — ikke av
> agenter — fordi den rører prod-DB. Dette dokumentet beskriver hva som
> skal kjøres, hvordan å verifisere, og hvordan å rulle tilbake.

---

## 1. Hva som seedes

| Ressurs | Antall | Kilde |
|---|---|---|
| Group of Halls | 1 (`pilot-q3-2026-teknobingo`) | Ny rad |
| Master-hall-binding | Teknobingo Årnes | `app_hall_groups.master_hall_id` |
| Hall-medlemskap | 4 haller | Årnes (master) + Bodø + Brumunddal + Fauske |
| Spilleplan | 1 (`pilot-q3-2026-hovedplan`) | Ny rad, koblet til GoH |
| Plan-items | 13 | Alle 13 katalog-spill iht. SPILL_REGLER_OG_PAYOUT.md §1.4 |
| Test-spillere | 40 (10 per hall) | KYC=VERIFIED + 1000 NOK deposit |
| Bingoverter | 4 (1 per hall) | role=AGENT med primary-hall-binding |

**Pilot-haller (resolveres via slug i app_halls):**
- Teknobingo Årnes (master): slug=`arnes`, prod-id `b18b7928-3469-4b71-a34d-3f81a1b09a88`
- Teknobingo Bodø: slug=`bodo`, prod-id `afebd2a2-52d7-4340-b5db-64453894cd8e`
- Teknobingo Brumunddal: slug=`brumunddal`, prod-id `46dbd01a-4033-4d87-86ca-bf148d0359c1`
- Teknobingo Fauske: slug=`fauske`, prod-id `ff631941-f807-4c39-8e41-83ca0b50d879`

NB: Scripts resolveres hall-id run-time fra slug, så lokal dev (med
genererte UUIDs) fungerer også uten endringer.

**Test-spiller-email-format:**
- `pilot-q3-<hall-slug>-<n>@spillorama.no` (n=1..10)
- Eksempel: `pilot-q3-arnes-1@spillorama.no`

**Bingovert-email-format:**
- `pilot-q3-agent-<hall-slug>@spillorama.no`
- Eksempel: `pilot-q3-agent-arnes@spillorama.no`

**Test-data-markering:**
- Alle test-data har `compliance_data.is_test = true` og
  `compliance_data.test_marker = "pilot-q3-2026"` for senere cleanup.
- GoH og plan har `extra.is_test = true`.

---

## 2. Forutsetninger før seeding

Før seed-scriptet kan kjøres mot prod, må følgende være på plass:

### 2.1 Migrasjoner kjørt

```bash
# Lokalt (verifiser):
npm --prefix apps/backend run check
npm --prefix apps/backend run migrate

# Prod (Render kjører dette automatisk ved deploy):
# Se render.yaml — buildCommand inkluderer `npm run migrate`
```

Spesifikke migrasjoner som må være på plass:
- `20260424000000_hall_groups.sql` — `app_hall_groups` + `app_hall_group_members`
- `20261210000000_app_game_catalog_and_plan.sql` — `app_game_catalog`, `app_game_plan`, `app_game_plan_item`
- `20261214000000_app_hall_groups_master_hall_id.sql` — `master_hall_id`-kolonnen
- `20261216000000_app_hall_groups_cascade_fk.sql` — ON DELETE CASCADE for FK

### 2.2 Pilot-haller eksisterer i `app_halls`

Hallene må være seedet før seed-scriptet kjører. Kjør:

```bash
cd apps/backend
APP_PG_CONNECTION_STRING=<prod-url> npx tsx scripts/seed-halls.ts
```

Dette skriver alle 22 Teknobingo/Spillorama-haller med
`INSERT ... ON CONFLICT DO NOTHING` — trygt å re-kjøre.

### 2.3 Spillkatalog seedet

`app_game_catalog` må inneholde de 13 katalog-spillene (slug `bingo`,
`1000-spill`, `5x500`, `ball-x-10`, `innsatsen`, `jackpot`, `kvikkis`,
`oddsen-55`, `oddsen-56`, `oddsen-57`, `trafikklys`, `tv-extra`).

Du kan enten:

**Alternativ A — kjør demo-seed (også seeder Profil A og B testdata):**
```bash
cd apps/backend
APP_PG_CONNECTION_STRING=<prod-url> npm run seed:demo-pilot-day
```

> NB: demo-seed legger også inn `demo-hall-001..004` testhaller. I prod
> ønsker vi ikke disse — vurder å kjøre kun mot lokal/staging og bruke
> alternativ B for prod.

**Alternativ B — manuell admin-CRUD via UI:**
1. Logg inn som admin på `/admin/`
2. Naviger til `/admin/#/games/catalog`
3. Lag de 13 katalog-spillene iht. SPILL_REGLER_OG_PAYOUT.md §1.4

---

## 3. Kjør seed-scriptet

Tre alternativer, sortert etter foretrukket bruk:

### 3.1 TypeScript-orkestrator (anbefalt)

Validering via service-laget. Hashtag passord med scrypt. Inkluderer
spillere og bingoverter.

```bash
# Step 1: Dry-run (logger alt, skriver INGENTING):
PILOT_DRY_RUN=1 \
PILOT_TARGET=local \
APP_PG_CONNECTION_STRING=<prod-url> \
  npx tsx scripts/seed-pilot-prod-q3-2026.mts

# Step 2: Hvis dry-run ser bra ut, kjør mot prod:
PILOT_TARGET=live \
PILOT_PASSWORD='<sterkt-passord-min-12-tegn>' \
APP_PG_CONNECTION_STRING=<prod-url> \
  npx tsx scripts/seed-pilot-prod-q3-2026.mts
```

**Sikkerhetsguard:** Scriptet aborterer hvis `PILOT_TARGET=live` settes
uten `PILOT_PASSWORD` (min 12 tegn). Dette forhindrer at default-passord
(`Spillorama123!`) lekker til prod.

### 3.2 SQL-script (alternativ)

Hvis Node-runtime ikke er tilgjengelig, eller du ønsker å se nøyaktig
hva som skrives. **Inkluderer IKKE spillere/agenter** — kun GoH + plan.

```bash
psql <prod-url> -f scripts/pilot-prod-seed-q3-2026.sql
```

Spillere og agenter må deretter seedes via TypeScript-orkestratoren
(steg 3.1) eller registreres manuelt via admin-UI.

### 3.3 Kombinert kjøring (anbefalt rekkefølge)

```bash
# 1. Verifiser haller eksisterer:
APP_PG_CONNECTION_STRING=<prod-url> npx tsx apps/backend/scripts/seed-halls.ts

# 2. Verifiser game-catalog:
psql <prod-url> -c "SELECT slug FROM app_game_catalog WHERE is_active = TRUE ORDER BY slug;"

# 3. Seed pilot-data:
PILOT_TARGET=live PILOT_PASSWORD='<sterkt-passord>' \
APP_PG_CONNECTION_STRING=<prod-url> \
  npx tsx scripts/seed-pilot-prod-q3-2026.mts

# 4. Verifiser:
APP_PG_CONNECTION_STRING=<prod-url> \
  npx tsx scripts/verify-pilot-prod-q3-2026.mts
```

---

## 4. Verifikasjon

Kjør verifikasjons-scriptet etter seeding:

```bash
APP_PG_CONNECTION_STRING=<prod-url> \
  npx tsx scripts/verify-pilot-prod-q3-2026.mts
```

Output:
- `READY FOR PILOT` — alt er OK, exit-kode 0
- Liste av mangler — exit-kode 1, scriptet beskriver hva som må fikses

Verifikasjonen sjekker:
1. Alle 4 pilot-haller er aktive i `app_halls` (slug-resolve)
2. GoH eksisterer med korrekt master-hall-binding
3. GoH har 4 medlemmer
4. GamePlan eksisterer, er aktiv, koblet til GoH
5. Plan har 13 items i korrekt sekvens
6. Hver hall har 10+ test-spillere med KYC=VERIFIED + 1000 NOK
7. Hver hall har en bingovert med primary-hall-binding
8. Alle 13 katalog-slugs er aktive i `app_game_catalog`

---

## 5. Hva å gjøre hvis seed feiler

### 5.1 Pre-flight-feil

Scriptet aborterer **før** noen DB-skriving hvis:
- Pilot-haller mangler i `app_halls` → kjør `seed-halls.ts` først
- Game-catalog mangler slugs → kjør `seed:demo-pilot-day` eller seed manuelt
- `master_hall_id`-kolonne mangler → kjør migrasjoner

I disse tilfellene: fix forutsetninger og kjør seed-scriptet på nytt.

### 5.2 Mid-flight-feil

Hele seed-scriptet kjøres i én Postgres-transaksjon. Hvis en INSERT/UPDATE
feiler, ROLLBACK kjøres automatisk og DB er uendret. Sjekk feilmelding,
fiks underliggende problem (f.eks. orphan FK, schema-drift), og kjør på
nytt.

### 5.3 Verifikasjons-feil etter seeding

Hvis `verify-pilot-prod-q3-2026.mts` viser mangler:
1. Sjekk feilmeldinger — de er spesifikke om hva som mangler.
2. Re-kjør seed-scriptet — det er idempotent, så det vil korrigere
   eventuelle delvise oppdateringer.
3. Re-kjør verifikasjon for å bekrefte fix.

### 5.4 Catastrophic failure

Hvis prod-DB havner i inkonsistent tilstand:
1. Sjekk Postgres-logger for feilmeldinger (Render dashboard → Logs)
2. Sjekk om partial commit skjedde (skulle ikke skje med BEGIN/COMMIT)
3. Kjør cleanup-script (§6) for å rydde test-data
4. Kontakt Render support hvis DB-state er korrupt

---

## 6. Cleanup etter pilot

Når pilot er over, rydder vi test-data. **Pilot-hallene selv ryddes IKKE**
(de er produksjonshaller).

### 6.1 Hva som ryddes

- 40 test-spillere (`compliance_data.is_test = true` AND
  `email LIKE 'pilot-q3-%@spillorama.no'`)
- 4 bingoverter (samme filter, men `role = 'AGENT'`)
- Wallet-data tilhørende disse
- Hall-registreringer for disse spillerne
- GoH `pilot-q3-2026-teknobingo` (soft-delete via `deleted_at`)
- GamePlan `pilot-q3-2026-hovedplan` (soft-delete via `is_active = FALSE`)

### 6.2 Cleanup-script (kjør manuelt)

> **Forsiktighet:** Cleanup-scriptet eksisterer ikke ennå som ferdig
> tsx-script. Kjør manuelt mot prod via psql-skriptet under, eller bruk
> service-laget via admin-UI.

```sql
-- Cleanup pilot-q3-2026 test-data
-- KJØR I TRANSAKSJON — ROLLBACK hvis usikker

BEGIN;

-- 1. Soft-delete bingoverter (sett role til DELETED, fjern hall-binding)
UPDATE app_users
   SET role = 'DELETED',
       updated_at = now()
 WHERE role = 'AGENT'
   AND email LIKE 'pilot-q3-agent-%@spillorama.no'
   AND compliance_data->>'test_marker' = 'pilot-q3-2026';

DELETE FROM app_agent_halls
 WHERE user_id IN (
   SELECT id FROM app_users
    WHERE email LIKE 'pilot-q3-agent-%@spillorama.no'
      AND compliance_data->>'test_marker' = 'pilot-q3-2026'
 );

-- 2. Soft-delete test-spillere (anonymisering — bevarer wallet-historikk
--    for compliance, men nuller ut PII)
UPDATE app_users
   SET email = 'deleted-' || id || '@spillorama.no',
       display_name = 'Deleted Pilot User',
       phone = NULL,
       birth_date = NULL,
       role = 'DELETED',
       updated_at = now()
 WHERE role = 'PLAYER'
   AND email LIKE 'pilot-q3-%@spillorama.no'
   AND compliance_data->>'test_marker' = 'pilot-q3-2026';

-- 3. Sett hall-registreringer til INACTIVE
UPDATE app_hall_registrations
   SET status = 'INACTIVE',
       updated_at = now()
 WHERE user_id IN (
   SELECT id FROM app_users
    WHERE compliance_data->>'test_marker' = 'pilot-q3-2026'
 );

-- 4. Soft-delete GoH (bevarer historikk for plan-runs)
UPDATE app_hall_groups
   SET status = 'inactive',
       deleted_at = now(),
       updated_at = now()
 WHERE id = 'pilot-q3-2026-teknobingo';

-- 5. Deaktiver plan
UPDATE app_game_plan
   SET is_active = FALSE,
       updated_at = now()
 WHERE id = 'pilot-q3-2026-hovedplan';

-- Verifiser counts før COMMIT
DO $$
DECLARE
  remaining_players int;
  remaining_agents int;
BEGIN
  SELECT count(*) INTO remaining_players
    FROM app_users
   WHERE role = 'PLAYER'
     AND email LIKE 'pilot-q3-%@spillorama.no'
     AND compliance_data->>'test_marker' = 'pilot-q3-2026';
  SELECT count(*) INTO remaining_agents
    FROM app_users
   WHERE role = 'AGENT'
     AND email LIKE 'pilot-q3-agent-%@spillorama.no'
     AND compliance_data->>'test_marker' = 'pilot-q3-2026';

  IF remaining_players > 0 OR remaining_agents > 0 THEN
    RAISE EXCEPTION 'cleanup: % spillere + % agenter fortsatt aktive — abortere',
      remaining_players, remaining_agents;
  END IF;
END $$;

COMMIT;
```

### 6.3 Hard-delete (kun ved DPIA-krav)

Hvis Datatilsynet eller GDPR krever hard-delete (ikke anonymisering),
kontakt teknisk lead og følg retningslinjer i
`docs/compliance/GDPR_DATA_DELETION_PROCEDURE.md`.

Hard-delete krever koordinering med:
- Wallet-historikk (kan ha pengetransaksjoner — må bevares 7 år per
  bokføringsloven)
- Compliance-ledger (samme retensjonskrav)
- Audit-log (regulatorisk krav)

---

## 7. Sikkerhetsnotater

### 7.1 Passord

- Default-passord (`Spillorama123!`) brukes KUN for `PILOT_TARGET=local`.
- For prod (`PILOT_TARGET=live`): scriptet krever eksplisitt
  `PILOT_PASSWORD` (min 12 tegn) — ellers aborterer det.
- Etter seeding bør hver pilot-bruker bli bedt om å endre passord ved
  første innlogging.
- Passord blir ALDRI logget. Scrypt-hash skrives kun til DB.

### 7.2 PII

- Test-spillere har syntetiske email/navn — ingen ekte PII.
- `compliance_data.is_test = true` markerer alle test-data for cleanup.
- Birth-date er hardkodet 1990-01-01 (over 18 — KYC-validering).

### 7.3 Data-residency

- Prod-DB ligger i Render Frankfurt-region (EU).
- Test-spillere og deres wallet-historikk lagres i samme DB.
- Cleanup-prosedyren håndterer disse i tråd med GDPR.

### 7.4 Rollback-strategi

- Hele seed-scriptet kjører i én transaksjon — partial commit umulig.
- Hvis seed feiler i prod: re-kjør etter fix (idempotent).
- Hvis seed lykkes men pilot avlyses: kjør cleanup (§6).

---

## 8. Kjøre lokalt for verifisering

Før prod-kjøring, test scriptet lokalt:

```bash
# 1. Start dev-stack
cd /Users/tobiashaugen/Projects/Spillorama-system
docker-compose up -d postgres redis

# 2. Kjør migrasjoner
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run migrate

# 3. Seed haller (de 4 pilot-hallene må eksistere)
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npx tsx apps/backend/scripts/seed-halls.ts

# 4. Seed game-catalog (13 katalog-spill)
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run seed:demo-pilot-day

# 5. Dry-run pilot-seed:
PILOT_DRY_RUN=1 \
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npx tsx scripts/seed-pilot-prod-q3-2026.mts

# 6. Kjør pilot-seed lokalt:
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npx tsx scripts/seed-pilot-prod-q3-2026.mts

# 7. Verifiser:
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npx tsx scripts/verify-pilot-prod-q3-2026.mts

# 8. Test login som pilot-agent
# Åpne http://localhost:5174/admin/agent/login
#   Email:    pilot-q3-agent-arnes@spillorama.no
#   Passord:  Spillorama123!  (default for local)
```

---

## 9. Sjekkliste for Tobias før prod-kjøring

- [ ] Migrasjoner kjørt (`render.yaml` deploy gjør dette automatisk)
- [ ] 4 pilot-haller verifisert i `app_halls`:
      `arnes`, `bodo`, `brumunddal`, `fauske`
- [ ] Game-catalog verifisert: 13 slugs aktive
- [ ] PILOT_PASSWORD valgt (min 12 tegn, sterkt) og lagret sikkert
- [ ] Backup tatt av prod-DB før seeding
- [ ] Lokal dry-run kjørt og verifisert OK
- [ ] PR merget til main (denne dokumenterte seedingen)
- [ ] Tobias har logget inn på Render og kan kjøre psql/tsx mot prod-DB

Etter seeding:
- [ ] `verify-pilot-prod-q3-2026.mts` viser READY FOR PILOT
- [ ] Manuell smoke-test: login som pilot-agent, verifiser hall-kontekst
- [ ] Manuell smoke-test: login som pilot-spiller, verifiser saldo
- [ ] PILOT_PASSWORD distribuert sikkert til pilot-bingoverter (ikke
      i klartekst i Slack/email)

---

## 10. Lokal-dev-verifikasjon (gjort 2026-05-09)

Scriptene ble verifisert mot lokal dev-DB med følgende resultat:

```text
[seed-pilot-prod-q3] start
  target:    local
  schema:    public
  dry-run:   false

[1/5] Pre-flight: resolve halls via slug
  [warn] arnes/bodo/brumunddal/fauske: faktisk hall-id avviker fra
         forventet prod-id (forventet kun lokalt dev)
  [resolve-halls] 4/4 pilot-haller resolved fra slug

[2/5] Pre-flight: verify game-catalog has required slugs
  [verify-catalog] alle 12 katalog-spill finnes

[3/5] Group of Halls + master-binding
  [hall-group]      Pilot Q3 2026 — Teknobingo (id=pilot-q3-2026-teknobingo,
                    master=<arnes-id>, members=4)

[4/5] GamePlan + items (13 katalog-spill)
  [game-plan]       Pilot Q3 2026 — Hovedplan (id=pilot-q3-2026-hovedplan,
                    13 items, GoH=pilot-q3-2026-teknobingo)

[5/5] Test-spillere (10/hall) + bingoverter (1/hall)
  TOTAL: 40 test-spillere, 4 bingoverter
```

Verifikasjon mot lokal dev-DB ga `READY FOR PILOT` etter at slug-baserte
queries ble innført (initial versjon brukte hardkodede prod-UUIDs som
ikke matchet lokalt).

---

## 11. Referanser

Scripts og kilder:

- `scripts/seed-pilot-prod-q3-2026.mts` — TypeScript-orkestrator
- `scripts/verify-pilot-prod-q3-2026.mts` — verifikasjons-script
- `scripts/pilot-prod-seed-q3-2026.sql` — SQL-alternativ
- `apps/backend/scripts/seed-halls.ts` — pre-flight: hall-seed
- `apps/backend/scripts/seed-demo-pilot-day.ts` — referanse for game-catalog-seed

Doc-referanser:

- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 1-fundament
- `docs/architecture/SPILLKATALOG.md` — markedsnavn vs slugs
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — §1.4 13 katalog-spill
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — pilot-gating R1-R12

---

## 12. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-09 | Initial: pilot-prod-seed Q3 2026. Verifisert lokalt mot postgres-16. | PM-AI (Claude) |
