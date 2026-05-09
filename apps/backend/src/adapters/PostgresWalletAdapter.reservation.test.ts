/**
 * PR #513 §1.1 + §1.2: integrasjons-test for PostgresWalletAdapter
 * reservation-flyten. Kjører KUN når `WALLET_PG_TEST_CONNECTION_STRING`
 * er satt (opt-in i `npm test` — samme mønster som transferTargetSide-testen).
 *
 * Hva denne dekker:
 *   §1.1: fractional NOK lagres uten trunkering i amount_cents (NUMERIC(20,6))
 *   §1.2: commitReservation er race-safe mot expireStaleReservations
 *           (atomisk transaksjon med FOR UPDATE på reservation-raden)
 *
 * Kontrakt-deler som allerede er dekket av InMemory-tester:
 *   reserve / release / commit / idempotens / available-beregning
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "./PostgresWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";
import { bootstrapWalletSchemaForTests } from "./walletSchemaTestUtil.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `wallet_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

// ── §1.1: fractional NOK ────────────────────────────────────────────────────

test(
  "postgres §1.1: amount_cents lagrer fractional NOK uten trunkering",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    // BIN-828: bootstrap schema før adapter-bruk.
    await bootstrapWalletSchemaForTests(cleanupPool, { schema });
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    try {
      await adapter.createAccount({ accountId: "frac-player", initialBalance: 100 });

      // 12.50 kr per brett — bug-scenario: BIGINT trunkerte til 12.
      const r = await adapter.reserve!("frac-player", 12.5, {
        idempotencyKey: "frac-1",
        roomCode: "FRAC",
      });

      assert.equal(r.amount, 12.5, "API returnerer fractional value uendret");

      // Verifiser at DB faktisk lagrer 12.5, ikke 12.
      const { rows } = await cleanupPool.query<{ amount_cents: string }>(
        `SELECT amount_cents::text AS amount_cents
         FROM "${schema}"."app_wallet_reservations"
         WHERE id = $1`,
        [r.id],
      );
      assert.equal(rows.length, 1);
      assert.equal(
        Number(rows[0]!.amount_cents),
        12.5,
        `DB-verdi skal være 12.5 (ikke trunkert til 12 — fikk: ${rows[0]!.amount_cents})`,
      );

      // Available skal også være riktig.
      const available = await adapter.getAvailableBalance!("frac-player");
      assert.equal(available, 87.5, "available = 100 - 12.5 = 87.5");
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

test(
  "postgres §1.1: aggregat av fractional reservasjoner stemmer",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    // BIN-828: bootstrap schema før adapter-bruk.
    await bootstrapWalletSchemaForTests(cleanupPool, { schema });
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    try {
      await adapter.createAccount({ accountId: "frac-agg", initialBalance: 100 });

      await adapter.reserve!("frac-agg", 12.5, { idempotencyKey: "k1", roomCode: "R1" });
      await adapter.reserve!("frac-agg", 25.75, { idempotencyKey: "k2", roomCode: "R1" });

      // 100 - (12.5 + 25.75) = 61.75 — krever full presisjon i SUM()
      const available = await adapter.getAvailableBalance!("frac-agg");
      assert.equal(available, 61.75);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

// ── §1.2: TOCTOU race (commitReservation vs expireStaleReservations) ───────

test(
  "postgres §1.2: commitReservation er atomisk vs expireStaleReservations",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    // BIN-828: bootstrap schema før adapter-bruk.
    await bootstrapWalletSchemaForTests(cleanupPool, { schema });
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    try {
      await adapter.createAccount({ accountId: "race-player", initialBalance: 1000 });
      await adapter.createAccount({ accountId: "race-house", initialBalance: 0 });

      // Lag en reservation som er PÅ randen til å expire (1 sekund frem).
      // Vi bruker TTL utenfor default-30-min så vi kan trigge expiry-tick.
      const expiresAt = new Date(Date.now() + 1000).toISOString();
      const r = await adapter.reserve!("race-player", 250, {
        idempotencyKey: "race-1",
        roomCode: "RACE",
        expiresAt,
      });

      // Race-scenario: Kjør commit + expire samtidig. FOR UPDATE-låsen i
      // commitReservation skal blokkere expire til commit er ferdig.
      // Etter at begge er done skal status være enten 'committed' (commit
      // vant) eller commit må feile med INVALID_STATE (expire vant).
      // I begge tilfeller MÅ wallet-balance og reservation-status være
      // konsistente — ikke "wallet trukket men status='expired'".
      const expirePromise = adapter.expireStaleReservations!(Date.now() + 5000);
      const commitPromise = adapter.commitReservation!(r.id, "race-house", "buy-in", {
        gameSessionId: "race-game",
      }).catch((err) => err);

      const [expiredCount, commitOutcome] = await Promise.all([expirePromise, commitPromise]);

      // Sjekk integritet:
      const { rows: resRows } = await cleanupPool.query<{
        status: string;
        amount_cents: string;
      }>(
        `SELECT status, amount_cents::text AS amount_cents
         FROM "${schema}"."app_wallet_reservations"
         WHERE id = $1`,
        [r.id],
      );
      const finalStatus = resRows[0]!.status;

      const playerBalance = await adapter.getBalance("race-player");
      const houseBalance = await adapter.getBalance("race-house");

      if (commitOutcome instanceof Error) {
        // Expire vant racet → status='expired', wallet urørt.
        assert.equal(finalStatus, "expired", "expire vant → status=expired");
        assert.equal(playerBalance, 1000, "wallet ikke trukket når commit feilet");
        assert.equal(houseBalance, 0, "house ikke kreditert når commit feilet");
        assert.ok(
          (commitOutcome as WalletError).code === "INVALID_STATE",
          `forventet INVALID_STATE, fikk ${(commitOutcome as WalletError).code}`,
        );
      } else {
        // Commit vant → status='committed', wallet trukket 250.
        assert.equal(finalStatus, "committed", "commit vant → status=committed");
        assert.equal(playerBalance, 750, "wallet trukket 250");
        assert.equal(houseBalance, 250, "house kreditert 250");
        // expireStaleReservations kan ha touched 0 eller 1 — ikke kritisk
        // for konsistens, bare logget.
        void expiredCount;
      }
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);

test(
  "postgres §1.2: parallelle commit-attempts på samme reservation (én vinner)",
  { skip: skipReason },
  async () => {
    const schema = makeTestSchema();
    const cleanupPool = new Pool({ connectionString: PG_CONN });
    // BIN-828: bootstrap schema før adapter-bruk.
    await bootstrapWalletSchemaForTests(cleanupPool, { schema });
    const adapter = new PostgresWalletAdapter({
      connectionString: PG_CONN!,
      schema,
      defaultInitialBalance: 0,
    });
    try {
      await adapter.createAccount({ accountId: "dup-player", initialBalance: 1000 });
      await adapter.createAccount({ accountId: "dup-house", initialBalance: 0 });

      const r = await adapter.reserve!("dup-player", 100, {
        idempotencyKey: "dup-1",
        roomCode: "DUP",
      });

      // To samtidige commit-kall på samme reservation — én skal lykkes,
      // den andre skal kaste INVALID_STATE.
      const [a, b] = await Promise.allSettled([
        adapter.commitReservation!(r.id, "dup-house", "buy-in"),
        adapter.commitReservation!(r.id, "dup-house", "buy-in"),
      ]);

      const fulfilled = [a, b].filter((x) => x.status === "fulfilled");
      const rejected = [a, b].filter((x) => x.status === "rejected");

      assert.equal(fulfilled.length, 1, "kun én commit skal lykkes");
      assert.equal(rejected.length, 1, "den andre skal feile");

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason as WalletError;
      assert.ok(
        rejectedReason.code === "INVALID_STATE",
        `forventet INVALID_STATE for andre commit, fikk ${rejectedReason.code}`,
      );

      // Wallet skal kun være trukket 100 (ikke 200 — ingen dobbel-debit).
      assert.equal(await adapter.getBalance("dup-player"), 900);
      assert.equal(await adapter.getBalance("dup-house"), 100);
    } finally {
      await dropSchema(cleanupPool, schema);
      await cleanupPool.end();
    }
  },
);
