# Spill 3 — komplett implementasjons-status og fundament

**Status:** Autoritativ. Skal være oppdatert ved hver sesjons-slutt eller etter store endringer.
**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead) + PM-AI (Claude Opus 4.7)
**Lese-først-i-sesjon:** **JA** — alle nye PM/agenter som skal jobbe med Spill 3 SKAL lese dette dokumentet før de begynner.

---

## 0. Hvorfor dette dokumentet eksisterer

Spill 3 (slug `monsterbingo`, kode-navn `game_3`) er et live hovedspill med en helt egen arkitektur som verken matcher Spill 1 (per-hall lobby + GoH-master) eller Spill 2 (perpetual rocket). Spill 3 har en **sequential phase-state-machine** (Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus) som er unik i pilot-skopet.

Pilot-mandatet i [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) krever at Spill 3 holder Evolution Gaming-grade oppetid (99.95 %+) innenfor åpningstid. Tobias' direktiv 2026-05-08:

> "Det er ekstremt viktig at fundamentet her er godt dokumentert slik at fremtidige PM/agenter har full forståelse og ikke fraviker fra planen."

Dette dokumentet er konsolidering av alt som eksisterer per 2026-05-08 — databasenivå, services, runtime-flyt, klient og admin-UI — slik at neste agent kan fortsette uten å re-discovere arkitekturen.

---

## 1. KRITISK: Forskjeller fra Spill 1 OG Spill 2 (les FØRST)

> **🚨 Den kanoniske cross-spill-sammenligningen ligger i [`SPILL_ARCHITECTURE_OVERVIEW.md`](./SPILL_ARCHITECTURE_OVERVIEW.md).** Tabellen under er Spill 3-perspektiv (med alle 3 spill kolonner). For konsoliderte regler om bridge-pattern, phase-state-machine og anti-mønstre på tvers av spillene — bruk SPILL_ARCHITECTURE_OVERVIEW.

Spill 3 er **verken** en variant av Spill 1 eller Spill 2. Hvis du tar med deg antakelser fra Spill 1-doku (per-hall lobby, master-styrt) eller Spill 2-doku (auto-tick perpetual loop, jackpot-mapping), vil de feile på Spill 3. Tabellen under er forskjells-oversikten alle MÅ lese:

| Aspekt | Spill 1 (`bingo`) | Spill 2 (`rocket`) | **Spill 3 (`monsterbingo`)** |
|---|---|---|---|
| Grid | 5×5 m/fri sentercelle | 3×3 full plate | **5×5 UTEN fri sentercelle** |
| Ball-range | 1-75 | 1-21 | **1-75** |
| Maks draws/runde | 75 | 21 | **75** |
| Rom-modell | Per-hall lobby + GoH-master | ETT globalt rom | **ETT globalt rom** |
| Master-rolle | Master-hall styrer | Ingen master | **Ingen master** |
| Spilleplan | Plan-runtime + scheduled-games | Perpetual loop | **Perpetual loop** (auto-spawn) |
| Trekning | Master-trigger + plan-tick | Auto-tick global | **Auto-tick global + phase-state-machine** |
| Vinning | Rad 1-4 + Fullt Hus (parallelt) | Kun Fullt Hus (9/9) | **Sequential phases: Rad 1 → Rad 2 → ... → Fullt Hus** |
| Pause mellom faser | Master pauser bevisst | N/A (én fase) | **`pauseBetweenRowsMs` (default 3000ms) — automatisk** |
| Sub-games / katalog | 13 katalog-varianter | Kun rocket | **Kun monsterbingo (singleton-config)** |
| Bongtype | 3 farger (5/10/15 kr) | ÉN type (10 kr default) | **ÉN type ("Standard", default 5 kr)** |
| Premie-modus | Auto-multiplikator | Jackpot-mapping per draw-count | **`fixed` ELLER `percentage` av runde-omsetning** |
| Bonus-spill | 4 mini-spill (Wheel/Chest/Mystery/ColorDraft) | Lucky number bonus | **Ingen bonus** |
| Auto-start | Plan + master-trigger | `minTicketsToStart` | **`minTicketsToStart`** |
| Åpningstid | `plan.startTime`/`endTime` | Config-vindu valgfritt | **`openingTimeStart`/`End` påkrevd (default 11:00-23:00)** |
| Salgskanaler | Online + fysiske bonger + agent-terminal | Online + agent-terminal | **Online ONLY** (Tobias-direktiv) |
| Master-hall valg | GoH har `master_hall_id` | N/A | **N/A — ingen master** |
| Compliance gameType | `MAIN_GAME` | `MAIN_GAME` | **`MAIN_GAME`** (15% til organisasjoner) |

### 1.1 Tobias-revert 2026-05-03 (PR #860)

**KRITISK historisk kontekst.** Spill 3 ble kortvarig portet til 3×3 / 1..21-form ("samme som Spill 2 med flere mønstre") i PR #860, men Tobias revertet dette 2026-05-03:

> "75 baller og 5x5 bonger uten free i midten. Alt av design skal være likt [Spill 1] bare at her er det kun 1 type bonger og man spiller om mønstre. Logikken med å trekke baller og markere bonger er fortsatt helt lik."

Eldre dokumenter ([SPILLKATALOG.md](./SPILLKATALOG.md), [game3-canonical-spec.md](../engineering/game3-canonical-spec.md)) kan referere til T/X/7/Pyramide-pattern-bingo (4 design-mønstre à 25%) eller 3×3-form. **Disse er foreldede.** Spill 3 i pilot-fasen er:

- 5×5 grid, 75 baller, ÉN ticket-type
- Sequential rad-faser: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus (KUN — ikke T/X/7/Pyramide)
- Premie via `Spill3Config` (admin-konfigurert globalt)

> **Hvis du finner kode eller doc som motsier dette, doc-en vinner og koden må fikses** (jf. konflikt-regel i SPILL_REGLER_OG_PAYOUT.md).

### 1.2 Hvorfor phase-state-machine er unikt

Spill 1 har Rad 1-4 + Fullt Hus, men evaluerer dem **parallelt** i hver trekning (cycler-pattern eller rad-eval-pathen). Master tar bevisst pause mellom rader hvis ønskelig.

Spill 3 evaluerer fasene **sekvensielt med automatisk pause**:
1. Rad 1 aktiv → trekk baller → vinner identifisert + utbetalt
2. Engine pauser i `pauseBetweenRowsMs` (default 3000ms) — **ingen** trekk skjer
3. Rad 2 aktiv → trekk fortsetter med samme draw-bag → vinner identifisert
4. ... (3s pause) → Rad 3 → ... → Rad 4 → ... → Fullt Hus
5. Fullt Hus vunnet ELLER 75 baller trukket uten Fullt Hus → runde slutt

Dette er implementert i `Game3PhaseStateMachine.ts` og wired inn i `Game3Engine.ts` via R10-PR (`feat/r10-spill3-engine-wireup`, ennå ikke merget per 2026-05-08).

---

## 2. Arkitektur — hvor alt henger sammen

### 2.1 Tre-lags-modell

