# Delta — purchase_open to-stegs master-flyt

**Dato:** 2026-05-15  
**Branch:** `codex/purchase-open-two-step-master-flow`  
**Risiko:** P0 pilot-blokker, Spill 1 live/master-flow

## Hva ble endret

- `apps/backend/src/game/GamePlanEngineBridge.ts` — fresh plan-runtime scheduled-games opprettes nå som `purchase_open`, ikke `ready_to_start`.
- `apps/backend/src/game/MasterActionService.ts` — første master-start på en ny planposisjon åpner bongesalg og returnerer uten engine-start; neste master-start på eksisterende `purchase_open`/aktiv scheduled-game starter trekningen.
- `apps/backend/src/game/MasterActionService.ts` — `advance()` har samme defense-in-depth: fresh ny planposisjon åpnes for bongkjøp, ikke direkte running.
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`, `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts`, `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` — UI skiller "Bongesalg åpnet" fra "Spill 1 startet" og viser "Start trekninger nå" når status allerede er pre-running.
- `tests/e2e/helpers/rest.ts` — pilot-flow reset bruker nå appens Oslo business-date, ikke Postgres `CURRENT_DATE`, slik at CI rundt norsk midnatt faktisk sletter riktig dagsrad.
- `tests/e2e/spill1-rad-vinst-flow.spec.ts` — forventer 12 rendered ticket-cards, én per faktisk brett, i tråd med dagens UI.

## Hvorfor

Forensic baseline viste at live flowen hadde praktisk talt null kjøpsvindu:

- Evidence: `/tmp/purchase-open-forensics-2026-05-15T21-56-07Z.md`
- Target scheduled-game: `f7fa6583-285c-4b16-9285-127d21fe692f`
- `scheduled_start=18:38:42.835`
- `actual_start=18:38:42.928`
- purchase `created_at=18:38:42.897`

Det ga ca. 30 ms mellom kjøp og engine-start, som ikke er et operativt `purchase_open`-vindu.

## Hva andre steder kunne ha blitt brutt

- `Game1TicketPurchaseService` måtte fortsatt akseptere `ready_to_start` som compat/transition-status. Testen er oppdatert for å dokumentere at dagens plan-flow er `purchase_open`, men at `ready_to_start` fortsatt er tillatt.
- Legacy `Game1ScheduleTickService` bruker fortsatt `ready_to_start` i cron-flow. Denne PR-en endrer ikke legacy cron-state-machine.
- Frontend-copy måtte oppdateres i både cash-in/out og agent-portal. Hvis bare én flate endres, kan master få feil mental modell i live-test.
- `advance()` måtte dekkes selv om dagens UI primært bruker `start()` for neste runde. Ellers ville en alternativ backend-flate fortsatt kunne starte engine direkte.

## Nye fragilities

- Ingen ny FRAGILITY_LOG-entry opprettet. Eksisterende F-02 ble lest fordi endringen berører plan-run/scheduled-game state-maskin.
- Commit-message inneholder `[context-read: F-02]` og comprehension om at plan-run og scheduled-game må reconcileres som uavhengige state-maskiner.

## Brief for neste agent

- Ikke behandle `purchase_open`-bugen som en ren cron/seed-feil uten ny forensic baseline. Root cause for master-flowen var at plan-bridge + master-start startet engine i samme request.
- Fresh plan-runtime scheduled-game skal gi `scheduledGameStatus='purchase_open'` og ingen `startGame()`-call.
- Reused `purchase_open` skal starte engine. Det er andre masterklikk på samme scheduled-game.
- UI skal vise "Bongesalg åpnet" etter første klikk og "Start trekninger nå" når samme pre-running scheduled-game skal startes.
- E2E cleanup som sletter plan-run/scheduled-game for "dagen" må bruke `Europe/Oslo` business-date. Ikke bruk `CURRENT_DATE` i Postgres for pilot-flow-reset.

## Tester kjørt

- `LOG_LEVEL=warn npx tsx --test src/game/__tests__/MasterActionService.test.ts` — 49/49 pass
- `LOG_LEVEL=warn npx tsx --test src/game/__tests__/Game1TicketPurchaseService.allowedStatuses.test.ts` — 7/7 pass
- `npm run check` i `apps/backend` — pass
- `npm run check` i `apps/admin-web` — pass
- `npx playwright test --config=tests/e2e/playwright.config.ts --list` — 7 pilot-flow specs listet uten TS/transpile-feil etter CI-follow-up

Integration-testene for `GamePlanEngineBridge.cancelledRowReuse` og `GamePlanEngineBridge.multiGoHIntegration` ble kjørt, men skippet lokalt fordi `WALLET_PG_TEST_CONNECTION_STRING` ikke var satt.

## Kunnskapsoppdatering

- `.claude/skills/spill1-master-flow/SKILL.md` v1.20.2
- `docs/engineering/PITFALLS_LOG.md` §3.17
- `docs/engineering/PITFALLS_LOG.md` §6.19
- `docs/engineering/AGENT_EXECUTION_LOG.md`
