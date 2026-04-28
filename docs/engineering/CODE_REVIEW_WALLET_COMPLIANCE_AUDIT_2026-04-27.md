# Code Review: Wallet + Compliance + Audit-trail (RESPAWN-2)

**Dato:** 2026-04-27
**Reviewer:** Code-reviewer agent
**Branch:** `docs/code-review-wallet-compliance-audit-2026-04-27`
**Scope:** Wallet money-safety, compliance §71 multi-hall, self-exclusion fail-closed, audit-log integritet, cross-module samspill.

## Sammendrag

Wallet-laget (PostgresWalletAdapter) er solid casino-grade — REPEATABLE READ + retry, `FOR UPDATE`-låsing, compensation-pattern, DB-UNIQUE på idempotency-key, hash-chain audit. Compliance-laget har derimot **strukturelle hull** rundt selve §71-write-path: random UUID uten dedup, soft-fail-pattern, og — kritisk — **ingen compliance-gate før REST-purchase**. En selvutestengt spiller kan kjøpe billetter via REST.

| Severity | Antall |
|---|---:|
| **P0** (regulatorisk/money-loss) | **4** |
| **P1** (polish) | **3** |
| **P2** (nice-to-have) | **2** |

## Top 3 P0

1. **Selvutestengt spiller kan kjøpe Spill 1-billetter via REST** — `apps/backend/src/routes/game1Purchase.ts:156` kaller `purchaseService.purchase()` uten `engine.assertWalletAllowedForGameplay()`-gate. Socket-pathen i `game1ScheduledEvents.ts:353` har gaten. **§23 + §66**.
2. **Self-exclusion mutes in-memory FØR persist** — `ComplianceManager.ts:484-486` setter `state.selfExcludedAtMs` og awaiter persist etterpå. På persist-failure: in-memory excluded, DB ikke. Etter restart → exclusion tapt (hydrate fra DB).
3. **ComplianceLedger har ingen idempotency-nøkkel** — `ComplianceLedger.ts:170` bruker `randomUUID()` per call. Ingen UNIQUE-constraint i `app_rg_compliance_ledger` (initial_schema.sql:369). Retry/dobbel-kall = duplikat-rader → §71-rapport teller dobbelt.

## Findings detaljert

### [P0] Game1 ticket-purchase mangler compliance-gate

**ISSUE:** `apps/backend/src/routes/game1Purchase.ts:96-167` autentiserer + RBAC-sjekker, men kaller IKKE `assertWalletAllowedForGameplay()` eller `wouldExceedLossLimit()` før `purchaseService.purchase()` debiterer wallet. Sammenlign med `sockets/game1ScheduledEvents.ts:352-353` som gjør begge.

**SAMSPILL:** route → Game1TicketPurchaseService.purchase() → wallet.debit() → complianceLoss.recordLossEntry (soft-fail, AFTER debit).

**RISIKO:** Spiller med aktiv self-exclusion eller mandatory pause kan kjøpe via REST. Bryter pengespillforskriften §23 (selvutestengelse) og §66 (mandatory pause).

**FIX:** Etter linje 154 (før `purchaseService.purchase`):
```typescript
if (paymentMethod === "digital_wallet") {
  const buyer = await platformService.getUserById(buyerUserId);
  engine.assertWalletAllowedForGameplay(buyer.walletId);
  // dailyLossLimit-sjekk via wouldExceedLossLimit(buyer.walletId, totalAmountCents/100, Date.now(), hallId)
}
```

### [P0] ComplianceManager.setSelfExclusion fail-open ved persist-failure

**ISSUE:** `apps/backend/src/game/ComplianceManager.ts:473-488`. Lines 484-485 muterer `state` i Map (ref-deling fra `getRestrictionState`). Linje 486 awaiter `persistRestrictionState`. Hvis DB feiler:
- Exception bubler opp til caller
- In-memory state har `selfExcludedAtMs` satt
- DB har IKKE state
- Server-restart → `hydrateFromSnapshot` rebuilder fra DB → exclusion borte

**SAMSPILL:** ProfileSettingsService → ComplianceManager.setSelfExclusion → persist (PG) → hydrate-on-restart.

**RISIKO:** Hvis Postgres er treg/down i øyeblikket spiller utesteneger seg, kan eksklusjonen gå tapt. Spillvett-modal viser "blokkert" → spiller forsøker igjen senere → ny attempt-fail → endelig restart sletter alt.

