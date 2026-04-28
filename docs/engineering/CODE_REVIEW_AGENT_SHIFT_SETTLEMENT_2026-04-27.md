# Pilot-kritisk code review — Agent Shift, Cash, Settlement (2026-04-27)

**Reviewer:** Independent code reviewer (Claude)
**Scope:** Agent shift lifecycle + cash-in/out + settlement + machine-tickets + unique-IDs + withdraw-XML
**Trigger:** Tobias-direktiv 2026-04-27 — vanntett bingoday-flyt før pilot-launch
**Branch:** `docs/code-review-agent-shift-settlement-2026-04-27`

---

## Sammendrag

Audit dekker **15 kjerne-filer** (services, stores, routes) som styrer agent-portalens hele drifts-loop fra skift-start til settlement. Den **regulatoriske compliance-grunnmuren** (idempotency-keys på wallet, audit-log, RBAC) er solid, og de fleste hovedflyter har god dekning. Men det er **en alvorlig atomicity-bug i cash-ops** og **flere systemiske integritets-hull** som kan koste penger eller bryte settlement under høy belastning. Disse må lukkes før pilot.

**Per-severity:**
- **P0 (money-risk / compliance):** 8
- **P1 (polish):** 6
- **P2 (nice-to-have):** 3

---

## P0 — Money-loss / broken settlement / regulatorisk

### P0-1: Cash-op er IKKE atomisk; retry kan dobbel-debitere shift-balance

**File/line:** `apps/backend/src/agent/AgentTransactionService.ts:307-350`

**ISSUE:** `processCashOp()` utfører tre side-effects sekvensielt med separate Postgres-transaksjoner:
1. `wallet.credit/debit` (idempotent på `clientRequestId`)
2. `store.applyShiftCashDelta` (IKKE idempotent — `daily_balance = daily_balance + $delta`)
3. `txs.insert` (IKKE idempotent — fersk `agenttx-${randomUUID()}`)

Hvis steg 2 eller 3 crasher (DB-tap, OOM, container-restart) etter steg 1 lyktes, vil klient-retry treffe samme idempotency-key → wallet returnerer eksisterende `walletTx` (korrekt) men kjører `applyShiftCashDelta` på nytt → **shift.dailyBalance blir doblet**.

**SAMSPILL:** Wallet ↔ Shift balance ↔ Settlement-rapport. Settlement aggregerer `aggregate.cashIn/Out` fra agent_transactions men sammenligner mot `shift.dailyBalance`. Når disse divergerer pga. retry-bug, vil `controlDailyBalance.diff > 0` selv om kassen stemmer fysisk.

**MONEY-RISK:** Ja. Under network-flap kan agent få "feil" daily-balance → ved close-day vil systemet kreve note/force på et avvik som faktisk ikke eksisterer. Verre: hvis cron crasher mid-flow, forsvinner agent-tx-loggen helt → audit-trail brutt.

**FIX:** Wrap step 2 + 3 i samme PG-transaksjon som inkluderer en `idempotency_key` UNIQUE-constraint på `app_agent_transactions.other_data->>'clientRequestId'`. Eksempel:
```sql
CREATE UNIQUE INDEX uniq_agent_tx_client_req ON app_agent_transactions (
  agent_user_id, player_user_id, (other_data->>'clientRequestId')
) WHERE other_data->>'clientRequestId' IS NOT NULL;
```
Service-laget må fange `23505` på insert og returnere eksisterende rad isteden for å re-applye delta. Eller — bedre — flytt cash-delta + tx-insert til en stored procedure som er én atomic block.

**TEST:** Mangler. Legg til unit-test som verifiserer at to sekvensielle `cashIn(...)` med samme `clientRequestId` resulterer i kun ÉN `applyShiftCashDelta`-call og ÉN tx-rad.

---

### P0-2: `aggregateByShift` SILENT TRUNCATION — settlement under-rapporterer på travle shifts

**File/line:** `apps/backend/src/agent/AgentTransactionStore.ts:260-263`

**ISSUE:** `aggregateByShift()` kaller `this.list({ shiftId, limit: 500 })` og aggregerer bare disse. En travel hall-dag (10t skift × 4 agenter × ~5-7 ops/min × samtidig billettsalg) kan lett produsere > 500 rader på én shift. Eldste rader ekskluderes silent → `shift.cashIn/Out` i settlement = bare nyeste 500 transaksjoner.

