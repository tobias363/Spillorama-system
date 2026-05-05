# Local Dev Quickstart

**Dato:** 2026-05-05  
**Direktiv:** Tobias — redusere iterasjon fra 5-7 min Render-deploy til 2-sek hot-reload.  
**Mål:** fra `git clone` til "spillet kjører lokalt med demo-data" på under 10 minutter.

---

## TL;DR

```bash
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system
npm install                             # første gang
npm run dev:all                         # starter alt
# i en annen terminal:
npm run dev:seed                        # seed demo-data
npm run dev:credentials                 # se test-bruker-passord
```

Åpne så:
- http://localhost:5174/admin/ → admin-panel
- http://localhost:4000/web/ → spiller-shell
- http://localhost:5173/ → game-client (dev-server)
- http://localhost:4173/ → visual-harness

Logg inn med `demo-admin@spillorama.no` / `Spillorama123!`.

---

## Forutsetninger

| Krav | Versjon | Sjekk |
|---|---|---|
| Node.js | 22+ | `node --version` |
| npm | 10+ | `npm --version` |
| Docker Desktop | latest | `docker info` |
| git | 2.40+ | `git --version` |

På macOS:
```bash
brew install node@22 docker
brew install --cask docker     # GUI-versjonen for å starte daemon
```

---

## Trinn-for-trinn

### 1. Clone og installer

```bash
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system
npm install --include=dev
```

`npm install` resolverer monorepo-workspace (apps/backend, apps/admin-web, packages/game-client, packages/shared-types).

### 2. Konfigurer .env (én gang)

```bash
cp apps/backend/.env.example apps/backend/.env
# Rediger apps/backend/.env hvis du har egne credentials.
# Default-verdier fungerer for lokal dev (Postgres+Redis fra docker-compose).
```

Minimums-variabler:
```
APP_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
REDIS_URL=redis://localhost:6379
NODE_ENV=development
SESSION_SECRET=<generer 32 random char>
JWT_SECRET=<generer 32 random char>
JWT_REFRESH_SECRET=<generer 32 random char>
WALLET_PROVIDER=postgres
KYC_PROVIDER=local
ROOM_STATE_PROVIDER=redis
SCHEDULER_LOCK_PROVIDER=redis
```

### 3. Start hele stack-en

```bash
npm run dev:all
```

Hva skjer:
- Docker Postgres (port 5432) + Redis (port 6379) starter via `docker compose up -d`.
- Backend (port 4000) — `tsx --watch` reloader på filendringer.
- Admin-web (port 5174) — Vite med HMR.
- Game-client (port 5173) — Vite med HMR.
- Visual-harness (port 4173) — Node-server, kun re-build ved manuelle bygg.

Output: farge-kodet `[backend] [admin] [games] [harness]` linjer.

Etter ~10-15 sek vises en status-tabell med `✓` per port.

**Ctrl+C** → alle child-prosesser SIGTERM-es, så SIGKILL etter 3 sek hvis noe henger.

#### Flagg

```bash
npm run dev:all -- --no-docker      # hopper Docker-sjekk (manuell Postgres+Redis)
npm run dev:all -- --no-admin       # kun backend + game-client
npm run dev:all -- --no-harness     # sparer port 4173
```

### 4. Seed demo-data

```bash
npm run dev:seed
```

Hva skjer:
1. Kjør node-pg-migrate (idempotent).
2. Kjør `seed-demo-pilot-day.ts` som oppretter:
   - 1 single-hall (`demo-hall-999`) med 3 spillere.
   - 4-hall pilot (`demo-hall-001..004`) med 12 spillere (3 per hall).
   - Admin (`demo-admin@spillorama.no`, `tobias@nordicprofil.no`).
   - Agenter (`demo-agent@spillorama.no`, `demo-agent-1..4@spillorama.no`).
   - GameManagement (Spill 1) + sub-games + daily schedules.

Idempotent — trygt å kjøre flere ganger.

### 5. Vis credentials

```bash
npm run dev:credentials
```

Print all test-bruker-info:
- E-post + passord per spiller/agent/admin
- Hvilken hall hver spiller tilhører
- Auto-login-URLer (se §6)
- Dev-URLer

