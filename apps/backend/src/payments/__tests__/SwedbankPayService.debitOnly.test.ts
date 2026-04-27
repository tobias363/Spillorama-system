/**
 * Scenario A — Tobias 2026-04-26.
 *
 * REGULATORY integration-test: Swedbank-callback fra Visa CREDIT card.
 *
 * Flow:
 *   1. Vi seeder en intent (status=CREATED) i mock-Pool — som om
 *      createTopupIntent allerede har blitt kalt med VISA_DEBIT.
 *   2. Vi simulerer at en kunde har autorisert betalingen, men kortet
 *      var faktisk et CREDIT-kort (cardFundingType="credit" fra Swedbank).
 *      Dette kan skje hvis brand-listen ikke 100 % filtrerte i widget-en
 *      (f.eks. cross-border-kort, business-kort, eller hvis Swedbanks
 *      brand-mapping er forsinket).
 *   3. processCallback skal:
 *        a) hente paymentOrder fra Swedbank API → vi mocker fetch
 *        b) se at cardFundingType="DEBIT" feiler isAcceptableFundingType
 *        c) markere intent som REJECTED + populere rejection_reason
 *           = "CREDIT_CARD_FORBIDDEN"
 *        d) kalle Swedbank /cancellations (best-effort) for å reverere
 *           autorisering
 *        e) IKKE kreditere wallet
 *        f) emit "payment.online.rejected" til auditLogger
 *
 * Vi mocker fetch slik at vi kan verifisere både GET (paymentOrder
 * fetch) og POST (cancellations).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  SwedbankPayService,
  type AuditLogger,
} from "../SwedbankPayService.js";
import type { WalletAdapter, WalletTransaction } from "../../adapters/WalletAdapter.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Mock pg.Pool ────────────────────────────────────────────────────────────

interface IntentRow {
  id: string;
  provider: string;
  user_id: string;
  wallet_id: string;
  order_reference: string;
  payee_reference: string;
  swedbank_payment_order_id: string;
  amount_minor: string;
  amount_major: string;
  currency: string;
  status: string;
  checkout_redirect_url: string | null;
  checkout_view_url: string | null;
  credited_transaction_id: string | null;
  credited_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  payment_method: string | null;
  card_funding_type: string | null;
  card_brand: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
}

function makeMockPool(seed: IntentRow[]): {
  pool: Pool;
  rows: Map<string, IntentRow>;
} {
  const rows = new Map<string, IntentRow>();
  for (const r of seed) rows.set(r.id, r);

  function runQuery(sql: string, params: unknown[]): { rows: IntentRow[] } {
    const upper = sql.trim().slice(0, 16).toUpperCase();
    if (
      upper.startsWith("BEGIN") ||
      upper.startsWith("COMMIT") ||
      upper.startsWith("ROLLBACK") ||
      upper.startsWith("CREATE ") ||
      upper.startsWith("ALTER ") ||
      upper.startsWith("COMMENT")
    ) {
      return { rows: [] };
    }

    if (upper.startsWith("SELECT")) {
      // Match by id, by order_reference, eller by payment_order_id.
      if (sql.includes("WHERE id = $1")) {
        const id = params[0] as string;
        const row = rows.get(id);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (sql.includes("WHERE order_reference = $1")) {
        const orderRef = params[0] as string;
        const row = [...rows.values()].find((r) => r.order_reference === orderRef);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (sql.includes("WHERE swedbank_payment_order_id = $1")) {
        const oid = params[0] as string;
        const row = [...rows.values()].find((r) => r.swedbank_payment_order_id === oid);
        return { rows: row ? [{ ...row }] : [] };
      }
      return { rows: [] };
    }

    if (upper.startsWith("UPDATE")) {
      const id = params[0] as string;
      const row = rows.get(id);
      if (!row) return { rows: [] };
      // Detekter hvilken UPDATE-shape vi har
      if (sql.includes("status = 'CREDITED'")) {
        row.status = "CREDITED";
        row.credited_transaction_id = params[2] as string;
        row.credited_at = new Date();
        row.card_funding_type = (params[3] as string) ?? row.card_funding_type;
        row.card_brand = (params[4] as string) ?? row.card_brand;
      } else if (sql.includes("status = 'REJECTED'")) {
        row.status = "REJECTED";
        row.rejected_at = new Date();
        row.rejection_reason = params[1] as string;
        row.card_funding_type = (params[2] as string) ?? row.card_funding_type;
        row.card_brand = (params[3] as string) ?? row.card_brand;
      } else if (sql.includes("SET status = ") && sql.includes("last_error")) {
        // updateIntentError eller updateIntentStatus
        const newStatus = params[1] as string;
        if (newStatus) row.status = newStatus;
        row.last_error = (params[2] as string) ?? row.last_error;
      } else if (sql.includes("swedbank_payment_order_id = $2")) {
        row.swedbank_payment_order_id = params[1] as string;
      }
      row.updated_at = new Date();
      return { rows: [{ ...row }] };
    }

    return { rows: [] };
  }

  const clientShim = {
    query: async (sql: string, params: unknown[] = []) => runQuery(sql, params),
    release: () => undefined,
  };
  const poolShim = {
    connect: async () => clientShim,
    query: async (sql: string, params: unknown[] = []) => runQuery(sql, params),
  };
  return { pool: poolShim as unknown as Pool, rows };
}

// ── Mock WalletAdapter ──────────────────────────────────────────────────────

function makeMockWallet(): {
  adapter: WalletAdapter;
  topUps: Array<{ accountId: string; amount: number }>;
} {
  const topUps: Array<{ accountId: string; amount: number }> = [];
  let nextTxId = 1;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("nope");
    },
    async ensureAccount() {
      return {
        id: "x",
        balance: 0,
        depositBalance: 0,
        winningsBalance: 0,
        createdAt: "",
        updatedAt: "",
      };
    },
    async getAccount() {
      throw new Error("nope");
    },
    async listTransactions() {
      return [];
    },
    async listAccounts() {
      return [];
    },
    async listAllAccounts() {
      return [];
    },
    async transfer() {
      throw new Error("nope");
    },
    async withdraw() {
      throw new Error("nope");
    },
    async topUp(accountId: string, amount: number): Promise<WalletTransaction> {
      topUps.push({ accountId, amount });
      return {
        id: `wtx-${nextTxId++}`,
        accountId,
        type: "CREDIT",
        amount,
        reason: "",
        createdAt: new Date().toISOString(),
      };
    },
  } as unknown as WalletAdapter;
  return { adapter, topUps };
}

// ── Mock fetch ──────────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function installFetchMock(
  responder: (url: string, init: RequestInit) => Response
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = (init.method || "GET").toUpperCase();
    let parsedBody: unknown = undefined;
    if (typeof init.body === "string" && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    return responder(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Setup helpers ───────────────────────────────────────────────────────────

function makeService(
  pool: Pool,
  walletAdapter: WalletAdapter,
  audit?: AuditLogger
): SwedbankPayService {
  const svc = new SwedbankPayService(walletAdapter, {
    connectionString: "postgres://test/test",
    schema: "public",
    apiBaseUrl: "https://api.test.swedbankpay.com",
    accessToken: "test-token",
    payeeId: "payee-123",
    callbackUrl: "https://test/callback",
    completeUrl: "https://test/complete",
    cancelUrl: "https://test/cancel",
  });
  // Replace internal pool with our mock — service eier ikke pool-felt
  // direkte som offentlig API; vi setter via Object.defineProperty for
  // testing. Service bruker `this.pool` internt, så vi overskriver det.
  Object.defineProperty(svc as unknown as { pool: Pool }, "pool", {
    value: pool,
    writable: true,
    configurable: true,
  });
  // Skip schema-init (vi bruker mock-Pool som ikke har real DB).
  Object.defineProperty(svc as unknown as { initPromise: Promise<void> }, "initPromise", {
    value: Promise.resolve(),
    writable: true,
    configurable: true,
  });
  if (audit) svc.setAuditLogger(audit);
  return svc;
}

function seedIntent(): IntentRow {
  return {
    id: "intent-credit-test-001",
    provider: "swedbankpay",
    user_id: "user-1",
    wallet_id: "wallet-1",
    order_reference: "TOPUP-ORDER-001",
    payee_reference: "TP-PAYEE-001",
    swedbank_payment_order_id: "/psp/paymentorders/po-001",
    amount_minor: "10000",
    amount_major: "100.00",
    currency: "NOK",
    status: "CREATED",
    checkout_redirect_url: "https://payex.test/redirect/po-001",
    checkout_view_url: null,
    credited_transaction_id: null,
    credited_at: null,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    payment_method: "VISA_DEBIT",
    card_funding_type: null,
    card_brand: null,
    rejected_at: null,
    rejection_reason: null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("processCallback rejects credit-card payment + audits + does NOT credit wallet", async () => {
  const { pool, rows } = makeMockPool([seedIntent()]);
  const { adapter, topUps } = makeMockWallet();

  const auditEvents: Array<{ action: string; details?: Record<string, unknown> }> = [];
  const auditLogger: AuditLogger = {
    async record(input) {
      auditEvents.push({ action: input.action, details: input.details });
    },
  };

  const fetchMock = installFetchMock((url, init) => {
    const method = (init.method || "GET").toUpperCase();
    // GET paymentOrder?$expand=paid → returnerer CREDIT-funding
    if (method === "GET" && url.includes("/psp/paymentorders/po-001")) {
      return jsonResponse({
        paymentOrder: {
          id: "/psp/paymentorders/po-001",
          status: "Paid",
          amount: 10000,
          currency: "NOK",
          paid: {
            cardFundingType: "credit", // ← REGULATORISK FORBUDT
            cardBrand: "Visa",
          },
        },
      });
    }
    // POST /cancellations (best-effort fra reject-flow)
    if (method === "POST" && url.includes("/cancellations")) {
      return jsonResponse({ cancellation: { id: "cxl-1" } });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });

  try {
    const svc = makeService(pool, adapter, auditLogger);
    await assert.rejects(
      svc.processCallback({
        paymentOrder: { id: "/psp/paymentorders/po-001" },
        orderReference: "TOPUP-ORDER-001",
      }),
      (err: unknown) =>
        err instanceof DomainError && err.code === "CREDIT_CARD_FORBIDDEN"
    );
  } finally {
    fetchMock.restore();
  }

  // 1. Wallet ble IKKE kreditert
  assert.equal(topUps.length, 0, "wallet topUp må ikke skje for CREDIT-kort");

  // 2. Intent ble markert REJECTED + reason persistert
  const finalRow = rows.get("intent-credit-test-001");
  assert.ok(finalRow, "intent må fortsatt eksistere");
  assert.equal(finalRow.status, "REJECTED");
  assert.equal(finalRow.rejection_reason, "CREDIT_CARD_FORBIDDEN");
  assert.ok(finalRow.rejected_at, "rejected_at må være satt");

  // 3. Cancel-call mot Swedbank gikk gjennom (best-effort)
  const cancelCalls = fetchMock.calls.filter(
    (c) => c.method === "POST" && c.url.includes("/cancellations")
  );
  assert.equal(cancelCalls.length, 1, "skal kalle Swedbank /cancellations én gang");

  // 4. Audit-event "payment.online.rejected" ble emittet
  const rejectAudit = auditEvents.find((e) => e.action === "payment.online.rejected");
  assert.ok(rejectAudit, "skal emit payment.online.rejected");
  assert.equal(rejectAudit.details?.reason, "CREDIT_CARD_FORBIDDEN");
  assert.equal(rejectAudit.details?.paymentMethod, "VISA_DEBIT");
  assert.equal(rejectAudit.details?.cardFundingType, "CREDIT");
  assert.equal(rejectAudit.details?.amountCents, 10000);

  // 5. Ingen "payment.online.completed" emittert
  assert.equal(
    auditEvents.find((e) => e.action === "payment.online.completed"),
    undefined,
    "completed-event må IKKE emittes når vi avviste"
  );
});

test("processCallback accepts DEBIT card + credits wallet + audits completed", async () => {
  const { pool, rows } = makeMockPool([seedIntent()]);
  const { adapter, topUps } = makeMockWallet();
  const auditEvents: Array<{ action: string; details?: Record<string, unknown> }> = [];
  const auditLogger: AuditLogger = {
    async record(input) {
      auditEvents.push({ action: input.action, details: input.details });
    },
  };

  const fetchMock = installFetchMock((url, init) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && url.includes("/psp/paymentorders/po-001")) {
      return jsonResponse({
        paymentOrder: {
          id: "/psp/paymentorders/po-001",
          status: "Paid",
          amount: 10000,
          currency: "NOK",
          paid: {
            cardFundingType: "debit",
            cardBrand: "Visa",
          },
        },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });

  try {
    const svc = makeService(pool, adapter, auditLogger);
    const result = await svc.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-001" },
      orderReference: "TOPUP-ORDER-001",
    });
    assert.equal(result.walletCreditedNow, true);
  } finally {
    fetchMock.restore();
  }

  // Wallet ble kreditert med 100 NOK
  assert.equal(topUps.length, 1);
  assert.equal(topUps[0].amount, 100);
  assert.equal(topUps[0].accountId, "wallet-1");

  const finalRow = rows.get("intent-credit-test-001");
  assert.ok(finalRow);
  assert.equal(finalRow.status, "CREDITED");
  assert.equal(finalRow.card_funding_type, "DEBIT");

  const completedAudit = auditEvents.find((e) => e.action === "payment.online.completed");
  assert.ok(completedAudit, "skal emit payment.online.completed");
  assert.equal(completedAudit.details?.cardFundingType, "DEBIT");
  assert.equal(completedAudit.details?.paymentMethod, "VISA_DEBIT");
});

test("processCallback accepts Vipps even uten cardFundingType i paid-resource", async () => {
  // Vipps og andre mobile-wallets returnerer som regel ikke
  // cardFundingType — wallet-en selv håndhever underlying funding
  // restrictions. Vi skal IKKE avvise disse på manglende fundingType.
  const seed: IntentRow = { ...seedIntent(), payment_method: "VIPPS" };
  const { pool, rows } = makeMockPool([seed]);
  const { adapter, topUps } = makeMockWallet();

  const fetchMock = installFetchMock((url, init) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && url.includes("/psp/paymentorders/po-001")) {
      return jsonResponse({
        paymentOrder: {
          id: "/psp/paymentorders/po-001",
          status: "Paid",
          amount: 10000,
          currency: "NOK",
          paid: {
            // Ingen cardFundingType — typisk Vipps-respons
            cardBrand: "Vipps",
          },
        },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });

  try {
    const svc = makeService(pool, adapter);
    const result = await svc.processCallback({
      paymentOrder: { id: "/psp/paymentorders/po-001" },
      orderReference: "TOPUP-ORDER-001",
    });
    assert.equal(result.walletCreditedNow, true);
  } finally {
    fetchMock.restore();
  }

  assert.equal(topUps.length, 1, "Vipps skal kreditere wallet");
  const finalRow = rows.get("intent-credit-test-001");
  assert.equal(finalRow?.status, "CREDITED");
});
