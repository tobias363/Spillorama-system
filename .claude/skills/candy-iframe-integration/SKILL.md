---
name: candy-iframe-integration
description: When the user/agent works with Candy integration, the wallet-bridge, /api/games/:slug/launch, /api/ext-wallet/* endpoints, iframe-overlay, eller postMessage-protokoll mellom Candy og host. Also use when they mention candy, candy-slug, ext-wallet, externalGameWallet, ExternalGameWalletAdapter, CANDY_BACKEND_URL, EXT_GAME_WALLET_API_KEY, CANDY_INTEGRATION_API_KEY, candy-backend-ldvg.onrender.com, candy-web, demo-backend, OpenUrlInSameTab, launchCandyOverlay, iframe-overlay, third-party Candy. Make sure to use this skill whenever someone touches Candy launch-flyt, wallet-bridge, eller iframe-host — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: spillorama
---

# Candy iframe-integration — leverandørsiden

Candy er et tredjeparts-spill vi **ikke** har kildekoden til. Spillorama-system eier KUN: launch-endpoint + wallet-bridge + iframe-host. All Candy-spillkode, demo-login, demo-admin og demo-runtime ligger i separate repoer (`tobias363/candy-web` og `tobias363/demo-backend`).

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md` — kanonisk grenseboundary
- `docs/architecture/CANDY_SPILLORAMA_API_CONTRACT.md` — wire-kontrakt
- `docs/architecture/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md` — separasjon-detaljer

**Direktiv (2026-04-09):**
> Spillorama-system skal kun inneholde kode for live bingo-systemet. Candy demo-backend, demo-login, demo-admin og demo-settings hører IKKE hjemme her.

Hvis noen andre dokumenter i dette repoet sier noe annet, er `LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md` styrende.

## Tre-system-modell — kritisk å forstå

| System | Lokal mappe | GitHub-repo | Ansvar |
|---|---|---|---|
| **Live bingo** | `Spillorama-system` | `tobias363/Spillorama-system` | Live bingo-plattformen + leverandorsiden av Candy-integrasjon |
| **Candy** | `Candy/` | `tobias363/candy-web` | Selve Candy-spillet, UI, assets, gameplay |
| **demo-backend** | `demo-backend/` | `tobias363/demo-backend` | Candy demo-login, demo-admin, demo-settings, demo-runtime, sentral Candy-backend |

**Domener og hva de betyr:**

| Domene | Path | Eier |
|---|---|---|
| `https://spillorama-system.onrender.com/` | `/` | `Spillorama-system` |
| `https://spillorama-system.onrender.com/web/` | `/web/` | `Spillorama-system` (Candy iframe-host) |
| `https://candy-backend-ldvg.onrender.com/` | `/` | `demo-backend` |
| `https://candy-backend-ldvg.onrender.com/admin/` | `/admin/` | `demo-backend` |

**Samme path-navn betyr ikke samme system.** Domene avgjør eierskap.

## Hva Spillorama EIER (legitim kode i dette repoet)

### 1. Launch-endpoint
`POST /api/games/:slug/launch` — i `apps/backend/src/routes/game.ts:94`

Autentiserer Spillorama-spiller, genererer session-token, returnerer URL spilleren kan åpne Candy på.

**Wire-respons:**
```json
{
  "embedUrl": "https://candy-backend-ldvg.onrender.com/...?token=...",
  "expiresAt": "2026-05-08T12:00:00Z"
}
```

### 2. Wallet-bridge
`/api/ext-wallet/balance`, `/api/ext-wallet/debit`, `/api/ext-wallet/credit`

Candy-backend kaller disse med API-key (`EXT_GAME_WALLET_API_KEY` / `CANDY_INTEGRATION_API_KEY`) for å sjekke saldo og belaste/kreditere Spillorama-lommeboken (delt lommebok).

**Wire-kontrakt (Candy → Spillorama):**
- `GET /api/ext-wallet/balance?playerId=X&currency=NOK` — sjekk saldo
- `POST /api/ext-wallet/debit` — trekke fra saldo (spillinnsats)
- `POST /api/ext-wallet/credit` — legge til saldo (gevinst)

### 3. iframe-embed (`/web/`-host)
Candy-UI lastes i iframe inne i Spillorama-web-shell. Post-message-protokoll validerer origin.

**Implementasjon:** `backend/public/web/spillvett.js:launchCandyOverlay`

### 4. Token-handoff
Mellom Unity-host og launch-flyten — for legacy Unity-klient som lansker Candy.

## Hva Spillorama IKKE EIER

- Candy-spillkode (gameplay, UI, assets)
- Candy-backend (room-engine, scheduler, RTP-parametre)
- Candy demo-login (test-brukere)
- Candy demo-admin (driftspanel)
- Candy demo-settings (runtime-konfig)
- Candy regulatoriske ansvar (RNG, sannsynligheter — det er Candy-leverandørens)

**Hvis Candy trenger egne settings, launch-regler, demo-brukere, driftspanel, RTP-parametre eller annen backendlogikk:** Det skal implementeres i `demo-backend`, IKKE i `Spillorama-system`.

## Environment-variabler

`render.yaml`:
```yaml
- key: EXT_GAME_WALLET_API_KEY
  sync: false                           # delt hemmelighet for wallet-bridge
- key: CANDY_BACKEND_URL
  value: https://candy-backend-ldvg.onrender.com
- key: CANDY_INTEGRATION_API_KEY
  sync: false                           # alternative API-key
```

Disse er KUN for leverandorsiden av integrasjonen — Spillorama bruker dem for å validere innkommende Candy-backend-requests.

## Hva som ble fjernet fra dette repoet (2026-04-09)

Disse områdene tilhørte tidligere Candy/demo-backend men ble flyttet ut:

- `bingo_in_20_3_26_latest/`
- `backend/src/integration/`
- `backend/docs/integration/`
- `backend/public/game/`
- runtime-støtte for `WALLET_PROVIDER=external` i `backend/src/adapters/createWalletAdapter.ts`

**Spillorama eier IKKE lenger:**
- `/api/integration/*`
- Candy gameplay-kode
- Candy room-engine
- Candy backendsettings
- legacy demo-backend-strukturen som blandet live bingo og Candy

## Wire-kontrakt detaljert

### Spillorama → Candy (launch-handoff)

1. Spilleren autentiseres i Spillorama (login)
2. Spilleren klikker Candy-tile i lobby
3. Klient kaller `POST /api/games/candy/launch` med Bearer-token
4. Server genererer launch-URL med session-token (signert/kort levetid)
5. Klient åpner URL i iframe-overlay (eller `OpenUrlInSameTab` for legacy Unity)

### Candy → Spillorama (wallet-operasjoner)

Server-til-server, autentisert med `CANDY_INTEGRATION_API_KEY` i header.

```
GET /api/ext-wallet/balance?playerId=X&currency=NOK
  Headers: X-Api-Key: <CANDY_INTEGRATION_API_KEY>
  Response: { balance: 5000, currency: "NOK" }

POST /api/ext-wallet/debit
  Body: { playerId, amount, currency, idempotencyKey, reason }
  Response: { newBalance, transactionId }

POST /api/ext-wallet/credit
  Body: { playerId, amount, currency, idempotencyKey, reason }
  Response: { newBalance, transactionId }
```

**Idempotency:** Alle debit/credit-kall MÅ ha `idempotencyKey` for safe retry. Spillorama dedup-erer i 90 dager (BIN-767).

### iframe postMessage-protokoll

Validert origin på `https://candy-backend-ldvg.onrender.com`.

Meldinger:
- `candy:ready` — Candy-iframe er ferdig lastet
- `candy:close` — Spilleren har trykket "lukk" inne i Candy
- `candy:balance-update` — Candy ber host refresh balanse
- `candy:error` — feilmelding fra Candy-runtime

Implementasjon: `backend/public/web/spillvett.js`.

## Kjent gap (per dokumentasjon)

`CANDY_SPILLORAMA_API_CONTRACT.md` og `UNITY_JS_BRIDGE_CONTRACT.md` beskriver Candy som iframe-overlay. Faktisk implementasjon i `backend/public/web/index.html`:

```javascript
function OpenUrlInSameTab(url) {
  existingTab = window.open(url, 'myUniqueTab');  // ← åpner ny fane, ikke iframe
}
```

**Status:** Candy åpnes i egen fane/vindu fra Unity-host. iframe-integrasjonen er ikke ferdigstilt for Unity-flyten. Web-shell-flyten (`spillvett.js:launchCandyOverlay`) implementerer iframe-overlay korrekt.

## Praktisk tommelfingerregel — hvor hører endringen hjemme?

**Spillorama-system:**
- Live portal, admin, wallet, auth, compliance
- Live `/web/`-shell (lobby, profile, Spillvett)
- Live `/view-game/` (TV-display)
- Leverandorsiden av Candy launch
- Leverandorsiden av shared wallet (`/api/ext-wallet/*`)

**Candy / demo-backend (IKKE her):**
- `https://candy-backend-ldvg.onrender.com/`
- Candy demo-login, demo-admin, demo-settings, demo-runtime
- Candy gameplay eller Candy assets

## Vanlige feil og hvordan unngå dem

### 1. Implementerer Candy-spillkode i Spillorama-system
Symptom: Ny PR introduserer Candy game-engine, Candy assets, eller Candy-backend-logikk.
**Fix:** Det hører IKKE hjemme her. Flytt til `tobias363/candy-web` (Candy spillkode) eller `tobias363/demo-backend` (Candy-backend).

### 2. Legger til `/api/integration/*` route
Symptom: Forsøker gjenbruke gamle `WALLET_PROVIDER=external`-paths.
**Fix:** Det ble fjernet 2026-04-09. Bruk `/api/games/:slug/launch` + `/api/ext-wallet/*` istedet.

### 3. Bypasser API-key validering
Symptom: `/api/ext-wallet/*`-paths er ikke autentisert.
**Fix:** ALLE Candy-backend-requests MÅ valideres mot `CANDY_INTEGRATION_API_KEY` (eller `EXT_GAME_WALLET_API_KEY`). Dette er ekstern wallet — uautentiserte kall = pengetap.

### 4. Skipper idempotency-key på wallet-operasjoner
Symptom: Candy-retry på network failure trekker dobbelt.
**Fix:** Server MÅ håndheve `idempotencyKey` i debit/credit. Returner forrige resultat ved duplikat-key.

### 5. Forveksler Spillorama-domain og Candy-domain
Symptom: Tror at samme route-navn på spillorama-system.onrender.com og candy-backend-ldvg.onrender.com refererer samme system.
**Fix:** Domene avgjør eierskap. Sjekk hvilket domene before du gjør endringer.

### 6. Forsøker å implementere Candy demo-login i Spillorama
Symptom: Ny PR for Candy-test-brukere eller demo-konfig.
**Fix:** Det hører hjemme i `demo-backend`-repoet. Spillorama eier IKKE Candy demo-flyten.

### 7. Glemmer regulatorisk ansvar-delegering
Symptom: Spillorama tar ansvar for Candy RNG-sertifisering eller sannsynligheter.
**Fix:** Det er Candy-leverandørens ansvar. Spillorama er KUN wallet- og launch-vertshus.

### 8. Lagrer Candy-spillhistorikk i Spillorama-DB
Symptom: Ny tabell `app_candy_*` for spillhistorikk.
**Fix:** Vi lagrer kun wallet-transaksjoner (debit/credit-events). Spillhistorikk hører hos Candy-backend.

## Når denne skill-en er aktiv

**Gjør:**
- Les `LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md` FØRST
- Verifiser at endringer kun rører leverandorsiden (launch + wallet-bridge + iframe-host)
- Sjekk at API-key-validering er på plass for alle `/api/ext-wallet/*`-paths
- Verifiser idempotency-key-håndhevelse i debit/credit-paths
- Test postMessage-origin-validering for iframe-overlay
- Sjekk at endringer ikke duplikat-implementerer Candy-funksjonalitet

**Ikke gjør:**
- IKKE legg til Candy-spillkode i Spillorama-system
- IKKE introduser `/api/integration/*`-routes (deprecated)
- IKKE bypass API-key-validering på wallet-bridge
- IKKE skip idempotency-key i debit/credit
- IKKE forveksle spillorama-system og candy-backend-domain
- IKKE lagre Candy-spillhistorikk i Spillorama-DB
- IKKE ta regulatorisk ansvar for Candy RNG / sannsynligheter

## Kanonisk referanse

`LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md` er autoritativ. Hvis du finner andre dokumenter som motsier den, er de historiske og ikke kildesannhet.
