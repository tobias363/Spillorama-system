/**
 * GAP #17 + #19 (audit BACKEND_1TO1_GAP_AUDIT_2026-04-24): admin halls
 * soft-delete + pre-create-validering.
 *
 * Tester:
 *   - DELETE /api/admin/halls/:hallId (soft-delete)
 *     - Happy path: aktiv hall uten avhengigheter → 200, audit-log.
 *     - Konflikt: avhengigheter → HTTP 409 med HALL_HAS_DEPENDENCIES.
 *     - Ugyldig hall: HALL_NOT_FOUND.
 *     - RBAC: HALL_OPERATOR/SUPPORT får FORBIDDEN (kun ADMIN).
 *     - Mangler auth → UNAUTHORIZED.
 *
 *   - POST /api/admin/halls/check-availability (pre-create + edit)
 *     - Returnerer per-feltet `{ ok, conflictingHallId? }`.
 *     - hallId-felt ekskluderer hallen selv (edit-flow).
 *     - Manglende felter → ikke i resultatet.
 *
 * Bruker samme harness-mønster som adminHallTvVoice.test.ts: in-memory
 * platformService + AuditLogService, full Express round-trip.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminRouter, type AdminRouterDeps } from "../admin.js";
import { EmailService } from "../../integration/EmailService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import { InMemoryHallCashLedger } from "../../agent/HallCashLedger.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
  HallDefinition,
  CheckHallAvailabilityInput,
  CheckHallAvailabilityResult,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeAdmin(id = "admin-1"): AppUser & PublicAppUser {
  return {
    id,
    email: "admin@spillorama.no",
    displayName: "Admin One",
    walletId: `wallet-${id}`,
    role: "ADMIN",
    hallId: null,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as AppUser & PublicAppUser;
}

function makeOperator(hallId: string, id = "op-1"): AppUser & PublicAppUser {
  return {
    id,
    email: "op@spillorama.no",
    displayName: "Operator",
    walletId: `wallet-${id}`,
    role: "HALL_OPERATOR",
    hallId,
    kycStatus: "VERIFIED",
    phone: null,
    birthDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as AppUser & PublicAppUser;
}

function makeHall(id: string, opts: Partial<HallDefinition> = {}): HallDefinition {
  return {
    id,
    slug: id,
    name: `Hall ${id}`,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    hallNumber: opts.hallNumber ?? 101,
    ipAddress: opts.ipAddress ?? null,
    deletedAt: opts.deletedAt ?? null,
    cashBalance: 0,
    tvVoiceSelection: "voice1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...opts,
  };
}

interface FakeService {
  halls: Map<string, HallDefinition>;
  /** Hall-ID-er som har "aktive avhengigheter" — softDeleteHall skal kaste. */
  hallsWithDependencies: Set<string>;
  softDeleteCalls: string[];
  checkCalls: CheckHallAvailabilityInput[];
}

interface HarnessContext {
  baseUrl: string;
  audit: AuditLogService;
  state: FakeService;
  close: () => Promise<void>;
}

