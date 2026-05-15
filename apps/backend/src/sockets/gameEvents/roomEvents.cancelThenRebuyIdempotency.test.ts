/**
 * Sentry SPILLORAMA-BACKEND-6 (2026-05-15, Tobias-rapport):
 *
 *   Error: Reservasjon med samme key (arm-BINGO_DEMO-PILOT-GOH-...-9) har
 *   beløp 60, ikke 180.
 *   errCode: IDEMPOTENCY_MISMATCH
 *
 * Reproduksjon:
 *  1. Spiller kjøper bonger (eks. 60 kr) → bet:arm med newTotalWeighted=N
 *     → reservation #1 (60 kr, active, key arm-{room}-{user}-{cycle1}-{N})
 *  2. Spiller avbestiller ALLE bonger via × i BuyPopup / cancelAll
 *     → releasePreRoundReservation: status='released', in-memory resId cleared
 *     → MEN armCycleId IKKE bumpet (pre-fix bug)
 *  3. Spiller forlater spillerklient og kommer tilbake
 *  4. Spiller kjøper nye bonger (eks. 180 kr) → bet:arm med newTotalWeighted=N
 *     (samme weighted-count som forrige attempt!)
 *     → reserve() med samme key fordi armCycleId er uendret
 *     → adapter finner stale released-rad / aktiv rad → IDEMPOTENCY_MISMATCH
 *
 * Fix: bump arm-cycle etter player-level full-disarm (cancelAll /
 * ticket:cancel fullyDisarmed=true) så gjenkjøp får frisk key.
 *
 * Reconnect-resiliens preserveres: bumpen skjer KUN ved bevisst full-disarm,
 * ikke ved reconnect-flapping innen samme arm-cycle.
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
  adapter: Pick<WalletAdapter, "reserve" | "increaseReservation" | "releaseReservation">;
  reserveCalls: ReserveOptions[];
  getReservation: (id: string) => WalletReservation | undefined;
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
        // Status != active (released/committed/expired) → INVALID_STATE.
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
    async releaseReservation(
      reservationId: string,
      amount?: number,
    ): Promise<WalletReservation> {
      const existing = reservations.get(reservationId);
      if (!existing) {
        throw new WalletError("RESERVATION_NOT_FOUND", `Reservasjon ${reservationId} finnes ikke.`);
      }
      if (existing.status !== "active") {
        throw new WalletError(
          "INVALID_STATE",
          `Reservasjon ${reservationId} er ${existing.status}, kan ikke frigis.`,
        );
      }
      if (amount === undefined || amount >= existing.amount) {
        const updated: WalletReservation = {
          ...existing,
          status: "released",
          releasedAt: new Date().toISOString(),
        };
        reservations.set(reservationId, updated);
        return { ...updated };
      }
      const updated: WalletReservation = {
        ...existing,
        amount: existing.amount - amount,
      };
      reservations.set(reservationId, updated);
      return { ...updated };
    },
  };

  return {
    adapter,
    reserveCalls,
    getReservation: (id: string) => reservations.get(id),
  };
}

function makeDeps(opts: {
  adapter: Pick<WalletAdapter, "reserve" | "increaseReservation" | "releaseReservation">;
  roomState: RoomStateManager;
  entryFee?: number;
}): GameEventsDeps {
  const { adapter, roomState, entryFee = 5 } = opts;
  return {
    walletAdapter: adapter,
    getRoomConfiguredEntryFee: () => entryFee,
    getWalletIdForPlayer: () => "wallet-test",
    getReservationId: (code: string, pid: string) => roomState.getReservationId(code, pid),
    setReservationId: (code: string, pid: string, rid: string) =>
      roomState.setReservationId(code, pid, rid),
    clearReservationId: (code: string, pid: string) => roomState.clearReservationId(code, pid),
    getArmCycleId: (code: string) => roomState.getOrCreateArmCycleId(code),
    bumpArmCycle: (code: string) => roomState.bumpArmCycle(code),
  } as unknown as GameEventsDeps;
}

// ── Bug-repro: kjøp → cancel → kjøp igjen MED SAMME weighted-count ─────────

test("Sentry SPILLORAMA-BACKEND-6: gjenkjøp etter cancelAll ikke kolliderer med stale released-key", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  const roomCode = "BINGO_TEST";
  const playerId = "user-1";

  // Steg 1: kjøp første bonger — 12 weighted (60 kr ved entryFee=5)
  await reservePreRoundDelta(deps, roomCode, playerId, 0, 12);
  const firstResId = roomState.getReservationId(roomCode, playerId);
  assert.ok(firstResId, "første reservation må eksistere");
  const firstKey = reserveCalls[0].idempotencyKey;
  assert.ok(firstKey.includes("-12"), `key skal slutte på -12 (newTotalWeighted): ${firstKey}`);

  // Steg 2: avbestilles alle bonger (cancelAll via bet:arm wantArmed=false).
  // releasePreRoundReservation kjører full release + clearReservationId.
  // Med fix bumpes også armCycleId.
  await adapter.releaseReservation!(firstResId!);
  roomState.clearReservationId(roomCode, playerId);
  deps.bumpArmCycle?.(roomCode);

  // Steg 3: gjenkjøp med SAMME weighted-count (12) — i pre-fix bug, key
  // ville kollidere med stale released-rad og kaste INVALID_STATE/MISMATCH.
  await reservePreRoundDelta(deps, roomCode, playerId, 0, 12);
  const secondResId = roomState.getReservationId(roomCode, playerId);
  assert.ok(secondResId, "andre reservation må eksistere");
  assert.notEqual(secondResId, firstResId, "ny reservation-id, ikke gjenbruk");

  // Verifiser at keys er forskjellige fordi armCycleId ble bumpet.
  const secondKey = reserveCalls[1].idempotencyKey;
  assert.notEqual(firstKey, secondKey, "keys må være forskjellige etter cycle-bump");
  assert.ok(secondKey.includes("-12"), `andre key skal også slutte på -12: ${secondKey}`);
});

// ── Bug-repro med ulikt beløp (eksakt Sentry-scenario) ─────────────────────

test("Sentry SPILLORAMA-BACKEND-6: gjenkjøp med ULIKT beløp fungerer etter cycle-bump", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  const roomCode = "BINGO_TEST";
  const playerId = "user-1";

  // Steg 1: kjøp 12 weighted (60 kr)
  await reservePreRoundDelta(deps, roomCode, playerId, 0, 12);
  const firstResId = roomState.getReservationId(roomCode, playerId);
  assert.ok(firstResId);

  // Steg 2: cancel alle (release + clear + bump cycle).
  await adapter.releaseReservation!(firstResId!);
  roomState.clearReservationId(roomCode, playerId);
  deps.bumpArmCycle?.(roomCode);

  // Steg 3: gjenkjøp 36 weighted (180 kr) — i pre-fix bug, hvis weighted
  // ble lik (eks. 9 i Sentry-eksempel), ville key kollidert og kastet
  // IDEMPOTENCY_MISMATCH. Med fix: ny cycle = ny key = ny reservasjon.
  await reservePreRoundDelta(deps, roomCode, playerId, 0, 36);
  const secondResId = roomState.getReservationId(roomCode, playerId);
  assert.ok(secondResId);
  assert.notEqual(secondResId, firstResId);
  assert.notEqual(reserveCalls[0].idempotencyKey, reserveCalls[1].idempotencyKey);
});

// ── Reconnect-resiliens preserveres ─────────────────────────────────────────

test("Sentry SPILLORAMA-BACKEND-6: reconnect-flapping innen samme arm-cycle (ingen cancel) gir samme key", async () => {
  const { adapter, reserveCalls } = makePostgresLikeAdapter();
  const roomState = new RoomStateManager();
  const deps = makeDeps({ adapter, roomState });

  const roomCode = "BINGO_TEST";
  const playerId = "user-1";

  await reservePreRoundDelta(deps, roomCode, playerId, 0, 12);
  const firstResId = roomState.getReservationId(roomCode, playerId);

  // Reconnect: socket-laget mistet reservation-tracking (men IKKE cancel).
  // Cycle skal IKKE bumpes — bare in-memory mapping.
  roomState.clearReservationId(roomCode, playerId);
  // NB: ingen bumpArmCycle her — vi simulerer reconnect, ikke cancel.

  await reservePreRoundDelta(deps, roomCode, playerId, 0, 12);
  const secondResId = roomState.getReservationId(roomCode, playerId);

  assert.equal(secondResId, firstResId, "samme reservation ved reconnect uten cancel");
  assert.equal(
    reserveCalls[0].idempotencyKey,
    reserveCalls[1].idempotencyKey,
    "samme key innen samme cycle (idempotent)",
  );
});

// ── Verifiser at bumpArmCycle bytter cycle-id ───────────────────────────────

test("Sentry SPILLORAMA-BACKEND-6: bumpArmCycle gir frisk UUID på neste getOrCreateArmCycleId", async () => {
  const roomState = new RoomStateManager();
  const roomCode = "BINGO_TEST";

  const cycle1 = roomState.getOrCreateArmCycleId(roomCode);
  assert.ok(cycle1.length > 10, "cycle-id skal være UUID");

  // Samme cycle innen syklus.
  const cycle1Repeat = roomState.getOrCreateArmCycleId(roomCode);
  assert.equal(cycle1, cycle1Repeat);

  // Bump → ny cycle på neste call.
  roomState.bumpArmCycle(roomCode);
  const cycle2 = roomState.getOrCreateArmCycleId(roomCode);
  assert.notEqual(cycle1, cycle2, "ny cycle etter bump");

  // Bump er idempotent — bump på allerede-bumpet rom bare sletter (no-op).
  roomState.bumpArmCycle(roomCode);
  roomState.bumpArmCycle(roomCode);
  const cycle3 = roomState.getOrCreateArmCycleId(roomCode);
  assert.notEqual(cycle2, cycle3, "ny cycle etter bumps");
});
