# Spill 1 — komplett implementasjons-status og fundament

**Status:** Autoritativ. Skal være oppdatert ved hver sesjons-slutt eller etter store endringer.
**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead) + PM-AI (Claude Opus 4.7)
**Lese-først-i-sesjon:** **JA** — alle nye PM/agenter som skal jobbe med Spill 1 SKAL lese dette dokumentet før de begynner.

---

## 0. Hvorfor dette dokumentet eksisterer

Spill 1 (slug-familie `bingo`, 13 katalog-varianter) er hovedspill-fundamentet for Spillorama. Pilot går mot 4 haller (Teknobingo Årnes som master + Bodø + Brumunddal + Fauske) med Evolution Gaming-grade robusthet-mål (99.95 %+ oppetid).

Hvis fundamentet glipper, koster det oss kunder, tillit og regulatorisk risiko (Lotteritilsynet). Tobias' direktiv 2026-05-08:

> "Det er ekstremt viktig at fundamentet her er godt dokumentert slik at fremtidige PM/agenter har full forståelse og ikke fraviker fra planen. Viktig at vi får det riktig nå og fortsetter med god dokumentasjon."

Dette dokumentet er konsolidering av alt arbeid som er gjort 2026-05-08 — slik at neste PM/agent ikke trenger å re-discovere det.

---

## 1. Arkitektur — hvor alt henger sammen

### 1.1 Tre-lags-modell

```
┌────────────────────────────────────────────────────────────┐
│  KLIENT-LAG                                                │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Player-shell    │  │ Admin-konsoll│  │ TV-skjerm    │  │
│  │ /web/?dev-user= │  │ :5174/admin/ │  │ /tv/<id>/<t> │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
│           │                  │                  │         │
└───────────┼──────────────────┼──────────────────┼─────────┘
            │                  │                  │
            ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────┐
│  BACKEND-LAG (Node.js + Express + Socket.IO på port 4000)  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Master-flyt:                                         │  │
│  │  /api/agent/game-plan/start → GamePlanRunService     │  │
│  │    → GamePlanEngineBridge.createScheduledGame()      │  │
│  │      → app_game1_scheduled_games-rad spawnet          │  │
│  │      → Game1MasterControlService.startGame()         │  │
│  │        → BingoEngine + Game1DrawEngineService        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Klient-flyt:                                         │  │
│  │  GET /api/games/spill1/lobby?hallId=X                 │  │
│  │    → Game1LobbyService.getLobbyState()                │  │
│  │  Socket.IO spill1:lobby:{hallId}-rom                  │  │
│  │  Socket.IO spill1:scheduled-{gameId}-rom              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────┐
│  STATE-LAG                                                  │
│  ┌─────────────────┐  ┌──────────────────────────────────┐ │
│  │  Postgres 16    │  │  Redis 7                          │ │
│  │  (system of     │  │  (room state, sessions,           │ │
│  │   record)       │  │   rate-limits)                    │ │
│  └─────────────────┘  └──────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 1.2 Hall-modell og master-rolle

**Group of Halls (GoH):** En samling haller som spiller samme runde samtidig. Pilot-GoH har 4 haller.

**Master-hall:** Én hall i GoH-en som styrer master-handlingene (start, pause, fortsett, advance til neste spill i sekvens). Andre haller er deltakere.

**Master-handlinger** (Tobias-direktiv 2026-05-08):
- ✅ Master kan starte/stoppe **uavhengig** av om andre haller er klare (ready-status er KUN informativ, ikke gate)
- ❌ Master kan **aldri** hoppe over neste spill i sekvensen (alltid umiddelbart neste i spilleplan-rekkefølgen)
- ❌ Ingen "Avbryt spill"-knapp for master (flyttet til admin-only — regulatorisk-tung)
- ❌ Ingen "Kringkast Klar + 2-min countdown" (master starter direkte)

**Master-hall valg:** Settes ved opprettelse av GoH (BIN-1034, 2026-05-08). Kolonne `app_hall_groups.master_hall_id`. Bridge bruker GoH.master_hall_id som `effectiveMasterHallId` ved scheduled-game-spawn — fallback til `run.hall_id` hvis pinnet hall er deaktivert.

### 1.3 Datamodell — kjerne-tabeller for Spill 1

```
app_hall_groups
  ├─ id (text)
  ├─ name (unique)
  ├─ master_hall_id (FK → app_halls, ON DELETE SET NULL)
  └─ status, deleted_at, ...