**SAMSPILL:** Settlement-rapporten (PDF + Hall Account Report) aggregerer dette til regnskap. Bilag og §11-rapporter mot Lotteritilsynet kan vise feil totaler.

**MONEY-RISK:** Ja, regulatorisk. En enkelt aktiv shift kan logge tusenvis av rader (busy hall + multiple agents + ticket-sale-cancel-resale chains).

**FIX:** Bruk SUM-query i SQL i stedet for å laste rader til memory:
```sql
SELECT
  COALESCE(SUM(CASE WHEN payment_method='CASH' AND wallet_direction='CREDIT' THEN amount ELSE 0 END), 0) AS cash_in,
  COALESCE(SUM(CASE WHEN payment_method='CASH' AND wallet_direction='DEBIT'  THEN amount ELSE 0 END), 0) AS cash_out,
  -- ... osv
  COUNT(*) FILTER (WHERE action_type='TICKET_SALE') AS ticket_sale_count,
  COUNT(*) FILTER (WHERE action_type='TICKET_CANCEL') AS ticket_cancel_count
FROM app_agent_transactions
WHERE shift_id = $1
```

**TEST:** Mangler. Legg til test som seeder 600 transaksjoner og bekrefter `aggregateByShift().cashIn` matcher faktisk sum.

---

### P0-3: Unique ID `mustGetActive()` sjekker IKKE `expiry_date` — utløpt kort kan brukes

**File/line:** `apps/backend/src/agent/UniqueIdService.ts:342-357`

**ISSUE:** Read-time-guard inspiserer kun `card.status !== "ACTIVE"`. Status flippes til `EXPIRED` av en daglig cron som kjører etter midnatt (kl 01:00 lokal). Mellom expiry-tid og neste cron-run kan kortet:
- ta i mot `addMoney` (penger låses i utløpt kort)
- bli brukt i `withdraw` (cash betales ut etter expiry)

I worst-case: et kort utstedt med `hoursValidity=24` kl 02:00 utløper 02:00 dagen etter, men forblir ACTIVE i 23 timer til neste cron-run.

**SAMSPILL:** Wireframe 17.9-fotnote: "Your Unique Id will be Expired before starting of the game, please Contact Administrator." → status er ment å være authoritativ.

**MONEY-RISK:** Lav per kort, men aggregert risiko hvis kort utstedes nær midnatt. Også audit-risiko: `getDetails` viser et utløpt kort som ACTIVE.

**FIX:** Endre `mustGetActive()` til å returnere EXPIRED hvis `new Date(card.expiryDate).getTime() < Date.now()` selv når status er ACTIVE. Eller bedre: trigger inline status-flip + audit-rad.
```ts
if (card.status === "ACTIVE" && new Date(card.expiryDate).getTime() < Date.now()) {
  await this.store.updateStatus(card.id, "EXPIRED");
  throw new DomainError("UNIQUE_ID_NOT_ACTIVE", "Kortet er utløpt.");
}
```

**TEST:** Mangler. Test: opprett kort med `hoursValidity=24`, skru tiden 25t fram, kall `addMoney` — skal kaste `UNIQUE_ID_NOT_ACTIVE`, ikke akseptere innskuddet.

---

### P0-4: Bilag-receipt validerer IKKE faktisk filstørrelse — agent kan injisere arbitrary blob

**File/line:** `apps/backend/src/agent/MachineBreakdownTypes.ts:236-260`

**ISSUE:** `validateBilagReceipt()` stoler på client-supplied `sizeBytes`-felt. Den dekoder IKKE base64-strengen og sammenligner mot grensa. En klient kan sende:
```json
{ "mime": "application/pdf", "filename": "x.pdf",
  "dataUrl": "data:application/pdf;base64,<10MB+ payload>",
  "sizeBytes": 100, "uploadedAt": "...", "uploadedByUserId": "x" }
```
og bestå validering. Body-limit i Express er 15 MB → større blobs er teoretisk mulig per request.

**SAMSPILL:** Postgres JSONB lagring. Hvis 100 settlements får 12-MB blobs hver, går DB-disk-bruken opp 1.2 GB. Også: PDF-eksport laster bilag i minnet (`decodeDataUrl` i route).

**MONEY-RISK:** Indirect — DoS-/lagrings-vektor. Agent kan parkere store filer i settlement-rader og bruke som ad-hoc fil-storage.

