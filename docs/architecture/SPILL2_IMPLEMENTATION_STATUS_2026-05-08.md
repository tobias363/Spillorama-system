# Spill 2 — komplett implementasjons-status og fundament

**Status:** Autoritativ. Skal være oppdatert ved hver sesjons-slutt eller etter store endringer.
**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead) + PM-AI (Claude Opus 4.7)
**Lese-først-i-sesjon:** **JA** — alle nye PM/agenter som skal jobbe med Spill 2 SKAL lese dette dokumentet før de begynner.

---

## 0. Hvorfor dette dokumentet eksisterer

Spill 2 (slug-familie `rocket` / aliaser `game_2`, `tallspill`) er den minst dokumenterte av live-spillene i Spillorama-pilot. Det er bygget som en arving-fra-Spill 1-engine med fundamentalt forskjellig arkitektonisk mønster — **ETT globalt rom uten master-rolle**, drevet av en perpetual loop som auto-spawn'er nye runder. Agenter som behandler Spill 2 som "Spill 1 i 21-ball-form" gjør konsekvent feilantakelser om hall-binding, master-handlinger og spilleplan-koblinger som **ikke finnes** for Spill 2.

Tobias' direktiv 2026-05-08 (LIVE_ROOM_ROBUSTNESS_MANDATE):

> "Live-rommene for Spill 1, Spill 2 og Spill 3 er kritisk infrastruktur. Nedetid eller flaky-oppførsel innenfor åpningstid er ikke akseptabelt."

R9 (Spill 2 24t-leak-test) er et utvidelses-gating-tiltak — pilot kan kjøre 4 haller uten R9, men utvidelse betinger at `app_spill2_config.opening_time_*` + perpetual-loop holder uten leak/drift over 24t.

**Grunnregel:** Hvis du ikke vet hvordan Spill 2 oppfører seg — sjekk i kode med fil:linje-referanser fra denne doc-en før du gjetter.

---

## 1. KRITISK: Forskjeller fra Spill 1 (les FØRST)

> **🚨 Den kanoniske cross-spill-sammenligningen ligger i [`SPILL_ARCHITECTURE_OVERVIEW.md`](./SPILL_ARCHITECTURE_OVERVIEW.md).** Tabellen under er Spill 2-perspektiv (Spill 1 vs Spill 2). For cross-spill-sammenligning på tvers av alle 3 spill (Spill 1 vs Spill 2 vs Spill 3) — bruk SPILL_ARCHITECTURE_OVERVIEW.

Spill 2 er IKKE en variant av Spill 1. Det er en uavhengig arkitektur som tilfeldigvis bruker samme draw-pipeline. Disse forskjellene må være tydelige før du rører noe:

| Aspekt | Spill 1 (`bingo`) | Spill 2 (`rocket`) |
|---|---|---|
| **Grid** | 5×5 med fri sentercelle | **3×3 full plate (9 ruter)** |
| **Ball-range** | 1-75 | **1-21** |
| **Maks ball-trekk** | 75 | **21** |
| **Rom-modell** | Per-hall lobby + GoH-master rom (`BINGO_<groupId>`) | **ETT GLOBALT ROM (`ROCKET`) for ALLE haller** |
| **Hall-isolasjon** | Master-hall styrer; deltager-haller deler runde via GoH | **Ingen** — hall_id ignoreres for room-routing (`canonicalRoomCode.ts:55-57`) |
| **Master-rolle** | Master-hall styrer start/pause/advance via `Game1MasterControlService` | **Ingen master** — auto-start når `minTicketsToStart` er nådd |
| **Spilleplan** | `app_game_plan` + `app_game_plan_run` + `GamePlanEngineBridge` | **Ingen plan** — perpetual loop, runder spawnes av `PerpetualRoundService` |
| **Trekning** | Master kall (`/api/admin/rooms/:code/draw-next` eller engine-tick) | **Auto-tick-driven** — `Game2AutoDrawTickService` polled cron |
| **Sub-games / katalog** | 13 katalog-varianter (bingo, oddsen, trafikklys, …) | **Kun rocket-variant** — ingen multi-variant-katalog |
| **Vinning** | Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus | **Kun Fullt Hus (9/9, full plate)** — ingen rad-faser |
| **Draws-til-vinst-sjekk** | Aktivert per fase (rad 1 etter ~5 trekk osv.) | **Først etter trekk 9** (`GAME2_MIN_DRAWS_FOR_CHECK`) |
| **Bonus** | Mini-games (Wheel/Chest/Mystery/Color) på Fullt Hus | **Jackpot-mapping per draw-count** + valgfri **Lucky Number Bonus** |
| **Pris** | 5/10/15 kr (hvit/gul/lilla bong-multiplikator) | **ÉN ticket-type** ("Standard"), default 10 kr (admin-konfigurerbar i øre) |
| **Bong-multiplikator** | × 1 / × 2 / × 3 (auto-mult per fase) | **Ingen multiplikator** — alle bonger like |
| **Åpningstid** | `app_game_plan.start_time` / `end_time` | **`Spill2Config.openingTimeStart` / `End`** (HH:MM, eller NULL = alltid åpent) |
| **Min spillere/bonger** | Driven av plan + master-handling | **`Spill2Config.minTicketsToStart`** auto-trigger |
| **Klient-rom** | `spill1:lobby:{hallId}` + `spill1:scheduled-{gameId}` | **Single room-key `ROCKET`** + Socket.IO-namespace `/game2` |
| **Compliance §11** | MAIN_GAME (15% til org) | **MAIN_GAME (15%)** — samme regulatorisk kategori |
| **Konfig-redeploy** | Plan + katalog endres via admin-CRUD | **Single `app_spill2_config`-rad** (singleton, partial unique idx) |
| **Engine-instans** | `BingoEngine` (samme instans som Spill 2/3) | **`Game2Engine extends BingoEngine`**; runtime-instans er `Game3Engine` (pga arve-kjede) |

**Konsekvenser når du gjør endringer:**

- Endrer du `GamePlanEngineBridge`, `GamePlanRunService` eller `app_game1_scheduled_games` — **det rører IKKE Spill 2**. Spill 2 har ingen plan-state.
- Endrer du `canonicalRoomCode` for slug-til-room-mapping — verifiser at `rocket` fortsatt returnerer `ROCKET` global.
- Endrer du `Spill2ConfigService` — alt som leser singleton (engine, perpetual-loop, health-endpoint) påvirkes globalt.
- Endrer du `Game2AutoDrawTickService` — det er ENESTE driver av draws for ROCKET-rom. Hvis ticken stopper → ingen baller trekkes.

---

## 2. Arkitektur — hvor alt henger sammen

### 2.1 Tre-lags-modell

```
┌────────────────────────────────────────────────────────────┐
│  KLIENT-LAG                                                │
│  ┌─────────────────────────┐  ┌──────────────────────┐   │
│  │ Player-shell            │  │ Admin (Spill2Config) │   │
│  │ /web/?webClient=game_2  │  │ :5174/admin/#/games/ │   │
│  │ → Game2Controller       │  │   spill2-config      │   │
│  └─────────────────────────┘  └──────────────────────┘   │
│           │                              │                 │
└───────────┼──────────────────────────────┼─────────────────┘
            │                              │
            ▼                              ▼
┌────────────────────────────────────────────────────────────┐
│  BACKEND-LAG (Node.js + Express + Socket.IO på port 4000)  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Klient-flyt (perpetual):                             │  │
│  │  socket.connect(`/game2`)                              │  │
│  │  → room:create / room:join (hallId, slug='rocket')    │  │
│  │  → canonicalRoomCode → "ROCKET" (global)              │  │
│  │  → room:join-handler kaller                           │  │
│  │      perpetualRoundService.spawnFirstRoundIfNeeded()  │  │
│  │      → engine.startGame() hvis ingen aktiv runde      │  │
│  │  → Game2AutoDrawTickService cron trekker baller       │  │
│  │      (game23DrawBroadcaster fanout `draw:new`)        │  │
│  │  → Game2Engine.onDrawCompleted (etter draw 9):        │  │
│  │      findG2Winners (9/9 full plate)                   │  │
│  │      → payG2JackpotShare + payG2LuckyBonus             │  │
│  │      → game.status = ENDED                             │  │
│  │  → bingoAdapter.onGameEnded                           │  │
│  │      → perpetualRoundService.handleGameEnded          │  │
│  │      → setTimeout(roundPauseMs) → startNextRound       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Admin-konfig-flyt:                                   │  │
│  │  PUT /api/admin/spill2/config (ADMIN, JWT)            │  │
│  │  → Spill2ConfigService.update (validate + audit)      │  │
│  │  → invalidateCache (5s TTL)                            │  │
│  │  → engine leser fersk config ved neste runde-spawn    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────┐
│  STATE-LAG                                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────┐│
│  │  Postgres 16         │  │  Redis 7                      ││
│  │  app_spill2_config   │  │  Engine room state cache      ││
│  │  (singleton)         │  │  Socket.IO adapter (cross-    ││
│  │  app_compliance_*    │  │   instance broadcast)         ││
│  │  app_wallet_*        │  │  Idempotency dedup            ││
│  └──────────────────────┘  └──────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### 2.2 ETT globalt rom — singleton-konstrukten

Spill 2 bruker **kun ÉN room-code globalt: `ROCKET`**. Dette håndheves på flere lag:

**Room-routing** — `apps/backend/src/util/canonicalRoomCode.ts:55-57`:
```typescript
if (slug === "rocket") {
  return { roomCode: "ROCKET", effectiveHallId: null, isHallShared: true };
}
```
Uavhengig av hvilken `hallId` eller `groupId` klient sender, mapper alle `rocket`/`ROCKET`/`Rocket`-aliaser (case-insensitivt + whitespace-trimmet) til samme room-code. `effectiveHallId: null` markerer rommet som hall-shared så `joinRoom`-handler godtar hvilken som helst hall (HALL_MISMATCH-relaksering — `apps/backend/src/util/canonicalRoomCode.test.ts:59-67`).

**Config-singleton** — `apps/backend/migrations/20261213000000_app_spill2_config.sql:71-73`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill2_config_singleton_active
  ON app_spill2_config((active))
  WHERE active = TRUE;
```
Partial unique index på `WHERE active = TRUE` håndhever at maksimalt ÉN konfig-rad har `active=TRUE` til enhver tid. Migration seeder ÉN default-rad (`id='spill2-default'`) som er aktiv fra første deploy.

