# Candy ↔ Spillorama API-kontrakt v1.0

**Opprettet:** 2026-04-09
**Status:** Gjeldende

Denne kontrakten definerer grensesnittet mellom Spillorama-system (leverandor) og Candy/demo-backend (spillprodukt). En utvikler skal kunne implementere begge sider basert pa dette dokumentet alene.

Se `CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md` for eiermodell og repo-grenser.

---

## 1. Arkitektur

```
Spiller (nettleser)
  |
  |-- HTTPS --> Spillorama live host (spillorama-system.onrender.com)
  |               |
  |               |-- POST /api/games/candy/launch --> Spillorama backend
  |               |     |
  |               |     |-- POST /api/integration/launch --> demo-backend
  |               |     |     (server-til-server, X-API-Key)
  |               |     |
  |               |     |<-- { embedUrl } --
  |               |
  |               |-- Viser Candy i iframe med embedUrl
  |
  |-- iframe --> Candy klient (candy-backend-ldvg.onrender.com/web/)
  |               |
  |               |-- Socket.IO --> demo-backend
  |
demo-backend
  |-- GET  /api/ext-wallet/balance --> Spillorama backend (server-til-server)
  |-- POST /api/ext-wallet/debit   --> Spillorama backend
  |-- POST /api/ext-wallet/credit  --> Spillorama backend
  |
  |-- POST {webhookUrl} --> Spillorama backend (spillresultater)
```

### Nettverksmodell

| Kall | Retning | Type | CORS? |
|------|---------|------|-------|
| Spiller -> Spillorama | browser -> server | HTTPS | ja (origin) |
| Spillorama -> demo-backend | server -> server | HTTPS | nei |
| Spiller -> Candy iframe | browser -> server | HTTPS | ja (iframe origin) |
| Candy klient -> demo-backend | browser -> server | HTTPS/WSS | ja (candy origin) |
| demo-backend -> Spillorama wallet | server -> server | HTTPS | nei |
| demo-backend -> Spillorama webhook | server -> server | HTTPS | nei |

---

## 2. Launch-flyt

### 2.1 Spillorama utsteder launch (intern)

Spilleren er allerede logget inn i Spillorama. Portalen kaller:

```
POST /api/games/candy/launch
Authorization: Bearer {spillerens-access-token}
Content-Type: application/json

{
  "hallId": "hall-default"
}
```

Spillorama backend:
1. Validerer spillerens sesjon
2. Sjekker at Candy er aktivert i spillkatalogen
3. Kaller demo-backend for a opprette Candy-sesjon (se 2.2)
4. Returnerer embedUrl til portalen

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "embedUrl": "https://candy-backend-ldvg.onrender.com/web/?lt=abc123&embed=true",
    "expiresAt": "2026-04-09T12:05:00.000Z"
  }
}
```

### 2.2 Spillorama -> demo-backend (server-til-server)

```
POST https://{CANDY_BACKEND_URL}/api/integration/launch
X-API-Key: {CANDY_INTEGRATION_API_KEY}
Content-Type: application/json

{
  "sessionToken": "{spillerens-access-token}",
  "playerId": "{spillerens-wallet-id}",
  "currency": "NOK",
  "language": "nb-NO",
  "returnUrl": "https://spillorama-system.onrender.com/"
}
```

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "embedUrl": "https://candy-backend-ldvg.onrender.com/web/?lt=abc123&embed=true",
    "launchToken": "abc123",
    "expiresAt": "2026-04-09T12:05:00.000Z",
    "internalPlayerId": "uuid",
    "internalWalletId": "uuid"
  }
}
```

### 2.3 Iframe-embedding

Spillorama portalen laster embedUrl i en iframe:

```html
<iframe
  src="{embedUrl}"
  allow="autoplay"
  sandbox="allow-scripts allow-same-origin"
  style="width:100%;height:100%;border:none"
></iframe>
```

