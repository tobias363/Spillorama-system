# Research: Hall ↔ Spill 1 Binding — 2026-04-24

**Scope:** Hvordan Spillorama-systemet binder haller til scheduled Game 1-runder, hvilke mekanismer som koordinerer multi-hall-spill (master/participating), og hvor det ligger gaps mot legacy-paritet og produksjonsbruk.

**Research-grunnlag:** Kode i `apps/backend/src/game/*.ts`, `apps/backend/src/routes/adminGame1*.ts`, `apps/backend/src/sockets/adminGame1Namespace.ts`, `apps/backend/src/sockets/adminHallEvents.ts`, `apps/backend/src/sockets/adminDisplayEvents.ts`, `apps/backend/src/sockets/game1ScheduledEvents.ts`, `apps/backend/migrations/*.sql`, samt legacy-referanse i `.claude/worktrees/slot-C/legacy/unity-backend/`.

---

## TL;DR

**Multi-hall-flyten er delvis portert.** Kjernen for Game 1 (master-start, exclude/include-hall, per-hall ready-flow, participating-halls-snapshot) er implementert og dekket av tester. Men flere legacy-mekanismer finnes ikke i ny stack:

1. **Ingen `transferHall`-flyt.** Legacy hadde runtime-overføring av master-rollen mellom haller (agent-initiert, admin-godkjent). Ny stack har ingen tilsvarende flyt — master-hall settes ved daily-schedule-spawn og er frossen for spillets levetid.
2. **Ingen sign-up/sign-off av haller mid-dag.** `participating_halls_json` er en snapshot som skrives én gang per `app_game1_scheduled_games`-rad ved scheduler-spawn. Det er ingen endpoint for at en hall kan melde seg *på* eller *av* et allerede spawnet scheduled-game (kun `excludeHall`/`includeHall` av master).
3. **To parallelle multi-hall-schemaer** (`app_draw_sessions` BIN-515 og `app_game1_scheduled_games` GAME1_SCHEDULE) — ingen er pensjonert. `app_draw_sessions` er generisk "linked-draw" med hash-chain audit (BIN-516), mens `app_game1_scheduled_games` er Game 1-spesifikk. Draw-engine bruker kun sistnevnte — det tidligere er dead code så langt jeg kunne finne i service-laget.
4. **Hall-cash-balanse er ikke koblet til ticket-salg eller payout.** Billettbetaling går gjennom wallet (for spillere) eller agent-kasse — `app_halls.cash_balance` muteres kun ved daglig shift-settlement, ikke per game.
5. **Kritisk gap:** Ingen hall-ready-TV-display-event. Ready-status broadcastes til master-UI og `hall:<id>:display`, men TV-displayet har ingen UI for ready-status i `adminDisplayEvents.ts` (state er kun current-game + winners).

File: `apps/backend/src/game/Game1MasterControlService.ts` (1072 linjer)
File: `apps/backend/src/game/Game1HallReadyService.ts` (400 linjer)
File: `apps/backend/src/game/Game1ScheduleTickService.ts` (930+ linjer)
File: `apps/backend/src/game/Game1DrawEngineService.ts` (2338 linjer)

---

## 1. Multi-hall-arkitektur

### 1.1 Master vs. Participating

**Ny stack (`app_game1_scheduled_games`, migrasjon 20260428000000):**

| Felt | Type | Semantikk |
|---|---|---|
| `master_hall_id` | TEXT NOT NULL FK → app_halls(id) | Hallen som eier start-knappen for denne scheduled game. Bingovert i denne hallen har GAME1_MASTER_WRITE-scope. |
| `group_hall_id` | TEXT NOT NULL FK → app_hall_groups(id) | Link-ID — hall-gruppa spillet kjører for. Brukes av admin-UI dagsoversikt (`idx_game1_sched_group_day`). |
| `participating_halls_json` | JSONB NOT NULL | Array av hall-IDer. Snapshot av daily_schedule.hallIds.hallIds + hall-group-members på spawn-tidspunkt. Master-hall er IKKE automatisk i listen — det er en implicit deltaker (se `allParticipatingHallsReady`). |
| `excluded_hall_ids_json` | JSONB DEFAULT '[]' | Haller master har ekskludert etter purchase_open (tekniske feil). Tom ved spawn. NB: faktisk ekskludering mutes i `app_game1_hall_ready_status.excluded_from_game`, ikke her — dette feltet er deprecated-mot-redundant (migration kommentar sier "haller master har ekskludert" men koden bruker ikke feltet i `assertPurchaseOpenForHall` eller `allParticipatingHallsReady`). |

**Master-hall-rollen** håndheves av `Game1MasterControlService.assertActorIsMaster` (Game1MasterControlService.ts:960-974):
```
- ADMIN: alltid godkjent
- SUPPORT: alltid avvist (FORBIDDEN)
- HALL_OPERATOR / AGENT: actor.hallId må matche game.master_hall_id
```

**Master-hallen settes ved spawn.** `Game1ScheduleTickService.spawnUpcomingGame1Games` (Game1ScheduleTickService.ts:321-686) leser `masterHallId` fra `daily_schedule.hall_ids_json.masterHallId` — hvis feltet mangler, skippes hele daily_schedule (logget som `skippedSchedules`). Participating-halls hentes fra `hall_ids_json.hallIds`.

