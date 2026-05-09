# Post-deploy smoke-test (pilot)

**Status:** Etablert 2026-05-08 som pilot-readiness-tiltak. Lever som pilot-go/no-go-gate i §6.1 av [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md).

Et lite, raskt smoke-test-skript som kjøres etter hver deploy for å bekrefte at de player-vendte API-pathene svarer korrekt: health → login → identity → wallet → halls → games → room health → rooms.

Dette skriptet er forskjellig fra de andre to smoke-tests vi allerede har:

| Skript | Scope | Bruker | Når kjøres |
|---|---|---|---|
| **`scripts/smoke-test-pilot.sh`** (denne) | Player-vendt API | TEST_USER (player) | **Hver deploy** (post-deploy hook) |
| `apps/backend/scripts/pilot-smoke-test.sh` | Admin + seed-verifisering | ADMIN | Manuelt før pilot-flow-test |
| `apps/backend/scripts/e2e-smoke-test.ts` | 22-step admin + agent + multi-hall | ADMIN + AGENT | Før prod-deploy fra staging |

---

## 1. Hva sjekkes

Skriptet kjører 8 sekvensielle sjekker mot backend. Første feilet steg avbryter — exit-koden 1 går rett tilbake til runner (Render / GitHub Action / lokal terminal).

| # | Steg | Endpoint | Forventet |
|---|---|---|---|
| 1 | `GET /health` | `/health` | 200 + `{ ok: true }` |
| 2 | `POST /api/auth/login` | `/api/auth/login` | 200 + `data.accessToken` |
| 3 | `GET /api/auth/me` | `/api/auth/me` | 200 + `data.id == login.user.id` |
| 4 | `GET /api/wallet/me` | `/api/wallet/me` | 200 + `data.account.balance` finnes |
| 5 | `GET /api/halls` | `/api/halls` | 200 + array med ≥ 1 hall |
| 6 | `GET /api/games` | `/api/games` | 200 + slugs `bingo`, `rocket`, `monsterbingo` finnes |
| 7 | `GET /api/games/spill1/health` | `/api/games/spill1/health?hallId=…` | 200 + `data.status` ∈ `{ok, degraded}` (kun `down` feiler) |
| 8 | `GET /api/rooms` | `/api/rooms` | 200 + array (kan være tom) |

**Hvorfor disse:**

- Steg 1-4: minimum-flyten en spiller møter ved login.
- Steg 5-6: katalog-data backend må eksponere før spiller kan velge hall/spill.
- Steg 7: R7 / BIN-814 — per-rom helsestatus per [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md). `degraded` aksepteres (Redis varmer opp etter cold-start), `down` feiler hardt.
- Steg 8: rooms-listing er public — verifiserer at rom-aggregatoren svarer.

---

## 2. Kjøre lokalt

### 2.1 Krav

- `bash` 4+ (macOS standard er bash 3.2 — bruk `/usr/bin/env bash` eller `brew install bash` hvis 4+ trengs; skriptet er testet med 3.2).
- `curl`, `jq`, `awk` (alle standard på macOS + Linux).
- En reachable backend (default `http://localhost:4000`).
- En **test-bruker** som finnes på target-miljøet og **ikke har 2FA** aktivert. På local dev er `demo-spiller-1@…` typisk valg.

### 2.2 Vanlige kall

```bash
# Mot lokal dev-server (default URL)
TEST_USER_EMAIL='demo-spiller-1@spillorama.no' \
TEST_USER_PASSWORD='Spillorama123!' \
  bash scripts/smoke-test-pilot.sh

# Mot eksplisitt URL (staging eller prod)
TEST_USER_EMAIL='…' TEST_USER_PASSWORD='…' \
  bash scripts/smoke-test-pilot.sh https://api.spillorama.no

# JSON-modus for alerting / Slack-integrasjon
TEST_USER_EMAIL='…' TEST_USER_PASSWORD='…' \
  bash scripts/smoke-test-pilot.sh --json https://api.spillorama.no

# Hjelpetekst
bash scripts/smoke-test-pilot.sh --help
```

### 2.3 Konfig-flagg via env

| Variabel | Default | Beskrivelse |
|---|---|---|
| `TEST_USER_EMAIL` | (påkrevd) | Spiller-konto for login. |
| `TEST_USER_PASSWORD` | (påkrevd) | Plaintext-passord. **Bruk single-quotes** rundt verdien hvis den inneholder `$`, `!`, etc. |
| `SMOKE_TIMEOUT_SEC` | `15` | Per-request curl-timeout. Hev til 30+ for trege staging-deploys. |
| `SMOKE_HALL_ID` | (auto) | Lås `?hallId=…` for room-health-probe. Default: første ID fra `/api/halls`. |