**Slug-aliaser** — `apps/backend/src/game/Game2AutoDrawTickService.ts:70-74`:
```typescript
export const GAME2_SLUGS: ReadonlySet<string> = new Set([
  "rocket", "game_2", "tallspill",
]);
```
`tallspill` (markedsføring) og `game_2` (legacy) faller inn på samme runtime-flyt som `rocket`. Tester verifiserer at alle tre aliaser binder samme `Spill2Config` (`apps/backend/src/util/roomState.bindSpill2Config.test.ts:65-92`).

### 2.3 Perpetual loop og auto-spawn-trigger

Spill 2 har ingen master som starter rundene. To call-sites trigger ny runde:

**A. Første runde etter cold-start / tomt rom** — `room:join`-handler kaller `PerpetualRoundService.spawnFirstRoundIfNeeded(roomCode)`. Service-en sjekker:
- service enabled (`PERPETUAL_LOOP_ENABLED`)
- slug er i `PERPETUAL_SLUGS` (`rocket`, `game_2`, `tallspill`, eller Spill 3-aliaser)
- ingen pending auto-restart for rommet
- ingen aktiv runde (currentGame.status ∉ {WAITING, RUNNING})
- rommet har minst 1 spiller
- `canSpawnRound` returnerer true innen åpningstid (Spill 2 + Spill 3 — se §3.8)

**BIN-823-fix (2026-05-08):** Spill 2 har nå en aktiv åpningstid-guard wired i `canSpawnRound`. Logikken er flyttet ut til `PerpetualRoundOpeningWindowGuard` (`apps/backend/src/game/PerpetualRoundOpeningWindowGuard.ts`) og kalles via factory i `apps/backend/src/index.ts`. For Spill 2 (rocket/game_2/tallspill) henter guarden `Spill2Config` og kaller `isWithinOpeningHours(config)`. Hvis `openingTimeStart`/`End` er null returneres true (alltid åpent — default-konfig). Hvis begge er satt sammenlignes nåværende Oslo-HH:MM mot vinduet [start, end). Ved DB-feil returneres null (fail-open).

Implementasjon: `apps/backend/src/game/PerpetualRoundService.ts:922-1100`.

**B. Auto-restart etter game-end** — `bingoAdapter.onGameEnded`-hook kaller `PerpetualRoundService.handleGameEnded(input)`. Service-en sjekker:
- `endedReason` ∈ `NATURAL_END_REASONS` (`G2_WINNER`, `G2_NO_WINNER`, `G3_FULL_HOUSE`, `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY`)
- ikke `MANUAL_END` / `SYSTEM_ERROR`
- idempotens (samme gameId trigges ikke to ganger)

Hvis `Spill2Config.minTicketsToStart > 0` aktiveres **threshold-gate** istedet for direkte `setTimeout`:
- `startWaitingForTickets` polling hvert 2. sek (`THRESHOLD_POLL_INTERVAL_MS = 2_000`)
- Sikkerhets-timeout 30 min (`THRESHOLD_MAX_WAIT_MS = 30 * 60 * 1_000`) — etter det starter runde uansett
- Når `sum(armedPlayerTicketCounts) >= minTickets` → fortsett til countdown

Når threshold-gate ikke er aktiv (eller threshold møtt), schedules `setTimeout(roundPauseMs)` → `startNextRound` som kaller `engine.startGame` med carry-over av `armedPlayerIds` fra `roomState.armedLookup`.

Implementasjon: `apps/backend/src/game/PerpetualRoundService.ts:389-536` (handleGameEnded), `:540-700` (threshold-polling), `:700-900` (startNextRound).

**Cron-driver** — `apps/backend/src/jobs/game2AutoDrawTick.ts` kjøres hvert 1000ms:
```typescript
return await deps.service.tick();
```
`tick()` enumerer alle rom via `engine.listRoomSummaries()`, filtrerer på `GAME2_SLUGS`, sjekker per-rom throttle (`drawIntervalMs` eller `variantConfig.ballIntervalMs`), og kaller `engine.drawNextNumber({ roomCode, actorPlayerId: SYSTEM_ACTOR_ID })`. Etter vellykket draw fyrer `broadcaster.onDrawCompleted` for å emitte `draw:new` + engine-effekter til klienter.

Implementasjon: `apps/backend/src/game/Game2AutoDrawTickService.ts:327-700`.

### 2.4 Wallet-touch og compliance-ledger

Spill 2 binder ALL wallet- og compliance-skrivning til **`MAIN_GAME`**, ikke `DATABINGO`.

**Ledger-game-type** — `apps/backend/src/game/Game2Engine.ts:266`:
```typescript
const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
const channel: LedgerChannel = "INTERNET";
const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);
```

