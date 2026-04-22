/**
 * PT4 — enhetstester for PhysicalTicketPayoutService.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 6: Vinn-varsel + verifisering + utbetaling")
 *
 * Dekker (≥20 tester):
 *   Input-validering:
 *     1. createPendingPayout: alle ikke-tomme felter påkrevd
 *     2. createPendingPayout: negativt expectedPayoutCents avvises
 *     3. verifyWin: tom pendingPayoutId/scannedTicketId/userId avvises
 *     4. confirmPayout: tomme felter avvises
 *     5. rejectWin: tom reason avvises
 *
 *   Happy-path flyter:
 *     6. createPendingPayout → listPendingForGame/User returnerer raden
 *     7. createPendingPayout er idempotent (ON CONFLICT DO NOTHING)
 *     8. verifyWin → setter verified_at og returnerer needsAdminApproval=false
 *         for beløp < terskel
 *     9. verifyWin → needsAdminApproval=true for beløp ≥ terskel
 *    10. confirmPayout happy path (uten admin-approval)
 *    11. confirmPayout oppdaterer app_static_tickets.paid_out_*
 *    12. rejectWin happy path
 *
 *   Fail-closed:
 *    13. verifyWin med scan-mismatch → TICKET_SCAN_MISMATCH
 *    14. confirmPayout uten verify → NOT_VERIFIED
 *    15. confirmPayout med admin-required men ikke admin-approved → ADMIN_APPROVAL_REQUIRED
 *    16. adminApprove på pending uten admin_approval_required → ADMIN_APPROVAL_NOT_REQUIRED
 *    17. rejected pending → verifyWin/adminApprove/confirmPayout feiler
 *    18. dobbel confirmPayout → ALREADY_PAID_OUT
 *    19. dobbel rejectWin → ALREADY_REJECTED
 *    20. rejected pending → rejectWin feiler
 *
 *   Admin-approval:
 *    21. adminApprove happy path
 *    22. adminApprove → confirmPayout fungerer etterpå
 *    23. adminApprove er idempotent
 *
 *   Not-found:
 *    24. verifyWin på ukjent id → PENDING_PAYOUT_NOT_FOUND
 *    25. confirmPayout på ukjent id → PENDING_PAYOUT_NOT_FOUND
 *    26. adminApprove på ukjent id → PENDING_PAYOUT_NOT_FOUND
 *    27. rejectWin på ukjent id → PENDING_PAYOUT_NOT_FOUND
 *
 *   Threshold override:
 *    28. custom threshold i ctor → påvirker admin_approval_required-flagg
 *
 *   Listings:
 *    29. listPendingForGame filtrerer ut paid_out + rejected
 *    30. listPendingForUser filtrerer ut paid_out + rejected
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  PhysicalTicketPayoutService,
  ADMIN_APPROVAL_THRESHOLD_CENTS,
} from "../PhysicalTicketPayoutService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Mock store / pool ──────────────────────────────────────────────────────

interface MockPendingRow {
  id: string;
  ticket_id: string;
  hall_id: string;
  scheduled_game_id: string;
  pattern_phase: string;
  expected_payout_cents: number;
  responsible_user_id: string;
  color: string;
  detected_at: Date;
  verified_at: Date | null;
  verified_by_user_id: string | null;
  paid_out_at: Date | null;
  paid_out_by_user_id: string | null;
  admin_approval_required: boolean;
  admin_approved_at: Date | null;
  admin_approved_by_user_id: string | null;
  rejected_at: Date | null;
  rejected_by_user_id: string | null;
  rejected_reason: string | null;
}

interface MockStaticTicketRow {
  hall_id: string;
  ticket_serial: string;
  paid_out_at: Date | null;
  paid_out_amount_cents: number | null;
  paid_out_by_user_id: string | null;
}

interface MockStore {
  pending: Map<string, MockPendingRow>;
  staticTickets: Map<string, MockStaticTicketRow>; // key: hallId::serial
  txActive: number;
  commitCount: number;
  rollbackCount: number;
}

function newStore(): MockStore {
  return {
    pending: new Map(),
    staticTickets: new Map(),
    txActive: 0,
    commitCount: 0,
    rollbackCount: 0,
  };
}

function staticKey(hallId: string, serial: string): string {
  return `${hallId}::${serial}`;
}

function seedStaticTicket(
  store: MockStore,
  hallId: string,
  serial: string,
): void {
  store.staticTickets.set(staticKey(hallId, serial), {
    hall_id: hallId,
    ticket_serial: serial,
    paid_out_at: null,
    paid_out_amount_cents: null,
    paid_out_by_user_id: null,
  });
}

function rowToResponse(row: MockPendingRow): Record<string, unknown> {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    hall_id: row.hall_id,
    scheduled_game_id: row.scheduled_game_id,
    pattern_phase: row.pattern_phase,
    expected_payout_cents: row.expected_payout_cents,
    responsible_user_id: row.responsible_user_id,
    color: row.color,
    detected_at: row.detected_at,
    verified_at: row.verified_at,
    verified_by_user_id: row.verified_by_user_id,
    paid_out_at: row.paid_out_at,
    paid_out_by_user_id: row.paid_out_by_user_id,
    admin_approval_required: row.admin_approval_required,
    admin_approved_at: row.admin_approved_at,
    admin_approved_by_user_id: row.admin_approved_by_user_id,
    rejected_at: row.rejected_at,
    rejected_by_user_id: row.rejected_by_user_id,
    rejected_reason: row.rejected_reason,
  };
}

function makeMockPool(store: MockStore): Pool {
  const runQuery = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();
    if (s === "BEGIN") {
      store.txActive += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "COMMIT") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.commitCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "ROLLBACK") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.rollbackCount += 1;
      return { rows: [], rowCount: 0 };
    }

    // INSERT ... ON CONFLICT DO NOTHING RETURNING ...
    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("ON CONFLICT")
    ) {
      const [
        id, ticketId, hallId, gameId, patternPhase,
        cents, responsibleUserId, color, adminRequired,
      ] = params as [
        string, string, string, string, string,
        number, string, string, boolean,
      ];
      const key = `${hallId}::${ticketId}::${patternPhase}`;
      // Check conflict
      for (const r of store.pending.values()) {
        if (
          r.hall_id === hallId
          && r.ticket_id === ticketId
          && r.pattern_phase === patternPhase
        ) {
          return { rows: [], rowCount: 0 };
        }
      }
      const row: MockPendingRow = {
        id,
        ticket_id: ticketId,
        hall_id: hallId,
        scheduled_game_id: gameId,
        pattern_phase: patternPhase,
        expected_payout_cents: cents,
        responsible_user_id: responsibleUserId,
        color,
        detected_at: new Date(),
        verified_at: null,
        verified_by_user_id: null,
        paid_out_at: null,
        paid_out_by_user_id: null,
        admin_approval_required: adminRequired,
        admin_approved_at: null,
        admin_approved_by_user_id: null,
        rejected_at: null,
        rejected_by_user_id: null,
        rejected_reason: null,
      };
      store.pending.set(id, row);
      return { rows: [rowToResponse(row)], rowCount: 1 };
    }

    // SELECT by (hall_id, ticket_id, pattern_phase) — findByUniqueKey
    if (
      sql.includes("FROM")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("WHERE hall_id = $1 AND ticket_id = $2 AND pattern_phase = $3")
    ) {
      const [hallId, ticketId, patternPhase] = params as [string, string, string];
      for (const r of store.pending.values()) {
        if (
          r.hall_id === hallId
          && r.ticket_id === ticketId
          && r.pattern_phase === patternPhase
        ) {
          return { rows: [rowToResponse(r)], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // SELECT by scheduled_game_id
    if (
      sql.includes("FROM")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("WHERE scheduled_game_id = $1")
      && sql.includes("paid_out_at IS NULL")
    ) {
      const [gameId] = params as [string];
      const rows = [...store.pending.values()]
        .filter((r) =>
          r.scheduled_game_id === gameId
          && r.paid_out_at === null
          && r.rejected_at === null)
        .sort((a, b) => a.detected_at.getTime() - b.detected_at.getTime())
        .map(rowToResponse);
      return { rows, rowCount: rows.length };
    }

    // SELECT by responsible_user_id
    if (
      sql.includes("FROM")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("WHERE responsible_user_id = $1")
      && sql.includes("paid_out_at IS NULL")
    ) {
      const [userId] = params as [string];
      const rows = [...store.pending.values()]
        .filter((r) =>
          r.responsible_user_id === userId
          && r.paid_out_at === null
          && r.rejected_at === null)
        .sort((a, b) => a.detected_at.getTime() - b.detected_at.getTime())
        .map(rowToResponse);
      return { rows, rowCount: rows.length };
    }

    // SELECT full row by id + FOR UPDATE
    if (
      sql.includes("FROM")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("WHERE id = $1")
      && sql.includes("FOR UPDATE")
    ) {
      const [id] = params as [string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      // Noen query-varianter henter kun subset av felter (rejectWin)
      if (sql.includes("id, paid_out_at, rejected_at")) {
        return {
          rows: [{
            id: r.id,
            paid_out_at: r.paid_out_at,
            rejected_at: r.rejected_at,
          }],
          rowCount: 1,
        };
      }
      return { rows: [rowToResponse(r)], rowCount: 1 };
    }

    // SELECT full row by id (no FOR UPDATE) — getById + reload after approve
    if (
      sql.includes("FROM")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      return { rows: [rowToResponse(r)], rowCount: 1 };
    }

    // UPDATE pending SET verified_at, verified_by_user_id
    if (
      sql.includes("UPDATE")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("SET verified_at")
    ) {
      const [id, userId] = params as [string, string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.verified_at = new Date();
      r.verified_by_user_id = userId;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE pending SET admin_approved_at
    if (
      sql.includes("UPDATE")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("SET admin_approved_at")
    ) {
      const [id, userId] = params as [string, string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.admin_approved_at = new Date();
      r.admin_approved_by_user_id = userId;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE pending SET paid_out_at
    if (
      sql.includes("UPDATE")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("SET paid_out_at")
    ) {
      const [id, at, userId] = params as [string, Date, string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.paid_out_at = at;
      r.paid_out_by_user_id = userId;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE pending SET rejected_at
    if (
      sql.includes("UPDATE")
      && sql.includes("app_physical_ticket_pending_payouts")
      && sql.includes("SET rejected_at")
    ) {
      const [id, at, userId, reason] = params as [string, Date, string, string];
      const r = store.pending.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.rejected_at = at;
      r.rejected_by_user_id = userId;
      r.rejected_reason = reason;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE app_static_tickets SET paid_out_*
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET paid_out_at")
    ) {
      const [ticketId, at, cents, userId, hallId] = params as [
        string, Date, number, string, string,
      ];
      const st = store.staticTickets.get(staticKey(hallId, ticketId));
      if (!st) return { rows: [], rowCount: 0 };
      if (st.paid_out_at === null) st.paid_out_at = at;
      st.paid_out_amount_cents = (st.paid_out_amount_cents ?? 0) + cents;
      if (!st.paid_out_by_user_id) st.paid_out_by_user_id = userId;
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`MockPool: unhandled SQL: ${s.slice(0, 120)}`);
  };

  const client = {
    query: runQuery,
    release: () => { /* no-op */ },
  };

  const pool = {
    connect: async () => client,
    query: runQuery,
  } as unknown as Pool;

  return pool;
}

