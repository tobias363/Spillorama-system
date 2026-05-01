# Bug-walkthrough rapport — 2026-05-01

**Verktoy:** Playwright headless (chromium) mot live prod (`https://spillorama-system.onrender.com/admin/`).
**Test-fil:** `apps/admin-web/tests/e2e/agent-portal-bug-walkthrough.spec.ts`
**Rådata:** `apps/admin-web/tests/e2e/walkthrough-results.json` (184 findings)
**Klassifisert:** `apps/admin-web/tests/e2e/issues-classified.json`
**Screenshots:** `apps/admin-web/tests/e2e/screenshots/` (184 stk lokal, gitignored). 9 kuratore i `docs/audit/walkthrough-2026-05-01-screenshots/`.

## Sammendrag

- **Roller testet:** 4 (ADMIN-demo, ADMIN-tobias, AGENT-arnes, AGENT-bodo)
- **Ruter besøkt:** 184 totalt (78 admin × 2 + 14 agent × 2)
- **Unike sider med problemer:** 17 (8 ADMIN-konstante + 1 AGENT-arnes-only + 8 AGENT-bodo-only)
- **Høy:** 7 unike root-cause-bugs (12 forekomster)
- **Medium:** 6 unike (15 forekomster — mest duplikater på tvers av ADMIN-roller / shift-state)
- **Lav:** 4 unike støy-typer (22 forekomster — alle er konsekvens av high-bugs)

Ingen 5xx, ingen rene login-failures, ingen JS-krasj. Alle bugs er enten contract-mismatch (FE↔BE) eller sidebar-/navigasjonsfeil.

## Høy

### #1 — Spill 1-5 rapporter helt ødelagt for ALLE admins

**Ruter:** `/reportGame1`, `/reportGame2`, `/reportGame3`, `/reportGame4`, `/reportGame5`
**Rolle:** ADMIN (begge accounts, identisk symptom)
**Symptom:** Stor rød alert-danger-banner: `gameType må være MAIN_GAME eller DATABINGO.` Tabellen viser "Ingen data tilgjengelig". Backend-call svarer 400.
**Reproduksjon:** Logg inn som admin → klikk "Rapportadministrasjon → Spill1" (eller Spill2-5).
**Network:** `GET /api/admin/reports/games/{slug}/drill-down?startDate=...&endDate=...` → `400 INVALID_INPUT`
**Root cause:** Frontend sender slug-strings (`bingo`, `rocket`, `mystery`, `wheel`, `color-draft`) som path-param `:gameSlug`, men backend (`apps/backend/src/routes/adminReports.ts:317-322`) kaller `parseOptionalLedgerGameType()` som KUN aksepterer `MAIN_GAME` eller `DATABINGO`. Frontend må sende `MAIN_GAME` for Spill 1-3 og `DATABINGO` for SpinnGo. Spill 4 (`themebingo`) er deprecated (BIN-496) og rute bør fjernes.
**Lokasjoner:** `apps/admin-web/src/pages/reports/{game1,game2,game3,game4,game5}/Game?ReportPage.ts:9-10` (gameSlug-konstanter), `apps/backend/src/routes/adminReports.ts:317-340` (path-param-validering), `apps/backend/src/util/httpHelpers.ts:106-118` (parser).
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug1-reportGame1.png`

### #2 — "Master-konsoll (Game 1)" sidebar-link er hardkodet placeholder

**Rute:** `/game1/master/placeholder`
**Rolle:** ADMIN (begge)
**Symptom:** Side viser breadcrumb `/game1/master/placeholder` og rød banner "Spillet finnes ikke." Tom skjerm.
**Network:** `GET /api/admin/game1/games/placeholder` og `/.../hall-status` → `400 GAME_NOT_FOUND`
**Root cause:** Sidebar-leaf bruker bokstavelig "/game1/master/placeholder" som path: `apps/admin-web/src/shell/sidebarSpec.ts:69`. Burde slå opp aktivt Game 1 master-game og linke til riktig `gameId`, eller skjules helt når ingen master-game eksisterer.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug2-game1-master-console.png`

### #3 — Agent-dashbord viser hall-UUID i stedet for hall-navn

