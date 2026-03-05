# Handoff Chat 2 (UI/Performance)

## Branch

Opprett fra:

`codex/candy-c1-bonus-integration-step1`

Ny branch:

`codex/candy-test2-ui-performance`

## Oppgave

1. Profilere draw-loop, near-win blink og bonuspanel.
2. Redusere hot-path overhead.
3. Verifisere visuell korrekthet.

## Leveranser

1. Oppdatert kode i Unity scripts.
2. Utfylt `docs/qa/TEST2_UI_PERFORMANCE_REPORT.md`.
3. PR mot `codex/candy-c1-bonus-integration-step1`.

## Minstekrav i rapport

1. p95 frame time desktop/mobil (for/etter).
2. GC spike-frekvens under aktiv runde.
3. Bekreftelse på:
   - ingen blaa win-fill
   - korrekt near-win blink
   - bonusheader stabil
