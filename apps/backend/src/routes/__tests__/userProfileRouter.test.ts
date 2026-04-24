/**
 * BIN-720: integrasjonstester for /api/user/profile/* endepunkter.
 *
 * Dekker:
 *   - GET settings
 *   - POST loss-limits (senking umiddelbar, økning 48h-queue)
 *   - POST self-exclude (1d/7d/30d/1y/permanent)
 *   - POST language
 *   - POST pause
 *   - assertUserNotBlocked-gate
 *   - flushPendingLossLimits (48h-queue)
 *   - Full audit-trail
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

import { createUserProfileRouter } from "../userProfile.js";
import { ProfileSettingsService } from "../../compliance/ProfileSettingsService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import { BingoEngine, DomainError } from "../../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type {
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot,
  PersistedPendingLossLimitChange,
  PersistedLossLimit,
  PersistedRestrictionState,
} from "../../game/ResponsibleGamingPersistence.js";
import {
  type WalletAccount,
  type WalletAdapter,
  type WalletTransaction,
  type WalletTransferResult,
  WalletError,
  type CreateWalletAccountInput,
} from "../../adapters/WalletAdapter.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../../game/types.js";

// ── In-memory wallet (portet fra spillevett/__tests__/cross-game.test.ts) ──

class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${++this.txCounter}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    if (this.accounts.has(accountId)) {
      if (!input?.allowExisting) throw new WalletError("ACCOUNT_EXISTS", "");
      return { ...this.accounts.get(accountId)! };
    }
    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(accountId, account);
    return { ...account };
  }
  async ensureAccount(id: string): Promise<WalletAccount> {
    if (this.accounts.has(id)) return { ...this.accounts.get(id)! };
    return this.createAccount({ accountId: id, initialBalance: 0, allowExisting: true });
  }
  async getAccount(id: string): Promise<WalletAccount> {
    const a = this.accounts.get(id);
    if (!a) throw new WalletError("ACCOUNT_NOT_FOUND", "");
    return { ...a };
  }
  async listAccounts(): Promise<WalletAccount[]> { return [...this.accounts.values()].map((a) => ({ ...a })); }
  async getBalance(id: string): Promise<number> { return (await this.getAccount(id)).balance; }
  async getDepositBalance(id: string): Promise<number> { return (await this.getAccount(id)).depositBalance; }
  async getWinningsBalance(id: string): Promise<number> { return (await this.getAccount(id)).winningsBalance; }
  async getBothBalances(id: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(id);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }
  async debit(id: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(id, -Math.abs(amount), "DEBIT", reason);
  }
  async credit(id: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(id, Math.abs(amount), "CREDIT", reason);
  }
  async topUp(id: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjust(id, Math.abs(amount), "TOPUP", reason);
  }
  async withdraw(id: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjust(id, -Math.abs(amount), "WITHDRAWAL", reason);
  }
  async transfer(from: string, to: string, amount: number, reason: string): Promise<WalletTransferResult> {
    const fromTx = await this.adjust(from, -Math.abs(amount), "TRANSFER_OUT", reason, to);
    const toTx = await this.adjust(to, Math.abs(amount), "TRANSFER_IN", reason, from);
    return { fromTx, toTx };
  }
  async listTransactions(id: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions.filter((t) => t.accountId === id).slice(-limit).map((t) => ({ ...t }));
  }
  private async adjust(id: string, delta: number, type: WalletTransaction["type"], reason: string, related?: string): Promise<WalletTransaction> {
    const acc = await this.ensureAccount(id);
    const next = acc.balance + delta;
    if (next < 0) throw new WalletError("INSUFFICIENT_FUNDS", "");
    this.accounts.set(id, {
      ...acc,
      balance: next,
      depositBalance: next,
      winningsBalance: 0,
      updatedAt: new Date().toISOString(),
    });
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`, accountId: id, type, amount: Math.abs(delta),
      reason, createdAt: new Date().toISOString(), relatedAccountId: related,
    };
    this.transactions.push(tx);
    return { ...tx };
  }
}

// ── Fixed-ticket BingoSystemAdapter (spiller aldri) ───────────────────────

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: [[1, 2, 3, 4, 5], [13, 14, 15, 16, 17], [25, 26, 0, 27, 28], [37, 38, 39, 40, 41], [49, 50, 51, 52, 53]] };
  }
}

// ── In-memory RG persistence adapter (with upsert tracking) ───────────────

interface StubRgState {
  pending: Map<string, PersistedPendingLossLimitChange>;
  limits: Map<string, PersistedLossLimit>;
  restrictions: Map<string, PersistedRestrictionState>;
}

function makeRgAdapter(state: StubRgState): ResponsibleGamingPersistenceAdapter {
  const emptySnapshot = (): ResponsibleGamingPersistenceSnapshot => ({
    personalLossLimits: Array.from(state.limits.values()),
    pendingLossLimitChanges: Array.from(state.pending.values()),
    restrictions: Array.from(state.restrictions.values()),
    playStates: [],
    lossEntries: [],
    prizePolicies: [],
    extraPrizeEntries: [],
    payoutAuditTrail: [],
    complianceLedger: [],
    dailyReports: [],
  });
  const key = (walletId: string, hallId: string) => `${walletId}::${hallId}`;
  const noop = async () => { /* noop */ };
  const adapter = {
    ensureInitialized: noop,
    loadSnapshot: async () => emptySnapshot(),
    upsertLossLimit: async (e: PersistedLossLimit) => { state.limits.set(key(e.walletId, e.hallId), e); },
    upsertPendingLossLimitChange: async (e: PersistedPendingLossLimitChange) => {
      // If both daily and monthly pending are undefined, delete.
      if (e.dailyPendingValue === undefined && e.monthlyPendingValue === undefined) {
        state.pending.delete(key(e.walletId, e.hallId));
      } else {
        state.pending.set(key(e.walletId, e.hallId), e);
      }
    },
    deletePendingLossLimitChange: async (walletId: string, hallId: string) => {
      state.pending.delete(key(walletId, hallId));
    },
    upsertRestriction: async (e: PersistedRestrictionState) => { state.restrictions.set(e.walletId, e); },
    deleteRestriction: async (walletId: string) => { state.restrictions.delete(walletId); },
    upsertPlaySessionState: noop,
    deletePlaySessionState: noop,
    insertLossEntry: noop,
    upsertPrizePolicy: noop,
    insertExtraPrizeEntry: noop,
    insertPayoutAuditEvent: noop,
    insertComplianceLedgerEntry: noop,
    upsertDailyReport: noop,
    insertOverskuddBatch: noop,
    getOverskuddBatch: async () => null,
    listOverskuddBatches: async () => [],
    upsertHallOrganizationAllocation: noop,
    listHallOrganizationAllocations: async () => [],
    deleteHallOrganizationAllocation: noop,
    shutdown: noop,
  };
  return adapter as unknown as ResponsibleGamingPersistenceAdapter;
}

