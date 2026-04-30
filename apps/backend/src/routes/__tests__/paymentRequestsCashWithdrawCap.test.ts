/**
 * HV2-A / BIR-036: integration-tester for kontant-utbetaling-cap i
 * `POST /api/admin/payments/requests/:id/accept`.
 *
 * Verifiserer:
 *   * Cash-withdraw (`destination_type='hall'`) over cap → 400 med
 *     `CASH_WITHDRAW_CAP_EXCEEDED` + `details.remainingCapCents`.
 *   * Cash-withdraw under cap → 200 + bucket inkrementeres.
 *   * Bank-withdraw (`destination_type='bank'`) → INGEN cap-sjekk,
 *     går gjennom selv om beløpet er over 50 000 kr.
 *   * Audit-log skrives med riktig action-name ved cap-exceed.
 *
 * Mønster: speiler paymentRequestsHallScope.test.ts — starter en
 * lokal express-server med fetch.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPaymentRequestsRouter } from "../paymentRequests.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  PaymentRequestService,
  PaymentRequest,
  PaymentRequestKind,
  PaymentRequestDestinationType,
} from "../../payments/PaymentRequestService.js";
import type {
  HallCashWithdrawalCapService,
} from "../../agent/HallCashWithdrawalCapService.js";
import type {
  AuditLogService,
  AuditLogInput,
} from "../../compliance/AuditLogService.js";
import { DomainError } from "../../errors/DomainError.js";

function makeUser(
  id: string,
  role: PublicAppUser["role"],
  hallId: string | null
): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `wallet-${id}`,
    role,
    hallId,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

function makeWithdrawRequest(
  id: string,
  hallId: string,
  amountCents: number,
  destinationType: PaymentRequestDestinationType
): PaymentRequest {
  return {
    id,
    kind: "withdraw",
    userId: "player-1",
    walletId: "wallet-player-1",
    amountCents,
    hallId,
    submittedBy: "player-1",
    status: "PENDING",
    rejectionReason: null,
    acceptedBy: null,
    acceptedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    walletTransactionId: null,
    destinationType,
    createdAt: "2026-04-30T08:00:00Z",
    updatedAt: "2026-04-30T08:00:00Z",
  };
}

interface CapServiceSpy {
  assertCalls: Array<{ hallId: string; amountCents: number }>;
  recordCalls: Array<{ hallId: string; amountCents: number }>;
  /** Hvis satt: assertWithinCap vil kaste denne på neste call. */
  assertThrows?: DomainError;
  /** Hvis satt: recordWithdrawal vil kaste denne på neste call. */
  recordThrows?: DomainError;
}

interface AuditSpy {
  records: AuditLogInput[];
}

interface TestHarness {
  baseUrl: string;
  capSpy: CapServiceSpy;
  auditSpy: AuditSpy;
  acceptedIds: string[];
}

