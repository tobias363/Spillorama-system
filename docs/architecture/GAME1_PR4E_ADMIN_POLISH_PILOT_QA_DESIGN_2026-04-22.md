# PR 4e — Admin-UI polish + pilot-QA design

**Status:** Design-forslag, venter PM-review
**Dato:** 2026-04-22
**Agent:** Scope-plan-agent — ingen kode, bare dokumentasjon
**Bygger på:** [`GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md`](./GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md), [`SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md`](./SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md), [`spill1-variantconfig-admin-coupling.md`](./spill1-variantconfig-admin-coupling.md)

## 1. Executive summary

PR 4e er siste pilot-blokker for Spill 1: den gjør admin-UI faktisk operativt for en pilot-leder + dokumenterer manuell QA-prosedyre for å kjøre 4-halls-piloten live. Hovedfunn fra utforskning: **GroupHall-CRUD har backend men ingen admin-UI (kun placeholder)** — pilot krever 1 hall-gruppe ("link"), så dette må bygges. I tillegg har `DailyScheduleEditorModal` fri-tekst CSV-felt for master-hall + hall-IDs + group-hall-IDs, som er en vesentlig feilkilde under pilot-setup. PR 4e leveres som 3 sub-PR-er (4e.1 GroupHall-UI, 4e.2 DailySchedule-polish + master-konsoll-fixups, 4e.3 pilot-QA-dok + runbook), totalt ~4 dager arbeid. Pilot-QA leveres som Markdown-runbook i `docs/qa/` med trinn-for-trinn E2E-flyt + rollback-prosedyrer.

## 2. Pilot-kontekst