function makeService(
  store: MockStore,
  threshold = ADMIN_APPROVAL_THRESHOLD_CENTS,
): PhysicalTicketPayoutService {
  return PhysicalTicketPayoutService.forTesting(
    makeMockPool(store),
    "public",
    threshold,
  );
}

function seedPending(
  store: MockStore,
  svc: PhysicalTicketPayoutService,
  overrides: Partial<{
    ticketId: string;
    hallId: string;
    scheduledGameId: string;
    patternPhase: string;
    expectedPayoutCents: number;
    responsibleUserId: string;
    color: string;
  }> = {},
): Promise<{ pendingId: string; hallId: string; ticketId: string }> {
  const data = {
    ticketId: overrides.ticketId ?? "100-1001",
    hallId: overrides.hallId ?? "hall-a",
    scheduledGameId: overrides.scheduledGameId ?? "game-1",
    patternPhase: overrides.patternPhase ?? "row_1",
    expectedPayoutCents: overrides.expectedPayoutCents ?? 10_000,
    responsibleUserId: overrides.responsibleUserId ?? "op-a",
    color: overrides.color ?? "small",
  };
  seedStaticTicket(store, data.hallId, data.ticketId);
  return svc.createPendingPayout(data).then((p) => ({
    pendingId: p.id,
    hallId: p.hallId,
    ticketId: p.ticketId,
  }));
}

