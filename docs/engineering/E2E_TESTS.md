# Synthetic E2E tests (BIN-823)

**Status:** Etablert 2026-05-08 etter Tobias-direktiv: "Fanger cross-system-bugs som unit-tester ikke ser. Pilot-go-live-confidence."

Dette dokumentet beskriver hvordan vi kjører **automatiserte E2E-tester** mot et ephemert backend i CI og lokalt. Det er distinkt fra:

- **`apps/backend/scripts/e2e-smoke-test.ts`** — manuell røyk-sjekk mot **live staging** før prod-deploy. Forutsetter seedet DB. Se `docs/operations/E2E_SMOKE_TEST.md`.
- **`apps/backend/src/__tests__/e2e_4hall_master_flow.test.ts`** og lignende — in-process-integrasjon med stub-pool. Tester service-graf uten å spawne backend.

De **synthetiske E2E-testene** sitter mellom de to: de spawner ekte `node dist/index.js`, kobler til ekte (men ephemer) Postgres + Redis, og verifiserer protokoll-kontrakter via HTTP.

---

## 1. Hva testes

Filen `apps/backend/src/__tests__/e2e/Spill1FullDay.e2e.test.ts` dekker:

| Fase | Hva |
|------|-----|
| 1.1 | `/health` returnerer 200 |
| 1.2 | `/api/status` har dokumentert shape |
| 1.3 | `/api/games/spill1/health` validerer `hallId`-param |
| 2.1 | `POST /api/auth/register` returnerer gyldig token |
| 2.2 | `GET /api/auth/me` returnerer profil for ny spiller |
| 2.3 | `GET /api/wallet/me` returnerer wallet-snapshot |
| 3.1 | `/api/agent/game1/start` avviser uautentiserte kall |
| 3.2 | `/api/agent/game1/start` avviser PLAYER med FORBIDDEN |
| 3.3 | `/api/agent/game1/pause` avviser uautentiserte kall |
| 3.4 | `/api/agent/game1/stop` avviser uautentiserte kall |
| 3.5 | Admin master-endpoints avviser uautentiserte kall |
| 4.1 | DomainError-respons er `{ ok:false, error:{code,message} }` |
| 4.2 | Public CMS-endpoints crashes ikke ved unseeded slugs |
| 5.1 | Backend lever fortsatt etter hele suiten |

### Hva er IKKE dekket (TODO)

- **Full master-cycle** (start → draws → pause → resume → stop → settlement) krever seedet `app_halls`, `app_hall_groups`, `app_daily_schedules`, `app_game1_scheduled_games` + ticket-config. Det er ~15 dependent tabeller. Dekkes i dag av `apps/backend/scripts/e2e-smoke-test.ts` mot seedet staging.
- **Socket.IO live-broadcast.** Egen oppgave (BIN-768 Phase 3).
- **Ticket-purchase → draw-tick → payout-flow.** Dekket av `Game1DrawEngineService.test.ts` og chaos-suiten (`__tests__/chaos/`).

Disse hullene er bevisste — det er bedre å ha en **rask, CI-trygg** E2E-test som fanger protokoll-drift, enn én lang test som er for skjør for PR-feedback.

---

## 2. Kjøre lokalt

```bash
# 1. Spinner up isolated infra (Postgres @ 5433, Redis @ 6380).
docker-compose -f docker-compose.e2e.yml up -d

# 2. Build backend (test exec'er node dist/index.js).
npm --prefix apps/backend run build

# 3. Run E2E.
E2E_PG_CONNECTION_STRING=postgresql://e2e:e2e@127.0.0.1:5433/spillorama_e2e \
E2E_REDIS_URL=redis://127.0.0.1:6380/0 \
  npm --prefix apps/backend run test:e2e

# 4. Tear down (volumer er tmpfs, så ingen state etterlates uansett).
docker-compose -f docker-compose.e2e.yml down -v
```

Hvis du allerede har Postgres/Redis lokalt på standardporter (5432/6379), kan du peke env-vars dit i stedet — testen lager sitt eget skjema og dropper det etterpå.

### Hopp over E2E i lokal `npm test`

Det vanlige `npm --prefix apps/backend run test`-kommandoen kjører glob `src/**/*.test.ts` som inkluderer E2E. Men E2E **skipper automatisk** når `E2E_PG_CONNECTION_STRING` ikke er satt, så det kommer ut som SKIP, ikke FAIL.

---

## 3. Kjøre i CI

Workflow: `.github/workflows/e2e-test.yml`

Triggere:
- Pull-requests som rører `apps/backend/src/game/**`, `apps/backend/src/wallet/**`, `apps/backend/src/compliance/**`, master-rute-filene, eller migrations.
- Push til `main`.