**FIX:** Persist FØRST, mutér in-memory etter. Eller: bruk transactional outbox-pattern. Pseudo:
```typescript
// Persist først til DB (autoritativt)
await this.persistence.upsertRestriction({...});
// Deretter mutér in-memory
state.selfExcludedAtMs = nowMs;
state.selfExclusionMinimumUntilMs = nowMs + this.selfExclusionMinMs;
this.restrictionsByWallet.set(walletId, state);
```

Samme fix-mønster for `setTimedPause` (linje 446-449), `clearTimedPause` (linje 467-469), `clearSelfExclusion` (linje 507-509).

### [P0] ComplianceLedger random UUID uten dedup → §71-duplikater

**ISSUE:** `apps/backend/src/game/ComplianceLedger.ts:170` setter `id: randomUUID()` på hver `recordComplianceLedgerEvent`-call. Schema (`migrations/20260413000001_initial_schema.sql:369-389`): `id TEXT PRIMARY KEY` men INGEN UNIQUE på `(eventType, claimId, gameId, playerId)` eller annet logisk sett.

`Game1TicketPurchaseService.ts:606` og `Game1PayoutService.ts:390/430` setter `claimId` og `gameId` i metadata, men disse er ikke unique-constrained.

**SAMSPILL:** Game1TicketPurchaseService → recordComplianceLedgerEvent. Soft-fail-mønster (try/catch warn) gjør retry mulig — men retry skriver duplikat. Wallet-tx er allerede committed.

**RISIKO:** §71 daglig rapportering teller stake/prize dobbelt. Hvis `recordComplianceLedgerEvent` retries (via outer retry/cron-replay), én billett-debit gir to STAKE-rader → rapport sier dobbel innsats. Lotteritilsynet-revisjon: kan ikke avgjøre om duplikat-rad er reell hendelse eller retry-artefakt.

**FIX:** Legg til logisk idempotency-key. Migrasjon:
```sql
ALTER TABLE app_rg_compliance_ledger
  ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_rg_ledger_idempotency
  ON app_rg_compliance_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```
Call-sites: bruk f.eks. `${eventType}:${gameId}:${claimId ?? playerId}:${nonce}` som key. Gjør write idempotent — retry returner eksisterende rad.

### [P0] STAKE/PRIZE compliance-write soft-fail uten retry-mekanisme

**ISSUE:** `Game1TicketPurchaseService.ts:625-636` (`STAKE feilet — purchase fortsetter`), `Game1PayoutService.ts:419-423` (`PRIZE feilet — payout fortsetter`), `recordLossEntry` (line 549-557, BUYIN feilet). På failure logges warn og purchase/payout fortsetter — men det finnes ingen retry-job som plukker opp manglende rader.

**SAMSPILL:** Wallet-debit → soft-fail compliance-write → orphaned wallet-tx uten ledger-binding.

**RISIKO:** §71-rapport lekker reelt salg/utbetaling. Hvis 1% av kjøp feiler compliance-write under DB-load, går rapport-tall under faktisk omsetning → §11 fordeling til organisasjoner blir feil.

