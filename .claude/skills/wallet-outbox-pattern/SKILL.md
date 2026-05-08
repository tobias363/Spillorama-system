---
name: wallet-outbox-pattern
description: When the user/agent works with wallet-mutating code, payout, ticket-purchase, idempotency-keys, REPEATABLE READ isolation, hash-chain audit, eller wallet-reconciliation. Also use when they mention WalletAdapter, walletAdapter, PostgresWalletAdapter, InMemoryWalletAdapter, app_wallet_outbox, app_event_outbox, app_compliance_audit_log, WalletOutboxRepo, WalletOutboxWorker, WalletAuditVerifier, IdempotencyKeys, REPEATABLE READ, hash-chain, audit-trail, ledger-events, casino-grade, BIN-761, BIN-762, BIN-763, BIN-764, BIN-766, BIN-767, BIR-036, ADR-003, ADR-004. Make sure to use this skill whenever someone touches wallet-touch code, payout-services, ticket-purchase, eller compliance-ledger — even if they don't explicitly ask for it.
metadata:
  version: 1.0.0
  project: spillorama
---

# Casino-grade wallet — outbox + REPEATABLE READ + hash-chain

Spillorama wallet-stack er bygget for Evolution Gaming-grade robusthet. ALL wallet-touch MÅ gå via `WalletAdapter`-interface og bruke outbox-pattern for atomic state-mutering + event-skriving. REPEATABLE READ-isolation forhindrer lost-update. Hash-chain audit gir Lotteritilsynet-sporbarhet. Dette er regulatorisk infrastruktur — bypassing er pengetap-risiko.

## Kontekst — hvorfor er dette kritisk?

**Lese-først-doc:**
- `apps/backend/src/wallet/README.md` — modul-spec og API-overflate
- `docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md` — wallet-split design (deposit + winnings + holds)
- `docs/architecture/modules/backend/WalletService.md` — service-detaljer (hvis finnes)

**Linear-issues (BIN-serie):**
- BIN-761 — outbox-pattern for state-mutering + event-skriving
- BIN-762 — REPEATABLE READ-isolation
- BIN-763 — wallet-split (deposit/winnings/holds)
- BIN-764 — hash-chain audit (ADR-003)
- BIN-766 — multi-currency-readiness
- BIN-767 — idempotency-key 90-dager TTL cleanup
- BIR-036 — kontant-utbetaling-cap 50 000 kr/hall/dag

## Mandate (Tobias-direktiv)

> "ALL wallet-touch må gå via WalletAdapter-interface."

Direct-INSERT i `app_wallet`, `app_wallet_transactions`, eller noen annen wallet-tabell utenom WalletService/WalletAdapter er **forbudt**. Det bryter outbox-garantien og hash-chain-kontinuitet.

## Kjerne-arkitektur

### Tre-lags-modell

```
┌────────────────────────────────────────────────────────────┐
│  CALLER-LAG                                                 │
│  Game1PayoutService, Game1TicketPurchaseService,           │
│  Game2Engine, Game3Engine, AgentTransactionService,        │
│  SwedbankPayService, etc.                                  │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
┌────────────────────────────────────────────────────────────┐
│  WALLET-INTERFACE                                           │
│  WalletAdapter (apps/backend/src/adapters/WalletAdapter.ts)│
│  Metoder: transfer, debit, credit, getBalance, reserve,    │
│           releaseReservation                                │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
┌────────────────────────────────────────────────────────────┐
│  IMPLEMENTASJONER                                           │
│  PostgresWalletAdapter (prod) — REPEATABLE READ + outbox   │
│  InMemoryWalletAdapter (test) — speiler invariants         │
│  FileWalletAdapter (dev) — JSON fil-backend                 │
│  HttpWalletAdapter (legacy) — eksternt wallet              │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
┌────────────────────────────────────────────────────────────┐
│  STATE-LAG                                                  │
│  Postgres: app_wallet, app_wallet_transactions,            │
│            app_wallet_outbox, app_event_outbox,            │
│            app_compliance_audit_log                         │
│  Redis (cache, ikke source of truth)                       │
└────────────────────────────────────────────────────────────┘
```

## Outbox-pattern (BIN-761 / ADR-004)

