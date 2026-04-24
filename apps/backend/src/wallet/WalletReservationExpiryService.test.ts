import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import { WalletReservationExpiryService } from "./WalletReservationExpiryService.js";

test("BIN-693 ExpiryService: tick markerer stale reservasjoner expired", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });

  // Opprett én stale og én fersk.
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await adapter.reserve!("w-1", 150, {
    idempotencyKey: "fresh",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  let ticked = 0;
  const svc = new WalletReservationExpiryService({
    walletAdapter: adapter,
    tickIntervalMs: 60_000,
    onTick: (c) => (ticked = c),
  });

  const count = await svc.tick();
  assert.equal(count, 1);
  assert.equal(ticked, 1);

  const active = await adapter.listActiveReservations!("w-1");
  assert.equal(active.length, 1);
  assert.equal(active[0].idempotencyKey, "fresh");
});

test("BIN-693 ExpiryService: tick throttles ved overlapp", async () => {
  // Synthetic adapter som simulerer treg sweep → samme tick må ikke overlappes.
  let callCount = 0;
  const slowAdapter = {
    expireStaleReservations: async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 30));
      return 1;
    },
  } as unknown as InMemoryWalletAdapter;

  const svc = new WalletReservationExpiryService({
    walletAdapter: slowAdapter,
    tickIntervalMs: 60_000,
  });

  const [a, b] = await Promise.all([svc.tick(), svc.tick()]);
  // Én tick vinner (callCount=1), den andre returnerer 0 uten å kalle adapter.
  assert.equal(callCount, 1);
  assert.equal(a + b, 1);
});

test("BIN-693 ExpiryService: adapter uten expireStaleReservations → no-op", async () => {
  const noopAdapter = {} as InMemoryWalletAdapter;
  const svc = new WalletReservationExpiryService({ walletAdapter: noopAdapter });
  const count = await svc.tick();
  assert.equal(count, 0);
});

test("BIN-693 ExpiryService: error i adapter blir svelgt, tick returnerer 0", async () => {
  const errAdapter = {
    expireStaleReservations: async () => {
      throw new Error("DB offline");
    },
  } as unknown as InMemoryWalletAdapter;

  const svc = new WalletReservationExpiryService({ walletAdapter: errAdapter });
  // Ikke rethrow — servicen skal overleve transient feil.
  const count = await svc.tick();
  assert.equal(count, 0);
});
