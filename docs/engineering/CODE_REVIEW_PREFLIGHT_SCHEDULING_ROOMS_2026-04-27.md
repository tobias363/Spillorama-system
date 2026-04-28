# Pilot-kritisk Code Review — Pre-Flight + Scheduling + Room Mgmt

**Dato:** 2026-04-27
**Scope:** PR #661 pre-flight, scheduling-tabbene, room mgmt-flyt for Spill 1.
**Branch:** `docs/code-review-preflight-scheduling-rooms-2026-04-27`
**Reviewer:** code-reviewer agent (independent gate before pilot day)

## TL;DR

PR #661 lukker hovedhullet ("starte uten hall-gruppe / spilleplan") **kun for `POST /api/admin/rooms/:roomCode/start`**. Game1 master-pathen (`POST /api/admin/game1/games/:gameId/start`) og agent-pathen (`/api/agent/game1/...`) bypasser pre-flight komplett og kan starte uregistrerte trekninger på pilot-dagen. Bug var ikke fanget under PR #661-review.

I tillegg finnes 4 uavhengige drift-stoppere (P0): TOCTOU mellom pre-flight og `engine.startGame`, ingen sub-game-tids-overlap-validering i ScheduleService, `HallGroupService.isReferenced` har false-positive substring-match, og ingen prosent-sum-validering på pattern-config / per-color-winning. Hver enkelt kan ende dagen i support-eskalasjon.

**Anbefaling:** behold PR #661, men start K-bølge med 5 P0-fixer FØR pilot. Estimat: 1-2 dev-dager.

---

## P0 (pilot-blokkere)

### 1. Pre-flight bypass via Game1 master-path

**Severity:** P0
**File:** `apps/backend/src/routes/adminGame1Master.ts:246-322`

```
ISSUE: POST /api/admin/game1/games/:gameId/start kaller masterControlService.startGame
       UTEN å kalle roomStartPreFlightValidator.validate(hallId).
SAMSPILL: Game1MasterControlService.startGame, RoomStartPreFlightValidator,
          adminGame1Master, agentGame1
DRIFT-RISK: Akkurat den bug-en som triggret PR #661 kan fortsatt skje hvis
            agent (eller admin) starter via Game1-master endpoint i stedet
            for Room-start-endpoint. Pilot-dagen begynner trekning på et
            game1-game uten link/spilleplan. Resultat: tomtrekning, ingen
            audit-binding, "Uventet feil" resten av dagen — IDENTISK
            symptom som PR #661 prøvde å lukke.
FIX: I `adminGame1Master.ts:280` (rett etter `loadMasterHallId`):
  if (deps.roomStartPreFlightValidator) {
    await deps.roomStartPreFlightValidator.validate(masterHallId);
  }
  Tilsvarende i `agentGame1.ts` ved master-start-flyten.
TEST: New test i `adminGame1Master.test.ts` — "start with hall not in group
      → HALL_NOT_IN_GROUP" + "start with no schedule → NO_SCHEDULE_FOR_HALL_GROUP".
      Bør også integreres i Game1MasterControlService selv (defensive depth).
```

Same gap eksisterer i `apps/backend/src/sockets/adminHallEvents.ts` for
`admin:force-end` socket-paths som indirekte kan trigge restart-flyt.

### 2. TOCTOU mellom pre-flight og engine.startGame

**Severity:** P0
**File:** `apps/backend/src/routes/adminRooms.ts:189-227`

```
ISSUE: roomStartPreFlightValidator.validate() kjører i én DB-transaksjon
       (faktisk to separate queries), engine.startGame i en annen. Mellom
       de to call-sites kan en parallell admin-request fjerne hallen fra
       gruppen ELLER deaktivere alle daily_schedules. Pre-flight passerer,
       men trekning starter på en hall som NÅ er ugyldig.
SAMSPILL: RoomStartPreFlightValidator, HallGroupService.update,
          DailyScheduleService.update, engine.startGame
DRIFT-RISK: Lite sannsynlig i pilot (få samtidige admins), men hvis det
            skjer er det INGEN audit-trail som viser at hallen mistet
            gruppe-medlemskapet — pre-flight loggen sier "OK", engine.start
            committer trekningen, og rapportene forblir feil. Regulatorisk
            risiko.
FIX: Gjør pre-flight + engine.startGame atomisk: enten flytt validatoren
     INN i engine.startGame (transaction-aware), eller wrap begge i
     advisory-lock per hallId. Quick fix er å gjenta validatoren
     etter engine.startGame har committet (men da er det for sent —
     compensating rollback må kjøres). Beste fix: pass `Pool` med en
     felles transaksjon-client til validate() OG drawEngine.startGame.
TEST: Race-test der validate() returnerer OK, så fjernes hall fra gruppe,
      så engine.startGame kalles. Forventet: enten begge feiler eller
      begge committer. Aldri valid+invalid.
```

