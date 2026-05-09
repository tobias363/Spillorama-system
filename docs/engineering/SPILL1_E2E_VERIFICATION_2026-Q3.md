# Spill 1 — End-to-end-verifikasjon mot lokalt dev-miljø

**Dato:** 2026-05-09 (Oslo)
**Test-engineer:** PM-AI agent (Claude Opus 4.7)
**Branch:** `test/spill1-end-to-end-verification`
**Mål:** Pre-pilot verifikasjon — kjøre full Spill 1-flyt mot lokal Postgres + Redis fra "docker-compose up" til "spiller vinner og får premie i wallet".

---

## TL;DR — Pilot go/no-go-vurdering

**Verdikjeden virker** — en spiller kjøpte bong, runden ble startet av admin, baller ble trukket, en spiller vant Rad 1 og fikk 100 NOK kreditert wallet, compliance-ledger fikk korrekt hall-binding. Slutt-til-slutt fungerer.

**Men 7 funn må fikses før pilot går live**, hvorav 3 er pilot-blokkere:

- **PILOT-BLOKKER F10** — agent-route mangler `jackpotConfirmed`-wireup (master-bingovert kan ikke fullføre jackpot-popup via `/api/agent/game1/start`, må bruke admin-route).
- **PILOT-BLOKKER F13** — `GAME1_AUTO_DRAW_ENABLED` defaulter til `false`. Glemmer man å sette env-var i prod, står spillet stille i `running` med 0 trekk.
- **PILOT-BLOKKER F17** — `/api/agent/game1/lobby` returnerer `INTERNAL_ERROR` for seed-data fordi `Spill1AgentLobbyStateSchema` krever UUID for `planId`, men seed-plan `demo-plan-pilot` er ikke UUID.

I tillegg er det 1 **subtil tidssone-bug (F4)**, 1 **legacy MAX_DRAWS-grense (F22)** som er forventet, og diverse polishing-funn.

---

## 1. Lokalt miljø-oppsett

```bash
# Container-state ved test-start
docker ps --format 'table {{.Names}}\t{{.Status}}'
# spillorama-system-postgres-1   Up About an hour (healthy)
# spillorama-system-redis-1      Up About an hour (healthy)

npm --prefix apps/backend run migrate           # ferdig (alle 95+ migreringer kjørte uten feil)
npm run build:types                              # ferdig
npm --prefix apps/backend install                # ferdig (nodemailer var ikke installert)
GAME1_AUTO_DRAW_ENABLED=true PORT=4001 npm --prefix apps/backend run dev
# Backend startet på port 4001 (4000 var brukt av annet)
# /health respondte: {"ok":true,...,"rooms":1,"games":5,"halls":6,"wallets":25}
```

### Findings under oppstart

**F1 — Manglende deps-install i agent-onboarding:**

Første `npm run dev` feilet med:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'nodemailer' imported from
  apps/backend/src/integration/EmailService.ts