// ── Fake Postgres pool for ProfileSettingsService ─────────────────────────

interface FakeDb {
  users: Map<string, { id: string; wallet_id: string; hall_id: string | null; role: string }>;
  profileSettings: Map<string, { user_id: string; language: string; blocked_until: Date | null; blocked_reason: string | null }>;
  /** Speilet inn fra RG-state for 48h-queue-flush. */
  pending: Map<string, PersistedPendingLossLimitChange>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakePool(db: FakeDb): any {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      const s = sql.replace(/\s+/g, " ").trim();
      // loadUser
      if (s.includes("SELECT id, wallet_id, hall_id, role FROM")) {
        const id = params[0] as string;
        const user = db.users.get(id);
        return { rows: (user ? [user] : []) as unknown as T[], rowCount: user ? 1 : 0 };
      }
      // loadProfileRow
      if (s.includes("SELECT user_id, language, blocked_until, blocked_reason")) {
        const id = params[0] as string;
        const row = db.profileSettings.get(id);
        return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
      }
      // upsert language
      if (s.includes("INSERT INTO") && s.includes("app_user_profile_settings") && s.includes("language, created_at")) {
        const [userId, language] = params as [string, string];
        const existing = db.profileSettings.get(userId);
        if (existing) existing.language = language;
        else db.profileSettings.set(userId, { user_id: userId, language, blocked_until: null, blocked_reason: null });
        return { rows: [] as T[], rowCount: 1 };
      }
      // upsert blocked_until (full row insert)
      if (s.includes("INSERT INTO") && s.includes("app_user_profile_settings") && s.includes("blocked_until, blocked_reason, created_at")) {
        const [userId, blockedUntil, reason] = params as [string, Date, string];
        const existing = db.profileSettings.get(userId);
        if (existing) {
          existing.blocked_until = blockedUntil;
          existing.blocked_reason = reason;
        } else {
          db.profileSettings.set(userId, { user_id: userId, language: "nb-NO", blocked_until: blockedUntil, blocked_reason: reason });
        }
        return { rows: [] as T[], rowCount: 1 };
      }
      // clear blocked_until
      if (s.includes("UPDATE") && s.includes("SET blocked_until = NULL")) {
        const [userId] = params as [string];
        const existing = db.profileSettings.get(userId);
        if (existing) { existing.blocked_until = null; existing.blocked_reason = null; }
        return { rows: [] as T[], rowCount: 1 };
      }
      // blocked_until read for assertUserNotBlocked
      if (s.includes("SELECT blocked_until FROM")) {
        const id = params[0] as string;
        const row = db.profileSettings.get(id);
        return { rows: (row ? [{ blocked_until: row.blocked_until }] : []) as unknown as T[], rowCount: row ? 1 : 0 };
      }
      // pending loss-limit flush read
      if (s.includes("FROM") && s.includes("app_rg_pending_loss_limit_changes")) {
        const nowMs = params[0] as number;
        const rows = Array.from(db.pending.values())
          .filter(
            (p) =>
              (p.dailyEffectiveFromMs !== undefined && p.dailyEffectiveFromMs <= nowMs) ||
              (p.monthlyEffectiveFromMs !== undefined && p.monthlyEffectiveFromMs <= nowMs)
          )
          .map((p) => ({
            wallet_id: p.walletId,
            hall_id: p.hallId,
            daily_pending_value: p.dailyPendingValue?.toString() ?? null,
            daily_effective_from_ms: p.dailyEffectiveFromMs?.toString() ?? null,
            monthly_pending_value: p.monthlyPendingValue?.toString() ?? null,
            monthly_effective_from_ms: p.monthlyEffectiveFromMs?.toString() ?? null,
          }));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      throw new Error(`userProfileRouter.test FakePool: unhandled SQL:\n${sql.slice(0, 220)}`);
    },
  };
}

