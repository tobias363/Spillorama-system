# Next Game Display — Agent A — Frontend rendering paths

**Branch:** `research/next-game-display-a-frontend-2026-05-14`
**Agent:** A (Frontend rendering paths)
**Mandat:** Map ut hver frontend-fil som rendrer "neste spill"-tekst eller "Start neste spill"-knapper. **Ikke fikse — bare mappe.**
**Sesjon:** 2026-05-14
**Slottes inn i:** `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md` §3.3

---

## 1. Executive summary

**Funn:** Det finnes **6 aktive UI-paths** som rendrer eller bruker "neste spill"-strenger i frontend-laget, fordelt på 4 forskjellige datakilder. Bølge 1-3-konsolideringen (2026-05-08) reduserte ID-konfliktene mellom plan-run-id og scheduled-game-id, men selve "hvilken catalog-display-name skal vises i hvilken state"-logikken er fortsatt DUPLISERT i frontend istedenfor sentralisert i én helper.

**Hovedproblem-områder:**

1. **`getMasterHeaderText`-helper i Spill1HallStatusBox.ts:1456** har 8 forskjellige header-strenger basert på state, men bruker `data.catalogDisplayName` direkte fra `planMeta` — uten å sjekke om plan-run faktisk har neste position. Mapping fungerer for §3.13 (finished plan-run viser neste item), men kun fordi backend pre-computer `positionForDisplay = rawPosition + 1` i `GameLobbyAggregator.buildPlanMeta()`. Hvis backend-logikken brytes (eks. nytt §3.x-fix lander), faller frontend tilbake til SISTE ferdigspilt-name uten å detektere det.

2. **`NextGamePanel.ts` har EGEN translator `mapLobbyToLegacyShape`** (linje 591-642) som overstyrer `currentGame.subGameName = lobby.planMeta?.catalogDisplayName`. Hvis aggregator returnerer `planMeta=null` (eks. plan-run uten plan-coverage), faller `subGameName` til tom streng `""`. Spill1AgentStatus.ts:85 renderer da `<h3>Spill 1 — </h3>` (tomt) istedenfor "Bingo"-fallback.

3. **`Spill1AgentControls.ts:120` har EGEN Start-label-bygging** med `currentGame.customGameName ?? currentGame.subGameName`. Hvis subGameName er tom (jfr. punkt 2), vises "Start neste spill — " (ingen navn). Mangler defensiv fallback til "Bingo".

4. **`Game1Controller.ts:619 + 2504` i game-client har EGEN fallback** `state?.nextScheduledGame?.catalogDisplayName ?? "Bingo"` for BuyPopup-subtitle. Bruker `Spill1LobbyState.nextScheduledGame` (public lobby-endpoint), ikke `Spill1AgentLobbyState.planMeta` (auth aggregator). To forskjellige wire-formater → to forskjellige `catalogDisplayName`-felter → samme display men separate computation-paths.

5. **`LobbyFallback.ts:328` renderer "Neste spill: {name}"** med tilsvarende fallback. Brukes når `socket.createRoom` feiler (R1/BIN-822). Identisk logikk som Game1Controller.

6. **`NextGamePanel.renderSpill1Block` (linje 679-746)** kaller BÅDE `renderSpill1AgentStatus` OG `renderSpill1AgentControls`, der begge konsumerer `currentGame.subGameName` independent. Hvis subGameName er tom i én, må endringen propageres til andre — det skjer ikke automatisk fordi de leser fra samme `Spill1CurrentGameResponse`-shape (etter translator).

**Konklusjon:** Frontend ER ferdig migrert til `currentScheduledGameId` som single id-rom (Bølge 3 leverte det), men "neste spill"-display er IKKE konsolidert. Hver komponent bygger sin egen tekst-streng fra forskjellige felt-kombinasjoner. Fallback "Bingo" finnes i kun 1 av 6 paths.

---

## 2. File-list (full kall-graf)

### 2.1 Aktive paths (rendrer "Neste spill"-tekst eller "Start neste spill"-knapp)

| # | Fil | Linje(r) | Hva rendres | Datakilde | Fallback |
|---|---|---|---|---|---|
| 1 | `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` | 692-693, 694, 763, 1288-1290, 1456-1515 | Header `<h3>` på master-konsoll, Start-knapp-label, alle state-baserte header-strenger | `Spill1AgentLobbyState.planMeta.catalogDisplayName` via `data.catalogDisplayName` (linje 364) | INGEN — `safeName ? ... : "Neste spill"` (kun generisk fallback uten navn) |
| 2 | `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` | 591-642 (translator), 700-712 (idle-render), 714-746 (active-render) | `<h3>Spill 1 — venter på neste runde</h3>` (idle), delegerer til Spill1AgentStatus+Controls (active) | `mapLobbyToLegacyShape(lobby)` setter `currentGame.subGameName = lobby.planMeta?.catalogDisplayName ?? ""` (linje 620) | INGEN — tom streng faller gjennom til child-komponenter |
| 3 | `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts` | 120-123, 134-167 | `<button>Start neste spill — {name}</button>` | `currentGame.customGameName ?? currentGame.subGameName` | INGEN — `nextGameName ? ... : "Start neste spill"` (faller til generisk uten navn) |
| 4 | `apps/admin-web/src/pages/agent-portal/Spill1AgentStatus.ts` | 85, 104 | `<h3>Spill 1 — {displayName}</h3>` (game-info-box) | `currentGame.customGameName ?? currentGame.subGameName` | INGEN — vises som tom streng hvis subGameName er "" |
| 5 | `packages/game-client/src/games/game1/Game1Controller.ts` | 619, 2504 | BuyPopup subtitle "{name}" via `playScreen.setBuyPopupDisplayName()` | `state?.nextScheduledGame?.catalogDisplayName` (Spill1LobbyState, ikke aggregator) | "Bingo" (hardkodet — eneste fallback i frontend som har dette) |
| 6 | `packages/game-client/src/games/game1/logic/LobbyFallback.ts` | 320-329 | Body-text på fallback-overlay: "Neste spill: {name}." | `state.nextScheduledGame.catalogDisplayName` (public lobby-endpoint) | "Venter på neste spill." (generisk uten navn) |

