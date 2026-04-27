/**
 * BIN-760: Unit-tester for `walletStatePusher`.
 *
 * Verifiserer:
 *   1. `pushForWallet` bygger korrekt payload fra adapter.getBothBalances +
 *      getAvailableBalance og emitter til `wallet:<walletId>`-rom.
 *   2. Reservasjons-info reflekteres riktig (reservedAmount = total - available).
 *   3. Adapter uten `getAvailableBalance` faller tilbake til total = available.
 *   4. Emit-feil swallowes (fail-soft) — caller får aldri en kastet feil.
 *   5. `walletRoomKey` bruker konsistent prefix.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletStatePusher,
  walletRoomKey,
} from "../walletStatePusher.js";
import type { WalletAdapter, WalletBalance } from "../../adapters/WalletAdapter.js";

interface CapturedEmit {
  room: string;
  event: string;
  payload: unknown;
}

function makeFakeIo(throwOnEmit = false): {
  io: { to: (room: string) => { emit: (event: string, payload: unknown) => void } };
  emits: CapturedEmit[];
} {
  const emits: CapturedEmit[] = [];
  return {
    io: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          if (throwOnEmit) throw new Error("io emit failed");
          emits.push({ room, event, payload });
        },
      }),
    },
    emits,
  };
}

function makeFakeAdapter(opts: {
  deposit?: number;
  winnings?: number;
  available?: number | "throw" | "absent";
} = {}): WalletAdapter {
  const deposit = opts.deposit ?? 100;
  const winnings = opts.winnings ?? 50;
  const balance: WalletBalance = { deposit, winnings, total: deposit + winnings };
  const adapter: Partial<WalletAdapter> = {
    getBothBalances: async () => balance,
  };
  if (opts.available === "throw") {
    adapter.getAvailableBalance = async () => { throw new Error("DB down"); };
  } else if (opts.available !== "absent") {
    const av = opts.available ?? deposit + winnings;
    adapter.getAvailableBalance = async () => av;
  }
  return adapter as WalletAdapter;
}

test("walletRoomKey: prefix-er walletId med 'wallet:'", () => {
  assert.equal(walletRoomKey("w-123"), "wallet:w-123");
  assert.equal(walletRoomKey(""), "wallet:");
});

test("pushForWallet: emitter wallet:state med korrekt payload-shape", async () => {
  const { io, emits } = makeFakeIo();
  const adapter = makeFakeAdapter({ deposit: 200, winnings: 80, available: 280 });
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter, now: () => 1000 });

  await pusher.pushForWallet("w-1", "credit", { gameId: "g-1" });

  assert.equal(emits.length, 1, "én emit");
  const e = emits[0]!;
  assert.equal(e.room, "wallet:w-1");
  assert.equal(e.event, "wallet:state");
  const p = e.payload as Record<string, unknown>;
  assert.equal(p.walletId, "w-1");
  assert.equal(p.serverTimestamp, 1000);
  assert.equal(p.reason, "credit");
  assert.deepEqual(p.source, { gameId: "g-1" });
  const acct = p.account as Record<string, number>;
  assert.equal(acct.balance, 280);
  assert.equal(acct.depositBalance, 200);
  assert.equal(acct.winningsBalance, 80);
  assert.equal(acct.reservedAmount, 0);
  assert.equal(acct.availableBalance, 280);
});

test("pushForWallet: reservedAmount = total - available når reservasjon aktiv", async () => {
  const { io, emits } = makeFakeIo();
  // Total = 300, available = 250 → reserved = 50
  const adapter = makeFakeAdapter({ deposit: 300, winnings: 0, available: 250 });
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter, now: () => 2000 });

  await pusher.pushForWallet("w-2", "reservation");

  assert.equal(emits.length, 1);
  const acct = (emits[0]!.payload as Record<string, unknown>).account as Record<string, number>;
  assert.equal(acct.reservedAmount, 50);
  assert.equal(acct.availableBalance, 250);
});

test("pushForWallet: adapter uten getAvailableBalance — fallback til total", async () => {
  const { io, emits } = makeFakeIo();
  const adapter = makeFakeAdapter({ deposit: 100, winnings: 0, available: "absent" });
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter, now: () => 3000 });

  await pusher.pushForWallet("w-3", "debit");

  assert.equal(emits.length, 1);
  const acct = (emits[0]!.payload as Record<string, unknown>).account as Record<string, number>;
  assert.equal(acct.availableBalance, 100);
  assert.equal(acct.reservedAmount, 0);
});

test("pushForWallet: getAvailableBalance som kaster — fallback til total uten å boble feilen", async () => {
  const { io, emits } = makeFakeIo();
  const adapter = makeFakeAdapter({ deposit: 50, winnings: 50, available: "throw" });
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter, now: () => 4000 });

  await pusher.pushForWallet("w-4", "transfer");

  assert.equal(emits.length, 1);
  const acct = (emits[0]!.payload as Record<string, unknown>).account as Record<string, number>;
  assert.equal(acct.availableBalance, 100);
  assert.equal(acct.reservedAmount, 0);
});

test("pushForWallet: emit-feil swallowes — caller får aldri kastet feil", async () => {
  const { io, emits } = makeFakeIo(true); // throwOnEmit
  const adapter = makeFakeAdapter();
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter });

  // Skal IKKE kaste — fail-soft sikrer wallet-commit aldri rulles tilbake.
  await pusher.pushForWallet("w-5", "credit");

  assert.equal(emits.length, 0);
});

test("pushForWallet: tomt walletId → no-op (ingen emit)", async () => {
  const { io, emits } = makeFakeIo();
  const adapter = makeFakeAdapter();
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter });

  await pusher.pushForWallet("", "credit");

  assert.equal(emits.length, 0);
});

test("buildPayload: returnerer samme shape som push uten å emitte", async () => {
  const { io, emits } = makeFakeIo();
  const adapter = makeFakeAdapter({ deposit: 70, winnings: 30, available: 100 });
  const pusher = createWalletStatePusher({ io: io as never, walletAdapter: adapter, now: () => 5000 });

  const payload = await pusher.buildPayload("w-6", "expiry", { roomCode: "BINGO1" });

  assert.equal(emits.length, 0, "buildPayload emitter ikke");
  assert.equal(payload.walletId, "w-6");
  assert.equal(payload.serverTimestamp, 5000);
  assert.equal(payload.reason, "expiry");
  assert.deepEqual(payload.source, { roomCode: "BINGO1" });
  assert.equal(payload.account.balance, 100);
});
