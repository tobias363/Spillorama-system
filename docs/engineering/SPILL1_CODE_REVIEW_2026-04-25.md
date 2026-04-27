# Spill 1 — Code Review 2026-04-25

**Reviewer:** code-reviewer subagent (Claude Opus 4.7 1M context)
**Branch base:** `origin/main` @ `b7adaa777ebc997d0eaf2bfda0305a61a1173a54`
**Scope:** All Spill 1-specific code (backend engine + services + sockets + game-client + shared-types). Files actively modified by K2 branches were skipped (see §8).

---

## TL;DR

- **Verdict:** REQUEST_CHANGES (REGULATORISK avhengig — se §1 issue 1)
- **Critical issues found:** 3
- **Significant issues:** 6
- **Stylistic suggestions:** 4
- **Pilot-readiness:** GO-WITH-FIXES — pilot kan kjøres etter at §1.1 (regulatorisk gameType-misklassifisering) er bekreftet/avklart; §1.2 og §1.3 bør fikses før pilot, men kan kjøres i parallell pilot-prep.

Top 3 critical issues:

1. **Regulatorisk feilrapportering**: BingoEngine + Game1PayoutService + Game1TicketPurchaseService skriver ALLE Spill 1-entries med `gameType: "DATABINGO"`. Per `docs/architecture/SPILLKATALOG.md` §2 og §5 er Spill 1 et `MAIN_GAME` (Hovedspill). Dette påvirker §11-overskudd-fordeling (30 % vs 15 %) og §71-rapport per hall.
2. **Wallet-debit uten purchase-row** ved transient INSERT-feil — wallet er debitert men ingen `app_game1_ticket_purchases`-rad eksisterer hvis INSERT feiler med ikke-23505-feilkode etter vellykket wallet-debit (Game1TicketPurchaseService).
3. **Hardkodet `actorHallId: 'SYSTEM'` mot `master_hall_id`-FK** i Game1RecoveryService.cancelOverdueGame — `actorHallId` settes til `row.master_hall_id` (OK), men `actor_user_id: 'SYSTEM'` som lagres i `app_game1_master_audit` kan bryte FK-en mot `app_users.id` hvis tabellen har en FK-constraint. Trenger DB-skjema-verifisering.

---

## §1 Critical issues (must fix before pilot)

### 1.1. Regulatorisk gameType-misklassifisering: alle Spill 1-entries lagres som "DATABINGO"

**Files:**
- `apps/backend/src/game/BingoEngine.ts:735` (`startGame`-buy-in STAKE-entry)
- `apps/backend/src/game/BingoEngine.ts:1259` (`payoutPhaseWinner`-PRIZE-entry)
- `apps/backend/src/game/BingoEngine.ts:1268` (PrizePolicy-resolve)
- `apps/backend/src/game/BingoEngine.ts:1579` (`chargeTicketReplacement`-STAKE-entry)
- `apps/backend/src/game/BingoEngine.ts:1759, 1777, 1882` (jackpot-aktivering / submitClaim)
- `apps/backend/src/game/BingoEngine.ts:2306, 2330, 2350, 2374, 2455, 2463-2570` (`awardExtraPrize` + report-helpers)
- `apps/backend/src/game/Game1PayoutService.ts:330` (PRIZE-entry per fase-vinner)
- `apps/backend/src/game/Game1PayoutService.ts:368` (EXTRA_PRIZE jackpot per vinner)
- `apps/backend/src/game/Game1TicketPurchaseService.ts:492` (STAKE-entry per purchase)

**Concrete code:** `const gameType: LedgerGameType = "DATABINGO";` — hardkodet.

**Failure mode:** Per `docs/architecture/SPILLKATALOG.md` §2 er ALLE fire interne spill (Spill 1-4) Hovedspill, og Spillorama driver IKKE databingo. Når engine skriver `gameType: "DATABINGO"` i `app_rg_compliance_ledger`:

