# Pilot-test-flyt og kunnskapsprotokoll

**Status:** Autoritativ. Skal være lese-først-i-sesjon for ALLE PM/agenter som rører pilot-relatert kode (Spill 1/2/3, master-flow, buy-popup, ticket-grid, payout).
**Sist oppdatert:** 2026-05-13
**Eier:** Tobias Haugen (teknisk lead)
**Vedlikehold:** Hver PM oppdaterer dette dokumentet ved sesjons-slutt — på linje med PM_HANDOFF og BACKLOG.

> "Det er nøkkelen for at vi skal ha god fremgang her. Vi må tilegne oss kunnskap og dokumentere slik at denne kunnskapen ikke er tapt med ny PM og agenter."
>
> — Tobias 2026-05-13

---

## 0. Hvorfor dette dokumentet eksisterer

**Spillorama tapte 3 dager på buy-flow-iterasjon 2026-05-11 → 2026-05-13** uten å produsere ferdige fixes. Mønsteret var:

1. Tobias rapporterer bug fra manuell test (5 min)
2. PM/agent leser debug-output, gjetter root-cause (10-30 min)
3. Skriver fix, åpner PR, venter på auto-merge + CI (5-15 min)
4. Tobias kjører `dev:nuke`, refresher, tester manuelt (5-10 min)
5. Bug fortsatt der eller en NY bug → tilbake til steg 1

Tilbakekoblings-loop-en var **for treg og for støyende** til å konvergere. Hver iterasjon hadde 30-60 min runtime og maks 1-2 hypoteser kunne testes per dag. Resultat: marginal fremgang, frustrasjon, og Tobias måtte til slutt si:

> "Helt ærlig. Kaster vi bort tid her? Siste 3 dagene har det nesten ikke skjedd noen ting. Vi er nødt til å endre kurs."

**Beslutning 2026-05-13:** Bygg fullverdig E2E-test-infrastruktur FØR vi itererer videre. Investér 1-2 dager i tooling for å spare 5-10 dager på iterasjon.

**Resultat:** 13-sekunds deterministisk test som driver master + spiller + buy-flyt ende-til-ende. 3 nye bugs (I8/I9/I10 i `tests/e2e/BUG_CATALOG.md`) avdekket og fikset av samme autonome agent som bygget infrastrukturen. Iterasjons-hastighet fra **5 min/manual** til **13s/automatic**.

---

## 1. Test-flyten — hva den dekker og hvordan

### 1.1 Arkitektur

```
┌───────────────────────────────────────────────────────────────┐
│  Playwright (chromium 1280×720, headless)                    │
│  tests/e2e/spill1-pilot-flow.spec.ts                          │
│                                                                │
│  ┌──────────────────────┐    ┌──────────────────────┐        │
│  │  REST orkestrering   │    │  UI assertions       │        │
│  │  helpers/rest.ts     │    │  page.locator(...)    │        │
│  │                      │    │                       │        │
│  │  • autoLogin         │    │  data-test="..."      │        │
│  │  • markHallReady     │    │  • buy-popup-*        │        │
│  │  • masterStart       │    │  • ticket-card        │        │
│  │  • resetPilotState   │    │  • ticket-grid        │        │
│  │  • raisePlayerLossLimits                          │        │
│  └──────────┬───────────┘    └──────────┬───────────┘        │
└─────────────┼───────────────────────────┼───────────────────────┘
              │                           │
              │ HTTP                      │ Chromium DOM/socket
              ▼                           ▼
┌───────────────────────────────────────────────────────────────┐
│  Live `dev:all`-stack (port 4000)                             │
│                                                                │
│  Backend (Express + Socket.IO)                                 │
│  ├─ /api/dev/auto-login (token mint)                          │
│  ├─ /api/admin/game1/halls/{hallId}/ready                     │
│  ├─ /api/agent/game1/master/{start,stop,pause,resume}         │
│  ├─ /api/admin/rooms/{code} DELETE (cleanup)                  │
│  └─ /web/ static bundle (game-client)                         │
│                                                                │
│  Postgres + Redis (Docker)                                     │
└───────────────────────────────────────────────────────────────┘
```

