# Refaktor-plan — Spillorama (pilot-code cleanup)

**Startet:** 2026-04-23
**PM:** Tobias Haugen
**Status:** Fase 1 — beslutnings-låsing

---

## Formål

Etter 62 PR-er landet i løpet av Bølge 2-7 (#313-#376) er pilot-funksjonaliteten komplett. Nå konsoliderer vi kodebasen før den vokser videre, for å unngå:

- **Overlappende ansvar** mellom moduler (samme endring må gjøres på flere steder)
- **Død kode** som ligger igjen fra tidligere iterasjoner (Unity-legacy, gamle varianter)
- **"Functions fighting each other"** — endringer som ikke får effekt fordi flere steder overstyrer

**Mantra:** ingen funksjonalitet tapes, men hver ansvarslinje har ÉN eier.

---

## Prinsipper

1. **Refaktor-only PR-er**: ingen ny funksjonalitet introduseres underveis
2. **Test-parity**: all eksisterende test-suite må passere uendret etter hver PR
3. **Flytting dokumenteres**: commit-message skal eksplisitt si "flyttet X fra A til B, ingen logikk-endring"
4. **Én agent per fil**: ingen parallelle modifikasjoner på samme fil innen én bølge
5. **Rebase tidlig, merge raskt**: conflicts mellom refaktor-PR-er er smertefulle
6. **Dokumentér funksjons-bevaring**: for hver "sletting" må vi vise at funksjonen lever videre andre steder eller er bekreftet ubrukt

---

## PM-beslutninger

### P1.1 Spill 1 pattern-evaluator: in-memory vs schedule — hvem vinner?

**Bakgrunn:**
- `BingoEngine.evaluateActivePhase` + `meetsPhaseRequirement` (L1013, L1276) er in-memory-sporet
- `Game1DrawEngineService.evaluateAndPayoutPhase` + `Game1PatternEvaluator.evaluatePhase` er schedule-sporet
- Begge aktive i prod i dag

**Spørsmål til Tobias:** er alle Spill 1-spill nå schedule-basert i prod? Eller finnes det fortsatt in-memory-rom?

**Status:** ⏸ ÅPEN — trenger PM-svar før PR-C1 kan starte

---

### P1.2 Legacy/Unity-rester — fjern eller behold?

**Bakgrunn:**

Det finnes to adskilte "legacy"-kategorier:

#### Kategori A: Unity WebGL (spill-visning)
- `apps/backend/public/view-game/` — **33 MB Unity WebGL-build** for hall-TV-skjerm-visning
- Kode-rester:
  - `apps/backend/src/index.ts:244` — `pingInterval: 60000` med kommentar "Unity WebGL WebSocket needs longer heartbeat window"
  - `apps/backend/src/platform/PlatformService.ts:92` — `client_variant: 'unity' | 'web' | 'unity-fallback'` enum
  - `apps/backend/src/sockets/adminHallEvents.ts:5` — kommentar "to live in the Unity admin client"
  - 10 filer totalt har `unity|Unity`-referanser
- `.gitignore` L37-38, 61 har Unity-regler
- `README.md` har 4 Unity-referanser

#### Kategori B: Legacy-web-admin (iframe-mount)
- `apps/admin-web/public/legacy-v1/` (184 KB — `index.html` + `app.js`)
- `apps/admin-web/public/legacy-skin/` (2.7 MB — AdminLTE CSS/images)
- Serves via iframe i `LegacySectionMount.ts` for **11 routes**:
  1. `/live/dashboard`
  2. `/live/game-settings`
  3. `/live/games`
  4. `/live/halls`
  5. `/live/hall-display`
  6. `/live/terminals`
  7. `/live/hall-rules`
  8. `/live/wallet-compliance`
  9. `/live/prize-policy`
  10. `/live/room-control`
  11. `/live/payment-requests`

**PM-beslutning (Tobias 2026-04-23):**

> "Vi fjerner alt av gammel unity kode. Eneste som er viktig er at vi ikke mister funksjonalitet, men gammel legacy unity kode skal ikke være med videre"

**Tolkning + plan:**

✅ **Kategori A (Unity WebGL)** — fjern fullstendig:
- Slett `apps/backend/public/view-game/`
- Fjern Unity-kommentarer + `pingInterval`-justering (endre til web-standard verdier)
- Fjern `client_variant`-enum-verdi `"unity" | "unity-fallback"`
- Rens `.gitignore`, `README.md`, `apps/windows/README.md`
- **Funksjons-bevaring**: før fjerning, bekreft at web-basert hall-TV-visning finnes eller lag en. Sannsynlig at Game 1 schedule-sporet allerede har web-TV via admin-web eller game-client.

⚠️ **Kategori B (legacy-web-admin)** — **krever migrering før fjerning**:
- De 11 iframe-routes serverer faktisk admin-funksjonalitet som kjernen bruker daglig
- Før fjerning MÅ hver route migreres til native admin-web
- **Unntak som kan fjernes umiddelbart**: hvis noen av de 11 har blitt erstattet og er duplikater
- Dette krever egen PR-serie (estimat 2-4 PR-er avhengig av overlapp med eksisterende native admin-web)

**Handlingspunkter:**
1. **PR-R2a** (umiddelbart): fjern Unity-kategori A + kode-rester
2. **PR-R2b-M** (hvis migrering av legacy-web-admin): separat PR per route eller bundle i logiske grupper

**Status:** ✅ BESVART, utvidet tolkning gitt

---

### P1.3 Dev-artifacts vs prod-kode

**Bakgrunn:**
- `apps/backend/src/adapters/FileWalletAdapter.ts` (341 LOC) — er dette dev-only eller prod?
- `autoClaimPhaseMode` på variantConfig — permanent på, eller aktiv feature-switch?
- Andre mulige dev-artefakter: `MockPatternSeeder`, test-only endepunkter aktivert i prod?

**Spørsmål til Tobias:** vil du at jeg sjekker hver kandidat og foreslår sletting/beholde før vi begynner?

**Status:** ⏸ ÅPEN — trenger PM-svar eller delegert avklaring

---

## Modul-kart (faktisk state per 2026-04-23)

### Backend-kjerne

| Modul | Størrelse | Ansvar | Refaktor-anbefaling |
|---|---|---|---|
| `BingoEngine.ts` | 3394 LOC | In-memory room-state + lifecycle + draw + mini-game + payout-delegering | **Splitt** (PR-S1) |
| `Game1DrawEngineService.ts` | 1322 LOC | Schedule-Spill 1 draw + pattern-eval | Behold, men parallell med BingoEngine |
| `Game1TicketPurchaseService.ts` | 888 LOC | Schedule-Spill 1 kjøp + refund | Stabil |
| `Game1ScheduleTickService.ts` | 888 LOC | Auto-scheduler-tick | Stabil |
| `Game1MasterControlService.ts` | 962 LOC | Admin master-console | Stabil |
| `Game1PatternEvaluator.ts` | 243 LOC | Pattern-eval for schedule | Gjenbruk PatternMatcher (PR-C1) |
| `PatternMatcher.ts` | 251 LOC | Generisk bit-mask pattern-matcher | Kanonisk owner — bruk overalt |

### Mini-spill

| Modul | Størrelse | Ansvar |
|---|---|---|
| `game/minigames/Game1MiniGameOrchestrator.ts` | — | Orchestrator (M1) |
| `game/minigames/MiniGameWheelEngine.ts` | 357 | Wheel runtime (M2) |
| `game/minigames/MiniGameChestEngine.ts` | 472 | Chest runtime (M3) |
| `game/minigames/MiniGameColordraftEngine.ts` | 556 | Colordraft runtime (M4) |
| `game/minigames/MiniGameOddsenEngine.ts` | 846 | Oddsen runtime (M5) |
| `admin/MiniGamesConfigService.ts` | 320 | Admin-CRUD for mini-game-config |
| `BingoEngine.ts` L2143-2260 | — | **Hardkodet** MINIGAME_PRIZES + ROTATION (dead-duplicate) |

**Kritisk funn:** `BingoEngine.MINIGAME_PRIZES` er hardkodet og leser IKKE fra `MiniGamesConfigService`. Admin-konfig er uten effekt inntil PR-C3.

### Pot-mekanikker (Spor 4)

| Modul | Størrelse | Ansvar |
|---|---|---|
| `game/pot/Game1PotService.ts` | — | Akkumulerende pot-er (T1) |
| `game/pot/PotEvaluator.ts` | — | Generisk pot-vinn-evaluator (T3) |
| `game/pot/PotDailyAccumulationTickService.ts` | — | Jackpott daily-cron (T2) |
| `Game1DrawEngineService.ts` L???? | — | `evaluateAccumulatingJackpotPots` (T2) parallelt med PotEvaluator |
| `Game1JackpotService.ts` | 196 | Gammel fixed-amount-per-farge (PRE-T1) |

**Kritisk funn:** `PotEvaluator.evaluateSinglePot` (T3) og `evaluateAccumulatingJackpotPots` (T2) evaluerer ulike pot-typer parallelt. Flagget som "post-merge cleanup" av T2-agent. **PR-C2 refaktor.**

### Wallet-split

| Modul | Status |
|---|---|
| `WalletAdapter` interface | Stabilt med `{to: "deposit"|"winnings"}` fra W1 |
| `PostgresWalletAdapter` | 829 LOC, stabil |
| `InMemoryWalletAdapter` | Stabil, W3 la til idempotency-støtte |
| `FileWalletAdapter` | 341 LOC — **P1.3 avklar om dev-only** |
| `HttpWalletAdapter` | 400 LOC, stabil |
| `ComplianceLossPort` | Narrow-port fra W5 (BUYIN-logging) |
| `PotSalesHookPort` | Narrow-port fra T3 |

### Fysisk bong

| Modul | Status |
|---|---|
| `compliance/StaticTicketService.ts` | Stabil fra PT1 |
| `compliance/AgentTicketRangeService.ts` | Utvidet i PT2-PT3-PT5 |
| `compliance/PhysicalTicketService.ts` | **1756 LOC** — for stor, kandidat for splitt (PR-S2) |
| `compliance/PhysicalTicketPayoutService.ts` | Fra PT4 |

### Problem-filer (størrelse-ordrede)

| Fil | LOC | Problem |
|---|---|---|
| `BingoEngine.ts` | 3394 | God-class, mange ansvar |
| `routes/admin.ts` | 2025 | "Dumping ground" |
| `shared-types/schemas.ts` | 1813 | Zod-alt-i-ett |
| `compliance/PhysicalTicketService.ts` | 1756 | Vokst gjennom PT1-PT5 |
| `game/ComplianceLedger.ts` | 1473 | Grenser mot god-class |
| `sockets/gameEvents.ts` | 1285 | 30+ handlere |
| `compliance/LoyaltyService.ts` | 1147 | Grenser mot god-class |
| `game/ComplianceManager.ts` | 1103 | Regulatorisk kjerne |

### Admin-web

- 32 page-submapper, stort sett velstrukturert
- `LegacySectionMount.ts` → **11 iframe-routes** (se P1.2)
- `otherGames/` har 4 separate pages (ColorDraftPage, MysteryGamePage, TreasureChestPage, WheelOfFortunePage) — kan konsolideres (PR-A1)
- PT6 leverte 4 nye sider for fysisk-bong — stabile

### Game-client

- `Game1Controller.ts` 502 LOC — ikke god-class, akseptabel
- 14 overlay-komponenter, største 483 LOC — akseptabel
- M6 (#374) leverte 4 omdøpte overlays på ny protokoll

---

## Cross-cutting red flags (prioritets-sortert)

### 🔴 Kritisk — må fikses før videre utvikling

1. **Mini-game runtime leser ikke admin-config** (`BingoEngine.MINIGAME_PRIZES` hardkodet) — **PR-C3**
2. **Pot-evaluator dobbel-implementasjon** (T2 + T3) — **PR-C2**
3. **M6 backend socket-wire mangler** (orchestrator emitter ingen events til klient) — **PR-C4**

### 🟡 Høy — teknisk gjeld

4. **Pattern-evaluering i 3 parallelle systemer** (BingoEngine + Game1PatternEvaluator + PatternMatcher) — **PR-C1** (forutsetter P1.1)
5. **Idempotency-keys 4+ konvensjoner** — **PR-N1**
6. **`routes/admin.ts` 2025 LOC dumping-ground** — **PR-R1**

### 🟢 Middels — ryddejobb

7. **`shared-types/schemas.ts` 1813 LOC** splittes per domene — **PR-R3**
8. **`sockets/gameEvents.ts` 1285 LOC** splittes per event-cluster — **PR-R4**
9. **`BingoEngine.ts` 3394 LOC** splittes — **PR-S1**
10. **`PhysicalTicketService.ts` 1756 LOC** splittes — **PR-S2**
11. **`ComplianceLedger.ts` 1473 LOC** splittes — **PR-S3**

### 🔵 Lav — kosmetisk / ytre

12. **Unity-rester fjernes** (PM låst) — **PR-R2a**
13. **Legacy-web-admin migreres** (PM låst, migrering før sletting) — **PR-R2b-M-serie**
14. **`otherGames/` konsolideres** — **PR-A1**
15. **FileWalletAdapter relevans** — avhenger av P1.3

---

## Fase-struktur (revidert basert på PM-beslutninger)

### Fase 1 ✅ — Kartlegging + beslutnings-låsing (denne doc)

- [x] Arkitektur-audit
- [x] P1.2 Unity-beslutning låst (fjern)
- [ ] P1.1 in-memory vs schedule
- [ ] P1.3 dev-artifacts

### Fase 2 — Ryddejobber (lav risiko, parallelliserbar)

Når P1.2 er låst (✅):
- **PR-R1**: Splitt `routes/admin.ts`
- **PR-R2a**: Fjern Unity-kategori A + kode-rester
- **PR-R2b-M1** til **-M4**: Migrer legacy-web-admin routes (serie, avhenger av scope)
- **PR-R3**: Splitt `shared-types/schemas.ts`
- **PR-R4**: Splitt `sockets/gameEvents.ts`

Kan kjøres 4 parallelle agenter (hver på sin fil).

### Fase 3 — Parallelle implementasjoner konsolideres (sekvensiell, rekkefølge-kritisk)

- **PR-C1**: Pattern-evaluator konsolidering (krever P1.1)
- **PR-C2**: Pot-evaluator konsolidering (selvstendig)
- **PR-C3**: Mini-game runtime leser admin-config (selvstendig)
- **PR-C4**: M6 backend socket-wire (selvstendig, kritisk for klient)

### Fase 4 — Modul-splittinger (etter Fase 3, full test-suite)

- **PR-S1**: Splitt BingoEngine
- **PR-S2**: Splitt PhysicalTicketService
- **PR-S3**: Splitt ComplianceLedger

### Fase 5 — Idempotency + narrow-port-konvensjon

- **PR-N1**: Sentraliser idempotency-keys

### Fase 6 — Admin-web cleanup

- **PR-A1**: Konsolidér `otherGames/` → én generisk admin-side

---

## Sporings-logg (PM-handlinger)

| Dato | Handling | Status |
|---|---|---|
| 2026-04-23 | Arkitektur-audit kjørt | ✅ |
| 2026-04-23 | P1.2 Unity-beslutning låst: fjern A + migrér B før sletting | ✅ |
| — | P1.1 Spill 1 evaluator-eier | ⏸ |
| — | P1.3 dev-artifacts | ⏸ |

---

## Definition of Done per fase

**Fase 1:** Denne doc-en merget + ubesvarte beslutninger eskaleret til Tobias.

**Fase 2:** Alle filer omtalt er splittet/flyttet. Unity A er borte. Legacy-B er migrert eller dokumentert utsatt. Backend tsc + test-suite grønt.

**Fase 3:** Ingen parallelle implementasjoner av samme logikk. Admin-config leses av runtime. M6 socket-flyt fungerer end-to-end.

**Fase 4:** Ingen backend-fil > 1500 LOC (unntak: aksepterte domene-kjerner som ComplianceLedger hvis splittet non-trivielt).

**Fase 5:** Én kanonisk `IdempotencyKeys`-modul. Alle 4+ konvensjoner konsolidert.

**Fase 6:** Admin-web: hver mini-game-type har felles editor. Ingen 1-til-1-duplikat-pages.

---

## Risiko + mitigasjon

| Risiko | Mitigasjon |
|---|---|
| Refaktor introduserer skjulte bugs | Full test-suite må passere etter hver PR. Rapportér forskjell i test-tall. |
| Parallelle PR-er skaper merge-konflikter | Én agent per fil. Merge så raskt som mulig etter grønn CI. |
| Unity-fjerning brekker hall-TV-visning | Manuel QA + bekreft at web-TV-visning er komplett FØR fjerning |
| Legacy-web-admin fjernes for tidlig | Separat migrerings-PR per route. Feature-parity-checklist per route før sletting. |
| God-class-splitting gir for store diffs | Del i sub-PR-er hvis én PR > 1500 LOC diff. |
| Auditor-misvisning | Agent må kjøre i main-worktree, ikke PM-session. Dokumenter verifisert base-branch i hver PR-body. |
