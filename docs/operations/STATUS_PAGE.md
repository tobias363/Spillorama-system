# Public Status Page (`/status`)

**Linear:** BIN-791
**Implementert:** 2026-04-30

Den offentlige status-siden er en lett, egenbygd erstatning for SaaS-tjenester
som statuspage.io. Spillere og hall-operatører kan sjekke den ved problemer
uten å logge inn — siden er offentlig og uten auth.

---

## Hvor finner du den?

- **Status-side:** `https://spillorama-system.onrender.com/status`
- **Status JSON:** `GET /api/status` (cachet 30s)
- **Uptime JSON:** `GET /api/status/uptime` (24t bøtter)
- **Incidents JSON:** `GET /api/status/incidents` (active + recent)

Siden auto-refresher hvert 30. sekund. Endringer i komponentstatus vises
opptil 30 sekunder etter at de skjer.

---

## Hva sjekkes?

`apps/backend/src/observability/statusBootstrap.ts` registrerer ti
komponenter:

| Component | Display | Sjekk |
|---|---|---|
| `api` | API | Backend-prosessen kjører (alltid OK hvis vi kan svare). |
| `database` | Database | Postgres `SELECT 1` — 1s timeout. |
| `bingo` | Spill 1 | `engine.getAllRoomCodes()` — engine-helsesjekk. |
| `rocket` | Spill 2 | Samme engine. |
| `monsterbingo` | Spill 3 | Samme engine. |
| `spillorama` | SpinnGo (Spill 4) | Samme engine. |
| `wallet` | Lommebok | `walletAdapter.listAccounts()` — én round-trip. |
| `auth` | Innlogging | `SELECT 1 FROM app_user_sessions LIMIT 1`. |
| `admin` | Admin-panel | `platformService.listHalls()` — auth + admin-DB. |
| `tv` | TV-skjerm | Static — TV-routes er oppe så lenge backend er. |

Hver sjekk har 5 sekunders timeout. Hvis en sjekk kaster, markeres
komponenten som `outage`. Samtidig logges det som `warn` (ikke `error`)
siden status-side-failures ikke er ekte ops-feil — det er selve
INFORMASJONEN status-siden er ment å gi.

---

## Status-kategorier

| Status | Farge | Betydning |
|---|---|---|
| `operational` | Grønn | Komponenten fungerer normalt. |
| `degraded` | Gul/Oransje | Fungerer, men har advarsler (treg, partial). |
| `outage` | Rød | Komponenten er nede. |

**Overall systemstatus:**

- Hvis ALLE er `operational` → `operational`.
- Hvis MINST ÉN er `outage` → `outage`.
- Ellers (én eller flere `degraded`) → `degraded`.

---

## Publisere en incident manuelt

Det finnes ingen admin-UI for incidents ennå (TODO: BIN-791-followup). I
mellomtiden kan en admin publisere via `psql`:

```sql
INSERT INTO app_status_incidents (
  title, description, status, impact, affected_components, created_by_user_id
) VALUES (
  'Spill 1 har redusert kapasitet',
  'Vi undersøker en treg respons fra Spill 1-engine. Ingen risiko for tap av tickets — runder fortsetter normalt.',
  'investigating',
  'minor',
  '["bingo"]'::jsonb,
  'admin-user-id-her'
);
```

**Status-overganger:**

- `investigating`: Vi har oppdaget problemet og undersøker.
- `identified`: Rotårsak funnet, jobber med å løse.
- `monitoring`: Fix er deployet, observerer at det fungerer.
- `resolved`: Ferdig løst. `resolved_at` settes automatisk.

**Impact-nivåer:**

- `none`: Informasjon (planlagt vedlikehold osv.) — grønn.
- `minor`: Liten påvirkning — gul.
- `major`: Stor påvirkning — oransje.
- `critical`: Kritisk påvirkning — rød.

For å oppdatere/lukke:

```sql
UPDATE app_status_incidents
SET status = 'monitoring', updated_at = now()
WHERE id = 'incident-uuid-her';

-- Lukk:
UPDATE app_status_incidents
SET status = 'resolved', resolved_at = now(), updated_at = now()
WHERE id = 'incident-uuid-her';
```

---

## Cache-politikk

- **Server:** `StatusService` har 30s in-memory cache. Innenfor cache-vinduet
  blir samme snapshot returnert uten å kjøre komponent-sjekkene på nytt.
- **Klient:** `Cache-Control: public, max-age=30` — proxy/CDN holder svaret
  i 30 sekunder.

Det betyr at en faktisk status-endring tar opptil 60 sekunder å reflekteres
hos sluttbrukeren (cache-stacking). For statuspage-bruk er dette akseptabelt.

For å tvinge en re-check fra admin-siden, restart backenden — eller tell
servicen til å glemme cachen via `service.refresh()`. (Dette er ikke
eksponert som API ennå.)

---

## Hva siden IKKE er

- **Ikke en alarm-tjeneste.** Siden viser status — varsel går via Sentry +
  ops-konsollet (`/admin/ops`).
- **Ikke en SLA-måler.** 24-timers historikk er nyttig for kontekst, men ikke
  for SLA-rapporter (vi mangler persistert historikk over uker).
- **Ikke regulatorisk-bevis.** Pengespillforskriften krever audit-logger,
  ikke status-side. `app_status_incidents` har ingen retention-policy ut
  over standard DB-backup.

---

## Migrere til statuspage.io senere

Hvis vi vil bytte til en SaaS-leverandør senere, mapper data-modellen vår
1:1 mot Atlassian Statuspage:

| Vårt felt | Statuspage.io |
|---|---|
| `app_status_incidents.title` | `incident.name` |
| `app_status_incidents.description` | `incident.body` |
| `app_status_incidents.status` | `incident.status` (samme verdier) |
| `app_status_incidents.impact` | `incident.impact_override` |
| `app_status_incidents.affected_components` | `component_ids` |

Migrasjonen vil være en ETL-jobb — ingen modellendring nødvendig.

---

## Filer

- `apps/backend/src/observability/StatusService.ts` — komponent-aggregat + cache
- `apps/backend/src/observability/statusBootstrap.ts` — wiring i prod
- `apps/backend/src/admin/StatusIncidentService.ts` — incidents-CRUD
- `apps/backend/src/routes/publicStatus.ts` — public HTTP-routene
- `apps/backend/public/status.html` — statisk frontend
- `apps/backend/migrations/20260430213331_status_incidents.sql` — DB-skjema

## Tester

- `apps/backend/src/observability/__tests__/StatusService.test.ts` — 15 tester
- `apps/backend/src/routes/__tests__/publicStatus.test.ts` — 6 tester
