# Handoff Chat 3 (E2E/Ops)

## Branch

Opprett fra:

`codex/candy-c1-bonus-integration-step1`

Ny branch:

`codex/candy-test3-e2e-ops`

## Oppgave

1. Verifisere full E2E-flyt i runtime.
2. Kjore negative tester for auth/token/settings/env.
3. Kjore deploy smoke + rollback smoke.

## Leveranser

1. Testartefakter (kommandoer + output).
2. Utfylt `docs/qa/TEST3_E2E_OPS_REPORT.md`.
3. Oppdatert `docs/CANDY_RELEASE_ROLLOUT_PLAN.md` ved behov.
4. PR mot `codex/candy-c1-bonus-integration-step1`.

## Minstekrav i rapport

1. Bevis for launch token happy path og failure path.
2. Bevis for admin-validering av `launchUrl`/`apiBaseUrl`.
3. Bevis for rollback-flyt og post-rollback health/spill.
