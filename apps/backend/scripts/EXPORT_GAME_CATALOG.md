# Export Game Catalog (`export-game-catalog.ts`)

Versjons-stempler hele Spillorama spillkatalog-konfigurasjonen til en lesbar
JSON-fil i `docs/state/`. Brukes som strukturell fix for at PM (og senere
Claude-sessions / agenter) skal kunne slå opp eksakte produksjons-verdier
uten direkte DB-tilgang.

## Når kjøres dette

- Etter en katalog-endring i prod (nye varianter, justert premie, ny
  spilleplan, ny hall-gruppe).
- Før et PM-handoff der nestemann trenger en sannhets-kilde.
- Når `SPILL_DETALJER_PER_SPILL.md` har for mange ⚠️-markeringer.

Det er **ikke** ment som et live-cache-lag — backenden er fortsatt eneste
sannhet. Filen er en momentan-snapshot, signert med dato + git-commit.

## Hva eksporteres

| Tabell | Felt | Notater |
|---|---|---|
| `app_game_catalog` | alle rader (aktive + inaktive) | Sortert på `sort_order, display_name`. |
| `app_mini_games_config` | 4 singleton-konfiger | wheel, chest, mystery, colordraft |
| `app_hall_groups` + medlemmer | navn, status, hall-id+navn+nummer | Soft-slettede grupper (`deleted_at IS NOT NULL`) er ikke med. |
| `app_game_plan` + items | aktive planer | `is_active = TRUE`. Items joines mot catalog-slug. |

## Hva eksporteres IKKE (sikkerhets-policy)

- Ingen brukere, sesjoner, wallets eller transaksjoner.
- Ingen passord-hashes eller token-hashes.
- Ingen TV-tokens, hall-IP-adresser, settlement-kontoer eller andre secrets.
- Ingen runtime-state (`app_game_plan_run`, `app_game1_scheduled_games`).
- Ingen audit-loggs eller compliance-data.

Filen kan derfor sjekkes inn i git og deles i pull-requester.

## Bruk

### Lokal kjøring (mot test-DB / lokal docker-compose)

```bash
cd apps/backend
npm run export:game-config
```

Output: `docs/state/prod-game-catalog-YYYY-MM-DD.json` +
`docs/state/prod-game-catalog-LATEST.json`. Hvis det fantes en eldre
`LATEST.json`, skrives også `docs/state/prod-game-catalog-CHANGES.md`
med en kort diff.

### Kjøring mot produksjon (Render-tunnel)

Render-DB-en eksponerer ikke port 5432 utad. Bruk PostgreSQL-tunnel via
Render Shell eller midlertidig "External Database URL" som Render kan
generere for deg:

```bash
# 1) Hent connection-string fra Render dashboard
#    -> Database -> "External Connection" -> "Postgres URL"
# 2) Eksporter den lokalt (ikke commit denne!)
export APP_PG_CONNECTION_STRING="postgres://..."
# 3) Kjør eksporten
cd apps/backend
npm run export:game-config
```

Connection-stringen skal **ikke** lagres i `.env`-fila. Hver kjøring krever
at PM eksporterer den manuelt — bevisst friksjon.

### Dry-run

```bash
npm run export:game-config -- --dry-run
```

Skriver ingen filer; logger hva som ville blitt skrevet og diff-en mot
forrige snapshot.

### Auto-doc-update (eksperimentell)

```bash
npm run export:game-config -- --update-docs
```

Genererer en separat rapport-fil
`docs/architecture/SPILL_DETALJER_PER_SPILL-prod-values-YYYY-MM-DD.md`
med foreslåtte verdier for ⚠️-markeringene. **Skriver ikke direkte
inn i `SPILL_DETALJER_PER_SPILL.md`** — første versjon krever at PM
verifiserer og limer inn manuelt. (Designvalg: vi vil ikke at automatikk
skal overskrive et håndlaget regulatorisk doc før vi har sett det
oppfører seg fornuftig over flere kjøringer.)

### Annen output-mappe

```bash
npm run export:game-config -- --output-dir=/tmp/spillorama-snapshot
```