### 3. Ingen sub-game-tids-overlap-validering

**Severity:** P0
**File:** `apps/backend/src/admin/ScheduleService.ts:252-370` (assertSubgames)
**File:** `apps/backend/src/admin/DailyScheduleService.ts:420-485` (assertSubgames)

```
ISSUE: assertSubgames i begge services validerer kun at HH:MM er gyldig
       per slot, IKKE at slot[i].endTime <= slot[i+1].startTime. To
       sub-games med overlappende tider (eks: 19:00-20:00 og 19:30-20:30)
       passerer validering.
SAMSPILL: ScheduleService.create/update, DailyScheduleService.create/update,
          Game1ScheduleTickService.spawnUpcomingGame1Games (som spawner
          rader basert på malen)
DRIFT-RISK: Game1ScheduleTickService.spawnUpcomingGame1Games:620-665
            spawner én scheduled_game per sub-game-index. Hvis to
            spawnes samtidig på samme hall, kan begge gå i purchase_open
            samtidig — første som rekker `engine.startGame` "vinner"
            men andre forblir hengende i ready_to_start til
            cancelEndOfDayUnstartedGames sweeper det. Operatøren må
            manuelt ende det andre, mens spillere har kjøpt billetter
            på begge.
FIX: I `assertSubgames`, sortér på startTime og verifiser at
     slot[i].endTime <= slot[i+1].startTime. Cross-day-rull (23:00→01:00)
     må behandles separat:
       const sorted = [...slots].sort((a,b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
       for (let i=1; i<sorted.length; i++) {
         if (sorted[i-1].endTime > sorted[i].startTime) {
           throw new DomainError("INVALID_INPUT",
             `subGames[${i-1}].endTime overlapper subGames[${i}].startTime.`);
         }
       }
     Også: legg til `EXCLUDE USING gist` constraint i DB på
     `app_daily_schedules` for samme hall + tidssone.
TEST: New test "subGames med overlappende tider → INVALID_INPUT" og
      "subGames i feil rekkefølge → assertSubgames sortérer + valider".
```

### 4. HallGroupService.isReferenced false-positive substring-match

**Severity:** P0
**File:** `apps/backend/src/admin/HallGroupService.ts:637-660`

```
ISSUE: isReferenced bruker `hall_ids_json::text LIKE %groupId%`. UUID-format
       betyr at `groupId="abc"` matcher en hall_id som inneholder "abc"
       som substring. Hard-delete blokkeres feilaktig på en gruppe som
       faktisk ikke er i bruk; eller verre — passerer for en gruppe som
       ER referert (hvis subStrengen tilfeldigvis ikke matcher).
SAMSPILL: HallGroupService.remove({hard:true}), DailyScheduleService
DRIFT-RISK: I pilot:
            - False positive: admin kan ikke slette ubrukt gruppe →
              skal cascade til soft-delete uansett, men UX er rar.
            - False negative: admin tror gruppen er ubrukt, hard-deleter,
              og forelderen `app_daily_schedules.hall_ids_json.groupHallIds[]`
              peker på et navn som ikke lenger finnes. Pre-flight
              validator (#661) kan ikke matche gruppen til hallen og
              kaster HALL_NOT_IN_GROUP — pilot-blokker.
FIX: Bruk korrekt JSONB array-search istedenfor LIKE:
       `hall_ids_json @> jsonb_build_object('groupHallIds', jsonb_build_array($1::text))`
     Identisk pattern som `RoomStartPreFlightValidator:147` allerede bruker.
     Også: rens subgames_json LIKE-match samtidig.
TEST: Test der group-id "abc" får hard-delete og en eksisterende
      DailySchedule har hall_ids_json={hallIds: ["xabcy"]} (substring
      match). Med fix: hard-delete skal LYKKES (ikke referert). Uten
      fix: blokkeres feilaktig.
```