**Rute:** `/agent/dashboard`
**Rolle:** AGENT-arnes (synlig for alle agenter med åpen shift)
**Symptom:** Header viser "b18b7928-3469-4b71-a34d-3f81a1b09a88 — b18b7928-3469-4b71-a34d-3f81a1b09a88" i stedet for "Teknobingo Årnes — Teknobingo Årnes" (eller hva GoH/Hall heter).
**Root cause:** `apps/admin-web/src/pages/agent-dashboard/AgentDashboardPage.ts:124-125` setter både `groupHallLabel` og `hallNameLabel` til `data?.shift?.hallId` (UUID-en), ikke til navn. Burde joine mot `session.hall[]` eller agent-context for å hente friendly name. Begge labels er identiske selv om ene skal være Group of Halls.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug3-agent-dashboard-uuid.png`

### #4 — Sidebar "Pending/Rejected Requests" for agenter sender til admin-rute → bounce

**Ruter:** `/pendingRequests`, `/rejectedRequests`
**Rolle:** AGENT (begge accounts)
**Symptom:** Klikk på "Spilleradministrasjon → Pending Requests" i agent-sidebaren → URL endres et par millisekunder til `/pendingRequests` → role-guard i `main.ts:402-410` bouncer til `/agent/dashboard`. Brukeren ender på dashboard mens sidebaren høylight-er Pending Requests. Ingen feilmelding.
**Root cause:** `apps/admin-web/src/shell/sidebarSpec.ts:329-330` peker agent-sidebar-leaves på admin-paths (`/pendingRequests`, `/rejectedRequests`). Agent-portalen har ikke disse sidene tilgjengelig — burde enten lage agent-spesifikke sider, fjerne menyvalgene, eller route dem til agent-versjonene.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug4-pending-redirect.png`

### #5 — Agent-features krasjer for agent uten åpen shift uten tydelig CTA

**Ruter (AGENT-bodo, ingen aktiv shift):**
- `/agent/players` → `400 NO_ACTIVE_SHIFT`
- `/agent/sellProduct` → `400 NO_ACTIVE_SHIFT`
- `/agent/orders/history` → `400 SHIFT_NOT_ACTIVE`
- `/agent/past-winning-history` → `400 SHIFT_NOT_ACTIVE`

**Symptom:** Sidene returnerer 400 med konsoll-error. UI-en er enten tom eller viser samme "Åpne et skift"-banner som dashboard. På `/agent/players` finnes det INGEN "Start shift"-CTA — agenten må vite at hen må gå tilbake til dashboard først.
**Root cause:** Pages forutsetter aktiv shift, men har ingen "ingen-shift"-fallback. AGENT-arnes (med shift) hadde 0 errors på samme ruter — så det er strikt en ingen-shift-tilstand. Burde rendre samme "Start shift"-banner som dashboard på alle disse sidene.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug5-no-shift-fallback-missing.png`

### #6 — Admin-bruker ser /agent/cashinout men kaller daily-balance som blir avvist

**Rute:** `/agent/cashinout`
**Rolle:** ADMIN (begge)
**Symptom:** Sidebar-leaf "Kontant inn/ut → Kontant inn/ut" sender admin til en rute der siden trigger `GET /api/agent/shift/daily-balance` → `400 FORBIDDEN: "Daily-balance er kun for AGENT."` (Side rendrer fortsatt, men data-felt er tomme.)
**Root cause:** Admin-sidebar (`sidebarSpec.ts:63`) lar admin gå til agent-spesifikk side. Backend (`apps/backend/src/routes/agentOpenDay.ts:124+`) avviser admin-rolle. Enten skjul cash-in-out-gruppen for admin, eller la admin-versjonen bruke et impersonation-pattern (`X-Acting-Hall-Id`) eller velge agent å vise data for.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug6-admin-cash-inout.png`

### #7 — Physical Active Ranges-side kaller endpoint uten obligatorisk filter

