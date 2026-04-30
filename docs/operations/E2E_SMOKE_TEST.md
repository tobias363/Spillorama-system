# E2E Smoke-Test Runbook (BIN-768)

**Status:** Ny — etablert 2026-04-30 som M1 / pilot-blokker.

End-to-end smoke-test som dekker hele dag-flyten i staging før hver prod-deploy. Manuelt invokert; automatiserte assertions fanger regresjoner i auth, hall-listing, schedule, agent-shift, cash-in/out og settlement-infrastruktur.

---

## 1. Når kjøre

- **Før hver prod-deploy** fra og med M1 til og med M2 (full pilot-modenhet). Hvis smoke-testen ikke kjøres, dokumentér unntaket i deploy-loggen og ha en supplerende manuell røyk-sjekk klar.
- **Etter staging-rebuild** (se `STAGING_REBUILD_2026-04-29.md`) — bekrefter at re-seeding av demo-data ikke har brutt API-kontraktene.
- **Etter merge av PR-er som rører** auth-, agent-, wallet- eller settlement-koden — selv om CI er grønn, fanger smoke-testen kontrakts-drift mot et live miljø.

---

## 2. Forutsetninger

1. **Demo-seed kjørt på target-miljøet.** `feat/seed-demo-pilot-day`-branchen oppretter haller, schedule, agent-bruker og demo-spillere som testen forutsetter. Hvis smoke-testen rapporterer `No demo-players found` eller `No schedules found`, må demo-seedet kjøres først.
2. **Admin-bruker** finnes med `role=ADMIN` og `ADMIN_PANEL_ACCESS`-permission.
3. **Agent-bruker** finnes med `role=AGENT`, `agent_status=active`, og **minst én hall-tilordning** (`agent_hall_assignments`-rad). Agentens primære hall må være den hallen demo-spillerne ligger i — ellers feiler `players/lookup` på `PLAYER_NOT_AT_HALL`.
4. **Node 22+** (eller Bun) lokalt. Skriptet bruker Node 22 sin innebygde `fetch` — ingen `node-fetch`-avhengighet.
5. **Tilgang til target-URL.** Staging er offentlig; for prod kreves IP-whitelisting (kontakt Tobias).

---

## 3. Kjøre testen

Fra repo-roten:

```bash
npm --prefix apps/backend run smoke-test -- \
  --api-base-url=https://staging.spillorama-system.onrender.com \
  --admin-email=admin@spillorama.no \
  --admin-password='REDACTED' \
  --agent-email=agent@spillorama.no \
  --agent-password='REDACTED'
```

Argumenter:

| Flag | Påkrevd | Beskrivelse |
|------|---------|-------------|
| `--api-base-url` | Ja | URL til backend, uten trailing slash. F.eks. `https://staging.spillorama-system.onrender.com`. |
| `--admin-email` | Ja | E-post for admin-bruker. |
| `--admin-password` | Ja | Passord. **Bruk single-quotes** rundt verdien for å unngå at shell-en tolker `$`, `!`, etc. |
| `--agent-email` | Ja | E-post for agent-bruker. |
| `--agent-password` | Ja | Passord. Samme quoting-regel. |

Skriptet exit-koder:

- `0` — alle 13 steg passerte.
- `1` — minst ett steg feilet (eller manglende CLI-args).

Output-format per steg:

```
[OK]  Step 1: Admin login (215 ms)
[FAIL] Step 6: Player lookup (find demo-players) — No demo-players found at this hall (...)
```

---

## 4. Hva testen sjekker

| # | Steg | Endpoint | Hva som assertes |
|---|------|----------|------------------|
| 1 | Admin login | `POST /api/admin/auth/login` | `ok=true`, `data.accessToken` finnes |
| 2 | List schedules | `GET /api/admin/schedules?limit=100` | minst 1 schedule returneres |
| 3 | List halls | `GET /api/admin/halls` | minst 1 aktiv hall |
| 4 | Agent login | `POST /api/agent/auth/login` | `ok=true`, agent har `halls`-tilordning |
| 5 | Shift start | `POST /api/agent/shift/start` | `isActive=true`, eller idempotent fallback ved `SHIFT_ALREADY_ACTIVE` |
| 6 | Player lookup | `POST /api/agent/players/lookup` | minst én demo-spiller funnet (prøver `demo`/`test`/`smoke`/`spill`) |
| 7 | Balance read | `GET /api/agent/players/:id/balance` | `walletBalance` er nummer |
| 8 | Cash-in 50 NOK | `POST /api/agent/players/:id/cash-in` | `afterBalance` returneres |
| 9 | Verify +50 | `GET .../balance` | re-fetched balance = før + 50 |
| 10 | Cash-out 25 NOK | `POST /api/agent/players/:id/cash-out` | `afterBalance` returneres |
| 11 | Control daily balance | `POST /api/agent/shift/control-daily-balance` | `severity` returneres |
| 12 | Settlement-date info | `GET /api/agent/shift/settlement-date` | `expectedBusinessDate` returneres |
| 13 | Shift end | `POST /api/agent/shift/end` | `isActive=false`, eller idempotent ved `NO_ACTIVE_SHIFT` |

**Bevisste utelatelser:**

- **`/shift/close-day` kjøres IKKE.** Close-day er en "én gang per dag"-operasjon som ville brent test-agenten for resten av dagen. Vi sjekker isteden at settlement-infrastruktur svarer (steg 12) og lukker shiftet uten dags-oppgjør (steg 13).
- **Spill-runtime testes ikke.** Bingo-runde, draw-engine, ticket-mark og claim-submit har egne integrasjons-tester (`packages/game-client` + load-tests). Smoke-testen dekker kun den "rolige" cash-flyten.

---

## 5. Feilhåndtering — hva man gjør ved hver type fail