### 5. Ingen 100% sum-validering på pattern-percentage / per-color-winning

**Severity:** P0
**File:** `apps/backend/src/admin/ScheduleService.ts:307-321` (`ticketTypesData`, `jackpotData`, `extra.rowPrizesByColor`)
**File:** `packages/shared-types/src/ticket-colors.ts:151-179` (`validateRowPrizesByColor`)

```
ISSUE: ScheduleService.assertSubgames validerer at ticketTypesData /
       jackpotData / rowPrizesByColor er objekter, men IKKE at vinning-
       prosenter / antall-fordelinger summeres til 100%. Game1PayoutService
       leser prosenter ved payout-tid og kan dele ut 0% (alle tom) eller
       150% (cap-overskridelse) av pot.
SAMSPILL: ScheduleService.create/update → Game1PayoutService → ComplianceLedger
DRIFT-RISK: Regulatorisk: Lotteritilsynet krever at premie-utdeling er
            forutsigbar. Hvis pot underutbetales (sum < 100%) går
            differansen til "house" som ikke har grunnlag i en avtale
            med spillere. Hvis overutbetales (sum > 100%) går "huset"
            i underskudd som er regnskaps-rød.
FIX: I assertSubgames, etter validateRowPrizesByColor:
       if (slot.extra?.rowPrizesByColor) {
         for (const color of Object.keys(rowPrizesByColor)) {
           const sum = (rowPrizesByColor[color]?.row1 ?? 0) +
                       (rowPrizesByColor[color]?.row2 ?? 0) +
                       ... + fullHouse;
           if (Math.abs(sum - 100) > 0.01) {
             throw new DomainError("INVALID_INPUT",
               `rowPrizesByColor.${color} må summere til 100% (var ${sum}).`);
           }
         }
       }
     Hvis "rowPrizes" er kr-beløp ikke prosenter (uklart fra koden):
     krev at sum <= ticketPrice * antall_solgte_billetter. Dette er
     unhelpful uten run-time data — derfor må PRØVELSESVALIDERING
     skje på sub-game-creation OG runtime ved payout-tid.
TEST: Test "rowPrizesByColor summerer ikke til 100% → INVALID_INPUT".
      Eksisterende test for validateRowPrizesByColor har ingen sum-sjekk.
```

---

## P1 (polish — bør fikses pre-pilot men ikke blokkere)

### 6. Pre-flight kjører ikke for `isTestHall` bypass

**Severity:** P1
**File:** `apps/backend/src/game/RoomStartPreFlightValidator.ts:70-94`

```
ISSUE: Test-haller (is_test_hall=true) brukes til Demo Hall-flyten der
       Tobias kjører trekning uten å sette opp full link+spilleplan.
       Pre-flight blokkerer dette: HALL_NOT_IN_GROUP. Tobias mistet
       Demo Hall i PR #677 — dette gjør at PR #661+#677 sammen kan ende
       opp med å låse Demo Hall ute.
SAMSPILL: PlatformService.getHall (returnerer is_test_hall),
          BingoEngine.setRoomTestHall, RoomStartPreFlightValidator
DRIFT-RISK: Demo Hall-flyten fra PR #660 fungerer ikke uten manuell
            link-oppsett. PM må huske å sette opp link+plan før hver
            demo. Hvis ikke, popup "Hallen tilhører ikke en link" og
            demoen feiler.
FIX: I `validate(hallId)`, sjekk hall.is_test_hall først:
       const hall = await platformService.getHall(hallId);
       if (hall.isTestHall === true) {
         logger.info({ hallId }, "[pre-flight] bypass for test hall");
         return; // skip both checks
       }
     Krever at validator får tilgang til PlatformService — endre constructor.
TEST: Test "isTestHall=true → bypass — no DB queries to app_hall_groups".
```

### 7. ScheduleService.scheduleNumber genereres med ms-suffix kollisjons-toleranse via randomUUID-chunk

**Severity:** P1
**File:** `apps/backend/src/admin/ScheduleService.ts:377-387`