CSP frame-ancestors pa demo-backend: `ALLOWED_EMBED_ORIGINS=https://spillorama-system.onrender.com`

---

## 3. Wallet-bro (demo-backend -> Spillorama)

Demo-backend sin `ExternalWalletAdapter` kaller Spillorama sin wallet-API for alle pengebevegelser. Alle kall er server-til-server.

### 3.1 Auth

Alle wallet-kall bruker:
```
Authorization: Bearer {EXT_GAME_WALLET_API_KEY}
```

### 3.2 GET /api/ext-wallet/balance

Henter spillerens saldo.

```
GET /api/ext-wallet/balance?playerId={walletId}
Authorization: Bearer {api-key}
```

**Response (200):**
```json
{
  "balance": 500.00,
  "currency": "NOK"
}
```

**Feil (404):**
```json
{
  "success": false,
  "errorCode": "PLAYER_NOT_FOUND",
  "message": "Ukjent wallet-ID."
}
```

### 3.3 POST /api/ext-wallet/debit

Trekker innsats fra spillerens konto.

```
POST /api/ext-wallet/debit
Authorization: Bearer {api-key}
Content-Type: application/json

{
  "playerId": "wallet-id",
  "amount": 50.00,
  "transactionId": "uuid-for-idempotens",
  "roundId": "ROOM-GAMEID",
  "currency": "NOK"
}
```

**Response (200):**
```json
{
  "success": true,
  "balance": 450.00,
  "transactionId": "uuid-for-idempotens"
}
```

**Feil (402):**
```json
{
  "success": false,
  "errorCode": "INSUFFICIENT_FUNDS",
  "message": "Ikke nok saldo.",
  "balance": 30.00
}
```

**Feil (409):**
```json
{
  "success": false,
  "errorCode": "DUPLICATE_TRANSACTION",
  "message": "Transaksjonen er allerede utfort.",
  "transactionId": "uuid-for-idempotens"
}
```

### 3.4 POST /api/ext-wallet/credit

Utbetaler gevinst til spillerens konto. Samme request-format som debit.

```
POST /api/ext-wallet/credit
Authorization: Bearer {api-key}
Content-Type: application/json

{
  "playerId": "wallet-id",
  "amount": 200.00,
  "transactionId": "uuid-for-idempotens",
  "roundId": "ROOM-GAMEID",
  "currency": "NOK"
}
```

**Response (200):**
```json
{
  "success": true,
  "balance": 650.00,
  "transactionId": "uuid-for-idempotens"
}
```

### 3.5 Feilkoder

| HTTP | Kode | Betydning | Retriable? |
|------|------|-----------|------------|
| 400 | `INVALID_AMOUNT` | Ugyldig belop (negativt, NaN, 0) | Nei |
| 400 | `INVALID_INPUT` | Manglende felt | Nei |
| 401 | `UNAUTHORIZED` | Ugyldig eller manglende API-nokkel | Nei |
| 402 | `INSUFFICIENT_FUNDS` | Ikke nok saldo for debit | Nei |
| 404 | `PLAYER_NOT_FOUND` | Ukjent wallet-ID | Nei |
| 409 | `DUPLICATE_TRANSACTION` | Transaksjon allerede utfort | Nei (idempotent ok) |
| 500 | `WALLET_ERROR` | Intern feil | Ja |
| 503 | `WALLET_UNAVAILABLE` | Wallet midlertidig nede | Ja |

### 3.6 Idempotency

- `transactionId` er pakrevd pa alle debit/credit-kall
- Duplikat-kall returnerer HTTP 409 med `DUPLICATE_TRANSACTION`
- Demo-backend behandler 409 som suksess (idempotent bekreftelse)
- Spillorama lagrer transactionId i 30 dager

### 3.7 Circuit breaker (demo-backend-side)