### Steg 1: `Admin login` feiler med `INVALID_CREDENTIALS`
- Verifiser at admin-brukeren faktisk eksisterer i target-DB (`SELECT email FROM app_users WHERE email = ...`).
- Sjekk at passordet ikke har spesialtegn som shell-en tolker — bruk single-quotes.
- Hvis brukeren ble laget med `--admin-bootstrap`, sjekk at `role=ADMIN`.

### Steg 2: `No schedules found`
- Demo-seed har ikke kjørt. Kjør `feat/seed-demo-pilot-day`-skriptet på target-miljøet.
- Eller: `app_schedules`-tabellen er tom. Lag en mal manuelt via admin-UI.

### Steg 3: `No active halls`
- Kjør `npm --prefix apps/backend run seed:halls` (eller demo-seed-pakken).

### Steg 4: `Agent has no hall assignment`
- I admin-UI: tilordne en hall til agent-brukeren (`Admin → Agents → <agent> → Add hall`).
- Eller direkte i DB: `INSERT INTO app_agent_hall_assignments (user_id, hall_id, is_primary) VALUES (...);`

### Steg 5: `SHIFT_ALREADY_ACTIVE` (idempotent — ingen feil)
- Skriptet behandler dette som en re-run og fortsetter. Ingen handling kreves.

### Steg 6: `No demo-players found at this hall`
- Demo-seedet har ikke laget spillere ved denne hallen. Verifiser at `--agent-email` peker på en agent med samme primær-hall som demo-seedets default.
- Eller: tilpass demo-seedet så det oppretter spillere ved akkurat denne hallen.
- Quick fix: opprett minst én spiller via admin-UI med `displayName` som starter med `demo` eller `test`.

### Steg 7-9: Cash-in / balance-verify-feil
- `INSUFFICIENT_DAILY_BALANCE` ved cash-out (steg 10) er ofte en konsekvens av at `daily_balance` på shiftet er 0. Demo-seedet bør sette en startsaldo, eller du kan kjøre `Add Daily Balance` i agent-UI før du kjører testen.
- Avvik mellom forventet og faktisk balanse (steg 9) tyder på en wallet-bug. Stopp deploy og undersøk i `app_wallet_transactions` + `app_compliance_outbox`.

### Steg 11: `DIFF_NOTE_REQUIRED` eller `ADMIN_FORCE_REQUIRED`
- Skriptet rapporterer en self-consistent balanse, så dette skal normalt ikke skje. Hvis det gjør det, sjekk om noen andre transaksjoner har gått inn i mellomtiden — re-kjør hele smoke-testen mot en ren agent.

### Steg 13: `NO_ACTIVE_SHIFT` (idempotent — ingen feil)
- Tolereres. Kan oppstå hvis steg 5 var en re-use og en parallel run allerede lukket shiftet.

### Generelle nettverksfeil
- "Non-JSON response": backend er nede eller returnerer HTML-feilside. Sjekk Render-dashboard.
- "Unexpected response shape": API-kontrakt har endret seg. Kjør smoke-testen lokalt mot egen branch og diag-fix før prod.

---

## 6. Hvor finner man logger

- **Skriptets egen output:** stdout/stderr i terminalen. Hvert steg har `[OK]` eller `[FAIL]` med varighet.
- **Backend-side** (Render dashboard):
  - `https://dashboard.render.com/` → `spillorama-system` (eller staging-tilsvarende) → Logs.
  - Filter på `bin-768` eller `smoke-test` for å se hvilke endpoints som faktisk ble truffet — testen gjør 13+ requests.
  - Audit-log: `agent.login`, `agent.shift.start`, `cash_in`, `cash_out` events vises i `app_audit_log`.
- **DB-side** for å verifisere at testens skriving faktisk landet:
  - `SELECT * FROM app_agent_transactions WHERE notes LIKE 'BIN-768%' ORDER BY created_at DESC LIMIT 5;`
  - `SELECT * FROM app_wallet_transactions WHERE wallet_id = (SELECT wallet_id FROM app_users WHERE id = '<demo-player-id>') ORDER BY created_at DESC LIMIT 5;`

---

## 7. CI-integrasjon (planlagt — IKKE ferdig per 2026-04-30)

Smoke-testen er foreløpig manuell. Plan:

1. Etter at neste deploy lander stabilt, lag en GitHub Actions-job som kjører smoke-testen mot staging på en cron (f.eks. hver natt 03:00 Oslo).
2. Når et prod-deploy starter, kall smoke-testen som post-deploy-step mot prod (med produksjons-credentials i secrets).
3. Hvis smoke-testen feiler post-deploy, trigger automatisk rollback via Render dashboard.

Frem til CI-integrasjon er på plass: **manuell kjøring før hver prod-deploy** er forventet.

---

## 8. Endringer på testen selv

Hvis du legger til eller endrer steg i `apps/backend/scripts/e2e-smoke-test.ts`:

1. Oppdater tabellen i §4 over.
2. Oppdater feilmodi i §5 hvis nye fail-mønstre er mulige.
3. Test lokalt mot eget dev-miljø før push.
4. Hold tallet på steg under ~20 — testen skal ferdig på under 30 sekunder. Heavy integrasjons-tester hører hjemme i egne suiter.

---

## 9. Relaterte dokumenter

- `docs/operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md` — manuell sjekkliste for pilot-dag (komplementær til denne automatiserte testen).
- `docs/operations/STAGING_REBUILD_2026-04-29.md` — staging rebuild-prosedyre.
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — migrations + deploy-flyt.
- `docs/operations/ROLLBACK_RUNBOOK.md` — hvis smoke-testen feiler post-deploy.
- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` §10 — backend-status og ferdigstilte pilot-blokkere.