app_hall_group_members
  ├─ group_id (FK → app_hall_groups, ON DELETE CASCADE)
  ├─ hall_id  (FK → app_halls)
  └─ added_at

app_game_catalog (13 rader for Spill 1)
  ├─ id, slug, display_name
  ├─ rules JSON (gameVariant, targetDraw for oddsen, prizesPerRowColor for trafikklys)
  ├─ ticket_colors[], ticket_prices_cents (per farge)
  ├─ prizes_cents (rad1-4 + bingoBase eller per-farge)
  ├─ prize_multiplier_mode (auto | explicit_per_color)
  └─ requires_jackpot_setup, bonus_game_slug

app_game_plan
  ├─ id (eks: demo-plan-pilot)
  ├─ name (eks: "Pilot Demo — alle 13 spill")
  ├─ group_of_halls_id (FK → app_hall_groups, ON DELETE SET NULL)
  │   eller hall_id (XOR — én av to)
  ├─ weekdays[], start_time, end_time
  └─ is_active

app_game_plan_item (13 items per plan, sortOrder 1..13)
  ├─ plan_id (FK → app_game_plan, ON DELETE CASCADE)
  ├─ position
  ├─ game_catalog_id
  └─ bonus_game_override

app_game_plan_run (én per (hall, businessDate))
  ├─ id
  ├─ plan_id (FK → app_game_plan, ON DELETE CASCADE)
  ├─ hall_id (master-hallen i GoH-en)
  ├─ business_date
  ├─ current_position (1+, eller 0 = idle)
  ├─ status (idle | running | paused | finished)
  └─ jackpot_overrides JSON

app_game1_scheduled_games (spawned av bridge)
  ├─ id (UUID, dette er gameId for socket-events)
  ├─ master_hall_id
  ├─ group_hall_id (FK → app_hall_groups, ON DELETE SET NULL)
  ├─ participating_halls_json (snapshot fra spawn-tid)
  ├─ catalog_entry_id, plan_run_id, plan_position
  ├─ ticket_config_json (auto-mult-skalert per bongfarge)
  ├─ status (scheduled | purchase_open | ready_to_start | running | paused | finished)
  └─ scheduled_start_time, actual_start_time, ...

app_game1_hall_ready_status
  ├─ game_id (FK → app_game1_scheduled_games)
  ├─ hall_id
  ├─ is_ready, ready_at, ready_by_user_id
  ├─ digital_tickets_sold, physical_tickets_sold
  ├─ start_ticket_id, final_scan_ticket_id
  └─ excluded_from_game

app_game1_tickets (kjøpte bonger)
  ├─ id, user_id, hall_id (KJØPE-hall, ikke master)
  ├─ scheduled_game_id (FK)
  ├─ ticket_color, price_cents
  └─ grid (JSON 5×5)

app_alert_log (R8 alerting hash-chain audit)
  ├─ id, game_slug, hall_id, scenario, severity
  ├─ payload_json, channels_attempted_json
  └─ entry_hash (SHA-256 av forrige + dette)
