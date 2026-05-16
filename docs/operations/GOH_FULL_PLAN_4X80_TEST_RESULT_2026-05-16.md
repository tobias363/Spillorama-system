# GoH Full-Plan 4x80 Test Result — 2026-05-16

**Status:** PASSED with P1 follow-up  
**Utført av:** PM-AI / Codex  
**Miljø:** Lokal backend på `http://localhost:4000`, lokal Postgres/Redis, Sentry/PostHog API snapshots, pilot-monitor  
**Scope:** `demo-pilot-goh`, 4 testhaller x 80 spillere = 320 samtidige testspillere  
**Plan:** Alle 13 Spill 1-planposisjoner  
**Evidence:** `docs/evidence/20260516-goh-full-plan-run-4x80/`

## Sammendrag

Full spilleplan ble kjørt ende-til-ende med 320 syntetiske spillere fordelt på 4 haller i Group of Halls. Kjøringen startet 2026-05-16T22:08:30Z og fullførte 2026-05-16T22:48:41Z med runner-status `passed`.

Kjernen er positiv: alle 13 plan-spill fullførte, 320/320 spillere koblet til, 4160 kjøp gikk gjennom, og pilot-monitor hadde 0 P0/P1 i testvinduet.

Dette er likevel ikke "ferdig robust" fordi live socket-markering fortsatt feiler: `ticket:mark` ga `GAME_NOT_RUNNING` gjennom hele kjøringen, med 0 `markAcks`. Server-side draw/pattern-eval fullfører, men spillerklientens mark-path er fortsatt en P1.

## Nøkkeltall

| Målepunkt | Resultat |
|---|---:|
| Haller | 4 |
| Spillere per hall | 80 |
| Totale spillere | 320 |
| Spill i plan | 13 |
| Kjøp totalt | 4160 |
| Ticket assignments | 11960 |
| Innsats totalt | 167400 kr |
| Draws totalt | 782 |
| Vinner-events | 89 |
| Auto-resumes | 52 |
| Purchase transient failures | 176 |
| Purchase retries succeeded | 150 |
| `ticket:mark` failures | 164495 |
| `ticket:mark` acks | 0 |

## Per-Runde Resultat

| Pos | Slug | Resultat | Kjøp | Tickets | Innsats | Draws | Resumes | Marks |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | bingo | completed | 320 | 920 | 12800 kr | 62 | 4 | 0 |
| 2 | 1000-spill | completed | 320 | 920 | 12800 kr | 63 | 4 | 0 |
| 3 | 5x500 | completed | 320 | 920 | 12800 kr | 59 | 4 | 0 |
| 4 | ball-x-10 | completed | 320 | 920 | 12800 kr | 60 | 4 | 0 |
| 5 | bokstav | completed | 320 | 920 | 12800 kr | 61 | 4 | 0 |
| 6 | innsatsen | completed | 320 | 920 | 12800 kr | 58 | 4 | 0 |
| 7 | jackpot | completed | 320 | 920 | 12800 kr | 61 | 4 | 0 |
| 8 | kvikkis | completed | 320 | 920 | 12800 kr | 59 | 4 | 0 |
| 9 | oddsen-55 | completed | 320 | 920 | 12800 kr | 60 | 4 | 0 |
| 10 | oddsen-56 | completed | 320 | 920 | 12800 kr | 60 | 4 | 0 |
| 11 | oddsen-57 | completed | 320 | 920 | 12800 kr | 62 | 4 | 0 |
| 12 | trafikklys | completed | 320 | 920 | 13800 kr | 59 | 4 | 0 |
| 13 | tv-extra | completed | 320 | 920 | 12800 kr | 58 | 4 | 0 |

## Observability

Preflight, midrun og postrun snapshots ligger i:

- `docs/evidence/20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/`
- `docs/evidence/20260516-observability-goh-80-midrun-2026-05-16T22-28-30-479Z/`
- `docs/evidence/20260516-observability-goh-80-postrun-2026-05-16T22-48-56-853Z/`

Postrun mot runtime-preflight:

