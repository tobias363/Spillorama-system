# Multiplayer Databingo (MVP)

Dette er et startpunkt for en tradisjonell multiplayer-bingo med server-autoritativ logikk.

## Hva som er implementert

- Egen backend (`backend/`) med `Express + Socket.IO + TypeScript`.
- Romflyt: opprett rom, join rom, start spill.
- Spillflyt: trekk tall, markér tall, claim linje/bingo, avslutt runde.
- Automatisk rundestart per rom (konfigurerbart intervall, default 30 sek).
- Opptil 5 bonger per spiller støttes (`ticketsPerPlayer` 1-5).
- Sperre mot parallell deltakelse: samme wallet kan ikke spille i to aktive runder samtidig.
- Minst 30 sekunder mellom spillstarter håndheves også ved manuell `game:start`.
- Tapsgrenser håndheves per wallet før buy-in (default `900`/dag og `4400`/måned).
- Personlige tapsgrenser kan settes (må være innenfor regulatorisk maksimum).
- Obligatorisk pause håndheves: etter 1 time samlet spilltid kreves 5 minutters pause før ny runde.
- Server-side validering av trekk/markering/claim.
- Innlogging med sesjonstoken (register/login/logout/me) lagret i Postgres.
- Spillkatalog i backend (`app_games`) med admin-endepunkt for å styre innstillinger per spill.
- Candy seedes som første spill i katalogen (`sortOrder=1`), Bingo som nr. 2.
- Egen wallet-funksjonalitet med persistent ledger på disk (`FileWalletAdapter`):
  - kontoopprettelse
  - saldo
  - top-up / uttak
  - transfer mellom wallets
  - transaksjonshistorikk
- Wallet kan byttes til ekstern API via `HttpWalletAdapter` (env-styrt `WALLET_PROVIDER=http`).
- Buy-in og premieutbetaling går via wallet-adapter.
- Innlogget wallet-flyt:
  - `GET /api/wallet/me`
  - `POST /api/wallet/me/topup` (manuell/simulert top-up)
  - `POST /api/payments/swedbank/topup-intent` (opprett betaling hos Swedbank)
  - `POST /api/payments/swedbank/confirm` (avstem og krediter hvis betalt)
  - `POST /api/payments/swedbank/callback` (Swedbank callback/webhook)
- Spillhistorikk (`gameHistory`) per rom.
- Integrasjonspunkt for eksisterende bingosystem (`BingoSystemAdapter`).
- Enkel webklient for testing (`frontend/`) servert av backend.

## Kom i gang

```bash
npm --prefix backend install
WALLET_PROVIDER=postgres \
WALLET_PG_CONNECTION_STRING='postgres://bingo_app:bytt-til-sterkt-passord@localhost:5432/bingo' \
WALLET_PG_SCHEMA=public \
WALLET_PG_SSL=false \
APP_PG_CONNECTION_STRING='postgres://bingo_app:bytt-til-sterkt-passord@localhost:5432/bingo' \
APP_PG_SCHEMA=public \
# Swedbank test-oppsett (sett egne verdier):
SWEDBANK_PAY_ACCESS_TOKEN='bytt-til-token' \
SWEDBANK_PAY_PAYEE_ID='bytt-til-payee-id' \
SWEDBANK_PAY_MERCHANT_BASE_URL='https://din-offentlige-url.no/' \
npm run dev
```

Åpne deretter:

- [http://localhost:4000](http://localhost:4000)
- Health-check: [http://localhost:4000/health](http://localhost:4000/health)

## Automatisk rundestart (hver 30. sekund)

Backenden støtter nå automatisk rundestart per rom.
Default er aktivert med intervall på `30000ms` (30 sekunder).
Serveren håndhever minimum `30000ms`, selv om env settes lavere.
Samme minimum brukes også i spillmotoren for manuell start (`game:start`).

Merk: For norsk databingo kan regelverket kreve lengre intervall (typisk minst 30 sekunder per spill).
Avklar alltid endelig oppsett med Lotteritilsynet før produksjon.

Miljøvariabler:

```bash
BINGO_MIN_ROUND_INTERVAL_MS=30000
BINGO_DAILY_LOSS_LIMIT=900
BINGO_MONTHLY_LOSS_LIMIT=4400
BINGO_PLAY_SESSION_LIMIT_MS=3600000
BINGO_PAUSE_DURATION_MS=300000

AUTO_ROUND_START_ENABLED=true
AUTO_ROUND_START_INTERVAL_MS=30000
AUTO_ROUND_MIN_PLAYERS=2
AUTO_ROUND_TICKETS_PER_PLAYER=4
AUTO_ROUND_ENTRY_FEE=0
```

Automatisk trekking (serveren trekker tall uten host-klikk):

```bash
AUTO_DRAW_ENABLED=true
AUTO_DRAW_INTERVAL_MS=1200
AUTO_ROUND_SCHEDULER_TICK_MS=250
```

## Hvordan koble dette mot eksisterende system

Backenden er laget for å kjøre separat og kobles på deres bingosystem/wallet senere.

## Wallet provider-oppsett

Backenden støtter tre wallet-providere:

- `file` (default): lokal persistent ledger i `backend/data/wallets.json`
- `http`: ekstern wallet-API
- `postgres`: intern wallet-ledger i Postgres (anbefalt for produksjon)

Kopier `backend/.env.example` til `.env` (eller sett env i runtime).

### Eksempel: lokal wallet

```bash
WALLET_PROVIDER=file
WALLET_DATA_PATH=backend/data/wallets.json
WALLET_DEFAULT_INITIAL_BALANCE=1000
```

### Eksempel: ekstern wallet-API

```bash
WALLET_PROVIDER=http
WALLET_API_BASE_URL=https://wallet.example.com
WALLET_API_PREFIX=/api
WALLET_API_KEY=replace-me
WALLET_API_TIMEOUT_MS=8000
WALLET_DEFAULT_INITIAL_BALANCE=1000
```

### Eksempel: Postgres wallet-ledger

```bash
WALLET_PROVIDER=postgres
WALLET_PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/bingo
WALLET_PG_SCHEMA=public
WALLET_PG_SSL=false
WALLET_DEFAULT_INITIAL_BALANCE=1000

# Plattform/auth (sessions + game catalog)
APP_PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/bingo
APP_PG_SCHEMA=public
AUTH_SESSION_TTL_HOURS=168
```

## Swedbank Pay-oppsett

Swedbank-integrasjonen bruker Checkout v3.1 med denne flyten:

1. `POST /api/payments/swedbank/topup-intent` oppretter payment order hos Swedbank.
2. Frontend sender spiller til `redirect-checkout`.
3. Swedbank kaller `POST /api/payments/swedbank/callback`.
4. Backend avstemmer status mot Swedbank API og krediterer wallet én gang når status er betalt.

Nødvendige env:

```bash
SWEDBANK_PAY_API_BASE_URL=https://api.externalintegration.payex.com
SWEDBANK_PAY_ACCESS_TOKEN=
SWEDBANK_PAY_PAYEE_ID=
SWEDBANK_PAY_MERCHANT_BASE_URL=https://din-offentlige-url.no/
```

Valgfrie overrides:

```bash
SWEDBANK_PAY_CALLBACK_URL=
SWEDBANK_PAY_COMPLETE_URL=
SWEDBANK_PAY_CANCEL_URL=
SWEDBANK_PAY_TERMS_URL=
SWEDBANK_PAY_CURRENCY=NOK
SWEDBANK_PAY_LANGUAGE=nb-NO
SWEDBANK_PAY_PRODUCT_NAME=Checkout3
SWEDBANK_PAY_REQUEST_TIMEOUT_MS=10000
```

Merk: Swedbank callback må nå backend fra internett. I lokal utvikling må du bruke offentlig tunnel (f.eks. `ngrok`) eller testmiljø med offentlig URL.

Postgres-adapteren oppretter schema/tabeller automatisk ved oppstart:

- `wallet_accounts`
- `wallet_transactions`
- `wallet_entries`

Systemkontoer (for dobbel bokføring) opprettes automatisk:

- `__system_house__`
- `__system_external_cash__`

### Forventet wallet-API kontrakt (`HttpWalletAdapter`)

Adapteren forventer disse endpointene på `${WALLET_API_BASE_URL}${WALLET_API_PREFIX}`:

- `POST /wallets`
- `GET /wallets`
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/transactions?limit=100`
- `POST /wallets/:walletId/debit`
- `POST /wallets/:walletId/credit`
- `POST /wallets/:walletId/topup`
- `POST /wallets/:walletId/withdraw`
- `POST /wallets/transfer`

Respons kan være enten:

- direkte payload
- eller envelope: `{ "ok": true, "data": ... }`

### 1) Bytt `BingoSystemAdapter`

Fil: `backend/src/adapters/BingoSystemAdapter.ts`

Lag en ny adapter som:

- henter/genererer billetter fra eksisterende system
- logger trekk til eksisterende system
- logger claim-resultater

Koble adapteren inn i `backend/src/index.ts` der `BingoEngine` opprettes.

### 2) Bytt `WalletAdapter`

Fil: `backend/src/adapters/WalletAdapter.ts`

Lag en adapter som peker mot:

- ekstern lommeboktjeneste (API/ledger)
- eller intern wallet dere bygger selv (f.eks. `PostgresWalletAdapter`)

Valg av adapter gjøres nå i `backend/src/adapters/createWalletAdapter.ts` via env.

### 3) Spillmotoren beholdes

`backend/src/game/BingoEngine.ts` er kjerne for regler og realtime state.
Adapterne gjør at dere kan integrere uten å skrive om spillreglene.

## Viktige API-er (MVP)

### Auth / Portal

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/games`
- `GET /api/admin/games` (admin)
- `PUT /api/admin/games/:slug` (admin)

### Wallet (innlogget bruker)

- `GET /api/wallet/me`
- `GET /api/wallet/me/compliance`
- `PUT /api/wallet/me/loss-limits`
- `POST /api/wallet/me/topup`
- `POST /api/payments/swedbank/topup-intent`
- `POST /api/payments/swedbank/confirm`
- `GET /api/payments/swedbank/intents/:intentId?refresh=true|false`
- `POST /api/payments/swedbank/callback`

### Wallet compliance (admin)

- `GET /api/admin/wallets/:walletId/compliance`
- `PUT /api/admin/wallets/:walletId/loss-limits`

### Spill/rom

- `GET /api/rooms`
- `GET /api/rooms/:roomCode`
- `POST /api/rooms/:roomCode/game/end`

### Wallet

- `POST /api/wallets`
- `GET /api/wallets`
- `GET /api/wallets/:walletId`
- `GET /api/wallets/:walletId/transactions?limit=100`
- `POST /api/wallets/:walletId/topup`
- `POST /api/wallets/:walletId/withdraw`
- `POST /api/wallets/transfer`

Når `WALLET_PROVIDER=http` fungerer disse endpointene som et backend-lag over ekstern wallet-adapter.

## Socket-events (MVP)

- `room:create`
- `room:join`
- `room:resume`
- `game:start`
- `game:end`
- `draw:next`
- `ticket:mark`
- `claim:submit`
- `room:state`

`room:create`/`room:join` støtter også `accessToken` i payload for å bruke innlogget bruker + wallet.

## Neste naturlige steg

- autentisering (JWT/session) i websocket-events
- Redis for delt realtime state (hvis flere server-instanser)
- Postgres for historikk/audit/oppgjør
- strengere tilgangskontroll (spillere skal kun se eget brett hvis ønskelig)
