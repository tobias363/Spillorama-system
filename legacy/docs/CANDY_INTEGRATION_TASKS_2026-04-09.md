# Oppgaver: Candy-integrasjon mot Spillorama-system

Opprettet: 2026-04-09  
Oppdatert: 2026-04-09

Dette dokumentet beskriver gjenstående integrasjonsoppgaver mellom `Spillorama-system`, `Candy` og `demo-backend`.

Dokumentet er ikke bare en idé-liste. Det er en styrt arbeidsplan med klare grenser, leveranser, akseptansekriterier og ikke-mål. Hvis en oppgave er i konflikt med repo-grensene i [CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md) eller [LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md](/Users/tobiashaugen/Projects/Spillorama-system/docs/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md), er de dokumentene styrende.

---

## 1. Målet

Målet er å få på plass en Candy-integrasjon som:

- lar en pålogget Spillorama-spiller åpne Candy
- lar Candy bruke spillerens midler via leverandørens wallet
- holder Candy-backend og Candy-klient helt utenfor `Spillorama-system`
- kan gjenbrukes mot flere bingo-leverandører senere

Dette betyr at integrasjonen må bygges som en kontrakt mellom to systemer, ikke som spesialkode som blander repoene sammen.

---

## 2. Harde grenser og ikke-mål

### 2.1 Hva som er lov i `Spillorama-system`

- generisk launch-flyt for eksterne spill
- utstedelse av begrenset launch-token eller signert assertionsdata
- wallet-API som Candy-backend kan bruke
- leverandørspesifikk auth, wallet og compliance
- generisk katalogoppføring for Candy

### 2.2 Hva som ikke er lov i `Spillorama-system`

- Candy demo-login
- Candy demo-admin
- Candy demo-settings
- Candy runtime-regler
- Candy gameplay-kode
- Candy-backend-endepunkter
- ny “midlertidig” wallet-bridge direkte i nettleseren
- nye Candy-spesifikke iframes, overlays eller auth-hacks i live bingo-koden

### 2.3 Hva som er lov i `demo-backend`

- Candy launch-validering
- Candy runtime-konfig
- Candy demo-admin
- Candy demo-login
- Candy settings
- Candy integrasjon mot Spillorama wallet-API
- sentral Candy-forretningslogikk på tvers av leverandører

### 2.4 Hva som er lov i `Candy`

- selve spillet
- UI, assets og gameplay
- klientflyt etter at et gyldig launch-context er etablert

---

## 3. Eiermodell

| Ansvar | Riktig repo | Kommentar |
|---|---|---|
| Leverandørens spilleridentitet | `Spillorama-system` | spilleren er pålogget her |
| Leverandørens wallet og saldo | `Spillorama-system` | dette er system of record for spillerens midler hos denne leverandøren |
| Candy-klienten | `Candy` | spillet, UI, assets |
| Candy-backend | `demo-backend` | launch-validering, drift, settings, sentral Candy-logikk |
| Integrasjonskontrakten | delt mellom repoene | må dokumenteres eksplisitt og versjoneres |

---

## 4. Arkitektur vi skal lande

### 4.1 Målbilde

```text
Spiller
  |
  |-- logger inn --> Spillorama-system
  |
  |-- åpner Candy --> Spillorama-system utsteder launch-context
  |
  |-- laster Candy-klient --> Candy
                            |
                            |-- validerer launch-context --> demo-backend
                                                       |
                                                       |-- wallet-kall --> Spillorama-system
```

### 4.2 Prinsipper

- Spilleren autentiseres bare én gang hos leverandøren.
- Candy skal ikke eie spillerens hovedsaldo.
- Candy-backend skal aldri skrive direkte til leverandørens database.
- Alle pengebevegelser må gå gjennom en eksplisitt wallet-kontrakt.
- Alle kall som kan påvirke saldo må være idempotente og sporbare.
- Ingen nettleserbasert “hemmelig” wallet-bro skal brukes som fallback.

---

## 5. Fase 1: API-kontrakt mellom Spillorama og Candy-backend

Dette er første blokkerende leveranse. Alt annet avhenger av dette.

