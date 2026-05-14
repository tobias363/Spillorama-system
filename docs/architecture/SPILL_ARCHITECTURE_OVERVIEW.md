# Spill 1/2/3 — Fundamental arkitektur-oversikt (ENESTE source-of-truth)

**Status:** Autoritativ. Erstatter dupliserte tabeller i `CLAUDE.md`, `PM_ONBOARDING_PLAYBOOK`, `PM_QUICK_REFERENCE`, `SPILL[1-3]_IMPLEMENTATION_STATUS` (§1.x) og `PITFALLS_LOG` (§3.x).
**Sist oppdatert:** 2026-05-15
**Eier:** Tobias Haugen (teknisk lead)
**Lese-først-i-sesjon:** **JA** — alle nye PM/agenter som rører ETT av live-spillene SKAL skumme dette dokumentet før de begynner.

---

## 0. Hvorfor denne fila eksisterer

Spillorama har tre live hovedspill med **FUNDAMENTALT forskjellige arkitekturer**. Antakelser fra ett spill overføres IKKE til de andre. Tidligere sto den samme sammenligningstabellen i 5+ docs (CLAUDE.md, PM_ONBOARDING_PLAYBOOK, PM_QUICK_REFERENCE, hver av SPILL[1-3]_IMPLEMENTATION_STATUS, PITFALLS_LOG) — alle ute av synk, alle ufullstendige.

Denne fila er **ENESTE source-of-truth** for cross-spill-sammenligning. Andre docs peker hit i stedet for å duplisere tabellen.

**Konflikt-regel:** Hvis koden motsier denne doc-en, doc-en vinner og koden må fikses. Hvis du oppdager at en regel her er feil, oppdater dokumentet i samme PR som rettelsen.

**Tobias-direktiv 2026-05-08:**
> "Veldig viktig at disse ulikhetene [Spill 1 vs Spill 2/3] kommer frem i beskrivelsen ... fundamentet legges godt nå."

**Tobias-direktiv 2026-05-15:**
> "Vi vil ha EN kanonisk doc med tabellen, og alle andre docs peker hit i stedet for å duplisere."

---

## 1. Hovedoversikt — komplett sammenligningstabell

> **🚨 ALDRI overfør antakelser mellom spillene.** Hver kolonne er en uavhengig kontrakt.

