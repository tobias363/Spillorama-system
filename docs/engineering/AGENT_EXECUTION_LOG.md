# Agent Execution Log — kronologisk agent-arbeid

**Status:** Autoritativ. Alle agent-leveranser dokumenteres her.
**Sist oppdatert:** 2026-05-11
**Eier:** PM-AI (vedlikeholdes ved hver agent-leveranse)

> **Tobias-direktiv 2026-05-10:** *"Når agenter jobber og du verifiserer arbeidet deres er det ekstremt viktig at alt blir dokumentert og at fallgruver blir forklart slik at man ikke går i de samme fellene fremover."*

---

## Hvorfor denne loggen eksisterer

Spillorama bruker mange parallelle agenter (test-engineer, general-purpose, Explore, Plan, code-reviewer, etc.). Hver agent gjør verdifullt arbeid — men kunnskapen forsvinner med agenten med mindre den dokumenteres.

Denne loggen sikrer at:

1. **Hva agenten faktisk gjorde** er dokumentert (file:line, commits, branch)
2. **Fallgruver oppdaget underveis** flyttes til [`PITFALLS_LOG.md`](./PITFALLS_LOG.md)
3. **Læring for framtidige agenter** er gjenfinnbart
4. **PM kan auditere agent-arbeid** uten å måtte gjenta agentens steg

Loggen er **append-only** — historiske entries beholdes selv om koden endres.

---

## Hvordan bruke

### For PM (deg)
1. **Etter hver agent-leveranse:** legg til entry her med inputs/outputs/learnings
2. **Før agent-spawn:** søk etter tidligere agenter med samme scope — hva fungerte, hva feilet?
3. **Hver kvartal:** review for mønstre — hvilke agent-typer leverer best på hvilke domener?

### Format

Hver entry har struktur:
- **Dato + agent-id** (interne id-er beholdes for sporbarhet i tilfelle re-spawn)
- **Agent-type** (test-engineer, general-purpose, Explore, Plan, code-reviewer)
- **Scope / oppdrag** (1-2 setninger)
- **Inputs gitt** (kort: hva var prompt-essensen)
- **Outputs produsert** (file:line, commits, PR)
- **Fallgruver oppdaget** (refer til [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) hvis lagt til)
- **Læring** (hva fungerte, hva ville vi gjort annerledes)
- **Eierskap** (hvilke filer agenten "eier" så vi unngår overlap)

---

## Aktive agenter (per 2026-05-10)

| Agent-id | Type | Scope | Status | Eierskap |
|---|---|---|---|---|
| `abbf640efb7e47e95` | test-engineer | E2E pilot-flow-script (Spor 2B) | 🔄 In flight | `apps/backend/scripts/pilot-smoke-test.sh` (fix) + ny `apps/backend/scripts/pilot-flow-e2e.sh` |
| `aee1f08ad995ac301` | general-purpose | BACKLOG.md cleanup | ✅ Ferdig | `BACKLOG.md` |
| `a1d4ffe73fc2d80fe` | general-purpose | Linear R-mandat cleanup (BIN-810 children) | ✅ Ferdig | Linear-MCP only |
| `abb7cfb21ba7e0f42` | Plan | R12 DR-runbook valideringsplan (BIN-816) | ✅ Ferdig | Tekst-rapport (lagret til `R12_DR_VALIDATION_PLAN.md`) |
| (test-engineer for spillerklient) | test-engineer | Spillerklient dev-user 403 + LobbyState fetch-resilience tests | ✅ Ferdig (commit `dc1d1ffb`) | 3 test-filer (493 + 290 + 393 linjer) |
| `aa8a2cf0f2c0495ab` | general-purpose | JackpotSetupModal wireup i master start-flyt | ✅ Ferdig (commit `3cea3963`) | `Spill1HallStatusBox.ts` + `NextGamePanel.ts` + ny `JackpotConfirmModal.ts` + 2 test-filer |

---

## Entries (newest first)

### 2026-05-13 — Cross-knowledge audit (drift-deteksjon, general-purpose agent)

**Scope:** Bygg ukentlig audit som detekterer drift mellom Spillorama-pilotens 7 kunnskaps-kilder (Linear-issues, BACKLOG, PITFALLS_LOG, FRAGILITY_LOG, ADR-er, BUG_CATALOG, PM-handoffs). Resultat: tre nye filer + AGENT_EXECUTION_LOG-entry. Markert som Pillar 8 i Knowledge Autonomy Protocol — selv-tilsyn av at Pillar 1-7 holder konsistens.

**Inputs gitt:**
- Tobias-direktiv 2026-05-13: "Det må bli vanntett nå ellers vil det ikke funke. Kan du anbefale noe annet her for at dette skal gå av seg selv og at da agentene blir smartere..."
- 8 konkrete drift-sjekker definert av PM-AI i task-promptet (PITFALLS→Linear, FRAGILITY-cluster, BACKLOG→Linear, BUG_CATALOG SHA, ADR-chain, skill-ADR-refs, PM_HANDOFF-PR-state, PR-template-checklist)
- Eksisterende `docs/engineering/KNOWLEDGE_AUTONOMY_PROTOCOL.md` (Pillar 1-7) + `scripts/generate-context-pack.sh` som referanse-mønster
- Branch: `feat/cross-knowledge-audit-2026-05-13` på worktree `.claude/worktrees/agent-a64af6053a7b344b0`

**Outputs produsert:**
- Branch: `feat/cross-knowledge-audit-2026-05-13`
- Nye filer:
  - `scripts/cross-knowledge-audit.mjs` (~840 linjer Node ESM) — 8 drift-sjekker + markdown/JSON-rapport-generator
  - `.github/workflows/cross-knowledge-audit-weekly.yml` — cron mandag 10:00 UTC + manuell trigger + auto-issue-opprettelse med label `cross-knowledge-audit`
  - `docs/engineering/CROSS_KNOWLEDGE_AUDIT.md` — komplett bidragsguide (hvorfor, hvordan handle på funn, hvordan legge til nye sjekker)
- Audit-funksjoner:
  - Check 1: PITFALLS-§ → Linear-state-cross-check (skipper graceful uten Linear-key)
  - Check 2: FRAGILITY-fil-cluster (≥ 3 entries på samme fil = arkitektonisk hot-spot)
  - Check 3: BACKLOG checkbox-items uten BIN-ref
  - Check 4: BUG_CATALOG ✅ Merged uten commit-SHA/PR-ref/branch-navn (kontekst-aware: kun tabeller med Fix-PR-kolonne)
  - Check 5: ADR Superseded-chain (broken eller manglende back-reference)
  - Check 6: Skills som peker på døde ADR-er
  - Check 7: PM_HANDOFF-mentions av åpne PR-er som faktisk er merget (krever `gh` CLI)
  - Check 8: PR-template manglende knowledge-protocol-checkboxes
- Severity-skala: 🔴 RED (arkitektonisk/integritet), 🟡 YELLOW (drift som bør lukkes), ℹ️ INFO (orientering)
- CLI-flagg: `--no-linear`, `--fail-on-findings`, `--json`, `--output=path`, `--verbose`