**Garantien:** State-mutering og event-skriving skjer i SAMME database-transaksjon.

```typescript
// Pseudo-kode
await pool.transaction(async (client) => {
  // 1. State-mutering
  await client.query("UPDATE app_wallet SET balance = ... WHERE id = ...");
  await client.query("INSERT INTO app_wallet_transactions ...");
  
  // 2. Outbox-INSERT i SAMME TX
  await client.query("INSERT INTO app_wallet_outbox (event_type, payload, ...) ...");
  
  // Atomisk commit eller rollback
});

// Worker plukker outbox-rader asynkront og sender til consumers
// Hvis worker crasher → events forblir i outbox til neste retry
```

**Hvorfor:** Hvis vi skrev events utenfor TX (eks. emit Socket.IO direkte), kunne TX rolle tilbake men event-en allerede ha gått ut. Outbox garanterer at events KUN sendes når state er commit-et.

**Implementasjon:**
- `apps/backend/src/wallet/WalletOutboxRepo.ts` — INSERT-helpers
- `apps/backend/src/wallet/WalletOutboxWorker.ts` — async worker som plukker pending rows
- `app_wallet_outbox`-tabell — outbox-køen

## REPEATABLE READ-isolation (BIN-762)

**Problemet:** Concurrent debit-paths kan trigge lost-update. Eks:
1. TX A leser saldo = 100
2. TX B leser saldo = 100
3. TX A skriver saldo = 50 (debit 50)
4. TX B skriver saldo = 50 (debit 50)
5. Begge committer → spiller har trukket 100 men saldo er bare 50

**Løsningen:** REPEATABLE READ-isolasjon på debit-flyt. Postgres detekterer concurrent write og kaster `serialization_failure`. Adapter retry'er.

```typescript
await pool.transaction({ isolationLevel: 'repeatable read' }, async (client) => {
  // Multi-step debit med limit-sjekk
});
```

**Tester:** `apps/backend/src/adapters/PostgresWalletAdapter.isolation.test.ts` verifiserer at concurrent debit ikke gir lost-update.

## Idempotency-keys (BIN-767)

**Hver wallet-operasjon krever idempotencyKey** — UUID v4 fra caller. Server dedup-erer i 90 dager.

**Cache-key shape:**
```typescript
{ userId, operation, idempotencyKey } → cached result
```

**Bruk:**
```typescript
await walletAdapter.transfer({
  fromWalletId, toWalletId, amount,
  idempotencyKey: IdempotencyKeys.game1Payout({ gameId, claimId }),  // deterministic
  reason: "PRIZE",
});
```

**Helper:** `apps/backend/src/util/IdempotencyKeys.ts` med deterministic key-builders per operasjon.

**Cleanup-cron:** BIN-767 — sletter rader eldre enn 90 dager fra `app_idempotency_cache`. Kjøres natten gjennom.

## Hash-chain audit (BIN-764 / ADR-003)

Alle wallet-transaksjoner skriver audit-rad i `app_compliance_audit_log` med `prev_hash + curr_hash` for å tippe-sikre kjeden. Hvis en revisor mistenker tampering kan de verifisere kjeden.

**Implementasjon:**
- `apps/backend/src/wallet/WalletAuditVerifier.ts` — verifiserer hash-kjeden
- `apps/backend/src/wallet/WalletAuditVerifier.test.ts` — regresjons-tester

**Hash-shape:**
```
curr_hash = SHA-256(prev_hash || canonical_json(transaction_data))
```

Manipulering av en historisk rad bryter alle subsequent hashes.

## Wallet-split design (BIN-763)

Wallet er split i tre buckets:

| Bucket | Hva |
|---|---|
| `deposit_balance` | Penger spilleren har satt inn (kan tas ut når som helst) |
| `winnings_balance` | Premier vunnet (kan også tas ut, men trackes separat for §11) |
| `holds` | Reserverte beløp (eks. ved aktiv runde) |

**Total saldo for spill:** `deposit_balance + winnings_balance - holds`

**Hvorfor split:** §11-distribusjon krever at vi vet hvor mye som er gevinst-utbetalinger vs deposits. Også bonus-vilkår (eks. "spill 10x deposit før withdrawal") krever spore-mekanikk.