| Aspekt | Spill 1 (`bingo`) | Spill 2 (`rocket`) | Spill 3 (`monsterbingo`) |
|---|---|---|---|
| **Grid** | 5×5 med fri sentercelle | 3×3 full plate (9 ruter) | 5×5 UTEN fri sentercelle |
| **Ball-range** | 1-75 | 1-21 | 1-75 |
| **Maks draws/runde** | 75 | 21 | 75 |
| **Rom-modell** | Per-hall lobby + GoH-master-rom (`BINGO_<groupId>`) | ETT GLOBALT ROM (`ROCKET`) for ALLE haller | ETT GLOBALT ROM (`MONSTERBINGO`) for ALLE haller |
| **Hall-isolasjon** | Master-hall styrer; deltager-haller deler runde via GoH | Ingen — `hallId` ignoreres for room-routing (`canonicalRoomCode.ts:55-57`) | Ingen — singleton-konfig globalt |
| **Master-rolle** | Master-hall styrer start/pause/advance via `Game1MasterControlService` | Ingen master — auto-start når `minTicketsToStart` er nådd | Ingen master — auto-start når `minTicketsToStart` er nådd |
| **Spilleplan** | `app_game_plan` + `app_game_plan_run` + `GamePlanEngineBridge` | Ingen plan — perpetual loop, runder spawnes av `PerpetualRoundService` | Ingen plan — perpetual loop, runder spawnes av `PerpetualRoundService` |
| **Auto-restart etter game-end** | ❌ Master-styrt mellom runder | ✅ `minTicketsToStart`-threshold trigger | ✅ Sequential phases internt + `minTicketsToStart` for ny runde |
| **Trekning** | Plan-tick + master-trigger (`/api/admin/rooms/:code/draw-next`) | Auto-tick-driven (`Game2AutoDrawTickService`, polled cron) | Auto-tick-driven (`Game3AutoDrawTickService`) + phase-state-machine |
| **Vinning** | Rad 1, Rad 2, Rad 3, Rad 4 + Fullt Hus (parallel eval) | Kun Fullt Hus (9/9 full plate) | Sequential phases: Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus |
| **Pause mellom faser** | Master pauser bevisst | N/A (én fase) | `pauseBetweenRowsMs` (default 3000ms) — AUTOMATISK |
| **Draws-til-vinst-sjekk** | Aktivert per fase (Rad 1 etter ~5 trekk osv.) | Først etter trekk 9 (`GAME2_MIN_DRAWS_FOR_CHECK`) | Sequential — kun aktiv fase evalueres per draw |
| **Sub-games / katalog** | 13 katalog-varianter (bingo, oddsen, trafikklys, …) | Kun rocket-variant | Kun monsterbingo (singleton-config, ingen multi-variant) |
| **Bongtype / pris** | 3 farger: hvit (5kr) / gul (10kr) / lilla (15kr) — auto-multiplikator | ÉN type ("Standard"), default 10 kr (admin-konfigurerbar i øre) | ÉN type ("Standard"), default 5 kr (admin-konfigurerbar i øre) |
| **Bong-multiplikator** | × 1 / × 2 / × 3 (auto-mult per fase) | Ingen multiplikator — alle bonger like | Ingen multiplikator — alle bonger like |
| **Premie-modus** | Auto-multiplikator (`base × ticketPrice / 500`) | Jackpot-mapping per draw-count (9, 10, 11, 12, 13, 14-21) | `fixed` ELLER `percentage` av runde-omsetning |
| **Bonus-spill** | 4 mini-spill (Wheel/Chest/Mystery/ColorDraft) på Fullt Hus | Lucky Number Bonus (admin-aktiverbar) | Ingen bonus |
| **Auto-start** | Plan + master-trigger | `minTicketsToStart` threshold (default 5) | `minTicketsToStart` threshold (default 20) |
| **Åpningstid** | `app_game_plan.start_time` / `end_time` | `Spill2Config.openingTimeStart` / `End` (HH:MM, NULL = alltid åpent) | `Spill3Config.openingTimeStart` / `End` (HH:MM, default 11:00-23:00, påkrevd) |
| **Min spillere/bonger** | Driven av plan + master-handling | `Spill2Config.minTicketsToStart` auto-trigger | `Spill3Config.minTicketsToStart` auto-trigger |
| **Klient-rom** | `spill1:lobby:{hallId}` + `spill1:scheduled-{gameId}` | Single room-key `ROCKET` + Socket.IO-namespace `/game2` | Single room-key `MONSTERBINGO` |
| **Salgskanaler** | Online + fysiske bonger + agent-terminal | Online + agent-terminal | Online ONLY (Tobias-direktiv 2026-05-08) |
| **Master-hall valg** | GoH har `master_hall_id` (admin-velger via UI) | N/A | N/A — ingen master |
| **Compliance gameType** | `MAIN_GAME` (15% til org) | `MAIN_GAME` (15% til org) | `MAIN_GAME` (15% til org) |
| **Konfig-redeploy** | Plan + katalog endres via admin-CRUD | Single `app_spill2_config`-rad (singleton, partial unique idx) | Single `app_spill3_config`-rad (singleton, partial unique idx) |
| **Engine-klasse** | `BingoEngine` | `Game2Engine extends BingoEngine` | `Game3Engine extends Game2Engine extends BingoEngine` |
| **Runtime engine-instans** | `BingoEngine` (default) | `Game3Engine` i runtime (pga arve-kjede) | `Game3Engine` i runtime |
| **Auto-restart-mekanikk** | N/A (master-styrt) | `PerpetualRoundService.handleGameEnded` → setTimeout(roundPauseMs) | Sequential phases internt; ny runde via samme `PerpetualRoundService` |

