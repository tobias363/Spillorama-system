# CandyMania — Env-sjekkliste for deploy

Candy-backend deployer fra `tobias363/bingosystem` via Render. Alle miljøvariabler
som styrer spilloppførsel må stå i **`render.yaml`** under `candy-backend`-tjenesten.
Hvis en variabel mangler der, faller backend tilbake til **code defaults** — som ofte
er feil for produksjon (f.eks. autoplay av, 3 min mellom runder).

> **Regel:** Hver gang du endrer en default-verdi i `backend/src/index.ts` eller
> legger til en ny env-variabel, **oppdater `render.yaml`** i samme PR.

---

## Hvor env-variabler bor

| Fil | Formål |
|-----|--------|
| `render.yaml` → `candy-backend` → `envVars` | **Produksjon** — Render leser herfra |
| `backend/.env` | Lokal utvikling |
| `backend/.env.example` | Dokumentasjon for nye utviklere |
| `backend/src/index.ts` | Code defaults (fallback når env mangler) |

Alle fire steder må holdes i synk.

---

## Sjekkliste — bruk ved hver deploy som endrer spillinnstillinger

### 1. Autoplay / timing

| Variabel | Prod-verdi | Code default | Kommentar |
|----------|-----------|--------------|-----------|
| `BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION` | `true` | `false` | **Må** være `true` for at autoplay fungerer i prod |
| `AUTO_ROUND_START_ENABLED` | `true` | `true` | Overstyrers til `false` hvis autoplay ikke er tillatt |
| `AUTO_ROUND_START_INTERVAL_MS` | `30000` | `180000` (3 min) | Sekunder mellom runder. `Math.max(MIN, denne)` |
| `AUTO_DRAW_ENABLED` | `true` | `true` | Overstyrers til `false` hvis autoplay ikke er tillatt |
| `AUTO_DRAW_INTERVAL_MS` | `1200` | `2500` | Millisekunder mellom hvert trukket tall |
| `BINGO_MIN_ROUND_INTERVAL_MS` | `30000` | `30000` | Absolutt minimumsintervall (floor) |
| `AUTO_ROUND_MIN_PLAYERS` | `1` | `1` | Minst antall spillere for å starte runde |
| `AUTO_ROUND_TICKETS_PER_PLAYER` | `4` | `4` | Bonger per spiller |
| `AUTO_ROUND_ENTRY_FEE` | `0` | `0` | Innsats per runde (0 = gratis) |

### 2. Compliance

| Variabel | Prod-verdi | Code default | Kommentar |
|----------|-----------|--------------|-----------|
| `BINGO_DAILY_LOSS_LIMIT` | `900` | `900` | Maks daglig tap (NOK) |
| `BINGO_MONTHLY_LOSS_LIMIT` | `4400` | `4400` | Maks månedlig tap (NOK) |
| `BINGO_PLAY_SESSION_LIMIT_MS` | `3600000` | `3600000` | 60 min spilløkt |
| `BINGO_PAUSE_DURATION_MS` | `300000` | `300000` | 5 min obligatorisk pause |

### 3. Payout / RTP

| Variabel | Prod-verdi | Code default | Kommentar |
|----------|-----------|--------------|-----------|
| `CANDY_PAYOUT_PERCENT` | `80` | `100` | Utbetalingsprosent. 100 = alt tilbake |

### 4. Integrasjon (sjelden endret)

| Variabel | Prod-verdi | Kommentar |
|----------|-----------|-----------|
| `WALLET_PROVIDER` | `external` | Proxy til bingo-system wallet |
| `INTEGRATION_ENABLED` | `true` | Tillat launch-token + ext-wallet |
| `ALLOWED_EMBED_ORIGINS` | `https://bingo-system-jsso.onrender.com` | CORS for iframe |

---

## Vanlige feil

### Autoplay fungerer ikke i produksjon
`BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION` mangler eller er `false`. Uten denne ignoreres
`AUTO_ROUND_START_ENABLED` og `AUTO_DRAW_ENABLED` fullstendig i production.

### Runder starter for sent (3 min i stedet for 30 sek)
`AUTO_ROUND_START_INTERVAL_MS` mangler i `render.yaml`. Code default er `180000` (3 min).
Sett eksplisitt til `30000`.

### Trekning går for sakte
`AUTO_DRAW_INTERVAL_MS` mangler. Code default er `2500` ms. Vi bruker `1200` ms.

### Payout er 100 % i produksjon
`CANDY_PAYOUT_PERCENT` mangler. Code default er `100`. Sett til `80` for produksjon.

---

## PR-sjekkliste (kopier inn i PR-beskrivelse ved behov)

```markdown
- [ ] Nye/endrede env-variabler er lagt til i `render.yaml` (candy-backend)
- [ ] `backend/.env.example` er oppdatert
- [ ] `backend/.env` (lokal) matcher ønsket oppførsel
- [ ] Code defaults i `backend/src/index.ts` er dokumentert her
- [ ] Autoplay-guard (`BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION`) er satt riktig
- [ ] Timing verifisert etter deploy (runder starter hvert 30. sekund)
```