**Piloten:** 4 haller innen én "link" (hall-gruppe), kjører Spill 1-basisvariant (5-fase-bingo med faste eller prosent-premier per farge) mot produksjonsmiljø. Agent 1's PR 4d har levert:
- Scheduled-game-spawn via `Game1ScheduleTickService`
- Multi-hall player-join via socket
- Master-konsoll real-time (`/admin-game1` namespace)
- Master stopGame med auto-refund + §11-audit
- Crash recovery (PR #312)

**Hva må PM/pilot-leder klare alene via admin-UI før piloten kan kjøre:**
1. Opprette 4 haller (eller verifisere at de 4 finnes og er `isActive=true`)
2. Opprette **1 hall-gruppe** som binder de 4 hallene sammen (= "link")
3. Opprette **Schedule-mal** som beskriver dagens spill-rytme (morgen/kveld-slots, lucky-number-premie, evt. manual-start/end-tider)
4. Opprette **DailySchedule-rad** som kopler `scheduleId` til hall-gruppe + velger ukedag(er)
5. Opprette én eller flere **GameManagement-rader** (Spill 1) med per-farge pris + premie-matrise + jackpot + Elvis-replace-pris + lucky-prize
6. Ved spilletid: åpne **Master-konsoll** per scheduled-game, verifisere at alle haller er klare, starte spill, håndtere exclude/pause/resume/stop

**Hva må testes manuelt før GO-piloten:**
- Full admin-opprettelse (punkt 1-5) uten å måtte redigere DB direkte
- Spiller-login via ordinær web-shell, se schedule i lobby, kjøpe bong, spille hele løpet
- Multi-hall: spillere fra minst 2 av 4 pilot-haller i samme scheduled-game, per-hall-tellinger stemmer
- Master-actions: exclude-hall før start, pause/resume under draw, stop + refund-verifikasjon
- Per-farge-premier: minst 2 farger i samme spill, verifiser at begge får sin egen matrise (Option X)
- Jackpot-triggering: Fullt Hus innenfor jackpot-draw-vindu (50-59), per-farge-prize utbetalt
- Reconnect: spiller refresher midt i fase, snapshot viser riktige vunne faser (PR #321-kontrakten)

## 3. Admin-UI polish — scope

### 3.1 Pilot-kritiske skjermer (må fungere)

| Skjerm | Rute | Fil | Status pr. 2026-04-22 |
|---|---|---|---|
| Hall-liste | `#/hall` | `apps/admin-web/src/pages/hall/HallListPage.ts` | Live, CRUD komplett |
| Hall-form (add/edit) | `#/hall/add`, `#/hall/edit/:id` | `apps/admin-web/src/pages/hall/HallFormPage.ts` | Live |
| **Hall-gruppe-liste** | `#/groupHall` | `apps/admin-web/src/pages/groupHall/index.ts` | **PLACEHOLDER — Bin blokker** |
| **Hall-gruppe-form** | `#/groupHall/add`, `#/groupHall/edit/:id` | `apps/admin-web/src/pages/groupHall/index.ts` | **PLACEHOLDER** |
| Schedule-liste | `#/schedules` | `apps/admin-web/src/pages/games/schedules/ScheduleListPage.ts` | Live, CRUD |
| Schedule-editor | Modal fra list-side | `apps/admin-web/src/pages/games/schedules/ScheduleEditorModal.ts` | Live — kjernefelt OK, subGames via rå JSON-textarea |
| DailySchedule-liste | `#/dailySchedule/view` | `apps/admin-web/src/pages/games/dailySchedules/DailyScheduleListPage.ts` | Live |
| DailySchedule-editor | Modal fra list-side | `apps/admin-web/src/pages/games/dailySchedules/DailyScheduleEditorModal.ts` | Live — **hall-IDs er CSV-fritekst, høy feilrisiko** |
| GameManagement-liste | `#/gameManagement` | `apps/admin-web/src/pages/games/gameManagement/GameManagementPage.ts` | Live |
| GameManagement-add (Spill 1) | `#/gameManagement/:typeId/add` | `apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts` | Live — full form med per-farge, per-pattern, jackpot (PR #311/#323) |
| Master-konsoll | `#/admin-game1/:gameId` | `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts` | Live, polling 5s → skal konverteres til socket av Agent 1 i PR 4d.3 |

### 3.2 Konkrete polish-punkter per skjerm

#### 3.2.1 GroupHall-CRUD (BLOKKER — må implementeres)

- **Problem:** `apps/admin-web/src/pages/groupHall/index.ts` er 56 linjer med placeholder som peker på "kommer post-pilot". Pilot krever at PM kan lage en hall-gruppe via UI.
- **Backend-status:** `apps/backend/src/routes/adminHallGroups.ts` har **full CRUD** (GET list, GET :id, POST, PATCH, DELETE) + `HallGroupService`. Rolle-gated med `HALL_GROUP_READ/WRITE`. Testdekning finnes (`adminHallGroups.test.ts`).
- **Tiltak i PR 4e.1:**
  1. Lag ny `apps/admin-web/src/api/admin-hall-groups.ts` API-adapter (analogt til `admin-halls.ts`).
  2. Lag `apps/admin-web/src/pages/groupHall/GroupHallListPage.ts` — DataTable-basert liste (name, slug, status, antall haller, opprettet).
  3. Lag `apps/admin-web/src/pages/groupHall/GroupHallFormPage.ts` — create/edit med multi-select for haller (pull `listHalls()` og lag checkbox-matrise eller select2-multi).
  4. Oppdater `mountGroupHallRoute` til å dispatche riktig side istedenfor placeholder.
  5. Remove placeholder-banner-tekst og i18n-nøkkel `group_halls_placeholder_banner` + `coming_post_pilot` der det bare er placeholder-referanse.
- **Minimumsfelt for pilot:** `name`, `slug`, `hallIds[]` (multi-select fra `listHalls()`), `status` (active/inactive). Post-pilot-felt som `loyaltyConfig` eller `reportRecipients` kan utstå.

#### 3.2.2 DailyScheduleEditorModal — hall-pickers

- **Problem:** `DailyScheduleEditorModal.ts` har 3 fri-tekst-felt: `ds-master-hall-id`, `ds-hall-ids` (CSV), `ds-group-hall-ids` (CSV). Admin må vite UUID utenat. Én stavefeil = scheduled-game blir aldri spawnet, eller haller får spillere uten mulighet til ready-sign.
- **Tiltak i PR 4e.2:**
  1. Last `listHalls({ includeInactive: false })` + `listHallGroups()` ved modal-åpning.
  2. `master-hall` → `<select>` med hall-liste (samme haller som er i valgt hall-gruppe).
  3. `hallIds` → multi-checkbox eller select2-multi fra hall-liste.
  4. `groupHallIds` → `<select>` med hall-grupper; når én velges, pre-velg hallene i `hallIds`-multi + master-hall-dropdownen (bruker kan deretter justere).
  5. Validering: hvis `groupHallIds` satt og `hallIds` satt, må alle `hallIds` være medlemmer av minst én valgt gruppe. Feil → setError() før submit.
- **Subgames-textarea (rå JSON):** Polish ikke-scope for pilot (pilot-spill opprettes via GameManagement-form, subgames kan være tom `[]` eller minimalt fylt).

#### 3.2.3 ScheduleEditorModal — subGames

- **Problem:** `sch-subgames` er rå JSON-textarea som krever at PM kjenner schema. Det er ingen feltvalidering utover JSON-array-sjekk.
- **Tiltak i PR 4e.2 (minimum):**
  1. Legg til en statisk help-block med eksempel-JSON (gameManagementId + startTime + endTime) for pilot-bruk.
  2. Legg til "Test JSON"-knapp som kjører JSON.parse + viser feltene som pent-formatert tabell under.
  3. Full strukturert subgames-editor utstår til post-pilot (5 382L legacy-create-form er ikke realistisk for 4e).
- **Validering av hall-felter:** Ingen i Schedule-modalen — Schedule-malen har ikke hall-kobling direkte. OK som er.

#### 3.2.4 GameManagementAddForm (Spill 1) — småpolish

- **Status:** PR #311 merget dette 2026-04-20. Form har per-farge-pris, per-(farge, pattern) mode+amount, per-farge-jackpot, Elvis-replace, lucky-prize. Validering kjører lokalt via `validateSpill1Config`.
- **Polish-punkter (småskruer i PR 4e.2):**
  1. **Ingen edit-path for eksisterende spill** — `#/gameManagement/:typeId/view/:id` viser read-only, men det finnes ingen `/edit/:id`-rute. Pilot-blokker? Diskuter med PM — hvis ja, må PR 4e.2 legge til edit-path; hvis nei, PM må slette + re-lage under pilot. Anbefaling: skip for 4e, dokumenter som workaround i runbook.
  2. **Sum-badgen på pattern-tabellen er feilaktig "grønn" når sum = 0%** — en tom matrise med 0% virker OK uten visuell advarsel, men betyr ingen premie. Legg til warning-farge hvis sum = 0% og mode = "percent" for alle farger.
  3. **Manglende "duplikat-form" (Repeat Game)** — legacy hadde "Repeat Game"-knapp som copy/paste-fyller forrige konfig. Ikke skopet i PR #311. Anbefaling: skip for pilot (PM kan lage en gang + lagre payload lokalt).
  4. **Ingen synlig kopling til hall-gruppe** — form lagrer `config.spill1` uten å vise hvilken hall-gruppe som får spillet. Dette er bevisst: én GameManagement-rad = én spill-konfig som brukes av scheduler for å spawne mange `scheduled_games` basert på DailySchedule. Men PM forventer sannsynligvis å se "hvilken link bruker dette spillet" — legg til en info-tekst i header: "Dette spillet kan brukes av alle DailySchedule-rader via `gameManagementId`".

#### 3.2.5 Game1MasterConsole — socket + små-polish

- **Status:** Polling hver 5s. Agent 1 konverterer til socket i PR 4d.3 (`/admin-game1` namespace).
- **4e.2-polish-punkter (kompatibelt med 4d.3 sin socket-konvertering):**
  1. **Exclude-hall-knapp er disabled for master-hall** — kode viser `<span>master</span>` istedenfor knapp. Legg til tooltip: "Master-hallen kan ikke ekskluderes — velg en ny master-hall i DailySchedule for å bytte".
  2. **Stop-dialog har ingen indikasjon av refund-omfang** — bruker skriver bare `reason` og trykker OK. Anbefalt polish: vis "Dette vil refundere N digitale bonger (sum X kr) + logge Y cash-bonger som krever manuell refund". Krever ny backend-endpoint `GET /api/admin/game1/:id/refund-preview` eller kan hentes fra eksisterende `fetchGame1Detail` + ny aggregate. **Vurderes av PM — kan utstå til post-pilot hvis estimat-kost er høy.**
  3. **Audit-tabellen er JSON-dump** — `metadata` vises via `JSON.stringify` i `<code>`-tag. For pilot er dette akseptabelt, men polish: pretty-print nøkler som "excludedHallId: hall-2, reason: hall-closed". Ikke kritisk.
  4. **"All Ready"-badge oppdaterer bare ved polling** — etter 4d.3-socket-konvertering blir dette umiddelbart. Ingen 4e-endring nødvendig hvis Agent 1 leverer 4d.3 før 4e.2 starter.

#### 3.2.6 Sidebar / hoved-nav

- **Problem:** Grupp-Haller er i sidebaren (antageligvis — bekreft i `components/Sidebar` eller `router.ts`). Hvis ikke, må pilot-brukeren navigere via URL manuelt.
- **Tiltak i PR 4e.1:** Verifiser at `#/groupHall` er i sidebar. Hvis ikke, legg til under "Spill"- eller "Administrasjon"-menyen.

### 3.3 Eksplisitt ut-av-scope for PR 4e (post-pilot)

- Schedule-builder med strukturert subGames-editor (legacy create.html 5 382L)
- GameManagement edit-path for eksisterende spill
- Repeat Game-funksjon (copy/paste)
- Alle 13 post-pilot-varianter fra `SPILL1_FULL_VARIANT_CATALOG`
- Per-farge-visning på klientsiden (Spor 3 — CenterTopPanel)
- Bug 2 scheduler-routing (blir levert sammen med scheduler-fiks post-pilot per `spill1-variantconfig-admin-coupling.md`)
- UX-polish som drag-drop på subGames, inline-edit på liste-sider, bulk-aksjoner
- Tickets-per-game-visning (BIN-623 backend blokker fortsatt)
- CloseDay-funksjonalitet (BIN-623)
- Hall-ready real-time via socket (Agent 1 sitt 4d §8 åpent spørsmål)

## 4. Pilot-QA — plan

Leveres i PR 4e.3 som `docs/qa/GAME1_PILOT_RUNBOOK_2026-04-22.md` (Markdown-dokument, ingen kode). Nedenfor er strukturen + hovedinnhold som runbooken skal inneholde:

### 4.1 Pilot-QA — trinnvis manuell prosedyre

**Pre-flight-sjekk (utføres 1-2 dager før pilot):**

| # | Steg | Forventet resultat | Pass/fail |
|---|---|---|---|
| P1 | `npm run test` i `apps/backend` | Alle tester grønne | - |
| P2 | `npm run test` i `apps/admin-web` | Alle tester grønne | - |
| P3 | Main-branch CI grønn på siste commit | Grønn | - |
| P4 | Verifiser migrasjoner er kjørt i pilot-miljø (inkl. 4d.1 `room_code`-kolonne) | `\d app_game1_scheduled_games` viser `room_code` | - |
| P5 | Verifiser at de 4 pilot-hallenes `organization_number` + `settlement_account` er satt | Ikke-null for alle 4 | - |

**Admin-opprettelse-flyt:**

| # | Steg | Forventet resultat |
|---|---|---|
| A1 | Logg inn som PILOT_ADMIN i admin-web (rolle `ADMIN`) | Ingen 401/403 |
| A2 | Naviger `#/hall`, verifiser at 4 pilot-haller er `active` | 4 rader synlige, status grønn |
| A3 | Naviger `#/groupHall`, klikk "Opprett hall-gruppe" | Form åpnes (ikke placeholder!) |
| A4 | Fyll ut name=`Pilot-link`, slug=`pilot-link`, velg 4 pilot-haller i multi-select, status=`active`, lagre | Toast.success; gruppe vises i liste |
| A5 | Naviger `#/schedules`, klikk "Legg til", fyll ut name=`Pilot-schedule`, type=`Auto`, lucky=500, subGames=`[]`, status=`active`, lagre | Lagret; vises i liste |
| A6 | Naviger `#/dailySchedule/view`, klikk "Opprett", fyll ut name=`Pilot-mandag-morgen`, startDate=i morgen, weekday=`monday`, startTime=`10:00`, endTime=`11:00`, velg hall-gruppe=`pilot-link`, velg master-hall=én av 4, hallIds=alle 4, scheduleId=`Pilot-schedule`, status=`active`, lagre | Lagret; viser gruppe-label i liste |
| A7 | Naviger `#/gameManagement`, velg type=`Spill 1`, klikk "Legg til spill" | Add-form åpnes |
| A8 | Fyll ut name=`Pilot-bingo`, velg farger `Small Yellow` + `Small White`, priser 20/40 NOK, pattern-matrise med minst 1 `percent` per farge (f.eks. Row1=10%, FullHouse=50%), jackpot=`Fullt Hus draw 55`, Elvis-replace=0, lucky-prize=500, lagre | Suksess-toast, redirect til liste |
| A9 | Vent 1 minutt, sjekk at `Game1ScheduleTickService` har spawnet `scheduled_games`-rad for morgendagen | `SELECT * FROM app_game1_scheduled_games WHERE scheduled_start_time > now()` returnerer 1 rad |

**Spiller-flyt (dag 1 pilot):**

| # | Steg | Forventet |
|---|---|---|
| S1 | På pilot-dag, 30 min før scheduled start: sjekk at master-konsoll `#/admin-game1/<gameId>` laster | Status = `purchase_open` |
| S2 | Spiller 1 logger inn i web-shell i hall A, ser schedule-kort i lobby | Kort vises med start-tid + kjøp-knapp |
| S3 | Spiller 1 kjøper 1 bong av farge `Small Yellow` | Wallet trekkes 20 NOK, bong-preview vises |
| S4 | Spiller 2 logger inn i hall B, kjøper 1 bong av farge `Small White` | Wallet trekkes 40 NOK |
| S5 | Master-konsoll: begge haller viser `halls-ready` = `venter` → hall-operator trykker "Klar" i hver hall | Badge blir `klar` for begge |
| S6 | 10 min før start, master-konsoll: "All Ready" = JA, Start-knappen enabled | Grønn badge |
| S7 | Klikk "Start" på master-konsoll | Status = `running`; første draw-event innen seconds-settingen (f.eks. 5s) |
| S8 | Observer draw-loop i begge klienter, per-fase-win når pattern fylles | `pattern:won`-event sendt én gang per fase med `winnerIds[]` inkludert |
| S9 | Hvis spiller 1 vinner Row 1 på Small Yellow og spiller 2 vinner Row 1 på Small White i samme draw → begge får sin farges payout | To separate claims, to wallet-kreditter (Option X) |
| S10 | Reconnect-test: spiller 1 refresher siden under fase 3 | Snapshot viser Row 1 + Row 2 som alt vunnet, ingen event-replay |

**Master-kontroll-scenarioer:**

| # | Steg | Forventet |
|---|---|---|
| M1 | Under `purchase_open`: PM ekskluderer hall C via master-konsoll + oppgi reason | Status hall C = `ekskludert: <reason>`; nye bong-kjøp fra hall C blokkeres |
| M2 | Under `running`: trykk "Pause" + reason | Status = `paused`, auto-draw stoppet |
| M3 | Under `paused`: trykk "Resume" | Status = `running`, draw fortsetter fra neste ball |
| M4 | I en test-kjøring: trykk "Stop" + reason | Status = `cancelled`; refund-progress-events flyter inn; alle digitale bonger refunderes; §11-audit-entry per refund |

**Pass/fail-kriterier per testbolk:**

- **Pre-flight P1-P5:** Alle må pass. Én rød = stopp piloten.
- **Admin A1-A9:** Alle må pass. A3 = GroupHall-UI mangler ⇒ pilot-blokker.
- **Spiller S1-S10:** S1-S8 må pass. S9-S10 er "nice-to-have" validering — dokumenter avvik, ikke nødvendigvis pilot-stopp.
- **Master M1-M4:** M4 (stop + refund) må pass i minst 1 test-kjøring før pilot.

### 4.2 Rollback-prosedyrer

Leveres som egen seksjon i runbook:

**Scenario R1 — Scheduled-game spawner ikke:**
1. Sjekk logger for `Game1ScheduleTickService`-feil
2. Verifiser `otherData.scheduleId` er satt på DailySchedule-raden
3. Hvis bug: manuelt insert `app_game1_scheduled_games`-rad via SQL (template i runbook)

**Scenario R2 — Master-konsoll viser "All Ready = NEI" men alle haller har trykket klar:**
1. Åpne network-tab, se om `/api/admin/game1/:id` returnerer riktig `halls[]`
2. Hvis backend sier NEI: sjekk `app_game1_hall_ready` + verifiser `is_ready=true`
3. Hvis UI-bug: force-refresh (F5). Hvis ikke løst: bruk `POST /api/admin/game1/:id/start` direkte via curl med `excludedHallIds` satt til ikke-klare haller.

**Scenario R3 — Stop + refund mislykket delvis:**
1. Master-konsoll viser `stop_reason='refund_failed_partial'`
2. Åpne audit-log for game_id, finn `refund`-entries med `failed=true`
3. Manuell refund per purchase via `POST /api/admin/game1/purchases/:id/refund` (endpoint må eksistere — verifiseres i PR 4d.4)
4. Når alle refundert: oppdater `stop_reason='refund_complete'` via SQL (audit-trail bevart)

**Scenario R4 — Spiller-klient kan ikke joine rom (scheduledGameId ukjent):**
1. Sjekk at `scheduled_games.room_code` er satt (PR 4d.1)
2. Hvis NULL: manuell `UPDATE app_game1_scheduled_games SET room_code = ? WHERE id = ?` med unikt rom-kode
3. Be spiller reconnecte — skal nå joine via lazy-init-pathen

**Scenario R5 — Full pilot-stopp (escape hatch):**
1. PM trykker Stop på alle aktive scheduled-games via master-konsoll
2. Oppdater alle DailySchedule-rader for dagen til `status='inactive'`
3. Kommuniser til pilot-haller: "Bingo-tjenesten er midlertidig utilgjengelig, kommer tilbake"
4. Post-mortem: kjør recovery-service (`Game1RecoveryService`) for å dokumentere state

## 5. Sub-PR-struktur

| Sub-PR | Scope | LOC | Dager |
|---|---|---|---|
| 4e.1 | GroupHall admin-UI (list + form) + API-adapter + sidebar-entry | ~600 | 1.5 |
| 4e.2 | DailyScheduleEditor hall-pickers + ScheduleEditor subGames-help + MasterConsole polish | ~500 | 1 |
| 4e.3 | Pilot-QA-runbook + rollback-prosedyrer (markdown only, ingen kode) | 0 kode / ~600 docs | 1 |
| **Totalt** | | **~1100 kode + 600 docs** | **3.5** |

Hver sub-PR leveres separat med rapport-før-kode-gate mellom hver (PM-flyt per `feedback_git_flow.md`).

**Bundle-vurdering:** 4e.1 + 4e.2 bundles ikke — 4e.1 er blokker-pilot-fix, 4e.2 er kvalitets-polish. 4e.3 må være sist siden runbooken skal referere til den live versjonen av UI-ene etter 4e.1+4e.2.

## 6. Avhengigheter

- **4e.1 GroupHall-UI:** Uavhengig av 4d. Kan starte umiddelbart etter PM-GO.
- **4e.2 DailySchedule + MasterConsole polish:**
  - Soft-dep på Agent 1's **PR 4d.3** (master-konsoll socket-konvertering): 4e.2-polish av master-konsoll må skrives slik at den **ikke bryter** socket-konvertering. Anbefaling: 4e.2 leveres *etter* 4d.3 merget, slik at MasterConsole-polish sitter på toppen av socket-versjonen.
  - Hard-dep på 4e.1: hall-picker i DailySchedule krever `listHallGroups()` API-adapter fra 4e.1.
- **4e.3 runbook:** Hard-dep på 4d + 4e.1 + 4e.2 merget. Runbooken testes mot live admin-UI-flyten og må reflektere den.

**Timeline-forslag:**
1. 4d.1 + 4d.2 (Agent 1) → 4d.3 + 4d.4 (Agent 1)
2. Parallelt: 4e.1 (denne PR-leveransen, Agent 2) — kan starte nå
3. Etter 4d.3 + 4e.1: 4e.2 (Agent 2)
4. Etter alt: 4e.3 (Agent 2 + PM manual-QA-validering)

## 7. Estimat

**Total kode:** ~1100 LOC across 4e.1 + 4e.2, ~600 docs i 4e.3.
**Kalendertid:** 3.5 dager med én agent, eller 2 dager hvis 4e.1 + 4e.3 kjøres parallelt med 4e.2.
**Risiko-buffer:** Legg 1 dag buffer for multi-select-UI-komponent-valg i 4e.1 (select2 vs HTML-native vs ny komponent).

## 8. Åpne spørsmål til PM

1. **GroupHall multi-select-komponent:** Ny `<select2>`-basert, HTML-native `<select multiple>`, eller checkbox-liste? Legacy bruker select2, men det drar inn jQuery. Anbefaling: HTML-native for pilot, upgrade senere.
2. **GameManagement edit-path:** Skal PR 4e.2 legge til edit-path for eksisterende Spill 1-spill, eller er "slett + re-lage" akseptabel workaround for pilot? Edit-path er ~400 LOC ekstra.
3. **Refund-preview i stop-dialog (§3.2.5 punkt 2):** Lade i 4e.2 eller utsette til post-pilot? Krever ny backend-endpoint ~100 LOC.
4. **PR 4e.2 timing:** Skal 4e.2 vente på Agent 1's 4d.3 (master-konsoll-socket), eller leveres parallelt med manuell merge-conflict-håndtering?
5. **Pilot-runbook distribusjon:** Skal runbooken være intern (kun `docs/qa/`) eller også sendes til pilot-hallene i en forenklet versjon? Sistnevnte krever ekstra "hall-operator-quick-start".
6. **Sidebar-plassering:** Under eksisterende "Spill"-meny eller ny top-level "Administrasjon → Hall-grupper"? Avhenger av om PM vil skille spill-drift fra systemadministrasjon.
7. **SubGames-editor i ScheduleEditor:** Er minimum (JSON-textarea + eksempel + "test JSON"-knapp) nok for pilot, eller bør 4e.2 legge til en 2-3 felt strukturert editor (gameManagementId-select + startTime + endTime per subgame)? Sistnevnte er ~150 LOC.

## 9. Notater + referanser

- 4d-design er forutsetning for 4e — særlig master-konsoll-socket (4d.3) og stop-refund (4d.4).
- PR #311 (admin-form) + PR #323 (admin-config-coupling) + PR #329 (backend per-farge-evaluation) gir fullt per-farge-loop som pilot trenger; 4e.2 må ikke forstyrre.
- `SPILL1_FULL_VARIANT_CATALOG` (13 varianter) er **post-pilot**. Pilot kjører basis-variant + trafikklys + per-farge + Elvis-ticket-mapping (visual Elvis-rendering er post-pilot).
- Known limitations fra `spill1-variantconfig-admin-coupling.md`: Bug 2 (scheduler-path per-farge-routing) manifesterer seg **ikke** i pilot fordi `Game1ScheduleTickService` leser legacy `ticketTypesData`. Dette betyr pilot kjører på default-gevinster fra `DEFAULT_NORSK_BINGO_CONFIG` — **PM må bekrefte at dette er akseptabelt for pilot**, eller 4e må også inkludere scheduler-fix (utvider scope med ~1 dag + risiko).
- Test-strategi for 4e.1 + 4e.2: Vitest-komponenter-tester i `apps/admin-web/tests/games/` (mønstret etter `savedGameSchedulesPages.test.ts` + `schedulesAdminWire.test.ts`) + minst 2 integrasjonstest-scenarioer for GroupHall CRUD-flyt.
- Runbooken i 4e.3 bør inkludere en "pilot-avslutnings-prosedyre" som dokumenterer hva som må slettes/arkiveres etter pilot-uken + en data-export-liste for etter-pilot-analyse.

---

**Ikke-mål for PR 4e (eksplisitt):**
- Ingen backend-kode-endring (unntatt evt. minor hjelper som refund-preview hvis PM godkjenner)
- Ingen game-client-endring
- Ingen Unity-endring
- Ingen nye shared-types-schemas (bortsett fra evt. HallGroup-schema hvis det mangler i adapter-laget)
- Ingen socket-wire-contract-endring