```
┌────────────────────────────────────────────────────────────┐
│  KLIENT-LAG                                                │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Player-shell    │  │ Admin-konsoll│  │ TV-skjerm    │  │
│  │ /web/?webClient │  │ Spill3Config │  │ /tv/<id>/<t> │  │
│  │  =game_3        │  │ -side        │  │ (delt UI)    │  │
│  └─────────────────┘  └──────────────┘  └──────────────┘  │
│           │                  │                  │         │
└───────────┼──────────────────┼──────────────────┼─────────┘
            │                  │                  │
            ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────┐
│  BACKEND-LAG (Node.js + Express + Socket.IO på port 4000)  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Singleton-konfig-flyt:                               │  │
│  │  GET/PUT /api/admin/spill3/config                     │  │
│  │    → Spill3ConfigService (read-through cache 5s)      │  │
│  │      → app_spill3_config (partial unique idx active)  │  │
│  │                                                       │  │
│  │  Runtime-bridge:                                      │  │
│  │  roomState.bindVariantConfigForRoom(...)              │  │
│  │    → fetchSpill3Config()                              │  │
│  │      → buildVariantConfigFromSpill3Config(config)     │  │
│  │        → GameVariantConfig {                          │  │
│  │            ticketTypes: [{name:"Standard"}]           │  │
│  │            patterns: 5 (Rad 1-4 + Fullt Hus)          │  │
│  │            autoClaimPhaseMode: true   ◄── R10-trigger │  │
│  │            minTicketsBeforeCountdown: ...             │  │
│  │            roundPauseMs: pauseBetweenRowsMs           │  │
│  │          }                                            │  │
│  │                                                       │  │
│  │  Engine-flyt (R10):                                   │  │
│  │  Game3Engine ⊂ Game2Engine ⊂ BingoEngine              │  │
│  │    → onDrawCompleted (med phase-state-machine)        │  │
│  │      → effectiveStep filter (kun aktiv fase)          │  │
│  │      → processG3Winners → wallet payout               │  │
│  │      → advancePhaseStateAfterWinners                  │  │
│  │        → state.pausedUntilMs = now + 3000ms           │  │
│  │                                                       │  │
│  │  Auto-tick:                                           │  │
│  │  Game3AutoDrawTickService                             │  │
│  │    → drawNext for hvert running monsterbingo-rom      │  │
│  │      (75 baller maks per runde)                       │  │
│  │                                                       │  │
│  │  Perpetual-loop:                                      │  │
│  │  PerpetualRoundService.handleGameEnded                │  │
│  │    → canSpawnRound (sjekker openingTimeStart/End)     │  │
│  │    → schedule ny runde etter delayMs                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────┐
│  STATE-LAG                                                  │
│  ┌─────────────────┐  ┌──────────────────────────────────┐ │
│  │  Postgres 16    │  │  Redis 7                          │ │
│  │  app_spill3_*   │  │  room state, sessions,            │ │
│  │  app_room_states│  │  rate-limits                      │ │
│  │  (spill3PhaseSt)│  │  (recovery-snapshot per restart)  │ │
│  └─────────────────┘  └──────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 2.2 ETT globalt rom — singleton-konstrukten

Spill 3 har **ÉN aktiv konfigurasjon globalt** og **ÉTT globalt rom som alle haller deler**. Dette er strukturelt forskjellig fra Spill 1 (per-hall lobby).

**Singleton-konstrukten i database:**

```sql
-- apps/backend/migrations/20261211000000_app_spill3_config.sql:62-64
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill3_config_singleton_active
  ON app_spill3_config((active))
  WHERE active = TRUE;
```

Partial unique index på `WHERE active = TRUE` håndhever at **maks ÉN rad** kan ha `active=TRUE` til enhver tid. Hvis admin prøver å aktivere en andre rad, vil DB avvise med unique-violation.

**Singleton-håndtering i service:**

`Spill3ConfigService.getActive()` (apps/backend/src/game/Spill3ConfigService.ts:434-449) henter alltid den ene aktive raden via `WHERE active = TRUE LIMIT 1`. Read-through cache med 5s TTL betyr at admin-endringer slår inn ved neste cache-miss (ikke instantly). Cache invalideres av `update()`-metoden.

**Hvis ingen aktiv rad finnes:** Service kaster `DomainError("CONFIG_MISSING")` (linje 441-444). Migration seeder default-rad så dette skal aldri skje i prod, untatt at admin har feilaktig deaktivert alle rader.

### 2.3 Perpetual loop og auto-spawn-trigger

Spill 3 har INGEN spilleplan-runtime og INGEN master-trigger. Runde-flyten er:

1. **Bootstrapping ved server-start:** Stale-room-boot-sweep (`StaleRoomBootSweepService`) sjekker om `MONSTERBINGO`-rom finnes; hvis ikke opprettes det. `PerpetualRoundService.spawnFirstRoundIfNeeded()` startes hvis rommet er WAITING og threshold-betingelser er møtt.

2. **Bonge-salg:** Spillere kobler til via socket og kjøper bonger. PerpetualRoundService overvåker `ticketsSold` i WAITING-state.

3. **Auto-start på threshold:** Når `ticketsSold ≥ minTicketsToStart` (admin-konfigurert, default 20), starter runden. Helper i state-machinen:

```typescript
// apps/backend/src/game/Game3PhaseStateMachine.ts:382-389
export function shouldAutoStartRound(input: AutoStartInput): boolean {
  if (input.roomStatus !== "WAITING") return false;
  if (input.minTicketsToStart <= 0) {
    return input.ticketsSold > 0;
  }
  return input.ticketsSold >= input.minTicketsToStart;
}
```

4. **Trekninger:** `Game3AutoDrawTickService` tikker drawNext hvert `ballIntervalMs`. Engine pauser ved fase-overgang.

5. **Round-end:** Fullt Hus vunnet ELLER 75 baller trukket → `endedReason="G3_FULL_HOUSE"` (eller `DRAW_BAG_EMPTY`). PerpetualRoundService schedulerer ny runde etter `PERPETUAL_LOOP_DELAY_MS` (default 5s, prod 30s).

6. **Åpningstid-guard:** Før hver spawn sjekker `canSpawnRound` om current Oslo-tid er innenfor `[openingTimeStart, openingTimeEnd)`. Hvis utenfor → ingen ny runde inntil vinduet åpner igjen.

**Idempotens:** Pending restarts er nøkket på `roomCode + gameId` for å forhindre duplikat-spawn ved gjentatte `onGameEnded`-fires.

### 2.4 Phase-state-machine (sequential rad-overgang)

Dette er Spill 3-spesifikk arkitektur. Se §4 for detaljert implementasjon.

```
                  ┌────────────────────────────────────┐
                  │  Round start (autoClaimPhaseMode)  │
                  │  game.spill3PhaseState lazy-init   │
                  │  currentPhaseIndex = 0 (Rad 1)     │
                  └─────────────────┬──────────────────┘
                                    │
                                    ▼
                       ┌────────────────────────┐
            ┌──────────│   Rad 1 aktiv          │
            │          │   (cycler filtered)    │
            │          └────────┬───────────────┘
            │                   │ vinner identifisert
            │                   ▼
            │       ┌──────────────────────────┐
            │       │ pause 3000ms             │
            │       │ pausedUntilMs = now+3000 │
            │       │ shouldDrawNext: SKIP     │
            │       └────────┬─────────────────┘
            │                │ pause expires
            │                ▼
       (Rad 2-4 samme mønster — skipped for korthet)
                             │
                             ▼
                  ┌──────────────────────────┐
                  │   Fullt Hus (idx=4)      │
                  └────────┬─────────────────┘
                           │
            ┌──────────────┴────────────────┐
            ▼                               ▼
    [Fullt Hus vunnet]              [DRAW_BAG_EMPTY]
    status = ENDED                   status = ENDED
    endedReason=FULL_HOUSE            endedReason=DRAW_BAG_EMPTY
                           │
                           ▼
                  PerpetualRoundService.handleGameEnded
                  → ny runde etter delay (innen åpningstid)
