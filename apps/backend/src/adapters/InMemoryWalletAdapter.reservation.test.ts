/**
 * BIN-693 Option B: Wallet-reservasjon (InMemory-adapter).
 *
 * Dekker kontrakten som er spesifisert i PM-brief 2026-04-24:
 *   - reserve: happy path + INSUFFICIENT_FUNDS + idempotens
 *   - releaseReservation: full release + partial (prorata)
 *   - commitReservation: bruker winnings-first-policy (gevinst først)
 *   - getAvailableBalance = total − sum(active reservations)
 *   - expireStaleReservations: marker expired etter TTL
 *   - listActiveReservations / listReservationsByRoom
 */
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

function makeAdapter(): { adapter: InMemoryWalletAdapter; playerAcc: string; houseAcc: string } {
  const adapter = new InMemoryWalletAdapter(0);
  // Seedes etter test-trenger — ikke default-balance her (0 gjør tester
  // deterministiske ved eksplisitt top-up).
  return { adapter, playerAcc: "wallet-player-1", houseAcc: "wallet-house-1" };
}

async function seedPlayer(
  adapter: InMemoryWalletAdapter,
  accountId: string,
  deposit: number,
  winnings = 0,
): Promise<void> {
  await adapter.createAccount({ accountId, initialBalance: 0 });
  if (deposit > 0) await adapter.topUp(accountId, deposit);
  if (winnings > 0) await adapter.credit(accountId, winnings, "seed winnings", { to: "winnings" });
}

// ── reserve ──────────────────────────────────────────────────────────────────

test("BIN-693 reserve: happy path — active reservation + reduced available", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);

  const reservation = await adapter.reserve!(playerAcc, 250, {
    idempotencyKey: "arm-BINGO1-p1-abc",
    roomCode: "BINGO1",
  });

  assert.equal(reservation.walletId, playerAcc);
  assert.equal(reservation.amount, 250);
  assert.equal(reservation.status, "active");
  assert.equal(reservation.roomCode, "BINGO1");
  assert.equal(reservation.gameSessionId, null);

  // Available = 1000 - 250 = 750; raw balance unchanged (1000).
  assert.equal(await adapter.getBalance(playerAcc), 1000);
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 750);
});

test("BIN-693 reserve: INSUFFICIENT_FUNDS når available < amount", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 100);

  await assert.rejects(
    () =>
      adapter.reserve!(playerAcc, 101, {
        idempotencyKey: "k1",
        roomCode: "BINGO1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof WalletError);
      assert.equal((err as WalletError).code, "INSUFFICIENT_FUNDS");
      return true;
    },
  );
});

test("BIN-693 reserve: INSUFFICIENT_FUNDS når eksisterende reservasjon spiser tilgjengelig", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  await adapter.reserve!(playerAcc, 900, { idempotencyKey: "k1", roomCode: "BINGO1" });

  // Ny reservasjon på 200 — available er 100, skal feile.
  await assert.rejects(
    () => adapter.reserve!(playerAcc, 200, { idempotencyKey: "k2", roomCode: "BINGO1" }),
    (err: unknown) => (err as WalletError).code === "INSUFFICIENT_FUNDS",
  );
});

test("BIN-693 reserve: idempotens — samme key + beløp returnerer eksisterende", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);

  const first = await adapter.reserve!(playerAcc, 250, {
    idempotencyKey: "arm-R1-p1-hashA",
    roomCode: "R1",
  });
  const second = await adapter.reserve!(playerAcc, 250, {
    idempotencyKey: "arm-R1-p1-hashA",
    roomCode: "R1",
  });
  assert.equal(first.id, second.id);
  // Available skal KUN reflektere én reservasjon (ikke dobbel).
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 750);
});

test("BIN-693 reserve: IDEMPOTENCY_MISMATCH når samme key har annet beløp", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  await adapter.reserve!(playerAcc, 250, { idempotencyKey: "k1", roomCode: "R1" });

  await assert.rejects(
    () => adapter.reserve!(playerAcc, 500, { idempotencyKey: "k1", roomCode: "R1" }),
    (err: unknown) => (err as WalletError).code === "IDEMPOTENCY_MISMATCH",
  );
});