`ledgerGameTypeForSlug` returnerer `MAIN_GAME` for `rocket`/`monsterbingo`. Pre-fix (PR #769) returnerte `DATABINGO` — det var regulatorisk feil og er fixet i Wave 2.

**Single-prize cap** — `apps/backend/src/game/Game2Engine.ts:986-988`:
```typescript
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType: ledgerGameTypeForSlug(room.gameSlug),
  amount: requestedPayout,
});
```

Cap leses fra prize-policy med korrekt gameType `MAIN_GAME`. Pre-fix (audit §9.1, fixed Wave 2) hardkodet `"DATABINGO"` på 3 steder — Game2 jackpot, Game2 lucky, Game3 pattern. Det er fixet.

**§11-distribusjon:** Spill 2 bidrar med 15% til organisasjoner (samme som Spill 1/3). Spillkatalog-doc:
- `docs/architecture/SPILLKATALOG.md:32-37` (Spill 2 = MAIN_GAME, ikke DATABINGO)
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md:11-13`

**Outbox-pattern:** Compliance-ledger-events skrives via `ComplianceOutboxRepo` for atomisitet ved crash/restart (`apps/backend/src/index.ts:777-810`). Wallet-credit til vinner går via `walletAdapter.transfer` med `idempotencyKey: IdempotencyKeys.game2Jackpot({gameId, claimId})` så duplikat-payout er safe.

---

## 3. Spill-mekanikk

### 3.1 Grid 3×3 og 21 baller

- **Drawbag:** 21 baller numerisk 1-21 (`DEFAULT_GAME2_CONFIG.maxBallValue: 21`, `drawBagSize: 21`).
- **Ticket-grid:** 3×3 = 9 unike tall (ingen FREE-celle).
- **Generator:** Backend `Game2TicketPoolService` (slettet i Bølge B-cleanup 2026-05-05) genererte tidligere 32 forhåndsgenererte brett per spiller. Etter PR #921 (slettet ChooseTicketsScreen) er det ÉN popup-flyt for ticket-kjøp via `BuyPopup.ts`.
- **Klient-rendering:** `BongCard.ts` rendrer 3×3-grid med beige bakgrunn (mockup 2026-05-03). Backend genererer 9 tall uten FREE — fallback-logikk i `BongCard.loadTicket` rendrer FREE hvis backend en dag legger 0 i sentrum.

### 3.2 Vinning kun ved Fullt Hus (full plate)

- **Pattern:** `hasFull3x3` (`apps/backend/src/game/ticket.ts`) — alle 9 ruter må matche trukne baller.
- **Sjekk-trigger:** Engine sjekker IKKE før trekk 9 (`GAME2_MIN_DRAWS_FOR_CHECK = 9`). Pre-9-draws emitter kun `g2:jackpot:list-update` for å oppdatere klient-jackpot-display.
- **Auto-claim:** Når 9/9 er funnet auto-genereres `ClaimRecord{ autoGenerated: true, type: 'BINGO' }`. Spilleren trenger IKKE klikke en knapp.
- **Ende-tilstand:** `game.status = ENDED`, `endedReason = G2_WINNER` (med vinnere) eller `G2_NO_WINNER` (alle 21 trukket uten 9/9). Begge regnes som NATURAL_END av perpetual-loopen.

Implementasjon: `apps/backend/src/game/Game2Engine.ts:911-959` (findG2Winners), `:152-412` (onDrawCompleted hovedflyt).

### 3.3 Jackpot-mapping per draw-count (9, 10, 11, 12, 13, 14-21)

Premier varierer basert på **antall trekninger ved seier** — jo færre trekk, jo større jackpot. Speilet legacy-mekanikk fra `gamehelper/game2.js:1466-1625`.

**Tabell-shape** (`apps/backend/src/game/Spill2ConfigService.ts:62-68`):
```typescript
interface Spill2JackpotEntry {
  price: number;     // flat kr-beløp (isCash=true) eller prosent 0-100 (isCash=false)
  isCash: boolean;
}
type Spill2JackpotTable = Record<"9"|"10"|"11"|"12"|"13"|"1421", Spill2JackpotEntry>;
```

**Default-seed** (migration `20261213000000_app_spill2_config.sql:138-145`):
| Draw-count | Verdi | Type | Premie ved 5000 kr omsetning |
|---|---|---|---|
| `"9"` | 5000 | Cash | 5 000 kr fast |
| `"10"` | 2500 | Cash | 2 500 kr fast |
| `"11"` | 1000 | Cash | 1 000 kr fast |
| `"12"` | 100 | Pct | 5 000 kr (100% av omsetning) |
| `"13"` | 75 | Pct | 3 750 kr (75% av omsetning) |
| `"1421"` | 50 | Pct | 2 500 kr (50% av omsetning) |

**Beregning** (`apps/backend/src/game/Game2JackpotTable.ts:96-115`):
```typescript
const rawPrize = entry.isCash
  ? entry.price
  : (entry.price * Math.max(0, ticketCount) * Math.max(0, ticketPrice)) / 100;
const prize = Math.round(rawPrize);
```

**Multi-vinner-deling** (`Game2JackpotTable.ts:151`):
```typescript
const pricePerWinner = Math.round(totalPrice / winnerCount);
```
Floor-rounding via `Math.round` (legacy match). Single-prize-cap (`PrizePolicyManager.applySinglePrizeCap`) kjøres etterpå med `gameType: MAIN_GAME`.

**Bucket-key `"1421"`:** Matcher draw-count i [14..21]. Ved trekk 9-13 brukes exact key. `JACKPOT_BUCKET_14_21` er konstant streng `"1421"` — display-form til klient er `"14-21"` (`Game2JackpotTable.ts:50`).

**Per-draw broadcast:** Etter HVER draw (også pre-9) emit `g2:jackpot:list-update` med oppdatert payout-tabell — så klient ser hvor mye 9/9 ville vært verdt akkurat nå (`drawEmits.ts:23-28`). Legacy-paritet: `gamehelper/game2.js`-controller `game2JackpotUpdate`.

### 3.4 Lucky Number Bonus

Tilleggspremie når `lastBall === player.luckyNumber` ved 9/9-seier.

**Aktivering:** `Spill2Config.luckyNumberEnabled = true` AND `Spill2Config.luckyNumberPrizeCents` er satt. Service-laget validerer konsistens (`assertConfigConsistency` — `Spill2ConfigService.ts:253-280`):
```typescript
if (config.luckyNumberEnabled && config.luckyNumberPrizeCents === null) {
  throw new DomainError("INVALID_CONFIG", "luckyNumberEnabled=true krever at luckyNumberPrizeCents er satt.");
}
```

**Spiller-input:** `lucky:set`-socket-event (`apps/backend/src/sockets/gameEvents/roomEvents.ts:1201-1215`):
```typescript
socket.on("lucky:set", rateLimited(...async (payload) => {
  const num = payload?.luckyNumber;
  if (typeof num !== "number" || num < 1 || num > 60) {  // NB: 60 — legacy-grense
    throw new DomainError("INVALID_INPUT", "luckyNumber må være mellom 1 og 60.");
  }
  // lagres i `luckyNumbersByRoom` Map<roomCode, Map<playerId, number>>
}));
```

> **Inconsistency-flag:** Socket-handler validerer 1-60, men Spill 2 har bare 1-21 baller. Alle lucky-numbers > 21 vil aldri matche `lastBall`. Dette er bevisst legacy-paritet (game2.js:1628-1712 hadde 60 også) men kan diskuteres.

**Payout-trigger:** `Game2Engine.onDrawCompleted` etter 9/9-deteksjon (`Game2Engine.ts:334-347`):
```typescript
const luckyNumber = this.luckyNumbersByPlayer.get(room.code)?.get(c.player.id);
const luckyPrize = variantConfig!.luckyNumberPrize ?? 0;
if (luckyNumber !== undefined && luckyNumber === lastBall && luckyPrize > 0) {
  luckyPaid = await this.payG2LuckyBonus({...});
}
```

**Bridge cents-til-kr:** `Spill2GlobalRoomService.buildVariantConfigFromSpill2Config` konverterer `luckyNumberPrizeCents` (i øre) til `luckyNumberPrize` (i kr) — engine forventer kr-verdier. NB: konvertering bruker `Math.floor(prizeCents / 100)` så delkroner avkortes (`Spill2GlobalRoomService.ts:95-98`).

**Random luckyNumber per runde:** Legacy game2.js:1628-1712 trekker random luckyNumber per runde fra serveren. Denne implementasjonen lar spilleren velge selv (1-60). Engine eier ikke "random pick" — admin kan bare skru på/av tilleggspremien.

### 3.5 Bongpris (singel ticket-type)

- **Ingen multi-farge:** Spill 2 har KUN ÉN ticket-type ("Standard") — `apps/backend/src/game/Spill2GlobalRoomService.ts:101-108`:
  ```typescript
  ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }]
  ```
- **Default pris:** 1000 øre = 10 kr (`app_spill2_config.ticket_price_cents` default).
- **Admin-justerbar:** 1-100_000 øre via `PUT /api/admin/spill2/config { ticketPriceCents }`. Endring slår inn ved neste runde (5s cache-TTL invalidate).
- **Ingen bong-multiplikator:** Ingen × 1/2/3-skalering. Alle bonger kjøpt for samme pris får samme premie-vekt.

### 3.6 Auto-start-betingelse (minTicketsToStart)

**Enkel modell** (default 5 bonger):
1. Runde slutter (G2_WINNER eller G2_NO_WINNER).
2. `PerpetualRoundService.handleGameEnded` sjekker `variantConfig.minTicketsBeforeCountdown`.
3. Hvis > 0 → start polling-gate (`startWaitingForTickets`).
4. Polling sjekker `armedLookup.getArmedPlayerTicketCounts(roomCode)` hvert 2. sek.
5. Når sum >= threshold → `startScheduledCountdown` → `setTimeout(roundPauseMs)` → `engine.startGame`.

**Sikkerhets-timeout 30 min:** Hvis threshold ikke nås innen 30 min, startes runde uansett (forhindrer evig hengende rom). Logges som `warn` så ops kan se mønsteret.

**Tomt rom:** `checkThresholdAndProceed` sjekker også at minst 1 spiller er i rommet. Tomt rom → polling stopper, ingen runde spawnes.

**Default = 5:** Migration seeder `min_tickets_to_start = 5` — sane default for sparse pilot-trafikk. 0 = umiddelbar start (ingen gate).

Implementasjon: `apps/backend/src/game/PerpetualRoundService.ts:475-700`.

---

## 4. Backend-services-kart (med fil-paths)

### 4.1 Spill2GlobalRoomService — config → variantConfig bridge

**Fil:** `apps/backend/src/game/Spill2GlobalRoomService.ts` (137 linjer)

Tar `Spill2Config` (admin-konfigurert global singleton) og mapper det inn i eksisterende `GameVariantConfig`-struktur slik at `Game2Engine` + `PerpetualRoundService` kan kjøre uten store endringer.

**Output-shape** (`buildVariantConfigFromSpill2Config`):
```typescript
{
  ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
  patterns: [],                                   // auto-claim-on-draw, ingen patterns
  maxBallValue: 21,
  drawBagSize: 21,
  patternEvalMode: "auto-claim-on-draw",
  jackpotNumberTable: <kopi av config.jackpotNumberTable>,
  luckyNumberPrize: <luckyNumberPrizeCents / 100>,  // øre → kr
  minTicketsBeforeCountdown: <config.minTicketsToStart>,
  roundPauseMs: <clamped 1000-300000>,
  ballIntervalMs: <clamped 1000-10000>,
}
```

**Hva tjenesten IKKE gjør** (jfr. JSDoc §line 20-46):
1. Lucky-number-randomisering — engine eier sin egen `luckyNumbersByPlayer` Map; bridge eksponerer kun **beløpet**, ikke nummer-pick.
2. ~~Åpningstid-gating i room-spawn — caller (perpetual-loop / cron) må lese `Spill2ConfigService.getActive()` separat før spawn-call. **Ikke wired for Spill 2 per 2026-05-08.**~~ **BIN-823-fix (2026-05-08):** Åpningstid-gating er nå wired via `PerpetualRoundOpeningWindowGuard`. `PerpetualRoundService.canSpawnRound` kaller `isWithinOpeningHours(spill2Config)` før hver spawn for `rocket`/`game_2`/`tallspill`-slugs. Runder spawner ikke utenfor `[openingTimeStart, openingTimeEnd)`-vinduet (Oslo-tz).
3. Migration av `GameManagement.config.spill2`-overrides — to konfig-kilder eksisterer side om side. `roomState.bindVariantConfigForRoom` prioriterer `Spill2Config` over `GameManagement` for `rocket`-rom.

**Fall-through-rekkefølge** (`apps/backend/src/util/roomState.ts:625-650`):
1. `Spill2Config` (global singleton) ← ny primærkilde
2. `GameManagement.config.spill2` (per item) ← legacy fallback
3. `DEFAULT_GAME2_CONFIG` ← hard fallback (`variantConfig.ts:642-658`)

### 4.2 Spill2ConfigService — singleton CRUD + cache + audit

**Fil:** `apps/backend/src/game/Spill2ConfigService.ts` (660 linjer)

Read-through cache (5s TTL default). Ansvar:
- `getActive()` — hent aktiv config. Kaster `DomainError("CONFIG_MISSING")` hvis ingen aktiv rad finnes.
- `update(input: UpdateSpill2ConfigInput)` — partial update med validering, audit-log, cache-invalidate.
- `invalidateCache()` — force-refresh ved neste `getActive()`-kall.

**Validering** (kjøres ved hvert update):
- HH:MM-format på opening-times (`assertOpeningTime` — `:148-176`)
- Jackpot-tabell shape (alle 6 keys, valid `{price, isCash}` — `assertJackpotTable` — `:220-240`)
- Pct-ranges 0-100 for `isCash=false` (`:206-211`)
- `luckyNumberEnabled=true` krever `luckyNumberPrizeCents` satt (`:274-279`)
- Opening-times XOR: enten begge satt eller begge null (`:255-262`)
- Min/max-grenser per felt (matcher migration CHECK-constraints)

**Audit-log:** Hvert update skriver `spill2.config.update` event til `AuditLogService` med før/etter-snapshot + `changedFields[]` (`:526-545`). Best-effort — feil i audit blokkerer ikke update.

**Helper:** `isWithinOpeningHours(config, now)` evaluerer om gitt tidspunkt er innenfor åpningstid-vindu. Bruker `Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo" })` for tidssone-konvertering. Over-midnatt-vindu (eks. 22:00-02:00) støttes IKKE i pilot-versjonen — admin må sette to konfig-rader (out-of-scope per Tobias-direktiv 2026-05-08).