### 6. Auto-login (hopper login-skjerm)

Bruk `?dev-user=<email>` i URL-en for å auto-logge inn:

```
http://localhost:4000/web/?dev-user=demo-spiller-1@example.com
http://localhost:5174/admin/?dev-user=demo-admin@spillorama.no
http://localhost:5174/admin/?dev-user=demo-agent-1@spillorama.no
```

**Sikkerhet:**
- Backend-routen `/api/dev/auto-login` er gated bak `NODE_ENV !== "production"` → returnerer `null` (ingen route-mount) i prod.
- Defense-in-depth: routen sjekker også per request, og krever localhost-IP.
- Email-allowlist: kun `demo-*`, `*@example.com`, `tobias@nordicprofil.no`.
- Aldri eksponer denne URL-en mot prod.

### 7. Reset state

```bash
npm run dev:reset
```

Hva skjer:
- Sletter alle pågående spillrunder (`game_sessions`, `game_checkpoints`).
- Tømmer Redis room-state (alle keys under `room:*`, `lock:*`, `ticket:*`, `game1:*`, etc).
- Sletter pending payment_requests fra demo-spillere.
- Resetter demo-spiller-saldo til 5000 NOK på depositkonto.

Sikkerhetssperre: `npm run dev:reset` nekter å kjøre hvis det finnes ikke-demo-brukere med transaksjoner siste 7 dager. Override: `RESET_FORCE=1 npm run dev:reset`.

---

## Vanlige workflows

### "Iterer på Spill 2-design"

Visual-harness lar deg laste rene Spill 2/3-scenes uten en full backend-runde:

```bash
npm run dev:all
# Åpne http://localhost:4173/
```

Endre filer i `packages/game-client/src/games/game2/` → Vite HMR oppdaterer i nettleseren.

For å manuelt bygge harness-en (default-konfigurasjon):
```bash
npm run build:visual-harness
```

### "Test full multi-player-flyt"

```bash
npm run dev:all
npm run dev:seed                                   # bare første gang
# Åpne 3 nettleser-faner:
#   http://localhost:4000/web/?dev-user=demo-pilot-spiller-1@example.com
#   http://localhost:4000/web/?dev-user=demo-pilot-spiller-2@example.com
#   http://localhost:4000/web/?dev-user=demo-pilot-spiller-3@example.com
# Logg inn agent på http://localhost:5174/admin/?dev-user=demo-agent-1@spillorama.no
# Start runde fra agent → spillere ser draws live
```

### "Stress-test før prod-deploy"

```bash
npm run dev:all
npm run dev:seed
npm run dev:stress -- --players=100 --duration=60 --game=rocket
# eller
npm run dev:stress -- --players=500 --duration=120 --game=monsterbingo --debug
```

Output: real-time progress, p50/p95/p99 latencies, errors. Resultat lagres som JSON.

### "Reproduser bug fra prod"

```bash
npm run dev:all
npm run dev:reset
npm run dev:seed
# Bruk dev:mock-players for å produsere realistisk multi-player-trafikk
# i bakgrunnen mens du selv tester via browser:
npm run dev:mock-players -- --count=5 --simulate-offline-percent=20
```

### "Test mobil-klient mot lokal stack"

```bash
npm run dev:all
npm run dev:tunnel       # eksponerer localhost:4000 via ngrok
# ngrok printer en https://*.ngrok.io URL — åpne den på telefonen
```

Krever at ngrok er installert (se `tunnel.mjs` for instruksjoner).

---

## Nye dev-kommandoer (oversikt)

| Kommando | Hva den gjør |
|---|---|
| `npm run dev:all` | Starter alt parallelt (backend + admin + games + harness) |
| `npm run dev:seed` | Migrasjoner + demo-pilot-day-seed |
| `npm run dev:reset` | Nullstill state (runtime + Redis + demo-saldoer) |
| `npm run dev:credentials` | Print test-bruker-passord + URLer |
| `npm run dev:stress` | CLI-stress-test for N parallelle spillere |
| `npm run dev:mock-players` | Realistisk multi-player-trafikk i bakgrunnen |
| `npm run dev:tunnel` | Eksponer lokal backend via ngrok |
| `npm run dev` | (eksisterende) Kun backend |
| `npm run dev:admin` | (eksisterende) Kun admin-web |
| `npm run dev:games` | (eksisterende) Kun game-client |