// ── Input-validering ───────────────────────────────────────────────────────

test("PT4: createPendingPayout validerer påkrevde felter", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.createPendingPayout({
      ticketId: "",
      hallId: "h",
      scheduledGameId: "g",
      patternPhase: "row_1",
      expectedPayoutCents: 100,
      responsibleUserId: "u",
      color: "small",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "INVALID_INPUT",
  );
});

test("PT4: createPendingPayout avviser negativt expectedPayoutCents", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.createPendingPayout({
      ticketId: "100-1001",
      hallId: "hall-a",
      scheduledGameId: "g-1",
      patternPhase: "row_1",
      expectedPayoutCents: -5,
      responsibleUserId: "op-a",
      color: "small",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "INVALID_INPUT",
  );
});

test("PT4: verifyWin validerer påkrevde felter", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.verifyWin({
      pendingPayoutId: "",
      scannedTicketId: "x",
      userId: "op-a",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "INVALID_INPUT",
  );
});

test("PT4: confirmPayout validerer påkrevde felter", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: "", userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "INVALID_INPUT",
  );
});

test("PT4: rejectWin validerer reason", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.rejectWin({
      pendingPayoutId: "pp-1",
      userId: "op-a",
      reason: "",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "INVALID_INPUT",
  );
});

// ── Happy-path ─────────────────────────────────────────────────────────────

