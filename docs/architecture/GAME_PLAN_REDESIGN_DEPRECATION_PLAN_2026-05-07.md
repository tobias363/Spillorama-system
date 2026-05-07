# Spilleplan-redesign: deprecation-plan

**Status:** Klar for utrulling. Fase 4 merget 2026-05-07.
**Eier:** Tobias (teknisk lead)
**Berørte tabeller:** app_game1_scheduled_games, app_daily_schedules, hall_game_schedules, app_schedules, hall_schedule_log

## Bakgrunn

Spilleplan-redesignen (Fase 1-4) erstatter dagens 9-tabells schedule-stack med 4 nye tabeller:

| Gammel modell | Ny modell |
|--------------|-----------|
| `app_game_management` | `app_game_catalog` |
| `app_daily_schedules` | `app_game_plan` |
| `app_sub_games` | `app_game_plan_item` |
| `app_schedule_sub_games` | (samme — `app_game_plan_item`) |
| `app_schedules` | (innholdet flyttet til `app_game_plan` + `app_game_plan_item`) |
| `hall_game_schedules` | (innholdet flyttet til `app_game_plan` + `app_game_plan_item`) |
| `hall_schedule_log` | (audit i `app_audit_log` med resource=`game_plan_run`) |
| `app_game1_scheduled_games` | (beholdes som "live" runtime-tabell — engine-bridge i Fase 4) |

Engine-en (Game1MasterControlService.startGame) leser fortsatt `app_game1_scheduled_games`. Fase 4-bridge spawn-er rader i denne tabellen fra plan-runs slik at engine kjører uendret.

## Tidsplan

### T+0 → T+7 dager (uke 1)

- **Mål:** Tobias og QA-personalet tester ny flow internt.
- **Aktivt:** Begge modeller side om side. Feature flag `useNewGamePlan` av per default.
- **Activate flag:** `localStorage.setItem('ff:useNewGamePlan', 'true')` i nettleseren. (Prefix `ff:` settes av `featureFlags.ts` — uten det er flagget ikke aktiv.)
- **Verifiser:**
  - Master-dashbord rendrer identisk med begge flagg-states.
  - Start/Advance-flow oppretter korrekt scheduledGameId via bridgen.
  - Engine kjører som før — ingen wallet/audit-diskrepans.
- **Rollback:** Slå av `useNewGamePlan` i localStorage. Gamle data uberørt.

### T+7 → T+14 dager (uke 2)

- **Mål:** En pilot-hall (Årnes) bruker ny flyt i prod.
- **Setup:** Aktiver `useNewGamePlan` for HALL_OPERATOR-brukerne i Årnes.
- **Migrate data:** Kjør `npx tsx scripts/migrate-game-plan-2026-05-07.ts --dry-run` mot prod for forhåndsvisning. Hvis ok, kjør `--execute`.
- **Verifiser:** `npx tsx scripts/verify-game-plan-migration.ts` — exit-kode 0.
- **Monitor:**
  - Audit-log: `data_migration.game_plan_redesign.execute`-events
  - Bridge-error-rate i Sentry
  - Spawn-tall (forventer 1 scheduled-game per `start`-call)

### T+14 → T+30 dager (uke 3-4)

- **Mål:** Rull ut til alle pilot-haller (4 stk).
- **Action:** Aktiver feature flag for alle HALL_OPERATOR.
- **Logg:** Eventuelle diskrepanser mellom legacy og ny flyt rapporteres til Tobias.
- **Hvis stabil:** Forbered T+30 globalt rollout.

### T+30 dager (uke 5)

- **Mål:** Globalt rollout — ny modell standardisert.
- **Action:** `useNewGamePlan` settes globalt til true (fjern feature flag i `featureFlags.ts`).
- **Legacy-endpoints:** Marker `/api/agent/game1/current-game` som deprecated i OpenAPI med `Deprecation`-header. Returnerer fortsatt 200 men med adapter-shape.
- **Stop-kriterium:** Hvis bridge-error-rate > 1% over 24t, rull tilbake til T+7-tilstand.

### T+60 dager (måned 2)

- **Mål:** Ingen kode leser fra gamle tabeller lenger.
- **Action:** Fjern alle referanser til:
  - `app_daily_schedules` i kode (Game1ScheduleTickService etc.)
  - `app_schedules` i kode
  - `hall_game_schedules` i kode
  - `hall_schedule_log` i kode
- **Migration:** Skriv en ny forward-only migration som:
  - `DROP TABLE app_daily_schedules`
  - `DROP TABLE app_schedules`
  - `DROP TABLE hall_game_schedules`
  - `DROP TABLE hall_schedule_log`
  - `DROP TABLE app_game1_scheduled_games` (etter at bridge ikke trenger den — krever større refaktor i engine)
