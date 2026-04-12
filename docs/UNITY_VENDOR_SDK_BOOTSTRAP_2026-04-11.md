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
- [`unity-vendor-sdk-manifest.tsv`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-manifest.tsv)

Dette scriptet:

1. leser `UNITY_PROJECT_PATH` hvis satt
2. faller ellers tilbake til repoets `Spillorama/`
3. sjekker at de obligatoriske vendor-katalogene finnes
4. feiler tidlig med forklaring hvis de mangler

Det betyr at en ny maskin nå får en presis bootstrap-feil i stedet for en uleselig Unity-compileeksplosjon.

## Intern bootstrap-pakke

Repoet har nå også to praktiske bootstrap-script:

- [`unity-bootstrap.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-bootstrap.sh)
- [`unity-test-suite.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-test-suite.sh)
- [`unity-vendor-sdk-publish-local.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-publish-local.sh)
- [`unity-vendor-sdk-fetch.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-fetch.sh)
- [`unity-vendor-sdk-package.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-package.sh)
- [`unity-vendor-sdk-restore.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-restore.sh)
- [`unity-vendor-sdk-verify.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-vendor-sdk-verify.sh)
- [`unity-test-suite-ci.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-test-suite-ci.sh)

Disse brukes slik:

1. Pakk vendor-SDK-ene fra en kjent god Unity-installasjon til en intern bundle
2. Del bundle-filen internt
3. Kjør `unity-bootstrap.sh` på ren maskin eller ren prosjektmappe
4. La bootstrap-scriptet restore bundle, kjøre audit og eventuelt hele Unity-suiten

Dette er valgt fordi full tracking av vendor-mappene i git er for tungt og delvis upraktisk:

- `Vuplex` alene er rundt `932 MB`
- `Firebase` og `Plugins` er også store

Den praktiske modellen er derfor:

- authored gameplay-kode i git
- vendor-SDK-er som intern, eksplisitt bootstrap-bundle

## Standard team-kommando

Det finnes nå én standardkommando for daglig bruk:

```bash
bash scripts/unity-test-suite.sh
```

Den gjør dette i riktig rekkefølge:

1. kjører `unity-bootstrap.sh`
2. auditerer vendor-SDK-er
3. restore-r bundle hvis de mangler
4. kjører hele Unity-suiten

Dette er kommandoen som skal brukes når målet er "bekreft at Unity-prosjektet er i orden", i stedet for å kjøre mange enkelt-script manuelt.

## Foreslått intern lagringsplass

Bootstrap-scriptet leter etter vendor-bundles i denne rekkefølgen:

1. `UNITY_VENDOR_BUNDLE_PATH`
2. `~/.spillorama/unity-vendor-bundles/`
3. `~/Library/Application Support/Spillorama/unity-vendor-bundles/`
4. `./unity-vendor-bundles/` i repoet

Den anbefalte team-standarden er:

- bundle-filer lagres utenfor git i `~/.spillorama/unity-vendor-bundles/`
- repoets lokale `unity-vendor-bundles/` brukes kun til midlertidig pakking eller lokal testing

Det gir:

- ett stabilt standardsted per maskin
- ingen tunge vendor-artefakter i git
- fortsatt støtte for eksplisitt override via env-var eller `--bundle`

For å publisere en ny bundle til denne standardplasseringen fra en fungerende maskin:

```bash
bash scripts/unity-vendor-sdk-publish-local.sh
```

Dette:

1. pakker en ny vendor-bundle fra lokal Unity-installasjon
2. kopierer archive + manifest til `~/.spillorama/unity-vendor-bundles/`
3. verifiserer archive mot manifest
4. oppdaterer `latest.tar.gz` og `latest.manifest.tsv`

Det er dermed denne kommandoen som skal brukes når teamet vil oppdatere den delte lokale bootstrap-kilden på en maskin.

Hvis teamet bruker en delt artifact-URL eller intern nedlastingslenke, vil bootstrap nå prioritere denne kilden når `UNITY_VENDOR_BUNDLE_URL` er satt:

```bash
UNITY_VENDOR_BUNDLE_URL=https://internal.example.com/unity-vendor-sdk.tar.gz \
UNITY_VENDOR_BUNDLE_MANIFEST_URL=https://internal.example.com/unity-vendor-sdk.manifest.tsv \
bash scripts/unity-bootstrap.sh
```

Eller eksplisitt fetch først:

```bash
UNITY_VENDOR_BUNDLE_URL=https://internal.example.com/unity-vendor-sdk.tar.gz \
UNITY_VENDOR_BUNDLE_MANIFEST_URL=https://internal.example.com/unity-vendor-sdk.manifest.tsv \
bash scripts/unity-vendor-sdk-fetch.sh
```

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

For å bygge en intern vendor-bundle fra en fungerende maskin:

```bash
bash scripts/unity-vendor-sdk-package.sh
```

Dette lager som standard:

- `unity-vendor-bundles/unity-vendor-sdk-<timestamp>.tar.gz`
- `unity-vendor-bundles/unity-vendor-sdk-<timestamp>.manifest.tsv`

For å publisere direkte til standard team-plassering:

```bash
bash scripts/unity-vendor-sdk-publish-local.sh
```

For å restore bundle-filen inn i en ren prosjektmappe:

```bash
UNITY_PROJECT_PATH=/absolute/path/to/Spillorama \
bash scripts/unity-vendor-sdk-restore.sh \
/absolute/path/to/unity-vendor-sdk-<timestamp>.tar.gz
```

Restore-scriptet verifiserer nå også archive mot bundle-manifest før utpakking.
Verifiseringen bruker en deterministisk tre-hash av relative filbaner, filinnhold og symlink-targets, slik at sjekken ikke påvirkes av tar-metadata eller utpakkingstidspunkt.

Hvis målmappene allerede finnes og skal overskrives:

```bash
UNITY_VENDOR_RESTORE_FORCE=1 \
UNITY_PROJECT_PATH=/absolute/path/to/Spillorama \
bash scripts/unity-vendor-sdk-restore.sh \
/absolute/path/to/unity-vendor-sdk-<timestamp>.tar.gz
```

For å bootstrappe en ren Unity-prosjektmappe med automatisk bundle-oppslag:

```bash
bash scripts/unity-bootstrap.sh
```

For å bootstrappe og deretter kjøre hele Unity-suiten:

```bash
bash scripts/unity-bootstrap.sh --with-tests
```

For standard daglig verifisering:

```bash
bash scripts/unity-test-suite.sh
```

For CI eller ren maskin uten lokal bundle-cache:

```bash
UNITY_VENDOR_BUNDLE_URL=https://internal.example.com/unity-vendor-sdk.tar.gz \
UNITY_VENDOR_BUNDLE_MANIFEST_URL=https://internal.example.com/unity-vendor-sdk.manifest.tsv \
bash scripts/unity-test-suite-ci.sh
```

For å bruke en eksplisitt bundle-fil:

```bash
bash scripts/unity-bootstrap.sh --bundle /absolute/path/to/unity-vendor-sdk.tar.gz --with-tests
```

For å kjøre standardpakken med eksplisitt bundle:

```bash
bash scripts/unity-test-suite.sh --bundle /absolute/path/to/unity-vendor-sdk.tar.gz
```

For å verifisere en bundle manuelt:

```bash
bash scripts/unity-vendor-sdk-verify.sh /absolute/path/to/unity-vendor-sdk.tar.gz
```

## Source-of-truth-gap som fortsatt gjenstår

Dette dokumentet støtter nå begge operative modellene:

1. lokal team-cache i `~/.spillorama/unity-vendor-bundles/`
2. delt artifact-URL via `UNITY_VENDOR_BUNDLE_URL` og `UNITY_VENDOR_BUNDLE_MANIFEST_URL`

Det gjenværende organisatoriske valget er derfor ikke kode, men hvilken av disse to modellene teamet faktisk vil standardisere på.

Riktig formulering nå er:

- authored Unity-kode er source of truth i git
- vendor-SDK-ene er håndtert gjennom en eksplisitt bootstrap-kontrakt
- teamet kan bruke enten lokal cache eller delt artifact-URL som standard distribusjonsmodell
