/**
 * PR-W2 wallet-split: regulatorisk gate-test for admin-wallet-credit-endepunktet.
 *
 * Dekker:
 *   - POST /api/admin/wallets/:walletId/credit med `to: "winnings"` → HTTP 403
 *     med error.code `ADMIN_WINNINGS_CREDIT_FORBIDDEN` (pengespillforskriften §11).
 *   - POST med `to: "deposit"` → HTTP 200, wallet kreditert på deposit-siden.
 *   - POST uten `to` → HTTP 200, defaulter til deposit-siden.
 *   - Ikke-admin (PLAYER) → FORBIDDEN (WALLET_COMPLIANCE_WRITE-gate).
 *   - Invalid `to`-verdi → INVALID_INPUT.
 *
 * Testen bruker ekte InMemoryWalletAdapter så vi kan verifisere at
 * `getDepositBalance` / `getWinningsBalance` stemmer etter credit-kallet.
 *
 * Regulatorisk begrunnelse:
 *   Norsk pengespillforskrift §11 — loss-limit-beregningen bygger på at
 *   winnings-trekk ikke teller som tap. Hvis admin kunne kreditere direkte
 *   til winnings, ville admin kunne utdele "bonus" som omgår loss-limit.
 *   Dette er ikke lov. Gaten må være hard-kodet, ikke bare dokumentert.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminWalletRouter } from "../adminWallet.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(role: PublicAppUser["role"], id = "u-1"): PublicAppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role,
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  };
}

interface Ctx {
  baseUrl: string;
  wallet: InMemoryWalletAdapter;
  close: () => Promise<void>;
}

async function startServer(users: Record<string, PublicAppUser>): Promise<Ctx> {
  const wallet = new InMemoryWalletAdapter(0);
  // Seed test-wallet med kjent initial-saldo (100 kr deposit).
  await wallet.createAccount({ accountId: "wallet-target", initialBalance: 100 });

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const router = createAdminWalletRouter({
    platformService,
    walletAdapter: wallet,
  });
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    wallet,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function postCredit(
  ctx: Ctx,
  token: string,
  walletId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string; message?: string } } }> {
  const res = await fetch(
    `${ctx.baseUrl}/api/admin/wallets/${walletId}/credit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  return { status: res.status, body: json as never };
}

// ── Regulatorisk gate (PR-W2 hovedkontrakt) ─────────────────────────────────

test("PR-W2 gate: POST med `to: \"winnings\"` → 403 ADMIN_WINNINGS_CREDIT_FORBIDDEN", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 50,
      reason: "admin correction",
      to: "winnings",
    });
    // HTTP 403 — hard-kodet i adminWallet.ts for regulatorisk signalisering.
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "ADMIN_WINNINGS_CREDIT_FORBIDDEN");

    // Wallet-state uendret — credit-forsøket aldri traff adapteret.
    const balances = await ctx.wallet.getBothBalances("wallet-target");
    assert.equal(balances.deposit, 100, "deposit uendret");
    assert.equal(balances.winnings, 0, "winnings uendret (alltid 0 gjennom admin-route)");
  } finally {
    await ctx.close();
  }
});

test("PR-W2 gate: POST med `to: \"deposit\"` eksplisitt → 200 OK + lander på deposit-siden", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 25,
      reason: "manual correction deposit",
      to: "deposit",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // 100 (seed) + 25 = 125 på deposit-siden; winnings uendret.
    const balances = await ctx.wallet.getBothBalances("wallet-target");
    assert.equal(balances.deposit, 125);
    assert.equal(balances.winnings, 0);
    assert.equal(balances.total, 125);
  } finally {
    await ctx.close();
  }
});

test("PR-W2 gate: POST uten `to`-felt → 200 OK + defaulter til deposit", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 10,
      reason: "no-field correction",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // Default = deposit (matcher CreditOptions-kontrakt i WalletAdapter).
    const balances = await ctx.wallet.getBothBalances("wallet-target");
    assert.equal(balances.deposit, 110);
    assert.equal(balances.winnings, 0);
  } finally {
    await ctx.close();
  }
});

// ── Rolle-gating (WALLET_COMPLIANCE_WRITE) ─────────────────────────────────

test("adminWallet: PLAYER → FORBIDDEN (WALLET_COMPLIANCE_WRITE kreves)", async () => {
  const ctx = await startServer({
    "t-player": makeUser("PLAYER", "pl-1"),
  });
  try {
    const res = await postCredit(ctx, "t-player", "wallet-target", {
      amount: 10,
      reason: "should fail",
      to: "deposit",
    });
    // 400 (apiFailure)-pattern med error.code=FORBIDDEN.
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("adminWallet: SUPPORT får tilgang (matcher WALLET_COMPLIANCE_WRITE)", async () => {
  const ctx = await startServer({
    "t-support": makeUser("SUPPORT", "sup-1"),
  });
  try {
    const res = await postCredit(ctx, "t-support", "wallet-target", {
      amount: 5,
      reason: "support correction",
      to: "deposit",
    });
    assert.equal(res.status, 200);
  } finally {
    await ctx.close();
  }
});

test("adminWallet: HALL_OPERATOR → FORBIDDEN (bevisst utelatt fra WALLET_COMPLIANCE_WRITE)", async () => {
  const ctx = await startServer({
    "t-op": { ...makeUser("HALL_OPERATOR", "op-1"), hallId: "h1" },
  });
  try {
    const res = await postCredit(ctx, "t-op", "wallet-target", {
      amount: 10,
      reason: "hall op should not credit",
      to: "deposit",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Input-validering ────────────────────────────────────────────────────────

test("adminWallet: POST med tøyset `to: \"foobar\"` → INVALID_INPUT (ikke 403)", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 10,
      reason: "tøys",
      to: "foobar", // ugyldig verdi
    });
    // 400 med INVALID_INPUT — ikke 403 (kun winnings utløser regulator-gate).
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("adminWallet: POST uten reason → INVALID_INPUT (reason er påkrevd)", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 10,
      // reason mangler
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("adminWallet: POST med negativt amount → INVALID_AMOUNT", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: -5,
      reason: "negative-amt test",
      to: "deposit",
    });
    assert.equal(res.status, 400);
    // mustBePositiveAmount kaster INVALID_AMOUNT (se httpHelpers.ts).
    assert.ok(
      res.body.error?.code === "INVALID_AMOUNT" ||
        res.body.error?.code === "INVALID_INPUT",
      `forventet INVALID_AMOUNT/INVALID_INPUT men fikk ${res.body.error?.code}`
    );
  } finally {
    await ctx.close();
  }
});

// ── Idempotens passerer gjennom ─────────────────────────────────────────────

test("adminWallet: idempotencyKey sendes gjennom til wallet-adapter (samme tx ved retry)", async () => {
  const ctx = await startServer({
    "t-admin": makeUser("ADMIN"),
  });
  try {
    const res1 = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 20,
      reason: "idem test",
      to: "deposit",
      idempotencyKey: "admin-credit-idem-1",
    });
    assert.equal(res1.status, 200);

    const res2 = await postCredit(ctx, "t-admin", "wallet-target", {
      amount: 20,
      reason: "idem test",
      to: "deposit",
      idempotencyKey: "admin-credit-idem-1",
    });
    assert.equal(res2.status, 200);

    // Bare 20 kr tillagt, ikke 40 (idempotency-hit).
    const balances = await ctx.wallet.getBothBalances("wallet-target");
    assert.equal(balances.deposit, 120);
  } finally {
    await ctx.close();
  }
});
