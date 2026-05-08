# R6 — Outbox-validering for rom-events (BIN-818)

**Status:** Lukket — alle rom-events går gjennom outbox.
**Dato:** 2026-05-08
**Mandat-ref:** [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.6 + §5 R6](./LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
**Linear:** [BIN-818](https://linear.app/bingosystem/issue/BIN-818)

---

## 1. Mål

Verifisere at alle wallet-touch som trigges av rom-events (ticket-purchase,
payout, mini-game-credit, jackpot-credit, pot-credit) går via wallet-outbox-pattern
(BIN-761). Ingen socket-handler eller game-engine-flyt skal kunne bypasse
outbox-en.

Mandat-krav (§3.6):
- Aldri belaste lommebok uten at ticket-rad faktisk er commit-et.
- Aldri utbetale premie uten audit-event.
- Outbox-pattern skal brukes for alle wallet-touch fra rom-event.

## 2. Audit-omfang

Auditert mappe-tre:
- `apps/backend/src/sockets/` (alle socket-handlers)
- `apps/backend/src/game/` (alle engine-services + mini-games + pot-evaluator)

Søkt etter:
- Direkte INSERT/UPDATE mot wallet-tabeller (`wallet`, `wallet_account`, `wallet_balance`, `wallet_outbox`, `wallet_entries`, `wallet_transactions`).
- Wallet-call-sites som ikke bruker `walletAdapter`-interface
  (`debit`, `credit`, `creditWithClient`, `transfer`, `topUp`, `withdraw`,
  `reserve`, `increaseReservation`, `releaseReservation`, `commitReservation`).

## 3. Resultat

### 3.1 Direkte wallet-tabell-writes utenfor adapter

**Funn:** Ingen.

`grep -rn "INSERT INTO.*wallet_\|UPDATE.*wallet_account\|wallet_outbox\|wallet_transactions"` på
`src/{game,sockets}` returnerer **kun** kommentarer i `README.md` + en read-only
JOIN i `Game1ReplayService.ts`. Ingen mutating-statements.

`PostgresResponsibleGamingStore.ts` skriver til `personal_loss_limits` og
`loss_entries` — det er compliance-tabeller (ikke wallet-ledger). Disse er ute
av scope for wallet-outbox.

### 3.2 Wallet-call-sites — funnel-analyse

Auditert 50 wallet-call-sites på tvers av 21 filer i `src/{game,sockets}`. Alle
bruker `WalletAdapter`-interface. Distribusjon:

| Fil | Antall | Metoder brukt |
|---|---:|---|
| `BingoEngine.ts` | 4 | transfer, commitReservation |
| `BingoEngineMiniGames.ts` | 2 | transfer (Jackpot, Spin) |
| `BingoEngineRecovery.ts` | 1 | transfer (refund-replay) |
| `ClaimSubmitterService.ts` | 1 | transfer (claim-payout) |
| `ComplianceLedgerOverskudd.ts` | 1 | transfer (organisations-distribusjon) |
| `Game1DrawEngineDailyJackpot.ts` | 1 | credit |
| `Game1DrawEngineService.ts` | 1 | credit |
| `Game1PayoutService.ts` | 1 | credit |
| `Game1TicketPurchaseService.ts` | 3 | debit (purchase), credit (compensate, refund) |
| `Game2Engine.ts` | 4 | transfer (buy-in, payout) |
| `Game3Engine.ts` | 3 | transfer (buy-in, payout) |
| `PhasePayoutService.ts` | 1 | transfer (phase-payout) |
| `minigames/Game1MiniGameOrchestrator.ts` | 3 | credit, creditWithClient |
| `minigames/MiniGameOddsenEngine.ts` | 1 | credit |
| `pot/PotEvaluator.ts` | 1 | credit |
| `sockets/gameEvents/roomEvents.ts` | 3 | reserve, increaseReservation, releaseReservation |
| `sockets/gameEvents/ticketEvents.ts` | 2 | releaseReservation |

### 3.3 Outbox-funnel-verifisering

Alle ledger-mutating metoder funnel-er gjennom `PostgresWalletAdapter.executeLedger()`,
som atomisk enqueuer en outbox-rad per påvirket spiller-konto i samme DB-tx
som ledger-INSERT-en. Verifisert i kode:

```
adapter.debit               → singleAccountMovement → executeLedger → outboxRepo.enqueue
adapter.credit              → singleAccountMovement → executeLedger → outboxRepo.enqueue
adapter.creditWithClient    → singleAccountMovementWithClient → executeLedger → outboxRepo.enqueue
adapter.topUp               → singleAccountMovement → executeLedger → outboxRepo.enqueue
adapter.withdraw            → singleAccountMovement → executeLedger → outboxRepo.enqueue
adapter.transfer            → transferImpl (REPEATABLE READ tx) → executeLedger → outboxRepo.enqueue
adapter.commitReservation   → commitReservationImpl → executeTransferInTx → executeLedger → outboxRepo.enqueue
```

Reservation-operasjoner som ikke flytter penger skriver IKKE outbox:
```
adapter.reserve              → INSERT i wallet_reservations (kun saldo-lås, ingen ledger-mutasjon)
adapter.increaseReservation  → UPDATE wallet_reservations.amount_cents (kun saldo-lås)
adapter.releaseReservation   → UPDATE wallet_reservations.status (kun saldo-lås)
```

Dette er korrekt: reservasjoner er saldo-lås, ikke pengebevegelser. Outbox-event
skrives først ved `commitReservation` når reservasjonen blir til en faktisk
ledger-debit.

### 3.4 System-konto-filter

`executeLedger` filtrerer system-konti (`__system_house__`,
`__system_external_cash__`) bort fra outbox-enqueue (linje 1410-1438 i
`PostgresWalletAdapter.ts`). Dette er bevisst: system-konti har ingen klient
som abonnerer på `wallet:state`-broadcasts, og halverer outbox-volumet.

## 4. Atomicity-test-coverage

### 4.1 Eksisterende coverage (etablert pre-R6)

- **CRIT-6** (`BingoEngine.crit6Atomicity.test.ts`): wallet-transfer-feil ruller
  ikke state-mutasjoner. State settes ETTER vellykket transfer.
- **CRIT-6** (`BingoEngine.crit6PostTransferRecovery.test.ts`): post-transfer
  feil → idempotency-key sikrer at retry ikke dobbel-betaler.
- **Crash-recovery-partial-payout** (`BingoEngine.crashRecoveryPartialPayout.test.ts`):
  multi-vinner-payout der server krasjer mid-flyt → unik idempotency-key per
  vinner sikrer at recovery + idempotency unngår dobbel-utbetaling.
- **CRIT-5** (`Game1MiniGameOrchestrator.crit5Atomicity.test.ts`): mini-game
  credit + UPDATE i samme caller-tx via `creditWithClient`.
- **BIN-761** (`PostgresWalletAdapter.outbox.test.ts`): topup/transfer/credit
  produserer pending outbox-rader atomisk.

### 4.2 Ny R6-coverage (denne PR)

Lagt til `apps/backend/src/wallet/RoomEventsOutboxValidation.test.ts` med seks
integrationstester (skip-pattern matcher BIN-761-tester):

1. **Ticket-purchase-debit produserer 1 pending outbox-rad atomisk.** Simulerer
   `Game1TicketPurchaseService.purchase`-shape: `wallet.debit()` → wallet er
   debitert OG outbox har én pending-rad i samme tx.
2. **Payout-transfer produserer outbox-rad for spiller (system filtreres).**
   Simulerer payout via `transfer(house, player)` med `targetSide: "winnings"`.
3. **Idempotency-replay skriver IKKE duplikat outbox-rad.** Samme idempotency-key
   på to debit-kall → første får outbox-rad, andre returnerer eksisterende.
4. **Crash-mid-flow: debit + compensating credit gir 2 outbox-rader.** Speiler
   `Game1TicketPurchaseService` sin compensating-flyt — netto wallet-saldo = 0,
   men begge ledger-mutasjoner har egne outbox-events.
5. **Reservation-only ops skriver IKKE outbox.** reserve/increase/release har
   ingen ledger-mutasjon → ingen outbox.
6. **commitReservation produserer outbox-rad.** Reservation-til-debit-overgang.

### 4.3 Statisk guard

Lagt til `apps/backend/src/wallet/RoomEventsWalletGuard.test.ts` som
grep-baserte test som scanner `src/{game,sockets}` for:

- Direkte INSERT/UPDATE mot wallet-tabeller (allowlist-validert).
- Bruk av `pool.query` eller `client.query` med wallet-tabell-navn i
  rom-handlers.

Hvis en framtidig endring introduserer en bypass, vil testen feile på CI før
den kommer i prod.

## 5. Refaktorering

**Antall call-sites refaktorert:** 0.

Begrunnelse: Audit avdekket at alle eksisterende rom-event-paths allerede
bruker `WalletAdapter`-interface korrekt. Outbox-laget (BIN-761) ble lagt til
som decorator i adapter-en, slik at hver `executeLedger`-call automatisk
produserer outbox-rader. Ingen socket-handler eller game-engine-flyt eier
egne wallet-skrivinger.

## 6. Crash-recovery-egenskaper

Den eksisterende arkitekturen gir følgende garantier ved instans-krasj:

| Krasj-punkt | Wallet-state | Outbox-state | Klient-state |
|---|---|---|---|
| Før `wallet.debit()` returnerer | Tx rollback (REPEATABLE READ) | Ingen rad (i samme rollback-tx) | Klient får 5xx, retry med samme idempotency-key gir samme resultat |
| Etter `wallet.debit()`, før purchase-INSERT | Wallet debitert + outbox pending | Pending outbox-rad | Compensating-credit-blokk i `Game1TicketPurchaseService` ruller debit tilbake (samme idempotency-pattern) |
| Etter purchase-INSERT, før outbox-worker dispatch | Wallet + outbox commit-et | Pending → worker plukker opp ved restart | Klient får succes på neste reconnect, eller via `wallet:state`-push |
| Etter outbox-worker dispatch, før klient-ack | Permanent | Marker `processed` | Klient får retry-broadcast på neste reconnect (idempotent på klient-side) |

Mandat §3.6-krav er oppfylt:
- **Ingen wallet-debitert-uten-purchase-rad** → idempotency-key + compensating
  credit i `Game1TicketPurchaseService` (linje 433-486).
- **Ingen payout-uten-audit** → `executeLedger` skriver `wallet_transactions`
  + `wallet_entries` (med hash-chain) + outbox i samme tx.

## 7. Rest-risiko (akseptert)

### 7.1 Pot-jackpot-credit feil etter pot-decrement

`PotEvaluator.ts:520-560` har `failPolicy: "swallow"` for jackpot-pots: hvis
`walletAdapter.credit()` feiler etter at pot-eventet er commit-et i
`pot_events`, blir det en mismatch som krever manuell admin-refund. Dette er
**akseptert risiko** og dokumentert i koden.

Mitigation: jackpot-credit-feil logges på `[PR-T2]` med full kontekst —
ops kan grep-e logger for å fange manuell-refund-kandidater.

### 7.2 Outbox-worker dead-letter

Etter 5 mislykkede dispatch-forsøk merkes outbox-rad som `dead_letter` og
krever manuell ops-replay. Dette er ikke tap av penger (wallet er korrekt) —
kun mistet `wallet:state`-broadcast som klient kan re-fetche via HTTP.

## 8. Endringer i denne PR

1. `docs/architecture/R6_OUTBOX_VALIDATION_ROOM_EVENTS_2026-05-08.md` — denne audit-doc.
2. `apps/backend/src/wallet/RoomEventsOutboxValidation.test.ts` — integrationstester for crash-recovery atomicity (krever Postgres; skipper uten DB).
3. `apps/backend/src/wallet/RoomEventsWalletGuard.test.ts` — statisk guard mot direkte wallet-tabell-writes utenfor adapter.

## 9. Pilot-gating

Dette tiltaket er på R6-nivå i mandatet — kan være planlagt **etter pilot går
live**. Ettersom audit-en avdekket at outbox-en allerede er fullt funksjonell
for rom-events, er R6 effektivt lukket før pilot.

## 10. Referanser

- BIN-761 → 764 — wallet-outbox + REPEATABLE READ + nightly reconciliation + hash-chain audit
- `apps/backend/src/wallet/WalletOutboxRepo.ts` — outbox-repository
- `apps/backend/src/wallet/WalletOutboxWorker.ts` — outbox-dispatch-worker
- `apps/backend/src/adapters/PostgresWalletAdapter.ts` — `executeLedger` med outbox-enqueue (linje 1410-1438)
- `apps/backend/src/adapters/PostgresWalletAdapter.outbox.test.ts` — BIN-761 outbox-test-coverage
- `apps/backend/src/game/BingoEngine.crit6Atomicity.test.ts` — CRIT-6 atomicity-tester
- `apps/backend/src/game/BingoEngine.crashRecoveryPartialPayout.test.ts` — partial-payout crash-recovery
