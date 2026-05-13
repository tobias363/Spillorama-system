---
name: spill2-perpetual-loop
description: When the user/agent works with Spill 2 (rocket / Tallspill / game_2), perpetual room loop, auto-tick draws, jackpot-mapping per draw-count, or Lucky Number Bonus. Also use when they mention Spill2ConfigService, Spill2GlobalRoomService, Game2Engine, Game2AutoDrawTickService, Game2JackpotTable, PerpetualRoundService, PerpetualRoundOpeningWindowGuard, ROCKET-rom, canonicalRoomCode, GAME2_SLUGS, app_spill2_config, minTicketsToStart, ballIntervalMs, roundPauseMs, jackpotNumberTable, luckyNumberEnabled, åpningstid-guard, BIN-823, MAIN_GAME for rocket, drawIndex 9, full plate 9/9. Make sure to use this skill whenever someone touches Spill 2's perpetual loop, ROCKET-rom-routing, jackpot-utbetaling eller config-singleton — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/game/Game2*, apps/backend/src/game/Spill2*, apps/backend/src/game/PerpetualRound*, apps/backend/src/jobs/game2AutoDrawTick.ts, apps/backend/src/util/canonicalRoomCode.ts, apps/backend/src/util/roomState.bindSpill2Config.test.ts, apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts, packages/game-client/src/games/game2/** -->

# Spill 2 — Perpetual room loop og auto-tick

Spill 2 (slug-familie `rocket` / aliaser `game_2`, `tallspill`) er en uavhengig arkitektur som tilfeldigvis bruker samme draw-pipeline som Spill 1. **Det er ETT GLOBALT ROM (`ROCKET`) for alle haller**, drevet av en perpetual loop som auto-spawn'er nye runder. Ingen master, ingen plan, ingen per-hall lobby. Kun Fullt Hus (full plate 9/9) gir vinst.

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` — autoritativ implementasjons-status, alt arkitektur, gaps, beslutninger
- `docs/architecture/SPILLKATALOG.md` — katalogposisjon (Spill 2 er hovedspill MAIN_GAME, IKKE databingo)
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — R9 (Spill 2 24t-leak-test) er utvidelses-gating

**Direktiv (Tobias 2026-05-08):**
> "Live-rommene for Spill 1, Spill 2 og Spill 3 er kritisk infrastruktur."

R9 (Spill 2 24t-leak-test) er utvidelses-gating-tiltak — pilot kan kjøre 4 haller uten R9, men utvidelse betinger at `app_spill2_config.opening_time_*` + perpetual-loop holder uten leak/drift over 24t.

## KRITISK: Spill 2 er IKKE Spill 1 i 21-ball-form

| Aspekt | Spill 1 (`bingo`) | **Spill 2 (`rocket`)** |
|---|---|---|
| Grid | 5×5 med fri sentercelle | **3×3 full plate (9 ruter)** |
| Ball-range | 1-75 | **1-21** |
| Rom-modell | Per-hall lobby + GoH-master | **ETT GLOBALT ROM (`ROCKET`)** |
| Hall-isolasjon | Master-hall styrer | **Ingen** — `hallId` ignoreres for room-routing |
| Master-rolle | Master-hall styrer start/pause | **Ingen master** — auto-start når `minTicketsToStart` er nådd |
| Spilleplan | `app_game_plan` + `GamePlanEngineBridge` | **Ingen plan** — perpetual loop |
| Trekning | Master kall eller engine-tick | **Auto-tick-driven** — `Game2AutoDrawTickService` cron |
| Vinning | Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus | **Kun Fullt Hus (9/9, full plate)** — ingen rad-faser |
| Vinst-sjekk | Per fase (rad 1 etter ~5 trekk) | **Først etter trekk 9** (`GAME2_MIN_DRAWS_FOR_CHECK`) |
| Bonus | Mini-games (Wheel/Chest/Mystery) | **Jackpot-mapping per draw-count + valgfri Lucky Number Bonus** |
| Pris | 5/10/15 kr (3 farger) | **ÉN ticket-type** ("Standard"), default 10 kr |
| Bong-multiplikator | × 1 / × 2 / × 3 (auto-mult) | **Ingen multiplikator** — alle bonger like |
| Konfig | Plan + katalog endres via admin | **Single `app_spill2_config`-rad** (singleton, partial unique idx) |

**Konsekvenser når du gjør endringer:**
- Endrer du `GamePlanEngineBridge`/`GamePlanRunService` → **rører IKKE Spill 2**. Spill 2 har ingen plan-state.
- Endrer du `canonicalRoomCode` for slug-til-room-mapping → verifiser at `rocket`/`game_2`/`tallspill` fortsatt returnerer `ROCKET` global.
- Endrer du `Spill2ConfigService` → alt som leser singleton (engine, perpetual-loop, health-endpoint) påvirkes globalt.
- Endrer du `Game2AutoDrawTickService` → det er ENESTE driver av draws for ROCKET-rom. Hvis ticken stopper → ingen baller trekkes.

## Singleton-håndhevelse (3 lag)

Spill 2 bruker **kun ÉN room-code globalt: `ROCKET`**. Dette håndheves på flere lag:

### Lag 1 — Room-routing (kode)
`apps/backend/src/util/canonicalRoomCode.ts:55-57`:
```typescript
if (slug === "rocket") {
  return { roomCode: "ROCKET", effectiveHallId: null, isHallShared: true };
}
```
Uavhengig av `hallId`/`groupId` mapper alle `rocket`/`ROCKET`/`Rocket` (case-insensitive + whitespace-trimmet) til samme room-code. `effectiveHallId: null` markerer rommet som hall-shared (HALL_MISMATCH-relaksering).

### Lag 2 — Config-singleton (DB)
`apps/backend/migrations/20261213000000_app_spill2_config.sql:71-73`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill2_config_singleton_active
  ON app_spill2_config((active))
  WHERE active = TRUE;
```
Partial unique index sørger for at maks ÉN aktiv konfig finnes globalt.

