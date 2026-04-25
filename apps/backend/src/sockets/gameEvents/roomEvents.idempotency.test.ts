/**
 * PR #513 §1.3 (KRITISK pilot-blokker, 2026-04-25):
 * `reservePreRoundDelta` brukte tidligere
 *   `arm-${roomCode}-${playerId}-${Date.now()}-${Math.random()...}`
 * som idempotency-key. Random-komponenten gjorde at retry aldri kunne
 * matche samme key — `reserve()`-idempotency-mekanismen mistet sitt formål.
 *
 * Hvis socket.io re-emit-et samme `bet:arm` (typisk under reconnect-flapping)
 * lagde vi en NY DB-reservasjon hver gang. Hver reservasjon låste penger
 * til 30-minutters TTL utløp → spiller kunne få "INSUFFICIENT_FUNDS"
 * på neste legitime kjøp fordi tidligere duplikater fortsatt holdt
 * tilgjengelig saldo.
 *
 * Fix: `arm-${roomCode}-${playerId}-${newTotalWeighted}` — deterministisk.
 * Et legitimt nytt kjøp endrer `newTotalWeighted` → ny key → ny reservasjon.
 * En duplikat-emit av samme `bet:arm` → samme key → adapter returnerer
 * eksisterende reservasjon (ingen dobbel-låsing).
 *
 * NB: increase-pathen bruker reservation-id direkte og er ikke dekket av
 * idempotency her — men socket.io-acks gir én-gangs-levering for de
 * fleste scenarioene der.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reservePreRoundDelta } from "./roomEvents.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import type { GameEventsDeps } from "./deps.js";
import type { WalletReservation, ReserveOptions } from "../../adapters/WalletAdapter.js";

interface CapturingAdapter {
  inner: InMemoryWalletAdapter;
  reserveCalls: Array<{ accountId: string; amount: number; options: ReserveOptions }>;
}

/** Wrap InMemoryWalletAdapter for å fange opp idempotency-keys. */
function makeCapturingAdapter(): CapturingAdapter {
  const inner = new InMemoryWalletAdapter(0);
  const reserveCalls: Array<{ accountId: string; amount: number; options: ReserveOptions }> = [];
  const originalReserve = inner.reserve!.bind(inner);
  // Patch reserve for å logge kall.
  (inner as unknown as { reserve: typeof originalReserve }).reserve = async (
    accountId: string,
    amount: number,
    options: ReserveOptions,
  ): Promise<WalletReservation> => {
    reserveCalls.push({ accountId, amount, options: { ...options } });
    return originalReserve(accountId, amount, options);
  };
  return { inner, reserveCalls };
}

function makeDeps(adapter: InMemoryWalletAdapter, entryFee = 60): {
  deps: GameEventsDeps;
  reservationStore: Map<string, string>;
} {
  const reservationStore = new Map<string, string>();
  const deps = {
    walletAdapter: adapter,
    getRoomConfiguredEntryFee: () => entryFee,
    getWalletIdForPlayer: (_code: string, _pid: string) => "wallet-test",
    getReservationId: (code: string, pid: string) => reservationStore.get(`${code}:${pid}`) ?? null,
    setReservationId: (code: string, pid: string, rid: string) => {
      reservationStore.set(`${code}:${pid}`, rid);
    },
    clearReservationId: (code: string, pid: string) => {
      reservationStore.delete(`${code}:${pid}`);
    },
  } as unknown as GameEventsDeps;
  return { deps, reservationStore };
}

// ── Deterministisk key-format ───────────────────────────────────────────────

test("PR #513 §1.3: idempotency-key er deterministisk (ingen Date.now/Math.random)", async () => {
  const { inner, reserveCalls } = makeCapturingAdapter();
  await inner.createAccount({ accountId: "wallet-test", initialBalance: 1000 });
  const { deps } = makeDeps(inner);

  await reservePreRoundDelta(deps, "ROOM-X", "player-Y", 0, 5);

  assert.equal(reserveCalls.length, 1);
  assert.equal(
    reserveCalls[0]!.options.idempotencyKey,
    "arm-ROOM-X-player-Y-5",
    `key skal være 'arm-ROOM-X-player-Y-5', fikk: ${reserveCalls[0]!.options.idempotencyKey}`,
  );
  // Ingen tidsstempel eller random-suffix:
  assert.ok(
    !/\d{13}/.test(reserveCalls[0]!.options.idempotencyKey),
    "key skal ikke inneholde Date.now()-stempel (13 sifre)",
  );
});

