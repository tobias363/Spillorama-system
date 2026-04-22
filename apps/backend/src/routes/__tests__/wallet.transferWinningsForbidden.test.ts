/**
 * PR-W3 wallet-split: regulatorisk gate-test for generisk transfer-endepunkt.
 *
 * Dekker:
 *   - POST /api/wallets/transfer med targetSide:"winnings" → 403
 *     ADMIN_WINNINGS_TRANSFER_FORBIDDEN (pengespillforskriften §11).
 *   - POST uten targetSide (eller default) → normal transfer lykkes.
 *
 * Denne matcher W2 admin-credit-gate på prinsipp: eneste lovlige kilde for
 * winnings-kreditering er game-engine (BingoEngine, Game2Engine, Game3Engine
 * payout-path), ALDRI HTTP-endepunkter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createWalletRouter } from "../wallet.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { SwedbankPayService } from "../../payments/SwedbankPayService.js";

function makePlayer(): PublicAppUser {
  return {
    id: "player-1",
    email: "p1@test.no",
    displayName: "P1",
    walletId: "wallet-player",
    role: "PLAYER",
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

async function startServer(): Promise<Ctx> {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "wallet-from", initialBalance: 1000 });
  await wallet.createAccount({ accountId: "wallet-to", initialBalance: 0 });

  const platformService = {
    async getUserFromAccessToken() {
      return makePlayer();
    },
    async listHalls() {
      return [];
    },
  } as unknown as PlatformService;

  const engine = {} as unknown as BingoEngine;
  const swedbankPayService = {} as unknown as SwedbankPayService;

  const router = createWalletRouter({
    platformService,
    engine,
    walletAdapter: wallet,
    swedbankPayService,
    emitWalletRoomUpdates: async () => {},
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

async function postTransfer(
  ctx: Ctx,
  body: Record<string, unknown>
): Promise<{
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message?: string } };
}> {
  const res = await fetch(`${ctx.baseUrl}/api/wallets/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message?: string };
  };
  return { status: res.status, body: json };
}

// ── Happy-path ────────────────────────────────────────────────────────────

test("POST /api/wallets/transfer uten targetSide: lykkes, lander på deposit", async () => {
  const ctx = await startServer();
  try {
    const res = await postTransfer(ctx, {
      fromWalletId: "wallet-from",
      toWalletId: "wallet-to",
      amount: 250,
      reason: "refund via UI",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const b = await ctx.wallet.getBothBalances("wallet-to");
    assert.equal(b.deposit, 250, "default lander på deposit");
    assert.equal(b.winnings, 0);
  } finally {
    await ctx.close();
  }
});

// ── Regulatorisk gate ─────────────────────────────────────────────────────

test("POST /api/wallets/transfer med targetSide='winnings': 403 ADMIN_WINNINGS_TRANSFER_FORBIDDEN", async () => {
  const ctx = await startServer();
  try {
    const res = await postTransfer(ctx, {
      fromWalletId: "wallet-from",
      toWalletId: "wallet-to",
      amount: 500,
      reason: "malicious bonus attempt",
      targetSide: "winnings",
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error?.code, "ADMIN_WINNINGS_TRANSFER_FORBIDDEN");
    assert.match(
      res.body.error?.message ?? "",
      /pengespillforskriften/,
      "feilmelding referer pengespillforskriften"
    );

    // State skal være UENDRET — gaten kastet før transfer ble utført.
    const fromB = await ctx.wallet.getBothBalances("wallet-from");
    const toB = await ctx.wallet.getBothBalances("wallet-to");
    assert.equal(fromB.deposit, 1000, "avsender uendret");
    assert.equal(toB.deposit, 0);
    assert.equal(toB.winnings, 0, "ingen bonus-winnings opprettet");
  } finally {
    await ctx.close();
  }
});

test("POST /api/wallets/transfer med targetSide='deposit' eksplisitt: lykkes (ikke forbudt)", async () => {
  const ctx = await startServer();
  try {
    const res = await postTransfer(ctx, {
      fromWalletId: "wallet-from",
      toWalletId: "wallet-to",
      amount: 100,
      reason: "explicit deposit",
      targetSide: "deposit",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const b = await ctx.wallet.getBothBalances("wallet-to");
    assert.equal(b.deposit, 100);
    assert.equal(b.winnings, 0);
  } finally {
    await ctx.close();
  }
});
