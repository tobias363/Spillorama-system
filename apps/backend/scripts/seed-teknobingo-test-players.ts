#!/usr/bin/env npx tsx
/**
 * P0-1 (pilot 2026-05-02): Backfill 24 Teknobingo pilot test-spillere.
 *
 * Hvorfor:
 *   `app_hall_registrations` har ingen produksjonskode-skriver. Spillere
 *   registrert via `/api/auth/register` eller satt via
 *   `/api/admin/users/:id/hall` ender ikke opp i tabellen, og
 *   `PlatformService.isPlayerActiveInHall` returnerer false →
 *   AGENT cash-in/cash-out feiler med `PLAYER_NOT_AT_HALL`.
 *
 *   Denne scripten lager 6 pilot-spillere per Teknobingo-hall (24 totalt)
 *   med korrekt `app_hall_registrations`-rad så agentene kan ta i mot
 *   kontant under pilot-test 2026-05-02.
 *
 * Hva som seeds:
 *   - 4 Teknobingo-haller (hardkodede prod-IDer):
 *       Årnes (master), Bodø, Brumunddal, Fauske
 *   - 6 spillere per hall (24 totalt):
 *       pilot-arnes-1..6, pilot-bodo-1..6,
 *       pilot-brumunddal-1..6, pilot-fauske-1..6
 *       (e-post: <slug>@spillorama.no, passord: Spillorama123!)
 *   - Hver spiller får:
 *       - role=PLAYER, kyc_status=VERIFIED, birth_date=1990-01-01
 *       - app_hall_registrations status=ACTIVE bundet til sin hall
 *       - 500 NOK starting deposit_balance + matching wallet_entries
 *         bootstrap-rad så BIN-763 reconciliation-jobben ikke flagger
 *         CRITICAL-alarmer
 *
 * Idempotent: alle skrivinger bruker UPSERT / ON CONFLICT, så scriptet
 * kan kjøres flere ganger trygt. Eksisterende spiller-rader blir ikke
 * overskrevet på passord, og hall-registreringer ON CONFLICT (id) bevarer
 * `activated_at` via COALESCE.
 *
 * Bruk:
 *   cd apps/backend
 *   npx tsx scripts/seed-teknobingo-test-players.ts
 *
 * Forutsetning: `APP_PG_CONNECTION_STRING` i .env (eller miljøet).
 *
 * Override passord: sett `DEMO_SEED_PASSWORD` (default `Spillorama123!`).
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
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── Konstanter ────────────────────────────────────────────────────────────

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";
const PLAYER_BIRTH_DATE = "1990-01-01";
const PLAYER_DEPOSIT_MAJOR = 500;
const ADMIN_USER_ID = "tobias-admin";

interface TeknobingoHall {
  hallId: string;
  slugPrefix: string;
  displayName: string;
}

/**
 * Teknobingo prod-haller per pilot 2026-05-02 (hardkodet i task-prompten).
 * IDene må matche prod nøyaktig — hvis de er feil, ON CONFLICT-INSERT
 * av app_hall_registrations vil feile på FK til app_halls.
 */
const TEKNOBINGO_HALLS: readonly TeknobingoHall[] = [
  {
    hallId: "b18b7928-3469-4b71-a34d-3f81a1b09a88",
    slugPrefix: "pilot-arnes",
    displayName: "Teknobingo Årnes",
  },
  {
    hallId: "afebd2a2-52d7-4340-b5db-64453894cd8e",
    slugPrefix: "pilot-bodo",
    displayName: "Teknobingo Bodø",
  },
  {
    hallId: "46dbd01a-4033-4d87-86ca-bf148d0359c1",
    slugPrefix: "pilot-brumunddal",
    displayName: "Teknobingo Brumunddal",
  },
  {
    hallId: "ff631941-f807-4c39-8e41-83ca0b50d879",
    slugPrefix: "pilot-fauske",
    displayName: "Teknobingo Fauske",
  },
] as const;

const PLAYERS_PER_HALL = 6;

// ── Hash helper (matcher PlatformService.hashPassword) ────────────────────

async function hashScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

// ── Schema-introspeksjon (samme som seed-demo-pilot-day) ──────────────────

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table],
  );
  return Boolean(rows[0]?.exists);
}

async function columnExists(
  client: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(rows[0]?.exists);
}

// ── Wallet bootstrap (port av seed-demo-pilot-day, BIN-763-trygg) ─────────

