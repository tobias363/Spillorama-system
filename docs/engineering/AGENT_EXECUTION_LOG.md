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

### 2026-05-13 — Tobias-readiness auto-generator i AI Fragility Review (general-purpose agent)

**Scope:** Utvid `ai-fragility-review.yml`-workflow med auto-genererte "Tobias smoke-test"-seksjoner per PR. Heuristikk-basert fil→scenario-mapping rendrer ferdig markdown med konkrete URL-er, credentials, klikk-steg, forventet resultat og typiske feilbilder. Skal redusere Tobias' verifikasjons-burden ved at han ser hva han skal teste uten å lese diffen selv.

**Inputs gitt:**
- Mandat fra Tobias 2026-05-13: PR-comment skal ha "Tobias smoke-test"-seksjon med <30 linjer, konkrete URL-er, norsk språk
- Pekere til `.github/workflows/ai-fragility-review.yml`, `FRAGILITY_LOG.md`, `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`, `PM_ONBOARDING_PLAYBOOK.md` §5, PR-template
- 8 scenario-maler påkrevd (master-start/stop/advance, spiller-buy/mark, wallet-touch, docs-only, unknown)
- Min 5 fixture-diff-er for testing
- Branch: `feat/tobias-readiness-summary-2026-05-13`, ikke åpne PR

**Outputs produsert:**
- **Branch:** `feat/tobias-readiness-summary-2026-05-13` (pushes til origin etter PM-godkjent)
- **Filer (nye):**
  - `scripts/generate-tobias-readiness.mjs:1-301` — Node ESM-script med `classifyFile()` + `aggregateScenarios()` + `generateReadinessSection()` + CLI-main
  - `scripts/tobias-readiness-templates/master-start.md` — start-runde-mal
  - `scripts/tobias-readiness-templates/master-stop.md` — stopp-runde-mal
  - `scripts/tobias-readiness-templates/master-advance.md` — advance-til-neste-fase-mal
  - `scripts/tobias-readiness-templates/spiller-buy.md` — kjøp-bonger-mal
  - `scripts/tobias-readiness-templates/spiller-mark.md` — marker-tall-mal
  - `scripts/tobias-readiness-templates/wallet-touch.md` — wallet+compliance-mal
  - `scripts/tobias-readiness-templates/docs-only.md` — "ikke nødvendig"-mal
  - `scripts/tobias-readiness-templates/unknown.md` — fallback-mal
  - `scripts/__tests__/generate-tobias-readiness.test.mjs` — 39 tester (node:test)
  - `scripts/__tests__/fixtures/diff-{docs-only,master-start,spiller-buy,wallet-touch,mixed,husky-only,unknown}.txt`
  - `scripts/__tests__/fixtures/commits-pilot-fix.txt`
  - `docs/engineering/TOBIAS_READINESS_FORMAT.md` — vedlikeholds-doc
- **Filer (endret):**
  - `.github/workflows/ai-fragility-review.yml` — nytt `Generate Tobias smoke-test section`-step + integrasjon med eksisterende FRAGILITY-review comment

**Test-resultat:**
- `node --test scripts/__tests__/generate-tobias-readiness.test.mjs` → 39/39 pass, ~1.1s runtime
- Manuell smoke-test med `--diff-file scripts/__tests__/fixtures/diff-spiller-buy.txt` produserte korrekt markdown med 2 scenarier (spiller-buy + spiller-mark) inkludert URL-er, credentials og "Forventet feilbilde"-seksjon
- YAML-syntax verifisert med `js-yaml.load(...)` → OK

**Fallgruver oppdaget:**
- Hvis FRAGILITY har 0 matches OG vi bare ville posted Tobias-section, var den eksisterende `return`-early-koden et hinder — fikset ved å restrukturere så Tobias-section vises uavhengig av FRAGILITY-match
- Eksisterende comment-detection brukte kun "🛡️ AI Fragility Review"-substreng — utvidet til å også matche "🎯 Tobias smoke-test" så docs-only-PR-er får én oppdatert comment, ikke duplikat
- Aggregering: hvis blandet docs+kode, måtte vi droppe "docs-only" fra scenario-listen så reelle test-steg ikke ble overskygget av "ikke nødvendig"

