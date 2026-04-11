# Spillorama-system

> Scope-beslutning 9. april 2026: dette repoet er kun for live bingo-systemet. Hvis denne README-en er i konflikt med `docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`, er det dokumentet styrende.

Dette repoet eier live bingo-plattformen:

- live portal
- live auth
- live wallet
- live compliance
- live admin
- live Spillorama-lobby
- live Spillorama Unity-spill
- generisk spillkatalog

Det eier ikke Candy demo-login, Candy demo-admin eller Candy demo-settings.

## Tre kodebaser

| System | Lokal mappe | Repo | Produksjon | Eier |
|---|---|---|---|---|
| Live bingo | `/Users/tobiashaugen/Projects/Spillorama-system/` | `tobias363/Spillorama-system` | `https://spillorama-system.onrender.com/` | portal, wallet, auth, compliance, admin, Unity-lobby |
| Candy | `/Users/tobiashaugen/Projects/Candy/` | `tobias363/candy-web` | Candy-klient og spillkode | selve spillet, UI, assets, gameplay |
| demo-backend | `/Users/tobiashaugen/Projects/demo-backend/` | `tobias363/demo-backend` | `https://candy-backend-ldvg.onrender.com/` | demo-login, demo-admin, demo-settings, demo-drift |

## Domener og ruter

| Domene | Path | System | Betydning |
|---|---|---|---|
| `spillorama-system.onrender.com` | `/` | Live bingo | portal |
| `spillorama-system.onrender.com` | `/admin/` | Live bingo | live admin |
| `spillorama-system.onrender.com` | `/web/` | Live bingo | Unity-lobby / WebGL-host |
| `candy-backend-ldvg.onrender.com` | `/` | demo-backend | Candy demo-login og testflate |
| `candy-backend-ldvg.onrender.com` | `/admin/` | demo-backend | Candy demo-admin |

Samme route-navn på to forskjellige domener betyr ikke samme system.

## Hva som får lov å ligge i dette repoet

- `frontend/` for live portal og live admin
- `backend/` for live bingo API, auth, wallet, compliance, admin og generisk spillkatalog
- `Spillorama/` for live Unity-lobby og live Unity-spill
- leverandorsiden av Candy launch og shared wallet
- dokumentasjon som handler om live bingo eller om den formelle grensen mot Candy/demo-backend

## Hva som ikke skal bygges her

- Candy demo-login
- Candy demo-admin
- Candy demo-settings
- Candy demo-runtime
- Candy demo scheduler eller RTP-styring
- Candy demo deploy-runbooks som beskriver demo som om det var live bingo

## Hvor skal endringer gjøres?

| Jeg vil endre | Riktig kodebase | Kommentar |
|---|---|---|
| Live portal eller live admin | `Spillorama-system` | jobb i `frontend/` eller `backend/src/admin/` |
| Live wallet, auth eller compliance | `Spillorama-system` | jobb i `backend/src/` |
| Live Unity-lobby eller live Unity-spill | `Spillorama-system` | jobb i `Spillorama/` |
| Candy gameplay, UI eller assets | `Candy` | jobb i Candy-repoet |
| Candy demo-login, demo-admin eller demo-settings | `demo-backend` | jobb i `demo-backend`-repoet |

## Viktige presiseringer

### Candy i live bingo

Live bingo kan fortsatt kjenne til Candy som et eksternt spill på generisk nivå, for eksempel via spillkatalog, launch-URL eller en generisk embed-mekanisme. Live bingo skal ikke eie demo-driften rundt Candy.

Det betyr i praksis at `Spillorama-system` kan inneholde:

- Candy tile i Unity-lobbyen
- `POST /api/games/candy/launch`
- `/api/ext-wallet/*`
- iframe/overlay-hosting fra live `/web/`

Det betyr ikke at `Spillorama-system` skal eie Candy gameplay eller Candy-backend.

## Les disse dokumentene for full detalj

- `docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`
- `docs/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md`
- `docs/UNITY_JS_BRIDGE_CONTRACT.md`
- `docs/CANDY_UNITY_SHARED_WALLET_STATUS_2026-04-11.md`
- `docs/UNITY_VENDOR_SDK_BOOTSTRAP_2026-04-11.md`

## Standard Unity-verifisering

For daglig verifisering av tracket Unity-kilde og vendor-SDK-oppsett, bruk:

```bash
bash scripts/unity-test-suite.sh
```

Det bootstrapper vendor-SDK-er ved behov og kjører hele Unity-suiten i riktig rekkefølge.

For å publisere oppdatert vendor-bundle til standard lokal team-plassering, bruk:

```bash
bash scripts/unity-vendor-sdk-publish-local.sh
```

For å verifisere en bundle manuelt før restore:

```bash
bash scripts/unity-vendor-sdk-verify.sh /absolute/path/to/unity-vendor-sdk.tar.gz
```

Bundle-verifiseringen bruker deterministisk innholds-hash, ikke tar-metadata.

For CI eller ren maskin med delt artifact-URL:

```bash
UNITY_VENDOR_BUNDLE_URL=https://internal.example.com/unity-vendor-sdk.tar.gz \
UNITY_VENDOR_BUNDLE_MANIFEST_URL=https://internal.example.com/unity-vendor-sdk.manifest.tsv \
bash scripts/unity-test-suite-ci.sh
```

Providervendt Candy-integrasjonsdokumentasjon eies ikke av dette repoet. Bruk:

- `/Users/tobiashaugen/Projects/demo-backend/docs/CANDY_PROVIDER_INTEGRATION_IMPLEMENTATION_GUIDE_2026-04-11.md`
- `/Users/tobiashaugen/Projects/demo-backend/docs/INTEGRATION_CONTRACT.md`

## Render-navnstatus

Repo og Blueprint bruker nå navnet `Spillorama-system` / `spillorama-system`.

Live host er `https://spillorama-system.onrender.com/`.

## Kort regel

Hvis endringen kun trengs for at `https://candy-backend-ldvg.onrender.com/` eller `https://candy-backend-ldvg.onrender.com/admin/` skal fungere, skal den ikke lages i dette repoet.
