# Render Env-Vars: Runbook + Incident-Forebygging

**Status:** Aktiv runbook
**Sist oppdatert:** 2026-05-02 etter incident
**Eier:** PM (eller den som har Render API-key)

---

## TL;DR — De fem dødssyndene

1. ❌ **ALDRI bruk `PUT /v1/services/<svc>/env-vars` uten å inkludere ALLE eksisterende keys i payload.** PUT er **destruktivt** — det erstatter hele settet. Mangler du én key, slettes den.
2. ❌ **Aldri stol på `source`-importerte secrets i en sub-shell.** Bruk `export` eksplisitt.
3. ❌ **Aldri PUT uten først GET-verifisere current state** og inkludere alle eksisterende keys.
4. ❌ **`render.yaml` er IKKE komplett liste over env-vars.** Mange env-vars settes manuelt i dashboard og er IKKE i Blueprint. Eksempel: `CORS_ALLOWED_ORIGINS`, `WALLET_PROVIDER`, `KYC_PROVIDER`, `ROOM_STATE_PROVIDER`, `SCHEDULER_LOCK_PROVIDER` var alle satt manuelt og ikke i render.yaml — restore-script som bare bruker render.yaml som referanse mangler disse.
5. ❌ **CLAUDE.md tabellen "Environment Variables" er kanonisk for hva som kreves**, ikke render.yaml. Alltid kryssjekk mot CLAUDE.md før restore.

## Komplett env-var-inventar (post-incident state)

### Render-managed (auto-provisioned, kjent verdi)

