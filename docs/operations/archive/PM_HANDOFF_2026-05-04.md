# PM-handoff 2026-05-04 — Spill 2 + Spill 3 ferdigstilling

**Forrige PM:** Claude (Sonnet 4.5)
**Tobias' status:** Pilot-prep mot 4-hall demo (demo-hall-001 → demo-hall-004 + Teknobingo Harstad)
**Dette dokumentet:** komplett rapport av hva som er gjort 2026-05-03 → 2026-05-04 + ALLE feller jeg falt i, slik at ny PM ikke gjentar dem.

---

## 1. TL;DR — status per nå

### Hva som FUNGERER på prod
- ✅ **Auto-draw cron** for Spill 2 (rocket) + Spill 3 (monsterbingo) — env-var `AUTO_DRAW_INTERVAL_MS=3000` (3s/ball)
- ✅ **Game-end auto-recovery** innen 1s ved stuck-rom (drawnNumbers ≥ maxBalls + status=RUNNING)
- ✅ **Boot-sweep** ved oppstart finner stale rom + force-end + spawn ny via `spawnAfterEnd`-callback
- ✅ **HALL_MISMATCH defense-in-depth** — rocket/monsterbingo er ALLTID hall-shared (sjekker gameSlug, ikke bare `room.isHallShared`-flagg)
- ✅ **Carry over armed players** mellom perpetual-runder (PR #894)
- ✅ **Bong-render fra preRoundTickets** (fallback i `PlayScreen.buildTickets`, mirror Spill 1)
- ✅ **CenterBall-pop-animasjon** i Spill 2 (PR #896)
- ✅ **Loading-overlay** — ny brand-loader (logo + halo + "Laster spill") på alle Spill 1, 2, 3
- ✅ **Connection-error fallback** — "Får ikke koblet til rom. Trykk her" → reload
- ✅ **B I N G O-header** på alle bonger i Spill 1 + Spill 3 (PR #885)
- ✅ **Spill 3 frontend = Spill 1-klon** via direkte komponent-import (PR #878) — ÉN ticket-type "Standard"
- ✅ **Spill 3 backend** — 4 design-mønstre (T-shape, X, Topp+diagonal, Pyramide), hver 25% av pool
- ✅ **KYC-bypass** for `*@example.com`-domener (RFC 2606-reservert, trygt for testing)
- ✅ **test-bruker** `test@spillorama.no / Test1234!` opprettet via `RESET_TEST_PLAYERS=true` boot-script
- ✅ **`/api/_dev/game2-state`-debug-endpoint** for å diagnostisere ROCKET-rommet uten Render-logs

### Hva som GJENSTÅR
- ⏳ **Spill 3 frontend** — viser fortsatt "Rad 1-4 / Full Hus"-tekst i CenterTopPanel, ikke 4 mini-grids fra patterns.jsx-design. Backend støtter mønstrene; frontend må oppdateres for å rendre dem visuelt.
- ⏳ **Bekreftelse fra Tobias** at PR #896 (bong-render + ball-anim) faktisk fungerer ende-til-ende
- ⏳ **Loading-overlay state-driven** — Game3Controller mangler loading-wiring (PR #879 droppet det pga merge-konflikt)
- ⏳ **Game3Engine.test.ts** — 10/16 tester feiler etter PR #895 (forventet engelske pattern-navn). Må omskrives til ny semantikk.

---

## 2. PRs merget i sesjonen (2026-05-03 → 04)

| PR | Tittel | Status |
|---|---|---|
| #873 | Spill 2 BuyPopup kun ved eksplisitt klikk + bong-grid synlig | ✅ LIVE |
| #874 | Spill 2/3 auto-draw cron | ✅ LIVE |
| #875 | Spill 2 Lykketall-popup (replace inline 21-grid med kløver) | ✅ LIVE |
| #876 | Spill 2 game-end ved 21 baller uten vinner | ✅ LIVE (men hadde drawIndex off-by-one) |
| #877 | Spill 2 stigende jackpot-defaults (50/100/250/500/1000/2500) | ✅ LIVE |
| #878 | Spill 3 frontend = Spill 1-klon (importerer komponenter direkte) | ✅ LIVE |
| #879 | Loading-overlay redesign (brand-loader + error-fallback) | ✅ LIVE |
| #880 | Boot-sweep stale "RUNNING-but-exhausted" Spill 2/3-rom | ✅ LIVE |
| #881 | Loading-tekst kun "Laster spill" (drop state-spesifikke meldinger) | ✅ LIVE |
| #882 | drawIndex off-by-one fix → bytt til `drawnNumbers.length` | ✅ LIVE |
| #883 | Boot-sweep `spawnAfterEnd`-callback + bedre Game2 error-log | ✅ LIVE |
| #884 | KYC-bypass for `*@example.com`-konti | ✅ LIVE |
| #885 | B I N G O-header på Spill 1/3-bonger | ✅ LIVE |
| #886 | Boot-script `resetTestPlayers` (RESET_TEST_PLAYERS=true env-var) | ✅ LIVE |
| #887 | Reset-script split TX1+TX2 (test-bruker først, cleanup best-effort) | ✅ LIVE |
| #888 | Reset-script auto-pick første aktive hall (demo-hall-001 fantes ikke) | ✅ LIVE |
| #889 | `/api/_dev/reset-test-user`-HTTP-route med error-detalj | ✅ LIVE |
| #890 | `wallet_accounts.balance` er GENERATED — drop fra INSERT | ✅ LIVE |
| #891 | `/api/_dev/debug-rocket`-endpoint (lagt inn først, erstattet av #893) | ✅ LIVE |
| #892 | HALL_MISMATCH defense-in-depth (sjekk gameSlug i tillegg) | ✅ LIVE |
| #893 | `/api/_dev/game2-state` + auto-recovery innen 1s ved stuck-rom | ✅ LIVE |
| #894 | Carry over armed players mellom perpetual-runder | ✅ LIVE |
| #895 | Spill 3 backend: bytt Row 1-4 + Coverall til 4 design-mønstre | ✅ LIVE |
| #896 | Spill 2 bong-render fallback til preRoundTickets + ball-pop-anim | ⏳ bygger |

**Totalt:** 24 PRs merget i ~24 timer.

---

## 3. KRITISKE FELLER jeg falt i — UNNGÅ DISSE

### Felle 1: drawIndex er 0-basert (BIN-689)

**PR #876** la inn `if (drawIndex >= GAME2_MAX_BALLS)` som guard for siste-ball-uten-vinner. Den traff aldri fordi `drawIndex` på siste (21.) ball er **20**, ikke 21. Sjekken `>= 21` matchet aldri.

**Fix i PR #882:** bytt til `if (game.drawnNumbers.length >= GAME2_MAX_BALLS)` (1-basert teller).

**Lærdom:** ALLE drawIndex-sjekker i Game2Engine/Game3Engine er 0-basert. Bruk `drawnNumbers.length` for "antall trukne baller".

### Felle 2: `wallet_accounts.balance` er en GENERATED-kolonne

Boot-scriptet `resetTestPlayers` prøvde å INSERT-e direkte til `balance`-kolonnen. Postgres returnerte: `cannot insert a non-DEFAULT value into column "balance"`. Hele scriptet rullet tilbake → bruker ble aldri opprettet → login feilet med INVALID_CREDENTIALS.

**Funnet via:** `/api/_dev/reset-test-user`-endpointet (PR #889) som returnerer error.message + stack i HTTP-respons.

**Fix i PR #890:** drop `balance` fra INSERT — sett kun `deposit_balance` + `winnings_balance`. `balance` blir auto-computed.

**Lærdom:** Wallet-tabellen har computed `balance = deposit_balance + winnings_balance`. ALDRI INSERT/UPDATE direkte på `balance`.

### Felle 3: Render-log API returnerer IKKE boot-stdout

Brukte over en time på å lete etter "[reset-test-players]" i Render-logs. De finnes ikke der — Render's log API har et tidsvindu som ikke inkluderer boot-tid. Container-stdout fra de første sekundene blir aldri sendt til API-en.

**Workaround:** Lag HTTP-routes (`/api/_dev/...`) som trigger samme kode manuelt og returnerer error i HTTP-response. Da får du faktisk feilkode i stedet for å gjette.

**Eksempel:** PR #889 sin `/api/_dev/reset-test-user` avslørte rotsårsaken (Felle 2) på 30 sekunder.

### Felle 4: `room.isHallShared` er undefined på legacy-rom

ROCKET/MONSTERBINGO opprettet før PILOT-STOP-SHIP-fix 2026-04-27 har `isHallShared: undefined` på server-state. HALL_MISMATCH-sjekken `if (!room.isHallShared && room.hallId !== hallId)` traff for spillere fra andre haller enn den som opprettet rommet.

**Fix i PR #892:** sjekk gameSlug i tillegg — rocket/monsterbingo er ALLTID hall-shared per `canonicalRoomCode.ts`-spec. Defense-in-depth.

```typescript
const sharedSlugs = new Set(["rocket", "game_2", "tallspill", "monsterbingo", "mønsterbingo", "game_3"]);
const isShared = room.isHallShared === true || sharedSlugs.has((room.gameSlug ?? "").toLowerCase());
if (!isShared && room.hallId !== hallId) throw HALL_MISMATCH;
```

### Felle 5: `armedPlayerIds: []` clearing i PerpetualLoop

PerpetualLoop spawnet ny runde med tom armed-liste. Spillere som "armet" via BuyPopup mellom runder mistet sin armed-status → fikk aldri tickets → bonger vises ikke.

**Symptom:** klient sa "Armed successfully", server-debug viste `ticketCount=0`.

**Fix i PR #894:** ny `ArmedPlayerLookup`-callback i `PerpetualRoundServiceConfig`. Begge spawn-pathene leser fra `roomState.armedPlayerIdsByRoom` ved hver runde-start.

```typescript
armedPlayerIds: this.config.armedLookup?.getArmedPlayerIds(roomCode) ?? [],
armedPlayerTicketCounts: this.config.armedLookup?.getArmedPlayerTicketCounts(roomCode) ?? {},
armedPlayerSelections: this.config.armedLookup?.getArmedPlayerSelections(roomCode) ?? {},
```

### Felle 6: SPECTATING-spillere har tickets i `preRoundTickets`, ikke `myTickets`

Spill 1 hadde fallback i `buildTickets`: `myTickets.length > 0 ? myTickets : (preRoundTickets ?? [])`. Spill 2 manglet det. Spillere som joinet mid-RUNNING (SPECTATING) hadde armed-tickets i `state.preRoundTickets` — som ble ignorert → ingen bonger vises.

**Fix i PR #896:** speil Spill 1's mønster. Bonus: `updateInfo` re-kaller `buildTickets` hvis ticket-count har endret seg siden forrige render.

### Felle 7: AUTO_DRAW_INTERVAL_MS default er 30s

Cron-jobben kjører hvert sekund, men throttle-default er 30s mellom hver ball. Ingen `AUTO_DRAW_INTERVAL_MS` env-var var satt på Render → fallback til 30s. Spill 2-runde med 21 baller × 30s = **10,5 minutter per runde**. Frontend ser "statisk" ut fordi du ikke venter lenge nok.

**Fix:** sett `AUTO_DRAW_INTERVAL_MS=3000` på Render. Da trekkes ball hver 3. sekund (~1 min/runde).

**Verifisert via:** Agent II Playwright-test som målte 1 ball / 30s i 90s vindu og koblet til kode-default `?? 30_000` i `index.ts:1953`.

### Felle 8: `demo-hall-001` finnes ikke i prod-DB

Reset-scriptet hardkodet `TEST_PLAYER_HALL_ID = "demo-hall-001"`. På prod fantes ikke den hallen → INSERT av test-bruker feilet på FK → fail-soft swallowed feilen.

**Fix i PR #888:** query `SELECT id FROM app_halls WHERE is_active=true ORDER BY created_at LIMIT 1` før transaksjonen. Bruk faktisk hall-id fra DB. Fallback til konstant med warning.

### Felle 9: Single-transaksjon for resetTestPlayers

Hele scriptet kjørte i én transaksjon. DELETE av andre PLAYER-rader feilet på FK-RESTRICT (compliance-ledger har foreign keys uten CASCADE) → ROLLBACK rullet hele scriptet → INSERT av test-bruker skjedde aldri.

**Fix i PR #887:** split i TX1 (opprett test-bruker først) + TX2 (best-effort cleanup per-rad).

**Lærdom:** ALDRI bunch up critical-success-operasjoner (opprett test-bruker) sammen med best-effort-operasjoner (slett gamle) i samme transaksjon.

### Felle 10: Postgres-checkpoint persisterer stuck state

Etter Render-restart loaded engine room-state fra Postgres-checkpoint. Hvis ROCKET hadde `status=RUNNING + drawnNumbers=21 + endedReason=null` ved restart, kommer det tilbake i samme state etter restart. Render-restart hjelper IKKE.

**Fix i PR #880:** boot-sweep ved oppstart finner stale rocket/monsterbingo-rom og force-ender dem. PR #883 la til `spawnAfterEnd`-callback som umiddelbart spawner ny runde.

---

## 4. ARKITEKTUR — slik fungerer Spill 2 og 3 nå

### Spill 2 (slug: rocket)

**Backend:**
- `Game2Engine` extender `BingoEngine`
- 3×3 grid, 1-21 baller, ÉN ticket-type "Standard"
- Win-condition: full plate (alle 9 celler markert) — `auto-claim-on-draw`-mode
- Jackpot per slot (9-21): 50/100/250/500/1000/2500 kr
- Lucky-number bonus (lastBall === player.luckyNumber + winner)
- ETT globalt rom: `ROCKET` (alle haller deler)

**Auto-loop:**
1. `Game2AutoDrawTickService` kjører hvert sekund
2. Throttle: trekk ball hvis `now - lastDrawAt >= AUTO_DRAW_INTERVAL_MS` (3000ms i prod)
3. På siste ball uten vinner: `Game2Engine.onDrawCompleted` setter status=ENDED med endedReason=G2_NO_WINNER
4. `bingoAdapter.onGameEnded` → `PerpetualRoundService.handleGameEnded` → setTimeout 5s → `engine.startGame` med `armedPlayerIds` fra `roomState`
5. **Stuck-recovery (PR #893):** hvis tick finner et rom med `drawnNumbers.length >= 21 + status=RUNNING + endedReason=null`, kall `forceEndStaleRound` + `spawnFirstRoundIfNeeded` (innen 1s, ikke avhenger av boot)

**Frontend:**
- Egen `Game2Controller` + `PlayScreen.ts` + `BongCard` + `BallTube` + `ComboPanel` + `BuyPopup` + `LykketallPopup` + `CenterBallPop`
- Bong Mockup v2-design: tube øverst, 4 bong-cards 2×2 i midten, ComboPanel sticky bottom (PlayerCard + Hovedspill + Lykketall + Jackpots)
- BuyPopup åpnes KUN ved eksplisitt klikk på "Kjøp flere brett"-pill

### Spill 3 (slug: monsterbingo)

**Backend:**
- `Game3Engine` extender `BingoEngine`
- 5×5 grid uten free-center, 1-75 baller, ÉN ticket-type "Standard"
- 4 mønstre (PR #895): Topp+midt (T), Kryss (X), Topp+diagonal (7), Pyramide — hver 25% av pool
- ETT globalt rom: `MONSTERBINGO` (alle haller deler)

**Auto-loop:** identisk med Spill 2 men med 75 baller-cap

**Frontend:**
- `Game3Controller` importerer DIREKTE fra `../game1/...` (PR #878)
  - `LobbyScreen`, `PlayScreen`, `EndScreen` fra game1
  - Komponenter: BallTube, CenterBall, HeaderBar, etc — alle Spill 1's
  - **ENESTE forskjell:** ÉN ticket-type i stedet for 8 farger
- Pattern-pills viser fortsatt "Rad 1-4 / Full Hus" (norsk auto-mapping fra `displayNameFor`) — IKKE 4 mini-grids ennå
- Mini-game-overlays IKKE wired (Tobias' direktiv: "spille om mønstre")

---

## 5. DEBUG-VERKTØY — bruk disse FØR du gjetter

### `/api/_dev/game2-state` — GET

**Token:** `RESET_TEST_PLAYERS_TOKEN` env-var (verdi: `spillorama-2026-test`)

```bash
curl 'https://spillorama-system.onrender.com/api/_dev/game2-state?token=spillorama-2026-test&roomCode=ROCKET'
```

Returnerer komplett snapshot: status, drawnNumbers, players, ticketCount per player, armedState, lastTickResult, perpetual pending-state.

### `/api/_dev/game2-force-end` — POST

```bash
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/game2-force-end' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test","roomCode":"ROCKET"}'
```

Force-ender stuck rom + spawner ny runde.

### `/api/_dev/reset-test-user` — POST

```bash
curl -X POST 'https://spillorama-system.onrender.com/api/_dev/reset-test-user' \
  -H 'Content-Type: application/json' \
  -d '{"token":"spillorama-2026-test"}'
```

Re-oppretter test-bruker + balance. Returnerer error.message + stack hvis noe feiler.

### Test-bruker

```
Email: test@spillorama.no
Password: Test1234!
```

Hall: auto-pick første aktive (sannsynligvis demo-hall-001 eller første pilot-hall).

### Render API

```
Token:    rnd_yc1N9JDulVfrXKhanAC0eZPcG7Pc
Service:  srv-d7bvpel8nd3s73fi7r4g
Owner:    tea-d6k3pmfafjfc73fdh9mg
```

Logs API:
```bash
curl "https://api.render.com/v1/logs?ownerId=tea-d6k3pmfafjfc73fdh9mg&resource=srv-d7bvpel8nd3s73fi7r4g&limit=500&direction=backward" \
  -H "Authorization: Bearer rnd_yc1N9JDulVfrXKhanAC0eZPcG7Pc"
```

⚠️ **HUSKE:** Render-log API returnerer IKKE boot-stdout. Bruk HTTP debug-endpoints i stedet.

---

## 6. ENV-VARS som er satt på Render

| Variabel | Verdi | Hvorfor |
|---|---|---|
| `AUTO_DRAW_INTERVAL_MS` | `3000` | Spill 2/3 trekker ball hver 3. sekund |
| `PERPETUAL_LOOP_DELAY_MS` | `30000` | 30s pause mellom runder (kan reduseres til 5s for raskere demo) |
| `RESET_TEST_PLAYERS` | `true` | Boot-script oppretter test@spillorama.no — fjern når test er bekreftet |
| `RESET_TEST_PLAYERS_TOKEN` | `spillorama-2026-test` | Token for `/api/_dev/...`-endpoints |
| `NODE_ENV` | `production` | Standard prod-config |

⚠️ **TODO:** Fjern `RESET_TEST_PLAYERS=true` etter test-bruker er bekreftet fungere — ellers kjører scriptet ved hver boot og rydder bort eventuelle nye PLAYER-rader.

---

## 7. NESTE STEG — prioritet

### P0 — pilot-blokker
1. **Verifiser PR #896 fungerer ende-til-ende** — Tobias må teste at bonger faktisk vises etter han har armet brett, og at ball-pop-animasjon vises
2. **Fjern `RESET_TEST_PLAYERS` env-var** etter test-bruker er bekreftet
3. **Spill 3 frontend mini-grids** — bytt ut "Rad 1-4 / Full Hus"-tekst-pills med 4 mini-grids fra patterns.jsx-design

### P1 — kvalitet
4. **Game3Engine.test.ts** — 10/16 tester feiler etter PR #895. Skriv om til ny pattern-semantikk.
5. **Loading-overlay i Game3Controller** — droppet pga merge-konflikt i PR #879
6. **PERPETUAL_LOOP_DELAY_MS** — kanskje reduser til 5000 (5s) for raskere demo-flyt

### P2 — pre-pilot polish
7. **Frontend rendring av nye Spill 3-mønstre** når en ball matcher pattern-cells
8. **Reset-script fjerner ENV-var-avhengigheten** — lag `/api/admin/reset-test-user`-endpoint i stedet for boot-script

---

## 8. KJENT DEBT

### Test-suite-debt
- `Game3Engine.test.ts`: 10/16 fails (PR #895 endret pattern-set)
- `MysteryGameOverlay.test.ts`: 1 pre-existing fail ("Spill igjen"-knapp) — uavhengig av min sesjon
- `apps/backend/src/__tests__/invariants/*.test.ts`: pre-existing `fast-check` import-feil — uavhengig

### Konfig-debt
- `RESET_TEST_PLAYERS=true` env-var står på prod — må fjernes
- `demo-hall-001` finnes ikke alle prod-DB-er — boot-script auto-picker første aktive
- `room.isHallShared=undefined` på legacy ROCKET/MONSTERBINGO-rom — defense-in-depth (PR #892) håndterer det, men én gang opprydding ville være rent

### Code-debt
- `PerpetualRoundService.spawnFirstRoundIfNeeded` har duplikat-kode med `handleGameEnded` (begge spawner runde med samme parametere) — kunne refaktoreres
- `Game2AutoDrawTickService` har lokal mutex per rom — duplikat med engine-mutex
- 4 separate auto-restart-mekanismer (cron-tick, perpetual-loop, boot-sweep, room:join-spawn) — kunne konsolideres

---

## 9. WORKFLOW-LÆRDOMMER for ny PM

### Bruk debug-endpoints FØR du gjetter
- Hver gang du ser "noe feiler stille på prod", lag en HTTP-route som returnerer error med stack
- Render-log API gir IKKE boot-stdout — gjette på hva som skjedde tar timer

### Spawn diagnose-agenter parallelt med fix-agenter
- Agent II (Playwright) løste på 90s det jeg brukte 2 timer på å gjette
- Worktree-isolasjon (`isolation: "worktree"`) er essensielt — 2-3 agenter kan jobbe på Spill 2-koden samtidig uten å trampe hverandre

### Test-bruker-credentials er heilig
- ALDRI dropp `RESET_TEST_PLAYERS_TOKEN` — det blokkerer Tobias fra å hjelpe seg selv
- Hold credentials i toppen av handover-dokumenter

### "Bonger vises ikke" har minst 5 mulige rotsårsaker
1. Server har ikke tickets (perpetual-loop clearer armed)
2. SPECTATING bruker preRoundTickets ikke myTickets
3. Bridge.applySnapshot fyrer ikke buildTickets
4. PlayScreen.bongGridContainer har feil container-state
5. Klient-token utløpt → Spillvett-feil → Loading-overlay setError

Bruk `/api/_dev/game2-state` til å verifisere SERVER-side først.

### Tobias' direktiv-nivå
- "Sett en agent" = spawn med Agent-tool, ikke gjør det selv
- "Test til det funker" = iterer + verifiser etter hver deploy
- "Som spill 1" = porter design fra Spill 1 (BallTube, CenterBall, etc)
- "Skal være da kun..." = STRICT element-cleanup, fjern alt annet

### Render-deploy timing
- Build: 5-7 min
- Deploy: 1-2 min for "build_in_progress" → "live"
- Cache-clear deploy: 8-10 min totalt
- ALDRI gjør 2 deploys back-to-back mens første ennå bygger — Render køer dem og du venter dobbelt

---

## 10. KONTAKT

**Tobias' aktive flow:**
- Tester live på https://spillorama-system.onrender.com/web/
- Sender screenshots + console-output i chat
- Forventer PR-merge + deploy innen 5-10 min per fix-iterasjon
- Verdsetter konkret diagnose framfor gjetning

**Repo-konvensjon (PM-sentralisert git-flow):**
- Agenter pusher feature-branches
- PM kjører `gh pr create` + `gh pr merge --squash --admin`
- ALDRI merge fra agent-worktree (use --admin override for å bypasse CI-feil som ikke er relatert)

---

**Lykke til.** Du har 24 PRs som backstop. ROCKET fungerer, MONSTERBINGO fungerer. Det viktigste som gjenstår er: bekreft Tobias ser bonger + ball-anim, port mønster-mini-grids til Spill 3 frontend, og fjern `RESET_TEST_PLAYERS` env-var.

— Forrige PM, 2026-05-04