### 4.3 Game2AutoDrawTickService — server-driven draw-loop

**Fil:** `apps/backend/src/game/Game2AutoDrawTickService.ts` (712 linjer)

Cron-driven service som trekker baller automatisk for ALLE running ROCKET-rom. Speiler `Game1AutoDrawTickService`-mønsteret men for perpetual-modell.

**Per-tick-algoritme** (`tick()`):
1. Enumerer alle rom via `engine.listRoomSummaries()`.
2. Filtrer på `GAME2_SLUGS` (rocket / game_2 / tallspill, case-insensitive).
3. Skip om `summary.gameStatus !== "RUNNING"` (rydd `lastDrawAtByRoom`-cache).
4. Sjekk in-process mutex `currentlyProcessing` (per-rom).
5. Throttle: skip om `now - lastDrawAt[roomCode] < effectiveIntervalMs`. Effective interval = `variantConfig.ballIntervalMs` (admin-konfig) eller env-fallback `drawIntervalMs` (default 30000ms).
6. Hent fullt snapshot via `engine.getRoomSnapshot`.
7. Skip om `currentGame.status !== "RUNNING"` eller `drawnNumbers.length >= GAME2_MAX_BALLS (21)`.
8. **Stuck-room recovery:** Hvis drawn=21 men status fortsatt RUNNING → `engine.forceEndStaleRound("STUCK_AT_MAX_BALLS_AUTO_RECOVERY")`. Trigger `onStaleRoomEnded` → `perpetualRoundService.spawnFirstRoundIfNeeded`.
9. Sjekk at rommet har minst 1 spiller (skip-emitterer `auto_draw_skip_empty_room`).
10. `engine.drawNextNumber({ roomCode, actorPlayerId: SYSTEM_ACTOR_ID })`.
11. Oppdater `lastDrawAtByRoom[roomCode] = now`.
12. **Broadcaster:** `broadcaster.onDrawCompleted({ roomCode, number, drawIndex, gameId })` — emit `draw:new` + engine-effekter + `room:update`.

**Feil-isolasjon:** Alle errors fanget — `DRAW_TOO_SOON`, `NO_MORE_NUMBERS`, `GAME_PAUSED`, `GAME_NOT_RUNNING` skipper rommet og fortsetter. Strukturerte error-koder `BIN-RKT-001..008` for observability.

**Throttle init-fix** (BUG-1 2026-05-06): Første tick etter status=RUNNING setter `lastDrawAt = now` og skipper denne ticken — slik at klient-countdown rekker overgangen før første ball trekkes.

**System-actor:** Auto-draw-tick bruker `SYSTEM_ACTOR_ID` (ikke `hostPlayerId`). `assertHost` (BingoEngine) tillater sentinel-en for perpetual-rom, og `_drawNextLocked` skipper requirePlayer + wallet-check når actor er system og rommet er perpetual.

**Periodic validation:** Hver N. tick (default 10) trigger `onPeriodicValidation` for room-uniqueness invariant — sjekker at det fortsatt kun finnes ÉTT rocket-rom globalt.

### 4.4 Game2Engine — onDrawCompleted hook

**Fil:** `apps/backend/src/game/Game2Engine.ts` (1237 linjer)

`Game2Engine extends BingoEngine`. Tilfører kun `onDrawCompleted`-override som:
- Auto-marker celler som matcher `lastBall` (`autoMarkPlayerCells` — fix 2026-05-04 for audit/replay/late-joiner-paritet).
- Beregner `jackpotList` for alle 6 buckets via `computeJackpotList`.
- Pre-9 draws → emit kun jackpot-list-update.
- Post-9 → `findG2Winners` (snapshot-iterator + race-detector — audit §3.4 fix).
- Multi-winner payout: sequential når <= 10 vinnere, **batched parallel** (50 per batch) når >= 11 vinnere — bevarer regulatorisk atomicity via sync pre-pass av budget-allokasjon.
- Lucky-bonus-payout (sequential) etter jackpot-share.
- Sett `game.status = ENDED`, `endedReason = G2_WINNER`.

**Side-effects-stash** (`lastDrawEffectsByRoom: Map<string, G2DrawEffects>`):
- Engine populer ved `onDrawCompleted`.
- Socket-laget kaller `getG2LastDrawEffects(roomCode)` etter `drawNextNumber` returns — atomic read-and-clear.
- Effekter inneholder `{roomCode, gameId, drawIndex, lastBall, jackpotList, winners[], gameEnded, endedReason}`.

