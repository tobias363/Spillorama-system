# PM-handoff — 2026-04-23 kveld

Skrevet av PM-agent #2 etter takeover fra PM-agent #1 som måtte avslutte uten handoff.

**Målgruppe:** neste PM-agent (deg) som tar over morgen/dag 2026-04-24.

**TL;DR:** Vi er midt i Fase 1 MVP — 21 moduler mappet mot legacy, 11 ferdig, 10 igjen. Største gjenstående blokk er Agent-/bingovert-portalen (8 av 10 resterende moduler). Alle arkitekturvalg er tatt og dokumentert. Ingen åpne tekniske beslutninger stopper videre arbeid.

---

## 1. Master-dokumentet du må lese først

[`docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`](../architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md)

Dette er kartleggingen av legacy-funksjonalitet (fra 18 wireframe-PDF-er 2023–2025) vs. nåværende kode. Alt annet i denne handoffen refererer tilbake dit. §4 "Prioritert execution-plan" er Fase 1 MVP-listen — **den er vår nåværende to-do**.

Kjernekonklusjonen fra dokumentet: legacy består av **to sammenvevde systemer** — Admin-panel (~70% bygget) og Agent-/bingovert-portal (~5% bygget før i dag). Uten Agent-portalen kan ikke bingoverten drive en hall. Dette er pilot-hovedblokkeren.

---

## 2. Status ved handoff (2026-04-23 kveld)

### PR-er merget til main i dag (11 stk)

| PR | Modul | MVP-nr |
|---|---|---|
| #401 | Stacked modals + gameMgmt banner + dashboard 400-silencing (UX-polish) | — |
| #402 | GameManagement DailySchedule-tabell + 2 action-knapper (1:1 legacy) | Admin 1 |
| #403 | 1:1 legacy mapping-rapport (selve master-dokumentet) | — |
| #404 | Rejected-listing m/reason + Delete (Approve/Reject Player-flyt) | Admin 1 |
| #405 | Report Management Game 1 — OMS/UTD/Payout%/Res | Admin 3 |
| #406 | Hall Number-felt + Add Money-popup (cash-balanse) | Admin 2 |
| #407 | Schedule: 9 ticket-farger + Mystery Game sub-game type | Admin/Schedule |
| #408 | S1c BingoEngine dead-methods cleanup (refactor) | — |
| #409 | Role Management Agent Permission Table (15 moduler × 5 actions) | Admin/Role |
| #410 | Agent-portal skjelett med role-based redirect + 7 placeholder-sider | Agent 6 |
| #411 | TV Screen + Winners public display med hall-token | Public 15 |

### Åpne PR-er

Ingen. Alle PR-er fra dag 1 er merget til main.

