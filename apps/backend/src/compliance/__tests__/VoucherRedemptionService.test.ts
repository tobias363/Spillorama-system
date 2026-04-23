/**
 * BIN-587 B4b follow-up: unit-tester for VoucherRedemptionService.
 *
 * Pool-mock dekker business-logikk: validering (utløpt/inaktiv/exhausted),
 * rabatt-beregning (percentage vs flat), atomisk INSERT + uses_count++,
 * idempotens via UNIQUE(voucher_id, user_id), og cross-game-slug-bruk
 * (én voucher kan brukes i ett spill uten å blokkere andre spillere).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  VoucherRedemptionService,
  computeDiscountCents,
} from "../VoucherRedemptionService.js";
import { DomainError } from "../../game/BingoEngine.js";

type VoucherType = "PERCENTAGE" | "FLAT_AMOUNT";

interface VoucherFixture {
  id: string;
  code: string;
  type: VoucherType;
  value: number;
  max_uses: number | null;
  uses_count: number;
  valid_from: Date | null;
  valid_to: Date | null;
  is_active: boolean;
}

interface RedemptionFixture {
  id: string;
  voucher_id: string;
  user_id: string;
  wallet_id: string;
  game_slug: string;
  scheduled_game_id: string | null;
  room_code: string | null;
  discount_applied_cents: number;
  redeemed_at: Date;
}

interface Store {
  vouchersById: Map<string, VoucherFixture>;
  vouchersByCode: Map<string, string>; // code → id
  redemptions: RedemptionFixture[];
}

function newStore(): Store {
  return {
    vouchersById: new Map(),
    vouchersByCode: new Map(),
    redemptions: [],
  };
}

function seedVoucher(store: Store, v: Partial<VoucherFixture> & { id: string; code: string }): VoucherFixture {
  const row: VoucherFixture = {
    id: v.id,
    code: v.code,
    type: v.type ?? "PERCENTAGE",
    value: v.value ?? 10,
    max_uses: v.max_uses ?? null,
    uses_count: v.uses_count ?? 0,
    valid_from: v.valid_from ?? null,
    valid_to: v.valid_to ?? null,
    is_active: v.is_active ?? true,
  };
  store.vouchersById.set(row.id, row);
  store.vouchersByCode.set(row.code, row.id);
  return row;
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK")) {
    return { rows: [], rowCount: 0 };
  }

  if (t.startsWith("SELECT")) {
    if (sql.includes('"app_vouchers"') && sql.includes("WHERE code = $1")) {
      const [code] = params as [string];
      const id = store.vouchersByCode.get(code);
      const v = id ? store.vouchersById.get(id) : null;
      return v ? { rows: [v], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('"app_voucher_redemptions"') && sql.includes("WHERE voucher_id = $1 AND user_id = $2")) {
      const [voucherId, userId] = params as [string, string];
      const r = store.redemptions.find((x) => x.voucher_id === voucherId && x.user_id === userId);
      return r ? { rows: [r], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('"app_voucher_redemptions"') && sql.includes("WHERE user_id = $1")) {
      const [userId, limit] = params as [string, number];
      const list = store.redemptions
        .filter((r) => r.user_id === userId)
        .sort((a, b) => b.redeemed_at.getTime() - a.redeemed_at.getTime())
        .slice(0, limit);
      return { rows: list, rowCount: list.length };
    }
  }

  if (t.startsWith("INSERT") && sql.includes('"app_voucher_redemptions"')) {
    const [id, voucher_id, user_id, wallet_id, game_slug, scheduled_game_id, room_code, discount_applied_cents] =
      params as [string, string, string, string, string, string | null, string | null, number];
    // UNIQUE(voucher_id, user_id)
    if (store.redemptions.some((r) => r.voucher_id === voucher_id && r.user_id === user_id)) {
      const err = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
      err.code = "23505";
      throw err;
    }
    const row: RedemptionFixture = {
      id, voucher_id, user_id, wallet_id, game_slug,
      scheduled_game_id, room_code, discount_applied_cents,
      redeemed_at: new Date(),
    };
    store.redemptions.push(row);
    return { rows: [row], rowCount: 1 };
  }

  if (t.startsWith("UPDATE") && sql.includes('"app_vouchers"')) {
    // uses_count-increment
    const [id] = params as [string];
    const v = store.vouchersById.get(id);
    if (!v) return { rows: [], rowCount: 0 };
    v.uses_count += 1;
    return { rows: [v], rowCount: 1 };
  }

  throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect(): Promise<PoolClient> {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
        release() {},
      } as unknown as PoolClient;
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
  };
  return pool as unknown as Pool;
}

// ── Tests ───────────────────────────────────────────────────────────────

test("redemption: computeDiscountCents — percentage floor", () => {
  assert.equal(computeDiscountCents("PERCENTAGE", 25, 100), 25);
  assert.equal(computeDiscountCents("PERCENTAGE", 25, 99), 24); // floor
  assert.equal(computeDiscountCents("PERCENTAGE", 0, 100), 0);
  assert.equal(computeDiscountCents("PERCENTAGE", 100, 100), 100);
  // Klemmer > 100 til 100
  assert.equal(computeDiscountCents("PERCENTAGE", 150, 100), 100);
});

test("redemption: computeDiscountCents — flat amount clamped to price", () => {
  assert.equal(computeDiscountCents("FLAT_AMOUNT", 50, 100), 50);
  assert.equal(computeDiscountCents("FLAT_AMOUNT", 200, 100), 100); // clamp
  assert.equal(computeDiscountCents("FLAT_AMOUNT", 0, 100), 0);
});

test("redemption: redeem percentage voucher — happy path", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "SUMMER25", type: "PERCENTAGE", value: 25 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  const result = await svc.redeem({
    code: "summer25",
    userId: "user-a", walletId: "w-a",
    gameSlug: "game2", ticketPriceCents: 1000,
  });

  assert.equal(result.discount.code, "SUMMER25");
  assert.equal(result.discount.type, "PERCENTAGE");
  assert.equal(result.discount.discountAppliedCents, 250);
  assert.equal(result.discount.finalPriceCents, 750);
  assert.equal(store.redemptions.length, 1);
  assert.equal(store.vouchersById.get("v1")!.uses_count, 1);
});

test("redemption: redeem flat-amount voucher", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "FLAT50", type: "FLAT_AMOUNT", value: 5000 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  const result = await svc.redeem({
    code: "FLAT50",
    userId: "user-a", walletId: "w-a",
    gameSlug: "game3", ticketPriceCents: 10000,
  });
  assert.equal(result.discount.discountAppliedCents, 5000);
  assert.equal(result.discount.finalPriceCents, 5000);
});

test("redemption: redeem avviser utløpt voucher", async () => {
  const store = newStore();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  seedVoucher(store, { id: "v1", code: "EXPIRED", valid_to: oneDayAgo });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "EXPIRED",
      userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_EXPIRED",
  );
  assert.equal(store.redemptions.length, 0);
});

test("redemption: redeem avviser inaktiv voucher", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "INACTIVE", is_active: false });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "INACTIVE", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_INACTIVE",
  );
});

test("redemption: redeem avviser not-yet-valid voucher", async () => {
  const store = newStore();
  const inOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  seedVoucher(store, { id: "v1", code: "FUTURE", valid_from: inOneDay });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "FUTURE", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_NOT_YET_VALID",
  );
});

test("redemption: redeem avviser når max_uses nådd", async () => {
  const store = newStore();
  seedVoucher(store, {
    id: "v1", code: "LIMITED", max_uses: 1, uses_count: 1,
  });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "LIMITED", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_EXHAUSTED",
  );
});

test("redemption: redeem avviser ukjent kode", async () => {
  const store = newStore();
  const svc = VoucherRedemptionService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.redeem({
      code: "NOPE", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_NOT_FOUND",
  );
});

test("redemption: idempotent rerun — samme spiller kan ikke bruke samme kode to ganger", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "ONCE", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  // Første redemption OK
  const first = await svc.redeem({
    code: "ONCE", userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 100,
  });
  assert.equal(first.discount.discountAppliedCents, 10);

  // Andre redemption fra samme spiller → ALREADY_REDEEMED
  await assert.rejects(
    () => svc.redeem({
      code: "ONCE", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_ALREADY_REDEEMED",
  );
  // uses_count skal ha blitt 1 (ikke 2)
  assert.equal(store.vouchersById.get("v1")!.uses_count, 1);
  assert.equal(store.redemptions.length, 1);
});

test("redemption: to ulike spillere kan bruke samme kode", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "SHARED", type: "PERCENTAGE", value: 15 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await svc.redeem({
    code: "SHARED", userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 200,
  });
  await svc.redeem({
    code: "SHARED", userId: "u2", walletId: "w2",
    gameSlug: "game3", ticketPriceCents: 200,
  });
  assert.equal(store.redemptions.length, 2);
  assert.equal(store.vouchersById.get("v1")!.uses_count, 2);
});

test("redemption: validateCode returnerer discount uten state-endring", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "CHECK", type: "PERCENTAGE", value: 20 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  const discount = await svc.validateCode({
    code: "check", userId: "u1", gameSlug: "game2", ticketPriceCents: 500,
  });
  assert.equal(discount.discountAppliedCents, 100);
  assert.equal(discount.finalPriceCents, 400);
  // Ingen redemption-rad skrevet
  assert.equal(store.redemptions.length, 0);
  assert.equal(store.vouchersById.get("v1")!.uses_count, 0);
});

test("redemption: validateCode kaster ALREADY_REDEEMED hvis spilleren har brukt den", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "USED", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await svc.redeem({
    code: "USED", userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 100,
  });
  await assert.rejects(
    () => svc.validateCode({
      code: "USED", userId: "u1", gameSlug: "game2", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_ALREADY_REDEEMED",
  );
});

test("redemption: avviser negativ / null pris", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "PRICEBAD", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "PRICEBAD", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: 0,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => svc.redeem({
      code: "PRICEBAD", userId: "u1", walletId: "w1",
      gameSlug: "game2", ticketPriceCents: -100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("redemption: avviser ikke-støttet gameSlug", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "GAMESLUG", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await assert.rejects(
    () => svc.redeem({
      code: "GAMESLUG", userId: "u1", walletId: "w1",
      gameSlug: "unknown-game", ticketPriceCents: 100,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("redemption: listRedemptionsForUser returnerer egen historikk sortert nyest først", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "FIRST", type: "FLAT_AMOUNT", value: 100 });
  seedVoucher(store, { id: "v2", code: "SECOND", type: "FLAT_AMOUNT", value: 200 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await svc.redeem({
    code: "FIRST", userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 1000,
  });
  // Litt forskyvning så sortering er deterministisk
  await new Promise((r) => setTimeout(r, 2));
  await svc.redeem({
    code: "SECOND", userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 1000,
  });

  const list = await svc.listRedemptionsForUser("u1");
  assert.equal(list.length, 2);
  assert.equal(list[0]!.voucherId, "v2"); // nyest først
  assert.equal(list[1]!.voucherId, "v1");
});

test("redemption: scheduled-games-innløsning persisterer scheduledGameId", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "G1SCHED", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await svc.redeem({
    code: "G1SCHED",
    userId: "u1", walletId: "w1",
    gameSlug: "game1", ticketPriceCents: 2000,
    scheduledGameId: "scheduled-abc-123",
  });
  assert.equal(store.redemptions[0]!.scheduled_game_id, "scheduled-abc-123");
  assert.equal(store.redemptions[0]!.room_code, null);
});

test("redemption: ad-hoc-rom-innløsning persisterer roomCode (uppercased)", async () => {
  const store = newStore();
  seedVoucher(store, { id: "v1", code: "ADHOC", type: "PERCENTAGE", value: 10 });
  const svc = VoucherRedemptionService.forTesting(makePool(store));

  await svc.redeem({
    code: "ADHOC",
    userId: "u1", walletId: "w1",
    gameSlug: "game2", ticketPriceCents: 100,
    roomCode: "xyz99",
  });
  assert.equal(store.redemptions[0]!.room_code, "XYZ99");
  assert.equal(store.redemptions[0]!.scheduled_game_id, null);
});
