# Arbeidslogg: Candy-separasjon og integrasjon

**Dato:** 2026-04-09
**Scope:** Fullstendig separasjon av Candy fra Spillorama + bygging av integrasjonskontrakten

---

## 1. Hva som ble gjort

### 1.1 demo-backend: Fjernet KYC

KYC handteres av integrerte systemer (f.eks. Spillorama), ikke av demo-backend.

**Slettet filer:**
- `backend/src/adapters/KycAdapter.ts` - KYC interface
- `backend/src/adapters/LocalKycAdapter.ts` - lokal KYC-implementasjon
- `backend/src/adapters/LocalKycAdapter.test.ts` - KYC-tester

**Endret filer:**
- `backend/src/platform/PlatformService.ts`
  - Fjernet KycAdapter-import og constructor-injection
  - Fjernet AppUser-felter: `kycStatus`, `birthDate`, `kycVerifiedAt`, `kycProviderRef`
  - Fjernet `KycStatus` type
  - Slettet metoder: `submitKycVerification()`, `assertUserEligibleForGameplay()`, `updateKycStatus()`
  - Fjernet `calculateAgeYears()` hjelpefunksjon
  - Fjernet KYC-kolonner fra alle SQL-sporringer og schema-initialisering

- `backend/src/index.ts`
  - Fjernet import av `LocalKycAdapter`
  - Fjernet `KYC_MIN_AGE_YEARS` env-lesing og kycAdapter-opprettelse
  - Slettet endepunkter: `GET /api/kyc/me`, `POST /api/kyc/verify`
  - Fjernet `platformService.assertUserEligibleForGameplay()` kall fra:
    - `POST /api/games/candy/launch-token`
    - Socket `requireAuthenticatedPlayerAction()`
    - Socket `requireAuthenticatedPlayerIdentity()`

### 1.2 demo-backend: Fjernet compliance

Compliance (tap-grenser, selvutelukkelse, spillepauser) handteres av leverandorsystemet.

**Slettet filer:**
- `backend/src/compliance/compliance-suite.test.ts` - compliance-testsuite

**Endret filer:**
- `backend/src/game/BingoEngine.ts` (fjernet ~560 linjer)
  - Fjernet fra `ComplianceOptions`: `dailyLossLimit`, `monthlyLossLimit`, `playSessionLimitMs`, `pauseDurationMs`, `selfExclusionMinMs`
  - Fjernet private felter: `regulatoryLossLimits`, `playSessionLimitMs`, `pauseDurationMs`, `selfExclusionMinMs`, `complianceLedger`
  - Slettet metoder:
    - `getPlayerCompliance()`, `setPlayerLossLimits()`
    - `setTimedPause()`, `clearTimedPause()`
    - `setSelfExclusion()`, `clearSelfExclusion()`
    - `assertWalletAllowedForGameplay()`, `assertPlayersNotBlockedByRestriction()`
    - `calculateNetLoss()`, `getEffectiveLossLimits()`, `assertLossLimitsBeforeBuyIn()`
    - `finishPlaySession()`, `finishPlaySessionsForGame()`, `getPlaySessionState()`
    - `resolveGameplayBlock()`
    - `recordComplianceLedgerEvent()`, `listComplianceLedgerEntries()`
    - `recordAccountingEvent()`
  - Fjernet alle kall til `this.assertWalletAllowedForGameplay()` i spillflyten
  - Fjernet alle kall til `this.recordComplianceLedgerEvent()` og `this.finishPlaySessionsForGame()`