```

### 1.4 FK-cascade-strategi (R/BIN-1038, 2026-05-08)

For å garantere ingen orphan-data:
- `app_hall_group_members.group_id` → CASCADE
- `app_game_plan.group_of_halls_id` → CASCADE
- `app_game_plan_run.plan_id` → CASCADE
- `app_game_plan_item.plan_id` → CASCADE
- `app_game1_scheduled_games.group_hall_id` → CASCADE

Når GoH slettes, fjernes alle relaterte rader automatisk på DB-nivå (defense-in-depth, kompletterer kode-cascade i HallGroupService).

---

## 2. Spill 1 — komplett feature-status

### 2.1 Game-katalog (13 varianter)

Alle seedet via `seed-demo-pilot-day` (BIN-1021, 2026-05-08):

| Slug | Display | Variant | Bingo-base 5kr | Spesial |
|---|---|---|---|---|
| `bingo` | Bingo | standard | 1000 kr | — |
| `1000-spill` | 1000-spill | standard | 1000 kr | — |
| `5x500` | 5×500 | standard | 500 kr | — |
| `ball-x-10` | Ball × 10 | standard | varierer | — |
| `bokstav` | Bokstav | standard | varierer | NB: doc-en sier flytt til Spill 3 — kan deaktiveres |
| `innsatsen` | Innsatsen | standard | 500-2000 kr | Innsatsen-pot |
| `jackpot` | Jackpot | standard | master-popup | requires_jackpot_setup=true |
| `kvikkis` | Kvikkis | standard | 1000 kr | — |
| `oddsen-55` | Oddsen 55 | **oddsen** | low 500 / high 1500 | targetDraw=55 |
| `oddsen-56` | Oddsen 56 | **oddsen** | low 500 / high 1500 | targetDraw=56 |
| `oddsen-57` | Oddsen 57 | **oddsen** | low 500 / high 1500 | targetDraw=57 |
| `trafikklys` | Trafikklys | **trafikklys** | per rad-farge | flat 15kr/bong |
| `tv-extra` | TV-Extra | standard | 3000 kr | — |

Master kan velge bonus-spill per spilleplan-item (bonus_game_override).

**Autoritativ regel-spec:** [SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md)
**Per-spill-detaljer:** [SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md)

### 2.2 Bongpriser og premie-mekanikk

**Bongpriser (alle spill untatt Trafikklys):**
| Bongfarge | Pris | Multiplikator |
|---|---|---|
| Hvit | 5 kr | × 1 |
| Gul | 10 kr | × 2 |
| Lilla | 15 kr | × 3 |

**Trafikklys:** flat 15 kr alle bonger.

**Auto-multiplikator:**
- Premier defineres som base for billigste bong (5 kr)
- Backend skalerer for dyrere bonger: `actualPrize = base × (ticketPrice / 500)`
- Gjelder ALLE rad-premier OG Fullt Hus

**Multi-vinner pot-deling per bongstørrelse** (BIN-997, 2026-05-08):
- Pot per bongstørrelse = base × bongMultiplier
- Hver vinner får andel: pot[size] / antall_vinnende_bonger_i_samme_størrelse
- Floor-rest til HOUSE_RETAINED-event

**Cap:** Ingen single-prize cap på hovedspill (kun databingo har 2500 kr-cap).

### 2.3 Master-flyt (komplett)

```
1. Admin oppretter spilleplan
   ├─ /admin/#/games/plans/new
   ├─ Velger GoH eller hall (XOR)
   ├─ Velger ukedager + åpningstid (eks Mon-Sun 11:00-21:00)
   └─ Drar inn katalog-spill i sekvens

2. Admin setter master-hall på GoH
   └─ /admin/#/groupHall → master-hall-dropdown (BIN-1034)

3. Master-agent åpner /admin/agent/cash-in-out
   ├─ Plan-runtime lazy-creates plan-run (status=idle)
   ├─ "MIN HALL"-seksjon viser egen hall + ready-pill
   ├─ "ANDRE HALLER I GRUPPEN"-seksjon viser 3 andre haller med ready-pills (BIN-1030)
   └─ Master-handlinger: Start neste spill — <name>

4. Master klikker "Start neste spill"
   ├─ POST /api/agent/game-plan/start
   ├─ GamePlanRunService.start() — oppretter run
   ├─ GamePlanEngineBridge.createScheduledGameForPlanRunPosition()
   │   ├─ resolveParticipatingHallIds (GoH-medlemmer)
   │   ├─ buildTicketConfigFromCatalog (auto-mult per farge)
   │   └─ INSERT app_game1_scheduled_games (status=ready_to_start)
   ├─ Game1MasterControlService.startGame() — engine begynner
   └─ Spill1LobbyBroadcaster.broadcastForHall() — emit til klienter

5. Engine kjører
   ├─ Game1DrawEngineService trekker baller på interval
   ├─ Compliance-ledger skriver per draw
   └─ TV-skjerm + spiller-klient mottar via Socket.IO

6. Spillere markerer numre på bonger
   ├─ Socket-event ticket:mark (med clientRequestId for idempotens, BIN-1028)
   └─ Server validerer + lagrer

7. Vinner-deteksjon
   ├─ Engine sjekker pattern (Rad 1-4, Fullt Hus)
   ├─ Pot-per-bongstørrelse-utbetaling (§9 i regel-doc)
   ├─ Compliance-ledger PRIZE-event
   └─ Wallet credit via outbox (BIN-761→764)

