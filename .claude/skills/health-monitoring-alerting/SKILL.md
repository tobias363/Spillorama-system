---
name: health-monitoring-alerting
description: When the user/agent works with R7 health-endpoints or R8 alerting for the Spillorama bingo platform. Also use when they mention /api/games/spill[1-3]/health, GameRoomHealth, RoomAlertingService, R7, R8, BIN-814, BIN-815, health-endpoint, p95-latency, draw-stale, alerting, PagerDuty, Slack-alert, Spill 2 perpetual-loop, Spill 3 monsterbingo singleton. Defines per-room health snapshot schema, status-mapping, rate-limit, and the alert-pipeline that keeps live rooms self-reporting. Make sure to use this skill whenever someone touches the health routes, RoomAlertingService, or per-room observability hooks even if they don't explicitly ask for it — these are pilot-gating per the Live-Room Robustness Mandate.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/routes/publicGameHealth.ts, apps/backend/src/routes/__tests__/publicGameHealth.test.ts, apps/backend/src/observability/RoomAlertingService.ts, apps/backend/src/observability/RoomAlertingBootstrap.ts, apps/backend/src/observability/__tests__/RoomAlertingService.test.ts -->

# Health Monitoring & Alerting

## Kontekst

Per `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.4:
- **R7 (BIN-814):** Health-endpoint per rom for Spill 1, 2 og 3 — public, no auth, rate-limit 60/min/IP. Aldri stale > 5s.
- **R8 (BIN-815):** Alerting bygd på R7. Varsler PagerDuty/Slack ved persistent `down`, `draw_stale`, `redis_unhealthy`, `db_unhealthy`, `wallet_reconciliation_mismatch`.

Begge er pilot-gating. Uten dem har vi ingen måte å oppdage at en hall sitter med "rom utilgjengelig" mens vi tror alt går bra.

## Kjerne-arkitektur

### 3 endepunkter (BIN-814)

```
GET /api/games/spill1/health?hallId=<uuid>   # Bingo (per-hall lobbies)
GET /api/games/spill2/health?hallId=<uuid>   # Rocket (perpetual loop, global rom)
GET /api/games/spill3/health?hallId=<uuid>   # Monsterbingo (singleton, global rom)
```

Implementasjon: `apps/backend/src/routes/publicGameHealth.ts`.

### Sikkerhetsmodell

| Egenskap | Verdi | Begrunnelse |
|---|---|---|
| Auth | INGEN | Public observability-endpoint — Lotteritilsynet kan sjekke direkte |
| Rate-limit | 60/min per IP | Router-lokal sliding-window (strammere enn `/api/` 120/min) |
| Cache-Control | `no-cache, max-age=0, must-revalidate` | Aldri stale > 5s — kalkulerer fersk hver gang |
| Input-validering | hallId max 120 tegn, søker for SQL-safe | Rate-limit + validering hindrer DoS |

### Output-shape (samme på alle 3 endepunkter)

```typescript
interface GameRoomHealth {
  status: "ok" | "degraded" | "down";
  lastDrawAge: number | null;        // sek siden siste trekning
  connectedClients: number;
  currentPhase: "idle" | "running" | "paused" | "finished";
  currentPosition: number | null;     // plan-position (Spill 1) eller null
  instanceId: string;                 // hostname-pid eller Render instance-id
  redisHealthy: boolean;
  dbHealthy: boolean;
  nextScheduledStart: string | null; // ISO-tid for neste runde
  withinOpeningHours: boolean;
  p95SocketRoundtripMs: number | null; // null inntil R5 metrics
  checkedAt: string;                  // ISO-tid
}
```

### Status-mapping

| Status | Når | Action |
|---|---|---|
| `ok` | DB+Redis friske, aktiv runde uten stale draws ELLER lobby venter innenfor åpningstid | Ingen alert |
| `degraded` | Aktiv runde MEN Redis nede ELLER draw-stale > 30s | R8 alert (warning) |
| `down` | DB nede ELLER utenfor åpningstid uten aktiv runde | R8 alert (critical) |

### Spill-spesifikk adferd

**Spill 1** (`bingo`, per-hall lobbies):
- `hallId` påkrevd — leser `app_game1_scheduled_games WHERE master_hall_id = $1`
- `currentPosition` = plan-position når Game1LobbyService er fullført (PR #1018)
- `nextScheduledStart` fra schedule-tabellen
- `withinOpeningHours` returnerer `true` inntil schedule-basert vindu-sjekk lander (TODO R8)

**Spill 2** (`rocket`, perpetual loop):
- Globalt singleton-rom (`isHallShared=true`) — `hallId` brukt for logging, ikke filter
- `nextScheduledStart` ALLTID `null` (perpetual auto-spawner)
- `withinOpeningHours` leses fra `Spill2Config.openingTimeStart/End` (Europe/Oslo)
- Hvis config ikke kan leses → utenfor åpningstid → `down`

**Spill 3** (`monsterbingo`, singleton):
- Globalt singleton-rom
- `nextScheduledStart` ALLTID `null` (auto-spawn ved `Spill3Config.minTicketsToStart`)
- `withinOpeningHours` fra `Spill3Config.openingTimeStart/End`

### R8 Alerting (RoomAlertingService)

Implementasjon: `apps/backend/src/observability/RoomAlertingService.ts`.

**Designprinsipper:**
- **Fail-soft:** Hvis Slack/PD/Postgres er nede skal IKKE polling-loopen krasje. Try/catch + log.warn.
- **Pure-compute:** `evaluateAlerts()` er testbar uten DB, uten fetch, uten klokke.
- **Kanal-DI:** `AlertChannel`-interface — Slack og PD stub-bare i tester.
- **De-dup-vindu:** Én alert per (game, hallId, scenario) per N minutter.
- **Hash-chain audit-log:** Hver alert får en rad i `app_alert_log` med SHA-256-link til forrige rad (BIN-764-mønster).

**5 alert-scenarier:**

1. `status_down` — health.status === "down" i > N sekunder (vedvarende — én blip skal ikke trigge)
2. `draw_stale` — `lastDrawAge > 2 × ball-intervall` (Spill 1: ~10s ball-intervall → > 20s)
3. `redis_unhealthy` — `redisHealthy === false`
4. `db_unhealthy` — `dbHealthy === false`
5. `wallet_reconciliation_mismatch` — eksisterende `wallet_reconciliation_alerts`-tabell har åpne rader

**Kanal-prioritet (parallel-fan-out):**
- **Slack-webhook:** POST `{ text: "..." }`. Default for warning.
- **PagerDuty Events API v2:** POST til `events.pagerduty.com/v2/enqueue` med `routing_key` + `event_action: "trigger"` + `dedup_key`. Default for critical.
- **Console:** alltid på som fallback hvis ingen webhook konfigurert.

### Konfigurasjon (env-vars)

```
SLACK_ALERT_WEBHOOK_URL          # Slack incoming-webhook-URL
PAGERDUTY_INTEGRATION_KEY        # PD Events API v2 routing-key
ROOM_ALERTING_POLL_INTERVAL_MS   # default 30000 (30s)
ROOM_ALERTING_DEDUP_MINUTES      # default 15 min
ROOM_ALERTING_PERSISTENT_DOWN_MS # default 30000 (30s før alert)
```

## Immutable beslutninger

### Endpoints er public — ingen auth

Lotteritilsynet kan polle disse direkte uten å gå gjennom regulator-portal. Dette er bevisst — transparens er en del av regulert pengespill-drift.

Beskyttelse: rate-limit 60/min/IP + format-validering på `hallId`.

### Cache er aldri lengre enn 5 sek

`Cache-Control: no-cache, max-age=0, must-revalidate` på alle responses. Hvis vi setter cache lengre risikerer vi å vise stale "ok" når rommet faktisk er nede.

R8-alerting krever at health-data er fersk for å fungere.

### Persistent-down-deteksjon — én blip skal ikke trigge

In-memory map `lastSeenDownSinceMs[scenarioKey]` settes første gang status="down" observeres. Alert trigges først når `now - lastSeenDownSinceMs > PERSISTENT_DOWN_THRESHOLD_MS`. Når status flipper tilbake → mappen tørkes.

Dette hindrer alert-storm under deploy eller momentane network-blips.

### Source-level wiring-regression-test (BIN-823)

Per casino-grade-testing-skill: skriv en regresjons-test som verifiserer `bootstrap.ts` faktisk wirer servicen inn:

```typescript
test("RoomAlertingService wired in production bootstrap", () => {
  const source = readFileSync("src/index.ts", "utf-8");
  assert.match(source, /createRoomAlertingService\(/);
  assert.match(source, /\.start\(\)/);
});
```

Dette fanget BIN-823 der servicen var deklarert men aldri startet.

### Snapshot-tester per state — minst 16

`apps/backend/src/observability/__tests__/RoomAlertingService.test.ts` har tester for hver gyldig state-overgang med selv-dokumenterende navn:

- `evaluateAlerts-status-ok-no-alerts`
- `evaluateAlerts-status-down-persistent-triggers-alert`
- `evaluateAlerts-status-down-blip-no-alert`
- `evaluateAlerts-draw-stale-triggers-alert`
- `evaluateAlerts-redis-down-triggers-alert`
- `evaluateAlerts-dedup-window-suppresses-second-alert`
- ... osv.

### Hash-chain audit-log for alle alerts

Hver alert som sendes får en rad i `app_alert_log` med:
- `alert_type` (status_down, draw_stale, etc.)
- `game_slug`, `hall_id`, `scenario_key`
- `channel` (slack, pd, console)
- `prev_hash` + `curr_hash` (SHA-256 link til forrige rad)

Dette matcher BIN-764-audit-mønster og gjør alert-historikken bevisbar overfor regulator.

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| Glemt rate-limit på endpoint | DoS-flom under hendelser | Sliding-window 60/min/IP |
| Cache-Control mangler | Stale "ok" mens rom faktisk down | `no-cache, max-age=0, must-revalidate` |
| Alert-storm under deploy | PagerDuty 50 pings i 30 sek | Persistent-down-threshold 30s + de-dup 15 min |
| RoomAlertingService deklarert men ikke startet | Stille "ingen alerts" | Source-level wiring-regression-test (BIN-823) |
| Slack down → polling-loop krasjer | R8 dør stille | Try/catch + log.warn, never throw |
| Mock-tester uten kanal-DI | Tester sender til real Slack | Bruk `AlertChannel`-interface, stub i tester |
| `withinOpeningHours = true` alltid | Spill 1 lar `down`-status være `ok` utenfor schedule | TODO R8: les fra schedule-tabell |
| `hallId` ikke validert | SQL-injection eller log-spam | Valider format + max 120 tegn |
| Alerts uten audit-log | Regulator kan ikke verifisere at vi varslet på tid | Hash-chain audit (BIN-764-mønster) |

## Kanonisk referanse

- `apps/backend/src/routes/publicGameHealth.ts` — R7-endepunkter
- `apps/backend/src/routes/__tests__/publicGameHealth.test.ts` — endpoint-tester
- `apps/backend/src/observability/RoomAlertingService.ts` — R8-service
- `apps/backend/src/observability/RoomAlertingBootstrap.ts` — DI-wiring
- `apps/backend/src/observability/__tests__/RoomAlertingService.test.ts` — 16+ snapshot-tester
- `apps/backend/openapi.yaml` "Game Health — Public" og `GameRoomHealth`-schema
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.4 R7 + R8
- `docs/operations/LIVE_ROOM_OBSERVABILITY_2026-04-29.md` — bredere observability

## Når denne skill-en er aktiv

- Endre eller legge til health-endpoint
- Endre `RoomAlertingService` (alert-scenarier, kanaler, polling-intervall)
- Implementere R5-metrics (p95-socket-roundtrip)
- Touche `Spill2Config` eller `Spill3Config` (åpningstid-vindu)
- Wire-up av `Game1LobbyService` til Spill 1 health-endpoint (PR #1018-followup)
- Skrive snapshot-tests for nye state-overganger
- Konfigurere PagerDuty/Slack i prod (env-vars)
- Reviewe en alert-spam-incident (sjekk de-dup + persistent-threshold)
- Pre-pilot drill av R8-alerting (D-COMP-1/2)
- Lotteritilsynet- eller revisor-spørsmål om health-transparens
