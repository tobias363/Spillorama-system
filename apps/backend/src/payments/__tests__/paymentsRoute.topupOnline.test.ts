/**
 * Scenario A — Tobias 2026-04-26.
 *
 * Endpoint-test for POST /api/payments/topup-online:
 *   - Validerer at paymentMethod er påkrevd
 *   - Validerer beløp (10–10 000 NOK)
 *   - Validerer at ukjente paymentMethod-verdier avvises
 *   - Returnerer { intent, checkoutUrl } ved success
 *   - Sender vippsPhoneNumber gjennom til service-en
 *
 * Vi mocker PlatformService.getUserFromAccessToken til å returnere en
 * fast bruker, og SwedbankPayService.createTopupIntent til å returnere
 * en mock-intent. Selve service-logikken er allerede testet i
 * SwedbankPayService.{paymentMethods,debitOnly}.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPaymentsRouter } from "../../routes/payments.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type {
  SwedbankPayService,
  SwedbankTopupIntent,
  CreateSwedbankTopupIntentInput,
} from "../SwedbankPayService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(): PublicAppUser {
  return {
    id: "user-test-1",
    email: "test@example.no",
    displayName: "Test",
    walletId: "wallet-test-1",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    balance: 0,
  };
}

function makeIntent(overrides: Partial<SwedbankTopupIntent> = {}): SwedbankTopupIntent {
  return {
    id: "intent-1",
    provider: "swedbankpay",
    userId: "user-test-1",
    walletId: "wallet-test-1",
    orderReference: "TOPUP-001",
    payeeReference: "TP-001",
    paymentOrderId: "/psp/paymentorders/po-001",
    amountMajor: 100,
    amountMinor: 10000,
    currency: "NOK",
    status: "INITIALIZED",
    redirectUrl: "https://payex.test/redirect/po-001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paymentMethod: "VISA_DEBIT",
    ...overrides,
  };
}

interface CreateCall {
  input: CreateSwedbankTopupIntentInput;
}

interface MockHarness {
  url: string;
  close: () => Promise<void>;
  createCalls: CreateCall[];
  setNextIntent: (intent: SwedbankTopupIntent) => void;
  setNextError: (err: Error) => void;
}

async function startHarness(): Promise<MockHarness> {
  const createCalls: CreateCall[] = [];
  let nextIntent: SwedbankTopupIntent | null = null;
  let nextError: Error | null = null;

  const platformStub = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (!token || token === "INVALID") {
        throw new DomainError("UNAUTHORIZED", "Mangler access token.");
      }
      return makeUser();
    },
  } as unknown as PlatformService;

  const swedbankStub = {
    async createTopupIntent(
      input: CreateSwedbankTopupIntentInput
    ): Promise<SwedbankTopupIntent> {
      createCalls.push({ input });
      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }
      const intent = nextIntent ?? makeIntent({ paymentMethod: input.paymentMethod });
      nextIntent = null;
      return intent;
    },
  } as unknown as SwedbankPayService;

  const router = createPaymentsRouter({
    platformService: platformStub,
    swedbankPayService: swedbankStub,
    emitWalletRoomUpdates: async () => {
      /* noop */
    },
    swedbankWebhookSecret: "test-secret",
  });

  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => resolve())
      ),
    createCalls,
    setNextIntent: (intent) => {
      nextIntent = intent;
    },
    setNextError: (err) => {
      nextError = err;
    },
  };
}

async function postJson(
  url: string,
  body: unknown,
  authToken = "valid-token"
): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("POST /api/payments/topup-online — happy path returns checkoutUrl + intent", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 250,
      paymentMethod: "VISA_DEBIT",
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.checkoutUrl, "https://payex.test/redirect/po-001");
    assert.equal(json.data.intent.paymentMethod, "VISA_DEBIT");
    assert.equal(json.data.intent.amountMajor, 100);

    assert.equal(h.createCalls.length, 1);
    assert.equal(h.createCalls[0].input.userId, "user-test-1");
    assert.equal(h.createCalls[0].input.walletId, "wallet-test-1");
    assert.equal(h.createCalls[0].input.amountMajor, 250);
    assert.equal(h.createCalls[0].input.paymentMethod, "VISA_DEBIT");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — vippsPhoneNumber forwarded to service", async () => {
  const h = await startHarness();
  try {
    const { status } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
      paymentMethod: "VIPPS",
      vippsPhoneNumber: "+4790000000",
    });
    assert.equal(status, 200);
    assert.equal(h.createCalls[0].input.paymentMethod, "VIPPS");
    assert.equal(h.createCalls[0].input.vippsPhoneNumber, "+4790000000");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — accepts case-insensitive paymentMethod", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
      paymentMethod: "visa-debit",
    });
    assert.equal(status, 200);
    assert.equal(json.data.intent.paymentMethod, "VISA_DEBIT");
    assert.equal(h.createCalls[0].input.paymentMethod, "VISA_DEBIT");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — missing paymentMethod is 4xx with INVALID_PAYMENT_METHOD", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "INVALID_PAYMENT_METHOD");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — unknown paymentMethod is 4xx", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
      paymentMethod: "PAYPAL",
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "INVALID_PAYMENT_METHOD");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — generic VISA (uten Debit) avvises", async () => {
  // REGULATORISK: kunde kan ikke velge "VISA" og dermed unngå
  // debit-only-restriksjon. Sjekk at vi avviser den eksplisitt.
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
      paymentMethod: "VISA",
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, "INVALID_PAYMENT_METHOD");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — beløp under minimum avvises", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 5,
      paymentMethod: "VIPPS",
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "AMOUNT_TOO_SMALL");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — beløp over maksimum avvises", async () => {
  const h = await startHarness();
  try {
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 50000,
      paymentMethod: "VIPPS",
    });
    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "AMOUNT_TOO_LARGE");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — uten gyldig auth-token avvises", async () => {
  // apiFailure mapper UNAUTHORIZED til 4xx-respons; status-kode kan
  // variere (400/401) avhengig av httpHelpers-versjonen. Vi sjekker
  // primært at error-koden er korrekt og at request ikke nådde
  // service-laget.
  const h = await startHarness();
  try {
    const { status, json } = await postJson(
      `${h.url}/api/payments/topup-online`,
      { amount: 100, paymentMethod: "VIPPS" },
      "INVALID"
    );
    assert.ok(status >= 400 && status < 500, `forventet 4xx, fikk ${status}`);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "UNAUTHORIZED");
    assert.equal(h.createCalls.length, 0, "service skal ikke kalles ved auth-feil");
  } finally {
    await h.close();
  }
});

test("POST /api/payments/topup-online — service-feil propageres som 4xx error-shape", async () => {
  const h = await startHarness();
  try {
    h.setNextError(
      new DomainError("CREDIT_CARD_FORBIDDEN", "Kun debetkort er tillatt for innskudd.")
    );
    const { status, json } = await postJson(`${h.url}/api/payments/topup-online`, {
      amount: 100,
      paymentMethod: "VISA_DEBIT",
    });
    // Service-feil ekvivalent med klient-feil → apiFailure-mapping
    assert.equal(status, 400);
    assert.equal(json.error.code, "CREDIT_CARD_FORBIDDEN");
    assert.match(json.error.message, /debetkort/i);
  } finally {
    await h.close();
  }
});
