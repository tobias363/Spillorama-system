# Pilot 4-hall demo-runbook

**Formål:** Sett opp og kjør end-to-end demo-dag med 4 sammenkoblede bingohaller — én master + tre medlemmer — for å validere multi-hall master-koordinering, ready/start/stop-flyt og TV-skjerm med ball-opplesning per hall.

**Målgruppe:** Tobias eller operativ-PM som setter opp pilot-demoen uten å spørre teknisk lead om hver detalj.

**Scope:** Spill 1 only. Spill 2/3 er deferred til post-pilot (bekreftet av Tobias 2026-04-28).

**Relatert:** [`MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`](../architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md), [`PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md`](./PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md), [`LOCAL_TEST_TV_AND_MINIGAMES.md`](./LOCAL_TEST_TV_AND_MINIGAMES.md).

---

## 1. Forutsetninger

- macOS / Linux med Node.js 20+ og npm 10+.
- PostgreSQL 16 + Redis 7 kjørende (lokalt via `docker-compose up -d postgres redis` eller staging).
- Repo klonet og `npm install` kjørt fra repo-roten.
- Migrasjoner kjørt i target-DB:
  ```bash
  npm --prefix apps/backend run migrate
  ```
- Backend `.env` satt opp med minst:
  ```
  APP_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
  WALLET_PROVIDER=postgres
  WALLET_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
  PORT=3000
  AUTO_ROUND_START_ENABLED=false
  ```
  > `PORT=3000` er obligatorisk lokalt — `apps/admin-web/vite.config.ts` proxer `/api` og `/socket.io` til `http://localhost:3000`. Default i `apps/backend/src/index.ts` er 4000, så du må eksplisitt overstyre. `AUTO_ROUND_START_ENABLED=false` lar master kontrollere start manuelt.

- 4 separate Chrome-vinduer/-faner tilgjengelige (én per hall) for TV-skjerm-demo. Profile-isolasjon (eks. via Chrome-profiler eller `--user-data-dir`) anbefales hvis flere agenter skal være innlogget samtidig på samme maskin.

---

## 2. Ett-tids-oppsett (engangs)

```bash
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system
npm install
cp apps/backend/.env.example apps/backend/.env
# Editer .env per §1 over
npm --prefix apps/backend run migrate
npm --prefix apps/backend run seed:demo-pilot-day
```

> **Branch-avhengighet (per 2026-05-01):** 4-hall-profilen (Profil B) ligger fortsatt på `feat/seed-demo-pilot-day-4halls` (commit `fb180ec5`) og er **ikke merget til main**. Hvis du jobber fra main får du kun Profil A (single-hall demo). Sjekk ut feature-branchen før seed:
> ```bash
> git fetch origin
> git checkout feat/seed-demo-pilot-day-4halls
> npm --prefix apps/backend run seed:demo-pilot-day
> ```

Verifiser at output viser **begge profiler**:

