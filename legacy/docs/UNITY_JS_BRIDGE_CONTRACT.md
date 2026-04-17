# Unity WebGL ↔ Host Page JavaScript Bridge Contract

Dette dokumentet beskriver den gjeldende JS-broen mellom live bingo sine Unity-hosts og HTML-host-sidene i `Spillorama-system`.

Candy gameplay, Candy-klient og Candy-backend ligger fortsatt utenfor dette repoet, men live `/web/`-hosten inneholder nå leverandorsiden av Candy-integrasjonen:

- token handoff fra Unity til host
- launch mot `POST /api/games/candy/launch`
- iframe-overlay for Candy
- host-side mottak av Candy `postMessage`-hendelser

## 1. Gjeldende host-sider

| Host-side | Unity-build | Formål |
|-----------|-------------|--------|
| `backend/public/web/index.html` | Spillorama | Live bingo-lobby / spillerhost |
| `backend/public/view-game/index.html` | SpilloramaTv | Live hall-display / TV-host |

## 2. Globale funksjoner Unity forventer

Disse funksjonene må finnes som globale `window`-funksjoner. Hvis de mangler, kan Unity stoppe på splash-screen eller miste navigasjon.

### 2.1 `requestDomainData()`

Kalles av Unity ved oppstart for å få backendens origin.

**`backend/public/web/index.html`**

```javascript
var pendingDomainData = false;
function requestDomainData() {
  var serverUrl = window.location.origin;
  if (typeof unityInstanceRef !== 'undefined' && unityInstanceRef) {
    unityInstanceRef.SendMessage('Socket And Event Manager', 'DomainDataCall', serverUrl);
  }
}
```

Unity kaller `requestDomainData()` fra `GameSocketManager.Awake()` via `Application.ExternalCall` — dette skjer FØR `createUnityInstance`-Promisen resolves, så `unityInstanceRef` er `null` på dette tidspunktet. Deferred-patternen lagrer forespørselen og flusher den i `.then()`-callbacken.

**`backend/public/view-game/index.html`**

```javascript
function requestDomainData() {
  let host = window.location.origin;
  unityInstance.SendMessage("Socket And Event Manager", "DomainDataCall", host);
}
```

Begge host-sidene bruker nå `"Socket And Event Manager"` som SendMessage-mål (GameObjectet i Unity-scenen).

### 2.2 `SetPlayerToken(token)` og `ClearPlayerToken()` (`/web/` only)

Brukes av `/web/`-hosten til å lagre eller nullstille spiller-token som senere brukes mot Candy launch-endepunktet.

### 2.3 `SetActiveHall(hallId, hallName)` (`/web/` only)

Brukes av `/web/`-hosten til å vite hvilken hall som er aktiv i Unity-lobbyen akkurat nå.

Denne brukes nå også av host-side `Spillvett`-visning for å hente:

- `GET /api/wallet/me/compliance?hallId=...`
- `GET /api/spillevett/report?hallId=...&period=...`

### 2.4 `SetApprovedHalls(payloadJson)` og `ClearApprovedHalls()` (`/web/` only)

Brukes av Unity til å sende hele listen med godkjente haller til host-shellen, slik at hallvelgeren kan ligge utenfor Unity-canvaset.

Payloaden inneholder:

- aktiv hall-ID og hallnavn
- alle godkjente haller
- tilgjengelig tapsgrense per hall
- markering av valgt hall

### 2.5 `SwitchActiveHallFromHost(hallId)` (`/web/` only)

Brukes av host-shellen for å be Unity om å bytte aktiv hall når brukeren velger hall i shellens nedtrekk.

### 2.6 `NavigateSpilloramaGame(gameNumber)` (`/web/` only)

Brukes av host-shellen for å sende enkel spillnavigasjon tilbake inn i Unity.

### 2.7 `OpenUrlInSameTab(url)` (`/web/` only)

Kalles av Unity når lobbyen vil åpne en ekstern URL fra spillerhosten.

Gjeldende live-host oppfører seg slik:

- `/candy/` fanges opp og åpnes i et fullskjerms iframe-overlay via `window.launchCandyOverlay()` i `spillvett.js`
- Overlayets `POST /api/games/candy/launch` henter `embedUrl` med token + hallId, setter iframe `src` og validerer `event.origin` på innkommende `postMessage`-hendelser
- Andre URL-er åpnes via `window.open(url, 'myUniqueTab')`
### 2.8 `requestGameData()` (`/view-game/` only)

Kalles av hall-display-builden for å hente visningsdata fra URL-token og validere dette mot backend.

