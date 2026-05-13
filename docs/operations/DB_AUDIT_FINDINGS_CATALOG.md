# DB-audit findings catalog

**Sist oppdatert:** 2026-05-14
**Eier:** Observability/SRE
**Status:** Steg 1 av 3-stegs DB-auditor-plan (Tobias-direktiv 2026-05-13)

Denne katalogen dokumenterer alle queries i `apps/backend/scripts/audit-db.queries.json` — hva de leter etter, hvorfor, og hva fix-en typisk er.

## Bruk

```bash
# Full audit til markdown-rapport
APP_PG_CONNECTION_STRING="postgres://..." npm run audit:db

# Kun raske queries (for bug-rapport-inline-bruk)
npm run audit:db -- --quick

# Kun P1-funn (kritisk bad-state)
npm run audit:db -- --tier P1

# JSON-output (for tooling)
npm run audit:db -- --json
```

**Exit-codes:**
- `0` — alt OK, ingen P1-funn
- `1` — P1-funn detektert (kritisk bad-state)
- `2` — runtime-feil (DB ikke tilgjengelig, etc.)

## Tier-system

| Tier | Severity | Beskrivelse | Eksempel-respons |
|---|---|---|---|
| **P1** | Kritisk bad-state | DB-state som krever umiddelbar oppmerksomhet — pilot kan ikke kjøre, eller compliance-risiko | "Stopp pilot-test og fix før neste runde" |
| **P2** | Arkitektur-smell | Operasjonelle issues eller idempotency-bugs som ikke er kritisk men bør planlegges | "Legg på sprint-board" |
| **P3** | Performance/observability | Nice-to-detect-mønstre, ikke krise | "Følg utvikling over tid" |

## Bug-rapport-bundler-integrasjon

`audit-db.mjs --quick --json` kjøres som child_process av `devBugReport.ts` med max 30s timeout. Output bundles inn i `## 🗄️ DB-audit (quick)`-seksjonen av bug-rapporten. Fail-soft: hvis scriptet feiler eller henger, fortsetter bug-rapport uten audit-seksjonen.

Quick-queries er merket med `"quick": true` i `audit-db.queries.json` — total kjøretid skal være under 5 sekunder.

## Queries

### P1 Bad-state (pilot-blokker eller compliance-risiko)

#### `stuck-plan-run` (quick)

**Hva:** Plan-run i `app_game_plan_run` med `status='running'` der ingen tilknyttet scheduled-game er aktiv (alle linkede er completed/cancelled/finished, eller ingen finnes).

**Hvorfor:** Plan-run-state-machine ute av sync med scheduled-games. Typisk skjer ved master-restart eller crash mellom transitions.

**Fix-pattern:** Sjekk `MasterActionService.advanceToNext()` og `GamePlanEngineBridge.spawnScheduledGame()` for race-conditions. Marker plan-run som finished hvis ingen scheduled-game er aktiv, eller spawn ny scheduled-game for current_position.

#### `stuck-scheduled-game` (quick)

**Hva:** Scheduled-game i status `running`/`ready_to_start`/`purchase_open`/`paused` mer enn 30 min uten state-endring.

**Hvorfor:** Game henger uten state-overgang. Ofte etter engine-crash eller draw-bag-bug.

**Fix-pattern:** Sjekk `Game1DrawEngineService` for stuck-tick (draw-bag tom?) og `Game1AutoResumePausedService` (master-heartbeat?). For `running` uten draws: kanskje engine-instans døde uten failover. Bruk `/api/admin/game1/games/<id>/cancel` for å rydde.

#### `orphan-ticket-purchase`

**Hva:** Ticket-purchases som peker på ikke-eksisterende scheduled-game.

**Hvorfor:** Skal være impossible pga FK RESTRICT. Hvis funnet: alvorlig schema-corruption.

**Fix-pattern:** Verify-wallet-audit-chain. Rapporter til compliance umiddelbart.

#### `negative-wallet-balance` (quick)

**Hva:** Player wallet-accounts med negativ balanse. System-accounts (is_system=true) eksluderes — de er regnskaps-offset og kan være negative.

**Hvorfor:** Skal aldri skje pga REPEATABLE READ + ledger-invariants. Indikerer wallet-kompromittering eller transaction-race.

