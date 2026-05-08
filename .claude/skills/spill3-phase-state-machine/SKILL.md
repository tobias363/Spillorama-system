---
name: spill3-phase-state-machine
description: When the user/agent works with Spill 3 (monsterbingo / game_3), the sequential phase-state-machine, fixed-vs-percentage premie-modus, or pauseBetweenRowsMs. Also use when they mention Spill3ConfigService, Spill3GlobalRoomService, Game3Engine, Game3PhaseStateMachine, Game3AutoDrawTickService, autoClaimPhaseMode, MONSTERBINGO-rom, monsterbingo-slug, mønsterbingo, app_spill3_config, currentPhaseIndex, phasesWon, pausedUntilMs, sequential rad-faser, "75 baller 5×5 uten free", Tobias-revert PR #860, R10 chaos-test, BIN-820. Make sure to use this skill whenever someone touches Spill 3's phase-state-machine, monsterbingo-config, premie-modus eller fase-pause-logikk — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: spillorama
---

# Spill 3 — Sequential phase-state-machine

Spill 3 (slug `monsterbingo`, kode-navn `game_3`) er et live hovedspill med en helt egen arkitektur: **sequential rad-faser** (Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus) som er unikt i pilot-skopet. ETT globalt rom som alle haller deler. Ingen master, ingen plan. 5×5 grid UTEN fri sentercelle, 75 baller, ÉN ticket-type.

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` — autoritativ implementasjons-status
- `docs/architecture/SPILLKATALOG.md` — Spill 3 er hovedspill MAIN_GAME (ikke databingo)
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — kanonisk premie-mekanikk
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — R10 (Spill 3 phase-state-machine wireup + chaos-test) er pilot-gating

**Direktiv (Tobias 2026-05-08):**
> "Det er ekstremt viktig at fundamentet her er godt dokumentert slik at fremtidige PM/agenter har full forståelse og ikke fraviker fra planen."

R10 (Spill 3 phase-state-machine wireup) er pilot-gating-tiltak. PR `feat/r10-spill3-engine-wireup` er ennå ikke merget per 2026-05-08.

## KRITISK: Tobias-revert 2026-05-03 (PR #860)

**Historisk kontekst som SKAL forstås.** Spill 3 ble kortvarig portet til 3×3 / 1..21-form ("samme som Spill 2 med flere mønstre") i PR #860, men Tobias revertet dette 2026-05-03:

> "75 baller og 5x5 bonger uten free i midten. Alt av design skal være likt [Spill 1] bare at her er det kun 1 type bonger og man spiller om mønstre. Logikken med å trekke baller og markere bonger er fortsatt helt lik."

**Eldre dokumenter** (`SPILLKATALOG.md`, `game3-canonical-spec.md` i engineering/) kan referere til T/X/7/Pyramide-pattern-bingo (4 design-mønstre à 25%) eller 3×3-form. **Disse er foreldede.**

Spill 3 i pilot-fasen er:
- 5×5 grid, 75 baller, ÉN ticket-type
- Sequential rad-faser: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus (KUN — ikke T/X/7/Pyramide)
- Premie via `Spill3Config` (admin-konfigurert globalt)

> **Hvis du finner kode eller doc som motsier dette, doc-en vinner og koden må fikses.**

## Spill 3 vs Spill 1 vs Spill 2 — forskjells-tabell

| Aspekt | Spill 1 (`bingo`) | Spill 2 (`rocket`) | **Spill 3 (`monsterbingo`)** |
|---|---|---|---|
| Grid | 5×5 m/fri sentercelle | 3×3 full plate | **5×5 UTEN fri sentercelle** |
| Ball-range | 1-75 | 1-21 | **1-75** |
| Rom-modell | Per-hall lobby + GoH-master | ETT globalt rom | **ETT globalt rom (`MONSTERBINGO`)** |
| Master-rolle | Master-hall styrer | Ingen master | **Ingen master** |
| Spilleplan | Plan-runtime + scheduled-games | Perpetual loop | **Perpetual loop** |
| Vinning | Rad 1-4 + Fullt Hus (parallelt) | Kun Fullt Hus (9/9) | **Sequential phases: Rad 1 → Rad 2 → ... → Fullt Hus** |
| Pause mellom faser | Master pauser bevisst | N/A (én fase) | **`pauseBetweenRowsMs` (default 3000ms) — automatisk** |
| Bongtype | 3 farger (5/10/15 kr) | ÉN type (10 kr default) | **ÉN type ("Standard", default 5 kr)** |
| Premie-modus | Auto-multiplikator | Jackpot-mapping per draw-count | **`fixed` ELLER `percentage` av runde-omsetning** |
| Bonus-spill | 4 mini-spill | Lucky number bonus | **Ingen bonus** |
| Auto-start | Plan + master-trigger | `minTicketsToStart` | **`minTicketsToStart`** |
| Åpningstid | `plan.startTime`/`endTime` | Config-vindu valgfritt | **`openingTimeStart`/`End` påkrevd (default 11:00-23:00)** |
| Salgskanaler | Online + fysiske + agent-terminal | Online + agent-terminal | **Online ONLY** (Tobias-direktiv) |

## Phase-state-machine arkitektur

Spill 1 har Rad 1-4 + Fullt Hus, men evaluerer dem **parallelt** i hver trekning. Master tar bevisst pause hvis ønskelig.

Spill 3 evaluerer fasene **sekvensielt med automatisk pause**:

```
1. Rad 1 aktiv → trekk baller → vinner identifisert + utbetalt
2. Engine pauser i pauseBetweenRowsMs (default 3000ms) — INGEN trekk
3. Rad 2 aktiv → trekk fortsetter med samme draw-bag → vinner identifisert
4. ... (3s pause) → Rad 3 → ... → Rad 4 → ... → Fullt Hus
5. Fullt Hus vunnet ELLER 75 baller trukket uten Fullt Hus → runde slutt
```

### Implementasjon

`apps/backend/src/game/Game3PhaseStateMachine.ts` — pure state-machine helpers:
- `Game3PhaseIndex = 0..4` (Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus)
- `Game3PhaseState`: `{ currentPhaseIndex, pausedUntilMs, phasesWon, status, endedReason }`
- Helpers: `shouldDrawNext()`, `advancePhaseStateAfterWinners()`, `markDrawBagEmpty()`, `shouldAutoStartRound()`

`apps/backend/src/game/Game3Engine.ts` — wired med state-machine via R10-PR (pending merge):
- `Game3Engine extends Game2Engine extends BingoEngine`
- `onDrawCompleted` med phase-state-machine-evaluering
- `effectiveStep` filter (kun aktiv fase)
- `processG3Winners` → wallet payout
- `advancePhaseStateAfterWinners` → `state.pausedUntilMs = now + pauseBetweenRowsMs`

### Pattern-navn (to varianter — vær forsiktig)

Hvilken streng som brukes avhenger av kontext:

| Variant | Kilde | Verdier |
|---|---|---|
| **Bridge-form** | `Spill3GlobalRoomService.SPILL3_PHASE_NAMES` | `"1 Rad"`, `"2 Rader"`, `"3 Rader"`, `"4 Rader"`, `"Fullt Hus"` |
| **State-machine-form** | `Game3PhaseStateMachine.GAME3_PHASE_NAMES` | `"Rad 1"`, `"Rad 2"`, `"Rad 3"`, `"Rad 4"`, `"Fullt Hus"` |

**`phasePatternIndexFromName`** (Game3Engine.ts) aksepterer begge varianter for å unngå brudd ved navn-skifte.

### Phase-index 0..4 mapping

| Index | Phase-navn | Claim-type | Mask-design |
|---|---|---|---|
| 0 | Rad 1 / 1 Rad | `LINE` | design=1 |
| 1 | Rad 2 / 2 Rader | `LINE` | design=2 |
| 2 | Rad 3 / 3 Rader | `LINE` | design=3 |
| 3 | Rad 4 / 4 Rader | `LINE` | design=4 |
| 4 | Fullt Hus / Coverall | `BINGO` | design=0 (full grid) |

## Backend-services-kart

| Service | Fil | Ansvar |
|---|---|---|
| `Spill3GlobalRoomService` | `apps/backend/src/game/Spill3GlobalRoomService.ts` | `Spill3Config` → `GameVariantConfig` bridge med `autoClaimPhaseMode: true` |
| `Spill3ConfigService` | `apps/backend/src/game/Spill3ConfigService.ts` | Singleton CRUD + 5s read-through cache + audit-log |
| `Game3AutoDrawTickService` | `apps/backend/src/game/Game3AutoDrawTickService.ts` | Cron driver — drawNext for hvert running monsterbingo-rom (`GAME3_MAX_BALLS = 75`) |
| `Game3Engine` | `apps/backend/src/game/Game3Engine.ts` | Engine med phase-state-machine-evaluering (R10-PR) |
| `Game3PhaseStateMachine` | `apps/backend/src/game/Game3PhaseStateMachine.ts` | Pure state-machine helpers (no IO) |
| `PerpetualRoundService` | `apps/backend/src/game/PerpetualRoundService.ts` | Felles perpetual-loop for Spill 2/3 — `canSpawnRound` med åpningstid-guard |

### Routes

- `GET /api/admin/spill3/config` — RBAC `GAME_CATALOG_READ`
- `PUT /api/admin/spill3/config` — RBAC `GAME_CATALOG_WRITE` (ADMIN-only)
- `GET /api/games/spill3/health?hallId=X` — public, no-auth, rate-limit 60/min/IP

## Premie-modus: fixed ELLER percentage

Spill 3 har TO premie-modi, valgt globalt via `Spill3Config.prizeMode`:

### Mode 1: `fixed`
Faste kr-beløp per fase (uavhengig av omsetning).
- Krever at `prizeRad1Cents`..`prizeFullHouseCents` er satt
- Alle pct-felter er null
- Egnet for: stabile premiebeløp uavhengig av deltakelse

### Mode 2: `percentage`
Prosent av runde-omsetning (totalSold × pct/100).
- Krever at `prizeRad1Pct`..`prizeFullHousePct` er satt
- Alle cents-felter er null
- Sum av prosenter må være ≤ 100
- Egnet for: vekstmodus hvor premier skalerer med deltakelse

**Validering** (`Spill3ConfigService`):
- Service-laget validerer prize-mode-konsistens etter merge
- Fixed-mode → cents-felter må være satt
- Percentage-mode → pct-felter må være satt + sum ≤ 100

## Auto-start (`minTicketsToStart`) og åpningstid

**Auto-start-flyt:**
1. Bootstrapping ved server-start: `StaleRoomBootSweepService` sjekker om `MONSTERBINGO`-rom finnes; hvis ikke opprettes det
2. `PerpetualRoundService.spawnFirstRoundIfNeeded()` startes hvis rommet er WAITING og threshold-betingelser møtt
3. Bonge-salg: PerpetualRoundService overvåker `ticketsSold` i WAITING-state
4. Auto-start på threshold:
```typescript
// Game3PhaseStateMachine.ts:382-389
export function shouldAutoStartRound(input: AutoStartInput): boolean {
  if (input.roomStatus !== "WAITING") return false;
  if (input.minTicketsToStart <= 0) return input.ticketsSold > 0;
  return input.ticketsSold >= input.minTicketsToStart;
}
```
5. Trekninger: `Game3AutoDrawTickService` tikker drawNext hvert `ballIntervalMs`
6. Round-end: Fullt Hus vunnet ELLER 75 baller trukket → `endedReason="G3_FULL_HOUSE"` (eller `DRAW_BAG_EMPTY`)
7. Ny runde etter `PERPETUAL_LOOP_DELAY_MS` (default 5s, prod 30s) — innen åpningstid

**Åpningstid-guard:** Før hver spawn sjekker `canSpawnRound` (via `PerpetualRoundOpeningWindowGuard`) om current Oslo-tid er innenfor `[openingTimeStart, openingTimeEnd)`. Hvis utenfor → ingen ny runde inntil vinduet åpner igjen.

**Idempotens:** Pending restarts er nøkket på `roomCode + gameId` for å forhindre duplikat-spawn ved gjentatte `onGameEnded`-fires.

## Database-skjema

`app_spill3_config` (singleton via partial unique idx):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill3_config_singleton_active
  ON app_spill3_config((active))
  WHERE active = TRUE;
```

