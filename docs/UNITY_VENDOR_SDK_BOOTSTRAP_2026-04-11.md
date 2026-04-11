# Unity Vendor SDK Bootstrap
Dato: 11. april 2026
Scope: `/Users/tobiashaugen/Projects/Spillorama-system/Spillorama`

## Formål

Dette dokumentet beskriver tredjeparts Unity-SDK-ene som fortsatt kreves for å kompilere og teste prosjektet, hvordan de verifiseres, og hvordan batch-testene skal kjøres på en ny maskin eller ren checkout.

Målet er å erstatte skjult lokal state med en eksplisitt bootstrap-kontrakt.

## Status

Unity-prosjektet er nå betydelig mer sporbar enn før:

- authored gameplay-kode er tracket i git
- WebGL-templates er tracket i git
- `Packages` og `ProjectSettings` er tracket i git
- Unity batch-smoke-scriptne er tracket i git

Det som fortsatt ikke er fullt tracket, er flere vendor-SDK-er som authored kode direkte refererer til.

## Obligatoriske vendor-SDK-er

Følgende kataloger må finnes i Unity-prosjektet for at compile-check og smoke-testene skal være meningsfulle:

| Path | Hvorfor |
|---|---|
| `Assets/Best HTTP` | legacy socket.io-transport, JSON helpers, runtime networking |
| `Assets/ExternalDependencyManager` | Firebase/Android dependency resolution |
| `Assets/Firebase` | Firebase Messaging SDK |
| `Assets/GPM` | mobile/webview glue brukt av `webViewManager` |
| `Assets/I2` | localization layer |
| `Assets/Plugins` | native/plugin binaries brukt av authored scripts |
| `Assets/Vuplex` | embedded webview SDK |

Disse brukes faktisk av authored kode under `_Project`, blant annet:

- `BestHTTP.SocketIO`
- `I2.Loc`
- `Firebase`
- `Gpm.*`
- `Vuplex.*`

## Audit-script

Repoet har nå et eksplisitt audit-script:

- [`unity-vendor-sdk-audit.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-audit.sh)

Dette scriptet:

1. leser `UNITY_PROJECT_PATH` hvis satt
2. faller ellers tilbake til repoets `Spillorama/`
3. sjekker at de obligatoriske vendor-katalogene finnes
4. feiler tidlig med forklaring hvis de mangler

Det betyr at en ny maskin nå får en presis bootstrap-feil i stedet for en uleselig Unity-compileeksplosjon.

## Batch-testkontrakt

Alle Unity batch-scripts skal støtte:

- `UNITY_PROJECT_PATH`
- auto-detektert Unity-versjon fra `ProjectVersion.txt`
- tydelig feilmelding hvis prosjektsti eller vendor-SDK-er mangler

Det gjelder spesielt:

- [`unity-compile-check.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-compile-check.sh)
- [`unity-theme2-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-theme2-smoke.sh)
- [`unity-game-panel-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-panel-smoke.sh)
- [`unity-game-flow-contract-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-flow-contract-smoke.sh)
- [`unity-game-panel-lifecycle-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-panel-lifecycle-smoke.sh)
- [`unity-game-interaction-contract-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-interaction-contract-smoke.sh)
- [`unity-game-runtime-state-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-runtime-state-smoke.sh)

## Anbefalt bruk

På maskiner der vendor-SDK-ene allerede ligger i prosjektet:

```bash
bash scripts/unity-vendor-sdk-audit.sh
bash scripts/unity-compile-check.sh
bash scripts/unity-theme2-smoke.sh
bash scripts/unity-game-panel-smoke.sh
bash scripts/unity-game-flow-contract-smoke.sh
bash scripts/unity-game-panel-lifecycle-smoke.sh
bash scripts/unity-game-interaction-contract-smoke.sh
bash scripts/unity-game-runtime-state-smoke.sh
```

Hvis Unity-prosjektet ligger et annet sted enn repoets standardmappe:

```bash
UNITY_PROJECT_PATH=/absolute/path/to/Spillorama bash scripts/unity-vendor-sdk-audit.sh
UNITY_PROJECT_PATH=/absolute/path/to/Spillorama bash scripts/unity-compile-check.sh
```

## Source-of-truth-gap som fortsatt gjenstår

Dette dokumentet løser ikke selve vendor-distribusjonen. Det løser synlighet og bootstrap-kontrakt.

Det som fortsatt gjenstår for full reproduserbarhet er ett av disse valgene:

1. tracke vendor-SDK-ene i git
2. lagre dem som en eksplisitt intern bootstrap-pakke
3. beskrive eksakt installasjonsflyt per SDK og gjøre den reproducerbar

Inntil et av disse valgene tas, er riktig formulering:

- authored Unity-kode er source of truth i git
- vendor-SDK-ene er fortsatt et kontrollert, men ikke fullt versjonert miljøkrav