### 2.2 Supporting helpers

| Fil | Linje | Rolle |
|---|---|---|
| `apps/admin-web/src/api/agent-game1.ts` | 294-308 | `fetchLobbyState(hallId, opts)` — kanonisk single-source-call mot aggregator (Bølge 3). Returnerer `Spill1AgentLobbyState` med Zod-validering |
| `apps/admin-web/src/api/agent-game1.ts` | 56-68 | `Spill1CurrentGame.subGameName: string` — legacy wire-shape som NextGamePanel translatorer til |
| `apps/admin-web/src/api/agent-game-plan.ts` | 77-92 | `AgentGamePlanCurrentResponse.currentItem.catalogEntry.displayName` (legacy/deprecated; brukes fortsatt av JackpotSetupModal-fetcher i Spill1HallStatusBox:1630 + NextGamePanel:1251) |
| `apps/admin-web/src/api/agent-next-game.ts` | 26-53 | `AgentRoomSummary.currentGame.gameSlug` — Spill 2/3 rom-kode paradigme (IKKE Spill 1) |
| `packages/game-client/src/games/game1/logic/LobbyStateBinding.ts` | 182-186 | `getCatalogDisplayName()`: helper med "Bingo" fallback — KUN brukt av game-client-internal (ikke admin-web) |
| `packages/shared-types/src/api.ts` | 111-155 | `Spill1LobbyNextGame.catalogDisplayName: string` — public wire (game-client) |
| `packages/shared-types/src/spill1-lobby-state.ts` | 263 | `Spill1PlanMeta.catalogDisplayName: string` — auth aggregator wire (admin-web) |
| `apps/backend/src/game/GameLobbyAggregator.ts` | 971-1070 | `buildPlanMeta` — beregner `positionForDisplay = rawPosition + 1` for finished plan-run + `currentPosition < items.length` (§3.13) |

### 2.3 Inactive / deprecated paths (referert men ikke i live rendering)

| Fil | Status |
|---|---|
| `apps/admin-web/src/api/agent-game-plan-adapter.ts` | SLETTET i Bølge 3 (2026-05-08) |
| `apps/admin-web/src/api/agent-master-actions.ts` | SLETTET i Bølge 3 |
| `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` | **Renderer `<h3>{game.customGameName ?? game.subGameName}</h3>` på linje 330 — men dette er admin direct-edit-konsoll (uten plan), ikke "neste spill"-display. Inkludert for fullstendighet** |

---

## 3. Kall-graf (datakilde → frontend-render)