async function startServer(opts: {
  user: AppUser & PublicAppUser;
  halls: HallDefinition[];
  hallsWithDependencies?: string[];
}): Promise<HarnessContext> {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const ledger = new InMemoryHallCashLedger();
  const state: FakeService = {
    halls: new Map(opts.halls.map((h) => [h.id, h])),
    hallsWithDependencies: new Set(opts.hallsWithDependencies ?? []),
    softDeleteCalls: [],
    checkCalls: [],
  };

  const emailService = new EmailService({
    transporter: { async sendMail() { return { messageId: "fake" }; } },
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token === opts.user.id) return opts.user;
      throw new DomainError("UNAUTHORIZED", "bad token");
    },
    async getHall(reference: string): Promise<HallDefinition> {
      const found = [...state.halls.values()].find(
        (h) => h.id === reference || h.slug === reference
      );
      if (!found) {
        throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
      }
      return found;
    },
    async listHalls() {
      // Skjul soft-deleted by default (matcher prod-oppførsel).
      return [...state.halls.values()].filter((h) => !h.deletedAt);
    },
    async softDeleteHall(reference: string): Promise<{ hallId: string; deletedAt: string }> {
      state.softDeleteCalls.push(reference);
      const found = [...state.halls.values()].find(
        (h) => h.id === reference || h.slug === reference
      );
      if (!found) {
        throw new DomainError("HALL_NOT_FOUND", "Hallen finnes ikke.");
      }
      if (found.deletedAt) {
        throw new DomainError("HALL_ALREADY_DELETED", "Hallen er allerede soft-deleted.");
      }
      if (state.hallsWithDependencies.has(found.id)) {
        throw new DomainError(
          "HALL_HAS_DEPENDENCIES",
          "Hallen har 3 aktive spillere — flytt eller fjern disse først.",
          { dependency: "players", count: 3 }
        );
      }
      const deletedAt = new Date().toISOString();
      const updated: HallDefinition = { ...found, deletedAt, isActive: false };
      state.halls.set(found.id, updated);
      return { hallId: found.id, deletedAt };
    },
    async checkHallAvailability(
      input: CheckHallAvailabilityInput
    ): Promise<CheckHallAvailabilityResult> {
      state.checkCalls.push(input);
      const result: CheckHallAvailabilityResult = {};
      const excludeId = input.hallId ?? null;
      if (input.hallNumber !== undefined && input.hallNumber !== null) {
        const conflict = [...state.halls.values()].find(
          (h) => h.hallNumber === input.hallNumber && h.id !== excludeId
        );
        result.hallNumber = conflict
          ? { ok: false, conflictingHallId: conflict.id }
          : { ok: true };
      }
      if (input.ipAddress !== undefined && input.ipAddress !== null && input.ipAddress.trim()) {
        const conflict = [...state.halls.values()].find(
          (h) => h.ipAddress === input.ipAddress && h.id !== excludeId
        );
        result.ipAddress = conflict
          ? { ok: false, conflictingHallId: conflict.id }
          : { ok: true };
      }
      return result;
    },
  } as unknown as PlatformService;

  const noop = () => undefined;
  const noopAsync = async () => undefined;
  const emptyMap = new Map<string, number>();
  const engine = { listRoomSummaries() { return []; } } as unknown as AdminRouterDeps["engine"];

  const deps: AdminRouterDeps = {
    platformService,
    engine,
    io: {
      to() { return { emit() { /* noop */ } }; },
    } as unknown as AdminRouterDeps["io"],
    drawScheduler: { releaseRoom: noop } as unknown as AdminRouterDeps["drawScheduler"],
    bingoSettingsState: {
      runtimeBingoSettings: {
        autoRoundStartEnabled: false,
        autoRoundStartIntervalMs: 60_000,
        autoRoundMinPlayers: 1,
        autoRoundTicketsPerPlayer: 1,
        autoRoundEntryFee: 0,
        payoutPercent: 80,
        autoDrawEnabled: false,
        autoDrawIntervalMs: 2000,
      },
      effectiveFromMs: Date.now(),
      pendingUpdate: null,
    },
    responsibleGamingStore: undefined,
    localBingoAdapter: null,
    usePostgresBingoAdapter: false,
    enforceSingleRoomPerHall: false,
    bingoMinRoundIntervalMs: 30_000,
    bingoMinPlayersToStart: 1,
    bingoMaxDrawsPerRound: 75,
    fixedAutoDrawIntervalMs: 2000,
    forceAutoStart: false,
    forceAutoDraw: false,
    isProductionRuntime: false,
    autoplayAllowed: true,
    allowAutoplayInProduction: false,
    schedulerTickMs: 250,
    emitRoomUpdate: (async () => ({
      code: "ROOM", hallId: opts.halls[0]?.id ?? "hall-1", gameStatus: "WAITING", playerCount: 0,
    })) as unknown as AdminRouterDeps["emitRoomUpdate"],
    emitManyRoomUpdates: noopAsync as unknown as AdminRouterDeps["emitManyRoomUpdates"],
    emitWalletRoomUpdates: noopAsync as unknown as AdminRouterDeps["emitWalletRoomUpdates"],
    buildRoomUpdatePayload: ((s: unknown) => s) as unknown as AdminRouterDeps["buildRoomUpdatePayload"],
    persistBingoSettingsToCatalog: noopAsync as unknown as AdminRouterDeps["persistBingoSettingsToCatalog"],
    normalizeBingoSchedulerSettings: ((current: unknown) => current) as unknown as AdminRouterDeps["normalizeBingoSchedulerSettings"],
    parseBingoSettingsPatch: (() => ({})) as unknown as AdminRouterDeps["parseBingoSettingsPatch"],
    getRoomConfiguredEntryFee: () => 0,
    getArmedPlayerIds: () => [],
    disarmAllPlayers: noop,
    clearDisplayTicketCache: noop,
    roomConfiguredEntryFeeByRoom: emptyMap,
    getPrimaryRoomForHall: () => null,
    resolveBingoHallGameConfigForRoom: (async () => ({
      hallId: opts.halls[0]?.id ?? "hall-1",
      maxTicketsPerPlayer: 30,
    })) as unknown as AdminRouterDeps["resolveBingoHallGameConfigForRoom"],
    auditLogService: audit,
    emailService,
    supportEmail: "support@spillorama.no",
    hallCashLedger: ledger,
  };

  const app = express();
  app.use(express.json());
  app.use(createAdminRouter(deps));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    audit,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function call(
  method: "POST" | "GET" | "DELETE" | "PUT",
  url: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; json: { ok: boolean; data?: unknown; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null) as {
    ok: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  } | null;
  return { status: res.status, json };
}

