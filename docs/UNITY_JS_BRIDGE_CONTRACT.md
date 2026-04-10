# Unity WebGL ↔ Host Page JavaScript Bridge Contract

Dette dokumentet beskriver den gjeldende JS-broen mellom live bingo sine Unity-hosts og HTML-host-sidene i `Spillorama-system`.

Candy wallet-bridge, Candy iframe-overlay og Candy demo-hosting er ikke lenger del av dette repoet.

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
function requestDomainData() {
  var serverUrl = window.location.origin;
  if (typeof unityInstanceRef !== 'undefined' && unityInstanceRef) {
    unityInstanceRef.SendMessage('Socket And Event Manager', 'DomainDataCall', serverUrl);
  }
}
```

**`backend/public/view-game/index.html`**

```javascript
function requestDomainData() {
  let host = window.location.origin;
  unityInstance.SendMessage("Socket And Event Manager", "DomainDataCall", host);
}
```

Merk at de to buildene bruker ulike `SendMessage(...)`-mål.

### 2.2 `OpenUrlInSameTab(url)` (`/web/` only)

Kalles av Unity når lobbyen vil åpne en ekstern URL fra spillerhosten.

Gjeldende host implementerer dette som enkel nettlesernavigasjon i samme navngitte tab-kontekst. Det finnes ikke lenger Candy-spesifikk iframe-overlay eller wallet-bro på denne siden.

### 2.3 `requestGameData()` (`/view-game/` only)

Kalles av hall-display-builden for å hente visningsdata fra URL-token og validere dette mot backend.

### 2.4 `sendDeviceTypeToUnity()` (`/view-game/` only)

Sender `deviceType` fra querystring tilbake til `Panel - Bingo Hall Display`.

### 2.5 `openSpilloramaTab()` og `CloseSpilloramaTvScreenTab()` (`/view-game/` only)

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

## 4. Det som ikke lenger finnes i `Spillorama-system`

Følgende er fjernet fra live bingo-repoet og skal ikke reintroduseres her:

- `SetPlayerToken(token)`
- Candy `postMessage` wallet-bridge
- iframe-overlay for Candy-spill
- `/api/integration/*`-koblinger fra Unity-hosten
- Candy-spesifikk auth-/wallet-init i host-siden

Hvis disse trengs for Candy, hører de hjemme i `demo-backend` eller Candy-repoet.

## 5. Failure modes

| Symptom | Typisk årsak | Fiks |
|---------|--------------|------|
| Splash-screen henger på `/web/` | `requestDomainData()` mangler eller feil `SendMessage`-mål | Sjekk `backend/public/web/index.html` |
| `/view-game/` får ikke romdata | `requestGameData()` mangler eller backend-token feiler | Sjekk `backend/public/view-game/index.html` og `validateGameView`-flyten |
| Unity åpner ikke eksterne URL-er | `OpenUrlInSameTab(url)` mangler | Sjekk `backend/public/web/index.html` |
| Push-notifikasjoner virker ikke | service worker eller Firebase-init avviker fra host-path | Sjekk `backend/public/web/index.html` og `backend/public/web/firebase-messaging-sw.js` |

## 6. Deploy-regel

Unity WebGL-build og host HTML er ett deploybart sett.

Det betyr at følgende må deployes sammen:

- `backend/public/web/index.html`
- `backend/public/web/Build/*`
- `backend/public/web/StreamingAssets/*`
- `backend/public/web/firebase-messaging-sw.js`

Tilsvarende gjelder for `backend/public/view-game/`.