async function ensureWalletAccount(
  client: Client,
  walletId: string,
): Promise<void> {
  const hasDepositBalance = await columnExists(
    client,
    "wallet_accounts",
    "deposit_balance",
  );
  if (hasDepositBalance) {
    await client.query(
      `INSERT INTO wallet_accounts (id, deposit_balance, winnings_balance, is_system)
       VALUES ($1, 0, 0, false)
       ON CONFLICT (id) DO NOTHING`,
      [walletId],
    );
  } else {
    await client.query(
      `INSERT INTO wallet_accounts (id, balance, is_system)
       VALUES ($1, 0, false)
       ON CONFLICT (id) DO NOTHING`,
      [walletId],
    );
  }
}

/**
 * Sett deposit_balance ≥ amount; bevarer høyere saldo via GREATEST så
 * re-runs ikke nullstiller en mid-pilot wallet-topup.
 */
async function maybeTopUpPlayerWallet(
  client: Client,
  userId: string,
  amountMajor: number,
): Promise<{ ok: true; walletId: string } | { ok: false; reason: string }> {
  const exists = await tableExists(client, "wallet_accounts");
  if (!exists) {
    return {
      ok: false,
      reason: "wallet_accounts-tabell finnes ikke",
    };
  }
  const { rows: userRows } = await client.query<{ wallet_id: string }>(
    "SELECT wallet_id FROM app_users WHERE id = $1",
    [userId],
  );
  const walletId = userRows[0]?.wallet_id;
  if (!walletId) {
    return { ok: false, reason: "wallet_id mangler på user-raden" };
  }
  const hasDepositBalance = await columnExists(
    client,
    "wallet_accounts",
    "deposit_balance",
  );
  try {
    if (hasDepositBalance) {
      await client.query(
        `INSERT INTO wallet_accounts (id, deposit_balance, winnings_balance, is_system, created_at, updated_at)
         VALUES ($1, $2, 0, false, now(), now())
         ON CONFLICT (id) DO UPDATE
           SET deposit_balance = GREATEST(wallet_accounts.deposit_balance, EXCLUDED.deposit_balance),
               updated_at = now()`,
        [walletId, amountMajor],
      );
    } else {
      await client.query(
        `INSERT INTO wallet_accounts (id, balance, is_system, created_at, updated_at)
         VALUES ($1, $2, false, now(), now())
         ON CONFLICT (id) DO UPDATE
           SET balance = GREATEST(wallet_accounts.balance, EXCLUDED.balance),
               updated_at = now()`,
        [walletId, amountMajor],
      );
    }
    return { ok: true, walletId };
  } catch (err) {
    return {
      ok: false,
      reason: `wallet_accounts-INSERT feilet: ${(err as Error).message}`,
    };
  }
}

/**
 * Sørger for at wallet-ledger har en bootstrap-rad som matcher
 * `deposit_balance` på kontoen. Uten denne genererer den nattlige
 * BIN-763 wallet-reconciliation-jobben CRITICAL-alarm.
 */
async function ensureWalletBootstrapEntry(
  client: Client,
  walletId: string,
  accountSide: "deposit" | "winnings",
  targetBalanceMajor: number,
): Promise<void> {
  const hasWalletEntries = await tableExists(client, "wallet_entries");
  if (!hasWalletEntries) return;

  const operationId = `pilot-bootstrap-${walletId}-${accountSide}`;
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM wallet_entries WHERE operation_id = $1 LIMIT 1",
    [operationId],
  );
  if (existing.rows.length > 0) return;

  const sum = await client.query<{ net: string | null }>(
    `SELECT COALESCE(
       SUM(CASE WHEN side = 'CREDIT' THEN amount
                WHEN side = 'DEBIT'  THEN -amount
                ELSE 0 END),
       0
     ) AS net
     FROM wallet_entries
     WHERE account_id = $1 AND account_side = $2`,
    [walletId, accountSide],
  );
  const ledgerNet = Number(sum.rows[0]?.net ?? 0);
  const diff = targetBalanceMajor - ledgerNet;
  if (Math.abs(diff) < 0.01) return;

  await client.query(
    `INSERT INTO wallet_entries
       (operation_id, account_id, side, amount, account_side,
        currency, entry_hash, previous_entry_hash)
     VALUES
       ($1, $2, $3, $4, $5, 'NOK', NULL, NULL)`,
    [
      operationId,
      walletId,
      diff > 0 ? "CREDIT" : "DEBIT",
      Math.abs(diff),
      accountSide,
    ],
  );
}

