# Candy v1.0 QA Hub

Dette er felles QA-område for de tre parallelle testsporene:

1. `TEST1_CORE_REPORT.md` (Chat 1)
2. `TEST2_UI_PERFORMANCE_REPORT.md` (Chat 2)
3. `TEST3_E2E_OPS_REPORT.md` (Chat 3)

## Harde go-live gates

Følgende må være dokumentert som bestått før merge til `main`:

1. Portal `Spill naa` -> launch token -> resolve fungerer.
2. Runde avsluttes etter 30 trekk med `MAX_DRAWS_REACHED`.
3. Bonus trigges deterministisk fra backend-claim.
4. Near-win blink/guide vises korrekt.
5. `WINNING` viser korrekt sum inkl. bonus.
6. Ingen P0/P1-feil i logs under smoke.
7. Ytelse: p95 frame time innen målt grense.
8. Deploy + rollback verifisert via runbook.

## Kjoring

Core test (chat 1):

```bash
bash scripts/qa/test1-core.sh
```

Prod/staging API-kontrakt (valgfritt under chat 1):

```bash
CANDY_API_BASE_URL=https://bingosystem-3.onrender.com \
CANDY_TEST_ACCESS_TOKEN=<token> \
bash scripts/qa/test1-core.sh
```

E2E smoke for chat 3:

```bash
CANDY_API_BASE_URL=https://bingosystem-3.onrender.com \
CANDY_TEST_ACCESS_TOKEN=<token> \
bash scripts/qa/test3-e2e-smoke.sh
```