```
                               ┌──────────────────────────────────┐
                               │  PUBLIC LOBBY ENDPOINT            │
                               │  GET /api/games/spill1/lobby?     │
                               │      hallId=X                      │
                               │  Wire: Spill1LobbyState            │
                               │       .nextScheduledGame.          │
                               │       catalogDisplayName: string   │
                               └────────────┬─────────────────────┘
                                            │
                ┌───────────────────────────┴──────────────────────┐
                │                                                   │
                ▼                                                   ▼
   ┌──────────────────────────┐                  ┌──────────────────────────────┐
   │ game-client              │                  │ admin-web (cash-inout)        │
   │ Game1Controller          │                  │ (ikke direkte — bruker        │
   │ .lobbyStateBinding       │                  │  AGENT-aggregator-endpoint)   │
   │ + Game1LobbyFallback     │                  │                                │
   └──────────┬───────────────┘                  └──────────────────────────────┘
              │
              ├─► onChange(state) → state?.nextScheduledGame?.catalogDisplayName ?? "Bingo"
              │   → playScreen.setBuyPopupDisplayName(name)   [Game1Controller:619]
              │   → playScreen.setBuyPopupTicketConfig(tc)    [Game1Controller:629]
              │
              └─► Game1LobbyFallback.describeStateBody(state)
                  → "Neste spill: {name}."                    [LobbyFallback.ts:328]


                               ┌──────────────────────────────────┐
                               │  AUTH AGGREGATOR ENDPOINT         │
                               │  GET /api/agent/game1/lobby?      │
                               │      hallId=X                      │
                               │  Wire: Spill1AgentLobbyState       │
                               │       .planMeta.catalogDisplayName │
                               │       .currentScheduledGameId      │
                               │       .scheduledGameMeta.status    │
                               └────────────┬─────────────────────┘
                                            │
                                            ▼
                               ┌──────────────────────────────┐
                               │ fetchLobbyState(hallId)       │
                               │ in agent-game1.ts             │
                               │ (parser + Zod-validering)     │
                               └────────────┬─────────────────┘
                                            │
                  ┌─────────────────────────┴────────────────────────────┐
                  │                                                       │
                  ▼                                                       ▼
   ┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
   │ Spill1HallStatusBox.refresh()        │         │ NextGamePanel.refreshSpill1()        │
   │ (cash-inout box 3, polling 2s)       │         │ (agent-portal, polling 5s)           │
   │                                       │         │                                       │
   │ → mapLobbyToView(lobby) (linje 357)  │         │ → mapLobbyToLegacyShape(lobby)        │
   │   data.catalogDisplayName             │         │   currentGame.subGameName =           │
   │     = planMeta?.catalogDisplayName    │         │     planMeta?.catalogDisplayName      │
   │     ?? null                           │         │     ?? ""  ⚠️ TOM STRENG-FALLBACK    │
   │   data.scheduledGameStatus            │         │                                       │
   │     = scheduledGameMeta?.status       │         │   currentGame.id =                    │
   │     ?? null                           │         │     lobby.currentScheduledGameId      │
   │                                       │         │                                       │
   └────────────┬─────────────────────────┘         └────────────┬────────────────────────┘
                │                                                  │
                ▼                                                  ▼
   ┌────────────────────────────────────┐         ┌──────────────────────────────────────┐
   │ getMasterHeaderText(state, name)    │         │ renderSpill1Block (linje 679-746)    │
   │ (linje 1456-1515)                   │         │                                       │
   │                                      │         │ if (!spill1.currentGame):             │
   │ Mapping per state:                  │         │   → "<h3>Spill 1 — venter på neste   │
   │   running   → "Aktiv trekning - X"  │         │     runde</h3>"   ⚠️ INGEN navn       │
   │   paused    → "Pauset: X"           │         │                                       │
   │   scheduled,                        │         │ else (active):                        │
   │   purchase_open,                    │         │   → renderSpill1AgentStatus(...)      │
   │   ready_to_start → "Klar til å      │         │     → "<h3>Spill 1 — {subGameName}    │
   │     starte: X"                       │         │       </h3>" via                      │
   │   completed,                        │         │       currentGame.customGameName      │
   │   cancelled → "Runde ferdig: X"     │         │       ?? subGameName                  │
   │   idle (default) →                  │         │   → renderSpill1AgentControls(...)    │
   │     "Neste spill: X" eller          │         │     → "Start neste spill — {name}"   │
   │     "Neste spill" hvis X mangler    │         │       med samme fallback              │
   └─────────────────────────────────────┘         └──────────────────────────────────────┘
                                                                    ▲
                                                                    │
                                                                    │ KRITISK:
                                                                    │ NextGamePanel og
                                                                    │ Spill1HallStatusBox bruker
                                                                    │ SAMME aggregator-endpoint
                                                                    │ men DIFFERENT translator-
                                                                    │ logikk. Hvis aggregator
                                                                    │ endrer planMeta-fallback
                                                                    │ (eks. setter null
                                                                    │ istedenfor å klampe), så
                                                                    │ vil de to UI-flatene
                                                                    │ divergere i tomstreng-håndtering.
```

---

## 4. State-overganger × forventet display per komponent

Lest fra koden — slik som den faktisk virker per 2026-05-14.

### 4.1 Spill1HallStatusBox `getMasterHeaderText(state, gameName)` (linje 1456-1515)

| `scheduledGameStatus` (state-input) | `gameName` (planMeta.catalogDisplayName) | Forventet render | Fallback hvis name=null |
|---|---|---|---|
| `null` (ingen scheduled-game) | `"Bingo"` | "Neste spill: Bingo" | "Neste spill" |
| `idle` (fallback for unknown state) | `"Bingo"` | "Neste spill: Bingo" | "Neste spill" |
| `scheduled` | `"Bingo"` | "Klar til å starte: Bingo" | "Klar til å starte" |
| `purchase_open` | `"Bingo"` | "Klar til å starte: Bingo" | "Klar til å starte" |
| `ready_to_start` | `"Bingo"` | "Klar til å starte: Bingo" | "Klar til å starte" |
| `running` | `"Bingo"` | "Aktiv trekning - Bingo" | "Aktiv trekning" |
| `paused` | `"Bingo"` | "Pauset: Bingo" | "Pauset" |
| `completed` | `"Bingo"` | "Runde ferdig: Bingo" | "Runde ferdig" |
| `cancelled` | `"Bingo"` | "Runde ferdig: Bingo" | "Runde ferdig" |
| `plan_completed_for_today` | (ignorert) | "Spilleplan ferdig for i dag" / "Spilleplan ferdig for i dag — neste plan: HH:MM neste dag" hvis `nextOpeningTime` satt | (samme) |
| `closed` / `outside_opening_hours` | (ignorert) | "Stengt" / "Stengt — åpner HH:MM" hvis `nextOpeningTime` satt | (samme) |

