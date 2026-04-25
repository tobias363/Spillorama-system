/**
 * GAP #16: integrasjonstester for admin-game-oversight router
 * (manual-winning admin override).
 *
 * Dekker:
 *   - POST /api/admin/games/:gameId/manual-winning happy path → 200 +
 *     awardExtraPrize-resultat.
 *   - Strict ADMIN-only via EXTRA_PRIZE_AWARD: HALL_OPERATOR + SUPPORT +
 *     PLAYER + AGENT alle får FORBIDDEN.
 *   - Validering: missing/invalid playerId, hallId, amount, reason.
 *   - reason min-length 10 håndheves.
 *   - Ikke-PLAYER target → INVALID_INPUT.
 *   - Audit-log skrives med action `admin.game.manual_winning`.
 *   - Manual winning gjenbruker awardExtraPrize (ikke direkte wallet.credit) —
 *     verifisert ved at engine.awardExtraPrize-mock kalles, og ingen
 *     direkte wallet.credit-kall.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminGameOversightRouter } from "../adminGameOversight.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
} from "../../platform/PlatformService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import { DomainError } from "../../game/BingoEngine.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

// ── Test fixtures ────────────────────────────────────────────────────────

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
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = { ...adminUser, id: "op-1", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-tok-user", role: "PLAYER" };

function makePlayer(id: string): AppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: id,
    walletId: `w-${id}`,
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

interface AwardCall {
  walletId: string;
  hallId: string;
  linkId?: string;
  amount: number;
  reason?: string;
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  awardCalls: AwardCall[];
  emitCalls: string[][];
  auditStore: InMemoryAuditLogStore;
  setAwardError: (err: Error | null) => void;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  usersById: Record<string, AppUser>;
}): Promise<Ctx> {
  const awardCalls: AwardCall[] = [];
  const emitCalls: string[][] = [];
  let awardError: Error | null = null;

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(id: string): Promise<AppUser> {
      const u = opts.usersById[id];
      if (!u) throw new DomainError("NOT_FOUND", "user not found");
      return u;
    },
  } as unknown as PlatformService;

  const engine = {
    async awardExtraPrize(input: AwardCall) {
      awardCalls.push({ ...input });
      if (awardError) throw awardError;
      return {
        walletId: input.walletId,
        hallId: input.hallId,
        linkId: input.linkId ?? input.hallId,
        amount: input.amount,
        policyId: "policy-test-1",
        remainingDailyExtraPrizeLimit: 5_000 - input.amount,
      };
    },
  } as unknown as BingoEngine;

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminGameOversightRouter({
      platformService,
      engine,
      auditLogService,
      emitWalletRoomUpdates: async (ids) => {
        emitCalls.push([...ids]);
      },
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    awardCalls,
    emitCalls,
    auditStore,
    setAwardError: (err) => {
      awardError = err;
    },
  };
}

async function postManual(
  baseUrl: string,
  gameId: string,
  body: Record<string, unknown>,
  token?: string
): Promise<{ status: number; json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } } }> {
  const res = await fetch(`${baseUrl}/api/admin/games/${gameId}/manual-winning`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as never };
}

const VALID_REQ = {
  playerId: "pl-1",
  hallId: "hall-a",
  amount: 100,
  reason: "Fysisk kort #42 vant fullt hus offline",
};

// ── Happy path ───────────────────────────────────────────────────────────

test("GAP #16: ADMIN happy path → 200 + awardExtraPrize kalt + audit-log skrevet", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data?.gameId, "game-42");
    assert.equal(res.json.data?.playerId, "pl-1");
    assert.equal(res.json.data?.walletId, "w-pl-1");
    assert.equal(res.json.data?.amount, 100);
    assert.equal(res.json.data?.policyId, "policy-test-1");
    assert.equal(res.json.data?.remainingDailyExtraPrizeLimit, 4_900);

    // awardExtraPrize-mock fikk korrekt input.
    assert.equal(ctx.awardCalls.length, 1);
    const call = ctx.awardCalls[0]!;
    assert.equal(call.walletId, "w-pl-1");
    assert.equal(call.hallId, "hall-a");
    assert.equal(call.linkId, "game-42"); // gameId blir linkId i prize-policy-scope
    assert.equal(call.amount, 100);

    // emit-fanout kalt med vinnerens wallet.
    assert.deepEqual(ctx.emitCalls, [["w-pl-1"]]);

    // audit-log inneholder rad med action = admin.game.manual_winning.
    // Vent litt for å la fire-and-forget audit-record gjennomføre seg.
    await new Promise((r) => setTimeout(r, 10));
    const events = await ctx.auditStore.list({ resource: "game", resourceId: "game-42" });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "admin.game.manual_winning");
    assert.equal(events[0]!.actorId, "admin-1");
    assert.equal(events[0]!.actorType, "ADMIN");
    assert.equal(events[0]!.details.playerId, "pl-1");
    assert.equal(events[0]!.details.amount, 100);
    assert.equal(events[0]!.details.gameId, "game-42");
  } finally {
    await ctx.close();
  }
});

test("GAP #16: ticketId valgfri, blir reflektert i response og audit-detail", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(
      ctx.baseUrl,
      "game-42",
      { ...VALID_REQ, ticketId: "ticket-7" },
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data?.ticketId, "ticket-7");
    await new Promise((r) => setTimeout(r, 10));
    const events = await ctx.auditStore.list({ resource: "game", resourceId: "game-42" });
    assert.equal(events[0]!.details.ticketId, "ticket-7");
  } finally {
    await ctx.close();
  }
});

// ── Strict admin-only RBAC ───────────────────────────────────────────────

test("GAP #16: HALL_OPERATOR blokkert (EXTRA_PRIZE_AWARD er ADMIN-only)", async () => {
  const ctx = await startServer({
    users: { "op-tok": operatorUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "op-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "FORBIDDEN");
    assert.equal(ctx.awardCalls.length, 0); // engine ALDRI kalt
  } finally {
    await ctx.close();
  }
});

test("GAP #16: SUPPORT blokkert (EXTRA_PRIZE_AWARD er ADMIN-only)", async () => {
  const ctx = await startServer({
    users: { "sup-tok": supportUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "sup-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "FORBIDDEN");
    assert.equal(ctx.awardCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("GAP #16: PLAYER blokkert", async () => {
  const ctx = await startServer({
    users: { "pl-tok": playerUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "pl-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GAP #16: manglende Authorization → UNAUTHORIZED", async () => {
  const ctx = await startServer({
    users: {},
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ);
    assert.equal(res.status, 400);
    // bad token → UNAUTHORIZED via mock
    assert.ok(["UNAUTHORIZED", "MISSING_AUTH"].includes(res.json.error?.code ?? ""));
  } finally {
    await ctx.close();
  }
});

// ── Input-validering ─────────────────────────────────────────────────────

test("GAP #16: missing playerId → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const { playerId: _drop, ...without } = VALID_REQ;
    void _drop;
    const res = await postManual(ctx.baseUrl, "game-42", without, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #16: missing hallId → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const { hallId: _drop, ...without } = VALID_REQ;
    void _drop;
    const res = await postManual(ctx.baseUrl, "game-42", without, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #16: amount <= 0 → INVALID_AMOUNT/INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", { ...VALID_REQ, amount: 0 }, "admin-tok");
    assert.equal(res.status, 400);
    assert.ok(
      ["INVALID_AMOUNT", "INVALID_INPUT"].includes(res.json.error?.code ?? ""),
      `forventet INVALID_AMOUNT/INVALID_INPUT, fikk ${res.json.error?.code}`
    );
  } finally {
    await ctx.close();
  }
});

test("GAP #16: reason for kort (< 10 tegn) → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(
      ctx.baseUrl,
      "game-42",
      { ...VALID_REQ, reason: "kort" },
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "INVALID_INPUT");
    assert.match(
      res.json.error?.message ?? "",
      /minst 10 tegn|reason/i,
      "feilmelding skal nevne 10-tegn-kravet"
    );
  } finally {
    await ctx.close();
  }
});

test("GAP #16: missing reason → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const { reason: _drop, ...without } = VALID_REQ;
    void _drop;
    const res = await postManual(ctx.baseUrl, "game-42", without, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #16: ikke-PLAYER target (admin/support) → INVALID_INPUT", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: {
      "target-admin": { ...makePlayer("target-admin"), role: "ADMIN" },
    },
  });
  try {
    const res = await postManual(
      ctx.baseUrl,
      "game-42",
      { ...VALID_REQ, playerId: "target-admin" },
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "INVALID_INPUT");
    assert.equal(ctx.awardCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("GAP #16: ukjent playerId → NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: {},
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "NOT_FOUND");
    assert.equal(ctx.awardCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

// ── Compliance: prize-policy-feil propageres ─────────────────────────────

test("GAP #16: PRIZE_POLICY_VIOLATION fra awardExtraPrize → 400 propagert", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    ctx.setAwardError(
      new DomainError(
        "PRIZE_POLICY_VIOLATION",
        "Ekstrapremie 100 overstiger maks enkeltpremie (50)."
      )
    );
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "PRIZE_POLICY_VIOLATION");
    // engine kalt — feilen kom derfra, ikke fra route-laget
    assert.equal(ctx.awardCalls.length, 1);
  } finally {
    await ctx.close();
  }
});

test("GAP #16: EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED propagert som 400", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    ctx.setAwardError(
      new DomainError(
        "EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED",
        "Daglig grense overskredet."
      )
    );
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "admin-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.code, "EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED");
  } finally {
    await ctx.close();
  }
});

// ── Regulatorisk: aldri direkte wallet.credit ────────────────────────────

test("GAP #16 [REGULATORISK]: route bruker awardExtraPrize, IKKE direkte wallet.credit", async () => {
  // Vi kobler IKKE en walletAdapter til router-en — det er ikke en dependency.
  // Dette dokumenterer at route-implementasjonen ikke kan omgå den
  // regulatoriske gaten ved et direkte wallet.credit-kall: hvis noen i
  // fremtiden la inn et slikt kall ville denne testen fortsatt passere
  // kun fordi router'n nå rein ruter via `engine.awardExtraPrize`. Men
  // type-systemet gir oss compile-time-garantien (router-deps inneholder
  // ikke `walletAdapter`).
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    usersById: { "pl-1": makePlayer("pl-1") },
  });
  try {
    const res = await postManual(ctx.baseUrl, "game-42", VALID_REQ, "admin-tok");
    assert.equal(res.status, 200);
    assert.equal(ctx.awardCalls.length, 1, "awardExtraPrize MÅ kalles");
    assert.equal(
      ctx.awardCalls[0]!.linkId,
      "game-42",
      "linkId skal være gameId for prize-policy-scope-binding"
    );
  } finally {
    await ctx.close();
  }
});