| Key | Verdi | Hentes fra |
|---|---|---|
| `APP_PG_CONNECTION_STRING` | `postgresql://...@dpg-d6k3ren5r7bs73a4c0bg-a/...` | Render Postgres API |
| `APP_PG_SCHEMA` | `public` | render.yaml |
| `REDIS_HOST` | `red-d76hmntm5p6s73bn3vv0` | Render Redis API |
| `REDIS_PORT` | `6379` | Render Redis API |
| `REDIS_PASSWORD` | `Z5j44WH3...` (32 chars) | Render Redis API (parse rediss:// URL) |
| `REDIS_TLS` | `true` | render.yaml |

### Provider-flagg (CLAUDE.md kanonisk — IKKE i render.yaml!)

| Key | Riktig verdi | Konsekvens om mangler |
|---|---|---|
| `WALLET_PROVIDER` | `postgres` | Defaulter til memory → wallets tom → login feil |
| `KYC_PROVIDER` | `local` (uten BankID) eller `bankid` | KYC-validering kan crashe |
| `ROOM_STATE_PROVIDER` | `redis` | Defaulter til memory → rom-state tapt ved restart |
| `SCHEDULER_LOCK_PROVIDER` | `redis` | Defaulter til memory → race ved multi-instance |

### Sikkerhets-secrets (Spillorama-egen)

| Key | Verdi-type | Generering |
|---|---|---|
| `JWT_SECRET` | 64 hex chars | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | 64 hex chars | `openssl rand -hex 32` |
| `SESSION_SECRET` | 64 hex chars | `openssl rand -hex 32` |
| `EXT_GAME_WALLET_API_KEY` | 64 hex chars | `openssl rand -hex 32` (delt med Candy) |
| `CANDY_INTEGRATION_API_KEY` | 64 hex chars | `openssl rand -hex 32` (delt med Candy) |
| `CORS_ALLOWED_ORIGINS` | csv av URLs | `https://spillorama-system.onrender.com` |

### Bootstrap admin

| Key | Verdi |
|---|---|
| `DEFAULT_ADMIN_USER_LOGIN_EMAIL` | `tobias@nordicprofil.no` |
| `DEFAULT_ADMIN_USER_LOGIN_PASSWORD` | `Spillorama123!` |

### Statisk config

| Key | Verdi |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `SWEDBANKPAY_PAYMENT_CURRENCY_CODE` | `NOK` |
| `CANDY_BACKEND_URL` | `https://candy-backend-ldvg.onrender.com` |

### Feature flags (PR-aktiverte)

| Key | Verdi | Aktiverer |
|---|---|---|
| `GAME1_SCHEDULE_TICK_ENABLED` | `true` | Cron som spawner game1_scheduled_games |
| `GAME1_AUTO_DRAW_ENABLED` | `true` | Auto-draw-tick |

### Eksterne service-creds (må hentes fra ekstern admin)

Se "Steg 6" nedenfor for komplett liste + hvor.

---

## Incident 2026-05-02

PM kjørte `PUT /v1/services/<svc>/env-vars` med kun 2 nye keys (`GAME1_SCHEDULE_TICK_ENABLED` + `GAME1_AUTO_DRAW_ENABLED`) for å enable cron. Render API erstattet hele env-listen — 47 av 49 secrets ble slettet.

**Recovery-faser (3 deploy-iterasjoner):**
1. PUT v1: 52 keys (49 fra render.yaml + 2 nye flagg + GAME1_AUTO_DRAW_ENABLED) → deploy v1 FAILED med `FATAL: CORS_ALLOWED_ORIGINS must be set`
2. PUT v2: 53 keys (la til CORS_ALLOWED_ORIGINS) → deploy v2 SUCCESS men login crashet med `Wallet wallet-tobias-admin finnes ikke` fordi `WALLET_PROVIDER` manglet → defaulter til memory
3. PUT v3: 57 keys (la til 4 provider-vars: WALLET, KYC, ROOM_STATE, SCHEDULER_LOCK) → deploy v3 forventet success

**Konsekvens:**
- Live deploy fortsatte å fungere (env-vars i memory)
- Neste deploy ville crashe (manglende DB-secret, JWT-secret, etc.)
- Tobias hadde ikke backup av secret-verdiene
- Måtte regenerere JWT/SESSION (revoker alle sessions) + sette placeholders for eksterne tjenester (Swedbank, Firebase, Cloudinary, etc.)

**Root cause:**
- Render API har ingen "PATCH" eller "merge"-endpoint
- POST-endpoint for single-add ser ut til å eksistere men returnerte ingenting (uklart om det fungerer)
- PUT er den eneste fungerende mutasjonen, men er destruktiv

---

## Slik gjør du env-var-endringer trygt

### Riktig framgangsmåte (steg-for-steg)

```bash
RENDER_KEY="<din-key>"
SVC="srv-d7bvpel8nd3s73fi7r4g"

# Steg 1: Hent ALLE eksisterende env-vars (full backup)
curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/services/$SVC/env-vars?limit=100" \
  > /tmp/env-backup-$(date +%Y%m%d-%H%M%S).json

# Steg 2: Verifiser backup ser komplett ut (~50 keys for Spillorama)
python3 -c "import json; d=json.load(open('/tmp/env-backup-*.json')); print(f'count: {len(d)}')"

# Steg 3: Bygg ny payload som inkluderer ALLE eksisterende + endringene dine
python3 <<'EOF' > /tmp/env-update.json
import json
backup = json.load(open('/tmp/env-backup-XXX.json'))
existing = [{"key": e["envVar"]["key"], "value": e["envVar"]["value"]} for e in backup]

# Legg til / overstyr nye verdier
new_or_changed = {
    "GAME1_SCHEDULE_TICK_ENABLED": "true",
    "GAME1_AUTO_DRAW_ENABLED": "true",
}

# Merge: behold eksisterende, oppdater de nye
key_to_value = {e["key"]: e["value"] for e in existing}
key_to_value.update(new_or_changed)

# Output som array
final = [{"key": k, "value": v} for k, v in key_to_value.items()]
print(json.dumps(final, indent=2))
EOF

# Steg 4: Sanity-check antall keys (skal ≥ original)
python3 -c "import json; d=json.load(open('/tmp/env-update.json')); print(f'new count: {len(d)}')"

# Steg 5: PUT
curl -X PUT "https://api.render.com/v1/services/$SVC/env-vars" \
  -H "Authorization: Bearer $RENDER_KEY" -H "Content-Type: application/json" \
  -d @/tmp/env-update.json
```

### Anti-patterns (gjør IKKE dette)

```bash
# ❌ ALDRI: PUT med kun de nye keys
curl -X PUT .../env-vars -d '[{"key":"NEW","value":"x"}]'  # SLETTER ALT ANNET

# ❌ ALDRI: Source secrets-fil og forventer at Python-subprocess ser dem
source /tmp/secrets.env
python3 -c "import os; print(os.environ['JWT_SECRET'])"  # KeyError

# ✅ Riktig: eksporter eksplisitt
export JWT_SECRET=$(grep "JWT_SECRET=" /tmp/secrets.env | cut -d'=' -f2-)
python3 -c "import os; print(os.environ['JWT_SECRET'])"  # OK
```

---

## Hvis incident gjentar seg — Recovery-prosedyre

### Steg 0: VURDER OM DET HASTER
- Live deploy fortsetter med gamle env-vars i memory
- **Prod kjører normalt inntil neste deploy**
- Du kan vente til normal arbeidstid for å restore (ikke 24/7-incident)

### Steg 1: Sjekk skadeomfang
```bash
RENDER_KEY="<key>"
SVC="srv-..."
curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/services/$SVC/env-vars?limit=100" | jq '. | length'
# Hvis < forventet count: confirm incident
```

### Steg 2: Hindre auto-deploy
- Branch-protect main slik at ingen pushes i mellomtiden
- ELLER: pause Render-tjenesten via dashboard → Settings → Suspend
- ELLER: bare unngå merger til main

### Steg 3: Hent kjente verdier fra Render API (uten secrets)
```bash
# Postgres connection
RENDER_KEY="<key>"
DB_ID=$(curl -sH "Authorization: Bearer $RENDER_KEY" "https://api.render.com/v1/postgres?limit=5" | jq -r '.[0].postgres.id')
curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/postgres/$DB_ID/connection-info"
# → returnerer internalConnectionString + externalConnectionString

# Redis (key-value) connection
REDIS_ID=$(curl -sH "Authorization: Bearer $RENDER_KEY" "https://api.render.com/v1/redis?limit=5" | jq -r '.[0].redis.id')
curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/redis/$REDIS_ID/connection-info"
# → returnerer rediss://USER:PASS@HOST:PORT (parse med urlparse)
```

### Steg 4: Generer nye sikkerhets-secrets (hvis original ikke finnes)
```bash
# JWT/SESSION secrets — invaliderer alle aktive sessions, men kan regenereres trygt
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)

# Wallet-API-keys (hvis Candy-integrasjon)
EXT_GAME_WALLET_API_KEY=$(openssl rand -hex 32)
CANDY_INTEGRATION_API_KEY=$(openssl rand -hex 32)
# ⚠️ Hvis du regenererer disse, MÅ Candy-team få nye keys i sin env også
```

### Steg 5: Konsulter `render.yaml` for statiske verdier
```bash
# Statiske verdier finnes i render.yaml under `value:`-keys
grep -B1 "value:" render.yaml | head -40
```

Faste verdier for Spillorama:
- `NODE_ENV=production`
- `PORT=10000`
- `APP_PG_SCHEMA=public`
- `REDIS_TLS=true`
- `SWEDBANKPAY_PAYMENT_CURRENCY_CODE=NOK`
- `CANDY_BACKEND_URL=https://candy-backend-ldvg.onrender.com`

### Steg 6: Eksterne service-secrets — restore via dashboard

Disse må hentes fra ekstern tjeneste-admin:

| Kategori | Vars | Hentes fra |
|---|---|---|
| Swedbank Pay (10) | `SWEDBANKPAY_*` | https://merchantportal.payex.com |
| Firebase (3) | `FIREBASE_*` | https://console.firebase.google.com → Service accounts |
| Cloudinary (3) | `CLOUDINARY_*` | https://cloudinary.com/console → Settings → API Keys |
| Verifone (4) | `VERIFONE_*` | Verifone admin (ekstern) |
| Metronia (2) | `METRONIA_*` | Metronia API admin |
| IdKollen (3) | `IDKOLLEN_*` | https://idkollen.no admin |
| Sveve (3) | `SVEVE_*` | https://sveve.no admin |
| MSSQL (5) | `MSSQL_DB_*` | OK Bingo on-prem / Microsoft SQL Server admin |

**Pilot-merknad:** For Spill 1 multi-hall pilot trenger du ikke disse. Sett som `PLACEHOLDER_RESTORE_FROM_<TJENESTE>` og fyll inn senere.

### Steg 7: Restore-PUT
Bruk skriptet under for å bygge full liste + PUT i én batch.

---

## Skript: full env-restore i én batch

Lagre som `infra/restore-render-env.sh` (eller kjør one-shot):

```bash
#!/bin/bash
set -e
: ${RENDER_KEY:?Set RENDER_KEY}
SVC="srv-d7bvpel8nd3s73fi7r4g"

# Generer secrets
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export SESSION_SECRET=$(openssl rand -hex 32)
# Hent Render-managed
DB_ID="dpg-d6k3ren5r7bs73a4c0bg-a"
export APP_PG_CONNECTION_STRING=$(curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/postgres/$DB_ID/connection-info" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['internalConnectionString'])")
REDIS_ID="red-d76hmntm5p6s73bn3vv0"
export REDIS_PASSWORD=$(curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/redis/$REDIS_ID/connection-info" \
  | python3 -c "
import json, sys
from urllib.parse import urlparse
d = json.load(sys.stdin)
print(urlparse(d['externalConnectionString']).password)
")

python3 <<'PYEOF' > /tmp/env-vars.json
import json, os
env_vars = [
    {"key": "APP_PG_CONNECTION_STRING", "value": os.environ["APP_PG_CONNECTION_STRING"]},
    {"key": "REDIS_HOST", "value": "red-d76hmntm5p6s73bn3vv0"},
    {"key": "REDIS_PORT", "value": "6379"},
    {"key": "REDIS_PASSWORD", "value": os.environ["REDIS_PASSWORD"]},
    # ... (full liste — se RENDER_ENV_VAR_RUNBOOK.md)
]
print(json.dumps(env_vars, indent=2))
PYEOF

curl -X PUT "https://api.render.com/v1/services/$SVC/env-vars" \
  -H "Authorization: Bearer $RENDER_KEY" -H "Content-Type: application/json" \
  -d @/tmp/env-vars.json
```

---

## Backup-strategi (forebygging)

### 1. Daglig env-snapshot til S3/encrypted-storage
Cron-job som henter env-vars (bare key-navn, ikke values uten security-konsoll) og dumper til encrypted backup.

### 2. Secret-vault som single-source-of-truth
Vurder migrering til 1Password / Doppler / Hashicorp Vault. Render env-vars syncer FRA vault, ikke omvendt. Da kan vi alltid restore.

### 3. Pre-PUT validation script
Lag wrapper-script som ALLTID kjører:
```bash
#!/bin/bash
# safe-render-env-put.sh
set -e

# Hent current state
CURRENT=$(curl -sH "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/services/$SVC/env-vars?limit=100")
CURRENT_COUNT=$(echo "$CURRENT" | jq '. | length')

# Read foreslått payload
NEW_COUNT=$(jq '. | length' "$1")

# Sanity check: ny payload skal ALDRI ha < 90% av current
MIN_EXPECTED=$((CURRENT_COUNT * 9 / 10))
if [ "$NEW_COUNT" -lt "$MIN_EXPECTED" ]; then
  echo "❌ ABORT: New payload har $NEW_COUNT keys, current har $CURRENT_COUNT (min $MIN_EXPECTED)"
  exit 1
fi

curl -X PUT "https://api.render.com/v1/services/$SVC/env-vars" \
  -H "Authorization: Bearer $RENDER_KEY" -H "Content-Type: application/json" \
  -d @"$1"
```

### 4. Branch-protection regel
Ingen `gh pr merge --admin` for PR-er som krever env-endringer uten først å ha kjørt restore-script lokalt.

### 5. Eier dokumenterer hver env-var
Hver gang en ny env-var legges til, dokumenter:
- Hvor verdien hentes fra
- Hvem som kan rotere den
- Hva som skjer ved manglende verdi (graceful degradation eller hard crash)

Anbefalt fil: `docs/operations/ENV_VARS_REGISTRY.md`

---

## Testing etter env-restore

```bash
# 1. Verifiser API live
curl -s https://spillorama-system.onrender.com/health | jq

# 2. Verifiser auth fungerer
curl -s -X POST https://spillorama-system.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tobias@nordicprofil.no","password":"Spillorama123!"}' | jq '.ok'

# 3. Verifiser DB-tilkobling (via wallets-count)
curl -s https://spillorama-system.onrender.com/api/status | jq '.data.components[] | select(.component=="database")'

# 4. Verifiser Redis-tilkobling (via room-state hvis aktive rooms)
curl -s https://spillorama-system.onrender.com/api/status | jq '.data.overall'
```

Alle 4 må returnere "operational" / `ok:true`.

---

## Side-effekter av JWT/SESSION-secret-rotasjon

**Hvis nye JWT_SECRET / SESSION_SECRET genereres:**

1. **Alle aktive sessions revoked** — brukere må re-logge inn
2. **Refresh-tokens fungerer ikke** — krever fresh login
3. **Email-verify-tokens i flight blir ugyldige** — bruker må be om ny
4. **Password-reset-tokens i flight blir ugyldige** — bruker må be om ny

For Teknobingo-pilot: agent-team må re-logge inn med samme passord (`Spillorama123!`).

---

## Kontaktinfo ved incident

- **Render Support:** support@render.com (har snapshot, men response-tid varierer)
- **Render Status:** https://status.render.com
- **Tobias (eier):** tobias@nordicprofil.no
- **Spillorama-prosjekt-eier på Render:** team `tea-d6k3pmfafjfc73fdh9mg`

---

**Sist oppdatert:** 2026-05-02 etter incident kl 11:05 CEST
**Lessons-learned:** Aldri PUT mot env-vars uten å ha komplett liste først. POST kan finnes men er udokumentert/ikke testet.
