# PM-handoff — 2026-05-03 — Spill 2 + Spill 3 ferdigstilling

**Forrige PM:** Claude (sesjon 2026-05-02 kveld → 2026-05-03 natt)
**Neste PM:** Du som leser dette
**Hovedscope:** Spill 2 (Rocket / `rocket`) Bølge 1 ferdig, deler av Bølge 2 ferdig. Spill 3 (Mønsterbingo / `monsterbingo`) ikke startet — gjenbruker Spill 1-arkitektur.

---

## 0. TL;DR

I løpet av kveld 2026-05-02 / natt 2026-05-03 ble **10 PR-er merget** (#843–#852) — først 7 pilot-natt-fixes for Spill 1, deretter 3 PR-er for Spill 2 (Jackpot-bar + Choose Tickets-side + tickets-hidden).

**Spill 2-status:**
- ✅ **Bølge 1 (kjernen)** komplett: Jackpot-bar (#850), 30-brett-max (allerede impl), Choose Tickets-side (#851)
- 🟡 **Bølge 2 (polish)** delvis: Tickets-hidden (#852) ferdig. Change Marker/Background + Upcoming Games popup parkert med god grunn (se §6)
- ❌ **Bølge 3 (Chat)** ikke startet — delt med Spill 1 (BIN-516)
- ⚠️ **v2-arbeid** kritisk: Choose Tickets-pool er IKKE koblet til BingoEngine.startGame ennå — chosen ticket-tall vises kun visuelt, faktiske spill-tickets er fortsatt random. Dette er eksplisitt akseptert av Tobias for pilot, men må fikses før prod-ferdig.

**Spill 3-status:**
- ❌ Ikke startet
- Tobias' direkte sitat: **"design til spill 3 er identisk som spill 1 bare da med andre bonger"**
- Konkret tolkning: gjenbruk hele Spill 1-arkitekturen, bare endre brett-typen (5×5 1-60 ball uten free-center per `generate5x5NoCenterTicket`)

---

## 1. Hva ble gjort i denne sesjonen — kronologisk

### 1.1 Pilot-natt-fixes (Spill 1)

10 PR-er, alle merget til `main` 2026-05-02 kveld:

| PR | Hva | Hvorfor |
|---|---|---|
| [#843](https://github.com/tobias363/Spillorama-system/pull/843) | Klar persisterer (REQ-007 stale-sweep default OFF) | Klar-flagg revertet av cron etter 60s — ingen heartbeat. Tobias-krav: aldri auto-revert. |
| [#844](https://github.com/tobias363/Spillorama-system/pull/844) | Cash-inout Spill 1 hall-status + Klar/Ingen-kunder/Start-Stop | Master/agent-handlinger inline i kontant-inn-/ut-dashbord |
| [#845](https://github.com/tobias363/Spillorama-system/pull/845) | Én rom per group-of-halls | Random rom-koder (22VLRE/FCYW9N/...) → kanonisk `BINGO_<groupId>` |
| [#846](https://github.com/tobias363/Spillorama-system/pull/846) | Cash-inout mount-guard fix | Polling startet ikke ved re-mount → "evig Henter Spill 1-status…" |
| [#847](https://github.com/tobias363/Spillorama-system/pull/847) | Master kan starte med ikke-klare haller | REQ-007 confirmUnreadyHalls UI-flow |
| [#848](https://github.com/tobias363/Spillorama-system/pull/848) | Boot-bootstrap rom per aktiv group-of-halls | Render-deploy wiper BingoEngine in-memory; auto-create ved oppstart |
| [#849](https://github.com/tobias363/Spillorama-system/pull/849) | Fjern duplikat content-header på alle sider | 9 ulike `pages/*/shared.ts` rendret duplikat header |
| [#850](https://github.com/tobias363/Spillorama-system/pull/850) | **Spill 2 Jackpot-bar UI + fjern rocket-stack** | PDF 17 wireframe side 4: 6 slots (9/10/11/12/13/14-21) |
| [#851](https://github.com/tobias363/Spillorama-system/pull/851) | **Spill 2 Choose Tickets-side med 32 forhåndsgenererte brett** | PDF 17 side 5: spiller velger spesifikke brett, ikke random allotment |
| [#852](https://github.com/tobias363/Spillorama-system/pull/852) | **Spill 2 skjul ticket-tall på kjøpte brett** | PDF 17 note: "Tickets bought ... not viewed until game starts" |

### 1.2 Refaktor-detaljer (PR #845 — én rom per group)

Den viktigste arkitekturendringen i kveld. Bygger på eksisterende `getCanonicalRoomCode("bingo", hallId, groupId)`-infrastruktur som allerede genererte `BINGO_<groupId>` for socket-flow, men HTTP `POST /api/admin/rooms` brukte hardkodet `"BINGO1"` og bypasset.

**Endringer:**
- `Game1HallReadyService.setExcludedForHall` (ny metode) — agent kan ekskludere egen hall
- `adminRooms.ts`:
  - `requireRoomHallScope` async-ifisert; godtar shared rooms hvis user-hallens kanoniske kode matcher
  - `POST /api/admin/rooms`: lookup `getHallGroupIdForHall(hallId)` → `getCanonicalRoomCode` → idempotent (hvis rom finnes, returner det)
  - GET-listen: filter inkluderer shared rooms med matching kanonisk kode
- `RoomSummary` fikk nytt `isHallShared?: boolean`-flagg propagert fra `RoomState`
- `AdminSubRouterDeps`: nytt valgfritt `getHallGroupIdForHall`-callback
- `index.ts`: wire callback (samme `hallGroupService.list`-lookup som socket-deps)

**Effekt:** alle 4 Teknobingo-pilot-haller (Årnes/Bodø/Brumunddal/Fauske) deler nå ETT rom: `BINGO_TEKNOBINGO-PILOT-GOH`. Stabilt så lenge gruppen eksisterer. Verifisert via API-probe (alle 4 agenter ser samme rom-kode).

### 1.3 Spill 2 — Bølge 1 detaljer

#### Bølge 1.1: Jackpot-bar UI (PR #850)

Per PDF 17 side 4: horisontal bar med 6 slots over ticket-grid:

```
┌───────┬───────┬───────┬───────┬───────┬───────┐
│   9   │  10   │  11   │  12   │  13   │ 14-21 │
│Jackpot│Jackpot│Jackpot│Jackpot│ Gain  │ Gain  │
│ 5000  │ 3000  │ 2000  │ 1000  │  500  │  100  │
└───────┴───────┴───────┴───────┴───────┴───────┘
```

Aktiv slot (matcher current draw count) highlightes med gul bakgrunn.

**Filer:**
- NY [`packages/game-client/src/games/game2/components/JackpotBar.ts`](../../packages/game-client/src/games/game2/components/JackpotBar.ts) — Pixi-komponent, 6 slot-celler, active-state-highlight basert på draw count
- [`packages/game-client/src/games/game2/screens/PlayScreen.ts`](../../packages/game-client/src/games/game2/screens/PlayScreen.ts) — erstattet `RocketStack` med `JackpotBar`
- [`packages/game-client/src/net/SpilloramaSocket.ts`](../../packages/game-client/src/net/SpilloramaSocket.ts) — ny `g2JackpotListUpdate`-listener for `g2:jackpot:list-update`-event
- [`packages/game-client/src/games/game2/Game2Controller.ts`](../../packages/game-client/src/games/game2/Game2Controller.ts) — subscribe på event + forward til `playScreen.updateJackpot()`

Backend uendret — emitter allerede event på hver G2-trekning ([`drawEmits.ts:23`](../../apps/backend/src/sockets/gameEvents/drawEmits.ts)).

#### Bølge 1.2: 30-brett-max — ALLEREDE IMPLEMENTERT

Verifisert eksisterende kode:
- Backend: `roomEvents.ts:801` rejecter med `INVALID_INPUT "Totalt antall brett (X) overstiger maks 30"`
- Frontend: `BuyPopup.ts:15` + `LobbyScreen.ts:127` har `maxTickets=30` som hard-cap

Ingen endring nødvendig.

#### Bølge 1.3: Choose Tickets-side (PR #851)

Per PDF 17 side 5. Den største nye komponenten i Spill 2.

**Backend:**
- NY [`apps/backend/src/game/Game2TicketPoolService.ts`](../../apps/backend/src/game/Game2TicketPoolService.ts) — in-memory pool-state med deterministisk PRNG (Mulberry32 + FNV-1a seed). 32 stabile 3×3-brett (1-21 ball-range) per spiller per spill.
- NY [`apps/backend/src/routes/agentGame2ChooseTickets.ts`](../../apps/backend/src/routes/agentGame2ChooseTickets.ts):
  - `GET /api/agent/game2/choose-tickets/:roomCode` → returnerer 32 brett + purchasedIndices + pickAnyNumber
  - `POST /api/agent/game2/choose-tickets/:roomCode/buy` → markerer indekser som kjøpt + lagrer Lucky Number
- [`apps/backend/src/index.ts`](../../apps/backend/src/index.ts) — wire service + router

**Frontend:**
- NY [`packages/game-client/src/games/game2/screens/ChooseTicketsScreen.ts`](../../packages/game-client/src/games/game2/screens/ChooseTicketsScreen.ts) — Pixi-screen med 4×8 brett-grid (32 brett), klikk-toggle, Pick Any Number sirkel, Cards/Amount totals, Buy-knapp
- [`packages/game-client/src/games/game2/screens/LobbyScreen.ts`](../../packages/game-client/src/games/game2/screens/LobbyScreen.ts) — "Velg brett"-knapp + `setOnChooseTickets`-callback. **FJERNET** rocket-decoration sprite (Tobias-krav)
- [`packages/game-client/src/games/game2/Game2Controller.ts`](../../packages/game-client/src/games/game2/Game2Controller.ts) — `openChooseTicketsScreen`-metode
- [`packages/game-client/src/net/SpilloramaApi.ts`](../../packages/game-client/src/net/SpilloramaApi.ts) — `getGame2ChooseTickets` + `buyGame2ChooseTickets`-metoder

#### Bølge 2.1: Tickets-hidden (PR #852)

Per PDF 17 wireframe-note: "Tickets bought by the player will not viewed to the user until the game starts."

Etter kjøp i ChooseTicketsScreen: brett-cellene skjules (kun "KJØPT"-overlay vises). Tallene avsløres først når PlayScreen rendrer det faktiske spillet.

Endring: `cell.visible = !isPurchased` i `renderSelectionState`.

---

## 2. Spill 2 — komplett gap-analyse fremover

### 2.1 Hva som funker (testbart i prod)

| Funksjon | Status | Verifisert hvordan |
|---|---|---|
| 3×3 grid (9 celler) per ticket | ✅ | `generate3x3Ticket` i `apps/backend/src/game/ticket.ts:201` |
| 1-21 ball range, 21 draws | ✅ | `variantConfig.ts:401` (`maxBallValue=21`, `drawBagSize=21`) |
| Auto-claim på Fullt Hus | ✅ | `Game2Engine.ts` — patternEvalMode=`auto-claim-on-draw` |
| Jackpot multi-winner-split | ✅ | `Game2JackpotTable.ts:96` |
| Jackpot-bar UI med 6 slots | ✅ (PR #850) | `JackpotBar.ts` — verifiseres når runde kjører |
| Choose Tickets-side med 32 brett | ✅ (PR #851) | `ChooseTicketsScreen.ts` — kall `GET /api/agent/game2/choose-tickets/:roomCode` |
| Tickets skjult etter kjøp | ✅ (PR #852) | UI-only |
| 30-brett-max | ✅ (eksisterende) | `roomEvents.ts:801` |
| Lucky Number 1-21 | ✅ (eksisterende) | `LuckyNumberPicker.ts` |
| Lobby + countdown | ✅ (eksisterende) | `LobbyScreen.ts`, `CountdownTimer.ts` |
| Draw-animasjon | ✅ (eksisterende) | `DrawnBallsPanel.ts` |
| Claim-knapper (LINE/BINGO) | ✅ (eksisterende) | `ClaimButton.ts` |

### 2.2 KRITISK gjenstående arbeid (må gjøres før prod-pilot for Spill 2)

#### v2: Koble Choose Tickets-pool til BingoEngine.startGame

**Problem:** ChooseTicketsScreen viser 32 forhåndsgenererte ticket-tall til spilleren (deterministisk via PRNG). Spiller velger N. Etter "Buy" lagres pool-state med `purchasedIndices`. **MEN** når `BingoEngine.startGame` kjører, genererer den N HELT NYE random tickets — IKKE de tallene spiller så på Choose Tickets-skjermen.

**Konsekvens:** spiller tror de valgte spesifikke tall, men spiller faktisk med andre tall. Bryter wireframe-løftet.

**Trade-off Tobias godtok:** akseptabelt for pilot-test (visuell flyt verifiserer), MÅ fikses før ekte prod-pilot der spillere ser dette.

**Løsningsplan:**

1. **Endre `BingoAdapter.createTicket(input)`** til å akseptere optional `presetGrid: number[][]`. Hvis satt, bruk den grid-en i stedet for å generere random.
2. **`Game2TicketPoolService.buy()`** må returnere de valgte tickets-objektene, ikke bare indekser.
3. **`bet:arm`-handler** (i `roomEvents.ts`) må koble player → tickets fra Game2TicketPoolService når gameSlug=`rocket`. I stedet for å la BingoEngine generere, hent tickets fra pool og send som preset.
4. **Pool må persisteres til DB** for resilience over deploy/restart. Forslag: ny tabell `app_game2_ticket_pools` med kolonner `(room_code, player_id, game_id, ticket_grid_json[], purchased_indices_int[], pick_any_number INT, updated_at TIMESTAMP)`.
5. **Pool må slettes ved game-end** (gameEnded-event listener).

**Estimat:** 4-6 timer arbeid + 1-2 timer testing. Krever god BingoEngine-forståelse.

**Filer å endre:**
- `apps/backend/src/adapters/BingoSystemAdapter.ts` (interface + impl)
- `apps/backend/src/adapters/LocalBingoSystemAdapter.ts`
- `apps/backend/src/adapters/PostgresBingoSystemAdapter.ts`
- `apps/backend/src/sockets/gameEvents/roomEvents.ts` (bet:arm-handler)
- `apps/backend/src/game/Game2TicketPoolService.ts` (utvide buy → returnere tickets)
- NY: `apps/backend/src/migrations/0XXX_app_game2_ticket_pools.sql`

#### Bølge 2.2: Change Marker/Background

Per PDF 17 side 4 — knapp i play-view som lar spiller bytte marker-farge/bakgrunn på sine tickets.

**Status:** ikke startet.

**Plan:**
1. Ny `MarkerThemePicker.ts` modal i `packages/game-client/src/games/game2/components/`. 4-6 marker-color-presets (gul/hvit/lilla/rød/grønn/blå).
2. LocalStorage-persistens per playerId: `game2_marker_color`.
3. `TicketCard.ts` må eksponere `setMarkColor(color: number)` API + re-render markeringer.
4. PlayScreen leser localStorage ved mount + applierer til alle TicketCards.
5. Ved theme-endring midt i runde: kall `setMarkColor` på alle eksisterende cards.

**Estimat:** 2-3 timer. Lav risiko (kosmetisk).

**Filer å endre:**
- NY: `packages/game-client/src/games/game2/components/MarkerThemePicker.ts`
- `packages/game-client/src/games/game2/components/TicketCard.ts` (legg til setMarkColor)
- `packages/game-client/src/games/game2/screens/PlayScreen.ts` (knapp + theme-persist)

#### Bølge 2.3: Upcoming Games popup

Per PDF 17 side 4 panel B+C+D+E — dropdown i header → popup med dagens kommende spill: Name, "Tickets purchased: X", +/- selector, Submit, Choose Tickets, Cancel Tickets.

**Status:** ikke startet. **Krever ARKITEKTURAVKLARING.**

**Problem:** "Upcoming Games" antyder en SCHEDULED-games-arkitektur (som Spill 1 har via `app_game1_scheduled_games`). Spill 2 har IKKE scheduled-games i dag — kun room-basert med auto-start cron.

**To valg:**

**A) Bygg scheduled-games for Spill 2** (mirror Spill 1-arkitektur):
- Ny tabell `app_game2_scheduled_games` med samme shape som G1
- Ny `Game2ScheduleTickService` (port fra `Game1ScheduleTickService`)
- Daily-schedule + sub-game-konfig delt med Spill 1-admin-UI
- Ny socket-event `g2:scheduled-games:list` for popup
- ~6-10 timer arbeid + testing

**B) Bruk eksisterende rooms som "upcoming games"** (lettere):
- Popup viser alle rooms med `gameSlug=rocket` og `currentGame.status="WAITING"|"NONE"`
- For hvert: vis "Bli med"-knapp som joiner rommet
- Bygg ikke +/- selector, Submit, Cancel — la spiller bruke Lobby-flyten etter join
- ~2-3 timer arbeid

**Anbefaling:** Start med (B) for pilot-MVP. Vurder (A) etter pilot-feedback. Tobias bør beslutte.

#### Bølge 3: Chat (BIN-516)

Delt med Spill 1. Status: ikke implementert i Spill 2.

`PlayScreen.ts:97` har `chatPanel`-instansiering som er optional (krever `socket + roomCode`). Kontroller at det faktisk viser noe når spiller er i Spill 2-runde.

**Estimat:** verifiser eksisterende kode + evt. polish (~1-2 timer).

### 2.3 Sekundære gap (post-pilot)

| Gap | Status | Estimat |
|---|---|---|
| Audio/voice-pakker for G2 | MVP-stub | 4-6 timer (krever lyd-filer) |
| Hall-display broadcast for G2 | Delt med G1 (BIN-498) | Avhengig av G1-arbeid |
| Mobile-responsive polish | Funksjonell men ikke optimalisert | 4-8 timer |
| SPECTATING-fase | G1-only (BIN-507) | 2-3 timer port |
| Loader-barrier | G1-only (BIN-500) | 1-2 timer port |
| Admin jackpot-slot-editor (kr/% per draw 9-21) | Backend lagrer JSON, ingen UI | 3-4 timer |

---

## 3. Spill 3 — full implementeringsplan

Tobias' direkte sitat: **"design til spill 3 er identisk som spill 1 bare da med andre bonger"**.

### 3.1 Tolkning + arkitektur

Spill 3 = Mønsterbingo (`monsterbingo` slug). Per [`game3-canonical-spec.md`](../../docs/engineering/game3-canonical-spec.md) (sjekk om eksisterer) + [`apps/backend/src/game/ticket.ts:201`](../../apps/backend/src/game/ticket.ts):
- 5×5 grid, 25 celler, INGEN free-center (forskjell fra Spill 1)
- Ball-range 1-60 (ikke 1-75 som Spill 1)
- Ticket-generator: `generate5x5NoCenterTicket`
- Pattern-matching via PatternMatcher (admin-definerte mønstre, ikke hardkodede LINE/BINGO)

**Tobias' "identisk som spill 1"** betyr:
1. Samme draw-flow (BingoEngine eller Game1ScheduleTickService for scheduled games)
2. Samme ready/master-koordinering
3. Samme cash-inout-dashboard-integrasjon
4. Samme Mystery Game-rotasjon? **AVKLAR med Tobias** — Spill 1 har Wheel/Chest/Mystery/ColorDraft mini-games. Spill 3 kan ha eller ikke ha disse.

**Forskjeller:**
- Brett er 5×5 uten free-center (vs Spill 1 sin 5×5 med free-center)
- Ball-range 1-60 (vs Spill 1 sin 1-75)
- Ingen mini-games (per `game3-canonical-spec` — bekreft)

### 3.2 Status quo (eksisterende)

**Backend:**
- ✅ `Game3Engine.ts` finnes (mini-games inkludert?)
- ✅ `generate5x5NoCenterTicket` i `ticket.ts`
- ✅ Variant-config i `variantConfig.ts:DEFAULT_GAME3_CONFIG`
- ✅ Pattern-management UI for `monsterbingo` slug

**Game-client:**
- ✅ `packages/game-client/src/games/game3/Game3Controller.ts` finnes
- ✅ Lobby/Play/End screens
- ✅ Pattern-rendering komponent

**Admin:**
- ✅ `apps/admin-web/src/pages/games/gameManagement/` håndterer monsterbingo-slug

### 3.3 Hva som mangler vs Spill 1-paritet

KRITISK: dette er en research-task, ikke implementering. **Neste PM må først verifisere** følgende ved å lese koden:

| Spill 1-feature | Eksisterer i Spill 3? | Hvis nei, hvor lang er porten? |
|---|---|---|
| `Game1ScheduleTickService` (auto-spawn scheduled games) | ❓ Ukjent — sjekk om `Game3ScheduleTickService.ts` finnes | 4-6 timer port |
| `Game1HallReadyService` (per-hall Klar/Ingen-kunder) | ❓ | 3-4 timer port |
| `Game1MasterControlService` (master start/stop) | ❓ | 3-4 timer port |
| `app_game1_scheduled_games`-tabell (samme shape for G3?) | ❓ | 1-2 timer migrasjon |
| Cash-inout-dashboard Spill 3-blokk (analog til Spill1HallStatusBox) | ❓ | 2-3 timer (kopi+modifiser) |
| Mystery Game / mini-games | ❓ Avklar med Tobias | 0-8 timer |

**Forslag for Spill 3:**

**Fase 1 — Audit & plan (1-2 timer):**
1. Spawn Explore-agent: "Compare Spill 1 vs Spill 3 backend + game-client + admin. List exact gaps where G1 has X but G3 doesn't. Focus on scheduled-games, hall-ready, master-control, cash-inout integration."
2. Skriv konkret PR-plan med estimater per fil

**Fase 2 — Backend port (8-12 timer):**
3. Hvis `Game3ScheduleTickService` mangler: kopi fra G1, swap slug-konstanter
4. Hvis `Game3HallReadyService` mangler: samme
5. Hvis `Game3MasterControlService` mangler: samme
6. Migrasjon for `app_game3_scheduled_games` (eller gjenbruk G1-tabell med discriminator-kolonne)

**Fase 3 — Frontend port (4-6 timer):**
7. Cash-inout: `Spill3HallStatusBox.ts` (kopi av `Spill1HallStatusBox.ts`)
8. Game2-style "Velg brett" hvis ønskelig (Spill 3 har 5×5 grid, kanskje ikke Choose Tickets-konsept)
9. Verifiser game-client `Game3Controller` + screens fungerer end-to-end

**Fase 4 — Admin (2-3 timer):**
10. Verifiser admin kan opprette daily-schedules for monsterbingo
11. Verifiser cash-inout-dashbord viser Spill 3-status når runde kjører

**Total estimat for Spill 3:** 15-25 timer arbeid avhengig av hva som mangler.

---

## 4. Pilot-status nå (per 2026-05-03 kl 00:50)

### 4.1 Hva er klart for pilot

- ✅ **Spill 1**: full pilot-klar (Klar-status, master-koordinering, cash-inout-dashbord, kanonisk rom per group, boot-bootstrap, alle Bølge 1-fixes)
- 🟡 **Spill 2**: Bølge 1 + tickets-hidden ferdig. Choose Tickets fungerer visuelt MEN ticket-tall avviker fra faktisk spill (v2-arbeid kritisk)
- ❌ **Spill 3**: ikke startet
- ❌ **SpinnGo (game5)**: ikke startet
- ✅ **Candy**: eksternt, fungerer via iframe (uendret)

### 4.2 Demo-credentials (verifisert 2026-05-02)

```
ADMIN:
  email: tobias@nordicprofil.no
  password: Spillorama123!

AGENTER (alle med passord Spillorama123!):
  tobias-arnes@spillorama.no       (master-hall Årnes)
  agent-bodo@spillorama.no
  agent-brumunddal@spillorama.no
  agent-fauske@spillorama.no
```

Hall-IDer (fra `seed-teknobingo-test-players.ts`):
```
Årnes:        b18b7928-3469-4b71-a34d-3f81a1b09a88
Bodø:         afebd2a2-52d7-4340-b5db-64453894cd8e
Brumunddal:   46dbd01a-4033-4d87-86ca-bf148d0359c1
Fauske:       ff631941-f807-4c39-8e41-83ca0b50d879
```

Group-of-halls: `teknobingo-pilot-goh` (master = Årnes, 4 medlemmer)
Kanonisk rom: `BINGO_TEKNOBINGO-PILOT-GOH` (auto-bootstrap ved server-start per PR #848)

### 4.3 Prod-URL + deploy

- Frontend + backend: `https://spillorama-system.onrender.com`
- Admin: `https://spillorama-system.onrender.com/admin/`
- Render-service: `srv-d3pkgubipnbc73f74880`
- Hver merge til `main` triggrer auto-deploy (~3-5 min)

### 4.4 Schedule-konfigurasjon

PM oppdaterte `teknobingo-sched-spill1` 2026-05-02 kveld for å legge sub-games inn i fremtiden så cron kunne spawne games. **Dette må gjentas hver dag** inntil schedule-template har fast HH:MM-times for daglig drift.

Anbefales: opprett admin-UI for sub-game-time-redigering ELLER lag en evig-schedule som gjentas (f.eks. hver time HH:00-HH:25, HH:30-HH:55).

---

## 5. Arkitektur-beslutninger tatt i denne sesjonen

### 5.1 Én rom per group-of-halls

**Beslutning:** alle haller i en group-of-halls deler ETT BingoEngine-rom med deterministisk kode `BINGO_<groupId>`.

**Hvorfor:** wireframes + Tobias-krav. Tidligere fikk hver hall sitt random rom-id (forvirrende for agentene).

**Begrensning:** kun for `gameSlug=bingo` (Spill 1). Spill 2/3 bruker fortsatt per-hall-rom — men de er allerede globalt delte (Rocket = "ROCKET", Monsterbingo = "MONSTERBINGO").

**Konsekvens:** når Spill 3 skal porteres til scheduled-games + per-link, må arkitekturen utvides.

### 5.2 Choose Tickets pool: client-side preview, ikke koblet til engine

**Beslutning:** ChooseTicketsScreen viser 32 deterministiske brett, lar spiller velge, men `BingoEngine.startGame` genererer NYE random tickets ved spill-start. Visuell pool og spill-tickets matcher IKKE.

**Hvorfor:** integrasjon med BingoEngine ticket-generering er stor refaktor (4-6 timer). Tobias eksplisitt godtok trade-off for pilot.

**Konsekvens:** v2-arbeid (§2.2) er KRITISK før ekte prod-pilot for Spill 2.

### 5.3 REQ-007 stale-ready-sweep default OFF

**Beslutning:** `Game1HallReadyService.sweepStaleReadyRows`-cron er disabled per default (env-flag `GAME1_STALE_READY_SWEEP_ENABLED=false`).

**Hvorfor:** spec antok et heartbeat-endepunkt som aldri ble implementert. Uten heartbeat reverteres Klar-flagget hver 60-75s — Tobias-krav: "aldri auto-revert".

**Re-aktivering:** sett env-var til true når heartbeat-endepunkt finnes.

### 5.4 Boot-bootstrap rom

**Beslutning:** `bootstrapHallGroupRooms` kjøres ved server-oppstart, oppretter manglende kanonisk rom for hver aktiv group-of-halls.

**Hvorfor:** BingoEngine in-memory state wipes ved hver Render-deploy. Uten bootstrap måtte admin manuelt re-create rom etter hver deploy.

---

## 6. Parkerte features med begrunnelse

| Feature | Hvorfor parkert | Når ta opp |
|---|---|---|
| Spill 2 Change Marker/Background | Krever rendering-refaktor av TicketCard color-theme. Lav verdi for pilot. | Når andre Spill 2-features er stabile, eller hvis Tobias eksplisitt ber om det. |
| Spill 2 Upcoming Games popup | Krever scheduled-games-arkitektur for Spill 2 (eksisterer ikke). To valg (A/B) krever Tobias-beslutning. | Etter Tobias har valgt A vs B i §2.2 |
| Spill 2 v2: pool→engine | 4-6 timer arbeid. Krever god forståelse av BingoEngine. Tobias godtok trade-off for pilot. | KRITISK før prod-pilot — bør være neste store Spill 2-arbeid |
| Spill 2 chat | Delt med Spill 1 (BIN-516) — ikke isolert Spill 2-arbeid | Når BIN-516 håndteres globalt |

---

## 7. Risiko + tekniske gjeldende

### 7.1 Høy risiko

1. **Choose Tickets pool ≠ spilte tickets** (§2.2) — bryter wireframe-løftet, må fikses før prod
2. **BingoEngine state wipes ved deploy** — boot-bootstrap (PR #848) hjelper for rom, men IKKE for game-state. Hvis spill kjører under deploy, går spillet i stykker. Ingen DB-persistens av in-flight rounds.
3. **Schedule sub-game-times PATCH'es manuelt for hver dag** — ingen evig-template, hver morgen må PM (eller automatisering) push fremtidige tider

### 7.2 Medium risiko

4. **`Game2TicketPoolService` er in-memory only** — pool-state tapes ved Render restart. Spillere ser ny pool ved revisit etter deploy. For pilot OK; for prod trenger DB-persistens.
5. **Spill 3 status er ukjent** — ingen sesjon har fokusert på G3-paritet. Audit må gjøres før implementeringsarbeid.
6. **Debug-PR-er #838 + #839** ikke revertet — har debug-router-tracing og monkey-patch på `window.location.hash`-setter. Bør reverteres før prod.

### 7.3 Lav risiko

7. **Min Konto-overlay (PR #832)** har TODO for noen plassholdere
8. **Ekstern-tjeneste-secrets** (Swedbank, Firebase, Cloudinary, Verifone, Metronia, IdKollen, Sveve, MSSQL) har ikke ekte verdier i Render-env — pilot kjører uten disse

---

## 8. Foreslått prioritering for neste session

### Prioritet 1 (kritisk før prod)

1. **Spill 2 v2: pool→engine integrasjon** (4-6 timer + 1-2 timer test)
   - Spec i §2.2 over
   - Krever ny migrasjon + endringer i 5 backend-filer
   - HØYESTE prioritet — uten dette er Spill 2 ikke prod-klart

2. **Spill 3 audit + plan** (1-2 timer)
   - Spawn Explore-agent for G1 vs G3 sammenligning
   - Skriv konkret PR-plan
   - Tobias bekrefter scope (mini-games yes/no, scheduled-games arkitektur)

### Prioritet 2 (pilot-test feedback)

3. **Verifiser Spill 2 Bølge 1 i prod** — Tobias tester Jackpot-bar + Choose Tickets + tickets-hidden
4. **Spill 2 Upcoming Games popup** (variant B — bare list rooms) — 2-3 timer
5. **Schedule template forbedring** — evig daily-rotasjon i stedet for manuell PATCH

### Prioritet 3 (Spill 3 implementasjon)

6. Etter audit i (2): start Spill 3 backend-port (8-12 timer)
7. Spill 3 frontend-port (4-6 timer)
8. Spill 3 admin-verifisering (2-3 timer)

### Prioritet 4 (rydd opp)

9. Revert debug-PR-er #838 + #839
10. Fyll inn ekstern-tjeneste-secrets (Tobias må gi verdier)
11. Spill 2 Change Marker/Background (kosmetisk)

---

## 9. Filer endret i denne sesjonen — for navigasjon

**Backend:**
- `apps/backend/src/game/Game1HallReadyService.ts` (ny `setExcludedForHall`)
- `apps/backend/src/game/Game1ScheduleTickService.ts` (sweep gated)
- `apps/backend/src/game/Game2TicketPoolService.ts` (NY)
- `apps/backend/src/routes/adminGame1Ready.ts` (no-customers/has-customers routes)
- `apps/backend/src/routes/adminRooms.ts` (kanonisk-rom + shared scope)
- `apps/backend/src/routes/adminShared.ts` (`getHallGroupIdForHall` dep)
- `apps/backend/src/routes/agentGame1.ts` (stop-route)
- `apps/backend/src/routes/agentGame2ChooseTickets.ts` (NY)
- `apps/backend/src/game/types.ts` (`isHallShared` på RoomSummary)
- `apps/backend/src/game/RoomLifecycleService.ts` (propagate isHallShared)
- `apps/backend/src/util/envConfig.ts` (`jobGame1StaleReadySweepEnabled`)
- `apps/backend/src/index.ts` (boot-bootstrap + Game2 wiring + sweep-flag)
- `apps/backend/src/boot/bootstrapHallGroupRooms.ts` (NY)

**Game-client:**
- `packages/game-client/src/net/SpilloramaSocket.ts` (g2JackpotListUpdate)
- `packages/game-client/src/net/SpilloramaApi.ts` (Choose Tickets API)
- `packages/game-client/src/games/game2/components/JackpotBar.ts` (NY)
- `packages/game-client/src/games/game2/screens/ChooseTicketsScreen.ts` (NY)
- `packages/game-client/src/games/game2/screens/PlayScreen.ts` (rocket→jackpot)
- `packages/game-client/src/games/game2/screens/LobbyScreen.ts` (Velg brett-knapp + fjern rocket)
- `packages/game-client/src/games/game2/Game2Controller.ts` (jackpot subscribe + openChooseTicketsScreen)

**Admin-web:**
- `apps/admin-web/src/api/agent-game1.ts` (no-customers/has-customers + stop helpers)
- `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts` (mount Spill1HallStatusBox + cleanup)
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` (NY + mount-guard fix)
- 9 × `apps/admin-web/src/pages/*/shared.ts` (`contentHeader → no-op`)

**Docs:**
- `docs/operations/RENDER_ENV_VAR_RUNBOOK.md` (fra forrige natt — incident-postmortem)
- DENNE FILEN

**Migrasjoner:** ingen i denne sesjonen.

---

## 10. Kommandoer for å komme i gang (neste PM)

```bash
# Klone + sjekk status
git pull origin main
git log --oneline -15

# Type-check alle pakker
npm --prefix apps/backend run check
npm --prefix apps/admin-web run check
npm --prefix packages/game-client run check

# Start dev-servere (3 separate terminaler)
docker-compose up -d           # Postgres + Redis
npm run dev                     # Backend (port 4000)
npm run dev:admin               # Admin-web (port 5173)
npm run dev:games               # Game-client (port 5174)

# Login til prod-admin for å teste
open https://spillorama-system.onrender.com/admin/
# Bruk: tobias@nordicprofil.no / Spillorama123!

# Sjekk pilot-rom på prod
curl -sS https://spillorama-system.onrender.com/health | jq

# Oppdatere schedule (manuelt — anbefalt automatiseres)
# Få token via /api/admin/auth/login og PATCH /api/admin/schedules/teknobingo-sched-spill1
```

---

## 11. Kontaktperson + eskalering

- **Tobias Haugen** (`tobias@nordicprofil.no`) — produkteier + teknisk lead. Tilgjengelig daglig 08:00-22:00 NO-tid.
- **Tobias' krav er styrende** — hvis i tvil, spør (men kjør på når du har klar instruks).

---

**Slutt på handoff. Lykke til!**

— Forrige PM (Claude, sesjon 2026-05-02 → 2026-05-03 natt)
