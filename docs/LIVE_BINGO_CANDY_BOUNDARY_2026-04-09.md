# Live Bingo vs Candy Boundary

Dette dokumentet er kildesannhet for grensen mellom `Spillorama-system`, `Candy` og `demo-backend` per 9. april 2026.

Hvis noen andre dokumenter i dette repoet sier noe annet om Candy, demo-login, demo-admin, demo-settings eller gammel integrasjonskode, er dette dokumentet styrende.

## 1. Beslutning

`Spillorama-system` skal kun inneholde kode for live bingo-systemet.

Det betyr:

- live portal
- live auth
- live wallet
- live compliance
- live admin
- live Spillorama Unity-lobby
- live Spillorama Unity-spill
- hall-display / TV-display
- generisk spillkatalog og launch-flyt for spill som faktisk eies av live bingo

Det betyr også:

- ingen Candy-spillkode i dette repoet
- ingen Candy demo-backend i dette repoet
- ingen demo-login for Candy i dette repoet
- ingen demo-admin for Candy i dette repoet
- ingen Candy-spesifikke backendsettings i dette repoet
- ingen Candy room-engine eller Candy scheduler i dette repoet

Merk:

- leverandorsiden av Candy-integrasjonen er fortsatt lov i dette repoet
- dette inkluderer launch-endepunkt, shared wallet API og `/web/`-host glue

## 2. De tre kodebasene

| System | Lokal mappe | GitHub-repo | Ansvar |
|---|---|---|---|
| Live bingo | `/Users/tobiashaugen/Projects/Spillorama-system` | `tobias363/Spillorama-system` | live bingo-plattformen |
| Candy | `/Users/tobiashaugen/Projects/Candy` | `tobias363/candy-web` | selve Candy-spillet, UI, assets, gameplay |
| demo-backend | `/Users/tobiashaugen/Projects/demo-backend` | `tobias363/demo-backend` | Candy demo-login, demo-admin, demo-settings, demo-runtime og sentral Candy-backend |

## 3. Domener og hva de betyr

| Domene | Path | Eier |
|---|---|---|
| `https://spillorama-system.onrender.com/` | `/` | `Spillorama-system` |
| `https://spillorama-system.onrender.com/portal/` | `/portal/` | `Spillorama-system` |
| `https://spillorama-system.onrender.com/admin/` | `/admin/` | `Spillorama-system` |
| `https://spillorama-system.onrender.com/web/` | `/web/` | `Spillorama-system` |
| `https://candy-backend-ldvg.onrender.com/` | `/` | `demo-backend` |
| `https://candy-backend-ldvg.onrender.com/admin/` | `/admin/` | `demo-backend` |

Samme navn på route betyr ikke samme system. Domene avgjør eierskap.

Merk: offentlig live-adresse er nå `https://spillorama-system.onrender.com/`, og rooten `/` redirecter til `/web/`.

## 4. Integrasjonsmodellen vi er enige om

Candy skal kunne kobles mot flere ulike bingo-leverandører. Derfor skal Candy-backenden være sentral og ligge utenfor `Spillorama-system`.

Flyten er:

1. Spilleren autentiseres i bingo-leverandørens system.
2. Bingo-leverandøren eier spillerkonto, wallet og regulatoriske krav for sine egne spillere.
3. Candy-spillet eies av Candy-produktet.
4. Candy-backenden eies av `demo-backend` og er den sentrale backend-koden for Candy.
5. `Spillorama-system` skal ikke inneholde Candy demo-login, Candy demo-admin eller Candy runtime-konfig.

Den viktigste konsekvensen er denne:

- Hvis Candy trenger egne settings, launch-regler, demo-brukere, driftspanel, RTP-parametre eller annen backendlogikk, skal dette implementeres i `demo-backend`, ikke i `Spillorama-system`.

## 5. Hva som ble fjernet fra `Spillorama-system`

Disse områdene ble tatt ut fordi de tilhører Candy/demo-backend og ikke live bingo:

- `bingo_in_20_3_26_latest/`
- `backend/src/integration/`
- `backend/docs/integration/`
- `backend/public/game/`
- runtime-støtte for `WALLET_PROVIDER=external` i `backend/src/adapters/createWalletAdapter.ts`

Dette betyr at `Spillorama-system` ikke lenger eier:

- `/api/integration/*`
- Candy gameplay-kode
- Candy room-engine
- Candy backendsettings
- legacy demo-backend-strukturen som blandet live bingo og Candy

Dette er derimot fortsatt riktig å eie i `Spillorama-system`:

- `POST /api/games/candy/launch`
- `/api/ext-wallet/*`
- Candy tile i Unity-lobbyen
- `/web/`-hostens iframe-overlay for Candy
- token handoff mellom Unity-host og launch-flyten

## 6. Hva som fortsatt er riktig å ha i `Spillorama-system`

Disse områdene er fortsatt legitime fordi de tilhører live bingo:

- `frontend/`
- `backend/src/`
- `backend/public/web/`
- `backend/public/view-game/`
- `Spillorama/`

Spesielt:

- `backend/public/web/` er live Unity WebGL-host for bingo-lobbyen.
- `backend/public/view-game/` er hall-display / TV-host for live bingo.
- leverandorsiden av Candy launch og shared wallet hører også hjemme her

## 7. Praktisk tommelfingerregel

Endringen hører hjemme i `Spillorama-system` hvis den er nødvendig for:

- live portal
- live admin
- live wallet
- live auth
- live compliance
- live `/web/`
- live `/view-game/`
- leverandorsiden av Candy launch
- leverandorsiden av shared wallet

Endringen hører ikke hjemme i `Spillorama-system` hvis den er nødvendig for:

- `https://candy-backend-ldvg.onrender.com/`
- `https://candy-backend-ldvg.onrender.com/admin/`
- Candy demo-login
- Candy demo-admin
- Candy demo-settings
- Candy demo-runtime
- Candy gameplay eller Candy assets

## 8. Deploy-beslutning

`render.yaml` i dette repoet skal deploye live bingo fra repo-roten og starte `backend/dist/index.js` via `npm --prefix backend run start`.

Det skal ikke lenger peke til `bingo_in_20_3_26_latest`.

## 9. Dokumentasjonsregel

Hvis et dokument i `Spillorama-system` fortsatt refererer til:

- `bingo_in_20_3_26_latest`
- `backend/public/game`
- `/api/integration/*`
- Candy wallet bridge
- Candy demo-login/admin/settings som om de eies her

så er dokumentet historisk og ikke kildesannhet.

## 10. Kortversjonen

`Spillorama-system` = live bingo + leverandorsiden av Candy-integrasjonen.

`Candy` = Candy-spillet.

`demo-backend` = Candy-backend, demo-login, demo-admin og demo-settings.

Se også `docs/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md` for komplett redegjørelse, oppryddingsstatus og fremtidig arbeidsmodell.
