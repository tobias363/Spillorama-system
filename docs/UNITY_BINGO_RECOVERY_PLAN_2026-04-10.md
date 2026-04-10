# Unity Bingo Recovery Plan 2026-04-10

## Formål

Dette dokumentet er styrende plan for a gjenreise legacy Unity-bingo pa riktig mate.

Målet er ikke bare a fa `/web/` til a laste.
Målet er a fa tilbake:

- riktig login-flyt
- riktig lobby-flyt
- riktige spill-lister og namespaces
- riktig database- og env-oppsett
- en driftbar Render-service som peker til riktig runtime og riktig database

Dette skal gjores uten a dra Candy-kode tilbake inn i aktiv `backend/`.

## Na-status

Følgende er verifisert 10. april 2026:

### 1. Legacy runtime kan bootes lokalt

Recovery-runtimeen i:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend`

starter lokalt under Node 18 nar den far:

- gyldig `MONGO_URI`
- `SESSION_SECRET`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- Redis lokalt

### 2. Atlas-tilkobling virker

`MONGO_URI` i:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/.env.recovery`

peker na til `ais_bingo_stg`, og Mongo-tilkoblingen fungerer.

### 3. Minimumsdata for login, hall og lobby-bootstrap er seedet i staging

Følgende finnes na i `ais_bingo_stg`:

- `setting = 1`
- `hall = 1`
- `player = 1`
- `pattern = 21`
- `gameType = 3`
- `dailySchedule = 1`
- `schedules = 1`
- `assignedHalls = 1`
- `parentGame = 2`
- `game = 2` for recovery-lobby, i tillegg til genererte `game_1` schedule-games

I tillegg er testspilleren knyttet til seedet hall, godkjent for spill i hallen, og recovery-bootstrapen oppretter lokale `game_2`/`game_3` parent- og child-games med fremtidige tider i `Europe/Oslo`.

### 4. Følgende runtime-kall er bevist lokalt

På lokal recovery-runtime `http://127.0.0.1:4010` er dette verifisert:

- `/web/` svarer `200`
- `HallList` svarer `success`
- `LoginPlayer` svarer `success`
- `GetApprovedHallList` svarer korrekt hall-liste
- `GameTypeList` svarer uten dobbelt bilde-prefix
- `AvailableGames` svarer med `Start at` for `game_2` og `game_3`
- `Game2PlanList` svarer med en faktisk `upcomingGames`-liste
- `Game3PlanList` svarer med en faktisk `upcomingGames`-liste nar smoke-klienten tvinger `forceNew`/`multiplex:false` per namespace
- `scripts/e2e_recovery_purchase_flow.js` passerer lokalt for `Game2` med kjøp, `SubscribeRoom` og kansellering
- `scripts/e2e_recovery_purchase_flow.js` passerer lokalt for `Game3` med kjøp, `SubscribeRoom` og kansellering

Det betyr at vi er forbi:

- host-feil
- websocket-handshake
- Mongo-autentisering
- grunnleggende login/hall-bootstrap
- minimumsdataene som trengs for a fa `game_2` og `game_3` synlige i lobbyen lokalt

Det som ikke er forbi er full parity med historisk bingo-produkt eller faktisk trekk/start/finish gjennom Unity-klienten.

### 5. Ny lokal Unity WebGL-build er i bruk

Recovery-hosten serverer na en ny lokal Unity WebGL-build i:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/public/web`

`StreamingAssets/build_info` pa recovery-hosten viser:

- `Build from Tobias sin MacBook Pro at 4/9/2026 12:34:42 PM`

Det betyr at videre recovery-verifisering na skjer mot en kjent lokal build og ikke mot en eldre, ukjent WebGL-pakke.

### 6. Faktisk Unity WebGL-flyt er verifisert i nettleser

Følgende er na bekreftet i selve Unity WebGL-klienten mot lokal runtime:

- splash -> login virker
- login -> lobby virker
- lobbyen renderer `Candy Mania`, `Recovery Game 2` og `Recovery Game 3`
- `Recovery Game 2` kan apnes fra lobbyen
- billettkjop i `Recovery Game 2` fungerer i selve Unity-klienten

Dette er sterkere enn ren socket-smoke, fordi det bekrefter at recovery-runtimeen og den lokale WebGL-builden faktisk spiller sammen gjennom UI-laget.

### 7. Siste post-login-crash var en manglende statisk thumbnail

Den siste konkrete crashen etter vellykket login var ikke en socket-feil eller en Unity-kodefeil.

Arsaken var at lobbyen lastet:

- `profile/bingo/candy-mania-thumb.png`

og recovery-hosten svarte med HTML i stedet for PNG fordi filen manglet.

Denne filen finnes na i:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/public/profile/bingo/candy-mania-thumb.png`