**Funn:** Helperen er pure og state-aware (god). Men `gameName=null`-fallback gir generisk tekst uten "Bingo"-fallback. Backend `planMeta.catalogDisplayName` er typed `z.string()` (ikke nullable i Zod), så `null` skal aldri komme på wire — men hvis `planMeta` er null på top-level, mapper Spill1HallStatusBox til `catalogDisplayName: null` (linje 364). Da rendres "Neste spill" uten "Bingo".

### 4.2 NextGamePanel `renderSpill1Block` (idle-state, linje 686-712)

| `spill1.currentGame` | `spill1.halls[]` | Forventet render |
|---|---|---|
| `null` AND `halls.length === 0` | tom | return "" (ingen block) |
| `null` AND `halls.length > 0` | har haller | "Spill 1 — venter på neste runde" + hall-pills. **INGEN catalogDisplayName** vises. |

**Funn:** Idle-state header er hardkodet "venter på neste runde" — viser ALDRI planMeta.catalogDisplayName. Master ser ikke hvilket spill som er neste når ingen scheduled-game eksisterer enda. Avviker fra Spill1HallStatusBox-idle-state (som via `idleTitleHtml = getMasterHeaderText("idle", idleNextGameName)` viser "Neste spill: Bingo").

### 4.3 NextGamePanel `renderSpill1Block` (active-state, linje 713-745)

Når `spill1.currentGame !== null`:

→ Delegerer til `renderSpill1AgentStatus({...})` og `renderSpill1AgentControls({...})`.

**Resultat:**
- `Spill1AgentStatus` header: `<h3>Spill 1 — {currentGame.customGameName ?? currentGame.subGameName}</h3>`
- `Spill1AgentControls` Start-knapp: `<button>Start neste spill — {customGameName ?? subGameName}</button>` (eller "Start neste spill" hvis tomt)

Hvis `subGameName === ""` (fra translator-fallback) → header viser `"<h3>Spill 1 — </h3>"` (visuell bug men aldri fikset).

### 4.4 Spill1AgentControls.ts (linje 120-167)

| `currentGame.status` | `nextGameName` (customGameName ?? subGameName) | Forventet Start-label |
|---|---|---|
| `purchase_open` / `ready_to_start` | `"Bingo"` | "Start neste spill — Bingo" (canStart=true) |
| `purchase_open` / `ready_to_start` | `""` (tom) | "Start neste spill" (faller til generisk) |
| `purchase_open` / `ready_to_start` | `null`/`undefined` | "Start neste spill" |
| `scheduled` | (uavhengig) | disabled, tooltip "Start blir tilgjengelig når purchase-vinduet åpner (kl HH:MM)" |
| `running` | (uavhengig) | disabled, tooltip "Spillet kjører allerede" |
| `paused` | (uavhengig) | disabled, tooltip "Spillet er pauset — bruk Resume i stedet" |
| `completed` / `cancelled` | (uavhengig) | disabled |

**Funn:** Hvis `subGameName === ""` (translator-fallback), faller Start-label til generisk "Start neste spill" uten navn. Master vet ikke hvilket spill som starter.

### 4.5 Spill1AgentStatus.ts (linje 81-141)

Renderer game-info-box med:
- `<h3>Spill 1 — {customGameName ?? subGameName}</h3>` (linje 104, escapeHtml-wrapped)

Hvis subGameName er tom, viser "Spill 1 — " (med trailing-space).

### 4.6 Game1Controller (game-client, linje 614-644 + 2498-2521)

| `lobbyState?.nextScheduledGame?.catalogDisplayName` | BuyPopup display-navn |
|---|---|
| `"Bingo"` (normal) | "Bingo" |
| `"1000-spill"` | "1000-spill" |
| `undefined` (state null eller nextScheduledGame null) | **"Bingo"** ← hardkodet fallback (linje 619, 2504) |

**Funn:** game-client har den BESTE fallback-håndteringen — "Bingo" som default-tekst. Resten av admin-web mangler dette.

### 4.7 LobbyFallback.ts (linje 320-333)

Renderer overlay-body avhengig av `overallStatus`:

| `state.overallStatus` | `state.nextScheduledGame` | Body-text |
|---|---|---|
| `closed` | (uavhengig) | "Åpningstid: HH:MM–HH:MM." / "Hallen er stengt." |
| `finished` | (uavhengig) | "Spilleplanen er ferdig for dagen. Kom tilbake i morgen!" |
| (annet) | `{name: "Bingo", scheduledStartTime: "..."}` | "Neste spill: Bingo (om 5 min)." |
| (annet) | `{name: "Bingo"}` (uten startTime) | "Neste spill: Bingo." |
| (annet) | `null` med openingTimeEnd | "Hallen er åpen til HH:MM." |
| (annet) | `null` uten openingTimeEnd | "Venter på neste spill." (generisk) |

**Funn:** Pure logikk, men det er FREMDELES et FJERDE sted som builder "Neste spill: X"-streng (etter Spill1HallStatusBox, NextGamePanel-idle + active, Game1Controller).

---

## 5. Identifiserte bugs / edge-cases

### 5.1 BUG #A1 — NextGamePanel idle-state viser ikke catalogDisplayName

