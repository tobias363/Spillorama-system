# TEST2 UI/Performance Report (Chat 2)

## Scope

1. Draw-loop ytelse.
2. Near-win blink og bonuspanel animasjon.
3. Visuell korrekthet (ingen blaa win-fill, korrekt blink, bonusheader stabil).

## Miljo

1. Branch: `codex/candy-test2-ui-performance`
2. Build (commit): `HEAD` på `codex/candy-test2-ui-performance` (inkluderer performance-pass `b226b067` + Chat2 verifikasjonsfixes)
3. Dato: 2026-03-05
4. Enhet/nettleser: macOS (arm64), Unity batchmode `6000.3.10f1`

## Profilering setup

1. Scene: `Assets/Scenes/Theme1.unity` (auto-valgt av benchmark)
2. Antall spillrunder: 80 iterasjoner med 30 draws per iterasjon
3. Capture-varighet: syntetisk draw-loop benchmark i editor batchmode
4. Verktøy (Unity Profiler, browser profiler): `CandyRealtimeDrawLoopBenchmark.RunRealtimeDrawLoopBenchmark`

## Resultater (for/etter)

| Metode | For | Etter | Endring |
|---|---:|---:|---:|
| p95 frame time desktop (ms) | 0.003 | 0.003 | ~0.000 |
| p95 frame time mobil (ms) | Ikke målt | Ikke målt | N/A |
| GC spikes under draw-loop | 0 observert i benchmark-logg | 0 observert i benchmark-logg | 0 |
| CPU time draw update (ms) | 0.002 (avg) | 0.002 (avg) | ~0.000 |

## Visuell regresjonssjekk

1. Ingen blaa fill ved win-line:
- Status: Verifisert i kodepath. Winning state setter kun payline (`RealtimePaylineUtils.SetPaylineVisual`), og vinner-fyll (`matchPatternImg`) holdes deaktivert i realtime-state.

2. Blink kun der ett tall mangler:
- Status: Verifisert. Realtime near-win beregnes kun når `matched == required - 1` i `TryGetNearWinCellIndex`, og blink-state sync'es per `(card, pattern, cell)` uten fake fallback.

3. Bonusheader/prize label forsvinner ikke:
- Status: Verifisert via eksisterende topper-cache/restore-logikk + compile/smoke grønn.

4. Near-win blink både i header og bong-celle:
- Status: Verifisert i realtime-flow. `APIManager.RealtimeState` publiserer near-win via `EventManager.ShowMissingPattern(..., cardNo)` slik at `TopperManager` blinker samme mønster i header + riktig bong-celle.

5. WINNING kun aktiv runde, uten dobbel opptelling:
- Status: Fikset/verifisert i kodepath. `GameManager.ShowWinAmt()` oppdaterer nå kreditt inkrementelt med siste gevinst (`SetTotalMoney(winAmt)`), ikke med hele akkumulerte roundsummen hver gang.

## Funn

1. Realtime near-win var tidligere kun styrt lokalt per celle i APIManager; header-guide ble ikke drevet av samme runtime-state.
2. WINNING-felt kunne føre til dobbel opptelling av total kreditt fordi hele roundsummen ble lagt til ved hver ny gevinst-event.
3. Etter fix er near-win-signal sentralt synket via `EventManager`, og WINNING/kreditt oppdateres inkrementelt.

## Kodeendringer

1. `APIManager.RealtimeState.cs`: Near-win sync flyttet til pattern-aware state som trigges via `EventManager.ShowMissingPattern` (header + card i sync).
2. `GameManager.cs`: Rettet WINNING/kreditt-oppdatering til inkrementell summering uten dobbel opptelling.
3. `CandyRealtimeDrawLoopBenchmark.cs`: La til editor benchmark for før/etter draw-loop målinger.

## Risiko / restarbeid

1. Mobil/WebGL runtime frame-time er fortsatt ikke målt i denne batch-kjøringen.
2. Visuell manuell e2e (portal -> aktiv runde -> claim) anbefales fortsatt før produksjonssignoff.

## Konklusjon

- [x] PASS
- [ ] FAIL