### 1.1 Korte hovedforskjeller (executive summary)

- **Spill 1** (`bingo`) — per-hall lobby + GoH-master + plan-runtime + scheduled-games. Master starter/pauser bevisst.
- **Spill 2** (`rocket`) — ETT globalt rom (`ROCKET`) + perpetual loop + auto-tick. Ingen master, ingen plan. Auto-start på `minTicketsToStart`. Jackpot-mapping per draw-count.
- **Spill 3** (`monsterbingo`) — ETT globalt rom (`MONSTERBINGO`) + perpetual loop + **phase-state-machine** (Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus med auto-pause mellom faser). Unik for Spill 3 — verken Spill 1 eller Spill 2 har det.

---

## 2. Felles invariants (gjelder ALLE 3 spill)

Disse er IMMUTABLE på tvers av spillene. Hvis du bryter en av disse, har du bygget feil.

### 2.1 Server er sannhets-kilde
- Klient er view, ALDRI source of truth
- Alt regulatorisk valideres backend-side
- Wallet-mutering skjer KUN backend via `WalletAdapter`-interface

### 2.2 §11-distribusjon `MAIN_GAME` = 15%
Alle tre spill (`bingo`, `rocket`, `monsterbingo`) er regulatorisk **hovedspill**. Minimum 15% til organisasjoner per kvartal (pengespillforskriften §11).

Kun **SpinnGo** (`spillorama` / Spill 4) er `DATABINGO` med 30% + 2500 kr cap. Spill 1-3 har **INGEN** single-prize-cap.

### 2.3 Compliance-ledger binder til kjøpe-hall, IKKE master-hall
Compliance-event-binding bruker `actor_hall_id` (hvor billetten ble kjøpt), aldri `master_hall_id`. Pre-fix-bug i PR #443 hadde dette feil — fixet 2026-04-25.

### 2.4 `ledgerGameTypeForSlug()` er ENESTE mapping fra slug til gameType
```typescript
import { ledgerGameTypeForSlug } from "./game/ledgerGameTypeForSlug";

// "bingo" | "rocket" | "monsterbingo" → "MAIN_GAME"
// "spillorama" → "DATABINGO"
const gameType = ledgerGameTypeForSlug(slug);
```

**Hardkode ALDRI `gameType: "DATABINGO"` for Spill 1-3.** Pre-fix-bug hardkodet dette 12+ steder; bryter §11-rapportering. Bruk alltid funksjonen.

### 2.5 Idempotency-key kreves på alle wallet-touch paths
Per BIN-761/762/763/764 (casino-grade wallet):
- `idempotencyKey` på hver wallet-mutering (`IdempotencyKeys.<operation>(...)`)
- `clientRequestId` på socket-events som rør wallet (R5, BIN-813)
- REPEATABLE READ-isolation på wallet-debit
- Outbox-pattern for atomisk state + event

### 2.6 Hash-chain audit-trail (BIN-764, ADR-0004)
- `app_compliance_audit_log` + `app_wallet_entries` er append-only
- ALDRI `UPDATE` eller `DELETE` fra disse tabellene
- Korrigering = ny rad som refererer original

### 2.7 Live-rom-robusthet (LIVE_ROOM_ROBUSTNESS_MANDATE)
Alle tre spill må holde Evolution Gaming-grade oppetid (99.95%+) innenfor åpningstid. R1-R12 er pilot-gating-tiltak. Se [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md).

---

## 3. Bridge-pattern (Spill 2/3 perpetual-config → engine)

Spill 2 og Spill 3 bruker singleton-konfig (én aktiv rad globalt) som mapper til `GameVariantConfig` via en bridge-service. Dette gjør at endringer i admin-konfig slår inn ved neste runde uten kode-deploy.

### 3.1 Spill 2 — `Spill2GlobalRoomService`

**Fil:** `apps/backend/src/game/Spill2GlobalRoomService.ts`