**Severity:** P1 (UX-inkonsistens)
**Reprodusér:**
1. `dev:nuke` → ingen scheduled-game eksisterer
2. Open `/admin/agent/games` (NextGamePanel)
3. Expected: "Spill 1 — venter på Bingo" (eller tilsvarende med catalogDisplayName)
4. Faktisk: "Spill 1 — venter på neste runde" (linje 703)

**Root cause:** `renderSpill1Block` linje 700-712 har egen idle-render som ignorerer `lobby.planMeta?.catalogDisplayName`. Branchen ble lagt til 2026-05-03 (Tobias UX) men ble ikke oppdatert da §3.13 introduserte plan-aware "neste spill"-vising i Spill1HallStatusBox.

**Fix-anbefaling:** Bytt linje 703-704 til:
```typescript
const nextName = spill1Lobby?.planMeta?.catalogDisplayName ?? "Bingo";
return `<h3>Spill 1 — venter på ${escapeHtml(nextName)}</h3>`;
```

(Krever `spill1Lobby`-prop på state — i dag er det `state.spill1` som er den translatert legacy-shape uten direkte tilgang til `planMeta`.)

### 5.2 BUG #A2 — Translator faller til tom streng istedenfor "Bingo"

**Severity:** P1 (visuell-bug — "<h3>Spill 1 — </h3>" rendres som "Spill 1 —")
**Reprodusér:**
1. Aggregator returnerer state der `planMeta === null` (eks. plan-run eksisterer men plan-id ikke finnes — race-condition under stale-cleanup)
2. NextGamePanel kjører `mapLobbyToLegacyShape(lobby)` linje 620: `subGameName = lobby.planMeta?.catalogDisplayName ?? ""`
3. Spill1AgentStatus renderer `<h3>Spill 1 — </h3>` (linje 104)
4. Spill1AgentControls renderer `<button>Start neste spill</button>` (uten "— Bingo")

**Root cause:** Translator-fallback er tom streng `""` (linje 620) istedenfor "Bingo". Pre-Bølge-3 var det adapter som maskerte denne med plan-run-id-fallback; etter Bølge 3 er fallbacken stripped helt vekk.

**Fix-anbefaling:** Linje 620 endres til:
```typescript
const subGameName = lobby.planMeta?.catalogDisplayName ?? "Bingo";
```

(Defensiv default — matcher game-client og Spill1HallStatusBox-idle-path.)

### 5.3 BUG #A3 — getMasterHeaderText har ingen "Bingo"-fallback

**Severity:** P2 (kosmetisk — "Neste spill" istedenfor "Neste spill: Bingo")
**Reprodusér:**
1. Idle-state der `data.catalogDisplayName === null` (eks. aggregator returnerer `planMeta=null`)
2. `getMasterHeaderText("idle", null)` returnerer `"Neste spill"` (uten navn — linje 1513)
3. Master ser bare "Neste spill" uten å vite hvilket spill

**Root cause:** Helper-funksjonen (linje 1488-1489) bruker `gameName ? ... : null` for å bygge `safeName`. Hvis navn er null/tom, brukes generisk tekst uten "Bingo"-fallback.

**Fix-anbefaling:** Endre `gameName`-parameteren til å default-e til "Bingo" når falsy:
```typescript
const safeName = gameName ? escapeHtml(gameName) : "Bingo";
const nameSuffix = `: ${safeName}`;
```

ELLER caller (idle-path linje 692) må sende `data.catalogDisplayName ?? "Bingo"` istedenfor `data.catalogDisplayName`.

### 5.4 BUG #A4 — Spill1AgentControls bruker `currentGame.customGameName` som override

**Severity:** P3 (potensielt forvirrende)
**Observasjon:** Linje 120: `const nextGameName = currentGame.customGameName ?? currentGame.subGameName;`

`customGameName` er populert fra backend `scheduledGame.custom_game_name`-kolonnen (legacy admin-override). I plan-flow er denne ALLTID null (translator setter den til null på linje 628). Men hvis legacy daily-schedule-pathen spawner med custom name, vil DEN navne vises i Start-label istedet for plan-catalog-navnet.

**Fix-anbefaling:** Definer kanonisk display-navn-resolver:
```typescript
// I aggregator: returner kanonisk effectiveDisplayName som ALLE caller bruker
planMeta.catalogDisplayName  // alltid plan-runtime
// IKKE custom_game_name fra legacy scheduled_game
```

eller introduser en `getDisplayName(currentGame)` helper i shared.

### 5.5 BUG #A5 — Game1MasterConsole (admin) bruker en TREDJE datakilde

**Severity:** P3 (admin direct-edit har egen rendering)
**Observasjon:** `Game1MasterConsole.ts:330` rendrer `<h3>${escapeHtml(game.customGameName ?? game.subGameName)}</h3>` fra `Game1GameDetail.game`.

Dette er admin direct-edit-vy (`/admin/#/games/master/:id`) som henter via `fetchGame1Detail(gameId)` — IKKE via aggregator. Skiller seg fra agent-portal og cash-inout. Ikke en bug i seg selv, men en tredje display-path som må holdes synkronisert.

**Fix-anbefaling:** Behold uendret (per audit §4.3 R2 i forrige fundament-audit), men dokumenter at det er ANY admin-flow uten plan-bevissthet.

