# Unity Runtime Blockers 2026-04-10

## Kort konklusjon

`/web/` stopper ikke lenger fordi host-siden eller Socket.IO-handshake feiler.

Den stopper fordi dagens `Spillorama-system`-backend ikke implementerer bingo-produktet som Unity-klienten faktisk er bygget mot.

Det betyr:

- en ny WebGL-build alene vil ikke løse dette
- dagens backend mangler store deler av Unity-kontrakten
- den gamle bingo-backenden krevde MongoDB, og den infrastrukturen finnes ikke lenger på aktiv Render-service

## Statusoppdatering etter Atlas recovery

Etter videre arbeid 10. april 2026 er følgende na bevist:

- Atlas-tilkobling til `ais_bingo_stg` fungerer
- minimumsdata for `setting`, `hall`, spiller-hall-godkjenning og lobby-bootstrap er seedet i staging
- legacy runtime i `unity-bingo-backend/` booter lokalt under Node 18
- `/web/` svarer `200` lokalt nar runtime startes fra riktig working directory
- `HallList` svarer `success`
- `LoginPlayer` svarer `success`
- `GetApprovedHallList` svarer `success`
- `GameTypeList` svarer `success` uten dobbel bildebane
- `AvailableGames` svarer med `Start at` for `game_2` og `game_3`
- `Game2PlanList` svarer med `upcomingGames`
- `Game3PlanList` svarer med `upcomingGames` nar smoke-klienten tvinger ny Socket.IO-transport per namespace
- `dailySchedule`, `schedules`, `assignedHalls`, `parentGame` og recovery `game` er seedet i staging
- lokal E2E passerer for `Game2` gjennom kjøp, `SubscribeRoom` og kansellering
- lokal E2E passerer for `Game3` gjennom kjøp, `SubscribeRoom` og kansellering
- recovery-hosten serverer en ny lokal Unity WebGL-build med `build_info` fra `Tobias sin MacBook Pro at 4/9/2026 12:34:42 PM`
- faktisk Unity WebGL-login virker i nettleser mot recovery-runtimeen
- lobbyen renderer etter login uten runtime-crash
- `Recovery Game 2` kan apnes fra lobbyen og billettkjop fungerer i selve Unity WebGL-klienten

Det betyr at recovery-sporet er riktig.

Det som fortsatt mangler er ikke grunnmur, men full parity-data for faktisk historisk lobby og spill, pluss verifisering av trekk/start/finish i Unity-klienten:

- `subGame*`
- komplett `gameType`
- `background`
- `theme`
- `slotmachines`
- øvrige bingo-data som gjør at lobby og planlister ser ut som før

Den siste konkrete post-login-feilen som faktisk blokkerte lobbyen var en manglende PNG:

- `unity-bingo-backend/public/profile/bingo/candy-mania-thumb.png`

Da den manglet, fikk Unity HTML tilbake i stedet for bildeinnhold for Candy-thumbnailen, og WebGL-klienten krasjet videre i lobbyflyten. Etter at filen ble lagt tilbake, ble lobbyen stabil igjen.

Se styrende plan:

- `docs/UNITY_BINGO_RECOVERY_PLAN_2026-04-10.md`

## Hva som er verifisert

### 1. Host-siden er ikke hovedfeilen lenger

Følgende er allerede rettet i `main`:

- `/web/` sender nå `DomainDataCall` til riktig GameObject
- Socket.IO-serveren tillater `EIO=3`

Praktisk konsekvens:

- Unity-builden laster
- socketen åpner
- `OnConnect` skjer i live `/web/`

Det betyr at splash ikke lenger står stille på grunn av HTML-host eller websocket-handshake.

### 2. Unity forventer fortsatt legacy bingo-kontrakt

Unity starter fortsatt med legacy-kall fra disse filene:

- `Spillorama/Assets/_Project/_Scripts/Socket Manager/GameSocketManager.cs`
- `Spillorama/Assets/_Project/_Scripts/Manager/BackgroundManager.cs`
- `Spillorama/Assets/_Project/_Scripts/Socket Manager/EventManager.cs`
- `Spillorama/Assets/_Project/_Scripts/Panels/Login Register/LoginPanel.cs`

Eksempler på kall Unity fortsatt gjør:

- `HallList`
- `ScreenSaver`
- `LoginPlayer`
- `ReconnectPlayer`
- `PlayerDetails`
- `GetApprovedHallList`
- `GamePlanList`
- `AvailableGames`
- game namespace-kall på `Game1`, `Game2`, `Game3`, `Game4`, `Game5`

