# Code Review: Wallet + Compliance + Audit-trail (2026-04-27)

**Scope:** Money-safety + regulatorisk samspill for Spill 1-pilot.
**Branch:** `docs/code-review-wallet-compliance-audit-2026-04-27`
**Reviewer:** Independent code reviewer (PM-direktiv: vanntatt bingoday-flyt)
**Files reviewed:** PostgresWalletAdapter (2307 LOC), ComplianceLedger (525 LOC),
ComplianceManager (1054 LOC), AuditLogService (442 LOC), AgentTransactionService
(824 LOC), Game1TicketPurchaseService, Game1PayoutService, BingoEngine (relevant
sections), BingoEngineMiniGames, Game2Engine, Game3Engine, PotEvaluator,
Game1MiniGameOrchestrator, AgentSettlementService, WalletAuditVerifier,
WalletOutboxRepo + Worker, ledgerGameTypeForSlug, ComplianceLedgerValidators.

## Sammendrag

| Severity | Antall |
|---|---:|
| **P0** (money-loss eller regulatorisk risiko) | **8** |
| **P1** (polish, ikke pilot-blokker) | 5 |
| **P2** (nice-to-have) | 3 |

**Hovedfunn:** Wallet-laget (BIN-761/762/763/764) er solid casino-grade. Hash-chain,
outbox, REPEATABLE READ + retry, breaker, deposit/winnings-split, FOR UPDATE +
serialization-retry, og admin-winnings-credit-gate er alle på plass. **Men det
er regulatoriske §11- og §66-hull rundt enforcement-laget** — flere kjøps- og
cash-ops-paths som er pilot-kritiske bypasser ComplianceManager-gates. I tillegg
er `gameType: "DATABINGO"` fortsatt hardkodet i 7 hot-path-call-sites, inkludert
Spill 2/3, Game 1 ad-hoc-mini-games, og PotEvaluator.

---

## P0 — MÅ fixes før simulert bingoday-flyt

### P0-1 — `Game1TicketPurchaseService.purchase` mangler self-exclusion-check

```
[P0] apps/backend/src/game/Game1TicketPurchaseService.ts:353-374 (digital_wallet)
ISSUE: purchase() debiterer player wallet UTEN å kalle
  compliance.assertWalletAllowedForGameplay(walletId). En spiller på 1-års
  selvutestengelse, 60-min mandatorisk pause, eller frivillig timed-pause
  kan kjøpe Spill 1-bonger via Game1HallReadyService → debit → ledger.
SAMSPILL: ComplianceManager (assert-gate ikke kalt) → ComplianceLedger STAKE
  registreres → Hall Account Report viser kjøp av selvutestengt spiller.
REGULATORISK-RISIKO: JA — pengespillforskriften §66 (mandatorisk pause) og
  §23 (1-års selvutestengelse). Lotteritilsynet-revisjon vil flagge dette.
RIPLE-EFFECT: Wallet-debit committet, ledger-STAKE skrevet, BUYIN loss-entry
  skrevet, men spilleren skulle aldri ha hatt mulighet til å kjøpe. Ingen
  rollback hvis oppdaget post-hoc — kun manuell refund + ekstern rapport.
FIX: Tidlig-gate i purchase() før wallet.debit:
  ```ts
  if (input.paymentMethod === "digital_wallet") {
    const buyer = await this.platform.getUserById(input.buyerUserId);
    this.complianceManager.assertWalletAllowedForGameplay(buyer.walletId);
    // ... existing balance + debit ...
  }
  ```
  For `cash_agent`/`card_agent`: agent-portalen må også sjekke (P0-2).
TEST: Add `Game1TicketPurchaseService.selfExcludedRejected.test.ts` —
  selvutestengt spiller forsøker digital_wallet purchase → forventer
  `PLAYER_SELF_EXCLUDED` DomainError, INGEN wallet-debit, INGEN ledger-entry.
```

### P0-2 — `AgentTransactionService.processCashOp` mangler self-exclusion-check + compliance-ledger