### 2.9 `sendDeviceTypeToUnity()` (`/view-game/` only)

Sender `deviceType` fra querystring tilbake til `Panel - Bingo Hall Display`.

### 2.10 `openSpilloramaTab()` og `CloseSpilloramaTvScreenTab()` (`/view-game/` only)

Brukes av hall-displayet for fokus/lukking av TV-vindu.

## 3. Aktive `SendMessage(...)`-mål

| SendMessage-kall | Host-side | Når |
|-----------------|-----------|-----|
| `SendMessage('Socket And Event Manager', 'DomainDataCall', serverUrl)` | `/web/` | Etter `requestDomainData()` |
| `SendMessage('FirebaseManager', 'OnWebTokenReceived', token)` | `/web/` | Etter vellykket FCM-token |
| `SendMessage('FirebaseManager', 'OnWebMessageReceived', payload)` | `/web/` | Ved foreground push |
| `SendMessage('Socket And Event Manager', 'DomainDataCall', host)` | `/view-game/` | Etter `requestDomainData()` |
| `SendMessage('Panel - Bingo Hall Display', 'AdminHallDisplayRoomIdCall', jsonData)` | `/view-game/` | Etter `requestGameData()` |
| `SendMessage('Panel - Bingo Hall Display', 'ReceiveDeviceType', deviceType)` | `/view-game/` | Etter `sendDeviceTypeToUnity()` |

### 3.1 Phase 1 auth-flyt (`/web/`)

```
Shell login → JWT i sessionStorage['spillorama.accessToken']
            ↓
Unity OnUnityReady / ProvideShellCredentials
            ↓
SendMessage('UIManager', 'ReceiveShellToken', jwt)   ← primær
SendMessage('UIManager', 'ReceiveHostCredentials', …) ← transitional (AIS game events)
            ↓
Unity: GET /api/auth/me → gameAssetData populated (IsLoggedIn=true)
Unity: ProcessPendingHostGame()
```

`ProvideShellToken()` — global JS-funksjon kalt av `auth.js` etter token-refresh. Sender ny JWT til Unity hvis den kjører.

## 4. Det som fortsatt ikke skal ligge i `Spillorama-system`

Følgende skal fortsatt ikke reintroduseres i live bingo-repoet:

- Candy gameplay-kode
- Candy room-engine
- Candy scheduler-logikk
- Candy demo-login
- Candy demo-admin
- Candy demo-settings
- `/api/integration/*`-endepunkter som eies av Candy-backenden

Det som er lov i `Spillorama-system` er kun leverandorsiden av integrasjonen:

- `POST /api/games/candy/launch`
- `/api/ext-wallet/*`
- `SetPlayerToken(token)` / `ClearPlayerToken()`
- `SetApprovedHalls(payloadJson)` / `ClearApprovedHalls()`
- host-side hallvelger og Spillvett-shell på `/web/`
- iframe-overlay for Candy på `/web/`
- host-side mottak av Candy `postMessage`

## 5. Failure modes

| Symptom | Typisk årsak | Fiks |
|---------|--------------|------|
| Splash-screen henger på `/web/` | `requestDomainData()` mangler eller feil `SendMessage`-mål | Sjekk `backend/public/web/index.html` |
| Candy åpner ikke fra lobbyen | host mangler spiller-token eller Candy launch feiler | Sjekk `SetPlayerToken()`, `OpenUrlInSameTab('/candy/')` og `POST /api/games/candy/launch` |
| `/view-game/` får ikke romdata | `requestGameData()` mangler eller backend-token feiler | Sjekk `backend/public/view-game/index.html` og `validateGameView`-flyten |
| Unity åpner ikke eksterne URL-er | `OpenUrlInSameTab(url)` mangler | Sjekk `backend/public/web/index.html` |
| Push-notifikasjoner virker ikke | service worker eller Firebase-init avviker fra host-path | Sjekk `backend/public/web/index.html` og `backend/public/web/firebase-messaging-sw.js` |

## 6. Deploy-regel

Unity WebGL-build og host HTML er ett deploybart sett.

Live `/web/` bruker i tillegg en eldre Socket.IO/Engine.IO-klient fra Unity-builden. Backend må derfor beholde kompatibilitet for Engine.IO v3 (`allowEIO3`) så lenge denne Unity-builden er i bruk.

Det betyr at følgende må deployes sammen:

- `backend/public/web/index.html`
- `backend/public/web/Build/*`
- `backend/public/web/StreamingAssets/*`
- `backend/public/web/firebase-messaging-sw.js`

Tilsvarende gjelder for `backend/public/view-game/`.
