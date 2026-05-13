/**
 * Unit-tester for structured-logger (Fase 2A — 2026-05-05).
 *
 * Fokus: side-effekter (counter-increment, Sentry-breadcrumb) trigges
 * korrekt når errorCode er satt vs. utelatt. Test stub-er pino direkte for
 * å verifisere log-payload-shape uten å mounte hele app-en.
 *
 * Note: vi bruker et fake mock for Sentry-handle slik at testene ikke
 * forsøker å pinge ekte DSN. Sentry er disabled by default i dev, så
 * captureError er allerede no-op — men vi installerer mock for at vi kan
 * verifisere at høy-severity faktisk trigger captureException.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  __installMockSentryForTests,
  __resetSentryForTests,
} from "../sentry.js";
import {
  __resetCountersForTests,
  getErrorRate,
} from "../errorMetrics.js";
import { logError, logInfo, logWarn } from "../structuredLogger.js";

// Mock Sentry-handle som fanger alle calls for assertions.
function makeMockSentry(): {
  capturedExceptions: Array<{ err: unknown; tags?: Record<string, string> }>;
  breadcrumbs: Array<{ category: string; level?: string }>;
  install: () => void;
} {
  const capturedExceptions: Array<{ err: unknown; tags?: Record<string, string> }> = [];
  const breadcrumbs: Array<{ category: string; level?: string }> = [];

  const install = () => {
    __installMockSentryForTests({
      captureException: (err, hint) => {
        capturedExceptions.push({ err, tags: hint?.tags });
      },
      addBreadcrumb: (b) => {
        breadcrumbs.push({ category: b.category, level: b.level });
      },
      setTag: () => {},
      setUser: () => {},
      withScope: () => {},
      flush: async () => true,
    });
  };

  return { capturedExceptions, breadcrumbs, install };
}

test.beforeEach(() => {
  __resetCountersForTests();
  __resetSentryForTests();
});

test("logError: increment-counter når errorCode satt", () => {
  logError(
    {
      module: "TestService",
      errorCode: "BIN-RKT-002",
      roomCode: "ROCKET-1",
    },
    "tick failed",
    new Error("boom"),
  );

  const rate = getErrorRate("BIN-RKT-002");
  assert.equal(rate?.lifetime, 1);
});

test("logError: ingen counter-increment når errorCode utelatt", () => {
  logError({ module: "TestService" }, "boom");

  // Ingen counter-state for noen kode.
  // (Vi tester via getErrorRate som returnerer null/0 hvis aldri seen.)
  const rate = getErrorRate("BIN-RKT-002");
  assert.equal(rate?.lifetime, 0); // 0 fra registry-default, ikke 1
});

test("logError: Sentry breadcrumb + capture for HIGH severity", () => {
  const sentry = makeMockSentry();
  sentry.install();

  logError(
    {
      module: "TestService",
      errorCode: "BIN-RKT-002", // HIGH severity
      roomCode: "ROCKET-1",
    },
    "tick failed",
    new Error("engine crash"),
  );

  assert.equal(sentry.breadcrumbs.length, 1);
  assert.equal(sentry.breadcrumbs[0].category, "error.BIN-RKT-002");
  assert.equal(sentry.breadcrumbs[0].level, "error");

  assert.equal(sentry.capturedExceptions.length, 1);
  assert.equal(sentry.capturedExceptions[0].tags?.errorCode, "BIN-RKT-002");
  assert.equal(sentry.capturedExceptions[0].tags?.severity, "HIGH");
});

test("logError: Sentry capture for CRITICAL severity", () => {
  const sentry = makeMockSentry();
  sentry.install();

  logError(
    {
      module: "TestService",
      errorCode: "BIN-RUM-002", // CRITICAL
    },
    "host not in players[]",
  );

  assert.equal(sentry.capturedExceptions.length, 1);
  assert.equal(sentry.capturedExceptions[0].tags?.severity, "CRITICAL");
});

test("logError: ingen Sentry capture for MEDIUM severity", () => {
  const sentry = makeMockSentry();
  sentry.install();

  logError(
    {
      module: "TestService",
      errorCode: "BIN-RKT-001", // MEDIUM
    },
    "host fallback applied",
  );

  // Breadcrumb skal sendes, men captureException skal IKKE.
  assert.equal(sentry.breadcrumbs.length, 1);
  assert.equal(sentry.capturedExceptions.length, 0);
});

test("logWarn: increment-counter men ingen Sentry-capture (selv på HIGH severity)", () => {
  const sentry = makeMockSentry();
  sentry.install();

  logWarn(
    {
      module: "TestService",
      errorCode: "BIN-RKT-002", // HIGH severity
    },
    "warn-level event",
  );

  const rate = getErrorRate("BIN-RKT-002");
  assert.equal(rate?.lifetime, 1);

  // Breadcrumb skal sendes, captureException skal IKKE — fordi det er warn.
  assert.equal(sentry.breadcrumbs.length, 1);
  assert.equal(sentry.breadcrumbs[0].level, "warning");
  assert.equal(sentry.capturedExceptions.length, 0);
});

test("logInfo: increment-counter, ingen Sentry-side-effekt", () => {
  const sentry = makeMockSentry();
  sentry.install();

  logInfo(
    {
      module: "TestService",
      errorCode: "BIN-RKT-001",
    },
    "host fallback applied",
  );

  const rate = getErrorRate("BIN-RKT-001");
  assert.equal(rate?.lifetime, 1);

  assert.equal(sentry.breadcrumbs.length, 0);
  assert.equal(sentry.capturedExceptions.length, 0);
});

test("logError: ukjent errorCode logger med severity=UNKNOWN", () => {
  // Hvis noen sender en string som ikke er i registry (typisk migrasjon-bug)
  // skal vi fortsatt logge — bare med UNKNOWN-merking. Increment-counter
  // brukes også slik at vi kan oppdage "ghost codes" i admin-endpoint.
  logError(
    {
      module: "TestService",
      errorCode: "BIN-XYZ-999" as never, // bypass type-check som runtime ville gjort
    },
    "ghost code",
  );

  const rate = getErrorRate("BIN-XYZ-999");
  assert.equal(rate?.lifetime, 1);
  assert.equal(rate?.severity, "UNKNOWN");
});