```
ISSUE: generateScheduleNumber returnerer SID_YYYYMMDD_HHMMSS_<8-tegn-uuid-chunk>.
       UUID-suffixet er kun 8 tegn (32 bits) — birthday-paradox-kollisjon
       ved ~65k schedules/sekund. I praksis null risiko, men admin-CRUD
       kan importere mange (Excel-bulk-import) og skape duplikat.
SAMSPILL: Schema unique constraint `schedule_number TEXT NOT NULL UNIQUE`
DRIFT-RISK: Lav. Hvis kollisjon: SCHEDULE_NUMBER_CONFLICT-error som
            vises til admin. Ikke pilot-stopper.
FIX: Bytt til full randomUUID() (36 tegn) eller bruk timestamp + nanoid.
TEST: ikke nødvendig.
```

### 8. CloseDayService recurring-pattern bruker UTC for "i dag" — DST-drift

**Severity:** P1
**File:** `apps/backend/src/admin/CloseDayService.ts:452-454, 1158-1163`

```
ISSUE: `todayIsoUtc()` brukes som default-startDate for recurring-pattern.
       Norsk hall-driver setter "alltid stengt mandager" i sommer (CEST,
       UTC+2) → patterns startet kl 23:01 lokal tid får UTC-dag = følgende
       dag → første mandag i pattern hopper.
SAMSPILL: CloseDayService.closeRecurring → Game1ScheduleTickService
          (som filtrerer mot close-day i spawn-flyt — sjekk om denne
          bruker samme UTC-tolkning)
DRIFT-RISK: En pattern som var ment å lukke "alle mandager fra 27.04"
            kan starte på "tirsdag 28.04" hvis admin lager pattern
            sent kvelden. Stengning skjer feil ukedag.
FIX: Bruk Europe/Oslo-zone for hall-tidssoner. Allerede dokumentert
     som "kjent avvik" i kode-kommentar (CloseDayService:447-451).
     Ikke pilot-blokker — admin kan justere startDate manuelt.
TEST: Test "createRecurring kl 23:30 lokal tid (CEST) → startDate = i morgen".
```

### 9. JobScheduler — ingen per-instans re-entrancy-guard for tick

**Severity:** P1
**File:** `apps/backend/src/jobs/JobScheduler.ts:87-118`

```
ISSUE: Hver job kjører via `setInterval(() => void tick(job), intervalMs)`.
       Hvis én tick tar lengre enn intervalMs (eks: scheduler-tick på 15s
       som tar 20s grunnet treg DB), starter neste tick før forrige er
       ferdig. Ingen in-process-lock mellom dem.
SAMSPILL: Game1ScheduleTickService (spawnUpcoming + transitionReadyToStart),
          mandatory-pause-tick, withdraw-XML-export, compliance-overskudd,
          wallet-reconciliation, idempotency-cleanup
DRIFT-RISK: Når Redis lock ER satt: lock prevents kollisjon på tvers av
            instanser, men ikke innenfor én. I praksis: SchemaInit-race i
            Game1ScheduleTickService.spawnUpcomingGame1Games hvis to ticks
            overlapper. INSERT med ON CONFLICT DO NOTHING beskytter mot
            duplikat-rader, men begge ticks "stjeler" arbeid og DB-CPU.
FIX: I `tick(job)`-funksjonen, holdt en Set<string>(running) og
     return tidlig hvis allerede running. Kombinert med Redis-lock for
     multi-instans-safety.
TEST: Test der tick simulert tar 20s og intervalMs=15s — sjekk at
      andre tick venter eller skipper.
```

### 10. SubGameService.isReferenced soft-fail kan tillate hard-delete av aktiv sub-game

**Severity:** P1
**File:** `apps/backend/src/admin/SubGameService.ts:619-626`

```
ISSUE: Hvis referent-query (mot app_daily_schedules) feiler, returneres
       `false` — "antar ingen referanser". Hard-delete vil deretter
       lykkes, og DailySchedule-rader peker på deleted SubGame-id.
SAMSPILL: SubGameService.remove({hard:true}), DailyScheduleService,
          Game1ScheduleTickService.spawnUpcoming
DRIFT-RISK: Hvis DB-error skjer (f.eks. transient), fail-open lar
            admin slette en sub-game som faktisk er bundet til en
            ScheduleSubgame. Når scheduler spawnes neste runde,
            DailySchedule.subgames_json peker på id som ikke finnes
            → spawn skipping eller engine-error.
FIX: Endre fail-open til fail-closed. Hvis isReferenced kaster, kast
     vidre — admin må retry'e:
       } catch (err) {
         logger.error({err}, "[BIN-621] referent-sjekk feilet");
         throw new DomainError("SUB_GAME_REFERENCE_CHECK_FAILED",
           "Kunne ikke verifisere referanser. Prøv igjen.");
       }
TEST: Test "DB-error i isReferenced → fail-closed".
```