**Fix-pattern:**
1. Stopp alle wallet-debits (feature-flag)
2. Kjør `reconcile-wallet-vs-ledger.ts` og `verify-wallet-audit-chain.ts`
3. Skriv compliance-incident (Lotteritilsynet 24t-frist for player-wallet)
4. Forward-only fix via ADJUSTMENT-ledger-entry

#### `wallet-vs-entries-discrepancy`

**Hva:** Wallet-balance som ikke matcher SUM av wallet_entries (DEBIT/CREDIT-double-entry).

**Hvorfor:** Ledger-drift — wallet-update uten matching entry, eller entry uten matching balance-update.

**Fix-pattern:** Sjekk for manuell SQL-update på wallet. Hvis drift > 1 NOK: stopp prod-skriving og kjør reconcile. Forward-only fix via ADJUSTMENT.

#### `stuck-hall-ready-no-advancement` (quick)

**Hva:** Scheduled-game der alle ikke-ekskluderte haller er marked ready men status er fortsatt `ready_to_start`/`purchase_open` (mer enn 5 min).

**Hvorfor:** Cron-tick `Game1ScheduleTickService.transitionReadyToStartGames()` kjører ikke, eller `scheduled_start_time` er fortsatt i fremtiden.

**Fix-pattern:** Verifiser cron-job. Sjekk master-heartbeat (`MasterActionService.start()` `master:heartbeat`-sjekk).

#### `compliance-ledger-hashchain-gaps`

**Hva:** Hash-chain brudd i `app_regulatory_ledger` — event_hash av rad N skal være prev_hash av N+1. Også sequence-gaps.

**Hvorfor:** KRITISK regulatorisk integritet. Hash-chain skal være impossible å bryte uten direct DB-access.

**Fix-pattern:** Eskaler til compliance umiddelbart — Lotteritilsynet rapportering. Kjør `verify-wallet-audit-chain.ts`.

#### `anti-fraud-critical-recent` (quick)

**Hva:** Anti-fraud critical-level signals siste 24t.

**Hvorfor:** Krever admin-review per BIN-806.

**Fix-pattern:** Sjekk `/admin/anti-fraud-queue` og fattelse (frigi vs block). Hvis blocked + spilleren krever forklaring: rapporter til pengeansvarlig.

### P2 Arkitektur-smell (bør planlegges)

#### `missing-master-hall-or-group`

**Hva:** Scheduled-games hvor master_hall_id eller group_hall_id er NULL.

**Hvorfor:** Skal ikke skje pga NOT NULL. Hvis funnet: migrasjons-drift.

**Fix-pattern:** Kjør schema-arkeolog. Rapporter til ops.

#### `duplicate-plan-runs-active` (quick)

**Hva:** Mer enn 1 plan-run aktiv samme hall samme dato.

**Hvorfor:** Skal være håndhevet av UNIQUE(hall_id, business_date). Hvis funnet: schema-drift.

**Fix-pattern:** Force-finish duplikater via `/api/admin/game-plan/runs/<id>/cancel`.

#### `wallet-tx-without-idempotency-key`

**Hva:** Wallet-transactions UTEN idempotency_key fra siste 30 dager (STAKE/PRIZE/TRANSFER_IN/TRANSFER_OUT).

**Hvorfor:** Operasjoner uten idempotency-key er ikke retry-safe — retry kan resultere i double-spend.

**Fix-pattern:** Sjekk hvilken kode-path som skrev disse. Defense-in-depth: legg idempotency-key til alle wallet-mutasjoner.

#### `demo-users-in-prod-context` (quick)

**Hva:** Demo/test-spillere med nylig aktivitet i prod, eller demo-spillere med real wallet-transactions.

**Hvorfor:** Demo-data i prod er kun OK i dev/staging.

**Fix-pattern:** I prod — soft-delete eller flytt demo-users til egen schema. Hvis tx_last_7d > 0: stopp data, frys konto, rapporter til ops.

#### `pilot-spiller-balance-zero` (quick)

**Hva:** Demo-pilot-spillere (1-12) med balanse < 100 NOK.

**Hvorfor:** Skulle blitt reset til 500 NOK ved hver pilot-test.

**Fix-pattern:** Kjør `/api/_dev/reset-pilot-state?token=...` for å reset. Vurder å automatisere reset i pilot-test-infra.

#### `compliance-outbox-pending-pile-up` (quick) + `wallet-outbox-pending-pile-up` (quick)

**Hva:** Outbox har > 100 pending events ELLER pending-rader eldre enn 10 min.