test("PT4: createPendingPayout → listPendingForGame returnerer raden", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  const list = await svc.listPendingForGame("game-1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, pendingId);
  assert.equal(list[0]!.ticketId, "100-1001");
});

test("PT4: listPendingForUser returnerer pending for ansvarlig bingovert", async () => {
  const store = newStore();
  const svc = makeService(store);
  await seedPending(store, svc, { responsibleUserId: "op-b" });
  await seedPending(store, svc, {
    ticketId: "200-2001",
    responsibleUserId: "op-a",
  });
  const listA = await svc.listPendingForUser("op-a");
  const listB = await svc.listPendingForUser("op-b");
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]!.ticketId, "200-2001");
});

test("PT4: createPendingPayout er idempotent (ON CONFLICT DO NOTHING)", async () => {
  const store = newStore();
  const svc = makeService(store);
  const first = await svc.createPendingPayout({
    ticketId: "100-1001",
    hallId: "hall-a",
    scheduledGameId: "g-1",
    patternPhase: "row_1",
    expectedPayoutCents: 10_000,
    responsibleUserId: "op-a",
    color: "small",
  });
  const second = await svc.createPendingPayout({
    ticketId: "100-1001",
    hallId: "hall-a",
    scheduledGameId: "g-1",
    patternPhase: "row_1",
    expectedPayoutCents: 20_000, // skulle blitt ignorert
    responsibleUserId: "op-a",
    color: "small",
  });
  assert.equal(first.id, second.id, "samme id — eksisterende rad returnert");
  // Rad skal beholde ORIGINAL beløp, ikke overskrive.
  assert.equal(second.expectedPayoutCents, 10_000);
});