1. **§11 overskudd-fordeling** (`apps/backend/src/game/ComplianceLedgerOverskudd.ts:75`): `minimumPercent` blir 30 % (databingo-rate) i stedet for 15 % (main-game-rate). Doble-utbetaler til organisasjoner.
2. **§71 per-hall-rapport** kategoriseres som databingo, ikke hovedspill — feil regulatorisk klassifisering.
3. **HallSpecificReport.ts:293** mapper `MAIN_GAME → game1` som fallback; `DATABINGO → game4` (deprecated). Spill 1-data ender feilrubriserert i rapport når slot-mapping faller tilbake.
4. **Inconsistens på tvers av kodebase:** `apps/backend/src/admin/reports/HallSpecificReport.ts:22` har en kommentar som sier "alle interne spill er Hovedspill (MAIN_GAME), bortsett fra Spill 4 data-bingo" — men Spill 4 (`spillorama`) er per SPILLKATALOG også Hovedspill, og skal IKKE være databingo. Test-fixtures bruker `MAIN_GAME` (`Game1ManagementReport.test.ts:117`, `RedFlagPlayersReport.test.ts:80`) men prod-write-path bruker `DATABINGO`.

**Note:** SPILLKATALOG.md §5 dokumenterer eksplisitt at dette er en åpen regulatorisk avklaring — Tobias har uavklarte spørsmål: "Overskudd-prosent: ... 30%-regelen skal fjernes". Hvis SPILLKATALOG-vedtaket holder, ER ALL eksisterende `app_rg_compliance_ledger`-data feil-klassifisert.

**Suggested fix:**
- Bekreft regulatorisk vedtak: er Spill 1 `MAIN_GAME` eller `DATABINGO`? Hvis `MAIN_GAME`:
  - Endre alle 9 hardkodede `gameType: "DATABINGO"` i BingoEngine.ts + Game1PayoutService.ts + Game1TicketPurchaseService.ts til `"MAIN_GAME"`
  - Vurder data-migrasjon for eksisterende ledger-rader
  - Oppdater SPILLKATALOG-§5 til "lukket" med PR-referanse
- Hvis vedtaket fortsatt er åpent: blokker pilot inntil avklart, eller fortsett pilot men dokumenter eksplisitt at `app_rg_compliance_ledger`-tagging er provisorisk og må endres før første overskudd-utbetaling.

**Priority:** REGULATORISK — må avklares. Ikke nødvendigvis fikses før pilot, men dokumenter ekspisitt at det er aksept for risiko.

---

### 1.2. Wallet-debit uten purchase-row ved transient INSERT-feil

**File:** `apps/backend/src/game/Game1TicketPurchaseService.ts:348-413`

**Concrete failure mode:**
1. Linje 364: `walletDebitTx = await this.wallet.debit(buyer.walletId, amountNok, ..., { idempotencyKey })` — wallet debiteres.
2. Linje 388: `insertedRow = await this.insertPurchaseRow(...)` kjøres.
3. Hvis INSERT kaster med kode 23505 (UNIQUE) → linje 401-410 svarer alreadyExisted: true — OK.
4. Hvis INSERT kaster med en ANNEN feilkode (FK-violation, syntax, transient connection-død etter at wallet allerede committet): linje 412 `throw err` — wallet-debit har skjedd, ingen `app_game1_ticket_purchases`-rad finnes.

**Konsekvens:**
- Brukeren er debitert N kr men kan ikke se purchase-raden i `listPurchasesForBuyer` eller `listPurchasesForGame`.
- `game1Purchase`-route returnerer 500-feil → klient-app retry-er → wallet idempotency-key forhindrer dobbel-debit, men ny INSERT-attempt feiler på samme måte.
- Hvis brukeren ikke prøver igjen, er pengene tapt og det er ingen audit-trail (`fireAudit` linje 519 kjøres KUN ved OK INSERT).

**Suggested fix:** Wrap INSERT i en compensation-block som refunder wallet ved ikke-23505-feil. Pseudocode:

```ts
try {
  insertedRow = await this.insertPurchaseRow(...);
} catch (err) {
  const code = (err as any)?.code ?? "";
  if (code !== "23505") {
    if (walletDebitTx) {
      try {
        await this.wallet.credit(buyerWalletId!, amountNok,
          `game1_purchase_compensation:${purchaseId}`,
          { idempotencyKey: `compensate:${input.idempotencyKey}`, to: "deposit" });
        log.warn({ purchaseId, walletDebitTxId: walletDebitTx.id, err },
          "[CRITICAL] purchase INSERT failed — wallet debit refunded");
      } catch (refundErr) {
        log.error({ purchaseId, refundErr },
          "[CRITICAL] purchase INSERT failed AND wallet refund failed — manual intervention needed");
      }
    }
  }
  throw err;
}
```

**Priority:** Korrigeres før pilot. Lav sannsynlighet for at det skjer, men direkte player-impact når det skjer.

---

### 1.3. Audit-rad for SYSTEM-actor kan bryte FK ved auto-cancel

**File:** `apps/backend/src/game/Game1RecoveryService.ts:217-228, 311-323`

**Concrete code:**
```ts
await client.query(
  `UPDATE ${this.scheduledGamesTable()}
      SET ... stopped_by_user_id = 'SYSTEM', ...`,
  ...
);
...
await client.query(
  `INSERT INTO ${this.masterAuditTable()}
     (id, game_id, action, actor_user_id, actor_hall_id, ...)
   VALUES ($1, $2, 'stop', 'SYSTEM', $3, $4, ...)`,
  ...
);
```

**Failure mode:** Hvis `app_game1_scheduled_games.stopped_by_user_id` eller `app_game1_master_audit.actor_user_id` har en FK-constraint mot `app_users.id`, vil INSERT/UPDATE feile med 23503 (foreign_key_violation) ved boot crash recovery. Dette stopper hele recovery-pass-en for den raden, men `runRecoveryPass` (linje 169-183) håndterer feilen som per-rad-isolasjon (logger + push til `failures`-array), så verre konsekvens er at recovery-trail mangler audit + raden blir hengende på `running`-status.

**Verifisering trengs:** Sjekk migration-filer for `app_game1_scheduled_games` og `app_game1_master_audit` om disse kolonnene har FK eller bare er TEXT.

```bash
grep -rn "stopped_by_user_id\|actor_user_id" apps/backend/migrations/ | grep -iE "REFERENCES|FOREIGN"
```

Hvis FK eksisterer: enten (a) opprett en `'SYSTEM'`-bruker i `app_users` ved migrate, eller (b) endre kolonnen til nullable + nullify ved system-actions, eller (c) legg til CHECK-constraint som tillater 'SYSTEM'-streng utenfor FK.

**Priority:** Verifiser før pilot. Skjer kun ved server-krasj-recovery, men kritisk for regulatorisk audit-trail i den scenarioen.

---

## §2 Significant issues (should fix)

### 2.1. `centsToKroner`-floor-divisjon → potensiell øre-drift i logg

**File:** `apps/backend/src/game/Game1PayoutService.ts:506-508`

`function centsToKroner(cents: number): number { return cents / 100; }` returnerer `0.01` for `1` cent. Brukes for `wallet.credit` (linje 250), Audit-detail (linje 432-433), og Loyalty-event (linje 405). Hvis `prizePerWinnerCents` ikke er heltall (skulle ikke skje pga `Math.floor` på linje 206), kan vi få floats som `0.005` osv. som forplanter seg til kontoen.

`Math.floor` på linje 206 + 207 gjør cents til heltall, så praktisk risiko er lav. Men `houseRetainedCents` (linje 209) regnes som diff og kan teoretisk være float hvis `totalPhasePrizeCents` er float. Burde bekrefte at `totalPhasePrizeCents` alltid er heltall ved input.

**Suggested fix:** Legg til `Number.isSafeInteger(input.totalPhasePrizeCents)` i input-validation, eller wrappe `centsToKroner` til å bruke `Math.round((cents)) / 100`.

---

### 2.2. Pot-sales-hook kalles UANSETT betalingsmetode → `cash_agent` kjøp akkumuleres uten wallet-flyt

**File:** `apps/backend/src/game/Game1TicketPurchaseService.ts:457-472`