### 1.2 14-stegs flyt

1. **REST: Auto-login master** (`demo-agent-1@spillorama.no`) — får token
2. **REST: Auto-login spiller** (`demo-pilot-spiller-{1..12}@example.com`, picker fra pool for å unngå daglig tapsgrense)
3. **REST: Reset pilot state** — `masterStop` + `DELETE /api/admin/rooms/BINGO_DEMO-PILOT-GOH` + `BINGO_DEMO-DEFAULT-GOH`
4. **REST: `markHallReady(demo-hall-001)`** — lazy-spawner scheduled-game (returnerer `gameId`)
5. **REST: `masterStart()`** — verifiserer `status === "running"`, `scheduledGameId` matches
6. **UI: Pre-seed `sessionStorage.lobby.activeHallId = "demo-hall-001"`** så lobby joiner pilot-GoH-rommet (uten dette default-er lobby til `hall-default`)
7. **UI: Direct token injection** — setter session i `localStorage` istedenfor `?dev-user=`-redirect-race (det var bug i forrige iterasjon)
8. **UI: `page.goto('/web/?debug=1')`** — lobby mounter
9. **UI: Klikk `[data-slug="bingo"]`-tile** — game-bundle (Pixi + HTML-overlay) lastes
10. **UI: Verifiser pris-tekst** per bongfarge i popup (`buy-popup-price-<slug>`):
    - `small-white = 5 kr`, `small-yellow = 10 kr`, `small-purple = 15 kr`
    - `large-white = 15 kr`, `large-yellow = 30 kr`, `large-purple = 45 kr`
11. **UI: Klikk + på hver rad** (6 selections, 12 brett, total 120 kr)
12. **UI: Klikk Kjøp** — popup skjules etter success
13. **UI: Verifiser ticket-grid** (`data-test="ticket-card"`, count = brett-antall, korrekte `data-test-ticket-price`-attributter per brett)
14. **UI: Re-åpne popup** + verifiser `cancelBtn` enabled + priser intakte

### 1.3 Kjøre kommandoer

```bash
# Forutsetning: dev:all kjører på port 4000 med ENABLE_BUY_DEBUG=1
cd /Users/tobiashaugen/Projects/Spillorama-system
ENABLE_BUY_DEBUG=1 npm run dev:nuke

# Annen terminal — én kjøring (13s):
npm run test:pilot-flow

# Med UI for steg-for-steg debug:
npm run test:pilot-flow:ui

# Med Playwright-debugger (browser åpen, breakpoints):
npm run test:pilot-flow:debug

# Continuous loop (kjør test hvert 10s med diff-detection):
bash scripts/pilot-test-loop.sh --loop
```

### 1.4 Hva testen fanger

| Bug-type | Hvordan fanget |
|---|---|
| Feil priser (bundle vs per-brett) | Steg 10 + 13 sammenligner mot eksplisitt tabell |
| Popup mounter ikke | Steg 9 + `toBeVisible({timeout:30_000})` |
| Buy-knapp disabled feil | Steg 12 + `toBeEnabled()` |
| Wrong ticket-count etter buy | Steg 13 + `toHaveCount(EXPECTED_TOTAL_BRETT)` |
| Re-open popup feiler | Steg 14 + `cancelBtn`-state-check |
| Wrong ticket-type → price-mapping | Steg 13 + `[data-test-ticket-price="<N>"]` selector |
| Master action SCHEDULED_GAME_TERMINAL | Steg 5 + propageres som test-failure |
| Lobby route til feil hall | Steg 6 pre-seed garanterer rett hall |

### 1.5 Hva testen IKKE dekker enda (B-fase 2c)