```

### 2.5 Wallet-touch og compliance-ledger

Spill 3 utbetaler via samme casino-grade wallet-stack som Spill 1/2 (BIN-761→764):
- Outbox-pattern for atomic kreditt
- REPEATABLE READ-isolation
- Hash-chain audit-events

**Compliance-ledger gameType:** `MAIN_GAME` (resolved av `ledgerGameTypeForSlug("monsterbingo")` i `apps/backend/src/game/ledgerGameTypeForSlug.ts`). Dette betyr §11-distribusjon **15% til organisasjoner** (samme som Spill 1/2 — Spill 3 er IKKE databingo).

**Cap-håndhevelse:** `applySinglePrizeCap` med `gameType: ledgerGameTypeForSlug(room.gameSlug)` (Game3Engine.ts:1137). Spill 3 = `MAIN_GAME` = ingen 2500 kr-cap (cap er kun for `DATABINGO`).

---

## 3. Spill-mekanikk

### 3.1 Grid 5×5 UTEN fri sentercelle (forskjell fra Spill 1!)

Bonger er 5×5 grid med **alle 25 cellene som reelle tall** (1-75). Spill 1 har fri sentercelle (auto-marked). Spill 3 har det IKKE — alle 25 må markeres for Fullt Hus.

Implementert via `uses5x5NoCenterTicket(slug)` i `apps/backend/src/game/ticket.ts`. Bekrefter at slug er `monsterbingo`/`mønsterbingo`/`game_3` og bygger ticket-grid uten fri-celle.

### 3.2 75 baller (samme range som Spill 1)

Ball-range 1-75. `Game3AutoDrawTickService.GAME3_MAX_BALLS = 75`. Når `drawnNumbers.length >= 75` skal ingen flere trekk skje — engine markerer phase-state som `markDrawBagEmpty` hvis runden ikke er ferdig.

### 3.3 Sequential phases: Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus

Spill 3-spesifikt. Hver fase får eksklusivt kjøretid — ingen parallel evaluation som Spill 1's cycler-pathen.

**Pattern-navn:** Hvilken streng som brukes avhenger av context:
- **Bridge-form** (fra `Spill3GlobalRoomService.SPILL3_PHASE_NAMES`): `"1 Rad"`, `"2 Rader"`, `"3 Rader"`, `"4 Rader"`, `"Fullt Hus"`
- **State-machine-form** (fra `Game3PhaseStateMachine.GAME3_PHASE_NAMES`): `"Rad 1"`, `"Rad 2"`, `"Rad 3"`, `"Rad 4"`, `"Fullt Hus"`

`phasePatternIndexFromName` (Game3Engine.ts:1518) aksepterer begge varianter for å unngå brudd ved navngivnings-skifte.

**Phase-index 0..4:**

| Index | Phase-navn | Claim-type | Mask-design |
|---|---|---|---|
| 0 | Rad 1 / 1 Rad | `LINE` | design=1 |
| 1 | Rad 2 / 2 Rader | `LINE` | design=2 |
| 2 | Rad 3 / 3 Rader | `LINE` | design=3 |
| 3 | Rad 4 / 4 Rader | `LINE` | design=4 |
| 4 | Fullt Hus / Coverall | `BINGO` | design=0 (full grid) |

### 3.4 Pause mellom faser (`pauseBetweenRowsMs`)

Etter en fase er vunnet og utbetalt, scheduler engine pause før neste fase aktiveres:

```typescript
// apps/backend/src/game/Game3PhaseStateMachine.ts:301-310
} else {
  // Ikke-terminal fase: scheduler pause før neste fase.
  const nextPhaseIdx = (wonPhaseIdx + 1) as Game3PhaseIndex;
  newState = {
    currentPhaseIndex: nextPhaseIdx,
    pausedUntilMs: now + pauseBetweenRowsMs,
    phasesWon: [...state.phasesWon, wonPhaseIdx],
    status: "ACTIVE",
    endedReason: null,
  };
}
```

**Default 3000ms** (admin-konfigurerbar 0-60000ms via `pauseBetweenRowsMs`-felt i config).

`shouldDrawNext` (Game3PhaseStateMachine.ts:334-345) sjekker mot `pausedUntilMs` og returnerer `{ skip: true, reason: "PAUSED" }` mens pause-vinduet er åpent. Engine skipper hele `processG3Winners`-stegen i pause.

### 3.5 Premie-modus: fixed eller percentage

Admin velger **én av to modi globalt** i `Spill3Config.prizeMode`:

**`fixed`-modus:**
- Faste kr-beløp i øre per fase (`prizeRad1Cents`, `prizeRad2Cents`, ..., `prizeFullHouseCents`)
- Uavhengig av antall solgte bonger
- Krever at ALLE 5 cents-felter er satt (`assertConfigConsistency` validerer)

**`percentage`-modus:**
- Prosent av runde-omsetning (`prizeRad1Pct`, ..., `prizeFullHousePct`)
- Premie = `(pct / 100) × totalSoldCents`
- Sum av prosenter må være **≤ 100%** (validering i `assertConfigConsistency`)
- Krever at ALLE 5 pct-felter er satt

**Default seed (migration):**

| Fase | Pct |
|---|---|
| Rad 1 | 5% |
| Rad 2 | 8% |
| Rad 3 | 12% |
| Rad 4 | 15% |
| Fullt Hus | 30% |
| **Sum** | **70%** (resten 30% = hus + §11) |

Service-laget validerer prize-mode-konsistens **etter merge** av partial update — dvs admin kan sende kun delta-felter, og service fyller inn resten fra eksisterende rad før validering kjører.

### 3.6 Bongpris (default 5 kr — online-only)

Spill 3 har **KUN ÉN ticket-type "Standard"** med admin-konfigurerbar pris (`ticketPriceCents`, default 500 = 5 kr).

Per Tobias-direktiv 2026-05-08:
- Online-only — ingen fysiske bonger via agent
- Flat 5 kr (kan justeres globalt av admin)
- Ingen fargevarianter (Spill 1 har 3, Spill 3 har 1)

Fordi det kun er én bong-type, blir **multi-vinner pot-deling alltid flat** (ingen bong-vekting som Spill 1's pot-per-bongstørrelse). Pot deles likt på alle vinnere i samme fase med floor-rounding; rest til HOUSE_RETAINED.

### 3.7 Auto-start-betingelse (`minTicketsToStart`)

`Spill3Config.minTicketsToStart` (default 20). Når threshold nås i WAITING-state starter runden umiddelbart. `0` betyr "umiddelbar start så snart minst én ticket er solgt". Maks-grense 1000 (sikkerhetsmargin via DB-CHECK).

Endres av admin uten kode-deploy. Globalt for hele spillet (IKKE per-hall — alle haller deltar i samme rom).

### 3.8 Åpningstid Europe/Oslo HH:MM

`openingTimeStart`/`openingTimeEnd` (HH:MM 24t-format, default 11:00/23:00). Validert via:
- Format: regex `^([01]\d|2[0-3]):([0-5]\d)$`
- Konsistens: `start < end` (samme dag, ingen midnatt-wrap)

`isWithinOpeningWindow(config)` (apps/backend/src/game/Spill3ConfigService.ts:288-309) bruker `Intl.DateTimeFormat` med `timeZone: "Europe/Oslo"` for korrekt lokal-tid uavhengig av server-zone (Render kjører UTC).

**Wire-effect:** PerpetualRoundService kaller `canSpawnRound` før hver spawn. Logikken bor i `apps/backend/src/game/PerpetualRoundOpeningWindowGuard.ts` (BIN-823 refactor, 2026-05-08) som factory-bygger callbacken fra `Spill2ConfigService` + `Spill3ConfigService`. For `monsterbingo`/`mønsterbingo`/`game_3`-slugs:
- Hvis innenfor vindu → spawn ny runde
- Hvis utenfor vindu → skip spawn (loop fortsetter, men ingen ny runde til vinduet åpner)
- Ved feil/exception → fail-open (spawn tillates)

Samme guard dekker også Spill 2 (`rocket`/`game_2`/`tallspill`) — se [SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md §3.8](./SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md). Begge spill bruker samme factory-mønster slik at refaktor på en av dem ikke kan miste guard-en på den andre.

---

## 4. Phase-state-machine — kritisk implementasjons-detalj

Dette er det mest komplekse i Spill 3. R10-PR-en wirer state-machinen inn i engine. Per 2026-05-08 er PR pushed på `feat/r10-spill3-engine-wireup` (commit `8d755781`) men **ennå ikke merget**.

### 4.1 `Game3PhaseStateMachine`: states og transitions

**Tilstands-shape** (Game3PhaseStateMachine.ts:74-97):

```typescript
export interface Game3PhaseState {
  currentPhaseIndex: Game3PhaseIndex;     // 0..4
  pausedUntilMs: number | null;            // wall-clock ms; null = ikke pause
  phasesWon: Game3PhaseIndex[];            // append-only audit-trail
  status: "ACTIVE" | "ENDED";
  endedReason: "FULL_HOUSE" | "DRAW_BAG_EMPTY" | null;
}
```

Tilstanden er **ren JSON og serialiserbar** slik at den kan persisteres i `app_room_states.current_game.spill3PhaseState` og restoreres ved server-restart.

**Initial state:**
```typescript
createInitialPhaseState(): Game3PhaseState {
  return {
    currentPhaseIndex: 0,
    pausedUntilMs: null,
    phasesWon: [],
    status: "ACTIVE",
    endedReason: null,
  };
}
```

### 4.2 `autoClaimPhaseMode`-flag (kun monsterbingo)

`Spill3GlobalRoomService.buildVariantConfigFromSpill3Config()` setter `autoClaimPhaseMode: true` (apps/backend/src/game/Spill3GlobalRoomService.ts:151) når den bygger `GameVariantConfig`.

Dette flagget er signal til engine om at runden skal kjøre **phase-locked sequential evaluation** istedenfor parallel cycler-evaluation.

`Game3Engine.isPhaseModeActive(variantConfig)` (Game3Engine.ts:387-389):

```typescript
private isPhaseModeActive(variantConfig: GameVariantConfig | undefined): boolean {
  return variantConfig?.autoClaimPhaseMode === true;
}
```

Legacy `DEFAULT_GAME3_CONFIG` (4 design-mønstre uten phase-mode) setter IKKE flagget, så eksisterende runder bypasser phase-state-machine og kjører gammel parallel evaluation.

### 4.3 `onDrawCompleted`-integrasjon i Game3Engine

R10-wireup i Game3Engine.ts:212-294. Sekvens per draw når phase-mode er aktiv:

```typescript
async onDrawCompleted(ctx) {
  await super.onDrawCompleted(ctx);
  if (!this.isGame3Round(room, variantConfig)) return;

  // 1. Auto-mark celler synkronisert (samme som ikke-phase-mode)
  autoMarkPlayerCells(game, lastBall);

  // 2. Phase-mode init lazy
  const phaseModeActive = this.isPhaseModeActive(variantConfig);
  if (phaseModeActive && game.spill3PhaseState === undefined) {
    game.spill3PhaseState = createInitialPhaseState();
  }

  // 3. Pause-vakt: skip processG3Winners hvis i pause-vindu
  let phasePaused = false;
  if (phaseModeActive && phaseState) {
    const drawDecision = shouldDrawNext(phaseState, Date.now());
    if (drawDecision.skip && drawDecision.reason === "PAUSED") {
      phasePaused = true;
    }
  }

  // 4. Bygg cycler-step (alle aktive patterns)
  const cycler = this.getOrCreateCycler(room, game);
  const step = cycler.step(drawIndex);

  // 5. Filter cycler til KUN aktiv fase
  let effectiveStep = step;
  if (phaseModeActive && phaseState && !phasePaused) {
    const activeIdx = phaseState.currentPhaseIndex;
    const filtered = step.activePatterns.filter(
      p => phasePatternIndexFromSpec(p) === activeIdx
    );
    effectiveStep = { activePatterns: filtered, ... };
  }

  // 6. Kjør winner-deteksjon på effective step
  const winnerRecords = phasePaused
    ? []
    : await this.processG3Winners({ room, game, ..., step: effectiveStep, ... });

  // 7. Etter winners → advance state-machinen
  if (phaseModeActive && phaseState && winnerRecords.length > 0) {
    this.advancePhaseStateAfterWinners(game, winnerRecords, variantConfig);
  }

  // 8. Round-end-deteksjon (status === "ENDED")
  const phaseEnded = phaseModeActive
    && phaseState !== undefined
    && game.spill3PhaseState?.status === "ENDED";
  const roundOver = explicitFullHouseWon || allPatternsWon || phaseEnded;

  // 9. DRAW_BAG_EMPTY-håndtering
  if (phaseModeActive && phaseState && game.drawnNumbers.length >= 75
      && game.spill3PhaseState?.status === "ACTIVE") {
    game.spill3PhaseState = markDrawBagEmpty(game.spill3PhaseState);
  }
}
```

### 4.4 `effectiveStep`-filter under aktiv fase

**Hvorfor:** `Spill3GlobalRoomService` setter alle 5 patterns med `ballThreshold=75`, dvs `PatternCycler.step()` ville frigi ALLE 5 som aktive samtidig. Uten filteret ville alle radene kunne vinnes parallelt på samme draw — bryter sequential-spec'en.

**Hvordan:** `effectiveStep.activePatterns` filtreres til kun pattern som matcher `phaseState.currentPhaseIndex` via `phasePatternIndexFromSpec`. Andre patterns vil aldri matche fordi cycler ikke gir dem til winner-pathen.

### 4.5 `advancePhaseStateAfterWinners` scheduler 3s pause

R10-implementasjon (Game3Engine.ts:401-468):

```typescript
private advancePhaseStateAfterWinners(
  game: GameState,
  winnerRecords: G3WinnerRecord[],
  variantConfig: GameVariantConfig | undefined,
): void {
  const state = game.spill3PhaseState;
  if (!state || state.status === "ENDED") return;

  // Map winner-records til phase-indices
  const wonIndices = new Set<number>();
  for (const record of winnerRecords) {
    if (record.ticketWinners.length === 0) continue;
    const idx = phasePatternIndexFromName(record.patternName);
    if (idx !== null) wonIndices.add(idx);
  }

  if (wonIndices.size === 0) return;

  // Pause-millis fra config (default 3s)
  const pauseMs = variantConfig?.roundPauseMs ?? 3000;

  // Advance state for each won phase (sorted)
  const sortedIdx = [...wonIndices].sort((a, b) => a - b);
  let mutated = state;
  const now = Date.now();

  for (const idx of sortedIdx) {
    if (mutated.status === "ENDED") break;
    if (idx !== mutated.currentPhaseIndex) continue;  // out-of-order safety

    const isFullHouse = idx === 4;
    const phaseIdx = idx as Game3PhaseIndex;

    mutated = isFullHouse
      ? {
          // Terminal: ENDED, ingen pause
          currentPhaseIndex: phaseIdx,
          pausedUntilMs: null,
          phasesWon: [...mutated.phasesWon, phaseIdx],
          status: "ENDED",
          endedReason: "FULL_HOUSE",
        }
      : {
          // Ikke-terminal: scheduler pause + advance
          currentPhaseIndex: ((idx + 1) as Game3PhaseIndex),
          pausedUntilMs: now + pauseMs,
          phasesWon: [...mutated.phasesWon, phaseIdx],
          status: "ACTIVE",
          endedReason: null,
        };
  }
  game.spill3PhaseState = mutated;
}
```

### 4.6 Round-end på Fullt Hus eller `DRAW_BAG_EMPTY`

To exit-grunner:

1. **Fullt Hus vunnet** (idx=4): `advancePhaseStateAfterWinners` setter `status="ENDED"`, `endedReason="FULL_HOUSE"`. Engine setter `game.endedReason="G3_FULL_HOUSE"` for legacy-paritet med PerpetualRoundService som anser dette som "naturlig runde-end".

2. **75 baller trukket uten Fullt Hus**: `markDrawBagEmpty(state)` (Game3PhaseStateMachine.ts:352-360):
```typescript
export function markDrawBagEmpty(state: Game3PhaseState): Game3PhaseState {
  if (state.status === "ENDED") return state;
  return {
    ...state,
    status: "ENDED",
    endedReason: "DRAW_BAG_EMPTY",
    pausedUntilMs: null,
  };
}
```

PerpetualRoundService.NATURAL_END_REASONS inkluderer `G3_FULL_HOUSE`, `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY` — alle trigger auto-restart.

### 4.7 Pattern → fase-mapping (bridge-form vs state-machine-form)

R10-PR introduserer `phasePatternIndexFromName` (Game3Engine.ts:1518-1538) som aksepterer **begge** navngivnings-konvensjonene:

```typescript
function phasePatternIndexFromName(name: string | undefined): 0|1|2|3|4|null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  // Bridge-form (Spill3GlobalRoomService): "1 Rad", "2 Rader", ...
  if (normalized === "1 rad") return 0;
  if (normalized === "2 rader") return 1;
  if (normalized === "3 rader") return 2;
  if (normalized === "4 rader") return 3;
  // State-machine-form (Game3PhaseStateMachine): "Rad 1", "Rad 2", ...
  if (normalized === "rad 1") return 0;
  if (normalized === "rad 2") return 1;
  if (normalized === "rad 3") return 2;
  if (normalized === "rad 4") return 3;
  // Fullt Hus / Coverall / Full House (case-insensitive)
  if (normalized === "fullt hus" || normalized === "coverall" || normalized === "full house") {
    return 4;
  }
  return null;
}
```

**Hvorfor liberal:** Bridge bruker `"1 Rad"` (Spill3GlobalRoomService.SPILL3_PHASE_NAMES) men state-machinen bruker `"Rad 1"` (Game3PhaseStateMachine.GAME3_PHASE_NAMES). Begge bør virke uten brudd.

### 4.8 Checkpoint-serialization og recovery (R10 chaos-test)

**Persistens:** Phase-state lagres som JSON i `app_room_states.current_game.spill3PhaseState`. `BingoEngine.serializeGame` (BingoEngine.ts:4569-4579) deep-cloner phase-state inn i recovery-snapshot:

```typescript
spill3PhaseState: game.spill3PhaseState
  ? {
      currentPhaseIndex: game.spill3PhaseState.currentPhaseIndex,
      pausedUntilMs: game.spill3PhaseState.pausedUntilMs,
      phasesWon: [...game.spill3PhaseState.phasesWon],  // array clone
      status: game.spill3PhaseState.status,
      endedReason: game.spill3PhaseState.endedReason,
    }
  : undefined,
