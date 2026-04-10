# Unity Bingo Backend Recovery

## Formål

Denne mappen er en isolert recovery-kopi av den legacy bingo-runtime-en som Unity `/web/` faktisk er bygget mot.

Den finnes for ett formål:

- gjenreise Unity bingo-produktet uten å dra Candy-kode tilbake inn i den aktive `backend/`-applikasjonen

Dette er ikke den nye room-baserte backend-en.
Dette er heller ikke `demo-backend`.

## Kilde

Snapshoten er hentet fra historisk commit:

- `33bdbcce`

Den ble valgt fordi den fortsatt inneholder:

- legacy Unity socket-kontrakt
- namespaces `Game1` til `Game5`
- Mongo-baserte modeller og services
- ren Unity web-host uten Candy-overlay i `/public/web`

## Hva som er verifisert

Følgende er testet lokalt 10. april 2026:

1. `npm install` feiler under Node 25 fordi gamle native avhengigheter som `grpc@1.24.x` ikke bygger der.
2. `npm install` lykkes under Node 18.
3. Oppstart uten legacy DB-config feiler umiddelbart fordi appen bygger en ugyldig Mongo-URI.
4. Oppstart med `DB_CONNECTION_TYPE=local` og `DB_MODE=local` kommer lenger, kobler til lokal Redis, men stopper pa manglende MongoDB med `ECONNREFUSED 127.0.0.1:27017`.

Konklusjon:

- koden er brukbar som recovery-base
- runtimeen er ikke blokkert av host eller Socket.IO lenger
- den er blokkert av manglende legacy Mongo-data

## Ny status 10. april 2026

Videre recovery-arbeid har na bekreftet:

1. Atlas-tilkobling mot `ais_bingo_stg` fungerer.
2. Minimumsdata for `setting`, `hall` og spiller-hall-godkjenning er seedet i staging.
3. Seed-scriptet bygger na opp minimumsdata for hall, spiller og recovery-lobby i staging.
4. Runtimeen booter lokalt pa `http://127.0.0.1:4010` nar den startes fra denne mappen.
5. `/web/` svarer `200`.
6. `HallList` svarer `success`.
7. `LoginPlayer` svarer `success`.
8. `GetApprovedHallList` svarer korrekt hall-liste.
9. `GameTypeList` svarer uten dobbelt `profile/bingo/`-prefix i bildebanen.
10. `seed_staging_lobby_bootstrap.js` bygger na opp en lokal staging-lobby med `dailySchedule`, `schedules`, `assignedHalls`, `parentGame` og recovery-`game` for `game_2` og `game_3`.
11. `AvailableGames` svarer na med `Start at` for `game_2` og `game_3`.
12. `Game2PlanList` svarer na med en faktisk `upcomingGames`-liste.
13. `Game3PlanList` svarer na med en faktisk `upcomingGames`-liste nar smoke-klienten tvinger egen Socket.IO-transport per namespace.
14. `scripts/e2e_recovery_purchase_flow.js` passerer na lokalt for `Game2` med kjøp, `SubscribeRoom` og kansellering.
15. `scripts/e2e_recovery_purchase_flow.js` passerer na lokalt for `Game3` med kjøp, `SubscribeRoom` og kansellering.
16. En ny lokal Unity WebGL-build er promotert inn i `public/web`, og `StreamingAssets/build_info` viser `Build from Tobias sin MacBook Pro at 4/9/2026 12:34:42 PM`.
17. Selve Unity WebGL-klienten er verifisert i nettleser gjennom splash, login, lobby og faktisk billettkjop i `Recovery Game 2`.
18. En konkret post-login-crash i lobbyen ble sporet til manglende `public/profile/bingo/candy-mania-thumb.png`, og recovery-hosten er na oppdatert med denne filen.

Det neste hovedgapet er ikke lenger login eller host, men full parity-data utover recovery-bootstrapen og faktisk trekk/start/finish i Unity:

- `subGame`
- `subGame1`
- `subGame5`
- `background`
- `theme`
- `slotmachines`
- komplett `gameType`

Se full plan i:

- `/Users/tobiashaugen/Projects/Spillorama-system/docs/UNITY_BINGO_RECOVERY_PLAN_2026-04-10.md`
- `/Users/tobiashaugen/Projects/Spillorama-system/docs/UNITY_RECOVERY_ENV_MATRIX_2026-04-10.md`

## Recovery-artefakter

Denne recovery-runden har na konkrete scripts og backup-spor:

- backup-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/backup_mongo_db.js`
- seed-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/seed_minimum_recovery.js`
- lobby-bootstrap: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/seed_staging_lobby_bootstrap.js`
- audit-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/audit_masterdata.js`
- start-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/start_local_recovery.sh`
- smoke-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/smoke_recovery_runtime.js`
- e2e-script: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/e2e_recovery_purchase_flow.js`
- lokal Candy-thumbnail: `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/public/profile/bingo/candy-mania-thumb.png`

Siste eksplisitte backup ligger i:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/recovery-backups/ais_bingo_stg_2026-04-10T15-23-23-782Z`

## Runtime-krav

Minimum som ma finnes for a boote denne appen ordentlig:

- Node 18
- MongoDB med legacy bingo-data
- Redis
- MSSQL TicketService-tilgang
- legacy app secrets i env

Se:

- `.env.example`
- `Config/Database.js`
- `Config/Redis.js`
- `Config/mssql.js`

## Viktig arkitekturpoeng

Unity-login og lobby er ikke bare et tynt API-lag foran dagens backend.

Legacy-runtimeen leser direkte fra Mongo for:

- spillere
- haller
- settings
- spillstatus
- approved halls

Det betyr at denne runtimeen ikke kan gjenreises riktig bare ved a mappe noen websocket-events.

## Lokal kjøring

Bruk Node 18. På denne maskinen ble det testet med midlertidig runtime via `npx`.

Install:

```bash
npx -y -p node@18 -p npm@10 npm install
```

Minimal smoke-test uten ekte legacy DB:

```bash
SESSION_SECRET=test \
JWT_SECRET=test \
JWT_REFRESH_SECRET=test \
DEFAULT_ADMIN_USER_LOGIN_EMAIL=test@example.com \
DEFAULT_ADMIN_USER_LOGIN_PASSWORD=test \
DB_CONNECTION_TYPE=local \
DB_MODE=local \
PORT=448 \
npx -y -p node@18 node index.js
```

Forventet resultat akkurat na:

- Redis kobler opp lokalt
- Mongo feiler fordi legacy databasen ikke finnes lokalt

Faktisk recovery-kjoring mot Atlas staging:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend
node scripts/backup_mongo_db.js .env.recovery recovery-backups
node scripts/seed_minimum_recovery.js .env.recovery
node scripts/seed_staging_lobby_bootstrap.js .env.recovery --apply
node scripts/audit_masterdata.js .env.recovery
./scripts/start_local_recovery.sh .env.recovery
node scripts/smoke_recovery_runtime.js http://127.0.0.1:4010 .env.recovery martin martin 1
node scripts/e2e_recovery_purchase_flow.js http://127.0.0.1:4010 .env.recovery martin martin
```

## Hva som mangler for faktisk recovery

Minst ett av disse ma skaffes:

1. opprinnelig Mongo connection string til legacy bingo-databasen
2. Mongo-dump av legacy bingo-data
3. en eksplisitt plan for a bootstrappe nye minimumsdata for spillere, haller, settings og spill

Uten dette blir `/web/` fortsatt stående, selv om host-siden og websocket-handshake er rettet.