8. Master pause/fortsett (Spill 1 er master-styrt mellom rader)
   ├─ POST /api/admin/game1/games/<scheduled-game-id>/pause (NB: scheduled-game-id, ikke plan-run-id, BIN-1041)
   └─ Engine pauser draws

9. Master advance til neste spill i plan
   └─ POST /api/agent/game-plan/advance → ny scheduled-game spawnet for plan-position+1

10. Etter plan.endTime → run.status=finished, rommet stenger
```

### 2.4 Klient-flyt (R1 / BIN-822 / 1033)

**Lobby-rom-konsept:**
- Klient kobler til `spill1:lobby:{hallId}` ved hall-valg
- Henter state via `GET /api/games/spill1/lobby?hallId=X`
- State: `{ isOpen, openingTimeStart, openingTimeEnd, nextScheduledGame, runStatus, overallStatus }`
- Innenfor åpningstid + ingen aktiv runde → "Neste spill: <name> (om X min)"
- Aktiv runde → bytter til runde-modus (live trekk + pattern-evaluering)
- Etter Fullt Hus → tilbake til lobby-modus
- Etter `plan.endTime` → "Stengt"-melding

**Reconnect-flyt (R5 idempotency, R3 reconnect-test):**
- `clientRequestId` (UUID v4) på alle socket-events
- Server dedup-erer i Redis med 5-min TTL
- Cache-key: `(userId, eventName, clientRequestId)`
- Marks/claims/buys cache-es lokalt under disconnect, replay-es etter reconnect

### 2.5 Pilot-gating-tiltak (R-mandat)

Alle ferdig levert eller infra-klar (LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md):

| # | Tiltak | Status | PR |
|---|---|---|---|
| R1 | Game1Controller-wireup ("FÅR IKKE KOBLET TIL ROM"-fix) | ✅ Merget | #1018 + #1033 |
| R2 | Failover-test (drep instans midt i runde) | ✅ Infra klar (må kjøres) | #1032 |
| R3 | Klient-reconnect-test | ✅ Infra klar (må kjøres) | #1037 |
| R5 | Idempotent socket-events | ✅ Merget | #1028 |
| R7 | Health-endpoint per rom | ✅ Merget | #1027 |
| R8 | Alerting (Slack/PagerDuty) | ✅ Merget | #1031 |
| R12 | DR-runbook for live-rom | ✅ Merget | #1025 |

---

## 3. UI-status

### 3.1 Admin-konsoll (innlogget admin: `tobias@nordicprofil.no` / `Spillorama123!`)

| Sti | Hva | Status |
|---|---|---|
| `/admin/#/spill1` | Spill 1-landingsside (3 kort: katalog, planer, hallgrupper) | ✅ #1024 |
| `/admin/#/games/catalog` | Spillkatalog — 13 spill listet | ✅ #1021 |
| `/admin/#/games/plans` | Spilleplaner — drag-and-drop builder | ✅ |
| `/admin/#/groupHall` | Hallgrupper — master-hall-velger | ✅ #1034 |
| `/admin/#/halls` | Haller | ✅ |
| `/admin/#/players` | Spillere | ✅ |

### 3.2 Agent-konsoll (innlogget agent: `demo-agent-1@spillorama.no` / `Spillorama123!`)

| Sti | Hva | Status |
|---|---|---|
| `/admin/agent/dashboard` | Dashboard | ✅ |
| `/admin/agent/cash-in-out` | Master-konsoll | ✅ |
| ↳ "MIN HALL"-seksjon | Egen hall + ready-pill | ✅ #1030 |
| ↳ "ANDRE HALLER" | Andre GoH-haller med pills | ✅ #1030 |
| ↳ Master-handlinger | Start, Pause, Fortsett | ✅ #1041 |
| ↳ "Marker Klar" | Disabled før master starter | ✅ #1035 |

### 3.3 Spiller-shell (`/web/?dev-user=demo-pilot-spiller-1`)

| Tilstand | Hva vises | Status |
|---|---|---|
| Utenfor åpningstid | "Stengt — åpner kl HH:MM" | ✅ |
| Åpningstid + ingen runde | "Neste spill: <name> (om X min)" | ✅ |
| Aktiv runde | Live trekk + pattern-evaluering | ✅ |
| Etter Fullt Hus | Tilbake til lobby-modus | ✅ |
| Etter plan.endTime | "Ferdig for dagen" | ✅ |

