/**
 * K1-D wireframe-paritet for SettlementBreakdownModal-headeren (16.25/17.10):
 *   1. Admin kan endre business_date ved edit (validert YYYY-MM-DD).
 *   2. Settlement-respons kan beriges med hallName + agentDisplayName så
 *      modal-headeren viser navn istedenfor IDs ("Hall: Game of Hall" /
 *      "Agent Name: Nsongka Thomas").
 *   3. Resolve-helperne håndterer manglende hall/user gracefully (faller
 *      tilbake til ID).
 *
 * Bruker InMemoryAgentSettlementStore for isolasjon. Felles seed-flyt
 * gjenbrukes fra AgentSettlementService.test.ts via lokal makeSetup.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentSettlementService,
} from "../AgentSettlementService.js";
import { AgentService } from "../AgentService.js";
import { AgentShiftService } from "../AgentShiftService.js";
import { AgentTransactionService } from "../AgentTransactionService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import { InMemoryAgentTransactionStore } from "../AgentTransactionStore.js";
import { InMemoryAgentSettlementStore } from "../AgentSettlementStore.js";
import { InMemoryHallCashLedger } from "../HallCashLedger.js";
import { InMemoryPhysicalTicketReadPort } from "../ports/PhysicalTicketReadPort.js";
import { NotImplementedTicketPurchasePort } from "../ports/TicketPurchasePort.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import type { AppUser, HallDefinition } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface TestCtx {
  service: AgentSettlementService;
  txService: AgentTransactionService;
  store: InMemoryAgentStore;
  settlements: InMemoryAgentSettlementStore;
  hallCash: InMemoryHallCashLedger;
  /** Tillat tester å midlertidig fjerne en hall (for fallback-testen). */
  unregisterHall(hallId: string): void;
  /** Tillat tester å midlertidig fjerne en bruker (for fallback-testen). */
  unregisterUser(userId: string): void;
  seedAgent(id: string, hallId: string, displayName?: string): Promise<{ shiftId: string }>;
}

function makeSetup(): TestCtx {
  const store = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const settlements = new InMemoryAgentSettlementStore();
  const hallCash = new InMemoryHallCashLedger();
  const wallet = new InMemoryWalletAdapter(0);
  const physicalRead = new InMemoryPhysicalTicketReadPort();

  const usersById = new Map<string, AppUser>();
  const hallsById = new Map<string, HallDefinition>();

  const stubPlatform = {
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async getUserFromAccessToken(): Promise<AppUser> {
      throw new Error("not used");
    },
    async createAdminProvisionedUser(): Promise<AppUser> {
      throw new Error("not used");
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(): Promise<boolean> { return false; },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
    async getHall(hallId: string): Promise<HallDefinition> {
      const h = hallsById.get(hallId);
      if (!h) throw new DomainError("HALL_NOT_FOUND", "not found");
      return h;
    },
  };

  const physicalMark = {
    async markSold(input: { uniqueId: string; soldBy: string }) {
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const txService = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    physicalTicketService: physicalMark as any,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: new NotImplementedTicketPurchasePort(),
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txStore,
  });
  const service = new AgentSettlementService({
    platformService,
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txStore,
    settlementStore: settlements,
    hallCashLedger: hallCash,
  });

  return {
    service, txService, store, settlements, hallCash,
    unregisterHall(hallId: string) { hallsById.delete(hallId); },
    unregisterUser(userId: string) { usersById.delete(userId); },
    async seedAgent(id, hallId, displayName) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: displayName ?? id });
      await wallet.ensureAccount(`wallet-${id}`);
      usersById.set(id, {
        id,
        email: `${id}@x.no`,
        displayName: displayName ?? id,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      });
      hallsById.set(hallId, {
        id: hallId, slug: hallId, name: `Hall ${hallId.toUpperCase()}`, region: "NO",
        address: "", isActive: true, clientVariant: "web",
        tvToken: `tv-${hallId}`, createdAt: "", updatedAt: "",
      });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      hallCash.seedHallBalance(hallId, 0, 0);
      return { shiftId: shift.id };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// businessDate edit (admin-only via editSettlement)
// ═══════════════════════════════════════════════════════════════════════════

test("K1-D editSettlement: admin kan korrigere businessDate", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  const originalDate = settlement.businessDate;
  const targetDate = "2026-04-25";
  // Sanity: at vi faktisk endrer dato (ikke samme som original)
  assert.notEqual(originalDate, targetDate);
  const edited = await ctx.service.editSettlement({
    settlementId: settlement.id,
    editedByUserId: "admin-1",
    editorRole: "ADMIN",
    reason: "Agent close-day-et med feil dato (rett etter midnatt for forrige drifts-dag).",
    patch: { businessDate: targetDate },
  });
  assert.equal(edited.businessDate, targetDate);
  assert.equal(edited.editReason, "Agent close-day-et med feil dato (rett etter midnatt for forrige drifts-dag).");
  assert.equal(edited.editedByUserId, "admin-1");
});

