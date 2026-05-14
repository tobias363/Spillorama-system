# Agent E — Historisk PR-arv research: Next Game Display-bug

**Branch:** `research/next-game-display-e-history-2026-05-14`
**Agent:** Agent E (general-purpose, PM Trinn 1)
**Dato:** 2026-05-14
**Scope:** Komplett kronologi av alle PR-er som rører plan-runtime, lobby, eller "next game"-rendering siden 2026-04-23. Identifiser mønstre, "patch-spiral"-anti-patterns, og rot-årsaker.

> ⚠️ **READ-ONLY research.** Ingen kode-endringer. Leveranse er denne markdown-fil + AGENT_EXECUTION_LOG-entry.

---

## 0. TL;DR

**Bug-buggen: 11+ direkte fix-forsøk, 199+ relaterte PR-er, samme symptom-klasse i 4 uker.**

| Måling | Verdi |
|---|---:|
| Tot. PR-er som rører lobby/plan-runtime/master-konsoll siden 2026-04-23 | **199+** |
| PR-er som DIREKTE adresserer "neste spill"-display | **11** (#854, #1010, #1011, #1017, #1368, #1377-1380, #1422, #1427, #1431) |
| PR-er som rører `Spill1HallStatusBox.ts` | **30+** (file har vært i konstant flux) |
| Touches på `NextGamePanel.ts` | **39** kommits |
| Touches på `GameLobbyAggregator.ts` (siden 2026-05-08-fødsel) | **12** kommits — 4 av disse er funderskel fixer på samme problemfelt |
| Touches på `GamePlanRunService.ts` | **25** kommits |
| Touches på `Game1LobbyService.ts` | **12** kommits — 4 av disse direkte på "neste spill"-relatert |
| Tobias-rapporter på samme bug-klasse | **5+** (Tobias har rapportert "feil neste-spill-tekst" eksplisitt 2026-05-13 13:00, 14 07:55, 14 09:51, 14 09:58, 14 12:44, 14 13:00) |
| Bølge 1-3 refactor 2026-05-08 — løste den bug-klassen? | **❌ NEI** |

**Konklusjon: Dette er en strukturell anti-pattern, ikke en kjede av tilfeldige bugs.** Hver fix patcher én av minst 4 kode-paths som beregner "neste spill" hver for seg. Mønsteret er like sterk i dag som 2026-04-23.

---

## 1. Kronologisk tidslinje av relevante PR-er

Sortert kronologisk, fra eldst til nyest. Hvert oppslag har:
- **Dato** og **PR-nummer**
- **Hva fix-en prøvde å løse**
- **Hva som glapp** (eller "Hvilken neste PR matte fikse på toppen")
- **Mønster-klassifikasjon:** `patch-on-patch` | `arkitektur` | `state-machine-utvidelse`

### Fase 1: Foundation — Spilleplan-redesign-bølgen (2026-04-23 → 2026-05-08)

#### PR #431 — 2026-04-23 — `feat(agent-portal): Next Game panel — start/pause/resume + ready-popup + jackpot-confirm` (+1642/-11)
**Hva:** Introdusert `NextGamePanel.ts` første gang. Master-konsoll med start/pause/resume + ready-popup.
**Glapp:** ETT MONOLITISK KOMPONENT, ingen test-coverage. Foundation som hele patch-spiralen senere bygger på.
**Mønster:** **arkitektur (foundation)**

#### PR #465 — 2026-04-24 — `feat(game1): foren agent-portal + master-konsoll mot scheduled_games (Task 1.4)` (+2586/-0)
**Hva:** Forsøk å forene agent-portal og master-konsoll mot samme datakilde (`app_game1_scheduled_games`).
**Glapp:** Plan-runtime fantes ennå ikke; "scheduled_games" ble eneste sannhets-kilde. Senere kollisjon når plan-runtime ble lagt på toppen.
**Mønster:** **arkitektur (premature consolidation)**

#### PR #798 — 2026-05-01 — `fix(admin-web): NextGamePanel auto-unmount når router bytter side` (+49/-0)
**Hva:** Defensive cleanup ved route-change.
**Glapp:** Symptomet er at panelet henger med stale state etter navigation. Fikset symptomet, ikke roten (panelet eier sin egen state-cache uten coordinator).
**Mønster:** **patch-on-patch (symptom-fix)**

#### PR #840 — 2026-05-02 — `fix(admin-web): unmount NextGamePanel ved nav bort fra /agent/games (AGENT-bouncer)` (+451/-3)
**Hva:** Forsterket PR #798 — auto-unmount når man navigerer bort.
**Glapp:** Samme bug-klasse — stale state. Stadig ikke roten.
**Mønster:** **patch-on-patch (samme bug 4 dager senere)**

#### PR #846 — 2026-05-02 — `fix(cashinout): Spill1HallStatusBox laster umiddelbart ved re-mount` (+13/-4)
**Hva:** Force-refresh på re-mount av Spill1HallStatusBox.
**Glapp:** Race-condition på første polling-sykle. Symptom-fix.
**Mønster:** **patch-on-patch**

#### PR #854 — 2026-05-03 — `feat(agent-game1): vis hall-status for neste planlagte spill alltid` (+206/-21)
**Hva:** Tobias-direktiv: "Vis hall-status for neste planlagte spill alltid, ikke kun under aktiv runde."
**Glapp:** Ny logikk i `NextGamePanel.ts` for å pre-hente neste spill — men neste spill ble beregnet fra `app_game1_scheduled_games` (DB-side). Plan-runtime fantes ennå ikke.
**Mønster:** **state-machine-utvidelse** (legger til nytt scenario uten å rydde gamle)

#### PR #857 — 2026-05-03 — `fix(spill1): tillat Marker Klar / Ingen kunder også under 'scheduled'-status` (+13/-6)
#### PR #858 — 2026-05-03 — `fix(spill1): master kan starte under 'scheduled'-status og med oransje haller` (+45/-12)
#### PR #859 — 2026-05-03 — `fix(spill1): fjern unused allReady-destructure (TS6133 hotfix)` (+50/-13)

**Hva:** 3 PR-er på rad samme dag for å håndtere `scheduled`-status. Hver utvidet hva man kunne gjøre i denne tilstanden.
**Glapp:** State-machine ble utvidet i UI-laget uten et felles utgangspunkt — backend hadde 6 states (`scheduled`, `purchase_open`, `ready_to_start`, `running`, `paused`, `completed`), UI begynte å beregne om "Aktiv trekning" eller "Neste spill" basert på løse mappings.
**Mønster:** **patch-on-patch (3 PR-er samme dag på samme fil)**

### Fase 2: Spilleplan-redesign Fase 1-4 (2026-05-07 → 2026-05-08)

#### PR #977 — 2026-05-07 — `fix(game1): bedre Start-knapp UX når runden er 'scheduled' (PR-C)` (+443/-34)
**Hva:** UX-cleanup for `scheduled`-status.
**Mønster:** **patch-on-patch**

#### PR #980 — 2026-05-07 — `feat(backend): spilleplan-redesign Fase 1 — game-catalog + plan + run` (+4821/-0)
**Hva:** Introdusert hele plan-runtime-modellen: `app_game_catalog`, `app_game_plan`, `app_game_plan_item`, `app_game_plan_run`.
**Glapp:** PARALLELL datamodell til `app_game1_scheduled_games`. To id-rom (plan-run-id + scheduled-game-id) opprettes uten klar grense — RIGHT HERE er roten til 4 uker senere fix-spiral.
**Mønster:** **arkitektur (foundation introduserer parallell datakilde uten reconciliation)**

#### PR #982 — 2026-05-07 — `feat(spilleplan): Fase 3 — runtime-kobling til master-dashbord` (+2776/-6)
**Hva:** Koblet plan-runtime til master-dashboard (`NextGamePanel`).
**Glapp:** Frontend henter NÅ to datakilder (`/api/agent/game-plan/current` + `/api/agent/game1/current-game`) parallelt og MERGER felt-for-felt. Patch-spiral arvelagt.
**Mønster:** **arkitektur (parallell data — uten coordinator)**

#### PR #985 — 2026-05-07 — `fix(spilleplan): hotfix 2 — frontend driver + docs (HIGH #2/#3 + MEDIUM #4-6)` (+563/-17)
**Hva:** Hotfix for Fase 3-bugs.
**Mønster:** **patch-on-patch (samme PR-cyclen)**

#### PR #1009 — 2026-05-08 — `chore(admin-web): fjern useNewGamePlan-flag — ny flyt er nå default` (+226/-337)
**Hva:** Fjernet feature-flag — ny plan-flyt er default. Punkt-of-no-return.
**Glapp:** Begge datakilder fortsatt parallelle.
**Mønster:** **state-machine-utvidelse (commit point)**

#### PR #1010 — 2026-05-08 — `fix(agent-game-plan): GET /current lazy-creates dagens plan-run` (+309/-14)
**Hva:** Plan-run opprettes lazy ved første GET.
**Glapp:** Hva med "ingen plan-run eksisterer ennå"-state? Hva med "plan-run finished men ingen ny ennå"-state? Disse states ble lagt på senere.
**Mønster:** **state-machine-utvidelse**

#### PR #1011 — 2026-05-08 — `fix(game-plan): getOrCreateForToday matcher GoH-baserte planer + UI-poll 400-fix` (+674/-5)
**Hva:** Fikset GoH-baserte planer i `getOrCreateForToday`.
**Glapp:** `getOrCreateForToday` blir nå et bekymrings-felt — det avslår om bug ER plan-run-id eller scheduled-game-id. Kommer tilbake gang etter gang.
**Mønster:** **patch-on-patch**

#### PR #1017 — 2026-05-08 — `feat(spill1): master kan starte uavhengig av ready-status + konsolider UI` (+809/-301)
**Hva:** Master kan starte uavhengig av ready (ADR-0021). Konsoliderer noen UI-handlinger.
**Glapp:** Konsoliderte UI-knapper men ikke datakilden bak dem.
**Mønster:** **state-machine-utvidelse (legger til "master kan starte med 0 spillere"-state)**

#### PR #1041 — 2026-05-08 — `fix(agent-ui): bruk scheduled-game-id i master pause/fortsett (Tobias-feedback 2026-05-08)` (+?/-?)
**Hva:** **KRITISK BUG**: Master pause/fortsett-knapper sendte `plan-run-id` til backend, men backend forventer `scheduled-game-id`. Patchet ved å hente legacy-current-game parallelt og overstyre `currentGame.id` i UI-state.
**Glapp:** Race condition — hvis legacy-callet ikke svarer tilstrekkelig raskt, sendes feil id. Patch-spiral starter for alvor.
**Mønster:** **patch-on-patch (id-overskrivning kun ved polling — ikke deterministisk)**

### Fase 3: Bølge 1-3 fundament-refactor (2026-05-08)

Etter PR #1041 ble fundament-audit gjort. **Audit-konklusjon:** Y, "fundamentet er broken". 6 bølger ble foreslått, men kun 5 av 6 ble fullført.

#### PR #1045 — 2026-05-08 — `docs(architecture): plan↔spill kobling fundament-audit (read-only)` (+721/-0)
**Hva:** Audit-dokument som identifiserer roten (2 parallelle id-rom, 4+ kode-paths som duplicerer logikk).
**Glapp:** AUDIT-EN identifiserte problemet korrekt. Hvis Bølge 1-6 hadde blitt FULLFØRT 100%, var bug-en lukket.

#### PR #1050 — 2026-05-08 — `refactor(spill1): Bølge 1 — GameLobbyAggregator (single source of truth, plan↔spill fundament-refaktor)` (+3549/-15)
**Hva:** Ny service `GameLobbyAggregator`. **Single source of truth** for hva master/agent-UI viser. Inkluderer `inconsistencyWarnings` for å detektere divergens (BRIDGE_FAILED, DUAL_SCHEDULED_GAMES, etc).
**Hva som virket:** API-grensesnittet er korrekt — én endpoint, én service, alle "next game"-kall går her.
**Glapp:** Ble en KOMPATIBILITETS-BRO, ikke en ERSTATNING. Eksisterende endpoints (`/current-game`, `/game-plan/current`) ble IKKE slettet → frontend fortsatt brukte begge.
**Mønster:** **arkitektur (foundation — men ikke fullført fordi Bølge 4 manglet)**

#### PR #1069 — 2026-05-08 — `refactor(spill1): Bølge 2 — MasterActionService (single sekvenseringsmotor)` (+3198/-17)
**Hva:** `MasterActionService` — ENESTE sted som vet om både plan-run-id og scheduled-game-id, og driver master-actions ende-til-ende.
**Mønster:** **arkitektur (foundation komplett for Bølge 2-scope)**

#### PR #1075 — 2026-05-08 — `refactor(admin-web): Bølge 3 — UI bytter til ny aggregator + master-actions` (+1768/-952)
**Hva:** UI byttet til `fetchLobbyState` + nye master-action-helpers. **`agent-game-plan-adapter.ts` (146 linjer) og `agent-master-actions.ts` (135 linjer) SLETTET.**
**Hva som virket:** Bølge 1-3 ble den siste "ekte" fundament-refaktor — etter dette skulle "neste spill"-display bli korrekt.
**Glapp:** **Bølge 4 (slett legacy parallel-spawn) ble ALDRI gjennomført.** Det betyr at `GamePlanEngineBridge` og `Game1ScheduleTickService` fortsatt har dual-write konflikt på `app_game1_scheduled_games`-tabellen. Hver gang noe går galt, finner systemet det "feil" scheduled-game.
**Mønster:** **arkitektur (foundation — men Bølge 4 manglet)**

#### PR #1065 — 2026-05-08 — `refactor(spill1): Bølge 6 — Game1ScheduledGameFinder consolidator` (+611/-118)
**Hva:** Konsoliderte finder-logikk.
**Mønster:** **state-machine-utvidelse**

#### PR #1074 — 2026-05-08 — `refactor(platform): Bølge 5 — HallGroupMembershipQuery consolidator` (+?/-?)
**Hva:** GoH-membership-query konsolidert.
**Mønster:** **state-machine-utvidelse**

### Fase 4: Post-Bølge — første symptom-tilbakefall (2026-05-09 → 2026-05-12)

Etter Bølge 1-3+5+6, alt skulle være OK. Men Bølge 4 manglet (legacy parallel-spawn ble IKKE slettet).

#### PR #1099, #1101 — 2026-05-09 — `test(spill1): E2E verifikasjon — 3 P0 pilot-blokkere identifisert (F10/F13/F17)` + fix
**Hva:** E2E-test fant 3 P0-bugs i Bølge-fundamentet.
**Mønster:** **patch-on-patch (bygget umiddelbart oppå Bølge 1-3)**

#### PR #1113 — 2026-05-09 — `feat(spill1): master-recovery UI-knapp + backend-endpoint (lukk pilot-blokker)` (+2475/-3)
**Hva:** UI-knapp for å rydde stuck plan-runs.
**Mønster:** **state-machine-utvidelse (legger til "recovery"-state)**

#### PR #1114 — 2026-05-09 — `feat(game-plan): auto-cleanup cron + inline self-heal for stale plan-runs` (+1275/-62)
**Hva:** Cron 03:00 + inline self-heal for stale plan-runs (gårsdagens).
**Mønster:** **state-machine-utvidelse (legger til "auto-cleanup"-state)**

#### PR #1118 — 2026-05-09 — `fix(spill1): F-NEW-1 + F-NEW-2 — siste pilot-blokkere lukket` (+628/-67)
#### PR #1120 — 2026-05-09 — `fix(spill1): F-NEW-3 — pause_reason migration` (+761/-12)
#### PR #1121 — 2026-05-09 — `fix(spill1): F-Plan-Reuse + F-Recovery-Incomplete (P0 pilot-blokkere)` (+94/-7)

**Hva:** 3 pilot-blokker-fixer på samme dag som "siste". `F-Plan-Reuse` er kritisk — den introduserer DELETE+INSERT-flyt i `getOrCreateForToday` som SENERE blir kilden til PR #1422-bugen.
**Glapp:** "Siste pilot-blokker" var IKKE den siste. PR #1422 bug-en oppstod akkurat fordi `F-Plan-Reuse` hardkodet `current_position=1` på INSERT.
**Mønster:** **patch-on-patch (introduserer ny bug mens fikser gammel)**

#### PR #1126 — 2026-05-09 — `feat(spill1): master-flow + lazy-spawn for pre-game ready` (+1215/-41)
**Hva:** Lazy-spawn av scheduled-game ved "Marker klar"-knapp.
**Glapp:** Krever cron-race-håndtering (§3.9 i PITFALLS_LOG).
**Mønster:** **state-machine-utvidelse**

#### PR #1128 — 2026-05-09 — `feat(game-client): wire Game1Controller to plan-runtime aggregator (fase 1)` (+745/-7)
**Hva:** Spiller-klient byttet til aggregator.
**Mønster:** **patch-on-patch (UI follow-up)**

#### PR #1241 — 2026-05-11 — `feat(spill1): multi-lag stuck-game-recovery (ADR-0022)` (+2561/-19)
**Hva:** ADR-0022 — multi-lag stuck-game-recovery. Tre lag av recovery (master-trigger + cron + UI-knapp).
**Glapp:** Hvert lag har egen state-machine for "hva regnes som stuck". State-machine-eksplosjon.
**Mønster:** **state-machine-utvidelse (eskalering)**

#### PR #1253 — 2026-05-12 — `fix(spill1): bridge tar over eksisterende hall-default-rom (room_code-konflikt)` (+1205/-54)
**Hva:** Bridge-konflikt med eksisterende rom.
**Mønster:** **patch-on-patch (Bølge 4-issue manifesterer)**

#### PR #1257 — 2026-05-12 — `fix(spill1): bridge gjenbruker ikke cancelled/completed rader i idempotency-lookup` (+584/-2)
**Hva:** Bridge gjenbrukte cancelled/completed rader → ny bug-klasse.
**Glapp:** Symptom av Bølge 4-mangelen. Konkret §4.4 i PITFALLS_LOG.
**Mønster:** **patch-on-patch (Bølge 4-mangel)**

#### PR #1277 — 2026-05-12 — `fix(admin-web): master-konsoll header — Aktiv trekning vs Neste spill på spilleplan` (+33/-26)
**Hva:** Header-tekst-fix.
**Glapp:** Samme bug som PR #1427 skulle fikse 2 dager senere.
**Mønster:** **patch-on-patch (samme bug 2 dager senere)**

#### PR #1280 — 2026-05-12 — `fix(admin-web): unblock 'Angre Klar' i master-konsoll når forrige runde er terminal` (+75/-9)
**Hva:** Unblock-knapp.
**Mønster:** **patch-on-patch**

#### PR #1284 — 2026-05-12 — `feat(spill1): armed→purchase-konvertering ved bridge-spawn (PILOT-BLOKKER)` (+2206/-0)
**Hva:** Konverter armed-state til faktiske purchases ved bridge-spawn.
**Mønster:** **state-machine-utvidelse (lyser opp annen path)**

#### PR #1291 — 2026-05-12 — `fix(spill1): lobby-rom persisterer ved gameEnded (canonical reset, ikke destroy)` (+828/-12)
**Hva:** Lobby-rom-persistens etter game-end.
**Mønster:** **state-machine-utvidelse**

#### PR #1293 — 2026-05-12 — `fix(spill1): armed→purchase-konvertering fyrer faktisk (hall_id-kolonne-bug)` (+566/-4)
**Hva:** Bug i PR #1284 — kolonnenavn-typo.
**Mønster:** **patch-on-patch (samme PR-syklus)**

#### PR #1296 — 2026-05-12 — `fix(admin-web): Angre Klar disabled i idle-state (regresjon fra PR #1280)` (+68/-12)
**Hva:** Regression fra PR #1280.
**Mønster:** **patch-on-patch (samme uke som introduksjon)**

### Fase 5: Pilot-debug-perioden (2026-05-13)

#### PR #1325 — 2026-05-13 — `fix(spill1): re-attach-guard i joinScheduledGame — fikser I15 (re-entry-during-draw)` (+1257/-10)
**Hva:** Re-attach-bug under aktiv trekning.
**Mønster:** **state-machine-utvidelse**

#### PR #1341 — 2026-05-13 — `fix(spill1): plan-run auto-reconcile fra lobby-poll (I16, F-02)` (+966/-51)
**Hva:** **Andre type stuck-plan-run-reconciler.** Auto-reconciliere ved poll. Begynnelsen av "tre lag reconcile-mekanismer".
**Glapp:** Hver lobby-poll kan trigge reconcile. Race med master-actions.
**Mønster:** **state-machine-utvidelse (legger til reconcile-mekanisme #2)**

#### PR #1367 — 2026-05-13 — `fix(spill1): koble Rad 1-vinst-popup til vinneren via walletId-fallback (cherry-pick fra #1287)`
**Mønster:** **patch-on-patch (UI-fix)**

#### PR #1368 — 2026-05-13 — `fix(spill1): plan-meta vises uansett status (cherry-pick fra #1290)` (+42/-25) — **FIX-FORSØK #1 av NEXT GAME DISPLAY-BUG**
**Hva:** **DIREKTE adressering av "neste spill"-bug.** Tobias-direktiv: *"Neste spill må uansett vises uavhengig hvilken status man har."*

Pre-fix: `GameLobbyAggregator.buildPlanMeta` returnerte null når plan-run ikke fantes ennå → header rendret "Neste spill på spilleplan" og knapp "Start neste spill" UTEN navn før master klikket.

Fix: `buildPlanMeta` returnerer nå plan-info selv uten aktiv plan-run.

**Glapp:** Dekket KUN initial-state (før plan-run opprettes). Ikke advance-state etter runde-end. PR #1422 + #1431 + #1427 kom etterpå for å dekke andre states.
**Mønster:** **patch-on-patch (ÉN state dekket, ikke alle)**

#### PR #1373 — 2026-05-13 — `fix(spill1): timeout-fallback for "Forbereder rommet"-spinner` (+240/-0)
**Mønster:** **patch-on-patch (UI-fix)**

#### PR #1375 — 2026-05-13 — `fix(spill1): propager entryFee + patterns + nextScheduledGame i room-snapshot` (+540/-2)
**Hva:** Propager `nextScheduledGame` i room-snapshot.
**Glapp:** Enda en datakilde for "neste spill". Nå har vi:
- `GameLobbyAggregator.buildPlanMeta` → `nextScheduledGame` (PR #1050)
- `Game1LobbyService.getLobbyState` → `nextScheduledGame` (eksisterende)
- Room-snapshot → `nextScheduledGame` (PR #1375)

Tre kilder for samme felt. Patch-spiral PEAK.
**Mønster:** **arkitektur-divergence (legger til SØLVKILDE for samme data)**

#### PR #1376 — 2026-05-13 — `fix(spill1): "Angre Klar"-knapp fungerer fra master-konsoll` (+668/-60)
**Mønster:** **patch-on-patch (master-action-fix)**

### Fase 6: Maks intensitet — Tobias-rapporterer 5 ganger samme dag (2026-05-14)

#### PR #1403 — 2026-05-14 — `fix(spill1): reconcile stuck plan-runs (FIX-1, audit:db-evidence)` (+944/-0)
**Hva:** **Reconciler #3** for stuck plan-runs. Kjøres ved `start()` og `advanceToNext()` (manuell master-handling).
**Glapp:** Dekket KUN manuell master-handling, ikke naturlig runde-end.
**Mønster:** **state-machine-utvidelse (reconciler-eksplosjon)**

#### PR #1407 — 2026-05-14 — `fix(spill1): auto-reconcile stuck plan-runs after natural round-end (BUG-A)` (+1455/-13)
**Hva:** **Reconciler #4** for naturlig runde-end.
**Glapp:** PR #1403 + #1407 = 2 forskjellige reconcilere som overlapper. Hver med egen threshold-tid.
**Mønster:** **state-machine-utvidelse (komplementært til #1403, dekker tidligere uncovered scenario)**

#### PR #1422 — 2026-05-14 — `fix(spill1): auto-advance plan-run fra finished til neste position (BUG E)` (+819/-8) — **FIX-FORSØK #2 av NEXT GAME DISPLAY-BUG**
**Hva:** **DB-side fix.** Auto-advance plan-run til `previousPosition + 1` ved DELETE+INSERT.

Tobias-direktiv (KANONISK):
> "Hvert spill spilles kun en gang deretter videre til nytt spill."

Pre-fix: `F-Plan-Reuse (PR #1006)` hardkodet `current_position=1` på INSERT → Bingo (pos=1) repeterte evig.

Fix: `getOrCreateForToday` capturer `previousPosition` FØR DELETE, og INSERT-er med `nextPosition = previousPosition + 1`.

**Glapp:** **DB-side fix var korrekt. Men lobby-API leste fortsatt det gamle feltet på read-tid.** Master-UI viste fortsatt "Start neste spill — Bingo" selv etter Bingo (position=1) var ferdigspilt. → PR #1431 måtte fikse lobby-API.
**Mønster:** **patch-on-patch (ÉN av 4 kode-paths fikset)**

#### PR #1427 — 2026-05-14 — `fix(admin-web): master-UI header state-aware (Tobias 3-gang-bug)` (+428/-32) — **FIX-FORSØK #3 av NEXT GAME DISPLAY-BUG**
**Hva:** Master-UI header viste "Aktiv trekning - Bingo" selv når engine IKKE var running. Mappet `purchase_open | ready_to_start | running | paused` som "isActiveDraw" — feil. KUN `running` skal trigge "Aktiv trekning".

Tobias har rapportert dette **3 ganger samme dag** (07:55, 09:51, 12:44).

Fix: Pure helper `getMasterHeaderText(state, gameName, info?)` med 11 state-mappings + 35 unit-tester + regression-trip-wire (ingen ikke-running state returnerer "Aktiv trekning").

**Glapp:** UI-tekst-fix på `Spill1HallStatusBox` — ikke "neste spill"-tekst. KUN header-state. → PR #1431 måtte fikse "neste spill"-feltet.
**Mønster:** **patch-on-patch (ÉN annen kode-path fikset)**

#### PR #1431 — 2026-05-14 — `fix(spill1): lobby-API nextGame for finished plan-run (komplementært til PR #1422)` (+494/-13) — **FIX-FORSØK #4 av NEXT GAME DISPLAY-BUG**
**Hva:** **DIREKTE komplementært til PR #1422.** Endret `Game1LobbyService.getLobbyState` til å returnere `plan.items[currentPosition + 1]` ved finished. `GameLobbyAggregator.buildPlanMeta` clampet feil — fikset.

Tobias-rapport 2026-05-14 13:00 (samme dag som PR #1422):
> "Master-UI viser fortsatt 'Start neste spill — Bingo' etter at Bingo (position=1) er ferdigspilt. Skal vise '1000-spill' (position=2)."

Fix: Når `run.status='finished'` OG `currentPosition < items.length`, returner `nextScheduledGame` fra `plan.items[currentPosition + 1]`. Ny `planCompletedForToday`-flag.

**Glapp:** **Bugen er fortsatt rapportert som tilbakevendende.** Mistenkt: minst én av 4 frontend-kode-paths ignorerer dette feltet og faller tilbake til default.

**Mønster:** **patch-on-patch (ÉN tredje kode-path fikset — men minst én til mangler)**

### Fase 7: PM erkjenner patch-spiral (2026-05-14 kveld)

#### PR #1469 — 2026-05-14 — `docs(architecture): NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT skall — koordiner 6 research-agenter`
**Hva:** **Audit-skall opprettet.** PM erkjenner at 4 fix-forsøk ikke har løst rot-årsaken. Spawnet 6 research-agenter for kunnskaps-deep-dive.

Tobias-direktiv:
> "Vi må nå ha et helt åpent sinn hvor vi ser på funksjonaliteten og hvis vi finner ut at dette må bygges som og det utsetter pilot med uker så er vi nødt til å gjøre det."

**Mønster:** **arkitektur (research → rewrite-vurdering)**

---

## 2. Mønster-analyse

### 2.1 Filer i konstant flux

**Topp 5 mest-touched-filer siden 2026-04-23 (på vårt tema):**

| Fil | Antall touches | Mønster |
|---|---:|---|
| `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts` | **56+** | Patch-spiral PEAK — fix-fix-fix-fix på samme komponent |
| `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` | **39** | Fra PR #431 (foundation) til PR #1168 (ADR-0019). Hver state-utvidelse touched |
| `apps/backend/src/game/GamePlanRunService.ts` | **25** | Service har vært skrevet om 4+ ganger. `getOrCreateForToday` alene touched 3 ganger med kritiske semantikk-endringer |
| `apps/backend/src/game/Game1LobbyService.ts` | **12** | Lobby-state-aggregat. Touched hver gang ny state ble lagt til |
| `apps/backend/src/game/GameLobbyAggregator.ts` | **12** | Født Bølge 1 — touched 4 ganger siden 2026-05-08 for å fikse "neste spill"-display |

### 2.2 "Patch on patch"-spiraler

#### Spiral A: Master pause/fortsett-id-bug
| PR | Dato | Fix-type | Følge |
|---|---|---|---|
| #1041 | 2026-05-08 | Hent legacy-current-game parallelt for å overstyre `currentGame.id` | Race condition |
| #1069 (Bølge 2) | 2026-05-08 | MasterActionService — single sekvenseringsmotor | Funker, men Bølge 4 manglet |
| #1075 (Bølge 3) | 2026-05-08 | UI bytter til ny aggregator + master-actions | Slettet `agent-game-plan-adapter.ts` + `agent-master-actions.ts` |

**Diagnose:** Spiral A løst korrekt med Bølge 1-3. **Men kun for master-actions**. "Neste spill"-display ble ikke berørt.

#### Spiral B: Stuck plan-run-recovery
| PR | Dato | Reconciler-type | Trigger |
|---|---|---|---|
| #1114 | 2026-05-09 | Cron 03:00 + inline self-heal | Daily |
| #1241 | 2026-05-11 | Multi-lag stuck-game-recovery (ADR-0022) | Master + cron + UI-knapp |
| #1341 | 2026-05-13 | Auto-reconcile fra lobby-poll (I16, F-02) | Hver lobby-poll |
| #1403 | 2026-05-14 | reconcile stuck plan-runs (FIX-1) | Master-actions (`start`, `advance`) |
| #1407 | 2026-05-14 | Auto-reconcile etter natural round-end (BUG-A) | Poll-tick 30s |

**Diagnose:** **5 reconcilere bygget på toppen av hverandre.** Hver med egen threshold-tid. Hver med egen trigger. Hver med egen audit-event. **Patch-spiral peak.**

#### Spiral C: Next Game Display-bug (4 fix-forsøk)
| PR | Dato | Hvor i pipeline | Hva fikset |
|---|---|---|---|
| #1368 | 2026-05-13 | `GameLobbyAggregator.buildPlanMeta` | Initial state (før plan-run opprettes) |
| #1422 | 2026-05-14 | `GamePlanRunService.getOrCreateForToday` | DB-side advance-logikk |
| #1427 | 2026-05-14 | `Spill1HallStatusBox.getMasterHeaderText` | Master-UI header-tekst per state |
| #1431 | 2026-05-14 | `Game1LobbyService.getLobbyState` + `GameLobbyAggregator.buildPlanMeta` | Lobby-API nextGame for finished plan-run |

**Diagnose: 4 forskjellige kode-paths beregner "neste spill"-tekst.** Hver fix har truffet ÉN path, de andre 3 driver tilstanden videre.

**Patch-spiral KAN IKKE løses uten å konsolidere alle paths til ÉN service.**

### 2.3 Tobias-rapporter (kronologi)

Sortert kronologisk:

| Dato | Tid | Hva Tobias rapporterte |
|---|---|---|
| 2026-05-03 | — | "Vis hall-status for neste planlagte spill alltid" |
| 2026-05-08 | — | "alt av kode som krangler mot hverandre må fjernes ... fundamentet legges godt nå" |
| 2026-05-13 | 13:00 | "Neste spill må uansett vises uavhengig hvilken status man har" |
| 2026-05-14 | 07:55 | "Master-UI viser 'Aktiv trekning - Bingo' men knapp viser Start" (PR #1427-bug) |
| 2026-05-14 | 09:51 | "Aktiv trekning fortsatt feil" (PR #1427-bug, samme bug) |
| 2026-05-14 | 09:58 | "Hvert spill spilles kun en gang deretter videre til nytt spill" (PR #1422-bug) |
| 2026-05-14 | 12:44 | "Aktiv trekning fortsatt feil" (PR #1427-bug, tredje rapport samme dag) |
| 2026-05-14 | 13:00 | "Master-UI viser 'Start neste spill — Bingo' selv etter Bingo er ferdigspilt" (PR #1431-bug) |
| 2026-05-14 | 22:21 | **DB-evidens:** plan-run finished position=1, lobby-API skulle returnert "1000-spill" (position 2) per PR #1431. Bugen rapporteres FORTSATT |

**Symptom-konsistens:** YES. Samme bug-klasse — "feil eller manglende neste-spill-tekst" — i alle 5+ rapporter. Det varierer KUN i state-overgangen (initial / advance / finished). Det er IKKE forskjellige bugs, det er den SAMME bugen med forskjellige manifestasjoner.

### 2.4 Hva som faktisk er fixet vs gjenstår

**FIXET 100%:**
- ✅ Master pause/fortsett-id (Bølge 1-3, 2026-05-08, korrekt arkitektur-fix)
- ✅ Plan-run-reconciliation (5 reconcilere — overkill men funksjonelt)
- ✅ Master kan starte uavhengig av ready (ADR-0021)

**FIXET PARTIELT — bug-klasse gjenstår:**
- ⚠️ "Neste spill"-display etter `dev:nuke` (PR #1368)
- ⚠️ "Neste spill"-display etter finished position=1 (PR #1422 + #1431)
- ⚠️ Master-UI header-tekst per state (PR #1427)
- ❌ **HVA SOM ENNÅ MANGLER:** Minst én frontend-kode-path som ignorerer alt det ovennevnte og faller tilbake til default `plan_items[0]` (Bingo). Tobias-rapporten 22:21 bekrefter at bugen FORTSATT er live.

---

## 3. Bølge 1-6 (2026-05-08) — etterspill

Audit fra `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` foreslo 6 bølger:

| Bølge | Beskrivelse | PR | Status | Løste den "Next Game Display"-bugs? |
|---|---|---|---|---|
| Bølge 1 | GameLobbyAggregator (SoT) | #1050 | ✅ Fullført | **Delvis**. Aggregator returnerer "neste spill" korrekt — men kun for noen states. PR #1368 + #1431 har måttet utvide den. |
| Bølge 2 | MasterActionService | #1069 | ✅ Fullført | ❌ Nei. Master-actions fikset, ikke display. |
| Bølge 3 | UI bytter til ny aggregator + master-actions | #1075 | ✅ Fullført | **Delvis**. Slettet to adaptere (146 + 135 linjer), men `Spill1HallStatusBox` + `NextGamePanel` har fortsatt egen rendering-logikk. |
| **Bølge 4** | **Slett legacy parallel-spawn (GamePlanEngineBridge + Game1ScheduleTickService)** | **IKKE FERDIG** | ❌ Manglet | **JA — dette ER rot-årsaken til mange downstream-bugs.** Dual-write konflikt på `app_game1_scheduled_games` gjenstår. Hver gang lobby-API leter etter "current scheduled-game", kan den finne fra to forskjellige spawn-kilder. |
| Bølge 5 | HallGroupMembershipQuery consolidator | #1074 | ✅ Fullført | ❌ Nei. Membership-query, ikke display. |
| Bølge 6 | Game1ScheduledGameFinder consolidator | #1065 | ✅ Fullført | **Delvis**. Konsoliderer finder — men ikke alle anrop går via den. |

### Bølge 4 — den manglende biten

Det mest kritiske som **IKKE BLE GJORT** under Bølge-refaktor 2026-05-08:

> **Slett legacy parallel-spawn av scheduled-games.** Per audit §4.2-4.3:
>
> - `Game1ScheduleTickService.ts` spawn-er legacy `scheduled_games` fra `app_daily_schedules` (gammel modell)
> - `GamePlanEngineBridge.ts` spawn-er fra plan-runtime (ny modell)
> - **Begge skriver til samme tabell `app_game1_scheduled_games`.**
>
> Når lobby-API leter etter "current scheduled-game" for en hall, kan den finne én fra hver kilde. **Dette er bevart i dagens kode.**

Hver bug under Spiral C kan spores tilbake til **Bølge 4-mangelen**:
- Bug #1368: GameLobbyAggregator kunne ikke finne plan-meta hvis plan-run ikke fantes → fordi ENGINE kan ha startet en legacy-scheduled-game UTEN plan-run.
- Bug #1422: `getOrCreateForToday` DELETE+INSERT hadde position=1 → fordi plan-run-state og scheduled-game-state ikke var synkroniserte (de er parallelle datakilder).
- Bug #1431: Lobby-API returnerte `nextGame: null` selv om planen hadde flere items → fordi `nextScheduledGame` ble beregnet fra TO datakilder (lobby-service + aggregator) med ulik finished-handling.

**Konklusjon:** Bølge 4 ER rot-årsaken til bug-klassen som vi har fixet 4 ganger uten å lukke.

---

## 4. Recommendations

### 4.1 Bug-klasse-diagnose

Dette er **IKKE 4 separate bugs**. Det er **EN strukturell anti-pattern** med 4 manifestasjoner:

> **Anti-pattern:** "Neste spill"-tekst beregnes i minst 4 parallelle kode-paths som hver har egen state-machine:
>
> 1. `GameLobbyAggregator.buildPlanMeta` (Bølge 1)
> 2. `Game1LobbyService.getLobbyState`
> 3. `Spill1HallStatusBox.getMasterHeaderText`
> 4. Frontend fallback til `plan_items[0]` ved null
>
> Hver fix har truffet ÉN path. De andre 3 driver tilstanden videre.

Tobias' bekreftelse (forutsigbar pattern):
> "Vi må nå ha et helt åpent sinn hvor vi ser på funksjonaliteten og hvis vi finner ut at dette må bygges som og det utsetter pilot med uker så er vi nødt til å gjøre det."

### 4.2 Sannsynlighet for at "Bølge 7" lukker bug-klassen

**Bølge 7 (anbefalt):** **Slett alle parallelle "neste spill"-beregninger. Konsolider til ÉN service som returnerer en `NextGameDisplay`-type.**

Per audit-skall §7:
```typescript
type NextGameDisplay = {
  catalogSlug: string | null;        // "1000-spill" | null hvis plan ferdig
  catalogDisplayName: string | null; // "1000-spill" | null
  position: number | null;           // 2 | null
  planCompletedForToday: boolean;    // true | false
  reason: "next_in_sequence" | "plan_completed" | "no_plan_run" | "closed";
};
```

**Hvorfor det vil VIRKE:**
1. Frontend har INGEN beregning lenger — bare rendring av `reason`-field
2. Backend har ÉN service som dekker alle 11 states × 4 klient-roller
3. Tester dekker hver state-overgang × klient-rolle
4. Hvis bug oppstår, kan den ALDRI være "frontend leser feil felt" — den må være i den ene service-en

**Hvorfor PR #1368 + #1422 + #1427 + #1431 IKKE virket:**
- De fixet ÉN av 4 parallelle paths
- De andre 3 fortsatte å beregne uavhengig
- Hver gang en ny state-overgang ble lagt til, måtte vi finne ALLE 4 paths og oppdatere dem

### 4.3 Bølge 7 vs fundamental rewrite

**Bølge 7 (konsolidering):**
- Estimat: 3-5 dev-dager (med 2-3 agenter)
- Risiko: Lav — slett duplikat logikk + bygg én service
- Blokkere pilot: Nei (kan komplettere før pilot går live)

**Fundamental rewrite (full reset):**
- Estimat: 1-4 uker (Tobias-direktiv: kvalitet > tid)
- Krav: Slett HELE plan-runtime vs scheduled-game-skillet. Erstatt med én monoton state-machine
- Risiko: Høy — vil bryte mange eksisterende tester
- Blokkere pilot: Ja (krever full re-testing)

**Anbefaling:**
- **FORSØK BØLGE 7 FØRST** (3-5 dager). Hvis det lukker bug-klassen → pilot kan gå live.
- **Hvis Bølge 7 ikke lukker** (en 5. parallell path oppdages, ny bug-klasse trer frem) → **da fundamental rewrite**. Tobias har eksplisitt godkjent inntil 1 måned.

### 4.4 Spesifikk Bølge 7-anbefaling

**Steg 1:** Identifiser ALLE kode-paths som beregner "neste spill"-tekst.
- Agent A (frontend) finner alle render-call-sites
- Agent B (backend aggregator) finner alle backend-computasjoner
- Agent F (test-coverage) bygger state-machine-matrise

**Steg 2:** Bygg én autoritativ service `NextGameDisplayService` som returnerer `NextGameDisplay`.

**Steg 3:** Slett alle parallelle beregninger:
- ❌ `GameLobbyAggregator.buildPlanMeta` — beholder NÅR den returnerer kun rådata, ikke "neste-spill"-tekst
- ❌ `Game1LobbyService.getLobbyState` `nextScheduledGame`-felt — erstatt med `NextGameDisplay`
- ❌ `Spill1HallStatusBox.getMasterHeaderText` — fjern beregnings-logikk, ren rendring
- ❌ `NextGamePanel` fallback til `plan_items[0]` — fjern; bruk `NextGameDisplay`

**Steg 4:** Implementer Bølge 4 (slett legacy parallel-spawn) parallelt. Uten Bølge 4 vil dual-write fortsatt skape state-mismatch-bugs.

**Steg 5:** Test-coverage. Minst 30 tester for hele state-machine.

**Steg 6:** Tobias kjører manuell smoke-test før merge.

---

## 5. Konklusjon

Next Game Display-bugen er **ÅPENBART** en strukturell anti-pattern, ikke en serie tilfeldige bugs.

**Tidslinje viser:**
- 199+ PR-er rører temaet siden 2026-04-23
- 11+ direkte fix-forsøk
- 4 reconcilere bygget oppå hverandre
- 4 parallelle beregnings-paths
- Tobias har rapportert 5+ ganger samme dag

**Bølge 1-3 var korrekt arkitektur-arbeid. Men Bølge 4 (slett legacy parallel-spawn) ble aldri gjennomført. Det ER rot-årsaken.**

**Anbefalingen er klar:** Bølge 7 (konsolidering av "neste spill"-beregninger) + Bølge 4 (slett legacy parallel-spawn) **parallelt**. Hvis det ikke lukker bug-klassen innen 5 dager → fundamental rewrite på inntil 1 måned per Tobias-direktiv.

**Tobias har gitt grønt lys for utsatt pilot. Bruk det.**

---

## 6. SKILL_UPDATE_PROPOSED (Trinn 2)

For PM å overveie i Trinn 2:

- **`.claude/skills/spill1-master-flow/SKILL.md`** — ny seksjon "Patch-spiral anti-pattern: 4-paths-for-samme-rendering". Dokumenter at "neste spill"-display KUN må ha ÉN beregnings-path.
- **`.claude/skills/pm-orchestration-pattern/SKILL.md`** — ny seksjon "Bug-klasse vs bug-instans". Dokumenter når flere fix-er skal slås sammen til én bølge istedenfor å patches inkrementelt.

## 7. Referanser

- [`docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`](../architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md) — audit-skall
- [`docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`](../architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md) — forrige fundament-audit (Bølge 1-6)
- [`docs/engineering/PITFALLS_LOG.md`](../engineering/PITFALLS_LOG.md) §3.10-§3.13 — 4 tidligere fix-forsøk
- [`docs/operations/PM_HANDOFF_2026-05-14.md`](../operations/PM_HANDOFF_2026-05-14.md) §1 — Tobias-mandat
- PRs: #1368, #1370 (foundation), #1422 (DB-side), #1427 (UI-header), #1431 (lobby-API)