### 3.4 TV-skjerm (`/tv/<hallId>/<token>`)

| Hall | URL | Status |
|---|---|---|
| Demo 1 (Master) | `/tv/demo-hall-001/11111111-...` | ✅ #1039 |
| Demo 2 | `/tv/demo-hall-999/2c5ec903-...` | ✅ |
| Demo 3 | `/tv/demo-hall-002/22222222-...` | ✅ |
| Demo 4 | `/tv/demo-hall-003/33333333-...` | ✅ |

Redirecter til `/admin/#/tv/<hallId>/<token>` så admin-Vite-bundle rendrer (fix for MIME-type-bug, BIN-1039).

### 3.5 Bonus-spill preview

`http://localhost:4000/web/games/preview.html` — viser alle 5 mini-spill (Lykkehjul, Skattekiste, Mystery Joker, Fargetrekning, Oddsen) i én visning.

`http://localhost:4000/web/games/dev-overview.html` — sentral landingsside med alle preview-elementer + scenarier + TV-iframes (BIN-1026).

---

## 4. Backend-tjenester

| Service | Fil | Ansvar |
|---|---|---|
| `BingoEngine` | `apps/backend/src/game/BingoEngine.ts` | Hovedengine for 75-ball 5×5 |
| `Game1MasterControlService` | `apps/backend/src/game/Game1MasterControlService.ts` | Master-handlinger (start, pause, advance) |
| `Game1HallReadyService` | `apps/backend/src/game/Game1HallReadyService.ts` | Per-hall ready-state |
| `Game1LobbyService` | `apps/backend/src/game/Game1LobbyService.ts` | Lobby-state-aggregat for SPILLER-shell (R1) |
| `GameLobbyAggregator` (Bølge 1, 2026-05-08) | `apps/backend/src/game/GameLobbyAggregator.ts` | **Kanonisk** lobby-state for MASTER/AGENT-konsoll. Erstatter dual-fetch + adapter-pattern. Eksponert via `GET /api/agent/game1/lobby`. |
| `Spill1LobbyBroadcaster` | `apps/backend/src/game/Spill1LobbyBroadcaster.ts` | Fan-out til lobby-rom (R1) |
| `Game1ScheduleTickService` | `apps/backend/src/game/Game1ScheduleTickService.ts` | Auto-flip scheduled→purchase_open→running |
| `GamePlanEngineBridge` | `apps/backend/src/game/GamePlanEngineBridge.ts` | Spawner scheduled-games fra plan-runtime |
| `GamePlanRunService` | `apps/backend/src/game/GamePlanRunService.ts` | Plan-run-state-machine |
| `GameCatalogService` | `apps/backend/src/game/GameCatalogService.ts` | Katalog-CRUD + calculateActualPrize |
| `Game1TicketPurchaseService` | `apps/backend/src/game/Game1TicketPurchaseService.ts` | Ticket-kjøp + compliance-binding (per kjøpe-hall) |
| `Game1PayoutService` | `apps/backend/src/game/Game1PayoutService.ts` | Vinner-utbetaling med pot-deling |
| `Game1TransferHallService` | `apps/backend/src/game/Game1TransferHallService.ts` | 60s-handshake for runtime master-overføring |
| `RoomAlertingService` | `apps/backend/src/observability/RoomAlertingService.ts` | R8 alerting til Slack/PagerDuty |
| `SocketIdempotencyStore` | `apps/backend/src/sockets/SocketIdempotencyStore.ts` | R5 socket dedup |

### 4.1 GameLobbyAggregator (Bølge 1) — kanonisk lobby-state for master/agent-UI

Aggregator-en er **single-source-of-truth** for hva master/agent-konsollet
viser. Tidligere hentet UI `/api/agent/game-plan/current` og
`/api/agent/game1/current-game` parallelt og merget felt-for-felt — det
skapte dual-fetch og ID-krangel-bugen som er dokumentert i
[`PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`](./PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md).

