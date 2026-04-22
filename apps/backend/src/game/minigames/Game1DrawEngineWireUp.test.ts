/**
 * BIN-690 Spor 3 M1: smoke-test for Game1DrawEngineService wire-up.
 *
 * Verifiserer at `Game1DrawEngineService.setMiniGameOrchestrator()` er
 * tilgjengelig på public API og at options.miniGameOrchestrator godtas.
 * Full DB-integrasjonstest av trigger-after-Fullt-Hus dekkes i M2+ når
 * konkrete mini-game-implementasjoner finnes å validere mot.
 *
 * Hovedtest av trigger-flyt gjøres i Game1MiniGameOrchestrator.test.ts
 * med fake-pool. Denne filen sikrer bare at wire-up ikke er glemt.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1DrawEngineService,
  type Game1DrawEngineServiceOptions,
} from "../Game1DrawEngineService.js";
import {
  Game1MiniGameOrchestrator,
  type Game1MiniGameOrchestratorOptions,
} from "./Game1MiniGameOrchestrator.js";
import type { Game1TicketPurchaseService } from "../Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

function makeStubPool(): import("pg").Pool {
  return {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => undefined,
    }),
  } as unknown as import("pg").Pool;
}

function makeStubWalletAdapter(): import("../../adapters/WalletAdapter.js").WalletAdapter {
  return {
    credit: async () => ({ id: "tx-1" }),
    debit: async () => ({ id: "tx-1" }),
    transfer: async () => ({ fromTx: { id: "f" }, toTx: { id: "t" } }),
    getBalance: async () => 0,
    getAccountExists: async () => true,
    createAccount: async () => undefined,
  } as unknown as import("../../adapters/WalletAdapter.js").WalletAdapter;
}

function makeStubTicketPurchaseService(): Game1TicketPurchaseService {
  return {
    listPurchasesForScheduledGame: async () => [],
  } as unknown as Game1TicketPurchaseService;
}

test("BIN-690 M1 wire-up: setMiniGameOrchestrator finnes på drawEngine", () => {
  const pool = makeStubPool();
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());
  const ticketPurchaseService = makeStubTicketPurchaseService();

  const drawEngine = new Game1DrawEngineService({
    pool,
    ticketPurchaseService,
    auditLogService,
  } as Game1DrawEngineServiceOptions);

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog: auditLogService,
    walletAdapter: makeStubWalletAdapter(),
  } as Game1MiniGameOrchestratorOptions);

  // Smoke: API skal eksistere og godta orchestrator.
  assert.equal(
    typeof drawEngine.setMiniGameOrchestrator,
    "function",
    "setMiniGameOrchestrator må være eksportert på public API",
  );
  drawEngine.setMiniGameOrchestrator(orchestrator);
  // Ingen exception = pass.
});

test("BIN-690 M1 wire-up: miniGameOrchestrator kan passes via options", () => {
  const pool = makeStubPool();
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());
  const ticketPurchaseService = makeStubTicketPurchaseService();

  const orchestrator = new Game1MiniGameOrchestrator({
    pool,
    auditLog: auditLogService,
    walletAdapter: makeStubWalletAdapter(),
  } as Game1MiniGameOrchestratorOptions);

  const drawEngine = new Game1DrawEngineService({
    pool,
    ticketPurchaseService,
    auditLogService,
    miniGameOrchestrator: orchestrator,
  } as Game1DrawEngineServiceOptions);

  // Smoke: ingen exception fra constructor = pass.
  assert.ok(drawEngine);
});
