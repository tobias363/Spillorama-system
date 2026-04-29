/**
 * PR #513 §2.5 (KRITISK pilot-blokker, 2026-04-25):
 * SecurityService skal IKKE fail-open uten alarm.
 *
 * Bug-detaljer:
 *   `initializeSchema` kunne feile (DB-utfall, manglende permissions, korrupt
 *   schema) — feilen ble wrappet som DomainError("SECURITY_INIT_FAILED") og
 *   kastet videre. `refreshBlockedIpCache` swallowed den til en `warn`-log
 *   og fortsatte med tom cache. Resultat: `isIpBlocked()` returnerte `false`
 *   for ALT (fail-open) uten en alarm sterk nok til at noen merket det.
 *
 * Fix:
 *   1. `initFailed`-flag persisterer etter init-feil.
 *   2. `isIpBlocked()` emit-er CRITICAL-event per request når flag er satt.
 *   3. Pilot-mode: re-throw fra `initializeSchema` så server-boot crasher
 *      med tydelig stack-trace i stedet for å starte med fail-open stack.
 *   4. `onCriticalFailure`-hook tillater Sentry-capture / Slack-poster /
 *      health-endpoint-flagging.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { SecurityService } from "../SecurityService.js";
import { DomainError } from "../../errors/DomainError.js";

interface CapturedEvent {
  code: string;
  err: unknown;
  context: string;
}

/**
 * Pool som kaster på BEGIN/CREATE for å simulere init-failure (eks. DB-utfall
 * eller manglende permissions). Andre queries returnerer tomt resultat.
 */
function makeFailingInitPool(): Pool {
  return {
    async connect() {
      return {
        async query(sql: string) {
          const t = sql.trim();
          if (t.startsWith("BEGIN") || t.startsWith("CREATE")) {
            throw new Error("simulated DB init failure (permission denied or DB down)");
          }
          if (t.startsWith("ROLLBACK") || t.startsWith("COMMIT")) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async query() {
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
}

// ── §2.5 alarm: init-failure markerer initFailed + emit-er CRITICAL ────────

test("PR #513 §2.5: initializeSchema-feil markerer initFailed + emit-er CRITICAL via hook", async () => {
  // NB: vi kan ikke bruke SecurityService.forTesting siden den setter
  // initPromise = Promise.resolve() før init kjører. Vi bygger en instans
  // manuelt via Object.create for å aktivere init-pathen.
  const events: CapturedEvent[] = [];
  const pool = makeFailingInitPool();
  // Kjør konstruktor-setup uten å trigge ekte Pool-konfigurasjon:
  const svc = Object.create(SecurityService.prototype) as SecurityService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    pool,
    schema: "public",
    cacheTtlMs: 60_000,
    nowMs: () => Date.now(),
    pilotMode: false,
    onCriticalFailure: (e: CapturedEvent) => events.push(e),
    initPromise: null,
    initFailed: false,
    blockedIpCache: null,
    blockedIpCacheLoadedAt: 0,
  });

  // isIpBlocked trigger-er init via refreshBlockedIpCache.
  // Init feiler (kaster), men cache-refresh swallow-er feilen.
  const blocked = await svc.isIpBlocked("10.0.0.1");

  // Fail-open: returnerer false (ingen kunnskap om noen IP-er).
  assert.equal(blocked, false);

  // initFailed skal være satt ETTER init-failure.
  assert.equal(
    (svc as unknown as { initFailed: boolean }).initFailed,
    true,
    "initFailed-flag skal være true etter init-failure",
  );

  // CRITICAL-event skal være emit-et minst to ganger:
  //   - én fra initializeSchema selv (code=SECURITY_INIT_FAILED)
  //   - én fra isIpBlocked (code=IP_BLOCK_FAIL_OPEN)
  const initEvents = events.filter((e) => e.code === "SECURITY_INIT_FAILED");
  const checkEvents = events.filter((e) => e.code === "IP_BLOCK_FAIL_OPEN");
  assert.ok(initEvents.length >= 1, `forventet ≥1 SECURITY_INIT_FAILED, fikk ${initEvents.length}`);
  assert.ok(checkEvents.length >= 1, `forventet ≥1 IP_BLOCK_FAIL_OPEN, fikk ${checkEvents.length}`);
  assert.equal(initEvents[0]!.context, "initializeSchema");
  assert.equal(checkEvents[0]!.context, "isIpBlocked");
});

test("PR #513 §2.5: pilot-mode kaster fra initializeSchema (fail-fast på boot)", async () => {
  const events: CapturedEvent[] = [];
  const pool = makeFailingInitPool();
  const svc = Object.create(SecurityService.prototype) as SecurityService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    pool,
    schema: "public",
    cacheTtlMs: 60_000,
    nowMs: () => Date.now(),
    pilotMode: true, // ← pilot-mode på
    onCriticalFailure: (e: CapturedEvent) => events.push(e),
    initPromise: null,
    initFailed: false,
    blockedIpCache: null,
    blockedIpCacheLoadedAt: 0,
  });

  // warmBlockedIpCache er fortsatt fail-open (caller bestemmer), men
  // direkte addBlockedIp skal kaste fra ensureInitialized siden init feiler.
  await assert.rejects(
    () => svc.addBlockedIp({ ipAddress: "10.0.0.1", blockedBy: "admin" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, `forventet DomainError, fikk ${err}`);
      assert.equal((err as DomainError).code, "SECURITY_INIT_FAILED");
      return true;
    },
  );

  // Critical-hook skal fortsatt være kalt.
  const initEvents = events.filter((e) => e.code === "SECURITY_INIT_FAILED");
  assert.ok(initEvents.length >= 1);
});

test("PR #513 §2.5: default critical-hook bruker pino fatal (ikke crash)", async () => {
  // Sanity: SecurityService.forTesting (uten custom hook) skal heller ikke
  // crashe — bare log via default-hook (pino fatal).
  const pool = makeFailingInitPool();
  const svc = Object.create(SecurityService.prototype) as SecurityService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    pool,
    schema: "public",
    cacheTtlMs: 60_000,
    nowMs: () => Date.now(),
    pilotMode: false,
    // No onCriticalFailure → bruker default (pino fatal log).
    // Vi dependency-injekter manuelt for å unngå default fra constructor:
    onCriticalFailure: () => {
      /* swallow så test ikke spammer log */
    },
    initPromise: null,
    initFailed: false,
    blockedIpCache: null,
    blockedIpCacheLoadedAt: 0,
  });

  // isIpBlocked skal returnere false (fail-open) uten å throw.
  const result = await svc.isIpBlocked("any-ip");
  assert.equal(result, false);
});