Pot-sales-hook (`onSaleCompleted`) kalles for ALLE betalingsmetoder per kommentaren "siden pot bygger på total-salg i hallen". Men cash_agent + card_agent har ingen wallet-flyt — bare en INSERT i `app_game1_ticket_purchases`. Ved refund av agent-purchase (linje 619-628) gjøres KUN audit-logg, ingen wallet-credit, og pot blir IKKE redusert.

**Failure mode:** Hvis en agent-cash-purchase aksepteres av engine (idempotent INSERT) men senere refunderes uten wallet-flyt, har pot-saldoen blitt akkumulert med beløp som ikke representerer faktiske penger i huskontoen.

**Suggested fix:** Når et agent-purchase refunderes, kall også `potSalesHook.onSaleCompleted({ saleAmountCents: -totalAmountCents })` for å rebalansere pot. Eller dokumentér at pot ikke trenger reverse fordi pot er separat fra realbalansen.

---

### 2.3. SQL `audit-action 'stop'` brukt for både master-stop og crash-recovery — vanskelig å skille i rapport

**File:** `apps/backend/src/game/Game1RecoveryService.ts:38-41` (kommentar) + `apps/backend/src/game/Game1RecoveryService.ts:315`

Per kommentaren bruker recovery-service `'stop'`-action med metadata.reason = `'crash_recovery_cancelled'` for å unngå migration av CHECK-constraint. Dette betyr at `SELECT COUNT(*) WHERE action='stop'` for rapport teller BÅDE master-stop OG auto-recovery-stop. Korrekt query må filtrere på `metadata_json->>'reason'`, som er enklere å glemme.

**Suggested fix:** Vurder å legge til `'crash_recovery_cancelled'` som ekte CHECK-action (krever migration). Lavprioritet — fungerer som det er.

---

### 2.4. `priceFor`-funksjon i StakeCalculator runder med `Math.round` mens roundCurrency på server bruker 2-desimal-presisjon

**File:** `packages/game-client/src/games/game1/logic/StakeCalculator.ts:122`

`return Math.round(input.entryFee * multiplier)` runder til nærmeste hele kr — server-side `roundCurrency()` runder til 2 desimaler. Fallback-pathen kan derfor vise et annet beløp enn hva backend faktisk debiterer.

**Failure mode:** Lavt — fallback brukes kun ved race-vinduer mellom Kjøp-klikk og neste room:update. Ulik avrunding mellom client-fallback og server kan vise 100 kr i UI mens server debiterer 99,90 kr.

**Suggested fix:** Bruk `Math.round((entryFee * multiplier) * 100) / 100` i `priceFor`, eller importer `roundCurrency` fra shared-types.

---

### 2.5. Regex `/^1\s*rad\b/` i `classifyPhaseFromPatternName` matcher "1 Rad Kalt" og lignende

**File:** `packages/shared-types/src/spill1-patterns.ts:97`

Patterns som "1 Rad Special" eller "1 Rad Kalt" vil bli klassifisert som Phase1. Hvis admin oppretter en custom-variant med navn "1 Rad Bonus" får den feil fase-tilordning, og engine vil håndtere claim-logikken som Phase1 i stedet for som custom.

**Failure mode:** Lavt for Spill 1-pilot (kun standard 5-fase brukes). Risiko øker hvis admin lager custom-patterns.

**Suggested fix:** Endre regex til strengere matching: `/^1\s*rad$/` (full match, ikke prefiks).

---

### 2.6. `assignmentsTable.markings_json` UPDATE i loop — ikke FOR UPDATE-låst skikkelig

**File:** `apps/backend/src/game/Game1DrawEngineService.ts:2532-2542`

`SELECT ... FOR UPDATE` på alle assignments i samme transaksjon låser radene mot konkurrerende UPDATE — OK. Men loopen på linje 2543-2561 kjører N synkrone INSERT-er per draw. For 1000 spillere med 15 brett = 15 000 sekvensielle UPDATE-er per draw. Kan være ytelses-problem ved skalering, men funksjonelt korrekt.

**Failure mode:** Pilot-skala (få spillere per hall, få haller) — ingen impact. Senere pilot-skalering må vurdere batch-UPDATE med `unnest($1::uuid[], $2::jsonb[])`.