- Rad 1 vunnet → Fortsett til Rad 2 (master advance i samme runde)
- Auto-start-bug (runde starter automatisk etter kjøp uten master)
- Multi-spiller-konkurranse om samme pattern
- Wallet-balance pre/post-buy
- Visning av vinner-popup ved Rad-win
- Per-hall opening time (Stengt/Åpen pill)

Disse må legges til i utvidet test-suite. Mal i `tests/e2e/spill1-pilot-flow.spec.ts`-strukturen.

---

## 2. Kunnskapsprotokoll — slik tilegner og bevarer vi læring

### 2.1 De fire kunnskaps-hjul som MÅ snurre per sesjon

Hvert PM-sesjon SKAL produsere oppdateringer i alle fire:

| Hjul | Fil | Hva oppdateres |
|---|---|---|
| **1. Pitfalls** | `docs/engineering/PITFALLS_LOG.md` | Hver gang vi gjør en feil eller oppdager en fallgruve som ikke står der. Format: §-katalogisert, eks: §2.5 "Compliance ledger binder til kjøpe-hall, ikke master-hall". |
| **2. Agent execution** | `docs/engineering/AGENT_EXECUTION_LOG.md` | Hver agent-leveranse: inputs, outputs, hvor lang tid, hva som funket, hva som ikke. Mønster: append-only kronologisk. |
| **3. PM handoff** | `docs/operations/PM_HANDOFF_YYYY-MM-DD.md` | Sesjons-slutt-snapshot for neste PM. Hva er gjort, hva er åpent, hvilke beslutninger er fattet, hva venter. |
| **4. Domain skills** | `.claude/skills/<navn>/SKILL.md` | Når mønsteret er generaliserbart (gjelder flere agenter/services). Eks: `playwright` skill oppdateres med pilot-flow-mønsteret. |

**Disse er IKKE valgfrie.** Tobias-direktiv 2026-05-13:

> "Vi må tilegne oss kunnskap og dokumentere slik at denne kunnskapen ikke er tapt med ny PM og agenter."

PR-template har checkbox for å konfirme at relevante kunnskaps-hjul er oppdatert.

### 2.2 Sannheten om "self-improving skills"

**Skills forbedrer seg ikke automatisk.** De er markdown-filer i `.claude/skills/<name>/SKILL.md`. De forbedres når PM/agent **bevisst skriver** ny lærdom inn i dem.

Mekanismen vi har:
- Skills loadet on-demand av agent
- Skill-innhold injiseres som kontekst når agent starter en oppgave
- Når PM-agent ser at et mønster i en skill mangler/er feil → skriv det inn

Det vi har manglet er **disiplinen som tvinger oppdatering**. Det fikser denne protokollen.

**Hvordan en skill oppdateres etter sesjon:**

```bash
# 1. Identifiser hvilken skill er relevant
ls .claude/skills/

# 2. Rediger SKILL.md med ny seksjon/eksempel
$EDITOR .claude/skills/playwright/SKILL.md

# 3. Commit som del av sesjons-handoff-PR
git add .claude/skills/playwright/SKILL.md
git commit -m "docs(skills): update playwright with pilot-flow E2E pattern"
```

### 2.3 Når oppdatere hva — beslutnings-matrise

| Type læring | Hvor logges |
|---|---|
| "Ikke gjør X — det breaker Y" (anti-pattern) | PITFALLS_LOG §relevant |
| "Når Z skjer, gjør slik" (positive pattern) | Domain skill |
| "Agent N leverte X i Y minutter" (telemetri) | AGENT_EXECUTION_LOG |
| "Beslutning: vi bruker X over Y fordi Z" (ADR-kvalitet) | `docs/adr/NNNN-tittel.md` (ny ADR) |
| "Sesjons-snapshot for handoff" | PM_HANDOFF_YYYY-MM-DD.md |
| "Hvordan kjøre X kommando" | README per modul + skill |
| "Hvilket spill bruker hvilken slug" | SPILLKATALOG.md |
| "Hvordan betaler vi ut premier" | SPILL_REGLER_OG_PAYOUT.md |