**Subclass-detect bug** (Audit §2.1, fixed 2026-05-04): `Game3Engine extends Game2Engine extends BingoEngine`. Runtime-instans er `Game3Engine` — `instanceof Game2Engine` returnerer korrekt `true` for ROCKET-rom.

### 4.5 Routes

**Admin-config CRUD** — `apps/backend/src/routes/adminSpill2Config.ts` (189 linjer):
- `GET /api/admin/spill2/config` (GAME_CATALOG_READ — ADMIN/HALL_OPERATOR/SUPPORT/AGENT)
- `PUT /api/admin/spill2/config` (GAME_CATALOG_WRITE — kun ADMIN)

Wire-format: cents over wire (admin-UI konverterer til/fra kr); opening-times som `"HH:MM"`-strenger eller `null`; jackpotNumberTable som objekt med 6 keys.

**Public health** — `apps/backend/src/routes/publicGameHealth.ts:513-562`:
- `GET /api/games/spill2/health?hallId=X` — un-authenticated, rate-limit 60/min/IP, no-cache
- Returnerer aggregert `GameRoomHealth` med `withinOpeningHours` lest fra `Spill2Config` (NB: `hallId`-param er kun for logging — Spill 2 er global).
- Status-mapping: `ok` (alt friskt), `degraded` (aktiv runde men Redis nede / draw stale > 30s), `down` (DB nede eller utenfor åpningstid uten aktiv runde).

**Dev-diagnose (token-gated)** — `apps/backend/src/routes/devGame2State.ts` (397 linjer):
- `GET /api/_dev/game2-state?token=...` — read-only diagnostic (lastTickResult, room snapshot, perpetual pending-state).
- `POST /api/_dev/game2-force-end?token=...` — workaround for stuck-rom: force-end-er ROCKET + spawner ny runde.

**Job-scheduler** — `apps/backend/src/jobs/game2AutoDrawTick.ts` (41 linjer):
- Wrapper rundt `Game2AutoDrawTickService.tick()`.
- Feature-flag `GAME2_AUTO_DRAW_ENABLED` (default ON i prod).

**Socket broadcaster** — `apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts` (149 linjer):
- `onDrawCompleted` emitter `draw:new` + drainer engine-effekter (`emitG2DrawEvents`) + trigger `emitRoomUpdate(roomCode)`.
- Fail-soft per emit (logges, kaster ikke videre).

**Socket events** — `apps/backend/src/sockets/gameEvents/drawEmits.ts:20-53`:
- `g2:jackpot:list-update` — alltid per draw, payload `{roomCode, gameId, jackpotList, currentDraw}`.
- `g2:rocket:launch` — per vinner ved gameEnded, payload `{roomCode, gameId, playerId, ticketId, drawIndex, totalDraws}`.
- `g2:ticket:completed` — per vinner (legacy `Game2/GameProcess.js:343-354`).

---

## 5. Database-skjema

### 5.1 `app_spill2_config` (singleton)

**Migration:** `apps/backend/migrations/20261213000000_app_spill2_config.sql` (153 linjer)

```sql
CREATE TABLE IF NOT EXISTS app_spill2_config (
  id                          TEXT PRIMARY KEY,
  opening_time_start          TEXT NULL,                -- HH:MM eller NULL
  opening_time_end            TEXT NULL,                -- HH:MM eller NULL
  min_tickets_to_start        INTEGER NOT NULL DEFAULT 5
                              CHECK (min_tickets_to_start >= 0 AND min_tickets_to_start <= 1000),
  ticket_price_cents          INTEGER NOT NULL DEFAULT 1000
                              CHECK (ticket_price_cents > 0 AND ticket_price_cents <= 100000),
  round_pause_ms              INTEGER NOT NULL DEFAULT 60000
                              CHECK (round_pause_ms >= 1000 AND round_pause_ms <= 300000),
  ball_interval_ms            INTEGER NOT NULL DEFAULT 4000
                              CHECK (ball_interval_ms >= 1000 AND ball_interval_ms <= 10000),
  jackpot_number_table_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  lucky_number_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  lucky_number_prize_cents    INTEGER NULL CHECK (lucky_number_prize_cents IS NULL OR lucky_number_prize_cents >= 0),
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL
);

-- Singleton-håndhevelse: kun ÉN aktiv rad globalt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill2_config_singleton_active
  ON app_spill2_config((active))
  WHERE active = TRUE;
```

**Seed-rad** (idempotent INSERT ON CONFLICT DO NOTHING):
- `id = 'spill2-default'`
- Alle defaults som over
- `jackpot_number_table_json` = legacy DEFAULT_GAME2_CONFIG (5000/2500/1000 fast + 100/75/50 pct)

### 5.2 `app_game2_ticket_pools` (deprecated, slettet i Bølge B-cleanup)

**Migration:** `apps/backend/migrations/20261206000001_game2_ticket_pools.sql`

Tabellen finnes fortsatt i schema (forward-only-policy), men `Game2TicketPoolService` er **slettet 2026-05-05** sammen med ChooseTicketsScreen-stacken. Dagens flyt bruker `BuyPopup` som genererer tickets ad-hoc per kjøp (ingen pre-genererte 32-pools).

> **Cleanup-anbefaling (post-pilot):** Hvis tabellen er ubrukt etter 30 dager → drop via migration. Per 2026-05-08 er det ingen aktiv kode-path som leser/skriver den.

### 5.3 Wallet- og compliance-koblinger

Spill 2 bruker samme felles compliance/wallet-skjema som Spill 1:
- `app_compliance_outbox` — outbox for ledger-events
- `app_compliance_ledger` — §71-pengespillforskriften events
- `app_payout_audit` — hash-chain audit trail
- `app_wallets` / `app_wallet_transactions` — players' wallet
- `app_wallet_outbox` — BIN-761 outbox-pattern for credit/debit

**House-account-ID format** (`makeHouseAccountId`):
- `house-{hallId}-main_game-INTERNET` for Spill 2 (alle haller bidrar til samme `hallId`-bucket men ROOM er global)

NB: Selv om rommet er globalt, binder ledger-events til `room.hallId` — dette er master-hallens ID (typisk Demo Hall 001 eller første-spiller-sin-hall, avhengig av room-init-flow). Audit §9.x diskuterer at dette potensielt blander ledger-events på tvers av haller. **Kjent gap, ikke pilot-blokker.**

### 5.4 Migrations som introduserer Spill 2-skjema