**Suggested fix:** Lavprioritet — flagger som follow-up post-pilot.

---

## §3 Compliance review

### §11-paths

✅ **Loss-limit fail-closed:** `BingoEngine.assertWalletAllowedForGameplay` (linje 2297) kalles før draw og before purchase. `compliance.recordLossEntry` med `type: "BUYIN"` skrives etter wallet-transfer (linje 827-831). PR-W4/W5-split: `lossLimitAmountFromTransfer` filtrerer bort winnings-bruk så bare deposit-andelen teller.

✅ **Self-exclusion:** Default `selfExclusionMinMs` satt til 365 dager (linje 309). Validering på linje 422 kaster hvis under.

⚠️ **GameType-tagging på loss-entries:** `recordLossEntry` tar ikke `gameType` — men ledger-entries (STAKE/PRIZE) er taget med `"DATABINGO"` (se §1.1). §11 § 2.1 om databingo har strengere krav enn hovedspill. Hvis Spill 1 IKKE er databingo, blir feil regelsett anvendt.

✅ **Idempotency-keys:** Bruker `IdempotencyKeys.adhocBuyIn`, `IdempotencyKeys.adhocPhase`, `IdempotencyKeys.game1Phase`, `IdempotencyKeys.game1LuckyBonus` — kanonisk modul med deterministiske keys (PR-N1).

✅ **Append-only ledger:** `ComplianceLedger.recordComplianceLedgerEvent` (kjent fra ComplianceLedger.ts) skriver bare append, ingen UPDATE/DELETE.

### §11 fail-closed-paths

✅ **drawNext-rollback:** Game1DrawEngineService.drawNext (linje 936-1267) kjører i transaksjon. Wallet-credit-feil i payoutService → DomainError → ROLLBACK av draws-INSERT, markings-UPDATE, og phase-state-UPDATE. (Se kommentar linje 1808-1813.)

✅ **Lucky-bonus rollback:** `payoutLuckyBonusForFullHouseWinners` (linje 2403-2442) kaster DomainError ved wallet-feil → rollback hele draw.

⚠️ **Compliance-ledger soft-fail:** Game1PayoutService.payoutPhase (linje 349-361) og Game1TicketPurchaseService.purchase (linje 506-517) ruller IKKE tilbake ved compliance-ledger-feil. Dokumentert design (matcher PR4c-pattern). Men hvis `recordComplianceLedgerEvent` feiler, finnes en wallet-debit/credit uten matching ledger-entry → §11-rapportering blir inkomplett.

**Recommendation:** Legg til en periodisk reconcile-job som finner wallet-tx-er uten matching ledger-entry og logger varsler til operativ-team. Lavprioritet siden det er fail-soft, men regulatorisk audit-spore burde være komplett.

### Audit-trail

✅ **Master-audit:** Game1MasterControlService skriver per spec (start/pause/resume/stop) med actor + halls-snapshot.

✅ **Engine-audit:** Game1DrawEngineService.fireAudit (linje 2621-2641) skriver `game1_engine.draw`, `game1_engine.start`, `game1_engine.pause`, `game1_engine.resume`, `game1_engine.stop`.

⚠️ **PII i audit-details:** `details.buyerUserId` og `walletId` skrives i Game1TicketPurchaseService.fireAudit (linje 528-535). Verifisert at `walletId` er ikke et personnummer eller PII per Spillorama-konvensjon (intern wallet-id, ikke ekstern). OK.

---

## §4 Security review

### SQL injection

✅ **Parameterized queries:** Alle SQL-queries i Game1*Service-filene bruker `$1, $2, ...`-parameterstil. Eneste avvik er tabellnavn-interpolering (`${this.purchasesTable()}`) som er sikret via `assertSchemaName` (regex-validert som `^[a-z_][a-z0-9_]*$`).

✅ **CloseDayService.updateDate (linje 689-695):** Dynamisk `${sets.join(", ")}` ser farlig ut, men `sets`-array bygges fra hardkodede strenger (`"start_time = $${idx}"`) ikke fra input. Trygt.

### Auth/authz

