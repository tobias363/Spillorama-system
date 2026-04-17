# Unity Masterdata Restore Spec 2026-04-10

## Formål

Dette dokumentet beskriver hva som faktisk ma være til stede i legacy bingo-databasen for at Unity-lobbyen skal fungere som før.

Dette er ikke en seed-fil.
Dette er restore-spesifikasjonen som skal brukes for å:

- verifisere Atlas backup eller historisk dump
- vurdere om en database er god nok for recovery
- unngå å finne på produksjonsdata som ikke er autoritative

## Status

Atlas-databasen `ais_bingo_stg` er nå verifisert som:

- teknisk brukbar for login og hall-bootstrap
- utilstrekkelig for lobby og spillmasterdata

Konklusjon:

- login-laget er gjenreist
- schedule- og lobby-laget er ikke gjenreist

Ny kritisk observasjon etter direkte Atlas-verifisering 10. april 2026:

- `dailySchedule = 0`
- `schedules = 0`
- `assignedHalls = 0`

Det betyr at vi ikke bare mangler ferdige `parentGame`/`game`-dokumenter.
Vi mangler også schedule-laget som legacy runtime bruker til å generere deler av lobby- og spillstrukturen.

## A. Login og hall-bootstrap

Disse collectionene må være til stede for at `/web/`, `HallList`, `LoginPlayer` og `GetApprovedHallList` skal fungere:

### `setting`

Minst disse feltene brukes direkte:

- `android_version`
- `ios_version`
- `wind_linux_version`
- `webgl_version`
- `disable_store_link`
- `android_store_link`
- `ios_store_link`
- `windows_store_link`
- `webgl_store_link`
- `screenSaver`
- `screenSaverTime`
- `imageTime`
- `daily_spending`
- `monthly_spending`

### `hall`

Minst disse feltene må finnes for en aktiv hall:

- `_id`
- `name`
- `number`
- `status = "active"`
- `agents` må ikke være tom
- `groupHall`
- `hallId`

### `player`

Minst disse feltene må finnes for at login og hallvalg skal fungere:

- `_id`
- `username`
- `password`
- `status`
- `userType`
- `walletAmount`
- `points`
- `selectedLanguage`
- `isVerifiedByHall`
- `isAlreadyApproved`
- `hall`
- `approvedHalls`
- `groupHall`

Kritisk observasjon:

- `GetApprovedHallList` leser `player.groupHall`
- login-returnen leser `approvedHalls`
- spillflyten leser `player.hall.id`

Det betyr at alle tre må være konsistente.

### `gameType`

Minst disse feltene brukes i lobby:

- `name`
- `photo`
- `type`

Kritisk observasjon:

- `GameTypeList` prefikser normalt `profile/bingo/`
- hvis `photo` allerede inneholder dette prefixet, blir bildebane feil uten normalisering

## B. Schedule og hall-tilordning

Disse collectionene er autoritativ kilde for deler av legacy bingo-oppsettet.
Når de er tomme, kan ikke runtime bygge opp Game 1 og deler av lobbyen på korrekt måte.

### `dailySchedule`

Dette er den viktigste schedule-collectionen for runtimeen.

Minst relevante felt:

- `_id`
- `dailyScheduleId`
- `name`
- `status`
- `startDate`
- `endDate`
- `days`
- `groupHalls`
- `halls`
- `allHallsId`
- `masterHall`
- `startTime`
- `endTime`
- `specialGame`
- `otherData`

Kritiske observasjoner fra koden:

- `processDailySchedules()` leser `dailySchedule` direkte
- `createGame1FromSchedule()` bygger child games fra `dailySchedule` + `schedules`
- `allHallsId` og `groupHalls` må matche reelle haller

### `schedules`

Dette er schedule-malene som `dailySchedule` refererer til.

Minst relevante felt:

- `_id`
- `scheduleName`
- `scheduleType`
- `status`
- `subGames`
- `manualStartTime`
- `manualEndTime`
- `luckyNumberPrize`

Kritiske observasjoner:

- `subGames` må være komplett nok til å generere child games
- `scheduleType` påvirker hvordan start- og sluttider tolkes

### `assignedHalls`

Brukes for å binde daglige schedules til haller og group halls.

Minst relevante felt:

- `_id`
- `groupHallId`
- `groupHallName`
- `hallId`
- `hallName`
- `dailyScheduleId`
- `startDate`
- `endDate`
- `status`

## C. Lobby og tilgjengelige spill

Disse collectionene må være til stede for at `AvailableGames`, `Game2PlanList` og `Game3PlanList` skal gi reelle resultater.

### `parentGame`

Legacy runtime forventer parent games for særlig:

- `game_2`
- `game_3`
- ofte også `game_4`
- ofte også `game_5`

Minst disse feltene er relevante:

- `_id`
- `gameType`
- `gameTypeId`
- `gameName`
- `gameNumber`
- `ticketPrice`
- `luckyNumberPrize`
- `notificationStartTime`
- `days`
- `totalNoTickets`
- `minTicketCount`
- `seconds`
- `status`
- `subGames`
- `groupHalls`
- `halls`
- `allHallsId`
- `stopGame`
- `childGameList`
- `startDate`
- `endDate`
- `otherData`

Kritiske filterkrav fra koden:

- `status in ['active', 'running']`
- `stopGame = false`
- `allHallsId` må inneholde valgt hall
- `days.<dag>` må eksistere
- `childGameList` må finnes og ikke være tom for `AvailableGames`
- `otherData.isBotGame = false`

### `game`

Dette er child/spillrundene som faktisk listes i `Game2PlanList` og `Game3PlanList`.

Minst disse feltene må finnes:

- `_id`
- `parentGameId`
- `gameType`
- `gameName`
- `gameNumber`
- `ticketPrice`
- `players`
- `status`
- `allHallsId`
- `startDate`
- `otherData.isBotGame`

Kritiske filterkrav fra koden:

- `status = 'active'`
- `parentGameId` må matche valgt parent game
- `gameType = 'game_2'` eller `gameType = 'game_3'`
- `allHallsId` må inneholde spillerens hall

### `subGame`

Brukes av legacy flyt for Game 1 og varianter, samt videre runtime-data.

Minst disse feltene bør finnes i en autoritativ restore:

- `_id`
- `parentGameId`
- `gameType`
- `gameName`
- `gameNumber`
- `patternNamePrice`
- `ticketPrice`
- `day`
- `status`
- `players`
- `purchasedTickets`
- `withdrawNumberList`
- `currentPatternList`
- `allPatternArray`
- `betData`
- `otherData`
- `startDate`
- `graceDate`

### `subGame1`

Brukes som mønster-/variantmasterdata.

Minst disse feltene bør finnes:

- `_id`
- `subGameId`
- `gameType`
- `gameName`
- `patternRow`
- `ticketColor`
- `allPatternRowId`
- `status`

### `subGame5`

Brukes for Game 5.

Minst disse feltene bør finnes:

- `_id`
- `parentGameId`
- `gameType`
- `gameNumber`
- `status`
- `withdrawNumberArray`
- `winners`
- `groupHalls`
- `halls`
- `allPatternArray`
- `otherData`
- `startDate`
- `seconds`
- `withdrawableBalls`

## D. Øvrig UI- og driftsmasterdata

Disse collectionene er ikke nok alene til å starte lobbyen, men de er del av riktig bingo-masterdata og må vurderes i en full restore.

- `_id`
- `scheduleName`
- `scheduleType`
- `scheduleNumber`
- `luckyNumberPrize`
- `status`
- `subGames`
- `manualStartTime`
- `manualEndTime`

### `assignedHalls`

Må gjenopprettes fra dump dersom systemet tidligere brukte den til schedule-hall-binding.

Restore må bekrefte:

- hvilke felt som finnes per dokument
- hvordan de peker mot hall, agent og schedule

## D. UI- og støtte-masterdata

Disse collectionene er ikke første blokkere for login, men er del av en full restore:

- `background`
- `theme`
- `slotmachines`
- `agent`
- `user`
- `notification`

## E. Autoritativ recovery-sekvens

Riktig rekkefølge er:

1. Finn dump eller Atlas backup som inneholder disse collectionene med faktiske dokumenter.
2. Sammenlign mot denne restore-specen.
3. Gjenopprett til staging.
4. Kjør:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend
node scripts/audit_masterdata.js .env.recovery
./scripts/start_local_recovery.sh .env.recovery
node scripts/smoke_recovery_runtime.js http://127.0.0.1:4010 .env.recovery martin martin 1
```

5. Bekreft at:

- `GetApprovedHallList` returnerer hall
- `GameTypeList` returnerer riktige spilltyper
- `AvailableGames` ikke bare er `Closed`
- `Game2PlanList` returnerer faktiske runder
- `Game3PlanList` returnerer faktiske runder

## F. Dagens reelle blocker

Per 10. april 2026 er den faktiske blokkeren:

- det finnes ingen kjent autoritativ kilde til `parentGame`, `game`, `subGame*`, `schedules`, `assignedHalls`, `background`, `theme`, `slotmachines`

Det betyr at neste riktige arbeidsløp ikke er mer tilfeldig seeding.
Det er å hente ut riktig backup eller historisk dataeksport som matcher denne spesifikasjonen.