**FIX:** Faktisk dekod i validator + verifiser at decoded.length <= MAX_BILAG_BYTES OG at decoded.length matcher (innen ~3% margin) `sizeBytes`. Eksempel:
```ts
const payload = dataUrl.slice(`data:${mime};base64,`.length);
const decodedBuf = Buffer.from(payload, "base64");
if (decodedBuf.length > MAX_BILAG_BYTES) throw new Error(`Bilag overskrider ${MAX_BILAG_BYTES} bytes (decoded).`);
if (Math.abs(decodedBuf.length - sizeBytes) > sizeBytes * 0.03) {
  throw new Error("sizeBytes matcher ikke decoded payload-størrelse.");
}
```

**TEST:** Mangler. Test som sender `sizeBytes=100` med `dataUrl` som dekoder til >10MB skal feile.

---

### P0-5: Manglende "Cannot logout with unreconciled balance" — agent kan logge ut uten å avstemme

**File/line:** `apps/backend/src/agent/AgentShiftService.ts:204-234` (endShift) og `:244-268` (logout)

**ISSUE:** Søk i hele kodebasen viser INGEN sjekk for `dailyBalance != 0` ved `endShift`/`logout` (`grep "unreconciled"` returnerer 0 treff). Agent kan kalle `/api/agent/shift/end` uten å først ha kjørt `controlDailyBalance` eller `closeDay`. Resultatet er at shift markeres `is_active=false, settled_at=null` — en "stranded shift".

Wireframe 17.4 / 13.4 sier eksplisitt: *"Agent cannot logout with unreconciled balance"*. Settlement (close-day) er ment å være den eneste lovlige avslutningsveien.

**SAMSPILL:** AgentOpenDayService.hasPendingSettlement() oppdager dette først NESTE dag når agent prøver å åpne ny dag — men kun ved se de siste 5 shifts. Hvis 6+ stranded shifts mellom, sjekken er null & void. Cash i kassen må telles + reconcileres for §72 dagsrapport.

**MONEY-RISK:** Ja. En agent kan logge ut med 5,000 NOK i dailyBalance som aldri blir transferert tilbake til hall.cashBalance via `HallCashLedger`. Hallens kontante midler blir uregistrerte til neste cron eller manuelt admin-inngrep.

**FIX:** Legg til guard i `AgentShiftService.endShift` (og `logout`):
```ts
if (Math.abs(shift.dailyBalance) > 0.01 && !shift.settledAt) {
  throw new DomainError(
    "UNRECONCILED_BALANCE",
    "Du må kjøre close-day før shift kan avsluttes."
  );
}
```
ADMIN-force kan bypasse med dokumentert reason, slik dagens force-close gjør.

**TEST:** Mangler. Test: åpne shift, cashIn 1000, kall endShift uten close-day → forventer DomainError UNRECONCILED_BALANCE.

---

### P0-6: `AgentOpenDayService.alreadyOpened`-sjekk har 500-cap blind spot

**File/line:** `apps/backend/src/agent/AgentOpenDayService.ts:91-96` og `:178-181`

**ISSUE:** Begge stedene henter `ledger.listForHall(shift.hallId, { limit: 500 })` og leter etter `tx.shiftId === shift.id && tx.txType === "DAILY_BALANCE_TRANSFER"`. En aktiv hall kan akkumulere mer enn 500 hall-cash-transactions over noen ukers drift (open-days, close-days, manual adjustments, drop-safe-moves). Hvis target-shiftens DAILY_BALANCE_TRANSFER ligger > 500 rader bakover, sjekken returnerer `alreadyOpened=false` selv om dagen er åpnet.

**SAMSPILL:** Open-day-flyt → debiterer hall-cash + krediterer shift-balance. Hvis dette skjer to ganger på samme shift, hallens cash-balance blir trukket dobbelt (selv om shift.dailyBalance også får dobbelt). Resultat: regnskaps-divergens som først oppdages ved nattlig reconciliation.

**MONEY-RISK:** Ja. Hver duplikering = 1 dagligbalanse trukket fra hall.cashBalance ekstra (typisk 5,000-15,000 NOK).

**FIX:** Bruk targeted query istedenfor list-and-filter:
```sql
SELECT EXISTS (
  SELECT 1 FROM app_hall_cash_transactions
  WHERE shift_id = $1 AND tx_type = 'DAILY_BALANCE_TRANSFER'
) AS already_opened
```
Dette krever ny metode på `HallCashLedger` (`existsForShift(shiftId, txType)`).

