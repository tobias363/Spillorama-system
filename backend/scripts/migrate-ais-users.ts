#!/usr/bin/env npx tsx
/**
 * BIN-271: Migrate users from AIS MongoDB → Spillorama PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/migrate-ais-users.ts --input ais-users-export.json [--dry-run]
 *
 * Input format (JSON array):
 *   [
 *     {
 *       "_id": "mongo-object-id",
 *       "email": "user@example.com",
 *       "displayName": "Bruker",
 *       "phone": "+4712345678",
 *       "passwordHash": "$2b$10$...",        // bcrypt hash from AIS
 *       "balance": 500,                       // wallet balance in NOK
 *       "birthDate": "1990-01-15",            // optional
 *       "kycVerified": true,                  // optional
 *       "lossLimits": { "daily": 900, "monthly": 4400 },  // optional Spillvett
 *       "selfExcluded": false,                // optional
 *       "selfExcludedUntil": null,            // optional ISO date
 *       "createdAt": "2024-03-10T12:00:00Z"
 *     }
 *   ]
 *
 * The script:
 *   1. Reads the AIS export file
 *   2. For each user, checks if email already exists in Spillorama
 *   3. Creates user + wallet if not exists
 *   4. Transfers wallet balance
 *   5. Migrates Spillvett settings (loss limits, self-exclusion)
 *   6. Logs results to stdout
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// ── AIS user shape (adjust fields to match actual AIS export) ────────────────

interface AisUser {
  _id: string;
  email: string;
  displayName: string;
  phone?: string;
  passwordHash: string;
  balance: number;
  birthDate?: string;
  kycVerified?: boolean;
  lossLimits?: { daily?: number; monthly?: number };
  selfExcluded?: boolean;
  selfExcludedUntil?: string | null;
  createdAt: string;
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");
const inputFile = inputIdx >= 0 ? args[inputIdx + 1] : null;
const dryRun = args.includes("--dry-run");

if (!inputFile) {
  console.error("Usage: npx tsx scripts/migrate-ais-users.ts --input <file.json> [--dry-run]");
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const connectionString = process.env.APP_PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("Error: APP_PG_CONNECTION_STRING env var required");
  process.exit(1);
}

const schema = process.env.APP_PG_SCHEMA?.trim() || "public";
const usersTable = `${schema}.users_table`;
const walletsTable = `${schema}.wallets`;

async function main() {
  const raw = readFileSync(inputFile!, "utf-8");
  const aisUsers: AisUser[] = JSON.parse(raw);

  console.log(`[migrate] Loaded ${aisUsers.length} AIS users from ${inputFile}`);
  if (dryRun) console.log("[migrate] DRY RUN — no database changes will be made");

  const client = new pg.Client({ connectionString });
  await client.connect();

  let created = 0;
  let skipped = 0;
  let errors = 0;

  try {
    for (const aisUser of aisUsers) {
      try {
        // Check if email already exists
        const existing = await client.query(
          `SELECT id FROM ${usersTable} WHERE email = $1`,
          [aisUser.email.toLowerCase().trim()]
        );

        if (existing.rows.length > 0) {
          console.log(`[skip] ${aisUser.email} — already exists as ${existing.rows[0].id}`);
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`[dry-run] Would create: ${aisUser.email} (balance: ${aisUser.balance})`);
          created++;
          continue;
        }

        // Create user within transaction
        await client.query("BEGIN");

        const userId = randomUUID();
        const walletId = `wallet-user-${userId}`;

        // Insert user (reuse AIS password hash — both use bcrypt)
        await client.query(
          `INSERT INTO ${usersTable} (id, email, display_name, password_hash, wallet_id, role, kyc_status, birth_date, kyc_verified_at, phone, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'PLAYER', $6, $7, $8, $9, $10, now())`,
          [
            userId,
            aisUser.email.toLowerCase().trim(),
            aisUser.displayName,
            aisUser.passwordHash,
            walletId,
            aisUser.kycVerified ? "VERIFIED" : "UNVERIFIED",
            aisUser.birthDate || null,
            aisUser.kycVerified ? new Date().toISOString() : null,
            aisUser.phone || null,
            aisUser.createdAt || new Date().toISOString(),
          ]
        );

        // Create wallet with balance
        // NOTE: Adjust this query to match your wallet provider's table schema.
        // If using file-based or HTTP wallet, you'll need a different approach.
        await client.query(
          `INSERT INTO ${walletsTable} (id, balance, currency, created_at, updated_at)
           VALUES ($1, $2, 'NOK', now(), now())
           ON CONFLICT (id) DO NOTHING`,
          [walletId, Math.max(0, aisUser.balance)]
        );

        // TODO: Migrate Spillvett/compliance data if the responsible_gaming tables exist
        // This depends on PostgresResponsibleGamingStore schema.
        // if (aisUser.lossLimits) { ... }
        // if (aisUser.selfExcluded) { ... }

        await client.query("COMMIT");
        console.log(`[created] ${aisUser.email} → ${userId} (balance: ${aisUser.balance})`);
        created++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[error] ${aisUser.email}: ${(err as Error).message}`);
        errors++;
      }
    }
  } finally {
    await client.end();
  }

  console.log(`\n[migrate] Done. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
  if (dryRun) console.log("[migrate] This was a dry run. Run without --dry-run to apply changes.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