### Lag 3 — Slug-aliaser (kode)
`apps/backend/src/game/Game2AutoDrawTickService.ts:70-74`:
```typescript
export const GAME2_SLUGS: ReadonlySet<string> = new Set([
  "rocket", "game_2", "tallspill",
]);
```
`tallspill` (markedsføring) og `game_2` (legacy) faller inn på samme runtime-flyt.

## Backend-services-kart

| Service | Fil | Ansvar |
|---|---|---|
| `Spill2GlobalRoomService` | `apps/backend/src/game/Spill2GlobalRoomService.ts` | `Spill2Config` → `GameVariantConfig`-bridge for engine |
| `Spill2ConfigService` | `apps/backend/src/game/Spill2ConfigService.ts` | Singleton CRUD + read-through cache (5s TTL) + audit-log |
| `Game2AutoDrawTickService` | `apps/backend/src/game/Game2AutoDrawTickService.ts` | Cron-driven draw-loop hvert 1000ms — ENESTE driver av draws |
| `Game2Engine` (extends BingoEngine) | `apps/backend/src/game/Game2Engine.ts` | `onDrawCompleted`-hook med jackpot-list + 9/9-deteksjon + multi-winner payout |
| `Game2JackpotTable` | `apps/backend/src/game/Game2JackpotTable.ts` | Jackpot-bucket-resolver per draw-count |
| `PerpetualRoundService` | `apps/backend/src/game/PerpetualRoundService.ts` | Perpetual loop — `spawnFirstRoundIfNeeded`, `handleGameEnded`, threshold-gate |
| `PerpetualRoundOpeningWindowGuard` | `apps/backend/src/game/PerpetualRoundOpeningWindowGuard.ts` | BIN-823-fix: åpningstid-guard wired i `canSpawnRound` |

### Routes