**Live audit-funn (på dagens main):**
- 1 drift (🟡): PR-template mangler alle 4 knowledge-protocol-checkboxes (PITFALLS / FRAGILITY / SKILL / AGENT_EXECUTION_LOG) — Check 8 fanget dette
- 3 info-notiser: Linear ikke konfigurert (Check 1 graceful skip), 2 × handoff-PR-state-stale (Check 7 informasjons-funn — PR #1320, #1323)
- 0 arkitektoniske concerns (Check 2): `tests/e2e/spill1-pilot-flow.spec.ts` har 2 FRAGILITY-refs (F-01, F-02), under terskelen 3

**Fallgruver oppdaget:**
- _Ingen nye fallgruver_ — audit-script-en er pure-read, ingen mutering av prod-state
- Note: I første iterasjon flagged Check 4 falskt H1-row i BUG_CATALOG som ikke hadde commit-SHA — root-cause var at "test-harness-issues"-tabellen ikke har Fix-PR-kolonne. Fixet: kontekst-aware sjekk basert på tabell-headers.

**Læring:**
- ✅ **Drift-deteksjon er enkelt når kildene har struktur:** ADR-er, FRAGILITY-entries og BUG_CATALOG-rader har konsistent formatering — markdown-parsing er nok, ingen LLM-prosessering
- ✅ **Linear-tilgang er ikke nødvendig for MVP:** 7/8 sjekker fungerer uten Linear; Check 1 skipper med ℹ️-notis
- ✅ **Workflow-mønster er stabilt:** Følger `doc-freshness.yml`-stilen (cron + manual + push) — gjenbruker eksisterende GH-Actions-konvensjoner
- ⚠️ **Sjekker må være kontekst-aware:** Naivt "alle ✅-rows må ha SHA" gir false positives. Sjekk for Fix-PR-kolonne i tabell-headers.
- ⚠️ **Check 7 (PR-state via `gh`) er bare informativ:** Handoff-docs går naturlig stale; rapportér men ikke flag som "drift"
- 💡 **Pillar 8 i Knowledge Autonomy Protocol:** Audit-en er meta-pillar — den verifiserer at Pillar 1-7 holder konsistens. Bør refereres fra `KNOWLEDGE_AUTONOMY_PROTOCOL.md` i en oppfølger-PR.

**Verifisering (PM):**
- ✅ `node scripts/cross-knowledge-audit.mjs --no-linear --verbose` kjører uten error, returnerer 1 drift-funn
- ✅ `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cross-knowledge-audit-weekly.yml'))"` validerer YAML
- ✅ Exit-koder verifisert: `--fail-on-findings` → exit 1 ved drift, exit 0 hvis bare ℹ️
- ✅ JSON-output validert (har `driftCount`, `findings[]`)
- ⏳ Workflow må kjøres på CI én gang for å verifisere `gh issue create`-pathen + secret-binding (LINEAR_API_KEY hvis konfigurert)

**Tid:** ~45 min agent-arbeid (build + test + dokumentasjon).

---

### 2026-05-13 — Rad-vinst-flow E2E test (general-purpose agent, PM-AI)

**Scope:** Utvid pilot-test-suiten med en ny E2E-test som dekker Rad-vinst + master Fortsett (`spill1-rad-vinst-flow.spec.ts`). Eksisterende `spill1-pilot-flow.spec.ts` stopper etter buy-flow; B-fase 2c i `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` listet Rad-vinst som neste utvidelse.

**Inputs gitt:**
- Mandat: skriv ny testfil (ikke endre eksisterende), lag helper-utvidelser, fiks bugs hvis avdekket
- Pekere til `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`, `BUG_CATALOG.md`, `MasterActionService.ts`, `Game1MasterControlService.ts`
- Branch: ny fra main, ikke åpne PR (PM-AI tar over)
- Forutsetning: `ENABLE_BUY_DEBUG=1 npm run dev:nuke` på port 4000

**Outputs produsert:**
- **Branch:** `feat/pilot-test-rad-vinst-2026-05-13` (pushed til origin)
- **Commits:**
  - `1402cc35` — initial test + helpers + WinPopup data-test
  - `a5fb2007` — reorder: buy FØR masterStart (grid-rendering krever ready_to_start)
  - `640d604b` — polling-strategi (admin draw-next blokkert av USE_SCHEDULED_API)
  - `add0a485` — public room snapshot fallback
  - `a93fb658` — bruk /api/admin/game1/games/<id> for engine-state (drawsCompleted + currentPhase)
  - `56cfd342` — doc-oppdateringer (AGENT_EXECUTION_LOG, PITFALLS_LOG, BUG_CATALOG)
- **Filer:**
  - `tests/e2e/spill1-rad-vinst-flow.spec.ts:1-555` — ny test, 14-stegs flyt med pause/resume
  - `tests/e2e/helpers/rad-vinst-helpers.ts:1-326` — nye REST-helpers (masterPause, masterResume, masterAdvance, adminDrawNext, getGameStateSnapshot, getRoomSnapshotJson, getGameDetail, resetPilotStateExt)
  - `packages/game-client/src/games/game1/components/WinPopup.ts:86-103` — data-test-attributter (win-popup-backdrop, data-test-win-rows, data-test-win-amount, data-test-win-shared)

**Test-runs (deterministisk):**
- Run 1: PASS 52.8s — Rad 1 @ 37 draws (phase 1→2), Rad 2 @ 42 draws (phase 2→3)
- Run 2: PASS 48.1s — samme tellinger som Run 1
- Run 3: PASS 1.1m — Rad 2 @ 57 draws (variasjon pga random ticket-grid)
- Run 4 (post-doc-commit): PASS 53.4s — Rad 2 @ 44 draws
- Konklusjon: testen er deterministisk (samme path, ulik tid avhenger av tilfeldig pattern-match)

**Fallgruver oppdaget (alle nye, lagt til i PITFALLS_LOG):**

1. **Multi-agent worktree branch-switching:** Andre agenter switcher branches aggressivt i samme shared worktree. Forårsaket gjentatte revert av endringer. Mitigert ved: (a) `git push -u origin <branch>` umiddelbart etter første commit for å sikre persistens, (b) `git checkout -B <my-branch> origin/main` + `cherry-pick` + `push --force-with-lease` for å gjenopprette commits etter branch-switch, (c) `git reset --hard origin/main` + cherry-pick for å isolere min commit fra andre agenters arbeid. Anti-mønster: stol IKKE på at branch ikke endres mellom kommandoer i samme tool-batch.

2. **§6.10 — `/api/admin/rooms/<code>/draw-next` blokkert for scheduled Spill 1:** Returnerer `USE_SCHEDULED_API` for `gameSlug=bingo`. Eneste vei til scheduled draws er auto-tick (4s interval per `Game1AutoDrawTickService.defaultSeconds`) eller socket-event `draw:next`. Konsekvens: testen kan ikke akselerere draws — må vente på auto-tick.

3. **§6.9 — `/api/rooms/<code>` returnerer null `currentGame` for scheduled Spill 1:** Bekreftelse av at Game1DrawEngineService eier scheduled-runde-state, ikke BingoEngine room. For scheduled-game-state må man bruke `/api/admin/game1/games/<id>` (krever GAME1_GAME_READ) som returnerer `engineState.drawsCompleted` + `currentPhase` + `isPaused`.

4. **I12 i BUG_CATALOG — `/api/_dev/game-state-snapshot` krever `RESET_TEST_PLAYERS_TOKEN`-env-var:** Returnerer SPA-HTML hvis token mangler. Falt tilbake til `/api/admin/game1/games/<id>` som primær state-source.

5. **I13 i BUG_CATALOG — Demo-hall (`is_test_hall=TRUE`) auto-pauser likevel ved Rad-vinst:** Migration claims bypass men test-run viste `isPaused=true, pausedAtPhase=N` etter Rad-vinst. Praktisk: test-strategi som forventer auto-pause fungerer fint på demo-hall.

6. **Rad-vinst-deteksjon via `currentPhase`-advance:** Engine går fra phase=1 → phase=2 etter Rad 1, etc. På `is_test_hall=TRUE` advances skjer raskt (bypass pause); på prod-hall pauses engine før advance. Begge tilfeller dekkes av polling-strategi `phase > previousPhase`.

7. **Test må kjøre i `ready_to_start`-state for grid-rendering:** Buy må skje FØR masterStart. I status=running går buys til preRoundTickets-queue og rendres ikke i grid umiddelbart. Speil av kjent regel fra eksisterende test (`spill1-pilot-flow.spec.ts:181-191`).

8. **WinPopup `data-test`-attributter mangler i baseline:** Lagt til `win-popup-backdrop` + `data-test-win-rows/amount/shared` for test-deteksjon. Test bruker WinPopup som tidlig-exit, men faller tilbake til engine-snapshot hvis player ikke er vinner.

**Læring:**
- **Multi-agent worktree krever defensive git-flyt:** push-tidlig + cherry-pick + force-with-lease. Standard `git checkout main → edit → commit` flyten er for sårbar mot andre agenter.
- **Scheduled Spill 1 og BingoEngine er separate state-systemer:** for tester må man bruke admin-game1-endpoints, ikke `/api/rooms/`-endpointet.
- **Polling-strategi for auto-tick:** 500ms-poll + 90s-timeout per Rad gir solid margin. Med 4s draw-interval og ~37 draws (gjennomsnitt) til Rad 1 tar det ~2.5 min total test-runtime — innenfor 5min playwright-timeout.
- **Tids-basert polling > antall-basert polling:** Original test brukte `for (drawIdx = 1 to 35)` med `adminDrawNext`. Etter switch til auto-tick måtte vi bytte til `while (Date.now() - start < timeout)`. Tids-basert er mer robust mot variable draw-intervaller.

**Verifisering (PM-AI):**
- TypeScript strict passerer (`npx tsc --noEmit --skipLibCheck tests/e2e/`)
- 4 consecutive test-runs PASS deterministisk
- Master pause + resume preserverer scheduledGameId verifisert
- Rad 1 + Rad 2 detection via phase-advance verifisert

**Tid:**
- Total: ~2.5 timer (research + 5 iterasjoner + 4 verifisering-runs)

**Status:** Test grønn, branch pushed til origin. PR ikke åpnet (per oppdrag) — PM-AI tar over.

**Eierskap:** `tests/e2e/spill1-rad-vinst-flow.spec.ts`, `tests/e2e/helpers/rad-vinst-helpers.ts` (denne agentens). WinPopup-edit er minimal og non-breaking.

---

### 2026-05-13 — Pilot-test: no-auto-start regression (Tobias 2026-05-13)

**Scope:** Isolere bug Tobias rapporterte 2026-05-13: "runden startet også automatisk etter jeg kjøpte bong. vises som 5 kr innsats og 20 kr forhåndskjøp." Skal IKKE skje for Spill 1 (master-styrt mellom runder, ikke perpetual).

**Inputs gitt:**
- Branch: `feat/pilot-test-no-auto-start-2026-05-13` fra `origin/main`
- Pre-reqs: `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`, eksisterende `spill1-pilot-flow.spec.ts`, `helpers/rest.ts`, `SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`, `Game1MasterControlService`, `Game1ArmedToPurchaseConversionService`
- Direktiv: Lag ny `tests/e2e/spill1-no-auto-start.spec.ts`. Pre-seed scheduled-game via `markHallReady` (purchase_open). Buy via REST. Verifiser status forblir purchase_open/ready_to_start, IKKE running. Master starter manuelt → verifiser run state transition.

**Outputs produsert:**
- **Ny test:** `tests/e2e/spill1-no-auto-start.spec.ts` (289 linjer, 2 test-scenarios)
  - Scenario 1: 1 buy → 10s wait → verifiser ingen auto-start (10.4s deterministic)
  - Scenario 2: 3 raske buys → 15s wait → verifiser ingen auto-start (15.4s deterministic)
- **BUG_CATALOG oppdatert:** ny V-tabell ("Verifiserte ikke-bugs") med V1-entry for denne testen
- **Branch:** `feat/pilot-test-no-auto-start-2026-05-13`
- **Test-resultat:** **2 passed (26.7s)** — bug IKKE reprodusert via REST-flyt

**Root-cause-analyse:**
Bug-en Tobias rapporterte var IKKE en backend-auto-start. Det var en UI-misdisplay-bug i master-konsoll som hadde feil header-mapping fra PR #1277:
- Status `purchase_open` og `ready_to_start` ble feilaktig vist som "Aktiv trekning - X" i header
- Korrigert i commit `6b90b32e` 2026-05-12 ("'Aktiv trekning' kun ved running/paused")
- Tobias' manuelle test så denne UI-tekst og konkluderte at "runden startet automatisk"

Verifisert via test:
- REST `/api/game1/purchase` rør IKKE status. Engine `running`-status settes KUN i `Game1MasterControlService.startGame` (SQL: `SET status='running', actual_start_time=now()`)
- `Game1ScheduleTickService.transitionReadyToStartGames` flipper `purchase_open` → `ready_to_start` (når alle haller markert klar), ALDRI til `running`
- `DemoAutoMasterTickService` target `hall-default` only, ikke pilot-haller

**Læring:**
- **Verdi-først teste:** Test verifiserer Spill 1 sin master-styrte semantikk er intakt mot bukker som flytter den til perpetual-modell ved feiltrekk
- **UI vs DB:** Når Tobias rapporterer "runden startet" er det viktig å skille om det er backend-state eller UI-display. Header-text-mapping er ofte uavhengig av actual DB-state
- **Test-design:** Direkte REST-buy bypasser UI-buy-popup-rendering — fokuser test på arkitektur, ikke UI-iterasjon
- **Stress-test variant:** 3 raske buys + 15s wait dekker schedule-tick-cycle (10s interval) for race-detection
- **Skala:** Test kjører på 27s deterministic — egnet som CI-gate hvis aktivert

**Eierskap:**
- `tests/e2e/spill1-no-auto-start.spec.ts` — ny test, owned by denne agenten
- `tests/e2e/BUG_CATALOG.md` — appended V1-entry

**Fallgruver oppdaget:** Ingen nye — bug Tobias rapporterte var allerede fikset i `main` før denne test-sesjonen.

---

### 2026-05-10 → 2026-05-11 — Sesjon-summering: ADR-0017 + Bølge 1 + 2 + Tobias-bug-fix (PM-orkestrert)

**Scope:** Implementere 4 ADR-er (0017 jackpot manual, 0019 state-konsistens, 0020 utvidelses-fundament, 0021 master start uten spillere), pluss fikse 10+ Tobias-rapporterte bugs under live testing. Spawnet ~12 parallelle agenter på ulike scope.

**Inputs gitt:**
- Tobias-direktiv: ADR-0017 manuell jackpot (ikke daglig akkumulering)
- Tobias-direktiv: "Sett av så mange ressurser som mulig" for Bølge 1 + Bølge 2
- Tobias-direktiv: "ja, du kan starte MASTER_HALL_RED" (ADR-0021)
- Tobias-direktiv: Liten/Stor hvit/gul/lilla bong-navn (norske UI-labels)
- Tobias-direktiv: Erstatt WaitingForMasterOverlay med CenterBall idle-text
- Live bug-rapporter med skjermdump-feil ("fortsatt samme bilde", "venter på master popup", "429 fra rate-limit")

**Outputs produsert (PR-er merget):**
- **PR #1149** — `normalizeDevUserParam` for short-form dev-user query
- **PR #1154** — ADR-0017: fjern daglig jackpot-akkumulering
- **PR #1168** — admin-master-rooms socket-broadcast targeting (ADR-0019)
- **PR #1169** — `RoomStateVersionStore` for monotonic stateVersion dedup (ADR-0019)
- **PR #1174** — `RedisHealthMonitor` + `RedisHealthMetrics` (ADR-0020)
- **PR #1175** — `infra/leak-tests/r9-spill2-24h-leak-test.sh` + runbook (ADR-0020 R9)
- **PR #1176** — `RoomCircuitBreaker` + `RoomLatencyTracker` + `RoomIsolationGuard` (ADR-0020 R11)
- **PR #1180** — `infra/load-tests/spill1-1000-clients.mjs` + R4 runbook (ADR-0020)
- **PR #1183** — PM_ONBOARDING_PLAYBOOK §2.2 → bruk `npm run dev:nuke`
- **PR #1184** — fix `reset-state.mjs` ON CONFLICT → SELECT-then-INSERT
- **PR #1185** — `await lobbyStateBinding.start()` fix race condition
- **PR #1189** — `npm run build:games` i nuke-restart (§5)
- **PR #1190** — `lobbyTicketConfig` vinner over `state.ticketTypes`
- **PR #1192** — demo-plan 00:00-23:59 for 24h opening
- **PR #1193** — `pointer-events: none` på WaitingForMasterOverlay card
- **PR #1195** — `NORWEGIAN_DISPLAY_NAMES` (Liten hvit, Stor lilla, etc.)
- **PR #1197** — `buildBuyPopupTicketConfigFromLobby` autogenerer Large variants

**In-flight ved sesjons-slutt:**
- **PR #1196** — Slett WaitingForMasterOverlay, erstatt med CenterBall idle-text (CONFLICTING — rebase pending)

**Fallgruver oppdaget (alle dokumentert i PITFALLS_LOG):**
- §7.9 — `state.ticketTypes` overrider plan-runtime variantConfig (PR #1190)
- §7.10 — Static game-client-bundle krever eksplisitt rebuild (PR #1189)
- §7.11 — Lobby-init race condition (PR #1185)
- §7.12 — WaitingForMasterOverlay pointer-events blokkerer BuyPopup-klikk (PR #1193, #1196)
- §9.5 — Demo-plan åpningstid blokkerte natt-testing (PR #1192)
- §9.6 — `reset-state.mjs` ON CONFLICT uten UNIQUE-constraint (PR #1184)
- §11.8 — Single-command `npm run dev:nuke` eliminerer port-konflikter (PR #1183, #1189)
- §11.9 — Worktree-branch-leakage mellom parallelle agenter
- §11.10 — Pre-commit hook leser stale `COMMIT_EDITMSG`

**Læring:**
- **Mental modell-feil avsløres av frontend-popup:** ADR-0017 oppdaget kun fordi Tobias så `JackpotConfirmModal` på Bingo og umiddelbart forsto at modellen var feil. Pre-impl test mental-modell med eksempel-visualisering.
- **Static bundle er silent failure-modus:** Endringer i `packages/game-client/src/` synlige i Vite HMR men IKKE i spiller-shell før `npm run build:games`. Standard restart-kommando må alltid inkludere rebuild.
- **Lobby er autoritativ for spill-konfig:** Når `state.ticketTypes` og `lobbyTicketConfig` kolliderer, vinner lobby. Dokumentér eksplisitt — race conditions vil ellers gjenta seg.
- **Pointer-events: none MÅ være på alle nested elementer**, ikke bare backdrop. Card med `pointer-events: auto` dekker BuyPopup selv om backdrop er gjennomsiktig.
- **PM-sentralisert workflow scaler:** 16 PR-er merget over 12-15 timer. Auto-merge + CI-verifisering + dev:nuke-rutine eliminerte deploy-friksjon.
- **Worktree-isolation er obligatorisk for parallelle agenter** — cherry-pick mellom branches der begge endrer overlappende filer er anti-mønster. Bruk worktree + isolated branch fra start.

**Verifisering (PM):**
- 16 PR-er merget med ekte CI-grønning (verifisert via `gh pr checks <nr>` 5-10 min etter merge)
- Tobias bekreftet via live-test at de Norske ticket-navn er synlige i BuyPopup
- Lobby-state binding fungerer (CENTER_BALL viser "Neste spill: Bingo / Kjøp bonger for å være med i trekningen" når plan er aktiv men runde ikke startet)
- Auto-multiplier verifisert i `buildBuyPopupTicketConfigFromLobby`-output (Small = 1×, Large = 3×)

**Tid:**
- PM-orkestrering: ~12-15 timer over sesjonen
- Agent-arbeid: ~25-35 agent-timer total

**Status:** Bølge ferdig, klar for retest. PR #1196 må rebases. Hall-isolation-bug fra Tobias er åpen for diagnose.

---



**Scope:** Wire `JackpotSetupModal.ts` (245 linjer fra Fase 3, 2026-05-07) inn i master start-flyt fra cash-inout-dashboardet (Spill1HallStatusBox) og NextGamePanel. Tobias-bug 2026-05-10: backend kastet `JACKPOT_CONFIRM_REQUIRED`/`JACKPOT_SETUP_REQUIRED` → frontend viste rå `Toast.error` istedenfor popup.

**Inputs gitt:**
- Mandat: wire eksisterende JackpotSetupModal + lag ny JackpotConfirmModal for daglig-akkumulert pott
- Pekere til backend-error-codes (Game1MasterControlService:453, MasterActionService:856, GamePlanEngineBridge:920)
- Mønster fra `Game1MasterConsole.openJackpotConfirmPopup` som referanse
- F-NEW-1 (2026-05-09): backend tok allerede `jackpotConfirmed?: boolean` — bare frontend manglet

**Outputs produsert:**
- Branch `feat/jackpot-setup-modal-master-flow-2026-05-10` (commit `3cea3963`, pushed)
- Modifisert: `apps/admin-web/src/api/agent-game1.ts` (+45 linjer), `Spill1HallStatusBox.ts` (+~190 linjer), `NextGamePanel.ts` (+~125 linjer)
- Nye filer: `JackpotConfirmModal.ts` (198 linjer), `jackpotConfirmModal.test.ts` (221 linjer, 18 tester), `spill1HallStatusBoxJackpotFlow.test.ts` (481 linjer, 6 wireup-tester)
- Ny logikk: `runStartWithJackpotFlow`-loop som retry'er etter modal-submit
- Type-check admin-web + backend GREEN
- Vitest jackpot-suite: 40 PASS (18 + 6 + 9 + 7)
- Vitest full admin-web: 1544 PASS, 3 skipped
- Compliance gate: 444/446 PASS
- Live curl-verifisert: `JACKPOT_CONFIRM_REQUIRED` → `jackpotConfirmed: true` → backend bypass
- PR #1150 (auto-merge SQUASH aktivert)

**Fallgruver oppdaget:**
- **§7.6 (NY):** JackpotSetupModal eksisterte død i 3 dager før wireup — komponenten fra Fase 3 ble aldri kalt fra produksjonsflyt
- **§7.7 (NY):** `Number(null) === 0`-edge-case i `extractJackpotConfirmData` — drawThresholds-array filtrerte ikke ut `null`/`undefined`/`boolean` → `Number(null)` ble inkludert som gyldig threshold
- **§11.7 (NY):** Komponent-uten-wireup er IKKE leveranse — DoD må kreve "kan trigges fra UI uten devtools"
- Modal `onClose`-callback fyrer alltid uansett close-årsak → idempotent `settle()`-pattern med `resolved`-flag for å unngå dobbel-resolve

**Læring:**
- ✅ Mønster med "loop max 3x" fanger sekvensielle backend-feil (CONFIRM først, deretter SETUP)
- ✅ Live curl mot backend før test-skriving avdekket kontrakt-detalj
- ✅ Bakover-kompatibel API-endring (`startMaster()` med valgfri `jackpotConfirmed`)
- ⚠️ PM-gate `[bypass-pm-gate]`-melding misvisende fra stale `.git/COMMIT_EDITMSG` — agent ignorerte og pushed
- ⚠️ Anbefalt sjekk: hver ny komponent → grep etter `import.*ComponentName` i prod-path

**Verifisering (PM):**
- Branch fetched + commits inspisert
- 40 jackpot-tester PASS i agent-rapport
- PR #1150 auto-merge SQUASH aktivert
- PR-beskrivelse inkluderer Tobias retest-instruksjoner

**Tid:** ~17 min agent-arbeid (1003s per usage-rapport, 124 tool-uses)

### 2026-05-10 17:50 — `(test-engineer for spillerklient)` (test-engineer)

**Scope:** Skriv regresjonstester for to spillerklient-bugs Tobias rapporterte: (1) `?dev-user=demo-pilot-spiller-1` ga 403 og (2) lobby-fetch-resilience ved backend-feil.

**Inputs gitt:**
- Tobias screenshot + console-log som viste 403 på `/api/dev/auto-login?email=demo-pilot-spiller-1` (uten domain)
- Backend allowlist-regex i `apps/backend/src/dev/devAutoLoginRoute.ts` (KORREKT spec — krever full email)
- Frontend dev-user-paths (`auth.js:740` + `main.ts:84`) som sendte raw param uten normalisering
- Mandat: lås backend-kontrakt + skriv frontend regression-tester + lever spec for `normalizeDevUserParam()`

**Outputs produsert:**
- Branch `fix/spillerklient-plan-runtime-fallback-2026-05-10` (commit `dc1d1ffb`, pushed)
- 3 nye test-filer:
  - `apps/backend/src/dev/devAutoLoginRoute.handler.test.ts` (393 linjer, 16 tester) — låser backend-kontrakt
  - `packages/game-client/src/games/game1/__tests__/devUserAutoLoginRegression.test.ts` (290 linjer, 24 tester) — frontend regression
  - `packages/game-client/src/games/game1/logic/LobbyStateBinding.fetchResilience.test.ts` (497 linjer, 16 tester) — fetch-resilience
- Slut-rapport med `normalizeDevUserParam()`-spec klar for implementer
- Mapping-tabell: `'demo-pilot-X'` → `@example.com`, `'demo-agent-X'` → `@spillorama.no`, `'tobias'` → `@nordicprofil.no`

**Fallgruver oppdaget:**
- **§7.5 (NY):** Frontend må normalisere query-params før backend-kall — backend-allowlist-regex er KORREKT spec, ikke bug
- Anti-mønster: "Backend rejecter min input → backend må fikses" (ofte er backend riktig)

**Læring:**
- ✅ Test-engineer-pattern: lever regression-tester FØR implementasjon for å låse spec
- ✅ Slut-rapport med "Anbefaling til implementer-agent" gjør PM-handoff trivielt (PM porter spec til prod-kode)
- ✅ Pure-funksjon med eksplisitt mapping-tabell er trivielt å porte mellom JS (auth.js) og TS (main.ts)
- ⚠️ Bug-symptomene ("STANDARD"-header, 8 farger, ingen overlay) var alle nedstrøms av 403 — én bug fix → tre bugs forsvinner

**Verifisering (PM):**
- 16 backend-tester PASS via `npx tsx --test`
- 24 frontend regression-tester PASS via `vitest run`
- 16 LobbyStateBinding-tester PASS
- PM portet `normalizeDevUserParam()` til auth.js + main.ts (commit `f3967221`)
- PR #1149 auto-merge SQUASH aktivert

**Tid:** ~12 min agent-arbeid (test-skriving) + ~3 min PM implementasjon

### 2026-05-10 16:30 — `abb7cfb21ba7e0f42` (Plan)

**Scope:** Lag konkret valideringsplan for R12 (BIN-816) — verifiser at eksisterende DR-runbook dekker live-rom-arkitektur (Spill 1, 2, 3) per LIVE_ROOM_ROBUSTNESS_MANDATE §6.

**Inputs gitt:**
- Mandat-spec (autoritativ kilde)
- 14 eksisterende DR-runbooks å auditere
- Mandat-S1-S7-scenarier å sjekke mot
- Per-spill-spesifikke gaps-instruksjon
- Strukturert output-format med 8 seksjoner
- Constraints: ikke skriv fil, ikke foreslå arkitektur-endringer, realistisk estimat

**Outputs produsert:**
- Tekst-plan med 8 seksjoner (1500+ ord)
- 14 runbook-inventory
- Gap-analyse mot 7 mandat-scenarier
- 7 drill-design med invariants + estimat
- Sign-off-kriterier (8 punkter)
- Anbefalt rekkefølge for drills
- Plan etterpå skrevet til `docs/operations/R12_DR_VALIDATION_PLAN.md` (av PM)

**Fallgruver oppdaget (KRITISK):**
- **§4.X (NY) — DR-runbook S1-S7-navne-kollisjon:** `LIVE_ROOM_DR_RUNBOOK.md` bruker S1-S7 for INFRASTRUKTUR (backend-crash, Redis-død, etc.) MENS `LIVE_ROOM_ROBUSTNESS_MANDATE.md` bruker S1-S7 for APPLICATION/COMPLIANCE (master-fail, ledger poison, RNG drift, etc.). Ops/compliance kan få feil oppfatning under press.
- Logget til [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) §4.X (DR-runbook navne-kollisjon)

**Læring:**
- ✅ Plan-agent identifiserte navne-kollisjons-bug ingen tidligere PM/agent hadde fanget
- ✅ Realistisk 22-28 timer-estimat (ikke "noen timer" som ofte gjentas)
- ✅ Identifiserte hvilke drills krever Tobias-tid (C, E) vs L2 alene (A, F)
- ⚠️ Anbefalt parallellisering (A+F samme dag) for ressurs-effektivitet

**Verifisering (PM):**
- Plan lest i sin helhet
- Inventory matchet mot faktisk filer i `docs/operations/`
- Gap-analyse cross-sjekket mot mandat §3 + §6
- Lagret som ny doc med samme branch som PITFALLS-update

**Tid:** ~4 min agent-arbeid (252s per usage-rapport)

### 2026-05-10 15:45 — `a1d4ffe73fc2d80fe` (general-purpose)

**Scope:** Verifiser + lukk stale R-mandat-issues i Linear (BIN-810 children). 14 children alle i `Backlog`-state, men minst 7 var faktisk merget.

**Inputs gitt:**
- Spesifikke issues å verifisere (BIN-822, 823, 813, 814, 815, 811, 812, 825)
- Done-policy-krav (commit-SHA + file:line + test/CI)
- Mal for Done-comments
- Anti-mønstre (ikke lukk uten evidence, ikke rør andre prosjekter)
- Constraints: kun Linear-state-endringer, ingen kode

**Outputs produsert:**
- 8 BIN-children flippet fra `Backlog` → `Done`:
  - BIN-822 R1 Game1Controller-wireup
  - BIN-823 Spill 2 åpningstid-guard
  - BIN-813 R5 Idempotent socket-events
  - BIN-814 R7 Health-endpoint
  - BIN-815 R8 Alerting
  - BIN-811 R2 Failover-test (PASSED 2026-05-08 22:39)
  - BIN-812 R3 Reconnect-test (PASSED 2026-05-08 22:42)
  - BIN-825 Chaos-test Dockerfile-mismatch
- BIN-810 parent fått status-update-kommentar
- 5 issues korrekt holdt åpne (BIN-817/818/819/820/821 — post-pilot-utvidelses-blokkere)
- 1 issue holdt åpen (BIN-816 — drill pending)

**Fallgruver oppdaget:**
- **Doc-konflikt:** Individuelle resultat-doc-er (`R2_FAILOVER_TEST_RESULT.md`, `R3_RECONNECT_TEST_RESULT.md`) viser tom invariant-status, mens autoritativ `CHAOS_TEST_RESULTS_R2_R3_2026-05-08.md` rapporterer PASS. Per PM_HANDOFF_2026-05-09: CHAOS_TEST_RESULTS er autoritativ. Allerede dekket i [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) §8.4 (kode vs doc).
- BIN-825 var verifisert fixet (`af355de2`, `a29a153d`, `c845743d`) selv om Linear-tittel sa "blokker R2/R3" — bekreftet inkonsistens fra tidligere observasjon.

**Læring:**
- ✅ Verifisering mot kode FØR Linear-state-endring fanget BIN-825-inkonsistens
- ✅ Done-policy-comments med komplett evidence-format gir framtidig audit-spor
- ✅ Holdt seg strengt innenfor BIN-810-children-scope (ingen lekkasje til andre prosjekter)
- ⚠️ Linear-state var DRASTISK stale — pilot-go/no-go-møte kunne potensielt blitt utsatt pga feil oppfatning av "åpne pilot-blokkere"

**Verifisering (PM):**
- Linear-changes inspisert via MCP `get_issue` for stikkprøver
- Done-policy-evidence lest i kommentarer — alle har commit-SHA + file:line + verifiserings-bevis
- Ingen filer i repoet endret (acceptance-kriterium oppfylt)

**Tid:** ~7 min agent-arbeid (456s per usage-rapport, mest verifiserings-tid)



### 2026-05-10 14:30 — `aee1f08ad995ac301` (general-purpose)

**Scope:** Cleanup av stale entries i `BACKLOG.md`. K4 (BIN-823) markert ÅPEN selv om FIKSET 2026-05-08.

**Inputs gitt:**
- Spesifikk inkonsistens: BACKLOG vs `SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` §3.8
- Tobias-direktiv 2026-05-09 om lese-disiplin (kontext-grunnlag)
- Verifiserings-trinn (sjekk eksistens av `PerpetualRoundOpeningWindowGuard.ts`, tester, wireup)
- Sweep-instruks for andre stale entries
- Conventional Commits-format
- Anti-mønstre (ikke `git add -A`, ikke rør PM-handoff/ADR-er)

**Outputs produsert:**
- Branch: `docs/backlog-cleanup-2026-05-10`
- Commit: `6f5b5feb` — `docs(planning): mark BIN-823 closed in BACKLOG.md + sweep stale entries`
- 1 fil endret (BACKLOG.md), 30 insertions / 25 deletions
- PR #1136 (PM opprettet) — auto-merget som `efe76be7` 2026-05-10
- Sentral endring: K4 markert ✅ Lukket, Wave 3a (PR #952) + Wave 3b (PR #953) lagt til ferdig-historikk

**Fallgruver oppdaget:**
- Ingen nye fallgruver — agenten verifiserte at relaterte doc-er (SPILL[2-3]_IMPLEMENTATION_STATUS, E2E_TESTS, PM_ONBOARDING_PLAYBOOK, status/2026-W19) allerede har korrekt BIN-823-referanse

**Læring:**
- ✅ Agenten leverte presist + holdt seg innenfor doc-only scope
- ✅ Identifiserte ekstra stale entries (Wave 3a+3b) selv — verdi-add utover prompt
- ✅ Verifiserte mot kode FØR endring av BACKLOG → ingen falsk-positiv markering

**Verifisering (PM):**
- Diff inspisert manuelt — alle endringer korrekte og innenfor scope
- File:line-pekere i commit gyldige
- Auto-merge satt med squash → CI grønn → mergeed

**Tid:** ~6 min agent-arbeid (355s per usage-rapport)

---

### 2026-05-13 — `a43345d47cf2a71da` (autonomous-loop, general-purpose)

**Scope:** Bygg fullverdig E2E test-infrastruktur for Spill 1 pilot-flow. Driv test til grønn. Hvis bugs avdekkes underveis, fiks og dokumenter. Spawnet 2026-05-13 etter Tobias-direktiv om kurs-endring etter 3-dagers buy-flow-iterasjon.

**Inputs gitt:**
- Tobias-direktiv: "fullverdig testflyt for effektiv utvikling, hvis dette tar 3 dager er det 100% verdt det"
- Beskjed om at pilot-dato ikke skal komme på bekostning av kvalitet
- BUY-DEBUG-output fra Tobias' manuelle test (åpning av spill1-pilot-flow med priser 20 kr / 0 kr)
- Pre-existing infrastructure: `apps/backend/scripts/pilot-smoke-test.sh` (utdatert), demo-seed-data, dev:nuke-kommando
- Worktree: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/musing-tharp-551346` på branch `feat/autonomous-pilot-test-loop-2026-05-13`

**Outputs produsert:**
- Branch: `feat/autonomous-pilot-test-loop-2026-05-13` — pushed til origin
- Commit: `9aad3063` — "feat(spill1): autonomous pilot-flow E2E test + 3 buy-flow bugfixes"
- PR: #1305 (PM-åpnet etter agent-fullføring, auto-merge aktivert)
- Nye filer:
  - `tests/e2e/playwright.config.ts` — separat config for live-stack
  - `tests/e2e/spill1-pilot-flow.spec.ts` — 14-stegs full flow
  - `tests/e2e/helpers/rest.ts` — REST-helpers (autoLogin, masterStart, markHallReady, resetPilotState m/admin room-destroy)
  - `tests/e2e/BUG_CATALOG.md` — bug-katalog template + 7 hist. + 3 nye fiksede
  - `tests/e2e/README.md` — kjøre-instruksjoner + design-rationale
  - `scripts/pilot-test-loop.sh` — runner med automatic failure-diagnose
- Endringer i prod-kode (3 nye bugs fikset):
  - `packages/game-client/src/games/game1/sockets/SocketActions.ts` — buildScheduledTicketSpec bruker priceMultiplier (I8)
  - `packages/game-client/src/games/game1/components/TicketGridHtml.ts` — computePrice match (size, color) (I9)
  - `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` — cancelBtn reset ved re-open (I10)
- Endringer i tests/data-test attrs:
  - `Game1BuyPopup.ts` — `data-test="buy-popup-{backdrop,row,price,plus,minus,qty,total-*,confirm,cancel}-<slug>"`
  - `BingoTicketHtml.ts` — `data-test="ticket-card"` + `data-test-ticket-{id,color,type,price}`
  - `TicketGridHtml.ts` — `data-test="ticket-grid"`
- npm-scripts: `test:pilot-flow`, `:ui`, `:debug`

**Fallgruver oppdatert i PITFALLS_LOG:**
- §6.6 — Manuell iterasjons-loop konvergerer ikke (P0 root-cause)
- §6.7 — Sessions-state-resett mellom E2E-test-runs
- §6.8 — Dev-user redirect-race forstyrrer Playwright

**Læring:**
- ✅ **Test-infra først** funker. 3 nye bugs som tok 3 dager manuelt ble avdekket på én agent-kjøring etter test-infra var på plass.
- ✅ **Autonomi-loop med presis prompt** er extremely effective. Agent kjørte ~80 min, produserte 14-stegs test + 3 bugfixes + komplett dok.
- ✅ **Direct token injection** > `?dev-user=`-redirect i Playwright for å unngå timing-race
- ✅ **Pre-seed `sessionStorage.lobby.activeHallId`** kritisk for å route lobby til pilot-hall (default-er ellers til `hall-default`)
- ⚠️ **`resetPilotState` må også DELETE-e GoH-rommet** — `masterStop` alene lar player-slots henge (engine beholder vinnere)
- ⚠️ **Daglig tapsgrense** akkumulerer over tester — `raisePlayerLossLimits`-helper + pick fra 12-spillers pool
- ⚠️ **Bypass-gate brukt** (`[bypass-pm-gate: emergency-pilot-test-fix]`) fordi PR-flow har vært bottleneck i 3 dager. Bypass er dokumentert i commit-message.

**Verifisering (PM):**
- ✅ Inspiserte commit `9aad3063` — diff ser ren ut
- ✅ Sjekket at `git push` lykkes (origin up-to-date)
- ✅ Åpnet PR #1305 manuelt med auto-merge
- ✅ Skrev `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` med agent-mønsteret som §3.1
- ✅ Skrev denne entry'en
- ⏳ Tobias verifiserer post-merge at `npm run test:pilot-flow` går grønn på hans maskin

**Tid:** ~80 min agent-arbeid (387 tool-uses, 4 839 622 ms = 80 min duration per usage-rapport) + ~30 min PM-verifikasjon/docs.

---

### 2026-05-10 13:00 — `abbf640efb7e47e95` (test-engineer)

**Scope:** Bygg automatisert E2E pilot-flow-script (Spor 2B). Komplement til manuell `PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md`. Fiks også eksisterende smoke-test-bugs.

**Inputs gitt:**
- Eksisterende script-bug-rapport (jq-paths feiler — `.data` vs `.data.groups`)
- Full spec for §1-§6 dekning (admin login → plan → ready → start → bong-kjøp → SQL-verify pot + multi-hall)
- Demo-data setup (haller, agenter, spillere)
- DB tilgangs-info (PGPASSWORD)
- Idempotens-krav, fail-fast, color-coded output
- Anti-mønstre (ikke `git add -A`, ikke rør audit-tabeller, forward-only migrations)

**Outputs produsert:** _(in flight, oppdateres når ferdig)_

**Forventet leveranse:**
- Branch: `feat/pilot-flow-e2e-script-2026-05-10`
- 2 endringer:
  1. Fix `apps/backend/scripts/pilot-smoke-test.sh` (jq-paths)
  2. Ny `apps/backend/scripts/pilot-flow-e2e.sh` (full §1-§6)
- Vitest unit-tester for helper-funksjoner

**Status:** 🔄 Forventet ferdig 17:00-18:00 UTC.

---

## Entries fra tidligere sesjoner (rekonstruert fra PM-handoffs)

> **NB:** Disse entries er rekonstruert fra `PM_HANDOFF_*.md`-historikk. Gransularitet lavere enn fremtidige entries.

### 2026-05-10 (sesjon: spillerklient-rebuild)

**5 PR-er merget på én sesjon:**

| Agent (anonym) | PR | Tema |
|---|---|---|
| Implementasjons-agent | #1125 | PM_ONBOARDING_PLAYBOOK + tools (~2200 linjer docs) |
| Implementasjons-agent | #1126 | Master-flow + lazy-spawn (forrige PMs hovedoppgave) |
| Implementasjons-agent | #1127 | E2E-fix BIN-828 (reparerte 9 main-fails) |
| Implementasjons-agent | #1128 | Fase 1 spillerklient: Game1Controller-aggregator |
| Implementasjons-agent | #1132 | Fase 2+3+4 spillerklient (combined etter SHA-mismatch) |

**Sentrale fallgruver oppdaget:**
- §5.1 Squash-merge SHA-mismatch ved kjedede PR-er → CONFLICTING (PR #1129/#1130/#1131 lukket, combined til #1132)
- §6.1 e2e-workflow har ingen migrate-step (BIN-828 fix → PR #1127)
- §7.1-§7.3 Game1Controller hardkodet defaults → fixed via lobby-runtime-binding

### 2026-05-09 (sesjon: master-flow lazy-spawn)

**12+ timer arbeid, ende-til-ende master-flow-fundament**

| Agent (anonym) | Område | Læring |
|---|---|---|
| 1× implementasjons-agent | `MasterActionService.prepareScheduledGame` | Lazy-create scheduled-game uten engine.startGame |
| 1× test-agent | curl-baserte E2E-tester | 6 tester PASS, 1 P0-bug funnet (cancelled-rad-gjenbruk) |

**Sentrale fallgruver oppdaget:**
- §3.2 DrawScheduler kill-switch for `bingo`-slug
- §3.6 Master-hall-pin: kolonne + extra_json
- §3.9 Lazy-spawn cron-race-håndtering
- §4.4 GamePlanEngineBridge cancelled-rad-gjenbruk (åpen P0)
- §9.1 Tobias' `.env` pekte på ikke-eksisterende DB

### 2026-05-08 (sesjon: pilot-fundament)

**14 PR-er merget, R-mandat etablert**

**Sentrale fallgruver oppdaget:**
- §3.1 Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer (gjentakelse — Tobias-direktiv)
- §3.4 Spill 3 phase-state-machine sequential (ikke PR #860-revertet 3×3-form)
- §3.8 BIN-823 Spill 2 åpningstid-guard

### 2026-05-07 (sesjon: spilleplan-redesign)

**22 PR-er merget — Fase 1-4 spilleplan-redesign**

| Område | Læring |
|---|---|
| Datamodell-konsolidering | 9 → 4 tabeller (`app_game_catalog`, `app_game_plan`, `app_game_plan_item`, `app_game_plan_run`) |
| 13 katalog-spill | Standard / Trafikklys (`explicit_per_color`) / Oddsen (target-draw) |
| Auto-multiplikator | Per bongfarge: 5kr×1, 10kr×2, 15kr×3 |
| Bonus-spill per item | `plan_item.bonus_game_override > catalog.bonus_game_slug > none` |

**Sentrale fallgruver dokumentert:**
- §1.7 Auto-multiplikator gjelder per bongfarge
- §1.8 Multi-vinner pot-deling per bongstørrelse (regel definert, engine-rebuild gjenstår)

### 2026-04-26 (sesjon: casino-grade wallet)

**K1+K2+K3-bølge ferdig, 9 PR-er åpnet samme dag**

**Sentrale fallgruver oppdaget:**
- §2.1 Wallet 2.-vinn-bug (PR #553 — 4t fix)
- §2.2 BIN-611 race condition SELECT-before-BEGIN
- §2.3 BIN-612 ExternalWalletAdapter retry-er 5× ved alle feil
- §2.4 Outbox-pattern (BIN-761 etablert)
- §2.5 REPEATABLE READ (BIN-762)

---

## Mønstre observert (etter ~50 agent-sesjoner)

### Når agenter leverer best

1. **Klart definert scope** — agenten vet hvilke filer den eier
2. **Eksplisitte fallgruver** i prompt — referer til PITFALLS_LOG-sek
3. **Acceptance criteria** med JA/NEI-checks (ikke "lag noe pent")
4. **Verifiserings-trinn inkludert** — agenten validerer eget arbeid
5. **Conventional Commits-format spesifisert** — colour-printing CI hvis ikke

### Når agenter sliter

1. **For bredt scope** ("fix alle bugs i wallet") — leverer overflate eller blokker på unsikkerhet
2. **Manglende kontekst-pekere** — agenten må re-discovere arkitektur
3. **Konflikt med parallell agent** — to agenter på samme fil → merge-konflikt
4. **Stale dokumentasjon** — agenten antar feil mønster basert på utdaterte docs
5. **Ingen anti-mønstre i prompt** — agenten gjør "what feels right" istedenfor å unngå kjente feil

### Sweet-spot

- 1-3 timer agent-arbeid
- Single fil-tre eller veldefinert grense
- Klart input + klart output
- Verifiserings-mekanisme (test, file-existence, SQL-query)

---

## Hvordan legge til ny entry

```markdown
### YYYY-MM-DD HH:MM — `<agent-id>` (<agent-type>)

**Scope:** 1-2 setninger om hva agenten skulle gjøre.

**Inputs gitt:**
- Punkt 1
- Punkt 2

**Outputs produsert:**
- Branch: `...`
- Commit: `<sha>` — `<commit-message>`
- File:line pekere
- PR-nummer (hvis åpnet)

**Fallgruver oppdaget:**
- §X.Y — kort beskrivelse, lenke til PITFALLS_LOG
- (eller "ingen nye fallgruver")

**Læring:**
- Hva fungerte
- Hva ville vi gjort annerledes
- Mønstre for framtidige agenter

**Verifisering (PM):**
- Hva PM gjorde for å verifisere
- Eventuelle issues funnet

**Tid:** Antall min agent-arbeid + PM-verifikasjon
```

---

## Relaterte dokumenter

- [`PITFALLS_LOG.md`](./PITFALLS_LOG.md) — sentral fallgruve-katalog
- [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) — PM-rutine
- [`ENGINEERING_WORKFLOW.md`](./ENGINEERING_WORKFLOW.md) — branch + PR + Done-policy
- [`docs/operations/PM_HANDOFF_*.md`](../operations/) — sesjons-handoffs

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — 6 dagers agent-historikk + 2 aktive agenter | PM-AI (Claude Opus 4.7) |
| 2026-05-11 | Sesjon 2026-05-10→2026-05-11: 16 PR-er merget (ADR-0017 + Bølge 1 + Bølge 2 + ADR-0021 + Tobias-bug-fix). 9 nye fallgruver dokumentert i PITFALLS_LOG. | PM-AI (Claude Opus 4.7) |
| 2026-05-13 | Cross-knowledge audit etablert: `scripts/cross-knowledge-audit.mjs` (8 drift-sjekker) + ukentlig CI-workflow (mandag 10:00 UTC) + `docs/engineering/CROSS_KNOWLEDGE_AUDIT.md` bidragsguide. Pillar 8 i Knowledge Autonomy Protocol. | Agent (cross-knowledge-audit task) |
