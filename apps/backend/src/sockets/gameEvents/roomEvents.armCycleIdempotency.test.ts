/**
 * Pilot-bug 2026-04-27 (Tobias-rapport): bet:arm idempotency-key var
 * deterministisk per (roomCode, playerId, newTotalWeighted) men IKKE
 * round-scoped. Etter at runde 1 commiter reservasjonen (status=committed),
 * gjenbruker bet:arm for runde 2 samme key hvis spilleren armer samme
 * antall brett. Postgres adapteren kaster da INVALID_STATE: "Idempotency-key
 * arm-... er allerede brukt (status=committed)" og spilleren får
 * "Uventet feil"-popup uten å kunne forhåndskjøpe neste runde.
 *
 * Fix: legg armCycleId (UUID som bumpes ved disarmAllPlayers) inn i keyen
 * så hver runde får friske keys. Reconnect-/retry-flapping innen samme runde
 * holder samme cycle-id og er fortsatt idempotent.
 *
 * Custom mock-adapter speiler Postgres-semantikken (kaster INVALID_STATE
 * når key er kjent og status != active) — ellers ville bug-en ikke
 * reprodusert mot InMemoryWalletAdapter (som silent overskriver).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reservePreRoundDelta } from "./roomEvents.js";
import { RoomStateManager } from "../../util/roomState.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type { GameEventsDeps } from "./deps.js";
import type {
  WalletReservation,
  ReserveOptions,
  WalletAdapter,
} from "../../adapters/WalletAdapter.js";

function makePostgresLikeAdapter(): {
  adapter: Pick<WalletAdapter, "reserve" | "increaseReservation">;
  commit: (resId: string) => void;
  reserveCalls: ReserveOptions[];
} {
  const reservations = new Map<string, WalletReservation>();
  const reservationsByKey = new Map<string, string>();
  const reserveCalls: ReserveOptions[] = [];
  let nextId = 1;

  const adapter = {
    async reserve(
      walletId: string,
      amount: number,
      options: ReserveOptions,
    ): Promise<WalletReservation> {
      reserveCalls.push({ ...options });
      const existingResId = reservationsByKey.get(options.idempotencyKey);
      if (existingResId) {
        const row = reservations.get(existingResId);
        if (row?.status === "active") {
          if (row.amount !== amount) {
            throw new WalletError(
              "IDEMPOTENCY_MISMATCH",
              `Reservasjon med samme key (${options.idempotencyKey}) har beløp ${row.amount}, ikke ${amount}.`,
            );
          }
          return { ...row };
        }
        // Reproduserer prod-bug: status committed/released/expired → INVALID_STATE.
        throw new WalletError(
          "INVALID_STATE",
          `Idempotency-key ${options.idempotencyKey} er allerede brukt (status=${row?.status}).`,
        );
      }
      const id = `res-${nextId++}`;
      const reservation: WalletReservation = {
        id,
        walletId,
        amount,
        idempotencyKey: options.idempotencyKey,
        status: "active",
        roomCode: options.roomCode,
        gameSessionId: null,
        createdAt: new Date().toISOString(),
        releasedAt: null,
        committedAt: null,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
      reservations.set(id, reservation);
      reservationsByKey.set(options.idempotencyKey, id);
      return { ...reservation };
    },
    async increaseReservation(
      reservationId: string,
      extraAmount: number,
    ): Promise<WalletReservation> {
      const existing = reservations.get(reservationId);
      if (!existing) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      if (existing.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${existing.status}.`,
        );
      }
      const updated: WalletReservation = { ...existing, amount: existing.amount + extraAmount };
      reservations.set(reservationId, updated);
      return { ...updated };
    },
  };

  function commit(resId: string): void {
    const row = reservations.get(resId);
    if (!row) throw new Error(`commit: reservation ${resId} not found`);
    reservations.set(resId, {
      ...row,
      status: "committed",
      committedAt: new Date().toISOString(),
    });
  }

  return { adapter, commit, reserveCalls };
}

function makeDeps(opts: {
  adapter: Pick<WalletAdapter, "reserve" | "increaseReservation">;
  roomState: RoomStateManager;
  entryFee?: number;
}): GameEventsDeps {
  const { adapter, roomState, entryFee = 60 } = opts;
  return {
    walletAdapter: adapter,
    getRoomConfiguredEntryFee: () => entryFee,
    getWalletIdForPlayer: () => "wallet-test",
    getReservationId: (code: string, pid: string) => roomState.getReservationId(code, pid),
    setReservationId: (code: string, pid: string, rid: string) =>
      roomState.setReservationId(code, pid, rid),
    clearReservationId: (code: string, pid: string) => roomState.clearReservationId(code, pid),
    getArmCycleId: (code: string) => roomState.getOrCreateArmCycleId(code),
  } as unknown as GameEventsDeps;
}

// ── Bug-repro: pre-pluss arm i to runder med samme antall brett ─────────────

test("Pilot 2026-04-27: arm-key er round-scoped via armCycleId — runde 2 fungerer etter commit i runde 1", async () => {
  const { adapter, commit } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  // Runde 1: spiller armer 6 brett.
  await reservePreRoundDelta(deps, "BINGO1", "p1", 0, 6);
  const round1ResId = roomState.getReservationId("BINGO1", "p1");
  assert.ok(round1ResId, "runde 1 skal ha reservation-id");

  // Runde 1 starter: commit reservasjonen.
  commit(round1ResId!);

  // Game lifecycle: disarmAllPlayers kalles av game:start-handleren.
  roomState.disarmAllPlayers("BINGO1");

  // Runde 2: samme spiller, samme antall brett (6) — pre-fix kastet
  // INVALID_STATE her. Med fix skal dette gå gjennom.
  await reservePreRoundDelta(deps, "BINGO1", "p1", 0, 6);
  const round2ResId = roomState.getReservationId("BINGO1", "p1");
  assert.ok(round2ResId, "runde 2 skal ha reservation-id");
  assert.notEqual(round2ResId, round1ResId, "ny reservation, ikke gjenbruk av committed");
});

// ── Reconnect-resiliens innen samme runde ───────────────────────────────────

test("Pilot 2026-04-27: reconnect-flapping innen samme runde gir samme key (idempotent)", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  await reservePreRoundDelta(deps, "BINGO1", "p1", 0, 6);
  const firstResId = roomState.getReservationId("BINGO1", "p1");

  // Simuler reconnect: socket-laget mistet reservation-tracking.
  roomState.clearReservationId("BINGO1", "p1");
  await reservePreRoundDelta(deps, "BINGO1", "p1", 0, 6);
  const secondResId = roomState.getReservationId("BINGO1", "p1");

  assert.equal(secondResId, firstResId, "samme reservation-id ved reconnect-retry");
  assert.equal(reserveCalls.length, 2, "begge calls skal ha gått til adapter");
  assert.equal(
    reserveCalls[0].idempotencyKey,
    reserveCalls[1].idempotencyKey,
    "samme idempotency-key for begge",
  );
});

// ── Key-format-verifisering ────────────────────────────────────────────────

test("Pilot 2026-04-27: idempotency-key inkluderer armCycleId (UUID-format)", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  await reservePreRoundDelta(deps, "BINGO1", "p1", 0, 6);

  assert.equal(reserveCalls.length, 1);
  const key = reserveCalls[0].idempotencyKey;
  // Format: arm-{roomCode}-{playerId}-{cycleId}-{newTotalWeighted}
  const match = key.match(
    /^arm-BINGO1-p1-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-6$/,
  );
  assert.ok(match, `key skal matche 'arm-BINGO1-p1-{uuid}-6', fikk: ${key}`);
});

// ── Backward-compat: ingen getArmCycleId-dep → pre-fix-format ───────────────

test("Pilot 2026-04-27: backward-compat — uten getArmCycleId-dep brukes pre-fix-format", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps: GameEventsDeps = {
    walletAdapter: adapter,
    getRoomConfiguredEntryFee: () => 60,
    getWalletIdForPlayer: () => "wallet-test",
    getReservationId: (code: string, pid: string) => roomState.getReservationId(code, pid),
    setReservationId: (code: string, pid: string, rid: string) =>
      roomState.setReservationId(code, pid, rid),
    clearReservationId: (code: string, pid: string) => roomState.clearReservationId(code, pid),
    // Bevisst ikke gitt: getArmCycleId
  } as unknown as GameEventsDeps;

  await reservePreRoundDelta(deps, "ROOM-X", "p1", 0, 5);

  assert.equal(reserveCalls.length, 1);
  assert.equal(
    reserveCalls[0].idempotencyKey,
    "arm-ROOM-X-p1-5",
    "uten cycle-dep skal keyen være pre-fix-format",
  );
});

// ── Cycle-management ─────────────────────────────────────────────────────

test("Pilot 2026-04-27: gjentatte disarmAllPlayers gir alltid frisk cycle-id på neste arm", async () => {
  const { adapter } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();

  const cycle1 = roomState.getOrCreateArmCycleId("BINGO1");
  roomState.disarmAllPlayers("BINGO1");
  const cycle2 = roomState.getOrCreateArmCycleId("BINGO1");
  assert.notEqual(cycle1, cycle2, "ny cycle etter disarm");

  const cycle2Repeat = roomState.getOrCreateArmCycleId("BINGO1");
  assert.equal(cycle2, cycle2Repeat, "samme id innen syklus");

  roomState.disarmAllPlayers("BINGO1");
  const cycle3 = roomState.getOrCreateArmCycleId("BINGO1");
  assert.notEqual(cycle2, cycle3, "ny cycle etter andre disarm");

  void adapter;
});