```typescript
function buildVariantConfigFromSpill2Config(config: Spill2Config): GameVariantConfig {
  return {
    ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
    patterns: [],                                   // auto-claim-on-draw, ingen patterns
    maxBallValue: 21,
    drawBagSize: 21,
    patternEvalMode: "auto-claim-on-draw",
    jackpotNumberTable: config.jackpotNumberTable,  // 6 keys: 9, 10, 11, 12, 13, 1421
    luckyNumberPrize: (config.luckyNumberPrizeCents ?? 0) / 100,
    minTicketsBeforeCountdown: config.minTicketsToStart,
    roundPauseMs: clamp(config.roundPauseMs, 1000, 300000),
    ballIntervalMs: clamp(config.ballIntervalMs, 1000, 10000),
  };
}
```

**Fall-through-rekkefølge** (`roomState.bindVariantConfigForRoom`):
1. `Spill2Config` (global singleton) ← primær
2. `GameManagement.config.spill2` (per item) ← legacy fallback
3. `DEFAULT_GAME2_CONFIG` ← hard fallback

### 3.2 Spill 3 — `Spill3GlobalRoomService`

**Fil:** `apps/backend/src/game/Spill3GlobalRoomService.ts`

Tilsvarende bridge for Spill 3, men setter i tillegg `autoClaimPhaseMode: true` for å aktivere sequential phase-state-machine i `Game3Engine`.

```typescript
function buildVariantConfigFromSpill3Config(config: Spill3Config): GameVariantConfig {
  return {
    ticketTypes: [{ name: "Standard", type: "game3-5x5-no-center", priceMultiplier: 1, ticketCount: 1 }],
    patterns: SPILL3_PATTERNS,                      // 5 patterns: Row 1-4 + Fullt Hus
    maxBallValue: 75,
    drawBagSize: 75,
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,                        // ← Spill 3-spesifikt: aktiverer phase-state-machine
    minTicketsBeforeCountdown: config.minTicketsToStart,
    roundPauseMs: config.pauseBetweenRowsMs,         // default 3000ms
    // ... premie-modus (fixed eller percentage) mappes fra config
  };
}
```

### 3.3 Felles regel: ikke spawne flere singleton-rom

For både Spill 2 og Spill 3:
- `canonicalRoomCode("rocket")` returnerer alltid `"ROCKET"` med `effectiveHallId: null`
- `canonicalRoomCode("monsterbingo")` returnerer alltid `"MONSTERBINGO"`
- Partial unique idx på `WHERE active = TRUE` på begge config-tabellene
- Hvis du finner kode som prøver å spawne per-hall `rocket`/`monsterbingo`-rom → **det er bug**

---

## 4. Phase-state-machine (Spill 3 unique)

Spill 3 evaluerer rad-faser **sekvensielt med automatisk pause**, mens Spill 1 evaluerer dem **parallelt** (alle faser kan vinnes på samme draw).

### 4.1 Spill 3 sequential flow

```
Round start (autoClaimPhaseMode=true)
└─ game.spill3PhaseState lazy-init: { currentPhaseIndex: 0, pausedUntilMs: null, phasesWon: [], status: "ACTIVE" }

┌────────────────────┐
│  Rad 1 aktiv       │ ─── vinner identifisert + utbetalt
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  pause 3000ms      │ ─── shouldDrawNext returns SKIP
│  pausedUntilMs+=3s │
└────────┬───────────┘
         │ pause expires
         ▼
   ... (Rad 2 → 3s pause → Rad 3 → 3s pause → Rad 4 → 3s pause) ...
         │
         ▼
┌────────────────────┐
│  Fullt Hus (idx=4) │
└────────┬───────────┘
         │
    ┌────┴─────────┐
    ▼              ▼
[Fullt Hus]   [DRAW_BAG_EMPTY]
status=ENDED  status=ENDED
endedReason=  endedReason=
FULL_HOUSE    DRAW_BAG_EMPTY
         │
         ▼
PerpetualRoundService.handleGameEnded
→ ny runde etter delay (innen åpningstid)
```