## Output-format

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-08T14:30:00.000Z",
  "exportedBy": "tobiashaugen",
  "source": {
    "dbSchema": "public",
    "gitCommit": "47da2a16…"
  },
  "notes": "Eksportert av apps/backend/scripts/export-game-catalog.ts. …",
  "gameCatalog": [
    {
      "slug": "bingo",
      "displayName": "Bingo",
      "rules": { "gameVariant": "standard" },
      "ticketColors": ["hvit", "gul", "lilla"],
      "ticketPricesCents": { "hvit": 500, "gul": 1000, "lilla": 1500 },
      "prizesCents": {
        "rad1": 10000, "rad2": 20000, "rad3": 30000, "rad4": 40000,
        "bingoBase": 100000,
        "bingo": { "hvit": 100000, "gul": 200000, "lilla": 300000 }
      },
      "prizeMultiplierMode": "auto",
      "bonusGameSlug": null,
      "bonusGameEnabled": false,
      "requiresJackpotSetup": false,
      "isActive": true,
      "sortOrder": 100,
      "createdAt": "2026-05-07T…",
      "updatedAt": "2026-05-07T…"
    }
    // ... 12 til
  ],
  "miniGameConfigs": [
    { "id": "…", "gameType": "wheel", "config": { … }, "active": true,
      "updatedAt": "…" }
    // ... 3 til
  ],
  "hallGroups": [
    {
      "id": "demo-pilot-goh",
      "name": "Demo Pilot GoH",
      "status": "active",
      "members": [
        { "hallId": "demo-hall-001", "hallName": "Demo Bingohall 1 (Master)",
          "hallNumber": 1001, "isActive": true }
        // ...
      ]
    }
  ],
  "activeGamePlans": [
    {
      "id": "…",
      "name": "Hverdagsspilleplan",
      "groupOfHallsId": "demo-pilot-goh",
      "weekdays": ["mon", "tue", "wed", "thu", "fri"],
      "startTime": "11:00:00",
      "endTime": "20:00:00",
      "items": [
        { "position": 1, "gameCatalogSlug": "bingo", "bonusGameOverride": null }
        // ...
      ]
    }
  ]
}
```

## Endringer mellom snapshots

`prod-game-catalog-CHANGES.md` skrives kun hvis det fantes en eldre
`LATEST.json` da scriptet kjørte. Den lister:

- Katalog-rader lagt til / fjernet / endret (priser, premier, bonus-flagg)
- Mini-game-konfig endret
- Aktive spilleplaner lagt til / fjernet / endret (sekvens, tid, ukedager)

For dypere diff bruker du `diff` mot tidligere datert fil:

```bash
diff docs/state/prod-game-catalog-2026-05-01.json \
     docs/state/prod-game-catalog-2026-05-08.json
```

## Feilsøking

### `Error: APP_PG_CONNECTION_STRING env var required`
Sett miljøvariabel før kjøring (se §Bruk).

### `app_game_catalog finnes ikke`
Migrasjoner er ikke kjørt på DB-en. Kjør `npm run migrate` mot riktig DB
først, eller verifiser at du peker mot en DB som har migrasjon
`20261210000000_app_game_catalog_and_plan.sql`.

### Eksporten viser 0 katalog-rader
DB-en er fersk migrert men ingen seed har kjørt. `seed:demo-pilot-day`
seeder en single-hall + 4-hall-pilot. Ekte produksjons-DB har
katalog-radene injisert manuelt av admin via `/admin/game-catalog`.

## Hvorfor scriptet er "dumt"

Scriptet gjør med vilje ingen tunge transformasjoner. Det er en
"snapshot to disk" som leser direkte fra de samme tabellene admin-UI
skriver til. Dette er bevisst:

1. Mindre risiko for at JSON-output skiller seg fra runtime-virkelighet.
2. Lett å re-implementere hvis tabell-strukturen endres (vi forventer
   ikke at scriptet overlever store skjema-omlegginger uten oppdatering).
3. PM kan forstå hele scriptet på én lesing.

Hvis vi senere trenger en mer aktiv katalog-versjons-kontroll
(f.eks. semver-bumping ved schema-endringer), kan det bygges på
JSON-formatet ved å legge til feltet `schemaVersion` (allerede satt til 1
i envelopen).