// ── Retry returnerer samme reservasjon ─────────────────────────────────────

test("PR #513 §1.3: duplikat-call med samme totalWeighted → idempotent (én reservasjon)", async () => {
  const { inner, reserveCalls } = makeCapturingAdapter();
  await inner.createAccount({ accountId: "wallet-test", initialBalance: 1000 });
  const { deps, reservationStore } = makeDeps(inner);

  // Førstegangs bet:arm
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5);
  const firstResId = reservationStore.get("ROOM1:p1");

  // Simuler socket.io-retry: samme call på nytt etter at vi nullstiller
  // reservation-tracking (som om reconnect mistet state). Da går flow-en
  // gjennom `reserve()` igjen — adapter skal returnere SAMME reservation
  // basert på idempotency-key.
  reservationStore.clear();
  await reservePreRoundDelta(deps, "ROOM1", "p1", 0, 5);
  const secondResId = reservationStore.get("ROOM1:p1");

  assert.equal(secondResId, firstResId, "samme reservation-id ved retry");
  assert.equal(reserveCalls.length, 2, "begge kall skal ha gått til adapter");
  assert.equal(
    reserveCalls[0]!.options.idempotencyKey,
    reserveCalls[1]!.options.idempotencyKey,
    "samme idempotency-key for begge",
  );

  // Available skal kun reflektere ÉN reservasjon (300 kr, ikke 600).
  assert.equal(await inner.getAvailableBalance!("wallet-test"), 700);

  // Kun én aktiv reservasjon — ikke dobbel-låsing.
  const active = await inner.listActiveReservations!("wallet-test");
  assert.equal(active.length, 1);
});

// ── Nytt totalWeighted = ny reservasjon ────────────────────────────────────

test("PR #513 §1.3: nytt totalWeighted gir ny key i reserve()-pathen", async () => {
  // Verifiser at NÅR reserve() blir kalt (ikke increase-path), bruker den
  // newTotalWeighted i key-en. Increase-path gjelder kun når reservation-id
  // allerede er trackes i room-state.
  const { inner, reserveCalls } = makeCapturingAdapter();
  await inner.createAccount({ accountId: "wallet-A", initialBalance: 10_000 });
  await inner.createAccount({ accountId: "wallet-B", initialBalance: 10_000 });

  // To ulike spillere → reserve() kjører for begge (ulike reservation-IDer).
  const reservationStore = new Map<string, string>();
  function makeDepsWithWallet(walletId: string): GameEventsDeps {
    return {
      walletAdapter: inner,
      getRoomConfiguredEntryFee: () => 60,
      getWalletIdForPlayer: () => walletId,
      getReservationId: (code: string, pid: string) => reservationStore.get(`${code}:${pid}`) ?? null,
      setReservationId: (code: string, pid: string, rid: string) => {
        reservationStore.set(`${code}:${pid}`, rid);
      },
      clearReservationId: (code: string, pid: string) => {
        reservationStore.delete(`${code}:${pid}`);
      },
    } as unknown as GameEventsDeps;
  }

  // p1 / 5 brett, p2 / 7 brett — begge går gjennom reserve() med ulike keys.
  await reservePreRoundDelta(makeDepsWithWallet("wallet-A"), "ROOM-A", "p1", 0, 5);
  await reservePreRoundDelta(makeDepsWithWallet("wallet-B"), "ROOM-A", "p2", 0, 7);

  const keyP1 = reserveCalls.find((c) => c.accountId === "wallet-A");
  const keyP2 = reserveCalls.find((c) => c.accountId === "wallet-B");
  assert.equal(keyP1!.options.idempotencyKey, "arm-ROOM-A-p1-5");
  assert.equal(keyP2!.options.idempotencyKey, "arm-ROOM-A-p2-7");
});