**Bølge 1 fundament:**
- **Wire-format:** `Spill1AgentLobbyState` i `packages/shared-types/src/spill1-lobby-state.ts` (Zod-validert)
- **Service:** `GameLobbyAggregator` i `apps/backend/src/game/GameLobbyAggregator.ts` (pure read; ingen state-mutering)
- **Route:** `GET /api/agent/game1/lobby?hallId=X` i `apps/backend/src/routes/agentGame1Lobby.ts`
- **Tester:** 16 snapshot-tester per state i `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` (alle passering) + integration-test mot ekte Postgres (skip-graceful)

**Kontrakt for Bølge 2/3 (UI-bytte):**
- `currentScheduledGameId` er ENESTE id-felt UI bruker for master-actions (start/pause/resume/stop). Aldri plan-run-id.
- `inconsistencyWarnings` er stabile koder (`PLAN_SCHED_STATUS_MISMATCH`, `MISSING_GOH_MEMBERSHIP`, `STALE_PLAN_RUN`, `BRIDGE_FAILED`, `DUAL_SCHEDULED_GAMES`) — Bølge 2 reconciliere på disse, Bølge 3 viser feilbannere.
- `halls[]` er ferdig-filtrert mot nåværende GoH-membership (stale haller flagget via warning).
- Aggregator throw KUN ved infrastruktur-feil (`LOBBY_AGGREGATOR_INFRA_ERROR` → 5xx). Alle "data ser rar ut"-scenarioer flagges som warnings, aldri throw.

**Bakover-kompatibilitet:** Eksisterende endpoints (`/current-game`, `/game-plan/current`, `/admin/game1/games/:id/...`) er IKKE påvirket. UI bytter til ny endpoint i Bølge 3 etter at Bølge 2 (MasterActionService) er på plass.

---

## 5. Beslutninger som er låst inn (immutable)

### 5.1 Spill 1 gevinstmønster

> **STATUSAVKLARING 2026-05-08:** Spill 1's gevinstmønstre er DEFINERT som `Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus` og skal ALDRI endres. Nye gevinstmønster-varianter (eks. Bokstav, T/L/X-mønstre) hører hjemme på Spill 3, ikke Spill 1.

### 5.2 Master-handling (Tobias 2026-05-08)

| Regel | Verdi |
|---|---|
| Master kan starte/stoppe uavhengig av om andre haller er ready | ✅ (ready-status er KUN informativ) |
| Master kan hoppe over neste spill i sekvensen | ❌ (alltid umiddelbart neste i spilleplan-rekkefølgen) |
| "Avbryt spill"-knapp for master | ❌ (flyttet til admin-only) |
| "Kringkast Klar + 2-min countdown" | ❌ (master starter direkte) |

### 5.3 Lobby-rom åpningstid (Tobias 2026-05-08)

> "Så lenge rommet er åpent skal man ha mulighet til å gå inn i rommet og kjøpe bonger. Åpningstidene blir da samme som spilleplanen."

Spill 1-rommet er åpent når `now ∈ [plan.startTime, plan.endTime]`. Klient ser neste planlagte spill og kan kjøpe bonger til det.

### 5.4 Multi-vinner pot-deling (Tobias 2026-05-08)

Pot per bongstørrelse, ikke flat-deling, ikke per-vinner-uavhengig. Se SPILL_REGLER_OG_PAYOUT.md §9.

### 5.5 Single-prize cap

**Kun databingo (SpinnGo) har 2500 kr-cap.** Hovedspill har INGEN cap. Lilla-bong får 3000 kr på Innsatsen Fullt Hus, 4500 kr på Oddsen-HIGH — det er forventet og regulatorisk OK.

### 5.6 Live-rom-robusthet — Evolution Gaming-grade

`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` er autoritativ. R1-R12 er pilot-gating eller post-pilot-gating. Eksternt SRE-løft autorisert hvis intern kapasitet ikke holder.

**Pilot-gating gjenstår etter denne sesjon:** R2 og R3 må KJØRES (chaos-tests) for å validere strukturell robusthet. Hvis avdekker problemer → pilot pauses per §6.1 go/no-go-policy.

### 5.7 Pilot-omfang (Tobias 2026-05-08)

4 haller. Utvidelse betinger:
- 4-hall-pilot grønn 2 uker
- R4 (load-test 1000) bestått
- R6 (outbox-validering) bestått
- R9 (Spill 2 24t-leak-test) bestått
- Null kjente compliance-feil