// ── releaseReservation ───────────────────────────────────────────────────────

test("BIN-693 release: full release frigjør hele beløpet", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  const r = await adapter.reserve!(playerAcc, 250, { idempotencyKey: "k1", roomCode: "R1" });
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 750);

  const released = await adapter.releaseReservation!(r.id);
  assert.equal(released.status, "released");
  assert.ok(released.releasedAt);
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 1000);
});

test("BIN-693 release: partial release reduserer beløp, status forblir active", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  // Prorata: 5 bonger á 50 kr = 250 kr. Avbestill 2 bonger (100 kr).
  const r = await adapter.reserve!(playerAcc, 250, { idempotencyKey: "k1", roomCode: "R1" });

  const after = await adapter.releaseReservation!(r.id, 100);
  assert.equal(after.status, "active");
  assert.equal(after.amount, 150);
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 850);
});

test("BIN-693 release: RESERVATION_NOT_FOUND for ukjent id", async () => {
  const { adapter } = makeAdapter();
  await assert.rejects(
    () => adapter.releaseReservation!("does-not-exist"),
    (err: unknown) => (err as WalletError).code === "RESERVATION_NOT_FOUND",
  );
});

test("BIN-693 release: INVALID_STATE når reservasjon allerede er released", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  const r = await adapter.reserve!(playerAcc, 250, { idempotencyKey: "k1", roomCode: "R1" });
  await adapter.releaseReservation!(r.id);

  await assert.rejects(
    () => adapter.releaseReservation!(r.id),
    (err: unknown) => (err as WalletError).code === "INVALID_STATE",
  );
});

// ── commitReservation ────────────────────────────────────────────────────────

test("BIN-693 commit: bruker winnings-first-policy (gevinst før deposit)", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  // Spiller: 800 deposit + 200 winnings = 1000 total.
  await seedPlayer(adapter, playerAcc, 800, 200);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });

  const r = await adapter.reserve!(playerAcc, 150, { idempotencyKey: "k1", roomCode: "R1" });
  const transfer = await adapter.commitReservation!(r.id, houseAcc, "Bingo buy-in R1 (3 bonger)", {
    gameSessionId: "game-abc",
  });

  // 150 kr trekkes — gevinst-først: 150 fra winnings (200 > 150, deposit urørt).
  assert.equal(transfer.fromTx.split?.fromWinnings, 150);
  assert.equal(transfer.fromTx.split?.fromDeposit, 0);

  // Spiller etter commit: 800 + 50 = 850 total.
  assert.equal(await adapter.getBalance(playerAcc), 850);
  assert.equal(await adapter.getWinningsBalance(playerAcc), 50);
  assert.equal(await adapter.getDepositBalance(playerAcc), 800);

  // Reservasjonen frigis ikke via separate release — ledger viser committed.
  const active = await adapter.listActiveReservations!(playerAcc);
  assert.equal(active.length, 0);
});

test("BIN-693 commit: gevinst dekker delvis, resten fra deposit", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  // 800 deposit + 50 winnings = 850 total. Commit 150 kr.
  await seedPlayer(adapter, playerAcc, 800, 50);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });

  const r = await adapter.reserve!(playerAcc, 150, { idempotencyKey: "k1", roomCode: "R1" });
  const transfer = await adapter.commitReservation!(r.id, houseAcc, "R1 buy-in");

  // 50 fra winnings, 100 fra deposit.
  assert.equal(transfer.fromTx.split?.fromWinnings, 50);
  assert.equal(transfer.fromTx.split?.fromDeposit, 100);
  assert.equal(await adapter.getDepositBalance(playerAcc), 700);
  assert.equal(await adapter.getWinningsBalance(playerAcc), 0);
});

test("BIN-693 commit: INVALID_STATE når reservasjon allerede committed", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });
  const r = await adapter.reserve!(playerAcc, 100, { idempotencyKey: "k1", roomCode: "R1" });
  await adapter.commitReservation!(r.id, houseAcc, "first commit");

  await assert.rejects(
    () => adapter.commitReservation!(r.id, houseAcc, "second commit"),
    (err: unknown) => (err as WalletError).code === "INVALID_STATE",
  );
});