```

`BingoEngineRecovery.restoreRoomFromSnapshot` (BingoEngineRecovery.ts:301-311) hydrerer phase-state ved server-restart med tilsvarende deep-clone. Pause-vinduer overlever fordi `pausedUntilMs` er wall-clock (Date.now()) — ny instans sjekker mot samme klokke.

**Chaos-test (R10):** `infra/chaos-tests/r10-spill3-chaos-test.sh` (R10-PR) kjører:
1. Spinner opp 2 backend-instanser via docker-compose.chaos.yml
2. Trigger Spill 3-runde og venter på fase-overgang
3. SIGKILL backend-1 midt i fase (scenarier: pause-window | row-2-mid | full-house)
4. Snapshot pre-kill (phase-state + ledger + pot fra Postgres)
5. Verifiser at backend-2 plukker opp via `/health`
6. Snapshot post-recovery
7. Kjør `r10Spill3Invariants.test.ts`-invariants

**Invariants** (apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts, R10-PR):

| ID | Invariant | Strukturelt? |
|---|---|---|
| I1 | `currentPhaseIndex` advancer aldri bakover (monotont) | Ja |
| I2 | `phasesWon` er append-only (superset etter recovery) | Ja |
| I3 | `prize_pool_remaining` minker monotont (ingen wallet-rollback) | Ja |
| I4 | Compliance-ledger §71 append-only (count + sum øker) | Ja |
| I5 | `phasesWon.length ≤ 5` og `currentPhaseIndex ∈ [0, 4]` (ingen dobbelt-trigging) | Ja |
| I6 | Pause-vindu konsistens (`pausedUntilMs` krymper ikke vesentlig) | Nei (advisory) |

---

## 5. Backend-services-kart (med fil-paths)

| Service | Fil:linje | Ansvar |
|---|---|---|
| `Spill3ConfigService` | `apps/backend/src/game/Spill3ConfigService.ts` (717 linjer) | Singleton CRUD + read-through cache (5s TTL) + audit-log + validering |
| `Spill3GlobalRoomService` | `apps/backend/src/game/Spill3GlobalRoomService.ts` (225 linjer) | Bridge: `Spill3Config` → `GameVariantConfig`. Setter `autoClaimPhaseMode=true` |
| `Game3PhaseStateMachine` | `apps/backend/src/game/Game3PhaseStateMachine.ts` (389 linjer) | Pure state-machine: phase-overgang, pause-tracking, winner-deteksjon |
| `Game3Engine` | `apps/backend/src/game/Game3Engine.ts` (1358 linjer, +230 i R10) | Engine-runtime: `onDrawCompleted` med phase-state-wireup, payout-flyt |
| `Game3AutoDrawTickService` | `apps/backend/src/game/Game3AutoDrawTickService.ts` (433 linjer) | Cron-driven `drawNext` for running monsterbingo-rom |
| `PerpetualRoundService` | `apps/backend/src/game/PerpetualRoundService.ts` (1183 linjer, delt med Spill 2) | Auto-restart etter `onGameEnded` for `monsterbingo` + `rocket` |
| `roomState.bindVariantConfigForRoom` | `apps/backend/src/util/roomState.ts:597-650` | Hook-flyt: fetcher Spill3Config og mapper til variant via Spill3GlobalRoomService |
| Routes: `/api/admin/spill3/config` | `apps/backend/src/routes/adminSpill3Config.ts` (193 linjer) | GET (READ) + PUT (WRITE) for konfig |
| Routes: `/api/games/spill3/health` | `apps/backend/src/routes/publicGameHealth.ts:565-610` | Public R7 helse-endpoint |
| Index-wireup | `apps/backend/src/index.ts:1163, 2789-2796 (canSpawnRound via PerpetualRoundOpeningWindowGuard factory), 2948, 3652, 4006, 4606` | Service-init, canSpawnRound-hook, route-registration, fetcher-hooks |

### 5.1 Migrasjoner

| Migration | Fil | Innhold |
|---|---|---|
| 20261211000000 | `apps/backend/migrations/20261211000000_app_spill3_config.sql` | Opprett `app_spill3_config` + partial unique index + seed default |
| 20261212000000 | `apps/backend/migrations/20261212000000_app_spill3_config_opening_times.sql` | ADD COLUMN `opening_time_start`, `opening_time_end` + backfill 11:00/23:00 |

### 5.2 Test-suite

| Test-fil | Linjer | Dekker |
|---|---|---|
| `apps/backend/src/game/Game3PhaseStateMachine.test.ts` | 389 | Pure state-machine: phase-overganger, pause, winner-finding, edge-cases |
| `apps/backend/src/game/Spill3GlobalRoomService.test.ts` | 230 | Bridge: fixed/percentage-mapping, prize-mode-switch, autoClaimPhaseMode |
| `apps/backend/src/game/Spill3ConfigService.test.ts` | 690 | CRUD, validering, audit-log, cache, opening-window |
| `apps/backend/src/game/Game3Engine.test.ts` | 893 | Engine-flyt: pattern-eval, payout, mass-payout-batched, race-detection |
| `apps/backend/src/game/Game3Engine.inheritance.test.ts` | (1) | Inheritance Game3⊂Game2⊂BingoEngine |
| `apps/backend/src/game/Game3AutoDrawTickService.test.ts` | 546 | Tick-service: slug-filter, max-balls, throttle |
| `apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts` | 315 (R10-PR) | I1-I6 invariants for chaos-test |
| `apps/admin-web/tests/spill3ConfigPage.test.ts` | (1) | Admin-UI form-validering |
| `apps/backend/src/util/roomState.bindSpill3Config.test.ts` | (1) | Bind-hook: fetchSpill3Config + fallback |

Per R10-PR commit-melding: **alle 107 Spill 3-relaterte tester passerer**.

---

## 6. Database-skjema

### 6.1 `app_spill3_config` (singleton, partial unique index)

Migrert i `20261211000000_app_spill3_config.sql`:

| Kolonne | Type | Default | Notat |
|---|---|---|---|
| `id` | TEXT PK | (none, eks `spill3-default`) | — |
| `min_tickets_to_start` | INTEGER NOT NULL | 20 | 0-1000 (DB-CHECK) |
| `prize_mode` | TEXT NOT NULL CHECK | (none) | `'fixed'` eller `'percentage'` |
| `prize_rad1_cents` | INTEGER NULL CHECK ≥0 | NULL | Brukt i fixed-modus |
| `prize_rad2_cents` | INTEGER NULL CHECK ≥0 | NULL | Brukt i fixed-modus |
| `prize_rad3_cents` | INTEGER NULL CHECK ≥0 | NULL | Brukt i fixed-modus |
| `prize_rad4_cents` | INTEGER NULL CHECK ≥0 | NULL | Brukt i fixed-modus |
| `prize_full_house_cents` | INTEGER NULL CHECK ≥0 | NULL | Brukt i fixed-modus |
| `prize_rad1_pct` | NUMERIC(5,2) NULL CHECK 0-100 | 5.00 | Brukt i percentage-modus |
| `prize_rad2_pct` | NUMERIC(5,2) NULL CHECK 0-100 | 8.00 | Brukt i percentage-modus |
| `prize_rad3_pct` | NUMERIC(5,2) NULL CHECK 0-100 | 12.00 | Brukt i percentage-modus |
| `prize_rad4_pct` | NUMERIC(5,2) NULL CHECK 0-100 | 15.00 | Brukt i percentage-modus |
| `prize_full_house_pct` | NUMERIC(5,2) NULL CHECK 0-100 | 30.00 | Brukt i percentage-modus |
| `ticket_price_cents` | INTEGER NOT NULL CHECK >0 | 500 | Default 5 kr |
| `pause_between_rows_ms` | INTEGER NOT NULL CHECK 0-60000 | 3000 | Default 3s |
| `opening_time_start` | TEXT NULL | '11:00' | HH:MM 24t |
| `opening_time_end` | TEXT NULL | '23:00' | HH:MM 24t |
| `active` | BOOLEAN NOT NULL | TRUE | Singleton-flagg |
| `created_at` | TIMESTAMPTZ NOT NULL | now() | — |
| `updated_at` | TIMESTAMPTZ NOT NULL | now() | — |
| `updated_by_user_id` | TEXT NULL FK → app_users(id) | NULL | ON DELETE SET NULL |

**Singleton-håndhevelse:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill3_config_singleton_active
  ON app_spill3_config((active))
  WHERE active = TRUE;
```

