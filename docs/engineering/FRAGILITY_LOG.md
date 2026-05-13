# FRAGILITY_LOG — kode som ALDRI skal røres uten verifisering

**Status:** Autoritativ. Hver entry kobler en kode-region til konkrete tester + regler som MÅ holde grønn.
**Vedlikehold:** Hver bug-fix MÅ legge til en entry her hvis fixen avdekket en fragility. Hver agent MÅ lese relevante entries før de rører nevnte filer.
**Etablert:** 2026-05-13 etter Tobias-direktiv: *"Vi gjør endringer som skaper problemer. Har vi nå satt opp at alt som blir gjort blir loggført og skills oppdatert så man vet at denne da ikke kan røres for det ødelegger det popup-funksjonaliteten?"*

> **Format per entry:**
> ```
> ## F-NN: <kort tittel>
> - **Filer:** <eksakte file:line refs>
> - **Hvorfor fragile:** 1-3 setninger
> - **Hva ALDRI gjøre:** liste
> - **Hvilke tester MÅ stå grønn etter endring:** liste
> - **Manuell verifikasjon:** spesifikk flyt
> - **Historisk skade:** PR/dato/symptom
> ```

---

## F-01: PlayScreen.update() popup-auto-show gate (5 conditions)

**Filer:** `packages/game-client/src/games/game1/screens/PlayScreen.ts:693-720`

**Hvorfor fragile:** 5 gate-conditions må ALLE være riktige for at popup vises:
1. `!autoShowBuyPopupDone` — kan settes feil sted og forhindre re-vis
2. `!hasLive` — krever korrekt `myTickets.length`-sjekk
3. `hasTicketTypes` — krever at lobbyTicketConfig ELLER state.ticketTypes er befolket
4. `!waitingForMasterPurchase` — krever at `pickJoinableScheduledGameId(state)` returnerer ikke-null
5. `preRoundTicketsCount === 0` — krever korrekt routing av pre-round vs live-tickets

Endring i ÉN av disse uten å verifisere de ANDRE = popup mismatched mot Tobias-flyt.

**Hva ALDRI gjøre:**
- Legge til ny gate-condition uten å oppdatere alle 4 testene under
- Fjerne `getEventTracker().track("popup.autoShowGate", ...)` — server-side monitor avhenger av det
- Endre `autoShowBuyPopupDone`-reset-logikk uten å forstå idle-state-modus
- Sette `waitingForMasterPurchase = true` permanent — vil låse popup forever

**Hvilke tester MÅ stå grønn etter endring:**
- `tests/e2e/spill1-pilot-flow.spec.ts` — full happy-path
- `tests/e2e/spill1-no-auto-start.spec.ts` — regresjons-vern
- `tests/e2e/spill1-wallet-flow.spec.ts` — STAKE-asserts
- `tests/e2e/spill1-rad-vinst-flow.spec.ts` — Rad-vinst-flyt

**Manuell verifikasjon:** Etter merge, kjør lokalt:
1. `npm run dev:nuke`
2. Master start runde via `/admin/agent/cash-in-out`
3. Åpne `/web/?debug=1` som spiller
4. Klikk Bingo-tile
5. **Verifiser popup vises med 6 bongfarger og korrekte priser (5/10/15/15/30/45)**
6. Sjekk `/tmp/pilot-monitor.log` for `popup.autoShowGate { willOpen: true, ... }`

**Historisk skade:**
- PR #1273 (2026-05-12): auto-show var én-shot-per-session → fikset til per-runde
- PR #1279 (2026-05-12): `waitingForMasterPurchase` låste Buy-knapp → fjernet
- PR #1303 (2026-05-13): `state.entryFee` brukt feil → bruker nå `lobbyTicketConfig.entryFee`
- I14 (2026-05-13): popup vises ikke pga stuck plan-run-state — root cause var IKKE popup-kode men plan-runtime (se F-02)

---

## F-02: Plan-run lifecycle — stuck-state mellom test-cleanup og master-action