### 2.4 Exit-koder

| Kode | Mening |
|---|---|
| `0` | Alle 8 steg passerte. |
| `1` | Minst ett steg feilet — sjekk `failedStep` / `failedReason` for detaljer. |
| `2` | Ugyldige argumenter (manglende env, ukjent flagg, manglende `curl/jq`). |

---

## 3. Output-format

### 3.1 Human-mode (default)

```
smoke-test-pilot → http://localhost:4000
user=demo-spiller-1@spillorama.no  timeout=15s

[OK]   GET /health (24ms)
[OK]   POST /api/auth/login (28ms)
[OK]   GET /api/auth/me (18ms)
[OK]   GET /api/wallet/me (16ms)
[OK]   GET /api/halls (18ms)
[OK]   GET /api/games (19ms)
[OK]   GET /api/games/spill1/health (15ms)
[OK]   GET /api/rooms (16ms)

smoke-test PASSED (243ms total)
```

ANSI-farger brukes når stdout er TTY; auto-fallback til ren tekst når output sendes til fil.

### 3.2 JSON-mode (`--json`)

Single-line JSON som lett kan parses i CI / pipeline:

```json
{
  "ok": true,
  "baseUrl": "https://api.spillorama.no",
  "totalDurationMs": 1842,
  "steps": [
    { "name": "GET /health", "status": "ok", "durationMs": 215 },
    { "name": "POST /api/auth/login", "status": "ok", "durationMs": 412 }
  ],
  "failedStep": null,
  "failedReason": null
}
```

Ved feil:

```json
{
  "ok": false,
  "baseUrl": "https://api.spillorama.no",
  "totalDurationMs": 312,
  "steps": [
    { "name": "GET /health", "status": "ok", "durationMs": 215 },
    { "name": "POST /api/auth/login", "status": "fail", "durationMs": 97,
      "reason": "HTTP 401 from POST .../api/auth/login: {\"ok\":false,..." }
  ],
  "failedStep": "POST /api/auth/login",
  "failedReason": "HTTP 401 from POST ..."
}
```

---

## 4. Integrasjon — Render post-deploy hook

Render kan kjøre en kommando etter hvert deploy. For Spillorama-backend ligger build-config i [`render.yaml`](../../render.yaml).

### 4.1 Anbefalt setup

Render har for øyeblikket ikke en innebygd "post-deploy"-hook, men du kan kalle smoke-testen fra ekstern crony / GitHub Action i stedet (se §5). Hvis Render i framtida får native post-deploy-hooks, legg til som følger:

```yaml
# render.yaml — IKKE merget; eksempel for når feature lander
services:
  - type: web
    name: spillorama-system
    # ... eksisterende config
    postDeployCommand: |
      bash scripts/smoke-test-pilot.sh https://$RENDER_EXTERNAL_HOSTNAME
```

`TEST_USER_EMAIL` og `TEST_USER_PASSWORD` må settes som env-vars på Render-tjenesten (sync: false så de ikke commit-es).

### 4.2 Manuell post-deploy fra lokal terminal

Når du kjører `npm run deploy:backend` eller bruker Render-dashboardet, legg til som siste steg i deploy-loggen:

```bash
TEST_USER_EMAIL='ops-test@spillorama.no' \
TEST_USER_PASSWORD="$OPS_TEST_PASSWORD" \
  bash scripts/smoke-test-pilot.sh https://api.spillorama.no \
  || { echo "POST-DEPLOY SMOKE FAILED — initiate rollback"; exit 1; }
```

---

## 5. Integrasjon — GitHub Action (post-deploy)

For automatisk kjøring etter merge til `main`, opprett `.github/workflows/post-deploy-smoke.yml`:

```yaml
name: Post-deploy smoke-test
on:
  workflow_run:
    workflows: ["Deploy Production"]
    types: [completed]
    branches: [main]
  workflow_dispatch:  # tillat manuell trigger fra Actions-tab

jobs:
  smoke:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch' }}
    steps:
      - uses: actions/checkout@v4
      - name: Install jq (preinstalled, but verify)
        run: sudo apt-get install -y jq curl
      - name: Wait for Render rollout (60s)
        run: sleep 60
      - name: Run smoke-test
        env:
          TEST_USER_EMAIL: ${{ secrets.SMOKE_TEST_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.SMOKE_TEST_PASSWORD }}
        run: |
          bash scripts/smoke-test-pilot.sh \
            --json \
            https://api.spillorama.no \
            | tee smoke-result.json
      - name: Post failure to Slack
        if: failure()
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_OPS_WEBHOOK }}
        run: |
          payload=$(jq -n --slurpfile r smoke-result.json \
            '{text: "Post-deploy smoke FAILED at \($r[0].failedStep): \($r[0].failedReason)"}')
          curl -X POST -H 'Content-Type: application/json' \
            --data "$payload" "$SLACK_WEBHOOK_URL"
```

**Secrets å sette i GitHub:**

- `SMOKE_TEST_EMAIL` — dedikert player-konto, ikke admin
- `SMOKE_TEST_PASSWORD` — passordet
- `SLACK_OPS_WEBHOOK` — webhook for ops-kanalen

---

## 6. Feilsøking

### 6.1 `[FAIL] POST /api/auth/login: 2FA enabled?`

Test-brukeren har TOTP-2FA aktivert. Smoke-test bruker simpel `POST /api/auth/login`-flyt; 2FA-flyt krever ekstra `challengeId` + TOTP-kode-call. Velg en dedikert smoke-test-bruker uten 2FA.

### 6.2 `[FAIL] GET /api/games/spill1/health: status=down`

Backend ser at Spill 1 ikke har aktiv runde og er utenfor åpningstid, ELLER DB-koblingen er nede. Sjekk:

1. `GET /health` viser om DB er tilkoblet
2. Render-loggene for `[/health] DB failed` eller `[draw-engine] Postgres unavailable`
3. Spille-katalogen — er `bingo`-slug `isEnabled=true`?

R7-status `down` SKAL feile smoke-testen — det er hele poenget med BIN-814.

### 6.3 `[FAIL] GET /api/halls: halls list empty`

Demo-seed eller pilot-seed har ikke kjørt på target-miljøet. Kjør:

```bash
npm --prefix apps/backend run seed:demo-pilot-day
```

og prøv smoke-test på nytt.

### 6.4 Rate-limit på `spill1/health` (HTTP 429)

`/api/games/spillN/health` er rate-limitet til 60 req/min/IP. Hvis du har et monitoring-system som poller hyppig fra samme IP som CI, hev `SMOKE_TIMEOUT_SEC` til 30+ og inkluder retry i CI-jobben.

### 6.5 Cold-start-falskt-positiv

Render-instansen kan trenge 5-10 sek på å varme opp etter scale-from-0. Hvis smoke-testen feiler i en cold-start, vent og kjør på nytt:

```bash
# i CI: enkel retry-kappe
for i in 1 2 3; do
  bash scripts/smoke-test-pilot.sh https://api.spillorama.no && break
  sleep 10
done
```

---

## 7. Vedlikehold

### 7.1 Når må skriptet oppdateres

- **Nye player-vendte endpoints lagt til** som er kritiske for første-side-load → legg inn som ny `step_*`.
- **Nye obligatoriske spill** (f.eks. Spill 4 lansert som hovedspill) → utvid `step_games`-slug-listen.
- **API-shape endring** på `/api/auth/login` (f.eks. `data.user` flyttet) → `step_login` jq-uttrykk må oppdateres.
- **`/health` shape endring** → `step_health` må reflektere ny shape.

### 7.2 Holde i sync med eksisterende smoke-tests

Hvis `apps/backend/scripts/e2e-smoke-test.ts` eller `apps/backend/scripts/pilot-smoke-test.sh` får nye player-vendte verifikasjoner, **kopier ikke kode** — vurder om de tilhører her i stedet. De andre to har admin-/agent-fokus; player-fokuset bør konsentreres her.

---

## 8. Referanser

- [`scripts/smoke-test-pilot.sh`](../../scripts/smoke-test-pilot.sh) — selve skriptet
- [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.4 R7 + §6.1 — pilot-go/no-go-policy
- [`docs/operations/E2E_SMOKE_TEST.md`](./E2E_SMOKE_TEST.md) — admin/agent-fokusert smoke-test
- [`apps/backend/openapi.yaml`](../../apps/backend/openapi.yaml) — API-spec endpoints kalles mot
- [`render.yaml`](../../render.yaml) — produksjons-deploy-config