### 6.2 `app_room_states.current_game.spill3PhaseState` (R10-felt)

Phase-state lagres som JSON-felt på recovery-snapshot. Type-definert i `apps/backend/src/game/types.ts:288-310` (R10-PR diff):

```typescript
export interface GameState {
  // ... eksisterende felter ...

  /**
   * BIN-820 / R10 (2026-05-08): Spill 3 phase-state-machine state.
   * Format matcher Game3PhaseState i Game3PhaseStateMachine.ts.
   * Optional / undefined for alle ikke-Spill-3-runder.
   */
  spill3PhaseState?: import("./Game3PhaseStateMachine.js").Game3PhaseState;
}

export interface GameSnapshot {
  // ... eksisterende felter ...
  spill3PhaseState?: import("./Game3PhaseStateMachine.js").Game3PhaseState;
}
```

### 6.3 Wallet-koblinger (delt med Spill 1/2)

Ingen Spill 3-spesifikke wallet-tabeller. Bruker eksisterende:
- `app_wallet_accounts` (delt)
- `app_wallet_transactions` (delt, med `idempotency_key` for Spill 3-keys via `IdempotencyKeys.game3Pattern` / `IdempotencyKeys.game3Lucky`)
- `app_rg_compliance_ledger` (med `gameType: 'MAIN_GAME'`)
- `app_payout_audit` (hash-chain)