```
[P0] apps/backend/src/agent/AgentTransactionService.ts:268-352 (processCashOp)
     apps/backend/src/agent/AgentTransactionService.ts:464-567 (sellPhysicalTicket)
ISSUE 1 (self-exclusion): Agent kan kreditere wallet for selvutestengt spiller.
  Agent kan også selge fysisk ticket for selvutestengt spiller. Ingen kall til
  `compliance.assertWalletAllowedForGameplay`.
ISSUE 2 (compliance-ledger): AgentTransactionService har ingen
  ComplianceLedgerPort. CASH_IN/CASH_OUT/TICKET_SALE skrives KUN til
  app_agent_transactions, IKKE til ComplianceLedger. § 71-rapport per hall vil
  mangle hall-cash-bong-salg fra agenten — Hovedspill 1 i hall (kontant)
  rapporteres ikke per pengespillforskriften.
SAMSPILL: ComplianceManager (gate ikke kalt) + ComplianceLedger (event ikke
  skrevet) + HallAccountReportService (regner ut net-revenue fra agent_tx for
  cash, men §11-distribusjon (15% til org) går via ComplianceLedger som er
  TOM for fysisk-cash-Spill-1 i hall). Settlement-rapport blir korrekt for
  cash, men Lotteritilsynet-rapporten mangler.
REGULATORISK-RISIKO: JA — §11 (regnskap til organisasjoner) og §66/§23
  (selvutestengelse/mandatorisk pause).
RIPLE-EFFECT: Hovedspill 1 i hall (kontant) eksisterer ikke i §11-aggregert
  rapport. Når overskudd-fordeling kjøres for hall, blir basis kun internett-
  Spill 1 + Spill 2/3/SpinnGo. Distribusjon til organisasjoner blir feil.
FIX:
  1. Legg til `complianceManager` + `complianceLedgerPort` på
     `AgentTransactionServiceDeps`.
  2. I `processCashOp` — før `wallet.credit/debit`:
     `complianceManager.assertWalletAllowedForGameplay(player.walletId);`
  3. I `sellPhysicalTicket` — etter `markSold` + (potential) wallet-debit, skriv
     STAKE til ComplianceLedger:
     ```ts
     await this.complianceLedgerPort.recordComplianceLedgerEvent({
       hallId: shift.hallId,
       gameType: ledgerGameTypeForSlug("bingo"),  // Spill 1 hovedspill
       channel: "HALL",          // fysisk salg via agent
       eventType: "STAKE",
       amount: priceNok,
       playerId: player.id,
       walletId: player.walletId,
       metadata: { reason: "AGENT_PHYSICAL_TICKET_SALE",
                   ticketUniqueId: ticket.uniqueId, paymentMethod: input.paymentMethod }
     });
     ```
  4. Samme fix i `addMoneyToUser`/`withdrawFromUser` for self-exclusion-gate
     (CASH_IN til selvutestengt = unødvendig men ikke direkte ulovlig — kjøp er
     blokkert via P0-1 + denne. CASH_OUT skal være tillatt — spilleren skal
     kunne ta ut penger selv om selvutestengt.).
TEST:
  - `AgentTransactionService.compliance.test.ts` — selvutestengt spiller, agent
    forsøker `cashIn` → `PLAYER_SELF_EXCLUDED`, `sellPhysicalTicket` →
    `PLAYER_SELF_EXCLUDED`. CASH_OUT skal lykkes (ikke blokkere uttak).
  - `AgentTransactionService.complianceLedgerEntry.test.ts` — fysisk-cash-salg
    → assert at recordComplianceLedgerEvent ble kalt med channel="HALL",
    gameType="MAIN_GAME" (slug `bingo`).
```

### P0-3 — Spill 2 og Spill 3 hardkoder fortsatt `gameType: "DATABINGO"`

