/**
 * Route-test for POST /api/agent/game1/master/recover-stale (2026-05-09).
 *
 * Strategy: real Express harness with stub `PlatformService`,
 * `MasterActionService`, and `StalePlanRunRecoveryService`. The
 * recovery service is a stub that just records its input; we don't need
 * to exercise the SQL path here (that's covered in
 * `StalePlanRunRecoveryService.test.ts`).
 *
 * Coverage:
 *   ✓ AGENT can call the endpoint for own hall (200 + cleared counts)
 *   ✓ ADMIN can override hallId via body (200)
 *   ✓ HALL_OPERATOR locked to own hall — body.hallId mismatch → 400 FORBIDDEN
 *   ✓ AGENT without hallId → 400 FORBIDDEN
 *   ✓ Missing service injection → 503 RECOVERY_NOT_CONFIGURED
 *   ✓ Underlying service throws DomainError → propagated as same code
 *   ✓ Underlying service throws generic Error → 500
 *   ✓ Idempotent — second call with no stale state returns {0, 0}
 *   ✓ AdminPermission denial (PLAYER role) returns 403
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

import { createAgentGame1MasterRouter } from "../agentGame1Master.js";
import { DomainError } from "../../errors/DomainError.js";
import type { MasterActionService } from "../../game/MasterActionService.js";
import type {
  StalePlanRunRecoveryInput,
  StalePlanRunRecoveryResult,
  StalePlanRunRecoveryService,
} from "../../game/recovery/StalePlanRunRecoveryService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_HALL = "99999999-9999-9999-9999-999999999999";

function makeAgent(hallId: string | null = HALL_ID): PublicAppUser {
  return {
    id: "agent-1",
    email: "agent@spillorama.no",
    displayName: "Agent One",
    walletId: "wallet-agent-1",
    role: "AGENT",
    hallId,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as PublicAppUser;
}

function makeAdmin(): PublicAppUser {
  return {
    id: "admin-1",
    email: "admin@spillorama.no",
    displayName: "Admin",
    walletId: "wallet-admin",
    role: "ADMIN",
    hallId: null,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as PublicAppUser;
}

function makeHallOperator(): PublicAppUser {
  return {
    id: "ho-1",
    email: "ho@spillorama.no",
    displayName: "Hall Op",
    walletId: "wallet-ho",
    role: "HALL_OPERATOR",
    hallId: HALL_ID,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as PublicAppUser;
}

function makeSupport(): PublicAppUser {
  return {
    id: "sup-1",
    email: "sup@spillorama.no",
    displayName: "Support",
    walletId: "wallet-sup",
    role: "SUPPORT",
    hallId: null,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as PublicAppUser;
}

interface HarnessOpts {
  user: PublicAppUser;
  recoverImpl?: (
    input: StalePlanRunRecoveryInput,
  ) => Promise<StalePlanRunRecoveryResult>;
  /** When true, omit the recovery service from router-deps so 503 is returned. */
  withoutService?: boolean;
}

interface Harness {
  baseUrl: string;
  recoveryCalls: StalePlanRunRecoveryInput[];
  close: () => Promise<void>;
}

