#!/usr/bin/env npx tsx
/**
 * R4 Load-test (BIN-817): Seed N test-spillere idempotent for load-test.
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-817
 * Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.5 R4
 *
 * Hvorfor:
 *   Demo-seed (`seed-demo-pilot-day.ts`) gir bare 12+3 spillere — for langt
 *   for lite for 1000-VU load-test. Denne scripten oppretter N spillere med
 *   forutsigbare e-postadresser (`loadtest-1@loadtest.local`,
 *   `loadtest-2@loadtest.local` osv) og hall-registrering på target-hallen
 *   slik at `bet:arm`/`ticket:mark` ikke avvises av PLAYER_NOT_AT_HALL.
 *
 * Idempotent: kan kjøres flere ganger. Eksisterende spiller-rader bevares
 * via ON CONFLICT DO NOTHING / DO UPDATE.
 *
 * Hver spiller får:
 *   - role=PLAYER, kyc_status=VERIFIED, birth_date=1990-01-01
 *   - wallet_accounts-rad med 10 000 NOK deposit_balance
 *   - app_hall_registrations status=ACTIVE bundet til target-hallen
 *
 * Bruk:
 *   cd apps/backend
 *   npx tsx ../../infra/load-tests/seed-load-test-players.ts \
 *     --count=1000 --hallId=demo-hall-001
 *
 * Eller via wrapper:
 *   bash scripts/load-test-runner.sh seed --count=1000 --hallId=demo-hall-001
 *
 * Args:
 *   --count=N       (default 1000)
 *   --hallId=...    (default demo-hall-001)
 *   --prefix=...    (default loadtest-)
 *   --domain=...    (default @loadtest.local)
 *   --password=...  (default Spillorama123!)
 *   --batchSize=N   (default 100; for stor-skala-seeds)
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const scrypt = promisify(scryptCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Last .env fra backend (samme pattern som seed-teknobingo-test-players.ts)
dotenv.config({ path: path.resolve(__dirname, "../../apps/backend/.env") });

// ── CLI parsing ───────────────────────────────────────────────────────────
function parseArg(name: string, defaultValue: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : defaultValue;
}

const COUNT = Number(parseArg("count", "1000"));
const HALL_ID = parseArg("hallId", "demo-hall-001");
const PREFIX = parseArg("prefix", "loadtest-");
const DOMAIN = parseArg("domain", "@loadtest.local");
const PASSWORD = parseArg(
  "password",
  process.env.LOAD_TEST_PASSWORD ?? "Spillorama123!",
);
const BATCH_SIZE = Math.max(1, Number(parseArg("batchSize", "100")));
const PLAYER_BIRTH_DATE = "1990-01-01";
const PLAYER_DEPOSIT_MAJOR = 10000; // 10 000 NOK starting balance per VU

if (!Number.isFinite(COUNT) || COUNT < 1 || COUNT > 100_000) {
  console.error(`[seed-load-test] Invalid --count=${COUNT} (must be 1..100000)`);
  process.exit(2);
}

// ── Password-hashing (matcher PlatformService.hashPassword + seed-teknobingo) ──
// Format: `scrypt:<salt-hex>:<digest-hex>` (KOLON-separator, ikke $).
async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(plain, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

// ── DB-helpers ────────────────────────────────────────────────────────────
async function ensureHallExists(client: Client, hallId: string): Promise<void> {
  const res = await client.query(
    `SELECT id FROM app_halls WHERE id = $1 LIMIT 1`,
    [hallId],
  );
  if (res.rows.length === 0) {
    throw new Error(
      `[seed-load-test] Hall "${hallId}" finnes ikke. ` +
        `Kjør først \`npm run seed:demo-pilot-day\` eller velg en eksisterende hall.`,
    );
  }
}

async function columnExists(
  client: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column],
  );
  return res.rows.length > 0;
}

interface SeedResult {
  created: boolean;
}

async function seedPlayer(
  client: Client,
  index: number,
  hallId: string,
  passwordHash: string,
  hasHallIdColumn: boolean,
): Promise<SeedResult> {
  const userId = `${PREFIX}user-${index}`;
  const walletId = `${PREFIX}wallet-${index}`;
  const email = `${PREFIX}${index}${DOMAIN}`;
  const displayName = `Loadtest ${index}`;
  const surname = `User ${index}`;
  const regId = `${PREFIX}reg-${index}-${hallId}`;

  // ── 1. wallet_accounts (PARENT av FK) ─────────────────────────────────
  await client.query(
    `INSERT INTO wallet_accounts (id, deposit_balance, winnings_balance, is_system, currency, created_at, updated_at)
     VALUES ($1, $2, 0, false, 'NOK', now(), now())
     ON CONFLICT (id) DO UPDATE
       SET deposit_balance = GREATEST(wallet_accounts.deposit_balance, EXCLUDED.deposit_balance),
           updated_at = now()`,
    [walletId, PLAYER_DEPOSIT_MAJOR],
  );

  // ── 2. app_users ──────────────────────────────────────────────────────
  const userCols = [
    "id",
    "email",
    "display_name",
    "surname",
    "password_hash",
    "wallet_id",
    "role",
    "kyc_status",
    "kyc_verified_at",
    "birth_date",
    "compliance_data",
  ];
  const userPlaceholders = [
    "$1",
    "$2",
    "$3",
    "$4",
    "$5",
    "$6",
    "'PLAYER'",
    "'VERIFIED'",
    "now()",
    "$7::date",
    `'{"createdBy":"R4_LOAD_TEST_SEED"}'::jsonb`,
  ];
  const userValues: unknown[] = [
    userId,
    email,
    displayName,
    surname,
    passwordHash,
    walletId,
    PLAYER_BIRTH_DATE,
  ];
  if (hasHallIdColumn) {
    userCols.push("hall_id");
    userPlaceholders.push(`$${userValues.length + 1}`);
    userValues.push(hallId);
  }

  const userRes = await client.query(
    `INSERT INTO app_users (${userCols.join(", ")})
     VALUES (${userPlaceholders.join(", ")})
     ON CONFLICT (id) DO UPDATE SET
       updated_at = NOW()
     RETURNING (xmax = 0) AS created`,
    userValues,
  );
  const created: boolean = userRes.rows[0]?.created === true;

  // ── 3. app_hall_registrations ─────────────────────────────────────────
  await client.query(
    `INSERT INTO app_hall_registrations
       (id, user_id, wallet_id, hall_id, status,
        requested_at, activated_at, activated_by_user_id, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, 'ACTIVE',
        now(), now(), NULL, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       status = 'ACTIVE',
       wallet_id = EXCLUDED.wallet_id,
       activated_at = COALESCE(app_hall_registrations.activated_at, EXCLUDED.activated_at),
       updated_at = now()`,
    [regId, userId, walletId, hallId],
  );

  return { created };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const conn =
    process.env.APP_PG_CONNECTION_STRING ??
    "postgres://spillorama:spillorama@localhost:5432/spillorama";

  console.log(
    `[seed-load-test] Seeding ${COUNT} players → hall=${HALL_ID} (prefix=${PREFIX})`,
  );

  const client = new Client({ connectionString: conn });
  await client.connect();

  try {
    await ensureHallExists(client, HALL_ID);
    const hasHallIdColumn = await columnExists(client, "app_users", "hall_id");

    // Hash passordet ÉN gang. KRITISK ytelse: scrypt er ~100ms per hash,
    // så 1000 hashes ville tatt 100 sek alene.
    console.log(`[seed-load-test] Hashing password (engang)...`);
    const passwordHash = await hashPassword(PASSWORD);

    let createdCount = 0;
    let updatedCount = 0;
    const startMs = Date.now();
    const reportEvery = Math.max(50, Math.floor(COUNT / 20));

    for (let i = 1; i <= COUNT; i++) {
      try {
        const { created } = await seedPlayer(
          client,
          i,
          HALL_ID,
          passwordHash,
          hasHallIdColumn,
        );
        if (created) createdCount++;
        else updatedCount++;
      } catch (err) {
        console.error(`[seed-load-test] FAILED at player ${i}:`, err);
        throw err;
      }

      if (i % reportEvery === 0) {
        const elapsed = (Date.now() - startMs) / 1000;
        const rate = i / elapsed;
        const eta = (COUNT - i) / rate;
        process.stderr.write(
          `[seed-load-test] ${i}/${COUNT} (${rate.toFixed(0)}/s, ETA ${eta.toFixed(0)}s)\n`,
        );
      }
    }

    const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(
      `[seed-load-test] Done: ${createdCount} created + ${updatedCount} existing (in ${totalSec}s)`,
    );
    console.log(`[seed-load-test] Login-creds:`);
    console.log(`  email: ${PREFIX}<N>${DOMAIN}   (N = 1..${COUNT})`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  hall: ${HALL_ID}`);
  } catch (err) {
    console.error(`[seed-load-test] FAILED:`, err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[seed-load-test] fatal:", err);
  process.exit(1);
});