### 5.6 EDGE-CASE #A6 — Hva skjer hvis lobby-API returnerer nextGame=null men plan har items

**Reprodusér:**
- Plan-run.status='finished', currentPosition=13, plan.items.length=13 (helt ferdig)
- Aggregator `buildPlanMeta` clamps `positionForDisplay = Math.min(13, 13) = 13`
- `planMeta.catalogDisplayName = items[12].displayName` ("tv-extra")

UI ser "Neste spill: tv-extra" — selv om planen er HELT ferdig. Skal vise "Spilleplan ferdig" istedenfor.

**Hvor faller frontend mellom paths:**
- `Spill1AgentLobbyState`-skjemaet har IKKE `planCompletedForToday`-flag (kun `Spill1LobbyState` har det — linje 191 i api.ts)
- Aggregator returnerer NORMAL planMeta uten å signalisere "plan helt ferdig"-state
- Frontend kan ikke skille mellom "neste spill er tv-extra" og "tv-extra var siste, planen er ferdig" basert på aggregator-data alene
- `getMasterHeaderText` har dedikert state `plan_completed_for_today` (linje 1402), men IKKE callere som sender den

**Fix-anbefaling:** Aggregator skal eksponere `planCompletedForToday`-flag også på `Spill1AgentLobbyState`. Caller-paths (Spill1HallStatusBox.refresh) må sjekke flagget og sende `"plan_completed_for_today"` til `getMasterHeaderText` istedenfor å bruke `scheduledGameStatus`.

### 5.7 EDGE-CASE #A7 — DUAL_SCHEDULED_GAMES warning blokkerer rendering

**Reprodusér:**
- Aggregator har `inconsistencyWarnings: ["DUAL_SCHEDULED_GAMES"]` (race-condition mellom bridge + legacy spawn)
- Spill1HallStatusBox viser warning-banner OG forsøker å rendre header med stale data
- `scheduledGameMeta` og `planMeta` kan være ut av synk

**Hvor faller frontend mellom paths:** Frontend lar warning-banner stå over hovedinnholdet, men UI-en oppdaterer fortsatt header-tekst med stale data. Master må manuelt klikke "🧹 Rydde stale plan-state" (linje 935-938) for å rydde.

**Fix-anbefaling:** Ved `DUAL_SCHEDULED_GAMES` skal header-render skippe og vise "Inkonsistens — krever opprydning"-tekst. Backend bør også blokkere `MasterActionService.start` ved warning (det gjør den allerede per `BLOCKING_WARNING_CODES`).

---

## 6. Recommendations — single source of truth for "neste spill"-display

### 6.1 Anbefalt arkitektur

**EN authoritative service eier "hva skal vises som neste spill"-logikken.** Ikke spredt over 6 UI-paths.

#### Forslag A: Utvid `GameLobbyAggregator` med pre-computed display-state

Legg til et nytt felt på `Spill1AgentLobbyState`:

```typescript
export const Spill1NextGameDisplaySchema = z.object({
  /** Catalog-slug for det som skal vises som neste spill. */
  catalogSlug: z.string().nullable(),
  /** Display-navn. ALDRI null — fallback til "Bingo" hvis ingen plan. */
  catalogDisplayName: z.string(),
  /** Plan-posisjon (1-basert). Null hvis ingen plan dekker. */
  position: z.number().int().positive().nullable(),
  /** `true` hvis spilleplanen er HELT fullført — UI skal vise "ferdig"-banner. */
  planCompletedForToday: z.boolean(),
  /** Stabil reason-kode for diagnose. */
  reason: z.enum([
    "next_in_sequence",      // Normal — neste plan-item
    "plan_completed",         // Spilleplan helt ferdig
    "no_plan_run",            // Ingen plan-run eksisterer ennå (pre-start)
    "no_plan_for_today",      // Hallen er ikke i en plan for i dag
    "closed",                 // Utenfor åpningstid
  ]),
});

// På Spill1AgentLobbyStateSchema (top-level):
nextGameDisplay: Spill1NextGameDisplaySchema,
```

**Aggregator-logikk** (i `GameLobbyAggregator.buildPlanMeta` eller ny `buildNextGameDisplay`):

