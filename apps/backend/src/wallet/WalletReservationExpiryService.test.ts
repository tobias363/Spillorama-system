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

test("CHIP-DESYNC 2026-04-26: start() schedulerer boot-sweep etter 30s", async () => {
  // Sannity-test: verifiser at start() registrerer en setTimeout for boot-
  // sweep i tillegg til selve interval-loopen. Vi mock-er ut setTimeout/
  // setInterval slik at testen ikke faktisk venter 30s.
  let timeoutScheduled: { fn: () => void; ms: number } | null = null;
  let intervalScheduled = false;

  const realSetTimeout = global.setTimeout;
  const realSetInterval = global.setInterval;

  // Overstyrer global setTimeout/setInterval for å verifisere scheduling
  // uten å faktisk vente 30s i testen.
  global.setTimeout = ((fn: () => void, ms: number) => {
    timeoutScheduled = { fn, ms };
    return { unref: () => undefined } as unknown as NodeJS.Timeout;
  }) as typeof global.setTimeout;
  global.setInterval = (() => {
    intervalScheduled = true;
    return { unref: () => undefined } as unknown as NodeJS.Timeout;
  }) as typeof global.setInterval;

  try {
    const adapter = new InMemoryWalletAdapter(0);
    let tickCount = 0;
    const svc = new WalletReservationExpiryService({
      walletAdapter: adapter,
      tickIntervalMs: 60_000,
      onTick: () => {
        tickCount++;
      },
    });

    svc.start();

    // start() skal ha registrert både boot-sweep og interval.
    assert.equal(intervalScheduled, true, "interval-loop er ikke startet");
    assert.notEqual(timeoutScheduled, null, "boot-sweep er ikke schedulert");
    assert.equal((timeoutScheduled as unknown as { ms: number }).ms, 30_000, "boot-sweep ms ≠ 30000");

    // Trigger boot-sweep manuelt for å verifisere at den faktisk kaller tick()
    await (timeoutScheduled as unknown as { fn: () => void }).fn();
    // Vent én mikrotask så onTick rekker å kjøre.
    await new Promise((r) => realSetTimeout(r, 0));
    assert.equal(tickCount, 1, "boot-sweep kalte ikke tick()");
  } finally {
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
  }
});
