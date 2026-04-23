/**
 * BIN-587 B4b follow-up: integrasjonstest for socket-event `voucher:redeem`.
 *
 * Tester går via `registerVoucherEvents(ctx)` med en mock-socket som holder
 * registered handlers og en stub-VoucherRedemptionService. Dette gir oss
 * wire-contract-verifikasjon uten å dra inn hele BingoEngine.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { registerVoucherEvents } from "../gameEvents/voucherEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type {
  VoucherRedemptionService,
  RedemptionResult,
  AppliedDiscount,
} from "../../compliance/VoucherRedemptionService.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface MockSocket extends EventEmitter {
  id: string;
  emit: EventEmitter["emit"];
  emittedEvents: Array<{ event: string; payload: unknown }>;
}

function makeMockSocket(): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  ee.emittedEvents = [];
  const origEmit = ee.emit.bind(ee);
  ee.emit = (event: string, ...args: unknown[]) => {
    ee.emittedEvents.push({ event, payload: args[0] });
    return origEmit(event, ...args);
  };
  return ee;
}

function makeCtx(overrides: {
  user: PublicAppUser;
  voucherRedemptionService?: VoucherRedemptionService;
}): { ctx: SocketContext; socket: MockSocket; acks: Array<unknown> } {
  const socket = makeMockSocket();
  const acks: unknown[] = [];
  const deps = {
    voucherRedemptionService: overrides.voucherRedemptionService,
  } as unknown as GameEventsDeps;

  // Minimal SocketContext-implementasjon. Kun handlers som `voucher:redeem`
  // bruker behøver å være implementert.
  const ctx = {
    socket,
    deps,
    ackSuccess<T>(cb: (r: { ok: boolean; data: T }) => void, data: T) {
      const resp = { ok: true, data };
      acks.push(resp);
      cb(resp);
    },
    ackFailure<T>(cb: (r: { ok: boolean; error: { code: string; message: string } }) => void, err: unknown) {
      const pub = err instanceof DomainError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      const resp = { ok: false, error: pub };
      acks.push(resp);
      cb(resp as never);
    },
    rateLimited<P, R>(
      _event: string,
      handler: (payload: P, cb: (response: unknown) => void) => Promise<void>,
    ): (payload: P, cb: (response: unknown) => void) => void {
      return (payload, cb) => {
        handler(payload, cb).catch((err) => {
          cb({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err) } });
        });
      };
    },
    getAuthenticatedSocketUser: async () => overrides.user,
  } as unknown as SocketContext;

  return { ctx, socket, acks };
}

const playerUser: PublicAppUser = {
  id: "user-1", email: "p@test.no", displayName: "Player",
  walletId: "w-1", role: "PLAYER", hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  balance: 1000,
};

const adminUser: PublicAppUser = { ...playerUser, id: "user-admin", role: "ADMIN" };

function stubDiscount(overrides: Partial<AppliedDiscount> = {}): AppliedDiscount {
  return {
    voucherId: "v1",
    code: "WELCOME",
    type: "PERCENTAGE",
    value: 25,
    discountAppliedCents: 250,
    finalPriceCents: 750,
    ...overrides,
  };
}

function stubService(behavior: {
  redeem?: (input: unknown) => Promise<RedemptionResult>;
  validateCode?: (input: unknown) => Promise<AppliedDiscount>;
}): VoucherRedemptionService {
  return {
    redeem: behavior.redeem ?? (async () => {
      throw new Error("redeem-stub ikke konfigurert");
    }),
    validateCode: behavior.validateCode ?? (async () => {
      throw new Error("validateCode-stub ikke konfigurert");
    }),
    listRedemptionsForUser: async () => [],
  } as unknown as VoucherRedemptionService;
}

async function invokeRedeem(
  socket: MockSocket,
  payload: Record<string, unknown>,
): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit("voucher:redeem", payload, (response: unknown) => {
      resolve({ response: response as never });
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

test("voucher:redeem — happy path emitter voucher:redeemed + ack success", async () => {
  let captured: unknown = null;
  const svc = stubService({
    redeem: async (input) => {
      captured = input;
      return {
        redemptionId: "red-1",
        redeemedAt: "2026-04-23T12:00:00Z",
        discount: stubDiscount(),
      };
    },
  });
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    code: "welcome",
    gameSlug: "game2",
    ticketPriceCents: 1000,
    roomCode: "ROOM1",
  });

  assert.equal(response.ok, true);
  const data = response.data as { voucherId: string; discountAppliedCents: number; validateOnly: boolean };
  assert.equal(data.voucherId, "v1");
  assert.equal(data.discountAppliedCents, 250);
  assert.equal(data.validateOnly, false);

  const emitted = socket.emittedEvents.find((e) => e.event === "voucher:redeemed");
  assert.ok(emitted, "voucher:redeemed skal bli emitted");

  // Verifiser at input ble videresendt korrekt
  const input = captured as {
    code: string; userId: string; walletId: string;
    gameSlug: string; ticketPriceCents: number; roomCode: string | null;
  };
  assert.equal(input.code, "welcome");
  assert.equal(input.userId, "user-1");
  assert.equal(input.walletId, "w-1");
  assert.equal(input.ticketPriceCents, 1000);
  assert.equal(input.roomCode, "ROOM1");
});

test("voucher:redeem — validateOnly returnerer discount uten å kalle redeem", async () => {
  let redeemCalled = false;
  const svc = stubService({
    redeem: async () => {
      redeemCalled = true;
      throw new Error("skal ikke kalles");
    },
    validateCode: async () => stubDiscount({ discountAppliedCents: 100, finalPriceCents: 400 }),
  });
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    code: "CHECK", gameSlug: "game2", ticketPriceCents: 500, validateOnly: true,
  });

  assert.equal(response.ok, true);
  const data = response.data as { validateOnly: boolean; redemptionId: null; discountAppliedCents: number };
  assert.equal(data.validateOnly, true);
  assert.equal(data.redemptionId, null);
  assert.equal(data.discountAppliedCents, 100);
  assert.equal(redeemCalled, false);
});

test("voucher:redeem — DomainError emitter voucher:rejected + ack failure", async () => {
  const svc = stubService({
    redeem: async () => {
      throw new DomainError("VOUCHER_EXPIRED", "Koden er utløpt.");
    },
  });
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    code: "OLD", gameSlug: "game2", ticketPriceCents: 100,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "VOUCHER_EXPIRED");

  const rejected = socket.emittedEvents.find((e) => e.event === "voucher:rejected");
  assert.ok(rejected, "voucher:rejected skal bli emitted ved DomainError");
  const payload = rejected.payload as { code: string; message: string };
  assert.equal(payload.code, "VOUCHER_EXPIRED");
});

test("voucher:redeem — admin-rolle blir avvist med FORBIDDEN", async () => {
  const svc = stubService({ redeem: async () => { throw new Error("skal ikke kalles"); } });
  const { ctx, socket } = makeCtx({ user: adminUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    code: "ANY", gameSlug: "game2", ticketPriceCents: 100,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "FORBIDDEN");
});

test("voucher:redeem — manglende service svarer NOT_SUPPORTED", async () => {
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: undefined });
  registerVoucherEvents(ctx);
  const { response } = await invokeRedeem(socket, {
    code: "ANY", gameSlug: "game2", ticketPriceCents: 100,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "NOT_SUPPORTED");
});

test("voucher:redeem — avviser negativ ticketPriceCents", async () => {
  const svc = stubService({ redeem: async () => { throw new Error("skal ikke kalles"); } });
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    code: "ANY", gameSlug: "game2", ticketPriceCents: -100,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("voucher:redeem — manglende code svarer INVALID_INPUT", async () => {
  const svc = stubService({ redeem: async () => { throw new Error("skal ikke kalles"); } });
  const { ctx, socket } = makeCtx({ user: playerUser, voucherRedemptionService: svc });
  registerVoucherEvents(ctx);

  const { response } = await invokeRedeem(socket, {
    gameSlug: "game2", ticketPriceCents: 100,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});
