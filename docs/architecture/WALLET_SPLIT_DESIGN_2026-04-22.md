# Wallet-split — design-dok (deposit + winnings)

**Status:** Foreslått 2026-04-22. PM-GO kreves før PR-W1.
**Dato:** 2026-04-22
**Forfatter:** Agent (wallet-split-design)
**Scope:** Deling av eksisterende wallet i to logiske konti per spiller — `deposit` (innskudd) og `winnings` (gevinst) — med konsekvens for purchase-flyt, payout-flyt, header-UI, admin-UI og loss-limit-beregning.
**Beslutning kreves:** Godkjenn design + sub-PR-struktur, eller endre scope, eller utsett.

---

## 1. Executive summary

Dagens wallet har én saldo per spiller — både innskudd og gevinster blandes i samme `balance`-kolonne. Tobias har besluttet å splitte denne i to logiske konti: `deposit` (innskudd) og `winnings` (gevinst). Gevinst krediteres til `winnings`, og kjøp trekkes først fra `winnings`, deretter fra `deposit` — kun deposit-trekk teller mot daglig/månedlig tapsgrense. Endringen er forward-only: eksisterende saldo blir stående som `deposit` uten retroaktiv splitt. Leveres i 5 sub-PR-er totalt ca. 1 400–1 700 LOC + migrasjon + tester.

---

## 2. Nåværende wallet-implementasjon

### 2.1 Interface og schema

`apps/backend/src/adapters/WalletAdapter.ts` definerer kontrakten:

```typescript
interface WalletAccount {
  id: string;
  balance: number;      // én felles saldo i kroner
  createdAt: string;
  updatedAt: string;
}

interface WalletAdapter {
  getBalance(accountId): Promise<number>;
  debit(accountId, amount, reason, options?): Promise<WalletTransaction>;
  credit(accountId, amount, reason, options?): Promise<WalletTransaction>;
  topUp(...): Promise<WalletTransaction>;
  withdraw(...): Promise<WalletTransaction>;
  transfer(fromId, toId, ...): Promise<WalletTransferResult>;
  listTransactions(accountId, limit?): Promise<WalletTransaction[]>;
}
```

`PostgresWalletAdapter` (`apps/backend/src/adapters/PostgresWalletAdapter.ts`) persisterer dette som tre tabeller i `wallet`-schemaet:

| Tabell | Kolonner (essens) |
|---|---|
| `wallet_accounts` | `id TEXT PK, balance NUMERIC(20,6), is_system BOOLEAN, created_at, updated_at` |
| `wallet_transactions` | `id, operation_id, account_id, transaction_type, amount, reason, related_account_id, idempotency_key, created_at` |
| `wallet_entries` | `id BIGSERIAL, operation_id, account_id, side ('DEBIT'\|'CREDIT'), amount, transaction_id, created_at` |

Transaksjoner bruker double-entry-ledger: hver logisk operasjon oppretter én `wallet_transactions`-rad og to `wallet_entries`-rader (DEBIT + CREDIT). Systemkontoer `__system_house__` og `__system_external_cash__` er motpart for hhv. interne overføringer og topup/withdrawal.

### 2.2 Debit/credit-flyt

- `debit(walletId, amount, reason)` → overfører `amount` fra `walletId` til `__system_house__`. Kaster `INSUFFICIENT_FUNDS` hvis netto-saldo etter delta < 0 (for ikke-system-kontoer).
- `credit(walletId, amount, reason)` → overfører `amount` fra `__system_house__` til `walletId`.
- `topUp` / `withdraw` → motpart er `__system_external_cash__`.
- Idempotens: Alle metoder tar `TransactionOptions.idempotencyKey`. UNIQUE-index `idx_wallet_transactions_idempotency_key` deduperer — samme key returnerer eksisterende transaksjon uendret.

### 2.3 Bruk i BingoEngine + Game 1