Felter (utdrag):
- `prize_mode` ENUM `('fixed', 'percentage')`
- `prize_rad1_cents`..`prize_full_house_cents` (fixed-mode)
- `prize_rad1_pct`..`prize_full_house_pct` (percentage-mode)
- `ticket_price_cents` (default 500 = 5 kr, online-only per Tobias)
- `pause_between_rows_ms` (default 3000)
- `min_tickets_to_start` (default 20)
- `opening_time_start`/`opening_time_end` (HH:MM, default 11:00-23:00)
- `active` BOOLEAN (singleton-flagg)

## Compliance — MAIN_GAME (ikke databingo)

`ledgerGameTypeForSlug("monsterbingo")` returnerer `MAIN_GAME`. Dette betyr:
- §11-distribusjon **15% til organisasjoner** (samme som Spill 1/2)
- INGEN single-prize-cap (cap er kun for `DATABINGO`)
- Cap-håndhevelse: `applySinglePrizeCap` med `gameType: ledgerGameTypeForSlug(room.gameSlug)` — Game3Engine.ts:1137

## Checkpoint-recovery (R10 chaos-test)

R10 i pilot-mandatet (LIVE_ROOM_ROBUSTNESS_MANDATE) krever at engine fortsetter korrekt etter midlertidig backend-nedetid:
- `app_room_states` lagrer phase-state-snapshots i Redis + Postgres
- Etter restart skal `currentPhaseIndex`, `phasesWon`, `pausedUntilMs` recoveres
- Chaos-test kjøres via `bash infra/chaos-tests/r10-spill3-resume-test.sh`