- **Audit-bevaring:** `app_audit_log` beholder alle eksisterende rader. Resource-IDer som peker til legacy-tabeller blir "døde" referanser men forblir gyldige for historikk.

### T+90 dager (måned 3)

- **Mål:** Migration-skriptet er ikke lenger nødvendig.
- **Action:** Fjern `scripts/migrate-game-plan-2026-05-07.ts` + `migrate-game-plan-helpers.ts` + `verify-game-plan-migration.ts`.
- **Final cleanup:** Fjern `catalog_entry_id`, `plan_run_id`, `plan_position` fra `app_game1_scheduled_games` om engine ikke trenger dem (etter T+60-DROP).

## Rollback-strategi

### Scenario 1: Bridge-feil oppdaget i T+0 → T+30

Hvis bridgen produserer feil scheduledGameId-rader eller engine kjører feil prizes:

1. **Umiddelbart:** Slå av `useNewGamePlan` i localStorage på alle terminals.
2. **Verifiser:** Master-dashbord faller tilbake til legacy `/api/agent/game1/current-game`.
3. **Diagnose:** Les bridge-error-events fra audit-log + Sentry.
4. **Rollback (om nødvendig):** `npx tsx scripts/migrate-game-plan-2026-05-07.ts --rollback` fjerner alle migrerte rader (kun rader med `mig-fase4-` prefix).
5. **Fix:** Deploy fix, prøv igjen.

### Scenario 2: Data-migrasjon-feil

Hvis migrasjons-skriptet skriver feil data:

1. **Identifiser:** `npx tsx scripts/verify-game-plan-migration.ts` rapporterer diff.
2. **Rollback:** `--rollback` fjerner alle migrerte rader.
3. **Fix:** Oppdater helpers, kjør `--execute` på nytt.
4. **Re-verify:** Verifiseringsskriptet skal nå returnere 0.

## Audit-bevaring

Pengespillforskriften krever 7 år audit-historikk:

- **Eksisterende `app_audit_log`-rader** peker til gamle resource-IDer (eks `game1_scheduled_game.7020f09f-...`). Disse forblir gyldige etter DROP TABLE — vi sletter ALDRI audit-rader.
- **Nye audit-events** (Fase 4 og fremover) bruker resource-types `game_catalog`, `game_plan`, `game_plan_run`. Resource-IDer er distinkte fra legacy.
- **Lotteritilsynet-rapporter** må joine begge resource-typer for komplett bilde.
- **Migrasjons-events** logges med `action="data_migration.game_plan_redesign.execute|rollback"` så det er sporbart hvilke data som ble flyttet.

## Sjekkliste før globalt rollout

- [ ] Tobias har testet ny flyt på minst 1 hall i 7 dager uten feil
- [ ] `npx tsx scripts/verify-game-plan-migration.ts` returnerer 0
- [ ] Bridge-error-rate < 1% i Sentry over 7 dager
- [ ] Alle 4 pilot-haller har kjørt på ny flyt minst 24t hver
- [ ] Lotteritilsynet-rapporter generert for testperioden er korrekte
- [ ] Backup av prod-DB tatt < 7 dager før rollout
- [ ] Rollback-prosedyre verifisert i staging

## Engine-bridge oppdateringer post-Fase 4

- **2026-05-08 — Oddsen-runtime (Agent 1, branch `feat/oddsen-engine-bridge-runtime-2026-05-08`):**
  Bridge skriver `spill1.oddsen` med per-bongfarge `bingoLow/HighPrizes`
  når `catalog.rules.gameVariant === "oddsen"`. Engine
  (`Game1DrawEngineService.payoutOddsenFullHouse` via
  `Game1DrawEngineHelpers.planOddsenFullHousePayout`) velger HIGH/LOW
  basert på `drawSequenceAtWin <= rules.targetDraw`. Fallback til
  standard pattern-payouts hvis `spill1.oddsen` mangler. Tester:
  `apps/backend/src/game/__tests__/GamePlanEngineBridge.oddsen.test.ts`,
  `Game1DrawEngineHelpers.oddsen.test.ts`,
  `Game1PayoutService.oddsen.test.ts`. Trafikklys-runtime gjenstår.

## Referanser

- Fase 1: PR #980 — DB-modell + service-layer
- Fase 2: PR #981 — Admin-UI for catalog + plan
- Fase 3: PR #982 — Runtime-kobling med feature flag
- Fase 4: (denne — engine-bridge + data-migrasjon)
- `apps/backend/migrations/20261210000000_app_game_catalog_and_plan.sql`
- `apps/backend/migrations/20261210010000_app_game1_scheduled_games_catalog_link.sql`
- `apps/backend/migrations/20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql`
- `apps/backend/src/game/GamePlanEngineBridge.ts`
- `apps/backend/scripts/migrate-game-plan-2026-05-07.ts`
- `apps/backend/scripts/verify-game-plan-migration.ts`