- **Buy-in (BingoEngine)** — `walletAdapter.transfer(player.walletId, houseAccountId, entryFee, ...)` i kjøps-loopen (`BingoEngine.ts:637-650`). Etter transfer kalles `compliance.recordLossEntry({type:"BUYIN", amount})` som bygger netto-tapsgrunnlaget per spiller/hall.
- **Payout (BingoEngine)** — `walletAdapter.transfer(houseAccountId, player.walletId, prize, ...)` (flere steder, f.eks. `:1345`, `:1830`, `:2099`). Etterfølges typisk av `recordLossEntry({type:"PAYOUT", amount})` som reduserer netto-tap i Spillvett-regnestykket.
- **Game 1 scheduled-games ticket-purchase** — `Game1TicketPurchaseService.purchase` kaller `walletAdapter.debit(buyerUserId, total, {idempotencyKey})` for `digital_wallet`-kjøp; `refundPurchase` kaller `walletAdapter.credit` med `idempotencyKey=refund:{purchaseId}`. Agent-kjøp (cash/card) hopper over wallet-flyt.
- **Game 1 payout** — `Game1PayoutService.payoutPhase` kaller `walletAdapter.credit(winner.walletId, prize, {idempotencyKey:g1-phase-...})`. Én credit-feil kaster `PAYOUT_WALLET_CREDIT_FAILED` og caller (Game1DrawEngineService) ruller tilbake hele draw-transaksjonen.

### 2.4 Netto-tap-beregning

`ComplianceManager.calculateNetLoss(walletId, nowMs, hallId)` summerer signerte entries innenfor day/month-vindu: `BUYIN = +amount`, `PAYOUT = -amount`. Returnerer `max(0, daily)` og `max(0, monthly)`. `assertLossLimitsBeforeBuyIn` (`BingoEngine.ts:2991`) blokkerer nye buy-ins når `netLoss + entryFee > limit`.

**Viktig observasjon:** Dagens logikk teller **alle** buy-ins som tap og **alle** payouts som tap-reduksjon, uavhengig av hvilken "konto" pengene kommer fra. Wallet-splitten endrer dette (se §3.4).

---

## 3. Foreslått ny modell

### 3.1 Schema-endring (valgt: 2 kolonner på samme rad)

```sql
ALTER TABLE wallet_accounts
  ADD COLUMN deposit_balance  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN winnings_balance NUMERIC(20,6) NOT NULL DEFAULT 0;

-- Migrering (forward-only): eksisterende `balance` blir `deposit_balance`.
UPDATE wallet_accounts SET deposit_balance = balance WHERE is_system = false;
-- `balance` beholdes foreløpig som generert kolonne for bakover-kompatibilitet:
ALTER TABLE wallet_accounts DROP COLUMN balance;
ALTER TABLE wallet_accounts ADD COLUMN balance NUMERIC(20,6)
  GENERATED ALWAYS AS (deposit_balance + winnings_balance) STORED;
```

**Alternativ vurdert (avvist):** To separate accounts-rader per bruker (ett `-deposit`-suffiks, ett `-winnings`). Gir finere audit-spor i `wallet_entries`, men:
- Dobler antall rader i `wallet_accounts`.
- `getAccount(walletId)` må aggregere to rader.
- `debit-first-winnings-then-deposit` blir to separate transactions (ikke atomisk uten full transfer-bundling).
- Krever mer koordinering mot eksterne integrasjoner (`externalGameWallet.ts`).

2-kolonner-modellen gir samme double-entry-integritet (`wallet_entries` får ny kolonne `account_side` med verdi `'deposit'` eller `'winnings'` — se §3.5) og er enklere å migrere.

### 3.2 Credit-logikk ved payout

Alle `credit`-kall til spiller-wallets går **uendret i signatur** men kreder `winnings_balance`:

```typescript
interface CreditOptions extends TransactionOptions {
  /** default: "winnings" for spiller-credit, "deposit" for refund+topup */
  targetSide?: "deposit" | "winnings";
}

// Ny signatur (bakover-kompatibel):
credit(accountId, amount, reason, options?: CreditOptions): Promise<WalletTransaction>;
```

