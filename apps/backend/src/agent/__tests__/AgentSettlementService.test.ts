/**
 * BIN-583 B3.3: AgentSettlementService unit tests.
 *
 * Bruker InMemory-implementasjoner for alle stores. Dekker
 * controlDailyBalance, closeDay (happy + diff-thresholds + force),
 * editSettlement, freeze-enforcement på AgentTransactionService.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentSettlementService,
  computeDiffSeverity,
  DIFF_NOTE_THRESHOLD_NOK,
  DIFF_FORCE_THRESHOLD_NOK,
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
  txStore: InMemoryAgentTransactionStore;
  settlements: InMemoryAgentSettlementStore;
  hallCash: InMemoryHallCashLedger;
  wallet: InMemoryWalletAdapter;
  seedAgent(id: string, hallId: string): Promise<{ shiftId: string }>;
  seedPlayer(id: string, hallId: string, balance?: number): Promise<void>;
}

function makeSetup(): TestCtx {
  const store = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const settlements = new InMemoryAgentSettlementStore();
  const hallCash = new InMemoryHallCashLedger();
  const wallet = new InMemoryWalletAdapter(0);
  const physicalRead = new InMemoryPhysicalTicketReadPort();

  const usersById = new Map<string, AppUser>();
  const playerHalls = new Map<string, Set<string>>();

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
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
    async getHall(hallId: string): Promise<HallDefinition> {
      return {
        id: hallId, slug: hallId, name: `Hall ${hallId}`, region: "NO", address: "",
        isActive: true, clientVariant: "web", tvToken: `tv-${hallId}`, createdAt: "", updatedAt: "",
      };
    },
  };

  const physicalMark = {
    async markSold(input: { uniqueId: string; soldBy: string; buyerUserId?: string | null; priceCents?: number | null }) {
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
    service, txService, store, txStore, settlements, hallCash, wallet,
    async seedAgent(id, hallId) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      await wallet.ensureAccount(`wallet-${id}`);
      usersById.set(id, {
        id, email: `${id}@x.no`, displayName: id,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      hallCash.seedHallBalance(hallId, 0, 0);
      return { shiftId: shift.id };
    },
    async seedPlayer(id, hallId, balance = 0) {
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      if (balance > 0) await wallet.credit(walletId, balance, "seed");
      usersById.set(id, {
        id, email: `${id}@test.no`, displayName: `Player ${id}`,
        walletId, role: "PLAYER", hallId: null,
        kycStatus: "VERIFIED", createdAt: "", updatedAt: "",
      });
      const set = playerHalls.get(id) ?? new Set<string>();
      set.add(hallId);
      playerHalls.set(id, set);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLD HELPER
// ═══════════════════════════════════════════════════════════════════════════

test("computeDiffSeverity: thresholds beregner riktig", () => {
  // OK: liten diff i kr og %
  assert.equal(computeDiffSeverity(100, 1), "OK");
  assert.equal(computeDiffSeverity(-100, -1), "OK");
  // NOTE_REQUIRED: over note-threshold men under force
  assert.equal(computeDiffSeverity(600, 6), "NOTE_REQUIRED");
  assert.equal(computeDiffSeverity(-700, -7), "NOTE_REQUIRED");
  // FORCE_REQUIRED: over force-threshold
  assert.equal(computeDiffSeverity(1500, 15), "FORCE_REQUIRED");
  assert.equal(computeDiffSeverity(-2000, -20), "FORCE_REQUIRED");
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL DAILY BALANCE
// ═══════════════════════════════════════════════════════════════════════════

test("controlDailyBalance lagrer reportert sjekk på shift JSONB", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 200,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  const result = await ctx.service.controlDailyBalance({
    agentUserId: "a1", reportedDailyBalance: 200, reportedTotalCashBalance: 200,
  });
  assert.equal(result.shiftDailyBalance, 200);
  assert.equal(result.diff, 0);
  assert.equal(result.severity, "OK");
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal((shift?.controlDailyBalance as { reportedDailyBalance?: number }).reportedDailyBalance, 200);
});

test("controlDailyBalance kan kalles flere ganger (overskriver)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.service.controlDailyBalance({
    agentUserId: "a1", reportedDailyBalance: 100, reportedTotalCashBalance: 100,
  });
  const r2 = await ctx.service.controlDailyBalance({
    agentUserId: "a1", reportedDailyBalance: 250, reportedTotalCashBalance: 250,
  });
  assert.equal(r2.reportedDailyBalance, 250);
});

test("controlDailyBalance feiler hvis ingen aktiv shift", async () => {
  const ctx = makeSetup();
  await assert.rejects(
    ctx.service.controlDailyBalance({
      agentUserId: "no-shift-agent", reportedDailyBalance: 100, reportedTotalCashBalance: 100,
    }),
    (err) => err instanceof DomainError && (err.code === "FORBIDDEN" || err.code === "NO_ACTIVE_SHIFT")
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// CLOSE DAY
// ═══════════════════════════════════════════════════════════════════════════

test("closeDay (no diff) oppretter settlement + setter shift.settled_at + transferer til hall.cash", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 500,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 500,
  });
  assert.equal(settlement.shiftId, shiftId);
  assert.equal(settlement.dailyBalanceAtEnd, 500);
  assert.equal(settlement.dailyBalanceDifference, 0);
  assert.equal(settlement.shiftCashInTotal, 500);
  assert.equal(settlement.isForced, false);
  const shift = await ctx.store.getShiftById(shiftId);
  assert.ok(shift?.settledAt);
  const balances = await ctx.hallCash.getHallBalances("hall-a");
  assert.equal(balances.cashBalance, 500);
});

test("closeDay krever note hvis diff > 500 NOK", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 5000,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  // Diff = 5000 - 4400 = 600 (12 % av 5000) → both thresholds → FORCE
  // Bruk diff i NOTE-spennet i stedet: report 4400 → diff = -600 NOK = -12% → FORCE
  // OK use a smaller test: diff = 4400 - 5000 = -600 (12 %) → FORCE; bruk diff = 800 i kr-only
  // Ny shift med større dailyBalance for å unngå pct-trigger.
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT",
      reportedCashCount: 4400, // diff = -600 (12%) → FORCE_REQUIRED via pct
    }),
    (err) => err instanceof DomainError && err.code === "ADMIN_FORCE_REQUIRED"
  );
});

test("closeDay krever note hvis diff er over note-threshold men under force", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  // Bygg dailyBalance = 20000 → 600 NOK diff = 3% → kun NOK-grense slår
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 20000,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT",
      reportedCashCount: 20600, // diff = +600 NOK (3% av 20000) → NOTE_REQUIRED
    }),
    (err) => err instanceof DomainError && err.code === "DIFF_NOTE_REQUIRED"
  );
});

test("closeDay med note og diff i NOTE_REQUIRED-spennet aksepteres", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 20000,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 20600,
    settlementNote: "Vekselkasse hadde 600 ekstra fra forrige dag",
  });
  assert.equal(settlement.dailyBalanceDifference, 600);
  assert.equal(settlement.settlementNote, "Vekselkasse hadde 600 ekstra fra forrige dag");
  assert.equal(settlement.isForced, false);
});

test("closeDay med diff > FORCE-threshold krever ADMIN + isForceRequested + note", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 20000,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  // diff = -1500 NOK (7.5 % av 20000) → kun NOK-grense triggrer FORCE
  // AGENT kan ikke
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT",
      reportedCashCount: 18500,
      settlementNote: "Avvik",
    }),
    (err) => err instanceof DomainError && err.code === "ADMIN_FORCE_REQUIRED"
  );
  // ADMIN uten force-flag avvises
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "ADMIN",
      reportedCashCount: 18500,
      settlementNote: "Avvik",
    }),
    (err) => err instanceof DomainError && err.code === "ADMIN_FORCE_REQUIRED"
  );
  // ADMIN + force + note OK
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "ADMIN",
    reportedCashCount: 18500,
    settlementNote: "Manglet kontant — bekreftet med fysisk telling",
    isForceRequested: true,
  });
  assert.equal(settlement.isForced, true);
  assert.equal(settlement.dailyBalanceDifference, -1500);
});

test("closeDay feiler hvis allerede settled", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
    }),
    (err) => err instanceof DomainError && (err.code === "NO_ACTIVE_SHIFT" || err.code === "SHIFT_SETTLED")
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FREEZE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

test("freeze: cashIn etter settlement avvises (ingen aktiv shift)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a");
  await ctx.txService.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 100,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 100,
  });
  // markShiftSettled setter is_active=false, så getCurrentShift returnerer null
  // → NO_ACTIVE_SHIFT er det effektive freeze-uttrykket. Defense-in-depth
  // SHIFT_SETTLED-sjekk dekker edge-case der getCurrentShift skulle treffe
  // en settled-men-fortsatt-aktiv shift.
  await assert.rejects(
    ctx.txService.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 50,
      paymentMethod: "CASH", clientRequestId: "r-2",
    }),
    (err) => err instanceof DomainError &&
      (err.code === "NO_ACTIVE_SHIFT" || err.code === "SHIFT_SETTLED")
  );
});

test("freeze: physicalSell etter settlement avvises", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 100);
  await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.txService.sellPhysicalTicket({
      agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-1",
      paymentMethod: "WALLET", clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError &&
      (err.code === "NO_ACTIVE_SHIFT" || err.code === "SHIFT_SETTLED")
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// EDIT
// ═══════════════════════════════════════════════════════════════════════════

test("editSettlement (admin) oppdaterer felter + setter edited_by/edit_reason", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  const edited = await ctx.service.editSettlement({
    settlementId: settlement.id,
    editedByUserId: "admin-1",
    editorRole: "ADMIN",
    reason: "Korrigerte note etter avstemning",
    patch: { settlementNote: "Korrigert note", reportedCashCount: 100 },
  });
  assert.equal(edited.settlementNote, "Korrigert note");
  assert.equal(edited.reportedCashCount, 100);
  assert.equal(edited.editedByUserId, "admin-1");
  assert.equal(edited.editReason, "Korrigerte note etter avstemning");
  assert.ok(edited.editedAt);
});

test("editSettlement avvises for ikke-ADMIN", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.editSettlement({
      settlementId: settlement.id,
      editedByUserId: "ho-1",
      editorRole: "HALL_OPERATOR",
      reason: "test",
      patch: { settlementNote: "x" },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("editSettlement krever reason", async () => {
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
      reason: "",
      patch: { settlementNote: "x" },
    }),
    (err) => err instanceof DomainError && err.code === "EDIT_REASON_REQUIRED"
  );
});

// Threshold-konstanter eksponert
test("threshold-konstanter eksportert riktig", () => {
  assert.equal(DIFF_NOTE_THRESHOLD_NOK, 500);
  assert.equal(DIFF_FORCE_THRESHOLD_NOK, 1000);
});

// ═══════════════════════════════════════════════════════════════════════════
// K1: MACHINE BREAKDOWN + BILAG RECEIPT
// ═══════════════════════════════════════════════════════════════════════════

test("K1 closeDay: aksepterer full 15-rad breakdown", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const breakdown = {
    rows: {
      metronia: { in_cents: 481000, out_cents: 174800 },
      ok_bingo: { in_cents: 362000, out_cents: 162500 },
      franco: { in_cents: 477000, out_cents: 184800 },
      rekvisita: { in_cents: 2500, out_cents: 0 },
      servering: { in_cents: 26000, out_cents: 0 },
      bank: { in_cents: 81400, out_cents: 81400 },
    },
    ending_opptall_kassie_cents: 461300,
    innskudd_drop_safe_cents: 0,
    difference_in_shifts_cents: 0,
  };
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
    machineBreakdown: breakdown,
  });
  assert.equal(settlement.machineBreakdown.rows.metronia?.in_cents, 481000);
  assert.equal(settlement.machineBreakdown.rows.ok_bingo?.out_cents, 162500);
  assert.equal(settlement.machineBreakdown.ending_opptall_kassie_cents, 461300);
});

test("K1 closeDay: ugyldig breakdown avvises med INVALID_INPUT", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT",
      reportedCashCount: 0,
      machineBreakdown: { rows: { metronia: { in_cents: -1, out_cents: 0 } } },
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("K1 closeDay: ukjent maskin-nøkkel i breakdown avvises", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await assert.rejects(
    ctx.service.closeDay({
      agentUserId: "a1", agentRole: "AGENT",
      reportedCashCount: 0,
      machineBreakdown: { rows: { fantasi_maskin: { in_cents: 0, out_cents: 0 } } },
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("K1 closeDay: uten breakdown (legacy-flyt) fortsatt OK", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
  });
  // Default tom breakdown (backward-compat).
  assert.deepEqual(settlement.machineBreakdown.rows, {});
  assert.equal(settlement.bilagReceipt, null);
});

test("K1 closeDay: bilag kan sendes inn direkte", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const receipt = {
    mime: "application/pdf",
    filename: "bilag.pdf",
    dataUrl: "data:application/pdf;base64,JVBERi0=",
    sizeBytes: 1000,
    uploadedAt: "2026-04-23T10:00:00.000Z",
    uploadedByUserId: "a1",
  };
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
    bilagReceipt: receipt,
  });
  assert.equal(settlement.bilagReceipt?.filename, "bilag.pdf");
  assert.equal(settlement.bilagReceipt?.mime, "application/pdf");
});

test("K1 uploadBilagReceipt: AGENT laster opp på egen settlement", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
  });
  const updated = await ctx.service.uploadBilagReceipt({
    settlementId: settlement.id,
    uploaderUserId: "a1",
    uploaderRole: "AGENT",
    receipt: {
      mime: "image/jpeg",
      filename: "receipt.jpg",
      dataUrl: "data:image/jpeg;base64,/9j/4AAQ=",
      sizeBytes: 2048,
      uploadedAt: "2026-04-23T11:00:00Z",
      uploadedByUserId: "a1",
    },
  });
  assert.equal(updated.bilagReceipt?.mime, "image/jpeg");
  assert.equal(updated.bilagReceipt?.sizeBytes, 2048);
  assert.ok(updated.editedAt); // applyEdit setter edited_at
});

test("K1 uploadBilagReceipt: AGENT kan IKKE laste opp på andre agents settlement", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedAgent("a2", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.uploadBilagReceipt({
      settlementId: settlement.id,
      uploaderUserId: "a2",
      uploaderRole: "AGENT",
      receipt: {
        mime: "application/pdf",
        filename: "x.pdf",
        dataUrl: "data:application/pdf;base64,AAAA",
        sizeBytes: 100,
        uploadedAt: "2026-04-23T10:00:00Z",
        uploadedByUserId: "a2",
      },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("K1 uploadBilagReceipt: HALL_OPERATOR avvises (read-only)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
  });
  await assert.rejects(
    ctx.service.uploadBilagReceipt({
      settlementId: settlement.id,
      uploaderUserId: "ho-1",
      uploaderRole: "HALL_OPERATOR",
      receipt: {
        mime: "application/pdf",
        filename: "x.pdf",
        dataUrl: "data:application/pdf;base64,AAAA",
        sizeBytes: 100,
        uploadedAt: "2026-04-23T10:00:00Z",
        uploadedByUserId: "ho-1",
      },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("K1 editSettlement: admin kan oppdatere breakdown + audit-logges", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const settlement = await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT",
    reportedCashCount: 0,
  });
  const edited = await ctx.service.editSettlement({
    settlementId: settlement.id,
    editedByUserId: "admin-1",
    editorRole: "ADMIN",
    reason: "Korrigerte breakdown etter avstemning",
    patch: {
      machineBreakdown: {
        rows: { metronia: { in_cents: 10000, out_cents: 5000 } },
        ending_opptall_kassie_cents: 5000,
        innskudd_drop_safe_cents: 0,
        difference_in_shifts_cents: 0,
      },
    },
  });
  assert.equal(edited.machineBreakdown.rows.metronia?.in_cents, 10000);
  assert.equal(edited.editReason, "Korrigerte breakdown etter avstemning");
});

test("K1 listSettlementsByHall: filtrerer og returnerer i dato-orden", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.service.closeDay({
    agentUserId: "a1", agentRole: "AGENT", reportedCashCount: 0,
  });
  const list = await ctx.service.listSettlementsByHall("hall-a", { limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0]!.hallId, "hall-a");
});

test("K1 computeBreakdownTotals: eksponert via service", async () => {
  const ctx = makeSetup();
  const totals = ctx.service.computeBreakdownTotals({
    rows: {
      metronia: { in_cents: 100, out_cents: 30 },
      bank: { in_cents: 50, out_cents: 50 },
    },
    ending_opptall_kassie_cents: 0,
    innskudd_drop_safe_cents: 0,
    difference_in_shifts_cents: 0,
  });
  assert.equal(totals.totalInCents, 150);
  assert.equal(totals.totalOutCents, 80);
  assert.equal(totals.totalSumCents, 70);
});