### Oppgaver

- [ ] Definer launch-kontrakten:
  - hvem utsteder launch-token
  - hva tokenet representerer
  - hvor lenge tokenet lever
  - om tokenet er engangsbruk
  - hvordan replay prevention håndteres
  - hvordan klokkeskjevhet håndteres

- [ ] Definer claims i launch-token:
  - `sub` eller `playerId`
  - `provider`
  - `walletAccountId`
  - `currency`
  - `sessionId`
  - `iat`
  - `exp`
  - `jti`
  - eventuell hall/site/operator-identitet

- [ ] Definer hvordan Candy-backend verifiserer token:
  - lokalt via offentlig nøkkel/JWKS anbefales
  - alternativt via verifikasjonsendepunkt i Spillorama
  - dokumenter nøkkelrotasjon

- [ ] Definer wallet-API:
  - `debit`
  - `credit`
  - `balance`
  - eventuelt `reserve`/`commit` hvis dere velger to-trinns modell

- [ ] Definer request/response-format:
  - Spillorama bruker standardformat `{ ok: boolean, data?: T, error?: string }`
  - dokumenter HTTP-status, feilobjekter og retriable vs non-retriable feil

- [ ] Definer idempotency-regler:
  - hvilke kall krever idempotency-key
  - hvor lenge nøkkelen er gyldig
  - hva som skjer ved duplikate kall

- [ ] Definer korrelasjonsnøkler:
  - `requestId`
  - `sessionId`
  - `roundId`
  - `transactionId`
  - `idempotencyKey`

- [ ] Lag kontraktsfil:
  - `docs/CANDY_SPILLORAMA_API_CONTRACT.md`
  - denne skal eies som en formell kontrakt og oppdateres ved hver breaking/non-breaking endring

### Akseptansekriterier

- [ ] Launch-token format er dokumentert med eksempelpayload
- [ ] Verifikasjonsmodell er valgt og dokumentert
- [ ] Wallet-endepunkter er dokumentert med eksempelkall
- [ ] Idempotency-regler er definert
- [ ] Feilkoder og retry-semantikk er dokumentert
- [ ] Dokumentet er godkjent av både Spillorama- og Candy-siden

### Referanser

| Fil | Innhold |
|---|---|
| `backend/src/adapters/WalletAdapter.ts` | wallet interface |
| `backend/src/adapters/HttpWalletAdapter.ts` | HTTP wallet med timeout/circuit breaker |
| `backend/src/adapters/createWalletAdapter.ts` | provider factory |
| `backend/src/platform/PlatformService.ts` | spillkatalog og game definition |

---

## 6. Fase 2: Trust, sikkerhet og revisjon

Dette er ekstra punkter som må inn før implementasjon, ellers bygger dere bare en ny skjør spesialintegrasjon.

### Oppgaver

- [ ] Bestem trust-modell:
  - service-to-service auth mellom `demo-backend` og `Spillorama-system`
  - API-key alene er ikke nok hvis den blir eneste kontroll
  - anbefalt: signert token + separat server-auth

- [ ] Definer signeringsmodell:
  - hvem eier private/public keys
  - hvordan nøkler roteres
  - hvordan gamle nøkler fases ut

- [ ] Definer audit-krav:
  - alle debit/credit-kall må kunne spores
  - logg må inneholde `playerId`, `transactionId`, `roundId`, `requestId`, timestamp og resultat

- [ ] Definer anti-replay-regler:
  - launch-token skal være kortlivet
  - launch-token bør være engangsbruk eller markeres brukt
  - wallet-kall skal ikke kunne replayes uten å bli avvist

- [ ] Definer fail-closed-regel:
  - hvis Candy-backend ikke er sikker på wallet-responsen, skal ikke klienten fortsette som om penger er trukket

- [ ] Definer ledger policy:
  - Spillorama er ledger source of truth for spillerens saldo
  - Candy-backend kan ha speiling/cache, men ikke autoritativ saldo

### Akseptansekriterier