- **Spill-payout** (`Game1PayoutService`, `BingoEngine.transfer`-payout-path) → `targetSide: "winnings"` (eksplisitt).
- **Refund av kjøp** (`Game1TicketPurchaseService.refundPurchase`) → `targetSide: "deposit"` (eksplisitt — refunderer til opprinnelig konto).
- **Manuell top-up** (`walletAdapter.topUp`) → `targetSide: "deposit"` (hardkodet — topup er alltid deposit).
- **Administrativ credit/correction** fra admin-UI → admin velger i modal, default `"deposit"`.

Default for `credit()` uten eksplisitt `targetSide` blir `"winnings"` (matcher payout-flertall) — men **alle** call-sites oppdateres til å sende eksplisitt verdi i PR-W2 for å unngå tvetydig default-oppførsel.

### 3.3 Debit-logikk ved purchase (winnings-first)

Nytt internt hjelpe-subrutine i `PostgresWalletAdapter`:

```typescript
// Pseudo-kode (faktisk i SQL under BEGIN/COMMIT):
async debit(accountId, amount, reason, options) {
  return await this.withTransaction(async (client) => {
    const acc = await selectForUpdate(client, accountId);
    if (acc.deposit_balance + acc.winnings_balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", ...);
    }
    const fromWinnings = Math.min(acc.winnings_balance, amount);
    const fromDeposit  = amount - fromWinnings;
    // To entries i samme operation_id:
    if (fromWinnings > 0) insertEntry(..., side:"DEBIT", account_side:"winnings", amount:fromWinnings);
    if (fromDeposit  > 0) insertEntry(..., side:"DEBIT", account_side:"deposit",  amount:fromDeposit);
    updateBalance(accountId, { deposit -= fromDeposit, winnings -= fromWinnings });
    insertTransaction({
      ...,
      type: "DEBIT",
      amount,
      meta: { fromWinningsCents: ..., fromDepositCents: ... } // JSONB
    });
  });
}
```

Hele debit-operasjonen er én DB-transaksjon med `SELECT ... FOR UPDATE` på account-raden — ingen race mellom to samtidige debits mot samme wallet.

### 3.4 Loss-limit: kun deposit-trekk teller

**Regelen fra Tobias:** Gevinst-konto-bruk skal ikke telle mot daglig/månedlig tapsgrense. Implementasjon:

- `BingoEngine.buyIn` + `Game1TicketPurchaseService.purchase` får returnert `{ fromWinningsCents, fromDepositCents }` i `WalletTransaction.meta`.
- Kall til `compliance.recordLossEntry({type:"BUYIN", amount})` endres til:
  ```typescript
  // Før:
  amount: playerBuyIn,
  // Etter:
  amount: fromDepositCents / 100,  // kun deposit-delen
  ```
- `type:"PAYOUT"`-entries forblir uendret (payout går alltid til winnings).
- Netto-effekt: Hvis spiller bruker kr 50 winnings + kr 100 deposit på et kjøp → bare kr 100 logges som BUYIN. Payout kr 80 → logges som kr 80 PAYOUT → netto-tap i dag = 100 − 80 = 20.

**Koordinering med verify-netto-loss-agent:** Hvis parallell-agent bekrefter at `calculateNetLoss` allerede produserer korrekt output for dagens én-konto-modell, blir endringen i wallet-split-PR-W5 avgrenset til å justere **amount**-parameteren som sendes inn til `recordLossEntry`. Selve regnestykke-formelen i `ComplianceManager` forblir uendret.

### 3.5 Audit-integritet: `wallet_entries`-endring

```sql
ALTER TABLE wallet_entries
  ADD COLUMN account_side TEXT NOT NULL DEFAULT 'deposit'
    CHECK (account_side IN ('deposit','winnings'));
-- Backfill: alle eksisterende entries er deposit-side.
UPDATE wallet_entries SET account_side = 'deposit' WHERE account_side IS NULL;
```

