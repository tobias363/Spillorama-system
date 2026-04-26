/**
 * W1-HOTFIX (Tobias 2026-04-26): GET /api/wallet/me + GET /api/wallets/:id
 * skal sette Cache-Control: no-store så browser/proxy ALDRI cacher
 * wallet-state.
 *
 * Bakgrunn: kombinert med commit 4832535b (cache-buster ?_=Date.now() i
 * lobby.js) sikrer dette at gjentatte fetches ikke kan returnere stale
 * data. Wallet-state er pengespillforskriften §11-kritisk og må aldri
 * vises stale.
 *
 * Backend-fix er primær mot reverse-proxy-cache; client-cache-busteren
 * er backup. Begge bør gjelde.
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

const PLAYER_WALLET = "wallet-cache-test";

function makePlayer(): PublicAppUser {
  return {
    id: "player-1",
    email: "p1@test.no",
    displayName: "P1",
    walletId: PLAYER_WALLET,
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
  close: () => Promise<void>;
}

async function startServer(): Promise<Ctx> {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: PLAYER_WALLET, initialBalance: 1000 });

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
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ── Test 1: /api/wallet/me setter Cache-Control: no-store ─────────────────

test(
  "W1-hotfix: GET /api/wallet/me setter Cache-Control: no-store, no-cache, must-revalidate, private",
  async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/api/wallet/me`, {
        headers: { Authorization: "Bearer test-token" },
      });
      assert.equal(res.status, 200);

      const cacheControl = res.headers.get("cache-control");
      assert.ok(cacheControl, "Cache-Control header skal være satt");
      // Sjekk at alle directives er til stede.
      assert.match(cacheControl!, /no-store/);
      assert.match(cacheControl!, /no-cache/);
      assert.match(cacheControl!, /must-revalidate/);
      assert.match(cacheControl!, /private/);

      // Pragma og Expires for HTTP/1.0-clients.
      assert.equal(res.headers.get("pragma"), "no-cache");
      assert.equal(res.headers.get("expires"), "0");
    } finally {
      await ctx.close();
    }
  }
);

// ── Test 2: /api/wallets/:walletId setter Cache-Control: no-store ────────

test(
  "W1-hotfix: GET /api/wallets/:walletId setter Cache-Control: no-store",
  async () => {
    const ctx = await startServer();
    try {
      const res = await fetch(
        `${ctx.baseUrl}/api/wallets/${PLAYER_WALLET}`,
        { headers: { Authorization: "Bearer test-token" } }
      );
      assert.equal(res.status, 200);

      const cacheControl = res.headers.get("cache-control");
      assert.ok(cacheControl, "Cache-Control header skal være satt");
      assert.match(cacheControl!, /no-store/);
      assert.match(cacheControl!, /no-cache/);
      assert.match(cacheControl!, /must-revalidate/);
      assert.match(cacheControl!, /private/);
    } finally {
      await ctx.close();
    }
  }
);

// ── Test 3: 2 sekvensielle requests har begge Cache-Control ──────────────

test(
  "W1-hotfix: gjentatte requests til /api/wallet/me serverer alltid med no-store-header",
  async () => {
    const ctx = await startServer();
    try {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${ctx.baseUrl}/api/wallet/me`, {
          headers: { Authorization: "Bearer test-token" },
        });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("cache-control") ?? "", /no-store/);
      }
    } finally {
      await ctx.close();
    }
  }
);