test("K1-D editSettlement: avviser ugyldig businessDate-format", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.editSettlement({
      settlementId: settlement.id,
      editedByUserId: "admin-1",
      editorRole: "ADMIN",
      reason: "test",
      patch: { businessDate: "26/04/2026" }, // feil format
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("K1-D editSettlement: avviser ugyldig dato (2026-13-45)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.editSettlement({
      settlementId: settlement.id,
      editedByUserId: "admin-1",
      editorRole: "ADMIN",
      reason: "test",
      patch: { businessDate: "2026-13-45" },
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("K1-D editSettlement: businessDate ignoreres når ikke i patch (idempotent)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  const originalDate = settlement.businessDate;
  const edited = await ctx.service.editSettlement({
    settlementId: settlement.id,
    editedByUserId: "admin-1",
    editorRole: "ADMIN",
    reason: "kun note-endring",
    patch: { settlementNote: "ny note" },
  });
  // BusinessDate uendret når ikke i patch
  assert.equal(edited.businessDate, originalDate);
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveDisplayNames + resolveDisplayNamesBatch
// ═══════════════════════════════════════════════════════════════════════════

test("K1-D resolveDisplayNames: returnerer hallName + agentDisplayName fra platform", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a", "Nsongka Thomas");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  const enriched = await ctx.service.resolveDisplayNames(settlement);
  assert.equal(enriched.hallName, "Hall HALL-A");
  assert.equal(enriched.agentDisplayName, "Nsongka Thomas");
  // Originale felt fortsatt med
  assert.equal(enriched.id, settlement.id);
  assert.equal(enriched.hallId, "hall-a");
  assert.equal(enriched.agentUserId, "a1");
});

test("K1-D resolveDisplayNames: faller tilbake til ID når hall ikke finnes (best-effort)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a", "Nsongka Thomas");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  ctx.unregisterHall("hall-a");
  const enriched = await ctx.service.resolveDisplayNames(settlement);
  assert.equal(enriched.hallName, "hall-a"); // fallback til ID
  assert.equal(enriched.agentDisplayName, "Nsongka Thomas"); // user fortsatt registrert
});

test("K1-D resolveDisplayNames: faller tilbake til ID når user ikke finnes", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a", "Nsongka Thomas");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  ctx.unregisterUser("a1");
  const enriched = await ctx.service.resolveDisplayNames(settlement);
  assert.equal(enriched.hallName, "Hall HALL-A");
  assert.equal(enriched.agentDisplayName, "a1"); // fallback til ID
});

test("K1-D resolveDisplayNamesBatch: beriker alle settlements parallelt", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a", "Agent One");
  await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await ctx.seedAgent("a2", "hall-b", "Agent Two");
  await ctx.service.closeDay({
    agentUserId: "a2", agentRole: "AGENT", reportedCashCount: 0,
  });
  const list = await ctx.service.listSettlements({ limit: 10 });
  const enriched = await ctx.service.resolveDisplayNamesBatch(list);
  assert.equal(enriched.length, 2);
  // Begge har resolved navn
  for (const e of enriched) {
    assert.match(e.hallName, /^Hall HALL-[AB]$/);
    assert.match(e.agentDisplayName, /^Agent (One|Two)$/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Persist + read-back: alle K1-B felt + K1-D businessDate edit-roundtrip
// ═══════════════════════════════════════════════════════════════════════════

test("K1-D roundtrip: alle wireframe-felter persisteres og leses tilbake", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a", "Test Agent");
  const breakdown = {
    rows: {
      metronia: { in_cents: 481000, out_cents: 174800 },
      ok_bingo: { in_cents: 362000, out_cents: 162500 },
      franco: { in_cents: 477000, out_cents: 184800 },
      otium: { in_cents: 100000, out_cents: 50000 },
      norsk_tipping_dag: { in_cents: 5000, out_cents: 0 },
      norsk_tipping_totall: { in_cents: 0, out_cents: 0 },
      rikstoto_dag: { in_cents: 3000, out_cents: 0 },
      rikstoto_totall: { in_cents: 0, out_cents: 0 },
      rekvisita: { in_cents: 2500, out_cents: 0 },
      servering: { in_cents: 26000, out_cents: 0 },
      bilag: { in_cents: 0, out_cents: 0 },
      bank: { in_cents: 81400, out_cents: 81400 },
      gevinst_overfoering_bank: { in_cents: 0, out_cents: 5000 },
      annet: { in_cents: 1000, out_cents: 500 },
    },
    kasse_start_skift_cents: 1_000_000,
    ending_opptall_kassie_cents: 1_661_300,
    innskudd_drop_safe_cents: 100_000,
    paafyll_ut_kasse_cents: 561_300,
    totalt_dropsafe_paafyll_cents: 661_300,
    difference_in_shifts_cents: 1_100,
  };
  const receipt = {
    mime: "application/pdf" as const,
    filename: "bilag-2026-04-26.pdf",
    dataUrl: "data:application/pdf;base64,JVBERi0=",
    sizeBytes: 1024,
    uploadedAt: "2026-04-26T20:00:00.000Z",
    uploadedByUserId: "a1",
  };
  // Skiftet har dailyBalance=0 (ingen tx i denne testen), så reportedCashCount=0
  // for å unngå ADMIN_FORCE_REQUIRED på 100% diff. Test fokuserer på
  // breakdown/bilag/note-persistering, ikke shift-aggregeringen.
  const created = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
    settlementToDropSafe: 1000,
    withdrawFromTotalBalance: 5613,
    totalDropSafe: 6613,
    settlementNote: "Vekselkasse +6 etter dagens drift",
    machineBreakdown: breakdown,
    bilagReceipt: receipt,
  });

  // Read back via store
  const reloaded = await ctx.service.getSettlementById(created.id);
  // Maskin-rader
  assert.equal(reloaded.machineBreakdown.rows.metronia?.in_cents, 481000);
  assert.equal(reloaded.machineBreakdown.rows.ok_bingo?.out_cents, 162500);
  assert.equal(reloaded.machineBreakdown.rows.gevinst_overfoering_bank?.out_cents, 5000);
  assert.equal(reloaded.machineBreakdown.rows.annet?.in_cents, 1000);
  // Shift-delta
  assert.equal(reloaded.machineBreakdown.kasse_start_skift_cents, 1_000_000);
  assert.equal(reloaded.machineBreakdown.ending_opptall_kassie_cents, 1_661_300);
  assert.equal(reloaded.machineBreakdown.innskudd_drop_safe_cents, 100_000);
  assert.equal(reloaded.machineBreakdown.paafyll_ut_kasse_cents, 561_300);
  assert.equal(reloaded.machineBreakdown.totalt_dropsafe_paafyll_cents, 661_300);
  assert.equal(reloaded.machineBreakdown.difference_in_shifts_cents, 1_100);
  // Bilag
  assert.equal(reloaded.bilagReceipt?.filename, "bilag-2026-04-26.pdf");
  assert.equal(reloaded.bilagReceipt?.sizeBytes, 1024);
  // Notice
  assert.equal(reloaded.settlementNote, "Vekselkasse +6 etter dagens drift");
  // Drop-safe-felter
  assert.equal(reloaded.settlementToDropSafe, 1000);
  assert.equal(reloaded.withdrawFromTotalBalance, 5613);
  assert.equal(reloaded.totalDropSafe, 6613);

  // Admin-edit roundtrip av businessDate + breakdown-modifikasjon
  const edited = await ctx.service.editSettlement({
    settlementId: created.id,
    editedByUserId: "admin-1",
    editorRole: "ADMIN",
    reason: "Korrigerer dato + Metronia-tall etter avstemning med regnskap",
    patch: {
      businessDate: "2026-04-25",
      machineBreakdown: {
        ...breakdown,
        rows: {
          ...breakdown.rows,
          metronia: { in_cents: 500000, out_cents: 180000 }, // korrigert
        },
      },
    },
  });
  assert.equal(edited.businessDate, "2026-04-25");
  assert.equal(edited.machineBreakdown.rows.metronia?.in_cents, 500000);
  assert.equal(edited.machineBreakdown.rows.metronia?.out_cents, 180000);
  // Andre rader uendret
  assert.equal(edited.machineBreakdown.rows.ok_bingo?.in_cents, 362000);
  assert.ok(edited.editedAt);
  assert.equal(edited.editedByUserId, "admin-1");
});