**Legacy-opphav:** Mongo-schema `dailySchedule.masterHall` (object) og `dailySchedule.halls` (array). Ny stack bevarer denne strukturen i `hall_ids_json`-objektet.

### 1.2 Sign-up / Sign-off

**Per-hall ready-flow (`app_game1_hall_ready_status`, migrasjon 20260428000100):**

| Action | Endpoint | Service | Legacy-paritet |
|---|---|---|---|
| "Hallen min er klar" | `POST /api/admin/game1/halls/:hallId/ready` | `Game1HallReadyService.markReady` | ✅ matcher legacy `ReadyScenario` |
| "Angre klar" | `POST /api/admin/game1/halls/:hallId/unready` | `Game1HallReadyService.unmarkReady` | ✅ |
| "Ekskluder hall (teknisk feil)" | `POST /api/admin/game1/games/:gameId/exclude-hall` | `Game1MasterControlService.excludeHall` | Nytt — legacy hadde ikke eksplisitt hall-exclude |
| "Re-inkluder hall" | `POST /api/admin/game1/games/:gameId/include-hall` | `Game1MasterControlService.includeHall` | Nytt |

**Hall-scope-håndheving** i `adminGame1Ready.ts:57-84` (`assertHallScopeForReadyFlow`):
- ADMIN + SUPPORT: global scope (kan markere ready på alle haller)
- HALL_OPERATOR: bruker `assertUserHallScope` — `user.hallId` må matche `targetHallId`
- AGENT: `user.hallId` må matche `targetHallId` (lokal sjekk, ikke via `assertUserHallScope` som er HALL_OPERATOR-only per BIN-591)

**GAP: Ingen runtime sign-up eller sign-off.** En hall kan ikke "melde seg på" et allerede spawnet scheduled-game som den ikke var i `participating_halls_json` for. Det finnes heller ingen "forlat scheduled-game"-endpoint. Legacy gjorde dette implisit gjennom agent-reset av daily_schedule + transferHall — se §1.3.

### 1.3 Transfer hall access

**Legacy-flyt** (`slot-C/legacy/unity-backend/Game/AdminEvents/AdminController/AdminController.js:253-522`):

| Socket-event | Legacy handler | Semantikk |
|---|---|---|
| `checkTransferHallAccess` | `AdminController.checkTransferHallAccess` | Hall sjekker om den har fått offer om å overta master. Ser `otherData.transferHall.validTill` (60s TTL). |
| `transferHallAccess` | `AdminController.transferHallAccess` | Agent/hall-operator i nåværende master-hall sender tilbud til en annen hall. Lager `otherData.transferHall` med `validTill = now + 60s`. Emit `hallTransferRequest` til target-hall. |
| `approveTransferHallAccess` | `AdminController.approveTransferHallAccess` | Target-hall aksepterer → `dailySchedule.masterHall` oppdateres + alle child-games settes `otherData.masterHallId`. Emit `pageRefresh` til begge haller. Reject → `otherData.transferHall = {}`. |

**Ny stack: finnes ikke.** Jeg fant ingen `transferHall`-relaterte endpoints, services, eller socket-events i `apps/backend/src/`. `git grep -r transferHall apps/backend/src/` returnerer 0 treff.

**Konsekvens:** Hvis master-hallen mister kontroll (bingovert syk, internet nede) midt i dagen, må operasjonen enten (a) vente til neste spawn-runde der admin manuelt kan endre `daily_schedule.hall_ids_json.masterHallId`, eller (b) direkte-edit databasen. Ingen self-service-flyt.

**Prioritert gap:** Dette er en produksjonskritisk mangel for pilot-operasjoner.

---

## 2. Ready/Not-Ready-flyt

### State-maskin

`app_game1_scheduled_games.status` (migrasjon 20260428000000:87-96):
```
scheduled → purchase_open → ready_to_start → running → paused → completed | cancelled
```

### Ready-signaleringsflyt

1. **Scheduler-tick** (`Game1ScheduleTickService.openPurchaseForImminentGames`, Game1ScheduleTickService.ts:692-705) flipper `scheduled → purchase_open` når `scheduled_start_time - notification_start_seconds <= now`.
2. **Bingovert per hall** trykker "klar" i admin-UI → `POST /api/admin/game1/halls/:hallId/ready` → `markReady` UPSERT i `app_game1_hall_ready_status` med `is_ready=true, ready_at=NOW()`.
3. **Snapshot av sales** ved ready-trykk: `digital_tickets_sold` (fra caller/UI) + `physical_tickets_sold` (COUNT fra `app_physical_tickets WHERE assigned_game_id=$gameId AND hall_id=$hallId AND status='SOLD'`). Game1HallReadyService.ts:163-164, 351-375.
4. **Purchase-cutoff for hallen:** `assertPurchaseOpenForHall` (Game1HallReadyService.ts:305-333) kaster `PURCHASE_CLOSED_FOR_HALL` hvis `game.status='purchase_open' AND hall.is_ready=true`. Brukt av `Game1TicketPurchaseService.purchase:294-297`.
5. **Broadcast:** `adminGame1Ready.ts:185-191` emit `game1:ready-status-update` til (a) global `io.emit`, (b) `hall:<hallId>:display` room. Inkluderer `allReady: boolean`.
6. **Scheduler-tick** (`Game1ScheduleTickService.transitionReadyToStartGames`, ~744-850) flipper `purchase_open → ready_to_start` når `allParticipatingHallsReady(gameId) === true`.