En `debit`-operasjon med split (winnings + deposit) genererer nå 2 DEBIT-entries (én per side) + 2 CREDIT-entries hos `__system_house__` (fortsatt kun 1 side på systemkonti — `account_side='deposit'` hardkodes for systemkonti for at sum-invariant i audit skal stemme).

---

## 4. Game-client header-endring

### 4.1 Nåværende (én saldo)

`packages/game-client/index.html:205`:
```javascript
`Innlogget som <strong>${data.data.user.displayName}</strong> — saldo: ${data.data.user.balance} kr`;
```

### 4.2 Ny (to saldoer)

```
Innlogget som <strong>Tobias</strong>
┌─────────────────┬──────────────────┐
│ Saldo:  500 kr  │  Gevinst: 1 000 kr│
└─────────────────┴──────────────────┘
```

HTML-struktur:
```html
<div class="wallet-summary">
  <span class="wallet-deposit" aria-label="Innskuddssaldo">
    <span class="label">Saldo</span>
    <span class="value">500 kr</span>
  </span>
  <span class="wallet-divider"></span>
  <span class="wallet-winnings" aria-label="Gevinstsaldo">
    <span class="label">Gevinst</span>
    <span class="value">1 000 kr</span>
  </span>
</div>
```

- `Saldo` venstre (innskudd) — bruker-side; dette er hva brukeren har satt inn.
- `Gevinst` høyre — hva som kan brukes uten at det teller mot grense.
- Brukes-først-regel kommuniseres i tooltip/hjelpeikon: "Gevinster brukes før innskudd ved nye kjøp."

**Backend-kontrakt:** `GET /api/auth/me` og `GET /api/wallet/:id` utvides med:
```json
{
  "balance": 1500,           // bakoverkompatibelt (sum)
  "depositBalance": 500,
  "winningsBalance": 1000
}
```

### 4.3 Animasjon ved gevinst-credit (nice-to-have, post-pilot)

- Ved socket-event `onPhaseWon` / `onWinnerCredit`: `wallet-winnings .value` blinker grønt + teller opp fra gammel verdi til ny (CSS `@keyframes pulse` + JS interval). Utsettes til egen PR — ikke i PR-W3.

---

## 5. Admin-UI-endringer

### 5.1 Player-detail + Wallet-detail

- `apps/admin-web/src/pages/wallets/WalletViewPage.ts` (`renderDetail`) viser i dag kun `account.balance`. Utvides til å vise:
  ```
  Saldo (innskudd):  500,00 kr
  Gevinst:         1 000,00 kr
  Totalt:          1 500,00 kr
  ```
- Adapter `apps/admin-web/src/api/admin-wallets.ts` oppdateres med `depositBalance` + `winningsBalance` i `WalletDetail`.

### 5.2 Transaction-log merker credit-type

- `WalletTransaction.meta` får mulighet for `{fromWinningsCents, fromDepositCents, targetSide}`.
- `WalletViewPage` + `ChipsHistoryTab` får ekstra kolonne "Konto": `CREDIT → winnings` eller `DEBIT → winnings+deposit (split)`.
- For split-debits vises underlinje: `-kr 150 (kr 50 gevinst + kr 100 innskudd)`.

### 5.3 Admin credit/correction-modal

- Ny dropdown i manuell credit-modal: "Til konto: [Saldo (innskudd) / Gevinst]". Default `Saldo`.
- Manual debit-modal forblir uten valg — følger winnings-first-regel.

---

## 6. Migrasjon for eksisterende brukere

**Prinsipp:** Forward-only, ingen retroaktiv splitt.

