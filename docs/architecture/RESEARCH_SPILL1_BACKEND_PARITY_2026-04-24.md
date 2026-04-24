# Research: Spill 1 Backend-paritet — 2026-04-24

**Forfatter:** Agent R1 (research-only)
**Scope:** sammenligne legacy `unity-backend` (commit `5fda0f78`) mot ny `apps/backend/src` for Spill 1 runde-kjøring. Målet: finne hva som skal til for at Spill 1 kan kjøres 100 % som i legacy.
**Ikke scope:** kodeskriving, PR-er, design av fiks. Kun observasjoner + gap-liste.

Legacy-kilde brukt: `/Users/tobiashaugen/projects/Spillorama-system/.claude/worktrees/slot-1/legacy/unity-backend/` (samme som `5fda0f78:legacy/unity-backend`).
Ny-kilde: `apps/backend/src` + `apps/backend/migrations` på branch `docs/research-spill1-backend`.

---

## TL;DR

Nytt backend er arkitektonisk rensket og ganske langt framme på Spill 1-basisspillet, men en rekke runde-features fra legacy er enten helt uportert, eller delvis bygget som plumbing uten payout-wiring. **P0 = 6 gaps, P1 = 11 gaps, P2 = 9 gaps.** Ingen av P0-ene er "nær ferdig" — alle krever reell implementasjon.

Topp 5 kritiske (P0) gap:
1. **Mystery Game** — engine, klient og audit 100 % uportert (`GameProcess.js:1978-2400` har hele legacy-logikken).
2. **Legacy socket-event-paritet** — 25 legacy-events på `/Game1`-namespace, under 10 finnes tilsvarende i ny stack; spiller-klient kan ikke reprodusere legacy-sekvens.
3. **Manuell Bingo-check / PAUSE+Reward-flyt (bingovert)** — `adminExtraGameNoti`, `PAUSE Game and check for Bingo`-UI, "Enter Ticket Number → GO → pattern-validate" finnes ikke — master-UI i ny stack kan kun start/pause/stop, ikke sjekke innleverte fysiske bonger eller utbetale dem mid-round.
4. **Lucky Number Bonus-utbetaling på Fullt Hus** — legacy `GameProcess.js:420-429` kjører `luckyNumberBonusWinners`-grenen når `lastBall == winner.luckyNumber` og `wonPattern == "Full House"`; i ny `Game1PayoutService` + `Game1PatternEvaluator` finnes ingen slik bonus-grening.
5. **Jackpott-akkumulering med multi-threshold (50→55→56→57)** — legacy har kun ett `jackpotDraw`-tall per game, men papir-planen (og `LEGACY_MINIGAMES_AUDIT_2026-04-24.md §3.1`) sier dette skal eskalere. Ny kode har kun fixed-per-color jackpot, ingen dag-akkumulering og ingen draw-threshold-eskalering.

Estimert total port-tid (P0+P1): **~28-45 dev-dager** (matcher LEGACY_MINIGAMES_AUDIT-estimat på ~28-42 dager + Mystery + Lucky-Number-bonus + socket-event-paritet).

---

## 1. Runde-livssyklus (fase for fase)

### 1.1 Schedule-aktivering

**Legacy**
- En `Game`-doc (`App/Models/game.js`) opprettes per daglig runde, klonet fra `savedGame` via `spiloDev/...` eller via `schedule` CRUD. Feltet `status ∈ {active, running, finish}` (game.js:57-59).
- Transisjon gjøres av cron `game1StatusCron` i `Game/Common/Controllers/GameController`:
  - "active" → "running" skjer ved `StartGame`-socket (`GameProcess.StartGame`, GameProcess.js:25-117) som setter `status='running'`, `timerStart=true`, `otherData.gameSecondaryStatus='running'` + skriver hele game-state til Redis (`saveGameDataToRedisHmset`).
  - "running" → "finish" skjer i `gameFinished` (GameProcess.js:988-1158) etter Fullt Hus eller siste pattern vunnet.
- Ingen separat "purchase_open" / "ready_to_start"-fase. Masteren trykker `StartGame` direkte når bingoverten er klar.
- `disableTicketPurchase`-flagg i `game.js:240` brukes til å stenge kjøp (settes av cron når `notificationStartTime` er nådd).

**Ny**
- State-maskin: `scheduled → purchase_open → ready_to_start → running → paused → completed | cancelled` i `app_game1_scheduled_games.status` (migrations/20260428000000_game1_scheduled_games.sql:85-96).
- Transisjoner drives av `Game1ScheduleTickService` (apps/backend/src/game/Game1ScheduleTickService.ts):
  - `spawnUpcomingGame1Games(nowMs)` — forward-spawn 24t frem fra daily_schedule × schedule-mal × subGames (L321-686).
  - `openPurchaseForImminentGames(nowMs)` — flipper `scheduled → purchase_open` når `start - notification_start_seconds ≤ now` (L692-705).
  - `transitionReadyToStartGames(nowMs)` — flipper `purchase_open → ready_to_start` når alle non-excluded haller har `is_ready=true` i `app_game1_hall_ready_status` (L742-834).
  - `detectMasterTimeout()` — audit-logger hvis master ikke trykker start innen 15 min (L856-946).
- `Game1MasterControlService.startGame()` flipper `ready_to_start → running`, setter `actual_start_time`, skriver audit-rad, og delegerer POST-commit til `Game1DrawEngineService.startGame()` som bygger draw-bag + genererer ticket-assignments.

**Delta**
- **Større forskjell:** ny stack innfører 2 ekstra mellom-statuser (`purchase_open`, `ready_to_start`) og bingovert-ready-flow som legacy ikke har.
- **Redis borte:** legacy leser/skriver game-state til Redis via `saveGameDataToRedisHmset`/`getGameDataFromRedisHmset`. Ny stack bruker kun Postgres (DB-autoritet). Recovery er dermed enklere i ny stack.
- **Manual vs Auto:** legacy skiller via `gameMode` (GameController.js:34-36). Ny stack har samme felt (`game_mode ∈ {Auto, Manual}` i `app_game1_scheduled_games.game_mode`) — Auto kjører auto-draw-tick, Manual krever bingovert å trykke start og trekk.
- **P1 gap:** `actual_start_time`-semantikk. Legacy har `graceDate` + `notificationStartTime` + cron; ny stack har `scheduled_start_time - notification_start_seconds`. Ser like ut i praksis men logger har ulikt format.

---

### 1.2 Ticket-purchase-phase

**Legacy (GameController.js:272-1040, ~770 linjer bare for purchase)**

Socket-event: `PurchaseGame1Tickets`.

Mottakelig input:
```js
{ playerId, gameId, purchaseType: 'points'|'realMoney'|'voucher',
  purchasedTickets: JSON.stringify({list:[{ticketName, ticketQty}]}),
  luckyNumber, voucherCode?, isAgentTicket, agentId, playerTicketType }
```

Flyt:
1. Fetch player + game + hall (Promise.all, L284-296).
2. Blokk-sjekk: `isPlayerBlockedFromGame` (blockRules) (L333-345).
3. Test-game-sjekk: `otherData.isTestGame` avviser (L314-321).
4. Unique-ID expiry-sjekk (L437-448).
5. Hall-match-sjekk: player.hall må være i game.halls (L452-475).
6. Kompleks ticket-name-mapping:
   - `Traffic Light` har 1 purchaseType men genererer 3 tickets (Red/Yellow/Green) (L519-552).
   - `Elvis` velges random via `randomWithProbability` fra `selectedElvisinAdmin` (L492-511); hver Elvis 1-5 gir 2 tickets per kjøp (L591-617).
   - `Small *` → 1 ticket per qty (L622-623). `Large *` → 3 tickets per qty (L624-628).
7. Max 30 bonger per spiller per spill (L666-695) — for Elvis/Traffic Light deles med hhv 2/3.
8. Voucher-deduksjon hvis voucherCode (L697-702).
9. `checkPlayerSpending` — Spillvett-limit (L730-738).
10. Wallet-deduksjon via `FindOneUpdate`: `points` / `walletAmount` + `monthlyWalletAmountLimit` (L742-793).
11. `assignTickets()` — plukker `staticTickets` fra preallokert pool (L799). Bruker `uniqueIdentifier` for idempotens.
12. `bulkWriteTicketData` — inserter `ticket`-dokument per bong med alle felter (L843-902).
13. Oppdater game-state: `ticketSold += qty`, `earnedFromTickets += total`, `finalGameProfitAmount += total`, `players.$.totalPurchasedTickets += qty`, `players.$.purchaseTicketTypes.*.totalPurchasedTickets` per ticket-farge, og `groupHalls.$.halls.$.ticketData.*` (L936-995).
14. Random `luckyNumber` (1-75) hvis ikke spesifisert (L931-935).
15. Broadcast `getTicketDataRefresh` til admin-hall-namespace (L879-882).