```
[P0] apps/backend/src/game/Game2Engine.ts:168, 320, 444
     apps/backend/src/game/Game3Engine.ts:254, 485
ISSUE: Spill 2 (rocket) og Spill 3 (monsterbingo) er hovedspill (15% til
  organisasjoner) per docs/architecture/SPILLKATALOG.md, men engine-koden
  bruker hardkodet `gameType: "DATABINGO"` for alle ledger-events
  (BUYIN STAKE + LINE/BINGO PRIZE + lucky-bonus PRIZE).
SAMSPILL: ComplianceLedger registrerer STAKE/PRIZE som DATABINGO →
  ComplianceLedgerOverskudd.ts:75 bruker `gameType === "DATABINGO" ? 0.3 : 0.15`
  → Spill 2/3 gir feil 30% til organisasjoner istedenfor lovlig 15%.
REGULATORISK-RISIKO: JA — pengespillforskriften §11. Spill 2/3 skal
  klassifiseres som hovedspill med 15%-minstegrense, ikke databingo med 30%.
  Lotteritilsynet-revisjon vil identifisere klassifiseringsfeil.
RIPLE-EFFECT: Hvis Spill 2/3 går i pilot uten fix — 30% til org-fordeling,
  15% av netto-omsetning blir ulovlig hus-retain (tilbake-utbetaling kreves).
FIX: Bruk `ledgerGameTypeForSlug(room.gameSlug)` slik Game1 + scheduled
  Spill 1 gjør:
  ```ts
  // Game2Engine.ts:168 (og line 320, 444)
  const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
  ```
  Resolveren returnerer `DATABINGO` for ukjente slugs (bevarer eksisterende
  oppførsel for SpinnGo/spillorama). Endring av Spill 2/3 må også oppdatere
  resolveren:
  ```ts
  const SPILL_HOVEDSPILL_SLUGS = new Set(["bingo", "rocket", "monsterbingo"]);
  if (SPILL_HOVEDSPILL_SLUGS.has(trimmed)) return "MAIN_GAME";
  ```
TEST:
  - `Game2Engine.gameType.test.ts` — buyIn + LINE-payout → ledger-entry har
    gameType="MAIN_GAME".
  - `Game3Engine.gameType.test.ts` — samme.
  - `ledgerGameTypeForSlug.test.ts` — utvid til å assert MAIN_GAME for rocket
    og monsterbingo, DATABINGO for spillorama.
NOTE: Pilot-fokus er Spill 1 (per CLAUDE.md "Spill 1 først"). Hvis Spill 2/3
  IKKE kjøres i pilot, kan dette utsettes — men master-plan §10 sier alle K1
  + P0 er merget. Sjekk med PM om Spill 2/3 er pilot-scope. Hvis ja, FIX nå.
```

### P0-4 — `BingoEngineMiniGames` (ad-hoc-engine) hardkoder DATABINGO for Spill 1 mini-games

```
[P0] apps/backend/src/game/BingoEngineMiniGames.ts:153, 326
ISSUE: spinJackpot og playMiniGame i ad-hoc-engine (brukt av sockets
  miniGameEvents.ts:36/48) bruker `gameType = "DATABINGO" as const` for
  payout. Når ad-hoc-rom kjører Spill 1 (slug `bingo`) registreres mini-game-
  premier som DATABINGO-EXTRA_PRIZE i ledger.
SAMSPILL: ComplianceLedgerOverskudd → 30%-fordeling istedenfor 15%.
REGULATORISK-RISIKO: JA — samme som P0-3.
RIPLE-EFFECT: Ad-hoc-rom for Spill 1 (test/dev) blir feil i §11. I pilot kan
  dette være ikke-aktivt (scheduled-flyt gjennom Game1MiniGameOrchestrator er
  korrekt — bruker ledgerGameTypeForSlug("bingo")). Verifiser om ad-hoc er
  påslått i pilot.
FIX:
  ```ts
  // BingoEngineMiniGames.ts:153 og 326
  import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
  const gameType = ledgerGameTypeForSlug(room.gameSlug);
  ```
  Krever at `room.gameSlug` propagerer til MiniGamesContext (allerede synlig
  via `room: RoomState`).
TEST: `BingoEngineMiniGames.mainGameLedger.test.ts` — Spill 1 (slug bingo)
  ad-hoc rom, BINGO + spinJackpot → ledger har gameType=MAIN_GAME.
```

### P0-5 — `AgentMiniGameWinningService.recordWinning` hardkoder DATABINGO

