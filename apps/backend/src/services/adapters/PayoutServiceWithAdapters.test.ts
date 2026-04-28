/**
 * Unified pipeline refactor — Fase 1 integration test.
 *
 * Verifiserer at PayoutService kan kjøre mot eksisterende prod-infrastruktur
 * (WalletAdapter + ComplianceLedgerPort + AuditLogService) gjennom
 * adapter-wrappers. Dette er broen mellom de to kontraktene som lar
 * eksisterende call-sites migrere inkrementelt.
 *
 * Test bruker:
 *   - InMemoryWalletAdapter (eksisterende test-double)
 *   - InMemoryAuditLogStore (eksisterende test-double)
 *   - Stub ComplianceLedgerPort som teller events
 *
 * Verifiserer:
 *   - PayoutService med adapter-wrappers gir samme resultat som med
 *     InMemory-portene (cents-baserte beregninger holder).
 *   - Multi-winner split + HOUSE_RETAINED-event kommer fram til legacy
 *     ComplianceLedgerPort.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { InMemoryAuditLogStore, AuditLogService } from "../../compliance/AuditLogService.js";
import type { ComplianceLedgerPort, ComplianceLedgerEventInput } from "../../adapters/ComplianceLedgerPort.js";
import { DefaultIdempotencyKeyPort } from "../../ports/IdempotencyKeyPort.js";
import { PayoutService } from "../PayoutService.js";
import {
  AuditAdapterPort,
  ComplianceAdapterPort,
  WalletAdapterPort,
} from "./index.js";

class StubComplianceLedgerPort implements ComplianceLedgerPort {
  events: ComplianceLedgerEventInput[] = [];

  async recordComplianceLedgerEvent(input: ComplianceLedgerEventInput): Promise<void> {
    this.events.push(input);
  }
}

test("PayoutService med WalletAdapterPort + ComplianceAdapterPort + AuditAdapterPort kjører end-to-end", async () => {
  const walletAdapter = new InMemoryWalletAdapter();
  // Fyll opp en spiller-wallet med 0 så credit treffer winnings-side.
  await walletAdapter.createAccount({ accountId: "wallet-winner-1", initialBalance: 0 });

  const legacyComplianceLedger = new StubComplianceLedgerPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditService = new AuditLogService(auditStore);

  const service = new PayoutService({
    wallet: new WalletAdapterPort(walletAdapter),
    compliance: new ComplianceAdapterPort(legacyComplianceLedger),
    audit: new AuditAdapterPort(auditService),
    keys: new DefaultIdempotencyKeyPort(),
  });

  const result = await service.payoutPhase({
    gameId: "game-bridge-1",
    phaseId: "phase-1",
    phaseName: "1 Rad",
    winners: [
      { walletId: "wallet-winner-1", playerId: "player-1", hallId: "hall-1", claimId: "claim-1" },
    ],
    totalPrizeCents: 10_000,
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  // Wallet credit landet på winnings-side med 100 kr.
  const balance = await walletAdapter.getBothBalances("wallet-winner-1");
  assert.equal(balance.winnings, 100);
  assert.equal(balance.deposit, 0);

  // Result-shape stemmer.
  assert.equal(result.prizePerWinnerCents, 10_000);
  assert.equal(result.houseRetainedCents, 0);

  // Compliance: én PRIZE-event til legacy-port.
  assert.equal(legacyComplianceLedger.events.length, 1);
  const event = legacyComplianceLedger.events[0]!;
  assert.equal(event.eventType, "PRIZE");
  assert.equal(event.amount, 100); // kroner
  assert.equal(event.hallId, "hall-1");
  assert.equal(event.gameType, "MAIN_GAME");

  // Idempotency-keyen er bevart i metadata.
  assert.match(
    String(event.metadata?.unifiedPipelineIdempotencyKey ?? ""),
    /^PRIZE:game-bridge-1:claim-1$/,
  );

  // Audit har én summary-event.
  const events = await auditStore.list({ resource: "game", resourceId: "game-bridge-1" });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.action, "game.payout.phase");
});

test("PayoutService med adaptere: multi-winner split skriver HOUSE_RETAINED til legacy-ledger", async () => {
  const walletAdapter = new InMemoryWalletAdapter();
  await walletAdapter.createAccount({ accountId: "w-A", initialBalance: 0 });
  await walletAdapter.createAccount({ accountId: "w-B", initialBalance: 0 });
  await walletAdapter.createAccount({ accountId: "w-C", initialBalance: 0 });

  const legacyComplianceLedger = new StubComplianceLedgerPort();
  const auditStore = new InMemoryAuditLogStore();
  const auditService = new AuditLogService(auditStore);

  const service = new PayoutService({
    wallet: new WalletAdapterPort(walletAdapter),
    compliance: new ComplianceAdapterPort(legacyComplianceLedger),
    audit: new AuditAdapterPort(auditService),
    keys: new DefaultIdempotencyKeyPort(),
  });

  // 1700 kr / 3 vinnere → 566 kr hver + 2 øre rest
  await service.payoutPhase({
    gameId: "game-multi",
    phaseId: "phase-fullt-hus",
    phaseName: "Fullt Hus",
    winners: [
      { walletId: "w-A", playerId: "p-A", hallId: "hall-1", claimId: "c-A" },
      { walletId: "w-B", playerId: "p-B", hallId: "hall-2", claimId: "c-B" },
      { walletId: "w-C", playerId: "p-C", hallId: "hall-3", claimId: "c-C" },
    ],
    totalPrizeCents: 170_000,
    actorHallId: "hall-1",
    isFixedPrize: true,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
  });

  // Verifisér: 3 PRIZE-events + 1 HOUSE_RETAINED-event.
  assert.equal(legacyComplianceLedger.events.length, 4);
  const prizes = legacyComplianceLedger.events.filter((e) => e.eventType === "PRIZE");
  assert.equal(prizes.length, 3);
  const houseRetained = legacyComplianceLedger.events.find((e) => e.eventType === "HOUSE_RETAINED");
  assert.notEqual(houseRetained, undefined);
  assert.equal(houseRetained!.amount, 0.02); // 2 øre = 0.02 kr
  assert.equal(houseRetained!.hallId, "hall-1"); // bindes til winners[0].hallId
});