Ticket-farger som brukes (hardkodet i logikk):
- Small Yellow / Small White / Small Purple / Small Red / Small Green / Small Orange / Small Blue (L620-623)
- Large Yellow / Large White / Large Purple (L624-628)
- Elvis 1-5 (`Small Elvis1`..`Small Elvis5`) (L497-512 + L588-617)
- Traffic Light (expansion → Small Red + Small Yellow + Small Green) (L519-552)

**Ny**

Socket + HTTP: `POST /api/game1/purchase` (routes/game1Purchase.ts) + ingen socket-event for purchase; klient kaller REST.

Input:
```ts
{ scheduledGameId, buyerUserId, hallId,
  ticketSpec: Array<{color, size: 'small'|'large', count, priceCentsEach}>,
  paymentMethod: 'digital_wallet'|'cash_agent'|'card_agent',
  idempotencyKey, agentUserId? }
```

Flyt (Game1TicketPurchaseService.ts, ~1158 linjer):
1. AUTH + permission-check i router (L86-90, `GAME1_PURCHASE_WRITE`).
2. `assertPurchaseOpenForHall` via `Game1HallReadyService` (lukker kjøp per hall når bingovert trykker klar).
3. Valider ticket_spec mot `scheduled_games.ticket_config_json` (farger + priser må matche).
4. `walletAdapter.debit(buyerUserId, total, idempotencyKey)` for digital_wallet (PR-W5 wallet-split: trekker winnings først, så deposit).
5. `complianceLossPort.logBuyIn(...)` for kun deposit-delen (PR-W5) — teller mot Spillvett-tapsgrense.
6. `INSERT INTO app_game1_ticket_purchases` med `UNIQUE(idempotency_key)`-retry-safety.
7. `potSalesHook.accumulateFromSale(...)` fire-and-forget for Innsatsen/Jackpott-akkumulering (PR-T3).
8. Ingen generering av ticket-grid ennå — skjer ved `startGame()` (se §1.3).
9. AuditLog `game1_purchase.create`.
10. Refund-flyt: `refundPurchase(purchaseId, reason)` — idempotent, wallet-credit, audit.

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Max bonger per spiller | 30, enforced (L666-695) | `maxTicketsPerPlayer` — sjekket i migration 20260413000002, men gjennomført? | P1 — må verifisere enforcement i `Game1TicketPurchaseService.purchase()` |
| Ticket-farger | 11 distinkte (Small 7 + Large 3 + Elvis 5 + Traffic Light expansion) | Free-form `color` TEXT + `size ∈ small\|large` (migration 20260501000000:54-58). Farger validert mot `ticket_config_json` | P1 — validerings-logikk i service må verifiseres mot alle 11 |
| Traffic Light expansion (1 kjøp → 3 bonger) | Hardkodet i purchase (L519-552) | Må implementeres via `ticket_config_json.traffic_light_expansion` eller egen flagg — ikke sett eksplisitt støtte | P0 — ingen legacy-paritet her (Spill 1 "Trafikklys" er i papir-plan) |
| Elvis random probability-distribusjon | `randomWithProbability(qty, selectedElvisinAdmin)` (L505) | "Elvis-random" ikke implementert; admin-config viser 5 separate Elvis-entries i `ticket_config_json` | P1 — hvis Elvis Spill 1-variant skal virke må random-distribusjon i purchase-laget implementeres |
| Voucher | Anvendt direkte på totalpris (L697-702) | Delvis portert admin-side; `Game1PurchaseService` har ikke voucher-deduksjon | P1 — bekreftet med LEGACY_MINIGAMES_AUDIT §3.4 |
| Lucky Number picking | Random 1-75 i purchase (L931-935) | Egen socket `lucky:set` på `/`-namespace (roomEvents.ts:350), ikke purchase-koblet | P1 — flyten er annen; ikke 1:1 |
| Unique-ID-player | `player.userType == "Unique"` + expiry-sjekk | Ikke portert til purchase-servicen | P1 — Spillvett-flyten er ikke koblet til unique-card expiry |
| Physical vs Online skillet | `userType, userTicketType, playerTicketType` på hver ticket | `payment_method ∈ {digital_wallet, cash_agent, card_agent}` + ingen `userType` på assignment | P0 — fysiske bonger er i `app_static_tickets` + `app_physical_tickets`; IKKE i `app_game1_ticket_assignments`. Delvis portert via PT1-PT5 (se LEGACY_1_TO_1_MAPPING §5.4) |
| Broadcast til hall admin namespace | `getTicketDataRefresh` (L879-882) | `AdminGame1Broadcaster` publiserer ingen ticket-count-events per purchase — kun status + draw + phase-won (sockets/adminGame1Namespace.ts) | P1 — bingovert-UI i ny stack får ikke live-oppdatering på ticket-salg |
| Grid-generation-timing | Ved purchase (via `assignTickets` + `staticTickets`-pool) | Ved game-start (`Game1DrawEngineService.startGame()` → `generateGridForTicket()`) — se migration 20260501000000:6-10 kommentar | Arkitektonisk endring — ny modell genererer grid ved start, ikke purchase. Begrunnelse: crash-recovery + færre DB-rows hvis kjøp kanselleres. |

---

### 1.3 Draw-phase

**Legacy (GameProcess.js:25-117 + `checkForWinners` L120-945)**

`StartGame(gameId)`:
1. `status='running'` + `timerStart=true`.
2. `ticketsWinningPrices` bygges fra `subGames[0].options[].winning` per ticket-name (L40-62). Er et objekt-map per farge som inneholder `[{pattern, winningValue}]`.
3. Skriv hele game-state til Redis HMSET (`saveGameDataToRedisHmset('game1', gameId, gameData)`, L110).
4. Start `gameInterval(gameId)`.

`gameInterval(gameId)` (se Helper/bingo.js via require i GameProcess.js:11-15) kalles hvert `seconds` sekund og trekker neste kule:
- Genererer random tall 1-75 som ikke er i `withdrawNumberArray` (legacy Game 1 bruker 1-75, verifisert via purchase-logikkens `getRandomArbitrary(1, 75)` på L932).
- Pusher til `withdrawNumberArray` + `withdrawNumberList`.
- Kaller `checkForWinners(gameId, withdrawBall, lastBallDrawnTime)`.
- Oppdaterer `count`, broadcaster `drawBall`-event til `/Game1`-namespace.

Auto-draw-interval: `seconds`-feltet på `game` (L52). Typisk 3-5 sekunder i legacy.

**Ny**

`Game1DrawEngineService.startGame(gameId, actorUserId)`:
1. Load scheduled_game, valider status='running'.
2. Kall `DrawBagStrategy.resolveDrawBagConfig` — bestemmer maxBallValue (default 75 for Spill 1) og shuffler via `buildDrawBag`.
3. `INSERT INTO app_game1_game_state(draw_bag_json, draws_completed=0, current_phase=1)`.
4. Generer `grid_numbers_json` per assignment via `generate5x5Grid(maxBallValue)` (Game1DrawEngineService.ts:313-374) — 25 celler, free-centre på index 12.
5. AuditLog `game1_engine.start`.

`Game1DrawEngineService.drawNext(gameId)` (L822-1155):
1. Transaksjon + `FOR UPDATE`-lås på game_state og scheduled_game.
2. Valider ikke paused / ikke finished / status='running'.
3. `ball = draw_bag[draws_completed]` — deterministisk plukk fra pre-shuffled bag.
4. `INSERT INTO app_game1_draws` med `draw_sequence`, `ball_value`, `current_phase_at_draw`.
5. `markBallOnAssignments()` — oppdaterer `markings_json` per assignment der grid inneholder ballen.
6. `evaluateAndPayoutPhase(current_phase, nextSequence, ...)`:
   - Evaluer aktiv fase (1-5) via `Game1PatternEvaluator.evaluatePhase(grid, markings, phase)` — 25-bit bitmask-matching (Game1PatternEvaluator.ts).
   - Hvis vinnere: call `Game1PayoutService.payoutPhase(...)` inne i samme transaksjon.
   - Hvis fase 5 vunnet → `isFinished=true`, UPDATE `scheduled_game.status='completed'`.
   - Ellers: `current_phase++`, fortsetter.