Path-filteret er bevisst smalt — andre PR-er går gjennom regulær `ci.yml`. Dette holder E2E-jobben rask og fokusert på de paths som rører kritisk live-rom-state.

CI-jobben:
1. Spinner opp Postgres 16 + Redis 7 som services-block-containere.
2. Bygger `packages/shared-types` + `apps/backend`.
3. Kjører `npm --prefix apps/backend run test:e2e`.

Forventet kjøretid: 60-120 sekunder.

---

## 4. Hvordan legge til en ny E2E-test

1. **Vurder først:** Er en in-process-test nok? E2E er dyrere — bare bruk dem når du faktisk trenger ekte HTTP/DB/Redis.
2. **Plassering:** `apps/backend/src/__tests__/e2e/<Feature>.e2e.test.ts`
3. **Mønster:** Følg `Spill1FullDay.e2e.test.ts`:
   - Bruk `node:test` (`describe`, `test`, `before`, `after`).
   - Bruk skip-betingelse på `E2E_PG_CONNECTION_STRING` + `E2E_REDIS_URL`.
   - Spawn backend én gang per `describe` (start i `before`, stopp i `after`).
   - Bruk `callApi`-helperen for HTTP — den parser konsistent og returnerer `{status, body, raw}`.
4. **Hold testen rask.** Hver fase bør være < 1s. Hvis du trenger seeding av tabeller, vurder om det egentlig hører hjemme i staging-smoke-testen i stedet.
5. **Test feilstier også.** Det er like verdifullt å assert at en uautentisert request returnerer 401/403 som å assert at en autentisert returnerer 200.

---

## 5. Debug-tips

**Backend dør ved oppstart:**
- Test-fil printer fullstdig stdout/stderr ved boot-failure. Søk etter `[FATAL]`, `Mangler connection string`, `SyntaxError`.
- Verifiser at `dist/index.js` er bygget mot samme commit (`npm run build`).

**Skjema-konflikt:**
- Hver test-run lager unik skjema (`e2e_<uuid16>`) og dropper i teardown. Hvis testen abortes hardt, kan rester ligge igjen — kjør `DROP SCHEMA e2e_xxx CASCADE` manuelt eller gjenbruk DB-en (skjemaer påvirker ikke hverandre).

**HTTP-call timeout:**
- Backend bruker 30s for å bli healthy ved cold-boot. Hvis testen feiler på `/health did not return 200`, sjekk at Postgres og Redis faktisk er klare før spawn (services-blokken har healthcheck — lokalt må du vente på at compose blir healthy).

**Testen passerer lokalt men feiler i CI:**
- CI bruker `localhost:5433` / `localhost:6380` mens `docker-compose.e2e.yml` lokalt eksponerer samme porter på `127.0.0.1`. Forskjellen er sjelden et problem, men sjekk env-strings hvis testen ikke connect-er.
- CI-runners er svakere — øk `waitForHealthy`-deadline om nødvendig.

---

## 6. Forhold til wallet-test-suiten og chaos

| Test-type | Plassering | Når |
|-----------|------------|-----|
| Unit / service | Co-located `*.test.ts` | Hvert `npm test`-kjør |
| Wallet invariants | `__tests__/invariants/` | Hvert `npm test`-kjør |
| Chaos / R2 R3 | `__tests__/chaos/` | Hvert `npm test`-kjør |
| In-process integration | `__tests__/e2e_*_test.ts` | Hvert `npm test`-kjør |
| **Synthetic E2E (denne)** | `__tests__/e2e/*.e2e.test.ts` | PR-touch på kritisk path; main push |
| Boot smoke | `__tests__/bootStartup.test.ts` | Hver PR (boot-test job) |
| Manual staging smoke | `scripts/e2e-smoke-test.ts` | Pre-prod-deploy |
| Visual regression | Playwright | Frontend-PR-er |

Synthetic E2E supplerer — erstatter ikke — de andre lagene.

---

## 7. Pilot-gating

Per `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §6 må E2E være grønn før vi går live i pilot-haller. Spesielt:

- Auth-RBAC-kontraktene (Phase 3) er fundamentale — hvis disse drifter, kan PLAYER teoretisk starte runder. Det er en regulatorisk show-stopper.
- Shape-kontrakten på `/api/games/spill1/health` (Phase 1.3) støtter R7-alerting (BIN-814). Hvis den drifter, slutter alerting å virke uten at vi merker det.

Når vi utvider pilot-skopet, utvid også E2E-suiten — ikke bare staging-smoke-testen.