| Migration | Dato | Hva den gjør |
|---|---|---|
| `20261206000001_game2_ticket_pools.sql` | 2026-12-06 | Opprettet `app_game2_ticket_pools` (deprecated etter PR #921) |
| `20261213000000_app_spill2_config.sql` | 2026-12-13 (commit-tid) | Opprettet `app_spill2_config` singleton-tabell + seed-rad |

---

## 6. Klient-flyt

### 6.1 Lobby — hvordan klient kobler til

**Player-shell:** `http://localhost:4000/web/?webClient=game_2`

Feature-flag `webClient=game_2` router til `Game2Controller` i `packages/game-client/src/games/game2/Game2Controller.ts`.

**State-machine:** `LOADING → LOBBY → PLAYING → SPECTATING → ENDED`

**Initial join-flow** (`Game2Controller.start`):
1. `socket.connect()` på namespace `/game2` med 10s timeout.
2. `socket.createRoom({ hallId, slug: 'rocket' })` — server router via `canonicalRoomCode` → `roomCode = "ROCKET"`.
3. Server kaller `perpetualRoundService.spawnFirstRoundIfNeeded(roomCode)` — spawn første runde hvis rommet er tomt.
4. `bridge.applySnapshot(snapshot)` — initial state.

**Reconnect-flow** (`apps/backend/src/sockets/gameEvents/roomEvents.ts:670+`):
- På `connectionStateChanged === 'connected'` etter disconnect → `socket.resumeRoom({ roomCode })` → `bridge.applySnapshot(res.data.snapshot)`.
- Spill 2 har egen logikk siden ROCKET er global — re-attach via `room:resume` istedenfor ny `room:join`.

### 6.2 Socket.IO-rom for live-state

| Namespace | Hva |
|---|---|
| `/game2` | Player-rom for ROCKET (leser draw-events) |
| `/admin-game1` | Admin-oversikt (lytter på alle rooms) |
| `/tv` | TV-skjerm read-only |

**Per-spiller-strip** (Wave 3b, 2026-05-06): For perpetual rom (`rocket`/`monsterbingo`) sender `room:update` én strippet payload pr socket istedenfor full broadcast. Sparer 460 MB → 1 MB pr emit på 1500-spillere-skala. Implementasjon: `apps/backend/src/util/roomHelpers.ts:stripPerpetualPayloadForRecipient` (ADR-011).

**Targeted broadcast:** Aldri `io.emit(...)` — alltid `io.to(roomCode).emit(...)`. Pilot-skala 1500 spillere på samme room betyr at full broadcast ville være katastrofalt for pre-Wave 3b-stack.

### 6.3 Ticket-purchase og pre-game-vindu

- **Pre-game-vindu:** Definert av `Spill2Config.roundPauseMs` (default 60_000ms = 60 sek mellom runder).
- **Buy-popup:** `BuyPopup.ts` (game2/components) viser kjøp-grid. Spilleren velger antall (default 1-30 brett, max 30 per spiller per runde).
- **Bet-arm:** `bet:arm`-socket-event sender `{ playerId, ticketCount, selections[] }`. `roomState.armedLookup` trekker `armedPlayerIds`/`Counts`/`Selections` carry-over til neste runde.
- **Ticket-pris:** Leses fra `Spill2Config.ticketPriceCents` ved runde-start. Endring slår inn ved NESTE runde (ingen mid-round price change).

### 6.4 Draw-events streamen

**Per-draw events** (etter hver tick fra `Game2AutoDrawTickService`):
1. `draw:new` `{ number, drawIndex, gameId }` — universell, alle klienter rendrer ny ball.
2. `g2:jackpot:list-update` `{ jackpotList: JackpotListEntry[], currentDraw }` — oppdater jackpot-display (alltid, også pre-9).
3. `room:update` (full snapshot) — etter Wave 3b stripped per recipient.

**Ved 9/9-seier (drawIndex >= 9):**
4. `g2:rocket:launch` `{ playerId, ticketId, drawIndex, totalDraws }` — celebratory animation per vinner.
5. `g2:ticket:completed` `{ playerId, ticketId }` — per vinner (legacy paritet).
6. `room:update` med `currentGame.status = ENDED, endedReason = "G2_WINNER"`.

**Klient-side handlere** (`packages/game-client/src/bridge/GameBridge.ts:274-285`).

### 6.5 Win-state og payout-visning

- Vinner ser sin egen `claim.payoutAmount` i `room:update`-payload.
- Wallet credit skjer via outbox (asynkront — kan lagge bak room-update med < 1 sek). Klient leser saldo via `GET /api/wallet/me/balance`.
- Single-prize-cap: Hvis `requestedPayout > 2500 kr`, capped beløp returneres. Capped-flag `claim.payoutWasCapped = true` propageres til klient.
- Multi-vinner-deling: `pricePerWinner = Math.round(totalPrice / winnerCount)`. 100 kr på 3 vinnere → hver får 33 kr (rest til HOUSE_RETAINED-event).

---

## 7. Admin-konfig (uten redeploy)

### 7.1 Felter som kan endres

URL: `/admin/#/games/spill2-config`

| Felt | Type | Min | Max | Default | Notat |
|---|---|---|---|---|---|
| `openingTimeStart` | string `HH:MM` \| null | "00:00" | "23:59" | null | NULL = alltid åpent |
| `openingTimeEnd` | string `HH:MM` \| null | "00:00" | "23:59" | null | Service validerer start < end |
| `minTicketsToStart` | int | 0 | 1000 | 5 | 0 = umiddelbar start |
| `ticketPriceCents` | int (øre) | 1 | 100_000 | 1000 (=10 kr) | UI viser kr |
| `roundPauseMs` | int (ms) | 1_000 | 300_000 | 60_000 (=60s) | Pause mellom runder |
| `ballIntervalMs` | int (ms) | 1_000 | 10_000 | 4_000 (=4s) | Pause mellom hver ball |
| `jackpotNumberTable` | object | — | — | legacy default | Alle 6 keys må være satt |
| `luckyNumberEnabled` | bool | — | — | false | Krever luckyNumberPrizeCents hvis true |
| `luckyNumberPrizeCents` | int (øre) \| null | 0 | 100_000_000 | null | Validert mot enabled-flag |

### 7.2 Validering og guards

**Schema-nivå** (CHECK-constraints i migration) — håndhever absolutte grenser.

**Service-nivå** (`Spill2ConfigService.update`):
- `assertOpeningTime` per felt
- `assertJackpotTable` shape + per-entry `{price, isCash}`-shape
- `assertConfigConsistency` (etter merge):
  - Opening-times XOR (begge satt eller begge null)
  - `start < end` leksikografisk på "HH:MM"
  - `luckyNumberEnabled=true` krever `luckyNumberPrizeCents` satt
- `INVALID_INPUT` for feltgrenser
- `INVALID_CONFIG` for konsistensbrudd

**Route-nivå** (`adminSpill2Config.ts`):
- RBAC: `GAME_CATALOG_READ` for GET, `GAME_CATALOG_WRITE` (ADMIN-only) for PUT.
- Body must være object (ikke array).
- Numeric strings konverteres til number (form-body-toleranse).

### 7.3 Audit-events ved oppdatering

Hvert PUT skriver `spill2.config.update` event:
```typescript
{
  actorType: "ADMIN",
  actorId: input.updatedByUserId,
  action: "spill2.config.update",
  resource: "spill2_config",
  resourceId: before.id,
  details: {
    before: <serializeForAudit(before)>,
    after: <serializeForAudit(after)>,
    changedFields: <diffChangedFields(before, after)>,
  },
}
```

Best-effort — feiler aldri caller. Logged som warn ved audit-failure.

**Cache-invalidate:** Etter UPDATE kalles `invalidateCache()` så neste `getActive()` leser fra DB. Default TTL 5 sek — endring slår inn ved senest 5 sek delay.

---

## 8. Pilot-gating R1-R12 — Spill 2-spesifikke status

| # | Tiltak | Hvordan det gjelder Spill 2 | Status |
|---|---|---|---|
| R1 | Lobby-rom Game1Controller-wireup | **Ikke relevant** — Spill 2 har ingen Game1-lobby. Klient kobler direkte til ROCKET via `Game2Controller.createRoom`. | n/a |
| R2 | Failover-test (drep instans midt i runde) | **Pilot-gating** — verifiser at perpetual-loop overlever instans-restart uten å miste draws. | Infra klar, må kjøres |
| R3 | Klient-reconnect-test | **Pilot-gating** — `socket.resumeRoom` for ROCKET må gi full state-replay. | Infra klar, må kjøres |
| R4 | Load-test 1000 klienter | **Direkte relevant** — ROCKET er pilot-skala 1500 samtidige. | Ikke startet |
| R5 | Idempotent socket-events | `lucky:set`, `bet:arm`, `claim:submit` for Spill 2 må ha `clientRequestId`-dedup. | Wallet-siden ferdig; rom-side ikke verifisert |
| R6 | Outbox-validering | Compliance + wallet outbox dekker Spill 2 likt som Spill 1. | Ferdig (felles infra) |
| R7 | Health-endpoint per rom | `/api/games/spill2/health` ferdig — `apps/backend/src/routes/publicGameHealth.ts:513-562`. | ✅ Merget |
| R8 | Alerting (Slack/PagerDuty) | `RoomAlertingService` overvåker ROCKET-health. | ✅ Merget (felles infra) |
| **R9** | **Spill 2 24t-leak-test** | **Direkte relevant** — verifiser at perpetual-loop ikke akkumulerer minne over 24t kontinuerlig drift. | **Pilot-utvidelses-gating, ikke startet** |
| R10 | Spill 3 phase-state-machine | Ikke relevant for Spill 2 — Spill 3-spesifikt. | n/a |
| R11 | Per-rom resource-isolation | **Direkte relevant** — én Spill 2-feil må ikke ta ned Spill 1/3. | Ikke startet |
| R12 | DR-runbook | Felles for alle live-rom. | ✅ Merget |

**Pilot-go-live:** R2 + R3 + R5 må kjøres for Spill 2-rom før pilot går live (samme som Spill 1).

**Pilot-utvidelse (4 → flere haller):** R9 (24t-leak) + R4 (load-test 1000) må bestå.

---

## 9. Immutable beslutninger (det som ALDRI skal endres uten Tobias)

### 9.1 ETT globalt rom — singleton-konstrukten

> **STATUSAVKLARING 2026-05-08:** Spill 2 har ETT globalt rom (`ROCKET`) og dette skal IKKE endres til per-hall, per-GoH eller multi-instance. Singleton-konstrukten håndheves på 3 lag (canonicalRoomCode + partial unique idx + GAME2_SLUGS-set). Hvis du finner kode som prøver å spawne flere `rocket`-rom — det er bug.

### 9.2 3×3 grid + 21 baller + Fullt Hus only

| Regel | Verdi |
|---|---|
| Grid | 3×3 (9 celler) |
| Ball-range | 1-21 |
| FREE-celle | Ingen — alle 9 celler må markeres |
| Vinning | Kun 9/9 (Fullt Hus) — ingen rad-faser |
| Min draws før vinner-sjekk | 9 (`GAME2_MIN_DRAWS_FOR_CHECK`) |

### 9.3 Auto-start basert på solgte bonger (ingen master)

> Spill 2 har INGEN master-rolle. Ingen "Start neste spill"-knapp, ingen `Game1MasterControlService`-koblet path, ingen plan-runtime. Auto-start når `minTicketsToStart` møtes via `PerpetualRoundService.handleGameEnded` → threshold-polling → `engine.startGame`.

### 9.4 15% til organisasjoner (MAIN_GAME)

Spill 2 er **regulatorisk hovedspill**, ikke databingo. §11-distribusjon = minst 15%. `ledgerGameTypeForSlug("rocket") === "MAIN_GAME"` — bekreftet via SPILLKATALOG.md korreksjon 2026-04-25.

Single-prize-cap: Hovedspill har INGEN cap. Spill 2 betaler ut faktisk pricePerWinner uavhengig av om beløpet overstiger 2500 kr.

### 9.5 Perpetual loop drevet av PerpetualRoundService

> Auto-restart etter game-end er ikke valgfritt for Spill 2. Hvis du finner kode som starter ROCKET-runder via plan-runtime, master-handling eller cron utenom `PerpetualRoundService` — det er feil. Kun service-en eier round-spawn.

### 9.6 Bridge-pattern for config

> `Spill2GlobalRoomService.buildVariantConfigFromSpill2Config` er ENESTE måte å oversette `Spill2Config` til `GameVariantConfig`. Hvis du legger inn en ny config-felt, MÅ bridge-funksjonen oppdateres samtidig. Tester i `roomState.bindSpill2Config.test.ts` verifiserer mappingen.

---

## 10. Kjente begrensninger og åpne issues

### 10.1 Pilot-blokkere som må fikses

**Ingen kjente pilot-blokkere per 2026-05-08.** Alle 9 KRITISKE funn fra `SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md` er enten fikset (Wave 2/3a/3b) eller mitigert til HIGH-status.

### 10.2 Pilot-utvidelse-blokkere

| Issue | Beskrivelse | Linear |
|---|---|---|
| ~~**Åpningstid-guard mangler i perpetual-loop**~~ | ~~`canSpawnRound` for Spill 2 returnerer alltid null — perpetual-loopen spawner runder uavhengig av `Spill2Config.openingTime*`. Spill 3 har full guard via `isWithinOpeningWindow`. **Pilot-blokker hvis admin setter åpningstid og forventer at runder stopper utenfor vinduet.**~~ **FIKSET BIN-823 (2026-05-08):** Logikken er flyttet til `apps/backend/src/game/PerpetualRoundOpeningWindowGuard.ts` og kalles via factory i `apps/backend/src/index.ts`. Spill 2-config med `openingTimeStart`/`End` håndheves nå likt med Spill 3. Verifisert via 19 unit-tester (`PerpetualRoundOpeningWindowGuard.test.ts`) + 4 wiring-regression-tester (`indexWiring.spill2OpeningWindowGuard.test.ts`). | BIN-823 |
| **R9 — 24t-leak-test ikke startet** | Verifiser at perpetual-loop holder seg uten leak/drift over 24t. Krav for utvidelse fra 4 → flere haller. | BIN-819 |
| **R4 — Load-test 1000 klienter ikke startet** | Skala-bekreftelse for ROCKET. | BIN-817 |
| **R11 — Per-rom resource-isolation ikke startet** | Sirkel-bryter per rom så Spill 2-feil ikke tar ned Spill 1/3. | BIN-821 |

### 10.3 Tekniske gjelder

| Issue | Beskrivelse | Severity |
|---|---|---|
| **Lucky number 1-60 selv om bare 1-21 baller** | `lucky:set`-handler aksepterer 1-60 (legacy-paritet) men > 21 vil aldri matche. Klient-UI har 5×5-grid (25 celler). | LOW |
| **`app_game2_ticket_pools`-tabell er ubrukt** | Tabell finnes etter forward-only-policy, men `Game2TicketPoolService` er slettet 2026-05-05. Dropp post-pilot via migration. | LOW |
| **Over-midnatt-vindu støttes ikke** | `Spill2Config.openingTimeStart > openingTimeEnd` (eks 22:00-02:00) avvises av `assertConfigConsistency`. Admin må sette to konfig-rader hvis behov. Out-of-scope per Tobias. | KNOWN |
| **`hallId`-binding i ROCKET-rom blander ledger-events** | Audit-events bindes til `room.hallId` (master-hallens ID, typisk Demo Hall 001 eller første-spiller-sin-hall). Ledger §71-events kan derfor ikke uten videre splittes per hall for ROCKET. | MEDIUM (audit-side) |
| **Lucky-number-randomisering** | Legacy game2.js trekker random luckyNumber per runde fra serveren. Vår implementasjon lar spilleren velge selv. Kjent avvik fra legacy. | KNOWN |

### 10.4 Performance-grenser (testet per 2026-05-08)

| Metric | Verdi | Notat |
|---|---|---|
| Max samtidige klienter testet | ~50 | I lokal/dev — pilot-skala 1500 ikke verifisert (R4 gjenstår) |
| `onDrawCompleted` p95 (sequential, < 10 vinnere) | ~250-500ms per vinner | Audit §3.1 |
| `onDrawCompleted` p95 (batched, 100+ vinnere) | ~6-10s | Audit §3.1, post-Wave 3a fix |
| `room:update` payload (full broadcast) | ~300 KB pre-Wave 3b | 1500 sockets × 300 KB = 450 MB per emit |
| `room:update` payload (per-spiller-strip) | ~0.8 KB pre Wave 3b | ADR-011 |

### 10.5 Manglende features

- **Sjikt-konfigurasjon per hall:** Spill 2 er bevisst global. Hvis pilot-haller ønsker hall-spesifikk konfig (f.eks. ulik bongpris per hall) → krever arkitektur-endring vekk fra singleton.
- **Multi-tenant config:** Per-tenant `Spill2Config` er bevisst out-of-scope.
- **Spilleplan-kobling:** Spill 2 fremvises ikke i `app_game_plan` / `Game Plans`-UI. Spillet kjører kontinuerlig så lenge åpningstid + threshold møtes.

---

## 11. Lokal pilot-test (hvordan tester man dette lokalt)

### 11.1 Sett opp dev-stack

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
./start-dev.sh
```

Eller manuelt:
```bash
docker-compose up -d postgres redis
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run migrate
# Spill 2 default-config seedes automatisk via migration 20261213000000.
npm run dev:all
```

### 11.2 URL-er

| URL | Hva |
|---|---|
| `http://localhost:5174/admin/` | Admin-konsoll |
| `http://localhost:5174/admin/#/games/spill2-config` | Spill2 globalt rom-konfig |
| `http://localhost:4000/web/?webClient=game_2` | Player-shell forced til Spill 2 |
| `http://localhost:4000/api/admin/spill2/config` | GET/PUT direkte (ADMIN-token kreves) |
| `http://localhost:4000/api/games/spill2/health?hallId=demo-hall-001` | Public health |
| `http://localhost:4000/api/_dev/game2-state?token=<RESET_TEST_PLAYERS_TOKEN>` | Read-only diagnose |

### 11.3 Test-trinn (5 min)

1. **Admin-side:** Logg inn som `tobias@nordicprofil.no` / `Spillorama123!`.
2. **Naviger til Spill2 config:** `/admin/#/games/spill2-config`.
3. **Verifiser default-verdier** (5 bonger min, 10 kr ticket, 60s pause, jackpot-tabell satt).
4. **Player-test:** Åpne `http://localhost:4000/web/?webClient=game_2&dev-user=demo-pilot-spiller-1`.
5. **Join ROCKET:** Klient skal automatisk kobles til `ROCKET` (slug=rocket, hallId=demo-hall-001).
6. **Trekk:** Hvis 5+ bonger er solgt → runde starter. Trekk skjer hvert 4. sek.
7. **9/9-seier:** Kjøp 30 brett (max) for høyere sjanse. Server auto-vinner ved 9/9 og emit `g2:rocket:launch`.
8. **Auto-restart:** Etter 60 sek → ny runde. Verifiser via dev-state-route.

### 11.4 Trigge auto-start manuelt (workaround for stuck-rom)

```bash
curl -X POST 'http://localhost:4000/api/_dev/game2-force-end?token=<TOKEN>'
```

Force-ender stuck ROCKET + spawner ny runde. Kun dev — RESET_TEST_PLAYERS_TOKEN må være satt i env.

### 11.5 Hvis noe feiler

- **Ingen runde starter:** Sjekk `Spill2Config.minTicketsToStart` — er threshold møtt? Sjekk dev-state-route for armed-count.
- **Trekk skjer ikke:** Sjekk feature-flag `GAME2_AUTO_DRAW_ENABLED` i env. Sjekk `getLastTickResult()` via dev-route.
- **DB tom:** Kjør `npm --prefix apps/backend run migrate` på nytt.
- **Stuck-rom:** POST `/api/_dev/game2-force-end?token=...`.
- **Phantom-rom etter restart:** Drep backend, FLUSHALL Redis, restart.

---

## 12. Decisions log

| Beslutning | Doc-ref | Linear/PR |
|---|---|---|
| 2026-05-03 | Perpetual auto-restart for Spill 2/3 etter game-end (Tobias-direktiv) | PR #863 + #868 |
| 2026-05-04 | Game3Engine extends Game2Engine (chain-fix for instanceof) | apps/backend/src/index.ts:702-739 |
| 2026-05-04 | Slug-aware default entry fee (Spill 2 = 10 kr baseline) | PerpetualRoundService.ts:106-115 |
| 2026-05-04 | Auto-mark cells in onDrawCompleted (audit-paritet) | Game2Engine.ts:173 |
| 2026-05-04 | Broadcaster wires draw:new + room:update post-tick | game23DrawBroadcasterAdapter.ts |
| 2026-05-04 | SYSTEM_ACTOR_ID for auto-draw-tick (audit §2.6 fix) | Game2AutoDrawTickService.ts:561 |
| 2026-05-05 | Game2TicketPoolService slettet (Bølge B-cleanup) — én popup-flyt | Bølge B |
| 2026-05-06 | Batched parallel mass-payout for >10 vinnere (audit §3.1 fix) | perf/wave-3a-mass-payout |
| 2026-05-06 | Snapshot-iterator + race-detector i findG2Winners (audit §3.4 fix) | Game2Engine.ts:913-958 |
| 2026-05-06 | Per-spiller-strip for room:update i perpetual-rom (Wave 3b) | ADR-011 |
| 2026-05-06 | Threshold-polling-gate (minTicketsBeforeCountdown) | PerpetualRoundService.ts:475-700 |
| 2026-05-06 | LedgerGameType MAIN_GAME for Spill 2/3 (audit §9.1 fix) | PR #948 |
| 2026-05-08 | `app_spill2_config` singleton-tabell + admin-CRUD (Tobias-direktiv) | Migration 20261213000000 |
| 2026-05-08 | Spill 2 redesign — global config primærkilde, GameManagement.config.spill2 fallback | Spill2GlobalRoomService.ts |
| 2026-05-08 | Live-rom-robusthet-mandat (Evolution Gaming-grade) | LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md |
| 2026-05-08 | R9 (24t-leak) er pilot-utvidelses-gating, ikke pilot-go-live | LIVE_ROOM_ROBUSTNESS_MANDATE §6.1 |

---

## 13. Vedlikehold av dette dokumentet

**Oppdater dette dokumentet ved:**
- Hver sesjons-slutt med store endringer på Spill 2
- Nye beslutninger som overstyrer eksisterende
- Når R-tiltak går fra "infra klar" til "kjørt og bestått"
- Når post-pilot-tiltak (R4/R6/R9/R11) lander
- Endringer i `app_spill2_config`-skjema eller bridge-funksjonen
- Endringer i `PerpetualRoundService`-betingelser

**Eier:** PM-AI vedlikeholder under utvikling. Tobias godkjenner større endringer.

**Konflikt-regel:** Ved uenighet mellom dette dokumentet og kode, **doc-en vinner** — koden må fikses. Hvis du oppdager at en regel her er feil, oppdater dokumentet i samme PR som rettelsen.

---

## 14. Referanser

- [SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) — kanonisk regel-spec (gjelder også Spill 2 multi-vinner)
- [SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md) — per-spill-detaljer §2 Hovedspill 2
- [SPILLKATALOG.md](./SPILLKATALOG.md) — Spill 2 = MAIN_GAME, 15% til org
- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — autoritativ robusthet-mandat
- [SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md](./SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md) — 27-funn-audit, 9 KRITISKE
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](./SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — Spill 1-fundament (kontrast)
- OpenAPI: `apps/backend/openapi.yaml` §`Admin — Spill 2 Config` + `Spill2Config`-schema + `/api/games/spill2/health`
- Linear: [BIN-810 R-mandat parent](https://linear.app/bingosystem/issue/BIN-810) + R9 [BIN-819](https://linear.app/bingosystem/issue/BIN-819)

### Kjerne-kildefiler

| Fil | LOC | Ansvar |
|---|---|---|
| `apps/backend/migrations/20261213000000_app_spill2_config.sql` | 153 | Singleton-tabell + seed |
| `apps/backend/src/game/Spill2ConfigService.ts` | 660 | CRUD + validering + cache + audit |
| `apps/backend/src/game/Spill2GlobalRoomService.ts` | 137 | Bridge `Spill2Config` → `GameVariantConfig` |
| `apps/backend/src/game/Game2Engine.ts` | 1237 | onDrawCompleted hook (auto-claim, jackpot, lucky) |
| `apps/backend/src/game/Game2AutoDrawTickService.ts` | 712 | Cron-driven draw-loop |
| `apps/backend/src/game/Game2JackpotTable.ts` | 164 | Jackpot-mapping helpers |
| `apps/backend/src/game/PerpetualRoundService.ts` | 1100+ | Auto-spawn + threshold-gate |
| `apps/backend/src/util/canonicalRoomCode.ts` | 121 | `rocket` → `ROCKET` global |
| `apps/backend/src/util/roomState.ts` | 818+ | `bindVariantConfigForRoom` med Spill2-hook |
| `apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts` | 149 | draw:new + room:update fanout |
| `apps/backend/src/sockets/gameEvents/drawEmits.ts` | 80+ | g2:* event emitters |
| `apps/backend/src/routes/adminSpill2Config.ts` | 189 | Admin GET/PUT |
| `apps/backend/src/routes/publicGameHealth.ts:513-562` | 50 | GET /api/games/spill2/health |
| `apps/backend/src/routes/devGame2State.ts` | 397 | Dev diagnose + force-end |
| `apps/backend/src/jobs/game2AutoDrawTick.ts` | 41 | JobScheduler-wrapper |
| `apps/admin-web/src/pages/games/spill2Config/Spill2ConfigPage.ts` | ~400 | Admin-UI |
| `apps/admin-web/src/api/admin-spill2-config.ts` | — | API-client |
| `packages/game-client/src/games/game2/Game2Controller.ts` | ~500 | Klient-runtime state machine |
| `packages/game-client/src/games/game2/screens/PlayScreen.ts` | — | Bong Mockup design (3×3) |
| `packages/game-client/src/games/game2/components/BongCard.ts` | — | 3×3 grid render |

---

## 15. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial — komplett implementasjons-status og fundament for Spill 2. Fokus på arkitektoniske forskjeller fra Spill 1. | PM-AI (Claude Opus 4.7) |

---

## 16. For nestemann som ser dette

Hvis du er en ny PM eller agent som starter på Spill 2:

1. **Les §1 først** — forskjellene fra Spill 1 er KRITISKE. Misforståelser her koster sesjoner.
2. **Les SPILL_REGLER_OG_PAYOUT.md** — multi-vinner-regelen gjelder også Spill 2 (men flat siden alle bonger har samme pris).
3. **Les SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md** — vit hvilke funn som er fixet og hvilke som er åpne.
4. **Les LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md** — R9 er Spill 2-spesifikk.
5. **Sjekk Linear: BIN-819 (R9) + BIN-810 (R-mandat parent).**
6. **Verifiser at lokalt dev-miljø fungerer** (§11).
7. **IKKE fravik fra de fastlåste beslutningene** i §9. Hvis du finner en konflikt mellom kode og doc, doc-en vinner og koden må fikses.

**Spør Tobias** før du:
- Endrer singleton-konstrukten (én rom for alle haller)
- Legger til master-rolle for Spill 2 (det skal IKKE være master)
- Endrer §11-distribusjons-prosent
- Endrer auto-spawn-betingelser (perpetual-loop er kontrakten)
- Legger til hall-spesifikk konfig (out-of-scope)
- Lager nye gevinstmønstre for Spill 2 (kun Fullt Hus 9/9)

**Hvis du finner kode som motsier denne doc-en**: doc-en er sannheten. Fix koden, oppdater doc-en hvis du oppdager at regelen var feil.
