/**
 * BIN-815 / R8 — Unit tests for RoomAlertingService.
 *
 * Strategi:
 *   - Pure compute (`evaluateAlerts`) testes direkte uten DI.
 *   - `RoomAlertingService.tick()` kjøres med stubbede porter (HealthCheckPort,
 *     AlertChannel, AlertLogWriter, WalletReconciliationStatusPort) for å
 *     verifisere polling, alerting, de-dup og fail-soft-oppførsel.
 *   - Hash-chain-helper (`computeAlertEntryHash`) verifiseres for determinisme.
 *   - Slack/PagerDuty-channels stubbes via `fetch`-injection.
 *
 * Ingen DB, ingen ekte HTTP, ingen klokke. Klokken injiseres i hver test.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AlertDedupTracker,
  ConsoleAlertChannel,
  NoopAlertLogWriter,
  PagerDutyAlertChannel,
  RoomAlertingService,
  SlackAlertChannel,
  computeAlertEntryHash,
  evaluateAlerts,
  type AlertChannel,
  type AlertLogWriter,
  type AlertEvaluationContext,
  type GameSlug,
  type HealthCheckPort,
  type HealthSnapshot,
  type RoomAlert,
  type WalletReconciliationStatusPort,
} from "../RoomAlertingService.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    status: "ok",
    lastDrawAge: null,
    connectedClients: 0,
    currentPhase: "idle",
    currentPosition: null,
    instanceId: "test-instance",
    redisHealthy: true,
    dbHealthy: true,
    nextScheduledStart: null,
    withinOpeningHours: true,
    p95SocketRoundtripMs: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function defaultEvalCtx(
  partial: Partial<AlertEvaluationContext> = {},
): AlertEvaluationContext {
  return {
    rooms: [],
    walletReconciliationOpenCount: 0,
    nowMs: 1_000_000,
    persistentDownThresholdMs: 30_000,
    drawStaleThresholdMs: 20_000,
    ...partial,
  };
}

class StubHealthPort implements HealthCheckPort {
  private readonly responses = new Map<string, HealthSnapshot | null>();
  public callLog: Array<{ game: GameSlug; hallId: string }> = [];

  setResponse(game: GameSlug, hallId: string, snap: HealthSnapshot | null): void {
    this.responses.set(`${game}:${hallId}`, snap);
  }

  async fetchHealth(game: GameSlug, hallId: string): Promise<HealthSnapshot | null> {
    this.callLog.push({ game, hallId });
    const key = `${game}:${hallId}`;
    return this.responses.has(key) ? this.responses.get(key) ?? null : null;
  }
}

class CapturingChannel implements AlertChannel {
  public sent: RoomAlert[] = [];
  public shouldFail = false;
  public throws = false;

  constructor(public readonly name: string = "capture") {}

  async send(alert: RoomAlert): Promise<boolean> {
    if (this.throws) throw new Error("simulated channel crash");
    if (this.shouldFail) return false;
    this.sent.push(alert);
    return true;
  }
}

class CapturingLogWriter implements AlertLogWriter {
  public writes: Array<{ alert: RoomAlert; channels: string[]; nowMs: number }> = [];
  public shouldFail = false;
  public hydrateRows: Array<{ scenarioKey: string; sentAtMs: number }> = [];

  async write(alert: RoomAlert, channels: string[], nowMs: number): Promise<boolean> {
    if (this.shouldFail) return false;
    this.writes.push({ alert, channels, nowMs });
    return true;
  }

  async loadRecentDedupState(): Promise<Array<{ scenarioKey: string; sentAtMs: number }>> {
    return this.hydrateRows;
  }
}

class StubReconcilePort implements WalletReconciliationStatusPort {
  public openAlerts = 0;
  public throws = false;

  async countOpenAlerts(): Promise<number> {
    if (this.throws) throw new Error("recon down");
    return this.openAlerts;
  }
}

// ── evaluateAlerts: scenarier ──────────────────────────────────────────────

test("evaluateAlerts: tom input gir ingen alerts", () => {
  const result = evaluateAlerts(defaultEvalCtx());
  assert.equal(result.length, 0);
});

test("evaluateAlerts: status=down i kortere tid enn terskel skal ikke trigge", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({ status: "down" }),
          downSinceMs: 1_000_000 - 5_000, // 5 sek siden — under 30s terskel
        },
      ],
    }),
  );
  assert.equal(result.length, 0);
});

test("evaluateAlerts: status=down vedvarende > 30s trigger status_down (critical)", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({ status: "down", currentPhase: "idle" }),
          downSinceMs: 1_000_000 - 31_000,
        },
      ],
    }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].scenario, "status_down");
  assert.equal(result[0].severity, "critical");
  assert.equal(result[0].game, "spill1");
  assert.equal(result[0].hallId, "hallA");
  assert.equal(result[0].scenarioKey, "spill1:hallA:status_down");
  assert.match(result[0].message, /31s/);
});

test("evaluateAlerts: lastDrawAge over draw-stale-grense triggrer draw_stale", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({
            status: "ok",
            currentPhase: "running",
            lastDrawAge: 25, // 25s — over 20s terskel
          }),
          downSinceMs: null,
        },
      ],
      drawStaleThresholdMs: 20_000,
    }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].scenario, "draw_stale");
  assert.equal(result[0].severity, "critical");
  assert.equal(result[0].details.lastDrawAgeSec, 25);
});

test("evaluateAlerts: draw_stale skal IKKE trigge utenfor running-fase", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({
            status: "ok",
            currentPhase: "idle",
            lastDrawAge: 999,
          }),
          downSinceMs: null,
        },
      ],
    }),
  );
  assert.equal(result.length, 0);
});

test("evaluateAlerts: redis_unhealthy + aktiv runde → critical", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill2",
          hallId: "hallA",
          snapshot: makeSnapshot({
            redisHealthy: false,
            currentPhase: "running",
            connectedClients: 5,
          }),
          downSinceMs: null,
        },
      ],
    }),
  );
  // Selv om status="ok" (default) — redis-flag overstyrer
  const redisAlert = result.find((a) => a.scenario === "redis_unhealthy");
  assert.ok(redisAlert);
  assert.equal(redisAlert.severity, "critical");
});

test("evaluateAlerts: redis_unhealthy uten aktiv runde → warning", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({
            redisHealthy: false,
            currentPhase: "idle",
            connectedClients: 0,
          }),
          downSinceMs: null,
        },
      ],
    }),
  );
  const redisAlert = result.find((a) => a.scenario === "redis_unhealthy");
  assert.ok(redisAlert);
  assert.equal(redisAlert.severity, "warning");
});

test("evaluateAlerts: db_unhealthy → alltid critical", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: makeSnapshot({ dbHealthy: false }),
          downSinceMs: null,
        },
      ],
    }),
  );
  const dbAlert = result.find((a) => a.scenario === "db_unhealthy");
  assert.ok(dbAlert);
  assert.equal(dbAlert.severity, "critical");
});

test("evaluateAlerts: wallet_reconciliation_mismatch er global og kritisk", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({ walletReconciliationOpenCount: 3 }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].scenario, "wallet_reconciliation_mismatch");
  assert.equal(result[0].severity, "critical");
  assert.equal(result[0].game, "global");
  assert.equal(result[0].hallId, null);
  assert.equal(result[0].details.openAlertCount, 3);
});

test("evaluateAlerts: snapshot=null skal IKKE alarmere (fail-soft)", () => {
  const result = evaluateAlerts(
    defaultEvalCtx({
      rooms: [
        {
          game: "spill1",
          hallId: "hallA",
          snapshot: null,
          downSinceMs: null,
        },
      ],
    }),
  );
  assert.equal(result.length, 0);
});

// ── AlertDedupTracker ──────────────────────────────────────────────────────

test("AlertDedupTracker: nytt scenario → shouldSend=true", () => {
  const tracker = new AlertDedupTracker();
  assert.equal(tracker.shouldSend("k1", 1000, 60_000), true);
});

test("AlertDedupTracker: markert som sendt innen vinduet → shouldSend=false", () => {
  const tracker = new AlertDedupTracker();
  tracker.markSent("k1", 1000);
  assert.equal(tracker.shouldSend("k1", 30_000, 60_000), false);
});

test("AlertDedupTracker: utenfor vinduet → shouldSend=true igjen", () => {
  const tracker = new AlertDedupTracker();
  tracker.markSent("k1", 1000);
  assert.equal(tracker.shouldSend("k1", 70_000, 60_000), true);
});

test("AlertDedupTracker: hydrate fra DB", () => {
  const tracker = new AlertDedupTracker();
  tracker.hydrate([
    { scenarioKey: "k1", sentAtMs: 5_000 },
    { scenarioKey: "k2", sentAtMs: 8_000 },
  ]);
  assert.equal(tracker.size(), 2);
  assert.equal(tracker.shouldSend("k1", 10_000, 60_000), false);
});

test("AlertDedupTracker: gc dropper gamle entries", () => {
  const tracker = new AlertDedupTracker();
  tracker.markSent("k1", 1_000);
  tracker.markSent("k2", 1_000_000);
  tracker.gc(2_000_000, 60_000); // cutoff = 2_000_000 - 120_000 = 1_880_000
  assert.equal(tracker.size(), 0);

  tracker.markSent("k3", 1_950_000);
  tracker.gc(2_000_000, 60_000);
  assert.equal(tracker.size(), 1);
});

// ── computeAlertEntryHash ──────────────────────────────────────────────────

test("computeAlertEntryHash: deterministisk og 64 hex tegn", () => {
  const payload = {
    scenarioKey: "spill1:hallA:status_down",
    game: "spill1",
    hallId: "hallA" as string | null,
    scenario: "status_down",
    severity: "critical",
    message: "test",
    details: { foo: 1, bar: "baz" },
    channels: ["slack"],
    createdAt: "2026-12-15T10:00:00.000Z",
  };
  const h1 = computeAlertEntryHash("0".repeat(64), payload);
  const h2 = computeAlertEntryHash("0".repeat(64), payload);
  assert.equal(h1, h2, "samme input → samme output");
  assert.equal(h1.length, 64);
  assert.match(h1, /^[a-f0-9]{64}$/);
});

test("computeAlertEntryHash: ulik prev_hash → ulik output", () => {
  const payload = {
    scenarioKey: "k",
    game: "spill1",
    hallId: null,
    scenario: "status_down",
    severity: "critical",
    message: "m",
    details: {},
    channels: [],
    createdAt: "2026-12-15T10:00:00.000Z",
  };
  const h1 = computeAlertEntryHash("0".repeat(64), payload);
  const h2 = computeAlertEntryHash("a".repeat(64), payload);
  assert.notEqual(h1, h2);
});

test("computeAlertEntryHash: kanal-rekkefølge er kanonisk (sortert)", () => {
  const base = {
    scenarioKey: "k",
    game: "spill1",
    hallId: null,
    scenario: "status_down",
    severity: "critical",
    message: "m",
    details: {},
    createdAt: "2026-12-15T10:00:00.000Z",
  };
  const h1 = computeAlertEntryHash("0".repeat(64), {
    ...base,
    channels: ["slack", "pagerduty"],
  });
  const h2 = computeAlertEntryHash("0".repeat(64), {
    ...base,
    channels: ["pagerduty", "slack"],
  });
  assert.equal(h1, h2, "channels sorteres før hash");
});

test("computeAlertEntryHash: details key-rekkefølge er kanonisk", () => {
  const base = {
    scenarioKey: "k",
    game: "spill1",
    hallId: null,
    scenario: "status_down",
    severity: "critical",
    message: "m",
    channels: [],
    createdAt: "2026-12-15T10:00:00.000Z",
  };
  const h1 = computeAlertEntryHash("0".repeat(64), {
    ...base,
    details: { foo: 1, bar: 2 },
  });
  const h2 = computeAlertEntryHash("0".repeat(64), {
    ...base,
    details: { bar: 2, foo: 1 },
  });
  assert.equal(h1, h2);
});

// ── RoomAlertingService.tick: integration ──────────────────────────────────

test("tick: fetcher health for alle (game, hall)-par i parallell", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot());
  port.setResponse("spill2", "hallA", makeSnapshot());
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: ["hallA"], spill3: [] },
    now: () => 1_000_000,
  });

  await service.tick();
  const fetched = port.callLog.map((c) => `${c.game}:${c.hallId}`).sort();
  assert.deepEqual(fetched, ["spill1:hallA", "spill2:hallA"]);
  assert.equal(channel.sent.length, 0, "no alerts when all snapshots are ok");
  assert.equal(log.writes.length, 0);
});

test("tick: persistent down (>30s) sender alert til kanal og persisterer", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();

  let now = 1_000_000;
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => now,
    persistentDownThresholdMs: 30_000,
  });

  await service.tick();
  assert.equal(channel.sent.length, 0, "ingen alert ved første observasjon");

  now += 31_000;
  const sent = await service.tick();
  assert.equal(sent, 1);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].scenario, "status_down");
  assert.equal(log.writes.length, 1);
  assert.deepEqual(log.writes[0].channels, ["capture"]);
});

test("tick: status flipper tilbake til ok → downSince tørkes, ingen alert", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  let now = 1_000_000;
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => now,
    persistentDownThresholdMs: 30_000,
  });

  await service.tick();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "ok" }));
  now += 35_000;
  const sent = await service.tick();
  assert.equal(sent, 0);
  assert.equal(channel.sent.length, 0);
  assert.equal(service.__getDownSinceMap().has("spill1:hallA"), false);
});

test("tick: de-dup undertrykker repetert alert innenfor vinduet", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  let now = 1_000_000;
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => now,
    persistentDownThresholdMs: 0,
    dedupMinutes: 15,
  });

  await service.tick();
  assert.equal(channel.sent.length, 1);

  now += 5 * 60 * 1000;
  await service.tick();
  assert.equal(channel.sent.length, 1, "deduped");

  now = 1_000_000 + 16 * 60 * 1000;
  await service.tick();
  assert.equal(channel.sent.length, 2);
});

test("tick: kanal-feil (returnerer false) regnes ikke som sent men persisteres", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const channel = new CapturingChannel();
  channel.shouldFail = true;
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
    persistentDownThresholdMs: 0,
  });

  const sent = await service.tick();
  assert.equal(sent, 0, "ingen kanal lyktes → ikke regnet som sendt");
  assert.equal(log.writes.length, 1, "men skrevet til audit-log uansett");
  assert.deepEqual(log.writes[0].channels, [], "tomt array når alle feilet");
});

test("tick: kanal som kaster må ikke crashe loopen", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const goodChannel = new CapturingChannel("good");
  const crashChannel = new CapturingChannel("crash");
  crashChannel.throws = true;
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [crashChannel, goodChannel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
    persistentDownThresholdMs: 0,
  });

  const sent = await service.tick();
  assert.equal(sent, 1, "good kanal lyktes selv om crash kastet");
  assert.equal(goodChannel.sent.length, 1);
  assert.equal(log.writes.length, 1);
  assert.deepEqual(log.writes[0].channels, ["good"]);
});

test("tick: healthCheck-feil rapporteres ikke som alert (fail-soft)", async () => {
  const port: HealthCheckPort = {
    async fetchHealth() {
      throw new Error("network down");
    },
  };
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
  });

  const sent = await service.tick();
  assert.equal(sent, 0);
  assert.equal(channel.sent.length, 0);
  assert.equal(log.writes.length, 0);
});

test("tick: walletReconciliation feil skal ikke krasje tick", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot());
  const recon = new StubReconcilePort();
  recon.throws = true;
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: recon,
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
  });

  const sent = await service.tick();
  assert.equal(sent, 0, "ingen alerts, men tick-en fullførte");
  assert.equal(channel.sent.length, 0);
});

test("tick: tom channel-liste fall back til console", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const log = new CapturingLogWriter();
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
    persistentDownThresholdMs: 0,
  });

  const originalErr = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    await service.tick();
  } finally {
    console.error = originalErr;
  }

  assert.ok(calls.length > 0, "console.error skal kalles av ConsoleAlertChannel");
  assert.equal(log.writes.length, 1);
  assert.deepEqual(log.writes[0].channels, ["console"]);
});

test("tick: hydrate fra DB respekterer dedup-vindu", async () => {
  const port = new StubHealthPort();
  port.setResponse("spill1", "hallA", makeSnapshot({ status: "down" }));
  const channel = new CapturingChannel();
  const log = new CapturingLogWriter();
  log.hydrateRows = [
    { scenarioKey: "spill1:hallA:status_down", sentAtMs: 1_000_000 - 5 * 60 * 1000 },
  ];
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [channel],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => 1_000_000,
    persistentDownThresholdMs: 0,
    dedupMinutes: 15,
  });

  await service.hydrate();
  await service.tick();
  assert.equal(channel.sent.length, 0);
});

// ── SlackAlertChannel ──────────────────────────────────────────────────────

test("SlackAlertChannel: poster JSON-payload med severity-prefiks", async () => {
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const channel = new SlackAlertChannel({
    webhookUrl: "https://hooks.slack.com/services/X/Y/Z",
    fetchFn: fakeFetch,
  });
  const ok = await channel.send({
    game: "spill1",
    hallId: "hallA",
    scenario: "status_down",
    severity: "critical",
    message: "Hall ned",
    details: {},
    scenarioKey: "spill1:hallA:status_down",
  });
  assert.equal(ok, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://hooks.slack.com/services/X/Y/Z");
  assert.equal(captured[0].init?.method, "POST");
  const body = JSON.parse(String(captured[0].init?.body ?? "{}"));
  assert.match(body.text, /:rotating_light:/);
  assert.match(body.text, /critical/);
  assert.match(body.text, /spill1/);
  assert.match(body.text, /hallA/);
  assert.match(body.text, /status_down/);
  assert.match(body.text, /Hall ned/);
});

test("SlackAlertChannel: non-2xx returnerer false", async () => {
  const fakeFetch: typeof fetch = (async () => {
    return new Response("rate-limited", { status: 429 });
  }) as typeof fetch;
  const channel = new SlackAlertChannel({
    webhookUrl: "https://hooks.slack.com/x",
    fetchFn: fakeFetch,
  });
  const ok = await channel.send({
    game: "spill1",
    hallId: "hallA",
    scenario: "status_down",
    severity: "critical",
    message: "x",
    details: {},
    scenarioKey: "k",
  });
  assert.equal(ok, false);
});

test("SlackAlertChannel: nettverksfeil returnerer false (fail-soft)", async () => {
  const fakeFetch: typeof fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const channel = new SlackAlertChannel({
    webhookUrl: "https://hooks.slack.com/x",
    fetchFn: fakeFetch,
  });
  const ok = await channel.send({
    game: "spill1",
    hallId: "hallA",
    scenario: "status_down",
    severity: "critical",
    message: "x",
    details: {},
    scenarioKey: "k",
  });
  assert.equal(ok, false);
});

// ── PagerDutyAlertChannel ──────────────────────────────────────────────────

test("PagerDutyAlertChannel: bruker dedup_key + Events API v2 shape", async () => {
  const captured: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response("{}", { status: 202 });
  }) as typeof fetch;

  const channel = new PagerDutyAlertChannel({
    routingKey: "abc123",
    fetchFn: fakeFetch,
  });
  const ok = await channel.send({
    game: "spill2",
    hallId: "hallB",
    scenario: "draw_stale",
    severity: "critical",
    message: "stale draw",
    details: { lastDrawAgeSec: 25 },
    scenarioKey: "spill2:hallB:draw_stale",
  });
  assert.equal(ok, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://events.pagerduty.com/v2/enqueue");
  const body = captured[0].body as Record<string, unknown>;
  assert.equal(body.routing_key, "abc123");
  assert.equal(body.event_action, "trigger");
  assert.equal(body.dedup_key, "spill2:hallB:draw_stale");
  const payload = body.payload as Record<string, unknown>;
  assert.equal(payload.severity, "critical");
  assert.equal(payload.component, "spill2");
  assert.equal(payload.class, "draw_stale");
  const customDetails = payload.custom_details as Record<string, unknown>;
  assert.equal(customDetails.lastDrawAgeSec, 25);
  assert.equal(customDetails.message, "stale draw");
});

test("PagerDutyAlertChannel: non-2xx returnerer false", async () => {
  const fakeFetch: typeof fetch = (async () => {
    return new Response("forbidden", { status: 403 });
  }) as typeof fetch;
  const channel = new PagerDutyAlertChannel({
    routingKey: "x",
    fetchFn: fakeFetch,
  });
  const ok = await channel.send({
    game: "spill1",
    hallId: "hallA",
    scenario: "db_unhealthy",
    severity: "critical",
    message: "x",
    details: {},
    scenarioKey: "k",
  });
  assert.equal(ok, false);
});

// ── ConsoleAlertChannel ────────────────────────────────────────────────────

test("ConsoleAlertChannel: skriver til console.error og returnerer true", async () => {
  const channel = new ConsoleAlertChannel();
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  try {
    const ok = await channel.send({
      game: "spill1",
      hallId: "hallA",
      scenario: "status_down",
      severity: "critical",
      message: "Hall nede",
      details: { foo: 1 },
      scenarioKey: "k",
    });
    assert.equal(ok, true);
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /CRITICAL/);
  assert.match(String(calls[0][0]), /spill1/);
  assert.match(String(calls[0][0]), /hallA/);
  assert.match(String(calls[0][0]), /status_down/);
});

// ── Integration-flavored: simulate down > 30s ──────────────────────────────

test("integration: simulert down-status > 30s sender alert til alle kanaler", async () => {
  const port = new StubHealthPort();
  port.setResponse(
    "spill1",
    "hallA",
    makeSnapshot({ status: "ok", currentPhase: "running" }),
  );

  const slackCalls: unknown[] = [];
  const fakeFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
    slackCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const slack = new SlackAlertChannel({
    webhookUrl: "https://hooks.slack.com/x",
    fetchFn: fakeFetch,
  });
  const log = new CapturingLogWriter();
  let now = 1_000_000;
  const service = new RoomAlertingService({
    healthCheck: port,
    walletReconciliationStatus: { async countOpenAlerts() { return 0; } },
    alertLog: log,
    channels: [slack],
    hallIdsByGame: { spill1: ["hallA"], spill2: [], spill3: [] },
    now: () => now,
    persistentDownThresholdMs: 30_000,
  });

  await service.tick();
  assert.equal(slackCalls.length, 0);

  port.setResponse(
    "spill1",
    "hallA",
    makeSnapshot({ status: "down", currentPhase: "idle" }),
  );

  await service.tick();
  assert.equal(slackCalls.length, 0);

  now += 31_000;
  await service.tick();
  assert.equal(slackCalls.length, 1, "Slack mottar alert etter 31s");
  assert.equal(log.writes.length, 1);
  assert.equal(log.writes[0].alert.scenario, "status_down");
});

// ── Sanity: NoopAlertLogWriter ─────────────────────────────────────────────

test("NoopAlertLogWriter: returnerer true og tom liste", async () => {
  const noop = new NoopAlertLogWriter();
  assert.equal(await noop.write(), true);
  assert.deepEqual(await noop.loadRecentDedupState(), []);
});