### Hvem kan signere ready

`adminGame1Ready.ts:57-84` + `AdminAccessPolicy.ts:328`:
- **AGENT** (bingovert): kun egen hall (`user.hallId === targetHallId`)
- **HALL_OPERATOR**: via `assertUserHallScope` (BIN-591) — egen hall
- **ADMIN / SUPPORT**: alle haller (ADMIN via rolle, SUPPORT via ikke-excluded rolle-sjekk i `assertHallScopeForReadyFlow`)

**Merk: SUPPORT kan trykke ready** i nåværende kode (adminGame1Ready.ts:61-63 short-circuit før AGENT-sjekken). Det er rart gitt at SUPPORT er utelatt fra GAME1_MASTER_WRITE; kan være intendert for compliance-override men ikke dokumentert.

### Countdown mellom ready og actual start

**Ingen egen countdown-mekanisme.** Overgangen `ready_to_start → running` skjer kun ved at master trykker start (`Game1MasterControlService.startGame:297-392`). Det finnes ingen timer som auto-starter etter ready_to_start. Dette matcher legacy: `dailySchedule.status='running'` ble satt manuelt av master-hall.

`countdownToNextGame` finnes i `TvScreenService.getState` (TvScreenService.ts:243-251), men det er for å vise "neste spill om X sek" på TV-skjermen, basert på `scheduled_start_time`, ikke på ready-status.

### Hva skjer hvis en hall ikke er klar

1. `purchase_open` ligger til alle non-excluded haller har `is_ready=true` (allParticipatingHallsReady, Game1HallReadyService.ts:288-293).
2. Master kan `excludeHall` (Game1MasterControlService.ts:394-474) — setter `excluded_from_game=true`, ruller tilbake `ready_to_start → purchase_open` hvis allerede var i ready_to_start.
3. Master kan ikke ekskludere master-hallen selv (`CANNOT_EXCLUDE_MASTER_HALL`, linje 410-415).
4. Ved start i `purchase_open` må master bekrefte ekskluderte haller via `confirmExcludedHalls: string[]` (linje 330-337). Uten bekreftelse → `EXCLUDED_HALLS_NOT_CONFIRMED`.
5. Hvis `scheduled_end_time < now` og status ∈ {scheduled, purchase_open, ready_to_start} → scheduler-tick (`cancelEndOfDayUnstartedGames`, Game1ScheduleTickService.ts:711-724) setter status='cancelled' med `stop_reason='end_of_day_unreached'`.

### Abort-flyt

`Game1MasterControlService.stopGame` (Game1MasterControlService.ts:647-760):
- Gyldig i status ∈ {purchase_open, ready_to_start, running, paused}
- Setter `status='cancelled'`, `stop_reason=$reason`, `actual_end_time=NOW()`
- POST-commit: delegerer til `drawEngine.stopGame` (hvis running/paused) eller `destroyRoomForScheduledGameSafe` (hvis pre-running — rydder opp eventuelle BingoEngine-rom fra `game1:join-scheduled`)
- Auto-refund av alle purchases via `ticketPurchaseService.refundAllForGame` (fail-closed per rad)
- Audit: `'stop'` med `{reason, priorStatus}` i metadata

---

## 3. Hall-display / TV per hall

### Per-hall TV-autentisering

To parallelle token-mekanismer:

**BIN-503 `app_hall_display_tokens`** (migrasjon 20260418150000) — socket-handshake:
- Hash-lagret (sha256), plaintext vises én gang ved opprettelse
- Flere tokens per hall (én per TV-kiosk), rotérbar uten re-deploy
- Brukt av `admin-display:login` socket-event (adminDisplayEvents.ts:115-129)

**`app_halls.tv_token`** (migrasjon 20260423000100) — URL-embedded public token:
- UNIQUE NOT NULL per hall, gen_random_uuid()
- Brukt av `/api/tv/:hallId/:tvToken/state` og `/api/tv/:hallId/:tvToken/winners`
- Enkel stabil URL for public TV-skjerm — limen er `TvScreenService` som returnerer state uten login-gate

### TV-state per hall

`TvScreenService.getState(hall)` (TvScreenService.ts:154-270):
- **Current game:** `findActiveScheduledGame(hallId)` — WHERE `master_hall_id = $hallId OR participating_halls_json @> to_jsonb($hallId)` AND status ∈ {running, paused, purchase_open, ready_to_start}
- **Fallback:** `findLatestCompletedScheduledGame` hvis ingen aktiv (for "game over" / winners-visning)
- **Next game:** `findNextScheduledGame` for sub-header
- **Patterns:** 5 faser (Row 1 → Full House) med `highlighted` for current phase
- **Balls:** siste 5 trukne + total draw-count
- **Jackpot/winners:** aggregeres fra `app_game1_phase_winners WHERE scheduled_game_id=...`

### Hvor kommer state fra i multi-hall-case?

**Samme scheduled_game, men TV-state er spørrebasert per hallId.** Queryen treffer `WHERE master_hall_id=$hallId OR participating_halls_json @> $hallId`, så en deltagende hall ser samme aktive game som master-hallen. Men:
- **Winners-state er IKKE filtrert per hall i `getState`** — `buildPatternRows` returnerer aggregert pattern-count for hele spillet. Vinnende brett fra andre haller vises i `highlighted`-fasen.
- **`getWinners`** (TvScreenService.ts:276-336) returnerer `hallName`-streng for vinnerens hall (komma-separert hvis flere haller vinner). Dette er en public-display-presentasjon, ikke filtrering.

