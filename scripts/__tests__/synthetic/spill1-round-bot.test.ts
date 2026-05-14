/**
 * Vitest unit-tests for the synthetic Spill 1 bingo-round bot.
 *
 * Covers:
 *   - Invariant evaluators (I1-I6) — pure-compute → fed mock data
 *   - ApiClient — fetch-mocked transport, success + structured-error paths
 *   - Bot helpers — playerEmailForIndex, parseArgs, defaultTicketSpec
 *   - Run-mode --dry-run — does not call wallet-mutating endpoints
 *
 * Run:
 *   cd <repo-root>
 *   npx vitest run scripts/__tests__/synthetic/
 *
 * The tests run WITHOUT a backend, Postgres, Redis, or socket.io-client
 * installed. We mock the FetchLike and SocketFactory interfaces.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  evaluateWalletConservation,
  evaluateComplianceLedger,
  evaluateHashChain,
  evaluateDrawSequence,
  evaluateIdempotency,
  evaluateRoundEndState,
  summarizeInvariants,
} from "../../synthetic/invariants.js";
import type {
  PlayerWalletSnapshot,
  PurchaseRecord,
  PayoutRecord,
  AuditLedgerSnapshot,
  HashChainSnapshot,
  DrawSequenceSnapshot,
  ScheduledGameFinalState,
} from "../../synthetic/invariants.js";
import { ApiClient, ApiError } from "../../synthetic/api-client.js";
import type { FetchLike } from "../../synthetic/api-client.js";
import {
  parseArgs,
  playerEmailForIndex,
  defaultTicketSpec,
  roomCodeForHall,
  run,
  renderReport,
  DEFAULT_CONFIG,
} from "../../synthetic/spill1-round-bot.js";
import type { BotConfig } from "../../synthetic/spill1-round-bot.js";
import type { SocketFactory, SyntheticSocketLike } from "../../synthetic/socket-client.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeWallet(
  userId: string,
  balanceBefore: number,
  balanceAfter: number
): PlayerWalletSnapshot {
  return {
    userId,
    walletId: `wallet-${userId}`,
    email: `${userId}@example.com`,
    balanceBeforeCents: balanceBefore,
    balanceAfterCents: balanceAfter,
  };
}

function makePurchase(
  userId: string,
  amountCents: number,
  opts: { alreadyExisted?: boolean; clientRequestId?: string; purchaseId?: string } = {}
): PurchaseRecord {
  const clientRequestId = opts.clientRequestId ?? `crid-${userId}-${amountCents}`;
  return {
    userId,
    walletId: `wallet-${userId}`,
    purchaseId: opts.purchaseId ?? `purchase-${userId}-${amountCents}`,
    totalAmountCents: amountCents,
    ticketCount: Math.max(1, Math.floor(amountCents / 500)),
    clientRequestId,
    alreadyExisted: opts.alreadyExisted ?? false,
  };
}

function makePayout(userId: string, amountCents: number): PayoutRecord {
  return {
    userId,
    walletId: `wallet-${userId}`,
    amountCents,
    phase: "1",
    patternName: "yellow",
  };
}

// ── I1: Wallet conservation ─────────────────────────────────────────────

describe("evaluateWalletConservation (I1)", () => {
  it("PASS when no money moved", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 10000)],
      purchases: [],
      payouts: [],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.id).toBe("I1");
  });

  it("PASS when purchase exactly debits balance", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 9500)],
      purchases: [makePurchase("u1", 500)],
      payouts: [],
    });
    expect(result.verdict).toBe("PASS");
  });

  it("PASS when payout exactly credits balance (no purchase)", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 12000)],
      purchases: [],
      payouts: [makePayout("u1", 2000)],
    });
    expect(result.verdict).toBe("PASS");
  });

  it("PASS when purchase + payout balance out across multiple players", () => {
    const result = evaluateWalletConservation({
      wallets: [
        makeWallet("u1", 10000, 9500), // bought 500
        makeWallet("u2", 10000, 12000), // bought 500, won 2500
        makeWallet("u3", 10000, 9500), // bought 500
      ],
      purchases: [
        makePurchase("u1", 500),
        makePurchase("u2", 500),
        makePurchase("u3", 500),
      ],
      payouts: [makePayout("u2", 2500)],
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL when wallet was double-debited", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 9000)], // -1000, but only one 500-purchase
      purchases: [makePurchase("u1", 500)],
      payouts: [],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("BRUDD");
  });

  it("alreadyExisted purchases do NOT count as spend", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 9500)], // -500 (one debit only)
      purchases: [
        makePurchase("u1", 500),
        // Idempotency-probe re-submit — should NOT count as additional spend
        makePurchase("u1", 500, { alreadyExisted: true, purchaseId: "purchase-u1-500" }),
      ],
      payouts: [],
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL with details showing delta in øre", () => {
    const result = evaluateWalletConservation({
      wallets: [makeWallet("u1", 10000, 9000)],
      purchases: [makePurchase("u1", 500)],
      payouts: [],
    });
    expect(result.details).toMatch(/delta=-500 øre/);
  });

  it("tolerance allows floor-rest from pot-split", () => {
    // 3 winners share a 100 kr (10000 øre) pot → 33.33 kr each → 3333 øre
    // each, total 9999, rest 1 øre to house.
    const result = evaluateWalletConservation({
      wallets: [
        makeWallet("u1", 0, 3333),
        makeWallet("u2", 0, 3333),
        makeWallet("u3", 0, 3333),
      ],
      purchases: [],
      payouts: [
        makePayout("u1", 3333),
        makePayout("u2", 3333),
        makePayout("u3", 3333),
      ],
      floorRestToleranceCents: 1, // explicit
    });
    expect(result.verdict).toBe("PASS");
  });
});

// ── I2: Compliance-ledger ───────────────────────────────────────────────

describe("evaluateComplianceLedger (I2)", () => {
  it("PASS when ledger has at least 1 STAKE per purchase + 1 PRIZE per payout", () => {
    const result = evaluateComplianceLedger({
      purchases: [makePurchase("u1", 500), makePurchase("u2", 500)],
      payouts: [makePayout("u1", 2000)],
      ledger: { stakeEntries: 2, prizeEntries: 1 },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL when STAKE-count is below purchase-count", () => {
    const result = evaluateComplianceLedger({
      purchases: [makePurchase("u1", 500), makePurchase("u2", 500)],
      payouts: [],
      ledger: { stakeEntries: 1, prizeEntries: 0 },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("færre STAKE-entries");
  });

  it("FAIL when PRIZE-count is below payout-count", () => {
    const result = evaluateComplianceLedger({
      purchases: [],
      payouts: [makePayout("u1", 2000), makePayout("u2", 1000)],
      ledger: { stakeEntries: 0, prizeEntries: 1 },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("færre PRIZE-entries");
  });

  it("alreadyExisted purchases are excluded from minimum count", () => {
    const result = evaluateComplianceLedger({
      purchases: [
        makePurchase("u1", 500),
        makePurchase("u1", 500, { alreadyExisted: true }),
      ],
      payouts: [],
      ledger: { stakeEntries: 1, prizeEntries: 0 },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("accepts more ledger entries than minimum (compliance flush)", () => {
    const result = evaluateComplianceLedger({
      purchases: [makePurchase("u1", 500)],
      payouts: [],
      ledger: { stakeEntries: 3, prizeEntries: 0 }, // extra audit-rows OK
    });
    expect(result.verdict).toBe("PASS");
  });
});

// ── I3: Hash-chain ──────────────────────────────────────────────────────

describe("evaluateHashChain (I3)", () => {
  it("PASS when chain is valid", () => {
    const snapshot: HashChainSnapshot = {
      entriesChecked: 100,
      entriesValid: 100,
      mismatches: 0,
      chainOk: true,
    };
    expect(evaluateHashChain(snapshot).verdict).toBe("PASS");
  });

  it("FAIL when chainOk=false", () => {
    const snapshot: HashChainSnapshot = {
      entriesChecked: 100,
      entriesValid: 99,
      mismatches: 1,
      chainOk: false,
    };
    expect(evaluateHashChain(snapshot).verdict).toBe("FAIL");
  });

  it("FAIL when mismatches > 0 even if chainOk=true", () => {
    const snapshot: HashChainSnapshot = {
      entriesChecked: 100,
      entriesValid: 95,
      mismatches: 5,
      chainOk: true,
    };
    expect(evaluateHashChain(snapshot).verdict).toBe("FAIL");
  });

  it("WARN when chainOk=null (skipped)", () => {
    const snapshot: HashChainSnapshot = {
      entriesChecked: 0,
      entriesValid: 0,
      mismatches: 0,
      chainOk: null,
    };
    expect(evaluateHashChain(snapshot).verdict).toBe("WARN");
  });
});

// ── I4: Draw-sequence consistency ───────────────────────────────────────

describe("evaluateDrawSequence (I4)", () => {
  it("PASS when all players see identical sequences", () => {
    const snapshots: DrawSequenceSnapshot[] = [
      { userId: "u1", drawnNumbers: [5, 12, 33, 44] },
      { userId: "u2", drawnNumbers: [5, 12, 33, 44] },
      { userId: "u3", drawnNumbers: [5, 12, 33, 44] },
    ];
    expect(evaluateDrawSequence(snapshots).verdict).toBe("PASS");
  });

  it("PASS when shorter sequence is prefix of longer (late-join)", () => {
    const snapshots: DrawSequenceSnapshot[] = [
      { userId: "u1", drawnNumbers: [5, 12, 33, 44, 55] },
      { userId: "u2", drawnNumbers: [5, 12, 33, 44] }, // late join, missed last
    ];
    expect(evaluateDrawSequence(snapshots).verdict).toBe("PASS");
  });

  it("FAIL when sequences diverge", () => {
    const snapshots: DrawSequenceSnapshot[] = [
      { userId: "u1", drawnNumbers: [5, 12, 33, 44] },
      { userId: "u2", drawnNumbers: [5, 12, 99, 44] }, // diverges at idx 2
    ];
    const result = evaluateDrawSequence(snapshots);
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("inconsistencies=1");
    expect(result.details).toContain("u2");
  });

  it("WARN when no players observed", () => {
    expect(evaluateDrawSequence([]).verdict).toBe("WARN");
  });

  it("handles single-player observation", () => {
    const result = evaluateDrawSequence([
      { userId: "u1", drawnNumbers: [1, 2, 3] },
    ]);
    expect(result.verdict).toBe("PASS");
  });
});

// ── I5: Idempotency ─────────────────────────────────────────────────────

describe("evaluateIdempotency (I5)", () => {
  it("PASS when uniqueClientRequestIds matches uniquePurchaseIds (no probe)", () => {
    const result = evaluateIdempotency({
      purchases: [
        makePurchase("u1", 500, { purchaseId: "p1", clientRequestId: "c1" }),
        makePurchase("u2", 500, { purchaseId: "p2", clientRequestId: "c2" }),
      ],
      intentionalDuplicates: 0,
    });
    expect(result.verdict).toBe("PASS");
  });

  it("PASS when alreadyExisted matches intentionalDuplicates", () => {
    const result = evaluateIdempotency({
      purchases: [
        makePurchase("u1", 500, { purchaseId: "p1", clientRequestId: "c1" }),
        makePurchase("u1", 500, {
          purchaseId: "p1",
          clientRequestId: "c1",
          alreadyExisted: true,
        }),
      ],
      intentionalDuplicates: 1,
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL when server creates more purchaseIds than clientRequestIds", () => {
    const result = evaluateIdempotency({
      purchases: [
        makePurchase("u1", 500, { purchaseId: "p1", clientRequestId: "c1" }),
        makePurchase("u1", 500, { purchaseId: "p2", clientRequestId: "c1" }),
        // ^^ same crid, different purchaseId → idempotency broken
      ],
      intentionalDuplicates: 1,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("opprettet flere purchaseIds");
  });

  it("FAIL when alreadyExisted is below intentionalDuplicates", () => {
    const result = evaluateIdempotency({
      purchases: [
        makePurchase("u1", 500, { purchaseId: "p1", clientRequestId: "c1" }),
      ],
      intentionalDuplicates: 2, // bot says it probed but server didn't dedup
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.details).toContain("færre alreadyExisted");
  });
});

// ── I6: Round-end-state ─────────────────────────────────────────────────

describe("evaluateRoundEndState (I6)", () => {
  it("PASS when status === 'finished'", () => {
    const state: ScheduledGameFinalState = {
      scheduledGameId: "sg-1",
      status: "finished",
      drawsTotal: 45,
    };
    expect(evaluateRoundEndState(state).verdict).toBe("PASS");
  });

  it("FAIL when status !== 'finished'", () => {
    const cases = ["running", "paused", "cancelled", "scheduled"];
    for (const status of cases) {
      const state: ScheduledGameFinalState = {
        scheduledGameId: "sg-1",
        status,
        drawsTotal: 0,
      };
      const result = evaluateRoundEndState(state);
      expect(result.verdict, `status=${status}`).toBe("FAIL");
    }
  });

  it("WARN when state is null (dry-run)", () => {
    expect(evaluateRoundEndState(null).verdict).toBe("WARN");
  });
});

// ── Summary ─────────────────────────────────────────────────────────────

describe("summarizeInvariants", () => {
  it("counts PASS / FAIL / WARN correctly", () => {
    const summary = summarizeInvariants([
      { id: "I1", title: "x", verdict: "PASS", details: "" },
      { id: "I2", title: "x", verdict: "PASS", details: "" },
      { id: "I3", title: "x", verdict: "FAIL", details: "" },
      { id: "I4", title: "x", verdict: "WARN", details: "" },
      { id: "I5", title: "x", verdict: "WARN", details: "" },
      { id: "I6", title: "x", verdict: "PASS", details: "" },
    ]);
    expect(summary.pass).toBe(3);
    expect(summary.fail).toBe(1);
    expect(summary.warn).toBe(2);
  });
});

// ── ApiClient ───────────────────────────────────────────────────────────

describe("ApiClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new ApiClient({
      baseUrl: "http://localhost:4000",
      fetchImpl: fetchMock as unknown as FetchLike,
    });
  });

  function makeResponse(opts: { status: number; body: unknown }): {
    status: number;
    ok: boolean;
    text(): Promise<string>;
    json(): Promise<unknown>;
    headers: { get(name: string): string | null };
  } {
    const text = JSON.stringify(opts.body);
    return {
      status: opts.status,
      ok: opts.status >= 200 && opts.status < 300,
      text: async () => text,
      json: async () => opts.body,
      headers: { get: () => null },
    };
  }

  it("login() unwraps { ok, data } envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: {
          ok: true,
          data: {
            accessToken: "tok-123",
            user: {
              id: "user-1",
              email: "u@x.no",
              role: "PLAYER",
              walletId: "wallet-1",
            },
          },
        },
      })
    );
    const session = await client.login("u@x.no", "pw");
    expect(session.accessToken).toBe("tok-123");
    expect(session.walletId).toBe("wallet-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("http://localhost:4000/api/auth/login");
    expect(call[1]?.method).toBe("POST");
  });

  it("login() throws REQUIRES_2FA on 2FA-account", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: { ok: true, data: { requires2FA: true, challengeId: "c1" } },
      })
    );
    await expect(client.login("u@x.no", "pw")).rejects.toMatchObject({
      name: "ApiError",
      code: "REQUIRES_2FA",
    });
  });

  it("throws ApiError with backend code on { ok: false }", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 401,
        body: {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "wrong password" },
        },
      })
    );
    await expect(
      client.login("u@x.no", "pw")
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("falls back to HTTP_<status> when no error code in body", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 500,
        body: { ok: false },
      })
    );
    await expect(
      client.get<unknown>("/anywhere")
    ).rejects.toMatchObject({
      code: "HTTP_500",
    });
  });

  it("Authorization header is added when token is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: { ok: true, data: { account: { id: "w1", balance: 100 } } },
      })
    );
    await client.getWalletMe("tok-abc");
    const call = fetchMock.mock.calls[0]!;
    expect(call[1]?.headers?.Authorization).toBe("Bearer tok-abc");
  });

  it("getWalletMe() converts kr → øre", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: {
          ok: true,
          data: {
            account: { id: "w1", balance: 1500 }, // 1500 kr
          },
        },
      })
    );
    const result = await client.getWalletMe("tok");
    expect(result.balanceCents).toBe(150000); // 1500 kr × 100 = 150000 øre
  });

  it("purchaseTickets() sends the expected payload", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: {
          ok: true,
          data: {
            purchaseId: "p-1",
            totalAmountCents: 1500,
            alreadyExisted: false,
          },
        },
      })
    );
    const result = await client.purchaseTickets("tok", {
      scheduledGameId: "sg-1",
      buyerUserId: "u-1",
      hallId: "demo-hall-001",
      ticketSpec: [
        { color: "white", size: "small", count: 3, priceCentsEach: 500 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-1",
    });
    expect(result.purchaseId).toBe("p-1");
    expect(result.alreadyExisted).toBe(false);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body!);
    expect(sent.scheduledGameId).toBe("sg-1");
    expect(sent.ticketSpec[0].count).toBe(3);
  });

  it("masterStart() returns scheduledGameId", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        body: {
          ok: true,
          data: {
            scheduledGameId: "sg-fresh",
            planRunId: "pr-1",
            status: "running",
            scheduledGameStatus: "running",
            inconsistencyWarnings: [],
          },
        },
      })
    );
    const result = await client.masterStart("tok", "demo-hall-001");
    expect(result.scheduledGameId).toBe("sg-fresh");
  });
});

// ── Bot helpers ─────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("uses defaults when no args supplied", () => {
    const cfg = parseArgs([]);
    expect(cfg.players).toBe(DEFAULT_CONFIG.players);
    expect(cfg.ticketsPerPlayer).toBe(DEFAULT_CONFIG.ticketsPerPlayer);
    expect(cfg.hallId).toBe("demo-hall-001");
    expect(cfg.mode).toBe("local");
    expect(cfg.timeoutMs).toBe(60_000);
  });

  it("parses --players and --tickets-per-player", () => {
    const cfg = parseArgs(["--players=5", "--tickets-per-player=2"]);
    expect(cfg.players).toBe(5);
    expect(cfg.ticketsPerPlayer).toBe(2);
  });

  it("clamps --players to max 12", () => {
    const cfg = parseArgs(["--players=20"]);
    expect(cfg.players).toBe(12);
  });

  it("clamps --players to min 1", () => {
    const cfg = parseArgs(["--players=0"]);
    expect(cfg.players).toBe(1);
  });

  it("--mode=ci shortens timeout to 30s default", () => {
    const cfg = parseArgs(["--mode=ci"]);
    expect(cfg.timeoutMs).toBe(30_000);
    expect(cfg.mode).toBe("ci");
  });

  it("--timeout overrides ci-default", () => {
    const cfg = parseArgs(["--mode=ci", "--timeout=15"]);
    expect(cfg.timeoutMs).toBe(15_000);
  });

  it("--dry-run sets mode", () => {
    const cfg = parseArgs(["--mode=dry-run"]);
    expect(cfg.mode).toBe("dry-run");
  });

  it("--no-socket flag is respected", () => {
    const cfg = parseArgs(["--no-socket"]);
    expect(cfg.noSocket).toBe(true);
  });

  it("--backend-url strips trailing slash", () => {
    const cfg = parseArgs(["--backend-url=http://example.com/"]);
    expect(cfg.backendUrl).toBe("http://example.com");
  });

  it("--replay-token defaults to --reset-token when not specified", () => {
    const cfg = parseArgs(["--reset-token=secret"]);
    expect(cfg.replayToken).toBe("secret");
  });

  it("--replay-token overrides --reset-token when specified", () => {
    const cfg = parseArgs([
      "--reset-token=reset-secret",
      "--replay-token=replay-secret",
    ]);
    expect(cfg.replayToken).toBe("replay-secret");
  });

  it("ignores unknown flags gracefully", () => {
    const cfg = parseArgs(["--players=3", "--unknown-flag=x"]);
    expect(cfg.players).toBe(3);
  });
});

describe("playerEmailForIndex", () => {
  it("returns demo-pilot-spiller-N+1 for index N", () => {
    expect(playerEmailForIndex(0)).toBe("demo-pilot-spiller-1@example.com");
    expect(playerEmailForIndex(11)).toBe("demo-pilot-spiller-12@example.com");
  });

  it("rotates after 12 (index 12 → demo-pilot-spiller-1)", () => {
    expect(playerEmailForIndex(12)).toBe("demo-pilot-spiller-1@example.com");
    expect(playerEmailForIndex(13)).toBe("demo-pilot-spiller-2@example.com");
  });
});

describe("defaultTicketSpec", () => {
  it("returns one small-white-entry with correct count and price", () => {
    const spec = defaultTicketSpec(3);
    expect(spec).toHaveLength(1);
    expect(spec[0]).toEqual({
      color: "white",
      size: "small",
      count: 3,
      priceCentsEach: 500,
    });
  });
});

describe("roomCodeForHall", () => {
  it("returns canonical BINGO1 for any hall", () => {
    expect(roomCodeForHall("demo-hall-001")).toBe("BINGO1");
    expect(roomCodeForHall("hall-anywhere")).toBe("BINGO1");
  });
});

describe("renderReport", () => {
  it("includes mode + backend + duration + result", () => {
    const report = renderReport({
      cfg: {
        ...DEFAULT_CONFIG,
        players: 5,
        backendUrl: "http://localhost:4000",
        hallId: "demo-hall-001",
      },
      invariants: [
        { id: "I1", title: "x", verdict: "PASS", details: "details" },
      ],
      preflightReason: undefined,
      startedAt: 0,
      durationMs: 5_000,
      mode: "local",
    });
    expect(report).toContain("Spillere:** 5");
    expect(report).toContain("Backend:** http://localhost:4000");
    expect(report).toContain("Resultat:** PASS");
    expect(report).toContain("I1");
  });

  it("includes pre-flight reason when present", () => {
    const report = renderReport({
      cfg: DEFAULT_CONFIG,
      invariants: [],
      preflightReason: "backend health failed",
      startedAt: 0,
      durationMs: 100,
      mode: "local",
    });
    expect(report).toContain("backend health failed");
  });

  it("FAIL when any invariant is FAIL", () => {
    const report = renderReport({
      cfg: DEFAULT_CONFIG,
      invariants: [
        { id: "I1", title: "x", verdict: "PASS", details: "" },
        { id: "I2", title: "x", verdict: "FAIL", details: "broken" },
      ],
      preflightReason: undefined,
      startedAt: 0,
      durationMs: 1000,
      mode: "local",
    });
    expect(report).toMatch(/Resultat:\*\* FAIL/);
  });
});

// ── Bot.run() integration smoke (with mocked fetch) ─────────────────────

describe("run() in --mode=dry-run", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockSocketFactory: SocketFactory;
  let socketCount: number;

  beforeEach(() => {
    fetchMock = vi.fn();
    socketCount = 0;
    mockSocketFactory = () => {
      socketCount += 1;
      const sock: SyntheticSocketLike = {
        connected: true,
        on: () => {},
        emit: () => {},
        disconnect: () => {},
      };
      return sock;
    };
  });

  function makeRespBody(body: unknown, status = 200) {
    const text = JSON.stringify(body);
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => text,
      json: async () => body,
      headers: { get: () => null },
    };
  }

  it("emits PASS-exit-code 0 in dry-run with healthy backend", async () => {
    // /health returns `{ ok: true, data: { ... } }` envelope on the real backend.
    fetchMock.mockResolvedValue(
      makeRespBody({ ok: true, data: { wallets: 0 } }, 200)
    );

    const cfg: BotConfig = { ...DEFAULT_CONFIG, mode: "dry-run", players: 2 };
    const client = new ApiClient({
      baseUrl: cfg.backendUrl,
      fetchImpl: fetchMock as unknown as FetchLike,
    });
    const result = await run(cfg, client, mockSocketFactory);
    expect(result.exitCode).toBe(0);
    // 6 invariants, all WARN in dry-run
    expect(result.invariants).toHaveLength(6);
    expect(
      result.invariants.every((i) => i.verdict === "WARN")
    ).toBe(true);
    // No purchases or master-start were made
    expect(socketCount).toBe(0);
  });

  it("returns exit-code 2 on pre-flight failure", async () => {
    fetchMock.mockResolvedValue(
      makeRespBody({ ok: false, error: { code: "SERVICE_UNAVAILABLE" } }, 503)
    );
    const cfg: BotConfig = { ...DEFAULT_CONFIG, mode: "dry-run", players: 1 };
    const client = new ApiClient({
      baseUrl: cfg.backendUrl,
      fetchImpl: fetchMock as unknown as FetchLike,
    });
    const result = await run(cfg, client, mockSocketFactory);
    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("backend health failed");
  });
});