```
[P0] apps/backend/src/agent/AgentMiniGameWinningService.ts:447
ISSUE: REQ-146 path — agent registrerer Spill 1 mini-game-vinner manuelt
  (Wheel of Fortune / Treasure Chest etc.). Skriver `gameType: "DATABINGO"`
  hardkodet til ledger-entry, men dette er Spill 1 (hovedspill).
SAMSPILL: §11 distribusjon-feil (30% istedenfor 15%).
REGULATORISK-RISIKO: JA — §11.
RIPLE-EFFECT: Manuelle physical-cashout-mini-game-payouts klassifiseres feil
  i §11-rapport.
FIX:
  ```ts
  // AgentMiniGameWinningService.ts:447
  gameType: ledgerGameTypeForSlug("bingo"),  // service er Spill 1-spesifikk
  ```
TEST: `AgentMiniGameWinningService.gameType.test.ts` — assert MAIN_GAME i
  recordComplianceLedgerEvent-payload.
```

### P0-6 — `BingoEngine.awardExtraPrize` hardkoder DATABINGO + uses room-less hallId

```
[P0] apps/backend/src/game/BingoEngine.ts:3294, 3318
ISSUE: `awardExtraPrize` brukes av admin-route for å gi ekstra-premie til en
  spillers wallet, og kalles uavhengig av spill-slug. Den hardkoder
  `gameType: "DATABINGO"` både i prize-policy-resolve (line 3294) og
  ledger-event (line 3318). For Spill 1-relaterte ekstra-premier
  (admin-bonus i Spill 1-runde) er dette feil §11-klassifisering.
SAMSPILL: ComplianceLedger EXTRA_PRIZE som DATABINGO → 30% fordeling.
REGULATORISK-RISIKO: JA — §11.
RIPLE-EFFECT: Admin-utbetalte bonuser klassifiseres feil. Bruksvolum lavt,
  men hver feilet entry skader §11-rapport.
FIX: Legg til `gameSlug` (eller `gameType`) på input-parametere og bruk
  ledgerGameTypeForSlug. Alternativt: ta hensyn til at admin må spesifisere
  slug ved bonus-utbetaling.
  ```ts
  awardExtraPrize(input: { ... gameSlug?: string; ... }) {
    const gameType: LedgerGameType = ledgerGameTypeForSlug(input.gameSlug);
    ...
  }
  ```
TEST: `BingoEngine.awardExtraPrize.gameType.test.ts` — assert at
  gameSlug="bingo" → gameType="MAIN_GAME".
```

### P0-7 — `PotEvaluator` binder ledger-event til pot.hallId, ikke firstWinner.hallId

```
[P0] apps/backend/src/game/pot/PotEvaluator.ts:639 (og 540, 585, 598, 670)
ISSUE: For multi-hall-spill der pot ble opprettet i master-hall, men firstWinner
  kjøpte sin bong i en linked-hall, registreres EXTRA_PRIZE-ledger-entry mot
  pot.hallId (master-hall) — IKKE firstWinner.hallId (kjøpe-hall, som er den
  korrekte for §71). PotEvaluatorWinner har `hallId: string` allerede, men det
  brukes ikke i ledger-call.
SAMSPILL: §71 hall-binding brytes. Hall Account Report for linked-hall
  mangler ekstra-premie-utbetaling som faktisk gikk til en spiller i den
  hallen. §11-overskudd-distribusjon for linked-hall blir feil — netto-tap
  (stake - prize) er for lavt der spillerens bong faktisk ble solgt.
REGULATORISK-RISIKO: JA — §71 multi-hall-binding (samme regelen som K1.1
  fixet for Game1TicketPurchaseService og Game1PayoutService).
RIPLE-EFFECT: Pot-utbetaling registreres i master-hallens ledger; linked-
  hallens spend (hvor premien gikk) ikke. Dette skaper net-revenue-divergens
  mellom Hall Account Report og §11-rapporten.
FIX:
  ```ts
  // PotEvaluator.ts:639
  await ledgerPort.recordComplianceLedgerEvent({
    hallId: firstWinner.hallId,  // ← endre fra pot.hallId
    gameType: ledgerGameTypeForSlug("bingo"),
    ...
  });
  ```
  Audit-log (line 622) kan beholde pot.hallId siden det er pot-state-info,
  men ledger-event MÅ bindes til winner.hallId per §71.
TEST: `PotEvaluator.multiHallLedgerBinding.test.ts` — pot opprettet i
  master-hall H1, firstWinner kjøpte i linked-hall H2 → ledger-EXTRA_PRIZE
  har hallId=H2.
```

### P0-8 — Audit-log fire-and-forget kan miste regulatorisk audit ved DB-outage