**TEST:** Mangler. Test: seed 600 hall-cash-transactions, sjekk at `openDay` på en shift med eksisterende DAILY_BALANCE_TRANSFER fortsatt blir blokkert.

---

### P0-7: `endShift` stenger ikke shift hvis flag-arg-rekkefølge bytter

**File/line:** `apps/backend/src/agent/AgentStore.ts:521-551`

**ISSUE:** `endShift` bygger SET-clauses dynamisk basert på hvilke flags som er satt. Den bruker `params.length + 1` som column-index, men shiftId er ALLEREDE pushed senere. La meg vise nøyaktig:

```ts
const params: unknown[] = [];
if (flags?.distributeWinnings !== undefined) {
  params.push(flags.distributeWinnings);  // params.length === 1 etter push
  sets.push(`distributed_winnings = $${params.length + 1}`);  // → $2
}
// Så kalles: `query(sql, [shiftId, ...params])` → shiftId=$1, params[0]=$2 ✓
```

Det fungerer for en enkelt sti. **MEN**: hvis to flags settes, blir første sett til `$2` og andre til `$3` (riktig). Senere ved 3 flags blir det `$4`. Men den faktiske array-indeksen for params er off-by-one mot SQL-indeksen — kompliser ved `pool.query(sql, [shiftId, ...params])` der shiftId er $1.

Manuell trace: hvis bare `distributeWinnings = true` settes:
- `params.push(true)` → `params.length = 1`
- `sets.push("distributed_winnings = $2")` ← korrekt fordi `params.length + 1 === 2`
- query kalles med `[shiftId, true]`, sql refererer `$1` (shiftId) og `$2` (true) ✓

Alle flagvarianter har korrekt indeksering. **Konklusjon: ikke bug** — men `+1`-notation er fragile. Legg til kommentar eller refaktor til klarere konstruksjon (`addParam(value)` helper).

**Severity ned-justert til P1 — ikke faktisk bug, men kan-bli-bug ved fremtidig endring.** Se P1-1.

---

### P0-7 (re-numbered): `closeDay` aggregerer fra ufullstendig data

**File/line:** `apps/backend/src/agent/AgentSettlementService.ts:251` (kaller `aggregateByShift`)

**ISSUE:** Settlement.shiftCashInTotal/shiftCashOutTotal/shiftCardInTotal/shiftCardOutTotal kommer fra `aggregateByShift` (P0-2). Hvis shiften har > 500 tx, tallene som persistes i settlement-rad (og brukes i PDF, hall-rapport, §72 dagsrapport, audit) er feil.

**SAMSPILL:** Compounded med P0-2. Persisted settlement-data er regulatorisk autoritativ — feil her propagerer til alle nedstrøms rapporter for evig.

**MONEY-RISK:** Ja, regulatorisk. Lotteritilsynets-rapporter kan inneholde feilaktig sum.

**FIX:** Samme som P0-2 — fix `aggregateByShift` til SUM-query.

**TEST:** Same as P0-2.

---

### P0-8: Cancel-window-check (10 min) bruker klient-tid, ikke transactional now()

**File/line:** `apps/backend/src/agent/AgentTransactionService.ts:594-601`

**ISSUE:** `const ageMs = Date.now() - new Date(original.createdAt).getTime();`. `Date.now()` er Node-prosessens uptime — kan drifte ved system-tid-justering eller restart. Worst-case: agent og DB har forskjellig klokke (cluster-deploy med NTP-skew).

Hva verre: rekkefølgen er:
1. Sjekk ageMs (Node-side)
2. ... noen async-op
3. `applyShiftCashDelta`
4. Skriv counter-tx

Hvis steg 3-4 tar lang tid (DB-lock-contention), kunne ageMs ha gått fra 9:50 (passert) til 10:01 (forbi grensen). Cancel-windowet er ikke håndhevet på counter-tx selv. Praktisk uvanlig, men under høy belastning kan dette gi inkonsistens.

**SAMSPILL:** Cancel-flyten oppretter counter-tx. Hvis vinduet åpner-stenger mellom check og insert, kan en cancel som teknisk er utenfor 10-min-vinduet bli akseptert.

**MONEY-RISK:** Lav. Worst-case agent får cancel etter vindu = ekstra refund-mulighet. Ikke en regulatorisk-blokker, men inkonsistens.

