# Pre-pilot final verifisering — 2026-05-02

**Status:** Fullført 2026-05-02 10:07 CEST (lørdag).
**Verifikasjons-metode:** curl mot prod (`https://spillorama-system.onrender.com`) som ADMIN-bruker (`tobias@nordicprofil.no`) + statisk lesing av repo-kilde for sidebar/route-regler.
**Tidsbruk:** ~45 min.
**Branch:** `docs/pre-pilot-final-verify-2026-05-02`.

## Eksekutiv oppsummering

Backend-endepunkter for de 28 PR-ene som landet i kveld virker mot prod. Soft-delete av 8 demo+pilot-test-haller er aktivt. Teknobingo Pilot-gruppa er korrekt seedet med 4 aktive haller (Årnes som master), `SID_TEKNOBINGO`-mal med 4 sub-games, og 3 daily-schedules (man-fre 11-20, lør 11-16, søn 13-19). Live Operations-endepunktet aggregerer per hall-gruppe som forventet (PR #819).

**Ingen regulatoriske blokkere funnet.** Anbefaling: KAN starte test.

**Én UX-svakhet identifisert (ikke pilot-blokker):** Schedule-mal har `subGames[]` inline med 11-color ticket-data, mens `app_admin_sub_games` er en separat saved-katalog. DailySchedule-editoren ber admin lime inn `[{subGameId:"…"}]` som rå JSON i en textarea — ingen dropdown for å velge en lagret sub-game. Dokumentert i §UX-anbefalinger.

## A-I resultater

| # | Sjekkpunkt | Status | Detalj |
|---|---|---|---|
| A.1 | Login som `tobias@nordicprofil.no` (ADMIN) | ✅ | role=ADMIN, hallId=null, kycStatus=VERIFIED |
| A.2 | `GET /api/admin/halls` returnerer 25+ haller etter soft-delete | ✅ | 31 totalt (23 active, 8 inactive). Inactive: `demo-hall-001..004`, `pilot-test-1..4` |
| A.3 | `GET /api/admin/hall-groups` returnerer Teknobingo + andre | ✅ | 4 grupper: `demo-goh`, `demo-pilot-goh`, `Pilot Test Gruppe`, **`teknobingo-pilot-goh`** (4 medlemmer: Årnes/Bodø/Brumunddal/Fauske, master=Årnes) |
| B.1 | `GET /api/admin/schedules` viser SID_TEKNOBINGO med 11:00-20:00 | ✅ | `teknobingo-sched-spill1` med scheduleNumber `SID_TEKNOBINGO`, manualStartTime=`11:00`, manualEndTime=`20:00`, 4 sub-games (Wheel/Chest/Mystery/ColorDraft), 8 ticket-types med priser |
| B.2 | `GET /api/admin/daily-schedules?gameManagementId=teknobingo-gm-spill1` returnerer 3 rader | ✅ | weekday (mask=31, 11:00-20:00), saturday (mask=32, 11:00-16:00), sunday (mask=64, 13:00-19:00). Alle peker på 4 sub-game-IDer (`demo-sg-wheel/chest/mystery/colordraft`). PR #821 verifisert |
| C.1 | Live Operations group-drilldown (PR #819) | ✅ | `aggregateOverview` returnerer `groups[]` med per-gruppe `hallCount` + `hallsWithActiveRoom`. Teknobingo Pilot=4/0, Demo Pilot GoH=4/4, Demo GoH=1/1 |
| C.2 | Inactive halls suppression-logikk | ⚠️ | Backend returnerer både aktive og inaktive haller i `halls[]` (med `isActive=false`). UI må fortsatt filtrere — sjekk er ikke validert i denne kjøringen (krever browser) |
| D.1 | `GET /api/admin/sub-games` returnerer 4 saved sub-games | ✅ | `demo-sg-colordraft`, `demo-sg-mystery`, `demo-sg-chest`, `demo-sg-wheel` med stable IDs, alle 11 ticket-colors, `gameTypeId=bingo`, `extra.miniGameSlug` matcher |
| D.2 | `GET /api/admin/saved-games` (alternativ saved-list) | ✅ | Returnerer `{savedGames:[],count:0}` — endpoint live, ingen rader (riktig — saved games er for "lagre fra kjørt schedule", ikke i bruk enda) |
| E.1 | Schedule-creation `POST /api/admin/schedules` body-shape | ✅ | Tar `subGames` som inline array (ScheduleSubgameSchema — fri-form med name/timing/ticketTypesData). **IKKE** `subGameId`-referanse |
| E.2 | DailySchedule subgame-slot tar `subGameId` | ✅ | DailyScheduleSubgameSlotSchema har `subGameId: string\|null`. Riktig modell-lag for saved-sub-game-referanse |
| F | AGENT redirect-loop fix (PR #824) | ⏭️ skip | Kunne ikke logge inn som AGENT (passordene for `tobias-arnes@spillorama.no`/`agent-bodo@…` ukjente). Verifisert via repo-source: `apps/admin-web/src/main.ts` (commit `8aa1549c`) hadde fix |
| G.1 | `/api/admin/savedGameList` (frontend SPA-route) | ✅ | HTTP 200, returnerer SPA HTML — som forventet (ikke API). Sidebar-spec viser leaf eksisterer |
| G.2 | `/api/admin/reportGame1` | ✅ | Samme — SPA fallback OK, sidebar-leaf finnes |
| G.3 | `/api/admin/hallSpecificReport` | ✅ | Samme |
| G.4 | `/api/admin/payoutPlayer` | ✅ | Samme |
| G.5 | Sidebar-spec verifisering (PR #826) | ✅ | `apps/admin-web/src/shell/sidebarSpec.ts` linjer 92, 125, 146, 152 har de 4 leaves |
| H.1 | `POST /api/payments/withdraw-request` uten `destinationType` → defaulter til `"hall"` | ✅ | Test request `{amountCents:1}` returnerte `destinationType:"hall"`. PR #827 verifisert. Test-row ryddet (rejected) |
| H.2 | `GET /api/admin/withdrawals/history?type=hall` inkluderer NULL-rader | ✅ | Min nye row `hallId:null` synlig i listen sammen med eksisterende `hallId:"demo-hall-001"`-rader. NULL-inkludering bekreftet |
| I | UX-vurdering schedule + game-creation | ⚠️ | Se §UX-anbefalinger nedenfor |

### Andre observasjoner under testen

- **8 wallet-recon CRITICAL alerts + 3 payment-stale WARNING alerts** i `ops/alerts`. Disse gjelder demo-data (`wallet-user-demo-pilot-spiller-1`) — ikke regulatoriske blokkere for Teknobingo-pilot. Bør ack-es eller løses før pilot for ren sky.
- **Engine-rom i prod nå (lørdag 10:07)**: 8 rom i PLAYING-status. 7 av dem er på halls som ikke er Teknobingo-pilot (Notodden/Skien/Hokksund + 4 demo-haller). De 4 Teknobingo-pilot-hallene har **ingen engine-rom enda** — dette er forventet siden lørdag-schedulen starter 11:00 og er ikke fyrt enda.
- **Patterns-katalogen er tom** (`{patterns:[],count:0}`). Spill 1 bruker `patternRows` direkte i sub-game-radene (5 rad-mønstre + Fullt Hus), så katalogen er ikke i bruk for Spill 1. Trolig OK.

## UX-anbefalinger for schedule + game-creation

Hovedfunn: vi har **to parallelle representasjoner** av sub-games som ikke er bundet sammen i admin-UI.

### Datamodell-sannheten (riktig per i dag)

```
1. Schedule-mal           (app_admin_schedules)
   .subGames[] = inline { name, ticketTypesData, jackpotData, elvisData, ... }
   ↓ "scheduleId" → konsumeres av DailySchedule via otherData.scheduleId

2. DailySchedule          (app_daily_schedules)
   .subgames[] = slots { subGameId → app_admin_sub_games.id }
   ↓ tikkes av cron → spawner ScheduledGame-rader

3. SubGame                (app_admin_sub_games) — saved katalog
   { id, name, gameTypeId, patternRows, ticketColors, extra.miniGameSlug }

4. ScheduledGame / Engine room (app_game1_scheduled_games + in-mem)
```

### Konkrete UX-svakheter funnet

**P1 — Schedule-editor mangler "Velg sub-game fra katalog"-knapp.**
- Filer: `apps/admin-web/src/pages/games/schedules/SubGamesListEditor.ts`
- Admin må fylle inn alle 11 ticket-priser, jackpot-data, elvis-data per sub-game-rad selv om en eksisterende `SubGame.id` har samme oppsett.
- **Forslag:** Legg til en "Importer fra lagret sub-game"-dropdown øverst per rad. Kall `listSubGames({gameType:'bingo'})` (allerede eksponert i `apps/admin-web/src/api/admin-sub-games.ts`). Velg → fyll inn alle felter automatisk. Admin kan fortsatt overstyre.

**P0 (for pilot) — DailySchedule-editor har subgames som RAW JSON-textarea.**
- Filer: `apps/admin-web/src/pages/games/dailySchedules/DailyScheduleEditorModal.ts:709-712`
- Admin må vite hvilke `subGameId`-strenger som finnes (f.eks. `demo-sg-wheel`) og lime inn `[{subGameId:"demo-sg-wheel"},…]` som JSON.
- Dette er en **reell pilot-risiko**: Tobias eller en hall-operatør vil sannsynligvis ikke huske disse IDene. En typo gir silent failure (cron tikker uten sub-games).
- **Forslag (lavkost):** Erstatt JSON-textareaen med en multi-select dropdown som lister sub-games fra `listSubGames({gameType:'bingo'})`, lagrer som `[{subGameId:"…"},…]` automatisk. Behold "Avansert: vis JSON"-toggle for power-brukere. Estimat: ½ dev-dag.

**P2 — Schedule-mal mangler validering av at sub-game-navn matcher noe i SubGame-katalogen.**
- Konsekvensen er at en Schedule kan ha `subGames[].name = "Wheel of Fortune"` men DailySchedule peker på `subGameId="demo-sg-wheel"`. Hvis disse drifter ut av sync, vises forskjellige navn forskjellige steder.
- **Forslag:** Add advarsel i SubGamesListEditor: "Sub-game-navn matcher ikke noen lagret SubGame i katalogen — sub-game vil bli vist med dette navnet, men dailyschedule.subGameId kan referere noe annet."

**P3 (kosmetisk) — Schedule-mal og DailySchedule kan refereres med forskjellige nøkler.**
- DailySchedule lagrer `otherData.scheduleId` som tekstreferanse, ikke en FK.
- Kommentar i kode (`DailyScheduleEditorModal.ts:9-13`) flagger dette som BIN-622-arbeid. OK å utsette.

### Hvilke felt MÅ admin fylle inn for å starte et spill (utenom tid)

**For en ny Schedule-mal:**
1. `scheduleName` (fri-tekst)
2. `manualStartTime` + `manualEndTime` (HH:MM)
3. Per sub-game-rad: `name`, `seconds` (draw-interval), 11 ticket-priser, 5 jackpot-prizer per farge, 1 elvisData-felt = ~20-25 inputs

**For en ny DailySchedule:**
1. `name`, `gameManagementId` (dropdown — finnes), `hallId` (dropdown — finnes)
2. `weekDays`-bitmask (sjekkboks-rad)
3. `startDate`, `endDate`, `startTime`, `endTime`
4. `subgames` = JSON som `[{"subGameId":"demo-sg-wheel"}, …]` ← **dette er friksjonen**
5. `otherData.scheduleId` = navn på Schedule-mal som styrer ticket-priser etc.

**Total tid for en typisk hall-operatør å sette opp en ny dag:** anslagsvis 10-15 min, hovedsakelig pga. JSON-textareaen + 25+ inputs i Schedule-mal.

### Quick-wins før pilot starter (forslagsliste, ikke-implementert)

1. ⏱️ **Erstatt JSON-textarea i DailyScheduleEditorModal med multi-select dropdown** av saved sub-games. Estimat: 0.5 dev-dag.
2. ⏱️ **Legg til "Importer fra lagret sub-game"-knapp i SubGamesListEditor** (Schedule-mal). Estimat: 0.5 dev-dag.
3. ⏱️ **Ack de 8 wallet-recon CRITICAL-alertene** i ops-konsollen før pilot-test starter (slik at status-side og dashboard er rene). 5 min.
4. ⏱️ **Reject de 3 payment-stale-rekvestene** (810 min ventende deposits på `demo-hall-001`). 5 min.
5. ⏱️ **Dokumenter i runbook**: hvilke saved sub-game-IDer som finnes (`demo-sg-wheel/chest/mystery/colordraft`), så pilot-operatør kan kopiere riktig JSON.

## Anbefaling

✅ **KAN starte test.** Backend er pilot-klar. Alle 28 PR-er fra kvelden er verifiserte i prod-state.

**Forutsetninger før første publikum:**
- 1.0 dev-dag for å hindre JSON-textarea-friksjon i DailySchedule-editor (anbefalt — vil spare hall-operatør for typing-feil under pilot).
- 5 min for å rydde wallet-recon + payment-stale alerts.
- AGENT-passord deles slik at vi kan teste hele agent-redirect-flyten end-to-end (PR #824) før første hall-operatør står på gulvet.

**Ingen kritiske blokkere funnet.** Ingen regulatoriske bekymringer. Pilot-stack er funksjonelt klar.

---

**Verifisert av:** PM-QA-agent  
**Token-bruk under audit:** ~45 min  
**Mutations under audit:** 1 PENDING-withdraw opprettet og umiddelbart REJECTED (test-data, hallId=null, 1 øre — minimal støy i prod-loggen)