---

## 7. Klient-flyt

### 7.1 Lobby — hvordan klient kobler til globalt rom

Klient åpner `http://localhost:4000/web/?webClient=game_3` (eller `monsterbingo`-slug). Game3Controller registreres i registry:

```typescript
// packages/game-client/src/games/game3/Game3Controller.ts
registerGame("monsterbingo", (deps) => new Game3Controller(deps));
registerGame("game_3", (deps) => new Game3Controller(deps));
```

Game3Controller gjenbruker hele Spill 1-frontenden (`PlayScreen`, `WinPopup`, `WinScreenV2`, etc.) — kun controller-laget er Spill 3-spesifikt. Per `packages/game-client/src/games/game3/README.md` per Tobias-direktiv 2026-05-03.

### 7.2 Socket.IO-rom for live-state

Spill 3 bruker det globale rommet (typisk `MONSTERBINGO` som canonical roomCode). Alle klienter på tvers av haller deler samme rom — i kontrast til Spill 1 hvor hver hall har eget lobby-rom.

Klient mottar:
- `room:update` — full snapshot inkludert `state.patternResults` og `state.patterns`
- `pattern:won` — emittert ved fase-vinst (bevaret fra eksisterende `super.onDrawCompleted`)
- Ingen Spill 3-spesifikke socket-events for phase-state per 2026-05-08 (klient ser pause indirekte via mangel på pattern-progresjon)

> **Ikke-strukturelt gap:** Eksplisitt `g3:phase:paused`-socket-event kunne gitt tydeligere UX, men er ikke pilot-blokker. Flagget i R10 chaos-test-doc som post-pilot.

### 7.3 Ticket-purchase og pre-game-vindu

Klient kjøper bonger gjennom standard ticket-purchase-flyt (delt med Spill 1/2). Spill 3 har:
- Kun ÉN ticket-type "Standard" (ingen fargevalg)
- Pris fra `Spill3Config.ticketPriceCents` (default 5 kr)
- Salg åpnes så snart rommet er WAITING (mellom runder)

### 7.4 Phase-progresjon visning på klient

Klient ser fase-progresjonen via `room:update`-snapshot — `state.patterns`-array oppdateres av engine etter hver vunnet fase (`isWon: true`). Aktive patterns (de som ennå ikke er vunnet) er filtrert til kun current phase i phase-mode.

`buildPatternSnapshot` (Game3Engine.ts:1432-1448) bygger wire-shape med `isWon`, `amount`, `patternDataList` (25-cell mask) for hver av de 5 patterns.

### 7.5 Draw-events streamen + 3s pause-event

Per draw skjer:
1. Engine trekker ny ball
2. Hvis i pause-vindu: `lastBall` emittes (auto-mark cells), men `processG3Winners` skipper
3. Hvis aktiv fase: pattern-evaluering kjører, vinner identifiseres og utbetales
4. `g3:pattern:auto-won`-event emittes med winners
5. Etter 3s pause: neste fase aktiveres (effective-step filter peker på neste idx)

### 7.6 Win-state og payout-visning per fase

Klient bruker Spill 1's `WinPopup.ts` for Rad 1-4 og `WinScreenV2.ts` for Fullt Hus. Pattern-navn-mapping fra "Row N" / "Rad N" / "1 Rad" gjøres via `displayNameFor` i CenterTopPanel (gjenbrukt fra game1).

---

## 8. Admin-konfig (uten redeploy)

### 8.1 Felter som kan endres (`Spill3ConfigUpdateInput`)

Admin sender partial-update via `PUT /api/admin/spill3/config`:

| Felt | Type | Validering |
|---|---|---|
| `minTicketsToStart` | integer | 0-1000 |
| `prizeMode` | `'fixed'` \| `'percentage'` | enum |
| `prizeRad1Cents` ... `prizeFullHouseCents` | integer \| null | ≥0, max 1 mill kr |
| `prizeRad1Pct` ... `prizeFullHousePct` | number \| null | 0-100, sum ≤100 |
| `ticketPriceCents` | integer | 1-100000 |
| `pauseBetweenRowsMs` | integer | 0-60000 |
| `openingTimeStart` | string | HH:MM 24t |
| `openingTimeEnd` | string | HH:MM 24t |

### 8.2 Premie-modus-validering

Service-laget kjører `assertConfigConsistency` **etter** merge av partial:
- `fixed`-mode: krever ALLE 5 cents-felter satt
- `percentage`-mode: krever ALLE 5 pct-felter satt + sum ≤ 100%
- Opening-times: format-validering + start < end

Hvis validering feiler: `DomainError("INVALID_CONFIG")` med beskrivende melding.

### 8.3 Audit-events `spill3.config.update`

Hver vellykket update skriver audit-event via `AuditLogService.record` (best-effort — feiler aldri caller hvis audit-log er nede):

```typescript
{
  actorType: "ADMIN",
  actorId: input.updatedByUserId,
  action: "spill3.config.update",
  resource: "spill3_config",
  resourceId: before.id,
  details: {
    before: serializeForAudit(before),
    after: serializeForAudit(after),
    changedFields: diffChangedFields(before, after),  // liste av endrede felter
  },
}
```

### 8.4 Cache-invalidering ved update

`Spill3ConfigService.update()` kaller `invalidateCache()` umiddelbart etter persist. Neste `getActive()` leser fra DB, ikke stale cache. Endringer slår inn ved neste runde-spawn (perpetual loop respekterer ny config).

### 8.5 Admin-UI form

`apps/admin-web/src/pages/games/spill3Config/Spill3ConfigPage.ts` (556 linjer) har:
- Form med radio for prize-mode (fixed/percentage)
- Conditional input-fields per mode (cents vs pct)
- Live-preview av "ved X solgte bonger blir Rad 1 = Y kr" via `calculatePhasePrizeCents`
- HH:MM input for opening-times med format-validering
- PUT mot `/api/admin/spill3/config`

Sidebar-link: `/games/spill3-config` under "Spilladministrasjon" (apps/admin-web/src/shell/sidebarSpec.ts).

---

## 9. Pilot-gating R1-R12 — Spill 3-spesifikke status

Per `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`:

| # | Tiltak | Spill 3-relevans | Status per 2026-05-08 |
|---|---|---|---|
| R1 | Game1Controller-wireup | N/A (Spill 1) | Spill 3 har egen `Game3Controller` allerede |
| R2 | Failover-test | Indirekte gjelder Spill 3 (delt infra) | Infra klar (PR #1032) — må kjøres |
| R3 | Klient-reconnect-test | Indirekte gjelder Spill 3 (delt infra) | Infra klar (PR #1037) — må kjøres |
| R4 | Load-test 1000 klienter | Indirekte | Ikke startet (post-pilot) |
| R5 | Idempotent socket-events | Gjelder Spill 3 | Merget #1028 (delt) |
| R6 | Outbox for room-events | Gjelder Spill 3 (wallet-touch) | Wallet-siden ferdig; rom-side må verifiseres |
| R7 | Health-endpoint per rom | **Gjelder Spill 3 direkte** | ✅ Merget #1027 — `/api/games/spill3/health` |
| R8 | Alerting | Gjelder Spill 3 | Merget #1031 (delt) |
| R9 | Spill 2 24t-leak-test | N/A (Spill 2) | Ikke startet |
| **R10** | **Spill 3 phase-state-machine engine-wireup + chaos-test** | **Spill 3-spesifikk** | **🚧 PR pushed `feat/r10-spill3-engine-wireup` (commit `8d755781`) — IKKE MERGET per 2026-05-08** |
| R11 | Per-rom resource-isolation | Gjelder Spill 3 | Ikke startet (post-pilot) |
| R12 | DR-runbook | Gjelder Spill 3 | Merget #1025 (delt runbook) |

**R10-PR commit-statistikk** (verifisert via `git log feat/r10-spill3-engine-wireup`):

```
feat(spill3): R10 phase-state-machine engine-wireup + chaos-test (BIN-820)

7 files changed, 1083 insertions(+), 9 deletions(-)
- apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts (NEW, 315 linjer)
- apps/backend/src/game/Game3Engine.ts                          (+230 linjer)
- apps/backend/src/game/types.ts                                (+28 linjer)
- apps/backend/src/game/BingoEngine.ts                          (+13 linjer)
- apps/backend/src/game/BingoEngineRecovery.ts                  (+12 linjer)
- infra/chaos-tests/r10-spill3-chaos-test.sh                    (NEW, 329 linjer)
- docs/operations/R10_SPILL3_CHAOS_TEST_RESULT.md               (NEW, 165 linjer)
```

Per R10-test-rapport ([docs/operations/R10_SPILL3_CHAOS_TEST_RESULT.md](../operations/R10_SPILL3_CHAOS_TEST_RESULT.md)):
- TypeScript strict-mode passer
- 107 Spill 3-relaterte tester passerer
- Chaos-script + invariants kjørbare; full ende-til-ende-Docker-validering venter på pilot-go-live-møte

---

## 10. Immutable beslutninger (det som ALDRI skal endres uten Tobias)

### 10.1 Singleton-rom-mønster

Spill 3 er **ÉTT globalt rom for alle haller**. Ingen per-hall lobby. Ingen GoH-master. Endrer du dette, har du brutt fundamental arkitektur — krever Tobias-godkjenning.

### 10.2 Grid 5×5 UTEN fri sentercelle (forskjell fra Spill 1)

Tobias revertet eksplisitt tilbake til 5×5 / 1..75-form 2026-05-03. Skal IKKE endres tilbake til 3×3 (PR #860-form) eller fri-celle-form.

### 10.3 Sequential phase-state-machine (Tobias-revert 2026-05-03 + R10)

Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus i sekvens. Ikke parallel evaluering. Ikke T/X/7/Pyramide-pattern-bingo (det var PR #860-formen som ble revertet).

### 10.4 Auto-start basert på solgte bonger

`minTicketsToStart` er global threshold, justeres av admin uten kode-deploy. Ingen master-trigger.

### 10.5 §11-distribusjon — 15% til organisasjoner

Spill 3 er `MAIN_GAME` regulatorisk (ikke `DATABINGO`). Endre IKKE dette uten å konsultere SPILLKATALOG.md + Tobias.

### 10.6 Ingen master-rolle

Spill 3 har ingen master-handlinger. Ingen "Start neste spill"-knapp. Ingen "Pause"-knapp. Alt er fullautomatisk.

### 10.7 Online-only — ÉN bongtype, default 5 kr

Per Tobias-direktiv 2026-05-08. Ingen fysiske bonger via agent. Ingen multi-farge-pricing. Bongpris justeres globalt via `ticketPriceCents`.

### 10.8 Phase-state må overleve restart

Recovery-snapshot MÅ deep-clone phase-state. Hvis du fjerner `spill3PhaseState`-felt fra `GameState`/`GameSnapshot`, bryter du R10-invariants (I1-I5).

---

## 11. Kjente begrensninger og åpne issues

### 11.1 R10 ennå ikke merget per 2026-05-08

Branch: `feat/r10-spill3-engine-wireup`
Commit: `8d755781`
Status: Pushed til origin, ikke merget til main.

Konsekvens: Hovedpath bruker fortsatt parallel cycler-evaluering (uten phase-state-machine). Spill 3 fungerer for bingo-runner, men sekvensielle pauser mellom rader er ikke wired. Pilot-test krever at R10 mergees før Spill 3 kan validere phase-flyt.

### 11.2 Phase-edge-cases

- **Out-of-order phase-vinst** (eks. Fullt Hus matcher før Rad 1): `advancePhaseStateAfterWinners` ignorerer pattern hvis `idx !== currentPhaseIndex` (fail-safe). I praksis skal dette ikke skje fordi `effectiveStep`-filteret allerede begrenser cycler til kun aktiv fase.
- **Concurrent winner i samme draw**: Hvis flere spillere vinner samme fase samme draw, deles poten flat med floor-rounding. Rest til HOUSE_RETAINED.
- **75 baller trukket midt i fase**: `markDrawBagEmpty` setter status="ENDED", endedReason="DRAW_BAG_EMPTY". PerpetualRoundService spawner ny runde.

### 11.3 Performance-grenser

- **Mass-payout batching**: For ≥ 50 vinnere på én pattern går engine i batched-path (Promise.allSettled, batch-size 25). Forhindrer at auto-draw-tick blokkeres på 1500-spillere-skala.
- **Race-detector**: `metrics.spill23RoomPlayersRaceDetected` teller når spillere evictes mellom mask-build og pattern-eval. Audit §3.4-fix beskytter mot crashes.
- **Cache TTL 5s**: Endringer i Spill3Config slår inn ved neste cache-miss. Ikke instant.

### 11.4 Manglende UX-events

- Ingen `g3:phase:paused`-socket-event — klient ser pausen indirekte via mangel på pattern-progresjon
- Ingen telemetry for fase-overgang-jitter (`metrics.spill3PhaseAdvance.inc`-forslag i R10-doc)

### 11.5 Legacy `DEFAULT_GAME3_CONFIG` (4 design-mønstre uten phase-mode)

Den gamle 4-pattern-konfigurasjonen (Topp+midt, Kryss, Topp+diagonal, Pyramide à 25%) eksisterer fortsatt i koden som fail-soft fallback. Hvis `Spill3Config` ikke kan hentes (eks. DB-feil), faller bridge tilbake til legacy-formen. Legacy-formen setter IKKE `autoClaimPhaseMode=true`, så den kjører på parallel cycler-pathen.

Dette er bevisst — vil ikke at en buggy config skal stoppe rommet helt.

---

## 12. Lokal pilot-test

### 12.1 Sett opp dev-stack

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
./start-dev.sh

# Eller manuelt:
docker-compose up -d postgres redis
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run migrate
npm run dev:all
```

### 12.2 Verifiser config

```bash
# Hent aktiv config
curl -H "Authorization: Bearer <admin-token>" \
  http://localhost:4000/api/admin/spill3/config

# Forventet: { id: "spill3-default", prizeMode: "percentage", prizeRad1Pct: 5, ... }
```

### 12.3 URL-er for testing

| Rolle | URL | Notat |
|---|---|---|
| Admin Spill3-config | `http://localhost:5174/admin/#/games/spill3-config` | Login: `tobias@nordicprofil.no` / `Spillorama123!` |
| Spiller-shell Spill 3 | `http://localhost:4000/web/?webClient=game_3` | Game3Controller — Spill 1-frontend gjenbruk |
| Spill 3 health | `http://localhost:4000/api/games/spill3/health?hallId=<any>` | Public no-auth |

### 12.4 Trigge auto-start manuelt

For å teste auto-start uten å kjøpe 20 bonger:

1. Sett `minTicketsToStart=1` via admin-UI eller `PUT /api/admin/spill3/config`
2. Cache TTL er 5s — vent litt eller restart backend
3. Kjøp én bong som spiller
4. Auto-spawn skal trigges innen ballIntervalMs

### 12.5 Hvis noe feiler

- **DB tom for spill3-config:** Re-kjør migration `20261211000000_app_spill3_config.sql`
- **`CONFIG_MISSING`-feil:** Sjekk at `WHERE active=TRUE` returnerer en rad
- **Phase-state ikke aktivert:** Verifiser at R10-PR er merget eller branch er ute. Bridge må sette `autoClaimPhaseMode=true`
- **Singleton-violation ved INSERT:** Bare én rad kan ha `active=TRUE` (partial unique index). Deaktiver eksisterende rad først

### 12.6 Run R10 chaos-test (når Docker-stack er tilgjengelig)

```bash
ADMIN_PASSWORD='<admin-passord>' bash infra/chaos-tests/r10-spill3-chaos-test.sh
# SCENARIO=pause-window | row-2-mid | full-house
```

---

## 13. Decisions log

| Dato | Beslutning | Hvem | Doc-ref |
|---|---|---|---|
| 2026-05-03 | Tobias-revert: Spill 3 tilbake til 5×5/75-baller (PR #860 revert) | Tobias | SPILLKATALOG.md, game3-canonical-spec.md |
| 2026-05-03 | Spill 3 reuses Spill 1 frontend 1:1 — kun Game3Controller er ny | Tobias | packages/game-client/src/games/game3/README.md |
| 2026-05-08 | Re-design: globalt rom + auto-start på threshold + fixed/percentage prize-mode | Tobias | SPILL_DETALJER_PER_SPILL.md §3 |
| 2026-05-08 | Sequential phase-state-machine: Rad 1 → 3s pause → ... → Fullt Hus | Tobias | Game3PhaseStateMachine.ts |
| 2026-05-08 | Online-only: ÉN bongtype, default 5 kr | Tobias | migration 20261211000000 |
| 2026-05-08 | Åpningstid Europe/Oslo HH:MM (default 11:00-23:00) | Tobias | migration 20261212000000 |
| 2026-05-08 | R10 engine-wireup + chaos-test pushed (BIN-820) | PM-AI | feat/r10-spill3-engine-wireup |
| 2026-05-08 | Spill 3 = MAIN_GAME, 15% til organisasjoner (IKKE databingo) | Tobias | SPILLKATALOG.md, ledgerGameTypeForSlug.ts |
| 2026-05-08 | Initial dokument-versjon — speil av SPILL1_IMPLEMENTATION_STATUS | PM-AI | denne filen |

---

## 14. Vedlikehold av dette dokumentet

**Oppdater dette doku ved:**
- Hver sesjons-slutt med store endringer på Spill 3
- Når R10-PR mergees (oppdater §9 + §11.1)
- Nye beslutninger som overstyrer eksisterende
- Endringer i datamodell eller singleton-håndtering
- Endringer i phase-state-machine

**Eier:** PM-AI vedlikeholder under utvikling. Tobias godkjenner større endringer.

**Konflikt-regel:** Ved uenighet mellom dette doku og kode, **doc-en vinner** — koden må fikses. Hvis du oppdager at en regel her er feil, oppdater dokumentet i samme PR som rettelsen og loggfør endringen i decisions log.

---

## 15. Referanser

### Doc-suite (kanoniske kilder)

- [SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) — autoritativ regel-spec for alle hovedspill
- [SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md) §3 — Spill 3-spesifikke detaljer
- [SPILLKATALOG.md](./SPILLKATALOG.md) — Spill 3 = MAIN_GAME, 15% til organisasjoner
- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — R10-mandat + go/no-go-policy
- [SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md](./SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) — strukturen dette dokumentet speiler
- [docs/operations/R10_SPILL3_CHAOS_TEST_RESULT.md](../operations/R10_SPILL3_CHAOS_TEST_RESULT.md) — R10-PR test-rapport

### Backend-kode

- `apps/backend/src/game/Spill3ConfigService.ts` — singleton config CRUD
- `apps/backend/src/game/Spill3GlobalRoomService.ts` — bridge til GameVariantConfig
- `apps/backend/src/game/Game3PhaseStateMachine.ts` — pure state-machine
- `apps/backend/src/game/Game3Engine.ts` — engine-runtime med R10-wireup
- `apps/backend/src/game/Game3AutoDrawTickService.ts` — auto-tick-driver
- `apps/backend/src/game/PerpetualRoundService.ts` — perpetual loop (delt med Spill 2)
- `apps/backend/src/game/types.ts` — `GameState.spill3PhaseState`-felt (R10)
- `apps/backend/src/game/BingoEngine.ts` — `serializeGame` med phase-state-clone (R10)
- `apps/backend/src/game/BingoEngineRecovery.ts` — `restoreFromCheckpoint` med phase-state-hydrering (R10)
- `apps/backend/src/util/roomState.ts:597-650` — `bindVariantConfigForRoom` Spill 3-grenen
- `apps/backend/src/routes/adminSpill3Config.ts` — admin-API
- `apps/backend/src/routes/publicGameHealth.ts:565-610` — R7 health-endpoint
- `apps/backend/migrations/20261211000000_app_spill3_config.sql` — singleton-tabell
- `apps/backend/migrations/20261212000000_app_spill3_config_opening_times.sql` — åpningstid-felter

### Klient-kode

- `packages/game-client/src/games/game3/Game3Controller.ts` — Spill 3 controller (gjenbruker game1/*)
- `packages/game-client/src/games/game3/README.md` — design-dokumentasjon
- `packages/game-client/src/games/registry.ts:39` — registry-import
- `apps/admin-web/src/pages/games/spill3Config/Spill3ConfigPage.ts` — admin-UI form
- `apps/admin-web/src/api/admin-spill3-config.ts` — API-wrapper
- `apps/admin-web/src/shell/sidebarSpec.ts` — sidebar-navigasjon

### Test-suite

- `apps/backend/src/game/Game3PhaseStateMachine.test.ts` (15 tester)
- `apps/backend/src/game/Spill3GlobalRoomService.test.ts` (12 tester)
- `apps/backend/src/game/Spill3ConfigService.test.ts` (35+ tester)
- `apps/backend/src/game/Game3Engine.test.ts` (14 tester)
- `apps/backend/src/game/Game3AutoDrawTickService.test.ts`
- `apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts` (R10-PR, I1-I6)
- `infra/chaos-tests/r10-spill3-chaos-test.sh` (R10-PR Docker-stack chaos)

### Linear-issues

- [BIN-820 — R10 Spill 3 phase-state-machine engine-wireup](https://linear.app/bingosystem/issue/BIN-820)
- [BIN-810 — R-mandat parent (Live-rom-robusthet)](https://linear.app/bingosystem/issue/BIN-810)
- PR #1006 (foundation), PR #1008 (sequential phase-state-machine), PR #1013 (admin-UI), PR #1027 (R7 health)

---

## 16. For nestemann som ser dette

Hvis du er en ny PM eller agent som starter på Spill 3:

1. **Les §1 i sin helhet.** Spill 3 er IKKE Spill 1 og IKKE Spill 2. Phase-state-machine er unikt.
2. **Les SPILL_REGLER_OG_PAYOUT.md** — kanonisk regel-spec.
3. **Les LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md** — robusthet-direktiv.
4. **Sjekk om R10-PR er merget** (§9 + §11.1). Hvis ikke, vurder om arbeidet ditt avhenger av phase-state-wireup.
5. **Verifiser at lokalt dev-miljø fungerer** (§12).
6. **IKKE fravik fra de fastlåste beslutningene** i §10. Hvis du finner en konflikt mellom kode og doc, doc-en vinner og koden må fikses.

**Spør Tobias** før du:
- Endrer phase-state-machine-spec
- Endrer prize-mode-system (fixed/percentage)
- Endrer singleton-rom-mønster
- Endrer 5×5 grid-form (revert til 3×3 eller fri-celle krever eksplisitt direktiv)
- Lager ny ticket-type-variant (Tobias-direktiv: kun ÉN bongtype)
- Endrer §11-distribusjons-prosent
- Endrer pilot-go-live-kriterier

**Hvis du finner en bug eller feil i koden:**
- Hvis det er P0 (regulatorisk eller wallet-relatert): fix umiddelbart, doc-oppdater i samme PR
- Hvis det er polish/UX (eks. fase-pause-event til klient): legg til i §11 og prioriter post-pilot
- Hvis det er konflikt med doc: doc-en vinner — fix koden

---