- Pilot-monitor P0 delta: 0
- Pilot-monitor P1 delta: 0
- PostHog `ticket.purchase.success`: +4160
- PostHog `spill1.master.start`: +13
- PostHog `spill1.payout.pattern`: +89
- Sentry new issue: `SPILLORAMA-BACKEND-A` — N+1 Query på `POST /api/agent/game1/master/advance`
- Sentry increased issue: `SPILLORAMA-BACKEND-8` — N+1 Query på `POST /api/agent/game1/master/resume`, +12

Sentry N+1-queryen var gjentatte `app_game_catalog WHERE id = $1` fra plan-item catalog enrichment. Fix er lagt i denne sesjonen: `GameCatalogService.getByIds()` + batch-load i `GamePlanService.fetchItems()`.

## Viktige Funn

### 1. GoH full-plan skalerer funksjonelt til 4x80 lokalt

Alle planposisjoner fullførte med 320 samtidige syntetiske spillere. Kjøp, ready-state og server-side draw/pattern-eval holdt gjennom hele planen.

### 2. Runneren var tidligere låst til 4x20-antakelse

`scripts/dev/goh-full-plan-run.mjs` hadde hardkodet `4 * 50 = 200` ticket assignments per runde. For 80 spillere per hall er riktig forventning 230 assignments per hall og 920 per runde. Runneren beregner nå forventningen fra faktisk `clients[]`.

### 3. `ticket:mark` er fortsatt P1

Alle runder fullfører server-side, men socket-eventen `ticket:mark` feiler med `GAME_NOT_RUNNING`. Dette er samme bug-klasse som 4x20 baseline, nå bekreftet ved 4x80.

Sannsynlig retning: `ticket:mark` bruker fortsatt legacy `BingoEngine.markNumber({ roomCode, playerId, number })`-path, mens scheduled Spill 1 rundestate eies av `Game1DrawEngineService` og DB. Neste fix må wire scheduled Spill 1 markering mot riktig scheduled-game/status-kilde og ha regresjonstest.

### 4. N+1 i master advance/resume ble fanget av Sentry

Sentry viste nye/incrementerte N+1-issues under testen. Dette er et godt tegn på at observability-oppsettet nå faktisk gir handlingsbar feedback fra live-load. Fixen er batch-loading av catalog entries i `GamePlanService`.

### 5. Auto-resume skjer systematisk

Hver runde hadde 4 auto-resumes. Fullflyten overlever dette, men PM må fortsatt avklare om denne phase-pause-kontrakten er ønsket i produktet, eller om synthetic runner skjuler en master/UX-beslutning.

## Kommandoer Brukt

```bash
PGHOST=localhost \
PGPORT=5432 \
PGUSER=spillorama \
PGPASSWORD=spillorama \
PGDATABASE=spillorama \
BACKEND_URL=http://localhost:4000 \
node scripts/dev/goh-full-plan-run.mjs \
  --players-per-hall=80 \
  --connect-delay-ms=2200 \
  --join-delay-ms=60 \
  --purchase-concurrency=8 \
  --round-timeout-ms=900000 \
  --output=/tmp/goh-full-plan-run-4x80-20260516T2208.json
```

Observability:

```bash
node scripts/dev/observability-snapshot.mjs \
  --label goh-80-postrun \
  --window-minutes 90 \
  --sentry-stats-period 24h \
  --compare docs/evidence/20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/2026-05-16T22-06-45-624Z-goh-80-preflight-runtime.json
```

## Neste PM Skal Gjøre

1. Fix scheduled Spill 1 `ticket:mark` path først. Det er nå den tydeligste P1 etter 4x80.
2. Re-kjør 4x80 etter `ticket:mark`-fix og krev `markAcks > 0` og `GAME_NOT_RUNNING = 0`.
3. Følg Sentry for `SPILLORAMA-BACKEND-A` og `SPILLORAMA-BACKEND-8` etter batch-fixen. Nye events etter fix betyr at flere catalog lookups ligger igjen.
4. Avklar auto-resume-kontrakten med Tobias før pilot: er 4 phase-pauses per runde ønsket produktatferd eller test-runner-overstyring?
5. Behold Sentry/PostHog/DB snapshots som obligatorisk før/midt/etter ved alle større GoH-load-kjøringer.
