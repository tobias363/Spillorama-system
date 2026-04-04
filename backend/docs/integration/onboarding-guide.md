# CandyWeb — Leverandor-onboarding

Denne guiden beskriver steg-for-steg hvordan en ny leverandor integrerer CandyWeb i sin plattform.

**Mal: Fra "vi vil ha CandyWeb" til live pa under 1 uke.**

---

## 1. Forutsetninger

Leverandoren ma ha:

- [ ] Et bruker/wallet-system med REST API (balance, debit, credit)
- [ ] En webplattform som kan laste iframes
- [ ] HTTPS-domene (kreves for iframe-embedding)
- [ ] Mulighet til a motta webhooks (HTTPS endpoint)

---

## 2. Konfigurasjonspakke fra oss

Vi sender leverandoren:

| Element | Beskrivelse |
|---------|-------------|
| API-nokkel | `X-API-Key` for launch-endepunktet |
| Webhook-secret | HMAC-SHA256 secret for a verifisere webhooks |
| OpenAPI-spec | `openapi.yaml` — komplett API-kontrakt |
| Sandbox-URL | Staging-miljo for testing |

---

## 3. Steg-for-steg oppsett

### Steg 1: Wallet API

Leverandoren implementerer tre endepunkter:

```
GET  /balance?playerId={id}
POST /debit   { playerId, amount, transactionId, roundId, currency }
POST /credit  { playerId, amount, transactionId, roundId, currency }
```

**Kritisk:**
- `transactionId` er idempotent — samme ID skal aldri gi dobbel debitering
- Credit-endepunktet ma handtere `DUPLICATE_TRANSACTION` gracefully
- Svar-format: `{ success, balance, transactionId, errorCode?, errorMessage? }`

### Steg 2: Konfigurer miljovaribler

Vi setter disse pa candy-backend:

```env
INTEGRATION_ENABLED=true
WALLET_PROVIDER=external
WALLET_API_BASE_URL=https://leverandor.example.com/api/wallet
WALLET_API_KEY=<leverandorens-api-nokkel>
WALLET_API_TIMEOUT_MS=5000
ALLOWED_EMBED_ORIGINS=https://leverandor.example.com
CORS_ALLOWED_ORIGINS=https://leverandor.example.com
INTEGRATION_WEBHOOK_URL=https://leverandor.example.com/webhooks/candy
INTEGRATION_WEBHOOK_SECRET=<delt-hmac-secret>
INTEGRATION_API_KEY=<var-api-nokkel-til-leverandor>
```

### Steg 3: Test launch-flyten

```bash
# 1. Kall launch-endepunktet
curl -X POST https://candy-backend.example.com/api/integration/launch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api-nokkel>" \
  -d '{
    "sessionToken": "leverandor-session-abc123",
    "playerId": "player-42",
    "currency": "NOK",
    "language": "nb-NO",
    "returnUrl": "https://leverandor.example.com/lobby"
  }'

# Svar:
# {
#   "embedUrl": "https://candy.example.com?lt=abc123&embed=true",
#   "launchToken": "abc123",
#   "expiresAt": "2026-04-02T12:05:00.000Z"
# }

# 2. Last embedUrl i en iframe
# <iframe src="{embedUrl}" allow="autoplay"></iframe>
```

### Steg 4: Implementer iframe-wrapper

```html
<div id="candy-overlay" style="position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center;">
  <button onclick="closeCandyGame()">Lukk</button>
  <iframe id="candy-frame" src="{embedUrl}" style="width:96%; max-width:1400px; height:90vh; border:none;" allow="autoplay"></iframe>
</div>

<script>
// Lytt pa meldinger fra CandyWeb
window.addEventListener('message', function(event) {
  if (!event.data || !event.data.type) return;

  switch (event.data.type) {
    case 'candy:ready':
      console.log('CandyWeb er klar');
      break;
    case 'candy:balanceChanged':
      console.log('Ny saldo:', event.data.payload.balance);
      break;
    case 'candy:gameEnded':
      console.log('Spill ferdig:', event.data.payload);
      break;
    case 'candy:error':
      console.error('Feil:', event.data.payload);
      break;
  }
});

function closeCandyGame() {
  var iframe = document.getElementById('candy-frame');
  iframe.contentWindow.postMessage({ type: 'host:closeGame', payload: {} }, '*');
  setTimeout(function() {
    document.getElementById('candy-overlay').style.display = 'none';
    iframe.src = '';
  }, 300);
}
</script>
```

### Steg 5: Implementer webhook-mottaker

```javascript
// Eksempel: Express webhook-handler
app.post('/webhooks/candy', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const body = JSON.stringify(req.body);

  // Verifiser HMAC-SHA256 signatur
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(body).digest('hex');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, playerId, result } = req.body;

  if (event === 'game.completed') {
    console.log(`Spiller ${playerId}: innsats ${result.entryFee}, gevinst ${result.totalPayout}`);
  }

  res.status(200).json({ received: true });
});
```

### Steg 6: Compliance-callbacks

CandyWeb sender compliance-hendelser til webhook-URL:

| Event | Beskrivelse |
|-------|-------------|
| `compliance.lossLimitReached` | Spiller har natt daglig/manedlig tapsgrense |
| `compliance.sessionLimitReached` | Spillokt har vart for lenge |
| `compliance.selfExclusion` | Spiller har selvekskludert seg |
| `compliance.timedPause` | Obligatorisk pause utlost |
| `compliance.breakEnded` | Pause er over, spiller kan fortsette |

---

## 4. Go-live sjekkliste

- [ ] Wallet API (balance, debit, credit) fungerer og er idempotent
- [ ] Launch-flyt testet: launch -> iframe -> spill -> lukk
- [ ] PostMessage-kommunikasjon fungerer (candy:ready, host:closeGame)
- [ ] Webhook-mottak verifisert med HMAC-signatur
- [ ] Compliance-callbacks handteres (tapsgrense, selvekskludering)
- [ ] CORS/CSP konfigurert korrekt (ingen console-feil)
- [ ] Responsivt pa mobil/tablet
- [ ] Reconciliation-rapport kjort uten avvik
- [ ] Feilhandtering: hva skjer ved wallet-timeout? Credit-feil?
- [ ] Produksjons-URL og API-nokler byttet fra staging

---

## 5. Feilsokingsguide

| Problem | Losning |
|---------|---------|
| Iframe laster ikke | Sjekk `ALLOWED_EMBED_ORIGINS` og CORS i browser console |
| Launch-token ugyldig | Token har 2-minutters levetid — embed iframe umiddelbart |
| Wallet timeout | Sjekk `WALLET_API_TIMEOUT_MS` og leverandorens responstid |
| Webhook ikke mottatt | Verifiser webhook-URL er tilgjengelig og HMAC-secret matcher |
| "INTEGRATION_DISABLED" | `INTEGRATION_ENABLED=true` er ikke satt |
| Dobbel debitering | Leverandorens API handterer ikke idempotency — fiks `transactionId`-sjekk |

---

## 6. Kontakt

| Rolle | Navn | Kontakt |
|-------|------|---------|
| Teknisk kontakt | Tobias Haugen | tobias@nordicprofil.no |
| API-spesifikasjon | Se `openapi.yaml` | |
| Arkitekturdokumentasjon | Se `ARCHITECTURE.md` | |