```

Fix: `npm --prefix apps/backend install` (deps fantes i `package.json`, men `node_modules/` var tomt). `npm install` på root installerer ikke automatisk i `apps/backend/`.

**Anbefaling:** `package.json` root-`postinstall`-script eller dokumentere dette i `AGENT_ONBOARDING.md`.

**F2 — `npm run build:types` må kjøres før første dev-start:**

Etter F1-fix feilet det med:
```
Cannot find module '@spillorama/shared-types/dist/socket-events.js'
```

Fix: `npm run build:types`. Dette er ikke i quick-start fra `CLAUDE.md` (linje 56-86).

**Anbefaling:** Legg til `npm run build:types` som steg 0 i quick-start-blokken i `CLAUDE.md`.

---

## 2. Seed-data verifikasjon

DB hadde allerede:
- 6 haller (1 default + 4 pilot + "ikke bruk")
- 1 hall-gruppe `demo-pilot-goh` med `master_hall_id=demo-hall-001`
- 1 katalog-spill med 13 entries (`bingo`, `5x500`, ..., `tv-extra`)
- 1 aktiv plan `demo-plan-pilot` med 13 items
- 18 spillere (12 pilot-spillere + 3 demo + 3 admin/agent), alle `kyc_status='VERIFIED'`
- Wallet med 500 NOK per pilot-spiller (cents-form: `balance: 500.000000`)

### F3 — Halls i DB har ikke `master_hall_id` direkte (behold gjeldende design)

`master_hall_id` ligger på `app_hall_groups`, ikke `app_halls`. Alle halls i seed-data har `hall_group_id=NULL`. Pilot-GoH peker på master via `app_hall_groups.master_hall_id`, men halls peker ikke tilbake til GoH-en. Dette er bevisst og fungerer.

### F4 — TIDSSONE-BUG: `dateRowToString` bruker UTC-offsets på Postgres `Date`-objekter

**Sted:** `apps/backend/src/game/GamePlanRunService.ts:191-203`

```ts
function dateRowToString(value: unknown): string {
  if (value instanceof Date) {
    const yyyy = value.getUTCFullYear();    // ← UTC-offsets
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(value.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  ...
}
```

**Observasjon (real test 2026-05-08 22:06 UTC = 2026-05-09 00:06 Oslo):**

`GET /api/agent/game-plan/current` returnerte:
```json
{
  "data": {
    "businessDate": "2026-05-09",          // top-level (computed via dayjs.tz)
    "run": {
      "businessDate": "2026-05-08",        // ← FEIL — DB-row sier faktisk 2026-05-09
      ...
    }
  }
}
```

DB-bekreftelse: `SELECT business_date FROM app_game_plan_run` returnerte `2026-05-09`, men API-mappingen gjorde dato til 2026-05-08 fordi `Date.getUTCDate()` brukes på en `pg.Date` som internt sender Oslo-midnatt = UTC-22:00 forrige dag.

**Effekt:** Plan-run-objekter som vises i dashbord viser feil dato i grenseperioden 22:00-00:00 UTC (00:00-02:00 Oslo). Multi-day plan-koordinering kan brytes.

**Severity:** Middels — affekterer kun midnatt-vinduet.

---

## 3. Spill 1 end-to-end-flyt

### 3.A Master-actions (Spill 1 master-konsoll)

| Test | Resultat | Endepunkt |
|---|---|---|
| Hent gjeldende plan (agent) | OK | `GET /api/agent/game-plan/current` |
| Player-token blokkert | OK 403 | (samme) |
| Start ny posisjon (agent) | OK | `POST /api/agent/game-plan/start` |
| Engine-bridge skrev `scheduledGameId` | OK | (i response) |
| Spilleplan-state ble `running` | OK | DB-bekreftet |

Eksempel-response:
```json
{
  "ok": true,
  "data": {
    "run": { "status": "running", "currentPosition": 1, ... },
    "scheduledGameId": "f0b609ec-2495-4e95-a220-9757a26249ff",
    "bridgeError": null
  }
}
```

### F5 — `[CRIT] VARIANT_CONFIG_AUTO_BOUND` i log fra eksisterende test-rom

Backend-logger viste ved oppstart:
```
[CRIT] VARIANT_CONFIG_AUTO_BOUND — Spill 1 room mangler variantConfig
  (cache-miss), auto-binder DEFAULT_NORSK_BINGO_CONFIG
```

Dette gjelder den persisterte `BINGO_DEMO-PILOT-GOH`-rommet som auto-rekonstrueres fra checkpoint, ikke det nye spillet som ble laget i dette testløpet. Auto-bind fungerer som fallback, men `[CRIT]`-nivå er overdrevet for noe som er en kjent recovery-path.

**Anbefaling:** Demote til `[WARN]`, eller dokumentere når dette er forventet.

### F6 — Recovery integrity drift

Ved oppstart:
```
[HIGH-4] drift: in-memory drawnNumbers != PG checkpoint
  roomCode=BINGO_DEMO-GOH memCount=64 dbCount=75
  memStatus=RUNNING dbStatus=ENDED
  msg=manuell vurdering anbefales
```

Et eldre rom har inkonsistens mellom in-memory og DB-checkpoint. Dette er en **eldre test-fixture** og påvirker ikke nye runder, men signaliserer at recovery-pathen ikke alltid lukker rom korrekt.

### 3.B Ticket-purchase (spiller-side)

| Test | Resultat | Endepunkt |
|---|---|---|
| Spiller-login | OK | `POST /api/auth/login` |
| Saldo-sjekk | OK (500 NOK) | `GET /api/wallet/me` |
| Bong-kjøp (HTTP, 2× small white) | OK 200, debit 10 NOK | `POST /api/game1/purchase` |
| Idempotency-replay (samme key) | OK 200, `alreadyExisted=true`, ingen ekstra debit | (samme) |
| Insufficient funds (100 bonger) | OK 400 `INSUFFICIENT_FUNDS` | (samme) |
| Compliance-event skrevet | OK med `hall_id=demo-hall-001` | DB-bekreftet |

**Bekreftet:** Wallet = 500 → 490 → 490 (replay) → 485 (andre runde) — eksakt match.

### F7 — `purchase_open` vs `ready_to_start` flow-konflikt

**Funn:** Bridge oppretter scheduled-game direkte i `ready_to_start`. Ticket-purchase krever `purchase_open` (sjekk i `Game1TicketPurchaseService.ts:309`).

**Implikasjon:** `POST /api/agent/game-plan/start` lager `scheduledGameId` i `ready_to_start`, men spillerne kan IKKE kjøpe bonger før noen flytter status til `purchase_open`. `Game1ScheduleTickService.openPurchaseForImminentGames` flytter kun `scheduled → purchase_open`, ikke `ready_to_start → purchase_open`.

**For test-løpet:** Måtte manuelt `UPDATE` status. I prod-pilot må enten:
1. Bridge skrive direkte til `purchase_open`, eller
2. Master-bingovert har en separat handling "åpne bong-salg" før "start spill"

**Test-bekreftelse:** Etter `UPDATE status='purchase_open'` virket purchase første gang.

### 3.C Multi-hall test (PR #443-validering)

| Test | Resultat |
|---|---|
| Spiller fra hall-001 kjøper bong | OK |
| Spiller fra hall-003 kjøper bong (samme runde) | OK ETTER fix av `participating_halls_json` |
| Compliance-entry hall-001 → `hall_id=demo-hall-001` | OK |
| Compliance-entry hall-003 → `hall_id=demo-hall-003` | OK |

**PR #443-fixen virker:** ulike hallID per kjøp, ingen cross-pollution.

### F8 — Manuell `participating_halls_json`-fix nødvendig

Bridge satte `participating_halls_json=["demo-hall-001", "demo-hall-999", "demo-hall-002", "demo-hall-003"]` korrekt på det første spillet (`f0b609ec`). Men når jeg manuelt klonet spillet for purchase_open-test, måtte jeg sette `participating_halls_json` selv, ellers ble multi-hall blokkert med `PURCHASE_CLOSED_FOR_HALL`.

For pilot-flyt er bridge-pathen den brukte, så dette er ikke pilot-blokker — bare en gotcha for fremtidige tester.

### 3.D Game start + draw

| Test | Resultat | Endepunkt |
|---|---|---|
| Engine start (admin med jackpot-confirm) | OK | `POST /api/admin/game1/games/:id/start` med `{"jackpotConfirmed": true}` |
| Auto-draw aktiv | OK (etter `GAME1_AUTO_DRAW_ENABLED=true`) | cron `game1-auto-draw-tick` |
| Phase 1 winner detektert (draw 39) | OK | DB `app_game1_phase_winners` |
| Phase 2-5 winners | INGEN — game endte på draw 52 | (se F22) |
| Game.actual_end_time satt | OK | DB |

### F10 — KRITISK BUG: agent-route mangler `jackpotConfirmed`

**Symptom:** `POST /api/agent/game1/start` returnerer 400 `JACKPOT_CONFIRM_REQUIRED`. Selv om body inneholder `{"jackpotConfirmed": true}`, blir det ignorert. Server-respons:

```json
{
  "ok": false,
  "error": {
    "code": "JACKPOT_CONFIRM_REQUIRED",
    "message": "Jackpott må bekreftes av master før start. Nåværende beløp: 2000 kr."
  }
}
```

**Rotårsak:** `apps/backend/src/routes/agentGame1.ts:553-633` (handler for `/api/agent/game1/start`) leser `confirmExcludedHalls` og `confirmUnreadyHalls` fra body, men IKKE `jackpotConfirmed`. Sammenlign med admin-routen `apps/backend/src/routes/adminGame1Master.ts:319` som korrekt gjør:

```ts
const jackpotConfirmed =
  body.jackpotConfirmed === true || body.jackpotConfirmed === "true";
if (jackpotConfirmed) startInput.jackpotConfirmed = true;
```

**Fix:** Kopier de 2 linjene over fra admin-route til agent-route, etter `confirmUnreadyHalls`-blokken.

**Pilot-impact:** Master-bingovert (HALL_OPERATOR/AGENT-rolle) kan ikke fullføre jackpot-popup-flyten via agent-konsollet. De må bruke admin-route som krever ADMIN-rolle.

**Test-coverage tilført:** `apps/backend/src/__tests__/e2e/spill1FullFlow.test.ts` —
"F10: documents agent-route gap: jackpotConfirmed not in agentGame1.ts (yet)".
Testen vil **failes** (rødt) når noen fikser routen, og kreve oppdatering — det er hensikten.

### F13 — KRITISK ENV-VAR-DEFAULT: `GAME1_AUTO_DRAW_ENABLED=false`

**Sted:** `apps/backend/src/util/envConfig.ts:268`

```ts
const jobGame1AutoDrawEnabled = parseBooleanEnv(process.env.GAME1_AUTO_DRAW_ENABLED, false);
```

**Symptom:** Etter `POST /api/admin/game1/games/:id/start`, scheduled-game var i `running` og engine-state var `paused=false`, MEN det ble aldri trukket en eneste ball — fordi cron-jobben `game1-auto-draw-tick` var disabled.

**Bekreftelse:**
- Restart backend med `GAME1_AUTO_DRAW_ENABLED=true` ⇒ trekk fungerte umiddelbart, 7 trekk på 12 sekunder.
- Restart uten env-var ⇒ samme spill, ingen trekk.

**Pilot-impact:** Hvis prod-deploy ikke setter denne env-varen, vil hver runde feile silent.

**Anbefaling:**
1. Endre default i `envConfig.ts:268` til `true`.
2. Eller — sett `GAME1_AUTO_DRAW_ENABLED=true` eksplisitt i `render.yaml`.
3. Eller — legg til health-check som verifiserer at running-spill faktisk får ticks innen N sekunder.

### F22 — Game ender etter `DEFAULT_GAME1_MAX_DRAWS = 52`

**Sted:** `apps/backend/src/game/Game1DrawEngineService.ts:166`

```ts
export const DEFAULT_GAME1_MAX_DRAWS = 52;
```

**Observasjon:** Med 2 small-white-bonger i spillet:
- Phase 1 (Rad 1) vunnet på draw 39
- Phases 2-5 nådde aldri winner (kun 2 brett, lav statistisk sannsynlighet)
- Game endte automatisk på draw 52 → status="completed", `engine_ended_at` satt

Dette er **forventet legacy-oppførsel**. 52-trekks-grensen er valgt for å begrense spilltid, ikke fordi alle phases skal være vunnet.

**Spørsmål til Tobias:** Skal vi ha en dokumentert melding/UI hvis spillet ender uten Fullt Hus-vinner? Bør spillet trekke videre til Fullt Hus uavhengig av 52-grensen?

### F21 — Manglende logging når spillet auto-ender

**Symptom:** Logger viste:
```
[GAME1_PR4c] phase payout completed (phase 1, winner 1)
[master.resume] auditId=... resumeType=auto
```

og deretter ingenting frem til DB viste `actual_end_time` satt og `status='completed'`.

**Forventet (per CLAUDE.md regel 3.4 R5/R8):** strukturert event-logg per state-overgang, inkludert `[engine] game completed reason=MAX_DRAWS_REACHED draws=52`.

**Anbefaling:** Legg til log-event i `Game1DrawEngineService.drawNext()` ved completion-path.

### 3.E Vinst-flyt + premie

Phase 1 winner (DB `app_game1_phase_winners`):
```
phase=1, winner_user_id=demo-pilot-spiller-1, hall_id=demo-hall-001,
draw_sequence_at_win=39, prize_amount_cents=10000, ticket_color=white,
wallet_transaction_id=b3479945-2c85-482a-8d5f-2c3ef2add290
```

Wallet-balanse for spiller-1 før/etter:
- Initial: 500 NOK
- Etter 2× small white kjøp: 490 NOK (10 NOK debit)
- Etter andre runde 1× small white: 485 NOK
- Etter Phase 1 win: **585 NOK** (100 NOK credit) ✓

Compliance-ledger-entries for spiller-1:
| event_type | amount | hall_id |
|---|---|---|
| STAKE | 10.00 | demo-hall-001 |
| STAKE | 5.00 | demo-hall-001 |
| PRIZE | 100.00 | demo-hall-001 |

**Alt validerer:** purchase + payout-paths binder til kjøperens hall (PR #443-fix bekreftet).

---

## 4. Edge-case-tester

| Test | Forventet | Faktisk | OK? |
|---|---|---|---|
| Multi-hall-purchase (hall-001 + hall-003 i samme runde) | Begge OK med distinct compliance hall-binding | OK | ✓ |
| Plan↔spill-mismatch (plan running uten scheduled-game) | `inconsistencyWarnings` rapporterer | Kunne ikke teste — `/lobby` failer F17 | ✗ |
| Insufficient funds (100 bonger) | 400 INSUFFICIENT_FUNDS | OK | ✓ |
| Master-action fra ikke-master | 403 FORBIDDEN med Norwegian-melding | OK | ✓ |
| Reconnect mid-runde (R3) | Full state-replay | Kunne ikke teste — krever socket.io-klient med disconnect-simulering | (skip) |

### F17 — KRITISK SCHEMA-BUG: `Spill1AgentLobbyStateSchema` brekker for seed-data

**Symptom:** `GET /api/agent/game1/lobby` med `Authorization: Bearer <agent-1>` returnerte:

```json
{ "ok": false, "error": { "code": "INTERNAL_ERROR", "message": "Lobby state schema-validation failed" } }
```

**Server-log:**
```
issues: [{
  code: "invalid_format", format: "uuid", path: ["planMeta", "planId"],
  message: "Invalid UUID"
}]
hallId: "demo-hall-001"
msg: "[lobby-route] aggregator returned schema-violating payload — backend bug"
```

**Rotårsak:** `packages/shared-types/src/spill1-lobby-state.ts:219`:

```ts
planId: z.string().uuid(),
```

Men seed-data har `app_game_plan.id = 'demo-plan-pilot'`, som ikke er UUID.

**Fix-alternativer:**
1. Endre seed til UUID — bryter alle eksisterende referanser fra plan-items, plan-runs, scheduled-games osv.
2. Endre schema til `z.string().min(1)` — løsner kontrakten.
3. Migrasjon som re-skaper planen med UUID + cascading-references.

**Anbefaling:** Alternativ 2. UUID-krav er en falsk constraint — DB-en lar `text` være hva som helst, og seed-data har bevisst lesbare ID-er.

**Test-coverage tilført:** 3 test-cases i `spill1FullFlow.test.ts` som låser kontrakten:
- Rejecter 'demo-plan-pilot' (regression-lock)
- Aksepterer ekte UUID (control)
- Aksepterer empty-state shape (no false-positive)

---

## 5. Funn oppsummert

| ID | Kategori | Tittel | Severity | Pilot-blokker? |
|---|---|---|---|---|
| F1 | Onboarding | `npm install` på root installerer ikke `apps/backend/` | low | nei |
| F2 | Onboarding | `npm run build:types` må kjøres før første dev-start | low | nei |
| F3 | Design | `master_hall_id` på `app_hall_groups`, ikke `app_halls` | n/a | nei |
| F4 | Bug | Tidssone-bug i `dateRowToString` (UTC vs Oslo) | medium | nei |
| F5 | Logging | `[CRIT]` for kjent recovery-fallback overdrevet | low | nei |
| F6 | Recovery | Eldre rom har drift mellom in-memory og DB | medium | nei |
| F7 | Flow | Bridge skriver `ready_to_start`, men purchase krever `purchase_open` | medium | **delvis** — krever manuell rute eller egen flyt |
| F8 | Diagnostic | `participating_halls_json` må settes manuelt for kloner | low | nei |
| F10 | **BUG** | Agent-route mangler `jackpotConfirmed`-wireup | high | **JA** |
| F13 | **BUG** | `GAME1_AUTO_DRAW_ENABLED` defaulter til false | high | **JA** |
| F17 | **BUG** | Lobby-schema krever UUID, seed har ikke | high | **JA** |
| F21 | Logging | Manglende log når engine ender silently | low | nei |
| F22 | Design | `MAX_DRAWS=52` kan gi runder uten Fullt Hus | low | nei (forventet) |

---

## 6. Anbefalt prioritering — pre-pilot

**P0 (må fikses før pilot-go-live):**

1. **F13** — Sett `GAME1_AUTO_DRAW_ENABLED=true` i `render.yaml` ELLER endre default i `envConfig.ts:268`. Estimat: 5 minutter.
2. **F17** — Fix `Spill1AgentLobbyStateSchema.planId` (fjern UUID-constraint). Estimat: 1-2 timer (incl. typecheck, run tests).
3. **F10** — Wire opp `jackpotConfirmed` i `agentGame1.ts:start`-handler. Estimat: 1-2 timer (incl. test).

**P1 (bør fikses før pilot, ikke blokker):**

4. **F4** — Fix `dateRowToString` til Oslo-tz. Estimat: 1 dag.
5. **F7** — Avklar med Tobias: skal bridge skrive direkte i `purchase_open`, eller skal master-bingovert eksplisitt åpne bong-salg? Estimat: 0.5 dag avklaring + 1 dag implementasjon.
6. **F21** — Legg til `[engine] game completed reason=...` log-event. Estimat: 30 min.

**P2 (post-pilot polish):**

7. **F1, F2** — Onboarding-doc-oppdateringer (CLAUDE.md, AGENT_ONBOARDING.md). Estimat: 30 min.
8. **F5, F6** — Log-nivå cleanup + recovery-rom-oppryd. Estimat: 1 dag.
9. **F22** — Avklar med Tobias om 52-trekks-grensen. Estimat: 0 koding (kanskje doc-vinner).

---

## 7. Tester tilført

**Fil:** `apps/backend/src/__tests__/e2e/spill1FullFlow.test.ts` (193 linjer)

5 testcases låser:
- F22 `DEFAULT_GAME1_MAX_DRAWS = 52` (kontrakt)
- F17 schema-validering for seed-style + UUID-style + empty-state
- F10 agent-route wire-up gap (rødt når fixet — refactor-driver)

**Run:** `npm --prefix apps/backend run test:e2e` ⇒ 5/5 grønn (sammen med eksisterende `Spill1FullDay.e2e.test.ts`).

**Compliance-suite:** `npm --prefix apps/backend run test:compliance` ⇒ 403/403 grønn (ingen regresjon).

---

## 8. Konklusjon

**Pilot-go/no-go:** **NO-GO** inntil F10, F13, F17 er fikset.

Estimat for pilot-readiness: **0.5-1 dev-dag** for å lukke de tre P0-blokkerne. Verdikjeden virker, så det er ikke arkitektur-arbeid — bare wire-up.

**Verifisert virker end-to-end:**
- Auth + KYC + wallet
- Spilleplan-start → engine-start (via admin-route)
- Bong-kjøp med idempotency
- Multi-hall compliance-binding (PR #443)
- Auto-draw + winner-detection + payout
- Wallet credit ved Phase 1 winner
- Compliance-ledger-skriving med korrekt hall

**Verifisert IKKE end-to-end:**
- Agent-master-flyten (F10 blokkerer)
- Lobby-state-polling (F17 blokkerer)
- Spill 2 og Spill 3 (out of scope per oppdrag)
- Reconnect-recovery (R3, krever socket-test-rig)

---

**Bemerkninger til parent agent:**

- Branch `test/spill1-end-to-end-verification` er pushet og inneholder denne docen + 1 ny test-fil + ingen produksjons-kode-endringer.
- `npm test:compliance` er fortsatt grønn (403/403).
- `npm run check` er fortsatt grønn.
- Ingen filer i konflikt-soner (sockets/, security/, PostgresWalletAdapter, smoke-test, drill-doc, pilot-runbook, compliance-doc) er endret.

---

## 9. Status-oppdatering 2026-05-09 (cleanup-bølge etter F10/F13/F17)

Etter at F10/F13/F17 ble fikset (PR #1101) er resterende funn nå adressert.
Status per funn:

| ID | Severity | Status | PR / branch |
|---|---|---|---|
| F1 | low | ✅ Lukket — dokumentert i CLAUDE.md + AGENT_ONBOARDING.md | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F2 | low | ✅ Lukket — dokumentert i CLAUDE.md + AGENT_ONBOARDING.md | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F3 | n/a | ✅ Akseptert — eksisterende design (F3 er bare verifikasjon) | (ingen kode-endring) |
| F4 | medium | ✅ Lukket — `formatOsloDateKey` brukt i `dateRowToString` | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F5 | low | ✅ Lukket — `[CRIT]` demoted til `[WARN]` for kjent recovery-fallback | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F6 | medium | 🔵 Akseptabel post-pilot — eldre test-fixture-rom; krever recovery-path-refaktor | (post-pilot) |
| F7 | medium | ✅ Lukket — `PURCHASE_ALLOWED_STATUSES` aksepterer både `purchase_open` og `ready_to_start` | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F8 | low | 🔵 Akseptabel — kun gotcha for fremtidige tester; bridge-pathen virker korrekt i prod-flyt | (kjent gotcha) |
| F10 | high | ✅ Lukket | PR #1101 |
| F13 | high | ✅ Lukket | PR #1101 |
| F17 | high | ✅ Lukket | PR #1101 |
| F21 | low | ✅ Lukket — strukturert log-event når engine ender med reason+draws+phase | `fix/spill1-e2e-cleanup-f4-f7-plus-low` |
| F22 | low | 🔵 Avklaring til Tobias — `MAX_DRAWS=52` er forventet legacy-oppførsel; spørsmålet "skal spillet trekke videre til Fullt Hus" er produkt-beslutning, ikke bug | (Tobias-spørsmål) |

**Pilot go/no-go etter cleanup-bølge:** **GO** — alle pilot-blokkere lukket.
F6 og F8 er aksepterte, og F22 er produkt-spørsmål uten kode-endring.

**Cleanup-bølge-commits (`fix/spill1-e2e-cleanup-f4-f7-plus-low`):**

| Commit | Funn | Beskrivelse |
|---|---|---|
| `0c007c75` | F4 | `dateRowToString` bruker `formatOsloDateKey` (Oslo-tz-fix) + 6 unit-tester |
| `4e6f9492` | F7 | `PURCHASE_ALLOWED_STATUSES` med `ready_to_start` tillatt + 7 unit-tester |
| `66a45e73` | F5 + F21 | `[CRIT]` → `[WARN]` for recovery-fallback + ny `[engine] game completed`-log-event |
| `54163e13` | F1 + F2 | CLAUDE.md + AGENT_ONBOARDING.md pre-flight-instruksjoner |

**Test-totaler:**
- 13 nye unit-tester (6 F4 + 7 F7), alle grønne.
- TypeScript strict-mode passerer (`npm --prefix apps/backend run check`).
- 0 regresjon i eksisterende test-suite.

**Akseptert post-pilot (F6, F8):**
- F6: eldre test-fixture-rom har drift mellom in-memory og DB-checkpoint.
  Påvirker ikke nye runder. Krever recovery-path-refaktor som ikke
  er pilot-blokker. Anbefales håndtert i egen post-pilot-issue.
- F8: gotcha for testere som manuelt kloner scheduled-games — bridge-
  pathen i prod setter `participating_halls_json` korrekt. Dokumentert
  i denne rapporten som tester-gotcha.

**Tobias-avklaring (F22):**
- `DEFAULT_GAME1_MAX_DRAWS = 52` avslutter spill etter 52 trekk uavhengig
  av om Fullt Hus er funnet. Forventet legacy-oppførsel for å begrense
  spilltid. **Produkt-spørsmål:** Skal vi vise UI-melding eller tillate
  videre trekk til Fullt Hus i pilot? Krever Tobias-beslutning.
