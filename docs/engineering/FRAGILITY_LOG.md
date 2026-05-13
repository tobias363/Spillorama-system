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
- ALLE manuell-flyt-tester (ikke skrevet enda — er en gap, se F-03)

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

## F-03: Test-coverage-gap — manuell flyt har ikke E2E-test

**Filer:** `tests/e2e/*.spec.ts` — ingen test mimicker Tobias' manuelle flyt

**Hvorfor fragile:** Eksisterende E2E-tester pre-seeder `sessionStorage.lobby.activeHallId` + injecter token direkte. Tobias' manuelle flyt traverserer auth-redirect-flow + lobby-default. **Strukturelt forskjellige scenarier.** Tester kan passere mens manuell feiler.

**Hva ALDRI gjøre:**
- Anta at "E2E grønn = manuell flyt grønn" — det er FALSKT
- Lukke pilot-bug uten å verifisere manuell-flyt parallelt

**Hvilke tester MÅ stå grønn etter endring:**
- ALL eksisterende E2E
- TODO: `tests/e2e/spill1-manual-flow.spec.ts` (mimicker manuell flyt — uten pre-seed)

**Manuell verifikasjon:** ALDRI lukk pilot-relatert PR uten at Tobias har gjort manuell smoke-test post-merge.

**Historisk skade:**
- 2026-05-13: E2E passet @ 10:40, manuell flyt feilet @ 12:00 — vi trodde alt var bra, det var ikke.

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
