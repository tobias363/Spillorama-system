# PM-handoff — 2026-04-26

**Fra:** PM-agent (Claude Opus 4.7, 1M context)
**Til:** Neste PM
**Bruker:** Tobias Haugen (tobias@nordicprofil.no)

Denne handoff-en gir komplett kontekst for å effektivt fortsette PM-rollen for Spillorama Live Bingo. Les fra topp til bunn — alt er prioritert i lese-rekkefølge for å bygge mental modell.

---

## 1. Executive summary

**Spillorama Live Bingo** er en regulert norsk live-bingo-plattform under pengespillforskriften. Pilot er planlagt om ~6 uker (rundt 2026-06-07) i 23 haller. Tobias er teknisk lead og produkteier; du er PM og koordinator av agent-arbeid.

**Status per 2026-04-26 kveld:**

- **Casino-grade code review** av Spill 1 (518 linjer) og Wallet (540 linjer) gjennomført. 7 CRITICAL pilot-blokkere identifisert; alle 7 fikset i én dag (K2-bølgen).
- **Wallet 2.-vinn-bug** (KRITISK) reprodusert, root-cause identifisert, fikset på 4 timer (PR #553 merget).
- **Casino-grade wallet-roadmap** etablert som Linear-prosjekt med 8 issues (BIN-760 til BIN-767) for Fase 2 hardening + Fase 3 industri-paritet.
- **K1-bølgen** (jackpott, settlement, agent-portal) ferdig.
- **9 PR-er åpnet i dag**, 4 merget, 5 venter auto-merge.

**Pilot-blokkere som gjenstår:**
- 6 PR-er må lande før K2 er offisielt ferdig (auto-merge på, lander naturlig)
- K1-A RBAC follow-up (hall-group-membership-check) — egen oppfølgings-PR
- Saved-game-template apply-to-schedule + save-as-template (Tobias bestilte etter K2)

---

## 2. Aktiv tilstand

### Åpne PR-er (alle med auto-merge på, CI grønn, BEHIND main)

| PR | Tema | Innvirkning | Estimat til merge |
|---|---|---|---|
| [#545](https://github.com/tobias363/Spillorama-system/pull/545) | Mystery v2 — autospill etter 2 min, knapp top-right, responsive | Frontend UX | ~5-15 min |
| [#546](https://github.com/tobias363/Spillorama-system/pull/546) | K1-A jackpott daglig akkumulering | Backend + tester | ~5-15 min |
| [#547](https://github.com/tobias363/Spillorama-system/pull/547) | K1-B settlement maskin-breakdown (1:1 wireframe) | Backend + UI | ~5-15 min |
| [#548](https://github.com/tobias363/Spillorama-system/pull/548) | K1-C agent-portal wire-up | Frontend | ~5-15 min |
| [#550](https://github.com/tobias363/Spillorama-system/pull/550) | K2-A regulatorisk: gameType + ledger + cap | Backend | ~5-15 min |
| [#551](https://github.com/tobias363/Spillorama-system/pull/551) | K2-B atomicity: assertNotScheduled + tx-fixes | Backend | ~5-15 min |

Hvis noen blir stuck i BEHIND/UNSTABLE i mer enn 30 min: kjør `gh pr update-branch <num>` og la auto-merge re-trigge.

### Allerede merget i dag (rekkefølge)

1. #539 — Sort tickets by closeness-to-complete (klient-side)
2. #549 — Lucky-clover firkløver + Spillorama-logo + cache-buster + 100% sentercell
3. #553 — **Wallet 2.-vinn-hotfix (KRITISK)**
4. #552 — Mystery-trigger etter Fullt Hus-dismiss (klient-kø)

### Aktive bakgrunns-agenter / monitorer
- Ingen kjører nå. Monitor `b4n8vax7y` ble stoppet ved handoff.
- ScheduleWakeup `17:16` er fortsatt aktiv (kan ignoreres — den var fallback for merge-progresjon).

### Linear-prosjekter du eier nå

1. **[Wallet Casino-Grade Redesign](https://linear.app/bingosystem/project/wallet-casino-grade-redesign-1fc289395e4b)** — Urgent. 8 issues (BIN-760 til BIN-767). 14-21 dev-dager til full industri-paritet. Tobias har bestilt dette eksplisitt: *"Det er ekstremt viktig at dette alltid funker 100% av tiden — ekte penger og feil kan bli ekstremt kostbart. Vi må undersøke hvordan største casinoene håndterer lommebok og vi må gjøre det samme."*
2. **[Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)** — pågår, sjekk for progress.

---

## 3. Kritiske rapporter (lese-prioritet)

| Dokument | Hva det gir deg |
|---|---|
| [SPILL1_CASINO_GRADE_REVIEW_2026-04-26.md](docs/architecture/SPILL1_CASINO_GRADE_REVIEW_2026-04-26.md) | 518 linjer, 7 CRITICAL identifisert (alle nå fikset). Rangerer Spill 1 vs Pragmatic Play / Evolution. **Les seksjon "Top 10 Action Items" og "Comparison to Casino Industry"**. |
| [WALLET_DEEP_REVIEW_2026-04-26.md](docs/architecture/WALLET_DEEP_REVIEW_2026-04-26.md) | 540 linjer. Root-cause for 2.-vinn-bug + 5 industri-piller mangler. **Les Konklusjon + Roadmap-fasene.** |
| [SPILLKATALOG.md](docs/architecture/SPILLKATALOG.md) | KRITISK: Spill 1-3 = hovedspill (15% til org), SpinnGo = databingo (30%), Candy = ekstern iframe. Korrigerer feil 2026-04-23-spikring. |
| [LEGACY_1_TO_1_MAPPING_2026-04-23.md](docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md) | Master-mapping mot legacy. Pilot-MVP-scope. |
| [MASTER_PLAN_SPILL1_PILOT_2026-04-24.md](docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md) | Pilot-kritisk sti. P0/P1/P2-funn. |
| [WIREFRAME_CATALOG.md](docs/architecture/WIREFRAME_CATALOG.md) | 1760 linjer, 65+ skjermer. Kanonisk UX-spec. |
| [CLAUDE.md](CLAUDE.md) (repo-root) | Tech-stack, konvensjoner, kommandoer. |

---

## 4. Tobias' way of working — KRITISK

Disse er ufravikelige preferanser observert over flere uker. Bryte dem koster tillit.

### 4.1 PM-sentralisert git-flyt
- **Agenter** committer + pusher feature-branches
- **PM** eier `gh pr create` + merge
- Agenter rapporterer som `"Agent N — [scope]:"` med branch, commits, test-status
- Vedtatt 2026-04-21 etter accidental cross-agent-merger

### 4.2 Done-policy (legacy-avkobling)
En issue lukkes KUN når:
1. Commit er **merget til main** (ikke bare PR-åpning)
2. `file:line` evidence i kommentar
3. Test eller grønn CI bekrefter

Vedtatt 2026-04-17 etter 4 falske Done-funn.

### 4.3 Spill 1 først (YAGNI)
Fullfør Spill 1 før generalisering mot Spill 2/3. Tobias vil ikke ha for tidlig abstraksjon.

### 4.4 Skill-loading (lazy)
- LOAD bare når du redigerer kode i den teknologien
- SKIP for PM/orkestrering
- Hver user-prompt får skill-loading-protocol — alltid output skill-decision FØR kode
- Vedtatt 2026-04-25

### 4.5 Browser-debugging
Bruk `chrome-devtools-mcp` (console logs, screenshots, JS eval, network). **Aldri** computer-use for browser-tasks.

### 4.6 Unity-paritet-regel
1:1 paritet med legacy Unity gjelder kun **funksjonell logikk**. Visuell polish er web-teamets valg.

### 4.7 Kommunikasjons-stil
- Norsk feilmeldinger til brukere
- Engelsk for tekniske termer i interne docs
- Tobias svarer kort + direkte. Hold svar konsise.
- Han **avbryter aktivt** hvis noe går galt — ta det som signal, ikke ubehag.

### 4.8 Kvalitets-fokus
Tobias har sagt: *"Det er ekstremt viktig at dette alltid funker 100% av tiden — ekte penger og feil kan bli ekstremt kostbart. Vi må undersøke hvordan største casinoene håndterer X og vi må gjøre det samme."*

Når i tvil: benchmarking mot Pragmatic Play / Evolution / NetEnt / IGT er svaret. Code-reviewer-agenten er din venn for dette.

---

## 5. Pilot-readiness-status

### 5.1 Spill 1 (Hovedspill 1, slug `bingo`, 75-ball 5×5)

**Solid:**
- BingoEngine + Game1DrawEngineService + Game1PayoutService + Game1MasterControlService
- Game1JackpotStateService (PR #466 + #546)
- Mini-game-orchestrator + 4 mini-games (Wheel, Chest, Mystery, ColorDraft)
- Lucky Number Bonus, Innsatsen-pot, Jackpott (akkumulering + utbetaling)
- TransferHallAccess (PR #453)
- Compliance-ledger med korrekt gameType (PR #550 — K2-A)
- Atomic submitClaim + master-control-rollback (PR #551 — K2-B)
- Wallet refresh etter Game1-payout (PR #553 — KRITISK fix)

**Klient:**
- Pixi.js + DOM-overlays (Mystery, WinPopup, WinScreenV2)
- Sort-tickets-by-progress (PR #539)
- Mystery autospill 2-min (PR #545)
- Mystery trigger etter Fullt Hus-dismiss (PR #552)

**Gjenstår etter pilot:**
- Multi-threshold jackpott (50→55→56→57) — P1
- FIFO-rotasjon mini-games — M2+
- Fase 2 wallet-hardening (BIN-760 til BIN-763)
- Fase 3 industri-paritet (BIN-764 til BIN-767)

### 5.2 Agent-portal

PR #548 wired opp resterende ruter (unique-id, physical-cashout, sold-tickets, sidebar-entries). Frontend ferdig MVP.

PR #547 utvidet `AgentSettlement` til full wireframe-paritet (14 maskin-rader + 6 shift-delta-felter + bilag).

**Gjenstår:**
- "Tickets Sold"-kolonne på Add Physical Ticket (TODO i kode)
- Order History agent-side (separat backend + frontend)

### 5.3 Compliance-status

Etter K2-A (PR #550):
- §11-fordeling 15% (hovedspill) korrekt for Spill 1 (var feil 30% før)
- §71-rapporter: pot/lucky/mini-game nå skriver til ComplianceLedger (var manglende)
- 2500 kr single-prize-cap håndhevet på alle payout-paths (var bare på BingoEngine.submitClaim)

### 5.4 Wallet (etter PR #553 hotfix)

**Solid kjerne:**
- Postgres source-of-truth, double-entry, idempotency, wallet-split (deposit + winnings + reserved)
- BIN-693 reservasjoner (pre-round bonger)

**Mangler (Fase 2-3 i Linear-prosjekt):**
- Outbox pattern (BIN-761)
- Autoritativ `wallet:state`-socket-event (BIN-760)
- SERIALIZABLE isolation (BIN-762)
- Nightly reconciliation (BIN-763)
- Hash-chain audit (BIN-764)
- Hot/cold (BIN-765, kan utsettes)
- Multi-currency-readiness (BIN-766)
- Idempotency-key TTL (BIN-767)

---

## 6. Critical files-map

### Backend (`apps/backend/src/`)
- `game/BingoEngine.ts` — 3109 linjer (for stor — refaktor post-pilot)
- `game/Game1DrawEngineService.ts` — 2651 linjer (scheduled-engine)
- `game/Game1PayoutService.ts` — phase-payout (har ledger-write nå etter K2-A)
- `game/Game1TicketPurchaseService.ts` — bonge-kjøp + wallet-debit
- `game/Game1MasterControlService.ts` — admin start/pause/end
- `game/Game1JackpotStateService.ts` — daglig akkumulering
- `game/ledgerGameTypeForSlug.ts` — NY (K2-A): bingo→MAIN_GAME, spillorama→DATABINGO
- `game/minigames/Game1MiniGameOrchestrator.ts` — trigger-rotasjon (FIFO M2+)
- `game/pot/PotEvaluator.ts` — Innsatsen + Jackpott
- `adapters/PostgresWalletAdapter.ts` — wallet-DB (med creditWithClient nå etter K2-B)
- `routes/wallet.ts` — har `Cache-Control: no-store` etter PR #553
- `compliance/ComplianceLedger.ts` — §11/§71

### Game-client (`packages/game-client/src/games/game1/`)
- `Game1Controller.ts` — orchestrator (har miniGame-kø + WinScreenV2-timing nå)
- `bridge/GameBridge.ts` — emit-state (dedup fjernet i PR #553)
- `components/MysteryGameOverlay.ts` — autospill + 2-min countdown
- `components/WinScreenV2.ts` — Fullt Hus-fontene + Tilbake
- `components/WinPopup.ts` — fase 1-4 vinn (Spillorama-logo)
- `components/BingoTicketHtml.ts` — sentercell med Spillorama-logo (100%)
- `logic/MiniGameRouter.ts` — overlay-router
- `logic/SocketActions.ts` — alle wallet-touch-events
- `logic/TicketSortByProgress.ts` — sort by closeness-to-complete

### Admin-web (`apps/admin-web/src/pages/`)
- `agent-portal/*` — agent-portal MVP
- `cash-inout/SettlementBreakdownModal.ts` — 1:1 wireframe-settlement (etter K1-B)

### Shared types (`packages/shared-types/src/`)
- `socket-events.ts` — alle Socket.IO-event-typer
- `spill1-patterns.ts` — pattern-definisjoner

### Config/infra
- `render.yaml` — Render.com Blueprint
- `docker-compose.yml` — local dev
- `apps/backend/openapi.yaml` — API-spec (3.1.0)

---

## 7. Day-1 playbook for ny PM

### Steg 1: Verifiser at de 6 åpne PR-ene har landet
```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
for pr in 545 546 547 548 550 551; do gh pr view $pr --json state,mergedAt -q '"#\(.number) \(.state) \(.mergedAt // "OPEN")"'; done
```

Hvis noen er fortsatt OPEN etter 1 time:
- Sjekk `gh pr checks <num>` for failing checks
- Hvis BEHIND men CI grønn: `gh pr update-branch <num>`
- Hvis konflikt: rebase manuelt + push

### Steg 2: Dra siste main + bygg lokalt
```bash
git checkout main && git pull
npm install
npm --prefix packages/game-client run build
# Sjekk localhost:3000/web/ med backend-dev-server
```

### Steg 3: Les casino-grade-rapportene (sett av 1 time)
Listet i §3 over.

### Steg 4: Prioriter neste arbeid

Foreslått rekkefølge:

**Akutt (denne uken):**
1. **K1-A RBAC follow-up** — hall-group-membership-check for jackpot admin POST. Egen PR, ~1 dev-dag.
2. **Saved-game-template apply-to-schedule + save-as-template** — Tobias bestilte etter K2. ~2 dev-dager. Backend `SavedGameService` finnes allerede; mangler bare apply-til-schedule + save-fra-schedule + admin-UI-knapper.

**Pre-pilot (denne sprinten, 2-3 uker):**
3. **Fase 2 wallet-hardening** (BIN-760 til BIN-763) — 6-9 dev-dager. KRITISK for casino-grade. Tobias har eksplisitt prioritert dette.

**Post-pilot:**
4. **Fase 3 wallet-paritet** (BIN-764 til BIN-767) — 8-12 dev-dager.
5. Code-rapportens HIGH-funn (11 stk fra Spill 1 review).

### Steg 5: Bekreft Tobias' prioritering før du starter

Tobias vil ikke at du gjør valg på tvers av prioritet uten å sjekke først. Send ham listen over og spør "skal vi gjøre A eller B først?" med en kort anbefaling.

---

## 8. Tilbakevendende fallgruver (lært av PM-agent)

1. **IKKE merge PR uten Tobias-go.** Selv "trivielle" PR-er trenger eksplisitt grønt lys. Han har vært PM-eier av all merge-aktivitet siden 2026-04-21.
2. **IKKE skrive store dokumenter uten oppdrag.** Tobias liker korte, direkte svar. Hvis du skriver 500 linjer uoppfordret blir det støy.
3. **Verifiser memory før du baserer beslutninger på det.** Memory kan være utdatert — sjekk koden før du anbefaler basert på minne.
4. **IKKE late som om noe fungerer.** Hvis du ikke faktisk testet i nettleser, si det. Tobias sa eksplisitt: "type checking and test suites verify code correctness, not feature correctness".
5. **Bruk localhost:3000/web/ for live-testing.** Tobias bygger og hard-refresher. Hvis du har endret koden, sørg for at bygd output finnes der.
6. **Dual-engine-bug:** BingoEngine (ad-hoc) vs Game1DrawEngineService (scheduled) eksisterer side-om-side. K2-B la inn `assertNotScheduled`-guards. Aldri rør in-memory state for scheduled rom uten å forstå begge engines.
7. **Wallet-amount er `number` (NOK) i service-laget**, integer-cents kun ved API-grense. Aldri float-arithmetic på cents.

---

## 9. Memory-system

Brukerens memory ligger i `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/` med `MEMORY.md` som indeks. Auto-loaded hver session.

**Eksisterende memory-poster (korte hooks):**
- user_role.md
- debug_preference.md
- feedback_done_policy.md
- feedback_game_docs.md
- feedback_git_flow.md
- feedback_skill_loading.md
- feedback_spill1_scope_first.md
- project_architecture.md
- project_game1_ball_styling.md
- project_pm_handoff_2026_04_23.md
- project_regulatory_requirements.md
- project_repo_structure.md
- project_spillkatalog.md
- project_spillvett_implementation.md
- project_unity_parity_rule.md

**Når du oppdaterer memory:**
- Skriv KORT (én-linje hooks i MEMORY.md, full body i egen fil)
- Inkluder **Why:** og **How to apply:** for feedback/project-typer
- Konverter relative datoer til absolutte når du lagrer

---

## 10. Avgjørelser som krever Tobias-input (åpne)

Disse ligger fortsatt åpne fra K1/K2-arbeidet:

1. **Multi-threshold jackpott** (50→55→56→57) — P1, K1-A scoped det utenfor pilot. Bekreft post-pilot.
2. **CRIT-6 full DB-tx atomicity** på tvers av wallet/compliance/ledger/payoutAudit/rooms/bingoAdapter — krever større refactor. K2-B fikset state-mutasjons-bug men ikke full atomicity. Egen post-pilot task.
3. **CRIT-7 approach** — K2-B valgte #2 (compensating rollback). Kan vurderes om #1 (single tx) ønskes post-pilot.
4. **Bridge-dedup** (PR #553 fjernet det). Hvis defensiv dedup-on-(balance, drawIndex) ønskes senere — del av BIN-761 outbox-pattern.

---

## 11. Kontakt + miljø

- **Tobias** — tobias@nordicprofil.no, GitHub `tobias363`, repo `tobias363/Spillorama-system`
- **Render** — backend deploy, Frankfurt-region
- **Linear team** — Bingosystem (key: BIN)
- **Norsk oversettelse** — Norsk i UI, engelsk i kode/docs/PR-er

### Daglige kommandoer
```bash
# Backend dev
npm run dev

# Frontend (game-client)
npm --prefix packages/game-client run build
# eller
npm run dev:games

# Type-check
npm --prefix apps/backend run check

# Tester
npm --prefix apps/backend run test           # backend (tsx --test)
npm --prefix packages/game-client test       # frontend (vitest)
npm run test:compliance                      # MANDATORY før merge
```

---

## 12. Siste råd

Tobias er en sterk teknisk lead som ikke trenger PM-en til å løse problemer for ham — han trenger en PM som **koordinerer agenter effektivt**, **flagger risiko tidlig**, og **sørger for at vedtatte ting faktisk lander**. Han avbryter aktivt hvis noe er galt — det er ikke kritikk, det er hans måte å holde tempo.

Bruk subagenter for det meste. Kjør parallelt der mulig (worktree-isolation). Verifiser med konkrete tester. Skriv korte, direkte svar.

Lykke til. Sett deg inn i casino-rapportene først — alt annet flyter ut fra dem.

---

*Generert 2026-04-26 av PM-agent (Claude Opus 4.7). Ved spørsmål til denne handoffen: les `docs/architecture/SPILL1_CASINO_GRADE_REVIEW_2026-04-26.md` og `docs/architecture/WALLET_DEEP_REVIEW_2026-04-26.md` først, så `CLAUDE.md` for konvensjoner.*
