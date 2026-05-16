# Delta-rapport — Codex / codex-spill1-goh-observability

## Hva ble endret

- `packages/game-client/src/games/game1/components/TicketGridHtml.ts` — grupperer store pre-round kjøp som triplet-kort når tre store bonger har samme farge/type/purchaseId, men holder live bonger som single for sortering.
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts` — oppdatert triplet-layout/header/grid spacing etter Tobias-godkjent desktop/tablet-design.
- `packages/game-client/src/games/game1/screens/PlayScreen.ts` — responsiv skalering og layout for toppanel/ticket-grid slik at desktop/tablet holder elementene på samme linje før overflow.
- `apps/backend/src/game/MasterActionService.ts` — styrket bridge retry/rollback rundt plan-run start/advance slik at permanent bridge-feil ikke etterlater stuck running-state.
- `apps/backend/src/game/GamePlanRunCleanupService.ts` — styrket natural-end reconcile for GoH/full-plan testflyt.
- `scripts/dev/goh-full-plan-run.mjs` — ny lokal/live test-runner for GoH full plan med evidence-output.
- `scripts/dev/observability-snapshot.mjs` — ny snapshot-runner for Sentry/PostHog/pilot-monitor/Postgres med read-only DB som førstevalg.

## Hva andre steder kunne ha blitt brutt

- Popup auto-show i `PlayScreen.ts` kunne blitt brutt hvis pre-round/live-ticket state ble blandet med F-01-gaten. Dette er vernet med context-read og målrettede ticket-grid/popup-relaterte tester.
- Plan-run lifecycle kunne blitt brutt hvis `runStatus="running"` ble tolket som at en joinable scheduled-game finnes. Dette er vernet med MasterActionService/GameLobbyAggregator/GamePlanRunCleanupService tester.
- Preview-source kunne blitt driftet fra prod-komponenter. PR-body må derfor ha `[design-locked: 2026-05-16]`, og preview-endringene er begrenset til bong/premie-design som Tobias itererte på i denne sesjonen.
- Observability kunne lekket credentials hvis database-URL ble skrevet rått. Snapshot-output redakterer til host/db + read-only user.

## Nye fragilities oppdaget

- Ingen ny `FRAGILITY_LOG` entry ble lagt til i denne PR-en. Eksisterende F-01 og F-02 ble lest og dokumentert i commit-message.
- Ny pitfall ble dokumentert i `docs/engineering/PITFALLS_LOG.md`: live-test uten frozen observability-snapshot og Render External Database URL som full-access secret.

## Brief for neste agent

- Hvis du endrer pre-round bong-rendering: stor bong skal vises som triplet før runden, men splittes til tre single bonger når spillet er running.
- Hvis du endrer `PlayScreen.ts`: ikke reintroduser `waitingForMasterPurchase` som popup-gate, og ikke fjern `popup.autoShowGate` tracking.
- Hvis du endrer plan-run/master-flow: sjekk F-02 først. `running` plan-run + terminal scheduled-game er en kjent stuck-state som må reconciles eller skjules fra lobby.
- Hvis du kjører live-test: start med `npm run observability:snapshot`, kjør testen, og ta snapshot etterpå. Rapporter evidence-path, ikke muntlig observasjon.
- Hvis du trenger DB under observability: bruk `SPILLORAMA_READONLY_DATABASE_URL` fra `~/.spillorama-secrets/postgres-readonly.env`, ikke Render default full-access URL.

## Tester kjørt

- `git diff --check` — ✅
- `rg -n '^<<<<<<<|^=======|^>>>>>>>' . docs || true` — ✅
- `node --check scripts/dev/observability-snapshot.mjs && node --check scripts/dev/goh-full-plan-run.mjs` — ✅
- `npm -w @spillorama/game-client exec vitest run src/games/game1/components/TicketGridHtml.tripleGrouping.test.ts src/games/game1/components/TicketGridHtml.largeMultiplicity.test.ts src/games/game1/components/TicketGridHtml.test.ts src/games/game1/components/BingoTicketHtml.test.ts src/games/game1/components/BingoTicketHtml.elvis.test.ts src/games/game1/components/CenterTopPanel.test.ts` — ✅ 125 tests
- `LOG_LEVEL=warn ./node_modules/.bin/tsx --test apps/backend/src/game/GamePlanRunService.test.ts apps/backend/src/game/__tests__/MasterActionService.test.ts apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts apps/backend/src/game/__tests__/GamePlanRunCleanupService.naturalEndReconcile.test.ts apps/backend/src/__tests__/GamePlanRunCleanupService.naturalEndReconcile.integration.test.ts` — ✅ 119 pass, 2 skip pga manglende `WALLET_PG_TEST_CONNECTION_STRING`
- `npm --prefix apps/backend run check` — ✅
- `npm -w @spillorama/game-client run check` — ✅
- `npm run observability:snapshot -- --label git-cleanup-readonly-smoke --window-minutes=15 --output-dir /tmp/spillorama-git-cleanup-observability` — ✅ Sentry/PostHog/Postgres read-only OK, pilot monitor P0/P1 = 0