**GAP:** Ingen hall-isolert TV-state for "kun mine vinnere". Hvis hall B vinner i et multi-hall-spill, vises det på hall A sin TV også. Dette matcher legacy-intensjonen (multi-hall = felles show), men det er ikke dokumentert som ønsket oppførsel.

### Socket-events til TV

`adminDisplayEvents.ts:145` — TV joiner `hall:<id>:display` rom. Events mottatt:
- `admin:hall-event` (room-ready, paused, resumed, force-ended) — fra `adminHallEvents.ts:146-153`
- `game1:ready-status-update` (fra `adminGame1Ready.ts:188` spesifikt for hall-display)
- Draw/pattern-broadcasts er kun via `roomCode` (BingoEngine-rom), ikke hall-scoped — TV må ha joined room-code via `resolveActiveRoomForHall` (adminDisplayEvents.ts:147-148).

### Claim-display per hall eller globalt

`app_hall_display_tokens` har PRIMARY KEY `(id)` og index `(hall_id) WHERE revoked_at IS NULL` — flere tokens per hall støttet, én token = én kiosk. Ingen "claim exclusive display" — alle tokens for en hall kan være aktive samtidig.

---

## 4. Sub-games

### Forholdet mellom parent og sub-games i Game 1

Game 1 har *ingen parent/child-hierarki i scheduled_games.* I motsetning til Game 2/Game 3 (hvor `SubGameManager.planChildren` genererer child-rader per sub-game), lagrer Game 1 hvert sub-game som **én separat rad i `app_game1_scheduled_games`** med unik `sub_game_index`.

- Schedule-mal (`app_schedules.sub_games_json`) har array av subGame-config (pattern, pris, jackpot, start/end-tid per sub-game)
- Scheduler-tick (`Game1ScheduleTickService`) itererer subGames-arrayen og INSERTer én rad per subGame per dag
- UNIQUE (daily_schedule_id, scheduled_day, sub_game_index) hindrer dobbel-spawn

Legacy-mapping: `subGame1` Mongo-model (`app_sub_games`-tabell i BIN-621) er admin-katalog av gjenbrukbare pattern-bundles. Daily_schedule refererer til dem via `subgames_json` i daily_schedule og `sub_games_json` i schedule-malen.

### Per sub-game: konfig som snapshot

Ved spawn kopierer scheduler følgende inn i scheduled_games-raden (Game1ScheduleTickService.ts:618-651):
- `ticket_config_json` = `sg.ticketTypesData` (farger, priser, prizes)
- `jackpot_config_json` = `sg.jackpotData` (per-farge jackpot + draw-grense)
- `notification_start_seconds` = parset fra `sg.notificationStartTime`
- `sub_game_name` + `custom_game_name` — denormalisert for rapporter
- `game_config_json` = hele `GameManagement.config_json`-snapshot (for variant-config)

**Snapshot-pattern** beskytter mot mal-endringer midt i plan-perioden. Hver subGame er selv-innehold.

### Overgang mellom sub-games

**Ingen automatisk overgang.** Hvert sub-game er et helt selvstendig scheduled_game med egen state-maskin. Master må starte hver sub-game separat. Tickets kjøpes per scheduled_game via `Game1TicketPurchaseService.purchase({scheduledGameId, ...})`.

**Hva bæres over:** ingenting runtime-mellom sub-games. Pot/jackpot-state (`Game1JackpotService`) leses per-scheduled_game fra `jackpot_config_json`. Det finnes ingen "pot-overføring mellom sub-games" i Game 1 (til forskjell fra Game 2 som har mer komplekse cross-game-pot-flyter via `PotEvaluator`).

### Legacy-gap

Legacy hadde `game.subGames[]` array med embedded state. Ny stack normaliserer til flate scheduled_games-rader. Dette er bedre for multi-hall men krever at admin-UI kan liste "alle sub-games for dag X" — feltet eksponeres via `adminReportsGame1Management.ts`.

---

## 5. Ticket-salg → hall/sub-game-binding

### Purchase-struktur

`app_game1_ticket_purchases` (refereres fra kode, ikke sett migrasjonen direkte men `Game1TicketPurchaseService.insertPurchaseRow:909-927`):
```
id, scheduled_game_id, buyer_user_id, hall_id, ticket_spec_json,
total_amount_cents, payment_method, agent_user_id, idempotency_key
```

Per purchase:
- `scheduled_game_id` — hvilket sub-game hører purchase til
- `hall_id` — hvilken hall ble kjøpet gjort fra (enten via agent-POS eller digital_wallet i hallen)
- `ticket_spec_json` — array av `{color, size, count, priceCentsEach}`

### Assignment-struktur (grid-generering ved game-start)

`app_game1_ticket_assignments` (migrasjon 20260501000000):
- **Én rad per fysisk-digital billett** (ikke per purchase-spec-entry)
- `scheduled_game_id`, `purchase_id`, `buyer_user_id`, `hall_id` — denormalisert for queries
- `grid_numbers_json` — 5x5 = 25 celler, index 12 = 0 (free centre)
- `markings_json` — `{marked: [bool × 25]}`, oppdateres av `drawNext`