- `backend/src/index.ts` (fjernet ~180 linjer)
  - Fjernet env-variabler: `BINGO_DAILY_LOSS_LIMIT`, `BINGO_MONTHLY_LOSS_LIMIT`, `BINGO_PLAY_SESSION_LIMIT_MS`, `BINGO_PAUSE_DURATION_MS`, `BINGO_SELF_EXCLUSION_MIN_MS`
  - Slettet `sendComplianceWebhook()` funksjon
  - Fjernet `complianceWebhookUrl` fra WebhookService-konfig
  - Slettet player-endepunkter:
    - `GET /api/wallet/me/compliance`
    - `POST /api/wallet/me/timed-pause`, `DELETE /api/wallet/me/timed-pause`
    - `POST /api/wallet/me/self-exclusion`, `DELETE /api/wallet/me/self-exclusion`
    - `PUT /api/wallet/me/loss-limits`
  - Slettet admin-endepunkter:
    - `GET /api/admin/wallets/:walletId/compliance`
    - `PUT /api/admin/wallets/:walletId/loss-limits`
    - `POST /api/admin/wallets/:walletId/timed-pause`, `DELETE`
    - `POST /api/admin/wallets/:walletId/self-exclusion`, `DELETE`

- `backend/src/game/BingoEngine.test.ts` (fjernet ~200 linjer)
  - Fjernet compliance-tester: daily hard limit, personal loss limits, mandatory pause, timed pause, self-exclusion
  - Fjernet compliance-opsjoner fra gjenvarende tester
  - La til `withFakeNow` helper som var nodvendig for gjenvarende tester

### 1.3 demo-backend: Fjernet login-krav pa player-frontend

Spilloversikten vises na direkte uten innlogging. Admin-panel er uendret.

**Endret filer:**
- `frontend/index.html`
  - Fjernet `#authView` (login/registrering-skjema)
  - Fjernet `#kycCard` (KYC-verifisering)
  - Fjernet "Spillvett"-seksjon fra profil-modal
  - Fjernet KYC-status fra personlig info
  - `#appView` vises direkte (ikke lenger skjult)

- `frontend/app.js`
  - Fjernet funksjoner: `onLogin()`, `onRegister()`, `onKycVerify()`, `renderKycCard()`
  - Fjernet compliance-funksjoner: `loadComplianceState()`, `onSafetyRefresh()`, `onSafetySaveLossLimits()`, `onSafetySetPause()`, `onSafetyClearPause()`, `onSafetySetSelfExclusion()`, `onSafetyClearSelfExclusion()`, `syncSafetyInputsFromCompliance()`, `renderSafetyStatus()`, `formatComplianceForPlayer()`
  - Fjernet alle event listeners for login, register, KYC, safety-knapper
  - `renderLayoutForAuth()` viser na alltid `#appView`
  - `bootstrap()` laster spill direkte uten auth-sjekk
  - `loadAuthenticatedData()` henter kun spill og haller (ikke wallet/compliance)

- `backend/src/index.ts`
  - `GET /api/games` krever ikke lenger autentisering
  - `GET /api/halls` krever ikke lenger autentisering

### 1.4 Spillorama-system: Bygget integrasjonsendepunkter

**Nye filer:**
- `backend/src/integration/externalGameWallet.ts` - wallet-bro for eksterne spill
  - `GET /api/ext-wallet/balance?playerId={walletId}` - hent saldo
  - `POST /api/ext-wallet/debit` - trekk innsats med idempotency
  - `POST /api/ext-wallet/credit` - utbetal gevinst med idempotency
  - Bearer-token auth via `EXT_GAME_WALLET_API_KEY`
  - Korrekte HTTP-statuskoder: 402 (insufficient funds), 404 (not found), 409 (duplicate)

- `docs/CANDY_SPILLORAMA_API_CONTRACT.md` - formell API-kontrakt v1.0

**Endret filer:**
- `backend/src/index.ts`
  - Importerer og monterer `externalGameWalletRouter` pa `/api/ext-wallet`
  - Nytt endepunkt: `POST /api/games/:slug/launch`
    - Validerer spillerens sesjon
    - Sjekker at spillet er aktivert i katalogen
    - Kaller demo-backend sin `/api/integration/launch` (server-til-server)
    - Returnerer embedUrl for iframe

- `backend/.env.example` - nye variabler dokumentert
- `render.yaml` - nye env-vars lagt til

### 1.5 Render: Satt env-variabler