---

## P2 (nice-to-have, post-pilot)

### 11. CloseDay yearly-pattern hopper over 29. feb i ikke-skuddår uten varsling

**Severity:** P2
**File:** `apps/backend/src/admin/CloseDayService.ts:888-903`

Pattern { type: "yearly", month: 2, day: 29 } i 2027 → 0 expanderte datoer,
men returnerer success med `expandedCount: 0`. Admin tror pattern fungerer.

### 12. ScheduleService manuelle start/end-tider auto-avledes — kan diverger fra subgames

**Severity:** P2
**File:** `apps/backend/src/admin/ScheduleService.ts:518-525`

`scheduleType=Auto` + manualStartTime ikke satt → kopierer
`subGames[0].startTime`. Senere `update({subGames: [...]})` uten å
oppdatere `manualStartTime` får drift mellom de to feltene.

### 13. DailyScheduleService.update — endDate validering kjører POST-update

**Severity:** P2
**File:** `apps/backend/src/admin/DailyScheduleService.ts:783-789`

`endDate < startDate`-sjekk i `update` skjer ETTER UPDATE-kommandoen er
committet. Kaster DomainError, men raden er allerede skrevet — neste
`get(id)` returnerer ugyldig state. Bør validere før update.

### 14. Ingen orphan-cleanup når hall fjernes fra gruppe MENS rom kjører

**Severity:** P2
**File:** `apps/backend/src/admin/HallGroupService.ts:412-509`

`update({hallIds: [...]})` erstatter hele medlems-listen. Hvis et rom kjører
trekning på en hall som blir fjernet, fortsetter rommet — men
ComplianceLedger kobler ikke lenger til riktig gruppe. Ingen advarsel.

---

## Cron-job-bekymringer (samlet)

1. **`game1ScheduleTick` interval=15s** — `transitionReadyToStartGames`
   kan ende opp å lese stale ready_to_start-rader hvis
   `cancelEndOfDayUnstartedGames` ikke har sweepet enda. Ikke kritisk.

2. **`detectMasterTimeout` 15min-grensen** — bare logger event, ingen
   auto-failover. OK for MVP.

3. **`compliance-overskudd kvartalsvis`** — ikke verifisert, men cron-
   queries som låser app_rg_compliance_ledger må kjøre OUTSIDE peak
   hour (22:00-08:00). Sjekk at den kjører om natten.

4. **`wallet-nightly-reconciliation`** — kombinert med outbox-pattern
   krever at idempotency-key TTL (90 dager) ikke sletter rader cron
   trenger. Sjekk timing.

5. **`mandatory-pause-tick`** — ikke gjennomgått her, men hvis denne
   kjører samtidig som master-start kan en spiller pauses MIDT i
   trekning. Kjent fra K-fix-2 list.

6. **`withdraw-XML-daily-export`** — ekstern e-post send, retries må
   være idempotent. PRE-pilot: verifiser at e-postservice retry ikke
   sender duplikat.

---

## Anbefalt prioritering

**Før pilot (1-2 dev-dager):**
1. P0 #1 — pre-flight i Game1Master + Agent paths
2. P0 #4 — HallGroupService.isReferenced JSONB array-search
3. P0 #5 — sum-validering rowPrizesByColor

**Pre-pilot men kan vente til pilot-dag morgen (2-4 timer):**
4. P0 #2 — TOCTOU minst dekket ved gjenta validate() etter engine.startGame
5. P0 #3 — sub-game tids-overlap

**Post-pilot, før første hall i prod:**
6. P1 #6 — isTestHall bypass
7. P1 #9 — JobScheduler re-entrancy
8. P1 #10 — SubGameService isReferenced fail-closed

**Ikke gjør før prod-rollout #2:**
9-14. P2 — alle.

---

## Tester som mangler

- `RoomStartPreFlightValidator` — integrasjons-test som setter opp ekte
  hall-grupper og daily-schedules (ikke kun mock-pool).
- `ScheduleService.assertSubgames` — overlap, sortering, percent-sum.
- `HallGroupService.isReferenced` — JSONB-substring false-positive case.
- `Game1MasterControlService.startGame` — pre-flight-integration regression test.
- `JobScheduler` — re-entrancy under treg DB.