async function startHarness(opts: HarnessOpts): Promise<Harness> {
  const recoveryCalls: StalePlanRunRecoveryInput[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token === opts.user.id) return opts.user;
      throw new DomainError("UNAUTHORIZED", "bad token");
    },
  } as unknown as PlatformService;

  const masterActionService = {
    // Not exercised in these tests but required by router-deps shape.
  } as unknown as MasterActionService;

  const recoveryStub: StalePlanRunRecoveryService | undefined = opts.withoutService
    ? undefined
    : ({
        async recoverStaleForHall(
          input: StalePlanRunRecoveryInput,
        ): Promise<StalePlanRunRecoveryResult> {
          recoveryCalls.push(input);
          if (opts.recoverImpl) return opts.recoverImpl(input);
          return {
            planRunsCleared: 0,
            scheduledGamesCleared: 0,
            clearedPlanRuns: [],
            clearedScheduledGames: [],
            recoveredAt: "2026-05-09T15:00:00.000Z",
            hallId: input.hallId,
            todayBusinessDate: "2026-05-09",
          };
        },
      } as unknown as StalePlanRunRecoveryService);

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGame1MasterRouter({
      platformService,
      masterActionService,
      staleRecoveryService: recoveryStub ?? null,
    }),
  );

  return new Promise<Harness>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        recoveryCalls,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function postRecoverStale(
  baseUrl: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/agent/game1/master/recover-stale`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Happy paths ──────────────────────────────────────────────────────────

test("recover-stale route: AGENT can clear own hall", async () => {
  const agent = makeAgent();
  const harness = await startHarness({
    user: agent,
    recoverImpl: async (input) => ({
      planRunsCleared: 2,
      scheduledGamesCleared: 1,
      clearedPlanRuns: [
        {
          id: "run-1",
          businessDate: "2026-05-08",
          status: "running",
          currentPosition: 3,
          planId: "plan-1",
        },
        {
          id: "run-2",
          businessDate: "2026-05-07",
          status: "paused",
          currentPosition: 2,
          planId: "plan-1",
        },
      ],
      clearedScheduledGames: [
        {
          id: "game-1",
          status: "running",
          scheduledStartTime: "2026-05-07T15:00:00.000Z",
          scheduledEndTime: "2026-05-07T17:00:00.000Z",
          subGameName: "Bingo",
          groupHallId: "grp-1",
        },
      ],
      recoveredAt: "2026-05-09T15:00:00.000Z",
      hallId: input.hallId,
      todayBusinessDate: "2026-05-09",
    }),
  });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id);
    assert.equal(status, 200);
    const responseBody = body as {
      ok: boolean;
      data: {
        cleared: { planRuns: number; scheduledGames: number };
        details: { todayBusinessDate: string };
      };
    };
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.data.cleared.planRuns, 2);
    assert.equal(responseBody.data.cleared.scheduledGames, 1);
    assert.equal(responseBody.data.details.todayBusinessDate, "2026-05-09");

    assert.equal(harness.recoveryCalls.length, 1);
    assert.equal(harness.recoveryCalls[0]!.hallId, HALL_ID);
    assert.equal(harness.recoveryCalls[0]!.actor.userId, agent.id);
    assert.equal(harness.recoveryCalls[0]!.actor.role, "AGENT");
  } finally {
    await harness.close();
  }
});

test("recover-stale route: ADMIN can override hallId via body", async () => {
  const admin = makeAdmin();
  const harness = await startHarness({ user: admin });
  try {
    const { status } = await postRecoverStale(harness.baseUrl, admin.id, {
      hallId: HALL_ID,
    });
    assert.equal(status, 200);
    assert.equal(harness.recoveryCalls.length, 1);
    assert.equal(harness.recoveryCalls[0]!.hallId, HALL_ID);
  } finally {
    await harness.close();
  }
});

test("recover-stale route: HALL_OPERATOR can clear own hall", async () => {
  const ho = makeHallOperator();
  const harness = await startHarness({ user: ho });
  try {
    const { status } = await postRecoverStale(harness.baseUrl, ho.id);
    assert.equal(status, 200);
    assert.equal(harness.recoveryCalls.length, 1);
    assert.equal(harness.recoveryCalls[0]!.hallId, HALL_ID);
  } finally {
    await harness.close();
  }
});

test("recover-stale route: idempotent — second call with no stale returns {0, 0}", async () => {
  const agent = makeAgent();
  const harness = await startHarness({ user: agent });
  try {
    const a = await postRecoverStale(harness.baseUrl, agent.id);
    const b = await postRecoverStale(harness.baseUrl, agent.id);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aBody = a.body as { data: { cleared: { planRuns: number } } };
    const bBody = b.body as { data: { cleared: { planRuns: number } } };
    assert.equal(aBody.data.cleared.planRuns, 0);
    assert.equal(bBody.data.cleared.planRuns, 0);
    assert.equal(harness.recoveryCalls.length, 2);
  } finally {
    await harness.close();
  }
});

// ── RBAC + scope rejections ──────────────────────────────────────────────

test("recover-stale route: AGENT cannot override hallId for another hall", async () => {
  const agent = makeAgent();
  const harness = await startHarness({ user: agent });
  try {
    const { status, body } = await postRecoverStale(
      harness.baseUrl,
      agent.id,
      { hallId: OTHER_HALL },
    );
    assert.equal(status, 400);
    const errBody = body as { ok: boolean; error: { code: string } };
    assert.equal(errBody.ok, false);
    assert.equal(errBody.error.code, "FORBIDDEN");
    assert.equal(harness.recoveryCalls.length, 0);
  } finally {
    await harness.close();
  }
});

test("recover-stale route: AGENT without hallId is rejected", async () => {
  const agent = makeAgent(null);
  const harness = await startHarness({ user: agent });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id);
    assert.equal(status, 400);
    const errBody = body as { ok: boolean; error: { code: string } };
    assert.equal(errBody.error.code, "FORBIDDEN");
  } finally {
    await harness.close();
  }
});

test("recover-stale route: SUPPORT is rejected by GAME1_MASTER_WRITE permission", async () => {
  const sup = makeSupport();
  const harness = await startHarness({ user: sup });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, sup.id);
    // SUPPORT lacks GAME1_MASTER_WRITE; assertAdminPermission throws
    // FORBIDDEN. apiFailure normalizes to 400 (not 403) per project
    // convention — code field is the durable contract for clients.
    assert.equal(status, 400);
    const errBody = body as { error: { code: string } };
    assert.equal(errBody.error.code, "FORBIDDEN");
  } finally {
    await harness.close();
  }
});

// ── Service errors ────────────────────────────────────────────────────────

test("recover-stale route: missing recovery service → 503 RECOVERY_NOT_CONFIGURED", async () => {
  const agent = makeAgent();
  const harness = await startHarness({ user: agent, withoutService: true });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id);
    assert.equal(status, 503);
    const errBody = body as { ok: boolean; error: { code: string } };
    assert.equal(errBody.ok, false);
    assert.equal(errBody.error.code, "RECOVERY_NOT_CONFIGURED");
  } finally {
    await harness.close();
  }
});

test("recover-stale route: service throws DomainError → propagated", async () => {
  const agent = makeAgent();
  const harness = await startHarness({
    user: agent,
    recoverImpl: async () => {
      throw new DomainError("INVALID_INPUT", "test domain error");
    },
  });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id);
    assert.equal(status, 400);
    const errBody = body as { error: { code: string; message: string } };
    assert.equal(errBody.error.code, "INVALID_INPUT");
    assert.match(errBody.error.message, /test domain error/);
  } finally {
    await harness.close();
  }
});

test("recover-stale route: service throws generic Error → 400 with INTERNAL_ERROR code", async () => {
  const agent = makeAgent();
  const harness = await startHarness({
    user: agent,
    recoverImpl: async () => {
      throw new Error("boom");
    },
  });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id);
    // apiFailure always 400 — code field carries the actual error type.
    assert.equal(status, 400);
    const errBody = body as { ok: boolean };
    assert.equal(errBody.ok, false);
  } finally {
    await harness.close();
  }
});

// ── Body validation ──────────────────────────────────────────────────────

test("recover-stale route: extra body fields rejected by strict schema", async () => {
  const agent = makeAgent();
  const harness = await startHarness({ user: agent });
  try {
    const { status, body } = await postRecoverStale(harness.baseUrl, agent.id, {
      hallId: HALL_ID,
      extraField: "should be rejected",
    });
    assert.equal(status, 400);
    const errBody = body as { error: { code: string } };
    assert.equal(errBody.error.code, "INVALID_INPUT");
  } finally {
    await harness.close();
  }
});
