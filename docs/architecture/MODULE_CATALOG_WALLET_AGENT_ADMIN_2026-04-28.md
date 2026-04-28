# Module Catalog: Wallet, Agent, Admin (2026-04-28)

**Formål:** Forklart oversikt over hvert produksjonsmodul i `apps/backend/src/wallet/`, `apps/backend/src/adapters/` (wallet-adapterne), `apps/backend/src/admin/` og `apps/backend/src/agent/`. Brukes som kart når du feilsøker en bug, leser PR-en eller skal forstå hvor en regel håndheves. Linje-tall er fra `wc -l` på main per 2026-04-28.

**Format per modul:**
- Path + LOC
- Ansvar (1-2 setninger)
- Public API (de viktigste metodene/eksportene)
- Avhengigheter (inn = importerer fra; ut = importert av andre kjente moduler)
- State-management
- Regulatoriske implikasjoner
- Bug-testing-guide (hvilke symptomer peker på denne modulen)

For Game/Game1/Game2/Game3-domenet: se separat catalog (planlegges som del 1 hvis den ikke finnes).

---

## Master-index

### Wallet (kjerne-økonomi)

| # | Modul | LOC | 1-linje |
|---|---|---:|---|
| 1 | `adapters/PostgresWalletAdapter.ts` | 2307 | Source-of-truth wallet i Postgres med BIN-761 outbox + BIN-762 REPEATABLE READ + BIN-764 hash-chain. |
| 2 | `wallet/WalletOutboxRepo.ts` + `WalletOutboxWorker.ts` | 391 | Outbox-pattern: atomisk `(ledger-tx, outbox-rad)` + `FOR UPDATE SKIP LOCKED`-poll-worker som dispatcher events. |
| 3 | `adapters/PostgresWalletAdapter.ts` (BIN-764-deler) | (delt) | Hash-chain-funksjoner `computeEntryHash` + `canonicalJsonForEntry` for tamper-evident audit-trail. |
| 4 | `jobs/walletReconciliation.ts` | 404 | Nightly cron som sammenligner `wallet_accounts.balance` mot `SUM(wallet_entries)` — alarmer ved divergens. |
| 5 | `wallet/WalletAuditVerifier.ts` | 368 | Verifiserer hash-chain-integritet entry-for-entry; alarm ved tamper. |
| 6 | `adapters/PostgresWalletAdapter.ts` (full klasse) | 2307 | Komplett wallet-adapter — også #1 og #3. |
| 7 | `adapters/InMemoryWalletAdapter.ts` | 605 | Test-adapter med samme interface; brukt i unit-tester og dev-mode uten Postgres. |
| 8 | `wallet/walletTxRetry.ts` | 206 | `withWalletTx`-helper: REPEATABLE READ + retry på SQLState 40001/40P01. |
| 9 | `wallet/WalletReservationExpiryService.ts` | 104 | Tick-service som markerer stale `bet:arm`-reservasjoner som `expired` etter 30 min. |

### Admin (operatør-CRUD + ops)

| # | Modul | LOC | 1-linje |
|---|---|---:|---|
| 10 | `admin/AdminOpsService.ts` | 743 | Super-admin ops-konsoll: aggregat hall-helse + alerts + force-actions hooks. |
| 11 | `platform/PlatformService.ts` (Hall-deler) | (3000+ delt) | Hall-CRUD (`createHall`, `listHalls`, `updateHall`, TV-tokens, terminals) bor på PlatformService — ingen separat HallService. |
| 12 | `admin/HallGroupService.ts` | 756 | Cross-hall-grupper for Game 2/3 — m:n via `app_hall_group_members` + soft-delete. |
| 13 | `admin/ScheduleService.ts` | 799 | Schedule-mal (gjenbrukbar bundle av sub-games). |
| 14 | `admin/DailyScheduleService.ts` | 977 | Daglig kalender-rad som instantierer Schedule på dato/hall. |
| 15 | `admin/SubGameService.ts` | 713 | SubGame-mal (pattern-ids + ticket-farger) brukt av DailySchedule. |
| 16 | `admin/CloseDayService.ts` | 1826 | 4-mode close-day (Single/Consecutive/Random/Recurring) — regulatorisk dagsavslutning. |
| 17 | `admin/GameTypeService.ts` | 793 | Topp-nivå spill-type-katalog (Game 1/2/3/4/5/Databingo). |
| 18 | `admin/GameManagementService.ts` | 640 | Variant-CRUD som kobler GameType + Schedule + ticket-pris + repeat-token. |
| 19 | `admin/SavedGameService.ts` | 633 | Lagrede mal-templates som kan load-to-game eller apply-to-schedule. |
| 20 | `agent/AgentService.ts` | 271 | Domain-regler over Platform + AgentStore: aktiv-shift-blokk, primary-hall-auto. |
| 21 | `compliance/HallAccountReportService.ts` | 565 | Per-hall daglig/månedlig rapport med manuelle adjustments. |

### Agent (skift + cash + tickets + maskiner)

| # | Modul | LOC | 1-linje |
|---|---|---:|---|
| 22 | `agent/AgentShiftService.ts` | 306 | Shift lifecycle (start/end/logout) — DB-unique-index + DomainError-fail-fast. |
| 23 | `agent/AgentTransactionService.ts` | 865 | Cash-in/out, ticket-sale/cancel, register-digital — orkestrerer wallet + shift-cash + tx-log. |
| 24 | `agent/AgentTransactionStore.ts` | 632 | Append-only Postgres-tabell for `app_agent_transactions` med idempotent insert. |
| 25 | `agent/AgentSettlementService.ts` | 785 | Daglig kasse-oppgjør: control + close-day + edit-settlement med diff-thresholds. |
| 26 | `agent/AgentOpenDayService.ts` | 209 | Skift-start: overfør hall-kasse til shift-daily-balance via HallCashLedger. |
| 27 | `agent/HallCashLedger.ts` | 281 | `app_halls.cash_balance/dropsafe_balance` mutasjoner med immutabel audit-trail. |
| 28 | `compliance/PhysicalTicketService.ts` (refereres) | (delt) | Fysisk billett-livssyklus brukt av AgentTransactionService.sellPhysicalTicket. |
| 29 | `agent/UniqueIdService.ts` | 369 | Customer Unique ID (prepaid-kort) lifecycle — create/add/withdraw/reprint/regenerate. |
| 30 | `agent/MetroniaTicketService.ts` | 696 | Metronia-maskin orchestrator: wallet → ekstern API → DB + agent-tx-log + 5min-void. |
| 31 | `agent/OkBingoTicketService.ts` | 662 | OK Bingo-spegling av Metronia + open-day SQL Server RPC + roomId-handling. |
| 32 | `agent/MachineBreakdownTypes.ts` | 281 | 14-rad breakdown-skjema (Metronia/OK/Franco/Otium/NT/Rikstoto/Rekvisita/Servering/Bilag/Bank). |

---

## Wallet-laget

### 1. `apps/backend/src/adapters/PostgresWalletAdapter.ts` (2307 LOC)

**Path + LOC:** `apps/backend/src/adapters/PostgresWalletAdapter.ts` — 2307 linjer.

**Ansvar:** Source-of-truth wallet-implementasjon mot Postgres. Eier `wallet_accounts` (deposit/winnings split), `wallet_transactions` (audit-log), `wallet_entries` (double-entry ledger med BIN-764 hash-chain). Wraps alle skrivespor i `withBreaker` (HIGH-8 circuit-breaker) + `withWalletTx` (BIN-762 REPEATABLE READ + retry) + optional outbox-enqueue (BIN-761).

**Public API:**
- Account-CRUD: `createAccount`, `ensureAccount`, `getAccount`, `listAccounts`.
- Balance reads: `getBalance`, `getDepositBalance`, `getWinningsBalance`, `getBothBalances`, `getAvailableBalance`.
- Money-moves: `debit`, `credit`, `creditWithClient`, `topUp`, `withdraw`, `transfer`.
- Reservations: `reserve`, `increaseReservation`, `releaseReservation`, `commitReservation`, `listActiveReservations`, `listReservationsByRoom`, `expireStaleReservations`.
- Tx-log: `listTransactions`.
- Outbox-wiring: `setOutboxRepo(repo)`, `getPool()`, `getSchema()`.
- Hash-chain helpers (eksportert): `computeEntryHash`, `canonicalJsonForEntry`, `WALLET_HASH_CHAIN_GENESIS`.
- Test-hooks: `getCircuitState()`.