```typescript
function buildNextGameDisplay(
  planRun: GamePlanRun | null,
  plan: GamePlanWithItems | null,
  isWithinOpeningHours: boolean,
): Spill1NextGameDisplay {
  // 1) Closed / outside opening hours
  if (!isWithinOpeningHours) {
    return {
      catalogSlug: null,
      catalogDisplayName: "Bingo",   // fallback for fallback-tekst
      position: null,
      planCompletedForToday: false,
      reason: "closed",
    };
  }

  // 2) Ingen plan dekker (hallen ikke i GoH med plan)
  if (!plan || plan.items.length === 0) {
    return {
      catalogSlug: null,
      catalogDisplayName: "Bingo",
      position: null,
      planCompletedForToday: false,
      reason: "no_plan_for_today",
    };
  }

  // 3) Plan helt ferdig (currentPosition >= items.length)
  if (planRun?.status === "finished" && planRun.currentPosition >= plan.items.length) {
    return {
      catalogSlug: plan.items[plan.items.length - 1].catalogEntry.slug,
      catalogDisplayName: plan.items[plan.items.length - 1].catalogEntry.displayName,
      position: plan.items.length,
      planCompletedForToday: true,
      reason: "plan_completed",
    };
  }

  // 4) Plan-run finished men neste item finnes (komplementært til PR #1422 + §3.13)
  if (planRun?.status === "finished" && planRun.currentPosition < plan.items.length) {
    const nextItem = plan.items[planRun.currentPosition];  // 0-indeksert, +1 fra rawPosition
    return {
      catalogSlug: nextItem.catalogEntry.slug,
      catalogDisplayName: nextItem.catalogEntry.displayName,
      position: planRun.currentPosition + 1,
      planCompletedForToday: false,
      reason: "next_in_sequence",
    };
  }

  // 5) Plan-run mangler eller idle/running/paused — peker til currentPosition (eller 1 hvis null/0)
  const position = (planRun?.currentPosition && planRun.currentPosition > 0)
    ? planRun.currentPosition
    : 1;
  const item = plan.items.find((i) => i.position === position) ?? plan.items[0];

  return {
    catalogSlug: item.catalogEntry.slug,
    catalogDisplayName: item.catalogEntry.displayName,
    position,
    planCompletedForToday: false,
    reason: planRun ? "next_in_sequence" : "no_plan_run",
  };
}
```

**Frontend bytter til kun å bruke `lobby.nextGameDisplay`:**

```typescript
// Spill1HallStatusBox.mapLobbyToView:
return {
  // ...
  catalogDisplayName: lobby.nextGameDisplay.catalogDisplayName,  // ALDRI null
  planCompletedForToday: lobby.nextGameDisplay.planCompletedForToday,
};

// renderMasterButtons:
const startLabel = `Start neste spill — ${opts.nextGameName}`;
// nextGameName er nå alltid satt (ikke null)

// getMasterHeaderText:
const effectiveState = data.planCompletedForToday
  ? "plan_completed_for_today"
  : (data.scheduledGameStatus ?? "idle");
const title = getMasterHeaderText(effectiveState, data.catalogDisplayName);
```

#### Forslag B: Bruk eksisterende `Spill1LobbyState.nextScheduledGame` på alle paths

Public `Spill1LobbyState.nextScheduledGame` har allerede `catalogDisplayName: string` (ikke nullable) og `planCompletedForToday?: boolean` (optional).

Admin-web kunne kalle public-endpointet `/api/games/spill1/lobby?hallId=X` istedenfor agent-aggregator-endpointet for å hente NESTE-spill-info, og fortsette å bruke aggregator-endpoint for master-action-context (`currentScheduledGameId`, `halls[]`, `isMasterAgent`).

**Avveining:**
- Pro: Single wire-format (`Spill1LobbyNextGame`) — public og admin viser samme tekst
- Kontra: To fetchcall fra admin-web istedenfor én (latency)
- Kontra: Duplisering av polling-logikk

**Konklusjon:** Forslag A er bedre fordi det utvider aggregator-skjemaet (allerede single-source for admin) istedenfor å legge til en ny fetch-path.

### 6.2 Migreringsplan (Bølge 7-prosjekt?)

Hvis Trinn 3 (refaktorering) godkjennes:

1. **Backend (1 dag):** Utvid `Spill1AgentLobbyStateSchema` med `nextGameDisplay`-felt + implementer `buildNextGameDisplay` i aggregator. Behold eksisterende `planMeta.catalogDisplayName` for bakover-kompat én sprint.
2. **Frontend (1 dag):**
   - Spill1HallStatusBox.mapLobbyToView leser `nextGameDisplay.catalogDisplayName` (med planCompletedForToday-flag)
   - `getMasterHeaderText`-caller bruker `planCompletedForToday`-flag for å mappe til `plan_completed_for_today`-state
   - NextGamePanel.mapLobbyToLegacyShape (DEPRECATED i Bølge 8) leser samme felt
   - Spill1AgentStatus/Spill1AgentControls leser `currentGame.subGameName` (uendret — translator fyller fra `nextGameDisplay`)
   - LobbyFallback (game-client) leser via Spill1LobbyState der vi alt har riktig data
3. **Game-client (½ dag):** Game1Controller leser `state.nextScheduledGame.catalogDisplayName` (uendret) — vi får backend til å eksponere samme `nextGameDisplay`-shape i `Spill1LobbyState`.
4. **Slett deprecated paths (½ dag):**
   - Fjern `planMeta.catalogDisplayName`-feltet (ev. behold som @deprecated)
   - Slett `customGameName ?? subGameName`-fallback i Spill1AgentControls/Spill1AgentStatus
   - Slett tom-streng-fallback i NextGamePanel translator

**Total:** 3 dev-dager + tester.

### 6.3 Test-invariants som MÅ dekkes

