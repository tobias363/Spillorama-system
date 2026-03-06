# Candy v1.0 QA Hub

Dette er felles QA-område for de tre parallelle testsporene:

1. `TEST1_CORE_REPORT.md` (Chat 1)
2. `TEST2_UI_PERFORMANCE_REPORT.md` (Chat 2)
3. `TEST3_E2E_OPS_REPORT.md` (Chat 3)
4. `CANDY_BASELINE_FREEZE_2026-03-06.md` (baseline freeze)
5. `CANDY_HARD_GATE_LOCAL.md` (lokal hard-gate)
6. `CANDY_CODE_INVENTORY.md` (ACTIVE/LEGACY/REMOVE_CANDIDATE)

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
bash scripts/qa/candy-hard-gate.sh
```

Prod/staging API-kontrakt + E2E (valgfritt under chat 1/3):

```bash
CANDY_GATE_RUN_E2E=true \
CANDY_API_BASE_URL=https://bingosystem-3.onrender.com \
CANDY_TEST_ACCESS_TOKEN=<token> \
CANDY_ADMIN_EMAIL=<admin-email> \
CANDY_ADMIN_PASSWORD=<admin-password> \
bash scripts/qa/candy-hard-gate.sh
```

E2E smoke for chat 3:

```bash
CANDY_API_BASE_URL=https://bingosystem-3.onrender.com \
CANDY_TEST_ACCESS_TOKEN=<token> \
bash scripts/qa/test3-e2e-smoke.sh
```