## Multi-currency readiness (BIN-766)

Alle wallet-rader har `currency`-felt (default NOK, men ikke hardkodet). Pilot kjører kun NOK, men infrastrukturen støtter EUR/SEK/USD i fremtiden.

**Tester:** `apps/backend/src/adapters/PostgresWalletAdapter.currency.test.ts`, `InMemoryWalletAdapter.currency.test.ts`.

## Cap-håndhevelse (BIR-036)

Kontant-utbetaling-cap: **50 000 kr/hall/dag**. Håndheves i `WalletService.withdraw` for `paymentType=CASH` og hall-bundet.

**Error-code:** `BIN-WAL-003` (cash withdraw cap exceeded).

**Implementasjon:** Sjekker sum av cash-withdrawals for (hall, businessDate) før hver utbetaling.

## Single-prize cap (gameType-conditional)

`PrizePolicyPort.applySinglePrizeCap`:
- `gameType === "DATABINGO"` (KUN SpinnGo) → cap 2500 kr per single-prize
- `gameType === "MAIN_GAME"` (Spill 1, 2, 3) → INGEN cap

**Bruk:**
```typescript
const capped = this.prizePolicy.applySinglePrizeCap({
  hallId: room.hallId,
  gameType: ledgerGameTypeForSlug(room.gameSlug),  // ALDRI hardkodet streng
  amount: requestedPayout,
});
```

## Daily reconciliation

Cron-jobb hver natt:
```
sum(deposits) + sum(winnings) - sum(withdrawals) - sum(stakes) = sum(balances)
```

Avvik > 1 NOK alarmer Sentry. Pre-pilot 2026-05-01 hadde 21 alerts → 0 etter fix.

**Implementasjon:** `WalletReconciliationService` (cron i `apps/backend/src/jobs/`).

## Vanlige error-codes

| Code | Betydning |
|---|---|
| `BIN-WAL-001` | Insufficient balance |
| `BIN-WAL-002` | Daily loss limit reached |
| `BIN-WAL-003` | Cash withdraw cap exceeded (BIR-036, 50k/hall/dag) |
| `BIN-WAL-004` | Idempotency-key conflict (samme key, ulik payload) |

## Reservation-flyt (holds)

For aktive runder reserves spilleren's innsats før draw starter:

```typescript
const reservationId = await walletAdapter.reserve({
  walletId, amount, idempotencyKey,
  reason: "GAME1_TICKET_PURCHASE",
});

// Senere: ved vinst
await walletAdapter.releaseReservation({ reservationId, settled: true });

// Eller: ved tap
await walletAdapter.releaseReservation({ reservationId, settled: false });
```

**Expiry:** `WalletReservationExpiryService` cron'er expired reservations (default 30 min etter draw start).

## Anti-fraud pre-commit decoration

Før commit av wallet-mutering kjøres pre-commit-decorators som kan hindre suspekte transaksjoner:
- Limit-sjekker (daily/monthly loss limits)
- Velocity-checks (for mange topup på kort tid)
- KYC-status (ikke-KYC kan ikke withdrawe)
- Self-exclusion (kan ikke spille i 1 år etter selvutestengelse)

**Implementasjon:** Composable hooks i `WalletService.debit`/`.credit`.

## Vanlige feil og hvordan unngå dem

### 1. Direct-INSERT i app_wallet eller app_wallet_transactions
Symptom: Migration eller manuelt skript skriver direkte i wallet-tabeller.
**Fix:** ALDRI direct-INSERT. Bruk WalletService eller WalletAdapter. Direct-INSERT bryter outbox-garantien og hash-chain.

### 2. Glemmer idempotencyKey
Symptom: Network retry trigger dobbeltkrediter.
**Fix:** ALLE wallet-operasjoner MÅ ha `idempotencyKey`. Bruk `IdempotencyKeys.<operation>` for deterministic keys.

### 3. Bruker SERIALIZABLE i stedet for REPEATABLE READ
Symptom: For mye locking, ytelsen lider.
**Fix:** REPEATABLE READ er nok for lost-update-prevention. SERIALIZABLE er overkill og dyrere.