## Immutable beslutninger (Tobias 2026-05-03)

1. **5×5 grid UTEN fri sentercelle** — IKKE 3×3 (Spill 2-form). PR #860-revert.
2. **75 baller 1-75** — IKKE 1-21.
3. **Sequential phases Rad 1 → ... → Fullt Hus** — IKKE T/X/7/Pyramide.
4. **ÉN ticket-type ("Standard")** — IKKE 3 farger.
5. **Online ONLY** — ingen fysiske bonger eller agent-terminal-salg.
6. **`MONSTERBINGO`-rom globalt** — IKKE per-hall.
7. **`MAIN_GAME` compliance** — 15% til organisasjoner, ingen 2500 kr-cap.
8. **`pauseBetweenRowsMs` default 3000ms** — fase-pause er automatisk, ikke master-styrt.

## Vanlige feil og hvordan unngå dem

### 1. Bruker pre-revert 3×3-form
Hvis du finner kode/doc som referer 3×3 eller 1..21 for monsterbingo: det er pre-PR #860 og er foreldet.
**Fix:** Verifiser via `Spill3GlobalRoomService.buildVariantConfigFromSpill3Config` at `maxBallValue=75`, `drawBagSize=75`, `uses5x5NoCenterTicket(slug)=true`.

### 2. Implementerer T/X/7/Pyramide-mønstre
Spill 3 har KUN sequential rad-faser. T/X/7/Pyramide hører hjemme i andre Spill 1-katalog-varianter (eks. `bokstav`-slug).
**Fix:** Hvis kunde ber om "monstermønstre", spør Tobias før implementasjon.