### 2.4 Kvalitets-krav til oppdateringer

**Ikke skriv:**
- "Det funket"
- "Jeg fikset bug-en"
- "Hellet å huske"

**Skriv:**
- "Bug: TicketGrid.computePrice matchet `ticket.type` mot legacy `state.ticketTypes` (small_yellow-style) i stedet for lobby-runtime config med (size, color)-modell. Resultat: alle brett viste samme pris (5 kr)."
- "Fix: pass `lobbyTicketConfig.ticketTypes` til TicketGridHtml.setTickets og match på `(name contains color) + (type matches size)`."
- "Hvor: `packages/game-client/src/games/game1/components/TicketGridHtml.ts:142-167`"
- "PR: feat/autonomous-pilot-test-loop-2026-05-13 commit 9aad3063"

**Regel:** Skal kunne reproduseres FRA dokumentet alene. Ingen ekstern kontekst trengs.

---

## 3. Agent-orkestrerings-mønstre som funker

Lærdom fra 2026-05-13-sesjonen:

### 3.1 Autonomous-loop agent for stuck-iterasjon

**Bruk:** Når PM/Tobias-iterasjon stagnerer på en konkret bug, spawn en
`general-purpose` agent med `<<autonomous-loop>>`-sentinel og presis prompt.

**Eksempel som funket** (2026-05-13):
> "Bygg pilot E2E-test-infrastruktur som driver hele Spill 1 buy-flow ende-til-ende. Iterer til testen går grønn. Hvis du finner bugs underveis, fiks dem og dokumenter i `tests/e2e/BUG_CATALOG.md`. Avslutt med komplett rapport."

Agent leverte i én kjøring:
- 14-stegs test som passerer 3 consecutive runs
- 3 nye bugs (I8/I9/I10) avdekket og fikset
- Komplett dokumentasjon (README + BUG_CATALOG)
- Commit + push på `feat/autonomous-pilot-test-loop-2026-05-13`

**Forutsetning:** Agent må ha skriv-tilgang til samme worktree som PM. Bruk `cwd` parameter.

### 3.2 Anti-pattern: parallel agents på samme fil

Hvis 2+ agenter modifiserer samme fil parallelt → cherry-pick conflicts.

**Regel:**
- Maks 1 agent per modul/fil
- PM koordinerer scope eksplisitt i prompts
- Hvis 2 agenter må røre samme fil: serialiser (A først, B etter)

### 3.3 PM-roll under agent-arbeid

PM skal IKKE duplisere agent-arbeid. PM-rollen mens en agent kjører:
- Skriv KOMPLEMENTÆR dokumentasjon (README, ADR, handoff)
- Forbered PR-mal og merge-strategi
- Monitorér agent-output for blokere
- Ta over når agent fullfører — commit, PR, merge

---

## 4. Sjekkliste for hver pilot-sesjon

### Pre-sesjon
- [ ] Les `PM_HANDOFF_<siste-dato>.md`
- [ ] Les `PITFALLS_LOG` §-er for ditt scope
- [ ] Sjekk åpne PR-er på `feat/autonomous-pilot-*` branches
- [ ] Verifiser `npm run dev:nuke` + `npm run test:pilot-flow` → grønn

### Under sesjon
- [ ] Hvis ny bug oppdages — først verifiser at test fanger den, OR utvid testen til å fange
- [ ] Hvis arkitektur-endring — skriv ADR FØR kode
- [ ] Bruk Conventional Commits + Norwegian commit-messages
- [ ] data-test-attributter på alle nye UI-komponenter

