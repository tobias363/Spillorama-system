# Render Environment Variables — Integrasjonsmodus

Sett disse i Render dashboard for candy-backend (eller candy-backend-staging).

## Candy-backend (produksjon)

```env
# Aktiver integrasjonslaget
INTEGRATION_ENABLED=true

# Wallet — ekstern leverandor
WALLET_PROVIDER=external
WALLET_API_BASE_URL=https://leverandor.example.com/api/wallet
WALLET_API_KEY=<leverandorens-api-nokkel>
WALLET_API_TIMEOUT_MS=5000

# Iframe-embedding — tillat bingo-system domenet
ALLOWED_EMBED_ORIGINS=https://bingo-system-jsso.onrender.com
CORS_ALLOWED_ORIGINS=https://bingo-system-jsso.onrender.com

# Webhooks — leverandorens callback-URL
INTEGRATION_WEBHOOK_URL=https://leverandor.example.com/webhooks/candy
INTEGRATION_WEBHOOK_SECRET=<delt-hmac-secret>
INTEGRATION_COMPLIANCE_WEBHOOK_URL=https://leverandor.example.com/webhooks/compliance

# Launch API
INTEGRATION_API_KEY=<var-api-nokkel-som-leverandor-sender>
INTEGRATION_DEFAULT_HALL_ID=hall-default
INTEGRATION_CANDY_FRONTEND_URL=https://candy-backend-ldvg.onrender.com/candy
INTEGRATION_CANDY_API_BASE_URL=https://candy-backend-ldvg.onrender.com
```

## Bingo-system

```env
# Legg til candy-backend i tillatte origins (kommaseparert)
ALLOWED_ORIGINS=https://candy-backend-ldvg.onrender.com
```

## Kjor seed-script etter deploy

```bash
# Fra bingo-system-prosjektet
MONGO_URI=<mongodb-connection-string> node scripts/seed-candy-mania.js
```