// ── User-upsert (matcher seed-demo-pilot-day pattern) ─────────────────────

interface UpsertPlayerInput {
  id: string;
  email: string;
  displayName: string;
  surname: string;
  hallId: string;
}

async function upsertPlayer(
  client: Client,
  input: UpsertPlayerInput,
): Promise<{ created: boolean }> {
  const walletId = `wallet-user-${input.id}`;
  await ensureWalletAccount(client, walletId);

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_users WHERE id = $1 OR email = $2 LIMIT 1",
    [input.id, input.email],
  );

  if (existing.rows[0]) {
    // Bevarer passord på eksisterende rad. Sikrer at hall_id, KYC og
    // verified-tidsstempel er konsistente uten å rotere passord-hash.
    const existingId = existing.rows[0].id;
    await client.query(
      `UPDATE app_users
          SET email = $2,
              display_name = $3,
              surname = $4,
              role = 'PLAYER',
              hall_id = $5,
              birth_date = $6::date,
              kyc_status = 'VERIFIED',
              kyc_verified_at = COALESCE(kyc_verified_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [
        existingId,
        input.email,
        input.displayName,
        input.surname,
        input.hallId,
        PLAYER_BIRTH_DATE,
      ],
    );
    return { created: false };
  }

  const passwordHash = await hashScrypt(DEMO_PASSWORD);
  const hasHallId = await columnExists(client, "app_users", "hall_id");

  const cols = [
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
  const placeholders = [
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
    `'{"createdBy":"SEED_TEKNOBINGO_PILOT"}'::jsonb`,
  ];
  const values: unknown[] = [
    input.id,
    input.email,
    input.displayName,
    input.surname,
    passwordHash,
    walletId,
    PLAYER_BIRTH_DATE,
  ];

  if (hasHallId) {
    cols.push("hall_id");
    placeholders.push(`$${values.length + 1}`);
    values.push(input.hallId);
  }

  await client.query(
    `INSERT INTO app_users (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    values,
  );
  return { created: true };
}

/**
 * Idempotent app_hall_registrations-upsert. Stable id (`reg-<userId>`) for
 * konsistens mellom kjøringer. ON CONFLICT (id) DO UPDATE bevarer
 * `activated_at` via COALESCE.
 */
async function upsertHallRegistration(
  client: Client,
  input: {
    id: string;
    userId: string;
    walletId: string;
    hallId: string;
    activatedByUserId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO app_hall_registrations
       (id, user_id, wallet_id, hall_id, status,
        requested_at, activated_at, activated_by_user_id)
     VALUES
       ($1, $2, $3, $4, 'ACTIVE',
        now(), now(), $5)
     ON CONFLICT (id) DO UPDATE
       SET wallet_id = EXCLUDED.wallet_id,
           hall_id = EXCLUDED.hall_id,
           status = 'ACTIVE',
           activated_at = COALESCE(app_hall_registrations.activated_at, EXCLUDED.activated_at),
           activated_by_user_id = COALESCE(
             app_hall_registrations.activated_by_user_id,
             EXCLUDED.activated_by_user_id
           ),
           updated_at = now()`,
    [input.id, input.userId, input.walletId, input.hallId, input.activatedByUserId],
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

interface SeedReport {
  hallName: string;
  hallId: string;
  created: number;
  alreadyExisted: number;
  walletTopupOk: number;
  walletTopupSkipped: number;
}

async function main(): Promise<void> {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING;
  if (!connectionString) {
    console.error(
      "Mangler APP_PG_CONNECTION_STRING (eller WALLET_PG_CONNECTION_STRING) i .env",
    );
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  // Resolve activated_by — bruk tobias-admin hvis den finnes, ellers NULL.
  const adminCheck = await client.query<{ id: string }>(
    "SELECT id FROM app_users WHERE id = $1 OR email = 'tobias@nordicprofil.no' LIMIT 1",
    [ADMIN_USER_ID],
  );
  const activatedByUserId = adminCheck.rows[0]?.id ?? null;

  // Verifiser at alle 4 hall-IDene faktisk finnes i prod, ellers FK-feil.
  const hallCheck = await client.query<{ id: string }>(
    `SELECT id FROM app_halls WHERE id = ANY($1::text[])`,
    [TEKNOBINGO_HALLS.map((h) => h.hallId)],
  );
  const foundHallIds = new Set(hallCheck.rows.map((r) => r.id));
  const missing = TEKNOBINGO_HALLS.filter(
    (h) => !foundHallIds.has(h.hallId),
  );
  if (missing.length > 0) {
    console.error(
      `[seed-teknobingo-test-players] ABORT — disse hall-IDene finnes ikke i app_halls:`,
    );
    for (const h of missing) {
      console.error(`  - ${h.displayName} (${h.hallId})`);
    }
    console.error(
      `Verifiser hall-IDer mot prod og oppdater TEKNOBINGO_HALLS-konstanten.`,
    );
    process.exit(1);
  }

  const reports: SeedReport[] = [];

  try {
    await client.query("BEGIN");

    for (const hall of TEKNOBINGO_HALLS) {
      const report: SeedReport = {
        hallName: hall.displayName,
        hallId: hall.hallId,
        created: 0,
        alreadyExisted: 0,
        walletTopupOk: 0,
        walletTopupSkipped: 0,
      };

      console.log(`\n== ${hall.displayName} (${hall.hallId}) ==`);

      for (let i = 1; i <= PLAYERS_PER_HALL; i += 1) {
        const userId = `${hall.slugPrefix}-${i}`;
        const email = `${hall.slugPrefix}-${i}@spillorama.no`;
        const displayName = `Pilot ${hall.slugPrefix.replace("pilot-", "")}-${i}`;
        const walletId = `wallet-user-${userId}`;

        const result = await upsertPlayer(client, {
          id: userId,
          email,
          displayName,
          surname: "Pilot",
          hallId: hall.hallId,
        });
        if (result.created) {
          report.created += 1;
        } else {
          report.alreadyExisted += 1;
        }

        const topup = await maybeTopUpPlayerWallet(
          client,
          userId,
          PLAYER_DEPOSIT_MAJOR,
        );
        if (topup.ok) {
          await ensureWalletBootstrapEntry(
            client,
            walletId,
            "deposit",
            PLAYER_DEPOSIT_MAJOR,
          );
          report.walletTopupOk += 1;
        } else {
          report.walletTopupSkipped += 1;
        }

        await upsertHallRegistration(client, {
          id: `reg-${userId}`,
          userId,
          walletId,
          hallId: hall.hallId,
          activatedByUserId,
        });

        const tag = result.created ? "[NEW]" : "[upd]";
        const wTag: string = topup.ok
          ? "wallet=ok"
          : `wallet-skip:${topup.reason}`;
        console.log(`  ${tag} ${email} → reg-${userId} (${wTag})`);
      }

      reports.push(report);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n[seed-teknobingo-test-players] failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }

  // ── Rapport ────────────────────────────────────────────────────────────
  console.log("\n");
  console.log("══════════════════════════════════════════════════════");
  console.log("  TEKNOBINGO PILOT — SEED REPORT");
  console.log("══════════════════════════════════════════════════════");
  let totalCreated = 0;
  let totalExisted = 0;
  let totalWalletOk = 0;
  for (const r of reports) {
    console.log(
      `  ${r.hallName.padEnd(28)} created=${r.created} existed=${r.alreadyExisted} wallet_ok=${r.walletTopupOk}`,
    );
    totalCreated += r.created;
    totalExisted += r.alreadyExisted;
    totalWalletOk += r.walletTopupOk;
  }
  console.log("──────────────────────────────────────────────────────");
  const total = totalCreated + totalExisted;
  console.log(
    `  TOTAL: ${total} spillere ` +
      `(${totalCreated} created, ${totalExisted} existed) — ` +
      `${totalWalletOk} wallets toppet opp`,
  );
  console.log("══════════════════════════════════════════════════════");
  console.log("\nLogin-credentials per spiller:");
  console.log(`  email:    pilot-<hall>-<n>@spillorama.no  (n=1..6)`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log("\nVerification (etter at backend er restarted):");
  console.log(
    `  curl -X POST $BASE/api/agent/players/lookup \\`,
  );
  console.log(
    `    -H "Authorization: Bearer <agent-token>" \\`,
  );
  console.log(
    `    -d '{"query":"pilot-arnes"}'`,
  );
}

main().catch((error) => {
  console.error("[seed-teknobingo-test-players] failed:", error);
  process.exit(1);
});
