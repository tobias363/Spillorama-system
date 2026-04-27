# Pre-pilot code review — payments + agent (Bølge B)

**Reviewer:** Code-reviewer subagent (Claude Opus 4.7, 1M ctx)
**Dato:** 2026-04-26
**Scope:** `apps/backend/src/payments/*` + `apps/backend/src/agent/*` + tilhørende routes (`payments.ts`, `paymentRequests.ts`, `agent*.ts`)
**Out of scope:** Spill 1-spesifikk kode (PR #499), compliance/wallet (Bølge A — PR #513), admin/spillevett (Bølge C senere), filer endret av kjørende K3-agenter

**Oppsummering (count per kategori):**

| Kategori | ✅ | ⚠️ | ❌ |
|---|---|---|---|
| Correctness | 12 | 6 | 4 |
| Compliance | 8 | 4 | 3 |
| Security | 9 | 3 | 1 |
| Test coverage | 11 | 5 | 4 |
| Architecture | 10 | 3 | 0 |
| Docs drift | 4 | 2 | 1 |

**Pilot-readiness-verdict:** **REQUEST_CHANGES** — fire kritiske bugs (idempotens, machine-payout-split, openDay-race, missing admin-force-route) må adresseres før pilot. Andre funn er COMMENT_ONLY eller follow-up for etter pilot. Detaljerte "Specific change requests" nederst.

---

## Top 3 critical issues

### 1. ❌ KRITISK — `processCashOp` lager fersk `txId` per call → idempotency-key er ustabil

**Fil:** `apps/backend/src/agent/AgentTransactionService.ts:295-301`

```typescript
const txId = `agenttx-${randomUUID()}`;
const idempotencyKey = IdempotencyKeys.agentTxWallet({ txId });
```

`txId` genereres frisk per request, så ved nettverks-retry (agent klikker "Cash In" igjen etter timeout) får servicen en NY idempotencyKey → `WalletAdapter.credit/debit` vil oppfatte det som en NY operasjon → DOBBEL-DEBIT/DOBBEL-CREDIT på spilleren.

`clientRequestId` ER en input-parameter og BURDE vært brukt som basis for idempotencyKey, men er kun lagret i `reason`-tekst og `otherData`.

**Pilotrisiko:** En registrert agent kan ved et tilfellig nettverk-glitch dobbel-belaste en spillers wallet. Dette er en compliance-feil (manglende idempotens på pengeflyt) og en kundeopplevelse-feil. Wireframe 17.7/17.8-flyten har eksplisitt `clientRequestId` for nettopp dette formålet.

**Fix:**
```typescript
const idempotencyKey = IdempotencyKeys.agentTxWallet({
  agentUserId: input.agentUserId,
  clientRequestId: input.clientRequestId,
});
```
+ utvid `IdempotencyKeys.agentTxWallet` til å akseptere `agentUserId + clientRequestId` i stedet for `txId`.

Samme bug-mønster i:
- `MetroniaTicketService.createTicket` (line 142-144) — `ticketId = mtkt-${randomUUID()}` gir fersk `uniqueTransaction` per retry. Dette er FARLIGERE fordi en retry vil opprette en ny Metronia-ticket OG dobbel-debitere spilleren.
- `OkBingoTicketService.createTicket` (line 140-141) — samme.

Ikke-bug (verifisert OK):
- `MetroniaTicketService.topupTicket/closeTicket/voidTicket` bruker `ticket.id` fra DB → stabilt.
- `OkBingoTicketService.topupTicket/closeTicket/voidTicket` — samme.
- `AgentTransactionService.sellPhysicalTicket` bruker `ticket.uniqueId` → stabilt.
- `AgentTransactionService.registerDigitalTicket` bruker `clientRequestId` → stabilt.
- `AgentTransactionService.cancelPhysicalSale` bruker `originalTxId` → stabilt.
- `AgentProductSaleService.finalizeSale` bruker `cartId` → stabilt.

### 2. ❌ KRITISK — Metronia/OkBingo payouts krediteres til deposit-side, ikke winnings-side

**Fil:** `apps/backend/src/agent/MetroniaTicketService.ts:307-316` (`closeTicket`), 378-388 (`autoCloseTicket`)
**Fil:** `apps/backend/src/agent/OkBingoTicketService.ts:303-313` (`closeTicket`), 369-378 (`autoCloseTicket`)

```typescript
const walletTx = await this.wallet.credit(
  player.walletId,
  payoutNok,
  `Metronia payout ${ticket.id}`,
  { idempotencyKey: ... }   // ⬅ ingen { to: "winnings" }
);
```

WalletAdapter-kontrakten sier at `to: "winnings"` skal brukes for "gevinst fra spill (Game1PayoutService, BingoEngine payout)" — men fordi `MetroniaTicketService` og `OkBingoTicketService` kaller `credit()` UTEN `to`, defaulter alt til deposit-side per `WalletAdapter.ts:104` ("default: deposit").

**Compliance-konsekvens:** Hele Metronia/OkBingo-payouten lander på deposit-saldoen. Per pengespillforskriften skal vinning-saldo være sporet separat for at:
1. Loss-limit-kalkulasjonen (`lossLimitAmountFromTransfer` i `BingoEngine.ts`) skal kunne ekskludere winnings-finansierte buy-ins fra daglig/månedlig tap-grense.
2. Withdrawals skal kunne preferere winnings-side ihht. eksisterende design.

Hvis hele Metronia-balansen blir tellet som deposit, vil spilleren bli feilaktig blokkert av loss-limit selv etter en gevinst.

**Komplikasjon:** Metronia/OkBingo payout = leftover-deposit + winnings (player putter inn 100, vinner 50 i maskinen, payout = 150). Korrekt split krever vite hvor mye var deposit vs winnings. Den raskeste pragmatiske løsningen er:
- payout ≤ initialAmountCents + totalTopupCents → alt til deposit (refund av ubrukt)
- payout > initialAmountCents + totalTopupCents → split: deposit-del = initial+topups, winnings-del = (payout - initial - topups)

Dette krever at WalletAdapter har en split-credit-API eller at servicen gjør to atomiske credit-calls.

**Pilotrisiko:** Norwegian regulators kan reagere på at vinnings ikke er sporet separat for machine-tickets. Dette er ikke en "blokker pilot"-greie hvis machine-volume er lav første uke, men er en compliance-gap som må fikses før produksjon-grade-skalering.

**Fix-strategi:**
1. Kort-sikt: legg `to: "deposit"` eksplisitt på alle 4 callsites (verifiserer eksisterende oppførsel).
2. Mellom-sikt: implementer split-logikken og bruk `to: "winnings"` for delen som overstiger init+topups. Sannsynligvis K3-followup.

### 3. ❌ KRITISK — Ingen admin force-close-route eksponerer `AGENT_SHIFT_FORCE`

**Fil:** `apps/backend/src/platform/AdminAccessPolicy.ts:90` definerer `AGENT_SHIFT_FORCE: ["ADMIN"]`
**Fil:** `apps/backend/src/agent/AgentShiftService.ts:190-208` `endShift` har eksplisitt ADMIN-gren

Men ingen route kaller `endShift` med ADMIN-actor + eksplisitt `shiftId`. `agent.ts:311-345` (`/api/agent/shift/end`) henter `active` shift for actor selv → ADMIN må ha sin egen aktive shift for at ruten skal returnere noe (og ADMIN kan ikke ha shift fordi `requireActiveAgent(user.id)` på linje 79 vil avvise ADMIN).

Konsekvens: Hvis en agent-shift er stuck (agent forlot uten å avslutte, klient krasjet), er det INGEN måte for admin å lukke shiften uten å gå rett i database. Wireframe Gap #9 og dokumentasjonen sier eksplisitt at admin skal kunne force-close.

`AGENT_SHIFT_FORCE`-permissionen er definert men **aldri grep-bart i routes/-** (verifisert: `grep -rn "AGENT_SHIFT_FORCE" apps/backend/src/routes/` → 0 treff).

**Pilotrisiko:** Sannsynligvis blokker for pilot. En stuck agent-shift forhindrer:
- Andre agenter fra å starte shift i samme hall? (Nei, partial unique-index er per `user_id`, ikke `hall_id` — verifisert i `AgentStore.ts:553-562`.)
- Settlement (close-day kan kun gjøres av eier-agenten med aktiv shift, så ja, force-settlement må komme via admin-route).

**Fix:** Legg til `POST /api/admin/agent/shifts/:shiftId/force-close` med `AGENT_SHIFT_FORCE`-guard som kaller `agentShiftService.endShift({ shiftId, actor: { userId, role: "ADMIN" } })`. Trenger også audit-event `agent.shift.admin-force-close`.

---

## Pilot-readiness-verdikt: REQUEST_CHANGES

Tre kritiske bugs må adresseres før pilot:

1. **Idempotens-bug i `processCashOp` + machine-create** — kan forårsake dobbel-debit. Pilotklare workaround: agent-instruks om å verifisere balanse mellom retry-forsøk + manuell counter-tx hvis dobbel skjer. Permanent fix før produksjon.
2. **Machine-payout krediterer feil saldo-side** — compliance-gap. Kort-sikt-fix er minimal (legg `to: "deposit"` eksplisitt). Mellom-sikt split-fix er K3-followup.
3. **Manglende admin force-close-route** — kritisk for ops/support når agent-shift stuck. Trenger ny route før pilot.

Ikke-blokkere men anbefalt før pilot:
- Add settlement guarantees (transaksjon rundt close-day i AgentSettlementService).
- Add openDay race-protection (DB partial-unique-index på `(shift_id, tx_type) WHERE tx_type='DAILY_BALANCE_TRANSFER'`).
- Implementer winnings-side-split for Metronia/OkBingo close (om ikke før pilot, så som første post-pilot-fix).

---

# Detaljert review

## A. payments/

### A.1 SwedbankPayService.ts (1046 linjer)

#### Correctness

- ✅ Full-roundtrip idempotens via `IdempotencyKeys.machineCredit`-mønsteret + `credited_at`-sjekk i `reconcileRow:491-497`. Dobbel-callback kan ikke forårsake dobbel-credit.
- ✅ `FOR UPDATE`-lås på `getIntentRowForUpdate:938-965` mens reconcile pågår — race-safe.
- ✅ `SWEDBANK_AMOUNT_MISMATCH`/`SWEDBANK_CURRENCY_MISMATCH` (line 503-513) verifiserer at fjern-payment matcher intent — vital fail-closed-mekanisme.
- ✅ `processCallback:456-488` slår opp via både `orderReference` og `paymentOrderId` med fallback — robust mot Swedbank's ulike callback-formater.
- ⚠️ `extractPaymentOrderAmountMinor:614-619` bruker `Math.floor(amount)` — Swedbank sender amount i cents (heltall). Hvis Swedbank-respons noen gang inneholder desimaler (eks. centesimaler-konvertering), `floor` runder ned, noe som kan skape MISMATCH-feil med 1-cent-margin. Mer robust: `Math.round`. Lite sannsynlig i praksis men verdt å notere.
- ⚠️ `request:720-773` har timeout (default 10s) — bra. Men ingen retry på 5xx — Swedbank-API er nettverk-avhengig. Hvis pilot-trafikk ser >0.1% timeout, vurder retry-with-backoff.

#### Compliance

- ✅ `topUp(walletId, amountMajor, ...)` på line 539 — bruker `topUp`-API som per WalletAdapter-design lander på deposit-side. Korrekt for top-up-flyt.
- ✅ `creditedTransactionId` lagret i `swedbank_payment_intents`-tabellen — full audit-trail.
- ✅ Schema-name validation `assertSchemaName:155-161` — SQL-injection-safe.

#### Security

- ✅ `accessToken`/`payeeId` eksponeres aldri i logger eller error-meldinger — verifisert.
- ✅ `apiBaseUrl` valideres som http/https i `normalizeBaseUrl:163-172` — god SSRF-defense.
- ✅ Token-format og hex-validation i `swedbankSignature.ts:31-43` — robust mot malformed headers.
- ⚠️ Schema `assertSchemaName` aksepterer `[A-Za-z_][A-Za-z0-9_]*` (case-insensitive). Postgres er case-sensitive on quoted identifiers — `"Public"` ≠ `"public"`. Per env-config bruker prosjektet alltid lowercase. Ikke-bug, men en dokumentasjonsdetalj kunne forhindre fremtidige issues.
- ⚠️ Ingen sjekk i `processCallback` for body-størrelse — express.json() har global limit (15MB per `index.ts`). Dvs. en angriper med signatur-secret kan POSTe 15MB JSON og stress-teste backend. Ikke-trivielt å utnytte (krever stjålet secret) men forsterk defense ved å sette en local limit.

#### Test coverage

- ✅ `swedbankSignature.test.ts` har 14 tester som dekker: header parse, hex validation, signature verify, body-tampering, missing header, empty secret, garbage hex. Solid.
- ❌ `SwedbankPayService.ts` HAR INGEN ENHETS-TEST. 1046 linjer med deposit/wallet-credit-logikk er uten dekning.
- ❌ Spesielt mangler:
  - Race-test for samtidig callback + reconcile (begge skal ende med `walletCreditedNow=true` for kun én).
  - `SWEDBANK_AMOUNT_MISMATCH`-sti.
  - Pending → Paid → Pending status-overgang.
  - Idempotens-test: callback med `processCallback` fulgt av manuell `reconcileIntentForUser` skal ikke dobbel-credite.

#### Architecture

- ✅ `WalletAdapter` injectes via constructor — testbar.
- ✅ Schema-init via `ensureInitialized` med lazy-promise — single-fire.
- ⚠️ Klassen oppretter en egen `Pool` i constructor (line 288) — 2 connection-pools per process (én via `WalletAdapter`, én her). Vurder å motta `Pool` som dep i stedet.

### A.2 swedbankSignature.ts (77 linjer)

- ✅ Constant-time compare via `timingSafeEqual` — korrekt anti-timing-attack.
- ✅ Length-check + hex-regex før `timingSafeEqual` — defensive.
- ✅ Empty-secret returnerer `false` (fail-closed).
- ✅ Test-coverage: 14 tester, dekker alle kjente angrepsmønstre.
- ✅ Beautiful module — eksempel på god kode.

### A.3 PaymentRequestService.ts (679 linjer)

#### Correctness

- ✅ `acceptRequest:430-525` bruker `BEGIN/COMMIT` med `lockPendingRow` (`FOR UPDATE`) — race-safe på double-accept.
- ✅ Wallet-failure under accept ruller tilbake DB-statusen — verifisert via `__tests__/PaymentRequestService.test.ts:398-413`.
- ✅ `IdempotencyKeys.paymentRequest({ kind, requestId })` — stabil idempotency-key (requestId er DB-generert UUID, så stabilt på tvers av retries).
- ⚠️ `acceptDeposit` bruker `walletAdapter.credit(walletId, amount, reason, { idempotencyKey, to: "deposit" })` (line 461) — med eksplisitt `to: "deposit"`. ✅ Dette er korrekt per regulatorisk gate. Bra at det er eksplisitt.
- ⚠️ `acceptWithdraw` bruker `walletAdapter.debit` (line 465) UTEN noen `from`-parameter. WalletAdapter har `debit` som default-trekker fra "først winnings, så deposit" (verifiserer ikke nøyaktig — må sjekkes mot WalletAdapter-impl). Dette betyr withdraws kan trekke fra winnings-saldo, men det er ikke nødvendigvis feil — refund/withdraw skal kunne trekke fra hele balansen.
- ⚠️ `parseDestinationType` (line 189-207) er definert men **brukes aldri**. Funksjonen er duplisert i `routes/paymentRequests.ts:108-126`. Død kode.

#### Compliance

- ✅ Append-only mønster: ACCEPTED/REJECTED er CHECK-constraint, ingen DELETE-API eksponert.
- ✅ Audit-log via `pino` — alle accept/reject-events logges med kind, requestId, acceptedBy/rejectedBy, walletId, amountCents.
- ⚠️ Linje 502 logger `walletId: mapped.walletId` — wallet-id er ikke PII, men i eldre dokumentasjon var dette flagget for review. Verifisert at det IKKE er sensitivt felt.
- ❌ `rejectDeposit` / `rejectWithdraw` har INGEN sjekk for hvem som er "submitter" vs "rejecter". En HALL_OPERATOR kan reject sin egen deposit-request (selv-godkjenning). Wireframe-spec fra BIN-586 sier ikke eksplisitt at en operator ikke kan accept/reject sin egen request, men 4-eyes-prinsippet er ofte regulatorisk-implisitt for AML. Verdi å avklare med Tobias.

#### Security

- ✅ `assertSchemaName` whitelist for SQL-injection-defense.
- ✅ Alle `pg.query`-kall bruker parameterized queries (`$1, $2`).
- ✅ `assertPositiveAmountCents` defensiv mot float/negative.

#### Test coverage

- ✅ 14 tester, dekker: opprett/reject/accept-flyt, double-accept, accept-after-reject, race-protection, wallet-failure-rollback, listPending-filtrering.
- ❌ Mangler test for `destinationType=hall` vs `bank` i acceptWithdraw.
- ⚠️ Mangler test for samtidig reject + accept (race).

### A.4 routes/payments.ts (145 linjer)

#### Correctness

- ✅ `swedbankWebhookSecret` fail-closed via `if (!swedbankWebhookSecret) → 503`. Bra design.
- ✅ Signatur-verifisering FØR `processCallback` — ingen DB-kall for unsigned requests.
- ✅ Refresh-flagg på `getIntentForUser` med valgfri reconcile — bra UX-pattern.

#### Compliance

- ✅ Wallet-rommer-update via `emitWalletRoomUpdates` etter credit — UI-konsistens.

#### Security

- ✅ HMAC-verifisering med konstant-tid-compare.
- ⚠️ `console.error` på line 105 og `console.warn` på line 117 — bør gå via `pino`-logger for konsekvent logging-format. Liten ting.

#### Test coverage

- ❌ Ingen integrasjonstest for selve `payments.ts`-routeren. Compute-end-to-end via Express er ikke testet.

### A.5 routes/paymentRequests.ts (348 linjer)

#### Correctness

- ✅ `parseStatuses` håndterer CSV-input og dedup.
- ✅ Hall-scope-sjekk via `assertUserHallScope` for HALL_OPERATOR (BIN-591).
- ✅ Fail-closed når payment-request ikke har hall_id og actor er HALL_OPERATOR (line 233-238).

#### Security

- ✅ `parseRejectionReason` cap'er på 500 chars — defense mot text-injection i logs.
- ✅ Permission-guard via `requireAdminPermissionUser` på alle admin-paths.

---

## B. agent/

### B.1 AgentShiftService.ts (283 linjer)

#### Correctness

- ✅ Triple-check guard for SHIFT_ALREADY_ACTIVE: app-nivå (`getActiveShiftForUser`) + DB partial unique-index + race-catch (`isUniqueViolation`).
- ✅ ADMIN-bypass på `endShift:205-211` korrekt.
- ✅ `logout` (Gap #9-flyt) gjør `endShift` først, så best-effort cashout/range-flagging.
- ⚠️ `logout:226-230` — hvis `endShift` lykkes men `markPendingForNextAgent` feiler, returnerer servicen `pendingCashoutsFlagged: 0`. Hvis port kaster unntak, det bobler opp. Dette er forskjellig oppførsel basert på port-implementasjonen — verifiser at både stub og prod-port håndterer feil konsekvent.
- ❌ KRITISK: `endShift` setter `is_active=false`, men IKKE `settled_at`. Agenten kan logge ut uten å close-day. Hvis agent har dailyBalance > 0 i shift, blir den ubekreftet, og hall-kassen er ikke synket. `AgentSettlementService.getSettlementDateInfo` flagger `previousSettlementPending` for neste shift, men det blokker bare openDay — ikke shift.start. Hvis to forskjellige agenter åpner shift på samme dag, har vi en uavklart prev-day-balance.

  **Fix-strategi:** På `endShift` (uten flags), enten (a) tving close-day-kall først, eller (b) auto-close-day med null-rapport hvis dailyBalance er 0 og ingen tx skjedde. Trenger PM-avklaring.

#### Compliance

- ✅ Hall-membership sjekkes via `profile.halls` — agent kan ikke åpne shift i fremmed hall.
- ✅ Audit-events `agent.shift.start/end/logout` logges via routes.

#### Test coverage

- ✅ 192-linjer test-suite + 246-linjer logout-audit-test + 206-linjer distributeWinnings-test + 260-linjer transferRegisterTickets-test.
- ⚠️ Mangler test for "agent ender shift uten close-day, hva skjer med prev-day-balance".

### B.2 AgentSettlementService.ts (637 linjer)

#### Correctness

- ✅ Threshold-regler korrekt implementert: `computeDiffSeverity` (line 621-631) matcher dokumentasjonen.
- ✅ `markShiftSettled` har `WHERE settled_at IS NULL` — race-safe.
- ✅ Validering av `machineBreakdown` + `bilagReceipt` før mutasjon.
- ✅ Wireframe 17.40 `calculateShiftDelta` har full validering + 9 tester (`shiftDelta.test.ts`).
- ⚠️ `closeDay:251-313` — etter `markShiftSettled` blir det 1 settlement-insert + 2 hall-cash-ledger-calls. Disse er IKKE i én transaksjon. Hvis `applyCashTx` feiler etter `settlement.insert`, har vi en settlement-rad uten matching hall-cash-mutasjon. Trenger compensating mechanism eller wraps i én PoolClient-transaksjon.
- ⚠️ `closeDay` validerer ikke at `aggregate.cashOut + aggregate.cashIn` matcher `dailyBalanceAtEnd - dailyBalanceAtStart`. Hvis tx-aggregat-data og shift.dailyBalance divergerer (skulle ikke skje, men beste defense in depth), settles vi bare på det rapporterte tallet. Liten verdi-add men compliance-rapporter blir mer pålitelig.
- ⚠️ `closeDay` setter `dailyBalanceAtStart: 0` (linje 265) hardkodet, fordi dailyBalance start ikke spores per shift. Dette er greit per nå men gjør PDF-eksport ufullstendig (PDF viser "0 ved start" alltid). Verdt å notere.

#### Compliance

- ✅ Edit-settlement (admin-only) lagrer `editedByUserId + editedAt + editReason` — full audit-trail.
- ✅ `uploadBilagReceipt` har AGENT-eier-sjekk (`settlement.agentUserId !== input.uploaderUserId` → FORBIDDEN).
- ⚠️ `editSettlement` lar admin oppdatere `reportedCashCount` (linje 322 i Store) som muterer settlements-rad-eksisterende felt. Dette er audit-tracket, men det betyr en admin kan teknisk endre tall uten å counter-tx-e wallet/hall-cash. Det er ikke wallet-mutasjon, men hall-cash kan ende opp inkonsistent. Trenger eksplisitt warning i edit-flyt.

#### Test coverage

- ✅ 664-linjer hovedtest + 110-linjer shiftDelta-test = solid.
- ❌ Mangler test for "settlement insert lykkes men hall-cash feiler" (partial-failure).

### B.3 AgentTransactionService.ts (802 linjer)

#### Correctness

- ✅ `assertTargetIsPlayer` (line 444-452) sikrer at add-money/withdraw kun går mot PLAYER-konti — hindrer bug der agent legger penger på admin-bruker.
- ✅ AML-threshold (10000 NOK) krever `requireConfirm=true` for withdraw — tilstrekkelig fail-closed.
- ✅ `cancelPhysicalSale` har eksplisitt `existingCancel`-sjekk (linje 581-584) — hindrer dobbel-cancel selv om ingen DB-unique-index.
- ✅ `requireActiveShift` sjekker `shift.settledAt` — fryser shift etter close-day. Bra.
- ✅ Cash-out har `INSUFFICIENT_DAILY_BALANCE`-guard for CASH-paymentMethod (line 280-287).
- ❌ KRITISK: `processCashOp:295` → `txId = agenttx-${randomUUID()}` lager fersk per-call ID, idempotency-key blir ustabil. Se top-3-issue-1.
- ⚠️ `cashIn` med paymentMethod=CARD gjør `wallet.credit` med `to`-default (deposit-side). Det er korrekt — kort-betaling er depositum, ikke vinnings.
- ⚠️ Linje 668: `totalPriceCents = input.pricePerTicketCents * input.ticketCount`. Hvis `input.ticketCount` er Number.MAX_SAFE_INTEGER og pricePerTicketCents > 1, flyter dette over. Validering på linje 663-664 cap'er bare `< 1` og non-integer. Praktisk ikke utnyttbart fordi assertPositive-checks ovenfor, men bedre å cap'e ticketCount eksplisitt på `<= 1000` eller similar.

#### Compliance

- ✅ Per-action audit via routes (verifisert i `agentTransactions.ts`).
- ⚠️ Ingen self-exclusion-sjekk i deposit/cash-in/cash-out-fly. Hvis en spiller er self-excluded, kan agent fortsatt cash-in penger til wallet. Dette omgår spillevett-systemet. Avklaring: Norske regler om self-exclusion gjelder vinning og spilling, ikke wallet-funding direkte. Men det er en ekstra defense-in-depth gap.
- ⚠️ Ingen KYC-status-sjekk. KYC er på app_users-nivå men ikke gated her. Ikke automatisk en feil men kan være en compliance-followup.

#### Security

- ✅ Hall-membership via `requirePlayerInHall` — IDOR-defense.
- ✅ `assertTargetIsPlayer` — privilege-escalation-defense.

#### Test coverage

- ✅ 1014-linjer test-suite. Solid.
- ❌ Mangler regression-test for idempotency-bug (top-3-issue-1).
- ❌ Mangler test for `withdrawFromUser` med exactly threshold-amount (boundary off-by-one).

### B.4 AgentOpenDayService.ts (209 linjer)

#### Correctness

- ✅ `OPEN_DAY_PARTIAL_FAILURE` håndteres med eksplisitt logging og DomainError — ops kan rydde manuelt.
- ✅ `INSUFFICIENT_HALL_CASH` blokkerer hvis hall-balanse er for lav.
- ✅ `PREVIOUS_SETTLEMENT_PENDING` blokkerer ny dag før forrige er lukket.
- ❌ `openDay:91-100` har TOCTOU race: `existing = await ledger.listForHall(...)`, så `alreadyOpened` check, så `applyCashTx`. To samtidige openDay-kall kan begge passere check og begge applyCashTx. Resultat: dobbel hall-cash-debit + dobbel shift-credit.
  **Fix:** Enten (a) wraps openDay i en PG-advisory-lock keyed på `shift.id`, eller (b) DB partial-unique-index på `app_hall_cash_transactions(shift_id, tx_type) WHERE tx_type='DAILY_BALANCE_TRANSFER'`.
- ⚠️ `hasPendingSettlement:193-208` har en bug: `for (const s of history) { if (s.id === currentShiftId) continue; if (s.endedAt) ... return; }`. Returnerer på FØRSTE shift som har endedAt — men ifølge logikken skal det sjekke om DEN umiddelbart forrige (ikke nåværende). Hvis history er lengre enn 5 og det ligger flere ikke-current ended-shifts, kun den nyeste sjekkes. Akseptabel for de fleste bruk, men pedantisk korreksjon: bare iterér til første ikke-active ikke-current shift.

#### Compliance

- ✅ HallCashLedger-mutasjon er audit-tracket via `app_hall_cash_transactions`.

#### Test coverage

- ✅ 246-linjer test-suite, dekker grunnflyten.
- ❌ Mangler race-test for samtidig openDay (TOCTOU-bugen).

### B.5 MetroniaTicketService.ts (655 linjer)

#### Correctness

- ✅ Refund-på-Metronia-failure: hvis Metronia API kaster, refund wallet med `IdempotencyKeys.machineRefund` (line 163-168).
- ✅ Void-flow håndterer "allerede lukket"-feil idempotent (line 467-471).
- ✅ `autoCloseTicket:356-424` har full forskjellig sti: ingen active-shift-check, suffix `:auto` på uniqueTransaction. Korrekt for cron.
- ❌ `createTicket:142-144` — fersk `mtkt-${randomUUID()}` per call → idempotency-bug for retries.
- ❌ `closeTicket:307-316` + `autoCloseTicket:378-388` — ingen `to: "winnings"` på credit. Se top-3-issue-2.
- ⚠️ `voidTicket:475` refunderer `initialAmountCents + totalTopupCents` til deposit-side. Korrekt — void = full refund av innsats. Ikke vinnings.

#### Compliance

- ✅ `MACHINE_CREATE/TOPUP/CLOSE/VOID` action types i `app_agent_transactions` — full reporting-mulighet.
- ✅ Per-shift aggregat funker.
- ⚠️ `VOID_WINDOW_MS` er 5 min hardkodet. Dette matcher legacy. Hvis regulatorisk-spec endrer seg, må env-overstyres. Dokumentert.

#### Security

- ✅ Bearer-token i HTTPS-call. `tlsRejectUnauthorized=false` kun ved eksplisitt config (staging).
- ✅ Per-call timeout (default 10s).

### B.6 OkBingoTicketService.ts (632 linjer)

Speilet av Metronia. Samme issues:

- ❌ `createTicket:140-141` — fersk `oktkt-${randomUUID()}` per call.
- ❌ `closeTicket:303-313` + `autoCloseTicket:369-378` — ingen `to: "winnings"`.
- ✅ `openDay` for OK Bingo er distinkt fra agent-openDay; den kaller bare maskin-API uten DB-mutasjon. Bra dekomponering.

### B.7 SqlServerOkBingoApiClient.ts (286 linjer)

- ✅ Polling-pattern med max attempts + interval — robust.
- ⚠️ `Parameter LIKE @Parameter` på line 248 bruker `%${requestComId}%` — LIKE er ikke det mest effektive, og hvis flere ComID-er finnes (f.eks. requestComId=12 matcher 12, 120, 1200), kunne man få kollisjoner. Real-world: ComID er auto-incrementing INT, så bare én rad har ComID > X med matching `%X%` for hver ID-verdi mellom polling-windows. Akseptabel, men en ren "ComID = X" eller streng equality på Parameter ville vært tryggere.
- ⚠️ `pollIntervalMs` × `pollMaxAttempts` = 10s default. SQL Server-kall kan ta lenger ved DB-load. Bør konfigureres per-deployment.
- ✅ `OKBINGO_DB_DOWN` returneres hvis pool ikke er connected — fail-closed.

### B.8 HttpMetroniaApiClient.ts (185 linjer)

- ✅ `tlsRejectUnauthorized=false` kun via eksplisitt config — ingen prosess-globalt påvirkning.
- ✅ Per-call timeout.
- ✅ Mapper Metronia error-format (`error: number` → `METRONIA_API_ERROR`).
- ⚠️ `fetchOptions.dispatcher = this.insecureDispatcher as any` (line 151) — typescript-cast via `any`. Forklart i kommentar (undici-quirk). Akseptabel.

### B.9 AgentProductSaleService.ts (586 linjer)

- ✅ Cart-mutation (createCart) er i én PG-transaksjon.
- ✅ Idempotency på `IdempotencyKeys.agentProductSale({ cartId })` — stabil.
- ✅ `expectedTotalCents`-sjekk hindrer agent fra å fakturere annet beløp enn cart-summen.
- ⚠️ `try { await this.txs.insert(...) } catch (err) { logger.warn... }` (line 462-482) — agent-tx-insert er best-effort. Hvis det feiler, logges men sale committes uansett. Det betyr rapporteringen er ikke 100% pålitelig — produkt-salg kan mangle i agent-transactions. Gradient-trade-off (sale skal ikke feile fordi audit-log feiler), men noter dette.

#### Test coverage

- ❌ INGEN test-fil for `AgentProductSaleService` (`apps/backend/src/agent/__tests__/`-listet over har ingen `AgentProductSaleService.test.ts`). 586 linjer DB-koblet kode er udekket.

### B.10 TicketRegistrationService.ts (601 linjer)

- ✅ Carry-forward-logikk er ikke-trivielt men korrekt: finner siste rad med `final_id IS NOT NULL` for (hall, type), order by `round_number DESC`.
- ✅ Range-overlap-validering (line 437-452) hindrer salgs-overlapp på tvers av spill.
- ✅ Atomic transaksjon: hele recordFinalIds rolles tilbake hvis én rad feiler.
- ✅ 715-linjer test-suite — solid.
- ⚠️ `getInitialIds` (line 250-314) gjør én query per ticket-type for `getLastCompletedRange` — kan optimaliseres til én batch-query. Performance-followup.

### B.11 HallCashLedger.ts (281 linjer)

- ✅ Postgres-implementasjon bruker BEGIN/COMMIT med FOR UPDATE-lås på `app_halls`.
- ✅ Audit-trail via `app_hall_cash_transactions` med previous/after-balance-snapshot.
- ✅ InMemory-impl med samme grensesnitt for tester.

### B.12 AgentTransactionStore.ts (393 linjer) + AgentSettlementStore.ts (486 linjer)

- ✅ Append-only på TransactionStore (ingen UPDATE/DELETE-API).
- ✅ Counter-tx via `related_tx_id`.
- ✅ Aggregate-helper deles mellom Postgres + InMemory.
- ✅ SettlementStore enforcer `UNIQUE(shift_id)` på begge implementasjoner.
- ⚠️ `applyEdit` på SettlementStore bruker dynamisk SET-bygging — sårbar for dårlig input om ikke pre-validert i service. AgentSettlementService DOES validate, så akseptabelt.

### B.13 MachineBreakdownTypes.ts (239 linjer)

- ✅ 14 kanoniske maskin-rader matcher wireframe (med kommentarer for legacy-stavefeil-mapping).
- ✅ `validateMachineBreakdown` defensive parsing — kaster på unkjente keys, non-integer values, negative tall.
- ✅ `BilagReceipt` validation: mime whitelist, sizeBytes-cap (10MB), data-URL-format-check.
- ✅ 215-linjer test-suite — solid.

### B.14 routes/agent.ts (450 linjer) + routes/agentSettlement.ts (514 linjer)

- ✅ Audit-logging på alle handlinger med structured `pino`-fields.
- ✅ Permission-guard via `requirePermission` på alle paths.
- ✅ Hall-scope-enforcement for HALL_OPERATOR.
- ❌ Manglende admin force-close shift-route (top-3-issue-3).
- ⚠️ `routes/agent.ts:447` logger "agent-router initialised (13 endpoints)" men jeg teller 11 i koden. Detalj.

### B.15 routes/agentMetronia.ts (280 linjer) + routes/agentOkBingo.ts

- ✅ Konsekvent permission-pattern.
- ⚠️ Begge router-filene har samme `mapRoleToActorType` duplikert (5 ganger på tvers av agent-routes-filene). Refactor til shared helper i `util/`.

---

## Specific change requests

### Blokkere før pilot

1. **`apps/backend/src/agent/AgentTransactionService.ts:295-301`** — fix idempotency-bug: bytt fra `txId` til `agentUserId + clientRequestId` som basis for idempotency-key. Utvid `IdempotencyKeys.agentTxWallet`-signaturen tilsvarende.
2. **`apps/backend/src/agent/MetroniaTicketService.ts:142-144`** og **`apps/backend/src/agent/OkBingoTicketService.ts:140-141`** — bytt fra freshly-generated ticketId i `uniqueTransaction` til `agentUserId + clientRequestId`. Lagre den interne ticketId separat i DB. Forhindrer dobbel-Metronia-create + dobbel-debit ved klient-retry.
3. **`apps/backend/src/agent/MetroniaTicketService.ts:307-316`, `:378-388`** og samme i `OkBingoTicketService.ts` — legg `to: "deposit"` eksplisitt på alle close-credits. Følg opp med winnings-split i K3.
4. **NY ROUTE `apps/backend/src/routes/agent.ts`** — legg til `POST /api/admin/agent/shifts/:shiftId/force-close` med `AGENT_SHIFT_FORCE`-permission. Ringer `agentShiftService.endShift({ shiftId, actor: { userId: admin.id, role: "ADMIN" } })`. Trenger audit-event `agent.shift.admin-force-close` og evt. logout-flags.

### Anbefalt før pilot

5. **`apps/backend/src/agent/AgentOpenDayService.ts:91-100`** — fix TOCTOU race: enten advisory-lock per `shift.id` eller DB partial-unique-index på `app_hall_cash_transactions(shift_id, tx_type) WHERE tx_type='DAILY_BALANCE_TRANSFER'`.
6. **`apps/backend/src/agent/AgentSettlementService.ts:251-313`** — wrap `markShiftSettled` + `settlements.insert` + 2× `applyCashTx` i én PG-transaksjon. Forhindrer partial-failure der settlement-rad finnes uten matching hall-cash-mutasjon.
7. **`apps/backend/src/agent/AgentShiftService.ts:197-211`** — vurder å blokke `endShift` hvis `shift.dailyBalance > 0` og ikke `shift.settledAt`. Tving close-day først eller auto-close-day med null-rapport. Dette må avklares med PM (kan være intentional design).

### Test-coverage-gap (post-pilot OK)

8. **`apps/backend/src/payments/SwedbankPayService.ts`** — legg til enhets-tester. 1046 linjer kritisk pengeflyt er udekket.
9. **`apps/backend/src/agent/AgentProductSaleService.ts`** — legg til enhets-tester. 586 linjer udekket.
10. **`apps/backend/src/agent/AgentTransactionService.ts`** — regression-test for idempotency-bug etter fix.
11. **`apps/backend/src/agent/AgentOpenDayService.ts`** — race-test for samtidig openDay.

### Architecture / kode-rensing (COMMENT_ONLY)

12. **`apps/backend/src/payments/PaymentRequestService.ts:189-207`** — `parseDestinationType` er duplisert med `routes/paymentRequests.ts:108-126`. Konsolider.
13. **`apps/backend/src/routes/agent*.ts`** — `mapRoleToActorType` duplisert 5+ ganger. Refactor til `util/auditActor.ts`.
14. **`apps/backend/src/payments/SwedbankPayService.ts:288`** — `new Pool(...)` i constructor lager en separat connection-pool. Vurder å motta `Pool` som dep i stedet (samme pool som WalletAdapter).
15. **`apps/backend/src/integration/okbingo/SqlServerOkBingoApiClient.ts:248`** — `LIKE '%X%'` på Parameter er ineffektiv. Vurder ren equality eller indeks-vennlig syntax.

---

## Questions for PM (Tobias)

1. **Idempotency-bug i cashIn/cashOut + machine-create**: er dette en pilot-blokker, eller akseptabelt med agent-instruks om manuell counter-tx-rydding? Anbefalt: blokker.
2. **Machine-payout winnings-split**: skal payout-credit gå til winnings-side (split-logikk) eller deposit-side (current behavior)? Avgjørelsen påvirker loss-limit-kalkulasjon. Anbefalt: split-logikken som mellom-sikt-fix; deposit-side på kort sikt.
3. **Admin force-close shift**: skal vi spawne dette som egen K3-task eller include i Bølge B? Anbefalt: K3-task, små route, tar < 1 dag.
4. **agent.endShift uten close-day**: er dette intentional design (agent kan logge ut, så åpne ny shift senere og close-day for prev)? Eller skal endShift tvinge close-day først?
5. **Metronia/OkBingo void-window 5 min**: skal dette være env-overstyrbart eller hardkodet?
6. **Ingen self-exclusion-sjekk i agent cash-in/cash-out**: er dette intentional (regulatorisk OK fordi det er hall-personal som setter inn for spilleren) eller bug?
7. **`AGENT_SETTLEMENT_FORCE` admin-edit**: når admin endrer `reportedCashCount`, skal det auto-skape counter-tx i hall-cash-ledger? Eller bare audit-tracking?

---

## Out of scope (flag for separate PR/issue)

- **OkBingo polling-effisiens**: bytt `LIKE '%comId%'` til equality + indeks. Følg-opp-issue: "OK Bingo response-correlation kan være mer effektiv".
- **`mapRoleToActorType` duplisering**: refactor til shared util. Følg-opp-issue: "Konsolider audit-actor-mapping i util/auditActor.ts".
- **AgentProductSaleService.audit-log er best-effort**: hvis tx-insert feiler, sale committes uansett. Trenger evt. compensating-mechanism eller eksplisitt no-fail-on-audit-flag (avhengig av PM-preferanse).
- **AgentSettlementService.dailyBalanceAtStart hardkodet 0**: PDF-eksport mangler start-balanse. Trenger schema-utvidelse på shift eller separat lookup.
- **SwedbankPayService.Pool-instansiering**: 2 connection-pools per process. Refactor til delt pool.

---

## Konklusjon

Bølge B-koden er generelt høy kvalitet — solid testdekning på agent-shift/settlement, robust idempotens-mønstre på de fleste flows, og defensive validering mot SQL-injection / SSRF / timing-attacks.

Tre kritiske bugs må fikses før pilot:
1. Idempotency-key er ustabil i 3 callsites → dobbel-debit-risiko ved retry.
2. Machine-payout krediteres feil saldo-side → compliance-gap for loss-limit-kalkulasjon.
3. Manglende admin force-close-route → ops kan ikke håndtere stuck shifts.

Andre funn (TOCTOU-race, manglende test-coverage på payments, partial-failure i closeDay) er anbefalt før pilot men ikke blokkere.

**Verdict: REQUEST_CHANGES**

---

*Generated by code-reviewer subagent på pre-pilot-review for Bølge B.*