- [ ] Trust-modell er dokumentert
- [ ] Nøkkelrotasjon er dokumentert
- [ ] Audit-loggfelter er definert
- [ ] Replay-beskyttelse er definert
- [ ] Ledger source of truth er eksplisitt besluttet

---

## 7. Fase 3: Miljøvariabler, secrets og konfigurasjon

`Spillorama-system` kan godt ha integrasjonskonfig for Candy. Det er ikke det samme som å eie Candy-backenden.

### Oppgaver

- [ ] Definer hvilke variabler Spillorama trenger:
  - `CANDY_BACKEND_URL`
  - `CANDY_LAUNCH_AUDIENCE`
  - `CANDY_JWKS_URL` eller offentlig nøkkelreferanse
  - eventuelle service credentials mot Candy-backend

- [ ] Legg relevante variabler til i:
  - `backend/.env.example`
  - `render.yaml`

- [ ] Definer hvilke variabler demo-backend trenger:
  - `SPILLORAMA_WALLET_API_URL`
  - `SPILLORAMA_WALLET_API_KEY` eller tilsvarende auth
  - `SPILLORAMA_JWKS_URL` eller offentlig nøkkel
  - `SPILLORAMA_PROVIDER_ID`

- [ ] Lag en delt tabell over alle variabler:

  | Variabel | Eies av | Brukes av | Formål | Secret? |
  |---|---|---|---|---|
  | `CANDY_BACKEND_URL` | demo-backend | Spillorama | launch/redirect | nei |
  | `SPILLORAMA_WALLET_API_URL` | Spillorama | demo-backend | wallet-kall | nei |
  | `SPILLORAMA_WALLET_API_KEY` | Spillorama | demo-backend | server-auth | ja |

- [ ] Dokumenter hvilket miljø som bruker hvilke verdier:
  - local
  - preview/staging
  - production

### Akseptansekriterier

- [ ] Alle påkrevde envs er listet
- [ ] Secrets er skilt fra ikke-secrets
- [ ] Eier av hver variabel er definert
- [ ] Miljømatrise er dokumentert

---

## 8. Fase 4: Nettverksmodell, CORS og grenser

### Oppgaver

- [ ] Definer om Candy-klienten skal kalle Spillorama direkte fra nettleseren:
  - hvis nei, skal all wallet-logikk gå server-til-server
  - dette er anbefalt

- [ ] Hvis Candy-klienten må kalle Spillorama direkte:
  - dokumenter nøyaktig hvilke endepunkter
  - legg kun disse originene i `CORS_ALLOWED_ORIGINS`
  - dokumenter hvorfor server-til-server ikke var tilstrekkelig

- [ ] Dokumenter domener:
  - Spillorama portal/admin/web
  - Candy-klient
  - demo-backend

- [ ] Dokumenter hvilke kall som er:
  - browser -> Spillorama
  - browser -> Candy
  - Candy -> demo-backend
  - demo-backend -> Spillorama

### Akseptansekriterier

- [ ] Nettverksdiagram finnes
- [ ] CORS-behov er eksplisitt dokumentert
- [ ] Server-til-server wallet-modell er valgt eller eksplisitt avvist

---

## 9. Fase 5: Feilhåndtering, observability og reconciliation

Dette er et område den eksisterende oppgavelisten var for svak på.

### Oppgaver

- [ ] Definer timeout-policy:
  - hvor lenge venter Candy-backend på wallet-respons
  - hva er retry-policy
  - hvilke kall skal ikke retries blindt

- [ ] Definer uklar tilstand:
  - debit kan være utført selv om responsen ikke kom frem
  - hva er sannhetskilden for oppslag etterpå
  - hvordan sjekkes transaksjonsstatus

- [ ] Definer reconciliation-jobb:
  - daglig eller hyppigere avstemming
  - sammenlign Candy-transaksjoner mot Spillorama ledger
  - flagg mismatch for manuell behandling

- [ ] Legg til health/ready checks:
  - Spillorama skal kunne vise om Candy-integrasjon er konfigurert
  - demo-backend skal kunne vise om Spillorama wallet-API er nåbar

- [ ] Definer metrics:
  - wallet debit success/failure
  - wallet credit success/failure
  - timeout count
  - retry count
  - reconciliation mismatch count