**Spillorama-system** (`srv-d7bvpel8nd3s73fi7r4g`):
| Variabel | Verdi |
|----------|-------|
| `EXT_GAME_WALLET_API_KEY` | `9CcYun69UD-voo3bwcwWYt8Wwh2lvGs1xAOl9fdpGw4` |
| `CANDY_BACKEND_URL` | `https://candy-backend-ldvg.onrender.com` |
| `CANDY_INTEGRATION_API_KEY` | `5JCnEWpuufR9rd8cUntyiOhH-23cqTqx8xh89lPoF0c` |

**candy-backend** (`srv-d76qa83uibrs73ck8iqg`):
| Variabel | Verdi |
|----------|-------|
| `WALLET_API_KEY` | `9CcYun69UD-voo3bwcwWYt8Wwh2lvGs1xAOl9fdpGw4` |
| `WALLET_API_BASE_URL` | `https://spillorama-system.onrender.com/api/ext-wallet` |
| `INTEGRATION_API_KEY` | `5JCnEWpuufR9rd8cUntyiOhH-23cqTqx8xh89lPoF0c` |
| `INTEGRATION_WEBHOOK_SECRET` | `57qpDx0Ob5mm3wFZGnGwqaXwvMaTE3S9khSJVAz1j6A` |

**Delte secrets:**
- `EXT_GAME_WALLET_API_KEY` (Spillorama) = `WALLET_API_KEY` (candy-backend)
- `CANDY_INTEGRATION_API_KEY` (Spillorama) = `INTEGRATION_API_KEY` (candy-backend)

---

## 2. Verifisering

### demo-backend
- TypeScript typecheck: 0 feil
- Build: ok
- Tester: 63/63 bestaatt, 0 feilet

### Spillorama-system
- TypeScript typecheck: 0 feil
- Build: ok

---

## 3. Hva som IKKE ble endret

- Admin-panelet i demo-backend (`frontend/admin/`) - uendret
- Backend auth for admin i demo-backend - uendret
- Spillogikk i BingoEngine (utenom compliance) - uendret
- Wallet-logikk (debit/credit/topup) - uendret
- Spillkatalog og settings - uendret
- Integrasjons-API i demo-backend (`/api/integration/*`) - uendret
- Draw engine og scheduler - uendret
- Hall/terminal-administrasjon - uendret
- Candy-klienten (`/Users/tobiashaugen/Projects/Candy`) - uendret

---

## 4. Flyten etter endringene

```
1. Spiller logger inn i Spillorama
2. Spillorama viser spillkatalog (inkludert Candy)
3. Spiller klikker "Spill Candy"
4. Spillorama: POST /api/games/candy/launch
     |-- server-til-server --> demo-backend: POST /api/integration/launch
     |<-- { embedUrl } --
5. Spillorama viser Candy i iframe
6. Candy-klient laster og kobler til demo-backend via Socket.IO
7. Spill pagaar:
     debit (innsats)  --> demo-backend --> POST /api/ext-wallet/debit --> Spillorama wallet
     credit (gevinst) --> demo-backend --> POST /api/ext-wallet/credit --> Spillorama wallet
8. Runde fullfort:
     demo-backend sender webhook til Spillorama (valgfritt)
```

---

## 5. Dokumenter opprettet/oppdatert

| Fil | Repo | Formal |
|-----|------|--------|
| `docs/CANDY_SPILLORAMA_API_CONTRACT.md` | Spillorama-system | Formell API-kontrakt v1.0 |
| `docs/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md` | Spillorama-system | Eiermodell og repo-grenser |
| `docs/CANDY_INTEGRATION_TASKS_2026-04-09.md` | Spillorama-system | Oppgaveliste for integrasjonen |
| Denne filen | Spillorama-system | Komplett arbeidslogg |

---

## 6. Neste steg

1. Push kode til GitHub (begge repoer)
2. Render auto-deployer begge tjenester
3. Verifiser at `/health` er gronn pa begge
4. Test launch-flyten ende-til-ende i staging
5. Sett opp CORS (`CORS_ALLOWED_ORIGINS`) pa Spillorama for Candy-domenet ved behov
6. Vurder webhook-mottak i Spillorama (`POST /api/webhooks/candy`) for spillresultater