1. **Schema:** `ALTER TABLE wallet_accounts ADD COLUMN deposit_balance, winnings_balance` (DEFAULT 0).
2. **Data-backfill:** `UPDATE wallet_accounts SET deposit_balance = balance WHERE is_system = false`.
3. **Kolonne-svap:** `balance` erstattes med GENERATED ALWAYS AS (deposit+winnings) STORED for bakoverkompatibilitet.
4. **Entries-backfill:** `ALTER TABLE wallet_entries ADD COLUMN account_side DEFAULT 'deposit'` — alle historiske entries markeres deposit.
5. **Systemkontoer** (`__system_house__`, `__system_external_cash__`) beholder kun `deposit_balance` — `winnings_balance` forblir 0. Constraint: `CHECK (is_system = false OR winnings_balance = 0)`.

**Migrasjons-SQL:** ny fil `apps/backend/migrations/20260501000000_wallet_split_deposit_winnings.sql`. Kjøres via eksisterende migration-runner ved boot av backend (samme path som `20260430000000_app_game1_ticket_purchases.sql`).

**Rollback:** migration er reversibel — ny sum-kolonne kan droppes, deposit/winnings-kolonner kan droppes etter restore av opprinnelig `balance`-kolonne fra sum. Backup før kjøring anbefales.

---

## 7. Sub-PR-struktur

| Sub-PR | Scope | LOC (kode) | Dager |
|---|---|---|---|
| **PR-W1** | Schema-migrasjon + `WalletAdapter`-interface-utvidelse (`depositBalance`, `winningsBalance`, `targetSide`-opsjon på `credit()`). Ingen call-sites endres ennå — default-oppførsel matcher gammel. In-memory/File-adapter oppdatert for test-paritet. | ~250 | 1 |
| **PR-W2** | `PostgresWalletAdapter.debit` → winnings-first-logikk. Nye entries har `account_side`. Alle internal call-sites i BingoEngine + Game1PayoutService + Game1TicketPurchaseService migreres til å sende eksplisitt `targetSide`. Returverdi fra `debit` utvides med `fromWinningsCents`, `fromDepositCents`. Integrasjons-tester (vitest + tx-rollback-test). | ~450 | 2 |
| **PR-W3** | Game-client header-UI (`packages/game-client/index.html` + CSS). Ny struktur for `me`-endepoint + wallet-saldo-render. Visuelt 2-talls-layout + tooltip. | ~200 | 0,5 |
| **PR-W4** | Admin-UI: `WalletViewPage` to-saldo-visning + transaction-log account-side-kolonne + ChipsHistoryTab utvidelse + manuell-credit-modal target-side-dropdown. | ~300 | 1 |
| **PR-W5** | Loss-limit-integrasjon: `recordLossEntry` mottar `fromDepositCents` i stedet for full amount. Oppdaterer BingoEngine:637/1345/1640/1830/1930/2100/2230/2490, Game2Engine:356/452, Game3Engine:513. Enhetstester + cross-game-test for netto-loss-paritet. | ~200 | 1 |
| **Totalt** | | **~1 400 LOC** | **5,5 dager** |

### 7.1 Bundle-vurdering

- PR-W1 og PR-W2 kan ikke bundles — PR-W1 er bakoverkompatibel schema-endring (trygg å merge på egenhånd, blir "død kode" til PR-W2 aktiverer split). Separat merge gir sikker rollback-path.
- PR-W3 + PR-W4 (UI) kan leveres parallelt etter PR-W2 merget.
- PR-W5 er siste — krever at PR-W2s `meta.fromDepositCents` er i prod først.

### 7.2 Test-strategi per PR

- **PR-W1:** Schema-migration-test (opp + ned på postgres-container). Adapter-interface-typesjekk.
- **PR-W2:** Integrasjonstest: `debit` med winnings-first-scenario (3 varianter: alt-winnings / split / alt-deposit), idempotency-retry-test, concurrent-debit-rollback-test.
- **PR-W3:** Vitest-komponent-test + snapshot av header-DOM. Chrome-devtools-mcp manual-QA-pass for visuell validering.
- **PR-W4:** Vitest admin-wire-test for ny kolonne + dropdown-render.
- **PR-W5:** Spillvett-cross-game-test (parallell til eksisterende `spillevett/__tests__/cross-game.test.ts`) som validerer at winnings-spent ikke øker netto-tap.

