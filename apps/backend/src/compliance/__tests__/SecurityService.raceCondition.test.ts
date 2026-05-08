/**
 * BIN-827: race-condition-test for concurrent SecurityService.initializeSchema.
 *
 * Bakgrunn:
 *   Multi-instance backend-deploy (Render auto-scaling, K8s pod-scaling,
 *   docker-compose med replikaer) starter alle backend-instanser samtidig.
 *   Hver instans kjører `initializeSchema` ved første DB-kall. Selv om
 *   hver `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` er
 *   trygg isolert sett, er IF-NOT-EXISTS-sjekken IKKE atomisk mot
 *   concurrent inserts i pg-katalogen — to backender som begge ser
 *   "tabellen finnes ikke" prøver så å lage den, og den langsomste krasjer
 *   på `pg_type_typname_nsp_index`-collision eller tilsvarende
 *   katalog-unique-violation (`pg_class_relname_nsp_index`,
 *   `pg_index_indexrelid_index`).
 *
 *   Funnet av BIN-825 chaos-fix-agent 2026-05-08 under R2-test (sequential
 *   bring-up var workaround). Fix: pg_advisory_xact_lock rundt DDL.
 *
 * Hva testes:
 *   1. 5 parallelle `ensureInitialized()`-kall via 5 separate
 *      SecurityService-instanser deler samme pool → alle skal lykkes uten
 *      pg-katalog-collision.
 *   2. Idempotens: schema er bare opprettet én gang (én rad i pg_class
 *      per tabell, ikke 5 forsøk + 4 collisions).
 *
 * Skipper når `WALLET_PG_TEST_CONNECTION_STRING` ikke er satt — samme
 * mønster som GameLobbyAggregator.integration.test.ts og andre
 * integrasjons-tester i repo-en.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SecurityService } from "../SecurityService.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres race-condition-test";

function makeTestSchema(): string {
  return `bin827_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "BIN-827: 5 concurrent initializeSchema-kall serialiseres via advisory-lock (ingen pg-katalog-collision)",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 10 });
    const schema = makeTestSchema();
    try {
      // Spawn 5 SecurityService-instanser som deler poolen. Hver kaller
      // ensureInitialized via en operasjon som trigger init (listBlockedIps).
      // Uten advisory-lock vil minst én av dem krasje på katalog-collision
      // når CREATE TABLE / CREATE INDEX kjører simultant.
      //
      // Vi bygger instans manuelt via Object.create — `SecurityService.forTesting`
      // setter initPromise = Promise.resolve() som short-circuit-er init, og
      // vi trenger init til faktisk å kjøre for å teste race-condition-en.
      const buildSvc = (): SecurityService => {
        const svc = Object.create(SecurityService.prototype) as SecurityService;
        Object.assign(svc as unknown as Record<string, unknown>, {
          pool,
          schema,
          cacheTtlMs: 60_000,
          nowMs: () => Date.now(),
          pilotMode: false,
          onCriticalFailure: () => {
            /* swallow så test ikke spammer log */
          },
          initPromise: null,
          initFailed: false,
          blockedIpCache: null,
          blockedIpCacheLoadedAt: 0,
        });
        return svc;
      };
      const instances = Array.from({ length: 5 }, () => buildSvc());

      // Spawn 5 parallelle kall. Alle skal lykkes — uten advisory-lock
      // vil 1-4 av dem typisk krasje med
      // "duplicate key value violates unique constraint pg_class_relname_nsp_index"
      // eller tilsvarende.
      const results = await Promise.allSettled(
        instances.map((svc) => svc.listBlockedIps()),
      );

      const failures = results.filter((r) => r.status === "rejected");
      assert.equal(
        failures.length,
        0,
        `Forventet 0 feilende init-kall, fikk ${failures.length}. Feilmeldinger:\n` +
          failures
            .map(
              (f) =>
                `  - ${(f as PromiseRejectedResult).reason?.message ?? f}`,
            )
            .join("\n"),
      );

      // Idempotens: verifiser at skjema-objektene er opprettet nøyaktig én
      // gang (3 tabeller fra SecurityService).
      const tableCheck = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_name IN ('app_withdraw_email_allowlist',
                              'app_risk_countries',
                              'app_blocked_ips')`,
        [schema],
      );
      assert.equal(
        tableCheck.rows[0]?.count,
        "3",
        "Forventet nøyaktig 3 SecurityService-tabeller i test-schemaet",
      );

      // Verifiser at det også er nøyaktig 1 partial-index på app_blocked_ips.
      const indexCheck = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pg_indexes
         WHERE schemaname = $1
           AND tablename = 'app_blocked_ips'
           AND indexname LIKE 'idx_%_blocked_ips_active'`,
        [schema],
      );
      assert.equal(
        indexCheck.rows[0]?.count,
        "1",
        "Forventet nøyaktig 1 partial-index på app_blocked_ips",
      );
    } finally {
      await dropSchema(pool, schema).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "BIN-827: 20 parallelle ensureInitialized via SAMME instans deduplikerer init-kall",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    // Uavhengig sanity-test: med samme instans skal `initPromise`-cachen
    // dedup-e parallelle kall — det er service-intern dedup, ikke
    // advisory-lock som gjør jobben her, men testen verifiserer at
    // service-state ikke blir korrupt under høy concurrency.
    const pool = new Pool({ connectionString: PG_CONN, max: 10 });
    const schema = makeTestSchema();
    try {
      const svc = Object.create(SecurityService.prototype) as SecurityService;
      Object.assign(svc as unknown as Record<string, unknown>, {
        pool,
        schema,
        cacheTtlMs: 60_000,
        nowMs: () => Date.now(),
        pilotMode: false,
        onCriticalFailure: () => {
          /* swallow */
        },
        initPromise: null,
        initFailed: false,
        blockedIpCache: null,
        blockedIpCacheLoadedAt: 0,
      });

      const calls = Array.from({ length: 20 }, () => svc.listBlockedIps());
      const results = await Promise.allSettled(calls);
      const failures = results.filter((r) => r.status === "rejected");
      assert.equal(
        failures.length,
        0,
        `Forventet 0 feilende kall, fikk ${failures.length}`,
      );

      // initFailed skal IKKE være satt etter en vellykket init.
      assert.equal(
        (svc as unknown as { initFailed: boolean }).initFailed,
        false,
        "initFailed skal være false etter vellykket init",
      );
    } finally {
      await dropSchema(pool, schema).catch(() => undefined);
      await pool.end();
    }
  },
);