7. UPDATE `game_state.draws_completed`, `last_drawn_ball`, `last_drawn_at`, `current_phase`, `engine_ended_at` (hvis finished).
8. Hvis `maxDraws` nådd (default 52 — se `DEFAULT_GAME1_MAX_DRAWS = 52` i Game1DrawEngineService.ts:130) → game over.
9. Oddsen-resolve hvis terskel-draw (default #57) og aktiv `app_game1_oddsen_state` finnes (Game1DrawEngineService.ts:1010-1028).
10. POST-commit broadcasts: `adminBroadcaster.onDrawProgressed`, `playerBroadcaster.onDrawNew`, mini-game-trigger, physical-ticket-broadcast.

Auto-draw: `Game1AutoDrawTickService` — separat service som tikker og kaller `drawNext()`.

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Draw-bag generering | Random 1-75 ved hver draw (legacy trekker uten pre-shuffle) | Pre-shuffled ved `startGame`, deterministisk | Ny er bedre — regulatorisk tillatt, audit-spor |
| Ball-range | 1-75 (hardcoded i legacy purchase) | `maxBallValue` konfigurerbart (default 75 for Spill 1, 90 for varianter) | Legacy-paritet OK |
| Draw-interval | `seconds` på game (default ~3-5s) | `next_auto_draw_at` i game_state, via AutoDrawTickService | Legacy-paritet OK |
| Max draws | Ingen hard cap i legacy (fortsetter til Fullt Hus vunnet eller alle patterns fullført, se `checkForGameFinished` L948-986) | `DEFAULT_GAME1_MAX_DRAWS = 52` — hard cap | **P0 delta** — legacy har ingen hard cap. Ny setter 52, men *legacy trekker til Fullt Hus* (se `checkForGameFinished.ts:948-986`). For Oddsen (trekker til 58 noen ganger) må max være dynamisk |
| Ekstra-draws når ingen vinner | `checkForGameFinished` returnerer false hvis `lineTypesToCheck` har unfinished patterns; fortsetter trekke | Ingen eksplisitt "ekstra draw"-logikk; maxDraws=52 er bare hard-cap | P1 — bør verifisere at ny engine trekker til fase 5 naturlig |
| Persistens | Redis HMSET + Mongo game-doc | Postgres `app_game1_draws` + `app_game1_game_state` | Ny er bedre — single source of truth |
| Crash-recovery | `BingoEngineRecovery` i ny kode, legacy hadde Redis-state-reload | Begge støtter | Paritet OK |
| Traffic Light + Elvis spesial-logikk i trekking | `checkForWinners` håndterer `trafficLightExtraOptions` per farge (L162-174) | `Game1DrawEnginePotEvaluator.computeOrdinaryWinCentsByHallPerColor` håndterer per-farge (Game1DrawEngineService.ts imports) | Delvis paritet — må verifisere 1:1 semantikk |

---

### 1.4 Claim-phase (pattern-matching + winner-detection)

**Legacy (GameProcess.js:120-945, `checkForWinners`)**

Patterns (hardkodet i pattern-eval):
- **Spill 1 standard (5-fase):** Row 1 / Row 2 / Row 3 / Row 4 / Full House.
- **Super Nils:** Kolonne-basert — B/I/N/G/O hver med eget pattern (L164-170).
- **Oddsen 56/57/58:** `Full House Within 56 Balls` osv. (L167-171).
- **Tv Extra:** Egne patterns `Frame`, `Picture`, `Full House` (L230-231, L820-830).

Pattern-matching: `checkWinningPattern(currentPattern, ballTickets, roomId)` + `checkTVExtraWinningPattern(lineTypesToCheck, ballTickets, roomId)` (L230-234). Disse kjører DB-query mot `ticketBallMappings` kolleksjon (`getBallMappingsByData`) + matcher grid.

Multi-winner-håndtering:
- `getWinnersOnWithdrawBall({patternWinners, unclaimedWinners, currentPattern, gameType, withdrawBall, isForRunningGameAddedTickets})` — filter ut duplikat pattern-winners for samme draw (L240-247).
- Hvis samme lineType allerede er vunnet (via `existingWinners = new Set(gameData.winners.map(w => w.lineType))`), winnner skipped (L461-466).
- Ved `tempPatternWinners.length > 0` splittes på userType via `splitByUserType(winners, predicate, physicalWinners, onlineWinners, withdrawNumberArray)` (L473).
- Online-winners går i `otherData.pendingWinners.onlineWinners`, physical går i `otherData.unclaimedWinners` (L487-499).

Manual bingo-check for physical:
- Fysisk bong vinner må manuelt meldes inn av bingovert via `agentBingoController` (`App/Routes/agent.js` → `agentBingo.js`).
- Legacy-admin-panel har `ClaimWinnerPanel` + `adminExtraGameNoti`-broadcast for dette (se LEGACY_MINIGAMES_AUDIT §5.3, §6.1).

Lucky Number Bonus-pattern-tillegg:
- Etter vinner-evaluering: hvis `lastBall == winner.luckyNumber` AND `wonPattern == "Full House"` → push `luckyNumberBonusWinners` med `wonAmount = round(room.luckyNumberPrize)` (GameProcess.js:420-429).

**Ny**

- `Game1PatternEvaluator.evaluatePhase(grid, markings, phase)` (apps/backend/src/game/Game1PatternEvaluator.ts, 243 linjer) — rent funksjonell, 25-bit-masker per fase.
- 5 faser: 1 Rad / 2 Rader / 3 Rader / 4 Rader / Fullt Hus.
- Ingen Super Nils / Tv Extra / Oddsen XX Balls / Frame / Picture.
- Multi-winner: alle assignments som matcher i samme fase får split-pot via `Game1PayoutService.payoutPhase` (split-rounding, floor-division, rest til hus).
- Ingen "unclaimedWinners"-semantikk — alle vinnere utbetales auto inne i samme transaksjon.
- Fysiske bonger håndteres av `Game1DrawEnginePhysicalTickets.evaluatePhysicalTicketsForPhase` — skaper pending-payout-rader (`app_physical_ticket_pending_payouts`) uten auto-payout (krever bingovert-manuell verifisering).

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Pattern-definisjoner | Hardcodet per gameName (Super Nils/Oddsen/Tv Extra/Jackpot/Ball X 10/Spillerness) | Generisk `PatternConfig` i `variantConfig.ts` med `winningType ∈ percent\|fixed\|multiplier-chain\|column-specific\|ball-value-multiplier` | Ny stack er mer generisk, men spesifikke patterns som `Frame`, `Picture`, `Full House Within 56 Balls`, `Super Nils B/I/N/G/O` er **ikke implementert** — **P1** |
| Lucky Number Bonus | Utbetales separat, ekstra payout (GameProcess.js:420-429) | Ikke implementert i `Game1PayoutService` — `LuckyNumberPicker.ts` eksisterer som klient men ingen engine-side | **P0** — Lucky Number Bonus er aktivt brukt i legacy |
| Multi-winner-split | Floor-split i `distributeMultiWinnings` (GameProcess.js:~2900) | `Game1PayoutService.payoutPhase` bruker floor-split + audit (split-rounding-audit) | Paritet OK |
| Unclaimed (physical)-gruppe | `otherData.unclaimedWinners` persisterer til bingovert claim (`agentBingoController`) | `app_physical_ticket_pending_payouts` + `PhysicalTicketPayoutService` | Paritet delvis — se §1.5 |
| Manual Bingo-check (agent) | `agentBingo.claim(ticketId, pattern)` + pattern-validate | Backend-service finnes (PT4 migrasjoner), men **admin-UI for å ENTER TICKET NUMBER → GO → pattern-validate** finnes ikke | **P0** — pilot-blocker per LEGACY_1_TO_1_MAPPING §3.2 |
| Bingo Announcement | `BingoAnnouncement`-socket-event (GameProcess.js:537-554) utløses når auto-pause trigges | Ikke portert som egen event | P2 |
| Multi-pattern-check per draw | Legacy evaluerer kun `lineTypesToCheck[0]` (én fase om gangen) | Ny evaluerer også kun én fase om gangen (current_phase) | Paritet OK |
| `Tv Extra`-variant (Frame/Picture/Full House) | Egen gameName-branch (L230-231) | Ikke implementert | P1 — kun hvis Tv Extra skal støttes. Papir-planen inkluderer "Extra" (Spor 1 #5) men som variant av 5-fase |

---

### 1.5 Payout-phase

**Legacy (GameProcess.js:260-433, `checkForWinners` winning-amount-block + L2800-3200 `processWinners`/`distributeMultiWinnings`)**

Premie-beregning per pattern:
- `getWinningAmount(winner, pattern)` (L268-296):
  - Standard: oppslag i `allWinningPatternsWithPrize[0][ticketColorName].find(pattern)` — fast beløp per (farge, pattern).
  - **Super Nils**: kolonne på ticket der vinner-celle ligger → `winningColumn = ["B","I","N","G","O"][colIdx]` → oppslag.
  - **Spillerness Spill / Spillerness Spill 2**: % av `earnedFromTickets`, med `minimumWinning`-gulv.
  - **Oddsen 56/57/58 Full House**: bruker threshold-pattern `Full House Within {N} Balls` hvis `withdrawBallCount <= N`, ellers vanlig Full House.
  - **Ball X 10 Full House**: `winningAmount = base + 10 * lastBall`.
  - **Jackpot Full House**: hvis `withdrawBallCount <= jackpotDraw` → `jackpotPrize[ticketColor]` (per-farge jackpot), ellers vanlig Full House.
  - **Wheel of Fortune / Treasure Chest / Mystery / Color Draft**: `winningAmount = 0` initially — bestemmes av mini-game.
  - **Innsatsen Full House**: hvis `withdrawBallCount <= jackpotDraw` → `winningAmount + innsatsenSales` capped 2000 (GameProcess.js:337-355).

Pot-splitting ved flere vinnere (GameProcess.js:~620-680 i kommentert kode, L2800+ aktiv):
- `processMultiWinnings(winnerArray)` grupperer per (playerId, lineType) og summerer.
- `distributeMultiWinnings` i `gamehelper/game1-process.js` gjør floor-split per `pLength` med `Math.round(exactMath.div(wonAmount, pLength))`.

Utbetaling:
- Physical: skaper transaction `createTransactionAgent` med `purchasedSlug='cash'` + oppdaterer `playerHallSpendingData` — bingovert betaler ut manuelt.
- Online: `createTransactionPlayer` med `purchasedSlug='realMoney'` + credit til `walletAmount` direkte.

**Ny (Game1PayoutService.ts, 390 linjer)**

`payoutPhase(client, input)`:
1. Floor-split: `prizePerWinnerCents = floor(totalPhasePrizeCents / winnerCount)`.
2. `houseRetainedCents = totalPhasePrizeCents - winnerCount × prizePerWinnerCents`.
3. Fire `splitRoundingAudit.onSplitRoundingHouseRetained(event)` (fire-and-forget) hvis `houseRetainedCents > 0`.
4. Per vinner:
   - `wallet.credit(walletId, prizePerWinnerCents, idempotencyKey=g1-payout-{winnerId}-{phase})` (PR-C2 — `to: "winnings"`).
   - `INSERT INTO app_game1_phase_winners(...)`.
   - Fire-and-forget loyalty-hook.
   - `jackpotAmountCentsPerWinner` hvis satt (kun Fullt Hus).
5. Atomisk innenfor draw-transaksjonen.

Pot-evaluering (`runAccumulatingPotEvaluation` i `Game1DrawEnginePotEvaluator.ts`):
- Delegerer til `Game1PotService.tryWin` for Jackpott + Innsatsen.
- Per-hall, per-color, per-phase.
- Se §2 for gap-detaljer på akkumulering.

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Premie-beregning `percent` | Kolonne-basert (Super Nils), ball-verdi (Ball X 10), Oddsen threshold, Innsatsen cap | `winningType ∈ percent\|fixed\|multiplier-chain\|column-specific\|ball-value-multiplier` | Grunnramme finnes, men **alle variant-implementasjoner må verifiseres / implementeres** — P1 |
| Jackpot per farge | `room.jackpotPrize[color]` hvis `withdrawBallCount <= jackpotDraw` | `Game1JackpotService` sentralisert, per-farge | Paritet OK |
| Jackpot daglig akkumulering +4000/dag max 30k | **Ikke i legacy-kode** (kun papir-plan) | **Ikke implementert** | **P0** — papir-plan og pilot-behov |
| Jackpot multi-threshold 50→55→56→57 | Ikke i legacy-kode (én `jackpotDraw` per game) | Ikke implementert | **P0** — papir-plan |
| Innsatsen-pot | `innsatsenSales` + 20%-andel + cap 2000 | `Game1PotService` + `pot/PotEvaluator` eksisterer. T1-T3 delvis i kode | **P1** — må verifisere at T2/T3 er wired opp; se LEGACY_MINIGAMES_AUDIT §3.2 |
| Wallet kontoside | Bruker `walletAmount` (deposit) | Wallet-split PR-W1…W5 — credit går til `winnings`, debit tar `winnings → deposit` | Ny er bedre regulatorisk |
| House-retained audit | `splitRoundingAuditPort` manglet | `SplitRoundingAuditPort` — fire-and-forget | Paritet OK |
| Physical-ticket payout | Auto-manuell-mix via `createTransactionAgent` | `PhysicalTicketPayoutService` + `app_physical_ticket_pending_payouts` — full manuell payout-flyt | Ny er bedre |
| Lucky Number Bonus-payout | Separat utbetaling via `distributeLuckyNumberBonus` (gamehelper) | Ikke implementert | **P0** — kritisk |

---

### 1.6 Mini-game trigger

**Legacy (GameProcess.js:1160-4056, `wheelOfFortuneData`/`Play`/`Finished` etc.)**

Trigger-mekanikk (GameProcess.js:260-356, i `checkForWinners`):
- Når en vinner får Fullt Hus, `gameFlags.isWoF` / `isTchest` / `isMys` / `isColorDraft` settes avhengig av `room.gameName`.
- Winner-objektet får `isWoF=true` etc.
- `winningAmount = 0` sett midlertidig — endelig beløp bestemmes av mini-game-resultatet.
- Socket-events `StartSpinWheel`, `OpenTreasureChest`, `SelectMysteryBall`, `selectColorDraftIndex` sendes til klient.

Rotasjons-regel (bugget "activeTypes[0]"):
- Legacy har ingen rotasjons-rule — hver `gameName` er hardcoded til én mini-game. "Rotasjons-bugg" ser ut til å være en PM-kommentar om at det kun var én miniGame per config, og ikke rotering på tvers.

Mini-game per runde (admin-konfig):
- Legacy: `subGame.gameName` = "Wheel of Fortune" / "Treasure Chest" / "Mystery" / "Color Draft" binder én mini-game til hele subgame. Hver ny runde må `subGame.gameName` være satt eksplisitt.
- `otherGame`-kolleksjon (Models/otherGame.js) lagrer prize-lists per slug.

Cross-round state (Oddsen):
- `Oddsen` er ikke en mini-game i legacy — det er en variant av pattern-matching (`Full House Within 56/57/58 Balls`). Se §1.4.
- Ny stack har gjort Oddsen til mini-game via `MiniGameOddsenEngine.ts` og cross-round state via `app_game1_oddsen_state` — dette er NY arkitektur, ikke legacy-paritet.

AutoTurn / timeout:
- Hvis spiller ikke klikker innen 10-20s, server auto-selekterer (`selectMysteryAuto`, `selectColorDraftAuto`).

**Ny (Game1MiniGameOrchestrator.ts + MiniGame*Engine.ts)**

`Game1MiniGameOrchestrator.maybeTriggerFor({winnerIds, drawSequenceAtWin, gameConfigJson})`:
- Fire-and-forget fra `drawNext` POST-commit (Game1DrawEngineService.ts:~1155).
- Hvis Fullt Hus vunnet OG admin-config spesifiserer mini-game → INSERT `app_game1_mini_game_results(scheduled_game_id, winner_user_id, mini_game_type='wheel'|'chest'|'colordraft'|'oddsen'|'mystery')`.
- Spiller-klient får socket-event `minigame:trigger` (gameEvents/miniGameEvents.ts:44 `minigame:play`).

Mini-game-engines:
- `MiniGameWheelEngine` — portert (random-index via `randomInt`, server-autoritativ).
- `MiniGameChestEngine` — portert.
- `MiniGameColordraftEngine` — portert.
- `MiniGameOddsenEngine` — portert (cross-round state).
- `MiniGameMysteryEngine` — **portert** (migration 20260724000000_game1_mini_game_mystery.sql utvider CHECK-constraint til å inkludere 'mystery'). **MEN** — LEGACY_MINIGAMES_AUDIT §1.3 sier 2026-04-24 at Mystery Game IKKE er portert. Det finnes en `MiniGameMysteryEngine.ts`-fil (se `apps/backend/src/game/minigames/MiniGameMysteryEngine.ts`), så migrasjonen + engine er til stede — men klient-UI + full end-to-end-integrasjon gjenstår.

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Mystery Game | Full backend + Unity-UI (MysteryGamePanel.cs, 450+ linjer) | Migration + `MiniGameMysteryEngine.ts` finnes, men klient-UI mangler (ifølge LEGACY_MINIGAMES_AUDIT §1.3) | **P0** — end-to-end ikke verifisert |
| Wheel of Fortune | Portert | ✅ portert (engine + klient-overlay) | Paritet OK |
| Treasure Chest | Portert | ✅ portert | Paritet OK |
| Color Draft | Portert | ✅ portert | Paritet OK |
| Oddsen | I legacy som pattern-variant | I ny som cross-round mini-game — **ikke direkte paritet, men funksjonelt ekvivalent** | P2 — arkitektonisk forskjell, må verifisere semantikk |
| Auto-turn-timeout | 10-20s auto-select (GameProcess.js:1311-1337) | Ikke sett eksplisitt auto-timeout-kode i orchestrator | P1 — må verifisere timer-hook i orchestrator |
| Admin-config per mini-game | `otherGame`-kolleksjon | `MiniGamesConfigService` + `app_mini_games_config` | Paritet OK |
| TV-display under mini-game | `PanelMiniGameWinners`, `AdminExtraGameNotifications` | Ikke portert (LEGACY_MINIGAMES_AUDIT §5.3) | P1 |
| Broadcast `toggleGameStatus` | Sendes når mini-game pauses | Ikke portert | P2 |

---

### 1.7 Runde-ende

**Legacy (GameProcess.js:988-1158, `gameFinished`)**

1. Fjern timer via `cleanTimeAndData(gameId_timer, 'game1', gameId)`.
2. Hent siste `game`-doc.
3. Broadcast `GameFinishEndGame` (L1022).
4. `processMultiWinnings(winnerArray)` + `distributeMultiWinnings(MultiWinnig, room)` — merge + pay ut.
5. Oppdater `status='finish'`, `winners=winnerArray`, `multipleWinners=MultiWinnig`.
6. `processTicketStats` — oppdater ticket-docs med winning amounts.
7. `processLuckyNumberBonus` — utbetal Lucky Number Bonus-winners.
8. `sendWinnersScreenToAdmin` — broadcast til TV.
9. `handleLosers` — oppdater ticket stats for tapende bonger.
10. `Innsatsen`-akkumulering: 20 % av `earnedFromTickets` legges til `dailySchedule.innsatsenSales` (L1100-1133).
11. `deleteManyBallMappingsByData({gameId})` — ryd opp ticketBallMappings.
12. Mini-games (WoF/Chest/Mystery/CD) har egne `refreshGameOnFinish`/`checkForMinigames` (L1083-1098).
13. Hvis ikke mini-game: `refreshGameWithoutCountDown` + `nextGameCountDownStart` 2s delay.

Game-checkpoints:
- Legacy persisterer ingen checkpoints — kun game-doc i Mongo + Redis HMSET. Crash recovery er via Redis reload.

**Ny**

1. `drawNext()` detekterer `isFinished = bingoWon || maxDrawsReached`.
2. UPDATE `scheduled_game.status='completed'`, `actual_end_time=now()`.
3. UPDATE `game_state.engine_ended_at=now()`.
4. Cleanup BingoEngine-rom (fire-and-forget) via `destroyRoomIfPresent` (Game1DrawEngineService.ts:548-559).
5. POST-commit: broadcast `game1:status-update` til admin-ns.
6. `Game1MasterControlService.stopGame(reason, actor)` — manuell stopp, setter `status='cancelled'`, kaller `ticketPurchaseService.refundAllForGame` (PR 4d.4).
7. Pot-evaluering (Innsatsen/Jackpott) kjøres ved Fullt Hus via `runAccumulatingPotEvaluation`.

**Delta**

| Område | Legacy | Ny | Gap |
|---|---|---|---|
| Broadcast `GameFinishEndGame` | Sendes til alle spillere | `game1:status-update` med status='completed' | P2 — semantikk lik, event-navn forskjellig |
| Innsatsen-akkumulering | Manuelt i `gameFinished` L1100-1133 | Via `PotSalesHookPort` per purchase + pot-evaluering ved Fullt Hus | Ny er bedre |
| Lucky Number Bonus-utbetaling | `processLuckyNumberBonus` | Ikke implementert | **P0** — se §1.5 |
| `nextGameCountDownStart` (count-down til neste spill) | `refreshGameWithoutCountDown` + `nextGameCountDownStart` 2s delay | Ikke implementert som auto-flow | P1 — Agent-portal må trigge manuelt |
| BallMappings-cleanup | `deleteManyBallMappingsByData` | Ikke relevant (ny arkitektur har ikke separate ballMappings) | N/A |
| TV "Winners"-skjerm | `sendWinnersScreenToAdmin` | Delvis portert (adminBroadcaster sender phase-won) | P1 — TV-UI-komponent mangler (LEGACY_MINIGAMES_AUDIT §5.3) |

---

## 2. Spesielle features

| Feature | Legacy | Ny | Gap |
|---|---|---|---|
| **Lucky Number Picker** (1-75 pre-game) | ✅ `SelectLuckyNumber`-socket (game1.js:55-63); random hvis ikke valgt (GameController.js:931-935) | 🟡 `lucky:set`-socket (roomEvents.ts:350), klient-UI `LuckyNumberPicker.ts`; MEN ikke koblet til Lucky Number Bonus-payout | **P0** for bonus-utbetaling (se §1.5). Picker-UI er 🟢 |
| **Elvis Replace** (in-place ticket swap midt i runde) | ✅ `ReplaceElvisTickets`-socket (game1.js:75-83) | ❌ Ikke implementert | **P1** — `replaceElvisTickets`-handler mangler. Assets finnes (ElvisAssetPaths.ts) |
| **Pick Any Number** (Spill 3) | Spill 3-only | N/A | Out of scope |
| **Number Completed** (popup når siste tall på rad trekkes) | ✅ Klient-side popup i `Game1GamePlayPanel.Interactions.cs` | ❌ Ikke implementert | **P2** — Spill 1-only, kosmetisk |
| **Speed Dial** (5/10/15/20/25/30 boards) | Spill 2/3-feature (Speed Dial quantity-valg) | ❌ Ikke implementert for noen spill | P2 — ikke Spill 1 |
| **Late-join** (SPECTATING + loader-barriere + event-buffer) | Legacy: `subscribeRoom` re-sender hele state (GameController.js:107-270) | `game1:join-scheduled` gir snapshot via `engine.getRoomSnapshot(roomCode)` | Paritet OK for status, men **event-buffering** (hente tapte draws siden last connect) er ikke wired i spiller-klient. P1 |
| **Replay / Game history** | `agent.gameHistory` + `adminSavedGames` | Delvis portert — `adminSavedGames.ts` finnes, men replay-player-UI mangler | P1 |
| **Spectator-mode** (kan se uten å kjøpe) | Legacy tillater (blokkeres av `Game1Room`-route) | Ny krever `engine.joinRoom` som legger til spiller; ingen dedikert spectator | P2 |
| **Chat** (backend + klient + persistens) | ✅ `SendGameChat`/`GameChatHistory`-socket (game1.js:95-111) + legacy-service `ChatServices` | ✅ portert — `chat:send`/`chat:history` (chatEvents.ts) + `app_chat_messages` persistens (migration 20260418130000) | Paritet OK |
| **Jackpot / pot-akkumulering** | Kun `innsatsenSales` felt + legacy `Jackpot`-game med `jackpotPrize` per color | `Game1JackpotService` (per-farge) + `Game1PotService` (akkumulerende Jackpott + Innsatsen) | 🟡 delvis — **Jackpott daglig akkumulering +4000/dag max 30k ikke implementert**. Se §1.5. **P0** |
| **Bot players** | Legacy har `isBotGame`-flagg + bot-spawning | Ikke implementert (bekreftet droppet i LEGACY_1_TO_1_MAPPING §8 #4) | N/A — ikke skal portes |
| **Voucher-innløsning** (spiller-side) | `ApplyVoucherCode`-socket + voucher-list i VoucherPanel | Admin-CRUD finnes, spiller-redemption mangler | P1 — LEGACY_MINIGAMES_AUDIT §3.4 |

---

## 3. DB-skjema-sjekk

Alle nye `app_game1_*`-tabeller er i migrations. Status:

| Tabell | Migrasjonsfil | Status | Evt. gap |
|---|---|---|---|
| `app_game1_scheduled_games` | 20260428000000_game1_scheduled_games.sql + 20260601000000_room_code.sql + 20260605000000_game_config.sql | ✅ | Inkluderer status, config_json, variants, room_code, game_config_json |
| `app_game1_hall_ready_status` | 20260428000100_game1_hall_ready_status.sql | ✅ | Per-hall ready-signalering |
| `app_game1_master_audit` | 20260428000200_game1_master_audit.sql | ✅ | start/pause/stop/exclude/include/timeout |
| `app_game1_ticket_purchases` | 20260430000000_app_game1_ticket_purchases.sql | ✅ | Idempotency-key, payment_method |
| `app_game1_ticket_assignments` | 20260501000000_app_game1_ticket_assignments.sql | ✅ | 5x5 grid med free centre |
| `app_game1_draws` | 20260501000100_app_game1_draws.sql | ✅ | UNIQUE per game+sequence |
| `app_game1_game_state` | 20260501000200_app_game1_game_state.sql | ✅ | Draw-bag + phase |
| `app_game1_phase_winners` | 20260501000300_app_game1_phase_winners.sql | ✅ | Inkluderer jackpot_amount_cents |
| `app_game1_mini_game_results` | 20260606000000_app_game1_mini_game_results.sql | ✅ | Utvidet for 'mystery' (20260724) |
| `app_game1_oddsen_state` | 20260609000000_game1_oddsen_state.sql | ✅ | Cross-round state |
| `app_game1_accumulating_pots` + `app_game1_pot_events` | 20260611000000_game1_accumulating_pots.sql | ✅ | Pot-framework |
| `app_physical_tickets` | 20260418230000_physical_tickets.sql + extensions | ✅ | PT1-PT5 |
| `app_physical_ticket_pending_payouts` | 20260608000000_physical_ticket_pending_payouts.sql | ✅ | |
| `app_chat_messages` | 20260418130000_chat_messages.sql | ✅ | |
| `wallet_accounts` (deposit_balance + winnings_balance) | 20260606000000_wallet_split_deposit_winnings.sql | ✅ | Wallet-split PR-W1 |

**Ingen åpenbare kritiske DB-gaps.** Alle tabeller for Spill 1 runde-kjøring finnes.

**P1-observasjon:** `app_game1_ticket_assignments.ticket_size` er `CHECK IN (small, large)` — hvis Elvis-bonger skal lagres her (hver Elvis gir 2 bonger per kjøp), trengs enten utvidelse av CHECK eller separat handling. Se LEGACY_MINIGAMES_AUDIT §3.6.

**Legacy Mongo-model-mapping:**

| Legacy Mongo | Ny Postgres |
|---|---|
| `game.js` (417 felter) | `app_game1_scheduled_games` + `app_game1_game_state` + `app_game1_phase_winners` + `app_game1_mini_game_results` |
| `subGame1.js` | Gikk inn i `app_schedules.sub_games_json` og `scheduled_games.ticket_config_json` |
| `pattern.js` | `app_patterns` (20260423000000) + `variant_config.patterns` i `hall_game_schedules` |
| `ticket.js` | `app_game1_ticket_purchases` + `app_game1_ticket_assignments` (splitt) |
| `ticketBallMappings.js` | Ingen direkte ekvivalent — `markings_json` per assignment erstatter dette |
| `staticPhysicalTickets.js` | `app_physical_tickets` (PT1-PT5) |
| `staticTickets.js` | Legacy preallokert ticket-pool. Ny arkitektur genererer grid ved startGame i stedet; `app_static_tickets` finnes (20260417000002) + extensions. Må verifisere 1:1 mapping. P1 |
| `savedGame.js` | `app_saved_games` (20260425000200) |

---

## 4. Socket-events per game-runde

Sammenligning legacy (`/Game1`-namespace, `Game/Game1/Sockets/game1.js:3-257`) vs ny (`/`-namespace + `/admin-game1`-namespace).

| Legacy event | Payload | Ny ekvivalent | Status |
|---|---|---|---|
| `Game1Room` | `{playerId, language}` → running+upcoming | Ingen dedikert — via REST + `game1:join-scheduled` | ❌ Ikke 1:1 |
| `SubscribeRoom` | `{playerId, gameId, language}` | `game1:join-scheduled` (game1ScheduledEvents.ts:257) | 🟡 delvis — payload + ACK-shape er ulik |
| `PurchaseGame1Tickets` | `{playerId, gameId, purchasedTickets JSON, purchaseType}` | HTTP `POST /api/game1/purchase` | 🟡 annerledes — socket erstattet av REST |
| `CancelGame1Tickets` | Cancel all tickets for player | `ticket:cancel`-socket (gameEvents/ticketEvents.ts:163) | 🟡 delvis — scheduled-game-scoped variant mangler |
| `CancelTicket` | Cancel én spesifik ticket | `ticket:cancel` | 🟡 delvis |
| `UpcomingGames` | List kommende spill per spiller | Ingen — polling via REST | ❌ |
| `SelectLuckyNumber` | Sett luckyNumber | `lucky:set` (roomEvents.ts:350) | ✅ paritet |
| `ViewPurchasedTickets` | Se bonger | Ingen socket; via REST `/api/game1/purchase/game/:id` | 🟡 |
| `ReplaceElvisTickets` | Bytt Elvis-variant | Ingen | ❌ **P1** |
| `StartGame` | Master-start | `Game1MasterControlService.startGame` via admin-HTTP + `admin:room-ready`/`admin:start-game`? | 🟡 — faktisk: `admin:room-ready` (adminHallEvents.ts:183) + egen HTTP-endpoint i admin-routes |
| `SendGameChat` | Chat | `chat:send` (chatEvents.ts) | ✅ paritet |
| `GameChatHistory` | Chat history | `chat:history` | ✅ paritet |
| `LeftRoom` | Spiller forlater | Socket `disconnect` + `room:leave`? | 🟡 implicit via socket.io disconnect |
| `AdminHallDisplayLogin` | TV-login | Delvis — `admin-display:login` (adminDisplayEvents.ts:115) | 🟡 delvis |
| `gameFinished` | Manuell trigger | Ingen — auto via drawNext | 🟡 — ny stack auto-avslutter |
| `WheelOfFortuneData` | Fetch WoF prize-list | `minigame:play` (gameEvents/miniGameEvents.ts:44) | 🟡 generisk minigame-event |
| `PlayWheelOfFortune` | Spin | `minigame:play` | 🟡 |
| `WheelOfFortuneFinished` | Stop-spin ack | Ingen eksplisitt | ❌ P1 — trenger ack-flyt |
| `TreasureChestData` | Fetch chest-list | `minigame:play` | 🟡 |
| `SelectTreasureChest` | Velg chest | `minigame:play` med `selectedIndex` | 🟡 |
| `MysteryGameData` | Fetch mystery-list | Ingen | ❌ **P0** |
| `SelectMystery` | Up/Down-valg | Ingen | ❌ **P0** |
| `ColorDraftGameData` | Fetch colordraft | `minigame:play` | 🟡 |
| `SelectColorDraft` | Velg color | `minigame:play` med `selectedIndex` | 🟡 |
| `StopGameByPlayers` | Spiller trigger stop | Ingen | ❌ P2 |
| `TvscreenUrlForPlayers` | Hent TV-URL | Ingen | ❌ P1 |

**Server→klient broadcasts (legacy):**

| Event | Trigges | Ny ekvivalent | Status |
|---|---|---|---|
| `GameStart` | StartGame | `game1:status-update` | ✅ |
| `drawBall` | Per draw | `draw:new` + `game1:draw-progressed` | ✅ |
| `PatternChange` | Ved ny pattern aktiv | Ingen eksplisitt — i snapshot | 🟡 |
| `BingoAnnouncement` | Auto-pause ved winner | Ingen | P2 |
| `BingoWinningAdmin` | Winner-detaljer til admin | `game1:phase-won` | ✅ paritet |
| `StartSpinWheel` / `StopSpinWheel` | WoF-spin | Via `minigame:play` result | 🟡 |
| `OpenTreasureChest` | Chest-select | Via `minigame:play` result | 🟡 |
| `SelectMysteryBall` | Mystery-roll | Ingen | ❌ **P0** |
| `mysteryGameFinished` | Mystery-end | Ingen | ❌ **P0** |
| `GameFinishEndGame` | Game-over | `game1:status-update` status='completed' | 🟡 |
| `GameOnlinePlayerCount` | Online count | Ingen | ❌ P2 |
| `getTicketDataRefresh` (admin-ns) | Per purchase | Ingen direkte | ❌ P1 |
| `adminRefreshRoom` | Force refresh | Ingen | P2 |
| `adminExtraGameNoti` | Winner popup til admin | Ingen | ❌ **P0** — trenger for PAUSE+Bingo-check-UI |
| `winnerDataRefresh` (admin-ns) | Per winner | Delvis via `game1:phase-won` | 🟡 |
| `toggleGameStatus` | Pause mid-mini-game | Ingen | P2 |
| `refreshTicketTable` | Force admin refresh | Ingen | P2 |
| `refreshSchedule` | Schedule change | Ingen | P2 |

**Oppsummert:** ca. **25 legacy-events**, under **10 finnes 1:1 i ny stack**. Resten er enten implicit via HTTP, generisert via `minigame:play`-event, eller helt uportert.

**P0:** Mystery Game-events (`MysteryGameData`, `SelectMystery`, `SelectMysteryBall`, `mysteryGameFinished`) mangler helt.
**P0:** `adminExtraGameNoti` (admin-side winner popup) mangler — kritisk for bingovert-PAUSE+Bingo-check-flyt.

---

## 5. Cross-system

### 5.1 Wallet (deposit + winnings)

**Legacy**
- Enkelt `walletAmount`-felt på player + `monthlyWalletAmountLimit`.
- Direkte `$inc` operasjoner via `Sys.Game.Common.Services.PlayerServices.FindOneUpdate(...)` (GameController.js:742-793).
- Ved purchase: trekk fra `walletAmount` eller `points`.
- Ved payout: `createTransactionPlayer` med `purchasedSlug='realMoney'` credit til `walletAmount`.

**Ny**
- `wallet_accounts.deposit_balance` + `winnings_balance` (split etter PR-W1).
- Purchase (`Game1TicketPurchaseService`): `walletAdapter.debit(userId, amount, idempotencyKey)` — trekker winnings først, så deposit.
- `complianceLossPort.logBuyIn(fromDeposit)` — kun deposit teller mot Spillvett-tapsgrense (PR-W5).
- Payout (`Game1PayoutService`): `walletAdapter.credit(walletId, cents, idempotencyKey=g1-payout-{winnerId}-{phase})` → alltid til `winnings` (PR-C2).

**Delta**
- Ny er betydelig bedre arkitektonisk og regulatorisk.
- Paritet for pengeflyt oppnådd.

### 5.2 Spillvett (RG limits, self-exclusion)

**Legacy**
- `checkPlayerSpending` (gamehelper/all.js) sjekker hall-spending mot limit.
- `updatePlayerHallSpendingData` oppdaterer per-hall spending.
- `isPlayerBlockedFromGame` (gamehelper/player_common.js) sjekker blockRules (self-exclusion).

**Ny**
- `ComplianceLossPort.logBuyIn` i `Game1TicketPurchaseService.purchase()` (L393).
- `BingoEngine.assertWalletAllowedForGameplay(walletId)` — fail-closed Spillvett-sjekk.
- `PlatformService.assertUserEligibleForGameplay(user)` — sjekker self-exclusion, block-rules.
- `engine.getComplianceLossPort()` for wire-up.

**Delta**
- Paritet OK. Ny implementasjon er mer formell (egne adapters + ports).

### 5.3 Compliance ledger (hva logges per runde)

**Legacy**
- Transaksjoner via `createTransactionPlayer` / `createTransactionAgent` — per event.
- Winners + purchases lagres på `game`-doc + separate ticket-docs.
- `savedGame` lagres etter `gameFinished` for historikk.

**Ny**
- `AuditLogService` — skriver `audit_log` rader for alle game-events (purchase, refund, phase-won, master-start osv.).
- `ComplianceLedger` + `ComplianceLedgerOverskudd` + `ComplianceLedgerValidators` — regulatorisk ledger per pengespillforskriften.
- `PayoutAuditTrail` — dedikert audit for payouts.
- `PostgresResponsibleGamingStore` — per-spiller-loss-ledger.

**Delta**
- Ny er betydelig bedre. Paritet OK+.

### 5.4 Dashboard live updates

**Legacy**
- `AdminGame1Events` (AdminEvents-namespace) + `refreshSchedule`-broadcast + `onHallReady`.

**Ny**
- `AdminGame1Broadcaster` → `/admin-game1`-namespace → events `game1:status-update`, `game1:draw-progressed`, `game1:phase-won`, `game1:physical-ticket-won`.
- Admin-dashboard subscriber via `game1:subscribe { gameId }`.

**Delta**
- Ny er bedre (egen ns + explicit subscribe).
- P1 gap: `getTicketDataRefresh`-event ved purchase mangler, så admin-dashboard får ikke live ticket-sales-tall.

### 5.5 TV-skjerm-state-stream

**Legacy**
- `adminHallDisplayLogin`, `TvscreenUrlForPlayers`, `AdminHallDisplayLogin`, `PanelMiniGameWinners`, `ClaimWinnerPanel`.
- TV-app (Unity-client) abonnerer på egne events via `/Game1`-namespace.

**Ny**
- `admin-display:login` + `admin-display:subscribe` + `admin-display:state` (adminDisplayEvents.ts).
- `TvScreenService.ts` — sentral TV-state.
- **Delta:** Mangler `ClaimWinnerPanel`, `PanelMiniGameWinners`, `AdminExtraGameNotifications`, `ScreenSaverManager` (LEGACY_MINIGAMES_AUDIT §5.3, §6.1).

---

## 6. Prioritert gap-liste

Sortert etter pilot-kritikalitet (P0 = pilot-blocker), estimat fra LEGACY_MINIGAMES_AUDIT + egen analyse.

| # | Gap | Prioritet | Estimat (dev-dager) | Hva kreves |
|---|---|---|---:|---|
| 1 | Mystery Game end-to-end (engine finnes, klient-overlay + audit-wire mangler) | P0 | 4-6 | Klient-UI `MysteryOverlay.ts`, verifiser engine-integrasjon med orchestrator, test cross-round-scenarios |
| 2 | Manuell Bingo-check UI for bingovert (PAUSE Game → Enter Ticket ID → Pattern-validate → Reward/Cashout-status → Reward All) | P0 | 5-7 | Backend: legge til endpoint `POST /api/agent/checkBingo`; socket `adminExtraGameNoti`-event; frontend: Agent-portal claim-popup m/pattern-highlight 5x5; integrer med `PhysicalTicketPayoutService` |
| 3 | Lucky Number Bonus-payout (Fullt Hus på lucky-ball gir ekstra utbetaling) | P0 | 2-3 | Utvid `Game1PatternEvaluator` / `Game1PayoutService` med lucky-bonus-branch; audit-event; klient-notifikasjon |
| 4 | Jackpott daglig akkumulering +4000/dag max 30.000 | P0 | 2-3 | Admin-UI-config + daglig tick-service (utvidelse av `PotDailyAccumulationTickService`) |
| 5 | Jackpott multi-threshold (50→55→56→57) | P0 | 2-3 | Utvide `Game1JackpotService` med `drawThresholds?: number[]`; evaluator leser sekvensielt |
| 6 | Elvis Replace (spiller-siden bytter Elvis 1-5) | P1 | 2-3 | Ny socket `elvis:replace` eller HTTP; backend swap logic på `ticket_assignments`; klient-UI |
| 7 | Socket-event-paritet for ticket-count-broadcast (`getTicketDataRefresh` → admin-UI live-update) | P1 | 1-2 | Utvide `AdminGame1Broadcaster` med `onTicketsPurchased`; wire i `Game1TicketPurchaseService.purchase()` |
| 8 | TV "Winners"-skjerm + `PanelMiniGameWinners` + `AdminExtraGameNotifications` | P1 | 5-7 | Ny `/tv/:hallId/:hallToken`-klient-komponenter (LEGACY_MINIGAMES_AUDIT §5.3) |
| 9 | Traffic Light expansion (1 kjøp → 3 bonger med Rød/Gul/Grønn) | P1 | 2-3 | Purchase-service må detektere traffic-light-variant og splitte til 3 assignments |
| 10 | Super Nils-variant (kolonne-spesifikk Fullt Hus-premie) | P1 | 2-3 | Ny `winningType: "column-specific"`-branch i evaluator + admin-UI |
| 11 | Oddsen 56/57/58 variant (Full House Within N Balls pattern) | P1 | 2-3 | Pattern-catalog + evaluator-støtte for draw-threshold-patterns |
| 12 | Ball x 10-variant (Full House = base + 10 × lastBall) | P1 | 1-2 | `winningType: "ball-value-multiplier"` er definert, må verifisere engine-integrasjon |
| 13 | Spillernes Spill multi-plier chain (Rad N = Rad 1 × N) | P1 | 2-3 | `winningType: "multiplier-chain"` finnes, verifiser engine |
| 14 | Innsatsen-pot (20% av salg → pot, base 500, draw-threshold 2000 innen 56) | P1 | 2-3 | `Game1PotService` + `PotSalesHookPort` finnes; må verifisere wiring + admin-UI |
| 15 | Event-buffer for reconnecting spillere (fetch missed draws siden last connect) | P1 | 2-3 | Utvid `emitRoomUpdate` med draw-history i snapshot |
| 16 | Voucher spiller-side innløsning | P1 | 2-3 | Klient-UI + ny socket-event `voucher:apply` på game1-namespace |
| 17 | Max 30 bonger per spiller (verifisere enforcement i `Game1TicketPurchaseService`) | P1 | 0.5 | Ren verifikasjon + evt test |
| 18 | Replay / Game History UI | P1 | 3-4 | Frontend komponent som leser `app_saved_games` |
| 19 | Mystery Game auto-turn timeout (10-20s) | P2 | 1-2 | Server-side timer i orchestrator |
| 20 | `BingoAnnouncement`-socket-event | P2 | 1 | Port legacy auto-pause-trigger |
| 21 | Number Completed-popup (klient) | P2 | 1-2 | Klient-detektering via snapshot |
| 22 | Spectator-mode | P2 | 2-3 | Ny flagg `is_spectator` på player-join |
| 23 | Auto-count-down til neste spill (etter finished) | P2 | 2 | Match legacy 2s-delay i agent-portal |
| 24 | `toggleGameStatus`-broadcast | P2 | 1 | Pause mid-mini-game |
| 25 | `GameOnlinePlayerCount`-event | P2 | 1 | Fan-out player count |
| 26 | ScreenSaverManager (admin+TV) | P2 | 3-4 | LEGACY_MINIGAMES_AUDIT §5.3 |

**Totalt estimat:**
- P0: 15-22 dev-dager
- P1: 25-36 dev-dager
- P2: 10-16 dev-dager
- **Summa: 50-74 dev-dager**

(Over-estimat inkluderer TV-UI + Agent-portal-drift som delvis er dekt av andre initiativer — LEGACY_1_TO_1_MAPPING §9.)

---

## 7. Åpne spørsmål til Tobias

1. **Mystery Game-klient-status:** `MiniGameMysteryEngine.ts` finnes i backend, men LEGACY_MINIGAMES_AUDIT §1.3 sier "Mangler helt" per 2026-04-24. Er engine faktisk wired opp i orchestrator og testet ende-til-ende? Vil en spiller se overlay i klient etter Fullt Hus? Bør verifiseres i kode — finner `MiniGameMysteryEngine.ts` + `Game1MiniGameOrchestrator.ts` + `packages/game-client/src/games/game1/components/MysteryOverlay.ts`?

2. **Lucky Number Bonus:** Er bonusen en del av pilot (altså P0) eller kan den utsettes? Legacy har den aktiv, papir-planen nevner den — men ikke alle legacy-spill bruker den (kun hvis `room.luckyNumberPrize > 0`).

3. **Jackpott daglig akkumulering (+4000/dag, max 30k):** LEGACY_MINIGAMES_AUDIT §9 Åpne spørsmål #2 — er dette implementert i legacy via admin-manuell bumping, eller er det en kodet cron-jobb vi må finne? Legacy `Game/Game1/Controllers/GameProcess.js` grep viser ingen +4000/dag.

4. **Multi-threshold jackpot 50→55→56→57:** Samme som LEGACY_MINIGAMES_AUDIT #2 — implementert via admin oppretter flere Jackpot-patterns med ulik `jackpotDraw`? Eller reell kode-logikk? Må verifiseres mot prod live-schedule før porting.

5. **Traffic Light-variant i Spill 1:** Skal "Spill 1 Trafikklys" støttes i ny stack? Backend: `DEFAULT_TRAFFIC_LIGHT_CONFIG` nevnes i SPILL1_FULL_VARIANT_CATALOG §Spor 1. Purchase-laget i ny stack har ikke expansion-logic (1 kjøp → 3 bonger). P0 eller post-pilot?

6. **Legacy socket-events — skal vi porter dem 1:1?** Legacy har 25 events på `/Game1`-ns, ny har generiske events (`minigame:play` med discriminator). Er dette OK, eller skal klient-spesifikke events portes for Unity-klient-paritet? (Ikke relevant hvis Unity er avkoblet, som PM-handoff antyder.)

7. **`StaticTickets`-pool vs grid-ved-startGame:** Legacy har preallokerte ticket-doc pool (`staticTickets`-kolleksjon). Ny genererer grid ved `startGame()`. Har vi full paritet for statistikk (f.eks. "hvor mange av ticket-ID #X er vunnet"), eller mister vi historikk?

8. **Elvis Replace (P1):** Er dette en feature som faktisk brukes, eller legacy-død-kode? Bør verifiseres med live-data før vi porter.

9. **Max 30 bonger per spiller:** Legacy enforcerer hard (GameController.js:666-695), del av Spillvett. Er dette enforced i ny stack? Ikke funnet eksplisitt i `Game1TicketPurchaseService.purchase()`. Bør verifiseres.

10. **Legacy `gameName`-pattern (Super Nils / Oddsen 56/57/58 / Tv Extra / Ball X 10 / Jackpot / Spillerness / Innsatsen):** Papir-planen har 13 varianter. Hvor mange av disse må kjøres i pilot? SPILL1_FULL_VARIANT_CATALOG sier alt er post-pilot (Fase 2-5 PR-er), men noen haller kan ha krav om spesifikke varianter.

---

## Appendix A — Nøkkel-kildehenvisninger

Legacy (`.claude/worktrees/slot-1/legacy/unity-backend/`):
- `Game/Game1/Sockets/game1.js` (257 linjer) — alle socket-events
- `Game/Game1/Controllers/GameController.js` (4056 linjer) — room, purchase, chat, lucky, replace, cancel, tv-url
- `Game/Game1/Controllers/GameProcess.js` (6261 linjer) — draw, check winners, payout, mini-games (WoF/TChest/Mystery/ColorDraft), gameFinished
- `Game/Game1/Services/GameServices.js` (463 linjer) — DB CRUD wrappers
- `App/Models/game.js` (417 linjer) — Mongo schema
- `App/Models/savedGame.js` (182 linjer) — Game-historikk
- `App/Models/pattern.js` (79 linjer) — Pattern-definisjoner
- `App/Models/dailySchedule.js` — `innsatsenSales`-felt
- `gamehelper/game1.js`, `gamehelper/game1-process.js` — helpers

Ny (`apps/backend/src/`):
- `game/Game1ScheduleTickService.ts` (947 linjer) — scheduler-tick + state-maskin-transisjoner
- `game/Game1MasterControlService.ts` (1083 linjer) — master start/stop/pause
- `game/Game1TicketPurchaseService.ts` (1158 linjer) — purchase + refund
- `game/Game1DrawEngineService.ts` (2338 linjer) — draw + phase eval + payout orchestration
- `game/Game1PayoutService.ts` (390 linjer) — split-rounding + wallet credit
- `game/Game1PatternEvaluator.ts` (~243 linjer) — 25-bit bitmask eval
- `game/Game1JackpotService.ts` — per-color jackpot
- `game/Game1HallReadyService.ts` — bingovert-ready flow
- `game/BingoEngine.ts` (2984 linjer) — player-registry for scheduled Spill 1 + full engine for Spill 2/3
- `game/minigames/*` — 5 mini-game-engines
- `game/pot/Game1PotService.ts` — akkumulerende pot-framework
- `sockets/game1ScheduledEvents.ts` (313 linjer) — `game1:join-scheduled`
- `sockets/adminGame1Namespace.ts` — admin-broadcast
- `sockets/gameEvents/*` — generiske game-events
- `routes/game1Purchase.ts` — POST /api/game1/purchase

Dokumentasjon (`docs/architecture/`):
- `LEGACY_1_TO_1_MAPPING_2026-04-23.md` — full legacy-mapping wireframe-basert (369 linjer)
- `LEGACY_MINIGAMES_AUDIT_2026-04-24.md` — mini-games + bonus + TV-audit (473 linjer)
- `SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md` — post-pilot variant-katalog
- `SPILL1_ENGINE_ROLES_2026-04-23.md` — kanonisk forklaring av BingoEngine vs Game1DrawEngineService
- `GAME1_SERVICE_CONSOLIDATION_DESIGN_2026-04-21.md`
- `GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md`

---

## Appendix B — Verifiseringsnote

Alle påstander i dette dokumentet er forankret i kilder (kode/migrasjoner/dokumenter). Usikre påstander markert med "må verifiseres" eller P-prioritet som reflekterer usikkerhet. Ingen spekulasjon — hvis ikke funnet, markert som "ukjent".

**Kjente verifiseringer ikke utført i denne auditen:**
- Om `Game1TicketPurchaseService.purchase()` faktisk enforcer max 30 bonger per spiller (bør bekrefte i kode eller test).
- Om `MiniGameMysteryEngine` er wired til `Game1MiniGameOrchestrator` og testet ende-til-ende.
- Om `winningType: "percent|multiplier-chain|column-specific|ball-value-multiplier"` faktisk kjører korrekt i `Game1PayoutService.payoutPhase()` for alle varianter (kun grunnramme finnes, varianter ikke kjørt end-to-end).
- Om alle 11 ticket-farger aksepteres i `Game1TicketPurchaseService.purchase()` via `ticket_config_json`-validering.
- Om `Innsatsen`/`Jackpott`-pot-evaluering faktisk kjører ved Fullt Hus (krever kjøring av `runAccumulatingPotEvaluation` sammenligning).

Disse bør være første step i implementasjonsplanen — raske "verify-and-document"-PR-er før større porting startes.

---

**Laget av:** Agent R1 (research-only)
**Dato:** 2026-04-24
**Commit:** `docs/research-spill1-backend` branch