---

## 8. Estimat

- **Total kode:** ~1 400 LOC + migration-SQL (~50 linjer) + ~400 test-LOC.
- **Kalendertid:** 5,5 dager med én agent sekvensielt. Kan parallelliseres til 3–4 dager med 2 agenter (PR-W3 + PR-W4 parallelt etter PR-W2).
- **Risiko-buffer:** +1 dag for PR-W2 hvis concurrent-debit-test avdekker lock-contention-problem på `SELECT FOR UPDATE` (lite sannsynlig siden eksisterende flyt allerede bruker FOR UPDATE).

---

## 9. Risiko

### 9.1 Dobbel-debit (kritisk)

**Scenario:** To samtidige kjøps-requests for samme spiller, begge kaller `debit(wallet, 100)`. Med naiv read-modify-write kan begge lese `winnings=150`, begge trekker 100 fra winnings → winnings blir −50 (eller bare én går igjennom, andre feiler).

**Mitigering:**
- `SELECT ... FOR UPDATE` på account-raden i hele `debit`-transaksjonen (allerede brukt i eksisterende `executeLedger`).
- Idempotency-key på hver `debit`-kall (eksisterer — retries gir samme resultat).
- Integrasjonstest i PR-W2: 2 parallelle debits → én lykkes, én får `INSUFFICIENT_FUNDS` / returnerer idempotent-hit hvis samme key.

### 9.2 Migration-data-feil

**Scenario:** Produksjons-DB har edge-cases hvor `balance` er negativ, null, eller finnes for system-kontoer med winnings-data — migrasjon kan korrupte data.

**Mitigering:**
- Pre-migration-audit: SQL-rapport som teller (antall rader med balance < 0, NULL, system-kontoer uten 0-balance). Kjøres manuelt før PR-W1 merges.
- Dry-run i staging mot kopi av prod-DB.
- Backup av `wallet_*`-tabeller via `pg_dump` før migrasjon.
- Migration kjører i én transaksjon med CHECK-constraints — feil = automatisk rollback.

### 9.3 Loss-limit-regresjon

**Scenario:** Etter PR-W5 blir det plutselig lettere å overskride grense (fordi tidligere ble winnings-spent logget som BUYIN og "telte med"). En spiller som brukte gevinster + innskudd om hverandre kan nå kjøpe mer — utilsiktet.

**Mitigering:**
- Eksplisitt dokumentasjon til pilot-hallene: "Endring i Spillvett-beregning 2026-05-XX: kun innskudd teller mot grense."
- Cross-game-test validerer at kun `fromDepositCents` teller.
- PM-avklaring (se §10, spørsmål 1) før PR-W5 merges.

### 9.4 Unity-klient-ut-av-sync

**Scenario:** Unity-klienten (Game 1/2/3) leser `balance` fra wire-kontrakten. Hvis Unity ikke oppdateres til å vise splitt, kan spiller se feil tall.

**Mitigering:**
- `balance`-feltet beholdes i API (sum av deposit+winnings) — Unity kan fortsette å rendre dette.
- Wire-kontrakten dokumenteres i `WIRE_CONTRACT.md` — split-feltene er additive (`depositBalance`, `winningsBalance` som opt-in).
- Shell/web-header viser splitten; Unity fortsetter med én-tall-visning inntil Unity-team oppdaterer. Avvik dokumenteres per `project_unity_parity_rule.md`.

### 9.5 Eksterne wallet-integrasjoner

**Scenario:** `externalGameWallet.ts` + Candy-integrasjon antar ett balance-felt. Split-endring kan bryte Candy-iframe-contract.

**Mitigering:**
- `balance`-felt beholdes som sum (generated column) — eksisterende kontrakter uberørt.
- Ingen push av `depositBalance`/`winningsBalance` til Candy-contract i første runde.
- Egen PR post-pilot hvis Candy skal bruke splitt.