// ── listActive / listReservationsByRoom ──────────────────────────────────────

test("BIN-693 listActive: kun aktive for gitt wallet", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });

  const r1 = await adapter.reserve!(playerAcc, 100, { idempotencyKey: "k1", roomCode: "R1" });
  await adapter.reserve!(playerAcc, 150, { idempotencyKey: "k2", roomCode: "R2" });
  await adapter.releaseReservation!(r1.id);

  const active = await adapter.listActiveReservations!(playerAcc);
  assert.equal(active.length, 1);
  assert.equal(active[0].amount, 150);
  assert.equal(active[0].roomCode, "R2");
});

test("BIN-693 listByRoom: alle reservasjoner (inkl. committed/released)", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });

  const r1 = await adapter.reserve!(playerAcc, 100, { idempotencyKey: "k1", roomCode: "BINGO1" });
  await adapter.reserve!(playerAcc, 200, { idempotencyKey: "k2", roomCode: "BINGO1" });
  await adapter.reserve!(playerAcc, 50, { idempotencyKey: "k3", roomCode: "OTHER" });
  await adapter.commitReservation!(r1.id, houseAcc, "R1 buy-in");

  const bingo1 = await adapter.listReservationsByRoom!("BINGO1");
  assert.equal(bingo1.length, 2);
  const statuses = bingo1.map((r) => r.status).sort();
  assert.deepEqual(statuses, ["active", "committed"]);
});

// ── expireStaleReservations ─────────────────────────────────────────────────

test("BIN-693 expire: aktive med expires_at < now markeres expired", async () => {
  const { adapter, playerAcc } = makeAdapter();
  await seedPlayer(adapter, playerAcc, 1000);

  const pastExpiry = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
  const futureExpiry = new Date(Date.now() + 60_000).toISOString();

  await adapter.reserve!(playerAcc, 100, {
    idempotencyKey: "stale",
    roomCode: "R1",
    expiresAt: pastExpiry,
  });
  await adapter.reserve!(playerAcc, 150, {
    idempotencyKey: "fresh",
    roomCode: "R1",
    expiresAt: futureExpiry,
  });

  const count = await adapter.expireStaleReservations!(Date.now());
  assert.equal(count, 1);

  const active = await adapter.listActiveReservations!(playerAcc);
  assert.equal(active.length, 1);
  assert.equal(active[0].idempotencyKey, "fresh");

  // Stale-reservasjonen skal ha frigitt available.
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 850);
});

// ── regresjon: bet:arm → cancel → startGame eksempel ────────────────────────

test("BIN-693 flyt: kjøp 5 → avbestill 2 → commit 3 (PM-eksempel)", async () => {
  const { adapter, playerAcc, houseAcc } = makeAdapter();
  // Start: 800 deposit + 200 winnings = 1000 total.
  await seedPlayer(adapter, playerAcc, 800, 200);
  await adapter.createAccount({ accountId: houseAcc, initialBalance: 0 });

  // Kjøper 5 bonger á 50 kr → reservasjon 250.
  const r = await adapter.reserve!(playerAcc, 250, { idempotencyKey: "k1", roomCode: "R1" });
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 750);

  // Avbestiller 2 brett (100 kr prorata).
  await adapter.releaseReservation!(r.id, 100);
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 850);

  // Runden starter → commit 150.
  const transfer = await adapter.commitReservation!(r.id, houseAcc, "R1 buy-in (3 bonger)");
  // Gevinst først: 150 fra winnings (200 > 150).
  assert.equal(transfer.fromTx.split?.fromWinnings, 150);
  assert.equal(transfer.fromTx.split?.fromDeposit, 0);
  assert.equal(await adapter.getDepositBalance(playerAcc), 800);
  assert.equal(await adapter.getWinningsBalance(playerAcc), 50);
  assert.equal(await adapter.getAvailableBalance!(playerAcc), 850); // uendret etter commit
});