### 4. Hopper over outbox og emitter direkte
Symptom: `socketBroadcaster.emit(...)` etter wallet-mutering.
**Fix:** Skriv til outbox i samme TX. Worker plukker og emitter asynkront.

### 5. Hardkodet `gameType: "DATABINGO"` for Spill 1-3
Symptom: Pre-fix bug (BIN-769) — Spill 1-3 ble feil-klassifisert som databingo.
**Fix:** Bruk alltid `ledgerGameTypeForSlug(slug)`. Aldri hardkodet streng.

### 6. Glemmer hash-chain ved manuelle data-rettelser
Symptom: SQL-update på wallet_transaction bryter chain.
**Fix:** Manuelle rettelser MÅ gå via WalletService med audit-trail. Ellers er chain broken og verifier alarmer.

### 7. Hopper over reconciliation-cron
Symptom: Saldo-drift over tid uten alert.
**Fix:** Sjekk Sentry for `walletReconciliation`-alerts. 21 alerts pre-pilot → 0 post-fix.

### 8. Bypass av cash-withdraw-cap
Symptom: Spiller får > 50k cash i én hall på én dag.
**Fix:** `WalletService.withdraw` MÅ sjekke BIR-036-cap for `paymentType=CASH`.

### 9. Glemmer reservation-expiry
Symptom: Holds blir aldri frigitt etter spill.
**Fix:** `WalletReservationExpiryService` cron'er det. Sjekk at den kjører.

### 10. Idempotency-cache vokser uten cleanup
Symptom: `app_idempotency_cache` tabell vokser i det uendelige.
**Fix:** BIN-767-cron sletter > 90 dager. Verifiser at den kjører.

## Bug-testing-guide

### "Saldo viser feil"
- Kjør `npm run reconcile:wallet` lokalt
- Sjekk `app_wallet_transactions` for spilleren — siste rad bør matche `app_wallet.balance`
- Sjekk om `app_event_outbox` har stuck delivery (delivered_at IS NULL)

### "Dobbeltkrediter / dobbel debit"
- Sjekk idempotency-key brukt av call-site
- Sjekk om to transaksjoner har samme `idempotency_key` men forskjellige tidspunkter
- Cron BIN-767 cleanup sletter etter 90 dager — sjekk om eldre

### "Payout går igjennom selv om saldo er for lav"
- Sjekk REPEATABLE READ isolation i `WalletService.debit`
- Sjekk om limit-sjekk er hoppet over (test på ADMIN-bypass)

### "Outbox-event nådde ikke klient"
- Sjekk `app_event_outbox WHERE delivered_at IS NULL ORDER BY created_at`
- Sjekk `outboxDeliveryCron` Sentry-status
- Manuell retry: `UPDATE app_event_outbox SET retry_count=0 WHERE id=...`

## Når denne skill-en er aktiv

**Gjør:**
- Les `apps/backend/src/wallet/README.md` FØRST
- Bruk `WalletAdapter`-interface for ALL wallet-touch
- Generer deterministic `idempotencyKey` via `IdempotencyKeys.<operation>`
- Bruk REPEATABLE READ-isolasjon for debit-paths
- Skriv events via outbox i samme TX som wallet-mutering
- Verifiser hash-chain etter manuelle data-endringer
- Test både InMemoryWalletAdapter og PostgresWalletAdapter (invariants matcher)
- Bruk `ledgerGameTypeForSlug` for compliance/cap, aldri hardkodet streng

**Ikke gjør:**
- IKKE direct-INSERT i `app_wallet`, `app_wallet_transactions`, eller relaterte tabeller
- IKKE skip idempotency-key
- IKKE emit socket-events utenfor outbox
- IKKE bypass cap-sjekker (BIR-036, single-prize-cap)
- IKKE hardkode `DATABINGO` eller `MAIN_GAME` — bruk `ledgerGameTypeForSlug`
- IKKE manuell-update wallet-rader uten audit-trail
- IKKE introduser ny WalletAdapter-implementasjon uten å speile invariants

## Kanonisk referanse

`apps/backend/src/wallet/README.md` er autoritativ for modul-API. ADR-003 (hash-chain) og ADR-004 (outbox) er bindende design-beslutninger. Spør Tobias før endringer på BIN-761→767-fundamentet.