Alle nye kommandoer er **additive** — eksisterende workflows er uendret.

---

## Troubleshooting

### Postgres port 5432 allerede i bruk

Du har sannsynligvis en lokal Postgres som ikke er fra docker-compose:
```bash
brew services list | grep postgresql
brew services stop postgresql@16     # eller hvilken versjon du har
```

Eller endre port i `docker-compose.yml` og `apps/backend/.env`.

### Vite cache-issues etter abrupt restart

```bash
rm -rf packages/game-client/node_modules/.vite
rm -rf apps/admin-web/node_modules/.vite
```

### Backend "EADDRINUSE :::4000"

`npm run dev` ble ikke ren-avsluttet. Drep det manuelt:
```bash
lsof -i :4000
kill -9 <PID>
```

Eller bruk eksisterende script:
```bash
npm --prefix apps/backend run dev:single
```
…som rydder hengende prosesser før den starter.

### dev:seed feiler med "relation does not exist"

Migrasjoner ikke kjørt:
```bash
cd apps/backend && npm run migrate
```

### dev:auto-login returnerer 404

Backend kjører i prod-modus (NODE_ENV=production). Sjekk:
```bash
grep NODE_ENV apps/backend/.env
```
Skal være `development` eller blank.

### dev:reset nekter å kjøre

Det finnes ikke-demo-brukere med transaksjoner siste 7 dager. Du kjører sannsynligvis mot prod-DB. Dobbeltsjekk `APP_PG_CONNECTION_STRING`. Hvis du virkelig vil:
```bash
RESET_FORCE=1 npm run dev:reset
```

### Game-client tap state ved hver edit

Vite HMR sender `dev:game-hmr`-event til shell, men shell-en re-mountes ikke alltid automatisk. Hvis du mister state, lagre token i sessionStorage (auto-login gjør dette) og refresh manuelt — du blir auto-innlogget igjen uten å skrive credentials.

---

## Sikkerhet i dev

Alle dev-only features er gated:

| Feature | Gate |
|---|---|
| `/api/dev/auto-login` | `NODE_ENV !== "production"` (router-mount) + per-request re-check + localhost-IP-only + email-allowlist |
| `?dev-user=` i admin-web | `import.meta.env.DEV` (tree-shaker fjerner i prod-build) |
| `?dev-user=` i web shell | `?dev-user=`-handler ringer `/api/dev/auto-login` som er prod-blokkert |
| `dev:reset` script | Heuristikk: nekter hvis ikke-demo-aktivitet siste 7 dager |
| `dev:tunnel` (ngrok) | Krever manuell start; varsel om at prod-credentials aldri skal lekke |

**Aldri commit** følgende til prod-PR-er:
- `?dev-user=...` URLer i nettleser-skjermbilder
- ngrok-URLer
- Plaintext-credentials (de er allerede i kode for demo-brukere — IT'S DEMO-DATA, ikke prod-data)

---

## Performance-mål for lokal stack

| Metrikk | Mål | Sjekk |
|---|---|---|
| `npm run dev:all` startup | <30 sek | `time npm run dev:all` |
| Backend hot-reload (tsx) | <2 sek | rediger en fil i `apps/backend/src/` |
| Admin-web HMR | <500 ms | rediger `apps/admin-web/src/main.ts` |
| Game-client HMR | <500 ms | rediger `packages/game-client/src/games/game2/PlayScreen.ts` |
| `dev:stress --players=100` | <5% feil | etter `dev:seed` |
| `dev:stress --players=1000` | <10% feil | utvikler-laptop. Pilot-mål 36k krever prod-infrastruktur |

---

## Hvor henvende seg

- Bug i en av dev-scriptene: opprett issue med tag `dev-stack`.
- Ønsker en ny workflow? Send PR mot dette dokumentet med en ny seksjon under "Vanlige workflows".
- Sikkerhetsspørsmål om dev-routes: spør Tobias direkte før du eksponerer noe.

Sist oppdatert: 2026-05-05.