// ── Test harness ──────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  db: FakeDb;
  rgState: StubRgState;
  auditStore: InMemoryAuditLogStore;
  service: ProfileSettingsService;
  engine: BingoEngine;
  /** Kontroller klokken i tester. */
  clock: { nowMs: number };
  close: () => Promise<void>;
}

async function startServer(opts?: {
  user?: Partial<PublicAppUser>;
  hallId?: string | null;
  lossLimitDelayMs?: number;
  startTimeMs?: number;
}): Promise<Ctx> {
  const hallId = opts?.hallId === undefined ? "hall-bergen" : opts.hallId;
  const user: PublicAppUser = {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
    ...opts?.user,
  };

  const startTimeMs = opts?.startTimeMs ?? new Date("2026-05-01T12:00:00Z").getTime();
  const clock = { nowMs: startTimeMs };

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token !== "alice-token") throw new DomainError("UNAUTHORIZED", "bad token");
      return user;
    },
  } as unknown as PlatformService;

  const rgState: StubRgState = {
    pending: new Map(),
    limits: new Map(),
    restrictions: new Map(),
  };
  const rgAdapter = makeRgAdapter(rgState);

  const walletAdapter = new InMemoryWalletAdapter();
  await walletAdapter.createAccount({ accountId: user.walletId, initialBalance: 0, allowExisting: true });

  const engine = new BingoEngine(new FixedTicketBingoAdapter(), walletAdapter, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 2,
    maxDrawsPerRound: 75,
    persistence: rgAdapter,
    dailyLossLimit: 900,
    monthlyLossLimit: 4400,
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 15 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000,
  });
  await engine.hydratePersistentState();

  const db: FakeDb = {
    users: new Map([[user.id, { id: user.id, wallet_id: user.walletId, hall_id: hallId, role: user.role }]]),
    profileSettings: new Map(),
    pending: rgState.pending, // shared reference for flush-test
  };

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const service = new ProfileSettingsService({
    pool: makeFakePool(db),
    schema: "public",
    engine,
    rgPersistence: rgAdapter,
    auditLogService,
    now: () => clock.nowMs,
    lossLimitIncreaseDelayMs: opts?.lossLimitDelayMs ?? 48 * 60 * 60 * 1000,
  });

  const app = express();
  app.use(express.json());
  app.use(createUserProfileRouter({ platformService, profileSettingsService: service }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    rgState,
    auditStore,
    service,
    engine,
    clock,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(url: string, method: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAuditEvent(
  store: InMemoryAuditLogStore,
  action: string,
  timeoutMs = 500
): Promise<PersistedAuditEvent | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-720: GET /api/user/profile/settings returnerer defaults når ingen profil-rad", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/settings`, "GET", "alice-token");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.userId, "user-alice");
    assert.equal(res.json.data.language, "nb-NO");
    assert.equal(res.json.data.block.blockedUntil, null);
    assert.equal(res.json.data.block.selfExcludedUntil, null);
    assert.equal(res.json.data.pause.pausedUntil, null);
    // Default loss-limits = regulatory (900/4400 per init).
    assert.equal(res.json.data.lossLimits.daily, 900);
    assert.equal(res.json.data.lossLimits.monthly, 4400);
  } finally {
    await ctx.close();
  }
});