---

## 6. Kjente begrensninger og oppfølger-arbeid

### 6.1 Pilot-gating-tiltak som må kjøres

| Tiltak | Hva må gjøres |
|---|---|
| R2 Failover-test | Kjør `bash infra/chaos-tests/r2-failover-test.sh` med Docker daemon. Hvis I1-I4 FAIL → pause pilot per §6.1 |
| R3 Reconnect-test | Kjør `bash infra/chaos-tests/r3-reconnect-test.sh`. Samme go/no-go-policy |
| R12 Drill | Drill DR-runbook scenarier S1-S7 minst én gang i staging før pilot |

### 6.2 Post-pilot tiltak (R-mandat)

In-flight 2026-05-08 (kjører som agent-arbeid):
- R4 Load-test 1000 klienter (BIN-817)
- R6 Outbox-validering rom-events (BIN-818, in-flight)
- R9 Spill 2 24t-leak-test (BIN-819, in-flight)
- R10 Spill 3 phase-state-machine wireup (BIN-820, in-flight)
- R11 Per-rom resource-isolation (BIN-821, ikke startet)

### 6.3 UX-polish som ikke er pilot-blokkere

- Hard-delete cascade i kode (Agent P feilet pga worktree-konflikt 2026-05-08; FK-cascade i DB håndhever uansett)
- "Skriv navnet for å bekrefte"-dialog ved GoH-delete
- Pre-flight count i delete-dialog
- WCAG 2.2 AA accessibility-audit (BIN-807, post-pilot)
- Multi-language i18n (BIN-770, post-pilot)

### 6.4 Bug å være obs på

- **GoH-rydding:** Hvis admin oppretter GoH via UI (ikke seed), blir det en NY GoH med ny id. Eksisterende scheduled-games refererer den gamle. Anbefaling: rediger seed-GoH heller enn å lage ny. Hard-delete-cascade håndhever rydding ved sletting.
- **Token-invalidering ved backend-restart:** Sessions er memory-only i dev. Etter backend-restart må alle logge inn igjen. I prod migreres sessions til Redis (allerede på listen).
- **Phantom-rom etter restart:** Backend gjenoppretter rooms fra Redis. FLUSHALL Redis + restart for å få ren state.

### 6.5 Tobias-eier-issues (kan ikke agent-løses)

- BIN-787 Hardware-anskaffelse (terminaler, TV, scannere, printere)
- BIN-789 Support-team rekruttering
- BIN-793 + BIN-799 Pilot-hall-kontrakter
- BIN-780 Lotteritilsynet søknadspakke
- BIN-782 DPIA / GDPR-vurdering
- BIN-783 AML-rutiner
- BIN-784 RG-policy + kontaktperson
- BIN-802 Swedbank Pay live-credentials
- BIN-803 Forsikring (cyber + ansvar)

---

## 7. Hvordan teste pilot-flyten lokalt

### 7.1 Sett opp dev-stack

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
./start-dev.sh
```

Eller manuelt:
```bash
docker-compose up -d postgres redis
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run migrate
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run seed:demo-pilot-day
npm run dev:all  # eller: ./start-dev.sh
```

### 7.2 Test-trinn (5 min)

1. **Admin-side:** `http://localhost:5174/admin/`
   - Logg inn: `tobias@nordicprofil.no` / `Spillorama123!`
   - `/admin/#/games/catalog` → 13 spill
   - `/admin/#/games/plans` → "Pilot Demo — alle 13 spill"

2. **Agent-side:** Logg ut, logg inn som `demo-agent-1@spillorama.no` / `Spillorama123!`
   - `/admin/agent/cash-in-out` → master-konsoll
   - 4 haller listet (Demo 1 Master, Demo 2, Demo 3, Demo 4)
   - Klikk "Start neste spill — <name>" → scheduled-game spawnes

3. **Spiller:** Annen tab — `http://localhost:4000/web/?dev-user=demo-pilot-spiller-1`
   - Lobby vises
   - Når master har startet → live trekk

4. **TV:** `http://localhost:4000/tv/demo-hall-001/11111111-1111-4111-8111-111111111111`
   - Redirecter til admin-Vite TV-bundle
   - Live trekk vises

### 7.3 Hvis noe feiler

