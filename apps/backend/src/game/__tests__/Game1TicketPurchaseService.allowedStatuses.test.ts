/**
 * F7 (E2E-verification 2026-Q3): tillatte purchase-statuser.
 *
 * Bug: `Game1TicketPurchaseService.purchase` og `assertPurchaseOpen`
 * krevde tidligere at scheduled_game.status === 'purchase_open'. En tidligere
 * catalog-plan-flyt spawnet scheduled-games direkte i `ready_to_start`, og
 * `ready_to_start` må fortsatt aksepteres som transition/compat-status.
 * Resultatet pre-fix var at billettkjøp kunne blokkeres med
 * `PURCHASE_CLOSED_FOR_GAME` selv om master ennå ikke hadde startet trekning.
 *
 * Fix: tillat begge `purchase_open` og `ready_to_start`. `running` er
 * fortsatt blokkert (regulatorisk + UX — ingen kjøp etter første ball
 * trekkes).
 *
 * Disse testene sikrer at det er en kompakt liste av tillatte statuser,
 * og at både ny purchase_open-flyt og legacy/transition-flyt fungerer.
 *
 * Test-strategi: vi bruker `assertPurchaseOpen` siden den har samme
 * status-sjekk og er enklere å teste isolert (ingen wallet/audit-mocks).
 * Mock-pool returnerer bare scheduled-game-row + minimal hall-ready-stub.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { Game1TicketPurchaseService } from "../Game1TicketPurchaseService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { Game1HallReadyService } from "../Game1HallReadyService.js";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import type { PlatformService } from "../../platform/PlatformService.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";

interface ScheduledGameRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
  master_hall_id: string;
  group_hall_id: string | null;
  participating_halls_json: unknown;
  scheduled_start_time: Date | null;
  scheduled_end_time: Date | null;
  notification_start_seconds: number;
}

function makePoolReturningGame(row: ScheduledGameRow | null): Pool {
  const fakePool = {
    query: async (
      _sql: string,
      _params?: unknown[],
    ): Promise<{ rows: ScheduledGameRow[]; rowCount: number }> => {
      if (row) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return fakePool as unknown as Pool;
}

function makeHallReadyAccepting(): Game1HallReadyService {
  // Stub — assertPurchaseOpenForHall is a no-op for these tests.
  return {
    assertPurchaseOpenForHall: async (
      _scheduledGameId: string,
      _hallId: string,
    ): Promise<void> => undefined,
  } as unknown as Game1HallReadyService;
}

function makeService(
  pool: Pool,
  hallReady?: Game1HallReadyService,
): Game1TicketPurchaseService {
  return new Game1TicketPurchaseService({
    pool,
    schema: "public",
    walletAdapter: {} as unknown as WalletAdapter,
    platformService: {} as unknown as PlatformService,
    hallReadyService: hallReady ?? makeHallReadyAccepting(),
    auditLogService: {} as unknown as AuditLogService,
  });
}

function baseRow(status: string): ScheduledGameRow {
  return {
    id: "game-1",
    status,
    ticket_config_json: {},
    master_hall_id: "hall-1",
    group_hall_id: null,
    participating_halls_json: ["hall-1"],
    scheduled_start_time: new Date("2026-05-09T18:00:00.000Z"),
    scheduled_end_time: new Date("2026-05-09T19:00:00.000Z"),
    notification_start_seconds: 300,
  };
}

test("F7: assertPurchaseOpen accepts status='purchase_open' (legacy cron flow)", async () => {
  const pool = makePoolReturningGame(baseRow("purchase_open"));
  const service = makeService(pool);
  await service.assertPurchaseOpen("game-1", "hall-1");
  // Reaching here without throwing is success.
  assert.ok(true, "purchase_open should be allowed");
});

test("F7: assertPurchaseOpen accepts status='ready_to_start' (compat transition)", async () => {
  const pool = makePoolReturningGame(baseRow("ready_to_start"));
  const service = makeService(pool);
  // Pre-fix: this would throw PURCHASE_CLOSED_FOR_GAME.
  // Post-fix: accepted as a compatibility/transition status. Current
  // GamePlanEngineBridge opens fresh plan-runtime rows in purchase_open.
  await service.assertPurchaseOpen("game-1", "hall-1");
  assert.ok(true, "ready_to_start should be allowed (regression-lock for F7 fix)");
});

test("F7: assertPurchaseOpen rejects status='scheduled' (pre-purchase window)", async () => {
  const pool = makePoolReturningGame(baseRow("scheduled"));
  const service = makeService(pool);
  await assert.rejects(
    () => service.assertPurchaseOpen("game-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PURCHASE_CLOSED_FOR_GAME");
      assert.match((err as DomainError).message, /scheduled/);
      return true;
    },
  );
});

test("F7: assertPurchaseOpen rejects status='running' (engine drawing)", async () => {
  const pool = makePoolReturningGame(baseRow("running"));
  const service = makeService(pool);
  await assert.rejects(
    () => service.assertPurchaseOpen("game-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PURCHASE_CLOSED_FOR_GAME");
      return true;
    },
  );
});

test("F7: assertPurchaseOpen rejects status='completed'", async () => {
  const pool = makePoolReturningGame(baseRow("completed"));
  const service = makeService(pool);
  await assert.rejects(
    () => service.assertPurchaseOpen("game-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PURCHASE_CLOSED_FOR_GAME");
      return true;
    },
  );
});

test("F7: assertPurchaseOpen rejects status='cancelled'", async () => {
  const pool = makePoolReturningGame(baseRow("cancelled"));
  const service = makeService(pool);
  await assert.rejects(
    () => service.assertPurchaseOpen("game-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PURCHASE_CLOSED_FOR_GAME");
      return true;
    },
  );
});

test("F7: assertPurchaseOpen rejects unknown future status (defensive)", async () => {
  const pool = makePoolReturningGame(baseRow("not_a_real_status"));
  const service = makeService(pool);
  // If we add more statuses to the lifecycle, they should be opt-in via
  // PURCHASE_ALLOWED_STATUSES — never opt-out by default.
  await assert.rejects(
    () => service.assertPurchaseOpen("game-1", "hall-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PURCHASE_CLOSED_FOR_GAME");
      return true;
    },
  );
});
