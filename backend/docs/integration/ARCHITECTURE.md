# CandyWeb Integration Layer — Architecture

## 1. Overview

The integration layer lets an external provider embed CandyWeb in an iframe
while the provider retains ownership of the player wallet. All game logic,
RTP control, and compliance run on the CandyWeb backend — the provider only
needs to supply three wallet endpoints (balance, debit, credit) and an iframe.

## 2. Component diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Provider platform (parent page)                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  CandyWeb iframe  (React client, embed mode)          │  │
│  │  - Detects ?embed=true, hides standalone UI           │  │
│  │  - PostMessage ↔ parent (candy:ready, host:close…)    │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │ Socket.IO + REST                │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│  CandyWeb Backend                                             │
│                                                               │
│  ┌─────────────────────┐  ┌──────────────────────────┐        │
│  │ IntegrationLaunch    │  │ BingoEngine              │        │
│  │ Handler              │  │ (unchanged game logic)   │        │
│  │                      │  │                          │        │
│  │ POST /api/integration│  │ Uses WalletAdapter for   │        │
│  │      /launch         │  │ debit/credit/transfer    │        │
│  └──────────┬───────────┘  └────────────┬─────────────┘        │
│             │                           │                      │
│             ▼                           ▼                      │
│  ┌─────────────────────┐  ┌──────────────────────────┐        │
│  │ IntegrationAuth      │  │ ExternalWalletAdapter    │        │
│  │ Bridge               │  │ (NEW — implements        │        │
│  │                      │  │  WalletAdapter interface) │        │
│  │ - Validates provider │  │                          │        │
│  │   session token      │  │ - Calls provider's       │        │
│  │ - Maps external →    │  │   balance/debit/credit   │        │
│  │   internal player    │  │ - Idempotency via txn ID │        │
│  │ - Issues launch token│  │ - Circuit breaker        │        │
│  └──────────────────────┘  │ - Timeout handling       │        │
│                            └────────────┬─────────────┘        │
│  ┌─────────────────────┐               │                      │
│  │ WebhookService       │               │                      │
│  │                      │               │                      │
│  │ - Sends game results │               │                      │
│  │   via HMAC-signed    │               │                      │
│  │   POST to provider   │               │                      │
│  │ - Retry + dead letter│               │                      │
│  └──────────────────────┘               │                      │
└─────────────────────────────────────────┼──────────────────────┘
                                          │ HTTP (REST)
                                          ▼
                            ┌──────────────────────────┐
                            │  Provider Wallet API      │
                            │                          │
                            │  GET  /api/wallet/balance│
                            │  POST /api/wallet/debit  │
                            │  POST /api/wallet/credit │
                            └──────────────────────────┘
