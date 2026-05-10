# Agent Execution Log — kronologisk agent-arbeid

**Status:** Autoritativ. Alle agent-leveranser dokumenteres her.
**Sist oppdatert:** 2026-05-10
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

### 2026-05-10 18:10 — `aa8a2cf0f2c0495ab` (general-purpose, JackpotSetupModal wireup)

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