Etter at den ble lagt tilbake, sluttet lobbyen a krasje etter login.

## Det som fortsatt mangler

Dette er na hovedgapene:

### 1. Spill-masterdata mangler fortsatt utover recovery-bootstrap

I dagens staging-database er disse kritiske collectionene fortsatt tomme:

- `subGame = 0`
- `subGame1 = 0`
- `subGame5 = 0`
- `background = 0`
- `theme = 0`
- `slotmachines = 0`
- `agent = 0`

Konsekvens:

- recovery-bootstrapen kan vise `game_2` og `game_3`, men det er fortsatt ikke historisk komplett bingo-oppsett
- Game 1, bakgrunner, theme-data, slotmachines og admin-drevet schedule-oppsett er fortsatt ikke tilbakefort
- Unity-lobbyen er derfor ikke "som for" ennå, selv om de grunnleggende namespace-listene na virker lokalt

### 2. `gameType` er ikke komplett

`gameType` inneholder na bare recovery-settet:

- `Candy Mania`
- `Recovery Game 2`
- `Recovery Game 3`

Konsekvens:

- `GameTypeList` kan ikke gjenskape opprinnelig Spillorama-lobby
- vi mangler minst de historiske bingo-spilltypene Unity forventer a vise

### 3. Production-env er ikke gjenreist

For full parity trengs ikke bare Mongo og Redis. Legacy runtime refererer ogsa til:

#### Kritiske for boot og auth

- `MONGO_URI`
- `SESSION_SECRET`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `DB_CONNECTION_TYPE`
- `PORT`

