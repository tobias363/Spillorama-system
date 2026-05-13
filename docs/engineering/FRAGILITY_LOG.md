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

## F-01: PlayScreen.update() popup-auto-show gate (4 conditions, oppdatert 2026-05-13)

**Filer:** `packages/game-client/src/games/game1/screens/PlayScreen.ts:693-720`

**Hvorfor fragile:** 4 gate-conditions må ALLE være riktige for at popup vises:
1. `!autoShowBuyPopupDone` — kan settes feil sted og forhindre re-vis
2. `!hasLive` — krever korrekt `myTickets.length`-sjekk
3. `hasTicketTypes` — krever at lobbyTicketConfig ELLER state.ticketTypes er befolket
4. `preRoundTicketsCount === 0` — krever korrekt routing av pre-round vs live-tickets

**FJERNET 2026-05-13:** `!waitingForMasterPurchase` var tidligere gate-condition (PR #1255 Alternativ B). Tobias-rapport 2026-05-13: "popup må komme frem uavhengig av hvilken runde som kjøres så lenge det er innenfor åpningstid". Fix: fjern gate-conditionen — popup vises uansett. Server-side `Game1ArmedToPurchaseConversionService` konverterer armed bonger → purchases ved master-start, så orphan-risiko eliminert.

Endring i ÉN av disse uten å verifisere de ANDRE = popup mismatched mot Tobias-flyt.

**Hva ALDRI gjøre:**
- Legge til ny gate-condition uten å oppdatere alle testene under
- Fjerne `getEventTracker().track("popup.autoShowGate", ...)` — server-side monitor avhenger av det
- Endre `autoShowBuyPopupDone`-reset-logikk uten å forstå idle-state-modus
- Re-introdusere `!waitingForMasterPurchase` som gate-blokker — Tobias-direktiv 2026-05-13 sier popup MÅ vises på første runde også

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
- Tobias-rapport 2026-05-13 (kveld): popup vises ikke ved FØRSTE entry FØR runde har kjørt — `waitingForMasterPurchase=true` blokkerte gate. Live-monitor fanget bug-en (3036 iterations, 163 gate-evaluations, kun 2 willOpen=true). Fix: fjern `!waitingForMasterPurchase` fra gate-condition (denne PR).

---

## F-02: Plan-run lifecycle — stuck-state mellom test-cleanup og master-action

**Status:** FIXED 2026-05-13 (I16) — auto-reconcile fra lobby-poll lagt til.

**Filer:**
- `apps/backend/src/game/GamePlanRunService.ts` — `start/advance/stop`-methods
- `apps/backend/src/game/MasterActionService.ts` — `tryReconcileTerminalScheduledGame` (PR #1286, master-action-side)
- `apps/backend/src/game/Game1LobbyService.ts:730-833` — `tryReconcileTerminalScheduledGame` (lobby-poll-side, I16-fix)
- `tests/e2e/helpers/rest.ts` — `resetPilotState`

**Hvorfor fragile:** Plan-run-state og scheduled-game-state er TO uavhengige state-maskiner som MÅ reconcileres. `masterStop()` rydder bare scheduled-game (status → 'completed'), ikke plan-run (status forblir 'running') hvis `wrapEngineError` kaster FØR `planRunService.finish()` rakk å kjøre. Lobby-state-aggregator returnerer da `currentScheduledGameId` med scheduled-status='completed' + run-status='running' = ingen joinable game for klient. **Symptom: popup vises ikke selv om master har "startet runde".**

**Hva ALDRI gjøre:**
- Kalle `masterStop()` uten å også resette `app_game_plan_run.status` (eller dokumentere "stuck state godkjent")
- Endre `Game1LobbyService.buildNextGameFromItem` uten å sjekke at både plan-run + scheduled-game-state speiler hverandre
- Anta at `runStatus="running"` betyr "joinable game finnes"
- Fjerne `TERMINAL_SCHEDULED_GAME_STATUSES`-konstanten fra `Game1LobbyService.ts` uten å replisere logikken — auto-reconcile er pilot-blokker-fix

**Hvilke tester MÅ stå grønn etter endring:**
- `apps/backend/src/game/__tests__/Game1LobbyService.reconcile.test.ts` (10 unit-tester, I16)
- `apps/backend/src/game/Game1LobbyService.test.ts` (14 eksisterende tester)
- `apps/backend/src/routes/__tests__/spill1Lobby.test.ts` (7 route-tester)
- `tests/e2e/spill1-pilot-flow.spec.ts`
- `tests/e2e/spill1-manual-flow.spec.ts` (lagt til 2026-05-13 — se F-03)

**Manuell verifikasjon:**
1. Kjør `npm run test:pilot-flow`
2. Etter test ferdig: kjør curl-blokk:
   ```bash
   TOK=$(curl -s "http://localhost:4000/api/dev/auto-login?email=demo-agent-1@spillorama.no" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])")
   curl -s "http://localhost:4000/api/agent/game1/lobby?hallId=demo-hall-001" -H "Authorization: Bearer $TOK" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"runStatus={d.get('planMeta',{}).get('planRunStatus')}, scheduledStatus={d.get('scheduledGameMeta',{}).get('status') if d.get('scheduledGameMeta') else None}\")"
   ```
3. Etter at ny lobby-poll har gått (innen 10s av første spiller-shell-load), skal output være `runStatus=finished` (auto-healt) eller `runStatus=running, scheduledStatus=null` (scheduled-game skjult). IKKE `runStatus=running, scheduledStatus=completed` lenger — det er nå reconciled automatisk på read-path.

**Historisk skade:**
- 2026-05-13 (I16): Etter E2E-test-suite kjørt, plan-run forble "running" mens scheduled-game var "completed". Tobias' manuelle test 1.5h senere så ingen popup → 1h diagnose for å finne stuck state.

**Fix (I16, 2026-05-13):** `Game1LobbyService.tryReconcileTerminalScheduledGame` auto-healer state på lobby-poll. To grener:
- Siste plan-position + terminal scheduled-game → auto-finish plan-run via `planRunService.finish` (idempotent, audit-actor `system:lobby-auto-reconcile`).
- Ikke-siste position + terminal scheduled-game → hide scheduled-game fra response (`scheduledGameId=null`, overallStatus='idle') så klient ikke prøver å joine en avsluttet runde. Master må advance manuelt.
- Fail-safe: DB-feil under finish logges men kaster aldri — neste poll prøver igjen.
- Concurrency: race mellom to lobby-polls håndteres av `changeStatus`-validering (`GAME_PLAN_RUN_INVALID_TRANSITION` fanges).

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

## F-06: PM Push Control — registry og scope-deklarasjon

**Filer:**
- `scripts/pm-push-control.mjs:1-1103` — registry-CRUD, list, conflicts, merge-order
- `.claude/active-agents.json` — persistent registry (etablert PR #1342)
- `.github/workflows/auto-rebase-on-merge.yml` — auto-rebase orkestrering
- `docs/engineering/PM_PUSH_CONTROL.md` — operasjonell guide

**Hvorfor fragile:** PM Push Control er meta-tool som ALLE PM-er trenger for multi-agent-koordinering. Hvis scope-deklarasjon-format brytes, mister vi konflikt-deteksjon før push. Hvis auto-rebase-workflow brytes, må PM manuelt rebase ALLE overlappende PR-er (cascade × N). Phase 2-fixet la til hooks + auto-rebase + dashboard. Endringer her kan rive ned hele orkestreringen.

**Hva ALDRI gjøre:**
- Endre `agents[].scope`-shape uten å oppdatere `globMatch`-funksjonen
- Fjerne `conflictsAcknowledged`-feltet — det er hele dokumentasjonen for forventede merges
- Hardkode kun bash 4-features (ref §5.8) — macOS-PM kan ikke kjøre
- Endre `gh api PUT /repos/.../pulls/N/update-branch` til REST POST — endpoint krever PUT
- Slette `/tmp/active-agents.json` mens daemon kjører — orphan'er agenter

**Hvilke tester MÅ stå grønn etter endring:**
- `scripts/__tests__/pm-push-control.test.mjs` (hvis eksisterer; ellers TODO)
- `npm run test:pilot-flow` — push-control-ruten må fortsatt fungere
- E2E-test for `register → list → conflicts → unregister` lifecycle (pending E5)
- `auto-rebase-on-merge.yml` workflow må kjøre grønt på sample PR

**Manuell verifikasjon:**
1. `node scripts/pm-push-control.mjs list` returnerer registry
2. Register test-agent: `node scripts/pm-push-control.mjs register TEST test/branch docs/test.md`
3. `node scripts/pm-push-control.mjs conflicts` viser ingen issues
4. Unregister: `node scripts/pm-push-control.mjs unregister TEST`
5. Verifiser ingen orphan-rader

**Historisk skade:**
- 2026-05-13 (Phase 1 + 2): bygget under aktiv 11-agent-sesjon, cascade-rebase × 14
- 2026-05-13 (D1 add/add conflict): scripts/pm-push-control.mjs duplisert til 1381 linjer broken JS — løst med `git merge -X ours` (ref §5.10)

---

## F-07: Worktree-isolation forutsetter parent på origin/main

**Filer:**
- Alle agent-spawn-points med `isolation: "worktree"`
- `PITFALLS_LOG.md §11.16`

**Hvorfor fragile:** Claude Agent SDK worktree-isolation forker fra parent's HEAD (Tobias' lokale main repo). Hvis parent er på feature-branch (eks `fix/reentry-during-draw-2026-05-13` etter Tobias drar siste PR), ALLE worktrees inherits den branchen. Resultat: agenter committer på branch som er foran origin/main → cascade-rebase × N for hver agent som merger.

**Hva ALDRI gjøre:**
- Spawne ≥ 2 parallelle agenter UTEN først å verifisere `git status` viser main + up-to-date
- Anta at Tobias' main-repo er ren — det er hans arbeidsmiljø, ikke et CI-environment
- Bruke `isolation: "worktree"` for write-PR-agenter når parent har uncommitted endringer
- Force-push fra worktree til Tobias' main repo

**Hvilke tester MÅ stå grønn etter endring:**
- Manuell: spawn 2 parallelle agenter, verifiser de begge forker fra `origin/main` ikke parent's branch
- Pilot-flow E2E må fortsatt fungere fra fresh main checkout

**Manuell verifikasjon:**
1. Før parallel-spawn: `cd /Users/tobiashaugen/Projects/Spillorama-system && git status`
2. Verifiser output: "On branch main", "Your branch is up-to-date with 'origin/main'"
3. Hvis avvik: `git checkout main && git pull --rebase --autostash` FØR spawn
4. Hvis dirty (untracked files): rydd via `git stash -u` eller eksplisitt `rm` (med Tobias-godkjennelse)

**Historisk skade:**
- 2026-05-13 (Wave 2): 11 agenter spawnet fra Tobias' fix-branch, cascade-rebase × 14 iterasjoner over 4 timer
- Tobias-direktiv §2.2: PM eier `git pull` etter HVER PR-merge → forhindrer dette mønsteret

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
| 2026-05-13 | F-02 FIXED (I16) — auto-reconcile fra lobby-poll i `Game1LobbyService.tryReconcileTerminalScheduledGame`. 10 unit-tester, < 50ms latency, idempotent. | Agent (I16) |

---

| 2026-05-13 | F-05 — Re-attach-guard i ALLE room-join handler-paths (etter I15-fix på `joinScheduledGame`) | reentry-fix agent |
| 2026-05-13 | F-03 oppdatert — test eksisterer nå (`tests/e2e/spill1-manual-flow.spec.ts`), status fra "gap" til "test må stå grønn" | Backend-agent |
| 2026-05-13 | F-06 — PM Push Control (`scripts/pm-push-control.mjs`) er meta-tool som styrer multi-agent-koordinering. F-07 — Worktree-isolation forutsetter parent på origin/main (Wave 2 cascade × 14). | PM-AI (E6 redo) |