### 3. Forvirring mellom pattern-navn-varianter
"1 Rad" vs "Rad 1" → bridge-form vs state-machine-form.
**Fix:** Bruk `phasePatternIndexFromName` for navn→index-mapping. Aksepterer begge.

### 4. Glemmer `autoClaimPhaseMode` flag
`Spill3GlobalRoomService.buildVariantConfigFromSpill3Config` setter `autoClaimPhaseMode: true`. Dette er R10-trigger som aktiverer phase-state-machine.
**Fix:** Endrer du `Spill3GlobalRoomService` — verifiser at `autoClaimPhaseMode` fortsatt er true.

### 5. Endrer phase-pause uten å sjekke `shouldDrawNext`
`shouldDrawNext` returnerer false hvis `now < pausedUntilMs`. Dette stopper auto-tick midlertidig.
**Fix:** Tester i `Game3PhaseStateMachine.test.ts` dekker pause-logikken — kjør dem ved endringer.

### 6. Validerer ikke prize-mode-konsistens
Service-laget kaster `INVALID_CONFIG` hvis fixed-mode mangler cents-felt eller percentage-mode mangler pct-felt.
**Fix:** Bruk `Spill3ConfigService.update` (som validerer) — aldri direct-write til DB.

### 7. Glemmer at runder bygger på samme draw-bag
Sequential faser bruker SAMME draw-bag — Rad 2 fortsetter med trekk fra der Rad 1 sluttet. IKKE reset draw-bag mellom faser.

### 8. Bytter fra `MAIN_GAME` til `DATABINGO`
Spill 3 er hovedspill, IKKE databingo (KUN SpinnGo er databingo).
**Fix:** `ledgerGameTypeForSlug("monsterbingo")` MÅ returnere `MAIN_GAME`.

## Når denne skill-en er aktiv

**Gjør:**
- Les `SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` FØRST
- Verifiser at endringer respekterer Tobias-revert (5×5 / 75 baller / sequential faser)
- Test både `monsterbingo`, `mønsterbingo`, og `game_3`-aliaser
- Sjekk `autoClaimPhaseMode: true` i variantConfig
- Bruk `Spill3ConfigService.update` for config-endringer (validering)
- Test phase-overgangsstate-machine via `Game3PhaseStateMachine.test.ts`

**Ikke gjør:**
- IKKE introduser 3×3-form eller 1..21-baller
- IKKE implementer T/X/7/Pyramide-mønstre
- IKKE introduser ticket-farger eller multi-priser
- IKKE tillat fysiske bonger eller agent-terminal-salg
- IKKE bytt til `DATABINGO` ledger-type
- IKKE introduser master-rolle eller plan-runtime
- IKKE rør `app_spill3_config`-skjema uten å sjekke partial unique idx håndhevelse

## Kanonisk referanse

Ved tvil mellom kode og doc: **doc-en vinner**, koden må fikses. SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md er autoritativ. Hvis du finner koe som motsier Tobias-revert 2026-05-03 (PR #860): koden må fikses.