- **DB tom:** Kjør `npm --prefix apps/backend run migrate` + seed
- **Token utløpt:** Logg ut/inn i nettleser
- **Phantom-rom:** Drep backend, FLUSHALL Redis, restart
- **GoH-rotet:** SQL-rydd som vist i §6.4

---

## 8. Decisions log — denne sesjon (2026-05-08)

| Beslutning | Doc-ref | Linear |
|---|---|---|
| Master kan starte uavhengig av ready | SPILL_DETALJER §1.0 | (BIN-1017) |
| Lobby-rom åpent innenfor plan-åpningstid | SPILL_DETALJER §1.0.1 | BIN-822 |
| Bokstav flyttes til Spill 3 | SPILL_DETALJER §0.2 | (BIN-1004) |
| Pot-per-bongstørrelse multi-vinner | SPILL_REGLER §9 | (BIN-997) |
| Cap fjernet for hovedspill | SPILL_REGLER §4 | (BIN-1000) |
| GoH master-hall-velger | (UI) | (BIN-1034) |
| Live-rom-robusthet-mandat (Evolution-grade) | LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08 | BIN-810..822 |
| Go/no-go-policy: pause pilot ved strukturelle R2/R3-funn | LIVE_ROOM §6.1 | — |
| Eksternt SRE-løft kun ved trigger | LIVE_ROOM §8.1 | — |
| Pilot-omfang 4 haller | LIVE_ROOM §8.2 | — |
| FK-cascade ON DELETE for GoH-relasjoner | (DB-migration) | (BIN-1038) |
| PM eier git pull etter merge — Tobias rør aldri git | feedback_pm_pull_after_merge.md | — |

---

## 9. Vedlikehold av dette dokumentet

**Oppdater dette doku ved:**
- Hver sesjons-slutt med store endringer på Spill 1
- Nye beslutninger som overstyrer eksisterende
- Når R-tiltak går fra "infra klar" til "kjørt og bestått"
- Når post-pilot tiltak (R4/R6/R9/R10/R11) lander
- Endringer i datamodell

**Eier:** PM-AI vedlikeholder under utvikling. Tobias godkjenner større endringer.

**Konflikt-regel:** Ved uenighet mellom dette doku og kode, **doc-en vinner** — koden må fikses.

---

## 10. Referanser

- [SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) — kanonisk regel-spec
- [SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md) — per-spill-detaljer
- [SPILLKATALOG.md](./SPILLKATALOG.md) — spillkatalog (markedsføring vs slug)
- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — autoritativ robusthet-mandat
- [SPILL_2_3_CASINO_GRADE_AUDIT_2026-05-05.md](./SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md)
- [TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md](./TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md)
- [docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md](../operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) — manuell test-checklist
- [docs/operations/LIVE_ROOM_DR_RUNBOOK.md](../operations/LIVE_ROOM_DR_RUNBOOK.md) — DR-runbook (R12)
- Linear: [BIN-810 R-mandat parent](https://linear.app/bingosystem/issue/BIN-810) + R1-R12 children
- Linear: [Lansering 2026-Q3 — Evolution Gaming-grade pilot](https://linear.app/bingosystem/project/lansering-2026-q3-evolution-gaming-grade-pilot-908eacd8a077)

---

## 11. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial — konsolidert fra dagens sesjon. 14 PR-er merget, 7 R-tiltak ferdig, kanonisk doc-suite på plass. | PM-AI (Claude Opus 4.7) |

---

## 12. For nestemann som ser dette

Hvis du er en ny PM eller agent som starter på Spill 1:

1. **Les dette dokumentet i sin helhet.**
2. **Les SPILL_REGLER_OG_PAYOUT.md** — kanonisk regel-spec.
3. **Les LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md** — robusthet-direktiv.
4. **Sjekk Linear: BIN-810** for R-mandat-status.
5. **Verifiser at lokalt dev-miljø fungerer** (§7).
6. **IKKE fravik fra de fastlåste beslutningene** i §5. Hvis du finner en konflikt mellom kode og doc, doc-en vinner og koden må fikses.

**Spør Tobias** før du:
- Endrer master-handling-spec
- Endrer multi-vinner-regel
- Endrer §11-distribusjons-prosent
- Endrer pilot-go-live-kriterier
- Lager nye gevinstmønstre for Spill 1