**Avhengigheter:**
- Inn: `pg` (Pool, PoolClient), `node:crypto` (hash-chain), `node:async_hooks` (re-entrancy guard), `WalletAdapter`-interface, `walletTxRetry`, `WalletOutboxRepo`, `CircuitBreaker`, `metrics`, `pgPool`-tuning.
- Ut: brukes av `BingoEngine`, `Game1PayoutService`, `AgentTransactionService`, `MetroniaTicketService`, `OkBingoTicketService`, `walletStateNotifyingAdapter`, `AdminOpsService` (indirekte via reconciliation).

**State-management:** Postgres er sannheten. AsyncLocalStorage holder per-async-chain breaker re-entrancy-flag. `defaultInitialBalance` + `houseAccountId`/`externalCashAccountId` er konstanter.

**Regulatoriske implikasjoner:**
- §71 (Lotteritilsynet audit): `wallet_entries` med hash-chain er tamper-evident — verifiseres nightly av WalletAuditVerifier.
- Wallet-split (deposit vs winnings): kun deposit teller mot Spillvett-tapsgrense. Winnings-first-policy ved debit (`splitDebitFromAccount`).
- Pengeflyt-integritet: REPEATABLE READ + retry forhindrer race-vinduer. Outbox sikrer at "ingen wallet-tx uten matching event".