**Filer:**
- `apps/backend/src/game/GamePlanRunService.ts` — `start/advance/stop`-methods
- `apps/backend/src/game/MasterActionService.ts` — `tryReconcileTerminalScheduledGame` (PR #1286)
- `tests/e2e/helpers/rest.ts` — `resetPilotState`

**Hvorfor fragile:** Plan-run-state og scheduled-game-state er TO uavhengige state-maskiner som MÅ reconcileres. `masterStop()` rydder bare scheduled-game (status → 'completed'), ikke plan-run (status forblir 'running'). Lobby-state-aggregator returnerer da `currentScheduledGameId` med scheduled-status='completed' + run-status='running' = ingen joinable game for klient. **Symptom: popup vises ikke selv om master har "startet runde".**

**Hva ALDRI gjøre:**
- Kalle `masterStop()` uten å også resette `app_game_plan_run.status` (eller dokumentere "stuck state godkjent")
- Endre `Game1LobbyService.buildNextGameFromItem` uten å sjekke at både plan-run + scheduled-game-state speiler hverandre
- Anta at `runStatus="running"` betyr "joinable game finnes"

**Hvilke tester MÅ stå grønn etter endring:**
- `tests/e2e/spill1-pilot-flow.spec.ts`
- `tests/e2e/spill1-manual-flow.spec.ts` (lagt til 2026-05-13 — se F-03)

**Manuell verifikasjon:**
1. Kjør `npm run test:pilot-flow`
2. Etter test ferdig: kjør curl-blokk:
   ```bash
   TOK=$(curl -s "http://localhost:4000/api/dev/auto-login?email=demo-agent-1@spillorama.no" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])")
   curl -s "http://localhost:4000/api/agent/game1/lobby?hallId=demo-hall-001" -H "Authorization: Bearer $TOK" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"runStatus={d.get('planMeta',{}).get('planRunStatus')}, scheduledStatus={d.get('scheduledGameMeta',{}).get('status') if d.get('scheduledGameMeta') else None}\")"
   ```
3. Hvis output viser `runStatus=running, scheduledStatus=completed` = stuck state. **FIX:** Test må rydde plan-run, ikke bare scheduled-game.

**Historisk skade:**
- 2026-05-13 (I16): Etter E2E-test-suite kjørt, plan-run forble "running" mens scheduled-game var "completed". Tobias' manuelle test 1.5h senere så ingen popup → 1h diagnose for å finne stuck state.

**Foreslått varig fix:** `MasterActionService` skal auto-reconcile fra lobby-poll, ikke kun fra master-action. Se TODO i `tryReconcileTerminalScheduledGame`.

---

## F-03: Test-coverage-gap — manuell flyt har E2E-test (test eksisterer, må stå grønn)

**Status:** ✅ Test eksisterer per 2026-05-13. Tidligere status var "test missing" (gap). Nå: gapet er lukket, men testen er fragile fordi hele dens eksistens er en motvekt til E2E-shortcuts.

**Filer:**
- `tests/e2e/spill1-manual-flow.spec.ts` — mimicker Tobias' faktiske bruks-flyt
- `tests/e2e/helpers/manual-flow.ts` — login-via-redirect + hall-picker-helpers

**Hvorfor fragile (fortsatt):** Test bruker BEVISST ingen pre-seed og ingen direct token-inject. Hvis noen "optimaliserer" testen ved å pre-seed `sessionStorage.lobby.activeHallId` eller injecte token direkte, mister vi hele verdien av denne testen — den blir bare en duplikat av `spill1-pilot-flow.spec.ts`.

Eksisterende E2E-tester (særlig `spill1-pilot-flow.spec.ts`) pre-seeder `sessionStorage.lobby.activeHallId` + injecter token direkte. Tobias' manuelle flyt traverserer auth-redirect-flow + lobby-default. **Strukturelt forskjellige scenarier.** Tester kan passere mens manuell feiler — dette er hele rationale for `spill1-manual-flow.spec.ts`.

**Hva ALDRI gjøre:**
- Anta at "E2E grønn = manuell flyt grønn" — det er FALSKT
- "Optimalisere" `spill1-manual-flow.spec.ts` ved å skipe redirect-flow eller pre-seede hall
- Lukke pilot-bug uten å verifisere manuell-flyt parallelt
- Slette eller refaktorere bort `loginViaDevUserRedirect`-helperen — det er hele poenget

**Hvilke tester MÅ stå grønn etter endring:**
- ALL eksisterende E2E (kjør `npm run test:pilot-flow`)
- **`tests/e2e/spill1-manual-flow.spec.ts`** (kjør `npm run test:pilot-flow:manual`)
- 3 consecutive passes for manual-flow før merge

**Manuell verifikasjon:** ALDRI lukk pilot-relatert PR uten at Tobias har gjort manuell smoke-test post-merge.

**Historisk skade:**
- 2026-05-13: E2E passet @ 10:40, manuell flyt feilet @ 12:00 — vi trodde alt var bra, det var ikke.
- 2026-05-13 (samme dag): `spill1-manual-flow.spec.ts` lagt til, lukker gapet ved at CI nå dekker både shortcut-path og manual-path.

---

## F-04: ConsoleBridge regex-patterns

**Filer:** `packages/game-client/src/games/game1/debug/ConsoleBridge.ts:33-47`

**Hvorfor fragile:** ConsoleBridge filterer hvilke console-meldinger som pushes til server. Hvis vi fjerner en pattern, mister live-monitor synlighet for den kategorien. Hvis vi gjør den for liberal (catch-all), spammes event-bufferen.

**Hva ALDRI gjøre:**
- Bytt ut `RELEVANT_PATTERNS`-listen med catch-all
- Fjern `[BUY-DEBUG]`, `[ROOM]`, `[CLI-BINGO]` fra listen uten å oppdatere monitor

**Hvilke tester MÅ stå grønn etter endring:**
- TODO: `ConsoleBridge.test.ts` (følger)

**Manuell verifikasjon:** Etter endring, refresh `/web/?debug=1` og sjekk `/tmp/pilot-monitor.log` for `console.log`-events.

**Historisk skade:** Ny komponent (2026-05-13).

---

## F-05: Re-attach-guard i ALLE room-join handler-paths

**Filer:**
- `apps/backend/src/sockets/game1ScheduledEvents.ts:288-365` — `joinScheduledGame` (I15-fix)
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:372-397` — `room:create` (reference-pattern)
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:771-806` — `room:join` (reference-pattern)
- `apps/backend/src/game/BingoEngine.ts:3790-3800` — `attachPlayerSocket`
- `apps/backend/src/game/BingoEngine.ts:3802-3831` — `detachSocket` (beholder player-record bevisst)
- `apps/backend/src/util/roomHelpers.ts:71-78` — `findPlayerInRoomByWallet`

**Hvorfor fragile:** `engine.detachSocket` beholder player-record (nullstiller KUN socketId) av regulatoriske grunner — armed-state, lucky-number-valg og forhåndskjøpte bonger må overleve disconnect/reconnect. Konsekvensen er at ALLE room-join-paths MÅ ha en re-attach-guard som speiler `room:join`/`room:create`-mønsteret. Mangler en handler-path guarden, kaster `engine.joinRoom` → `assertWalletNotAlreadyInRoom` → `PLAYER_ALREADY_IN_ROOM` ved re-entry mid-runde, og spilleren havner i `Game1LobbyFallback`-overlay i stedet for pågående runde.

Mønster som alle handlers MÅ følge før `engine.joinRoom`:
```ts
const snapshot = engine.getRoomSnapshot(roomCode);
const existing = findPlayerInRoomByWallet(snapshot, walletId);
if (existing) {
  engine.attachPlayerSocket(roomCode, existing.id, socketId);
  // ... return existing.id som playerId
  return;
}
// Kun fall gjennom til joinRoom hvis player IKKE finnes.
```

**Hva ALDRI gjøre:**
- Kalle `engine.joinRoom` uten å først sjekke `findPlayerInRoomByWallet` (du vil treffe `PLAYER_ALREADY_IN_ROOM` ved enhver reconnect)
- Fjerne re-attach-guarden fra `room:create`/`room:join`/`joinScheduledGame`/`handleScheduledGameDelta` "for å forenkle" — alle fire pathene MÅ ha den
- Legge til ny join-handler-path uten å speile guard-mønsteret
- Endre `detachSocket` slik at den faktisk fjerner player-record fra `room.players` (regulatorisk feil — armed-state forsvinner)
- Endre `assertWalletNotAlreadyInRoom` til å "ignorere" wallets med null socket (defeats hele guard-poenget)

**Hvilke tester MÅ stå grønn etter endring:**
- `apps/backend/src/sockets/__tests__/game1ScheduledEvents.reconnect.test.ts` — re-attach-pathen (4 tester)
- `apps/backend/src/sockets/__tests__/game1JoinScheduled.test.ts` — happy-path + race + status-gate (15 tester)
- `apps/backend/src/sockets/__tests__/roomEvents.scheduledBinding.test.ts` — room:resume scheduled-binding
- `apps/backend/src/sockets/__tests__/reconnectMidPhase.test.ts` — mid-phase reconnect
- `tests/e2e/spill1-reentry-during-draw.spec.ts` — E2E re-entry under aktiv trekning
- Alle `tests/e2e/spill1-*.spec.ts`-tester som inneholder `returnToShellLobby` eller socket-reconnect

**Manuell verifikasjon:**
1. `npm run dev:nuke`
2. Master starter en runde via `/admin/agent/cash-in-out`
3. Vent til status=`running` + minst 1 draw skjedd (~6s)
4. Spiller åpner `/web/?debug=1`, klikker bingo-tile → play-screen vises
5. Klient kaller `returnToShellLobby()` (back-knapp i lobby.js)
6. Spiller klikker bingo-tile igjen
7. **Verifiser at klient lander på play-screen UTEN `PLAYER_ALREADY_IN_ROOM`-feil i console** og UTEN at `Game1LobbyFallback`-overlay vises
8. Sjekk backend-log for `room.player.attached` (ikke `room.player.joined`)

**Historisk skade:**
- **2026-05-11 (PR #1218):** Samme bug-klasse i `handleScheduledGameDelta`-pathen (hall-default → scheduled-game upgrade). Fikset KUN delta-watcher-pathen. `joinScheduledGame` initial-join-pathen ble glemt → I15 (denne bug-en) oppstod 2026-05-13. Konklusjon: ÉN handler-path-fix er ikke nok — ALLE join-handlere må ha samme guard.
- **2026-05-13 (I15):** Tobias-rapport: "etter at jeg starter spill går ut av lobbyen for deretter å gå inn igjen så kommer jeg ikke inn i rommet under en trekning". Diagnose-doc: `docs/architecture/REENTRY_BUG_DIAGNOSE_2026-05-13.md`. Repro-test: `tests/e2e/spill1-reentry-during-draw.spec.ts`. Fix: `fix/reentry-during-draw-2026-05-13` (denne PR).

**Relatert:**
- PITFALLS_LOG §7.13 — `PLAYER_ALREADY_IN_ROOM` ved upgrade fra hall-default til scheduled-game (PR #1218)
- BUG_CATALOG.md I15 — re-entry-during-draw

---

## Format for ny entry

Når du fikser en bug som er ikke-triviell, OG du har sett at endring andre steder kunne ha brutt din fix, legg til:

```markdown
## F-NN: <kort tittel>
- **Filer:** path/to/file.ts:line-range
- **Hvorfor fragile:** ...
- **Hva ALDRI gjøre:** ...
- **Hvilke tester MÅ stå grønn:** ...
- **Manuell verifikasjon:** ...
- **Historisk skade:** PR-nr, dato, symptom
```

---

## Kobling til PR-template

PR-template har checkbox-seksjon "Knowledge protocol". Hvis PR rører et filsett som er nevnt i FRAGILITY_LOG, MÅ utvikleren bekrefte:

- [ ] Jeg har lest FRAGILITY_LOG F-NN for filene jeg endrer
- [ ] Jeg har kjørt testene listet under "Hvilke tester MÅ stå grønn"
- [ ] Jeg har utført manuell verifikasjon hvis FRAGILITY-entry krever det

Håndheves manuelt under PR-review (TODO: automatiser via danger-rule).

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — F-01 PlayScreen.update gate, F-02 plan-run lifecycle, F-03 manuell-flyt-gap, F-04 ConsoleBridge | PM-AI (Tobias-direktiv) |
| 2026-05-13 | F-05 — Re-attach-guard i ALLE room-join handler-paths (etter I15-fix på `joinScheduledGame`) | reentry-fix agent |
| 2026-05-13 | F-03 oppdatert — test eksisterer nå (`tests/e2e/spill1-manual-flow.spec.ts`), status fra "gap" til "test må stå grønn" | Backend-agent |