#### Kritiske for drift i miljoløsning

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_TLS`
- `REDIS_PREFIX`

#### Kritiske for full bingo-funksjon, betaling eller integrasjoner

- `MSSQL_DB_SERVER`
- `MSSQL_DB_DATABASE`
- `MSSQL_DB_PORT`
- `MSSQL_DB_USERNAME`
- `MSSQL_DB_PASSWORD`
- `SMTP_EMAIL`
- `SMTP_PASSWORD`
- `DEFAULT_ADMIN_USER_LOGIN_EMAIL`
- `DEFAULT_ADMIN_USER_LOGIN_PASSWORD`
- `VERIFONE_*`
- `IDKOLLEN_*`
- `METRONIA_*`
- `FIREBASE_*`
- `SVEVE_*`

Dette betyr at "Mongo virker" ikke er nok for produksjon.

## Riktig gjennomføringsplan

### Fase 1. Frys databasen og ta backup

Dette ma skje før mer seed eller videre migrering:

1. Ta eksport av `ais_bingo_stg`.
2. Dokumenter dagens counts i alle collections.
3. Merk tydelig hva som er seedet manuelt 10. april 2026.

Målet er a unnga at videre arbeid gjøres pa en database vi ikke kan rulle tilbake.

Status:

- backup-script finnes i `unity-bingo-backend/scripts/backup_mongo_db.js`
- dokumentert backup finnes i `unity-bingo-backend/recovery-backups/ais_bingo_stg_2026-04-10T15-23-23-782Z`

### Fase 2. Etabler "golden config" for legacy runtime

Det skal finnes ett autoritativt sett med env-vars for recovery-runtimeen.

Det betyr:

1. Lag en ren env-mal for `unity-bingo-backend`.
2. Del env i tre lag:
   - boot/auth
   - gameplay/runtime
   - tredjepartsintegrasjoner
3. Avklar hvilke verdier som er obligatoriske for:
   - lokal test
   - staging Render-service
   - live drift

Ingen flere ad hoc-manipulasjoner av env pa Render før denne listen er etablert.

Status:

- env-matrisen er dokumentert i `docs/UNITY_RECOVERY_ENV_MATRIX_2026-04-10.md`
- lokal oppstart er standardisert i `unity-bingo-backend/scripts/start_local_recovery.sh`

### Fase 3. Gjenopprett masterdata

Dette er den viktigste databasedelen.

Det riktige er:

1. Finn faktisk historisk bingo-dump eller backup.
2. Gjenopprett schedule-laget og masterdata inn i staging.
3. Bruk manuell seed bare for det som mangler i dumpen, ikke som hovedstrategi.

Masterdata som ma inn:

- `setting`
- `hall`
- `gameType`
- `dailySchedule`
- `schedules`
- `assignedHalls`
- `parentGame`
- `game`
- `subGame`
- `subGame1`
- `subGame5`
- `background`
- eventuelle `theme`- og `slotmachines`-data som brukes i UI eller spillflyt

Hvis dump ikke finnes, ma vi bygge en eksplisitt seed-plan collection for collection.
Det skal da gjøres som en kontrollert migrering, ikke via tilfeldige enkeltdokumenter i Atlas UI.

Status:

- minimumsseed er na kodifisert i `unity-bingo-backend/scripts/seed_minimum_recovery.js`
- masterdata-audit er na kodifisert i `unity-bingo-backend/scripts/audit_masterdata.js`
- audit viser fortsatt `parentGame = 0`, `game = 0`, `subGame* = 0`, `schedules = 0`, `assignedHalls = 0`, `background = 0`, `theme = 0`, `slotmachines = 0`

### Fase 4. Bekreft Unity-login og lobby lokalt

Følgende smoke-tester skal passere lokalt før Render:

1. `GET /web/` gir `200`
2. `HallList` gir minst én aktiv hall
3. `LoginPlayer` gir `success`
4. `GetApprovedHallList` gir korrekt hall-liste
5. `GameTypeList` gir forventede spilltyper
6. `AvailableGames` gir forventede statusverdier
7. `Game2PlanList` gir planliste når relevante spill finnes
8. `Game3PlanList` gir planliste når relevante spill finnes
9. `scripts/e2e_recovery_purchase_flow.js` passerer for `LoginPlayer`, `Game2`, `Game3`, kjøp, `SubscribeRoom` og kansellering

Deretter skal Unity WebGL faktisk testes i nettleser mot denne lokale runtimeen.

Status:

- smoke-test er na kodifisert i `unity-bingo-backend/scripts/smoke_recovery_runtime.js`
- lokal E2E er na kodifisert i `unity-bingo-backend/scripts/e2e_recovery_purchase_flow.js`
- steg 1 til 9 er teknisk bekreftet for `game_2` og `game_3`
- faktisk Unity WebGL-login, lobby og `Recovery Game 2`-kjop er na bekreftet i nettleser
- neste faktiske verifisering er trekk/start/finish i Unity WebGL, og tilsvarende manuell UI-verifisering av `Recovery Game 3`

### Fase 5. Opprett dedikert Render-service for legacy Unity bingo

Dette skal ikke presses tilbake inn i den nye `backend/`.

Riktig modell er:

1. Egen Render-service for `unity-bingo-backend`
2. Eget Render-env-sett for legacy bingo
3. Egen Mongo-tilkobling
4. Egen Redis-tilkobling eller avklart delt Redis med isolert prefix

Root/service-navn ma tydelig vise at dette er Unity bingo-runtime og ikke Candy og ikke den nye room-baserte backend-en.

### Fase 6. Koble `/web/` til riktig runtime

Nar staging-runtimeen er verifisert:

1. Pek `/web/`-hosten til riktig legacy runtime
2. Test WebGL-lobby, login og game selection
3. Test minst ett faktisk spill-løp

Først da skal produksjonskutt vurderes.

## Ikke gjør dette

Dette er eksplisitte ikke-mal:

- Ikke bland legacy bingo-runtime tilbake inn i aktiv `backend/`
- Ikke bruk `candy-db`
- Ikke seed prod manuelt i Atlas UI som hovedstrategi
- Ikke bygge ny WebGL som første løsning uten riktig backend/runtime-data
- Ikke deploye til Render før lokal runtime + staging-data er verifisert

## Konkrete neste steg

Dette er neste riktige arbeidsrekkefølge:

1. Ta backup av `ais_bingo_stg`
2. Dokumenter alle seedede staging-endringer gjort 10. april 2026
3. Finn historisk dump eller annen kilde for `game`, `schedule`, `gameType` og hall-masterdata
4. Gjenopprett disse i staging
5. Behold den lokale WebGL-builden og recovery-hosten i sync
6. Test faktisk Unity WebGL mot `http://127.0.0.1:4010/web/`
7. Verifiser trekk/start/finish og minst ett komplett spill-løp
8. Kjor manuell UI-verifisering av `Recovery Game 3`
9. Forbered egen Render-service for `unity-bingo-backend`

## Beslutning

Per 10. april 2026 er riktig strategi:

- beholde `unity-bingo-backend` som isolert recovery-runtime
- bruke `ais_bingo_stg` som staging-database for recovery
- gjenopprette masterdata systematisk
- flytte til egen Render-service nar lokal og staging-test er komplett

Dette er den tryggeste veien for a fa systemet tilbake "slik det var", uten a introdusere nye sammenblandinger mellom legacy bingo, ny backend og Candy.