**Grid genereres ved `startGame`**, ikke ved purchase (legacy-paritet). Dette betyr at hvis et spill aldri starter, har ingen billetter grids.

### Payment methods og hall-kobling

`Game1TicketPurchaseService.purchase` (Game1TicketPurchaseService.ts:266-500):

| paymentMethod | Hvem betaler | Hall-scope |
|---|---|---|
| `digital_wallet` | Spilleren selv via wallet-adapter | hallId = hvor kjøpet ble registrert (fra UI/context) |
| `cash_agent` | Agent i hall tar kontant, wallet-kreditering skjer via agent-shift | hallId = agent.hallId (krever aktiv shift — håndheves i route) |
| `card_agent` | Agent tar kortbetaling i hall | samme som cash_agent |

### Per-hall vs. global pot for prizes

**Phase prizes (Row 1-4 + Full House):** Total pot regnes fra `ticket_config_json.totalPrize` × alle solgte billetter av matching farge/størrelse på tvers av alle participating haller. Splittes likt mellom vinnende brett (uavhengig av hall). `Game1PayoutService.executePhasePayout` (refereres fra `Game1DrawEngineService.drawNext`).

**Jackpot (Full House):** Per-farge. `Game1JackpotService.evaluate` leser `ticket_config_json.jackpot.prizeByColor` per-farge — f.eks. hvit farge kan ha 30 000 kr jackpot, grønn 10 000 kr. Jackpot utløses kun hvis Full House vinnes ≤ `jackpotConfig.draw` (typisk 50..59).

**Viktig:** Pot + jackpot er **scheduled_game-scope, ikke hall-scope**. Det finnes ingen "hall A sin pot" separat fra "hall B sin pot" for det samme scheduled_game. Alle deltakende haller konkurrerer om samme pot.

### Purchase-validering mot hall

`Game1TicketPurchaseService.assertHallParticipates` (linje 796-808): hallId må være i `participating_halls_json` ELLER være `master_hall_id`. Master-hallen er implicit deltaker selv om den ikke er i listen (matcher `allParticipatingHallsReady`-logikken).

---

## 6. Hall-spesifikk config

### Patterns per hall vs. global per scheduled_game

**Patterns er scheduled_game-scope, ikke hall-scope.** `ticket_config_json` og `jackpot_config_json` er snapshot per scheduled_game-rad. Alle deltakende haller har samme pattern-config.

Dette er tilsiktet: multi-hall-spill handler om å ha *felles* spill. Pattern-differensiering per hall ville ødelagt "samme trekk, samme brett-muligheter"-invarianten.

### Ticket-color-priser per hall

**Per-hall-priser eksisterer ikke.** `ticket_config_json` snapshotter `schedule.subGame.ticketTypesData` som er globalt per subGame-mal. Ny stack har ingen variabel-injeksjon for per-hall-pris.

Legacy-sjekk: `dailySchedule.halls` (array) hadde per-hall-objekter med `{id, name, status}` — ingen pris-override på hall-nivå. Matcher ny stack.

### Jackpot-terskel per hall

Nei. `jackpotConfig.draw` er per-scheduled_game. Hvis hall A kjører "Hovedspill 1 kl. 19:00" og hall B også deltar, har de samme jackpot-draw-grense.

### Variant-config per hall

`app_game1_scheduled_games.game_config_json` (satt av scheduler fra `GameManagement.config_json`) er per-scheduled_game. Admin kan ha en GameManagement-rad per hall i teori, men scheduler ser én `game_management_id` per daily_schedule-rad, så effektivt blir det en config per scheduled_game.

### Hall-client-variant (BIN-540, nå pensjonert)

`HallClientVariant` finnes som tom type `"web"` (PlatformService.ts:77) med no-op settere (migrasjon 20260429000000 dropper DB-kolonnen). Gap lukket.

---

## 7. Hall cash-balanse i spill

### BIN-583 cash_balance-felt

`app_halls.cash_balance` (migrasjon 20260418250200) + `app_halls.dropsafe_balance`. Muteres atomisk via `HallCashLedger.applyCashTx` i `app_hall_cash_transactions` (migrasjon 20260418250300).

### Tx-typer som muterer cash_balance

- `DAILY_BALANCE_TRANSFER` — agent-shift → hall ved close-day settlement
- `DROP_SAFE_MOVE` — intern flytting mellom cash_balance og dropsafe_balance
- `SHIFT_DIFFERENCE` — cash-count-diff > 0
- `MANUAL_ADJUSTMENT` — admin-justering med note

**Ingen av disse utløses av Game 1 ticket-kjøp eller payout.** Ticket-betaling går via wallet-adapter (for digital_wallet) eller agent-shift-kasse (for cash_agent/card_agent). Payout går via wallet-credit til spillerens wallet.

### Hvor er "hallens pott" for prizes

`makeHouseAccountId(hallId, "databingo", "hall" | "internet")` (ComplianceLedgerValidators.ts:130-132) genererer wallet-adapter-ID per (hall, gameType, channel). F.eks. `"house-notodden-databingo-hall"`. Dette er en logisk wallet-konto for compliance-spor (§71 i pengespillforskriften), ikke `app_halls.cash_balance`.

