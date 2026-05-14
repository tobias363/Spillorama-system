# Skill → File Mapping (auto-generated)

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `scripts/build-skill-file-map.mjs`. Kjør `npm run build:skill-map`
> eller `node scripts/build-skill-file-map.mjs` lokalt.
>
> Tabellen oppdateres automatisk ved hver endring i `.claude/skills/`.

Hver skill har en `<!-- scope: glob1, glob2 -->`-header i sin
`.claude/skills/<name>/SKILL.md`. Denne tabellen viser scope-mønstre
og antall filer som matcher i nåværende HEAD.

Antall skills totalt: **20** — varsel hvis noen mangler scope-header:

> ✓ Alle skills har scope-header.

## Skill-katalog

| Skill | Antall mønstre | Filer matchet | Scope-mønstre |
|---|---:|---:|---|
| `agent-portal-master-konsoll` | 11 | 17 | `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`<br>`apps/admin-web/src/pages/cash-inout/CashInOutPage.ts`<br>`apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`<br>`apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts`<br>_(+7 more)_ |
| `agent-shift-settlement` | 10 | 19 | `apps/backend/src/agent/AgentShiftService.ts`<br>`apps/backend/src/agent/AgentSettlementService.ts`<br>`apps/backend/src/agent/AgentSettlementStore.ts`<br>`apps/backend/src/agent/AgentTransactionService.ts`<br>_(+6 more)_ |
| `anti-fraud-detection` | 6 | 7 | `apps/backend/src/security/AntiFraudService.ts`<br>`apps/backend/src/security/AntiFraudWalletAdapter.ts`<br>`apps/backend/src/security/__tests__/AntiFraud*.test.ts`<br>`apps/backend/src/routes/adminAntiFraud.ts`<br>_(+2 more)_ |
| `audit-hash-chain` | 7 | 6 | `apps/backend/src/compliance/AuditLogService.ts`<br>`apps/backend/src/compliance/AuditLogService.test.ts`<br>`apps/backend/src/wallet/WalletAuditVerifier.ts`<br>`apps/backend/src/wallet/WalletAuditVerifier.test.ts`<br>_(+3 more)_ |
| `candy-iframe-integration` | 6 | 6 | `apps/backend/src/integration/externalGameWallet.ts`<br>`apps/backend/src/integration/externalGameWallet.test.ts`<br>`apps/backend/src/routes/game.ts`<br>`apps/backend/public/web/spillvett.js`<br>_(+2 more)_ |
| `casino-grade-testing` | 4 | 657 | `infra/chaos-tests/**`<br>`apps/backend/src/__tests__/chaos/**`<br>`apps/backend/src/**/*.test.ts`<br>`tests/e2e/**` |
| `customer-unique-id` | 9 | 9 | `apps/backend/src/agent/UniqueIdService.ts`<br>`apps/backend/src/agent/UniqueIdStore.ts`<br>`apps/backend/src/agent/__tests__/UniqueIdStore.postgres.test.ts`<br>`apps/backend/src/agent/__tests__/UniqueIdService.test.ts`<br>_(+5 more)_ |
| `database-migration-policy` | 3 | 159 | `apps/backend/migrations/**`<br>`apps/backend/src/scripts/migrate.ts`<br>`render.yaml` |
| `dr-runbook-execution` | 9 | 11 | `docs/operations/DR_RUNBOOK.md`<br>`docs/operations/LIVE_ROOM_DR_RUNBOOK.md`<br>`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`<br>`docs/operations/INCIDENT_RESPONSE_PLAN.md`<br>_(+5 more)_ |
| `goh-master-binding` | 10 | 10 | `apps/backend/src/admin/HallGroupService.ts`<br>`apps/backend/src/admin/HallGroupService.test.ts`<br>`apps/backend/src/routes/adminHallGroups.ts`<br>`apps/backend/src/routes/__tests__/adminHallGroups.test.ts`<br>_(+6 more)_ |
| `health-monitoring-alerting` | 5 | 5 | `apps/backend/src/routes/publicGameHealth.ts`<br>`apps/backend/src/routes/__tests__/publicGameHealth.test.ts`<br>`apps/backend/src/observability/RoomAlertingService.ts`<br>`apps/backend/src/observability/RoomAlertingBootstrap.ts`<br>_(+1 more)_ |
| `live-room-robusthet-mandate` | 8 | 17 | `apps/backend/src/sockets/SocketIdempotencyStore.ts`<br>`apps/backend/src/sockets/withSocketIdempotency.ts`<br>`apps/backend/src/observability/RoomAlertingService.ts`<br>`apps/backend/src/adapters/EngineCircuitBreakerPort.ts`<br>_(+4 more)_ |
| `pengespillforskriften-compliance` | 10 | 81 | `apps/backend/src/compliance/**`<br>`apps/backend/src/spillevett/**`<br>`apps/backend/src/game/ComplianceLedger*`<br>`apps/backend/src/game/PrizePolicyManager.ts`<br>_(+6 more)_ |
| `pm-orchestration-pattern` | 8 | 31 | `BACKLOG.md`<br>`docs/operations/PM_HANDOFF_*.md`<br>`docs/engineering/PM_*.md`<br>`scripts/agent-onboarding.sh`<br>_(+4 more)_ |
| `spill1-master-flow` | 20 | 126 | `apps/backend/src/game/Game1*`<br>`apps/backend/src/game/MasterActionService.ts`<br>`apps/backend/src/game/GamePlanRunService.ts`<br>`apps/backend/src/game/GamePlanRunCleanupService.ts`<br>_(+16 more)_ |
| `spill2-perpetual-loop` | 8 | 51 | `apps/backend/src/game/Game2*`<br>`apps/backend/src/game/Spill2*`<br>`apps/backend/src/game/PerpetualRound*`<br>`apps/backend/src/jobs/game2AutoDrawTick.ts`<br>_(+4 more)_ |
| `spill3-phase-state-machine` | 9 | 23 | `apps/backend/src/game/Game3*`<br>`apps/backend/src/game/Spill3*`<br>`apps/backend/src/jobs/game3AutoDrawTick.ts`<br>`apps/backend/src/routes/adminSpill3Config.ts`<br>_(+5 more)_ |
| `spinngo-databingo` | 5 | 9 | `apps/backend/src/game/ledgerGameTypeForSlug.ts`<br>`apps/backend/src/game/ledgerGameTypeForSlug.test.ts`<br>`apps/backend/src/game/ledgerGameTypeForSlug.distribution.test.ts`<br>`apps/backend/src/game/ComplianceLedgerOverskudd.ts`<br>_(+1 more)_ |
| `trace-id-observability` | 7 | 47 | `apps/backend/src/middleware/traceId.ts`<br>`apps/backend/src/middleware/traceId.test.ts`<br>`apps/backend/src/middleware/socketTraceId.ts`<br>`apps/backend/src/middleware/socketTraceId.test.ts`<br>_(+3 more)_ |
| `wallet-outbox-pattern` | 10 | 39 | `apps/backend/src/wallet/**`<br>`apps/backend/src/adapters/PostgresWalletAdapter*`<br>`apps/backend/src/adapters/InMemoryWalletAdapter*`<br>`apps/backend/src/adapters/FileWalletAdapter*`<br>_(+6 more)_ |