test("PT4: verifyWin — beløp under terskel → needsAdminApproval=false", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 100_000, // 1000 NOK
  });
  const result = await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  assert.equal(result.needsAdminApproval, false);
  assert.equal(result.ticketId, "100-1001");
  assert.equal(result.pattern, "row_1");
  assert.equal(result.color, "small");

  const row = await svc.getById(pendingId);
  assert.ok(row?.verifiedAt);
  assert.equal(row?.verifiedByUserId, "op-a");
});

test("PT4: verifyWin — beløp ≥ terskel → needsAdminApproval=true", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000, // 6000 NOK
  });
  const result = await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  assert.equal(result.needsAdminApproval, true);
  const row = await svc.getById(pendingId);
  assert.equal(row?.adminApprovalRequired, true);
});

test("PT4: confirmPayout happy path (uten admin-approval)", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId, hallId, ticketId } = await seedPending(store, svc);
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: ticketId,
    userId: "op-a",
  });
  const payout = await svc.confirmPayout({
    pendingPayoutId: pendingId,
    userId: "op-a",
  });
  assert.equal(payout.paidOutAmountCents, 10_000);
  assert.equal(payout.ticketId, ticketId);

  const row = await svc.getById(pendingId);
  assert.ok(row?.paidOutAt);
  assert.equal(row?.paidOutByUserId, "op-a");

  // app_static_tickets speilet.
  const st = store.staticTickets.get(staticKey(hallId, ticketId))!;
  assert.ok(st.paid_out_at);
  assert.equal(st.paid_out_amount_cents, 10_000);
  assert.equal(st.paid_out_by_user_id, "op-a");
});

test("PT4: rejectWin happy path", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  const result = await svc.rejectWin({
    pendingPayoutId: pendingId,
    userId: "op-a",
    reason: "Bong ikke frembrakt når bingovert gikk runden.",
  });
  assert.ok(result.rejectedAt);
  const row = await svc.getById(pendingId);
  assert.equal(row?.rejectedByUserId, "op-a");
  assert.equal(row?.rejectedReason, "Bong ikke frembrakt når bingovert gikk runden.");
});

// ── Fail-closed ────────────────────────────────────────────────────────────

test("PT4: verifyWin med scan-mismatch → TICKET_SCAN_MISMATCH", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  await assert.rejects(
    () => svc.verifyWin({
      pendingPayoutId: pendingId,
      scannedTicketId: "WRONG-TICKET",
      userId: "op-a",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "TICKET_SCAN_MISMATCH",
  );
  // Verified_at skal IKKE være satt.
  const row = await svc.getById(pendingId);
  assert.equal(row?.verifiedAt, null);
});

test("PT4: confirmPayout uten verify → NOT_VERIFIED", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "NOT_VERIFIED",
  );
});

test("PT4: confirmPayout med admin-required men uten approval → ADMIN_APPROVAL_REQUIRED", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000,
  });
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "ADMIN_APPROVAL_REQUIRED",
  );
});

test("PT4: adminApprove på pending uten admin_approval_required → ADMIN_APPROVAL_NOT_REQUIRED", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 100_000, // 1000 NOK — under terskel
  });
  await assert.rejects(
    () => svc.adminApprove({ pendingPayoutId: pendingId, adminUserId: "admin-1" }),
    (e: unknown) => e instanceof DomainError && e.code === "ADMIN_APPROVAL_NOT_REQUIRED",
  );
});