test("BIN-720: GET settings uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/settings`, "GET");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST loss-limits SENKING aktiveres umiddelbart", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {
      daily: 500,
      monthly: 2000,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.lossLimits.daily, 500);
    assert.equal(res.json.data.lossLimits.monthly, 2000);
    // Senking skal IKKE havne i pending-queue.
    assert.equal(res.json.data.pendingLossLimits.daily, undefined);
    assert.equal(res.json.data.pendingLossLimits.monthly, undefined);

    const audit = await waitForAuditEvent(ctx.auditStore, "profile.loss_limits.update");
    assert.ok(audit, "forventet audit-event");
    assert.equal(audit!.actorType, "PLAYER");
    const diff = audit!.details.diff as Record<string, { from: number; to: number }>;
    assert.deepEqual(diff.dailyLimit, { from: 900, to: 500 });
    assert.deepEqual(diff.monthlyLimit, { from: 4400, to: 2000 });
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST loss-limits ØKNING lagres i 48h-queue", async () => {
  const ctx = await startServer();
  try {
    // Først senk slik at vi har noe å øke fra.
    await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {
      daily: 200,
      monthly: 1000,
    });

    const startMs = ctx.clock.nowMs;
    const res = await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {
      daily: 500,
      monthly: 3000,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    // Active verdier står fortsatt på senket verdi.
    assert.equal(res.json.data.lossLimits.daily, 200);
    assert.equal(res.json.data.lossLimits.monthly, 1000);
    // Pending skal reflektere økning med 48h effectiveAt.
    assert.ok(res.json.data.pendingLossLimits.daily);
    assert.equal(res.json.data.pendingLossLimits.daily.value, 500);
    const dailyEffectiveMs = new Date(res.json.data.pendingLossLimits.daily.effectiveAt).getTime();
    assert.equal(dailyEffectiveMs, startMs + 48 * 60 * 60 * 1000);
    assert.ok(res.json.data.pendingLossLimits.monthly);
    assert.equal(res.json.data.pendingLossLimits.monthly.value, 3000);
  } finally {
    await ctx.close();
  }
});

