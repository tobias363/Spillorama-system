/**
 * Admin TV-voice endpoints: GET/PUT /api/admin/halls/:hallId/voice.
 *
 * Wireframe PDF 14 (TV Screen + Winners) — per-hall voice-pack for
 * ball-utrop på TV-kiosk. Backend:
 *   - Lagrer `app_halls.tv_voice_selection` (migration 20260811000000)
 *   - Validerer voice ∈ ('voice1', 'voice2', 'voice3') i PlatformService
 *   - Audit-logger `hall.tv_voice.update`
 *   - Broadcaster `tv:voice-changed` til `hall:<id>:display` via io.to()
 *
 * Testene bruker samme in-memory harness som adminHallAddMoney.test.ts:
 * fake PlatformService + AuditLogService + io-stub som fanger opp
 * broadcast-payload så vi kan verifisere socket-wiring uten ekte io.
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
  HallTvVoice,
} from "../../platform/PlatformService.js";

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

function makeHallOperator(hallId: string, id = "op-1"): AppUser & PublicAppUser {
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

function makeHall(id = "hall-1", voice: HallTvVoice = "voice1"): HallDefinition {
  return {
    id,
    slug: id,
    name: "Test Hall",
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    hallNumber: 101,
    cashBalance: 0,
    tvVoiceSelection: voice,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
}

interface BroadcastCapture {
  room: string;
  event: string;
  payload: unknown;
}

interface HarnessContext {
  baseUrl: string;
  audit: AuditLogService;
  broadcasts: BroadcastCapture[];
  hallRef: { current: HallDefinition };
  close: () => Promise<void>;
}

async function startServer(opts: {
  user: AppUser & PublicAppUser;
  hall: HallDefinition;
}): Promise<HarnessContext> {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const ledger = new InMemoryHallCashLedger();
  const broadcasts: BroadcastCapture[] = [];
  const hallRef = { current: opts.hall };

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
      throw Object.assign(new Error("bad token"), { code: "UNAUTHORIZED" });
    },
    async getHall(reference: string): Promise<HallDefinition> {
      const h = hallRef.current;
      if (reference === h.id || reference === h.slug) return h;
      throw Object.assign(new Error("HALL_NOT_FOUND"), { code: "HALL_NOT_FOUND" });
    },
    async getTvVoice(reference: string): Promise<HallTvVoice> {
      const h = hallRef.current;
      if (reference === h.id || reference === h.slug) return h.tvVoiceSelection ?? "voice1";
      throw Object.assign(new Error("HALL_NOT_FOUND"), { code: "HALL_NOT_FOUND" });
    },
    async setTvVoice(reference: string, voice: string): Promise<HallDefinition> {
      if (voice !== "voice1" && voice !== "voice2" && voice !== "voice3") {
        throw Object.assign(new Error("INVALID_INPUT"), { code: "INVALID_INPUT" });
      }
      const h = hallRef.current;
      if (reference !== h.id && reference !== h.slug) {
        throw Object.assign(new Error("HALL_NOT_FOUND"), { code: "HALL_NOT_FOUND" });
      }
      hallRef.current = { ...h, tvVoiceSelection: voice as HallTvVoice };
      return hallRef.current;
    },
  } as unknown as PlatformService;

  // io-stub: fanger opp .to(<room>).emit(<event>, <payload>) så testene kan
  // asserte at socket-broadcast faktisk ble utført. Returnerer en proxy
  // med `.emit` som pusher payload.
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          broadcasts.push({ room, event, payload });
        },
      };
    },
  } as unknown as AdminRouterDeps["io"];

  const engine = {
    listRoomSummaries() { return []; },
  } as unknown as AdminRouterDeps["engine"];

  const noop = () => undefined;
  const noopAsync = async () => undefined;
  const emptyMap = new Map<string, number>();

  const deps: AdminRouterDeps = {
    platformService,
    engine,
    io,
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
      code: "ROOM", hallId: opts.hall.id, gameStatus: "WAITING", playerCount: 0,
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
    resolveBingoHallGameConfigForRoom: (async () => ({ hallId: opts.hall.id, maxTicketsPerPlayer: 30 })) as unknown as AdminRouterDeps["resolveBingoHallGameConfigForRoom"],
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
    broadcasts,
    hallRef,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function call(
  method: "PUT" | "GET",
  url: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: { ok: boolean; data?: unknown; error?: { message?: string } } | null }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null) as { ok: boolean; data?: unknown; error?: { message?: string } } | null;
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

// ── Tests ─────────────────────────────────────────────────────────────────

test("GET /halls/:id/voice returns current voice", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-1", "voice2");
  const ctx = await startServer({ user: admin, hall });
  try {
    const res = await call("GET", `${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`, admin.id);
    assert.equal(res.status, 200);
    const data = res.json?.data as { hallId: string; voice: string };
    assert.equal(data.hallId, hall.id);
    assert.equal(data.voice, "voice2");
  } finally {
    await ctx.close();
  }
});

test("PUT /halls/:id/voice persists + broadcasts + audits", async () => {
  const admin = makeAdmin();
  const hall = makeHall("hall-1", "voice1");
  const ctx = await startServer({ user: admin, hall });
  try {
    const res = await call(
      "PUT",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`,
      admin.id,
      { voice: "voice3" }
    );
    assert.equal(res.status, 200, `unexpected: ${JSON.stringify(res.json)}`);
    const data = res.json?.data as { hallId: string; voice: string };
    assert.equal(data.voice, "voice3");

    // DB-side — hallRef-kopien er oppdatert (fake setTvVoice muterer hallRef).
    assert.equal(ctx.hallRef.current.tvVoiceSelection, "voice3");

    // Audit-side
    await waitForAudit(ctx.audit, "hall.tv_voice.update");
    const evt = (await ctx.audit.list()).find((e) => e.action === "hall.tv_voice.update")!;
    assert.equal(evt.resource, "hall");
    assert.equal(evt.resourceId, hall.id);
    assert.equal(evt.details.voice, "voice3");

    // Broadcast-side — én tv:voice-changed på hall:<id>:display med riktig payload.
    const matches = ctx.broadcasts.filter((b) => b.event === "tv:voice-changed");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.room, `hall:${hall.id}:display`);
    const payload = matches[0]!.payload as { hallId: string; voice: string };
    assert.equal(payload.hallId, hall.id);
    assert.equal(payload.voice, "voice3");
  } finally {
    await ctx.close();
  }
});

test("PUT /halls/:id/voice rejects invalid voice values", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ user: admin, hall });
  try {
    const bad = await call(
      "PUT",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`,
      admin.id,
      { voice: "voice42" }
    );
    assert.equal(bad.status, 400);

    const nonString = await call(
      "PUT",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`,
      admin.id,
      { voice: 123 }
    );
    assert.equal(nonString.status, 400);

    // Ingen broadcast ved feil
    const matches = ctx.broadcasts.filter((b) => b.event === "tv:voice-changed");
    assert.equal(matches.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PUT /halls/:id/voice rejects non-ADMIN tokens (RBAC)", async () => {
  const op = makeHallOperator("hall-1");
  const hall = makeHall("hall-1");
  const ctx = await startServer({ user: op, hall });
  try {
    const res = await call(
      "PUT",
      `${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`,
      op.id,
      { voice: "voice2" }
    );
    // AdminAccessPolicy kaster DomainError("FORBIDDEN" / "INSUFFICIENT_PERMISSIONS")
    // som apiFailure mapper til 400 med error-code. Sjekker at det IKKE er 200
    // og at broadcast ikke skjedde — det er den faktiske RBAC-gaten vi bryr
    // oss om (ingen side-effects ved manglende tilgang).
    assert.notEqual(res.status, 200, "expected forbidden, got 200");
    const error = res.json?.error as { code?: string; message?: string };
    assert.ok(
      error?.code === "FORBIDDEN" ||
      error?.code === "INSUFFICIENT_PERMISSIONS" ||
      error?.code === "UNAUTHORIZED",
      `expected RBAC-error-code, got ${JSON.stringify(error)}`
    );
    // Audit skal IKKE være skrevet + ingen broadcast.
    const evts = await ctx.audit.list({ limit: 50 });
    assert.equal(evts.filter((e) => e.action === "hall.tv_voice.update").length, 0);
    const matches = ctx.broadcasts.filter((b) => b.event === "tv:voice-changed");
    assert.equal(matches.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PUT /halls/:id/voice rejects unauthenticated requests", async () => {
  const admin = makeAdmin();
  const hall = makeHall();
  const ctx = await startServer({ user: admin, hall });
  try {
    // Ingen token → apiFailure pakker UNAUTHORIZED DomainError til 400.
    const res = await fetch(`${ctx.baseUrl}/api/admin/halls/${hall.id}/voice`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: "voice2" }),
    });
    assert.notEqual(res.status, 200, "expected non-200 for missing auth");
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    assert.equal(body.ok, false);
    assert.ok(
      body.error?.code === "UNAUTHORIZED" ||
      body.error?.code === "INVALID_INPUT",
      `unexpected error-code: ${body.error?.code}`
    );
    // Ingen broadcast
    const matches = ctx.broadcasts.filter((b) => b.event === "tv:voice-changed");
    assert.equal(matches.length, 0);
  } finally {
    await ctx.close();
  }
});