```
[P0] apps/backend/src/compliance/AuditLogService.ts:212-239 (PostgresAuditLogStore.append)
ISSUE: AuditLogService.record() er fire-and-forget — ved DB-feil logges en
  pino warn og hendelsen forsvinner. For regulatoriske audit-events som
  KYC approve/reject, self-exclusion-set, agent-cash-handling-AML, kan dette
  føre til at Lotteritilsynet ikke kan rekonstruere "hvem gjorde hva, når".
  Pino-loggen er ikke en sertifisert audit-trail.
SAMSPILL: AuditLogService.record kalles fra alle compliance-paths
  (KYC moderation, self-exclusion, payment-requests, agent-tx). En 5-min
  DB-outage = 5 min audit-events tapt. Compliance-revisjon vil ikke kunne
  rekonstruere disse hendelsene.
REGULATORISK-RISIKO: JA — pengespillforskriften §6 (selvutestengelses-
  log), §11 (audit-trail), spillvett-grunnlovsbeskytelse.
RIPLE-EFFECT: Tap av audit-events. Ved feil kan KYC-godkjennelser ikke
  bevises. Self-exclusion-set/clear-events kan ikke rekonstrueres. Pino-
  redaction redder det fra PII-leak men ikke fra regulatorisk evidence-
  retention.
FIX (multi-fase):
  - Korttidsfix: outbox-pattern også for audit-events. Skriv outbox-rad i
    SAMME tx som domain-mutationen, dispatch til audit-DB asynkront. Outbox-
    raden persisterer til DB-en kommer opp igjen.
  - Alternativ: BIN-761-style outbox dedikert audit. WalletOutboxRepo kan
    være en mal.
  - For pilot: aksepter dagens nivå, men vurder om kritiske events
    (KYC.approve/reject + self-exclusion.set/clear + admin-credit) skal være
    blokkerende — return 503 hvis audit-DB nede.
TEST: `AuditLogService.criticalEventsRetry.test.ts` — DB-outage simulering,
  verifiser at audit-event ikke tapes.
NOTE: Fire-and-forget-mønsteret er BIN-588-vedtatt (matcher
  ChatMessageStore-BIN-516). Klassifisering av "kritisk" vs "ikke-kritisk"
  audit-event krever PM-vedtak. Pilot kan kjøre dagens nivå hvis
  pino-redaction + structured logs gir nok backup, men long-term er outbox
  korrekt.
```

---

## P1 — Polish, kan utsettes til post-pilot

### P1-1 — `redactDetails` mangler `email`, `displayName`, `phone` i REDACT_KEYS

```
[P1] apps/backend/src/compliance/AuditLogService.ts:101-117
ISSUE: REDACT_KEYS dekker password/token/ssn/cardnumber/etc., men IKKE
  email, displayName, phone. Audit-log kan inneholde plaintext PII selv om
  pino-loggen redacter — DB-raden gjør det ikke.
SAMSPILL: Game1TicketPurchaseService.fireAudit() inkluderer scheduledGameId,
  hallId etc. — ikke email/phone direkte, men noen agent-paths logger
  payment-confirm-flows der phone kan inngå i `details.note`-tekst.
REGULATORISK-RISIKO: GDPR-relevant; ikke direkte §11-pengespill.
FIX: Utvid REDACT_KEYS til å redacte de mest sensitive i tillegg:
  ```ts
  const PII_REDACT_KEYS = new Set(["email", "phonenumber", "phone", "ipaddress"]);
  // Merk: ipAddress lagres som dedikert kolonne, ikke i details. Email/phone
  // er trolig i details fra register-flow og password-reset.
  ```
  Behold dagens REDACT_KEYS som "hard secrets"; legg til separat
  PII_REDACT_KEYS som callere kan opt-out av når de eksplisitt vil persistere
  PII (men da sjekkes typically input.actorId istedenfor).
TEST: Utvid `redactDetails`-tester til å kjøre eksempler med email/phone i
  vilkårlige payload-shapes.
```

### P1-2 — `AgentSettlement.machineBreakdown` (JSONB) mangler schema-versjonering