- `GET /api/admin/spill2/config` — RBAC `GAME_CATALOG_READ`
- `PUT /api/admin/spill2/config` — RBAC `GAME_CATALOG_WRITE` (ADMIN-only), partial-update
- `GET /api/games/spill2/health?hallId=X` — public, no-auth, rate-limit 60/min/IP, no-cache
- `GET /api/_dev/game2-state?token=...` — read-only diagnostic
- `POST /api/_dev/game2-force-end?token=...` — workaround for stuck-rom

## Perpetual loop og auto-spawn-trigger

To call-sites trigger ny runde:

**A. Første runde etter cold-start / tomt rom:**
- `room:join`-handler kaller `PerpetualRoundService.spawnFirstRoundIfNeeded(roomCode)`
- Sjekker: service enabled, slug i `PERPETUAL_SLUGS`, ingen pending auto-restart, ingen aktiv runde, rommet har minst 1 spiller, **`canSpawnRound` returnerer true innen åpningstid (BIN-823)**

**B. Auto-restart etter game-end:**
- `bingoAdapter.onGameEnded`-hook kaller `PerpetualRoundService.handleGameEnded(input)`
- Sjekker: `endedReason ∈ NATURAL_END_REASONS` (`G2_WINNER`, `G2_NO_WINNER`, `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY`)
- Hvis `Spill2Config.minTicketsToStart > 0` → threshold-gate (`startWaitingForTickets`):
  - Polling hvert 2. sek (`THRESHOLD_POLL_INTERVAL_MS`)
  - Sikkerhets-timeout 30 min (`THRESHOLD_MAX_WAIT_MS`)
  - Når sum >= threshold → fortsett til countdown
- Etter threshold (eller direkte hvis `minTicketsToStart=0`): `setTimeout(roundPauseMs)` → `engine.startGame`

**Cron-driver:** `apps/backend/src/jobs/game2AutoDrawTick.ts` kjøres hvert 1000ms. Tick enumerer alle rom, filtrerer på `GAME2_SLUGS`, throttler per rom (`drawIntervalMs` eller `variantConfig.ballIntervalMs`), kaller `engine.drawNextNumber({ roomCode, actorPlayerId: SYSTEM_ACTOR_ID })`.

## Jackpot-mapping per draw-count

Premier varierer basert på antall trekninger ved seier — jo færre trekk, jo større jackpot. Speilet legacy-mekanikk fra `gamehelper/game2.js`.

**Tabell-shape** (`Spill2ConfigService.ts:62-68`):
```typescript
type Spill2JackpotTable = Record<"9"|"10"|"11"|"12"|"13"|"1421", Spill2JackpotEntry>;
interface Spill2JackpotEntry {
  price: number;     // flat kr-beløp (isCash=true) eller prosent 0-100 (isCash=false)
  isCash: boolean;
}
```

**Default-seed:**
| Draw-count | Verdi | Type | Premie ved 5000 kr omsetning |
|---|---|---|---|
| `"9"` | 5000 | Cash | 5 000 kr fast |
| `"10"` | 2500 | Cash | 2 500 kr fast |
| `"11"` | 1000 | Cash | 1 000 kr fast |
| `"12"` | 100 | Pct | 5 000 kr (100% av omsetning) |
| `"13"` | 75 | Pct | 3 750 kr (75% av omsetning) |
| `"1421"` | 50 | Pct | 2 500 kr (50% av omsetning) |

**Beregning** (`Game2JackpotTable.ts:96-115`):
```typescript
const rawPrize = entry.isCash
  ? entry.price
  : (entry.price * Math.max(0, ticketCount) * Math.max(0, ticketPrice)) / 100;
```

**Bucket-key `"1421"`:** Matcher draw-count i [14..21]. Display-form til klient er `"14-21"`.

**Per-draw broadcast:** Etter HVER draw (også pre-9) emit `g2:jackpot:list-update` så klient ser hvor mye 9/9 ville vært verdt akkurat nå.

## Lucky Number Bonus

Tilleggspremie når `lastBall === player.luckyNumber` ved 9/9-seier.