### 4.2 Hvorfor Spill 1 IKKE har dette

Spill 1 evaluerer Rad 1-4 + Fullt Hus i samme draw via `PatternCycler`. Master tar bevisst pause mellom rader hvis ønskelig. Det er master-styrt, ikke automatisk.

### 4.3 Hvorfor Spill 2 IKKE har dette

Spill 2 har KUN én fase (Fullt Hus 9/9). Det er ingen rad-faser å sekvensere.

### 4.4 Tobias-revert 2026-05-03 (KRITISK historisk kontekst)

PR #860 portet kortvarig Spill 3 til 3×3 / 1..21-form med parallel pattern-eval. Tobias revertet eksplisitt:

> "75 baller og 5x5 bonger uten free i midten. Alt av design skal være likt [Spill 1] bare at her er det kun 1 type bonger og man spiller om mønstre. Logikken med å trekke baller og markere bonger er fortsatt helt lik."

Eldre dokumenter (`SPILLKATALOG.md` før korrigering, `game3-canonical-spec.md`) refererer til T/X/7/Pyramide-pattern-bingo (4 design-mønstre à 25%) eller 3×3-form. **Disse er foreldede.** Spill 3 i pilot-fasen er:
- 5×5 grid, 75 baller, ÉN ticket-type
- Sequential rad-faser: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus (KUN — ikke T/X/7/Pyramide)
- Premie via `Spill3Config` (admin-konfigurert globalt)

**Aldri reverter Spill 3 til 3×3-form eller parallel-pattern-eval uten Tobias-godkjennelse.**

### 4.5 Pattern-navn-mapping (bridge vs state-machine)

- **Bridge-form** (`Spill3GlobalRoomService.SPILL3_PHASE_NAMES`): `"1 Rad"`, `"2 Rader"`, `"3 Rader"`, `"4 Rader"`, `"Fullt Hus"`
- **State-machine-form** (`Game3PhaseStateMachine.GAME3_PHASE_NAMES`): `"Rad 1"`, `"Rad 2"`, `"Rad 3"`, `"Rad 4"`, `"Fullt Hus"`

`phasePatternIndexFromName` (`Game3Engine.ts:1518`) aksepterer BEGGE varianter for å unngå brudd ved navngivnings-skifte.

---

## 5. Anti-mønstre (top-5)

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Anta Spill 2/3 har master-rolle eller plan-runtime | De har IKKE master/plan — perpetual-loop drevet av `PerpetualRoundService`. Hvis du leter etter master, du er på feil spill. |
| Anta Spill 1 har auto-restart etter game-end | Spill 1 er master-styrt mellom runder — regulatorisk korrekt per §64/§71. Kill-switch i `schedulerSetup.ts:135-200` blokkerer auto-start for `slug === "bingo"`. |
| Konvertere Spill 1 til perpetual-modell uten Tobias-godkjennelse | Regulatorisk korrekt som master-styrt. Endrer du dette uten direktiv = bryter §64 + bryter Tobias-direktiv 2026-05-08. |
| Hardkode `gameType: "DATABINGO"` for Spill 1-3 | `ledgerGameTypeForSlug(slug)` — ENESTE mapping. Hardkoding bryter §11-rapportering. |
| Apply 2500 kr cap på Spill 1-3 (MAIN_GAME) | Cap er KUN for `DATABINGO` (SpinnGo). MAIN_GAME har INGEN cap. Lilla-bong får 3000 kr på Innsatsen Fullt Hus, 4500 kr på Oddsen-HIGH — det er forventet og regulatorisk OK. |
| Spawne flere `rocket`/`monsterbingo`-rom per hall | De er globale singleton-rom. `canonicalRoomCode` returnerer fast room-key. Partial unique idx på `active=TRUE` på config-tabellene. |
| Endre `GamePlanEngineBridge` med tanken at det påvirker Spill 2/3 | Det rører IKKE Spill 2/3 — de har ingen plan-state. Bridgen er Spill 1-spesifikk. |
| Reverter Spill 3 til 3×3-form eller T/X/7/Pyramide-pattern | Tobias revertet PR #860. Pilot-form er 5×5 / 75-baller / sequential phases. |