```

## 3. New components

### 3.1 ExternalWalletAdapter

**File:** `src/integration/ExternalWalletAdapter.ts`

Implements the existing `WalletAdapter` interface from
`src/adapters/WalletAdapter.ts`. This means **BingoEngine requires zero
changes** — it calls `walletAdapter.transfer()` as before, and the new
adapter translates those calls into HTTP requests to the provider.

**Key behaviours:**

| WalletAdapter method | Provider API call | Notes |
|---|---|---|
| `getBalance(accountId)` | `GET /balance?playerId=X` | Maps accountId to external playerId via session |
| `debit(accountId, amount, reason)` | `POST /debit` | Generates unique transactionId for idempotency |
| `credit(accountId, amount, reason)` | `POST /credit` | Generates unique transactionId |
| `transfer(from, to, amount, reason)` | `POST /debit` + balance update | Debit from player; house account is virtual |
| `createAccount` / `ensureAccount` | No-op | Accounts exist on provider side |
| `topUp` / `withdraw` | Not supported | Throws — provider manages deposits/withdrawals |
| `listTransactions` | Returns local log | We log all transactions locally for reconciliation |

**Error handling:**
- HTTP timeout → `WalletError("WALLET_TIMEOUT")`
- 402 / INSUFFICIENT_FUNDS → `WalletError("INSUFFICIENT_FUNDS")`
- 5xx / network error → circuit breaker opens after 5 consecutive failures
- Circuit breaker auto-resets after 30 seconds

**Activation:** `WALLET_PROVIDER=external` in env → `createWalletAdapter()`
returns an `ExternalWalletAdapter` instance.

### 3.2 IntegrationAuthBridge

**File:** `src/integration/IntegrationAuthBridge.ts`

Handles the launch flow when a provider sends a player to CandyWeb.

**Flow:**

```
Provider                    CandyWeb Backend
   │                              │
   │  POST /api/integration/launch│
   │  { sessionToken, playerId }  │
   │─────────────────────────────►│
   │                              │ 1. Validate API key (X-API-Key header)
   │                              │ 2. Look up provider config
   │                              │ 3. Validate sessionToken against provider
   │                              │    (optional: call provider's auth endpoint)
   │                              │ 4. Find or create ExternalPlayerMapping
   │                              │ 5. Create internal player + wallet account
   │                              │ 6. Issue CandyWeb accessToken (JWT)
   │                              │ 7. Issue launch token via CandyLaunchTokenStore
   │                              │ 8. Build embed URL with launch token
   │                              │
   │  { embedUrl, launchToken,    │
   │    expiresAt }               │
   │◄─────────────────────────────│
   │                              │
   │  Load embedUrl in iframe     │
   │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ►│
   │                              │ Frontend resolves launch token
   │                              │ (existing /api/games/candy/launch-resolve)
```

**Player mapping table:** `external_player_mapping`

| Column | Type | Description |
|---|---|---|
| provider | varchar | Provider slug |
| external_player_id | varchar | Provider's player ID |
| internal_player_id | varchar | Our player ID |
| internal_wallet_id | varchar | Our wallet account ID |
| created_at | timestamp | First mapping |
| last_seen_at | timestamp | Last launch |

Primary key: `(provider, external_player_id)`

### 3.3 WebhookService

**File:** `src/integration/WebhookService.ts`

Sends game result callbacks to the provider after each completed round.
Hooks into `BingoSystemAdapter.onClaimLogged()` for BINGO claims (game end)
and listens for game-end events.

**Webhook delivery:**
1. Serialize payload as JSON
2. Compute HMAC-SHA256 signature: `HMAC(webhookSecret, payloadJson)`
3. POST to provider's webhook URL with `X-Webhook-Signature` header
4. On failure: retry with exponential backoff (1s, 2s, 4s, 8s, 16s)
5. After 5 failed attempts: log to dead letter queue (local file or DB)

### 3.4 IntegrationLaunchHandler

**File:** `src/integration/IntegrationLaunchHandler.ts`

Express route handler for `POST /api/integration/launch`. Orchestrates
the IntegrationAuthBridge and returns the embed URL.

## 4. Data flow: complete game round

```
1. Provider calls POST /api/integration/launch
   → IntegrationAuthBridge validates, maps player, issues launch token
   → Returns embed URL

2. Provider loads embed URL in iframe
   → CandyWeb frontend resolves launch token (existing flow)
   → Frontend connects via Socket.IO with accessToken

3. Player arms bet (socket: bet:arm)
   → No wallet action yet

4. Game starts (socket: game:start)
   → BingoEngine.startGame() calls walletAdapter.transfer(player → house)
   → ExternalWalletAdapter translates to POST /debit on provider API
   → Provider deducts entry fee from player balance
   → If INSUFFICIENT_FUNDS → game start aborted, player notified

5. Numbers drawn (socket: draw:next)
   → No wallet action

6. Player submits claim (socket: claim:submit)
   → BingoEngine.submitClaim() validates pattern
   → If valid LINE: walletAdapter.transfer(house → player)
     → ExternalWalletAdapter translates to POST /credit on provider API
   → If valid BINGO: same, plus game ends

7. Game ends
   → WebhookService sends GameResultWebhook to provider
   → Frontend sends candy:gameEnded PostMessage to parent
   → ExternalWalletAdapter fetches fresh balance from provider
   → Frontend updates displayed balance

8. Session ends
   → Frontend sends candy:ready with status=closed
   → Backend cleans up integration session
```

## 5. Error handling strategy

| Scenario | Handling |
|---|---|
| Provider wallet API timeout | Configurable timeout (default 5s). WalletError thrown. Game start aborted or credit retried. |
| Provider wallet API 5xx | Circuit breaker: 5 consecutive failures → breaker opens for 30s. During open: immediate WalletError. |
| Debit fails (insufficient funds) | Game start aborted. Player notified via socket ack. No retry. |
| Credit fails (payout) | Retry with exponential backoff (up to 5 attempts). Log to reconciliation table. Alert on persistent failure. |
| Provider session expired mid-game | Auto-play completes current round. Payout credited. Session marked expired. Frontend shows session-expired message. |
| Webhook delivery failure | Retry 5x with exponential backoff. Dead letter queue after exhaustion. Daily reconciliation job checks for gaps. |
| Network partition | Socket.IO reconnection handles frontend. Backend wallet calls use circuit breaker. |

## 6. Environment configuration

```env
# Activation
INTEGRATION_ENABLED=true
WALLET_PROVIDER=external

# Provider wallet API
WALLET_API_BASE_URL=https://provider.example.com/api/wallet
WALLET_API_KEY=<api-key-from-provider>
WALLET_API_TIMEOUT_MS=5000

# Iframe / embed
ALLOWED_EMBED_ORIGINS=https://provider.example.com,https://m.provider.example.com
CORS_ALLOWED_ORIGINS=https://provider.example.com

# Webhooks
WEBHOOK_URL=https://provider.example.com/api/candy/webhook
WEBHOOK_SECRET=<shared-secret-for-hmac>

# Launch token
LAUNCH_TOKEN_SECRET=<secret-for-signing>
LAUNCH_TOKEN_EXPIRY_SECONDS=300
```

## 7. Multi-tenant support

The system supports multiple providers simultaneously. Each provider has
its own configuration block identified by a provider slug. When
`INTEGRATION_ENABLED=true`, the backend loads provider configs from
environment variables or a config file.

For a single provider, flat env vars suffice (as above). For multiple
providers, a JSON config file at `INTEGRATION_CONFIG_PATH` can define
an array of `IntegrationProvider` objects.

## 8. Security considerations

- **Launch tokens** are one-time use and expire in 5 minutes
- **API key validation** on all integration endpoints
- **CORS** restricted to configured provider origins
- **CSP frame-ancestors** set to provider domains only
- **PostMessage origin validation** on every message
- **HMAC-SHA256 webhook signatures** prevent tampering
- **Player ID from token** — socket events use the player ID from the
  validated JWT, not from the client payload (prevents spoofing)
- **No wallet credentials in frontend** — all provider API calls happen
  server-side