```
[P1] apps/backend/src/agent/MachineBreakdownTypes.ts (ingen `version`-felt)
     apps/backend/src/agent/AgentSettlementStore.ts:274 (JSON.stringify, ingen versjon)
ISSUE: Settlement breakdown-objektet er en JSONB-payload uten versjons-felt.
  Når breakdown-shape endres (f.eks. ny maskin-type, eller en bilag-receipt
  endrer struktur), kan eldre rader ikke leses ved hjelp av nye validatorer.
  Backwards-compat krever feature-flag eller migration.
SAMSPILL: AgentSettlementStore.read → validateMachineBreakdown → kan kaste
  på legacy-rader hvis nye krav legges til.
REGULATORISK-RISIKO: NEI direkte; men kan blokkere settlement-historikk-tilgang.
FIX:
  ```ts
  export interface MachineBreakdown {
    schemaVersion: 1;  // ← bumped når shape endres
    rows: { ... };
    ...
  }
  ```
  validateMachineBreakdown migrerer schemaVersion=undefined → 1, legacy-rader
  default-formattes. Test-suite oppdateres til å sjekke versjons-feltet.
TEST: `AgentSettlementStore.legacyShape.test.ts` — sjekk at legacy-rad uten
  `schemaVersion` leses som v1 uten å kaste.
```

### P1-3 — `BingoEngine.refundDebitedPlayers` setter ikke compliance-ledger STAKE_REFUND

```
[P1] apps/backend/src/game/BingoEngine.ts:1034 (kompensasjons-grenen ved buy-in-feil)
ISSUE: Når BingoEngine kompenserer en buy-in-feil ved å refundere alle
  debitered players, skrives ingen tilsvarende ledger-event. ComplianceLedger
  har STAKE-entry fra den vellykte halvdelen av buy-ins, men refund-en for
  failed players blir ikke STAKE_REFUND-loggført. §71-rapporten viser kun
  nettokjøp, men audit-trail for "hva skjedde med refund-kompensasjonen"
  finnes kun i payoutAudit + checkpoint, ikke i ComplianceLedger.
SAMSPILL: ComplianceLedger fragmentert — refund-events finnes i wallet-tx
  + payoutAudit, men ikke i samme rapport som STAKE/PRIZE.
REGULATORISK-RISIKO: NEI direkte; aggregert §71-tall blir korrekte fordi
  failed players' STAKE aldri ble skrevet i ledger til å begynne med (compensation
  flyter sammen med IF-grenen). Men sporbarhet på enkelthendelser blir spredt.
FIX: Vurder STAKE_REFUND eller CORRECTION-eventType for refundDebitedPlayers,
  for konsekvens med awardExtraPrize-CORRECTION-pattern.
TEST: Eksisterende refund-test, utvidet med ledger-snapshot.
```

### P1-4 — `WalletAuditVerifier` har ingen schedulet cron-wiring

```
[P1] apps/backend/src/wallet/WalletAuditVerifier.ts (verifyAll-method)
     apps/backend/src/index.ts (no cron wiring funnet)
ISSUE: BIN-764 hash-chain-verifier har test-coverage og admin-endpoint, men
  ikke et faktisk cron-job som kjører nightly. Manipulasjon kan skje uten å
  oppdages før manuell admin-trigger.
SAMSPILL: Ingen alarm-kjede.
REGULATORISK-RISIKO: NEI direkte; men hash-chain er hele audit-evidence-
  pillaren — uten nightly verify er den passiv.
FIX: Wire et nightly setInterval i index.ts med call til
  walletAuditVerifier.verifyAll() + alarm-hook. WalletReservationExpiryService
  er en mal (allerede har nightly-pattern).
TEST: integration-test som verifiserer at verifyAll kjører nightly.
```

### P1-5 — `ComplianceManager.recordLossEntry` swallow-er empty hallId

```
[P1] apps/backend/src/game/ComplianceManager.ts:550-566
ISSUE: recordLossEntry returnerer silently hvis hallId er tomt — ingen warn,
  ingen error. En BUYIN/PAYOUT med blank hallId tapes uten at noen merker
  det. Loss-limit-håndhevelsen avhenger av at vi har komplette loss-entries.
SAMSPILL: assertWalletAllowedForGameplay → resolveGameplayBlock leser fra
  lossEntriesByScope → hvis hallId mangler tapes entry → loss-tap-ackumulator
  underregistrerer.
REGULATORISK-RISIKO: §11/§66 — feil håndhevelse av loss-limits.
FIX:
  ```ts
  if (!normalizedHallId) {
    logger.warn({ walletId: normalizedWalletId, entry }, 
                "[ComplianceManager] recordLossEntry called with empty hallId — skipping");
    return;
  }
  ```
TEST: `ComplianceManager.emptyHallId.test.ts` — assert warn + tom-return.
```

