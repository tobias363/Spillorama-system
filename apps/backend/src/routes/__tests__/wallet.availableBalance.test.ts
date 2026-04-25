/**
 * Regresjonstest 2026-04-25: `/api/wallet/me` skal eksponere
 * available-/reserved-felt så header-chip kan vise *tilgjengelig* saldo etter
 * pre-round-bong-reservasjoner (BIN-693).
 *
 * Bug fanget live 2026-04-25 14:42: spiller kjøper bong (20 kr) til neste
 * runde mens aktiv runde kjører. Reservasjonen opprettes server-side, men
 * `/api/wallet/me` viste kun brutto-saldo — UI snappet tilbake til 640/360
 * etter optimistisk update. Forventet 620/353.
 *
 * Dekker:
 *   - Ingen reservasjoner → available* === *Balance, reserved* === 0
 *   - Reservasjon < winningsBalance → kun winnings reduseres (winnings-first)
 *   - Reservasjon > winningsBalance → winnings nullstilles, deposit reduseres
 *     med rest (samme split-policy som transfer() ved commit)
 *   - Brutto-felt (balance/depositBalance/winningsBalance) er UENDRET
 *   - Tilbakefall: adapter uten listActiveReservations → reserved=0
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

const PLAYER_WALLET = "wallet-player";

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
  wallet: InMemoryWalletAdapter;
  close: () => Promise<void>;
}

interface MeResponse {
  ok: boolean;
  data?: {
    account: {
      id: string;
      balance: number;
      depositBalance: number;
      winningsBalance: number;
      reservedDeposit: number;
      reservedWinnings: number;
      availableDeposit: number;
      availableWinnings: number;
      availableBalance: number;
    };
    transactions: unknown[];
  };
  error?: { code: string; message?: string };
}

async function startServer(initialDeposit: number, initialWinnings = 0): Promise<Ctx> {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: PLAYER_WALLET, initialBalance: initialDeposit });
  // Hus-konto til transfer/commit ved bruk i andre tester.
  await wallet.createAccount({ accountId: "wallet-house", initialBalance: 0 });
  // Fyll på winnings via transfer fra house til player med targetSide:winnings
  // (matcher game-engine payout-flyten — eneste lovlige måte å fylle winnings).
  if (initialWinnings > 0) {
    // Først topup på house-account så vi kan transfere derfra.
    await wallet.topUp("wallet-house", initialWinnings, "test setup");
    await wallet.transfer("wallet-house", PLAYER_WALLET, initialWinnings, "test winnings", {
      targetSide: "winnings",
    });
  }

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

async function getWalletMe(ctx: Ctx): Promise<MeResponse> {
  const res = await fetch(`${ctx.baseUrl}/api/wallet/me`, {
    headers: { Authorization: "Bearer test-token" },
  });
  return (await res.json()) as MeResponse;
}

// ── Happy path: ingen reservasjoner ───────────────────────────────────────

test("GET /api/wallet/me uten reservasjoner: available* === *Balance, reserved* = 0", async () => {
  const ctx = await startServer(1000, 0);
  try {
    const body = await getWalletMe(ctx);
    if (!body.ok) {
      throw new Error(`Expected ok=true, got: ${JSON.stringify(body)}`);
    }
    assert.equal(body.ok, true);
    const a = body.data!.account;
    assert.equal(a.balance, 1000);
    assert.equal(a.depositBalance, 1000);
    assert.equal(a.winningsBalance, 0);
    assert.equal(a.reservedDeposit, 0);
    assert.equal(a.reservedWinnings, 0);
    assert.equal(a.availableDeposit, 1000);
    assert.equal(a.availableWinnings, 0);
    assert.equal(a.availableBalance, 1000);
  } finally {
    await ctx.close();
  }
});

test("GET /api/wallet/me uten reservasjoner med deposit+winnings: available* === *Balance", async () => {
  const ctx = await startServer(640, 360);
  try {
    const body = await getWalletMe(ctx);
    const a = body.data!.account;
    assert.equal(a.depositBalance, 640);
    assert.equal(a.winningsBalance, 360);
    assert.equal(a.reservedDeposit, 0);
    assert.equal(a.reservedWinnings, 0);
    assert.equal(a.availableDeposit, 640);
    assert.equal(a.availableWinnings, 360);
    assert.equal(a.availableBalance, 1000);
  } finally {
    await ctx.close();
  }
});

// ── Reservasjon spiser kun winnings (winnings-first) ──────────────────────

test("GET /api/wallet/me med reservasjon < winnings: kun winnings reduseres", async () => {
  // Bug-scenarioet fra 2026-04-25: 640 deposit + 360 winnings, 20 kr reservert
  // for forhåndskjøp. Forventet: deposit uendret 640, winnings 340, available
  // 980. Reservasjonen tar fra winnings først.
  const ctx = await startServer(640, 360);
  try {
    await ctx.wallet.reserve(PLAYER_WALLET, 20, {
      idempotencyKey: "test-key-1",
      roomCode: "ROOM-A",
    });
    const body = await getWalletMe(ctx);
    const a = body.data!.account;
    // Brutto: UENDRET — reservasjonen rører ikke wallet_accounts før commit.
    assert.equal(a.balance, 1000, "brutto balance uendret");
    assert.equal(a.depositBalance, 640, "depositBalance uendret (brutto)");
    assert.equal(a.winningsBalance, 360, "winningsBalance uendret (brutto)");
    // Reservert: kun fra winnings (winnings-first).
    assert.equal(a.reservedDeposit, 0);
    assert.equal(a.reservedWinnings, 20);
    // Tilgjengelig: deposit uendret, winnings -20.
    assert.equal(a.availableDeposit, 640);
    assert.equal(a.availableWinnings, 340);
    assert.equal(a.availableBalance, 980);
  } finally {
    await ctx.close();
  }
});

// ── Reservasjon større enn winnings: spiser hele winnings + rest av deposit ─

test("GET /api/wallet/me med reservasjon > winnings: winnings nullstilles, deposit -rest", async () => {
  // 100 deposit + 50 winnings, 80 kr reservert. Winnings-first:
  // reservedWinnings=50, reservedDeposit=30. Available: 70/0.
  const ctx = await startServer(100, 50);
  try {
    await ctx.wallet.reserve(PLAYER_WALLET, 80, {
      idempotencyKey: "test-key-2",
      roomCode: "ROOM-B",
    });
    const body = await getWalletMe(ctx);
    const a = body.data!.account;
    assert.equal(a.balance, 150);
    assert.equal(a.depositBalance, 100);
    assert.equal(a.winningsBalance, 50);
    assert.equal(a.reservedWinnings, 50);
    assert.equal(a.reservedDeposit, 30);
    assert.equal(a.availableDeposit, 70);
    assert.equal(a.availableWinnings, 0);
    assert.equal(a.availableBalance, 70);
  } finally {
    await ctx.close();
  }
});

// ── Flere reservasjoner aggregeres ────────────────────────────────────────

test("GET /api/wallet/me med flere aktive reservasjoner: sum aggregeres", async () => {
  const ctx = await startServer(500, 200);
  try {
    await ctx.wallet.reserve(PLAYER_WALLET, 30, {
      idempotencyKey: "k-multi-1",
      roomCode: "ROOM-A",
    });
    await ctx.wallet.reserve(PLAYER_WALLET, 50, {
      idempotencyKey: "k-multi-2",
      roomCode: "ROOM-B",
    });
    const body = await getWalletMe(ctx);
    const a = body.data!.account;
    // Total reservert = 80, alt fra winnings (200 > 80).
    assert.equal(a.reservedWinnings, 80);
    assert.equal(a.reservedDeposit, 0);
    assert.equal(a.availableDeposit, 500);
    assert.equal(a.availableWinnings, 120);
    assert.equal(a.availableBalance, 620);
  } finally {
    await ctx.close();
  }
});

// ── Released/expired reservasjoner ekskluderes ────────────────────────────

test("GET /api/wallet/me ekskluderer released-reservasjoner fra reserved-sum", async () => {
  const ctx = await startServer(1000, 0);
  try {
    const r1 = await ctx.wallet.reserve(PLAYER_WALLET, 100, {
      idempotencyKey: "k-rel-1",
      roomCode: "ROOM-A",
    });
    await ctx.wallet.reserve(PLAYER_WALLET, 50, {
      idempotencyKey: "k-rel-2",
      roomCode: "ROOM-A",
    });
    // Release først reservasjon.
    await ctx.wallet.releaseReservation(r1.id);

    const body = await getWalletMe(ctx);
    const a = body.data!.account;
    // Kun andre reservasjon (50) er fortsatt aktiv.
    assert.equal(a.reservedDeposit, 50);
    assert.equal(a.availableDeposit, 950);
    assert.equal(a.availableBalance, 950);
  } finally {
    await ctx.close();
  }
});