**FIX:** Flytt cancel-window-check til en `WHERE created_at > now() - interval '10 minutes'`-clause i counter-tx-insert. Da er DB-tiden authoritativ. Eller: ALTER tabellen til å ha CHECK-constraint på counter-tx der `(SELECT created_at FROM original_tx) > now() - interval '10 minutes' OR is_admin_force = true`.

**TEST:** Mangler test for race-window.

---

## P1 — Polish / non-blocking improvements

### P1-1: `endShift` SET-builder bruker fragile `params.length + 1`

**File/line:** `apps/backend/src/agent/AgentStore.ts:531, 535, 539`

**ISSUE:** Som analysert i forrige P0-7 (re-vurdert), indekseringen er korrekt **akkurat nå**. Men mønstret er sårbart for off-by-one ved fremtidig endring (legge til ny flag). Anbefaler refaktor til en `pushParam(value)`-helper som returnerer `$N`.

**FIX:** Helper:
```ts
const pushParam = (value: unknown) => { params.push(value); return `$${params.length + 1}`; };
sets.push(`distributed_winnings = ${pushParam(flags.distributeWinnings)}`);
```

---

### P1-2: `MetroniaTicketService.voidTicket` mangler explicit `to: "deposit"` for refund

**File/line:** `apps/backend/src/agent/MetroniaTicketService.ts:508-517`

**ISSUE:** Void refunderer initial+topup til player wallet uten å spesifisere `to: "winnings"`. Default-side er deposit (per W2-konvensjonen). Det er **korrekt** — refund er ikke en gevinst — men det er ikke eksplisitt dokumentert. closeTicket ($309-337) har eksplisitt `to: "winnings"` med detaljert kommentar. Konsistens-vise: skriv også eksplisitt `to: "deposit"` på voidTicket.

**FIX:** Legg til `to: "deposit"` + kommentar i `voidTicket`-credit:
```ts
const walletTx = await this.wallet.credit(
  player.walletId, refundNok, `Metronia void refund ${ticket.id}`,
  { idempotencyKey: ..., to: "deposit" }  // ← refund av innskudd, ikke gevinst
);
```

---

### P1-3: `cancelPhysicalSale` mangler RBAC-kontroll for HALL_OPERATOR

**File/line:** `apps/backend/src/routes/agentTransactions.ts:472-484`

**ISSUE:** Route bruker `AGENT_TICKET_WRITE` (`["ADMIN", "AGENT"]`). HALL_OPERATOR ekskluderes — men bør de kunne force-cancel for sin egen hall? Wireframe sier nei, men dokumentet bør være eksplisitt.

**FIX:** Legg til kommentar i route-fil som dokumenterer at HALL_OPERATOR kan IKKE cancele — kun ADMIN.

---

### P1-4: `AgentOpenDayService.openDay` partial-failure ikke automatisk reconciliable

**File/line:** `apps/backend/src/agent/AgentOpenDayService.ts:139-152`

**ISSUE:** Hvis hall-debit lyktes men shift-credit feilet, kommentar sier "ops må justere manuelt". Det er rimelig som MVP men det er ingen alarm-mekanisme. Rad i `app_hall_cash_transactions` finnes uten matchende shift-state. Manuell oppdaging kun ved daglig reconciliation.

**FIX:** Send compliance-audit-event `agent.open-day.partial-failure` med detalj som ops kan polle. ELLER: gjør hele open-day til én PG-transaksjon (HallCashLedger må eksponere `applyCashTxWithShiftDelta`-helper).

---

### P1-5: PDF-bilag download decoder dataUrl uten size-check

**File/line:** `apps/backend/src/routes/agentSettlement.ts:507-521` (`decodeDataUrl`)

**ISSUE:** Decode skjer uten `MAX_BILAG_BYTES`-sjekk. Hvis blob ble persisted med større filstørrelse (P0-4), download streamer hele blobben tilbake. Memory-pressure for Node-prosess.

**FIX:** Sjekk decoded-buffer mot `MAX_BILAG_BYTES` før respons-write. Returner 500 hvis korrupt blob.

---

### P1-6: `searchUsers` har N+1-query for balance

**File/line:** `apps/backend/src/agent/AgentTransactionService.ts:430-448`

**ISSUE:** For hver bruker som matcher, kalles `getUserById` + `getBalance` separat. Med 10 resultater = 21 PG-rundtrips. Ikke kritisk for liten hall, men kan synke responstid på 1+ sekunder under belastning.

**FIX:** Batch via `WHERE id = ANY($1::text[])` + JOIN mot wallets-tabell.

