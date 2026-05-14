# Stuck plan-run reconcile — runbook

**Status:** Aktiv (FIX-1, 2026-05-14)
**Eier:** Backend team
**Trigger:** OBS-6 DB-auditor (`npm run audit:db --quick`) rapporterer
`stuck-plan-run`-funn på P1-nivå.

---

## Hva er en "stuck plan-run"?

En `app_game_plan_run`-rad i `status='running'` der INGEN linkede
`app_game1_scheduled_games` er i en aktiv status
(`scheduled`/`purchase_open`/`ready_to_start`/`running`/`paused`).

Klient-effekt: master-konsoll og spiller-shell sitter fast og venter på
neste runde som aldri spawnes. Brytes §71-pengespillforskriften fordi
plan-run telles som "running" i daglig regulatorisk rapport mens ingen
spill faktisk pågår.

## Hvordan oppstår det?

Eksempler observert i pilot-test:

1. **Master-restart midt i transition** — backend krasjer mellom
   `planRunService.advanceToNext()` (position++ commit) og
   `engineBridge.createScheduledGameForPlanRunPosition()`-spawn.
2. **Race-condition i master-actions** — to parallelle actions konkurrer
   om samme plan-run; én av dem fullfører plan-mutering men aldri triger
   scheduled-game-spawn.
3. **Manuell stop uten å kalle `planRunService.finish`** — agent SQL-
   editer scheduled-game til `cancelled` men glemmer å sette plan-run
   til `finished`.

## Multi-lag forsvar (FIX-1, 2026-05-14)

### Lag 1: Runtime auto-reconcile

`MasterActionService.start()` og `advance()` kaller
`reconcileStuckPlanRuns({hallId, businessDate, actor})` FØR de utfører
plan-run-state-overgang. Hvis stuck-rader detekteres, markeres de
`finished` med audit-event `plan_run.reconcile_stuck`.

**Soft-fail:** Hvis `findStuck` eller `finish` selv kaster (DB-feil eller
race-condition), logges feilen og master-flyten fortsetter. Vi vil ikke
blokkere master på en cleanup-bug.

**Implementasjon:**
- `apps/backend/src/game/MasterActionService.ts` — `reconcileStuckPlanRuns`
- `apps/backend/src/game/GamePlanRunService.ts` — `findStuck`

### Lag 2: Backfill-migration

`apps/backend/migrations/20261226000000_reconcile_stuck_plan_runs.sql`
markerer eksisterende stuck-rader fra siste 7 dager `finished` med
audit-event `plan_run.reconcile_stuck.backfill`. Idempotent — WHERE-
klausulen filtrerer på status='running' så finished rader berøres ikke
ved re-kjøring.

### Lag 3: Eksisterende nattlig cleanup (uendret)

`GamePlanRunCleanupService.cleanupAllStale` rydder fortsatt gårsdagens
stale rader (`business_date < today`) hver natt kl 03:00 Oslo-tz. FIX-1
dekker dagens stuck-rader, ikke arkivering.

## Verifikasjon etter fix

```bash
# 1. Sjekk audit:db baseline (kan ha stuck-plan-run funn).
APP_PG_CONNECTION_STRING="postgres://..." \
  node apps/backend/scripts/audit-db.mjs --quick

# 2. Kjør backfill-migration (hvis ikke allerede applied).
APP_PG_CONNECTION_STRING="postgres://..." \
  npm --prefix apps/backend run migrate

# 3. Verifiser at audit:db nå rapporterer 0 stuck-plan-runs.
APP_PG_CONNECTION_STRING="postgres://..." \
  node apps/backend/scripts/audit-db.mjs --quick

# 4. Verifiser audit-event ble skrevet for hver reconcile.
psql -c "SELECT action, resource_id, details->>'reason' AS reason \
         FROM app_audit_log \
         WHERE action LIKE 'plan_run.reconcile_stuck%' \
         ORDER BY created_at DESC LIMIT 10;"
```

## §71-pengespillforskriften-sporbarhet

Hver reconcile (runtime + backfill) skriver audit-event:
- `plan_run.reconcile_stuck` — fra `MasterActionService` (runtime)
- `plan_run.reconcile_stuck.backfill` — fra migration (engangs)

Begge inneholder:
- `plan_id`, `hall_id`, `business_date`, `current_position`
- `reason` (`no_active_scheduled_games` / `backfill_stuck_state_2026_05_14`)
- `previous_status` (alltid `running`)
- `new_status` (alltid `finished`)

Lotteritilsynet-revisor kan reprodusere hvilke rader ble ryddet, når, og
hvorfor ved å spørre `app_audit_log` på disse action-strengene.

## Når trigger seg ny stuck-state?

Hvis ny stuck-rad oppstår etter at FIX-1 er deployet:
1. Sjekk `app_audit_log` for `plan_run.reconcile_stuck`-events i
   tidsvinduet — runtime-reconcile bør ha fanget det.
2. Hvis ingen reconcile-audit finnes, sjekk for `findStuck`-feil i logs
   (`module=master-action-service`, `event=plan_run.reconcile.stuck`).
3. Hvis flere stuck-rader per uke for samme hall — pek på
   `GamePlanEngineBridge` race-condition; eskaler til backend-team.

## Relaterte filer

- Runtime: `apps/backend/src/game/MasterActionService.ts`
- Helper: `apps/backend/src/game/GamePlanRunService.ts:findStuck`
- Migration: `apps/backend/migrations/20261226000000_reconcile_stuck_plan_runs.sql`
- Tester: `apps/backend/src/game/__tests__/MasterActionService.stuckReconcile.test.ts`
- Auditor: `apps/backend/scripts/audit-db.queries.json:stuck-plan-run`
- Eksisterende cleanup: `apps/backend/src/game/GamePlanRunCleanupService.ts`