**Rute:** `/physical/ranges`
**Rolle:** ADMIN (begge)
**Symptom:** Tabell viser ingen data. Konsoll: `400 INVALID_INPUT: "Minst én av agentId eller hallId må spesifiseres."`
**Root cause:** `apps/admin-web/src/api/admin-physical-tickets.ts:534-545` kaller `/api/admin/physical-tickets/ranges` uten params når brukeren ikke har valgt filter. Backend (samme endpoint) krever én av agentId/hallId. Enten preselekter filter på første hall i listen, eller render tom-state med "Velg hall først" instead of fyrng API.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug7-physical-ranges.png`

## Medium

### #8 — Track-spending viser permanent "kommer snart"-banner uten lukke-mulighet

**Rute:** `/players/track-spending`
**Rolle:** ADMIN
**Symptom:** Lilla `[role="alert"]`-banner: "Regulatorisk rapport kommer — Aggregat-endpoint er ikke tilgjengelig ennå (BIN-628). … fail-closed-prinsippet". Forventet etter BIN-628-status, men er stub uten data eller alternative actions.
**Vurdering:** Dette er WIP-tilstand som dokumentert. Lav forretningsmessig konsekvens, men fyller side.

### #9 — Topp 5 spillere widget på admin-dashboard viser "venter på backend"

**Rute:** `/admin`
**Rolle:** ADMIN (begge)
**Symptom:** Widgeten "Topp 5 spillere" viser teksten "Venter på backend-endpoint BIN-A2-API-2", samtidig som frontend faktisk fyrer `/api/admin/players/top` som returnerer 400 USER_NOT_FOUND.
**Root cause:** `apps/admin-web/src/api/dashboard.ts:123-147` har retry-handling som mapper 400 → null. UI-en viser placeholder-tekst korrekt, men nettverksforespørselen feiler likevel og er synlig i konsollen. Enten fjern API-kallet helt (siden frontend egentlig ikke vil bruke svaret) eller løs USER_NOT_FOUND root cause i backend.
**Network:** `GET /api/admin/players/top?metric=wallet&limit=5` → `400 USER_NOT_FOUND: "Bruker finnes ikke."`
**Vurdering:** Frontend-resilient men forurenser audit/console-logs. Faktisk USER_NOT_FOUND er mistenkelig — admin-bruker fra valid JWT skal ikke få denne feilen.
**Screenshot:** `docs/audit/walkthrough-2026-05-01-screenshots/bug9-dashboard-top5.png`

## Lav

Console-warnings og 400-statuses som er produkter av høy/medium-bugs (samme network-call dukker opp som både "network error" og "console error" warning). Ingen unike funn utover #1-#9.

## Observasjoner som IKKE er bugs

- **AGENT-bodo har ingen aktiv shift.** Dette er forventet; pilot-data har bare arnes med åpen shift. Dashboard viser korrekt fail-state med "Start shift"-CTA. Bugs #5 forteller om pages som mangler samme fail-state.
- **AGENT-arnes har 0 errors på de 12 ruter den har aktive shift på.** Bra signal for happy-path.
- **Begge ADMIN-roller har IDENTISKE bugs.** Verifiserer at problemene er backend-kontrakt og ikke konto-spesifikke.
- **AGENT-arnes hall-context fungerer logisk** (data lastes), men display-strengen er feil. Functional bug, ikke data bug.
- **`/agent/sellProduct` route requires `roles: ["agent"]`** (ikke `hall-operator`). HALL_OPERATOR kommer dermed til å bli bouncet til /agent/dashboard. Dette ble ikke testet (ingen HALL_OPERATOR-konto).

## Test-coverage merknader

- "Skjult bug": Modaler ble ikke åpnet (testet bare landing-state). Dialogene flagget som problematiske av PM (FORBIDDEN-feil i modaler) kan ligge bak knapp-clicks som walkthroughen ikke utløste. Anbefales utvidelse i runde 2.
- Mutating actions ble unngått (Approve/Reject, Start Game, Add Money etc.). Disse må manuelt verifiseres mot pilot-data.
- Agent-portalen har bare 14 sidebar-routes; modulene ligger bak knapper og dispatchere på cash-in-out og lignende. Walkthroughens scope er sidebar-navigasjon, ikke deep workflow.

## Repro-instruksjoner

```bash
npx playwright test apps/admin-web/tests/e2e/agent-portal-bug-walkthrough.spec.ts \
  --config=apps/admin-web/tests/e2e/walkthrough.config.ts \
  --project=chromium

# Analyse:
npx tsx apps/admin-web/tests/e2e/analyze.ts
```

Tar ~19 min for full sweep mot prod (ADMIN ~8min × 2 + AGENT ~1.5min × 2).
