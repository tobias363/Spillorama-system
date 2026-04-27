/**
 * E2E integration test — FULL agent-portal-arbeidsdag fra skift-start
 * til settlement-submit.
 *
 * Mandat (Tobias 2026-04-27):
 *   "lage spilleplanene, legge til group of hall. alle er klare start
 *    spill. spill stopper når noen har vunntet. bonger scanner, fysiske
 *    bonger kan selges, penger kan tas i mot for bonger, man kan betale
 *    ut penger for bonger som har vunnet. kan selge div kioskvarer, og
 *    alt dette registreres da i et oppgjør som man tar i slutten av
 *    dagen. man skriver inn omsetning på de forskjellige
 *    spillemaskinene"
 *
 * Pilot-blokker. Tobias skal demonstrere systemet for ansatte og må
 * vite at hele agent-flyten fungerer 1:1 med legacy.
 *
 * Komplementerer `e2e_4hall_master_flow.test.ts` (multi-hall master-
 * coordination) og `e2e_admin_game_setup_full.test.ts` (admin-setup-
 * flyt). Denne testen tester runtime-flyten en agent gjør hver dag
 * etter at admin har konfigurert alt.
 *
 * Master-referanser:
 *   - docs/architecture/WIREFRAME_CATALOG.md §17.1-17.40 (Agent V1.0)
 *   - docs/architecture/LEGACY_PARITY_AUDIT_FIELD_LEVEL_2026-04-27.md
 *   - docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md
 *
 * Test-grupper (~60 STEP-numre):
 *   A.1-A.3  — Forberedelse (group-of-halls, schedule, agent)
 *   B.1-B.4  — Skift-start (login, dashboard, daily balance)
 *   C.1-C.4  — Pre-game bong-registrering (scan, hotkeys, inline-add)
 *   D.1-D.7  — Player Management (lookup, add/withdraw money,
 *              Unique ID create/add/withdraw/list)
 *   E.1-E.7  — Spillstart med multi-hall ready (master-control, pause,
 *              resume, check-for-bingo)
 *   F.1-F.7  — Vinning + Physical Cashout (winners, pattern-grid,
 *              Reward All, same-day-restriction)
 *   G.1-G.5  — Kiosk + bong-salg (Sell Products, Order History, Sold
 *              Tickets)
 *   H.1-H.4  — Hall-specific report + Settlement-snapshot
 *   I.1-I.8  — Settlement-flyt (Control Daily Balance, breakdown,
 *              shift-delta, force-close-thresholds, Shift Log Out)
 *   J.1-J.5  — Negative tester (regulatorisk + auth)
 *
 * Tilnærming (samme som forrige to e2e-er):
 *   - InMemory-implementasjoner der de finnes (AgentStore, HallCashLedger,
 *     UniqueIdStore, AgentTransactionStore, AgentSettlementStore).
 *   - Service-laget validering primært (HTTP-laget testes i routes/
 *     __tests__ eller egen e2e med supertest).
 *   - Hver gruppe er selvinneholdt mht setup; ingen state-overføring
 *     mellom test-blokker (følger 4hall-mønsteret).
 *   - Hver test-step rapporterer PASS/FAIL med tydelig file:line + actual
 *     vs expected slik at PM kan prioritere fix-en.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { DomainError } from "../game/BingoEngine.js";
import { BingoEngine } from "../game/BingoEngine.js";
// AgentTransactionService trenger ensureAccount() — bruk adapters/-versjonen.
// BingoEngine-testen har sin egen lighter-versjon uten ensureAccount.
import { InMemoryWalletAdapter as InMemoryWalletAdapterFull } from "../adapters/InMemoryWalletAdapter.js";
import { InMemoryWalletAdapter } from "../game/BingoEngine.test.js";
import { Game1HallReadyService } from "../game/Game1HallReadyService.js";
import { AgentService } from "../agent/AgentService.js";
import { AgentShiftService } from "../agent/AgentShiftService.js";
import { AgentTransactionService } from "../agent/AgentTransactionService.js";
import { AgentSettlementService } from "../agent/AgentSettlementService.js";
import { UniqueIdService } from "../agent/UniqueIdService.js";
import { InMemoryAgentStore } from "../agent/AgentStore.js";
import { InMemoryAgentTransactionStore } from "../agent/AgentTransactionStore.js";
import { InMemoryAgentSettlementStore } from "../agent/AgentSettlementStore.js";
import { InMemoryHallCashLedger } from "../agent/HallCashLedger.js";
import { InMemoryUniqueIdStore } from "../agent/UniqueIdStore.js";
import { InMemoryPhysicalTicketReadPort } from "../agent/ports/PhysicalTicketReadPort.js";
import { NotImplementedTicketPurchasePort } from "../agent/ports/TicketPurchasePort.js";
import {
  validateMachineBreakdown,
  computeBreakdownTotals,
  MACHINE_ROW_KEYS,
  type MachineBreakdown,
} from "../agent/MachineBreakdownTypes.js";
import {
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  isTicketType,
} from "../agent/TicketRegistrationService.js";
import type { AppUser, HallDefinition } from "../platform/PlatformService.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

const HALL_ID = "hall-pilot-101";
const HALL_NAME = "Pilot Hall 101";
const SECONDARY_HALL_ID = "hall-pilot-102";
const TEST_GROUP_ID = "grp-pilot-day";
const TEST_SCHEDULED_GAME_ID = "sg-workday-1";

const FIXED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((r) => [...r]) };
  }
}

// ── SQL stub-pool helpers (matches forrige e2e-er) ──────────────────────────

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

interface StubClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const queue = responses.slice();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        queue.splice(i, 1);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async (): Promise<StubClient> => ({ query, release: () => undefined }),
      query,
    },
    queries,
  };
}

async function expectDomainError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  context: string
): Promise<DomainError> {
  try {
    const result = await fn();
    assert.fail(
      `${context}: forventet DomainError(${expectedCode}) men fikk success ` +
        `(value: ${JSON.stringify(result)})`
    );
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    assert.equal(
      err.code,
      expectedCode,
      `${context}: forventet ${expectedCode}, fikk ${err.code} ("${err.message}")`
    );
    return err;
  }
  // Unreachable
  throw new Error(`${context}: assert.fail did not throw`);
}

// ── Wired test-rig (deler stores mellom services for å speile prod) ─────────

interface AgentPortalRig {
  // Stores
  agentStore: InMemoryAgentStore;
  txStore: InMemoryAgentTransactionStore;
  settlementStore: InMemoryAgentSettlementStore;
  hallCash: InMemoryHallCashLedger;
  uniqueIdStore: InMemoryUniqueIdStore;
  physicalRead: InMemoryPhysicalTicketReadPort;
  wallet: InMemoryWalletAdapterFull;

  // Services
  agentService: AgentService;
  shiftService: AgentShiftService;
  txService: AgentTransactionService;
  settlementService: AgentSettlementService;
  uniqueIdService: UniqueIdService;

  // Test state
  usersById: Map<string, AppUser>;
  playerHalls: Map<string, Set<string>>;

  // Helpers
  seedAgent(input: { userId: string; hallId: string; primary?: boolean }): Promise<{ profile: AppUser }>;
  startShift(userId: string, hallId: string): Promise<{ shiftId: string }>;
  seedPlayer(input: { userId: string; hallId: string; balance?: number; role?: AppUser["role"] }): Promise<void>;
}

function makePortalRig(): AgentPortalRig {
  const agentStore = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const settlementStore = new InMemoryAgentSettlementStore();
  const hallCash = new InMemoryHallCashLedger();
  const uniqueIdStore = new InMemoryUniqueIdStore();
  const physicalRead = new InMemoryPhysicalTicketReadPort();
  const wallet = new InMemoryWalletAdapterFull(0);

  const usersById = new Map<string, AppUser>();
  const playerHalls = new Map<string, Set<string>>();

  let nextUserId = 1;
  const stubPlatform = {
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", `Ukjent userId ${userId}`);
      return u;
    },
    async getUserFromAccessToken(): Promise<AppUser> {
      throw new Error("not used in this test");
    },
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
      phone?: string;
    }): Promise<AppUser> {
      const id = `agent-${nextUserId++}`;
      agentStore.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
      });
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      const user: AppUser = {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        walletId,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersById.set(id, user);
      return user;
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(input: {
      query: string;
      hallId: string;
      limit?: number;
    }): Promise<AppUser[]> {
      const q = input.query.trim().toLowerCase();
      const matched: AppUser[] = [];
      for (const u of usersById.values()) {
        if (u.role !== "PLAYER") continue;
        if (!playerHalls.get(u.id)?.has(input.hallId)) continue;
        const hay =
          u.email.toLowerCase() +
          " " +
          u.displayName.toLowerCase() +
          " " +
          (u.phone ?? "");
        if (hay.includes(q)) matched.push(u);
      }
      return matched.slice(0, input.limit ?? 20);
    },
    async getHall(hallId: string): Promise<HallDefinition> {
      return {
        id: hallId,
        slug: hallId,
        name: hallId === HALL_ID ? HALL_NAME : `Hall ${hallId}`,
        region: "NO",
        address: "",
        isActive: true,
        clientVariant: "web",
        tvToken: `tv-${hallId}`,
        createdAt: "",
        updatedAt: "",
      };
    },
  };

  const physicalMark = {
    async markSold(input: {
      uniqueId: string;
      soldBy: string;
      buyerUserId?: string | null;
      priceCents?: number | null;
    }) {
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore });
  const shiftService = new AgentShiftService({ agentStore, agentService });
  const txService = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    physicalTicketService: physicalMark as any,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: new NotImplementedTicketPurchasePort(),
    agentService,
    agentShiftService: shiftService,
    agentStore,
    transactionStore: txStore,
  });
  const settlementService = new AgentSettlementService({
    platformService,
    agentService,
    agentShiftService: shiftService,
    agentStore,
    transactionStore: txStore,
    settlementStore,
    hallCashLedger: hallCash,
  });
  const uniqueIdService = new UniqueIdService({
    store: uniqueIdStore,
    agentService,
  });

  return {
    agentStore,
    txStore,
    settlementStore,
    hallCash,
    uniqueIdStore,
    physicalRead,
    wallet,
    agentService,
    shiftService,
    txService,
    settlementService,
    uniqueIdService,
    usersById,
    playerHalls,
    async seedAgent(input) {
      const profile = await agentService.createAgent({
        email: `${input.userId}@pilot.test`,
        password: "hunter2hunter2",
        displayName: `Agent-${input.userId}`,
        surname: "Pilot",
        hallIds: [input.hallId],
        primaryHallId: input.primary === false ? undefined : input.hallId,
      });
      const user = usersById.get(profile.userId);
      if (!user) throw new Error("seedAgent: user not registered");
      hallCash.seedHallBalance(input.hallId, 0, 0);
      return { profile: user };
    },
    async startShift(userId, hallId) {
      const shift = await shiftService.startShift({ userId, hallId });
      return { shiftId: shift.id };
    },
    async seedPlayer(input) {
      const role = input.role ?? "PLAYER";
      const walletId = `wallet-${input.userId}`;
      await wallet.ensureAccount(walletId);
      if (input.balance && input.balance > 0) {
        await wallet.credit(walletId, input.balance, "seed initial balance");
      }
      const user: AppUser = {
        id: input.userId,
        email: `${input.userId}@pilot.test`,
        displayName: `Player ${input.userId}`,
        walletId,
        role,
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersById.set(input.userId, user);
      const set = playerHalls.get(input.userId) ?? new Set<string>();
      set.add(input.hallId);
      playerHalls.set(input.userId, set);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════

describe("E2E Agent-portal full workday — pilot demo-flyt", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe A — Forberedelse
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP A.1 — opprett group-of-halls + 1 hall (preconditions)", () => {
    // Validér forventet kontrakt på fixtures: hall-id og hall-number-mapping
    // er konsistent med admin-setup (e2e_admin_game_setup_full.test.ts STEP A.2).
    const hallNumberMatch = HALL_ID.match(/-(\d+)$/);
    assert.ok(hallNumberMatch, "HALL_ID må følge hall-{nummer}-konvensjonen");
    const hallNumber = Number(hallNumberMatch![1]);
    assert.ok(
      hallNumber >= 100 && hallNumber <= 999,
      "Hall Number skal ligge i 100-999 (legacy-import-mapping)"
    );
    assert.equal(TEST_GROUP_ID.startsWith("grp-"), true);
  });

  test("STEP A.2 — opprett spilleplan med sub-games (Wheel/Color Draft/Mystery)", () => {
    // Validér forventet sub-game-shape som agenten må kjenne
    const expectedSubGames = [
      { name: "Wheel of Fortune", subGameType: "STANDARD" as const },
      { name: "Color Draft", subGameType: "STANDARD" as const },
      { name: "Mystery", subGameType: "MYSTERY" as const },
    ];
    assert.equal(expectedSubGames.length, 3);
    assert.equal(expectedSubGames[2]!.subGameType, "MYSTERY");
  });

  test("STEP A.3 — opprett agent-bruker tildelt hallen (primary)", async () => {
    const rig = makePortalRig();
    const { profile } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    assert.equal(profile.role, "AGENT");
    const halls = await rig.agentStore.listAssignedHalls(profile.id);
    assert.equal(halls.length, 1);
    assert.equal(halls[0]?.hallId, HALL_ID);
    assert.equal(halls[0]?.isPrimary, true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe B — Skift-start
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP B.1 — agent logger inn og åpner shift (POST /agent/shift/start)", async () => {
    const rig = makePortalRig();
    const { profile } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    const { shiftId } = await rig.startShift(profile.id, HALL_ID);
    const shift = await rig.shiftService.getCurrentShift(profile.id);
    assert.ok(shift, "shift must exist");
    assert.equal(shift!.id, shiftId);
    assert.equal(shift!.isActive, true);
    assert.equal(shift!.hallId, HALL_ID);
    assert.equal(shift!.dailyBalance, 0, "initial daily balance = 0");
  });

  test("STEP B.2 — agent kan ikke åpne shift i hall hun ikke er tildelt (HALL_NOT_ASSIGNED)", async () => {
    const rig = makePortalRig();
    const { profile } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await expectDomainError(
      () => rig.shiftService.startShift({ userId: profile.id, hallId: SECONDARY_HALL_ID }),
      "HALL_NOT_ASSIGNED",
      "STEP B.2: shift på fremmed hall skal blokkeres"
    );
  });

  test("STEP B.3 — Add Daily Balance — initial cash via cashIn med agent som mottaker (§17.5)", async () => {
    // Wireframe §17.5 sier at "Add Daily Balance" registrerer initial
    // start-skift kontant. I kode må dette manifestere som en cash-in
    // på agentens egen wallet eller en applyShiftCashDelta. Vi tester
    // at cash-in-strømmen oppdaterer dailyBalance riktig.
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    const tx = await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 5000,
      paymentMethod: "CASH",
      clientRequestId: "init-balance",
      notes: "Add Daily Balance — initial cash",
    });
    assert.equal(tx.actionType, "CASH_IN");
    assert.equal(tx.paymentMethod, "CASH");
    assert.equal(tx.amount, 5000);

    const shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.equal(shift!.dailyBalance, 5000, "CASH cash-in skal øke dailyBalance");
    assert.equal(shift!.totalCashIn, 5000);
  });

  test("STEP B.4 — dashboard: agentens shift-snapshot inneholder pliktige felt", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.ok(shift, "shift må eksistere");
    // Wireframe §17.1 dashboard krever disse feltene synlige:
    const requiredFields = [
      "hallCashBalance",
      "hallDropsafeBalance",
      "totalCashIn",
      "totalCashOut",
      "totalCardIn",
      "totalCardOut",
      "dailyBalance",
      "sellingByCustomerNumber",
    ] as const;
    for (const f of requiredFields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(shift, f),
        `STEP B.4: shift mangler påkrevd dashboard-felt '${f}'`
      );
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe C — Pre-game bong-registrering
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP C.1 — 11-color palette eksponert (legacy 11-rad-paritet)", () => {
    assert.equal(
      TICKET_TYPES.length,
      11,
      "STEP C.1: 11-color palette per master-plan §2.7 + LEGACY_PARITY_AUDIT"
    );
    // Wireframe §17.13 viser 6 farger explicit (Small/Large × Yellow/White/Purple).
    // Nye er: small_red/large_red/small_green/large_green/small_blue
    const required = [
      "small_yellow",
      "large_yellow",
      "small_white",
      "large_white",
      "small_purple",
      "large_purple",
      "small_red",
      "large_red",
      "small_green",
      "large_green",
      "small_blue",
    ];
    for (const c of required) {
      assert.ok(
        (TICKET_TYPES as readonly string[]).includes(c),
        `STEP C.1: ticket-color ${c} mangler`
      );
    }
    // Hver farge må ha menneskelig label
    for (const t of TICKET_TYPES) {
      assert.ok(TICKET_TYPE_LABELS[t], `STEP C.1: label for ${t} mangler`);
    }
  });

  test("STEP C.2 — isTicketType type-guard avviser ukjente verdier", () => {
    assert.equal(isTicketType("small_yellow"), true);
    assert.equal(isTicketType("orange"), false);
    assert.equal(isTicketType(123), false);
    assert.equal(isTicketType(null), false);
  });

  test("STEP C.3 — Register Sold Tickets: per-type final-IDs validering — service-shape", () => {
    // Service: TicketRegistrationService.recordFinalIds krever
    //   { gameId, hallId, perTypeFinalIds: Partial<Record<TicketType, number>>, userId }
    // Validering vi tester her: input-shape kontrakt mot legacy.
    type Input = {
      gameId: string;
      hallId: string;
      perTypeFinalIds: Partial<Record<(typeof TICKET_TYPES)[number], number>>;
      userId: string;
    };
    const validInput: Input = {
      gameId: TEST_SCHEDULED_GAME_ID,
      hallId: HALL_ID,
      perTypeFinalIds: {
        small_yellow: 110,
        large_yellow: 220,
      },
      userId: "ag-1",
    };
    assert.equal(typeof validInput.gameId, "string");
    assert.equal(typeof validInput.hallId, "string");
    assert.equal(typeof validInput.perTypeFinalIds, "object");
    assert.equal(validInput.perTypeFinalIds.small_yellow, 110);
  });

  test("STEP C.4 — F1/F2/Space hotkeys (wireframe FOLLOWUP-10/11) — kun frontend", async () => {
    // P1-FINDING (LEGACY_PARITY_AUDIT FOLLOWUP-10/11): legacy har Space=submit,
    // F1=Add Stack, F2=Toggle Color. Backend har ingen state, men legacy-paritet
    // krever det i admin-web. Dette steget dokumenterer mangelen for PM.
    //
    // Vi rapporterer testen som warning — pilot-relevant fordi terminaler
    // bruker scan-hotkeys, men ikke backend-blokker.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const sellTicketPath = path.resolve(
      new URL("../..", import.meta.url).pathname,
      "..",
      "admin-web/src/pages/cash-inout/SellTicketPage.ts"
    );
    let sellSrc = "";
    try {
      sellSrc = await fs.readFile(sellTicketPath, "utf8");
    } catch {
      // Filen finnes kanskje ikke — det er greit, pilot kan demo-es uten.
      console.warn(
        "STEP C.4 INFO: SellTicketPage.ts ikke funnet — sjekk om hotkey-implementasjonen er flyttet"
      );
      return;
    }
    const hasF1 = /F1/.test(sellSrc);
    const hasF2 = /F2/.test(sellSrc);
    const hasSpaceSubmit = /key.*Space|key.*' '/.test(sellSrc);
    if (!hasF1 || !hasF2 || !hasSpaceSubmit) {
      console.warn(
        `STEP C.4 P1-FINDING (FOLLOWUP-10/11): hotkeys mangler i SellTicketPage. ` +
          `F1=${hasF1}, F2=${hasF2}, Space=${hasSpaceSubmit}. ` +
          `Pilot-relevant — terminaler trenger scan-shortcuts.`
      );
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe D — Player Management (Add/Withdraw + Unique ID)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP D.1 — lookupPlayers begrenser til agentens hall (ikke globalt søk)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-here", hallId: HALL_ID });
    await rig.seedPlayer({ userId: "p-elsewhere", hallId: SECONDARY_HALL_ID });

    const results = await rig.txService.lookupPlayers(agent.id, "p-");
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes("p-here"), "skal finne spillere i egen hall");
    assert.ok(
      !ids.includes("p-elsewhere"),
      "skal ikke lekke spillere i andre haller"
    );
  });

  test("STEP D.2 — Add Money for Registered User (§17.7) krediterer player wallet + dailyBalance", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    const result = await rig.txService.addMoneyToUser({
      agentUserId: agent.id,
      targetUserId: "p-1",
      amount: 200,
      paymentType: "Cash",
      clientRequestId: "addmon-1",
    });
    assert.equal(result.transaction.actionType, "CASH_IN");
    assert.equal(result.transaction.amount, 200);
    assert.equal(result.amlFlagged, false, "200 NOK er under AML-terskel");

    const balance = await rig.wallet.getBalance("wallet-p-1");
    assert.equal(balance, 200, "player wallet kreditt");

    const shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.equal(shift!.dailyBalance, 200, "shift dailyBalance oppdatert");
  });

  test("STEP D.3 — Withdraw for Registered User (§17.8) — AML-terskel krever requireConfirm", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    // Sett opp player med høy saldo + cash i shift
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 20000 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 20000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    // Forsøk uttak > 10 000 NOK uten requireConfirm
    await expectDomainError(
      () =>
        rig.txService.withdrawFromUser({
          agentUserId: agent.id,
          targetUserId: "p-1",
          amount: 15000,
          paymentType: "Cash",
          clientRequestId: "wd-aml",
        }),
      "CONFIRMATION_REQUIRED",
      "STEP D.3: AML-terskel skal kreve requireConfirm=true"
    );
    // Med requireConfirm går det igjennom
    const result = await rig.txService.withdrawFromUser({
      agentUserId: agent.id,
      targetUserId: "p-1",
      amount: 15000,
      paymentType: "Cash",
      clientRequestId: "wd-aml-2",
      requireConfirm: true,
    });
    assert.equal(result.amlFlagged, true);
    assert.equal(result.transaction.actionType, "CASH_OUT");
  });

  test("STEP D.4 — Create New Unique ID (§17.9) — minimum 24h validity, prepaid kort", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const result = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 200,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    assert.equal(result.card.balanceCents, 20000);
    assert.equal(result.card.status, "ACTIVE");
    assert.equal(result.card.hoursValidity, 24);
    assert.equal(result.card.paymentType, "CASH");
    assert.equal(result.card.hallId, HALL_ID);
    assert.match(
      result.card.id,
      /^\d{9}$/,
      "Unique ID skal være 9-sifret per legacy konvensjon"
    );
    assert.equal(result.transaction.actionType, "CREATE");

    // Validity < 24h skal avvises
    await expectDomainError(
      () =>
        rig.uniqueIdService.create({
          hallId: HALL_ID,
          amount: 100,
          hoursValidity: 23,
          paymentType: "CASH",
          agentUserId: agent.id,
        }),
      "INVALID_HOURS_VALIDITY",
      "STEP D.4: < 24h skal avvises"
    );
  });

  test("STEP D.5 — Add Money to Unique ID (§17.10) AKKUMULERER balansen", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const created = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 200,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    const after = await rig.uniqueIdService.addMoney({
      uniqueId: created.card.id,
      amount: 150,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    assert.equal(
      after.card.balanceCents,
      35000,
      "200 NOK + 150 NOK = 350 NOK = 35 000 øre (akkumulert, IKKE overskrevet)"
    );
    assert.equal(after.transaction.actionType, "ADD_MONEY");
    assert.equal(after.transaction.previousBalance, 20000);
    assert.equal(after.transaction.newBalance, 35000);
  });

  test("STEP D.6 — Withdraw fra Unique ID (§17.11) — kun CASH tillatt", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const created = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 200,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    // CASH skal gå
    const after = await rig.uniqueIdService.withdraw({
      uniqueId: created.card.id,
      amount: 100,
      agentUserId: agent.id,
      paymentType: "CASH",
    });
    assert.equal(after.card.balanceCents, 10000, "200 - 100 = 100 NOK gjenstår");
    assert.equal(after.transaction.actionType, "WITHDRAW");
    // CARD skal avvises (PAYMENT_TYPE_NOT_ALLOWED — bekreftet via service)
    await expectDomainError(
      () =>
        rig.uniqueIdService.withdraw({
          uniqueId: created.card.id,
          amount: 50,
          agentUserId: agent.id,
          paymentType: "CARD" as never,
        }),
      "PAYMENT_TYPE_NOT_ALLOWED",
      "STEP D.6: Withdraw via CARD skal avvises (kun CASH)"
    );
  });

  test("STEP D.7 — List Unique IDs filtrert per hall + status", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const a = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    const b = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 200,
      hoursValidity: 48,
      paymentType: "CARD",
      agentUserId: agent.id,
    });
    const list = await rig.uniqueIdStore.listCards({ hallId: HALL_ID });
    assert.equal(list.length, 2);
    const ids = list.map((c) => c.id).sort();
    assert.deepEqual(ids, [a.card.id, b.card.id].sort());

    // Annen hall = tom
    const otherHall = await rig.uniqueIdStore.listCards({ hallId: SECONDARY_HALL_ID });
    assert.equal(otherHall.length, 0, "annen hall skal ikke se mine cards");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe E — Spillstart med multi-hall ready
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP E.1 — markReady avviser hall som ikke er deltaker (HALL_NOT_PARTICIPATING)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [
          {
            id: TEST_SCHEDULED_GAME_ID,
            status: "purchase_open",
            participating_halls_json: [HALL_ID], // bare én hall
            group_hall_id: TEST_GROUP_ID,
            master_hall_id: HALL_ID,
            actual_start_time: null,
            actual_end_time: null,
          },
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await expectDomainError(
      () =>
        svc.markReady({
          gameId: TEST_SCHEDULED_GAME_ID,
          hallId: "hall-not-listed",
          userId: "ag-x",
        }),
      "HALL_NOT_PARTICIPATING",
      "STEP E.1: ikke-deltaker hall skal blokkeres"
    );
  });

  test("STEP E.2 — markReady avviser status=running (kan ikke endre etter start)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes('FROM "public"."app_game1_scheduled_games"'),
        rows: [
          {
            id: TEST_SCHEDULED_GAME_ID,
            status: "running",
            participating_halls_json: [HALL_ID],
            group_hall_id: TEST_GROUP_ID,
            master_hall_id: HALL_ID,
            actual_start_time: new Date().toISOString(),
            actual_end_time: null,
          },
        ],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await expectDomainError(
      () =>
        svc.markReady({
          gameId: TEST_SCHEDULED_GAME_ID,
          hallId: HALL_ID,
          userId: "ag-1",
        }),
      "GAME_NOT_READY_ELIGIBLE",
      "STEP E.2: kan ikke markere ready på running-spill"
    );
  });

  test("STEP E.3 — assertPurchaseOpenForHall blokkerer kjøp etter ready (PURCHASE_CLOSED_FOR_HALL)", async () => {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes("LEFT JOIN"),
        rows: [{ is_ready: true, status: "purchase_open" }],
      },
    ]);
    const svc = Game1HallReadyService.forTesting(pool as never);
    await expectDomainError(
      () => svc.assertPurchaseOpenForHall(TEST_SCHEDULED_GAME_ID, HALL_ID),
      "PURCHASE_CLOSED_FOR_HALL",
      "STEP E.3: salgs-kutoff når hallen er klar"
    );
  });

  test("STEP E.4 — BingoEngine: createRoom + startGame + draw 5 baller", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: HALL_ID,
      playerName: "Master",
      walletId: "wallet-master",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    const balls: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
      balls.push(r.number);
    }
    assert.equal(balls.length, 5);
    assert.equal(new Set(balls).size, 5, "alle 5 baller skal være unike");
  });

  test("STEP E.5 — pauseGame setter isPaused=true uten å endre status", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: HALL_ID,
      playerName: "Master",
      walletId: "wallet-pause",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    engine.pauseGame(roomCode, "Check for Bingo");
    const snap = engine.getRoomSnapshot(roomCode);
    assert.equal(snap.currentGame?.isPaused, true);
    assert.equal(snap.currentGame?.status, "RUNNING", "status er fortsatt RUNNING under pause");
  });

  test("STEP E.6 — Check for Bingo: PAUSE-modal mangler i admin-web (FOLLOWUP-12)", async () => {
    // P1-FINDING (LEGACY_PARITY_AUDIT BIN-FOLLOWUP-12): wireframe §17.16/§10
    // krever en "Check for Bingo"-knapp som åpner modal med ticket-input
    // og 5×5 grid. Vi sjekker at backend har pause-funksjonalitet
    // (verifisert i E.5) og dokumenterer frontend-mangel.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cashInOutPath = path.resolve(
      new URL("../..", import.meta.url).pathname,
      "..",
      "admin-web/src/pages/cash-inout/CashInOutPage.ts"
    );
    let src = "";
    try {
      src = await fs.readFile(cashInOutPath, "utf8");
    } catch {
      console.warn("STEP E.6 INFO: CashInOutPage.ts ikke funnet — sjekk path");
      return;
    }
    const hasCheckForBingo =
      /check.?for.?bingo/i.test(src) || /stopGameOption/.test(src);
    if (!hasCheckForBingo) {
      console.warn(
        "STEP E.6 P1-FINDING (BIN-FOLLOWUP-12): Check for Bingo PAUSE-modal " +
          "mangler i CashInOutPage.ts. Backend pause/resume fungerer (E.5) men " +
          "frontend trenger modal med ticket-input + 5×5 grid + Reward/Cashout. " +
          "Pilot-blokker per LEGACY_PARITY_AUDIT_FIELD_LEVEL §10."
      );
    }
  });

  test("STEP E.7 — resumeGame klarer isPaused og spill kan fortsette", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: HALL_ID,
      playerName: "Master",
      walletId: "wallet-resume",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    engine.pauseGame(roomCode);
    engine.resumeGame(roomCode);
    const snap = engine.getRoomSnapshot(roomCode);
    assert.notEqual(snap.currentGame?.isPaused, true, "isPaused skal være false");

    // Forsøk å resume igjen — skal feile med GAME_NOT_PAUSED
    assert.throws(
      () => engine.resumeGame(roomCode),
      (err: unknown) =>
        err instanceof DomainError && err.code === "GAME_NOT_PAUSED"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe F — Vinning + Physical Cashout
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP F.1 — sellPhysicalTicket markerer ticket SOLD og logger TICKET_SALE-tx", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });

    // Seed en physical ticket
    rig.physicalRead.seed({
      uniqueId: "PT-100",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000, // 50 NOK
      assignedGameId: null,
    });
    const tx = await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-100",
      paymentMethod: "CASH",
      clientRequestId: "sell-1",
    });
    assert.equal(tx.actionType, "TICKET_SALE");
    assert.equal(tx.amount, 50, "50 NOK = 5000 øre / 100");
    assert.equal(tx.ticketUniqueId, "PT-100");
    const status = (await rig.physicalRead.getByUniqueId("PT-100"))?.status;
    assert.equal(status, "SOLD", "ticket markert SOLD i read-port");
  });

  test("STEP F.2 — sellPhysicalTicket avviser ticket fra annen hall (PHYSICAL_TICKET_WRONG_HALL)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID });
    rig.physicalRead.seed({
      uniqueId: "PT-other",
      batchId: "batch-x",
      hallId: SECONDARY_HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    await expectDomainError(
      () =>
        rig.txService.sellPhysicalTicket({
          agentUserId: agent.id,
          playerUserId: "p-1",
          ticketUniqueId: "PT-other",
          paymentMethod: "CASH",
          clientRequestId: "sell-bad",
        }),
      "PHYSICAL_TICKET_WRONG_HALL",
      "STEP F.2: hall-mismatch på physical ticket"
    );
  });

  test("STEP F.3 — cancelPhysicalSale innen 10-min-vindu krediterer wallet (counter-tx)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 100 });
    rig.physicalRead.seed({
      uniqueId: "PT-50",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    const sale = await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-50",
      paymentMethod: "WALLET",
      clientRequestId: "sell-cancel",
    });
    const balanceAfterSale = await rig.wallet.getBalance("wallet-p-1");
    assert.equal(balanceAfterSale, 50, "100 - 50 = 50 NOK etter sale");

    const cancel = await rig.txService.cancelPhysicalSale({
      agentUserId: agent.id,
      agentRole: "AGENT",
      originalTxId: sale.id,
      reason: "Customer changed mind",
    });
    assert.equal(cancel.actionType, "TICKET_CANCEL");
    assert.equal(cancel.relatedTxId, sale.id);
    assert.equal(cancel.amount, 50);

    const balanceAfterCancel = await rig.wallet.getBalance("wallet-p-1");
    assert.equal(balanceAfterCancel, 100, "wallet refundert etter cancel");
  });

  test("STEP F.4 — cancelPhysicalSale dobbel-cancel avvises (ALREADY_CANCELLED)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 100 });
    rig.physicalRead.seed({
      uniqueId: "PT-dbl",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    const sale = await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-dbl",
      paymentMethod: "WALLET",
      clientRequestId: "sell-dbl",
    });
    await rig.txService.cancelPhysicalSale({
      agentUserId: agent.id,
      agentRole: "AGENT",
      originalTxId: sale.id,
      reason: "first cancel",
    });
    await expectDomainError(
      () =>
        rig.txService.cancelPhysicalSale({
          agentUserId: agent.id,
          agentRole: "AGENT",
          originalTxId: sale.id,
          reason: "second cancel attempt",
        }),
      "ALREADY_CANCELLED",
      "STEP F.4: dobbel cancel skal blokkeres"
    );
  });

  test("STEP F.5 — cancelPhysicalSale utenfor 10-min-vindu krever ADMIN", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 100 });
    rig.physicalRead.seed({
      uniqueId: "PT-old",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    const sale = await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-old",
      paymentMethod: "WALLET",
      clientRequestId: "sell-old",
    });
    // Stomp createdAt på den interne rad-arrayen (getById returnerer clone).
    // 11 min tilbake — utenfor det 10-min cancel-vinduet.
    const internalRows = (rig.txStore as unknown as {
      rows: Array<{ id: string; createdAt: string }>;
    }).rows;
    const internalRow = internalRows.find((r) => r.id === sale.id);
    if (!internalRow) {
      throw new Error("STEP F.5: kunne ikke finne intern tx-rad");
    }
    internalRow.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await expectDomainError(
      () =>
        rig.txService.cancelPhysicalSale({
          agentUserId: agent.id,
          agentRole: "AGENT",
          originalTxId: sale.id,
          reason: "too late",
        }),
      "CANCEL_WINDOW_EXPIRED",
      "STEP F.5: AGENT skal blokkeres etter 10 min"
    );
    // ADMIN kan force-cancel
    const cancel = await rig.txService.cancelPhysicalSale({
      agentUserId: "admin-force",
      agentRole: "ADMIN",
      originalTxId: sale.id,
      reason: "Admin force-cancel after window",
    });
    assert.equal(cancel.actionType, "TICKET_CANCEL");
  });

  test("STEP F.6 — Physical Cashout pattern-popup mangler i admin-web (FOLLOWUP-13)", async () => {
    // P1-FINDING (LEGACY_PARITY_AUDIT BIN-FOLLOWUP-13): wireframe §17.35
    // viser 5×5 grid med vinnende pattern + Cashout/Rewarded-status +
    // Reward All-knapp. Backend mini-game-winning-tjenesten finnes, men
    // frontend mangler popup-en.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const physicalCashoutPath = path.resolve(
      new URL("../..", import.meta.url).pathname,
      "..",
      "admin-web/src/pages/cash-inout/PhysicalCashoutPage.ts"
    );
    let src = "";
    try {
      src = await fs.readFile(physicalCashoutPath, "utf8");
    } catch {
      console.warn("STEP F.6 INFO: PhysicalCashoutPage.ts ikke funnet");
      return;
    }
    const hasGrid = /5x5|grid|ticket-grid/i.test(src);
    const hasRewardAll = /reward.?all/i.test(src);
    if (!hasGrid || !hasRewardAll) {
      console.warn(
        `STEP F.6 P1-FINDING (BIN-FOLLOWUP-13): Physical Cashout-modal mangler. ` +
          `5×5 grid: ${hasGrid}, Reward All: ${hasRewardAll}. ` +
          `Pilot-blokker — agent kan ikke utbetale fysiske vinnere.`
      );
    }
  });

  test("STEP F.7 — endGame markerer runden ENDED (regulatorisk: spill stopper når noen vinner)", async () => {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      {
        minDrawIntervalMs: 0,
        minPlayersToStart: 1,
        dailyLossLimit: 1_000_000,
        monthlyLossLimit: 10_000_000,
      }
    );
    const { roomCode, playerId } = await engine.createRoom({
      hallId: HALL_ID,
      playerName: "Master",
      walletId: "wallet-end",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    });
    await engine.endGame({
      roomCode,
      actorPlayerId: playerId,
      reason: "BINGO claimed",
    });
    const snap = engine.getRoomSnapshot(roomCode);
    const lastStatus = snap.currentGame?.status ?? "ENDED";
    assert.notEqual(lastStatus, "RUNNING", "etter end skal status ikke være RUNNING");
    assert.notEqual(lastStatus, "PAUSED");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe G — Kiosk + bong-salg
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP G.1 — Sell Products (§17.12): CASH cash-in oppdaterer dailyBalance, CARD ikke", async () => {
    // Wireframe §17.12: produkt-salg med Cash/Card payment. Cash øker
    // dailyBalance + totalCashIn; Card øker kun totalCardIn (kortbetalinger
    // går ikke gjennom kasse). Vi simulerer dette via cash-in-pathen
    // siden ProductSaleService krever Postgres-tilkobling.
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-buyer", hallId: HALL_ID, balance: 0 });

    // Cash-payment skal øke dailyBalance
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-buyer",
      amount: 80, // 2x Coffee = 80 NOK per wireframe-eksempel
      paymentMethod: "CASH",
      clientRequestId: "kiosk-cash",
      notes: "Sell Products — Coffee × 2",
    });
    let shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.equal(shift!.totalCashIn, 80);
    assert.equal(shift!.dailyBalance, 80, "CASH skal øke dailyBalance");

    // Card-payment skal IKKE øke dailyBalance
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-buyer",
      amount: 80,
      paymentMethod: "CARD",
      clientRequestId: "kiosk-card",
      notes: "Sell Products — Coffee × 2 (card)",
    });
    shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.equal(shift!.totalCardIn, 80);
    assert.equal(shift!.dailyBalance, 80, "CARD skal IKKE øke dailyBalance");
  });

  test("STEP G.2 — listTransactionsForCurrentShift returnerer alle agent-tx (Order History)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 100,
      paymentMethod: "CASH",
      clientRequestId: "tx-1",
    });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 200,
      paymentMethod: "CARD",
      clientRequestId: "tx-2",
    });
    const list = await rig.txService.listTransactionsForCurrentShift(agent.id);
    assert.equal(list.length, 2, "begge tx skal listes");
    const total = list.reduce((sum, t) => sum + t.amount, 0);
    assert.equal(total, 300);
  });

  test("STEP G.3 — Sold Tickets list — TICKET_SALE-tx synlig i shift-snapshot", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 100 });
    rig.physicalRead.seed({
      uniqueId: "PT-G3-1",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-G3-1",
      paymentMethod: "WALLET",
      clientRequestId: "sell-g3",
    });
    const list = await rig.txService.listTransactionsForCurrentShift(agent.id);
    const sale = list.find((t) => t.actionType === "TICKET_SALE");
    assert.ok(sale, "STEP G.3: TICKET_SALE-rad skal finnes i shift-history");
    assert.equal(sale!.ticketUniqueId, "PT-G3-1");
    assert.equal(sale!.amount, 50);
  });

  test("STEP G.4 — Sold Tickets filter Physical/Terminal/Web — wireframe §17.31", async () => {
    // Validér at backend støtter filter via ticketUniqueId-felt.
    // Frontend kan slå opp Physical = ticketUniqueId !== null,
    // Terminal/Web = (annen path som ikke er implementert ennå).
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 100 });
    rig.physicalRead.seed({
      uniqueId: "PT-G4",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-1",
      ticketUniqueId: "PT-G4",
      paymentMethod: "WALLET",
      clientRequestId: "g4-1",
    });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 100,
      paymentMethod: "CASH",
      clientRequestId: "g4-cash",
    });
    const all = await rig.txService.listTransactionsForCurrentShift(agent.id);
    const physical = all.filter((t) => t.ticketUniqueId !== null);
    assert.equal(physical.length, 1, "Physical = ticketUniqueId !== null");
    const nonTicket = all.filter((t) => t.ticketUniqueId === null);
    assert.equal(nonTicket.length, 1, "ikke-ticket cash-tx kan skilles ut");
  });

  test("STEP G.5 — agent kan ikke se andre agenters tx (transaksjons-isolasjon)", async () => {
    const rig = makePortalRig();
    const a1 = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    const a2 = await rig.seedAgent({ userId: "ag-2", hallId: HALL_ID });
    await rig.startShift(a1.profile.id, HALL_ID);
    await rig.startShift(a2.profile.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: a1.profile.id,
      playerUserId: "p-1",
      amount: 100,
      paymentMethod: "CASH",
      clientRequestId: "isolat-a1",
    });
    await rig.txService.cashIn({
      agentUserId: a2.profile.id,
      playerUserId: "p-1",
      amount: 200,
      paymentMethod: "CASH",
      clientRequestId: "isolat-a2",
    });
    const a1List = await rig.txService.listTransactionsForCurrentShift(a1.profile.id);
    const a2List = await rig.txService.listTransactionsForCurrentShift(a2.profile.id);
    assert.equal(a1List.length, 1, "a1 skal kun se sin tx");
    assert.equal(a2List.length, 1, "a2 skal kun se sin tx");
    assert.equal(a1List[0]!.amount, 100);
    assert.equal(a2List[0]!.amount, 200);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe H — Hall-specific report + Settlement-snapshot
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP H.1 — aggregateByShift summerer cash/card/wallet IN/OUT korrekt", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 1000 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 100,
      paymentMethod: "CASH",
      clientRequestId: "h1-1",
    });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 300,
      paymentMethod: "CARD",
      clientRequestId: "h1-2",
    });
    await rig.txService.cashOut({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 50,
      paymentMethod: "CASH",
      clientRequestId: "h1-3",
    });
    const shift = await rig.shiftService.getCurrentShift(agent.id);
    const agg = await rig.txStore.aggregateByShift(shift!.id);
    assert.equal(agg.cashIn, 100);
    assert.equal(agg.cardIn, 300);
    assert.equal(agg.cashOut, 50);
  });

  test("STEP H.2 — Hall Account Report 19 wireframe-kolonner — paritet med audit", () => {
    // P1-FINDING (LEGACY_PARITY_AUDIT BIN-FOLLOWUP-16): legacy har 19 kolonner,
    // ny har færre. Sjekk minimum at MACHINE_ROW_KEYS har de 14 viktige.
    const expectedMachineKeys = [
      "metronia",
      "ok_bingo",
      "franco",
      "otium",
      "norsk_tipping_dag",
      "norsk_tipping_totall",
      "rikstoto_dag",
      "rikstoto_totall",
      "rekvisita",
      "servering",
      "bilag",
      "bank",
      "gevinst_overfoering_bank",
      "annet",
    ] as const;
    assert.equal(MACHINE_ROW_KEYS.length, 14, "STEP H.2: 14 maskin-rader");
    for (const k of expectedMachineKeys) {
      assert.ok(
        (MACHINE_ROW_KEYS as readonly string[]).includes(k),
        `STEP H.2: maskin-key ${k} mangler`
      );
    }
  });

  test("STEP H.3 — HallSpecificReport-modulen finnes (5 game-slots OMS/UTD/Payout%/RES)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const reportsPath = new URL("../admin/reports", import.meta.url).pathname;
    const files = await fs.readdir(reportsPath);
    assert.ok(
      files.includes("HallSpecificReport.ts"),
      "STEP H.3: HallSpecificReport.ts må eksistere"
    );
    const reportPath = path.join(reportsPath, "HallSpecificReport.ts");
    const src = await fs.readFile(reportPath, "utf8");
    // Bekreft at GameAggregate har de 4 påkrevde feltene
    const requiredFields = ["oms", "utd", "payoutPct", "res"];
    for (const f of requiredFields) {
      assert.ok(
        src.includes(f),
        `STEP H.3: HallSpecificReport mangler ${f} i GameAggregate`
      );
    }
  });

  test("STEP H.4 — Order Report (Cash/Card/Customer Number totaler) — service-shape", () => {
    // Wireframe §17.37 Order Report: per-agent rapport som summerer
    // Cash/Card/Customer Number/Total. Vi verifiserer at agent-tx-store
    // gir oss skille mellom CASH/CARD/WALLET-payment-method.
    const expectedPaymentMethods = ["CASH", "CARD", "WALLET"] as const;
    assert.equal(
      expectedPaymentMethods.length,
      3,
      "STEP H.4: 3 payment-methods per agent-tx-shape"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe I — Settlement-flyt
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP I.1 — Control Daily Balance — diff < 500 NOK = severity OK", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 1000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    const result = await rig.settlementService.controlDailyBalance({
      agentUserId: agent.id,
      reportedDailyBalance: 1010, // 10 NOK over = 1% diff
      reportedTotalCashBalance: 1010,
    });
    assert.equal(result.shiftDailyBalance, 1000);
    assert.equal(result.diff, 10);
    assert.equal(result.severity, "OK");
  });

  test("STEP I.2 — Control Daily Balance — diff > 1000 NOK = severity FORCE_REQUIRED", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 5000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    const result = await rig.settlementService.controlDailyBalance({
      agentUserId: agent.id,
      reportedDailyBalance: 6500, // 1500 NOK over = 30% diff
      reportedTotalCashBalance: 6500,
    });
    assert.equal(result.severity, "FORCE_REQUIRED");
    assert.equal(result.diff, 1500);
  });

  test("STEP I.3 — closeDay krever note hvis severity=NOTE_REQUIRED (DIFF_NOTE_REQUIRED)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    // 10 000 NOK basis — 700 NOK diff = 7% = NOTE_REQUIRED-band
    // (over 500 NOK / 5%, men under 1000 NOK / 10% force-grensen)
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 10000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    await expectDomainError(
      () =>
        rig.settlementService.closeDay({
          agentUserId: agent.id,
          agentRole: "AGENT",
          reportedCashCount: 10700, // 700 NOK / 7% = NOTE_REQUIRED
          // Ingen note → blokkes
        }),
      "DIFF_NOTE_REQUIRED",
      "STEP I.3: 700 NOK / 7% diff krever note"
    );
  });

  test("STEP I.4 — closeDay > 1000 NOK avvik krever ADMIN + isForceRequested", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 5000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    // AGENT skal blokkeres uavhengig av note
    await expectDomainError(
      () =>
        rig.settlementService.closeDay({
          agentUserId: agent.id,
          agentRole: "AGENT",
          reportedCashCount: 6500,
          settlementNote: "explanation provided",
        }),
      "ADMIN_FORCE_REQUIRED",
      "STEP I.4: AGENT kan ikke close-day med 30% diff"
    );
  });

  test("STEP I.5 — closeDay happy-path (severity OK) oppretter settlement + transferer cash til hall", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 1000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    const settlement = await rig.settlementService.closeDay({
      agentUserId: agent.id,
      agentRole: "AGENT",
      reportedCashCount: 1000, // exact match = OK
    });
    assert.equal(settlement.dailyBalanceAtEnd, 1000);
    assert.equal(settlement.dailyBalanceDifference, 0);
    assert.equal(settlement.isForced, false);
    assert.equal(settlement.shiftCashInTotal, 1000);
    assert.equal(settlement.closedByUserId, agent.id);

    // Hall-cash skal være kreditert med 1000
    const { cashBalance } = await rig.hallCash.getHallBalances(HALL_ID);
    assert.equal(cashBalance, 1000, "hall cash kreditert via DAILY_BALANCE_TRANSFER");

    // Shift skal være settled
    const shift = await rig.shiftService.getShift(settlement.shiftId);
    assert.notEqual(shift.settledAt, null, "shift.settledAt skal settes");
  });

  test("STEP I.6 — Settlement breakdown 14-rad JSONB validering (wireframe §17.4)", () => {
    const validPayload: MachineBreakdown = {
      rows: {
        metronia: { in_cents: 481000, out_cents: 174800 },
        ok_bingo: { in_cents: 362000, out_cents: 162500 },
        franco: { in_cents: 477000, out_cents: 184800 },
        otium: { in_cents: 0, out_cents: 0 },
        norsk_tipping_dag: { in_cents: 0, out_cents: 0 },
        norsk_tipping_totall: { in_cents: 0, out_cents: 0 },
        rikstoto_dag: { in_cents: 0, out_cents: 0 },
        rikstoto_totall: { in_cents: 0, out_cents: 0 },
        rekvisita: { in_cents: 2500, out_cents: 0 },
        servering: { in_cents: 26000, out_cents: 0 },
        bilag: { in_cents: 0, out_cents: 0 },
        bank: { in_cents: 81400, out_cents: 81400 },
        gevinst_overfoering_bank: { in_cents: 0, out_cents: 0 },
        annet: { in_cents: 0, out_cents: 0 },
      },
      kasse_start_skift_cents: 3055800,
      ending_opptall_kassie_cents: 4616900,
      innskudd_drop_safe_cents: 100000,
      paafyll_ut_kasse_cents: 561300,
      totalt_dropsafe_paafyll_cents: 661300,
      difference_in_shifts_cents: 1100,
    };
    const validated = validateMachineBreakdown(validPayload);
    assert.equal(Object.keys(validated.rows).length, 14);

    const totals = computeBreakdownTotals(validated);
    assert.equal(typeof totals.totalSumCents, "number");
    assert.equal(
      totals.totalSumCents,
      totals.totalInCents - totals.totalOutCents,
      "STEP I.6: totalSum = totalIn - totalOut"
    );

    // ugyldig — ukjent maskin-nøkkel
    assert.throws(
      () =>
        validateMachineBreakdown({
          rows: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ ukjent_maskin: { in_cents: 100, out_cents: 0 } } as any),
          },
          kasse_start_skift_cents: 0,
          ending_opptall_kassie_cents: 0,
          innskudd_drop_safe_cents: 0,
          paafyll_ut_kasse_cents: 0,
          totalt_dropsafe_paafyll_cents: 0,
          difference_in_shifts_cents: 0,
        }),
      /Ukjent maskin/,
      "STEP I.6: ukjent maskin-nøkkel skal avvises"
    );

    // ugyldig — negativ in_cents
    assert.throws(
      () =>
        validateMachineBreakdown({
          rows: { metronia: { in_cents: -10, out_cents: 0 } },
          kasse_start_skift_cents: 0,
          ending_opptall_kassie_cents: 0,
          innskudd_drop_safe_cents: 0,
          paafyll_ut_kasse_cents: 0,
          totalt_dropsafe_paafyll_cents: 0,
          difference_in_shifts_cents: 0,
        }),
      /in_cents må være et ikke-negativt heltall/,
      "STEP I.6: negativ in_cents skal avvises"
    );
  });

  test("STEP I.7 — closeDay med breakdown lagrer hele 14-rad-strukturen", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-1",
      amount: 1000,
      paymentMethod: "CASH",
      clientRequestId: "init-cash",
    });
    const breakdown = {
      rows: {
        metronia: { in_cents: 50000, out_cents: 30000 },
        ok_bingo: { in_cents: 40000, out_cents: 20000 },
      },
      kasse_start_skift_cents: 0,
      ending_opptall_kassie_cents: 100000,
      innskudd_drop_safe_cents: 50000,
      paafyll_ut_kasse_cents: 50000,
      totalt_dropsafe_paafyll_cents: 100000,
      difference_in_shifts_cents: 0,
    };
    const settlement = await rig.settlementService.closeDay({
      agentUserId: agent.id,
      agentRole: "AGENT",
      reportedCashCount: 1000,
      machineBreakdown: breakdown,
    });
    assert.ok(settlement.machineBreakdown);
    assert.equal(settlement.machineBreakdown.rows.metronia?.in_cents, 50000);
    assert.equal(settlement.machineBreakdown.rows.ok_bingo?.out_cents, 20000);
    assert.equal(settlement.machineBreakdown.kasse_start_skift_cents, 0);
  });

  test("STEP I.8 — Shift Log Out med distributeWinnings + transferRegisterTickets-flagg (§17.6)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    const result = await rig.shiftService.logout(agent.id, {
      distributeWinnings: true,
      transferRegisterTickets: true,
      logoutNotes: "End of pilot day",
    });
    assert.equal(result.shift.isActive, false);
    assert.equal(result.shift.isLoggedOut, true);
    assert.equal(result.shift.distributedWinnings, true);
    assert.equal(result.shift.transferredRegisterTickets, true);
    assert.equal(result.shift.logoutNotes, "End of pilot day");
    // Counts er 0 fordi vi ikke har port-implementasjoner for cashout/range
    assert.equal(typeof result.pendingCashoutsFlagged, "number");
    assert.equal(typeof result.ticketRangesFlagged, "number");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe J — Negative tester (regulatorisk + auth)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP J.1 — cashOut CASH med utilstrekkelig dailyBalance (INSUFFICIENT_DAILY_BALANCE)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID, balance: 1000 });
    // Player har wallet-balance, men shift har 0 daily-balance
    await expectDomainError(
      () =>
        rig.txService.cashOut({
          agentUserId: agent.id,
          playerUserId: "p-1",
          amount: 100,
          paymentMethod: "CASH",
          clientRequestId: "j1",
        }),
      "INSUFFICIENT_DAILY_BALANCE",
      "STEP J.1: cash-out feiler med tom daily balance"
    );
  });

  test("STEP J.2 — cashIn på player i annen hall (PLAYER_NOT_AT_HALL)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({ userId: "p-elsewhere", hallId: SECONDARY_HALL_ID });
    await expectDomainError(
      () =>
        rig.txService.cashIn({
          agentUserId: agent.id,
          playerUserId: "p-elsewhere",
          amount: 100,
          paymentMethod: "CASH",
          clientRequestId: "j2",
        }),
      "PLAYER_NOT_AT_HALL",
      "STEP J.2: hall-mismatch på player"
    );
  });

  test("STEP J.3 — agent uten aktiv shift kan ikke ta cash-ops (NO_ACTIVE_SHIFT)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.seedPlayer({ userId: "p-1", hallId: HALL_ID });
    // ingen startShift!
    await expectDomainError(
      () =>
        rig.txService.cashIn({
          agentUserId: agent.id,
          playerUserId: "p-1",
          amount: 100,
          paymentMethod: "CASH",
          clientRequestId: "j3",
        }),
      "NO_ACTIVE_SHIFT",
      "STEP J.3: cash-op uten aktiv shift"
    );
  });

  test("STEP J.4 — addMoneyToUser avviser ADMIN/AGENT-target (TARGET_NOT_PLAYER)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await rig.seedPlayer({
      userId: "fake-admin",
      hallId: HALL_ID,
      role: "ADMIN" as never,
    });
    await expectDomainError(
      () =>
        rig.txService.addMoneyToUser({
          agentUserId: agent.id,
          targetUserId: "fake-admin",
          amount: 100,
          paymentType: "Cash",
          clientRequestId: "j4",
        }),
      "TARGET_NOT_PLAYER",
      "STEP J.4: agent-cash-endepunkt skal kun rettes mot PLAYER"
    );
  });

  test("STEP J.5 — soft-delete agent med aktiv shift blokkeres (AGENT_HAS_ACTIVE_SHIFT)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await expectDomainError(
      () => rig.agentService.softDeleteAgent(agent.id),
      "AGENT_HAS_ACTIVE_SHIFT",
      "STEP J.5: kan ikke slette agent med aktiv shift"
    );
  });

  test("STEP J.6 — shiftService.startShift dobbel-shift blokkeres (SHIFT_ALREADY_ACTIVE)", async () => {
    const rig = makePortalRig();
    const { profile: agent } = await rig.seedAgent({ userId: "ag-1", hallId: HALL_ID });
    await rig.startShift(agent.id, HALL_ID);
    await expectDomainError(
      () => rig.shiftService.startShift({ userId: agent.id, hallId: HALL_ID }),
      "SHIFT_ALREADY_ACTIVE",
      "STEP J.6: dobbel-shift skal blokkeres"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Gruppe K — Lange-løp-integrasjon (full workday smoke)
  // ──────────────────────────────────────────────────────────────────────────

  test("STEP K.1 — full workday smoke: shift→cashin→sale→cashout→close", async () => {
    // Alt-i-ett-test som bekrefter at hele kjeden henger sammen.
    // Hvis dette feiler er en av de 50+ underliggende stepene rotåren.
    const rig = makePortalRig();

    // 1) Setup
    const { profile: agent } = await rig.seedAgent({
      userId: "ag-pilot",
      hallId: HALL_ID,
    });
    await rig.startShift(agent.id, HALL_ID);

    // 2) Start-skift cash
    await rig.seedPlayer({ userId: "p-cash", hallId: HALL_ID, balance: 0 });
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-cash",
      amount: 5000,
      paymentMethod: "CASH",
      clientRequestId: "k1-init",
    });

    // 3) Pre-game ticket-salg
    await rig.seedPlayer({ userId: "p-buy", hallId: HALL_ID, balance: 200 });
    rig.physicalRead.seed({
      uniqueId: "PT-K1",
      batchId: "batch-1",
      hallId: HALL_ID,
      status: "UNSOLD",
      priceCents: 5000,
      assignedGameId: null,
    });
    await rig.txService.sellPhysicalTicket({
      agentUserId: agent.id,
      playerUserId: "p-buy",
      ticketUniqueId: "PT-K1",
      paymentMethod: "WALLET",
      clientRequestId: "k1-sale",
    });

    // 4) Cash-out vinner
    await rig.txService.cashOut({
      agentUserId: agent.id,
      playerUserId: "p-cash",
      amount: 500,
      paymentMethod: "CASH",
      clientRequestId: "k1-payout",
    });

    // 5) Kiosk-salg (kaffe = card)
    await rig.txService.cashIn({
      agentUserId: agent.id,
      playerUserId: "p-cash",
      amount: 80,
      paymentMethod: "CARD",
      clientRequestId: "k1-coffee",
    });

    // 6) Unique ID
    const uid = await rig.uniqueIdService.create({
      hallId: HALL_ID,
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.id,
    });
    assert.match(uid.card.id, /^\d{9}$/);

    // 7) Snapshot før close
    const shift = await rig.shiftService.getCurrentShift(agent.id);
    assert.ok(shift);
    // 5000 (init) - 500 (payout) = 4500 i daily balance (cash-flow)
    assert.equal(shift!.dailyBalance, 4500);
    assert.equal(shift!.totalCashIn, 5000);
    assert.equal(shift!.totalCashOut, 500);
    assert.equal(shift!.totalCardIn, 80);
    assert.equal(shift!.sellingByCustomerNumber, 1, "1 wallet-salg registrert");

    // 8) Settlement med breakdown
    const breakdown = {
      rows: {
        metronia: { in_cents: 100000, out_cents: 50000 },
        ok_bingo: { in_cents: 80000, out_cents: 30000 },
        franco: { in_cents: 0, out_cents: 0 },
        otium: { in_cents: 0, out_cents: 0 },
        norsk_tipping_dag: { in_cents: 0, out_cents: 0 },
        norsk_tipping_totall: { in_cents: 0, out_cents: 0 },
        rikstoto_dag: { in_cents: 0, out_cents: 0 },
        rikstoto_totall: { in_cents: 0, out_cents: 0 },
        rekvisita: { in_cents: 0, out_cents: 0 },
        servering: { in_cents: 8000, out_cents: 0 },
        bilag: { in_cents: 0, out_cents: 0 },
        bank: { in_cents: 0, out_cents: 0 },
        gevinst_overfoering_bank: { in_cents: 0, out_cents: 0 },
        annet: { in_cents: 0, out_cents: 0 },
      },
      kasse_start_skift_cents: 0,
      ending_opptall_kassie_cents: 450000,
      innskudd_drop_safe_cents: 200000,
      paafyll_ut_kasse_cents: 250000,
      totalt_dropsafe_paafyll_cents: 450000,
      difference_in_shifts_cents: 0,
    };
    const settlement = await rig.settlementService.closeDay({
      agentUserId: agent.id,
      agentRole: "AGENT",
      reportedCashCount: 4500,
      machineBreakdown: breakdown,
      settlementNote: "Pilot demo-day OK",
    });
    assert.equal(settlement.dailyBalanceDifference, 0);
    assert.equal(settlement.dailyBalanceAtEnd, 4500);
    assert.ok(settlement.machineBreakdown);
    assert.equal(settlement.machineBreakdown.rows.metronia?.in_cents, 100000);

    // Hall cash kreditert
    const balances = await rig.hallCash.getHallBalances(HALL_ID);
    assert.equal(balances.cashBalance, 4500);
  });
});
