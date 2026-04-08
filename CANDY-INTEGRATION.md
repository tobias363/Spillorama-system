# Candy Game - Integrasjonsdokumentasjon

Detaljert teknisk dokumentasjon for Candy-spillets arkitektur og hvordan det integreres med bingosystemer via iframe.

## Innholdsfortegnelse

1. [Arkitekturoversikt](#arkitekturoversikt)
2. [Intern launch-flyt (eget system)](#intern-launch-flyt)
3. [Ekstern launch-flyt (tredjepart)](#ekstern-launch-flyt)
4. [Launch Token-system](#launch-token-system)
5. [Wallet-integrasjon](#wallet-integrasjon)
6. [Socket.IO-kommunikasjon](#socketio-kommunikasjon)
7. [Spilltilstander og rundeflyt](#spilltilstander-og-rundeflyt)
8. [Webhooks (spillresultater)](#webhooks)
9. [Auto-play scheduler (Candy Mania)](#auto-play-scheduler)
10. [Sikkerhetsmodell](#sikkerhetsmodell)
11. [Konfigurering av tredjeparts-integrasjon](#konfigurering)
12. [API-referanse](#api-referanse)
13. [Feilsøking](#feilsøking)

---

## Arkitekturoversikt

Candy er designet som et **selvstendig spill** som kan embeddes i ethvert bingosystem via iframe. Arkitekturen skiller spillogikk fra wallet-håndtering via adapter-mønster.

```
┌─ Vertssystem (portal / tredjepart) ──────────────────────────────┐
│                                                                   │
│  1. POST /api/integration/launch   (eller /api/games/candy/       │
│     med API-nøkkel                  launch-token for eget system) │
│                                                                   │
│  2. Motta embed-URL med launch-token                              │
│                                                                   │
│  ┌─ iframe ────────────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  Candy Web SPA (React)                                      │  │
│  │  ├── Løser launch-token → credentials                       │  │
│  │  ├── Laster Candy WebGL (Unity)                             │  │
│  │  └── WebGL kommuniserer via Socket.IO                       │  │
│  │                                                             │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │ Socket.IO + REST                     │
└────────────────────────────┼──────────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────────┐
│                                                                   │
│  Candy Backend (Node.js)                                          │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ BingoEngine  │  │ Wallet       │  │ WebhookService         │  │
│  │ (spillogikk) │  │ Adapter      │  │ (resultater → provider)│  │
│  └──────────────┘  └──────┬───────┘  └────────────────────────┘  │
│                           │                                       │
│            ┌──────────────┼──────────────────┐                    │
│            │              │                  │                    │
│      ┌─────▼─────┐ ┌─────▼──────┐  ┌───────▼───────┐           │
│      │ File      │ │ PostgreSQL │  │ External      │           │
│      │ (dev)     │ │ (intern)   │  │ (tredjepart)  │           │
│      └───────────┘ └────────────┘  └───────────────┘           │
│                                          │                       │
│                           ┌──────────────▼──────────┐            │
│                           │ Providers wallet-API    │            │
│                           │ GET /balance            │            │
│                           │ POST /debit             │            │
│                           │ POST /credit            │            │
│                           └─────────────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Intern launch-flyt

Når en spiller i eget system starter Candy:

### Sekvensdiagram

```
Spiller          Frontend (portal)         Backend               Candy Web SPA
  │                    │                      │                       │
  │ Klikk "Spill nå"  │                      │                       │
  │───────────────────>│                      │                       │
  │                    │ POST /api/games/     │                       │
  │                    │ candy/launch-token   │                       │
  │                    │─────────────────────>│                       │
  │                    │                      │ Validerer spiller     │
  │                    │                      │ Sjekker compliance    │
  │                    │                      │ Oppretter token       │
  │                    │   { launchToken,     │                       │
  │                    │     launchUrl }      │                       │
  │                    │<─────────────────────│                       │
  │                    │                      │                       │
  │  Redirect til      │                      │                       │
  │  launchUrl?lt=xxx  │                      │                       │
  │<───────────────────│                      │                       │
  │                    │                      │                       │
  │────────────────────────────────────────────────────────────────>│
  │                    │                      │                       │
  │                    │                      │ POST /api/games/      │
  │                    │                      │ candy/launch-resolve  │
  │                    │                      │<──────────────────────│
  │                    │                      │                       │
  │                    │                      │ Validerer token       │
  │                    │                      │ Konsumerer (engangs)  │
  │                    │                      │                       │
  │                    │                      │ { accessToken,        │
  │                    │                      │   hallId, walletId,   │
  │                    │                      │   playerName,         │
  │                    │                      │   apiBaseUrl }        │
  │                    │                      │──────────────────────>│
  │                    │                      │                       │
  │                    │                      │      Socket.IO        │
  │                    │                      │<═════════════════════>│
  │                    │                      │    (spill starter)    │
```

### Kode-referanser

**Frontend (app.js):**
```javascript
// Synlige spill i portalen
const CUSTOMER_VISIBLE_GAME_SLUGS = new Set(["candy", "roma", "bingo"]);
const INSTANT_LAUNCH_GAME_SLUGS = new Set(["candy", "roma"]);

// Launch-flyt
async function launchCandyGame(hallId) {
  const res = await fetch("/api/games/candy/launch-token", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hallId })
  });
  const { launchToken, launchUrl } = await res.json();
  window.location.assign(`${launchUrl}?launchToken=${launchToken}`);
}
```

**Backend endepunkter:**
- `POST /api/games/candy/launch-token` - Oppretter token (TTL: `CANDY_LAUNCH_TOKEN_TTL_SECONDS`, standard 120s)
- `POST /api/games/candy/launch-resolve` - Konsumerer token, returnerer credentials

---

## Ekstern launch-flyt

Når en tredjepart embedder Candy i sitt system:

### Sekvensdiagram

```
Tredjepart            Backend                 Candy (iframe)
    │                    │                        │
    │ POST /api/         │                        │
    │ integration/launch │                        │
    │ X-API-Key: xxx     │                        │
    │ { sessionToken,    │                        │
    │   playerId }       │                        │
    │───────────────────>│                        │
    │                    │ Validerer API-nøkkel   │
    │                    │ Mapper spiller          │
    │                    │  (ekstern → intern)     │
    │                    │ Oppretter sesjon        │
    │                    │ Lager launch-token      │
    │                    │                        │
    │ { embedUrl:        │                        │
    │   "https://candy   │                        │
    │   .example.com/    │                        │
    │   ?lt=xxx" }       │                        │
    │<───────────────────│                        │
    │                    │                        │
    │ <iframe src=       │                        │
    │  embedUrl />       │                        │
    │ ──────────────────────────────────────────>│
    │                    │                        │
    │                    │ POST /api/games/       │
    │                    │ candy/launch-resolve   │
    │                    │<───────────────────────│
    │                    │                        │
    │                    │ { accessToken,         │
    │                    │   hallId, walletId,    │
    │                    │   apiBaseUrl }         │
    │                    │───────────────────────>│
    │                    │                        │
    │                    │    Socket.IO           │
    │                    │<══════════════════════>│
    │                    │                        │
    │ Webhook:           │                        │
    │ game.completed     │                        │
    │<───────────────────│                        │
```

### Spillermapping

Backend oppretter automatisk en intern representasjon av tredjepartsspilleren:

| Felt | Verdi |
|------|-------|
| `internalPlayerId` | UUID (generert) |
| `internalWalletId` | `wallet-ext-provider-{uuid}` |
| `externalPlayerId` | Providers spiller-ID |
| `provider` | Provider-identifikator |

Mapping lagres i `external_player_mapping`-tabellen.

---

## Launch Token-system

### Token-egenskaper

| Egenskap | Verdi |
|----------|-------|
| Format | Base64-kodet UUID |
| TTL | Konfigurerbar (standard: 120 sekunder) |
| Bruk | Engangs (slettes etter resolving) |
| Lagring | In-memory (CandyLaunchTokenStore) |

### Token-payload (kryptert)

```json
{
  "accessToken": "intern sesjonstoken",
  "hallId": "bingohall-ID",
  "playerName": "Player-ABC123",
  "walletId": "wallet-ext-provider-uuid",
  "apiBaseUrl": "https://backend-url.com",
  "issuedAt": 1709654400000,
  "expiresAt": 1709654520000
}
```

### Sikkerhetsflyt

1. Token opprettes og lagres server-side med TTL
2. Token sendes til klient som URL-parameter
3. Candy Web resolver tokenet via POST-kall
4. Token slettes umiddelbart etter vellykket resolving
5. Utløpte tokens ryddes automatisk

---

## Wallet-integrasjon

### ExternalWalletAdapter

For tredjeparts-integrasjon bruker backend `ExternalWalletAdapter` som oversetter spilloperasjoner til API-kall mot providers wallet.

### Provider Wallet-API kontrakt

Provideren må implementere disse endepunktene:

#### Hent saldo

```http
GET /balance?playerId=player-1
Authorization: Bearer {api_key}

Response:
{
  "balance": 5000,
  "currency": "NOK"
}
```

#### Debit (trekk penger)

```http
POST /debit
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "playerId": "player-1",
  "amount": 100,
  "transactionId": "uuid-v4",
  "roundId": "ROOM_CODE",
  "currency": "NOK"
}

Response:
{
  "success": true,
  "balance": 4900,
  "transactionId": "uuid-v4"
}
```

#### Credit (legg til penger)

```http
POST /credit
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "playerId": "player-1",
  "amount": 200,
  "transactionId": "uuid-v4",
  "roundId": "ROOM_CODE",
  "currency": "NOK"
}

Response:
{
  "success": true,
  "balance": 5200,
  "transactionId": "uuid-v4"
}
```

### Pålitelighetsfunksjoner

| Funksjon | Beskrivelse |
|----------|-------------|
| **Circuit breaker** | Etter 5 feil → 30s avkjøling |
| **Balance caching** | 5 sekunders TTL, unngår unødvendige API-kall |
| **Credit retry** | Eksponentiell backoff, maks 5 forsøk (kritisk for utbetalinger) |
| **Transaksjonslogg** | Lokal logg for avstemming |

### Virtuelle kontoer

House-kontoer (prefix `house-` eller `__`) er virtuelle og spores lokalt. De sendes aldri til providers API.

---

## Socket.IO-kommunikasjon

### Tilkoblingsflyt (Candy Unity-klient)

Candy implementerer sin egen Socket.IO-klient i C# (`BingoRealtimeClient.cs`):

```
1. ClientWebSocket.ConnectAsync(ws://backend/socket.io/?EIO=4&transport=websocket)
2. Mottar engine.io "0" (open) → sender "40" (namespace connect)
3. Server sender "40" → tilkobling etablert
4. OnConnectionChanged(true) fires
5. Auto-reconnect ved frakobling (2s delay)
```

### Pakkeprotokoll

```
"0"  - Engine.IO open
"2"  - Ping
"3"  - Pong
"40" - Socket.IO namespace connect
"42" - Event: 42["eventName", payload]
"43" - Ack:   43[ackId, response]
"44" - Error
```

### Alle hendelser

| Hendelse | Retning | Payload |
|----------|---------|---------|
| `room:create` | Klient → Server | `{ hallId, playerName, walletId, accessToken }` |
| `room:join` | Klient → Server | `{ roomCode, hallId, playerName, walletId, accessToken }` |
| `room:resume` | Klient → Server | `{ roomCode, playerId, accessToken }` |
| `room:state` | Klient → Server | `{ roomCode, accessToken }` |
| `room:configure` | Klient → Server | `{ roomCode, playerId, entryFee }` |
| `game:start` | Klient → Server | `{ roomCode, playerId, entryFee, ticketsPerPlayer, accessToken }` |
| `game:end` | Klient → Server | `{ roomCode, playerId, reason, accessToken }` |
| `draw:next` | Klient → Server | `{ roomCode, playerId, accessToken }` |
| `ticket:mark` | Klient → Server | `{ roomCode, playerId, number, accessToken }` |
| `claim:submit` | Klient → Server | `{ roomCode, playerId, type, accessToken }` |
| `room:update` | Server → Klient | `{ snapshot }` (broadcast til hele rommet) |
| `draw:new` | Server → Klient | `{ number, snapshot }` |

### Ack-respons format

```json
{
  "ok": true,
  "data": { "roomCode": "ABC123", "playerId": "uuid", "snapshot": {...} },
  "error": null
}
```

Feil:
```json
{
  "ok": false,
  "data": null,
  "error": { "code": "ROOM_NOT_FOUND", "message": "Rommet finnes ikke" }
}
```

---

## Spilltilstander og rundeflyt

### Tilstandsmaskin

```
    ┌──────┐
    │ NONE │ (ledig, ingen aktiv runde)
    └──┬───┘
       │ room:create / room:join
       ▼
  ┌─────────┐
  │ WAITING │ (venter på spillere / scheduler)
  └────┬────┘
       │ game:start (manuelt eller auto-scheduler)
       ▼
  ┌─────────┐
  │ RUNNING │ (baller trekkes, spillere markerer)
  │         │ ← draw:next (trekk ball)
  │         │ ← ticket:mark (marker tall)
  │         │ ← claim:submit (krev gevinst)
  └────┬────┘
       │ Alle claims avgjort / game:end
       ▼
  ┌────────┐
  │ ENDED  │ (runde ferdig, beregner vinnere)
  └────┬───┘
       │
       ▼
  ┌─────────┐
  │ CLEANUP │ (klargjør neste runde)
  └────┬────┘
       │ (loop til WAITING eller avslutt)
       ▼
    ┌──────┐
    │ NONE │
    └──────┘
```

### Claim-typer

| Type | Beskrivelse |
|------|-------------|
| `ONE_LINE` | En komplett linje |
| `TWO_LINE` | To komplette linjer |
| `BINGO` | Full plate (alle tall) |

### Scheduler-modus

Candy støtter automatisk rundestart via scheduler:

```
AUTO_ROUND_START_ENABLED=true
AUTO_ROUND_START_INTERVAL_MS=180000     # Ny runde hvert 3. minutt
AUTO_ROUND_MIN_PLAYERS=1                # Minimum 1 spiller
AUTO_ROUND_TICKETS_PER_PLAYER=4         # 4 billetter per spiller
AUTO_DRAW_ENABLED=true                  # Auto-trekk baller
AUTO_DRAW_INTERVAL_MS=1200              # Trekk ball hvert 1.2 sekund
```

---

## Webhooks

### Spillresultat-webhook

Etter hver runde sender backend resultater til providers webhook:

```http
POST {provider.webhookUrl}
Content-Type: application/json

{
  "event": "game.completed",
  "gameId": "uuid",
  "sessionId": "session-uuid",
  "playerId": "providers-spiller-id",
  "timestamp": "2024-03-05T14:30:00Z",
  "result": {
    "entryFee": 100,
    "totalPayout": 500,
    "netResult": 400,
    "currency": "NOK",
    "ticketsPlayed": 2,
    "numbersDrawn": 45,
    "patterns": ["Line", "FullHouse"]
  },
  "signature": "hmac-sha256-hex-string"
}
```

### Signaturverifisering

Provideren bør verifisere webhook-signaturen:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, secret) {
  const { signature, ...data } = payload;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest('hex');
  return signature === expected;
}
```

### Pålitelighet

- Retries med eksponentiell backoff (opptil 5 forsøk)
- Maks forsinkelse: 16 sekunder
- Leveringslogg for admin-inspeksjon

---

## Auto-play scheduler

Candy Mania-scheduleren kjører automatiske runder uten manuell intervensjon.

### Konfigurasjon

| Variabel | Standard | Beskrivelse |
|----------|---------|-------------|
| `AUTO_ROUND_START_ENABLED` | true | Aktiver auto-start |
| `AUTO_ROUND_START_INTERVAL_MS` | 180000 | Intervall mellom runder (3 min) |
| `AUTO_ROUND_MIN_PLAYERS` | 1 | Minimum spillere for å starte |
| `AUTO_ROUND_TICKETS_PER_PLAYER` | 4 | Billetter per spiller |
| `AUTO_ROUND_ENTRY_FEE` | 0 | Innskudd per runde |
| `AUTO_DRAW_ENABLED` | true | Auto-trekk baller |
| `AUTO_DRAW_INTERVAL_MS` | 1200 | Intervall mellom baller (1.2s) |
| `CANDY_PAYOUT_PERCENT` | 100 | RTP (Return To Player) 0-100% |
| `CANDY_SINGLE_ACTIVE_ROOM_PER_HALL` | true | Kun ett rom per hall |

### Produksjonsvern

I produksjon er auto-play deaktivert med mindre:
```bash
BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true
```

### Admin-kontroll

Admin-panelet gir operatører kontroll via:
- `GET /api/admin/candy-mania/settings` - Hent scheduler-innstillinger
- `PUT /api/admin/candy-mania/settings` - Oppdater (med optional `effectiveFrom`)

---

## Sikkerhetsmodell

### Autentiseringslag

| Lag | Mekanisme |
|-----|-----------|
| **Provider → Backend** | API-nøkkel (X-API-Key header) |
| **Launch token** | Engangs, tidsbegrenset, server-side lagring |
| **Spiller → Backend** | Access token (Bearer) i alle requests |
| **Webhook** | HMAC-SHA256 signatur |
| **Iframe** | CSP frame-ancestors + CORS |

### CORS & Embedding

```bash
# Tillatte origins for iframe-embedding
ALLOWED_EMBED_ORIGINS=https://provider1.com,https://provider2.com
CORS_ALLOWED_ORIGINS=https://provider1.com,https://provider2.com
```

Backend setter `Content-Security-Policy: frame-ancestors` header basert på `ALLOWED_EMBED_ORIGINS`.

### Sesjonshåndtering

Tredjepart kan kontrollere spillersesjoner:
- `POST /api/integration/session/refresh` - Forleng sesjon (standard: 60 min)
- `POST /api/integration/session/kill` - Tving utlogging

---

## Konfigurering

### Miljøvariabler for tredjeparts-integrasjon

```bash
# Aktiver integrasjon
INTEGRATION_ENABLED=true

# Wallet-provider må være external
WALLET_PROVIDER=external

# Providers wallet-API
WALLET_API_BASE_URL=https://provider.example.com/api/wallet
WALLET_API_KEY=bearer_token_or_api_key
WALLET_API_TIMEOUT_MS=5000

# CORS og embedding
ALLOWED_EMBED_ORIGINS=https://provider.example.com
CORS_ALLOWED_ORIGINS=https://provider.example.com

# Webhooks
INTEGRATION_WEBHOOK_URL=https://provider.example.com/webhook/games
INTEGRATION_COMPLIANCE_WEBHOOK_URL=https://provider.example.com/webhook/compliance
INTEGRATION_WEBHOOK_SECRET=shared-hmac-secret

# API-autentisering
INTEGRATION_API_KEY=provider-api-key

# Candy-URLer
INTEGRATION_CANDY_API_BASE_URL=https://candy-backend.example.com
INTEGRATION_CANDY_FRONTEND_URL=https://candy-frontend.example.com

# Launch tokens
CANDY_LAUNCH_TOKEN_TTL_SECONDS=120
```

### Providers implementeringssjekkliste

For at en tredjepart skal integrere Candy:

1. **Implementer wallet-API**
   - `GET /balance` - Hent spillers saldo
   - `POST /debit` - Trekk penger ved spillstart
   - `POST /credit` - Legg til gevinst

2. **Implementer webhook-mottaker**
   - Motta `game.completed` hendelser
   - Verifiser HMAC-signatur
   - Oppdater intern spillerhistorikk

3. **Implementer launch-kall**
   - `POST /api/integration/launch` med API-nøkkel
   - Vis returnert embed-URL i iframe

4. **Konfigurer iframe**
   ```html
   <iframe
     src="https://candy.example.com/?lt=TOKEN"
     allow="autoplay; fullscreen"
     style="width: 100%; height: 100%; border: none;"
   ></iframe>
   ```

---

## API-referanse

### Launch

#### Opprett launch-sesjon (tredjepart)

```http
POST /api/integration/launch
X-API-Key: provider-api-key
Content-Type: application/json

{
  "sessionToken": "providers-sesjonsbevis",
  "playerId": "providers-spiller-id",
  "currency": "NOK",
  "language": "nb-NO",
  "returnUrl": "https://provider.com/game"
}

Response 200:
{
  "ok": true,
  "data": {
    "embedUrl": "https://candy.example.com/?lt=base64-token&embed=true",
    "launchToken": "base64-token",
    "expiresAt": "2024-03-05T14:32:00Z"
  }
}
```

#### Opprett launch-token (eget system)

```http
POST /api/games/candy/launch-token
Authorization: Bearer access-token
Content-Type: application/json

{
  "hallId": "optional-hall-id"
}

Response 200:
{
  "ok": true,
  "data": {
    "launchToken": "base64-token",
    "launchUrl": "https://candy.example.com",
    "issuedAt": 1709654400000,
    "expiresAt": 1709654520000
  }
}
```

#### Resolve launch-token

```http
POST /api/games/candy/launch-resolve
Content-Type: application/json

{
  "launchToken": "base64-token"
}

Response 200:
{
  "ok": true,
  "data": {
    "accessToken": "intern-sesjon-token",
    "hallId": "hall-123",
    "playerName": "Player-ABC",
    "walletId": "wallet-ext-uuid",
    "apiBaseUrl": "https://backend.example.com"
  }
}
```

### Sesjonshåndtering

#### Forleng sesjon

```http
POST /api/integration/session/refresh
X-API-Key: provider-api-key
Content-Type: application/json

{
  "playerId": "providers-spiller-id"
}
```

#### Avslutt sesjon

```http
POST /api/integration/session/kill
X-API-Key: provider-api-key
Content-Type: application/json

{
  "playerId": "providers-spiller-id"
}
```

---

## Feilsøking

### Vanlige problemer

| Problem | Årsak | Løsning |
|---------|-------|---------|
| Launch-token utløpt | TTL for kort | Øk `CANDY_LAUNCH_TOKEN_TTL_SECONDS` |
| CORS-feil i iframe | Manglende origin | Legg til origin i `CORS_ALLOWED_ORIGINS` og `ALLOWED_EMBED_ORIGINS` |
| Wallet debit feiler | Provider API nede | Sjekk circuit breaker-status i admin |
| Webhook mottas ikke | Feil URL / signatur | Sjekk `INTEGRATION_WEBHOOK_URL` og `INTEGRATION_WEBHOOK_SECRET` |
| Socket.IO frakobling | Nettverksproblemer | Auto-reconnect med 2s delay er innebygd |
| Spiller kan ikke starte | Compliance-grense nådd | Sjekk daglig/månedlig tapsgrense |

### Debug-logging

**Candy Unity-klient:**
```csharp
// BingoRealtimeClient.cs
verboseLogging = true;  // Logger alle socket-pakker

// APIManager.cs
logBootstrapEvents = true;  // Logger rom- og spillhendelser
```

**Backend:**
```bash
NODE_ENV=development  # Aktiverer detaljert logging
```

### Helsesjekk

```http
GET /api/integration/health
X-API-Key: provider-api-key

Response 200:
{
  "ok": true,
  "data": {
    "status": "healthy",
    "walletAdapter": "external",
    "activeRooms": 3,
    "activeSessions": 12
  }
}
```