### Post-sesjon (OBLIGATORISK — disse må alle krysses av)
- [ ] PITFALLS_LOG oppdatert hvis ny fallgruve oppdaget
- [ ] AGENT_EXECUTION_LOG appended hvis agent ble brukt
- [ ] Domain skill oppdatert hvis generaliserbart mønster
- [ ] PM_HANDOFF_<i-dag>.md skrevet med 1-2 setningers tldr per delivery
- [ ] BACKLOG.md status oppdatert
- [ ] Linear-issues lukket per Done-policy (commit til main + file:line + test)
- [ ] `git status` clean (ingen uncommitted changes igjen)

---

## 5. Tobias' ansvar (det jeg trenger fra deg)

For at protokollen skal fungere trenger jeg dette fra deg:

### 5.1 Disiplin-håndhevelse

**Strict policy:** Hvis PR mergees uten at relevante kunnskaps-hjul er oppdatert, kan vi ikke forvente at neste PM får full kontekst. Forslag:

- **PR-template** utvidet med checkbox-seksjon "Knowledge protocol":
  - [ ] PITFALLS_LOG oppdatert ELLER ingen ny fallgruve
  - [ ] PM_HANDOFF utkast skrevet ELLER ikke sesjons-slutt
  - [ ] Relevant skill oppdatert ELLER ikke generaliserbart
- **Danger.yml-regel** som blokkerer PR hvis pilot-relatert kode er endret uten knowledge-protocol checkbox

**Spørsmål til deg:** Ok å sette opp dette? Tar ~30 min å implementere.

### 5.2 Test-budsjett

For å iterere effektivt trenger vi:

- **Dedikert test-DB** (separat fra demo-state) så `resetPilotState` ikke kræsjer pågående manual test
  - Opsjon A: Annen Postgres-port (5433) for test
  - Opsjon B: Schema-isolasjon (test-schema vs public)
  - Opsjon C: Ignorer, kjør test alltid mot live demo-state

- **CI-runner**: pilot-flow-test kan kjøre på GitHub Actions med Postgres+Redis services. ~3-5 min per PR. Trenger din OK fordi det øker CI-tid.

**Spørsmål til deg:** Hvilken opsjon for test-DB? Pilot CI-gate ja/nei?

### 5.3 Tidsbudsjett før pilot-vurdering

Du sa "siste forsøk vi gjør før jeg må ta en vurdering med min sjef hva som er veien videre". For at jeg skal estimere riktig trenger jeg:

- **Hard deadline:** Når er pilot-vurderings-møtet?
- **Hva regnes som "klart"?** All-greens pipeline, eller manuell sign-off, eller mengde features?
- **Hvor mange dager kan vi investere i test-infra/dokumentasjon før vi ikke har mer tid?**

Foreslår: 1-2 dager til testene dekker Rad-vinst + Fortsett + auto-start. 1 dag til CI-gate. Deretter Tobias gjør manuell flyt-test og rapporterer eventuelle gjenværende bugs som testen ikke fanger. Hver av disse bugs blir egen test FØRST, fix etterpå.

### 5.4 Eskaleringsstier

Hvis vi finner strukturelle bugs (≥ 3 i BUG_CATALOG-strukturell-tabell):

- **Plan C** — arkitektur-rewrite av buy-flow (server pre-rendret ticket-objekter, klient pure render)
- Estimat: 3-5 dager
- Spør deg: er det innenfor budsjett?

Hvis vi finner < 3 strukturelle bugs:
- Plan B er nok — fortsetter med test-driven iterasjon på implementasjons-nivå

### 5.5 Ressurser jeg er villig til å skalere

Hvis du gir grønt lys, kan jeg spawn flere agenter parallelt på:
- Rad-vinst-test (B-fase 2c)
- Auto-start-bug-isolation
- CI-integration
- Wallet-balance-asserts

Hver agent koster claude.ai API-tokens, men ikke mye relativt til 5-10 dagers manual iterasjon.

