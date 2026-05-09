/**
 * BIN-806 A13: unit-tester for AntiFraudService.
 *
 * Strategi: stub `pg.Pool` med en in-memory store som etterligner
 * `wallet_transactions` (for velocity + amount-deviation) og
 * `app_anti_fraud_signals` (for persist + listSignals).
 *
 * Hver heuristikk testes isolert + en aggregat-test (multiple signals
 * → maks-risiko). Multi-IP testes med multiple service-calls fra
 * forskjellige userId-er for å verifisere at IP-cachen oppdateres
 * riktig og lazy-expirer.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AntiFraudService, computeTimingStdDev } from "../AntiFraudService.js";

interface WalletTxRow {
  user_id: string;
  amount: number;
  created_at: Date;
}

interface SignalRow {
  id: string;
  user_id: string;
  hall_id: string | null;
  transaction_id: string | null;
  risk_level: string;
  signals_json: unknown;
  action_taken: string;
  ip_address: string | null;
  amount_cents: number | null;
  operation_type: string | null;
  assessed_at: Date;
}

interface Store {
  walletTx: WalletTxRow[];
  signals: SignalRow[];
}

function newStore(): Store {
  return { walletTx: [], signals: [] };
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  const trimmed = sql.trim();
  if (
    trimmed.startsWith("BEGIN") ||
    trimmed.startsWith("COMMIT") ||
    trimmed.startsWith("ROLLBACK") ||
    trimmed.startsWith("CREATE")
  ) {
    return { rows: [], rowCount: 0 };
  }

  // Velocity: SELECT 'hour' AS window, COUNT(*)::bigint AS cnt FROM wallet_transactions ...
  if (sql.includes("'hour' AS window") && sql.includes("UNION ALL")) {
    const userId = params[0] as string;
    const hourFromIso = params[1] as string;
    const dayFromIso = params[2] as string;
    const hourFromMs = Date.parse(hourFromIso);
    const dayFromMs = Date.parse(dayFromIso);
    const hourCount = store.walletTx.filter(
      (r) => r.user_id === userId && r.created_at.getTime() >= hourFromMs,
    ).length;
    const dayCount = store.walletTx.filter(
      (r) => r.user_id === userId && r.created_at.getTime() >= dayFromMs,
    ).length;
    return {
      rows: [
        { window: "hour", cnt: hourCount },
        { window: "day", cnt: dayCount },
      ],
      rowCount: 2,
    };
  }

  // Amount-deviation: SELECT AVG(amount)::numeric, COUNT(*)::bigint FROM wallet_transactions ...
  if (sql.includes("AVG(amount)") && sql.includes("amount > 0")) {
    const userId = params[0] as string;
    const fromIso = params[1] as string;
    const fromMs = Date.parse(fromIso);
    const matching = store.walletTx.filter(
      (r) => r.user_id === userId && r.created_at.getTime() >= fromMs && r.amount > 0,
    );
    const avg =
      matching.length === 0
        ? null
        : matching.reduce((s, r) => s + r.amount, 0) / matching.length;
    return {
      rows: [{ avg_cents: avg, cnt: matching.length }],
      rowCount: 1,
    };
  }

  // INSERT INTO app_anti_fraud_signals
  if (trimmed.startsWith("INSERT INTO") && sql.includes("app_anti_fraud_signals")) {
    const [id, userId, hallId, txId, riskLevel, signalsJson, actionTaken, ipAddress, amountCents, operationType, assessedAtIso] =
      params as [string, string, string | null, string | null, string, string, string, string | null, number | null, string | null, string];
    store.signals.push({
      id,
      user_id: userId,
      hall_id: hallId,
      transaction_id: txId,
      risk_level: riskLevel,
      signals_json: typeof signalsJson === "string" ? JSON.parse(signalsJson) : signalsJson,
      action_taken: actionTaken,
      ip_address: ipAddress,
      amount_cents: amountCents,
      operation_type: operationType,
      assessed_at: new Date(assessedAtIso),
    });
    return { rows: [], rowCount: 1 };
  }

  // SELECT ... FROM app_anti_fraud_signals
  if (trimmed.startsWith("SELECT") && sql.includes("app_anti_fraud_signals")) {
    let result = [...store.signals];
    let pIdx = 0;
    if (sql.includes("hall_id = $")) {
      const hallId = params[pIdx++] as string;
      result = result.filter((r) => r.hall_id === hallId);
    }
    if (sql.includes("user_id = $")) {
      const userId = params[pIdx++] as string;
      result = result.filter((r) => r.user_id === userId);
    }
    if (sql.includes("risk_level = $")) {
      const riskLevel = params[pIdx++] as string;
      result = result.filter((r) => r.risk_level === riskLevel);
    }
    if (sql.includes("action_taken = $")) {
      const action = params[pIdx++] as string;
      result = result.filter((r) => r.action_taken === action);
    }
    if (sql.includes("assessed_at >= $")) {
      const fromIso = params[pIdx++] as string;
      const fromMs = Date.parse(fromIso);
      result = result.filter((r) => r.assessed_at.getTime() >= fromMs);
    }
    if (sql.includes("assessed_at <= $")) {
      const toIso = params[pIdx++] as string;
      const toMs = Date.parse(toIso);
      result = result.filter((r) => r.assessed_at.getTime() <= toMs);
    }
    const limit = params[pIdx++] as number;
    result.sort((a, b) => b.assessed_at.getTime() - a.assessed_at.getTime());
    return {
      rows: result.slice(0, limit).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        hall_id: r.hall_id,
        transaction_id: r.transaction_id,
        risk_level: r.risk_level,
        signals_json: r.signals_json,
        action_taken: r.action_taken,
        ip_address: r.ip_address,
        amount_cents: r.amount_cents,
        operation_type: r.operation_type,
        assessed_at: r.assessed_at,
      })),
      rowCount: result.length,
    };
  }

  return { rows: [], rowCount: 0 };
}

function buildPoolStub(store: Store): Pool {
  const stub = {
    query: async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      return runQuery(store, sql, params);
    },
    connect: async () => {
      return {
        query: async (sql: string, params: unknown[] = []) => runQuery(store, sql, params),
        release: () => {},
      };
    },
  };
  return stub as unknown as Pool;
}

function seedWalletTx(
  store: Store,
  userId: string,
  countOrTimes: number | Date[],
  amount = 1000,
): void {
  const now = Date.now();
  if (typeof countOrTimes === "number") {
    for (let i = 0; i < countOrTimes; i++) {
      store.walletTx.push({
        user_id: userId,
        amount,
        created_at: new Date(now - i * 1000),
      });
    }
  } else {
    for (const t of countOrTimes) {
      store.walletTx.push({ user_id: userId, amount, created_at: t });
    }
  }
}

// ── computeTimingStdDev (pure helper) ───────────────────────────────────────

test("computeTimingStdDev: returns null for fewer than 2 samples", () => {
  assert.equal(computeTimingStdDev([]), null);
  assert.equal(computeTimingStdDev([100]), null);
});

test("computeTimingStdDev: zero variance for perfectly even spacing", () => {
  const stdDev = computeTimingStdDev([0, 100, 200, 300, 400]);
  assert.equal(stdDev, 0);
});

test("computeTimingStdDev: high variance for uneven spacing", () => {
  // deltas: 50, 1500, 30 → mean=526.67, variance=466955.6, stdDev≈683
  const stdDev = computeTimingStdDev([0, 50, 1550, 1580]);
  assert.ok(stdDev !== null);
  assert.ok(stdDev! > 100, `expected high stddev, got ${stdDev}`);
});

test("computeTimingStdDev: handles unsorted input by sorting first", () => {
  const sorted = computeTimingStdDev([0, 100, 200, 300]);
  const unsorted = computeTimingStdDev([300, 0, 200, 100]);
  assert.equal(sorted, unsorted);
});

// ── Velocity heuristic ──────────────────────────────────────────────────────

test("velocity: low risk when count is below medium threshold (default 10)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 5);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "low");
  assert.equal(result.actionTaken, "logged");
  assert.equal(result.signals.length, 0);
});

test("velocity HOUR: medium risk at 11 tx in 1h (threshold 10)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 11);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "medium");
  assert.equal(result.actionTaken, "logged");
  const codes = result.signals.map((s) => s.code);
  assert.ok(codes.includes("VELOCITY_HOUR"));
  // 11 tx is under DAY-threshold (100), så VELOCITY_DAY skal IKKE fire.
  assert.ok(!codes.includes("VELOCITY_DAY"));
});

test("velocity HOUR: high risk at 31 tx (threshold 30)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 31);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "high");
  assert.equal(result.actionTaken, "flagged_for_review");
});

test("velocity HOUR: critical risk at 61 tx (threshold 60)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 61);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "critical");
  assert.equal(result.actionTaken, "blocked");
});

test("velocity DAY: medium triggers independently of HOUR", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  // Use forTesting with override thresholds so HOUR doesn't fire
  const svc = AntiFraudService.forTesting(pool, {
    thresholds: {
      velocityHour: { medium: 10000, high: 20000, critical: 30000 },
      velocityDay: { medium: 100, high: 200, critical: 500 },
      amountDeviation: { medium: 5, high: 10, critical: 25, minHistorySamples: 3 },
      multiAccountIp: { medium: 3, high: 5, critical: 10 },
      botTimingStdDevMs: { medium: 50, high: 25, critical: 10, minSamples: 100 },
    },
  });
  // Spread 101 tx over the past 23h so all are in DAY but only ~5 in HOUR
  const now = Date.now();
  const times: Date[] = [];
  for (let i = 0; i < 101; i++) {
    times.push(new Date(now - i * 13 * 60 * 1000)); // 13 min apart → ~5 in last hour
  }
  seedWalletTx(store, "user-1", times);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  const codes = result.signals.map((s) => s.code);
  assert.ok(codes.includes("VELOCITY_DAY"));
  assert.equal(result.risk, "medium");
});

// ── Amount-deviation heuristic ──────────────────────────────────────────────

test("amount-deviation: skipped when sample count < minHistorySamples (3)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  // Only 2 historical tx — too few
  seedWalletTx(store, "user-1", 2, 100);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 1_000_000, // 100x the average
    operationType: "TOPUP",
  });
  // No AMOUNT_DEVIATION signal because too few samples.
  assert.ok(!result.signals.some((s) => s.code === "AMOUNT_DEVIATION"));
});

test("amount-deviation: medium at 6x average, given >=3 samples", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  // 5 historical tx of 100 each → avg 100
  seedWalletTx(store, "user-1", 5, 100);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 600, // 6x avg of 100
    operationType: "TOPUP",
  });
  const amount = result.signals.find((s) => s.code === "AMOUNT_DEVIATION");
  assert.ok(amount, "expected AMOUNT_DEVIATION signal");
  assert.equal(amount!.level, "medium");
});

test("amount-deviation: critical at 26x average", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 5, 100);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 2600, // 26x
    operationType: "TOPUP",
  });
  const amount = result.signals.find((s) => s.code === "AMOUNT_DEVIATION");
  assert.ok(amount);
  assert.equal(amount!.level, "critical");
  assert.equal(result.risk, "critical");
  assert.equal(result.actionTaken, "blocked");
});

test("amount-deviation: skipped when amountCents === 0", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-1", 5, 100);

  const result = await svc.assessTransaction({
    userId: "user-1",
    amountCents: 0, // pre-commit-check or non-amount op
    operationType: "OTHER",
  });
  assert.ok(!result.signals.some((s) => s.code === "AMOUNT_DEVIATION"));
});

// ── Multi-account-IP heuristic ──────────────────────────────────────────────

test("multi-account-IP: low until > 3 unique users on same IP", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  // 3 users on same IP — under threshold 3 (signal fires when > 3)
  await svc.assessTransaction({
    userId: "u1", amountCents: 0, operationType: "DEBIT", ipAddress: "192.0.2.1",
  });
  await svc.assessTransaction({
    userId: "u2", amountCents: 0, operationType: "DEBIT", ipAddress: "192.0.2.1",
  });
  const r3 = await svc.assessTransaction({
    userId: "u3", amountCents: 0, operationType: "DEBIT", ipAddress: "192.0.2.1",
  });
  // Cache now has {u1, u2, u3} for this IP. 3 ≤ threshold 3 → no signal.
  assert.ok(!r3.signals.some((s) => s.code === "MULTI_ACCOUNT_IP"));

  // 4th user → 4 > 3 → MEDIUM
  const r4 = await svc.assessTransaction({
    userId: "u4", amountCents: 0, operationType: "DEBIT", ipAddress: "192.0.2.1",
  });
  const ipSig = r4.signals.find((s) => s.code === "MULTI_ACCOUNT_IP");
  assert.ok(ipSig, "expected MULTI_ACCOUNT_IP signal at 4 users");
  assert.equal(ipSig!.level, "medium");
});

test("multi-account-IP: critical at 11 unique users (threshold 10)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  for (let i = 0; i < 11; i++) {
    await svc.assessTransaction({
      userId: `user-${i}`,
      amountCents: 0,
      operationType: "DEBIT",
      ipAddress: "10.0.0.5",
    });
  }
  const r12 = await svc.assessTransaction({
    userId: "user-12",
    amountCents: 0,
    operationType: "DEBIT",
    ipAddress: "10.0.0.5",
  });
  const ipSig = r12.signals.find((s) => s.code === "MULTI_ACCOUNT_IP");
  assert.ok(ipSig);
  assert.equal(ipSig!.level, "critical");
  assert.equal(r12.risk, "critical");
});

test("multi-account-IP: TTL expires entries after window", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  let now = 1_000_000_000_000;
  const svc = AntiFraudService.forTesting(pool, {
    nowMs: () => now,
    ipCacheTtlMs: 60_000, // 60s TTL for fast test
  });

  // Seed 4 users
  for (let i = 0; i < 4; i++) {
    await svc.assessTransaction({
      userId: `u${i}`,
      amountCents: 0,
      operationType: "DEBIT",
      ipAddress: "10.0.0.6",
      nowMs: now,
    });
  }
  // 4 > 3 → MEDIUM
  const before = await svc.assessTransaction({
    userId: "u4",
    amountCents: 0,
    operationType: "DEBIT",
    ipAddress: "10.0.0.6",
    nowMs: now,
  });
  assert.ok(before.signals.some((s) => s.code === "MULTI_ACCOUNT_IP"));

  // Skip past TTL — but every assess refreshes the entry's expiresAt.
  // After the LAST observation at `now`, expiresAt = now + 60_000.
  // We must wait 61_000+ from the last call to see expiry.
  now = now + 61_000;
  const after = await svc.assessTransaction({
    userId: "fresh-user", // new user, fresh observation → 1 user only
    amountCents: 0,
    operationType: "DEBIT",
    ipAddress: "10.0.0.6",
    nowMs: now,
  });
  // No multi-account-IP signal: stale cache purged, fresh cache has only 1 user.
  assert.ok(!after.signals.some((s) => s.code === "MULTI_ACCOUNT_IP"));
});

// ── Bot-timing heuristic (separate API) ─────────────────────────────────────

test("bot-timing: returns low when below minSamples", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  // Only 50 timestamps — under minSamples 100
  const stamps = Array.from({ length: 50 }, (_, i) => i * 100);
  const result = await svc.assessBotTiming({
    userId: "u1",
    timestampsMs: stamps,
  });
  assert.equal(result.risk, "low");
  assert.equal(result.signals.length, 0);
});

test("bot-timing: critical when stdDev < 10ms over 100+ samples", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  // Perfectly-spaced 100 samples → stdDev = 0
  const stamps = Array.from({ length: 100 }, (_, i) => i * 1000);
  const result = await svc.assessBotTiming({
    userId: "u1",
    timestampsMs: stamps,
  });
  const sig = result.signals.find((s) => s.code === "BOT_TIMING");
  assert.ok(sig);
  assert.equal(sig!.level, "critical");
  assert.equal(result.risk, "critical");
});

test("bot-timing: no signal for clearly-human random spacing", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  // Pseudo-random spacing 0-3000ms over 100 samples
  let cumulative = 0;
  const stamps: number[] = [];
  for (let i = 0; i < 100; i++) {
    cumulative += 500 + ((i * 137) % 2500); // varied deltas
    stamps.push(cumulative);
  }
  const result = await svc.assessBotTiming({
    userId: "u1",
    timestampsMs: stamps,
  });
  // stdDev should be > 50ms easily — no signal.
  assert.ok(!result.signals.some((s) => s.code === "BOT_TIMING"));
});

// ── Aggregation: max-risk on multiple signals ──────────────────────────────

test("aggregation: max risk wins (HOUR=medium + IP=high → high)", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  // Seed 11 tx for HOUR=medium
  seedWalletTx(store, "u1", 11);
  // Seed IP cache via 6 prior users → > 5 = HIGH
  for (let i = 0; i < 6; i++) {
    await svc.assessTransaction({
      userId: `prior-${i}`,
      amountCents: 0,
      operationType: "DEBIT",
      ipAddress: "10.0.0.99",
    });
  }
  const result = await svc.assessTransaction({
    userId: "u1",
    amountCents: 0,
    operationType: "DEBIT",
    ipAddress: "10.0.0.99",
  });
  const codes = result.signals.map((s) => s.code);
  assert.ok(codes.includes("VELOCITY_HOUR"));
  assert.ok(codes.includes("MULTI_ACCOUNT_IP"));
  assert.equal(result.risk, "high");
});

// ── Audit-row persistence ──────────────────────────────────────────────────

test("persistSignal: writes one row per assess + listSignals returns it", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  await svc.assessTransaction({
    userId: "u1",
    hallId: "hall-a",
    amountCents: 1000,
    operationType: "DEBIT",
    ipAddress: "192.0.2.5",
  });

  const list = await svc.listSignals({});
  assert.equal(list.length, 1);
  assert.equal(list[0]!.userId, "u1");
  assert.equal(list[0]!.hallId, "hall-a");
  assert.equal(list[0]!.actionTaken, "logged");
});

test("persistSignal: filter by hallId in listSignals", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  await svc.assessTransaction({
    userId: "u1", hallId: "hall-a", amountCents: 0, operationType: "DEBIT",
  });
  await svc.assessTransaction({
    userId: "u2", hallId: "hall-b", amountCents: 0, operationType: "DEBIT",
  });

  const onlyA = await svc.listSignals({ hallId: "hall-a" });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0]!.userId, "u1");
});

test("persistSignal: filter by riskLevel + actionTaken", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);

  // u1: low (no signals)
  await svc.assessTransaction({
    userId: "u1", amountCents: 0, operationType: "DEBIT",
  });
  // u2: critical (61 tx in last hour)
  seedWalletTx(store, "u2", 61);
  await svc.assessTransaction({
    userId: "u2", amountCents: 0, operationType: "DEBIT",
  });

  const blocked = await svc.listSignals({ actionTaken: "blocked" });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]!.userId, "u2");
  assert.equal(blocked[0]!.riskLevel, "critical");

  const lowOnly = await svc.listSignals({ riskLevel: "low" });
  assert.equal(lowOnly.length, 1);
  assert.equal(lowOnly[0]!.userId, "u1");
});

// ── Integration-style: 11 tx in 1h → medium ───────────────────────────────

test("integration: 11 transactions in 1h triggers medium-risk result", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "user-burst", 11);

  const result = await svc.assessTransaction({
    userId: "user-burst",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "medium");
  assert.equal(result.actionTaken, "logged");
  // Both VELOCITY_HOUR + VELOCITY_DAY fire (11 > 10 hour, 11 > some day-baseline-no… wait DAY threshold is 100)
  // Only HOUR fires.
  const hourSig = result.signals.find((s) => s.code === "VELOCITY_HOUR");
  assert.ok(hourSig);
  assert.equal(hourSig!.level, "medium");
});

// ── Integration-style: critical-flagg blokkerer transaksjon ────────────────

test("integration: critical risk → action 'blocked'", async () => {
  const store = newStore();
  const pool = buildPoolStub(store);
  const svc = AntiFraudService.forTesting(pool);
  seedWalletTx(store, "u1", 61);

  const result = await svc.assessTransaction({
    userId: "u1",
    amountCents: 0,
    operationType: "DEBIT",
  });
  assert.equal(result.risk, "critical");
  assert.equal(result.actionTaken, "blocked");

  const list = await svc.listSignals({});
  assert.equal(list[0]!.actionTaken, "blocked");
  assert.equal(list[0]!.transactionId, null); // pre-commit-block: no tx yet
});