- [ ] Definer structured logging:
  - alle kall må ha samme korrelasjons-ID-er
  - logger må være søkbare på `playerId`, `transactionId`, `roundId`, `requestId`

### Akseptansekriterier

- [ ] Timeout- og retry-regler er dokumentert
- [ ] Reconciliation-prosess er definert
- [ ] Healthchecks er spesifisert
- [ ] Metrics og loggfelt er definert

---

## 10. Fase 6: Teststrategi

### Oppgaver

- [ ] Legg til kontraktstester:
  - valider request/response mellom repoene
  - test signaturvalidering
  - test idempotency

- [ ] Legg til integrasjonstester:
  - generer launch-token i Spillorama
  - valider token i demo-backend
  - kjør debit
  - kjør credit
  - verifiser saldo

- [ ] Legg til negative tester:
  - utløpt token
  - replayet token
  - ugyldig signatur
  - ukjent spiller
  - utilstrekkelig saldo
  - wallet-timeout

- [ ] Definer smoke-test etter deploy:
  - testspiller
  - testlaunch
  - én debit
  - én credit
  - verifisering av saldo og logger

- [ ] Bestem hva som kjøres:
  - i CI
  - manuelt før produksjon
  - periodisk i staging

### Akseptansekriterier

- [ ] Kontraktstest finnes
- [ ] Minst én e2e smoke-test er definert
- [ ] Negative tester er definert
- [ ] Testdata og testbrukerpolicy er dokumentert

---

## 11. Fase 7: Deploy-rekkefølge, versjonering og rollback

### Oppgaver

- [ ] Velg versjoneringsmodell:
  - header-versjonering
  - URL-versjonering
  - eksplisitt kontraktsversjon i dokumentet

- [ ] Definer bakoverkompatibel deploy-strategi:
  1. mottaker støtter gammel og ny kontrakt
  2. mottaker deployes
  3. avsender begynner å bruke ny kontrakt
  4. gammel kontrakt fases ut senere

- [ ] Definer rollback:
  - hva rollbackes først
  - hvordan håndteres pågående spillrunder
  - hvordan unngås duplikate credits/debits under rollback

- [ ] Definer kill-switch:
  - mulighet til å deaktivere Candy-launch i Spillorama uten full deploy
  - mulighet til å stoppe wallet-kall fra demo-backend ved kritisk feil

### Akseptansekriterier

- [ ] Kontrakten er versjonert
- [ ] Rollback-prosedyre er skrevet
- [ ] Kill-switch er definert

---

## 12. Fase 8: Go-live-kriterier

Candy-integrasjonen skal ikke slås på i produksjon før følgende er grønt:

- [ ] API-kontrakt signert av begge sider
- [ ] security/trust-modell godkjent
- [ ] envs og secrets satt i riktige miljøer
- [ ] healthchecks grønne
- [ ] smoke-test grønne
- [ ] reconciliation-prosess finnes
- [ ] rollback-plan finnes
- [ ] kill-switch finnes
- [ ] support/driftsansvar er definert

---

## 13. Prioritert rekkefølge

| # | Oppgave | Hvorfor først |
|---|---|---|
| 1 | API-kontrakt og trust-modell | alt annet avhenger av dette |
| 2 | Miljøvariabler og nettverksmodell | nødvendig for faktisk kobling |
| 3 | Observability og reconciliation | nødvendig før penger flyttes |
| 4 | Teststrategi | nødvendig før staging/prod |
| 5 | Deploy/rollback/kill-switch | nødvendig før go-live |

---

## 14. Første konkrete leveranser

Neste arbeidspakke bør være:

1. Opprett `docs/CANDY_SPILLORAMA_API_CONTRACT.md`
2. Velg signerings- og verifikasjonsmodell for launch-token
3. Beskriv wallet-endepunktene med eksempelpayloads
4. Beskriv idempotency- og reconciliation-regler
5. Få formell godkjenning fra både Spillorama- og Candy-siden

Ikke start med implementasjon i kode før dette er skrevet ned.