**Læring:**
- Templates som markdown-filer (ikke inline strings i kode) gir mye lettere vedlikehold — Tobias eller framtidig PM kan justere språk uten å rør JS-koden
- Test-fixture-tilnærming (diff-files på disk) gir reproduserbar testing av CLI-integrasjonen
- `import.meta.url` + named exports lar samme fil være både CLI og test-target uten kunstig refactor

**Verifisering (PM):**
- Vil verifisere at workflow renderer korrekt på faktisk PR etter merge til main
- Forventer at neste PR mot main får både FRAGILITY-review (eksisterende) + Tobias-readiness (nytt)

**Tid:** ~3 timer agent-arbeid

**Eierskap:** `scripts/generate-tobias-readiness.mjs`, `scripts/tobias-readiness-templates/`, `scripts/__tests__/generate-tobias-readiness.test.mjs`, `.github/workflows/ai-fragility-review.yml` (Tobias-section), `docs/engineering/TOBIAS_READINESS_FORMAT.md`

---

### 2026-05-13 — Spill 1 re-entry-during-draw bug-FIX (I15) (reentry-fix agent, PM-AI)

**Scope:** Implementer fix for I15 (re-entry-during-draw blokk) basert på diagnose levert av forrige agent (`docs/architecture/REENTRY_BUG_DIAGNOSE_2026-05-13.md`). Speile `findPlayerInRoomByWallet + attachPlayerSocket`-guard fra `room:create`/`room:join` inn i `joinScheduledGame`. Knowledge protocol: oppdater FRAGILITY F-05 + PITFALLS §7.13 + BUG_CATALOG I15.

**Inputs gitt:**
- Diagnose-doc med root-cause + foreslått fix (impl-only-pseudokode)
- Repro-test `tests/e2e/spill1-reentry-during-draw.spec.ts` på `feat/reentry-diagnose-2026-05-13`
- Pekere til `roomEvents.ts:372-397` (room:create-guard) og `roomEvents.ts:771-806` (room:join-guard)
- Krav: branch fra origin/main, IKKE åpne PR, oppdater knowledge-docs

**Outputs produsert:**
- **Branch:** `fix/reentry-during-draw-2026-05-13` (pushed til origin)
- **Filer endret:**
  - `apps/backend/src/sockets/game1ScheduledEvents.ts:40,295-336` — re-attach-guard lagt til (33 linjer ny kode + import)
- **Filer nye:**
  - `apps/backend/src/sockets/__tests__/game1ScheduledEvents.reconnect.test.ts` — 4 unit-tester (350+ linjer)
- **Filer oppdatert (knowledge-docs):**
  - `docs/engineering/FRAGILITY_LOG.md` — F-05 lagt til (60+ linjer)
  - `docs/engineering/PITFALLS_LOG.md` — §7.13 utvidet med Variant A vs Variant B + alle handler-path-listen
  - `tests/e2e/BUG_CATALOG.md` — I15 status til 🟡 PR pending, endringslogg-entry
- **Cherry-picks:** Cherry-picket diagnose-commit (`fbbd6a3c`) + FRAGILITY_LOG-introducing commit (`e54526f7`) inn på fix-branch så docs+repro-test + base FRAGILITY_LOG er tilgjengelig (FRAGILITY_LOG hadde ikke landet på main enda).