---

## P2 — Nice-to-have

### P2-1: `MachineRowKey` enum har stavefeil-tolerant kommentar uten data-migrasjon

**File/line:** `apps/backend/src/agent/MachineBreakdownTypes.ts:18`

Kommentaren nevner "Olsun" som legacy-stavefeil for "Otium" men koden bruker `otium`. Dokumentasjon er fin men vurder å sjekke at ingen legacy-data har persisted `olsun` som key.

---

### P2-2: `bilagReceipt.dataUrl` lagres som JSONB-streng — kostbar serialisering

**File/line:** `apps/backend/src/agent/AgentSettlementStore.ts:275`

PG `JSONB` parse/serialize er O(n) på blob-størrelse. 10MB bilag = ~300ms per insert/select. Vurder å flytte bilag til separat `app_settlement_bilags`-tabell eller external blob-storage. Også flagget i kommentar (`MachineBreakdownTypes:108-110`).

---

### P2-3: `AgentSettlementService.calculateShiftDelta` markert deprecated men har test-coverage

Kode-vedlikehold: når `calculateShiftDelta` er virkelig ikke-brukt, fjern den + tester. Foreløpig: behold for backward-compat, men dokumenter sunset-dato.

---

## Cross-module samspill

- **Wallet ↔ Shift balance ↔ Settlement:** P0-1, P0-2, P0-7 (re-numbered) er alle relatert. Cash-op-atomicity må fikses for at settlement-totals skal stemme.
- **Hall cash ↔ Open-day ↔ Close-day:** P0-6 (open-day blind-spot) + P1-4 (partial-failure). Hallens kontant-state er kritisk for §72-rapporten.
- **Unique ID ↔ Wallet:** P0-3 (expiry-bug). Kortet "lever" lengre enn det skal.
- **Shift end ↔ Settlement:** P0-5 (unreconciled balance). Ingen guard mot stranded shifts.

---

## Money-safety vurdering — beslutnings-grunnlag

| Rekkefølge | Issue | Trigger | Money/dag |
|---|---|---|---|
| 1 | P0-1 cash-op race | Network flap mid-cashIn | 50-500 NOK per hendelse, 1-10/dag på travel hall |
| 2 | P0-2 settlement truncation | Travel shift > 500 tx | Kan under-rapportere 5,000-50,000 NOK i totaler |
| 3 | P0-5 unreconciled logout | Agent forhast | Hele dailyBalance (5-15k NOK) potensielt forsvunnet fra hall-balanse |
| 4 | P0-6 open-day blind spot | Hall etter ~2 ukers drift | 5-15k NOK per duplisering |
| 5 | P0-3 unique-id expiry | Kort opprettet nær midnatt | 100-1000 NOK per kort, lav volum |

**Anbefalt prioritering for pilot-launch:**
1. **STOP-SHIP:** Fix P0-1 (atomicity) + P0-2 (truncation) + P0-5 (unreconciled).
2. **Pre-pilot patch:** P0-3 (unique-id) + P0-6 (open-day) + P0-4 (bilag).
3. **Pilot-uke 1:** P0-7 (closeDay aggregation, dekkes av P0-2).
4. **Post-pilot:** Alle P1 + P2.

---

## Konklusjon

Kodebasen viser tegn til **rask iterasjon mot pilot** med god top-of-mind-arkitektur (atomicity-kommentarer i ServiceTops, idempotency-keys konsistent, RBAC matrise) men **mangler defense-in-depth på SQL-nivå** for de tyngste regulatoriske flytene. Ingen av P0-funnene er arkitektur-feil — alle er fixable med målrettet patching i 1-3 dev-dager per issue.

**Anbefaling:** Ikke gå live i en hall med høy volum (>500 tx/skift) før P0-1 + P0-2 + P0-5 er lukket. Lavt-volum testhall kan gå live, men sett alarm på `app_agent_shifts WHERE settled_at IS NULL AND ended_at IS NOT NULL` (stranded shifts) + manual-review-flow før første pilot-dag.

---

**Reviewer notes:**
- Audit utført ved manuell lesning av 15 kjerne-filer (~3000 linjer kode + tester).
- Tester sett over: AgentTransactionService.test.ts, agentSettlement.test.ts, uniqueIdExpiry.test.ts. Test-coverage er god for happy-path men mangler edge-cases som rapportert.
- Build/CI-sjekk ikke kjørt (review-only).