| ID | Invariant |
|---|---|
| F-I1 | Idle (ingen plan-run) → display = `plan.items[0].displayName` |
| F-I2 | Plan-run.status=finished + currentPosition<items.length → display = `items[currentPosition+1].displayName` |
| F-I3 | Plan-run.status=finished + currentPosition>=items.length → `planCompletedForToday=true` |
| F-I4 | Plan-run.status=running + currentPosition=5 → display = `items[5].displayName` |
| F-I5 | Closed (utenfor åpningstid) → `reason="closed"`, display fallback til "Bingo" |
| F-I6 | Hallen ikke i en plan for i dag → `reason="no_plan_for_today"`, display fallback til "Bingo" |
| F-I7 | `DUAL_SCHEDULED_GAMES`-warning → UI skipper header-rendering, viser feilbanner |
| F-I8 | `STALE_PLAN_RUN`-warning → UI viser banner men beholder display-tekst (gårsdagens display vises ikke som "neste") |
| F-I9 | game-client BuyPopup-subtitle viser ALLTID en display-name (aldri tom streng) |

---

## 7. SKILL_UPDATE_PROPOSED

PM Trinn 2 konsolideringen bør oppdatere `.claude/skills/spill1-master-flow/SKILL.md` med følgende:

### Foreslått ny seksjon: "Neste spill-display single source of truth"

```markdown
## Neste spill-display single source of truth (post-Trinn 3, 2026-05-14)

**Problem-mønster:** Pre-Trinn 3 hadde 6 UI-paths som bygde "neste spill"-tekst hver for seg
(Spill1HallStatusBox, NextGamePanel idle, NextGamePanel active, Spill1AgentStatus,
Spill1AgentControls, Game1Controller). Forskjellige fallback-strategier ("", "Bingo",
"Neste spill" uten navn) → bug-rapport "viser feil neste spill" kom tilbake etter
hver §3.x-fix fordi en av paths fortsatte å beregne lokalt.

**Post-Trinn 3 (foreslått):** EN autoritær service `GameLobbyAggregator.buildNextGameDisplay`
returnerer `nextGameDisplay: { catalogSlug, catalogDisplayName, position,
planCompletedForToday, reason }` på `Spill1AgentLobbyState`. ALLE frontend-paths leser fra
dette feltet. Ingen lokal beregning av "neste spill"-tekst.

**Reglene:**
- `catalogDisplayName` er ALDRI null — backend faller alltid til "Bingo" som default.
- `reason` er stabil enum brukt for diagnose og UI-mapping
  (`next_in_sequence`/`plan_completed`/`no_plan_run`/`no_plan_for_today`/`closed`).
- `planCompletedForToday` er KANONISK flag — UI bruker dette for å mappe til
  `getMasterHeaderText("plan_completed_for_today", ...)`.

**Når du legger til ny UI-komponent som viser "neste spill"-tekst:**
- ALDRI bygg egen fallback-streng.
- ALDRI les fra `planMeta.catalogDisplayName` direkte — bruk `nextGameDisplay`.
- Hvis du må ha state-spesifikk render, hent `nextGameDisplay.reason` og map deretter.
```

### Foreslått oppdatering på eksisterende seksjon "ID-rom (plan-run-id vs scheduled-game-id)"

Legg til note:

```markdown
**Display-name er IKKE en del av ID-rom-konflikten** — selv etter Bølge 3 hadde vi 6 paths
som beregnet "neste spill"-tekst lokalt. Trinn 3 (foreslått) konsoliderer dette via
`nextGameDisplay`-felt på aggregator-wire. Inntil da: hvis du jobber med "neste spill"-bug,
sjekk ALLE 6 paths i `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md`.
```

### Foreslått ny PITFALLS_LOG-entry (§7.20-pattern)

PM kan eventuelt vurdere ny `§7.21` ("Neste spill-display lokalt beregnet i 6 paths") som
dokumenterer pre-Trinn-3-tilstanden + reference til denne research-doc-en.

---

## 8. Inactive findings (FYI for Trinn 2 PM-konsolidering)

- **`Game1MasterConsole.ts`** er en TREDJE display-path som ikke ble migrert i Bølge 3 fordi
  den jobber utenfor plan-runtime (admin direct-edit på gameId). Forslag A vil ikke påvirke
  den — den fortsetter å vise `game.customGameName ?? game.subGameName` fra
  `Game1GameDetail.game`. Behold uendret per audit §4.3 R2.

- **`LobbyFallback.ts`** (game-client) er den ENESTE path som rendrer ETA-tekst
  ("Neste spill: Bingo (om 5 min)"). Hvis Forslag A går videre, bør backend også eksponere
  `nextScheduledStartTime` i `nextGameDisplay` (eller fortsette å bruke
  `Spill1LobbyState.nextScheduledGame.scheduledStartTime` som i dag).

- **`JackpotSetupModal`-flow** (Spill1HallStatusBox:1625-1650 + NextGamePanel:1246-1268)
  henter `currentItem.catalogEntry` via `fetchAgentGamePlanCurrent(hallId)` — DEPRECATED
  per Bølge 3 men fortsatt brukt for jackpot-popup catalog-data (ticketColors-array). Bytt
  til aggregator-fetcher med `planMeta.catalogSlug` + `GameCatalogService.getBySlug` i en
  fremtidig PR. Ikke pilot-blokker.

---

## 9. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-14 | Initial — frontend rendering paths mapping for Next Game Display fundament-audit Trinn 1. | Agent A (research, spawned by PM-AI Claude Opus 4.7) |
