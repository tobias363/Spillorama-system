/**
 * ADR-0020 / P1-3 — RedisHealthMonitor tests.
 *
 * Strategi:
 *   - `evaluateRedisHealth` testes pure uten DI.
 *   - `RedisHealthMonitor.tick()` testes med stub-Redis og stub-AlertChannel
 *     for å verifisere alarm-overganger.
 *   - Klokke injiseres slik at vi kan kjøre tidsbasert overgang uten å vente.
 *
 * Invariants som testes:
 *   - Ping-suksess fra start → status="ok", ingen alarmer.
 *   - 30s+ ping-failure → "down" + outage-alarm publisert ÉN gang.
 *   - Ping ok igjen → "ok" + recovered-alarm publisert ÉN gang.
 *   - Ping ok men persist-failures > terskel → "degraded" + degraded-alarm.
 *   - Caller kaster aldri (alle channel-throws fanget).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetRedisMetricsForTests,
  recordRedisFailure,
  recordRedisSuccess,
} from "../RedisHealthMetrics.js";
import {
  RedisHealthMonitor,
  evaluateRedisHealth,
  type RedisHealthState,
} from "../RedisHealthMonitor.js";
import type { AlertChannel, RoomAlert } from "../RoomAlertingService.js";

// ── Helpers ────────────────────────────────────────────────────────────────

class CapturingChannel implements AlertChannel {
  public sent: RoomAlert[] = [];
  public shouldThrow = false;

  constructor(public readonly name: string = "capture") {}

  async send(alert: RoomAlert): Promise<boolean> {
    if (this.shouldThrow) throw new Error("channel-crash");
    this.sent.push(alert);
    return true;
  }
}

/**
 * Stub Redis for ping-tests. Vi bruker bare `.ping()` så vi simulerer kun
 * det som monitor-en trenger.
 */
interface StubRedisOptions {
  pingResponse?: "PONG" | "WRONG" | "throws" | "hangs";
}

function makeStubRedis(opts: StubRedisOptions = {}) {
  let pingResponse: NonNullable<StubRedisOptions["pingResponse"]> =
    opts.pingResponse ?? "PONG";

  const stub = {
    setPingResponse(r: NonNullable<StubRedisOptions["pingResponse"]>) {
      pingResponse = r;
    },
    async ping(): Promise<string> {
      if (pingResponse === "throws") {
        throw new Error("ECONNREFUSED");
      }
      if (pingResponse === "hangs") {
        // Never resolves — test code uses a tight ping-timeout to verify timeout path.
        return await new Promise<string>(() => {
          /* noop */
        });
      }
      if (pingResponse === "WRONG") return "WRONG";
      return "PONG";
    },
  };
  return stub;
}

class FixedClock {
  constructor(private nowMs: number) {}
  now = (): number => this.nowMs;
  advance(ms: number): void {
    this.nowMs += ms;
  }
}

test.beforeEach(() => {
  __resetRedisMetricsForTests();
});

// ── Pure evaluateRedisHealth ───────────────────────────────────────────────

test("evaluateRedisHealth: ok state when ping succeeds and no failures", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 10_000,
      pingOk: true,
      lastSuccessfulPingMs: 9_000,
      consecutivePingFailures: 0,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: null,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "ok",
  );

  assert.equal(result.status, "ok");
  assert.equal(result.outageStartedAtMs, null);
  assert.equal(result.shouldPublishOutage, false);
  assert.equal(result.shouldPublishRecovered, false);
});

test("evaluateRedisHealth: degraded on first ping failure (under threshold)", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 10_000,
      pingOk: false,
      lastSuccessfulPingMs: 9_000,
      consecutivePingFailures: 1,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: null,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "ok",
  );

  // First failure → outage starts now, but not enough time elapsed → degraded.
  assert.equal(result.status, "degraded");
  assert.equal(result.outageStartedAtMs, 10_000);
  assert.equal(result.shouldPublishDegraded, true);
  assert.equal(result.shouldPublishOutage, false);
});

test("evaluateRedisHealth: down + outage-alarm after threshold", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 50_000,
      pingOk: false,
      lastSuccessfulPingMs: 9_000,
      consecutivePingFailures: 8,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: 10_000, // 40s ago
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "degraded",
  );

  assert.equal(result.status, "down");
  assert.equal(result.outageStartedAtMs, 10_000);
  assert.equal(result.shouldPublishOutage, true);
  assert.match(result.reason, /40s/);
});

test("evaluateRedisHealth: recovered alarm on down → ok transition", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 60_000,
      pingOk: true,
      lastSuccessfulPingMs: 60_000,
      consecutivePingFailures: 0,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: 10_000,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "down",
  );

  assert.equal(result.status, "ok");
  assert.equal(result.outageStartedAtMs, null);
  assert.equal(result.shouldPublishRecovered, true);
  assert.equal(result.shouldPublishOutage, false);
});