Unity lytter også på broadcasts som blant annet:

- `SubscribeRoom`
- `UpdatePlayerRegisteredCount`
- `GameStart`
- `WithdrawBingoBall`
- `PatternChange`
- `GameFinish`
- `GameTerminate`
- `GameRefreshRoom`

Dette er bingo-produktet, ikke bare login og lobby.

### 3. Dagens backend implementerer ikke denne kontrakten

Nåværende runtime i `backend/src/index.ts` eksponerer i praksis bare room-baserte handlers som:

- `room:create`
- `room:join`
- `room:resume`
- `room:configure`
- `bet:arm`
- `game:start`
- `game:end`
- `draw:next`
- `claim:submit`
- `room:state`

Det finnes ikke live handlers for Unity-kall som:

- `HallList`
- `ScreenSaver`
- `LoginPlayer`
- `ReconnectPlayer`
- `PlayerDetails`
- `GetApprovedHallList`

Det finnes heller ikke live bingo namespace-stotte for `Game1` til `Game5` i dagens backend.

### 4. Historisk bingo-backend finnes bare som legacy-kode

Den gamle bingo-serveren finnes fortsatt i historikk og i de utskilte repoene, spesielt som:

- historisk commit `079652d5` i dette repoet under `bingo_in_20_3_26_latest`
- tilsvarende legacy-kopi i `demo-backend/bingo_in_20_3_26_latest`

Der ligger blant annet:

- `Game/Common/Sockets/common.js`
- `Config/socketinit.js`
- `Game/Game1/...`
- `Game/Game2/...`
- `Game/Game3/...`
- `Game/Game4/...`
- `Game/Game5/...`

Det er der Unity-kontrakten faktisk lever.

### 5. Aktiv Render-service har ikke lenger Mongo-oppsett

Render API er kontrollert for den aktive servicen `Spillorama-system`.

Det som finnes der er i praksis:

- Postgres-relatert app-config
- Redis-relaterte settings
- Candy-integrasjonsnøkler
- diverse tredjepartsnøkler

Det som ikke finnes der er legacy bingo-databaseoppsett som:

- `MONGO_URI`
- `DB_CONNECTION_TYPE`
- `DB_MODE`
- `MONGO_HOST`

Den gamle bingo-serveren er eksplisitt Mongo-basert og starter ikke uten dette.

### 6. Isolert recovery-runtime er hentet ut, bootet og lobby-smoke-testet

Det er hentet ut en ren legacy bingo-runtime til:

- `unity-bingo-backend/`

Kilden er historisk snapshot fra commit `33bdbcce`, valgt fordi den fortsatt inneholder Unity bingo-produktet uten Candy-overlay i web-hosten.

Følgende er verifisert lokalt:

- runtimeen installerer under Node 18
- runtimeen installerer ikke under Node 25
- lokal Redis pa `127.0.0.1:6379` svarer
- runtimeen stopper pa Mongo før den når ferdig serverstart

Konkrete observasjoner fra smoke-test:

- `npm install` under Node 25 feiler pa gammel `grpc@1.24.x`
- `npm install` under midlertidig Node 18 lykkes
- oppstart uten legacy env bygger ugyldig Mongo-URI og feiler umiddelbart
- oppstart i eksplisitt `DB_CONNECTION_TYPE=local` og `DB_MODE=local` kommer lenger, men stopper med `connect ECONNREFUSED 127.0.0.1:27017`

Dette bekrefter at recovery-sporet er teknisk riktig, og at vi na er forbi ren login-recovery.

Videre arbeid 10. april 2026 la ogsa til:

- `seed_staging_lobby_bootstrap.js` som bygger en deterministisk staging-lobby for `game_2` og `game_3`
- fremtidige lokale tidsluker i `Europe/Oslo`, slik at legacy cron ikke umiddelbart refunderer og avslutter recovery-rundene
- `forceNew` og `multiplex: false` i smoke-klienten, fordi sekvensielle namespace-tilkoblinger ellers kan henge i `socket.io-client` uten at runtimeen faktisk er blokkert

Videre recovery-scripts finnes na direkte i runtime-mappen:

- `unity-bingo-backend/scripts/backup_mongo_db.js`
- `unity-bingo-backend/scripts/seed_minimum_recovery.js`
- `unity-bingo-backend/scripts/audit_masterdata.js`
- `unity-bingo-backend/scripts/start_local_recovery.sh`
- `unity-bingo-backend/scripts/smoke_recovery_runtime.js`

### 7. Login- og hall-flyten er faktisk Mongo-avhengig