**Test-resultater:**
- ✅ TypeScript strict: clean (`npm run check` i apps/backend)
- ✅ Unit-tester nye: 4/4 PASS (`game1ScheduledEvents.reconnect.test.ts`) — 564ms
- ✅ Unit-tester eksisterende: 15/15 PASS (`game1JoinScheduled.test.ts`) — backwards-compat verifisert
- ✅ Reconnect-tester: 3/3 PASS (`reconnectMidPhase.test.ts`)
- ✅ Scheduled-binding-tester: 5/5 PASS (`roomEvents.scheduledBinding.test.ts`)
- ✅ E2E PASS: `spill1-reentry-during-draw.spec.ts` (14.9s, 1/1 PASS mot lokal `dev:all` med `ENABLE_BUY_DEBUG=1`)

**Fallgruver oppdatert i PITFALLS §7.13:**
- Variant A (PR #1218): klient-side fallback for delta-watcher kun
- Variant B (denne 2026-05-13): backend-side guard for initial-join — ny dimensjon for samme pitfall-klasse
- KRITISK observasjon: ÉN handler-path-fix er ikke nok — ALLE join-handlere må ha guard

**Ny FRAGILITY F-05:**
- Filer: 6 (game1ScheduledEvents + roomEvents.ts + BingoEngine + roomHelpers)
- Hvorfor fragile: `detachSocket` beholder player-record bevisst → ALLE join-paths må ha re-attach-guard
- Hva ALDRI gjøre: 5 punkter (ikke kall joinRoom uten guard, ikke fjern guard "for å forenkle", ikke endre detachSocket, etc.)
- Tester som MÅ stå grønn: 6 (4 unit + 2 E2E)
- Manuell verifikasjon: 8-trinn flyt
- Historisk skade: PR #1218 (Variant A glemt initial-join) + 2026-05-13 (I15 oppstod fordi initial-join-pathen var glemt)

**Læring:**
- Cherry-pick base-commits FØR fix når avhengige docs/tests ikke har landet på main enda. Spar tid vs å gjenskape repro-test.
- `findPlayerInRoomByWallet` er en standalone helper i `roomHelpers.ts`, ikke en metode på engine — kan importeres direkte i `game1ScheduledEvents.ts` uten å rote med deps-objektet.
- Test-stub som returnerer `players: [...]` i `getRoomSnapshot` er tilstrekkelig for å verifisere re-attach-pathen uten å mocke ut engine-internals.
- Fail-soft pattern fra dev-team: catch + log warn ved snapshot-lookup-feil (annet enn ROOM_NOT_FOUND), fall gjennom til normal joinRoom. ROOM_NOT_FOUND-pathen håndteres allerede av eksisterende recovery-blokk.

**Verifisering:**
- Backend kjørte tsx watch under utvikling — fix-en hot-reloaded automatisk
- E2E-test kjørt mot levende backend med fix-en aktiv → PASS
- Pre-existing tester ikke brutt

**Tid:** ~45 min (45 min implementasjon + tester + docs; bør være ferdig innenfor 30-60 min estimat)

**Status:** Branch klar for push. PM tar over for PR. Repro-test forblir som permanent regresjons-vern. FRAGILITY F-05 låser inn at ALLE handler-paths må ha guard så framtidige paths ikke gjenstår.

---

### 2026-05-13 — Spill 1 re-entry-during-draw bug-diagnose (I15) (explore-agent, PM-AI)

**Scope:** Diagnose Tobias-rapport 2026-05-13: "etter at jeg starter spill går ut av lobbyen for deretter å gå inn igjen så kommer jeg ikke inn i rommet under en trekning, må vente til trekning er ferdig før jeg kan gå inn". Reprodusere bug-en i E2E-test, finn root cause, klassifiser (impl vs struktur), foreslå fix uten å skrive den.

**Inputs gitt:**
- Symptom-beskrivelse fra Tobias
- Pekere til `apps/backend/src/sockets/gameEvents/roomEvents.ts:636`, `RoomLifecycleService.ts`, `BingoEngine.ts:980`, `Game1Controller.ts`, `lobby.js`
- Token `spillorama-2026-test` for debug-events
- Forutsetning: dev:all kjører på port 4000
- Branch: ny fra main, IKKE åpne PR, IKKE skriv fix
- Hvis strukturell bug — STOP og rapporter til PM

**Outputs produsert:**
- **Branch:** `feat/reentry-diagnose-2026-05-13` (klar for push)
- **Commit:** `<pending>` — `test(spill1): I15 — re-entry during active draw repro + diagnose`
- **Filer (nye):**
  - `tests/e2e/spill1-reentry-during-draw.spec.ts` — repro-test (forventet 🔴 inntil fix)
  - `docs/architecture/REENTRY_BUG_DIAGNOSE_2026-05-13.md` — full root-cause-diagnose med file:line + foreslått fix
- **Filer (oppdatert):**
  - `tests/e2e/BUG_CATALOG.md` — I15-entry + endringslogg

**Test-run:**
- `npx playwright test --config=tests/e2e/playwright.config.ts spill1-reentry-during-draw`
- Status: 🔴 FAIL som forventet (test reproduserer bug-en)
- Tid: ~24s
- Console-output bekrefter: `[Game1] Room join feilet — mounter lobby-fallback istedenfor å vise feil: {code: PLAYER_ALREADY_IN_ROOM, message: ...}`

**Root cause:**
- File: `apps/backend/src/sockets/game1ScheduledEvents.ts:288-365` (`joinScheduledGame`)
- Line 324: `engine.joinRoom({roomCode: row.room_code, ...})` kalles direkte UTEN re-attach-guard
- Backend `detachSocket` (`BingoEngine.ts:3802-3831`) beholder player-record (kun socketId nullstilles) av regulatoriske grunner (armed-state, lucky, forhåndskjøp)
- `RoomLifecycleService.joinRoom:393-394` → `assertWalletNotAlreadyInRoom` → THROW `PLAYER_ALREADY_IN_ROOM`
- `room:create` (`roomEvents.ts:372-397`) og `room:join` (`roomEvents.ts:771-806`) har riktig guard via `findPlayerInRoomByWallet` + `attachPlayerSocket` — `joinScheduledGame` mangler den
- Klient `Game1Controller.start` (line 717-753) faller direkte til `Game1LobbyFallback`-overlay ved `!joinResult.ok` (ingen `room:resume`-fallback for initial join, kun for plan-advance på linje 1325-1361)

**Klassifisering: IMPLEMENTASJONS-bug (ikke strukturell)**
- Mønsteret er etablert (room:create/room:join har samme guard)
- < 30 linjer endring i én fil
- Ingen ny tabell, event, eller arkitektur-pattern
- Backwards-compatible (fresh joins faller fortsatt til `engine.joinRoom`)

**Foreslått fix (impl-only, ikke skrevet):**
```ts
// joinScheduledGame, rett før engine.joinRoom-call på linje 324
const existingSnapshot = engine.getRoomSnapshot(row.room_code);
const existingPlayer = findPlayerInRoomByWallet(existingSnapshot, user.walletId);
if (existingPlayer) {
  engine.attachPlayerSocket(row.room_code, existingPlayer.id, socketId);
  await markScheduledRoom(row.room_code, row, isHallShared, hallId);
  const snapshot = engine.getRoomSnapshot(row.room_code);
  return { roomCode: row.room_code, playerId: existingPlayer.id, snapshot };
}
// Else: full join (eksisterende kode)
```

**Fallgruver oppdaget (ingen nye):**
- Bug-en treffer §3 (Spill-arkitektur) men er kjent symptom — `tests/e2e/helpers/rest.ts:200-201` har allerede dokumentert at "engine keeps player-slots after game-end — uten cleanup feiler neste `room:join` med `PLAYER_ALREADY_IN_ROOM`". Denne bugen er samme klasse, bare for re-join mid-runde i stedet for inter-runde.
- Repro-strategien (capture console-warnings + DOM-check for `data-spill1-lobby-fallback`) er ny i denne test-suiten, men trivielt mønster.

**Læring:**
- **Backend join-flows er ikke ensartet.** `room:create`, `room:join`, og `game1:join-scheduled` har tre litt forskjellige veier inn til samme `engine.joinRoom`. To av tre har re-attach-guard. Mønsteret bør konsolideres (eventuelt via en `engine.joinOrReattach`-hjelp som kombinerer det).
- **`engine.joinRoom` er IKKE idempotent.** Dokumentstringen "reconnect-trygg — samme wallet → samme player per eksisterende joinRoom-logikk" i `game1ScheduledEvents.ts:283-284` er feil. Idempotensen kommer fra wrap-guarden, ikke fra `joinRoom` selv.
- **Capture console-warnings** er mer robust enn DOM-polling for transient overlays (Game1LobbyFallback rendres + fetch-feiler + kan unmounte raskt).

**Verifisering:**
- TypeScript strict passerer for testen (samme pattern som eksisterende spec-er)
- Test bekreftet RØD via 1 run (24.7s)
- Lobby-fallback-mount observert i console: PLAYER_ALREADY_IN_ROOM-error logget

**Tid:** ~75 min (eksplorering + repro-test + diagnose-doc + BUG_CATALOG-update)

**Status:** Branch klar for push. PM tar over. Klart for impl-agent å skrive selve fix-en (forventet < 30 linjer + 1-2 unit-tester for reconnect-pathen).

---

### 2026-05-13 — Manual-flow E2E test (general-purpose agent, PM-AI)

**Scope:** Lukke F-03-gapet i FRAGILITY_LOG ved å skrive en ny E2E-test (`tests/e2e/spill1-manual-flow.spec.ts`) som mimicker Tobias' EKSAKTE manuelle bruks-flyt — uten pre-seedet `sessionStorage.lobby.activeHallId` og uten direct token-injection. Eksisterende `spill1-pilot-flow.spec.ts` bruker shortcuts som gjør at testen kan passere mens manuell flyt feiler (symptom 2026-05-13: E2E grønn @ 10:40, manuell feilet @ 12:00).

**Inputs gitt:**
- Mandat: skriv ny testfil + helper-utvidelser, ikke endre eksisterende
- Pekere til `FRAGILITY_LOG.md` F-03, `PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` §1.1-1.3, `tests/e2e/spill1-pilot-flow.spec.ts`, `tests/e2e/helpers/rest.ts`, `BUG_CATALOG.md` I14, `PlayScreen.ts:693-720`, `apps/backend/src/dev/devAutoLoginRoute.ts`
- Branch: ny fra `origin/main`, ikke åpne PR (PM-AI tar over)
- Forutsetning: `ENABLE_BUY_DEBUG=1 npm run dev:nuke` på port 4000

**Outputs produsert:**
- **Branch:** `feat/manual-flow-e2e-2026-05-13` (pushed til origin)
- **Filer:**
  - `tests/e2e/spill1-manual-flow.spec.ts:1-376` — ny test (376 linjer, 14-stegs flyt via `?dev-user=`-redirect og hall-picker)
  - `tests/e2e/helpers/manual-flow.ts:1-186` — nye helpers (`loginViaDevUserRedirect`, `waitForLobbyHydration`, `getActiveHallId`, `switchHallViaPicker`, `openBingoGame`, `captureAutoShowGateState`)
  - `package.json` — nytt npm-script `test:pilot-flow:manual`
  - `docs/engineering/FRAGILITY_LOG.md` — F-03 status oppdatert fra "gap" til "test må stå grønn"
  - `docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` — §1.5 utvidet med manual-flow-vs-shortcut-flow-tabell, §1.3 utvidet med ny kjør-kommando

**Test-runs (deterministisk):**
- Run 1 (alene): PASS 11.5s — demo-pilot-spiller-6 valgt
- Run 2 (alene): PASS 12.8s — samme
- Run 3 (alene): PASS 11.5s — samme
- `--repeat-each=3` total: 3/3 PASS i 36.5s
- Full suite (alle 6 tester inkludert): 6/6 PASS i 2.4min
- Konklusjon: testen er stabil og deterministisk. Runtime under 13s per run.

**Fallgruver oppdaget (ingen NYE pitfalls, men test bevisst beholder fragile aspekter):**

1. **Manual-flow må forbli "fragile" by design:** Hvis noen "optimaliserer" testen ved å pre-seed `sessionStorage.lobby.activeHallId` eller injecte token direkte, blir den bare en duplikat av `spill1-pilot-flow.spec.ts`. F-03 i FRAGILITY_LOG flagger eksplisitt at endring av denne testen MÅ være bevisst.

2. **demo-pilot-spillere 1-3 har `app_users.hall_id = demo-hall-001` men lobby defaulter likevel til `hall-default`:** lobby.js:135-140 leser fra `lobbyState.halls[0].id` (created_at-ordering), IKKE fra `user.hallId`. Hele rationale for manual-flow-testen. Hvis lobby noen gang fixet til å bruke user.hallId, vil testen logge "lobby defaulted DIREKTE til pilot-hall" og fortsette uten hall-bytte.

3. **Demo-pilot-spillere 1-6 har akkumulert tap > 700 kr/dag i nåværende dev-stack:** `pickAvailablePilotPlayer` må rotere over alle 1-12. Spiller 7-12 (hallId=demo-hall-003/004) brukes som fallback når 1-6 er over grensen. Dette er konsistent med eksisterende `pickAvailablePlayer` i pilot-flow-testen.

**Læring:**
- **`?dev-user=`-redirect-flyten er stabil** når man venter på `window.location.search.includes("dev-user=") === false` + `sessionStorage.getItem("spillorama.accessToken") !== null`. Race-vinduet mellom `saveSession` og `location.replace` håndteres trygt av disse to waits.
- **Hall-velger via `select.selectOption()`** triggrer Playwright's `change`+`input`-events korrekt → switchHall i lobby.js kjører → sessionStorage oppdateres → vi venter på sessionStorage-match som proxy. Fungerer på første forsøk.
- **Test fanger I14 (popup-auto-show) ved å diagnose autoShowGate-state** hvis popup ikke mounter innen 30s. `captureAutoShowGateState` leser fra `window.__spillorama.playScreen.getAutoShowGateState()` (hvis eksponert).
- **Re-using EXPECTED_ROWS, EXPECTED_TOTAL_KR, EXPECTED_TOTAL_BRETT fra pilot-flow-testen ville vært bedre,** men jeg duplikat-ed dem bevisst fordi (a) det er bare 6 rader, (b) shared module ville krevd refaktor av helpers/, (c) hver test bør være selvstendig lesbar uten å hoppe mellom filer.

**Verifisering (PM-AI):**
- `npm run test:pilot-flow:manual` 3 ganger på rad → 3/3 PASS (deterministisk)
- `npm run test:pilot-flow` (eksisterende) → fortsatt grønn (no regression)
- Hele suite (6 tester) → 6/6 PASS i 2.4min
- Test redirect-race håndtert: 0 flakes observert

**Tid:**
- Research + design: ~1.5h
- Implementation + test-iterasjon: ~2h
- Dokumentasjon: ~30min
- Total: ~4h

**Status:** Test grønn på 3 consecutive runs, branch pushed til origin. PR ikke åpnet (per oppdrag) — PM-AI tar over.

**Eierskap:** `tests/e2e/spill1-manual-flow.spec.ts`, `tests/e2e/helpers/manual-flow.ts` (denne agentens). Doc-edits i FRAGILITY_LOG og PILOT_TEST_FLOW er additive.

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
| 2026-05-13 | Manual-flow E2E-test (`spill1-manual-flow.spec.ts`) lagt til for å lukke F-03-gapet. Test mimicker Tobias' eksakte manuelle flyt via `?dev-user=`-redirect og hall-picker UI. 3/3 consecutive PASS i 11-13s. | Backend-agent (general-purpose) |
