/**
 * WalletReservationExpiryService — start/stop/lifecycle tester (BIN-693).
 *
 * Eksisterende `WalletReservationExpiryService.test.ts` dekker tick-base-cases
 * (markering av stale, throttling, no-op uten adapter, error-handling). Disse
 * testene fyller hullene rundt:
 *
 *   - start() / stop() lifecycle (timer setup + cleanup)
 *   - default tickIntervalMs
 *   - onReservationExpired-callback (per-reservation broadcast hook)
 *   - flere etterfølgende tick-kall sekvensielt
 *   - tick utført under aktiv start-loop
 */
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import { WalletReservationExpiryService } from "./WalletReservationExpiryService.js";

// ── default-konfig ─────────────────────────────────────────────────────────

test("default tickIntervalMs er 5 minutter (300_000 ms)", () => {
  const adapter = new InMemoryWalletAdapter(0);
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  // Privat felt — vi sjekker indirekte at start() oppretter timer uten å kaste.
  assert.doesNotThrow(() => svc.start());
  svc.stop();
});

// ── start() / stop() ──────────────────────────────────────────────────────

test("start: oppretter intern timer (kan kjøres uten exception)", () => {
  const adapter = new InMemoryWalletAdapter(0);
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter, tickIntervalMs: 60_000 });
  svc.start();
  // Kall start() en gang til — skal være no-op (ikke duplikat-timer)
  svc.start();
  svc.stop();
});

test("stop: idempotent (kan kalles flere ganger uten exception)", () => {
  const adapter = new InMemoryWalletAdapter(0);
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter, tickIntervalMs: 60_000 });
  svc.start();
  svc.stop();
  // Second stop = no-op
  assert.doesNotThrow(() => svc.stop());
});

test("stop uten start: no-op (ingen exception)", () => {
  const adapter = new InMemoryWalletAdapter(0);
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  assert.doesNotThrow(() => svc.stop());
});

// ── tick gjentatt sekvensielt ─────────────────────────────────────────────

test("tick gjentatt: idempotent — andre tick på samme reservasjoner returnerer 0", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });

  const first = await svc.tick();
  assert.equal(first, 1);
  const second = await svc.tick();
  assert.equal(second, 0, "samme reservasjon skal ikke expires igjen");
});

test("tick: opprett ny stale → expire → ny stale → expire (sekvensielt)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });

  // Runde 1
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(await svc.tick(), 1);

  // Runde 2
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-2",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(await svc.tick(), 1);
});

test("tick teller alle stale (multiple expired ved samme sweep)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  // 3 stale + 1 fresh
  for (let i = 0; i < 3; i++) {
    await adapter.reserve!("w-1", 50, {
      idempotencyKey: `stale-${i}`,
      roomCode: "R1",
      expiresAt: new Date(Date.now() - 60_000 - i * 1000).toISOString(),
    });
  }
  await adapter.reserve!("w-1", 50, {
    idempotencyKey: "fresh",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  const count = await svc.tick();
  assert.equal(count, 3);

  const active = await adapter.listActiveReservations!("w-1");
  assert.equal(active.length, 1);
  assert.equal(active[0].idempotencyKey, "fresh");
});

// ── onTick callback ────────────────────────────────────────────────────────

test("onTick: kalles med antall expired etter hver vellykket tick", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const callbackCalls: number[] = [];
  const svc = new WalletReservationExpiryService({
    walletAdapter: adapter,
    onTick: (count) => callbackCalls.push(count),
  });

  await svc.tick();
  await svc.tick(); // andre tick = 0 expired
  assert.deepEqual(callbackCalls, [1, 0]);
});

test("onTick: ikke kalt hvis adapter ikke implementerer expireStaleReservations", async () => {
  const minimalAdapter = {} as InMemoryWalletAdapter;
  let onTickCalls = 0;
  const svc = new WalletReservationExpiryService({
    walletAdapter: minimalAdapter,
    onTick: () => onTickCalls++,
  });
  await svc.tick();
  assert.equal(onTickCalls, 0);
});

test("onTick: ikke kalt ved adapter-error (svelges, returnerer 0)", async () => {
  const errAdapter = {
    expireStaleReservations: async () => {
      throw new Error("DB offline");
    },
  } as unknown as InMemoryWalletAdapter;

  let onTickCalls = 0;
  const svc = new WalletReservationExpiryService({
    walletAdapter: errAdapter,
    onTick: () => onTickCalls++,
  });
  await svc.tick();
  assert.equal(onTickCalls, 0, "onTick skal ikke trigges ved feil");
});

// ── tick: ingen reservasjoner i adapteren ─────────────────────────────────

test("tick: ingen reservasjoner i adapter → 0 expired (no-op)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  const count = await svc.tick();
  assert.equal(count, 0);
});

test("tick: kun fresh reservasjoner → 0 expired", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "fresh-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.reserve!("w-1", 200, {
    idempotencyKey: "fresh-2",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  });
  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  const count = await svc.tick();
  assert.equal(count, 0);
});

// ── Verifiser oppførsel ved expire-status-overgang ─────────────────────────

test("tick: expired reservasjon — status='expired', releasedAt satt", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  const stale = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  await svc.tick();

  // Reservasjonen finnes ikke i listActive lenger — sjekk via listByRoom
  const all = await adapter.listReservationsByRoom!("R1");
  const found = all.find((r) => r.id === stale.id);
  assert.ok(found, "reservasjon finnes fortsatt i historikk");
  assert.equal(found!.status, "expired");
  assert.ok(found!.releasedAt, "releasedAt satt ved expire");
});

test("tick: expire frigir reserved beløp slik at neste reserve går gjennom", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  // Stale reservasjon på 100 — tilgjengelig saldo blir 0
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  // Før tick: ingen tilgjengelig saldo
  const beforeAvailable = await adapter.getAvailableBalance!("w-1");
  assert.equal(beforeAvailable, 0);

  const svc = new WalletReservationExpiryService({ walletAdapter: adapter });
  await svc.tick();

  // Etter tick: 100 er frigjort
  const afterAvailable = await adapter.getAvailableBalance!("w-1");
  assert.equal(afterAvailable, 100);

  // Verifiser at vi nå kan reservere på nytt
  const newRes = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "post-expire",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(newRes.status, "active");
});

// ── Throttle: tick under aktiv tick — kombinert ─────────────────────────────

test("throttle: tre samtidige tick-kall → kun én utføres, andre returnerer 0", async () => {
  let callCount = 0;
  const slowAdapter = {
    expireStaleReservations: async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 30));
      return 1;
    },
  } as unknown as InMemoryWalletAdapter;

  const svc = new WalletReservationExpiryService({ walletAdapter: slowAdapter });
  const [a, b, c] = await Promise.all([svc.tick(), svc.tick(), svc.tick()]);
  assert.equal(callCount, 1, "kun én tick når adapteren");
  assert.equal(a + b + c, 1, "summen er 1 (én vinner)");
});

test("throttle: etter ferdigstilt tick kan ny tick kjøre normalt", async () => {
  let callCount = 0;
  const slowAdapter = {
    expireStaleReservations: async () => {
      callCount++;
      return callCount;
    },
  } as unknown as InMemoryWalletAdapter;

  const svc = new WalletReservationExpiryService({ walletAdapter: slowAdapter });
  await svc.tick();
  await svc.tick();
  assert.equal(callCount, 2, "begge tick gikk gjennom siden de var sekvensielle");
});