Se `adminHallEvents.ts:60-67`: `admin:hall-balance` socket-event returnerer saldo for alle (gameType, channel)-par for hallen. Legacy-paritet for `getHallBalance`.

### Payout-cap per hall

**Ikke implementert.** Prize-cap finnes globalt i `BingoEngine` (per-game fra `variantConfig`), men det er ingen per-hall payout-cap-mekanisme. Hvis en hall vinner Full House med jackpot, utbetales full pot uavhengig av hallens `cash_balance` eller house-account-balance.

**Spill1-spesifikk gap:** Hvis en hall "går tom" (hallens deltakere har vunnet mye, men billettsalget i hallen var lavt), er det ingen fail-safe som overhaler. Payout går via wallet-adapter og kan i teori føre til negative house-account-balanser.

---

## 8. Roller

### Rolle-matrise

`PlatformService.APP_USER_ROLES`: `ADMIN | HALL_OPERATOR | SUPPORT | PLAYER | AGENT`

Per `AdminAccessPolicy.ts`:

| Handling | ADMIN | HALL_OPERATOR | AGENT | SUPPORT | PLAYER |
|---|---|---|---|---|---|
| `GAME1_MASTER_WRITE` (start/pause/stop) | ✅ global | ✅ egen master-hall | ✅ egen master-hall | ❌ | ❌ |
| `GAME1_HALL_READY_WRITE` (ready/unready) | ✅ global | ✅ egen hall | ✅ egen hall | ❌ (men er bypass-sjekk i route?) | ❌ |
| `GAME1_GAME_READ` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `GAME1_PURCHASE_WRITE` | ✅ | ❌ | ✅ (egen hall via shift) | ❌ | ✅ (egen user) |
| `ROOM_CONTROL_WRITE` (admin:pause/resume/force-end) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `admin:hall-balance` | ✅ | ✅ (ROOM_CONTROL_READ) | ❌ | ❌ | ❌ |

### Hvilke roller jobber "i hallen"

**Bingovert-rollen** i legacy → to roller i ny stack:
- **HALL_OPERATOR:** administratorrolle i hallen. Klarer master-control + ready-flow. Typisk 1 per hall, knyttet via `app_users.hall_id` (BIN-591).
- **AGENT:** skift-basert POS-rolle. Selger billetter ved agent-terminal, tar kontant, starter/slutter shift. Kan også markere hall ready (AGENT er i GAME1_HALL_READY_WRITE + GAME1_MASTER_WRITE).

**Agent-binding til haller:**
- `app_users.hall_id` — primær hall (BIN-591)
- `app_agent_halls` (migrasjon 20260418220100) — agent kan serve flere haller (BIN-583)
- Aktiv `app_agent_shifts`-rad binder agent til én hall per skift

**Kan en hall ha flere agenter samtidig?** Ja — `app_agent_shifts` har ingen UNIQUE på `hall_id + status='OPEN'`. Flere agenter kan være i aktiv shift i samme hall samtidig.

**Super-admin overstyring:** ADMIN-rollen har global scope og kan:
- Ekskludere/inkludere haller i andres master-hall-spill
- Force-end rom via `admin:force-end` socket-event
- Refund purchases via `refundAllForGame`

**SUPPORT** er bevisst utelatt fra master-write og ticket-write — kun read-nivå for compliance-innsyn.

---

## 9. Scenarier

### 9.1 Hall A master, B+C participating. Hall C offline under runde.

**Flyt i ny stack:**
1. Hall C sin bingovert kontakter master (hall A) via separat kanal.
2. Master trykker `POST /api/admin/game1/games/:gameId/exclude-hall` med `{hallId: C, reason: "teknisk feil"}`.
3. Service setter `app_game1_hall_ready_status.excluded_from_game=true` for hall C.
4. Hvis status var `ready_to_start` → ruller tilbake til `purchase_open` så master må bekrefte eksklusjonen via `confirmExcludedHalls: ["C"]` ved neste start-trykk.
5. Hall C sine tickets forblir gyldige; hvis de vinner regnes de fortsatt med i pot-split (det er excluded fra READY-invarianten, ikke fra spillet).

**Wait — sjekket ut dette?** `excluded_from_game` påvirker kun `allParticipatingHallsReady` og `assertPurchaseOpenForHall`. Det finnes ingen filter i `Game1DrawEngineService.drawNext` eller `Game1PayoutService` som ekskluderer hall C's tickets fra winnings. Så hall C's spillere vinner fortsatt — dette er tilsiktet (hvem som er "ready" er for salg-lukking, ikke for spiller-deltakelse).

**Gap:** Det er ikke dokumentert tydelig at `excludeHall` betyr "stopp å vente på at hallen blir klar for å starte" vs. "fjern hallens spillere fra spillet". Koden gjør det første. Legacy-semantikken er uklar.

### 9.2 Master-hall har ingen ready-agenter 30s etter planlagt start

**Flyt i ny stack:**
1. Status forblir `purchase_open` (ingen auto-cancel før `scheduled_end_time < now`).
2. `Game1MasterControlService.recordTimeoutDetected` (linje 766-807) skriver `'timeout_detected'`-audit hvis noe annet oppdager timeout — men det kalles ikke automatisk av scheduler.
3. `cancelEndOfDayUnstartedGames` (Game1ScheduleTickService.ts:711-724) setter status='cancelled' når `scheduled_end_time < now` — typisk flere timer etter start.
4. Mens man venter: admin kan manuelt `POST /stop` med `reason="master unavailable"` → cancel + auto-refund.