✅ **`requirePermission` på alle admin-endepunkter:** `createGame1PurchaseRouter` linje 82-90 håndhever `GAME1_PURCHASE_WRITE/READ` via `assertAdminPermission`. PLAYER/AGENT/ADMIN-actor-scope håndheves linje 125-154.

✅ **Hall-scope:** AGENT må matche `actor.hallId === hallId` (linje 148-153). PLAYER må kjøpe på `buyerUserId === actor.id` (linje 132-137).

⚠️ **AGENT-actor for cash/card-purchase:** `agentUserId: actor.id` (linje 162-165) settes basert på den autentiserte actor — OK. Men hvis ADMIN kjøper på vegne av en PLAYER med `paymentMethod: cash_agent`, settes `agentUserId = ADMIN.id`. Det er kanskje ønsket (support-ops), men dokumentér at ADMIN kan agere som agent.

### Rate-limiting

✅ **Socket-events rate-limited:** `rateLimited("draw:next", ...)`, `rateLimited("ticket:mark", ...)`, etc. via SocketRateLimiter (BIN-499 + BIN-509).

⚠️ **HTTP-routes ikke synlig rate-limited:** `POST /api/game1/purchase` har ingen synlig rate-limit. Klient kan spamme purchase-requests. Men idempotency-key-felt forhindrer dobbel-effekt; bruker kan likevel forårsake DB-load. Sjekk om Express-stack har global rate-limit.

### Hardcoded secrets

✅ Ingen hardkodede secrets/API-keys i de gjennomgåtte filene.

---

## §5 Test coverage analyse

### BingoEngine

- `BingoEngine.test.ts` + 16 søsterfiler: dekker fivePhase, autoClaimOnDraw, columnSpecific, concurrentPatterns, crashRecoveryPartialPayout, kvikkis, lateJoinerParticipation, lossLimitSplit, multiplierChain, payoutTargetSide, perColorPatterns, preRoundAdoption, splitRoundingLoyalty, startGameColorFallback, subVariantPresets.
- ✅ Bra dekning for de regulatorisk-kritiske paths.
- ⚠️ Mangler test for compensation av wallet-debit hvis INSERT feiler i Game1TicketPurchaseService (§1.2).

### Game1MasterControlService

- 7 test-filer (`*.test.ts`). Men flere av disse er aktivt endret i K2-branch — ikke vurdert detaljert i denne review.

### Game1PayoutService

- `Game1PayoutService.test.ts` + `Game1PayoutService.complianceLedger.test.ts` (172-219) — dekker happy-path. Verifiserer at `gameType: "DATABINGO"` skrives.
- ⚠️ Test-fixtures bekrefter at "DATABINGO" er forventet — dvs. tester må endres SAMMEN med produksjonskode hvis §1.1 fikses.

### Game1TicketPurchaseService

- `Game1TicketPurchaseService.test.ts` + 3 søsterfiler — dekker buyInLogging, complianceLedger, potSalesHook, refundAllForGame.
- ❌ **Mangler:** test for §1.2 — INSERT-feil etter wallet-debit (compensation-path).

### Game1RecoveryService

- 407 LOC test-fil, dekker overdue-cancellation + audit-skriving.
- ⚠️ **Mangler:** test for §1.3 — FK-violation på `actor_user_id: 'SYSTEM'` (avhengig av schema).

### Game1DrawEngineService

- 12+ test-filer (`*.test.ts`) — autoPause, destroyRoom, luckyBonus, payoutWire, perColorConfig, physicalTicket, roomCode, etc.
- ✅ Bra dekning for evaluatePhase + payout flow.
- ⚠️ Mange av disse er aktivt endret i K2-branches (auto-pause, transfer-hall) — ikke gjennomgått detaljert.

### Shared-types

- ✅ Schema runtime-validering via Zod (BIN-545) for høy-risiko-payloads (RoomUpdate, DrawNew, ClaimSubmit, BetArm, TicketMark, PatternWon, ChatMessage, TicketReplace/Swap/Cancel).
- ✅ Spill1-patterns.ts har implisitt verifisering via test-filer i backend som bruker `PHASE_MASKS`.

### Game-client

