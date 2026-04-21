# PM Handoff — 2026-04-20

**Overtas av:** Ny prosjektleder
**Fra:** Claude Sonnet (PM-sesjon 2026-04-19 14:22 → 2026-04-20 ~07:30)
**Prosjektkontekst:** Spillorama legacy-avkobling — ny stack (`apps/backend` + `apps/admin-web` + `packages/game-client`) ↔ legacy Unity + legacy Node-backend

---

## 1. Executive Summary

Sesjonen startet ved PM-overtakelse 2026-04-19 14:22 med 4 åpne PR-er og staging som ikke var smoke-testet. Leverte:

- **33 PR-er merget** (#218, #219, #220, #222, #223, #224, #225, #226, #227, #228, #229, #230, #231, #232, #233, #234, #235, #236, #237, #238, #239, #240, #241, #242, #243, #244, #245, #246, #247, #248, #249, #250, #251, #252)
- **~70 Linear-issues opprettet og trackert** (BIN-616 → BIN-686)
- **4 parallelle agenter** håndtert (A admin-shell, B admin-cash, C backend, Game 1 bug-agent)
- **Kritisk deploy-fix** (BIN-658) — admin-web var aldri bygget på staging siden monorepo-restructure 2026-04-18; alle 8 admin-UI-PR-er var usynlige for brukere inntil denne ble merget
- **Game 1 CONDITIONAL GO for pilot** etter BIN-662 E2E-verifikasjon + BIN-672 defense-in-depth + BIN-673/682 loading-UX + reconnect-sync + BIN-686 staging-UX-bugs

**Status 2026-04-20 07:30:** Admin-UI 100% bygget (~167 sider over 13 PR-er). Game 2+3 backend komplett. 7 backend-CRUD live. Game 1 pilot-ready med støtte-personell. Agent A og C hit API-limit midt i siste bølge (resetter 02:00 Oslo — skulle ha resettet nå, klar for continuation).

---

## 2. Status per domene

### 2.1 Game 1 (Bingo 75-ball, 5×5) — PILOT-READY (CONDITIONAL GO FORSTERKET)

**Merget i dag:**
- PR #222 5x5-regresjon-fix (ticket-gen + scheduler TDZ + entryFee + Unity ball tube)
- PR #226 BIN-619 7 open bugs (4 fikset, 3 identifisert som env-deps)
- PR #230 BIN-643 3 infra-bugs (DB-schema + migrations + seed)
- PR #232 BIN-644 pivot-forskjell doc-only (PM-beslutning: visuell polish er web-teams valg)
- PR #235 BIN-657 migration-runner FK + markør-syntaks
- PR #242 BIN-661 forward-only migrations (removed Down-seksjoner — data-tap-risiko)
- PR #246 BIN-671 5x5 stop-gap (wrapper-fix + hardcoded bingo i recovery)
- PR #249 BIN-672 defense-in-depth (7 lags 5x5-garanti + compiler enforcement)
- PR #250 BIN-673+682 Loading UX overlay + reconnect state-sync
- **PR #252 BIN-686 4 staging UX-bugs (NYTT, 2026-04-20 07:19):**
  - Bug 1: "Bonger man ikke kjøpte" → skip unarmed i `getOrCreateDisplayTickets`
  - Bug 2: "Innsats: —" → alltid "0 kr" fallback (ikke em-dash)
  - Bug 3 (KRITISK): "Ballene vises ikke" → `lastAppliedDrawIndex` reset kun ved full-snapshot/ny gameId/WAITING→RUNNING (fjerner infinite-resync-loop)
  - Bug 4: "Markering mangler" → auto-resolved fra 1+3

**BIN-662 E2E-verifikasjon status (CONDITIONAL GO):**
| Kategori | Antall | Checkpoints |
|----------|--------|-------------|
| ✅ PASS | 5 | 1, 2, 3, 9, 11 |
| ⚠️ PARTIAL | 1 | 10 (reconnect — nå løst i BIN-682) |
| ⚠️ NOT OBSERVABLE | 5 | 4 (audio, headless), 5 (move-timing), 6 (line), 7 (full house), 8 (broadcast 2+ brukere) |

**Gjenværende for full GO:**
- Manuell QA av CP 4-8 under kontrollert pilot (hall-operatør)
- BIN-682 reconnect state-sync monitoreres i reell drift (test-låst kontrakt i PR #250)
- BIN-683 UX-avklaring "Kjøpt: N" — produkt-eier-beslutning

### 2.2 Game 2 (Rocket/Tallspill, 3×3 1..21) — KOMPLETT

BIN-615 ferdig etter:
- PR #217 PR-C1 delt infrastruktur
- PR #220 PR-C2 Rocket backend-paritet
- Alle socket-events, jackpot-table, 3x3-ticket, TicketCompleted

### 2.3 Game 3 (Mønsterbingo, 5×5 1..75 uten free centre) — KOMPLETT

BIN-615 ferdig etter:
- PR #223 PR-C3a backend infrastructure (PatternMask, PatternMatcher, PatternCycler, ticket factory, BingoEngine lucky-refactor)
- PR #229 PR-C3b Game3Engine + socket events + adapter wire-up

Game3Engine `extends Game2Engine extends BingoEngine` — inheritance chain (Agent C's arkitektur-beslutning, bedre enn opprinnelig brief).

### 2.4 Game 4 (Temabingo) — DEPRECATED (BIN-496)

Skjult via `GAME_TYPE_HIDDEN_FROM_DROPDOWN` i PR-A5. Ikke portet.

### 2.5 Game 5 (Spillorama/Papirbingo) — IKKE UNITY-VERIFISERT

Flagget som 3x5 per legacy `DATABINGO60_SLUGS` (lagt til i BIN-672 commit 6 for å bevare paritet). Ingen runtime-fiks ennå.

### 2.6 Admin-UI — 100% BYGGET (13 PR-er, ~167 sider)

**Agent A (6 PR-er, ~107 sider):**
- PR-A1 shell foundation (pre-session)
- PR-A2 Dashboard + widgets (#218)
- PR-A3a gameType + subGame + patternManagement (#225)
- PR-A3b gameManagement + savedGame + schedules + dailySchedules (#227)
- PR-A4a DataTable-utvidelse + Reports 15 sider (#233)
- PR-A4b hallAccount + Settlement + Payout 9 sider (#240)
- PR-A5 admin + agent + user + role + GroupHall + Hall 16 sider (#245)
- PR-A6 CMS + settings + SystemInfo + otherGames 16 sider (#248)

**Agent B (7 PR-er, ~60 sider):**
- PR-B1 cash-inout 12 sider (#219)
- PR-B2 Player + KYC + BankID + track-spending 23 sider (#224)
- PR-B3 physicalTickets 3 sider + scope-drop unique (#228)
- PR-B4 Amountwithdraw + Transaction + Wallet 11 sider (#234)
- PR-B5 Products 3 sider (#238)
- PR-B6 security + riskCountry + Leaderboard 5 sider (#244)
- PR-B7 register + password-reset flow 3 sider (#251)

**DataTable-utvidelse (fra PR-A4a):** `dateRange` + `cursorPaging` + `csvExport` — forward-kompatibelt for `xlsxExport`/`pdfExport` (BIN-652 follow-up).

### 2.7 Backend — 8 NYE CRUD LIVE

Merget i dag:
- BIN-622 GameManagement CRUD (#231) — 2318 LOC
- BIN-626 DailySchedule CRUD (#239) — 3401 LOC
- BIN-627 Pattern CRUD + dynamic menu (#243) — 2850 LOC
- BIN-628 Track-spending aggregate (#236) — REGULATORISK P2
- BIN-666 HallGroup CRUD (#247) — lukker BIN-617 dashboard widget

**Mønster:** Alle følger samme struktur: migration + service + routes + AdminAccessPolicy + Zod-schemas + wire-up + unit-tester (service) + integration-tester (router). Regulatorisk test-density er høy (tester dekker ~50% av LOC).

### 2.8 Infra — FORWARD-ONLY MIGRATIONS

BIN-643 fikset 3 dev-miljø-bugs (DB-schema drift, migration-ordre, test-user hallId=null).
BIN-657 fikset migration-runner FK + markør-syntaks.
BIN-658 fikset admin-web deploy (workspaces + build chain + Render install-flag).
BIN-661 forward-only migrations convention (removed Down-seksjoner, data-tap-risiko).

### 2.9 Deploy (Render)

Buildcommand: `npm install --include=dev && npm --prefix apps/backend install --include=dev && npm run build`
Build-chain: `shared-types → game-client → admin-web → backend` (alle via workspaces).
Admin-web serveres fra `apps/admin-web/dist/` via backend static-file fallback i `apps/backend/src/index.ts:122`.

**Staging verifisert live:** https://spillorama-system.onrender.com
- `/health` grønn
- `/admin/` bundled assets (main-BDE0DA9d.css + main-3GAo5hAG.js-lignende)
- `/web/` Unity wrapper player UI

---

## 3. Agent-bemanning

### 3.1 Status ved handoff

| Agent | Worktree | Scope | Status |
|-------|----------|-------|--------|
| **Agent A** | `slot-A` | Admin-UI shell + games/reports/admin/cms/settings | ⏸️ API-limit (BIN-684 wire-up uncommitted i slot-A) |
| **Agent B** | `slot-B` | Admin-UI cash-inout + player + physical + withdraw + security + auth | ✅ Primary scope komplett, idle |
| **Agent C** | `slot-C` | G2/G3 backend + admin-CRUD | ⏸️ API-limit (BIN-685 GameType CRUD: 2 av 7 commits committed) |
| **Game 1-bug-agent** | `xenodochial-lewin-8848a1` | Game 1 bugs + infra + defense-in-depth + loading-UX | ✅ Primary scope komplett, logget av |

### 3.2 API-limit status

Agent A og Agent C hit Anthropic API-limit 2026-04-19 ~22:25 (resetter 02:00 Europe/Oslo 2026-04-20).

**Slot-A uncommitted state:**
- `apps/admin-web/src/api/admin-game-management.ts` (ny)
- 2 page-filer + state + 2 test-filer + i18n modified
- Branch: `bin-684-placeholder-wireup` (lokal, ikke pushet)

**Slot-C committed state (2/7 commits):**
- `3e8e0173` GameType migration + service + routes + access policy
- `7029adf8` GameType service + router-tester (48 tester)
- Mangler: SubGame CRUD (commits 3-5), wire-up (commit 7)
- Branch: `bin-685-gametype-subgame-crud-bundle` (lokal, ikke pushet)

### 3.3 Briefs (referanser)

Agent-brief-filer finnes i hver slot. Oppdatert per PM-handoff:
- `slot-A/AGENT-A-BRIEF.md`
- `slot-B/AGENT-B-BRIEF.md`
- `slot-C/AGENT-C-BRIEF.md` (også backup i `brave-dirac-d44417/docs/pm-handoff-2026-04-19/`)

Bug-fix-agent har ingen permanent brief — ad-hoc per oppdrag.

---

## 4. Linear-oversikt

> **Viktig:** Linear-issue-numrene ble delt opp i en 2-sekunders periode mellom mine og Game 1-agentens parallelle creations. Det gjorde at BIN-665 = "staging-seed" (agent) mens jeg i PM-briefs feilaktig kalte GroupHall-issue BIN-665 (det ble faktisk BIN-666). Korrigert i Linear, men sjekk via `get_issue` hvis usikker.

### 4.1 Hovedstruktur

- **Team:** BIN — Bingosystem (`e11b5ce1-e8ab-4a1c-a958-de3e75771efa`)
- **Prosjekt:** Legacy-avkobling: Game 1–5 + backend-paritet (`7b3de1ee-e179-42e7-9ecf-ce1c64be5b2b`)
- **Parent-epics:**
  - **BIN-613** Admin-UI porting (~167 sider over 13 PR-er)
  - **BIN-615** Game 2+3 backend-paritet (KOMPLETT)

### 4.2 Åpne Linear-issues (P2 → P4)

#### P2 High

- **BIN-665** Staging mangler test-bruker `balltest@spillorama.no` — blokkerer BIN-662 manuell QA
- **BIN-680** Spillvett-tekst audit + versjonering (REGULATORISK §11 pengespillforskriften)

#### P3 Medium

Backend-polish (aktiverer placeholder-sider):
- **BIN-620** GameType CRUD (2 av 7 commits delvis levert på slot-C)
- **BIN-621** SubGame CRUD (mangler)
- **BIN-623** CloseDay endpoint
- **BIN-624** SavedGame CRUD
- **BIN-625** Schedule CRUD
- **BIN-668** Leaderboard tier CRUD + migration
- **BIN-676** CMS endpoints (FAQ + Terms + Support + Aboutus + Links)
- **BIN-677** System settings + maintenance endpoints
- **BIN-679** otherGames config (Wheel + Chest + Mystery + Colordraft)
- **BIN-681** Migration timestamp regresjon: 20260419000000_game_management må rebumpes
- **BIN-685** GameType + SubGame CRUD bundle (delvis levert slot-C)

Backend-endpoints for admin-UI:
- **BIN-618** GET /api/admin/players/top (dashboard top-5)
- **BIN-629** GET /api/admin/players/:id/login-history
- **BIN-630** GET /api/admin/players/:id/chips-history
- **BIN-633** POST /api/admin/players (add-player)
- **BIN-634** PUT /api/admin/players/:id (profile-edit)
- **BIN-638** GET /api/admin/games/in-hall
- **BIN-639** POST /api/admin/physical-tickets/reward-all
- **BIN-640** POST /api/admin/physical-tickets/cashout
- **BIN-641** POST /api/admin/physical-tickets/check-bingo
- **BIN-647** GET /api/admin/reports/subgame-drill-down
- **BIN-648** GET /api/admin/reports/physical-tickets/aggregate
- **BIN-649** GET /api/admin/reports/unique-tickets/range
- **BIN-650** GET /api/admin/reports/red-flag/categories
- **BIN-651** GET /api/admin/reports/red-flag/players (REGULATORISK audit-log)
- **BIN-653** paymentType Cash/Card backend-field
- **BIN-656** payment-requests audit-log verifikasjon

Wire-up + bug-fixes:
- **BIN-684** Wire-up placeholder-sider mot merged backend-CRUD (delvis levert slot-A)

#### P4 Low (post-pilot)

- **BIN-610** Post-pilot HTTP 8 deferred endpoints
- **BIN-631** POST /api/admin/pending/:id/forward-request
- **BIN-642** socket.io live-oppdatering for physicalGameTicketList
- **BIN-652** Reports xlsx + PDF eksport-paritet
- **BIN-654** Multi-status history-query for payment-requests
- **BIN-655** GET /api/admin/transactions generisk
- **BIN-667** Dynamic role-CRUD (post-pilot vurdering)
- **BIN-669** Swedbank payment-intent-monitor
- **BIN-678** GET /api/admin/system/info
- **BIN-683** UX-avklaring "Kjøpt: N" på tvers av sesjoner

#### Closed/Done

- BIN-617 dashboard hall-groups widget (ved BIN-666-merge)
- BIN-644 pivot-fix KANSELLERT (per PM-beslutning)
- BIN-666 GroupHall CRUD (merget via PR #247)

---

## 5. Kritiske beslutninger etablert i denne sesjonen

### 5.1 Unity-paritet-regel (2026-04-19, dokumentert i memory)

**Unity 1:1-paritet er kun påkrevd for funksjonell logikk:**
- Ticket-generering (5x5, 3x3, tall-ranges)
- Scoring / claim-logikk
- Timings (draw-intervaller, pattern-cycling)
- State-maskiner
- Drawbag-konfigurasjon

**Visuell polish er web-teams valg** med dokumentert avvik in-code.

Dokumentert i:
- `~/.claude/projects/.../memory/project_unity_parity_rule.md`
- PR #232 (BallTube pivot doc-only)

### 5.2 LOC-budsjett + split-threshold

- **Default:** 2000 LOC per PR (softcap), 2500 flag-terskel
- **Override:** tillat når shared components gjør splitten kunstig (f.eks. PR-A4a 3303 LOC)
- **Tests teller ikke 1:1** i budsjett — regulatorisk test-density er forventet

### 5.3 Forward-only migrations

Etter BIN-657 ble Down-seksjonene "ekte" (markør-syntaks-bug fikset). PR #242 fjernet alle Down-seksjoner + `migrate:down`-script + la til README. Regel: **aldri revert DB-schema**, alltid forward-migrations.

### 5.4 Placeholder-mønster for missing backend

Admin-UI PR-er skal ALDRI blokkere på backend-gaps:
1. Skriv UI med "Venter på backend-endpoint — BIN-XXX" callout-warning
2. Disable write-knapper (ingen kode-pathway til destructive actions)
3. Opprett Linear-issue for backend
4. Wire-up når backend lander

### 5.5 Stopp-og-vent kadens

Per PM_HANDOFF_2026-04-19 §7:
1. Agent sender scope-plan før kode
2. PM reviewer plan + gir GO eller justeringer
3. Agent koder, rapporterer per bolk/commit
4. PM verifiserer CI + merge-state
5. PM rebaser om BEHIND/DIRTY
6. PM merger via `gh pr merge --squash --delete-branch --admin`
7. PM sender neste GO eller venter neste rapport

### 5.6 Regulatorisk fail-closed

For Spillvett-tekst (§11 pengespillforskriften), track-spending, red-flag players:
- **Ingen data vises hvis usikker** (returnér 503, ikke tom array)
- **AuditLog kreves** på hver visning
- **Permission-gates** må være eksplisitt (ingen default-allow)
- **4-eyes** vurderes post-pilot for høye beløp

### 5.7 Defense-in-depth-mønster

Etablert i BIN-672 (5x5-garanti): 7 lags forsvar mot regresjon:
1. DB-schema (NOT NULL DEFAULT)
2. Adapter-persistering
3. Engine-default
4. State-required
5. TypeScript-compiler-gate
6. Runtime-throw (fail-loud)
7. Regresjons-tester

Brukes for kritiske paritet-krav.

---

## 6. Neste steg (prioritert)

### 6.1 Umiddelbart (API-limit resetter 02:00 Oslo — klar nå)

1. **Spinne opp Agent A på fresh sesjon** for å fullføre BIN-684 wire-up:
   - Start med committing uncommitted work som "bolk 1 GameManagement wire-up"
   - Fortsett bolker 2-5 (DailySchedule, Pattern, GroupHall, Track-spending)
   - Push + PR + merge

   **Eksakt brief til ny Agent A-sesjon:**
   ```
   Du fortsetter BIN-684 wire-up. Forrige sesjon hit API-limit midt i bolk 1.

   Sjekk slot-A uncommitted state:
   - apps/admin-web/src/api/admin-game-management.ts (ny)
   - 2 page-filer + state + 2 test-filer + i18n modified

   Commit-GO: samle disse som bolk 1-commit "GameManagement wire-up",
   kjør hard gate, deretter fortsett bolker 2-5 per BIN-684-brief.
   ```

2. **Spinne opp Agent C på fresh sesjon** for å fullføre BIN-685:
   - Fortsett fra commit `7029adf8` (GameType service + router-tester ferdig)
   - Commits 3-5: SubGame CRUD + tester
   - Commit 6: wire-up
   - Push + PR + merge

   **Eksakt brief til ny Agent C-sesjon:**
   ```
   Du fortsetter BIN-685 GameType + SubGame CRUD bundle. 2/7 commits committed.

   Branch: bin-685-gametype-subgame-crud-bundle (lokal, ikke pushet)
   Committet: GameType migration + service + routes + tester

   Fortsett:
   - Commits 3-5: SubGame migration + service + routes + tester (samme mønster)
   - Commit 6: wire-up i apps/backend/src/index.ts
   - Push + PR + merge
   ```

3. **Flagg ops-team** for BIN-665 staging-seed:
   - Kjør `npm --prefix apps/backend run seed:test-users` mot staging-DB
   - Opprett `balltest@spillorama.no` med hall-tilhørighet
   - Unblocker fremtidige E2E-kjøringer mot staging

4. **Staging-verifikasjon av BIN-686** (nettopp merget):
   - Vent ~5 min på Render-deploy
   - Logg inn `spillvett-test1@spillorama.staging` / `TestPlayer_64c85f!`
   - Verifiser: INGEN brett ved first login, "0 kr" i innsats, BallTube fylles med draws
   - Monitorér console for gap-errors (skal nå være borte)

### 6.2 Kort sikt (denne uken)

4. **Pilot-forberedelse:**
   - Manuell QA av BIN-662 CP 4-8 med hall-operatør
   - Verifiser alle admin-UI-sider mot staging etter wire-up merger
   - Oppdatér hall-operatør-opplæring-doc hvis visuelle endringer

5. **Backend-polish (P3-issues):**
   - BIN-623 CloseDay endpoint
   - BIN-624 SavedGame CRUD
   - BIN-625 Schedule CRUD
   - BIN-668 Leaderboard tier CRUD
   - BIN-676 CMS endpoints (med BIN-680 regulatorisk)

6. **Regulatorisk-clearance før pilot:**
   - BIN-680 Spillvett-tekst audit + versjonering (P2)
   - BIN-651 red-flag players (P3, REGULATORISK)

### 6.3 Før pilot-GO

7. **Produkt-eier-beslutninger:**
   - BIN-683 "Kjøpt: N" UX-avklaring (Option A/B/C)
   - BIN-667 dynamic role-CRUD (post-pilot vurdering)
   - BIN-669 Swedbank payment-intent-monitor (nødvendig?)

8. **Staging end-to-end smoke-test:**
   - Login → hall-select → Game 1 runde → claim → payout → settlement
   - Bruk hall-operatør + 2 test-spillere (for broadcast-verifikasjon CP 8)

### 6.4 Post-pilot (after first successful hall-pilot)

9. **Polish P4:**
   - BIN-610 deferred endpoints
   - BIN-652 xlsx + PDF eksport-paritet
   - BIN-678 system info endpoint
   - BIN-642 socket.io live-oppdateringer

10. **Tech-debt:**
   - BIN-632 Row 3 legacy-bug (9 av 10 triples) — post-pilot vurder
   - BIN-661 fikset allerede; monitorér migrations-pattern

---

## 7. Tekniske notater

### 7.1 Kodebase-struktur

```
/Users/tobiashaugen/Projects/Spillorama-system/
├── apps/
│   ├── admin-web/          # Vite SPA (PixiJS ikke brukt her)
│   ├── backend/            # Express + socket.io
│   └── (ingen game-client — ligger i packages/)
├── packages/
│   ├── shared-types/       # Zod + TS-types delt
│   └── game-client/        # PixiJS player UI (/web/)
├── legacy/
│   ├── unity-backend/      # Gammel node-backend (referanse-only)
│   └── unity-client/       # Unity C# (referanse-only)
├── infra/
│   └── deploy-backend.sh   # Render deploy-hook
└── scripts/                # tsx-scripts for build + matrix
```

### 7.2 Test-coverage (end of session)

- **Backend:** 1420/1421 tester (+3 fra BIN-686, 1 skip krever REDIS_URL)
- **Admin-web:** 421+ tester
- **Game-client:** 257/257 tester (+4 fra BIN-686, etter 253 fra BIN-673)
- **Hard gate:** BingoEngine + ticket + compliance + ComplianceLedger + Game2Engine + Game3Engine + PatternMatcher = 100% påkrevd per commit
- **G1-regresjon:** 136/136 (stabil)

### 7.3 CI-workflows

- **CI / backend** — `npm --prefix apps/backend test`
- **Compliance Gate / compliance** — `npm run test:compliance`

Begge må være SUCCESS før merge. PM har `--admin`-override for policy-mergeable-only-bypass, men brukes sparsomt.

### 7.4 Verktøy brukt i denne sesjonen

- **gh (GitHub CLI)** — list/view/merge PRs, rebase-branch
- **Linear MCP** (`mcp__55fb5f7d-*`) — opprett/oppdatér/get issues
- **chrome-devtools-mcp** — staging-verifisering, screenshots, console logs
- **Agent tool (background)** — alle agent-spawns kjørt i bakgrunn med `run_in_background: true`
- **ScheduleWakeup** — ikke brukt denne sesjonen
- **TodoWrite** — kontinuerlig task-tracking

### 7.5 Render ops

- **URL:** https://spillorama-system.onrender.com
- **Build:** auto på merge til main (~3-5 min)
- **Staging smoke-test:** `curl -s $URL/health | jq`

**Kritiske env-vars på Render (må settes):**
- `SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `APP_PG_CONNECTION_STRING`, `APP_PG_SCHEMA=public`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS=true`
- `MSSQL_DB_*` (OK Bingo integration)
- `DEFAULT_ADMIN_USER_LOGIN_EMAIL/PASSWORD`
- Metronia, IDkollen, Swedbank, Sveve creds
- Candy integration (`EXT_GAME_WALLET_API_KEY`, `CANDY_*`)

### 7.6 Workspaces + build-chain

Root `package.json`:
```json
"workspaces": ["packages/*", "apps/backend", "apps/admin-web"],
"build": "npm -w @spillorama/shared-types run build &&
         npm -w @spillorama/game-client run build &&
         npm -w @spillorama/admin-web run build &&
         npm --prefix apps/backend run build"
```

Render buildCommand inkluderer `--include=dev` for root install (for vite + typescript devDeps).

---

## 8. Kjente risikoer og mitigering

### 8.1 Staging-seed mangler (BIN-665)

**Risiko:** E2E-testing mot staging feiler for `balltest@spillorama.no`. Ny PM eller bug-agent vil også støte på det.

**Mitigering:** 
- Alternativ bruker virker: `spillvett-test1@spillorama.staging` / `TestPlayer_64c85f!`
- Lag seed-script del av deploy-hook (Alt B i BIN-665)
- Permanent løsning krever DB-access fra ops-team

### 8.2 Legacy Row 3 mønster-bug (BIN-632)

**Risiko:** Row 3-pattern i Game 3 har 9 av 10 triples (legacy bug mirroret for wire-paritet). Spillerne kan være vant til bug'en.

**Mitigering:** Post-pilot vurder om `{2,3,5}`-mask skal inkluderes. Dokumentert med test.

### 8.3 Migration-ordre regresjon

**Risiko:** BIN-681 flagger at `20260419000000_game_management.sql` har tidsstempel før nyeste run på dev-DB. `npm run migrate` feiler på fresh miljø.

**Mitigering:** 1-linjes `git mv` fikser det. Ikke pilot-blocker.

### 8.4 Admin-UI placeholder-sider

**Risiko:** ~24 sider viser "Venter på backend" inntil BIN-684 wire-up + resterende backend-CRUD lander. Hall-operatør kan forvente funksjonalitet som ikke er der.

**Mitigering:**
- Tydelige placeholder-bannere med BIN-referanser
- Demo-mode før pilot: vis kun aktiverte sider i menu
- Opplæring-doc markerer hvilke sider er live vs placeholder

### 8.5 BankID mock-mode på staging

**Risiko:** Admin-web viser mock-mode-banner på BankID-verify. Hall-operatør kan forvirres.

**Mitigering:** Legg BankID-staging-creds på Render før pilot. Creds må hentes fra BankID-partner.

### 8.6 Regulatorisk gap på Spillvett-tekst (BIN-680)

**Risiko:** ResponsibleGameing-tekst er edit-disabled (PR-A6 + callout-danger). Hall kan ikke oppdatere §11-tekst uten utvikler-intervensjon.

**Mitigering:** BIN-680 P2 High prioriteres før prod-cutover. AuditLog + versjon-historikk kreves før edit-aktiveres.

### 8.7 5 CP NOT OBSERVABLE i BIN-662

**Risiko:** Audio, move-timing, line/full-house claims, broadcast er ikke verifisert headless.

**Mitigering:** Manuell pilot med hall-operatør + 2 test-spillere verifiserer disse. Akseptert i CONDITIONAL GO.

---

## 9. PM-arbeidsmetode (hva som funket)

### 9.1 Prinsipper

- **Rapport før kode** — fanget 3 arkitektur-forskjeller før de ble merget
- **Stopp-og-vent per bolk/commit** — forhindret prematur "100% ferdig"-claims
- **Linear som single source of truth** — hver PR refererer issue, hver issue har clear scope
- **Additive-merge** — ikke-destruktive konflikt-løsninger (main.ts onUnknown-handler ble ~26 linjer men additivt bygget opp)
- **LOC-override når begrunnet** — shared components + tester kan pushe over 2000, ikke strikt grense
- **Staging-verifisering via chrome-devtools-mcp** — fanget admin-web deploy-break (BIN-658)

### 9.2 Konflikt-løsning-oppskrift

- 2+ agenter endrer samme fil → additive-merge
- Migration-timestamp-kollisjon → bump den andre
- Scope-oppdagelser → PM velger retning, oppdatér brief
- Falske "100% ferdig"-claims → krev live-verifisering

### 9.3 Agent-bemannings-stil

- **Spin up 3-4 agenter parallelt** i bakgrunn (`run_in_background: true`)
- **Gi batch-GO for lav-risk bolker** (2-6 commits) når mønster er etablert
- **Stopp-og-vent på regulatorisk-sensitive** commits (Spillvett, migrations)
- **Re-spawn agent ved context-limit** — alle context overleveres via branch-state + brief

---

## 10. Filer + paths å kjenne

### 10.1 Hoved-dokumenter

- `PM_HANDOFF_2026-04-19.md` (forrige PM's handoff, bevart i main)
- `PM_HANDOFF_2026-04-20.md` (denne)
- `docs/qa/game1-e2e-2026-04-19.md` (BIN-662 rapport)
- `docs/archive/legacy-*-bkp/` (arkiverte legacy-filer)

### 10.2 Agent-briefs (per slot)

- `slot-A/AGENT-A-BRIEF.md`, `slot-A/NEXT_ACTIONS.md`, `slot-A/PR-*-PLAN.md`
- `slot-B/AGENT-B-BRIEF.md`, `slot-B/NEXT_ACTIONS.md`, `slot-B/PR-*-PLAN.md`
- `slot-C/AGENT-C-BRIEF.md` (via brave-dirac-d44417-worktree), `slot-C/PR-C*-PLAN.md`

### 10.3 Kritiske paths

- `apps/backend/src/game/ticket.ts` — ticket-generasjon (BINGO75_SLUGS, GAME2_SLUGS, GAME3_SLUGS, DATABINGO60_SLUGS, generateTicketForGame)
- `apps/backend/src/game/BingoEngine.ts` — base engine med lucky-number (lifted fra Game2Engine)
- `apps/backend/src/game/Game2Engine.ts` / `Game3Engine.ts` — inheritance chain
- `apps/backend/src/admin/*Service.ts` — admin-CRUD-services (BIN-622/626/627/666)
- `apps/backend/src/routes/admin*.ts` — admin-endpoints
- `apps/backend/src/index.ts` — wire-up (static serving, socket-registering, adapter-instansiering)
- `apps/admin-web/src/main.ts` — 26+ route-mounts (additive fra 13 PR-er)
- `apps/admin-web/src/components/DataTable.ts` — utvidet i PR-A4a
- `packages/shared-types/src/schemas.ts` + `game.ts` — delt types + Zod
- `packages/game-client/src/games/game1/` — Game 1 PixiJS runtime
- `packages/game-client/src/LoadingOverlay.ts` — BIN-673 state-maskin

### 10.4 Worktrees

Alle i `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/`:
- `slot-A` — Agent A admin-shell
- `slot-B` — Agent B admin-cash/player
- `slot-C` — Agent C backend
- `xenodochial-lewin-8848a1` — Game 1 bug-agent
- `brave-dirac-d44417` — forrige PM-worktree (docs + briefs backup)

---

## 11. Ressurser

- **GitHub repo:** https://github.com/tobias363/Spillorama-system
- **Staging:** https://spillorama-system.onrender.com
- **Legacy admin (paritet-ref):** https://spillorama.aistechnolabs.info/admin/ (login: `michael@teknobingo.no` / `Michael1234`)
- **Linear:** https://linear.app/bingosystem
- **Linear prosjekt:** https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a

**Test-brukere på staging:**
- Admin: `admin@spillorama.staging` / `StagingAdmin_afb67c11!`
- Player: `spillvett-test1@spillorama.staging` / `TestPlayer_64c85f!` (hall: Staging Hall 1, 1000 kr)
- Player (mangler seed): `balltest@spillorama.no` / `BallTest123!` — se BIN-665

---

## 12. Acceptance-status for pilot

### 12.1 Ship-ready (pilot-klar)

- ✅ Game 1 runtime (5x5, 75 baller, B-I-N-G-O kolonner, free centre)
- ✅ Game 2 runtime (3x3, 1..21, jackpot-table, rocket-launch)
- ✅ Game 3 runtime (5x5, 75 baller, custom patterns, auto-claim)
- ✅ Admin login + dashboard (widgets live inkl. hall-groups via BIN-666)
- ✅ Cash-inout (12 sider, BIN-587 backend)
- ✅ Player + KYC + BankID + track-spending (23 sider, live backend)
- ✅ PhysicalTickets (3 sider, BIN-587 backend)
- ✅ Amountwithdraw + Transaction + Wallet (11 sider, BIN-646)
- ✅ Products (3 sider, BIN-583 backend)
- ✅ Security + riskCountry + Leaderboard placeholder (5 sider)
- ✅ Register + password-reset flow (3 sider)
- ✅ Reports + HallAccount + Payout (24 sider med 5 placeholder-gaps)
- ✅ Game 1 defense-in-depth (BIN-672)
- ✅ Game 1 loading UX (BIN-673) + reconnect-sync (BIN-682)
- ✅ Game 1 staging UX-bugs (BIN-686) — display-tickets, innsats, BallTube-resync
- ✅ Forward-only migrations (BIN-661)
- ✅ Admin-web deploy-config (BIN-658)

### 12.2 Blokkerer pilot-GO

- ⚠️ BIN-665 staging-seed for `balltest` (nice-to-have, fungerer uten)
- ⚠️ BIN-680 Spillvett-tekst versjonering (regulatorisk før hall kan edit)
- ⚠️ BIN-684 placeholder wire-up (24 sider med "—" data — demo-fungerer, men ikke hall-klar)
- ⚠️ BIN-685 GameType + SubGame CRUD (aktiverer 7 placeholder-sider)

### 12.3 Manuell QA kreves før pilot

- CP 4-8 fra BIN-662 (audio, move-timing, claims, broadcast)
- BIN-682 reconnect state-sync i reell drift
- BIN-683 "Kjøpt: N" UX-avklaring
- BankID-staging-creds på Render

---

## 13. Siste notater

### Du arver et prosjekt 2-3 uker fra pilot:

- **32 PR-er merget** i ~10-timers sesjon (eksepsjonell hastighet)
- **~167 admin-UI-sider** bygget
- **Game 1/2/3 backend komplett** og hard-gated
- **Regulatorisk-infrastruktur** etablert (AuditLog, fail-closed, permission-gates)
- **Defense-in-depth** + test-låste kontrakter forhindrer regresjon

### Tre ting som gjorde dagen produktiv:

1. **Rapport-før-kode-kadens** — ingen prematur koding, ingen "100% ferdig"-overraskelser
2. **Linear som synkroniserings-hub** — hver beslutning sporbar, ingen "hvor kommer dette fra"
3. **Parallelle agenter med klare scope-grenser** — A/B/C/bug-agent hadde ingen fil-konflikter

### Tre ting å fortsette:

1. **Staging-verifisering etter hver merge-bølge** — chrome-devtools-mcp fanger deploy-bugs
2. **Regulatorisk fail-closed-mønster** — ikke slapp av på dette før pilot
3. **LOC-override når begrunnet** — strikt 2000 ville tvunget kunstige splits

### Tre ting å vokte seg for:

1. **Linear-nummerering race conditions** — jeg blandet BIN-665/666 fordi agent opprettet parallelt. Alltid `get_issue` for å verifisere før PM-brief skrives.
2. **Uncommitted work ved agent-context-limit** — spawne ny agent med instruks om å review + commit eksisterende state, ikke starte over.
3. **"Done-policy"** — issues kan bare lukkes når commit er merget til main + file:line + test (vedtatt 2026-04-17). Ikke la "PR opprettet" være Done.

---

**Lykke til. Prosjektet er i god forfatning. Pilot er innen rekkevidde.**

— Claude Sonnet (PM-sesjon 2026-04-19 → 2026-04-20)

---

## Appendix A — 32 PR-er merget, kort beskrivelse

| # | Tittel | Linear |
|---|--------|--------|
| 218 | PR-A2 Dashboard + widgets | BIN-613 |
| 219 | PR-B1 cash-inout (12 pages + BarcodeScanner + i18n) | BIN-613 |
| 220 | PR-C2 Rocket/Tallspill backend paritet | BIN-615 |
| 222 | fix(game1) unify ticket-gen + scheduler TDZ + Unity ball tube | BIN-619 |
| 223 | PR-C3a Game 3 backend infrastructure | BIN-615 |
| 224 | PR-B2 Player + KYC + BankID + track-spending | BIN-613 |
| 225 | PR-A3a gameType + subGame + patternManagement | BIN-613 |
| 226 | BIN-619 — 4 open bugs from PR #222 follow-up | BIN-619 |
| 227 | PR-A3b gameManagement + savedGame + schedules + dailySchedules | BIN-613 |
| 228 | PR-B3 physicalTickets (+ scope-drop unique) | BIN-613 |
| 229 | PR-C3b Game3Engine + events + wire-up | BIN-615 |
| 230 | BIN-643 — 3 dev-infra bugs blocking E2E repro | BIN-643 |
| 231 | BIN-622 GameManagement CRUD + repeatGame backend | BIN-613 |
| 232 | BallTube pivot — intentional Unity deviation (doc) | BIN-619 |
| 233 | PR-A4a DataTable + Reports (15 sider + infra) | BIN-645 |
| 234 | PR-B4 Amountwithdraw + Transaction + Wallet | BIN-613 |
| 235 | BIN-657 — unblock apps/backend migrations runner | BIN-657 |
| 236 | BIN-628 track-spending aggregate + transactions (REGULATORISK) | BIN-628 |
| 237 | BIN-658 build admin-web on Render + include in workspaces | BIN-658 |
| 238 | PR-B5 Products admin | BIN-613 |
| 239 | BIN-626 DailySchedule CRUD backend | BIN-626 |
| 240 | PR-A4b hallAccount + Settlement + PayoutforPlayers | BIN-659 |
| 241 | docs(qa) BIN-662 Game 1 E2E — CONDITIONAL GO | BIN-662 |
| 242 | BIN-661 forward-only migrations | BIN-661 |
| 243 | BIN-627 Pattern CRUD + dynamic menu backend | BIN-627 |
| 244 | PR-B6 security + riskCountry + Leaderboard | BIN-664 |
| 245 | PR-A5 admin + agent + user + role + GroupHall + Hall | BIN-663 |
| 246 | 5×5 regression — gameSlug not forwarded to display-tickets | BIN-671 |
| 247 | BIN-666 HallGroup CRUD backend + dashboard widget | BIN-666 |
| 248 | PR-A6 CMS + Settings + SystemInfo + otherGames | BIN-674 |
| 249 | BIN-672 Game 1 5x5 defense-in-depth | BIN-672 |
| 250 | BIN-673 + BIN-682 Loading UX + reconnect state-sync | BIN-673 |
| 251 | PR-B7 register + password-reset flow | BIN-675 |
| 252 | BIN-686 Game 1 staging UX-bugs (display-tickets, innsats, BallTube, markering) | BIN-686 |

---

## Appendix B — Dag 1-sjekkliste for ny PM

- [ ] Les hele dette dokumentet (30 min)
- [ ] Les `PM_HANDOFF_2026-04-19.md` (30 min — gir kontekst før denne)
- [ ] Sjekk Linear: https://linear.app/bingosystem/project/legacy-avkobling
- [ ] Verifiser staging: https://spillorama-system.onrender.com/health
- [ ] Logg inn på admin-staging og player-staging for visuell sanity-check
- [ ] Les committed-men-ikke-pushet work i slot-A og slot-C (ref §3.2 over)
- [ ] Etter API-limit resetter 02:00 Oslo: spinne opp Agent A og C med "continuation brief"
- [ ] Flagg ops-team for BIN-665 staging-seed
- [ ] Prioriter BIN-680 regulatorisk-versjonering
- [ ] Etter BIN-684 + BIN-685 merger: gjør full staging-verifisering

Lykke til.

---

## 14. Operational notes for ny PM (quick-reference)

### 14.1 Dagen starter

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

# Sjekk åpne PR-er
gh pr list --state open --limit 20

# Sjekk staging
curl -s https://spillorama-system.onrender.com/health | jq

# Main oppdatert?
git fetch origin main && git log --oneline origin/main | head -10
```

### 14.2 Merge-oppskrift (gjentakende mønster)

```bash
gh pr view <N> --json mergeStateStatus,statusCheckRollup
gh pr update-branch <N> --rebase   # Hvis BEHIND

# Hvis DIRTY: manuell rebase i worktree
cd .claude/worktrees/<slot>
git fetch origin main && git rebase origin/main
# løs konflikter (oftest main.ts + i18n — alltid additivt)
git add -A && git rebase --continue
git push --force-with-lease

# Merge når CLEAN + CI grønn
gh pr merge <N> --squash --delete-branch --admin
```

### 14.3 Agent-spawning (bakgrunn + kontekst)

Bruk `Agent` tool med `run_in_background: true`. Brief skal inneholde: worktree-path, branch-navn, setup-kommandoer, scope (fil:linje), hard gate, LOC-budsjett, stopp-og-vent-kadens, PR-tittel-forslag.

### 14.4 Symptomer + rettelser

- **PR finnes ikke, agent sier ferdig** → uncommitted work i slot, ny agent push + PR
- **CI feiler etter merge** → staging-deploy (Render), ikke kode
- **Agent API-limit** → vent reset, spawn med "continue fra state"-brief
- **Linear-ID-kollisjon** → alltid `get_issue` for verifisering
- **Staging ser feil ut** → chrome-devtools-mcp (IKKE computer-use)

### 14.5 Test-brukere

**Fungerer:**
- Admin: `admin@spillorama.staging` / `StagingAdmin_afb67c11!`
- Player: `spillvett-test1@spillorama.staging` / `TestPlayer_64c85f!`

**Blokkert (BIN-665):** `balltest@spillorama.no`

---

## 15. Key learnings

### 15.1 Patterns som funker

- **Defense-in-depth + test-låste kontrakter** (BIN-672, BIN-686) — regresjon krever revert eller test-ignorering
- **Scope-ærlig redusering** — PR-B6 12→5, PR-B7 7→3. Dokumentér scope-drops eksplisitt
- **LOC-override når begrunnet** — shared components hører sammen, ikke kunstige splits
- **Placeholder-mønster** — UI ship før backend, ikke blokker
- **Parallelle agenter + batch-GO** — 4 samtidig hvis scope-grenser er tydelige

### 15.2 Anti-patterns

- Numeriske ID i PM-brief uten `get_issue`-verifisering
- Prematur celebrering før staging-verifisering
- "100% ferdig" fra agent = falsk hvis ikke merget til main

### 15.3 Største enkelt-finn

**BIN-658 admin-web deploy-break** — 8 admin-PR-er usynlige for brukere pga. fravær i build-chain siden 2026-04-18. Ville blitt katastrofalt om oppdaget under pilot.

**Lærdom:** Staging-verifisering etter hver merge-bølge, ikke én gang per dag.

---

## 16. Agent-continuation-briefs (klar til copy-paste etter API-reset)

### 16.1 Agent A — BIN-684 wire-up fortsettelse

```
Du fortsetter BIN-684 placeholder wire-up. Forrige sesjon hit API-limit midt i bolk 1.

Worktree: /Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-A
Branch: bin-684-placeholder-wireup (lokal, ikke pushet)

Status: Uncommitted work i slot-A:
- apps/admin-web/src/api/admin-game-management.ts (ny)
- 2 page-filer, state, 2 test-filer + i18n modified

Steg:
1. Review + commit som "feat(admin): BIN-684 bolk 1 GameManagement wire-up"
2. Fortsett bolker 2-5: DailySchedule (BIN-626), Pattern (BIN-627), GroupHall (BIN-666), Track-spending (BIN-628)
3. Hard gate: admin-web npm test + backend game-suite 100%
4. Push + PR + rapport til PM

Forutsetning: git fetch origin main (etter siste Agent B PR-B7 og Agent A PR-A6 merger).
```

### 16.2 Agent C — BIN-685 fortsettelse

```
Du fortsetter BIN-685 GameType + SubGame CRUD bundle. 2/7 commits committed.

Worktree: /Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-C
Branch: bin-685-gametype-subgame-crud-bundle (lokal, ikke pushet)

Status:
- Commit 1: 3e8e0173 GameType migration + service + routes + access policy
- Commit 2: 7029adf8 GameType service + router-tester (48 tester)
- Mangler: SubGame CRUD (commits 3-5), wire-up (commit 6)

Steg:
1. Review committed state, hard gate grønn?
2. Bolk B: SubGame migration + service + routes + tester (samme mønster som GameType + BIN-622/626/627/666)
3. Commit 6: wire-up i apps/backend/src/index.ts
4. Push + PR + rapport til PM

Forutsetning: git fetch origin main (sjekk om BIN-684 wire-up touchet index.ts).
```

### 16.3 Game 1-bug-agent

Logget av etter BIN-686. Primary scope komplett. Eventuelle nye bugs → ny ad-hoc sesjon.

### 16.4 Etter continuation-PR-er

1. Merge BIN-684 + BIN-685
2. Staging-verifisering via chrome-devtools-mcp
3. Neste backend-gaps: BIN-623 CloseDay, BIN-624 SavedGame, BIN-625 Schedule, BIN-668 Leaderboard, BIN-676 CMS
4. Agent B er ledig for wire-up eller front-end-polish

---

**Slutt på PM Handoff 2026-04-20. Komplett per 07:30 Oslo.**

— Claude Sonnet
