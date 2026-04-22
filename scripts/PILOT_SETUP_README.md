# Pilot-test rigging — kjøreguide

Disse scriptene setter opp og river ned en minimal pilot-konfigurasjon for
live-test av Spill 1 med 4 haller i én hall-gruppe.

| Script                          | Formål                                                 |
| ------------------------------- | ------------------------------------------------------ |
| `seed-pilot-halls.mts`           | Oppretter 4 pilot-haller + 1 hall-gruppe (idempotent). |
| `seed-pilot-game-plan.mts`       | Oppretter 3 test-GameManagement-rader (morgen/lunsj/kveld). |
| `pilot-teardown.mts`             | Soft-sletter alt pilot-data (idempotent).              |

## Forutsetninger

- Postgres kjører og er migrert (`npm --prefix apps/backend run migrate`).
- `APP_PG_CONNECTION_STRING` peker på samme DB som backend vil bruke.
- Node 22 + `npm install` kjørt i repo-rot.
- `npm run build:types` kjørt (shared-types må være bygget for `tsx` å løse imports).

## Kjent blocker (pre-existing, IKKE fikset her)

`HallGroupService.loadMembers()` (apps/backend/src/admin/HallGroupService.ts:577)
spør etter `app_halls.status` som **ikke eksisterer** i `app_halls`-schemaet
(kun `is_active` finnes, se PlatformService.ts:3575-3588). Scriptene vil
feile på hall-gruppe-opprettelse hvis denne kolonnen mangler.

**Workaround inntil fix er merget:**

```sql
ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
```

Kjør én gang mot DB-en før `seed-pilot-halls.mts`. Denne workarounden er
ikke-destruktiv (DEFAULT 'active' for eksisterende rader). En ekte fix
burde enten:
1. Oppdatere `HallGroupService.loadMembers()` til å referere `h.is_active`,
   eller
2. Legge til `status`-kolonne i PlatformService.initializeSchema()
   som speiler `is_active`.

Flagg dette som en egen issue til PM.

## Quickstart (5 minutter)

```bash
# 1) Sett opp pilot-haller + hall-gruppe
APP_PG_CONNECTION_STRING="postgres://..." \
  npx tsx scripts/seed-pilot-halls.mts

# 2) Sett opp test-GameManagement-rader
APP_PG_CONNECTION_STRING="postgres://..." \
  npx tsx scripts/seed-pilot-game-plan.mts

# 3) Start backend + admin-web som normalt
npm run dev                 # backend
npm run dev:admin           # admin-UI

# 4) Kjør QA-prosedyren i docs/qa/PILOT_QA_GUIDE_2026-04-22.md
```

## Dry-run (ingen DB-skriving)

Sett `PILOT_DRY_RUN=1` for å se hva scriptet ville gjort uten å skrive:

```bash
PILOT_DRY_RUN=1 APP_PG_CONNECTION_STRING="postgres://..." \
  npx tsx scripts/seed-pilot-halls.mts
```

## Live-DB (forsikring)

Scriptene tillater target=live kun når `PILOT_TARGET=live` settes eksplisitt.
Selv da matcher alle operasjoner på slug-prefix `pilot-` så produksjonsdata er
urørt:

```bash
PILOT_TARGET=live PILOT_CREATED_BY="tobias" \
  APP_PG_CONNECTION_STRING="postgres://live-db-url" \
  npx tsx scripts/seed-pilot-halls.mts
```

## Rollback

```bash
APP_PG_CONNECTION_STRING="postgres://..." \
  npx tsx scripts/pilot-teardown.mts
```

Teardown gjør soft-delete:
- GameManagement-rader: `deleted_at` settes, `status=inactive`
- Hall-gruppe: `deleted_at` settes, `status=inactive`
- Pilot-haller: `is_active=false` (data bevares i DB)

Vil du purge helt? Kjør manuell SQL mot `app_halls`, `app_hall_groups` og
`app_game_management` — men da mister du historikk, så dobbeltsjekk først.

## Pilot-hallene som opprettes

| Slug              | Navn              | Region |
| ----------------- | ----------------- | ------ |
| `pilot-notodden`  | Notodden Pilot    | NO     |
| `pilot-skien`     | Skien Pilot       | NO     |
| `pilot-porsgrunn` | Porsgrunn Pilot   | NO     |
| `pilot-kragero`   | Kragerø Pilot     | NO     |

Alle fire blir medlem av hall-gruppen **"Pilot-Link (Telemark)"**.

## GameManagement-radene som opprettes

| Tid    | Navn                           | Ticket-pris | Variant                              |
| ------ | ------------------------------ | ----------- | ------------------------------------ |
| 09:00  | Pilot Morgen-bingo             | 10 kr       | Standard 5-fase, faste premier       |
| 12:00  | Pilot Lunsj-bingo (Elvis)      | 15 kr       | Elvis-bonger + per-farge-premier     |
| 18:00  | Pilot Kveld-bingo (Jackpot)    | 20 kr       | Per-farge-jackpot (hvit/gul/lilla)   |

Alle får `startDate = i dag`, `endDate = i dag 23:59` og `status=active` slik
at de vises i master-konsollet umiddelbart.

## Kontakt ved problemer

- **Teknisk blocker:** legg commit-meldingen i PM-kanalen, tag `@Tobias`.
- **DB i ulage:** kjør `pilot-teardown.mts`, deretter `seed-pilot-halls.mts`
  + `seed-pilot-game-plan.mts` på nytt. Scriptene er idempotente.
- **Kvikkis / Spill 2 / 3:** ikke del av pilot — kun Spill 1 i dag.

Se `docs/qa/PILOT_QA_GUIDE_2026-04-22.md` for steg-for-steg QA-prosedyre.