---

## P2 — Nice-to-have (post-pilot)

- **P2-1:** `WalletReservationExpiryService` har TOCTOU-fix for commit, men
  kan også tråklere fra release-path. Verifiser at expire ikke kan vinne race
  mot release.
- **P2-2:** `PotEvaluator.evaluateAccumulatingPots` itererer pots og rethrow
  alltid for non-jackpott. Innsatsen-pot-feil kan ROLLBACK draw — vurder om
  dette er ønsket eller om vi kan degrade-gracefully.
- **P2-3:** `WalletOutboxWorker.tick` har ingen exponential backoff på
  poll-feil — DB-outage gir 1-sek hammer. Vurder backoff på consecutive failures.

---

## Andre observasjoner som er OK eller ute av scope

- **Wallet idempotency-key:** round-scoped (#674) er propagert overalt jeg
  sjekket. IdempotencyKeys-modulen brukes konsekvent.
- **REPEATABLE READ + retry (BIN-762):** Alle write-paths bruker withWalletTx;
  read-paths (getBalance, listAccounts, listTransactions) bypasser
  bevisst per JSDoc.
- **Outbox (BIN-761):** Atomic enqueue inne i ledger-tx. SKIP LOCKED i
  worker-poll. MAX_ATTEMPTS=5 → dead_letter. Solid.
- **Hash-chain (BIN-764):** computeEntryHash bruker stabilt canonical-JSON,
  insert + hash i samme tx, FOR UPDATE-låsen via selectAccountsForUpdate.
  Genesis-fallback for legacy. Solid.
- **Negative-balance prevention:** non-system-accounts har CHECK-constraint
  + executeLedger.runtime-check. System-accounts har winnings=0-CHECK.
- **Admin winnings credit forbidden:** ADMIN_WINNINGS_CREDIT_FORBIDDEN-gate
  er enforced på admin-routes (adminWallet.ts:132, wallet.ts:387). Kun
  game-engine kan legitimere targetSide:winnings. Solid.
- **§66 mandatorisk pause:** Håndheves backend-side via
  `assertWalletAllowedForGameplay` for ad-hoc-rom (BingoEngine.ts:721, 799,
  1698, 1983, 2034, 2068). Manglende kun i Spill 1 scheduled-flyt
  (Game1TicketPurchaseService) — se P0-1.
- **1-års self-exclusion lift-block:** ComplianceManager.clearSelfExclusion
  validerer `nowMs < state.selfExclusionMinimumUntilMs` → kaster
  SELF_EXCLUSION_LOCKED. Solid.
- **commitReservation TOCTOU-fix (PR #513 §1.2):** SELECT FOR UPDATE +
  executeTransferInTx + UPDATE i samme tx. expireStaleReservations blokkeres
  på row-låsen. Solid.

---

## Anbefalt prioritering for Tobias

**Før simulert bingoday-flyt (denne uken):**

1. **P0-1 + P0-2** (selv-exclusion + agent-tx compliance-ledger) — uten disse
   kan en selvutestengt spiller spille via Spill 1 scheduled-flyt eller agent.
   Det er blokker for revisjons-godkjennelse.
2. **P0-7** (PotEvaluator hall-binding) — billig fix (2 linjer),
   regulatorisk-relevant for multi-hall pilot.

**Før produksjons-pilot:**

3. **P0-3 + P0-4 + P0-5 + P0-6** (gameType-resolver utvidet til Spill 2/3 +
   ad-hoc + admin-paths). Kan gjøres i én PR via utvidelse av
   ledgerGameTypeForSlug.
4. **P0-8** (audit-log outbox) — vurder om dagens fire-and-forget er nok for
   pilot, eller om kritiske events skal blokkere på audit-DB-feil.

**Post-pilot:**

5. P1-1 til P1-5 + P2-1 til P2-3.

