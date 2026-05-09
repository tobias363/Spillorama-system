// BIN-764: WalletAuditVerifier integrasjons-test mot ekte Postgres.
//
// Som walletSplit.test.ts hopper denne over uten WALLET_PG_TEST_CONNECTION_STRING.
// Pure hash-helper-tester (uten DB) ligger i hashChain.unit.test.ts.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresWalletAdapter } from "../adapters/PostgresWalletAdapter.js";
import { bootstrapWalletSchemaForTests } from "../adapters/walletSchemaTestUtil.js";
import { WalletAuditVerifier } from "./WalletAuditVerifier.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over WalletAuditVerifier integrasjons-test";

function makeTestSchema(): string {
  return `wallet_audit_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

// ── Test 1: chain-integritet roundtrip ──────────────────────────────────────

test("audit: chain er intakt etter normal wallet-bruk (createAccount + credit + debit)", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    await adapter.createAccount({ accountId: "w-roundtrip", initialBalance: 500 });
    await adapter.credit("w-roundtrip", 200, "payout", { to: "winnings" });
    await adapter.debit("w-roundtrip", 150, "kjøp");

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema });
    const result = await verifier.verifyAccount("w-roundtrip");

    assert.equal(result.mismatches.length, 0, "ingen mismatches i intakt kjede");
    assert.equal(result.legacyUnhashed, 0, "ingen NULL-hashes i nye rader");
    assert.ok(result.entriesChecked > 0, "minst én entry verifisert");
    assert.equal(result.entriesValid, result.entriesChecked, "alle entries valide");
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Test 2: manipulert entry detekteres ─────────────────────────────────────

test("audit: manipulasjon av amount-felt detekteres som hash_mismatch", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    await adapter.createAccount({ accountId: "w-tamper", initialBalance: 1000 });
    await adapter.debit("w-tamper", 100, "kjøp-1");
    await adapter.debit("w-tamper", 200, "kjøp-2");

    // Manipuler én entry — sett amount = 99999. Hashen er ikke oppdatert,
    // så verifier-en skal detektere mismatch.
    await cleanupPool.query(
      `UPDATE "${schema}"."wallet_entries"
          SET amount = 99999
        WHERE account_id = 'w-tamper' AND side = 'DEBIT'
        AND id = (
          SELECT id FROM "${schema}"."wallet_entries"
           WHERE account_id = 'w-tamper' AND side = 'DEBIT'
           ORDER BY id ASC LIMIT 1
        )`
    );

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema });
    const result = await verifier.verifyAccount("w-tamper");

    assert.ok(result.mismatches.length >= 1, "minst én mismatch detektert");
    assert.equal(result.mismatches[0]!.reason, "hash_mismatch");
    assert.equal(result.mismatches[0]!.accountId, "w-tamper");
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Test 3: idempotent verify ───────────────────────────────────────────────

test("audit: verifyAccount er idempotent — samme svar ved gjentatt kjøring", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    await adapter.createAccount({ accountId: "w-idem", initialBalance: 200 });
    await adapter.credit("w-idem", 50, "payout", { to: "winnings" });
    await adapter.debit("w-idem", 30, "kjøp");

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema });
    const r1 = await verifier.verifyAccount("w-idem");
    const r2 = await verifier.verifyAccount("w-idem");
    const r3 = await verifier.verifyAccount("w-idem");

    assert.equal(r1.entriesChecked, r2.entriesChecked);
    assert.equal(r2.entriesChecked, r3.entriesChecked);
    assert.equal(r1.mismatches.length, 0);
    assert.equal(r2.mismatches.length, 0);
    assert.equal(r3.mismatches.length, 0);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Test 4: performance på 10k entries ──────────────────────────────────────

test("audit: 10k entries verifiseres på rimelig tid (<10s)", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    // Lag konto med 1000kr og kjør 5000 debit/credit-par.
    // Hver debit/credit gir 2 entries (DEBIT spiller + CREDIT motpart),
    // så totalt 4 entries per iterasjon × 2500 = 10000 entries.
    await adapter.createAccount({ accountId: "w-perf", initialBalance: 100000 });
    for (let i = 0; i < 2500; i += 1) {
      await adapter.debit("w-perf", 1, `kjøp-${i}`);
      await adapter.credit("w-perf", 1, `bonus-${i}`, { to: "deposit" });
    }

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema, batchSize: 1000 });
    const start = Date.now();
    const result = await verifier.verifyAccount("w-perf");
    const durationMs = Date.now() - start;

    assert.ok(result.entriesChecked >= 10000, `forventet ≥10k entries, fikk ${result.entriesChecked}`);
    assert.equal(result.mismatches.length, 0);
    assert.ok(durationMs < 10_000, `verifiseringen tok ${durationMs}ms — bør være <10s`);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Test 5: legacy-rader (entry_hash NULL) hoppes over uten mismatch ────────

test("audit: legacy-rader uten entry_hash teller som legacyUnhashed, ikke mismatch", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    await adapter.createAccount({ accountId: "w-legacy", initialBalance: 100 });
    await adapter.debit("w-legacy", 30, "kjøp");

    // Simuler legacy: nuller hashen på første rad. Verifier skal IKKE
    // alarmere på NULL — det er backwards-compat-shim. Etterfølgende
    // rader fortsetter kjeden (chain resettes ved NULL-rad).
    await cleanupPool.query(
      `UPDATE "${schema}"."wallet_entries"
          SET entry_hash = NULL, previous_entry_hash = NULL
        WHERE account_id = 'w-legacy'
          AND id = (SELECT MIN(id) FROM "${schema}"."wallet_entries" WHERE account_id = 'w-legacy')`
    );

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema });
    const result = await verifier.verifyAccount("w-legacy");

    assert.equal(result.legacyUnhashed, 1, "én legacy-rad detektert");
    assert.equal(result.mismatches.length, 0, "ingen mismatch (legacy er ikke alarm)");
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});

// ── Test 6: verifyAll dekker alle kontoer + concurrency ─────────────────────

test("audit: verifyAll dekker alle kontoer og rapporterer totaler", { skip: skipReason }, async () => {
  const schema = makeTestSchema();
  const cleanupPool = new Pool({ connectionString: PG_CONN });
  // BIN-828: bootstrap schema før adapter-bruk.
  await bootstrapWalletSchemaForTests(cleanupPool, { schema });
  const adapter = new PostgresWalletAdapter({ connectionString: PG_CONN!, schema, defaultInitialBalance: 0 });
  try {
    await adapter.createAccount({ accountId: "w-a", initialBalance: 100 });
    await adapter.createAccount({ accountId: "w-b", initialBalance: 200 });
    await adapter.createAccount({ accountId: "w-c", initialBalance: 300 });
    await adapter.debit("w-a", 10, "kjøp-a");
    await adapter.debit("w-b", 20, "kjøp-b");
    await adapter.debit("w-c", 30, "kjøp-c");

    const verifier = new WalletAuditVerifier({ pool: cleanupPool, schema, concurrency: 2 });
    const result = await verifier.verifyAll();

    // Vi har minst 3 user-konti + 2 system-konti (__system_house__,
    // __system_external_cash__) som motpart for createAccount-funding.
    assert.ok(result.accountsChecked >= 3, `forventet ≥3 kontoer, fikk ${result.accountsChecked}`);
    assert.equal(result.totalMismatches, 0);
    assert.equal(result.failedAccounts.length, 0);
    assert.ok(result.totalEntriesChecked > 0);
  } finally {
    await dropSchema(cleanupPool, schema);
    await cleanupPool.end();
  }
});