Demo-backend sin `ExternalWalletAdapter` har innebygd circuit breaker:
- Apner etter 5 pafolgende 5xx-feil
- Tilbakestilles etter 30 sekunder
- `INSUFFICIENT_FUNDS` (402) tripper IKKE breakeren
- Saldocache: 5 sekunders TTL per spiller

---

## 4. Game result webhook (demo-backend -> Spillorama)

Sendes asynkront etter at en runde er fullfort. Valgfritt - konfigureres via `INTEGRATION_WEBHOOK_URL`.

### 4.1 Payload

```json
{
  "event": "game.completed",
  "gameId": "uuid",
  "sessionId": "ROOMCODE",
  "playerId": "wallet-id",
  "timestamp": "2026-04-09T12:00:00.000Z",
  "result": {
    "entryFee": 50.00,
    "totalPayout": 200.00,
    "netResult": 150.00,
    "currency": "NOK",
    "ticketsPlayed": 4,
    "numbersDrawn": 18,
    "patterns": ["LINE", "BINGO"]
  },
  "signature": "hex-hmac-sha256"
}
```

### 4.2 Signaturverifisering

```
signature = hex(HMAC-SHA256(JSON.stringify(payload uten signature-felt), INTEGRATION_WEBHOOK_SECRET))
```

### 4.3 Levering

- Timeout: 10 sekunder
- Retry: eksponentiell backoff (1s, 2s, 4s, 8s, 16s), maks 5 forsok
- Dead letter etter 5 feil

---

## 5. PostMessage-protokoll (iframe <-> Spillorama)

### 5.1 Candy -> Spillorama (parent)

| Type | Payload | Beskrivelse |
|------|---------|-------------|
| `candy:ready` | `{}` | Spillet er lastet |
| `candy:balanceChanged` | `{ balance, currency }` | Saldo oppdatert |
| `candy:gameStarted` | `{ gameId, entryFee }` | Runde startet |
| `candy:gameEnded` | `{ gameId, totalPayout, netResult }` | Runde fullfort |
| `candy:error` | `{ code, message }` | Feil oppstod |
| `candy:resize` | `{ width, height }` | Onsket storrelse |

### 5.2 Spillorama -> Candy (iframe)

| Type | Payload | Beskrivelse |
|------|---------|-------------|
| `host:sessionExpiring` | `{}` | Sesjon i ferd med a utlope |
| `host:closeGame` | `{}` | Lukk spillet |

### 5.3 Verifisering

Begge sider skal validere `event.origin` mot kjente domener for de behandler meldinger.

---

## 6. Sesjonsadministrasjon

### 6.1 Kill session

Spillorama kan tvangsavslutte en spillers Candy-sesjon:

```
POST https://{CANDY_BACKEND_URL}/api/integration/session/kill
X-API-Key: {CANDY_INTEGRATION_API_KEY}

{ "playerId": "wallet-id", "provider": "default" }
```

### 6.2 Refresh session

```
POST https://{CANDY_BACKEND_URL}/api/integration/session/refresh
X-API-Key: {CANDY_INTEGRATION_API_KEY}

{ "playerId": "wallet-id", "extensionMinutes": 60 }
```

---

## 7. Miljovariabler

### 7.1 Spillorama-system

| Variabel | Formal | Secret? | Eksempel |
|----------|--------|---------|----------|
| `EXT_GAME_WALLET_API_KEY` | Auth for wallet-kall fra demo-backend | Ja | `sk_live_abc123` |
| `CANDY_BACKEND_URL` | URL til demo-backend | Nei | `https://candy-backend-ldvg.onrender.com` |
| `CANDY_INTEGRATION_API_KEY` | API-nokkel for launch-kall til demo-backend | Ja | `ik_live_xyz789` |
| `CANDY_WEBHOOK_SECRET` | HMAC-hemmelighet for webhook-verifisering | Ja | `whsec_abc123` |
| `CORS_ALLOWED_ORIGINS` | Ma inkludere Candy-klient origin | Nei | `https://candy-backend-ldvg.onrender.com` |