**Gap:** Ingen auto-escalation. Hvis master-hallen er død og ingen melder det, blir spillet bare hengende til end-of-day-tick cancellerer det. Legacy hadde `transferHall`-flyt som kunne flytte master-rollen — se §1.3.

### 9.3 Vinner i hall B, men game er i master-hall A. Hvor utbetales?

Payout går via wallet-adapter til spillerens wallet, ikke til hallen. `Game1PayoutService.executePhasePayout` itererer `Game1WinningAssignment[]` (hver med `walletId`, `userId`, `hallId`, `ticketColor`) og kaller `wallet.credit(walletId, amount)` for hver vinner.

Compliance-logging (ComplianceLedger) gjør debit fra `house-<masterHallId>-databingo-<channel>`. Så house-account for master-hall A belastes, selv om vinneren er i hall B.

**Regulatorisk gap:** §71 pengespillforskriften skiller mellom `HALL` og `INTERNET` kanal for samme hall. Men vi har ikke en kanal per deltakende hall i en multi-hall-runde. Alle tickets (fra alle haller) kjøpt via `cash_agent/card_agent` regnes som `HALL`-kanal mot *master-hallens* house-account. Dette kan være feil for rapportering — hall B burde ha sin egen `HALL`-linjeføring for billettene sine.

Verifiser: i `Game1TicketPurchaseService` settes `hall_id` til hallen hvor kjøpet skjedde (riktig), men compliance-ledger-entry bruker `masterHallId` fra scheduled_game (potensielt feil for multi-hall-oppgjør). Dette er et **prioritert regulatorisk risiko**.

### 9.4 To haller har overlappende scheduled games

**Per BIN-665:** `app_hall_group_members` PRIMARY KEY (group_id, hall_id) tillater at en hall er medlem av flere grupper. UNIQUE-constraint på `app_halls.hall_group_id` (BIN-515 multi_hall_linked_draws) ville blokkert dette, men den constraintet er *hall_group_id på app_halls-raden*, ikke på medlemskapslisten. I praksis har vi to parallelle modeller:

- **BIN-515 `app_halls.hall_group_id`** (kolonne på hall-raden): én-til-én-forhold. Dette brukes av `app_draw_sessions` (BIN-515).
- **BIN-665 `app_hall_group_members`** (join-tabell): mange-til-mange. Dette brukes av Game 1 (`group_hall_id` på scheduled_games via gruppe-medlem-lookup).

**Kan en hall delta i to scheduled_games samtidig?** Ja — ingenting i schema eller kode forhindrer det. Hall C kan være `participating_halls_json` i både Hovedspill 1 (19:00-19:30) og Hovedspill 2 (19:15-19:45). Men bingovert-UI vil være forvirrende (hvilket spill trykker de "klar" for?).

**Gap:** Det er ingen UNIQUE-constraint eller validering på "hall X kan ikke delta i overlappende scheduled_games". Dette kan være OK (bingovert må manuelt velge hvilket spill de markerer ready for), men det er ingen UX-veiledning eller race-safety.

### 9.5 Hall bytter fra master til participating midt i dagen

**Ny stack: finnes ikke som runtime-flyt.** Som nevnt i §1.3 er master-hall frossen ved scheduled_game-spawn. Admin kan endre `daily_schedule.hall_ids_json.masterHallId` → nye scheduled_games for morgendagen får ny master, men eksisterende scheduled_games (inkludert future-today) beholder sin master.

For å bytte master på dagens scheduled_games, må admin:
1. `POST /stop` på alle upcoming scheduled_games for i dag som bruker gammel master.
2. Manuelt endre `app_daily_schedules.hall_ids_json.masterHallId` i DB.
3. Vente på neste scheduler-tick som spawner nye rader med ny master (hvis det er rader innenfor 24t-vinduet).

**Legacy hadde `transferHallAccess`** som gjorde dette på 60 sekunder med master → target handshake. Ny stack har ingen tilsvarende flyt. **Prioritert gap.**

---

## 10. Prioritert gap-liste

### Kritiske (blokkere for pilot med multi-hall)

1. **`transferHallAccess`-flyt mangler.** Kan ikke flytte master-rollen runtime. Hvis master-hall har feil eller bingovert blir borte, må admin gjøre DB-edits. Legacy ref: `AdminController.js:302-522`. **Fix-estimat:** 2-3 dager å porte legacy-logikken (sockets + service + DB-migrasjon for `otherData.transferHall` eller egen tabell).

2. **Per-hall compliance-kanal for multi-hall-spill.** `ComplianceLedger` logger alle purchases mot master-hallens house-account, ikke hvor kjøpet ble gjort. §71-rapport kan bli feil per hall. **Fix-estimat:** endre `Game1TicketPurchaseService.insertPurchaseRow` til å bruke `input.hallId` (ikke master) i compliance-debit.

3. **Ingen eksplisitt "hall-offline"-deteksjon.** Hvis en hall mister nett midt i en runde, er det ingen heartbeat/ping som markerer den som inaktiv. Master må manuelt `excludeHall` eller `stopGame`. **Fix-estimat:** mindre — kan implementeres som socket-ping i `adminDisplayEvents.ts` med timeout-watchdog.