For full fallgruve-katalog, se [`PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md) §3 (Spill 1, 2, 3 arkitektur).

---

## 6. Dypere docs (per spill)

Denne fila er **sammenligning** av arkitekturene. For **dyp implementasjon** per spill:

| Spill | Doc | Innhold |
|---|---|---|
| Spill 1 | [`SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](./SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md) | plan-runtime, master-actions, scheduled-game lifecycle, GoH-master-koblinger, transfer-master, ticket-purchase, draw-engine, payout, 13 katalog-varianter, UI-status |
| Spill 2 | [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](./SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) | `Spill2GlobalRoomService`, `Spill2ConfigService`, `Game2AutoDrawTickService`, `Game2Engine`, `Game2JackpotTable`, Lucky Number, perpetual loop, ROCKET-rom, jackpot-mapping per draw-count |
| Spill 3 | [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](./SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md) | `Spill3GlobalRoomService`, `Spill3ConfigService`, `Game3AutoDrawTickService`, `Game3Engine`, `Game3PhaseStateMachine`, `autoClaimPhaseMode`, fixed/percentage premie-modus, MONSTERBINGO-rom, sequential rad-faser |

## 7. Relaterte kanoniske docs

| Doc | Når lese |
|---|---|
| [`SPILL_REGLER_OG_PAYOUT.md`](./SPILL_REGLER_OG_PAYOUT.md) | FØR enhver payout-relatert endring (bongpriser, auto-multiplikator, cap-håndhevelse, spesialspill) |
| [`SPILLKATALOG.md`](./SPILLKATALOG.md) | FØR enhver slug/kategori-endring (markedsføringsnavn vs kode-slug, §11-prosent) |
| [`SPILL_DETALJER_PER_SPILL.md`](./SPILL_DETALJER_PER_SPILL.md) | For per-spill-detaljer (mekanikk, premier, bonus-defaults for hvert av 13 katalog-spillene + Spill 2/3/4 + bonus-mini-spill) |
| [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) | FØR enhver rom-arkitektur-endring (Evolution Gaming-grade mål, R1-R12 pilot-gating) |
| [`PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md) §3 | For full fallgruve-katalog spesifikt om Spill 1/2/3-arkitektur |

---

## 8. For nestemann som ser dette

Hvis du er en ny PM eller agent som starter på Spill 1/2/3:

1. **Les §1 (hovedtabellen)** — det er forskjellene som koster sesjoner hvis du misforstår
2. **Les §5 (anti-mønstre)** — vit hvilke feil tidligere PM-er har gjort
3. **Sjekk dypere doc for spillet du jobber med** (§6)
4. **Sjekk PITFALLS_LOG §3** for full fallgruve-historikk
5. **Hvis tvil mellom kode og doc → doc-en vinner. Fix koden eller eskalér til Tobias**

**Spør Tobias FØR du:**
- Endrer singleton-konstrukten (ETT globalt rom per Spill 2/3)
- Legger til master-rolle for Spill 2/3 (det skal IKKE være master)
- Fjerner master-rolle fra Spill 1 (regulatorisk-tung)
- Endrer §11-distribusjons-prosent
- Endrer phase-state-machine-mekanikk (Spill 3)
- Konverterer Spill 1 til perpetual-loop
- Endrer auto-start-betingelser
- Lager nye gevinstmønstre for Spill 1 (definert som Rad 1-4 + Fullt Hus, immutable)

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-15 | Initial — konsoliderer dupliserte tabeller fra 5+ docs (CLAUDE.md, PM_ONBOARDING_PLAYBOOK, PM_QUICK_REFERENCE, SPILL[1-3]_IMPLEMENTATION_STATUS, PITFALLS_LOG) til én kanonisk kilde. Per Tobias-direktiv 2026-05-15. | PM-AI (Claude Opus 4.7) |