## Per-skill detalj

### `agent-portal-master-konsoll`

**Scope-mønstre:**

- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`
- `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts`
- `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`
- `apps/admin-web/src/pages/agent-portal/Spill1AgentControls.ts`
- `apps/admin-web/src/pages/agent-portal/Spill1AgentStatus.ts`
- `apps/admin-web/src/pages/agent-portal/JackpotSetupModal.ts`
- `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts`
- `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts`
- `apps/admin-web/src/pages/games/master/adminGame1Socket.ts`
- `apps/admin-web/src/api/agent-game-plan.ts`
- `apps/admin-web/src/pages/cash-inout/modals/**`

**Filer matchet i HEAD:** 17

### `agent-shift-settlement`

**Scope-mønstre:**

- `apps/backend/src/agent/AgentShiftService.ts`
- `apps/backend/src/agent/AgentSettlementService.ts`
- `apps/backend/src/agent/AgentSettlementStore.ts`
- `apps/backend/src/agent/AgentTransactionService.ts`
- `apps/backend/src/agent/AgentTransactionStore.ts`
- `apps/backend/src/agent/HallCashLedger.ts`
- `apps/backend/src/routes/agentSettlement.ts`
- `apps/backend/src/routes/agentDashboard.ts`
- `apps/backend/src/agent/__tests__/AgentShiftService*.test.ts`
- `apps/backend/src/agent/__tests__/AgentSettlementService*.test.ts`

**Filer matchet i HEAD:** 19

### `anti-fraud-detection`

**Scope-mønstre:**

- `apps/backend/src/security/AntiFraudService.ts`
- `apps/backend/src/security/AntiFraudWalletAdapter.ts`
- `apps/backend/src/security/__tests__/AntiFraud*.test.ts`
- `apps/backend/src/routes/adminAntiFraud.ts`
- `apps/backend/src/routes/__tests__/adminAntiFraud.test.ts`
- `apps/backend/src/compliance/AmlService.ts`

**Filer matchet i HEAD:** 7

### `audit-hash-chain`

**Scope-mønstre:**

- `apps/backend/src/compliance/AuditLogService.ts`
- `apps/backend/src/compliance/AuditLogService.test.ts`
- `apps/backend/src/wallet/WalletAuditVerifier.ts`
- `apps/backend/src/wallet/WalletAuditVerifier.test.ts`
- `apps/backend/src/adapters/PostgresWalletAdapter.ts`
- `apps/backend/src/scripts/verifyAuditChain.ts`
- `apps/backend/src/jobs/walletAuditVerify.ts`

**Filer matchet i HEAD:** 6

### `candy-iframe-integration`

**Scope-mønstre:**

- `apps/backend/src/integration/externalGameWallet.ts`
- `apps/backend/src/integration/externalGameWallet.test.ts`
- `apps/backend/src/routes/game.ts`
- `apps/backend/public/web/spillvett.js`
- `apps/backend/public/web/lobby.js`
- `apps/backend/public/web/index.html`

**Filer matchet i HEAD:** 6

### `casino-grade-testing`

**Scope-mønstre:**

- `infra/chaos-tests/**`
- `apps/backend/src/__tests__/chaos/**`
- `apps/backend/src/**/*.test.ts`
- `tests/e2e/**`

**Filer matchet i HEAD:** 657

### `customer-unique-id`

**Scope-mønstre:**

- `apps/backend/src/agent/UniqueIdService.ts`
- `apps/backend/src/agent/UniqueIdStore.ts`
- `apps/backend/src/agent/__tests__/UniqueIdStore.postgres.test.ts`
- `apps/backend/src/agent/__tests__/UniqueIdService.test.ts`
- `apps/backend/src/routes/adminUniqueIdsAndPayouts.ts`
- `apps/backend/src/routes/agentUniqueIds.ts`
- `apps/backend/src/routes/__tests__/adminUniqueIdsAndPayouts.test.ts`
- `apps/backend/src/routes/__tests__/agentUniqueIds.test.ts`
- `apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts`

**Filer matchet i HEAD:** 9

### `database-migration-policy`

**Scope-mønstre:**

- `apps/backend/migrations/**`
- `apps/backend/src/scripts/migrate.ts`
- `render.yaml`

**Filer matchet i HEAD:** 159

### `dr-runbook-execution`

**Scope-mønstre:**

- `docs/operations/DR_RUNBOOK.md`
- `docs/operations/LIVE_ROOM_DR_RUNBOOK.md`
- `docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`
- `docs/operations/INCIDENT_RESPONSE_PLAN.md`
- `docs/operations/HALL_PILOT_RUNBOOK.md`
- `docs/operations/EMERGENCY_RUNBOOK.md`
- `docs/operations/DRILL_BACKUP_RESTORE_*.md`
- `docs/operations/DRILL_ROLLBACK_*.md`
- `docs/operations/PILOT_*_RUNBOOK*.md`

**Filer matchet i HEAD:** 11

### `goh-master-binding`

**Scope-mønstre:**

- `apps/backend/src/admin/HallGroupService.ts`
- `apps/backend/src/admin/HallGroupService.test.ts`
- `apps/backend/src/routes/adminHallGroups.ts`
- `apps/backend/src/routes/__tests__/adminHallGroups.test.ts`
- `apps/backend/src/platform/HallGroupMembershipQuery.ts`
- `apps/backend/src/platform/__tests__/HallGroupMembershipQuery.test.ts`
- `apps/backend/src/game/Game1TransferHallService.ts`
- `apps/backend/src/game/Game1TransferExpiryTickService.ts`
- `apps/backend/src/game/Game1HallReadyService.ts`
- `apps/backend/src/boot/bootstrapHallGroupRooms.ts`

**Filer matchet i HEAD:** 10

### `health-monitoring-alerting`

**Scope-mønstre:**

- `apps/backend/src/routes/publicGameHealth.ts`
- `apps/backend/src/routes/__tests__/publicGameHealth.test.ts`
- `apps/backend/src/observability/RoomAlertingService.ts`
- `apps/backend/src/observability/RoomAlertingBootstrap.ts`
- `apps/backend/src/observability/__tests__/RoomAlertingService.test.ts`

**Filer matchet i HEAD:** 5

### `live-room-robusthet-mandate`

**Scope-mønstre:**

- `apps/backend/src/sockets/SocketIdempotencyStore.ts`
- `apps/backend/src/sockets/withSocketIdempotency.ts`
- `apps/backend/src/observability/RoomAlertingService.ts`
- `apps/backend/src/adapters/EngineCircuitBreakerPort.ts`
- `apps/backend/src/routes/publicGameHealth.ts`
- `infra/chaos-tests/**`
- `apps/backend/src/__tests__/chaos/**`
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_*.md`

**Filer matchet i HEAD:** 17

### `pengespillforskriften-compliance`

**Scope-mønstre:**

- `apps/backend/src/compliance/**`
- `apps/backend/src/spillevett/**`
- `apps/backend/src/game/ComplianceLedger*`
- `apps/backend/src/game/PrizePolicyManager.ts`
- `apps/backend/src/game/ledgerGameTypeForSlug.ts`
- `apps/backend/src/game/ResponsibleGamingPersistence.ts`
- `apps/backend/src/game/PostgresResponsibleGamingStore.ts`
- `apps/backend/src/adapters/PrizePolicyPort.ts`
- `apps/backend/src/adapters/ComplianceLedgerPort.ts`
- `apps/backend/src/adapters/ComplianceLossPort.ts`

**Filer matchet i HEAD:** 81

### `pm-orchestration-pattern`

**Scope-mønstre:**

- `BACKLOG.md`
- `docs/operations/PM_HANDOFF_*.md`
- `docs/engineering/PM_*.md`
- `scripts/agent-onboarding.sh`
- `scripts/pm-onboarding.sh`
- `scripts/pm-checkpoint.sh`
- `scripts/generate-context-pack.sh`
- `.github/workflows/pm-*.yml`

**Filer matchet i HEAD:** 31

### `spill1-master-flow`

**Scope-mønstre:**

- `apps/backend/src/game/Game1*`
- `apps/backend/src/game/MasterActionService.ts`
- `apps/backend/src/game/GamePlanRunService.ts`
- `apps/backend/src/game/GamePlanRunCleanupService.ts`
- `apps/backend/src/game/GamePlanEngineBridge.ts`
- `apps/backend/src/game/GameLobbyAggregator.ts`
- `apps/backend/src/game/Spill1LobbyBroadcaster.ts`
- `apps/backend/src/game/BingoEngine.ts`
- `apps/backend/src/game/BingoEngine.spill1*.test.ts`
- `apps/backend/src/routes/agentGame1*.ts`
- `apps/backend/src/routes/agentGamePlan.ts`
- `apps/backend/src/routes/adminGame1*.ts`
- `apps/backend/src/jobs/game1*.ts`
- `apps/backend/src/jobs/gamePlanRunCleanup.ts`
- `apps/backend/src/__tests__/MasterActionService*.test.ts`
- `apps/backend/src/game/__tests__/GamePlan*.test.ts`
- `apps/backend/src/game/__tests__/GameLobbyAggregator*.test.ts`
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`
- `apps/admin-web/src/pages/agent-portal/Spill1*.ts`
- `apps/admin-web/src/pages/games/master/Game1MasterConsole.ts`

**Filer matchet i HEAD:** 126

### `spill2-perpetual-loop`

**Scope-mønstre:**

- `apps/backend/src/game/Game2*`
- `apps/backend/src/game/Spill2*`
- `apps/backend/src/game/PerpetualRound*`
- `apps/backend/src/jobs/game2AutoDrawTick.ts`
- `apps/backend/src/util/canonicalRoomCode.ts`
- `apps/backend/src/util/roomState.bindSpill2Config.test.ts`
- `apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts`
- `packages/game-client/src/games/game2/**`

**Filer matchet i HEAD:** 51

### `spill3-phase-state-machine`

**Scope-mønstre:**

- `apps/backend/src/game/Game3*`
- `apps/backend/src/game/Spill3*`
- `apps/backend/src/jobs/game3AutoDrawTick.ts`
- `apps/backend/src/routes/adminSpill3Config.ts`
- `apps/backend/src/util/roomState.bindSpill3Config.test.ts`
- `apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts`
- `apps/admin-web/src/api/admin-spill3-config.ts`
- `apps/admin-web/src/pages/games/spill3Config/**`
- `packages/game-client/src/games/game3/**`

**Filer matchet i HEAD:** 23

### `spinngo-databingo`

**Scope-mønstre:**

- `apps/backend/src/game/ledgerGameTypeForSlug.ts`
- `apps/backend/src/game/ledgerGameTypeForSlug.test.ts`
- `apps/backend/src/game/ledgerGameTypeForSlug.distribution.test.ts`
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts`
- `packages/game-client/src/games/game5/**`

**Filer matchet i HEAD:** 9

### `trace-id-observability`

**Scope-mønstre:**

- `apps/backend/src/middleware/traceId.ts`
- `apps/backend/src/middleware/traceId.test.ts`
- `apps/backend/src/middleware/socketTraceId.ts`
- `apps/backend/src/middleware/socketTraceId.test.ts`
- `apps/backend/src/util/traceContext.ts`
- `apps/backend/src/util/traceContext.test.ts`
- `apps/backend/src/observability/**`

**Filer matchet i HEAD:** 47

### `wallet-outbox-pattern`

**Scope-mønstre:**

- `apps/backend/src/wallet/**`
- `apps/backend/src/adapters/PostgresWalletAdapter*`
- `apps/backend/src/adapters/InMemoryWalletAdapter*`
- `apps/backend/src/adapters/FileWalletAdapter*`
- `apps/backend/src/adapters/HttpWalletAdapter*`
- `apps/backend/src/adapters/WalletAdapter.ts`
- `apps/backend/src/game/Game1TicketPurchaseService.ts`
- `apps/backend/src/game/Game1PayoutService.ts`
- `apps/backend/src/game/IdempotencyKeys.ts`
- `apps/backend/scripts/reconcile-wallet-vs-ledger.ts`

**Filer matchet i HEAD:** 39

---

## Slik bruker du dette

Når du skal røre en fil, finn relevante skills med:

```bash
node scripts/find-skills-for-file.mjs apps/backend/src/game/Game2Engine.ts
# → spill2-perpetual-loop
```

Når PM spawner agent på en file-pattern, kjør:

```bash
bash scripts/generate-context-pack.sh apps/backend/src/game/Game2Engine.ts
# → inkluderer FRAGILITY + PITFALLS + relevant skill-content
```