**Bug-testing-guide:**
- *"Saldo viser feil tall"* → sjekk her FØRST. Reads bypasser breaker, så snubler ikke på cooldown.
- *"WALLET_CIRCUIT_OPEN-feil"* → DB hadde 3 påfølgende write-feil, breaker er åpen i 30s.
- *"Reservasjon henger"* → se WalletReservationExpiryService (#9). 30 min TTL.
- *"Wallet-tx-rad mangler korresponderende event-rad"* → BIN-761 outbox-enqueue feilet eller worker har dead-letter-rad. Sjekk `wallet_outbox` med `WalletOutboxRepo.countByStatus()`.
- *"Hash-mismatch alarm"* → BIN-764 verifier fant tampered entry. Aldri overse — det er tegn på DB-manipulering.
- *"Negative balance på ikke-system-konto"* → WalletAdapter blokkerer dette — hus-konti (`is_system=true`) kan gå negativt, vanlige spillere kan ikke.

---

### 2. `apps/backend/src/wallet/WalletOutboxRepo.ts` + `WalletOutboxWorker.ts` (221 + 170 LOC)

**Path + LOC:** `WalletOutboxRepo.ts` 221 linjer, `WalletOutboxWorker.ts` 170 linjer.

**Ansvar:** Industri-standard outbox-pattern (Pragmatic Play / Evolution). `enqueue()` MÅ kjøre i samme PoolClient-transaksjon som ledger-INSERT — det garanterer at `(wallet_entry, outbox_event)` er atomisk. Worker poller med `FOR UPDATE SKIP LOCKED` så multi-worker ikke dobbelt-prosesserer. Etter 5 attempts → `dead_letter`.

**Public API:**
- Repo: `enqueue(client, entry)`, `claimNextBatch(limit)`, `markProcessed(ids)`, `markFailed(id, error, attempts)`, `countByStatus()`.
- Worker: `start()`, `stop()`, `tick()`, `setDispatcher(dispatcher)`. Pluggable `WalletOutboxDispatcher` (default stub logger; BIN-760 wirer socket-pusher som broadcaster `wallet:state` på `wallet:<accountId>`-room).

**Avhengigheter:**
- Inn: `pg` Pool/PoolClient.
- Ut: importeres av `index.ts` (boot-wiring), `PostgresWalletAdapter` (constructor og `setOutboxRepo`).

**State-management:** Postgres-tabell `wallet_outbox` med statuser `pending` / `processed` / `dead_letter`. Worker holder `running`-flagg + interval-timer.

**Regulatoriske implikasjoner:**
- Hver wallet-mutasjon emitter et event slik at sosket-clients/audit-systemer ikke mister data ved nettverksfeil. Atomisk garanti er kritisk for finansiell konsistens.
- Dead-letter-rader krever ops-replay (manuell intervensjon).

**Bug-testing-guide:**
- *"Klient ser ikke saldo-update"* → sjekk `wallet_outbox`-statuser. Hvis pending stables seg opp, dispatcher feiler eller worker er stoppet.
- *"Dead_letter-rader bygger seg opp"* → ops-replay kreves; sjekk `last_error`.
- *"Race-condition mellom ledger og event"* → ikke mulig hvis kallsted bruker `enqueue(client, ...)` med samme client som ledger-INSERT. Hvis du ser dette: `enqueue` ble kalt med Pool, ikke en åpen tx-client.

---

### 3. `adapters/PostgresWalletAdapter.ts` — Hash-chain-deler (BIN-764)

**Path:** `apps/backend/src/adapters/PostgresWalletAdapter.ts:166-218` — eksporterte funksjoner.

**Ansvar:** Tamper-evident audit-trail. Hver `wallet_entries`-rad har `entry_hash = SHA256(previous_entry_hash + canonical_json(entry_data))`. Per-konto-kjede; genesis = 64 hex-zeros. Lotteritilsynet-revisor kan walke kjeden og oppdage post-hoc-manipulering.

**Public API:**
- `WALLET_HASH_CHAIN_GENESIS` (konstant).
- `canonicalJsonForEntry(input: WalletEntryHashInput): string` — sortert JSON for stabile hashes.
- `computeEntryHash(previousHash, input): string` — SHA-256 over `previousHash + canonical_json`.
- Type: `WalletEntryHashInput`.

**Avhengigheter:**
- Inn: `node:crypto`.
- Ut: `WalletAuditVerifier`, og indirekte alle wallet-write-paths som beregner `entry_hash` ved INSERT.

**State-management:** Stateless funksjoner; deterministisk per input.

**Regulatoriske implikasjoner:**
- Microgaming-pattern siden 2014. Industri-standard.
- Genesis-zero + per-konto-kjede betyr at hver konto har egen audit-tråd. Mismatch indikerer enten DB-skade eller tampering.

**Bug-testing-guide:**
- *"WALLET_AUDIT_TAMPER_DETECTED-alarm"* → kjør `WalletAuditVerifier.verifyAccount(accountId)` for å se hvilken rad som er korrupt.
- *"Backfill-migrasjon ga andre hashes på second run"* → canonicalJson-feltset eller sortering ble endret. Endring krever re-hash-migration.

---

### 4. `apps/backend/src/jobs/walletReconciliation.ts` (404 LOC)

**Path + LOC:** `apps/backend/src/jobs/walletReconciliation.ts` — 404 linjer (BIN-763).

**Ansvar:** Nightly cron (default 03:00 lokal) som sammenligner `wallet_accounts.{deposit_balance, winnings_balance}` mot `SUM(wallet_entries)` per konto+side. Avvik > 0.01 NOK alarmerer (skriver `wallet_reconciliation_alerts`-rad + emit prometheus + ERROR-log). Skriver ALDRI tilbake til wallet_accounts ved divergens — ADMIN må undersøke og lukke alerts manuelt.

**Public API:**
- `class WalletReconciliationService { reconcileAll(): ReconciliationResult; listOpenAlerts(limit); resolveAlert(id, ...) }`.

**Avhengigheter:**
- Inn: `pg` Pool, `JobScheduler`, logger, metrics.
- Ut: kalles av cron-tick i `index.ts`; `AdminOpsService` aggregerer alerts for ops-overview.

**State-management:** "Run-once-per-day"-guard via `lastRunDateKey`. Open-alert UNIQUE per `(account_id, account_side)` — `ON CONFLICT DO NOTHING`.

**Regulatoriske implikasjoner:**
- Detekterer "lekkasje" mellom balance-felter og ledger. Kombinert med BIN-764 hash-chain dekker dette begge angrepsvinklene: balance-tampering OG entry-tampering.
- Avvik må undersøkes av ADMIN — ingen auto-correction (regulatorisk forbud mot å skrive om historikk).

**Bug-testing-guide:**
- *"Pengene matcher ikke saldoen"* → kjør reconciliation manuelt via `POST /api/admin/wallet/reconciliation/run-now`. Sjekk om alert opprettes.
- *"Reconciliation alarm"* → `app_audit_log` har detaljer. ADMIN må kjøre forensics på det som har skjedd siden forrige run-OK.

---

### 5. `apps/backend/src/wallet/WalletAuditVerifier.ts` (368 LOC)

**Path + LOC:** `apps/backend/src/wallet/WalletAuditVerifier.ts` — 368 linjer (BIN-764).

**Ansvar:** Verifiserer hash-chain-integritet entry-for-entry. Per konto walker entries i id-rekkefølge og re-beregner hashen. Ved mismatch → alarm via console.error + `app_audit_log` + Prometheus.

**Public API:**
- `verifyAccount(accountId): WalletAuditVerifyResult` — én konto.
- `verifyAll(): WalletAuditVerifyAllResult` — alle kontoer (concurrency-cap 4).
- Eksportert helper: `recomputeEntryHashForRow(row)` for tester.

**Avhengigheter:**
- Inn: `pg` Pool, `PostgresWalletAdapter` (hash-funksjoner), logger.
- Ut: brukt av nightly cron + `GET /api/admin/wallet/audit-verify/:accountId`.

**State-management:** Cursor-paginert per konto (default batch 1000). Stream entries for å unngå memory-spike.

**Regulatoriske implikasjoner:**
- Casino-grade tamper-detection. 10k entries verifiseres på <2 sek.
- Legacy-rader med `entry_hash IS NULL` rapporteres som `legacyUnhashed`, ikke alarm.

**Bug-testing-guide:**
- *"Hvordan vet jeg om DB er tuklet med?"* → kjør `verifyAll()` via admin-endpoint. Mismatch peker på akkurat hvilken rad/konto som er korrupt.
- *"Performance-issue under nightly window"* → reduser concurrency (default 4) eller batchSize (default 1000).
- *"Reason: missing_hash"* → backfill-jobb kjørte ikke ferdig før endre-rader ble lagt til.

---

### 6. (samme som #1 — full PostgresWalletAdapter-klasse)

Behandlet i sin helhet under #1.

---

### 7. `apps/backend/src/adapters/InMemoryWalletAdapter.ts` (605 LOC)

**Path + LOC:** `apps/backend/src/adapters/InMemoryWalletAdapter.ts` — 605 linjer.

**Ansvar:** Test-twin med samme `WalletAdapter`-interface som Postgres-versjonen. Brukt i unit-tester (raskt, ingen DB-oppsett) og dev-mode `WALLET_PROVIDER=memory`. Implementerer hele kontrakten: split-balanser, reservasjoner, transfers, currency.

**Public API:** Identisk med PostgresWalletAdapter (samme `WalletAdapter`-interface). Mangler bare `getPool/getSchema/setOutboxRepo` (in-memory har ikke pool).

**Avhengigheter:**
- Inn: `node:crypto`, `WalletAdapter`-interface.
- Ut: brukt i tester via `createWalletAdapter`-factory når `WALLET_PROVIDER=memory`.

**State-management:** `Map<string, InternalAccount>` + `Map<string, WalletReservation>`. Ingen tx-grenser, men `isSystemAccountId`-prefix-detection speiler Postgres-logikk.

**Regulatoriske implikasjoner:** Skal **aldri** brukes i produksjon. Faller hvis prosessen restarter.

**Bug-testing-guide:**
- *"Test passerer in-memory men feiler mot Postgres"* → typisk race-condition eller transaksjons-grensemis. Postgres er sannheten.
- *"Negative balance på spiller-konto i test"* → sjekk `isSystemAccountId`-prefix.

---

### 8. `apps/backend/src/wallet/walletTxRetry.ts` (206 LOC)

**Path + LOC:** `apps/backend/src/wallet/walletTxRetry.ts` — 206 linjer (BIN-762).

**Ansvar:** `withWalletTx(pool, fn, options?)`-helper som kjører `fn(client)` under REPEATABLE READ (default) eller SERIALIZABLE isolation, retrier på SQLState 40001/40P01 med exponential backoff (50/150/450ms + jitter), og kaster `WALLET_SERIALIZATION_FAILURE` etter 3 retries.

**Public API:**
- `withWalletTx<T>(pool, fn, options?): Promise<T>`.
- Type: `WalletTxIsolation`, `WithWalletTxOptions`.

**Avhengigheter:**
- Inn: `pg`, `node:crypto` (correlation-id), logger.
- Ut: brukt av PostgresWalletAdapter ledger-write-paths.

**State-management:** Stateless funksjon; per-call correlation-id i log-context.

**Regulatoriske implikasjoner:**
- Phantom-read-protection er kritisk for double-entry-ledger. Uten REPEATABLE READ kan to concurrent kjøp evaluere balance før hverandre og overlapp negative.

**Bug-testing-guide:**
- *"WALLET_SERIALIZATION_FAILURE i logs"* → stor concurrency på samme konto/rom. Vurder å kjøre rom-eksklusivt eller øke retries.
- *"Deadlock-error"* → SQLState 40P01 — to tx tar samme rader i ulik rekkefølge. Hvis dette gjentar seg, sjekk lock-rekkefølge i wallet-write-path.

---

### 9. `apps/backend/src/wallet/WalletReservationExpiryService.ts` (104 LOC)

**Path + LOC:** `apps/backend/src/wallet/WalletReservationExpiryService.ts` — 104 linjer (BIN-693).

**Ansvar:** Tick-service (default 5 min) som markerer stale `bet:arm`-reservasjoner som `expired`. Brukes for crash-recovery: hvis backend krasjer etter `bet:arm` men før `startGame`, frigis reservasjonen automatisk etter 30 min TTL. Boot-sweep etter 30s for å håndtere restart-scenario.

**Public API:**
- `start()`, `stop()`, `tick()` (eksponert for tester).

**Avhengigheter:**
- Inn: `WalletAdapter` (kaller `expireStaleReservations(nowMs)`).
- Ut: instansieres i `index.ts`; `onReservationExpired`-callback brukes for socket-broadcast.

**State-management:** Timer + `running`-flagg (throttling).

**Regulatoriske implikasjoner:**
- Spiller-saldo skal ikke være "låst" indefinitt. 30 min TTL er en hensiktsmessig avveining for game-flow vs crash-recovery.

**Bug-testing-guide:**
- *"Saldo henger på 'reserved' men spillet aldri startet"* → vent maks 30 min, eller kall `expireStaleReservations(Date.now())` direkte.
- *"Reservasjoner aldri reset etter restart"* → boot-sweep skjer etter 30s; sjekk om servicen ble `start()`'et i index.ts.

---

## Wallet-adapters (samlet)

### Fellesgrensesnitt

`adapters/WalletAdapter.ts` definerer `WalletAdapter`-interface, `WalletError`, `WalletTransactionType`, `WalletAccountSide` (deposit/winnings), `WalletTransactionSplit`. Alle implementasjoner implementerer kontrakten 1:1.

### Implementasjons-tabell

| Adapter | Når brukt | Persistens | Notat |
|---|---|---|---|
| `PostgresWalletAdapter` | Produksjon (`WALLET_PROVIDER=postgres`) | `wallet_accounts/transactions/entries/outbox` | Eneste regulatorisk akseptable adapter. |
| `InMemoryWalletAdapter` | Unit-tester, dev hot-reload | `Map<>` | Tapes ved restart. |
| `FileWalletAdapter` | Legacy / smoke-tests | JSON-fil | Deprecated; brukes ikke av nye paths. |
| `HttpWalletAdapter` | Cross-service (Candy) | HTTP-bridge til ekstern wallet | Eksempel-pattern, ikke aktiv i prod. |
| `walletStateNotifyingAdapter` | Decorator | Wraps en annen adapter | Emitter `wallet:state`-events ved skrivespor. |

---

## Admin-laget

### 10. `apps/backend/src/admin/AdminOpsService.ts` (743 LOC)

**Ansvar:** Backend for ADMIN Super-User Ops-konsoll (`/admin/ops`). Aggregerer state fra eksisterende services (HallService via PlatformService, BingoEngine for rom-summary, HallGroupService, WalletReconciliationService, PaymentRequestService) og legger `app_ops_alerts`-tabell på toppen for ops-spesifikke alerts (hall offline, stuck rooms, pre-flight-feil, settlement-diff).

**Public API:**
- `aggregateOverview()` — full ops-snapshot per hall + groups + alerts + reconciliation.
- `listActiveAlerts(filter)` — paginert.
- `createAlert(input)` — manuell alert.
- `acknowledgeAlert(id, actor)`.
- Pure-compute: `computeHallHealth(input): HallHealthColor` (testbar uten DB).

**Avhengigheter:**
- Inn: `BingoEngine`, `PlatformService`, `HallGroupService`, `WalletReconciliationService`, `PaymentRequestService`, `pg` Pool, logger.
- Ut: brukt av `routes/adminOps.ts`.

**State-management:** Aggregat-only — ingen mutasjon av source-state. Force-actions ruter gjennom eksisterende services i route-laget.

**Regulatoriske implikasjoner:**
- ADMIN må kunne oppdage og diagnostisere drift-problemer i sanntid (Lotteritilsynet-krav til operatør-ansvarlighet).

**Bug-testing-guide:**
- *"Ops-konsoll viser feil hall-helse"* → sjekk `computeHallHealth`-input. Pure compute, lett å reprodusere.
- *"Stuck room ikke alarmert"* → terskelen er > 60s uten draw. Sjekk `roomLastDrawAt` og `nowMs`.

---

### 11. Hall-CRUD på `PlatformService.ts`

**Path:** `apps/backend/src/platform/PlatformService.ts` — Hall-relaterte metoder fra ~linje 1247.

**Ansvar:** Hall-CRUD bor på PlatformService, ikke en separat HallService-klasse. PlatformService eier hele "platformen" (haller, terminaler, brukere, hall-display-tokens, hall-game-config, schedule-slots) fordi haller er kjerne-concept som krysser auth/wallet/spill-domenet.

**Public API (Hall-relaterte):**
- `listHalls({includeInactive?})`, `getHall(ref)`, `requireActiveHall(ref)`.
- `createHall(input: CreateHallInput)`, `updateHall(ref, update)`.
- `verifyHallTvToken(ref, tvToken)`, `getTvVoice(ref)`, `setTvVoice(ref, voice)`.
- `listHallDisplayTokens(ref)`, `createHallDisplayToken(...)`, `revokeHallDisplayToken(id, ref?)`, `verifyHallDisplayToken(composite)`.
- `listTerminals({hallId?})`, `createTerminal(input)`, `getTerminal(id)`, `updateTerminal(id, update)`.
- `listHallGameConfigs({hallId?, gameSlug?})`, `upsertHallGameConfig(input)`.
- Hall-membership: `isPlayerActiveInHall`, `searchPlayersInHall`, `listPlayerHallStatus`, `setPlayerHallStatus`, `updateUserHallAssignment`.

**Avhengigheter:** Brukt av nesten alle moduler — admin-CRUD, wallet (compliance binding), spill-engines (hall-context), agent-services (skift-membership).

**State-management:** Postgres-tabeller `app_halls`, `app_terminals`, `app_hall_game_configs`, `app_user_hall_status`.

**Regulatoriske implikasjoner:**
- Hall er regulatorisk grunnenhet for §11 distribusjons-prosent og §71 audit. Spillere må bindes til hall for compliance-rapportering.
- TV-token + hall-display-token — hall-display har egen auth-mekanisme (`/tv/:hallId/:hallToken`).

**Bug-testing-guide:**
- *"Spill kobler til feil hall"* → sjekk `actor_hall_id`-binding (PR #443) og `setPlayerHallStatus`.
- *"TV-display 401"* → token er revoked eller utløpt. Sjekk `verifyHallTvToken` / `verifyHallDisplayToken`.
- *"Hall.cash_balance ikke oppdatert"* → ikke direkte her — sjekk HallCashLedger (#27).

---

### 12. `apps/backend/src/admin/HallGroupService.ts` (756 LOC)

**Ansvar:** Admin-CRUD for hall-grupper (cross-hall spill, BIN-665). Game 2 + Game 3 bruker GroupHall for sammenkoblede draws mot flere fysiske haller. Normalisert til `app_hall_groups` + `app_hall_group_members` (FK til `app_halls`).

**Public API:**
- `list(filter)`, `get(id)`, `count(filter)`.
- `create(input: CreateHallGroupInput)`, `update(id, update: UpdateHallGroupInput)`.
- `remove(id, options: { hard?: boolean })`.

**Avhengigheter:**
- Inn: `pg` Pool/PoolClient, `DomainError`, logger.
- Ut: brukt av `AdminOpsService`, `DailyScheduleService` (groupHallIds-referanse), Game 2/3-engines.

**State-management:** Postgres + soft-delete via `deleted_at`. Member-changes atomisk via PoolClient transaksjon.

**Regulatoriske implikasjoner:**
- Hard-delete blokkeres hvis gruppen er referert fra `app_daily_schedules.groupHallIds` — historisk integritet.

**Bug-testing-guide:**
- *"GroupHall mangler haller"* → sjekk `app_hall_group_members` direkte; soft-deleted halls vises kanskje ikke.
- *"Game 2 cross-hall draw mismatch"* → group medlemskap ble endret midt i schedule.

---

### 13. `apps/backend/src/admin/ScheduleService.ts` (799 LOC)

**Ansvar:** BIN-625. Admin-CRUD for Schedule-maler (gjenbrukbar spill-mal / sub-game-bundle). Tabellen `app_schedules` lagrer én rad per mal; subgame-bundle ligger i `sub_games_json` inntil BIN-621 normaliserer det videre. En Schedule er TEMPLATE — DailySchedule (#14) er kalender-raden som instantierer malen.

**Public API:**
- `list(filter: ListScheduleFilter)`, `get(id)`.
- `create(input: CreateScheduleInput)`, `update(id, update)`.
- `remove(id, { hard? })`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`, `@spillorama/shared-types` (mystery + row-prizes-by-color validators).
- Ut: brukt av `DailyScheduleService` (schedule-id-referanse).

**State-management:** Postgres + soft-delete; sub-games i JSON.

**Regulatoriske implikasjoner:**
- Schedule definerer regulatorisk-relevante parameterne (ticket-priser, sub-game-typer, mystery-config, row-prizes-per-farge). 8-farge-validering håndheves her.

**Bug-testing-guide:**
- *"Mystery-config feil"* → `validateMysteryConfig` fra shared-types. Sjekk JSON-strukturen.
- *"8-farge ticket-priser feil"* → `validateRowPrizesByColor`.

---

### 14. `apps/backend/src/admin/DailyScheduleService.ts` (977 LOC)

**Ansvar:** BIN-626. Admin-CRUD for daglige plan-rader som kobler GameManagement til hall + tidspunkt + sub-game-komposisjon. Tabellen `app_daily_schedules`; sub-game-slots i `subgames_json`.

**Public API:**
- `list(filter)`, `get(id)`.
- `create(input)`, `update(id, update)`, `remove(id, {hard})`.
- `createSpecial(input)` — special-schedule path.

**Avhengigheter:**
- Inn: `pg`, `zod`, `DomainError`.
- Ut: brukt av Game 1-7 schedulers, multi-hall-rom-engines.

**State-management:** Postgres + status-state-machine (`active`/`running`/`finish`/`inactive`). Soft-delete.

**Regulatoriske implikasjoner:**
- Det er den regulatorisk-relevante "kjøreplan"-raden. Status-transisjon `active` → `running` → `finish` skal være atomic for audit-konsistens.

**Bug-testing-guide:**
- *"Spill blir ikke startet på planlagt tid"* → sjekk DailySchedule-status + game1ScheduleTick.
- *"Hall blir ikke med i daily schedule"* → sjekk hallIds + groupHallIds-arrays.

---

### 15. `apps/backend/src/admin/SubGameService.ts` (713 LOC)

**Ansvar:** BIN-621. Admin-CRUD for SubGame-maler — navngitte bundles av pattern-ids + ticket-farger. DailySchedule binder inn SubGame-ids via `subgames_json`.

**Public API:**
- `list(filter)`, `get(id)`, `count(filter)`.
- `create(input)`, `update(id, update)`, `remove(id, {hard?})`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`.
- Ut: brukt av Schedule + DailySchedule + Pattern admin.

**State-management:** Postgres + soft-delete; hard-delete blokkeres hvis referert fra `app_daily_schedules.subgames_json`.

**Regulatoriske implikasjoner:**
- Pattern-til-pris-mapping kommer fra SubGame. Endringer påvirker payout-beregning.

**Bug-testing-guide:**
- *"Pattern win betalt feil"* → sjekk SubGame patternRefs vs PatternService.

---

### 16. `apps/backend/src/admin/CloseDayService.ts` (1826 LOC)

**Ansvar:** BIN-623 + BIN-700 + REQ-116. Regulatorisk dagsavslutning per GameManagement med 4-mode-støtte (Single / Consecutive / Random / Recurring). Aggregerer summary-snapshot, lukker dager idempotent (DB-unique på `(game_management_id, close_date)`), expanderer recurring patterns.

**Public API:**
- `summary(gameId, closeDate)` — KPI-snapshot.
- `close({...})` — single dag.
- `closeMany({mode: consecutive|random, ...})`.
- `closeRecurring(input: CloseRecurringInput)` — REQ-116 ukedag/månedsdag/årsdag.
- `listRecurringPatterns(gameId)`, `deleteRecurringPattern({...})`.
- `updateDate(input)`, `deleteDate(input)`.
- `listForGame(gameId)`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`, GameManagement, ScheduleService (kalender).
- Ut: brukt av admin-routes; CloseDayService styrer "spillet stengt"-status mot frontend + scheduler.

**State-management:** Postgres `app_close_day_log` + `app_close_day_recurring_patterns` (parent-child via `recurring_pattern_id`-FK).

**Regulatoriske implikasjoner:**
- "Dagen er lukket" = ingen flere innsatser/utbetalinger på dato. Brukes til å oppfylle kalender-baserte unntak (helligdager, vedlikehold).
- Idempotent close — kan ikke lukke samme dato to ganger (unique-index).

**Bug-testing-guide:**
- *"Spilleren kan kjøpe etter close"* → sjekk om kjøp-cutoff ser på `close_day_log` for current date.
- *"Recurring pattern lukker for mye/lite"* → sjekk expansion av (frequency, weekday, month, day_of_month) til child-rader.

---

### 17. `apps/backend/src/admin/GameTypeService.ts` (793 LOC)

**Ansvar:** BIN-620. Topp-nivå spill-type-katalog. GameType = stabil, navngitt variant av et spill ("Game 1", "Game 3", "Databingo 60") som backend-engine + admin-UI + dashboard dropper ned.

**Public API:**
- `list(filter)`, `get(id)`, `getBySlug(slug)`, `count(filter)`.
- `create(input)`, `update(id, update)`, `remove(id, {hard?})`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`.
- Ut: refererert fra `app_game_management.game_type_id`, `app_patterns.game_type_id`, `app_sub_games.game_type_id`.

**State-management:** Postgres + soft-delete; hard-delete blokkeres ved aktiv referanse.

**Regulatoriske implikasjoner:**
- Mapper Spillorama-spillkatalogen (Spill 1-3 hovedspill, SpinnGo databingo, Candy ekstern). 15% vs 30% organisasjons-prosent avhenger av GameType.

**Bug-testing-guide:**
- *"Game 1 dukker ikke opp i admin-dropdown"* → status `inactive` eller soft-deleted.

---

### 18. `apps/backend/src/admin/GameManagementService.ts` (640 LOC)

**Ansvar:** BIN-622. Admin-CRUD for spill-varianter operatører kan starte. Tabellen `app_game_management`; felter uten egen kolonne (prize tiers, hall-group visibility, sub-game composition, ticket colors, pattern-valg) i `config_json`. Repeat-flyt idempotent på `repeatToken`.

**Public API:**
- `list(filter)`, `get(id)`.
- `create(input)`, `update(id, update)`, `remove(id, {hard?})`.
- `repeat(input)` — idempotent på `repeatToken`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`.
- Ut: brukt av admin-pages, scheduler, close-day.

**State-management:** Postgres + soft-delete + status-state-machine (`active`/`running`/`closed`/`inactive`).

**Regulatoriske implikasjoner:**
- Game Management er det som faktisk "publiseres" til spillere. Alle endringer logges (audit i route-laget).

**Bug-testing-guide:**
- *"Spillet er tilgjengelig som det ikke skulle vært"* → status, hard-delete, soft-delete.
- *"Repeat opprettet duplikat"* → repeatToken må være stabilt fra caller.

---

### 19. `apps/backend/src/admin/SavedGameService.ts` (633 LOC)

**Ansvar:** BIN-624. CRUD for SavedGame-templates (gjenbrukbare GameManagement-oppsett). En SavedGame er IKKE et kjørbart spill — det er en mal admin lagrer for senere "load-to-game"-bruk. `loadToGame()` returnerer config-snapshot caller kan sende til GameManagementService.create().

**Public API:**
- `list(filter)`, `get(id)`, `count(filter)`.
- `create(input)`, `update(id, update)`, `remove(id, {hard?})`.
- `loadToGame(id)` → `SavedGameLoadPayload`.
- `applyToSchedule(id)` → `SavedGameApplyPayload`.
- `saveFromSchedule(input: SaveFromScheduleInput)`.

**Avhengigheter:**
- Inn: `pg`, `DomainError`.
- Ut: route-laget koordinerer `loadToGame() → GameManagementService.create()` for å unngå sirkulær avhengighet.

**State-management:** Postgres + soft-delete.

**Regulatoriske implikasjoner:**
- Audit-skriving ligger i route-laget (samme mønster som CloseDay) — IP/UA tilgjengelig der.

**Bug-testing-guide:**
- *"loadToGame returnerer feil config"* → SavedGame.config er fri-form Record; sjekk hva som ble lagret.

---

### 20. `apps/backend/src/agent/AgentService.ts` (271 LOC)

**Ansvar:** BIN-583 B3.1. Domain-regler over PlatformService + AgentStore: "kan ikke slette agent med aktiv shift", "første hall-tildeling blir primary auto", språk-validering. Audit-logging er route-lagets ansvar (har actor-context).

**Public API:**
- `getById(userId)`, `list(filter)`.
- `createAgent(input)`, `updateAgent(userId, update, actorRole?)`.
- `softDeleteAgent(userId)`.
- `isActive(userId)`, `requireActiveAgent(userId)`.
- `assertHallMembership(userId, hallId)` → `AgentHallAssignment`.

**Avhengigheter:**
- Inn: `PlatformService` (auth/wallet), `AgentStore` (DB), `DomainError`.
- Ut: brukt av AgentShiftService, AgentTransactionService, AgentSettlementService, alle agent-routes.

**State-management:** Stateless service; AgentStore eier persistens.

**Regulatoriske implikasjoner:**
- "Kan ikke slette aktiv-shift-agent" — bevarer audit-trail.
- Hall-membership-check er gating på alle cash-ops.

**Bug-testing-guide:**
- *"AGENT_NOT_FOUND"* → soft-deleted eller feil userId.
- *"AGENT_HAS_ACTIVE_SHIFT ved sletting"* → end shift først.
- *"HALL_NOT_ASSIGNED"* → mangler rad i `app_agent_halls`.

---

### 21. `apps/backend/src/compliance/HallAccountReportService.ts` (565 LOC)

**Ansvar:** BIN-583 B3.8. Per-hall daglig/månedlig revenue + account-balance-rapport. Port av legacy `hallController.{gethallAccountReportData, hallAccountReportsView}`. Hall-scoped, dag-for-dag per gametype, inkludert manuelle adjustments fra `app_hall_manual_adjustments`.

**Public API:**
- `getDailyReport({hallId, date, ...})`.
- `getMonthlyReport({hallId, month, ...})`.
- `getAccountBalance({hallId, asOf})`.
- `addManualAdjustment(input)`, `listManualAdjustments({hallId, ...})`.
- `listPhysicalCashoutsForShift({shiftId, ...})`, `getPhysicalCashoutSummaryForShift(shiftId)`.

**Avhengigheter:**
- Inn: `pg` Pool, `BingoEngine` (compliance-ledger), `DomainError`.
- Ut: brukt av admin-pages og audit-eksport.

**State-management:** Postgres reads + manual_adjustments-tabell.

**Regulatoriske implikasjoner:**
- Aggregerer flere kilder: `app_agent_transactions`, `app_hall_cash_transactions`, compliance-ledger (omsetning), physical-ticket-cashouts, manual-adjustments. Gir hall-totalt for §71-rapportering.

**Bug-testing-guide:**
- *"Daglig rapport viser feil sum"* → sjekk hver kilde separat: agent-tx, hall-cash, ledger, cashouts.
- *"Manual adjustment ikke synlig"* → category-filter eller business_date-mismatch.

---

## Agent-laget

### 22. `apps/backend/src/agent/AgentShiftService.ts` (306 LOC)

**Ansvar:** BIN-583 B3.1. Shift lifecycle (start/end/logout). Defense-in-depth: DB partial-unique-index `uniq_app_agent_shifts_active_per_user` er authoritative; service fail-fast med DomainError før DB-rejection.

**Public API:**
- `startShift(input: StartShiftInput): AgentShift`.
- `endShift(input: EndShiftInput): AgentShift` — med ADMIN-force-close + audit-reason.
- `logout(input)` — Shift Log Out-popup med flags (distribute winnings, transfer register-ticket).
- `listPendingCashouts(agentUserId)`.
- `getCurrentShift(userId)`, `getShift(shiftId)`.
- `getHistory(userId, opts)`, `listActiveInHall(hallId)`.

**Avhengigheter:**
- Inn: `AgentStore`, `AgentService` (active-check), `DomainError`.
- Ut: brukt av AgentTransactionService, AgentSettlementService, AgentOpenDayService, alle ticket-orkestratorer.

**State-management:** Postgres `app_agent_shifts`; max én aktiv shift per agent.

**Regulatoriske implikasjoner:**
- Shift = enheten for cash-reconciliation. Alt i et skift må være lukket før neste agent kan åpne et nytt.
- Wallet idempotency-keys: `agent-shift:{shiftId}:start|end|cash-in:{txId}|cash-out:{txId}`.

**Bug-testing-guide:**
- *"SHIFT_ALREADY_ACTIVE"* → DB-unique kicker. Vent på endShift eller bruk admin-force.
- *"NO_ACTIVE_SHIFT for cash-op"* → start shift først.
- *"Shift mangler settlement"* → sjekk `app_agent_settlements` for shiftId.

---

### 23. `apps/backend/src/agent/AgentTransactionService.ts` (865 LOC)

**Ansvar:** BIN-583 B3.2. Cash-in/out, ticket-sale/cancel, register-digital. Orkestrerer wallet ↔ shift-cash ↔ tx-log. Cancel = counter-transaction (ny rad med `related_tx_id`); rører IKKE `app_physical_tickets.status`. Game1PurchaseCutoffPort gating.

**Public API:**
- `lookupPlayers(agentUserId, query)`, `getPlayerBalance(agentUserId, playerUserId)`.
- `cashIn(input: CashOpInput)`, `cashOut(input)`.
- `addMoneyToUser(input: AddMoneyToUserInput)`, `withdrawFromUser(input: WithdrawFromUserInput)`.
- `searchUsers(agentUserId, query)`.
- `sellPhysicalTicket(input)`, `cancelPhysicalSale(input)`, `registerDigitalTicket(input)`.
- `listTransactionsForCurrentShift(agentUserId, opts)`, `listTransactions(filter)`, `getTransaction(id)`.
- `listPhysicalInventory(agentUserId, opts)`.

**Avhengigheter:**
- Inn: `WalletAdapter`, `PlatformService`, `PhysicalTicketService`, `AgentService`, `AgentShiftService`, `AgentStore`, `AgentTransactionStore`, `TicketPurchasePort`, `PhysicalTicketReadPort`, `Game1PurchaseCutoffPort`.
- Ut: brukt av agent-routes for cash-in-out-page.

**State-management:** Wallet (idempotent på `clientRequestId`), shift-cash-delta, `app_agent_transactions` (append-only).

**Regulatoriske implikasjoner:**
- Hver cash-mutasjon logges i to lag: wallet (deposit/winnings) + agent-tx-tabell (operatør-aktivitet for §71). Cancel er counter-transaction, ikke delete — bevarer audit-trail.
- Idempotent på `(agent_user_id, player_user_id, client_request_id)` partial unique.

**Bug-testing-guide:**
- *"Cash-out tar ikke fra spiller-saldo"* → wallet-debit feilet → sjekk shift-cash-delta blokk.
- *"Duplicate transaction etter retry"* → `clientRequestId` mangler eller endret. Idempotency-index lar gjentatt request returnere samme rad.
- *"PURCHASE_CLOSED_FOR_HALL"* → Game1HallReadyService har låst kjøp for hall.
- *"INSUFFICIENT_DAILY_BALANCE"* → cash-out over shift's daily-balance. Cash-in først.

---

### 24. `apps/backend/src/agent/AgentTransactionStore.ts` (632 LOC)

**Ansvar:** BIN-583 B3.2. Postgres-laget for `app_agent_transactions` — append-only, ingen update/delete API. Idempotent insert via partial unique-index. Speiler `wallet_transactions`-semantikk.

**Public API:**
- `insert(input, client?)`, `insertIdempotent(input, client?)`.
- `findByClientRequestId(...)`.
- `getById(id)`, `list(filter)`.
- `findSaleByTicketUniqueId(ticketUniqueId)`, `findCancelForTx(relatedTxId)`.
- `aggregateByShift(shiftId): ShiftAggregate`.
- (Postgres + InMemory variants — samme interface).

**Avhengigheter:**
- Inn: `pg` Pool/PoolClient.
- Ut: brukt av AgentTransactionService, AgentSettlementService, MetroniaTicketService, OkBingoTicketService, HallAccountReportService.

**State-management:** Append-only Postgres-tabell; InMemory-twin for tester.

**Regulatoriske implikasjoner:**
- Append-only er regulatorisk standard. Korreksjoner skjer kun via counter-transactions med `related_tx_id`-peker.

**Bug-testing-guide:**
- *"Duplikat transaksjons-rad"* → sjekk client_request_id; idempotency-index burde ha blokkert.
- *"aggregateByShift returnerer feil totals"* → kjente kolonner: total_cash_in/out, total_card_in/out, ticket_sale_total, etc.

---

### 25. `apps/backend/src/agent/AgentSettlementService.ts` (785 LOC)

**Ansvar:** BIN-583 B3.3. Daglig kasse-oppgjør orkestrator. Tre regler: (1) `controlDailyBalance` — pre-close sanity-check, ingen wallet-mutasjon, kan kalles flere ganger. (2) `closeDay` — atomisk: aggregér totals, computer diff, sjekk thresholds (note/force), sett `shift.settled_at`, opprett settlement-rad, transfer dailyBalance til hall.cash via HallCashLedger. (3) `editSettlement` — admin-only, lagrer edited_by/at/reason.

**Diff-thresholds:**
- |diff| ≤ 500 NOK OG ≤ 5% → close OK uten note.
- 500 < |diff| ≤ 1000 ELLER 5% < |%| ≤ 10% → note required.
- |diff| > 1000 ELLER |%| > 10% → ADMIN force + note required.
- Shift-diff > 100 NOK må forklares (UI-warning).

**Public API:**
- `controlDailyBalance(input)` → `{shiftDailyBalance, reportedDailyBalance, diff, diffPct, severity}`.
- `closeDay(input: CloseDayInput): AgentSettlement`.
- `uploadBilagReceipt({...})`.
- `editSettlement(input: EditSettlementInput): AgentSettlement`.
- `listSettlementsByHall(...)`, `listSettlements(filter)`.
- `getSettlementByShiftId(shiftId)`, `getSettlementById(id)`.
- `resolveDisplayNames(settlement)`, `resolveDisplayNamesBatch(...)`.
- `getSettlementDateInfo(agentUserId): SettlementDateInfo`.
- `buildPdfInput(settlementId, generatedBy)` — for PDF-eksport.

**Avhengigheter:**
- Inn: `PlatformService`, `AgentService`, `AgentShiftService`, `AgentStore`, `AgentTransactionStore`, `AgentSettlementStore`, `HallCashLedger`, `MachineBreakdownTypes`.
- Ut: brukt av agent-routes for shift-end-flow + admin-pages.

**State-management:** Postgres `app_agent_settlements` (nesten-immutabel; bare admin-edit).

**Regulatoriske implikasjoner:**
- Settlement = autoritativ end-of-day-rad for hall-revenue. 14-rad maskin-breakdown speiler legacy 1:1 (PDF 13 §13.5 / PDF 15 §15.8 / PDF 16 §16.25).
- Diff-thresholds + force-flow + admin-edit-trail er Lotteritilsynet-relevant.

**Bug-testing-guide:**
- *"DIFF_NOTE_REQUIRED"* → user må fylle ut settlementNote.
- *"ADMIN_FORCE_REQUIRED"* → eskaler til ADMIN; >1000 NOK eller >10% diff.
- *"Settlement allerede lukket"* → re-call returnerer eksisterende rad.
- *"machine breakdown valideringsfeil"* → sjekk `validateMachineBreakdown`-output (#32).

---

### 26. `apps/backend/src/agent/AgentOpenDayService.ts` (209 LOC)

**Ansvar:** BIN-583 B3.8. Skift-start cash-overføring fra hall til shift's daily-balance. Atomisk to-stegs: (1) HallCashLedger.applyCashTx(DEBIT, DAILY_BALANCE_TRANSFER) muterer `app_halls.cash_balance`, (2) AgentStore.applyShiftCashDelta øker shift-running-balance.

**Guardrails:** Aktiv shift må eksistere; kan ikke åpne dag to ganger; kan ikke åpne hvis prev-shift har endted_at uten settlement; amount > 0 og ≤ hall.cashBalance.

**Public API:**
- `openDay(input: OpenDayInput): OpenDayResult`.
- `getDailyBalance(agentUserId): DailyBalanceSnapshot`.

**Avhengigheter:**
- Inn: `AgentService`, `AgentShiftService`, `AgentStore`, `HallCashLedger`, `AgentSettlementStore`.
- Ut: brukt av agent-routes (Add Daily Balance-popup).

**State-management:** Stateless service; persistens i HallCashLedger + AgentStore.

**Regulatoriske implikasjoner:**
- Modspart til AgentSettlementService.closeDay. Begge-trinn må være atomiske for kasse-konsistens.

**Bug-testing-guide:**
- *"Kan ikke åpne dag — prev shift mangler settlement"* → close prev shift først.
- *"INSUFFICIENT_HALL_CASH"* → hall-kassen er under amount.
- *"DAILY_BALANCE_TRANSFER allerede gjort for shift"* → re-call blokkeres.

---

### 27. `apps/backend/src/agent/HallCashLedger.ts` (281 LOC)

**Ansvar:** BIN-583 B3.3. `app_halls.cash_balance/dropsafe_balance`-mutasjoner med immutabel audit-trail i `app_hall_cash_transactions`. Balance + tx-rad atomisk via samme PoolClient (BEGIN/COMMIT i caller).

**Public API:**
- `applyCashTx(input: ApplyCashTxInput): HallCashTransaction`.
- `getHallBalances(hallId)` → `{cashBalance, dropsafeBalance}`.
- `listForHall(hallId, opts)`, `listForSettlement(settlementId)`.
- (Postgres + InMemory variants).

**TX-typer:** `DAILY_BALANCE_TRANSFER` (open-day), `DROP_SAFE_MOVE` (settlement), `SHIFT_DIFFERENCE`, `MANUAL_ADJUSTMENT`.

**Avhengigheter:**
- Inn: `pg` Pool/PoolClient.
- Ut: brukt av AgentSettlementService, AgentOpenDayService, HallAccountReportService.

**State-management:** Postgres `app_halls.cash_balance` + `app_halls.dropsafe_balance` + `app_hall_cash_transactions` (append-only).

**Regulatoriske implikasjoner:**
- Hall-kasse er regulatorisk relevant. Hver mutasjon må ha tx-rad med previous/after-snapshot for revisjon.

**Bug-testing-guide:**
- *"Hall.cash_balance feil etter shift-end"* → sjekk `app_hall_cash_transactions` for shiftId og settlementId.
- *"Drop-safe diskrepans"* → settlement.drop_safe_in/out vs HallCashLedger.

---

### 28. PhysicalTicketService (refereres)

**Path:** `apps/backend/src/compliance/PhysicalTicketService.ts` (ikke en av de 30 i denne katalogen, men kritisk avhengighet for #23).

**Ansvar (kort):** Fysisk billett-livssyklus — CSV-import, AgentRange, batch-sale, payout, handover. Brukt av AgentTransactionService.sellPhysicalTicket via `TicketPurchasePort`.

---

### 29. `apps/backend/src/agent/UniqueIdService.ts` (369 LOC)

**Ansvar:** Wireframe gaps #8/#10/#11 (PDF 17 §17.9-17.11/17.26). Customer Unique ID-kort (prepaid) lifecycle: create (purchase/expiry/balance/hours/payment/PRINT), add money (akkumulerer, never overwritten), withdraw (cash-only), reprint, regenerate. Append-only tx-log i `app_unique_id_transactions`.

**Public API:**
- `create(input: CreateUniqueIdInput): CreateUniqueIdResult`.
- `addMoney(input: AddMoneyInput)`, `withdraw(input: WithdrawInput)`.
- `getDetails(input: DetailsInput): UniqueIdDetails`.
- `reprint(input: ReprintInput)`, `regenerate(input: RegenerateInput): RegenerateResult`.
- `list(filter)`.

**Konstanter:** `MIN_HOURS_VALIDITY = 24`. Alle beløp i øre (cents).

**Avhengigheter:**
- Inn: `AgentService`, `UniqueIdStore`, `DomainError`.
- Ut: brukt av agent-routes for Unique ID-flows.

**State-management:** Postgres `app_unique_ids` (current balance + status) + `app_unique_id_transactions` (append-only). Atomisk balance-update + tx-insert.

**Regulatoriske implikasjoner:**
- Prepaid-kort er regulatorisk relevant (KYC-light vei for walk-in-spillere).
- ≥ 24 timers validity-krav speiler PDF 17 §17.9.
- Append-only tx-log er audit-grunnlaget.

**Bug-testing-guide:**
- *"Card balance feil etter add money"* → sjekk `app_unique_id_transactions` (CREATE/ADD_MONEY/WITHDRAW/REPRINT/REGENERATE).
- *"INVALID_INPUT: hours validity"* → minst 24t.
- *"Card expired"* → sjekk `expires_at`.

---

### 30. `apps/backend/src/agent/MetroniaTicketService.ts` (696 LOC)

**Ansvar:** BIN-583 B3.4. Metronia ekstern-maskin orkestrator. (1) `createTicket`: debit player wallet → create Metronia ticket → store DB + log MACHINE_CREATE. (2) `topupTicket`: debit wallet → upgrade Metronia → DB+log. (3) `closeTicket`: close Metronia API → credit wallet med finalBalance → mark closed + log. (4) `voidTicket` (innen 5 min): close Metronia + refund initial+topups + mark voided + log. (5) `autoCloseTicket`. (6) Reports.

**Public API:**
- `createTicket(input)`, `topupTicket(input)`, `closeTicket(input)`, `autoCloseTicket(input)`, `voidTicket(input)`.
- `getTicketByNumber(ticketNumber)`.
- `getDailySalesForCurrentShift(agentUserId)`, `getHallSummary(hallId, opts)`, `getDailyReport(opts)`.

**Konstanter:** `VOID_WINDOW_MS = 5*60*1000`, MIN/MAX 1-1000 NOK.

**Avhengigheter:**
- Inn: `WalletAdapter`, `PlatformService`, `AgentService`, `AgentShiftService`, `AgentTransactionStore`, `MachineTicketStore`, `MetroniaApiClient`, `IdempotencyKeys`.
- Ut: brukt av agent-routes for Metronia-flows.

**State-management:** Postgres `app_machine_tickets` (machine_name='METRONIA') + agent-tx-log. Wallet-side idempotent via clientRequestId.

**Regulatoriske implikasjoner:**
- Tre-fase orkestrering wallet ↔ ekstern API ↔ DB. Crash-recovery via uniqueTransaction-idempotency. Partial-failure varsles via audit-log; manuell reconcile er ops-ansvar.
- Refund-policy ved API-feil: alltid refund initial+topups (regulatorisk: spilleren skal ikke tape penger ved Metronia-feil).

**Bug-testing-guide:**
- *"VOID_WINDOW_EXPIRED"* → > 5 min siden createTicket. ADMIN-force eller auto-close-flow.
- *"METRONIA_API_ERROR"* → ekstern API nede; wallet er allerede debited — sjekk om refund-flow ble trigget.
- *"Ticket mangler etter create"* → DB-insert feilet etter Metronia-create. Sjekk `MetroniaApiClient.uniqueTransaction` for å reconciliere.

---

### 31. `apps/backend/src/agent/OkBingoTicketService.ts` (662 LOC)

**Ansvar:** BIN-583 B3.5. OK Bingo-spegling av Metronia + roomId-felt + `openDay` SQL Server RPC. SQL Server polling i prod, stub i dev/CI. Felles `MachineTicketStore` med `machine_name='OK_BINGO'`.

**Public API:**
- Samme som Metronia: `createTicket`, `topupTicket`, `closeTicket`, `autoCloseTicket`, `voidTicket`, `getTicketByNumber`, `getDailySalesForCurrentShift`, `getHallSummary`, `getDailyReport`.
- I tillegg: `openDay(input: OpenDayInput): {opened: true, roomId: number}` — sender ComandID=11 til OK Bingo-maskin.

**Konstanter:** `VOID_WINDOW_MS = 5*60*1000`, `DEFAULT_BINGO_ROOM_ID = 247`, MIN/MAX 1-1000 NOK.

**Avhengigheter:**
- Inn: identisk med Metronia + `OkBingoApiClient`.
- Ut: brukt av agent-routes for OK Bingo-flows + admin OK Bingo-rapporter.

**State-management:** Postgres `app_machine_tickets` (machine_name='OK_BINGO').

**Regulatoriske implikasjoner:**
- Samme som Metronia. `openDay` er en spesiell hardware-signal som må logges som agent.okbingo.open-day audit-event.

**Bug-testing-guide:**
- *"OK Bingo open-day feiler"* → SQL Server tilkobling; sjekk `OkBingoApiClient`.
- *"Tickets bruker feil roomId"* → DEFAULT_BINGO_ROOM_ID 247 om ingen override.
- *"OKBINGO_TIMEOUT"* → SQL Server polling tid ut; må retry eller eskalere.

---

### 32. `apps/backend/src/agent/MachineBreakdownTypes.ts` (281 LOC)

**Ansvar:** K1 settlement maskin-breakdown — 1:1 legacy-paritet med wireframes (PDF 13 §13.5 + PDF 15 §15.8 + PDF 16 §16.25 + PDF 17 §17.10). 14 rader (Total beregnes på klient): Metronia, OK Bingo, Franco, Otium, Norsk Tipping Dag/Totalt, Rikstoto Dag/Totalt, Rekvisita, Servering, Bilag, Bank, Gevinst overføring bank, Annet. Beløp i øre for å unngå float-feil.

**Public API:**
- Type: `MachineRowKey`, `MachineRow`, `MachineBreakdown`, `BilagReceipt`.
- Konstant: `MACHINE_ROW_KEYS` (alle 14 nøkler).
- Funksjoner: `validateMachineBreakdown(...)`, `validateBilagReceipt(...)`, `computeBreakdownTotals(breakdown)`, `emptyMachineBreakdown()`.

**Shift-delta-felter:** `kasse_start_skift_cents`, `ending_opptall_kassie_cents`, `innskudd_drop_safe_cents`, `paafyll_ut_kasse_cents`, `totalt_dropsafe_paafyll_cents`, `difference_in_shifts_cents`.

**Formel (wireframe 16.25):**
```
difference_in_shifts = totalt_dropsafe_paafyll - totalt_sum_kasse_fil
totalt_sum_kasse_fil = sum(rows: in - out)
```

**Avhengigheter:**
- Inn: ingen.
- Ut: brukt av AgentSettlementService og AgentSettlementStore.

**State-management:** Stateless type-modul.

**Regulatoriske implikasjoner:**
- Wireframe 1:1-speiling er regulatorisk paritet-krav. Hver av de 14 rader speiler en kasse-kolonne i legacy-systemet operatører kjenner.
- Øre-presisjon (integer cents) er nødvendig fordi JSONB-tall i Postgres er float64 — float-summasjons-feil ble observert i K1-A.

**Bug-testing-guide:**
- *"Difference > 100 NOK"* → UI advarer; over 1000 NOK → ADMIN-force.
- *"validateMachineBreakdown failure"* → ukjente nøkler eller negative cents — strict validering.
- *"computeBreakdownTotals returnerer feil sum"* → sjekk øre vs NOK forveksling i caller.

---

## Cross-cutting concerns

### Idempotency-keys

| Subsystem | Key-format | Hvor håndhevet |
|---|---|---|
| Wallet | `agent-shift:{shiftId}:start|end|cash-in:{txId}|cash-out:{txId}` | PostgresWalletAdapter (`idempotency_key`-kolonne på wallet_transactions). |
| Agent transactions | `(agent_user_id, player_user_id, client_request_id)` | Partial unique-index (BIN-PILOT-K1 P0-1). |
| Payment requests | `payment-request:{kind}:{id}` | PaymentRequestService accept-flow. |
| Metronia ticket | `metronia:create:{clientRequestId}` etc. | IdempotencyKeys-helper. |
| OK Bingo ticket | `okbingo:create:{clientRequestId}` etc. | Same. |
| Spill 1 | `g1:purchase:{...}`, `g1:payout:{...}` | Game1-services (utenfor scope). |

### Wallet-split (deposit vs winnings)

Alle wallet-write-paths må respektere split:
- Deposit-side: topup, refund, admin-correction. Eneste konto som teller mot Spillvett-tapsgrense.
- Winnings-side: kun game-engine credit (regulatorisk forbud mot admin-credit til winnings). Trekkes først ved kjøp.

### Hall-binding (PR #443)

`actor_hall_id`-kolonne på compliance-ledger sikrer §71-rapportering per kjøpe-hall, ikke master-hall. Multi-hall-bug fikset her.

---

## Konvensjoner

- **DomainError vs WalletError:** DomainError fra `BingoEngine.ts` brukes for forretnings-feil; WalletError for adapter-spesifikke. Service-laget kaster vanligvis DomainError.
- **Soft-delete:** Default for admin-services (`deleted_at` + `status='inactive'`). Hard-delete kun via eksplisitt `{hard: true}` og blokkeres ved aktiv referanse.
- **Idempotent ensureInitialized():** Alle admin-services har metode for først-gangs-DB-init (idempotent). Kalles fra index.ts.
- **Object.create test-hook:** Admin-services bruker `Object.create(MyService.prototype)` for å mocke pool i tester.
- **Logger child:** Hver service har `rootLogger.child({module: "..."})` for strukturert logging.
- **Append-only logs:** AgentTransactionStore, UniqueIdStore.transactions, HallCashLedger.transactions, walletEntries — alle er append-only. Korreksjoner via counter-transactions.
- **Postgres + InMemory twins:** Stores eksponerer interface; service avhenger av interface, ikke konkret klasse.

---

## Bug-testing-snarveier (cross-modul)

| Symptom | Sjekk i rekkefølge |
|---|---|
| Saldo henger som "reservert" | (1) WalletReservationExpiryService running? (2) `expireStaleReservations` kall (3) DB rad i `wallet_reservations` med `status='active'` og expires_at < now |
| Hall-rapport viser feil omsetning | (1) HallAccountReportService aggregat (2) ComplianceLedger for stake/prize (3) AgentTransactionStore for cash-flow (4) HallCashLedger for hall-kasse-mutasjoner (5) Manual adjustments |
| Settlement diff ikke OK | (1) controlDailyBalance pre-flight (2) AgentTransactionStore.aggregateByShift (3) Diff-thresholds i AgentSettlementService (500/1000 NOK + 5/10%) (4) Force-required popup |
| Metronia/OK Bingo ticket "mistet" | (1) `app_machine_tickets` rad (2) `MetroniaApiClient`/`OkBingoApiClient` log (3) `app_agent_transactions` med MACHINE_CREATE (4) Wallet-tx idempotency-key |
| Compliance-binding feil hall | (1) PR #443 — `actor_hall_id` på ledger-entries (2) Game1TicketPurchaseService.ts:606 (3) Game1PayoutService.ts:390 |
| TV-display 401 | (1) PlatformService.verifyHallTvToken (2) `app_hall_display_tokens` rad (3) Composite token format `<hallId>:<tokenId>:<plaintext>` |
| Wallet hash-mismatch alarm | (1) WalletAuditVerifier.verifyAccount (2) `wallet_entries.entry_hash` vs computed (3) Sjekk `previous_entry_hash`-chain for konto |
| Outbox-events bygger seg opp | (1) WalletOutboxRepo.countByStatus (2) Worker `start()`'et i index.ts? (3) Dispatcher kaster — sjekk `last_error` på dead_letter-rader |

---

**Generert:** 2026-04-28 av docs-agent (per Tobias-direktiv).
**Format:** Speiler MODULE_CATALOG_GAME_2026-04-28.md (game-katalog del 1).
**Antall moduler:** 32 (mål 30 + 2 ekstra Hall-relaterte deler oppdaget under analyse).
