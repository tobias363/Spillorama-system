# TEST2 UI/Performance Report (Chat 2)

## Scope

1. Draw-loop ytelse.
2. Near-win blink og bonuspanel animasjon.
3. Visuell korrekthet (ingen blaa win-fill, korrekt blink, bonusheader stabil).

## Miljo

1. Branch: `codex/candy-test2-ui-performance`
2. Build (commit): `28b4c097` (inkluderer performance-pass `b226b067`)
3. Dato: 2026-03-05
4. Enhet/nettleser: macOS (arm64), Unity batchmode `6000.3.10f1`

## Profilering setup

1. Scene: `Assets/Scenes/Theme2.unity` (smoke)
2. Antall spillrunder: 0 fulle runder (compile + scene smoke)
3. Capture-varighet: N/A (ingen runtime profiler-capture i denne kjøringen)
4. Verktøy (Unity Profiler, browser profiler): Unity batch compile check + Theme2 smoke

## Resultater (for/etter)

| Metode | For | Etter | Endring |
|---|---:|---:|---:|
| p95 frame time desktop (ms) | Ikke målt | Ikke målt | Krever profiler-run |
| p95 frame time mobil (ms) | Ikke målt | Ikke målt | Krever profiler-run |
| GC spikes under draw-loop | Ikke målt | Ikke målt | Krever profiler-run |
| CPU time draw update (ms) | Ikke målt | Ikke målt | Krever profiler-run |

## Visuell regresjonssjekk

1. Ingen blaa fill ved win-line:
- Status: Ikke manuelt verifisert i aktiv runde i denne batch-kjøringen.

2. Blink kun der ett tall mangler:
- Status: Ikke manuelt verifisert i aktiv runde i denne batch-kjøringen.

3. Bonusheader/prize label forsvinner ikke:
- Status: Delvis verifisert via kodegjennomgang + Theme2-smoke (ingen runtime-feil), men ikke full gameplay-smoke.

## Funn

1. `npm run check:unity` passer på Unity `6000.3.10f1`.
2. `scripts/unity-theme2-smoke.sh` passerte med korrekt Unity-versjon.
3. Full p95/GC-ytelsesmåling mangler fortsatt og må tas i WebGL runtime (desktop + mobil).

## Kodeendringer

1. Importert QA-handofffiler under `docs/qa/`.
2. Oppdatert denne rapporten med faktisk status/resultat.
3. Fikset `scripts/unity-theme2-smoke.sh` til å auto-detektere Unity-versjon fra `ProjectVersion.txt`.

## Risiko / restarbeid

1. Uten p95/GC-tall kan ikke ytelses-gate (`docs/qa/README.md`) signeres endelig.
2. Trenger manuell UI-smoke i aktiv runde for near-win/blink/bonusheader-verifisering.

## Konklusjon

- [ ] PASS
- [x] FAIL