async function waitForAudit(audit: AuditLogService, action: string, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evts = await audit.list({ limit: 50 });
    if (evts.some((e) => e.action === action)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout waiting for audit action ${action}`);
}

// ── DELETE /api/admin/halls/:hallId — GAP #17 ─────────────────────────────

test("GAP #17: DELETE /halls/:id soft-deletes + audit-logger (happy path)", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-1");
  const ctx = await startServer({ user: admin, halls: [hall] });
  try {
    const res = await call(
      "DELETE",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}`,
      admin.id,
      { reason: "Hall konsolidert til hall-2" }
    );
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json?.data as { hallId: string; deletedAt: string };
    assert.equal(data.hallId, hall.id);
    assert.match(data.deletedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.deepEqual(ctx.state.softDeleteCalls, [hall.id]);

    await waitForAudit(ctx.audit, "hall.delete");
    const evt = (await ctx.audit.list()).find((e) => e.action === "hall.delete")!;
    assert.equal(evt.resource, "hall");
    assert.equal(evt.resourceId, hall.id);
    assert.equal(evt.details.reason, "Hall konsolidert til hall-2");
    assert.equal(typeof evt.details.deletedAt, "string");
  } finally {
    await ctx.close();
  }
});

test("GAP #17: DELETE /halls/:id returnerer 409 ved aktive avhengigheter", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-busy");
  const ctx = await startServer({
    user: admin,
    halls: [hall],
    hallsWithDependencies: [hall.id],
  });
  try {
    const res = await call(
      "DELETE",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}`,
      admin.id,
      {}
    );
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json?.error?.code, "HALL_HAS_DEPENDENCIES");
    assert.equal(res.json?.error?.details?.dependency, "players");
    assert.equal(res.json?.error?.details?.count, 3);

    // Ingen audit-event skal være skrevet.
    const evts = await ctx.audit.list({ limit: 50 });
    assert.equal(evts.filter((e) => e.action === "hall.delete").length, 0);
  } finally {
    await ctx.close();
  }
});

test("GAP #17: DELETE /halls/:id returnerer HALL_NOT_FOUND for ukjent id", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({ user: admin, halls: [] });
  try {
    const res = await call(
      "DELETE",
      `${ctx.baseUrl}/api/admin/halls/missing-id`,
      admin.id,
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json?.error?.code, "HALL_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("GAP #17: DELETE /halls/:id avviser HALL_OPERATOR (kun ADMIN — HALL_WRITE)", async () => {
  const op = makeOperator("hall-1");
  const hall = makeHall("hall-1");
  const ctx = await startServer({ user: op, halls: [hall] });
  try {
    const res = await call(
      "DELETE",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}`,
      op.id,
      {}
    );
    assert.equal(res.status, 400);
    const code = res.json?.error?.code;
    assert.ok(
      code === "FORBIDDEN" || code === "INSUFFICIENT_PERMISSIONS",
      `unexpected RBAC-code: ${code}`
    );
    // Ingen soft-delete-kall + ingen audit
    assert.equal(ctx.state.softDeleteCalls.length, 0);
    const evts = await ctx.audit.list({ limit: 50 });
    assert.equal(evts.filter((e) => e.action === "hall.delete").length, 0);
  } finally {
    await ctx.close();
  }
});