async function withServer(
  users: Record<string, PublicAppUser>,
  requests: Record<string, PaymentRequest>,
  run: (h: TestHarness) => Promise<void>
): Promise<void> {
  const acceptedIds: string[] = [];
  const capSpy: CapServiceSpy = {
    assertCalls: [],
    recordCalls: [],
  };
  const auditSpy: AuditSpy = { records: [] };

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const user = users[token];
      if (!user) throw new Error("UNAUTHORIZED");
      return user;
    },
  } as unknown as PlatformService;

  const paymentRequestService = {
    async getRequest(_kind: PaymentRequestKind, id: string): Promise<PaymentRequest> {
      const r = requests[id];
      if (!r) throw new DomainError("PAYMENT_REQUEST_NOT_FOUND", "missing");
      return r;
    },
    async acceptWithdraw({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      acceptedIds.push(requestId);
      return {
        ...requests[requestId]!,
        status: "ACCEPTED",
        walletTransactionId: `wtx-${requestId}`,
      };
    },
    async acceptDeposit({ requestId }: { requestId: string }): Promise<PaymentRequest> {
      acceptedIds.push(requestId);
      return { ...requests[requestId]!, status: "ACCEPTED" };
    },
    async rejectDeposit() {
      throw new Error("not implemented for these tests");
    },
    async rejectWithdraw() {
      throw new Error("not implemented for these tests");
    },
    async listPending() {
      return [];
    },
  } as unknown as PaymentRequestService;

  const cashWithdrawalCapService: HallCashWithdrawalCapService = {
    async assertWithinCap(hallId: string, amountCents: number) {
      capSpy.assertCalls.push({ hallId, amountCents });
      if (capSpy.assertThrows) {
        const err = capSpy.assertThrows;
        capSpy.assertThrows = undefined;
        throw err;
      }
    },
    async recordWithdrawal(hallId: string, amountCents: number) {
      capSpy.recordCalls.push({ hallId, amountCents });
      if (capSpy.recordThrows) {
        const err = capSpy.recordThrows;
        capSpy.recordThrows = undefined;
        throw err;
      }
    },
    async getRemainingCapCents() {
      return 5_000_000;
    },
  } as unknown as HallCashWithdrawalCapService;

  const auditLogService: AuditLogService = {
    async record(input: AuditLogInput) {
      auditSpy.records.push(input);
    },
  } as unknown as AuditLogService;

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentRequestsRouter({
      platformService,
      paymentRequestService,
      emitWalletRoomUpdates: async () => {},
      cashWithdrawalCapService,
      auditLogService,
      now: () => Date.parse("2026-04-30T12:00:00Z"),
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run({ baseUrl, capSpy, auditSpy, acceptedIds });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postAccept(
  baseUrl: string,
  id: string,
  token: string
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/admin/payments/requests/${id}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: "withdraw" }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("BIR-036: cash-withdraw under cap → 200, cap-service kalles for både assert og record", async () => {
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const requests = {
    "req-1": makeWithdrawRequest("req-1", "hall-a", 1_000_000, "hall"),
  };
  await withServer(users, requests, async (h) => {
    const res = await postAccept(h.baseUrl, "req-1", "admin");
    assert.equal(res.status, 200);
    assert.deepEqual(h.capSpy.assertCalls, [
      { hallId: "hall-a", amountCents: 1_000_000 },
    ]);
    assert.deepEqual(h.capSpy.recordCalls, [
      { hallId: "hall-a", amountCents: 1_000_000 },
    ]);
    assert.deepEqual(h.acceptedIds, ["req-1"]);
    // Ingen audit-events: alt gikk bra.
    assert.equal(h.auditSpy.records.length, 0);
  });
});

test("BIR-036: cash-withdraw over cap → 400 CASH_WITHDRAW_CAP_EXCEEDED + audit-log + ingen accept", async () => {
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const requests = {
    "req-2": makeWithdrawRequest("req-2", "hall-a", 5_000_100, "hall"),
  };
  await withServer(users, requests, async (h) => {
    h.capSpy.assertThrows = new DomainError(
      "CASH_WITHDRAW_CAP_EXCEEDED",
      "Daglig kontant-utbetaling-grense for hall hall-a er nådd.",
      {
        hallId: "hall-a",
        businessDate: "2026-04-30",
        requestedAmountCents: 5_000_100,
        remainingCapCents: 0,
        capCents: 5_000_000,
      }
    );

    const res = await postAccept(h.baseUrl, "req-2", "admin");
    assert.equal(res.status, 400);
    const body = res.json as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    assert.equal(body.error?.code, "CASH_WITHDRAW_CAP_EXCEEDED");
    assert.equal(body.error?.details?.remainingCapCents, 0);

    // recordWithdrawal skal IKKE være kalt (assertWithinCap kastet før).
    assert.deepEqual(h.capSpy.recordCalls, []);
    // Wallet-debit / accept-kall skal IKKE være kjørt.
    assert.deepEqual(h.acceptedIds, []);
    // Audit-log skal være skrevet (fire-and-forget).
    // Vente litt for fire-and-forget Promise å fullføres.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.auditSpy.records.length, 1);
    const auditEvent = h.auditSpy.records[0]!;
    assert.equal(auditEvent.action, "cash_withdrawal.cap_exceeded");
    assert.equal(auditEvent.resource, "payment_request");
    assert.equal(auditEvent.resourceId, "req-2");
    assert.equal(auditEvent.actorId, "admin");
    assert.equal(auditEvent.actorType, "ADMIN");
    assert.equal(auditEvent.details?.hallId, "hall-a");
    assert.equal(auditEvent.details?.requestedAmountCents, 5_000_100);
  });
});

test("BIR-036: bank-withdraw — INGEN cap-sjekk, går gjennom selv med stort beløp", async () => {
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const requests = {
    "req-bank": makeWithdrawRequest("req-bank", "hall-a", 100_000_000, "bank"),
    // 1_000_000 kr — langt over kontant-cap, men bank har ingen grense.
  };
  await withServer(users, requests, async (h) => {
    const res = await postAccept(h.baseUrl, "req-bank", "admin");
    assert.equal(res.status, 200);
    // Cap-service skal IKKE være kalt for bank-withdraw.
    assert.deepEqual(h.capSpy.assertCalls, []);
    assert.deepEqual(h.capSpy.recordCalls, []);
    assert.deepEqual(h.acceptedIds, ["req-bank"]);
    assert.equal(h.auditSpy.records.length, 0);
  });
});

test("BIR-036: deposit-request — INGEN cap-sjekk (kun withdraw-flyt har cap)", async () => {
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const depositReq: PaymentRequest = {
    id: "req-dep",
    kind: "deposit",
    userId: "player-1",
    walletId: "wallet-player-1",
    amountCents: 100_000_000,
    hallId: "hall-a",
    submittedBy: "player-1",
    status: "PENDING",
    rejectionReason: null,
    acceptedBy: null,
    acceptedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    walletTransactionId: null,
    destinationType: null,
    createdAt: "2026-04-30T08:00:00Z",
    updatedAt: "2026-04-30T08:00:00Z",
  };
  const requests = { "req-dep": depositReq };

  await withServer(users, requests, async (h) => {
    const res = await fetch(`${h.baseUrl}/api/admin/payments/requests/req-dep/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer admin",
      },
      body: JSON.stringify({ type: "deposit" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(h.capSpy.assertCalls, []);
    assert.deepEqual(h.capSpy.recordCalls, []);
    assert.deepEqual(h.acceptedIds, ["req-dep"]);
  });
});

test("BIR-036: cash-withdraw uten hallId → cap-sjekk hopper over (ikke kjørt)", async () => {
  // Hvis destination_type='hall' men hall_id=null (legacy/edge case),
  // skal vi ikke håndheve cap. Hall-scope-sjekken før blokkerer
  // HALL_OPERATOR uansett, og ADMIN skal ikke trigge cap når hall ikke
  // er bestemt (vi vet ikke hvilken cap-bucket).
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const req: PaymentRequest = {
    ...makeWithdrawRequest("req-noh", "hall-a", 5_000_000, "hall"),
    hallId: null,
  };
  const requests = { "req-noh": req };

  await withServer(users, requests, async (h) => {
    const res = await postAccept(h.baseUrl, "req-noh", "admin");
    assert.equal(res.status, 200);
    assert.deepEqual(h.capSpy.assertCalls, []);
    assert.deepEqual(h.capSpy.recordCalls, []);
  });
});

test("BIR-036: race-tap — recordWithdrawal feiler etter wallet-debit → 400 + audit-log med raceLossPostDebit", async () => {
  const users = { admin: makeUser("admin", "ADMIN", null) };
  const requests = {
    "req-race": makeWithdrawRequest("req-race", "hall-a", 100_000, "hall"),
  };
  await withServer(users, requests, async (h) => {
    // assertWithinCap lykkes (det er nok plass når vi sjekker)
    // men recordWithdrawal taper racen — bucket fyltes opp i
    // mellomtiden av en konkurrent.
    h.capSpy.recordThrows = new DomainError(
      "CASH_WITHDRAW_CAP_EXCEEDED",
      "race lost",
      {
        hallId: "hall-a",
        businessDate: "2026-04-30",
        requestedAmountCents: 100_000,
        remainingCapCents: 0,
        capCents: 5_000_000,
      }
    );

    const res = await postAccept(h.baseUrl, "req-race", "admin");
    assert.equal(res.status, 400);
    const body = res.json as { error?: { code?: string } };
    assert.equal(body.error?.code, "CASH_WITHDRAW_CAP_EXCEEDED");

    // Wallet-debit kjørte (acceptWithdraw kalt) før vi tapte racen.
    assert.deepEqual(h.acceptedIds, ["req-race"]);
    // assert + record begge kalt.
    assert.equal(h.capSpy.assertCalls.length, 1);
    assert.equal(h.capSpy.recordCalls.length, 1);

    // Audit-log må flagge raceLossPostDebit (kritisk for ops å se
    // at en wallet-tx er utestående uten cap-reservation).
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.auditSpy.records.length, 1);
    const auditEvent = h.auditSpy.records[0]!;
    assert.equal(auditEvent.action, "cash_withdrawal.cap_exceeded");
    assert.equal(auditEvent.details?.raceLossPostDebit, true);
    assert.equal(
      auditEvent.details?.walletTransactionId,
      "wtx-req-race"
    );
  });
});