### 7.2 demo-backend

| Variabel | Formal | Secret? | Eksempel |
|----------|--------|---------|----------|
| `INTEGRATION_ENABLED` | Aktiver integrasjonsmodus | Nei | `true` |
| `INTEGRATION_API_KEY` | Motta launch-kall fra Spillorama | Ja | `ik_live_xyz789` |
| `WALLET_PROVIDER` | Ma vaere `external` | Nei | `external` |
| `WALLET_API_BASE_URL` | Spillorama wallet-endepunkt | Nei | `https://spillorama-system.onrender.com/api/ext-wallet` |
| `WALLET_API_KEY` | Bearer-token for wallet-kall | Ja | `sk_live_abc123` |
| `ALLOWED_EMBED_ORIGINS` | Spillorama origin for iframe | Nei | `https://spillorama-system.onrender.com` |
| `INTEGRATION_WEBHOOK_URL` | Spillorama webhook-endepunkt | Nei | `https://spillorama-system.onrender.com/api/webhooks/candy` |
| `INTEGRATION_WEBHOOK_SECRET` | Delt HMAC-hemmelighet | Ja | `whsec_abc123` |

### 7.3 Delte secrets

| Formal | Spillorama-variabel | demo-backend-variabel | Verdi |
|--------|--------------------|-----------------------|-------|
| Wallet-auth | `EXT_GAME_WALLET_API_KEY` | `WALLET_API_KEY` | Samme nokkel |
| Launch-auth | `CANDY_INTEGRATION_API_KEY` | `INTEGRATION_API_KEY` | Samme nokkel |
| Webhook HMAC | `CANDY_WEBHOOK_SECRET` | `INTEGRATION_WEBHOOK_SECRET` | Samme hemmelighet |

---

## 8. Feilhandtering og observability

### 8.1 Timeout-policy

| Kall | Timeout | Retry |
|------|---------|-------|
| Spillorama -> demo-backend (launch) | 10s | Nei (spiller far feilmelding) |
| demo-backend -> Spillorama (balance) | 8s | Nei (viser cachet saldo) |
| demo-backend -> Spillorama (debit) | 8s | Nei (mislykket debit = spill starter ikke) |
| demo-backend -> Spillorama (credit) | 8s | Ja, opptil 5 forsok |
| demo-backend -> Spillorama (webhook) | 10s | Ja, opptil 5 forsok |

### 8.2 Uklar tilstand

Hvis et credit-kall timeoutet men pengene ble kreditert:
- demo-backend retrier med samme `transactionId`
- Spillorama returnerer 409 `DUPLICATE_TRANSACTION` (idempotent ok)
- demo-backend behandler 409 som suksess

### 8.3 Healthchecks

- Spillorama: `GET /health` viser `candyIntegration: { configured, reachable }`
- demo-backend: `GET /api/integration/health` viser wallet-API status

### 8.4 Logging

Alle kall mellom systemene skal logge:
- `requestId` (UUID generert av kallende system)
- `playerId` / `walletId`
- `transactionId` (for wallet-kall)
- `roundId` (for spillrelaterte kall)
- HTTP status og responstid

---

## 9. Deploy-rekkefole

Ved kontraktsendringer:

1. Mottakende system implementerer bakoverkompatibel stotte
2. Mottakende system deployes
3. Kallende system tar i bruk ny kontrakt
4. Kallende system deployes
5. Gammel stotte fases ut i neste runde

### Kill-switch

Spillorama kan deaktivere Candy-launch via spillkatalogen (`isEnabled: false`) uten full deploy.

---

## 10. Kontraktsversjonering

Denne kontrakten er v1.0. Ved breaking changes:
- Bump versjonnummer i dette dokumentet
- Dokumenter endringen med dato
- Follow deploy-rekkefole over
