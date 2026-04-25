/**
 * InMemoryWalletAdapter — race-condition og state-mutation tester.
 *
 * Eksisterende suite (`reservation`/`walletSplit`/`transferTargetSide`)
 * tester sekvensielle scenarioer. Disse testene fokuserer på:
 *
 *   - Concurrent operations (Promise.all mot samme konto)
 *   - State-isolasjon mellom adapter-instanser
 *   - Atomicity: feilet operasjon → ingen partiell mutasjon
 *   - increaseReservation under aktiv reservation
 *   - Edge cases for releaseReservation (partial, full, ukjent)
 *
 * Merk: InMemory-adapter har ingen reell mutex (operasjonene er synkrone i
 * single-thread JS). Testene verifiserer at koden har korrekt sekvensiell
 * semantikk under microtask-scheduling.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

// ── Concurrent debits / credits ────────────────────────────────────────────

test("Concurrent debits: 10 parallelle a 50 kr på saldo 1000 → ende 500", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  const ops = Array.from({ length: 10 }, (_, i) => adapter.debit("w-1", 50, `tx-${i}`));
  await Promise.all(ops);
  assert.equal(await adapter.getBalance("w-1"), 500);
});

test("Concurrent debits over saldo: én eller flere må kaste INSUFFICIENT_FUNDS", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  // 5 parallelle debits a 50 → 250 totalt > saldo 100
  const ops = Array.from({ length: 5 }, (_, i) =>
    adapter.debit("w-1", 50, `tx-${i}`).catch((err) => ({ error: err })),
  );
  const results = await Promise.all(ops);
  const errors = results.filter((r) => "error" in (r as object));
  assert.ok(errors.length >= 3, `≥3 av 5 må feile (kun 100 kr saldo, 50 per debit). Faktisk: ${errors.length}`);
  // Saldo skal aldri gå negativt
  const balance = await adapter.getBalance("w-1");
  assert.ok(balance >= 0, `balance må være ≥ 0, fikk ${balance}`);
});

test("Concurrent topUps: 10 parallelle a 100 kr → ende 1000 (ingen tap)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 0 });
  const ops = Array.from({ length: 10 }, (_, i) => adapter.topUp("w-1", 100, `tx-${i}`));
  await Promise.all(ops);
  assert.equal(await adapter.getBalance("w-1"), 1000);
});

test("Concurrent transfers from same source: ingen dobbel-debit, ingen overflow til to-wallet", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "from", initialBalance: 1000 });
  await adapter.createAccount({ accountId: "to", initialBalance: 0 });

  const ops = Array.from({ length: 10 }, (_, i) =>
    adapter.transfer("from", "to", 50, `tx-${i}`).catch(() => null),
  );
  await Promise.all(ops);

  // Ingen tap: from + to = 1000
  const total = (await adapter.getBalance("from")) + (await adapter.getBalance("to"));
  assert.equal(total, 1000, "konservering: ingen kroner skapt eller mistet");
});

// ── Concurrent reserve operations ─────────────────────────────────────────

test("Concurrent reserve mot samme wallet: hver vinner ulikt expectedAmount", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });

  // 5 parallelle reservasjoner a 100 kr — totalt 500, akkurat på saldo
  const ops = Array.from({ length: 5 }, (_, i) =>
    adapter.reserve!("w-1", 100, {
      idempotencyKey: `key-${i}`,
      roomCode: "R1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).catch((err) => ({ error: err })),
  );
  const results = await Promise.all(ops);
  const succeeded = results.filter((r) => !("error" in (r as object)));
  // Alle 5 må lykkes siden saldo akkurat dekker
  assert.equal(succeeded.length, 5);

  // Tilgjengelig saldo skal nå være 0
  const available = await adapter.getAvailableBalance!("w-1");
  assert.equal(available, 0);
});

test("Concurrent reserve over saldo: minst én må feile med INSUFFICIENT_FUNDS", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });

  // 3 parallelle reservasjoner a 100 kr — sum 300 > saldo 200
  const ops = Array.from({ length: 3 }, (_, i) =>
    adapter.reserve!("w-1", 100, {
      idempotencyKey: `key-${i}`,
      roomCode: "R1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).catch((err) => ({ error: err })),
  );
  const results = await Promise.all(ops);
  const errors = results.filter((r) => "error" in (r as object));
  assert.ok(errors.length >= 1, "minst én reserve må feile pga over-allokering");

  // Sum av aktive reservasjoner ≤ saldo
  const active = await adapter.listActiveReservations!("w-1");
  const sumActive = active.reduce((s, r) => s + r.amount, 0);
  assert.ok(sumActive <= 200, `sum reserved (${sumActive}) ≤ saldo (200)`);
});

test("Idempotent reserve: 10 parallelle reserve med samme key returnerer samme reservasjon", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });

  const ops = Array.from({ length: 10 }, () =>
    adapter.reserve!("w-1", 100, {
      idempotencyKey: "shared-key",
      roomCode: "R1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  const results = await Promise.all(ops);
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 1, "alle parallel-kall returnerte samme reservasjon");

  // Saldo bare redusert med 100 (ikke 1000)
  const available = await adapter.getAvailableBalance!("w-1");
  assert.equal(available, 900);
});

// ── increaseReservation ────────────────────────────────────────────────────

test("increaseReservation: happy path øker beløp", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const updated = await adapter.increaseReservation!(r.id, 50);
  assert.equal(updated.amount, 150);

  const available = await adapter.getAvailableBalance!("w-1");
  assert.equal(available, 350);
});

test("increaseReservation: avviser 0/negativ extraAmount (INVALID_AMOUNT)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(
    () => adapter.increaseReservation!(r.id, 0),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
  await assert.rejects(
    () => adapter.increaseReservation!(r.id, -10),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

test("increaseReservation: ukjent reservation-id → RESERVATION_NOT_FOUND", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.increaseReservation!("ghost-id", 100),
    (err: unknown) => err instanceof WalletError && err.code === "RESERVATION_NOT_FOUND",
  );
});

test("increaseReservation: INVALID_STATE for committed reservation", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  await adapter.createAccount({ accountId: "house" });
  const r = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.commitReservation!(r.id, "house", "x");
  await assert.rejects(
    () => adapter.increaseReservation!(r.id, 50),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_STATE",
  );
});

test("increaseReservation: INSUFFICIENT_FUNDS når extraAmount > tilgjengelig", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
  const r = await adapter.reserve!("w-1", 150, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  // Available = 50; forsøk på +100 må feile
  await assert.rejects(
    () => adapter.increaseReservation!(r.id, 100),
    (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS",
  );
});

// ── releaseReservation edge cases ──────────────────────────────────────────

test("releaseReservation: full release uten amount (default)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r = await adapter.reserve!("w-1", 200, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const released = await adapter.releaseReservation!(r.id);
  assert.equal(released.status, "released");
  assert.ok(released.releasedAt);
  // Hele saldoen er tilbake
  assert.equal(await adapter.getAvailableBalance!("w-1"), 500);
});

test("releaseReservation: amount >= reservasjon → full release", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  // amount > reservasjon → behandles som full release
  const released = await adapter.releaseReservation!(r.id, 999);
  assert.equal(released.status, "released");
});

test("releaseReservation: partial release reduserer beløp men beholder status='active'", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r = await adapter.reserve!("w-1", 200, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const partial = await adapter.releaseReservation!(r.id, 75);
  assert.equal(partial.status, "active", "fortsatt aktiv etter partial release");
  assert.equal(partial.amount, 125);
  // Tilgjengelig saldo = 500 - 125 = 375
  assert.equal(await adapter.getAvailableBalance!("w-1"), 375);
});

test("releaseReservation: ukjent id → RESERVATION_NOT_FOUND", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.releaseReservation!("ghost"),
    (err: unknown) => err instanceof WalletError && err.code === "RESERVATION_NOT_FOUND",
  );
});

// ── Atomicity ──────────────────────────────────────────────────────────────

test("Atomicity: feilet debit (insufficient) etterlater ingen partial state", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 50 });
  const before = await adapter.getBothBalances("w-1");

  await assert.rejects(() => adapter.debit("w-1", 100, "x"), WalletError);

  const after = await adapter.getBothBalances("w-1");
  assert.deepEqual(after, before, "ingen partial mutasjon");
  // Ingen DEBIT-tx skrevet
  const txs = await adapter.listTransactions("w-1");
  assert.ok(!txs.some((tx) => tx.type === "DEBIT"));
});

test("Atomicity: feilet transfer etterlater begge sider uendret", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 50 });
  await adapter.createAccount({ accountId: "w-2", initialBalance: 100 });
  const beforeFrom = await adapter.getBalance("w-1");
  const beforeTo = await adapter.getBalance("w-2");

  await assert.rejects(() => adapter.transfer("w-1", "w-2", 200), WalletError);

  assert.equal(await adapter.getBalance("w-1"), beforeFrom);
  assert.equal(await adapter.getBalance("w-2"), beforeTo);
});

// ── State-isolasjon mellom instanser ──────────────────────────────────────

test("State-isolasjon: to ulike adapter-instanser deler ikke kontoer", async () => {
  const adapter1 = new InMemoryWalletAdapter(0);
  const adapter2 = new InMemoryWalletAdapter(0);
  await adapter1.createAccount({ accountId: "w-1", initialBalance: 100 });
  // adapter2 vet ikke om kontoen — getAccount auto-creates med default saldo (0)
  const account = await adapter2.getAccount("w-1");
  assert.equal(account.balance, 0);
});

// ── reservasjon: idempotency + amount-mismatch ─────────────────────────────

test("Reservasjon: IDEMPOTENCY_MISMATCH når samme key brukes med ulikt beløp", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(
    () =>
      adapter.reserve!("w-1", 200, {
        idempotencyKey: "k-1",
        roomCode: "R1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    (err: unknown) => err instanceof WalletError && err.code === "IDEMPOTENCY_MISMATCH",
  );
});

// ── listActive vs listByRoom ───────────────────────────────────────────────

test("listActive: returnerer kun status='active' for gitt wallet", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  const r1 = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.reserve!("w-1", 50, {
    idempotencyKey: "k-2",
    roomCode: "R2",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.releaseReservation!(r1.id);

  const active = await adapter.listActiveReservations!("w-1");
  assert.equal(active.length, 1);
  assert.equal(active[0].idempotencyKey, "k-2");
});

test("listByRoom: returnerer alle (inkl. released/committed/expired) for gitt rom", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  await adapter.createAccount({ accountId: "house" });
  const r1 = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const r2 = await adapter.reserve!("w-1", 50, {
    idempotencyKey: "k-2",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.releaseReservation!(r1.id);
  await adapter.commitReservation!(r2.id, "house", "x");

  const all = await adapter.listReservationsByRoom!("R1");
  assert.equal(all.length, 2);
  const statuses = new Set(all.map((r) => r.status));
  assert.ok(statuses.has("released"));
  assert.ok(statuses.has("committed"));
});

// ── commit etter release: må feile ─────────────────────────────────────────

test("Commit etter release: INVALID_STATE", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 500 });
  await adapter.createAccount({ accountId: "house" });
  const r = await adapter.reserve!("w-1", 100, {
    idempotencyKey: "k-1",
    roomCode: "R1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await adapter.releaseReservation!(r.id);
  await assert.rejects(
    () => adapter.commitReservation!(r.id, "house", "x"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_STATE",
  );
});
