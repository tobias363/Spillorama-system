/**
 * BIN-760: Unit-tester for `WalletStateNotifyingAdapter`.
 *
 * Verifiserer at decorator-en kaller pusher.pushForWallet(...) etter hver
 * suksessfull mutasjon, med riktig walletId + reason. Read-operasjoner
 * skal IKKE fyre push.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { WalletStateNotifyingAdapter, type WalletStatePushHook } from "./walletStateNotifyingAdapter.js";
import type {
  WalletAdapter,
  WalletAccount,
  WalletBalance,
  WalletReservation,
  WalletTransaction,
  WalletTransferResult,
} from "./WalletAdapter.js";

interface CapturedPush {
  walletId: string;
  reason: string;
  source?: unknown;
}

function makeStubAdapter(): WalletAdapter {
  const tx = (accountId: string): WalletTransaction => ({
    id: "tx-" + accountId,
    accountId,
    type: "DEBIT",
    amount: 10,
    reason: "test",
    createdAt: new Date().toISOString(),
  });
  const reservation = (walletId: string, roomCode = "ROOM"): WalletReservation => ({
    id: "res-" + walletId,
    walletId,
    amount: 50,
    idempotencyKey: "k-" + walletId,
    status: "active",
    roomCode,
    gameSessionId: null,
    createdAt: new Date().toISOString(),
    releasedAt: null,
    committedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const account = (id: string): WalletAccount => ({
    id, balance: 100, depositBalance: 60, winningsBalance: 40,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return {
    createAccount: async () => account("new"),
    ensureAccount: async (id) => account(id),
    getAccount: async (id) => account(id),
    listAccounts: async () => [],
    getBalance: async () => 100,
    getDepositBalance: async () => 60,
    getWinningsBalance: async () => 40,
    getBothBalances: async (): Promise<WalletBalance> => ({ deposit: 60, winnings: 40, total: 100 }),
    debit: async (id) => tx(id),
    credit: async (id) => ({ ...tx(id), type: "CREDIT" }),
    topUp: async (id) => ({ ...tx(id), type: "TOPUP" }),
    withdraw: async (id) => ({ ...tx(id), type: "WITHDRAWAL" }),
    transfer: async (from, to): Promise<WalletTransferResult> => ({
      fromTx: { ...tx(from), type: "TRANSFER_OUT", relatedAccountId: to },
      toTx: { ...tx(to), type: "TRANSFER_IN", relatedAccountId: from },
    }),
    listTransactions: async () => [],
    getAvailableBalance: async () => 100,
    reserve: async (id, _amt, opts) => reservation(id, opts.roomCode),
    increaseReservation: async (resId) => reservation(resId.replace("res-", ""), "ROOM2"),
    releaseReservation: async (resId) => ({ ...reservation(resId.replace("res-", "")), status: "released" }),
    commitReservation: async (resId, to): Promise<WalletTransferResult> => ({
      fromTx: { ...tx(resId.replace("res-", "")), type: "TRANSFER_OUT" },
      toTx: { ...tx(to), type: "TRANSFER_IN" },
    }),
    listActiveReservations: async () => [],
    listReservationsByRoom: async () => [],
    expireStaleReservations: async () => 0,
  };
}

function makeRecordingPusher(): { pusher: WalletStatePushHook; pushes: CapturedPush[] } {
  const pushes: CapturedPush[] = [];
  return {
    pusher: {
      pushForWallet: async (walletId, reason, source) => {
        pushes.push({ walletId, reason, source });
      },
    },
    pushes,
  };
}

async function flush(): Promise<void> {
  // Pusher kalles via void-promise; gi den en mikrotask å resolve.
  await new Promise((r) => setImmediate(r));
}

test("debit: pusher kalles med reason='debit' for accountId", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.debit("w-1", 10, "test");
  await flush();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.walletId, "w-1");
  assert.equal(pushes[0]!.reason, "debit");
});

test("credit: pusher kalles med reason='credit'", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.credit("w-2", 10, "test");
  await flush();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.reason, "credit");
});

test("topUp + withdraw: bruker hhv. credit/debit reasons", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.topUp("w-3", 10);
  await adapter.withdraw("w-3", 5);
  await flush();

  assert.equal(pushes.length, 2);
  assert.equal(pushes[0]!.reason, "credit"); // topUp = credit
  assert.equal(pushes[1]!.reason, "debit");  // withdraw = debit
});

test("transfer: pusher kalles for begge sider med reason='transfer'", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.transfer("w-from", "w-to", 50, "test");
  await flush();

  assert.equal(pushes.length, 2);
  const wallets = pushes.map((p) => p.walletId).sort();
  assert.deepEqual(wallets, ["w-from", "w-to"]);
  for (const p of pushes) assert.equal(p.reason, "transfer");
});

test("reserve: pusher kalles én gang med reason='reservation' + roomCode i source", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.reserve!("w-4", 100, { idempotencyKey: "k", roomCode: "ROOM-X" });
  await flush();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.reason, "reservation");
  assert.equal(pushes[0]!.walletId, "w-4");
  assert.deepEqual(pushes[0]!.source, { roomCode: "ROOM-X" });
});

test("commitReservation: pusher kalles for begge sider med reason='commit'", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.commitReservation!("res-w-from", "w-to", "test", { gameSessionId: "g-1" });
  await flush();

  assert.equal(pushes.length, 2);
  for (const p of pushes) assert.equal(p.reason, "commit");
  for (const p of pushes) assert.deepEqual(p.source, { gameId: "g-1" });
});

test("releaseReservation: pusher kalles med reason='release'", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.releaseReservation!("res-w-5");
  await flush();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.reason, "release");
});

test("read-operasjoner (getBalance/listAccounts) skal IKKE fyre push", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  await adapter.getBalance("w-6");
  await adapter.getDepositBalance("w-6");
  await adapter.getWinningsBalance("w-6");
  await adapter.getBothBalances("w-6");
  await adapter.listTransactions("w-6");
  await adapter.listAccounts();
  await flush();

  assert.equal(pushes.length, 0, "ingen push for read-operasjoner");
});

test("pusher som kaster — caller får aldri kastet feil", async () => {
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), {
    pushForWallet: async () => { throw new Error("emit blew up"); },
  });

  // Skal IKKE kaste fra debit
  await adapter.debit("w-7", 1, "test");
  await flush();
  assert.ok(true, "ingen feil propagerte");
});

test("expireStaleReservations: pass-through, ingen push (bevisst — TTL handler separat)", async () => {
  const { pusher, pushes } = makeRecordingPusher();
  const adapter = new WalletStateNotifyingAdapter(makeStubAdapter(), pusher);

  const count = await adapter.expireStaleReservations!(Date.now());
  await flush();

  assert.equal(count, 0);
  assert.equal(pushes.length, 0, "expiry-tick fyrer ikke push på adapter-laget");
});