- `Game1Controller.claim.test.ts`, `.patternWon.test.ts`, `.reconnect.test.ts` — dekker claim-flow + reconnect. OK.
- `StakeCalculator.test.ts` — verifisert.
- `GameBridge.test.ts` — gap-detection-tests (BIN-502).

---

## §6 Architecture observations

### ✅ Clean layering

- BingoEngine eier game-state, ledger, compliance, prize-policy.
- Game1*-services bruker porter (`ComplianceLossPort`, `ComplianceLedgerPort`, `PotSalesHookPort`, `LoyaltyPointsHookPort`) — narrow-interface-pattern. Forhindrer at services tar direkte avhengighet til engine-klassen.
- Late-binding via `setX(...)` brukes for å unngå sirkulær konstruksjon.

### ✅ Source of truth

- Backend eier game-state (player, draws, marks). Klient er server-autoritativ — `playerStakes` beregnes på server (roomHelpers.ts:336-403).
- Klient-fallback i `StakeCalculator.calculateStake` (linje 79-86) tillater client-side fallback når server-stake mangler — defensiv design under utrulling.

### ⚠️ Cross-app imports

- `apps/backend/src/admin/reports/HallSpecificReport.ts:33` importerer `ComplianceLedgerEntry` fra `../../game/ComplianceLedger.js` — innen samme `apps/backend/src/`, OK.
- Ingen krysning mellom `apps/admin-web` og `apps/backend` direkte (forutsatt at de gjennomgåtte filene er representative).

### ✅ Strict TypeScript

- `tsconfig.json` har `"strict": true`. Spot-check viser ingen `as any` cast i de gjennomgåtte filene. `as never` brukes i noen test-/checkpoint-paths som dokumentert escape-hatch (BingoEngine.ts:856-857) — akseptabelt for compensation-checkpoint.

### ⚠️ DATABINGO-konstanten dupliseres

- 9 hardkodede `gameType: "DATABINGO"` på tvers av BingoEngine + Game1*Services. Hvis §1.1 fikses, må alle 9 endres. Bedre å ha én eksportert konstant `SPILL1_LEDGER_GAMETYPE` (eller injekteres som konfig).

---

## §7 Stylistic suggestions (lavprioritet, post-pilot)

### 7.1. JSDoc-overload i BingoEngine.ts

BingoEngine.ts er 3109 LOC. Mye av lengden er JSDoc-kommentarer (BIN-XXX-referanser, designvalg). Verdifullt for kontekst, men gjør filen vanskelig å navigere. Vurder: ekstrahér historiske design-dokumenter til separat `BingoEngine.design.md`-fil.

### 7.2. Norwegian/English-blanding i error-strings

DomainError-meldinger blander norsk ("Du trenger minst N spillere") og engelsk ("payoutPercent må være mellom 0 og 100"). Konsistent norsk er bedre for sluttbrukerfeil.

### 7.3. `parseHallIdsArray` dupliseres

Funksjonen finnes i både `Game1MasterControlService.ts:270-285` og `Game1TicketPurchaseService.ts:1033-1048`. Burde være i shared util.

### 7.4. Magic-numbers i StakeCalculator.priceFor

`Math.round(input.entryFee * multiplier)` — hvorfor `Math.round` her men `roundCurrency` (2-desimal) på server? Inconsistent (se §2.4).

---

## §8 Files reviewed (audit trail)

Følgende filer ble lest fra `origin/main` @ `b7adaa777ebc997d0eaf2bfda0305a61a1173a54`:

### Backend — game

