/**
 * MASTER_PLAN §2.3 — integrasjonstester for POST /api/admin/game1/jackpot/
 * :hallGroupId/award.
 *
 * Dekker:
 *  - happy path → 200 + result + audit-rad
 *  - JACKPOT_NOT_CONFIGURED når jackpotStateService ikke er injisert
 *  - INVALID_INPUT når idempotencyKey mangler
 *  - idempotency: andre kall returnerer samme award (idempotent=true)
 *  - RBAC: PLAYER blokkeres
 *
 * Bruker mock for Game1JackpotStateService.awardJackpot — gjør ingen
 * faktisk DB-aksess.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGame1MasterRouter } from "../adminGame1Master.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  Game1MasterControlService,
} from "../../game/Game1MasterControlService.js";
import type {
  AwardJackpotInput,
  AwardJackpotResult,
  Game1JackpotStateService,
} from "../../game/Game1JackpotStateService.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  awardCalls: AwardJackpotInput[];
  close: () => Promise<void>;
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  awardImpl?: (input: AwardJackpotInput) => Promise<AwardJackpotResult>;
  /** Set to true to omit jackpotStateService entirely. */
  withoutJackpotService?: boolean;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const masterControlService = {
    async getGameDetail() {
      throw new Error("not used in jackpot-award tests");
    },
  } as unknown as Game1MasterControlService;

  const awardCalls: AwardJackpotInput[] = [];
  const jackpotStateService: Game1JackpotStateService | undefined = opts.withoutJackpotService
    ? undefined
    : ({
        async awardJackpot(input: AwardJackpotInput): Promise<AwardJackpotResult> {
          awardCalls.push(input);
          if (opts.awardImpl) return opts.awardImpl(input);
          return {
            awardId: "g1ja-test-1",
            hallGroupId: input.hallGroupId,
            awardedAmountCents: 2_500_000,
            previousAmountCents: 2_500_000,
            newAmountCents: 200_000,
            idempotent: false,
            noopZeroBalance: false,
          };
        },
      } as unknown as Game1JackpotStateService);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGame1MasterRouter({
      platformService,
      auditLogService,
      masterControlService,
      jackpotStateService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    auditStore,
    awardCalls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(ctx: Ctx, path: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

// ── happy path ────────────────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — ADMIN happy path → 200 + result + audit-rad", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      idempotencyKey: "g1-jackpot-admin-1-2026-04-26",
      reason: "ADMIN_MANUAL_AWARD",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { award: Record<string, unknown> } };
    assert.equal(body.ok, true);
    assert.equal(body.data.award.awardId, "g1ja-test-1");
    assert.equal(body.data.award.awardedAmountCents, 2_500_000);
    assert.equal(body.data.award.idempotent, false);
    assert.equal(body.data.award.noopZeroBalance, false);

    // Service skal ha blitt kalt med riktig actor
    assert.equal(ctx.awardCalls.length, 1);
    assert.equal(ctx.awardCalls[0]!.hallGroupId, "grp-1");
    assert.equal(ctx.awardCalls[0]!.idempotencyKey, "g1-jackpot-admin-1-2026-04-26");
    assert.equal(ctx.awardCalls[0]!.awardedByUserId, "admin-1");
    assert.equal(ctx.awardCalls[0]!.reason, "ADMIN_MANUAL_AWARD");

    // Audit-rad skrives (fire-and-forget — vent litt så event-loop processer)
    await new Promise((r) => setTimeout(r, 20));
    const auditEntries = await ctx.auditStore.list();
    const award = auditEntries.find((e) => e.action === "game1_jackpot.admin_award");
    assert.ok(award, "skal ha audit-rad for game1_jackpot.admin_award");
    assert.equal(award!.resourceId, "grp-1");
    assert.equal(award!.actorId, "admin-1");
  } finally {
    await ctx.close();
  }
});

// ── feature-gate ──────────────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — JACKPOT_NOT_CONFIGURED når service mangler", async () => {
  const ctx = await startServer({ withoutJackpotService: true });
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      idempotencyKey: "g1-jackpot-admin-x",
    });
    assert.notEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "JACKPOT_NOT_CONFIGURED");
  } finally {
    await ctx.close();
  }
});

// ── input validation ──────────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — manglende idempotencyKey → INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      reason: "ADMIN_MANUAL_AWARD",
    });
    assert.notEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    assert.equal(body.ok, false);
    // mustBeNonEmptyString kaster INVALID_INPUT eller lignende
    assert.ok(body.error?.code, "skal ha en error-kode");
    // Ingen service-kall skal skje
    assert.equal(ctx.awardCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── idempotency end-to-end ────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — idempotent=true når service returnerer eksisterende rad", async () => {
  const ctx = await startServer({
    awardImpl: async (input) => ({
      awardId: "g1ja-existing",
      hallGroupId: input.hallGroupId,
      awardedAmountCents: 1_000_000,
      previousAmountCents: 1_000_000,
      newAmountCents: 200_000,
      idempotent: true,
      noopZeroBalance: false,
    }),
  });
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      idempotencyKey: "duplicate-key",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { award: Record<string, unknown> } };
    assert.equal(body.data.award.idempotent, true);
    assert.equal(body.data.award.awardId, "g1ja-existing");
  } finally {
    await ctx.close();
  }
});

// ── RBAC ──────────────────────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — PLAYER blokkeres (FORBIDDEN)", async () => {
  const ctx = await startServer({ users: { "t-player": playerUser } });
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-player", {
      idempotencyKey: "k1",
    });
    assert.notEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    assert.equal(body.ok, false);
    assert.equal(ctx.awardCalls.length, 0, "service skal ikke kalles for PLAYER");
  } finally {
    await ctx.close();
  }
});

// ── reason normalisering ──────────────────────────────────────────────────

test("POST /jackpot/:hallGroupId/award — ukjent reason map-pes til ADMIN_MANUAL_AWARD", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      idempotencyKey: "k-reason-test",
      reason: "SOME_RANDOM_VALUE",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.awardCalls[0]!.reason, "ADMIN_MANUAL_AWARD");
  } finally {
    await ctx.close();
  }
});

test("POST /jackpot/:hallGroupId/award — explicit FULL_HOUSE_WITHIN_THRESHOLD beholdes", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx, "/api/admin/game1/jackpot/grp-1/award", "t-admin", {
      idempotencyKey: "k-full-house",
      reason: "FULL_HOUSE_WITHIN_THRESHOLD",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.awardCalls[0]!.reason, "FULL_HOUSE_WITHIN_THRESHOLD");
  } finally {
    await ctx.close();
  }
});