**Aktivering:** `Spill2Config.luckyNumberEnabled = true` AND `luckyNumberPrizeCents` satt. Service-laget validerer konsistens (`assertConfigConsistency`).

**Spiller-input:** `lucky:set`-socket-event aksepterer 1-60 (legacy-grense). NB: Spill 2 har bare 1-21 baller, så lucky-numbers > 21 vil aldri matche `lastBall`. Bevisst legacy-paritet.

**Bridge cents-til-kr:** `Spill2GlobalRoomService.buildVariantConfigFromSpill2Config` konverterer `luckyNumberPrizeCents` (øre) til `luckyNumberPrize` (kr). Bruker `Math.floor(prizeCents / 100)` så delkroner avkortes.

## Åpningstid-guard (BIN-823 fix, 2026-05-08)

**Pre-fix gap:** Spill 2 hadde IKKE aktiv åpningstid-guard wired i `canSpawnRound`. `Spill2Config.openingTimeStart`/`End` var konfigurerbar men ble ikke håndhevet.

**Post-fix:** Logikken er flyttet ut til `PerpetualRoundOpeningWindowGuard` og kalles via factory i `apps/backend/src/index.ts`. For Spill 2 (rocket/game_2/tallspill) henter guarden `Spill2Config` og kaller `isWithinOpeningHours(config)`:
- Hvis `openingTimeStart`/`End` er null → returnerer true (alltid åpent — default-konfig)
- Hvis begge satt → sammenligner Oslo-HH:MM mot `[start, end)`-vindu
- Ved DB-feil → returnerer null (fail-open)

**Over-midnatt-vindu (eks. 22:00-02:00) støttes IKKE i pilot-versjonen** — admin må sette to konfig-rader (out-of-scope per Tobias 2026-05-08).

## Compliance — MAIN_GAME (ikke databingo)

`ledgerGameTypeForSlug("rocket")` returnerer `MAIN_GAME` (BIN-769 fix, Wave 2). §11-distribusjon: 15% til organisasjoner (samme som Spill 1/3).

**Single-prize cap:** Spill 2 = `MAIN_GAME` = INGEN 2500 kr-cap. Cap kun for `DATABINGO` (SpinnGo).

## Spillerflyt og klient

**Player-shell:** `http://localhost:4000/web/?webClient=game_2` → `Game2Controller`

**State-machine:** `LOADING → LOBBY → PLAYING → SPECTATING → ENDED`

**Initial join:**
1. `socket.connect()` på namespace `/game2` med 10s timeout
2. `socket.createRoom({ hallId, slug: 'rocket' })` → server router via `canonicalRoomCode` → `roomCode = "ROCKET"`
3. `perpetualRoundService.spawnFirstRoundIfNeeded` spawn første runde hvis tomt
4. `bridge.applySnapshot(snapshot)` — initial state

**Per-spiller-strip (Wave 3b, 2026-05-06):** For perpetual rom sender `room:update` én strippet payload pr socket istedenfor full broadcast. Sparer 460 MB → 1 MB pr emit på 1500-spillere-skala. ADR-011.

## Immutable beslutninger

1. **ETT globalt ROCKET-rom** — IKKE introduser per-hall room-koding for rocket-slug.
2. **Singleton-config** — kun ÉN `app_spill2_config`-rad har `active=TRUE` (partial unique idx).
3. **Auto-tick-driven draws** — `Game2AutoDrawTickService` er ENESTE driver. Master-konsoll skal ikke kunne trigge draw manuelt.
4. **Vinst kun ved 9/9 (full plate)** — ingen rad-faser. Auto-claim, ingen "send claim"-knapp.
5. **MAIN_GAME compliance** — IKKE `DATABINGO`. §11 = 15% til organisasjoner. Ingen single-prize-cap.
6. **Threshold-default = 5 bonger** — sane default for sparse pilot-trafikk.

## Vanlige feil og hvordan unngå dem