Det er nå verifisert i legacy-koden at Unity-login ikke bare er en tynn wrapper rundt ekstern TicketService eller ny backend.

Spesielt:

- `playerLogin` leser spiller direkte fra Mongo via `PlayerServices`
- hallvalg leser haller direkte fra Mongo via `HallServices`
- `playerDetails` leser wallet, poeng og hall direkte fra Mongo
- `getApprovedHallList` leser spiller og halltilgang direkte fra Mongo
- `ScreenSaver` leser `Sys.Setting`, som igjen lastes fra Mongo ved oppstart

Det betyr at en tom ny Mongo-instans ikke automatisk gir fungerende `/web/`.
Det trengs enten:

- den opprinnelige legacy bingo-databasen, eller
- et eksplisitt prosjekt for å bootstrappe minimumsdata for settings, haller, spill og spillere

### 8. Ingen autoritativ historisk dump er funnet

Det er søkt etter:

- `.env`
- `env.conf`
- Mongo-dumper (`.bson`, `.archive`, `dump/`)
- lagrede Mongo-tilkoblingsstrenger i reelle prosjektfiler

Det som finnes lokalt er:

- dagens Postgres-baserte `backend/.env`
- placeholder `.env.example`-filer
- gamle agentlogger med delvis eller redigert historikk

Det som ikke er funnet er:

- en ekte brukbar legacy Mongo connection string i et aktivt prosjekt
- en lokal Mongo-dump med bingo-data
- en aktiv Render-service i denne workspace-en som fortsatt har legacy Mongo-konfig

## Hva dette betyr teknisk

### "Bygg ny WebGL" er ikke riktig neste steg alene

Hvis dagens Unity-prosjekt bygges på nytt uten videre refaktor, vil den nye builden fortsatt snakke samme legacy-kontrakt.

Resultatet blir derfor:

- ny build
- samme backend-mismatch
- samme produksjonsproblem i ny emballasje

### "Legg tilbake noen fa events" er heller ikke nok

Problemet er ikke bare startup/login.

Unity-produktet er avhengig av:

- default namespace-handlers
- game namespaces for `Game1` til `Game5`
- broadcasts og rom-logikk for lobby og spill
- gammel bingo-datamodell

Det er et helt produktlag som mangler, ikke en liten adapter.

## Reell løsningsvei

### Fase 1: Gjenopprett dedikert bingo-backend

Dette er den korteste riktige veien til fungerende `/web/`.

Det innebærer:

1. Gjenopprett legacy bingo-backenden som egen bingo-runtime.
2. Hold Candy/demo ute av denne runtimeen, bortsett fra eventuell eksplisitt wallet-bridge hvis den fortsatt skal leve her.
3. Etabler MongoDB-oppsett igjen for bingo-produktet.
4. Deploy Unity-host og bingo-backend som et matchende sett.

For a kunne gjennomfore fase 1 mangler vi na ett konkret input:

- brukbar legacy MongoDB-tilgang og/eller dump av bingo-dataene

### Fase 2: Eventuell modernisering senere

Hvis man vil avvikle legacy bingo-kontrakten helt, ma dette skje som et eget prosjekt:

1. redesign Unity-klienten mot dagens nye backend
2. bygg faktisk bingo-stotte i ny backend for lobby og spill 1-5
3. bygg ny WebGL etter at backend-kontrakten finnes

Det er en produktmigrering, ikke en hotfix.

## Anbefaling

Anbefalt retning akkurat na:

- Ikke fortsett med "ny WebGL alene" som primartiltak.
- Ikke fortsett med flere små host/socket-patcher i `backend/src`.
- Start gjenoppretting av bingo-backenden som egen runtime med korrekt datastore.

## Status etter denne gjennomgangen

Det som er sikkert avklart:

- `/web/` henger ikke lenger pa grunn av host-siden
- `/web/` henger ikke lenger pa grunn av Engine.IO v3-handshake
- dagens backend er strukturelt inkompatibel med Unity bingo-klienten
- aktiv Render-service mangler Mongo-oppsettet den gamle bingo-serveren krevde
- isolert legacy bingo-runtime er hentet ut til `unity-bingo-backend/`
- runtimeen kan installeres og startes lokalt under Node 18
- runtimeen stopper konkret pa manglende MongoDB
- login og hallflyt er avhengig av Mongo-data, ikke bare websocket-adaptere

Derfor er videre arbeid blokkerte av manglende bingo-runtime og manglende legacy-databaseoppsett, ikke av flere frontend- eller deploy-justeringer.