**FIX:** Outbox-pattern. Skriv compliance-event til `compliance_outbox`-tabellen i SAMME tx som wallet (eller wallet-tx-row). Worker (kombiner med `WalletOutboxWorker.ts`) plukker opp og skriver til `app_rg_compliance_ledger`. På feil: backoff + retry. Gir at-least-once delivery — krever idempotency-key (P0 #3 over).

### [P1] WalletAuditVerifier: NULL-hash-row breaker chain-validation

**ISSUE:** `apps/backend/src/wallet/WalletAuditVerifier.ts:168-172`. Når en rad har `entry_hash IS NULL`, resetter verifier `lastStoredHash = WALLET_HASH_CHAIN_GENESIS` og hopper videre uten å rapportere det som mismatch (kun teller `legacyUnhashed`).

**SAMSPILL:** En attacker som kan UPDATE wallet_entries (DB-bypass) kan NULL-out `entry_hash`-feltet på tampered rad → verifier tolker det som "legacy" og linker den nye chain-en til genesis.

**RISIKO:** Hash-chain-tamper-detection er kompromittert hvis legacy-graceful-mode er aktiv. BIN-764 sin regulatoriske premiss er at chain ikke kan brytes uten alarmer.

**FIX:** Etter migrering-cutoff (rad-id > LEGACY_CUTOFF), behandle NULL-hash som `missing_hash`-mismatch.

### [P1] AuditLogService: PII-redaction whitelist for snever

**ISSUE:** `apps/backend/src/compliance/AuditLogService.ts:101-117`. `REDACT_KEYS` har eksakt-match på lower-case key, men dekker ikke:
- `pin`, `loginPin` (REQ-130 phone+PIN-login)
- `phone`, `phoneNumber` (norsk persondata)
- `email` (kontekstavhengig PII)
- `birthDate`, `birthdate` (PII)
- `iban`, `bankAccount`, `accountNumber` (regnskapsdata, BIN-586)
- `kid`, `kidNummer`

**SAMSPILL:** Audit-log-skrivere over hele kodebasen kan logge personnummer/PIN i `details`-objektet uten å vite det. Pino-redaction filtrerer fra structured logs men ikke fra audit_log-tabellen.

**RISIKO:** GDPR-violation: PII i audit-trail-tabell uten rettferdiggjørelse + retention-policy.

**FIX:** Utvid REDACT_KEYS. Vurder regex-pattern på keys som starter med `pin*`, `*Number`, `birth*`. Oppretthold pino-redaction-paritet.

### [P1] singleAccountMovement idempotency-check via separat connection

**ISSUE:** `apps/backend/src/adapters/PostgresWalletAdapter.ts:1043-1048` (i `singleAccountMovementWithClient`). Idempotency-sjekk bruker `pool.query` på egen connection. Hvis samme idempotency-key skrives via en annen committed tx mens caller's tx allerede er åpen, returneres ikke-existing → caller skriver ny rad → DB UNIQUE feiler ved INSERT (linje 1554) → caller's tx ruller tilbake.

**SAMSPILL:** `creditWithClient` (Game1MiniGameOrchestrator) → idempotency-sjekk uses-pool.query → vinning kan rulle tilbake hvis race med en annen path.

**RISIKO:** Mini-game payout som dobbel-trigges (race) får ROLLBACK på siste, men UI-respons ble allerede sendt. Mitigert av at DB UNIQUE er definitivt — ingen reell duplisering, bare korrupt UX.

**FIX:** Aksepter at INSERT-failure er den autoritative idempotency-sjekken. Catch 23505 (unique_violation) etter executeLedger og return existing tx.

### [P2] ComplianceLedger.complianceLedger har 50_000-cap (in-memory)

**ISSUE:** `ComplianceLedger.ts:191-193`. In-memory array trimmes til 50k entries. Pengespillforskriften krever 5-års oppbevaring.

**RISIKO:** I prod kan listComplianceLedgerEntries() returnere ufullstendig hvis kall ikke når DB. Generator-rapporter bruker in-memory cache.

**FIX:** Verifiser at all rapport-generering går via DB (via `persistence`-adapter), ikke in-memory cache.

### [P2] Retention-cutoff i calculateNetLoss er heuristic

**ISSUE:** `ComplianceManager.ts:660` setter `retentionCutoffMs = monthStartMs - 35 * 24 * 60 * 60 * 1000` (35 dager før måned-start). Dette er en heuristikk for "alle entries siste måned + buffer". Men §11-rapport krever data per kalenderdag/-måned eksakt.

**FIX:** Bruk eksplicit grenser. Konfigurerbart via env.

## Anbefaling for prod

P0 #1 og #2 må fikses før første pilot-hall går live. P0 #3 + #4 er regulatorisk hygiene — kan landes parallelt eller umiddelbart post-pilot, men ikke senere. P1 + P2 er polish.

## Cross-module samspill (oppsummert)

| Flyt | Path | Risiko |
|---|---|---|
| REST-purchase | route → service → wallet.debit → recordLossEntry (soft-fail) | P0 #1 + #4 |
| Self-exclusion | ProfileSettingsService → ComplianceManager (in-memory mutasjon før persist) | P0 #2 |
| Wallet-credit (mini-game) | Engine → creditWithClient (separat idempotency-tx) | P1 |
| Compliance write | recordComplianceLedgerEvent (random UUID, soft-fail) | P0 #3 + #4 |
| Audit verification | nightly cron → WalletAuditVerifier (NULL-hash bypass) | P1 |