### Høy-prioritet (bør fikses før produksjon)

4. **Overlappende scheduled_games per hall.** Ingen validering. UX-risiko. **Fix-estimat:** DB-constraint + UI-validering i admin-forms.

5. **`excluded_hall_ids_json` på scheduled_games er dead code.** Feltet finnes men brukes ikke. Fjern eller fyll inn (speil av ready_status-tabellen).

6. **Auto-escalation når master ikke trykker start.** Spill henger i `ready_to_start` til end-of-day. Trenger enten auto-start-timer eller støre til admin.

7. **`SUPPORT`-rollens ready-bypass er udokumentert.** `assertHallScopeForReadyFlow` linje 61-63: SUPPORT kan markere ANY hall ready. Tilsiktet? Dokumenter eller fjern.

### Medium-prioritet (kvalitetsforbedringer)

8. **TV-display viser ikke ready-status for andre haller.** `adminDisplayEvents.ts` lytter på `game1:ready-status-update` men snapshot-shape har ikke ready-array. UX-gap: spillere i hall A ser ikke om hall B er klar.

9. **Dual multi-hall-schema (app_draw_sessions vs app_game1_scheduled_games).** Pensjoner ett eller dokumenter tydelig hvilket er kanonisk. Currently Game 1 bruker kun `app_game1_scheduled_games`, men `app_draw_sessions`-migrasjon (20260416000001) er aktiv og tabellen er tom.

10. **Per-hall payout-cap mangler.** Ingen fail-safe hvis hall B har lite billettsalg og stor winning. Kan trenge `max_payout_cents_per_hall`-felt på scheduled_games eller sentral cap-logikk.

### Lav-prioritet (design-avklaringer)

11. **Master-hall er implicit deltaker.** Dokumentér at master er ALLTID i `participating_halls_json` selv om den ikke står eksplisitt i JSON-arrayen.

12. **Hall-specific pattern/price-config** ikke støttet (ingen per-hall-override). Avklart: legacy hadde det ikke heller, men dokumenter.

13. **Ingen "hall forlater spill mid-dag"-flyt.** Hvis hall C vil melde seg av for resten av dagen, må admin fjerne fra `daily_schedule.hall_ids_json` + vente på neste spawn.

---

## Appendix: Key filer

- `apps/backend/src/game/Game1MasterControlService.ts` — master-control (start/pause/stop/exclude/include)
- `apps/backend/src/game/Game1HallReadyService.ts` — per-hall ready-signalering + purchase-cutoff
- `apps/backend/src/game/Game1ScheduleTickService.ts` — scheduler-spawn + state-transisjoner
- `apps/backend/src/game/Game1TicketPurchaseService.ts` — purchase-flow med hall-validering
- `apps/backend/src/game/Game1DrawEngineService.ts` — draw-engine (calls payout, handles room destruction)
- `apps/backend/src/game/Game1PayoutService.ts` — phase payout med split-rounding
- `apps/backend/src/game/Game1JackpotService.ts` — jackpot-evaluering (per-farge)
- `apps/backend/src/game/TvScreenService.ts` — TV-state per hall
- `apps/backend/src/routes/adminGame1Master.ts` — HTTP-endepunkter for master-control
- `apps/backend/src/routes/adminGame1Ready.ts` — HTTP-endepunkter for ready-flow
- `apps/backend/src/sockets/adminGame1Namespace.ts` — `/admin-game1` real-time events
- `apps/backend/src/sockets/adminHallEvents.ts` — legacy-admin hall-socket-events (BIN-515)
- `apps/backend/src/sockets/adminDisplayEvents.ts` — TV-display socket-flyt
- `apps/backend/src/sockets/game1ScheduledEvents.ts` — player-join for scheduled game
- `apps/backend/migrations/20260428000000_game1_scheduled_games.sql` — kjernetabellen
- `apps/backend/migrations/20260428000100_game1_hall_ready_status.sql` — ready-flagg per hall
- `apps/backend/migrations/20260428000200_game1_master_audit.sql` — audit for master-actions
- `apps/backend/migrations/20260422000000_daily_schedules.sql` — daily_schedule med `hall_ids_json`
- `apps/backend/migrations/20260424000000_hall_groups.sql` — hall-grupper (BIN-665)
- `apps/backend/migrations/20260416000001_multi_hall_linked_draws.sql` — parallell draw_sessions-schema (BIN-515)
- `apps/backend/migrations/20260418250200_hall_cash_balance.sql` — hall.cash_balance
- `apps/backend/migrations/20260501000000_app_game1_ticket_assignments.sql` — grid per brett

Legacy-referanse (i `.claude/worktrees/slot-C/legacy/unity-backend/`):
- `Game/AdminEvents/AdminController/AdminController.js:253-522` — transferHall-flyt
- `Game/AdminEvents/Sockets/admnEvents.js:95-120` — transferHall socket-events
- `App/Models/dailySchedule.js` — Mongo-schema (masterHall, halls, groupHalls, otherData.transferHall)
- `App/Models/game.js` — per-game (masterHall, halls, isMasterGame, isSubGame)
- `App/Models/parentGame.js` — parent-game (masterHall, halls, isParent)
- `App/Controllers/GameController.js:2041-2120` — storeGamesData for game_1 (masterObj-binding)
