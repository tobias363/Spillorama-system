# Unity Recovery Env Matrix 2026-04-10

## Formål

Dette dokumentet er styrende env-matrisen for `unity-bingo-backend`.

Målet er at legacy Unity bingo-runtime skal kunne:

- boote likt lokalt og pa Render
- bruke samme Mongo-databasefamilie
- skille tydelig mellom minimumskrav for recovery og full drift

Dette dokumentet er ikke en hemmelighetsfil.
Ingen ekte nøkler eller passord skal lagres her.

## Niva 1: Minimum for lokal recovery

Dette er minste sett for a fa `/web/`, `HallList` og `LoginPlayer` opp lokalt.

- `MONGO_URI`
- `SESSION_SECRET`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `DB_CONNECTION_TYPE=production`
- `DB_MODE=production`
- `PORT=4010`

Kommentar:

- `MONGO_URI` skal peke til `ais_bingo_stg` eller senere autoritativ bingo-db.
- `SESSION_SECRET`, `JWT_SECRET` og `JWT_REFRESH_SECRET` kan vaere lokale utviklingsverdier ved ren lokal test.
- `DB_CONNECTION_TYPE=production` brukes her fordi Atlas-URIen brukes direkte av legacy runtime.

## Niva 2: Minimum for Render staging-service

Dette er minste sett for a kunne kjore samme runtime pa egen Render-service.

- alle variabler fra Niva 1
- `NODE_ENV=production`
- `RENDER_EXTERNAL_URL`
- `ALLOWED_ORIGINS`

Anbefalt tillegg:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_TLS=true`
- `REDIS_PREFIX`

Kommentar:

- uten Redis kan runtime fortsatt boote, men drift blir mindre lik produksjon
- `ALLOWED_ORIGINS` ma inkludere den Unity-hosten som skal laste `/web/`

## Niva 3: Full drift parity

Dette er ikke pa plass ennå. Disse verdiene ma kartlegges og bekreftes før ekte drift.

### Auth og admin

- `DEFAULT_ADMIN_USER_LOGIN_EMAIL`
- `DEFAULT_ADMIN_USER_LOGIN_PASSWORD`

### MSSQL og eksterne bingo-avhengigheter

- `MSSQL_DB_SERVER`
- `MSSQL_DB_DATABASE`
- `MSSQL_DB_PORT`
- `MSSQL_DB_USERNAME`
- `MSSQL_DB_PASSWORD`

### Betaling og tredjepart

- `VERIFONE_*`
- `IDKOLLEN_*`
- `METRONIA_*`
- `SVEVE_*`
- `SWEDBANKPAY_*`
- `SMTP_*`
- `FIREBASE_*`

Kommentar:

- disse er ikke blokkere for lokal login/lobby-recovery
- de er blokkere for komplett parity og reell drift

## Autoritativ filstruktur

Følgende filer er nå del av recovery-oppsettet:

- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/.env.example`
- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/.env.recovery`
- `/Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend/scripts/start_local_recovery.sh`

Regel:

- `.env.recovery` er lokal og hemmelig
- `.env.example` og dette dokumentet er offentlige maler

## Operasjonell rekkefolge

1. Bekreft `MONGO_URI`.
2. Kjor backup av databasen.
3. Kjor masterdata-audit.
4. Start lokal recovery-runtime.
5. Kjor smoke-test mot runtimeen.

Kommandoer:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system/unity-bingo-backend
node scripts/backup_mongo_db.js .env.recovery recovery-backups
node scripts/audit_masterdata.js .env.recovery
./scripts/start_local_recovery.sh .env.recovery
node scripts/smoke_recovery_runtime.js http://127.0.0.1:4010 .env.recovery martin martin 1
```