test("GAP #17: DELETE /halls/:id avviser uten Authorization-header", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-1");
  const ctx = await startServer({ user: admin, halls: [hall] });
  try {
    const res = await call(
      "DELETE",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}`,
      undefined,
      {}
    );
    assert.notEqual(res.status, 200);
    const code = res.json?.error?.code;
    assert.ok(
      code === "UNAUTHORIZED" || code === "INVALID_INPUT",
      `unexpected error-code: ${code}`
    );
    assert.equal(ctx.state.softDeleteCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── POST /api/admin/halls/check-availability — GAP #19 ────────────────────

test("GAP #19: POST /halls/check-availability — hallNumber LEDIG → ok=true", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({
    user: admin,
    halls: [makeHall("hall-1", { hallNumber: 101 })],
  });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { hallNumber: 999 }
    );
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.deepEqual(data.hallNumber, { ok: true });
    assert.equal(data.ipAddress, undefined);
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — hallNumber TATT → ok=false + conflictingHallId", async () => {
  const admin = makeAdmin();
  const existing = makeHall("hall-existing", { hallNumber: 101 });
  const ctx = await startServer({ user: admin, halls: [existing] });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { hallNumber: 101 }
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.equal(data.hallNumber?.ok, false);
    assert.equal(data.hallNumber?.conflictingHallId, "hall-existing");
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — hallId-felt ekskluderer hallen selv (edit)", async () => {
  const admin = makeAdmin();
  const existing = makeHall("hall-x", { hallNumber: 101 });
  const ctx = await startServer({ user: admin, halls: [existing] });
  try {
    // Sjekker hallNumber=101 mot en EDIT av samme hall — skal være OK siden
    // hallen sammenlignes mot seg selv.
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { hallNumber: 101, hallId: "hall-x" }
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.deepEqual(data.hallNumber, { ok: true });
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — IP-adresse LEDIG", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({
    user: admin,
    halls: [makeHall("hall-1", { ipAddress: "10.0.0.1" })],
  });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { ipAddress: "10.0.0.2" }
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.deepEqual(data.ipAddress, { ok: true });
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — IP-adresse TATT", async () => {
  const admin = makeAdmin();
  const existing = makeHall("hall-conflict", { ipAddress: "10.0.0.1" });
  const ctx = await startServer({ user: admin, halls: [existing] });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { ipAddress: "10.0.0.1" }
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.equal(data.ipAddress?.ok, false);
    assert.equal(data.ipAddress?.conflictingHallId, "hall-conflict");
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — begge felter sammen", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({
    user: admin,
    halls: [
      makeHall("hall-a", { hallNumber: 101, ipAddress: "10.0.0.1" }),
      makeHall("hall-b", { hallNumber: 102, ipAddress: "10.0.0.2" }),
    ],
  });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      { hallNumber: 102, ipAddress: "10.0.0.3" }
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.equal(data.hallNumber?.ok, false);
    assert.equal(data.hallNumber?.conflictingHallId, "hall-b");
    assert.deepEqual(data.ipAddress, { ok: true });
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability — manglende felter ekskluderes fra resultatet", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({ user: admin, halls: [] });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      admin.id,
      {} // ingen hallNumber / ipAddress
    );
    assert.equal(res.status, 200);
    const data = res.json?.data as CheckHallAvailabilityResult;
    assert.equal(data.hallNumber, undefined);
    assert.equal(data.ipAddress, undefined);
  } finally {
    await ctx.close();
  }
});

test("GAP #19: POST /halls/check-availability avviser uten Authorization-header", async () => {
  const admin = makeAdmin();
  const ctx = await startServer({ user: admin, halls: [] });
  try {
    const res = await call(
      "POST",
      `${ctx.baseUrl}/api/admin/halls/check-availability`,
      undefined,
      { hallNumber: 101 }
    );
    assert.notEqual(res.status, 200);
    const code = res.json?.error?.code;
    assert.ok(
      code === "UNAUTHORIZED" || code === "INVALID_INPUT",
      `unexpected error-code: ${code}`
    );
  } finally {
    await ctx.close();
  }
});