**Hvorfor:** Worker henger eller pile-up.

**Fix-pattern:** Sjekk worker-logs og Redis-connectivity. Hvis worker dødd: restart backend. Hvis stuck attempts > 10 → dead-letter krever manuell håndtering.

#### `compliance-outbox-dead-letters`

**Hva:** Compliance outbox dead-letter-rows som ikke har vært prosessert (> 5 attempts).

**Hvorfor:** Krever manuell undersøkelse. last_error viser hvorfor. Vanlig årsak: regulatorisk-fil-kontrakt brutt, eller wallet-state-divergens.

**Fix-pattern:** Fix root cause, deretter manuelt re-process.

#### `duplicate-tickets-same-game`

**Hva:** Samme idempotency_key brukt for flere ticket-purchases i samme scheduled-game.

**Hvorfor:** Skal være UNIQUE-håndhevet.

**Fix-pattern:** ALVORLIG idempotency-bug. Eskaler til compliance — mulig double-spend.

#### `stuck-purchase-open-no-tickets-near-start`

**Hva:** Scheduled-games i 'purchase_open' med 0 tickets solgt selv om scheduled_start_time er < 5 min unna.

**Hvorfor:** Mulig agent-portal bug eller UI-feil.

**Fix-pattern:** Verifiser master-cash-in-out UI om salgsknapper er synlige og fungerer.

#### `fk-orphan-hall-ready-status`

**Hva:** Hall-ready-status-rader hvor scheduled-game ikke lenger eksisterer.

**Hvorfor:** FK CASCADE skal ha ryddet. Hvis funnet: schema-drift.

**Fix-pattern:** Slett trygt med manual DELETE.

### P3 Performance/observability

#### `timezone-mismatch-business-date`

**Hva:** Plan-run business_date avviker fra Oslo-dato av scheduled-game start.

**Hvorfor:** Mulig timezone-bug mellom Postgres UTC og service-lag Oslo-tz.

**Fix-pattern:** Sjekk koden som setter business_date i create-plan-run — skal alltid være DAY-LEVEL av `scheduled_start_time AT TIME ZONE Europe/Oslo`.

#### `scheduled-game-no-tickets-completed`

**Hva:** Scheduled-games som er completed men ingen tickets ble solgt siste 7 dager.

**Hvorfor:** Mulig admin-test, stale demo-data, eller bug i ticket-purchase.

**Fix-pattern:** Hvis pilot-data: verify ticket-purchase-flow (e2e-smoke-test). Hvis stale demo-data: OK å ignorere.

#### `lock-contention-active`

**Hva:** Aktive pg_locks > 50 eller waiting-locks > 0.

**Hvorfor:** Høy lock-contention betyr DB-throughput-problem.

**Fix-pattern:** Sjekk slow-queries. For prod: vurder REPEATABLE READ statt SERIALIZABLE.

## Legge til ny query

1. Edit `apps/backend/scripts/audit-db.queries.json` og legg til entry under `queries`:
   ```json
   {
     "id": "min-nye-query",
     "tier": "P2",
     "category": "stuck-state",
     "severity": "P2",
     "quick": false,
     "description": "Kort menneske-vennlig beskrivelse",
     "sql": "SELECT ... FROM {{schema}}.app_xxx WHERE ...",
     "fixAdvice": "Konkret fix-anbefaling"
   }
   ```

2. Krav:
   - `id` må være unik (verifisert av tests)
   - `tier` ∈ `P1`/`P2`/`P3`
   - `sql` MÅ starte med `SELECT` eller `WITH` (read-only)
   - `sql` MÅ bruke `{{schema}}` istedenfor hardkodet schema-navn
   - Forbudte SQL-keywords: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`
   - `quick: true` for queries som er fast nok til å kjøre i bug-rapport (< 1s estimert)

3. Verifiser med tester:
   ```bash
   cd apps/backend && npx tsx --test scripts/__tests__/audit-db.test.ts
   ```

4. Test mot lokal DB:
   ```bash
   APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
     npm run audit:db -- --tier P2
   ```

## Steg 2 og 3 (kommende)

- **Steg 2:** Live cron-service som kjører audit-db hvert N. minutt og pusher til Slack/PagerDuty ved P1-funn
- **Steg 3:** AI-recommendation-engine som bruker fix-advice + historiske fix-mønstre for å foreslå konkret patch