test("PT4: rejected pending — verifyWin/adminApprove/confirmPayout feiler", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000,
  });
  await svc.rejectWin({
    pendingPayoutId: pendingId,
    userId: "op-a",
    reason: "test",
  });
  await assert.rejects(
    () => svc.verifyWin({
      pendingPayoutId: pendingId,
      scannedTicketId: "100-1001",
      userId: "op-a",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_REJECTED",
  );
  await assert.rejects(
    () => svc.adminApprove({ pendingPayoutId: pendingId, adminUserId: "admin-1" }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_REJECTED",
  );
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_REJECTED",
  );
});

test("PT4: dobbel confirmPayout → ALREADY_PAID_OUT", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" });
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_PAID_OUT",
  );
});

test("PT4: dobbel rejectWin → ALREADY_REJECTED", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  await svc.rejectWin({
    pendingPayoutId: pendingId,
    userId: "op-a",
    reason: "første",
  });
  await assert.rejects(
    () => svc.rejectWin({
      pendingPayoutId: pendingId,
      userId: "op-a",
      reason: "andre",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_REJECTED",
  );
});

test("PT4: rejectWin etter paid_out → ALREADY_PAID_OUT", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: pendingId, userId: "op-a" });
  await assert.rejects(
    () => svc.rejectWin({
      pendingPayoutId: pendingId,
      userId: "op-a",
      reason: "etter payout",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "ALREADY_PAID_OUT",
  );
});

// ── Admin-approval ─────────────────────────────────────────────────────────

test("PT4: adminApprove happy path", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000,
  });
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  const updated = await svc.adminApprove({
    pendingPayoutId: pendingId,
    adminUserId: "admin-1",
  });
  assert.ok(updated.adminApprovedAt);
  assert.equal(updated.adminApprovedByUserId, "admin-1");
});

test("PT4: confirmPayout fungerer etter adminApprove", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000,
  });
  await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.adminApprove({
    pendingPayoutId: pendingId,
    adminUserId: "admin-1",
  });
  const payout = await svc.confirmPayout({
    pendingPayoutId: pendingId,
    userId: "op-a",
  });
  assert.equal(payout.paidOutAmountCents, 600_000);
});

test("PT4: adminApprove er idempotent", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 600_000,
  });
  const first = await svc.adminApprove({
    pendingPayoutId: pendingId,
    adminUserId: "admin-1",
  });
  const second = await svc.adminApprove({
    pendingPayoutId: pendingId,
    adminUserId: "admin-2",
  });
  // Admin_approved_at og admin_approved_by_user_id bevares fra første kall.
  assert.equal(first.adminApprovedAt, second.adminApprovedAt);
  assert.equal(second.adminApprovedByUserId, "admin-1");
});

// ── Not-found ──────────────────────────────────────────────────────────────

test("PT4: verifyWin på ukjent id → PENDING_PAYOUT_NOT_FOUND", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.verifyWin({
      pendingPayoutId: "ukjent",
      scannedTicketId: "x",
      userId: "op-a",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "PENDING_PAYOUT_NOT_FOUND",
  );
});

test("PT4: confirmPayout på ukjent id → PENDING_PAYOUT_NOT_FOUND", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.confirmPayout({ pendingPayoutId: "ukjent", userId: "op-a" }),
    (e: unknown) => e instanceof DomainError && e.code === "PENDING_PAYOUT_NOT_FOUND",
  );
});

test("PT4: adminApprove på ukjent id → PENDING_PAYOUT_NOT_FOUND", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.adminApprove({
      pendingPayoutId: "ukjent",
      adminUserId: "admin-1",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "PENDING_PAYOUT_NOT_FOUND",
  );
});

test("PT4: rejectWin på ukjent id → PENDING_PAYOUT_NOT_FOUND", async () => {
  const store = newStore();
  const svc = makeService(store);
  await assert.rejects(
    () => svc.rejectWin({
      pendingPayoutId: "ukjent",
      userId: "op-a",
      reason: "x",
    }),
    (e: unknown) => e instanceof DomainError && e.code === "PENDING_PAYOUT_NOT_FOUND",
  );
});