- **Profil A:** `demo-hall-999` med admin/agent + 3 spillere.
- **Profil B:** `demo-hall-001..004` (Hall #1001-1004), hall-gruppe `Demo Pilot GoH`, 4 agenter, 12 spillere, master-hall `demo-hall-001`.

Mangler Profil B-blokken i output → branchen er ikke ute. Stopp og avklar.

Default-passord er `Spillorama123!` (overstyr via `DEMO_SEED_PASSWORD` i env).

---

## 3. Pre-flight checklist (før hver demo-dag)

- [ ] Postgres + Redis oppe og kjørende (`docker ps` viser begge).
- [ ] Backend dev-server: `npm --prefix apps/backend run dev` (port **3000**).
- [ ] Admin-web: `npm --prefix apps/admin-web run dev` (port **5174**).
- [ ] Game-client: `npm --prefix packages/game-client run dev` (port **5173**).
- [ ] `curl http://localhost:3000/health` returnerer 200.
- [ ] Re-seed hvis du vil tomme wallets / friske runder:
  ```bash
  npm --prefix apps/backend run seed:demo-pilot-day
  ```
  Scriptet er idempotent — kjør så mange ganger du vil.
- [ ] Verifiser hall-listen:
  ```bash
  curl -s http://localhost:3000/api/halls | jq '.data[].id'
  ```
  skal inkludere `demo-hall-001`, `demo-hall-002`, `demo-hall-003`, `demo-hall-004`.
- [ ] Tre Chrome-vinduer/-profiler åpnet, klar for TV + agent + spiller.

---

## 4. Demo-rolleoppsett (per person på demo-dagen)

Master er **bingovert med utvidet ansvar** — ingen separat rolle. Alle 4 agenter har `role=AGENT`; master-only handlinger guard'es på `hallId === group.masterHallId` runtime-side. Se `project_master_role_model.md` i memory.

### Master-bingovert (`demo-agent-1@spillorama.no`, primary `demo-hall-001`)

- URL: `http://localhost:5174/admin/` → logger inn → blir redirected til `/agent`.
- Ansvar:
  - Starter shift i hall-001 (Add Daily Balance).
  - Triggrer **Start Next Game** når alle haller er ready.
  - Monitorerer multi-hall-status (Hall Info-popup).
  - Kan **force-unmark** ready på en henging hall (krever reason).
  - Kan trigge **`transferHallAccess`** (60s handshake) hvis master-hallen blir uoperasjonell.

### Bingovert hall 2-4 (`demo-agent-2..4@spillorama.no`, primary `demo-hall-002..004`)

- URL: samme — `http://localhost:5174/admin/` → `/agent`.
- Ansvar:
  - Logger inn + starter eget skift (Add Daily Balance).
  - Skanner fysiske bonger via **Register More Tickets** (F1 hotkey).
  - Signaler **Ready** når klar.
  - Venter på master før spillet starter.
  - Etter trekk: **Check for Bingo** + **Physical Cashout**.
  - Etter dagen: shift end med checkboxene satt.

### TV-operatør per hall (4 stk Chrome-vinduer i kiosk-modus)

URLene er deterministiske (stabile UUID-tokens i seed-scriptet). Lim inn én per hall:

- Hall 1 (master): `http://localhost:5174/admin/#/tv/demo-hall-001/11111111-1111-4111-8111-111111111111`
- Hall 2: `http://localhost:5174/admin/#/tv/demo-hall-002/22222222-2222-4222-8222-222222222222`
- Hall 3: `http://localhost:5174/admin/#/tv/demo-hall-003/33333333-3333-4333-8333-333333333333`
- Hall 4: `http://localhost:5174/admin/#/tv/demo-hall-004/44444444-4444-4444-8444-444444444444`

> Seed-scriptet printer disse også — bruk versjonen fra terminal hvis du tviler. Scriptet skriver dem som `http://localhost:4000/...` (prod-modus, backend serverer admin static), men i lokal dev må du bruke `5174` (admin-web dev-server med proxy mot backend).

For hver TV:

- [ ] Velg voice-pakke i UI når mountet (1 = norsk mann, 2 = norsk kvinne, 3 = engelsk).
- [ ] Lyd må være på — Chrome autoplay-policy krever first-user-gesture, så klikk én gang etter mount.
- [ ] (Valgfritt) F11 for fullskjerm.

### Spillere (per hall, 1-3 demo-spillere)

- URL: `http://localhost:5173/` (game-client).
- Login-format: `demo-spiller-1@example.com` til `demo-spiller-12@example.com`, samme passord.
- Hall-tildeling per seed:
  - hall-001: spiller 1, 2, 3
  - hall-002: spiller 4, 5, 6
  - hall-003: spiller 7, 8, 9
  - hall-004: spiller 10, 11, 12
- Hver har 500 NOK på depositkonto.
- Velg din hall i lobby → kjøp bonger → vent på trekk → claim ved BINGO.

---

## 5. Demo-script — hva skjer på dagen

| Tidspunkt | Handling |
|---|---|
| **T-15min** | Pre-flight (§3), alle vinduer åpnet, TV-er i kiosk-modus, voice valgt. |
| **T+0:00** | Master logger inn på hall-001, åpner skift med 5000 NOK starting cash. |
| **T+0:01-04** | Agent 2/3/4 logger inn, åpner skift i sin hall. |
| **T+0:05-10** | Hver agent registrerer fysiske bonger (Register More Tickets, F1). |
| **T+0:11** | Demo-spillere logger inn på game-client, kjøper online-bonger i sin hall. |
| **T+0:12** | Agent 2/3/4 trykker **Ready**. Master ser status i Hall Info-popup. |
| **T+0:12** | Master trykker **Start Next Game** (om alle ready). 2-min countdown broadcastes. |
| **T+0:13-22** | Trekk pågår, baller leses opp på TV per hall, spillere markerer på online-bonger. |
| **T+0:23** | Vinner trykker BINGO i game-client → agent trykker **Check for Bingo** med ticket-id → 5×5 grid + Reward-All. |
| **T+0:24+** | Mini-game-overlay (Wheel of Fortune / Treasure Chest / Mystery / ColorDraft per rotasjon). |
| **T+0:30** | Neste runde — gjenta fra T+0:11. |
| **T+22:00 (skift-slutt)** | Physical Cashout pending → Reward All. Control Daily Balance. Settlement (Metronia/OK Bingo/Franco/Otium + NT/Rikstoto + Rekvisita + Servering + Bilag + Bank). Shift Log Out med checkboxer satt. |

> Mini-game-rotasjonen kjører engine-side: `Wheel → Chest → Mystery → ColorDraft → Wheel ...`. Profil B's seed inkluderer alle 4 sub-game-presets (BIN-804) slik at rotasjonen kan vises end-to-end på én demo-dag.

---

## 6. Avbruddshåndtering

| Symptom | Tiltak |
|---|---|
| **Master-hall mister forbindelse / agent-PC kræsjer** | Bruk `transferHallAccess` (60s handshake). I master-agent-UI: pek ny master-hall fra group, trykk Initiate Transfer. Når mottakende master Aksepterer, går master-rollen over uten ny runde. |
| **TV-skjerm henger** | F5-refresh. Voice cache lastes på nytt; klikk én gang for autoplay-gesture. |
| **Spiller-klient mister socket** | Auto-reconnect (BIN-AUTO_RELOAD_RESILIENCE) tar oss tilbake. Hvis ikke: F5. |
| **Hall sitter "Not Ready" og blokkerer Start** | Master-agent: åpne Hall Info-popup → force-unmark ready (krever reason, audit-logges). |
| **Wallet-saldo ser feil ut** | Sjekk Render/backend-logs for nightly-reconciliation-warnings. Cross-sjekk via `GET /api/wallets/:walletId` mot `app_wallet_audit`. |
| **§11-overskudd-rapport feiler** | Compliance-buggen er fikset (PR #769 + #443). Sjekk at Spill 2/3 ikke er aktivert i schedule (kun `bingo`-slug). |
| **EADDRINUSE :3000** | `lsof -i :3000` → drep prosessen som blokkerer. Vanligvis en gammel `tsx watch`. |
| **Vite-proxy 502 mot `/api`** | Backend ikke på 3000. Sjekk `PORT=3000` i `.env` og restart `npm run dev`. |

---

## 7. Cleanup etter demo

```bash
# I hver agent-fane: trykk Shift Log Out → kryss av:
#   [x] Distribute winnings to physical players
#   [x] Transfer register ticket to next agent

# Re-seed for ny demo (idempotent — sletter ikke gamle haller, men friskt schedule):
npm --prefix apps/backend run seed:demo-pilot-day

# Stopp dev-servere: Ctrl-C i alle 3 terminaler.
# Stopp infra hvis lokal docker:
docker-compose down
```

For helt blank slate (sjelden — kun ved skjema-eksperimentering):
```bash
docker-compose down -v   # sletter volumes
docker-compose up -d postgres redis
npm --prefix apps/backend run migrate
npm --prefix apps/backend run seed:demo-pilot-day
```

---

## 8. Avhengigheter på branches/PR-er (per 2026-05-01)

| Avhengighet | Status | Handling |
|---|---|---|
| `feat/seed-demo-pilot-day-4halls` (commit `fb180ec5`) | **Ikke merget** | MÅ være sjekket ut eller merget før `seed:demo-pilot-day` produserer Profil B. |
| E2E multi-hall test (Bølge 2 Agent A2) | I arbeid | Kjør for automatisert validering før manuell demo. |
| Spill 2/3 i schedule | Ikke pilot-scope | Hvis aktivert: dobbelsjekk at `Game2Engine.ts:173` + `Game3Engine.ts:259` bruker `ledgerGameTypeForSlug(room.gameSlug)` så §11-rapporter ikke regner feil prosent. |

---

## 9. Ytterligere referanser

- **Master-modellen:** «bingovert med utvidet ansvar» — ingen separat rolle. Master-only actions guards på `hallId === group.masterHallId`. Memory: `project_master_role_model.md`.
- **Wireframe-spec:** `docs/architecture/WIREFRAME_CATALOG.md` — Agent V1.0 = PDF 17, Admin V1.0 = PDF 16.
- **Pre-demo audit:** `docs/audit/WIREFRAME_PARITY_AUDIT_2026-04-30.md` — sjekk for åpne røde flagg.
- **Master-plan:** `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` — kontekst for kritiske P0/P1-items.
- **Smoke-sjekkliste:** `docs/operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md` — komplementær per-runde-sjekk for produksjons-pilot (denne runbooken er for demo-oppsettet, ikke produksjon).
- **TV-screen + mini-games (single hall):** `docs/operations/LOCAL_TEST_TV_AND_MINIGAMES.md` — bruk denne som starting point hvis du kun vil teste én hall uten master-koordinering.

---

**Sist oppdatert:** 2026-05-01 (Bølge 2 Agent A3).
**Eier:** Tobias / operativ-PM. Oppdater når master-handover-UI eller seed-script endres.