### 1. Bruker `DATABINGO` for ledger/cap
Pre-fix bug (BIN-769) hardkodet `DATABINGO` i 3 jackpot-payout-call-sites. Fixed Wave 2.
**Fix:** Bruk alltid `ledgerGameTypeForSlug(room.gameSlug)` — aldri hardkodet streng.

### 2. Forventer at `hallId` påvirker room-routing
Spill 2 ignorerer `hallId` for room-code. Alle `rocket`-spillere havner i `ROCKET` global.
**Fix:** `hallId` brukes kun for ledger-bucket (`house-{hallId}-main_game-INTERNET`), aldri for room-isolasjon.

### 3. Skipper aliaser i tester
Hvis du tester `rocket` men ikke `game_2`/`tallspill`, går alias-binding stille i stykker.
**Fix:** Bruk `apps/backend/src/util/roomState.bindSpill2Config.test.ts` som mal.

### 4. Endrer `Game2AutoDrawTickService` uten å sjekke throttle-init
BUG-1 (2026-05-06): Første tick etter status=RUNNING skipper for å la countdown rekke.
**Fix:** Verifiser `lastDrawAtByRoom`-init i tester når du endrer tick-logikken.

### 5. Glemmer at `Game3Engine extends Game2Engine`
Runtime-instans for ROCKET-rom er `Game3Engine` (pga arve-kjede). `instanceof Game2Engine` returnerer korrekt `true`.
**Fix:** Subclass-detect-bug fra Audit §2.1 er fixed 2026-05-04 — verifiser at endringer ikke regresserer.

### 6. Endrer `luckyNumber`-validering til 1-21
Bevisst legacy-paritet med 1-60. Endre kun etter Tobias-godkjenning.

### 7. Antaagelser om over-midnatt-åpningstid
Pilot-versjonen støtter IKKE over-midnatt-vindu (22:00-02:00). Service validerer `start < end` leksikografisk.
**Fix:** Hvis du trenger over-midnatt: dokumenter som out-of-scope eller eskaler til Tobias.

## Når denne skill-en er aktiv

**Gjør:**
- Les `SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` FØRST
- Verifiser at `canonicalRoomCode("rocket")` returnerer `ROCKET` etter dine endringer
- Test både `rocket`, `game_2`, og `tallspill`-aliaser
- Bruk `ledgerGameTypeForSlug` for compliance/cap, aldri hardkodet streng
- Sjekk `Spill2Config.openingTimeStart`/`End` håndhevelse via `PerpetualRoundOpeningWindowGuard`
- Verifiser per-spiller-strip (Wave 3b) ikke regresserer for perpetual rom

**Ikke gjør:**
- IKKE introduser plan-runtime for Spill 2 (det har ingen plan)
- IKKE introduser per-hall room-koding for rocket
- IKKE tillat manuell draw-trigger via master-konsoll
- IKKE endre 9/9-deteksjons-grense uten Tobias
- IKKE hardkode `DATABINGO` i Spill 2-paths

## Kanonisk referanse

Ved tvil mellom kode og doc: **doc-en vinner**, koden må fikses. SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md er autoritativ.

## Relaterte ADR-er

- [ADR-0002 — Perpetual rom-modell for Spill 2/3](../../../docs/adr/0002-perpetual-room-model-spill2-3.md) — bindende: ETT globalt rom, ikke per-hall
- [ADR-0003 — System-actor for engine-mutasjoner](../../../docs/adr/0003-system-actor.md) — system-actor driver auto-tick uten menneskelig agent
- [ADR-0008 — Spillkatalog-paritet (Spill 1-3 = MAIN_GAME)](../../../docs/adr/0008-spillkatalog-classification.md) — bindende: MAIN_GAME for rocket, ikke DATABINGO
- [ADR-0012 — Batched parallel mass-payout](../../../docs/adr/0012-batched-mass-payout.md) — pilot-kritisk for 9/9-payout-bursts
- [ADR-0013 — Per-spiller broadcast-strippet payload](../../../docs/adr/0013-per-recipient-broadcast-perpetual-rooms.md) — bindende: room:update strippes for 1500-spillere