test("evaluateRedisHealth: recovered alarm on degraded → ok transition", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 12_000,
      pingOk: true,
      lastSuccessfulPingMs: 12_000,
      consecutivePingFailures: 0,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: 10_000,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "degraded",
  );

  assert.equal(result.status, "ok");
  assert.equal(result.shouldPublishRecovered, true);
});

test("evaluateRedisHealth: degraded when ping ok but persist failures exceed threshold", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 10_000,
      pingOk: true,
      lastSuccessfulPingMs: 10_000,
      consecutivePingFailures: 0,
      consecutivePersistFailures: 6,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: null,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "ok",
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.shouldPublishDegraded, true);
  assert.match(result.reason, /Persist operations have 6/);
});

test("evaluateRedisHealth: degraded when ping ok but lock-acquire failures exceed threshold", () => {
  const result = evaluateRedisHealth(
    {
      nowMs: 10_000,
      pingOk: true,
      lastSuccessfulPingMs: 10_000,
      consecutivePingFailures: 0,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 7,
      outageStartedAtMs: null,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "ok",
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.shouldPublishDegraded, true);
  assert.match(result.reason, /Lock acquires have 7/);
});

test("evaluateRedisHealth: no duplicate alarm if already in same state", () => {
  // Already down → still down. shouldPublishOutage=false (no transition).
  const result = evaluateRedisHealth(
    {
      nowMs: 100_000,
      pingOk: false,
      lastSuccessfulPingMs: 9_000,
      consecutivePingFailures: 20,
      consecutivePersistFailures: 0,
      consecutiveLockAcquireFailures: 0,
      outageStartedAtMs: 10_000,
      outageThresholdMs: 30_000,
      degradedPersistFailureThreshold: 5,
    },
    "down",
  );

  assert.equal(result.status, "down");
  assert.equal(result.shouldPublishOutage, false);
  assert.equal(result.shouldPublishRecovered, false);
});

// ── RedisHealthMonitor.tick: integration ────────────────────────────────

test("monitor.tick: ok state from healthy ping", async () => {
  const redis = makeStubRedis({ pingResponse: "PONG" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  const snapshot = await monitor.tick();

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.consecutivePingFailures, 0);
  assert.equal(channel.sent.length, 0);
});

test("monitor.tick: triggers outage alarm after sustained failure", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // First tick at t=1000 → starts outage marker, status="degraded".
  await monitor.tick();
  assert.equal(channel.sent.length, 1, "expected degraded alarm at first failure");
  assert.equal(channel.sent[0].severity, "warning");
  assert.equal(channel.sent[0].scenarioKey, "global::redis_degraded");

  // Advance 35s → tick → outage threshold breached.
  clock.advance(35_000);
  await monitor.tick();

  assert.equal(channel.sent.length, 2, "expected outage alarm after 35s");
  assert.equal(channel.sent[1].severity, "critical");
  assert.equal(channel.sent[1].scenarioKey, "global::redis_outage");
  assert.match(channel.sent[1].message, /OUTAGE/);
});

test("monitor.tick: deduplicates outage alarm during sustained failure", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // Force into "down" state.
  await monitor.tick();
  clock.advance(35_000);
  await monitor.tick();
  const alarmsAfterOutage = channel.sent.length;

  // Stay in "down" — no new alarm should fire.
  clock.advance(10_000);
  await monitor.tick();
  clock.advance(10_000);
  await monitor.tick();

  assert.equal(channel.sent.length, alarmsAfterOutage, "no duplicate outage alarms while down");
});

test("monitor.tick: triggers recovered alarm when ping returns to ok", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // Drive into outage.
  await monitor.tick();
  clock.advance(35_000);
  await monitor.tick();
  const sentBefore = channel.sent.length;

  // Recover.
  redis.setPingResponse("PONG");
  clock.advance(5_000);
  const snapshot = await monitor.tick();

  assert.equal(snapshot.status, "ok");
  assert.equal(channel.sent.length, sentBefore + 1, "expected one recovered alarm");
  const recoveredAlert = channel.sent[channel.sent.length - 1];
  assert.equal(recoveredAlert.scenarioKey, "global::redis_recovered");
  assert.equal(recoveredAlert.severity, "info");
  assert.match(recoveredAlert.message, /RECOVERED/);
});