---

## 10. Åpne spørsmål til PM

1. **Spillvett-regelverk-klargjøring:** Norsk pengespillforskrift §-regel for "tap" — er det juridisk sikkert at winnings-spent *ikke* teller som tap? Vurderes som sikkert teknisk, men PM bør bekrefte mot regulatorisk kilde. Verify-netto-loss-agent-resultat kan inngå som input.
2. **Topup defaults til deposit:** Skal bankID-topup / Swedbank-pay-topup alltid lande på `deposit`-konto, eller vil vi i fremtiden tillate en "gevinst-topup-sti" (eks. bonusprogram)? Anbefalt: hardkod til `deposit` nå, utvides ved behov.
3. **Withdrawal-prioritering:** Ved uttak — trekk fra deposit først (beskytter winnings) eller winnings først (rydder opp)? Regulatorisk: gevinst må kunne tas ut når som helst. Anbefalt: deposit først (konsistent med wallet-metafor).
4. **Manuell admin-debit (korreksjoner):** Skal admin kunne velge hvilken konto en korreksjon trekkes fra, eller følge winnings-first-regel? Dagens anbefaling: samme regel som spiller.
5. **Retroaktiv splitt for utvalgte brukere:** Blir det ønsket å kunne konvertere eksisterende balance til `winnings`-split basert på historisk payout-data (via `wallet_transactions` med type=CREDIT)? Post-pilot-vurdering — utenfor dette designs scope.
6. **Header-tekst-wording:** `Saldo` / `Gevinst` er Tobias' foreslåtte tekst. Alternativt `Innskudd` / `Gevinst` (mer presis) eller `Kontant` / `Bonus` (mer marketing-vennlig). PM velger.
7. **Unity-klient-timing:** Skal Unity-team få en egen mini-spec for å vise split i Game 1/2/3 UI, eller forblir dette web-shell-ansvar inntil post-pilot? Anbefalt: shell-only nå.
8. **Admin-wallet-credit-default-side:** `deposit` eller `winnings`? Admin-credit er typisk compensasjon → anbefalt `deposit`. Men "bonus-utdeling" → `winnings`. PM velger default + dropdown-fallback.

---

## 11. Referanser

- `apps/backend/src/adapters/WalletAdapter.ts` — interface
- `apps/backend/src/adapters/PostgresWalletAdapter.ts` — schema + ledger-logikk
- `apps/backend/src/game/BingoEngine.ts:637-650, 1345, 2991-3018` — buy-in, payout, loss-limit-guard
- `apps/backend/src/game/ComplianceManager.ts:554, 661-685` — `recordLossEntry`, `calculateNetLoss`
- `apps/backend/src/game/Game1PayoutService.ts:204-243` — winner-credit-loop
- `apps/backend/src/game/Game1TicketPurchaseService.ts:12-22` — purchase/refund wallet-hook
- `apps/admin-web/src/pages/wallets/WalletViewPage.ts` — admin-UI mål for PR-W4
- `packages/game-client/index.html:205` — header-UI mål for PR-W3
- `docs/architecture/CANDY_SPILLORAMA_API_CONTRACT.md` — eksterne integrasjoner (uendret i første runde)
- `docs/architecture/WIRE_CONTRACT.md` — wire-contract for Unity
- Memory: `project_regulatory_requirements.md`, `project_spillvett_implementation.md`

---

**Ikke-mål for wallet-split-designet (eksplisitt):**
- Ingen endring av systemkonti (`__system_house__`, `__system_external_cash__`) — disse forblir én-saldo.
- Ingen endring av Candy-kontrakt eller `externalGameWallet.ts`-integrasjon i første runde.
- Ingen Unity-UI-endring — spillklient-split er shell-only inntil post-pilot.
- Ingen retroaktiv splitt av historisk saldo — forward-only.
- Ingen endring av `calculateNetLoss`-formelen — kun `recordLossEntry`-input-amount endres.
