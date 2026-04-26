/**
 * BIN-762: integration-tests for REPEATABLE READ + retry mot ekte Postgres.
 *
 * Disse testene kjører KUN når `WALLET_PG_TEST_CONNECTION_STRING` er satt
 * (typisk lokal docker eller CI-container). I standard `npm test` hoppes
 * de over.
 *
 * Hva denne dekker (komplementerer mock-dekningen i walletTxRetry.test.ts):
 *   - Concurrency: 2 parallelle credits til samme konto med samme idempotency-key
 *     → eksakt 1 sukkess + 1 dedup-detection (idempotency-key)
 *   - Concurrency: 2 parallelle reserve fra samme konto, hver overskrider
 *     available_balance hver for seg → 1 sukkess + 1 INSUFFICIENT_FUNDS
 *   - Performance baseline: hot-path latency P99 målt før/etter for å
 *     dokumentere eventuell økning
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `wallet_iso_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

// ── Concurrency: parallel credit med samme idempotency-key ──────────────────

test(
  "postgres: 2 parallelle credits med samme idempotency-key → eksakt 1 sukkess (dedup)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "w-dedup", initialBalance: 100 });
      const sharedKey = `idem-${randomUUID()}`;

      const results = await Promise.allSettled([
        adapter.credit("w-dedup", 50, "test-credit-A", { idempotencyKey: sharedKey }),
        adapter.credit("w-dedup", 50, "test-credit-B", { idempotencyKey: sharedKey }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      // Idempotency: begge skal returnere samme transaksjon (dedup), ELLER
      // én lykkes og én treffer 23505 unique violation som propageres.
      // Etter BIN-162 returnerer findByIdempotencyKey eksisterende tx, så
      // begge skal lykkes med IDENTISK tx-id.
      if (fulfilled.length === 2) {
        const tx1 = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value;
        const tx2 = (fulfilled[1] as PromiseFulfilledResult<{ id: string }>).value;
        assert.equal(tx1.id, tx2.id, "begge må peke på samme transaksjon");
      } else {
        // Race: en lykkes, andre får 23505 før idempotency-sjekken.
        // Verifiser at saldo bare økte med 50 (ikke 100).
      }

      const balance = await adapter.getBalance("w-dedup");
      assert.equal(balance, 150, "saldo må være 100+50, ikke 100+100");
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Concurrency: parallel reserve som overskrider available_balance ──────────

test(
  "postgres: 2 parallelle reserve som hver overskrider saldo → 1 sukkess + 1 INSUFFICIENT_FUNDS",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "w-reserve-race", initialBalance: 100 });
      // Saldo 100. To parallelle reserveringer à 60 = 120 totalt → 1 må feile.
      const results = await Promise.allSettled([
        adapter.reserve("w-reserve-race", 60, {
          idempotencyKey: `key-A-${randomUUID()}`,
          roomCode: "room-A",
        }),
        adapter.reserve("w-reserve-race", 60, {
          idempotencyKey: `key-B-${randomUUID()}`,
          roomCode: "room-B",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.equal(fulfilled.length, 1, "kun én reserve lykkes");
      assert.equal(rejected.length, 1, "den andre feiler");

      const rejection = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        rejection instanceof WalletError &&
          (rejection.code === "INSUFFICIENT_FUNDS" ||
            rejection.code === "WALLET_SERIALIZATION_FAILURE"),
        `forventet INSUFFICIENT_FUNDS eller WALLET_SERIALIZATION_FAILURE, fikk ${rejection?.code}`,
      );

      // Verifiser at sum aktive reservasjoner = 60 (ikke 120).
      const active = await adapter.listActiveReservations("w-reserve-race");
      assert.equal(active.length, 1);
      assert.equal(active[0].amount, 60);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Concurrency: race mellom transfer og reserve ────────────────────────────

test(
  "postgres: race transfer + reserve → REPEATABLE READ blokkerer phantom-read",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "w-race-A", initialBalance: 100 });
      await adapter.createAccount({ accountId: "w-race-B", initialBalance: 0 });

      // To parallelle write-paths som begge ville bryte saldoen om de begge lykkes.
      const results = await Promise.allSettled([
        adapter.transfer("w-race-A", "w-race-B", 80, "race-transfer"),
        adapter.reserve("w-race-A", 80, {
          idempotencyKey: `key-${randomUUID()}`,
          roomCode: "room-A",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Minst én må feile — total uttak 160 fra saldo 100 er umulig.
      // (Begge kan også feile hvis 40001-retries gir opp — det er da fail-closed
      // og akseptabelt.)
      assert.ok(
        rejected.length >= 1,
        `forventet ≥1 feil av to konkurrerende uttak fra saldo 100, fikk ${rejected.length}`,
      );

      // Saldo-invariant: tilgjengelig saldo må være >= 0.
      const final = await adapter.getBothBalances("w-race-A");
      assert.ok(final.total >= 0, `saldo må være ≥ 0, var ${final.total}`);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── Performance baseline: hot-path latency ───────────────────────────────────
//
// IKKE en test som feiler — bare logger målinger. Skal kjøres manuelt før
// og etter BIN-762-merge for å dokumentere eventuell P99-økning.

test(
  "postgres: hot-path latency-baseline (debit, 100 iterasjoner)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    try {
      await adapter.createAccount({ accountId: "w-perf", initialBalance: 100000 });
      const N = 100;
      const latencies: number[] = [];
      for (let i = 0; i < N; i += 1) {
        const t0 = process.hrtime.bigint();
        await adapter.debit("w-perf", 1, `perf-${i}`);
        const t1 = process.hrtime.bigint();
        latencies.push(Number(t1 - t0) / 1_000_000); // ms
      }
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(N * 0.5)]!;
      const p95 = latencies[Math.floor(N * 0.95)]!;
      const p99 = latencies[Math.floor(N * 0.99)]!;
      // eslint-disable-next-line no-console
      console.log(
        `[BIN-762 perf] debit P50=${p50.toFixed(2)}ms P95=${p95.toFixed(2)}ms P99=${p99.toFixed(2)}ms (N=${N})`,
      );
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);