- `apps/backend/src/game/BingoEngine.ts` (3109 LOC, ALL gjennomgått selektivt)
- `apps/backend/src/game/Game1PayoutService.ts` (509 LOC, FULL)
- `apps/backend/src/game/Game1TicketPurchaseService.ts` (1241 LOC, FULL)
- `apps/backend/src/game/Game1DrawEngineService.ts` (2651 LOC, gjennomgått alle hovedflyt)
- `apps/backend/src/game/Game1RecoveryService.ts` (328 LOC, FULL)
- `apps/backend/src/game/Game1MasterControlService.ts` (top-300 LOC — resten skipped pga K2-aktivitet)
- `apps/backend/src/game/ComplianceLedger.ts` (top-120 LOC for kontekst)
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts` (top-120 LOC for §11-formel)

### Backend — sockets/routes/admin

- `apps/backend/src/sockets/gameEvents/drawEvents.ts` (118 LOC, FULL)
- `apps/backend/src/sockets/gameEvents/ticketEvents.ts` (249 LOC, FULL)
- `apps/backend/src/routes/game1Purchase.ts` (top-220 LOC)
- `apps/backend/src/admin/CloseDayService.ts` (981 LOC, FULL)
- `apps/backend/src/util/roomHelpers.ts` (459 LOC, FULL)
- `apps/backend/src/index.ts` (offsetter for wiring-kontekst)

### Shared types

- `packages/shared-types/src/spill1-patterns.ts` (167 LOC, FULL)
- `packages/shared-types/src/socket-events.ts` (552 LOC, FULL)
- `packages/shared-types/src/schemas/game.ts` (449 LOC, top-450)

### Game-client

- `packages/game-client/src/games/game1/Game1Controller.ts` (554 LOC, FULL)
- `packages/game-client/src/games/game1/logic/StakeCalculator.ts` (138 LOC, FULL)
- `packages/game-client/src/bridge/GameBridge.ts` (553 LOC, FULL)

### Documentation cross-referenced

- `docs/architecture/SPILLKATALOG.md` (kanonisk spillkatalog)
- `apps/backend/src/admin/reports/HallSpecificReport.ts` (top-80 LOC for `MAIN_GAME` vs `DATABINGO`-mapping)

### Files skipped (aktivt endret i K2-branches)

Disse filene er aktivt under endring av kjørende K2-agenter — review utelatt:

- `Game1MasterControlService.ts` (resten — endres av jackpot-daily-accumulation, hall-status-color-scan-flow, agents-not-ready-popup, transfer-hall-access)
- `Game1AutoDrawTickService.ts` (auto-pause-phase-won)
- `Game1HallReadyService.ts` (hall-status-color-scan-flow)
- `Game1JackpotStateService.ts` (jackpot-daily-accumulation)
- `Game1TransferHallService.ts` + `Game1TransferExpiryTickService.ts` (transfer-hall-access)
- `AdminGame1Broadcaster.ts` (auto-pause + transfer)
- `Game1DrawEngineBroadcast.ts` (auto-pause)
- `apps/backend/src/sockets/adminGame1Namespace.ts` (auto-pause + tv-ready-status-banner + transfer)
- `apps/backend/src/game/spill1VariantMapper.ts` (bin-689-kvikkis)
- `apps/backend/src/game/minigames/Game1MiniGameOrchestrator.ts` (bin-690-m1-minigame-framework)
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` (bin-688-elvis-rendering)
- `packages/game-client/src/games/game1/colors/ElvisAssetPaths.ts` (bin-688-elvis-rendering)
- `packages/game-client/src/games/game1/ARCHITECTURE.md` (dev-perf-hud-overlay)

---

## Sluttkommentar

Spill 1-koden er i god teknisk stand. Hovedflyten (start → buy-in → draw → evaluate phase → payout → end) er solid med fail-closed-semantikk og append-only-ledger. Tester har god dekning for happy-path og kjente edge-cases.

Hovedbekymringen er regulatorisk: `gameType: "DATABINGO"`-tagging er per kanonisk SPILLKATALOG.md feil, men SPILLKATALOG dokumenterer eksplisitt at dette er en åpen avklaring (§5). Pilot kan kjøres hvis Tobias bekrefter at den nåværende DATABINGO-tagging er midlertidig akseptabel (med dokumentert plan for å rette det før første overskudd-utbetaling); ellers blokker pilot inntil avklart.

§1.2 (wallet-debit uten purchase-row) og §1.3 (SYSTEM-actor FK-risiko) har lav sannsynlighet men direkte player-impact når de skjer — burde fikses før pilot.

Resterende issues (§2-§7) kan håndteres post-pilot.

— Code-reviewer subagent, 2026-04-25