### Worktrees som kan ryddes (etter bekreftet merge)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system
git worktree remove .claude/worktrees/approve-reject-players      # #404 merget
git worktree remove .claude/worktrees/hall-number-add-money       # #406 merget
git worktree remove .claude/worktrees/report-mgmt-game1           # #405 merget
git worktree remove .claude/worktrees/schedule-8-colors           # #407 merget
git worktree remove .claude/worktrees/agent-portal-skeleton       # #410 merget
git worktree remove .claude/worktrees/game-mgmt-schedules         # #402 merget
git worktree remove .claude/worktrees/admin-ux-fixes              # #401 merget
git worktree remove .claude/worktrees/schedule-subgames-editor    # #400 merget
git worktree remove .claude/worktrees/s4b-draw-helpers            # #395 merget
git worktree remove .claude/worktrees/s-loyalty                   # #397 merget
git worktree remove .claude/worktrees/s-compliance-mgr            # #398 merget
git worktree remove .claude/worktrees/pedantic-shockley-75b81c    # #408 merget (S1c)
git worktree remove .claude/worktrees/r3-split-schemas            # sjekk status før sletting
# role-management og tv-screen er allerede ryddet av PM #2.
```

Verifiser alltid at branchen er merget til main før sletting:
```bash
git -C .claude/worktrees/<name> log --oneline main..HEAD   # tom = trygt å slette
```

---

## 3. Arkitekturbeslutninger som er tatt (alle bekreftet av Tobias)

Disse er endelige og skal ikke diskuteres på nytt med mindre noe blokkerer implementasjonen.

| # | Beslutning | Bekreftet |
|---|---|---|
| 1 | **Route tree B** — Agent-portal er ny subtree `/agent/*` i `apps/admin-web`, ikke separat app | ✅ Tobias 2026-04-23 |
| 2 | **TV Screen auth = hall-token i URL** (`/admin/#/tv/:hallId/:tvToken`) | ✅ Tobias 2026-04-23 |
| 3 | **Ticket colors: utvid til alle 9** (Yellow/White/Purple Small+Large + Red/Green/Blue + Mystery) | ✅ Tobias 2026-04-23 — implementert i #407 |
| 4 | **Bot Game: skippet fra Fase 1** (kan komme i Fase 3) | ✅ Tobias 2026-04-23 |
| 5 | **Import Player: engangs-migrering** når Tobias deler Excel-sheetet med ~6000 spillere | ✅ Tobias 2026-04-23 |
| 6 | **Settlement: alle 4 maskiner (Metronia/OK Bingo/Franco/Otium) manuelt for pilot**; API-integrasjon senere | ✅ Tobias 2026-04-23 |
| 7 | **Norsk Tipping / Rikstoto: manuell innlegging**, ikke API | ✅ Tobias 2026-04-23 |
| 8 | **Role Management 1:1 legacy-matrise** — 15 moduler × 5 actions (Create/Edit/View/Delete/Block-Unblock) | ✅ Tobias 2026-04-23 — implementert i #409 |
| 9 | **Screen Saver vises på TV-skjerm + dedikerte terminaler** i hallen når inaktiv | ✅ Tobias 2026-04-23 |

---

## 4. Åpne tråder — ting som venter

### 4.1 Fra Tobias (brukeren)

- **Excel-sheet med ~6000 spillere** for migrering. Tobias skulle dele sheetet. Når det er her: kjør engangs-migrering (script som kjøres på prod og fjernes). Ikke bygg permanent Excel-import enda — det er Fase 2.

- **Chrome-session for legacy backend-verifisering:** Tobias var logget inn i `spillorama.aistechnolabs.info` for å la forrige PM verifisere Spill 1 schedule 1:1. Forrige PM traff bilde-dimensjon-feil (2000px-grense) før informasjonen kunne hentes ut. Hvis du trenger dette — be Tobias logge inn på nytt og bruk `chrome-devtools-mcp`-tools (ikke computer-use — se memory/debug_preference.md). Ta små screenshots eller les tekst direkte med `take_snapshot` for å unngå dimensjon-feil.

### 4.2 Åpne spørsmål fra agent-leveranser

Fra Agent 1 (#404 Approve/Reject) — Tobias har ikke svart ennå:

1. **Manglende felter i DB** — Nickname / Bank Acc. / Group Hall / High Risk / PEP er i wireframe men ikke i DB-skjema. Separat PR i Fase 2?
2. **Delete = soft-delete** (setter `deleted_at`, beholder rad). Anbefalt ift. §11 pengespillforskriften (5 år retention). Bekreft med Tobias om ønsket.
3. **"Rejected by" viser actor-ID** (`admin-1`), ikke navn. Polishes i neste iterasjon.
4. **Reason-validering** — backend krever kun "ikke-tom". Ønsker Tobias strengere validering (min 3 chars)?

### 4.3 Teknisk gjeld flagget av chip

- **Flaky Colordraft-test** i packages (1/64 sjanse for å feile). Chip spawnet i forrige sesjon — Tobias kan trigge egen sesjon for å fikse.

---

## 5. Fase 1 MVP — hva som gjenstår

Fra [§4 i mapping-dokumentet](../architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md). Vi har levert 10 av 21 moduler. **11 igjen** (merk: original plan var ~20 PR-er, noen modul-nr er slått sammen).

### Admin-panel (2 igjen)

- **4. Hall Account Report + Settlement Report** (regnskap-drift — stor modul, 2 PR-er)
- **5. Withdraw in Hall / Bank + Add email account + XML-eksport** (regnskap-email per hall, 1 PR)

### Agent-portal (9 igjen — største gjenstående arbeid)

Skjelettet (#410) er på plass med `/agent/*`-routes og role-based redirect. Nå skal innholdet fylles inn:

- **7. Cash In/Out Management-panel** (Agent Name, Total Cash Balance, 6 action-knapper)
- **8. Add Daily Balance + Control Daily Balance + Settlement** (2 PR-er — settlement er regulatorisk kritisk, se §5.5 i mapping-dok)
- **9. Unique ID: Create / Add Money / Withdraw / List / Details** (2 PR-er)
- **10. Add Money / Withdraw — Registered User** (1 PR)
- **11. Register More Tickets + Register Sold Tickets** (scan-integrasjon, 2 PR-er, 9 farger)
- **12. Next Game panel: Start + PAUSE + Resume + Ready/Not Ready** (1 PR)
- **13. Check for Bingo + Physical Cashout** (Reward All, Cashout/Rewarded-status, 2 PR-er)
- **14. Shift Log Out-flyt** (distribute winnings checkbox + transfer tickets, 1 PR)

### Spiller-frontend (3 igjen)

- **16. Mystery Game-runtime** (10-bucket spin wheel, 10s timer, color-multiplier)
- **17. Points skjul + Landing Open/Start@HH:MM/Closed**
- **18. Profile Settings Language toggle / Block myself for / Set Limit (monthly)**

**Estimat:** ~15 PR-er. Kan parallelliseres i bølger à 3-4 agenter — se §8 under for hvordan.

---

## 6. Viktige policies (ikke-forhandlingsbart)

Dette er feedback brukeren har gitt tidligere. Finnes også i memory:

1. **PM-sentralisert git-flyt** (`feedback_git_flow.md`) — agenter committer og pusher feature-branch, PM eier `gh pr create` + merge. Agenter rapporterer som `"Agent N — [scope]:"` med branch-navn, commits, test-status.
2. **Done-policy** (`feedback_done_policy.md`) — Linear-issues kan bare lukkes når commit er **merget til main** (ikke bare feature-branch) + file:line-bevis + grønn test i CI. Vedtatt etter falske Done-funn.
3. **Spill 1 først før generalisering** (`feedback_spill1_scope_first.md`) — fullfør Spill 1 komplett før abstraksjoner mot Spill 2/3. YAGNI.
4. **Chrome-devtools-mcp for browser-debug** (`debug_preference.md`) — aldri computer-use for browser-oppgaver. Konsollogger/screenshots/JS-eval/network.
5. **Unity-paritet kun for funksjonell logikk** (`project_unity_parity_rule.md`) — visuell polish er web-teams valg med dokumentert avvik.

---

## 7. Repo-struktur (1 år ferskt — kanonisk)

```
apps/
  backend/       — Node/TS backend (deploys til Render)
  admin-web/     — admin UI + NÅVÆRENDE agent-UI som subtree /agent/*
packages/
  game-client/   — Pixi.js spiller-klient
  shared-types/  — delte typer + Zod wire-kontrakt
legacy/
  unity-client/  — Unity-prosjektet (utfases)
  unity-backend/ — legacy Node (utfases)
docs/
  architecture/  — 1:1-mapping, design-docs, variantkatalog
  engineering/   — parity audits, workflows, endpoint-matriser
  operations/    — runbooks, cutover, rollback, DENNE HANDOFFEN
```

Full beskrivelse i memory/`project_repo_structure.md`.

---

## 8. Hvordan orchestrere neste bølge

Forrige PM kjørte parallelle agent-bølger på 3-4 agenter. Det fungerte bra da hver agent fikk isolert scope og egen worktree. Hver bølge tok typisk 20-40 min + 5-10 min for merge.

### Oppskrift

1. **Velg 3-4 moduler med minimal overlapp** (f.eks. ikke 3 agenter som alle endrer samme service-fil).
2. **Spawn med `Agent`-tool, subagent_type=general-purpose**, `run_in_background: true`. Én tool-call med alle i samme melding → de kjører i parallell.
3. **Prompt til agent:**
   - Scope (hva som skal bygges, 1:1 mot wireframe-PDF-referanse)
   - Branch-navn (f.eks. `feat/agent-cash-in-out`)
   - Worktree-sti (lag ny eller bruk slot-1/2/3)
   - Git-regler (commit+push, ikke merge/PR — PM eier det)
   - Co-Authored-By-linje
   - Forventet leveranse-format (`"Agent N — [scope]:"` med branch, commits, tester, avvik)
4. **Vent på bakgrunns-varsler.** Ikke poll. ScheduleWakeup ~5 min hvis du må fortsette CI-sjekk på eksisterende PR-er mens agentene jobber.
5. **Når agent leverer:** åpne PR, rebase om BEHIND, merge når CI er grønn.

### API-limit-advarsel

Forrige PM traff API-limit (Opus 4.7 limit, reset 19:00 Oslo) midt i bølge 2. Tre agenter ble avbrutt uten output og måtte re-spawnes. **Mitigeringsoppskrift:** hvis du ser "API limit" i agent-svar, vent til reset og re-spawn med identisk prompt. Agent-worktrees er re-entrant safe så lenge branchen ikke allerede finnes.

---

## 9. Referansepeker

**Kode:**
- Backend: `apps/backend/src/`
- Admin-web (inkl. agent-routes): `apps/admin-web/src/`
- Agent-portal placeholder-sider: `apps/admin-web/src/pages/agent/`
- TV Screen-route: `apps/admin-web/src/pages/tv/`
- Spiller-klient: `packages/game-client/src/`

**Dokumentasjon:**
- Master: `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`
- Agent workflow: `docs/engineering/WORKFLOW_AGENTS.md`
- Engineering workflow: `docs/engineering/ENGINEERING_WORKFLOW.md`
- Pilot runbook: `docs/operations/HALL_PILOT_RUNBOOK.md`
- Pilot cutover: `docs/operations/PILOT_CUTOVER_RUNBOOK.md`

**Wireframe-PDF-er:** tidligere utviklerteam sine 18 stk, listet i §1 av mapping-dokumentet. Tobias har lokalkopier. Be om dem hvis du trenger 1:1-verifikasjon.

**Linear:**
- Team: `BIN` (Bingosystem)
- Aktive prosjekter:
  - "Legacy-avkobling: Game 1–5 + backend-paritet" — Urgent, pågår
  - "Spill 1 — Full variant-katalog (post-pilot)" — Medium, 13 post-pilot varianter
  - "AIS-fjerning — Komplett migrering til Spillorama" — High, Unity-koblinger fjernes

**Memory (persistent, auto-loaded):**
`/Users/tobiashaugen/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/`

**Brukerens rolle:** Tobias Haugen, teknisk lead. E-post `tobias@nordicprofil.no`. Norsktalende.

---

## 10. Åpne trådene — hva jeg (PM #2) anbefaler som første oppgave dag 2

1. ~~Verifiser #409 merge~~ — DONE av PM #2 kl. 18:12 2026-04-23.
2. **Rydd worktrees** (se §2 over — 12 stk kan fjernes).
3. **Spør Tobias om Excel-sheetet** (§4.1). Uten det kan ikke player-migrering kjøres.
4. **Spør Tobias om Agent 1-svarene** (§4.2 — de 4 oppklaringene om Approve/Reject).
5. **Start bølge 3 — Agent-portal innhold:** mest verdi i å parallellisere 3-4 av modulene 7-14. Foreslåtte bølger:
   - Bølge 3A: *Cash In/Out-panel* + *Add Daily Balance* + *Unique ID-create-flyt* + *Withdraw Registered User* (4 moduler, minst overlapp)
   - Bølge 3B: *Next Game-panel* + *Register More/Sold Tickets* + *Check for Bingo / Physical Cashout* + *Shift Log Out* (4 moduler, overlapper med spill-runtime — koordiner scope-grenser tydelig)
   - Bølge 3C: *Settlement* (alene — regulatorisk kritisk, ikke parallelliser)

6. **Gjenta Chrome-verifisering hvis Tobias ønsker det** — dette var åpent da forrige PM ga seg.

---

**Skrevet 2026-04-23 kveld av PM-agent #2 (Claude Opus 4.7, 1M context).**
**Neste oppdatering:** når #409 er merget + Fase 1 nærmer seg komplett.