**Spørsmål til deg:** Grønt lys for opp til 4 parallelle agenter når PR #1305 mergees?

---

## 6. Anti-mønstre — det vi IKKE skal gjøre igjen

Konkrete anti-mønstre fra 3-dagers-tap:

### 6.1 "Bare én rask manuell test til" 
**Symptom:** PM/agent tror neste fix er den siste. Tobias kjører manuelt, ny bug, gjenta.
**Hvorfor feiler:** Manuell loop er 30-60 min, deterministic verifisering mangler, ingen catalog over hva er testet.
**Fix:** ALDRI mer enn 2 manuelle iterasjoner uten å skrive automatisk test som låser oppdagelsen.

### 6.2 Iterer på debug-output uten å skrive test
**Symptom:** Tobias deler `[BUY-DEBUG]`-dump. PM gjetter root-cause. Skriver fix. Bug fortsatt der.
**Hvorfor feiler:** Debug-output viser SYMPTOM, ikke RACE/STATE som forårsaket det. Test isolerer state.
**Fix:** Når en bug ses 2+ ganger, FØRST skriv test som reproduserer, deretter fix.

### 6.3 Parallelle agenter uten scope-koordinering
**Symptom:** 3 agenter rører samme fil parallelt. Cherry-pick conflicts. Arbeid tapt.
**Fix:** PM eier scope-kart. Maks 1 agent per modul. Hvis kollisjon — serialiser.

### 6.4 PR uten knowledge-protocol-oppdatering
**Symptom:** Bug fikset, PR merget, men neste PM ser ikke fixen og prøver samme bug igjen.
**Fix:** PITFALLS_LOG-oppdatering er obligatorisk i PR-template.

### 6.5 Bypass-gate uten dokumentasjon
**Symptom:** `[bypass-pm-gate: emergency]` brukes uten å forklare hvorfor.
**Fix:** Bypass-bruk skal forklare i commit-message + skal aldri brukes til mer enn 1 PR per uke. Bruk indikerer at standard-flyten er broken og må fikses.

---

## 7. Hvordan vite om det funker

Suksess-kriterier for protokollen:

| Metrikk | Mål |
|---|---|
| Tid fra rapport til verifisert fix | < 30 min (var 30-60 min) |
| Bugs fanget av test før prod | ≥ 80% |
| Bugs som re-opener etter "fix" | < 5% (var ~30%) |
| PM-handover-kvalitet | Ny PM klar til kode-handling på < 90 min |
| Skills oppdatert per sesjon | ≥ 1 |
| Antall manuelle Tobias-tester | ≤ 2 per dag |

**Hvis vi ser bedring her i 2 uker, fungerer protokollen.** Hvis ikke — Plan C.

---

## 8. Vedlikehold av dette dokumentet

**Hvem oppdaterer:** Hver PM ved sesjons-slutt eller når nye mønstre oppdages.
**Hvor:** Direkte i `docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` i samme PR som leveransen.

**Endringslogg:**

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — etablert protokoll etter 3-dagers buy-flow-iterasjon. Komplett test-flyt + kunnskapsprotokoll + anti-mønstre + Tobias-asks. | PM-AI (Claude Opus 4.7) |

---

## 9. Quick-reference for ny PM

Hvis du er ny PM som leser dette:

1. **Les §0** for å forstå hvorfor protokollen eksisterer
2. **Les §4** for sjekkliste pre/under/post-sesjon
3. **Les §6** for konkrete anti-mønstre å unngå
4. **Spør Tobias** om åpne `§5`-asks fortsatt gjelder
5. **Kjør `npm run test:pilot-flow`** for å verifisere baseline grønn
6. **Sjekk `tests/e2e/BUG_CATALOG.md`** for aktive funn

Hvis testen feiler — ikke prøv å fikse manuelt. Spawn autonomous-loop-agent etter §3.1-mønsteret.

**Du har all kontekst du trenger.**