// ── Threshold override ─────────────────────────────────────────────────────

test("PT4: custom threshold i ctor påvirker admin_approval_required-flagg", async () => {
  const store = newStore();
  // Lavere terskel: 100 cents = 1 NOK
  const svc = makeService(store, 100);
  assert.equal(svc.getApprovalThresholdCents(), 100);
  const { pendingId } = await seedPending(store, svc, {
    expectedPayoutCents: 500,
  });
  const row = await svc.getById(pendingId);
  assert.equal(row?.adminApprovalRequired, true);
});

// ── Listings filter ────────────────────────────────────────────────────────

test("PT4: listPendingForGame filtrerer ut paid_out + rejected", async () => {
  const store = newStore();
  const svc = makeService(store);
  const a = await seedPending(store, svc, { ticketId: "100-1001" });
  const b = await seedPending(store, svc, { ticketId: "200-2001" });
  const c = await seedPending(store, svc, { ticketId: "300-3001" });

  // b: paid out.
  await svc.verifyWin({
    pendingPayoutId: b.pendingId,
    scannedTicketId: "200-2001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: b.pendingId, userId: "op-a" });

  // c: rejected.
  await svc.rejectWin({
    pendingPayoutId: c.pendingId,
    userId: "op-a",
    reason: "test",
  });

  const list = await svc.listPendingForGame("game-1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, a.pendingId);
});

test("PT4: listPendingForUser filtrerer ut paid_out + rejected", async () => {
  const store = newStore();
  const svc = makeService(store);
  const a = await seedPending(store, svc, { ticketId: "100-1001" });
  const b = await seedPending(store, svc, { ticketId: "200-2001" });

  await svc.verifyWin({
    pendingPayoutId: a.pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: a.pendingId, userId: "op-a" });

  const list = await svc.listPendingForUser("op-a");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, b.pendingId);
});

test("PT4: verifyWin er idempotent (dobbel scan) — verified_at endres ikke", async () => {
  const store = newStore();
  const svc = makeService(store);
  const { pendingId } = await seedPending(store, svc);
  const first = await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  const rowAfterFirst = await svc.getById(pendingId);
  const firstVerifiedAt = rowAfterFirst?.verifiedAt;
  assert.ok(firstVerifiedAt);

  const second = await svc.verifyWin({
    pendingPayoutId: pendingId,
    scannedTicketId: "100-1001",
    userId: "op-b",
  });
  const rowAfterSecond = await svc.getById(pendingId);
  // Verified_at bevares fra første kall.
  assert.equal(rowAfterSecond?.verifiedAt, firstVerifiedAt);
  assert.equal(rowAfterSecond?.verifiedByUserId, "op-a");
  assert.equal(first.needsAdminApproval, second.needsAdminApproval);
});

test("PT4: flere phase-wins for samme ticket akkumuleres i static_tickets.paid_out_amount_cents", async () => {
  const store = newStore();
  const svc = makeService(store);
  const a = await seedPending(store, svc, {
    ticketId: "100-1001",
    patternPhase: "row_1",
    expectedPayoutCents: 10_000,
  });
  const b = await seedPending(store, svc, {
    ticketId: "100-1001",
    patternPhase: "full_house",
    expectedPayoutCents: 50_000,
  });
  await svc.verifyWin({
    pendingPayoutId: a.pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: a.pendingId, userId: "op-a" });
  await svc.verifyWin({
    pendingPayoutId: b.pendingId,
    scannedTicketId: "100-1001",
    userId: "op-a",
  });
  await svc.confirmPayout({ pendingPayoutId: b.pendingId, userId: "op-a" });

  const st = store.staticTickets.get(staticKey("hall-a", "100-1001"))!;
  assert.equal(st.paid_out_amount_cents, 60_000);
});