test("monitor.tick: degraded alarm on persist-failure threshold", async () => {
  const redis = makeStubRedis({ pingResponse: "PONG" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    degradedPersistFailureThreshold: 5,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // Simulate 6 persist-failures via the metrics module (no Redis touched).
  for (let i = 0; i < 6; i++) {
    recordRedisFailure("persist", new Error(`fail ${i}`), clock.now());
  }

  await monitor.tick();

  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].scenarioKey, "global::redis_degraded");
  assert.equal(channel.sent[0].severity, "warning");
  assert.match(channel.sent[0].message, /Persist operations/);
});

test("monitor.tick: persist-success resets counter and clears degraded", async () => {
  const redis = makeStubRedis({ pingResponse: "PONG" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    degradedPersistFailureThreshold: 5,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // Build up to degraded.
  for (let i = 0; i < 6; i++) {
    recordRedisFailure("persist", new Error(`fail ${i}`), clock.now());
  }
  await monitor.tick();
  assert.equal(channel.sent.length, 1);

  // Persist succeeds → counter resets.
  recordRedisSuccess("persist", clock.now());
  clock.advance(5_000);
  const snapshot = await monitor.tick();

  assert.equal(snapshot.status, "ok");
  // Recovered alarm should fire.
  assert.equal(channel.sent.length, 2);
  assert.equal(channel.sent[1].scenarioKey, "global::redis_recovered");
});

test("monitor.tick: ping timeout is handled as failure", async () => {
  const redis = makeStubRedis({ pingResponse: "hangs" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 50,
    now: clock.now,
  });

  // Tick should NOT hang — race against timeout returns failure.
  const snapshot = await monitor.tick();
  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.consecutivePingFailures, 1);
});

test("monitor.tick: never throws even when channel.send throws", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const channel = new CapturingChannel();
  channel.shouldThrow = true;
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // First tick should publish degraded alarm — channel throws but tick must
  // still complete.
  await monitor.tick();
  // Verify by checking that snapshot has correct state even when channel
  // failed.
  const snapshot = monitor.getStatus();
  assert.equal(snapshot.status, "degraded");
});

test("monitor.tick: ping unexpected reply (not PONG) counts as failure", async () => {
  const redis = makeStubRedis({ pingResponse: "WRONG" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  const snapshot = await monitor.tick();
  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.consecutivePingFailures, 1);
});

test("monitor.start/stop is idempotent", () => {
  const redis = makeStubRedis({ pingResponse: "PONG" });
  const channel = new CapturingChannel();
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 60_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
  });

  monitor.start();
  monitor.start(); // second call no-op
  monitor.stop();
  monitor.stop(); // second call no-op
  // No assertion needed — just verify no throw.
});

test("monitor.getStatus snapshot includes outage duration", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  await monitor.tick();
  clock.advance(45_000);
  await monitor.tick();

  const snapshot = monitor.getStatus();
  assert.equal(snapshot.status, "down");
  assert.ok(snapshot.outageDurationMs >= 45_000);
  assert.ok(snapshot.totalPingFailures >= 2);
});

// ── State transition: degraded → ok via persist recovery (no outage) ──

test("monitor: stays in degraded when persist-failures continue (no progress to down)", async () => {
  const redis = makeStubRedis({ pingResponse: "PONG" });
  const channel = new CapturingChannel();
  const clock = new FixedClock(1_000);
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [channel],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    degradedPersistFailureThreshold: 5,
    pingTimeoutMs: 100,
    now: clock.now,
  });

  // Build up to degraded.
  for (let i = 0; i < 6; i++) {
    recordRedisFailure("persist", new Error(`fail ${i}`), clock.now());
  }
  await monitor.tick();
  const sentAtFirst = channel.sent.length;
  assert.equal(sentAtFirst, 1, "expected exactly one degraded alarm");

  // Continue without recovery — stays degraded but no new alarm.
  clock.advance(60_000);
  recordRedisFailure("persist", new Error("fail 7"), clock.now());
  await monitor.tick();

  assert.equal(channel.sent.length, sentAtFirst, "no new alarm during sustained degradation");
  assert.equal(monitor.getStatus().status, "degraded");
});

// ── Multiple channels deliver in parallel ──────────────────────────────────

test("monitor: publishes to all configured channels", async () => {
  const redis = makeStubRedis({ pingResponse: "throws" });
  const slack = new CapturingChannel("slack");
  const pd = new CapturingChannel("pagerduty");
  const monitor = new RedisHealthMonitor({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    channels: [slack, pd],
    intervalMs: 5_000,
    outageThresholdMs: 30_000,
    pingTimeoutMs: 100,
    now: () => 1_000,
  });

  await monitor.tick();
  // Initial failure at first tick → degraded → both channels get the alarm.
  assert.equal(slack.sent.length, 1);
  assert.equal(pd.sent.length, 1);
});