test("BIN-720: 48h-queue flush aktiverer pending-verdier når tid passerer", async () => {
  const ctx = await startServer({ lossLimitDelayMs: 48 * 60 * 60 * 1000 });
  try {
    // Senk først for å ha en lavere base.
    await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", { daily: 200, monthly: 1000 });
    // Økning → pending.
    await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", { daily: 500, monthly: 3000 });

    // Verifisér at pending finnes.
    const before = await req(`${ctx.baseUrl}/api/user/profile/settings`, "GET", "alice-token");
    assert.ok(before.json.data.pendingLossLimits.daily, "pending må eksistere før flush");
    assert.equal(before.json.data.lossLimits.daily, 200);

    // Tid fram 48h + 1s.
    ctx.clock.nowMs += 48 * 60 * 60 * 1000 + 1000;

    const activated = await ctx.service.flushPendingLossLimits();
    assert.ok(activated >= 1, "minst én rad skal aktiveres");

    const after = await req(`${ctx.baseUrl}/api/user/profile/settings`, "GET", "alice-token");
    assert.equal(after.json.data.lossLimits.daily, 500, "daily skal være aktivert");
    assert.equal(after.json.data.lossLimits.monthly, 3000, "monthly skal være aktivert");
    assert.equal(after.json.data.pendingLossLimits.daily, undefined, "pending skal være ryddet");
    assert.equal(after.json.data.pendingLossLimits.monthly, undefined, "pending skal være ryddet");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: 48h-queue flush NO-OP før tiden har passert", async () => {
  const ctx = await startServer();
  try {
    await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", { daily: 200 });
    await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", { daily: 500 });

    // Tid fram kun 1h — pending skal ikke aktiveres.
    ctx.clock.nowMs += 60 * 60 * 1000;
    const activated = await ctx.service.flushPendingLossLimits();
    assert.equal(activated, 0, "ingen flush forventet før 48h er gått");

    const res = await req(`${ctx.baseUrl}/api/user/profile/settings`, "GET", "alice-token");
    assert.equal(res.json.data.lossLimits.daily, 200, "daily skal fortsatt være senket verdi");
    assert.ok(res.json.data.pendingLossLimits.daily, "pending skal fortsatt eksistere");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST self-exclude '7d' setter blocked_until ~7 dager fram", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/self-exclude`, "POST", "alice-token", {
      duration: "7d",
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json.data.block.blockedUntil);
    const untilMs = new Date(res.json.data.block.blockedUntil).getTime();
    assert.equal(untilMs, ctx.clock.nowMs + 7 * 24 * 60 * 60 * 1000);
    // 1y-selvutelukkelse skal IKKE være satt for korte blokkeringer.
    assert.equal(res.json.data.block.selfExcludedUntil, null);

    const audit = await waitForAuditEvent(ctx.auditStore, "profile.self_exclude.set");
    assert.ok(audit);
    assert.equal(audit!.details.duration, "7d");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST self-exclude '1y' bruker ComplianceManager (eksisterende self-exclusion)", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/self-exclude`, "POST", "alice-token", {
      duration: "1y",
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    // 1y -> selfExcludedUntil skal være satt; blocked_until er ikke brukt for 1y.
    assert.ok(res.json.data.block.selfExcludedUntil);
    assert.equal(res.json.data.block.blockedUntil, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST self-exclude med ugyldig duration gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/self-exclude`, "POST", "alice-token", {
      duration: "2d",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: assertUserNotBlocked kaster PLAYER_BLOCKED når blocked_until er aktiv", async () => {
  const ctx = await startServer();
  try {
    // Blokker 1 dag.
    await req(`${ctx.baseUrl}/api/user/profile/self-exclude`, "POST", "alice-token", { duration: "1d" });
    // Gate må kaste PLAYER_BLOCKED.
    await assert.rejects(
      async () => await ctx.service.assertUserNotBlocked("user-alice"),
      (err: unknown) => err instanceof DomainError && err.code === "PLAYER_BLOCKED",
      "assertUserNotBlocked skal kaste PLAYER_BLOCKED"
    );
    // Etter at tiden har passert skal det ikke kaste.
    ctx.clock.nowMs += 2 * 24 * 60 * 60 * 1000;
    await ctx.service.assertUserNotBlocked("user-alice");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST language setter nb-NO → en-US og audit-logger", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/language`, "POST", "alice-token", {
      language: "en-US",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.language, "en-US");

    const audit = await waitForAuditEvent(ctx.auditStore, "profile.language.set");
    assert.ok(audit);
    assert.equal(audit!.details.from, "nb-NO");
    assert.equal(audit!.details.to, "en-US");

    // Toggling tilbake.
    const res2 = await req(`${ctx.baseUrl}/api/user/profile/language`, "POST", "alice-token", {
      language: "nb-NO",
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.data.language, "nb-NO");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST language med ugyldig verdi gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/language`, "POST", "alice-token", {
      language: "sv-SE",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST pause setter pausedUntil i compliance-snapshot", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/pause`, "POST", "alice-token", {
      durationMinutes: 30,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json.data.pause.pausedUntil);

    const audit = await waitForAuditEvent(ctx.auditStore, "profile.pause.set");
    assert.ok(audit);
    assert.equal(audit!.details.durationMinutes, 30);
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST pause uten durationMinutes gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/pause`, "POST", "alice-token", {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST loss-limits uten hall_id gir HALL_BINDING_REQUIRED", async () => {
  const ctx = await startServer({ hallId: null });
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {
      daily: 500,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "HALL_BINDING_REQUIRED");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST loss-limits høyere enn regulatorisk tak gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {
      daily: 99999,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-720: POST loss-limits uten felter gir INVALID_INPUT", async () => {
  const ctx = await startServer();
  try {
    const res = await req(`${ctx.baseUrl}/api/user/profile/loss-limits`, "POST", "alice-token", {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
