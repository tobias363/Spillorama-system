/**
 * Stor X-bong multiplikator i engine-path (`generateTicketAssignments`).
 *
 * Bug-fix 2026-05-15: tidligere genererte `Game1DrawEngineService
 * .generateTicketAssignments` kun 1 rad per `spec.count` uavhengig av størrelse.
 * 1 Stor X-bong = 3 brett per SPILL_REGLER §2 og §10.3 (`LARGE_TICKET_PRICE_MULTIPLIER = 3`
 * i `GamePlanEngineBridge`). Konsekvens: 1 Stor Hvit-kjøp ga 1 brett i DB
 * istedenfor 3, så frontend triple-grupperingen (PR #1512) ikke kunne
 * gruppere — viste 1 enkelt-bong istedenfor 1 triple-container.
 *
 * Samme fix er allerede dekket i `Game1ScheduledRoomSnapshot.test.ts`
 * for snapshot-pathen. Denne testen sikrer at engine-pathen
 * (`startGame()` → `generateTicketAssignments`) holder samme invariant.
 *
 * Test-strategi: call `generateTicketAssignments` direkte via cast og
 * tell INSERT-kall til `app_game1_ticket_assignments`. Pure unit-test
 * uten Postgres — stub client.query() tracker insertions.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import type {
  Game1TicketPurchaseService,
  Game1TicketPurchaseRow,
} from "./Game1TicketPurchaseService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

interface InsertedRow {
  purchaseId: string;
  ticketColor: string;
  ticketSize: string;
  sequenceInPurchase: number;
}

function makeService(): Game1DrawEngineService {
  const fakePool = {
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    }),
    query: async () => ({ rows: [], rowCount: 0 }),
  };
  return new Game1DrawEngineService({
    pool: fakePool as never,
    schema: "public",
    ticketPurchaseService: {} as unknown as Game1TicketPurchaseService,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
}

function makeStubClient(): {
  client: {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  inserts: InsertedRow[];
} {
  const inserts: InsertedRow[] = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO") && sql.includes("ticket_assignments")) {
        inserts.push({
          purchaseId: params[2] as string,
          ticketColor: params[5] as string,
          ticketSize: params[6] as string,
          sequenceInPurchase: params[8] as number,
        });
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, inserts };
}

function purchaseRow(
  id: string,
  ticketSpec: Array<{ color: string; size: "small" | "large"; count: number }>,
): Game1TicketPurchaseRow {
  return {
    id,
    scheduledGameId: "sg-test",
    buyerUserId: "user-test",
    hallId: "hall-test",
    ticketSpec: ticketSpec.map((t) => ({ ...t, priceCentsEach: 0 })),
    totalAmountCents: 0,
    paymentMethod: "digital_wallet",
    agentUserId: null,
    idempotencyKey: `idem-${id}`,
    purchasedAt: new Date().toISOString(),
    refundedAt: null,
    refundReason: null,
    refundedByUserId: null,
    refundTransactionId: null,
  };
}

test("Engine-path: 1 Stor Hvit → 3 brett i app_game1_ticket_assignments", async () => {
  const service = makeService();
  const { client, inserts } = makeStubClient();
  const purchases = [purchaseRow("p1", [{ color: "white", size: "large", count: 1 }])];

  // generateTicketAssignments er privat — cast for å teste invariant direkte.
  await (service as unknown as {
    generateTicketAssignments: (
      c: unknown,
      g: string,
      p: Game1TicketPurchaseRow[],
      m: number,
    ) => Promise<number>;
  }).generateTicketAssignments(client, "sg-test", purchases, 75);

  assert.equal(inserts.length, 3, `Forventet 3 brett for 1 Stor, fikk ${inserts.length}`);
  assert.ok(
    inserts.every((r) => r.ticketColor === "white" && r.ticketSize === "large"),
    "Alle 3 brett skal være white-large",
  );
  assert.deepEqual(
    inserts.map((r) => r.sequenceInPurchase).sort((a, b) => a - b),
    [1, 2, 3],
    "sequence_in_purchase skal være 1, 2, 3",
  );
});

test("Engine-path: 1 Stor Hvit + 1 Stor Gul + 1 Stor Lilla → 9 brett (3 per farge)", async () => {
  const service = makeService();
  const { client, inserts } = makeStubClient();
  const purchases = [
    purchaseRow("p-mixed", [
      { color: "white", size: "large", count: 1 },
      { color: "yellow", size: "large", count: 1 },
      { color: "purple", size: "large", count: 1 },
    ]),
  ];

  await (service as unknown as {
    generateTicketAssignments: (
      c: unknown,
      g: string,
      p: Game1TicketPurchaseRow[],
      m: number,
    ) => Promise<number>;
  }).generateTicketAssignments(client, "sg-test", purchases, 75);

  assert.equal(inserts.length, 9, `Forventet 9 brett (3×3), fikk ${inserts.length}`);
  assert.equal(
    inserts.filter((r) => r.ticketColor === "white").length,
    3,
    "3 brett av Stor White",
  );
  assert.equal(
    inserts.filter((r) => r.ticketColor === "yellow").length,
    3,
    "3 brett av Stor Yellow",
  );
  assert.equal(
    inserts.filter((r) => r.ticketColor === "purple").length,
    3,
    "3 brett av Stor Purple",
  );

  // Sekvensering: hvert farge-bundle skal ha 3 påfølgende sequence-numre
  // (1-3 white, 4-6 yellow, 7-9 purple) så frontend `tryGroupTriplet`
  // kan gruppere dem som consecutive same-color triples.
  const seqs = inserts.map((r) => r.sequenceInPurchase).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("Engine-path: 1 Liten Hvit → 1 brett (Liten har ingen multiplikator)", async () => {
  const service = makeService();
  const { client, inserts } = makeStubClient();
  const purchases = [purchaseRow("p2", [{ color: "white", size: "small", count: 1 }])];

  await (service as unknown as {
    generateTicketAssignments: (
      c: unknown,
      g: string,
      p: Game1TicketPurchaseRow[],
      m: number,
    ) => Promise<number>;
  }).generateTicketAssignments(client, "sg-test", purchases, 75);

  assert.equal(inserts.length, 1, "Liten Hvit skal generere kun 1 brett");
  assert.equal(inserts[0]?.ticketSize, "small");
  assert.equal(inserts[0]?.sequenceInPurchase, 1);
});

test("Engine-path: blandet Liten + Stor på samme purchase", async () => {
  const service = makeService();
  const { client, inserts } = makeStubClient();
  const purchases = [
    purchaseRow("p-mix", [
      { color: "white", size: "small", count: 2 },   // 2 brett
      { color: "yellow", size: "large", count: 1 },  // 3 brett
    ]),
  ];

  await (service as unknown as {
    generateTicketAssignments: (
      c: unknown,
      g: string,
      p: Game1TicketPurchaseRow[],
      m: number,
    ) => Promise<number>;
  }).generateTicketAssignments(client, "sg-test", purchases, 75);

  assert.equal(inserts.length, 5, "2 Liten Hvit + 1 Stor Gul = 5 brett");
  assert.equal(
    inserts.filter((r) => r.ticketSize === "small" && r.ticketColor === "white").length,
    2,
  );
  assert.equal(
    inserts.filter((r) => r.ticketSize === "large" && r.ticketColor === "yellow").length,
    3,
  );
});

test("Engine-path: refunded purchase skippes — ingen brett genereres", async () => {
  const service = makeService();
  const { client, inserts } = makeStubClient();
  const refunded = purchaseRow("p-refunded", [{ color: "white", size: "large", count: 1 }]);
  refunded.refundedAt = new Date().toISOString();
  const purchases = [refunded];

  await (service as unknown as {
    generateTicketAssignments: (
      c: unknown,
      g: string,
      p: Game1TicketPurchaseRow[],
      m: number,
    ) => Promise<number>;
  }).generateTicketAssignments(client, "sg-test", purchases, 75);

  assert.equal(inserts.length, 0, "Refundert purchase skal ikke generere brett");
});
