#!/usr/bin/env node
/**
 * scripts/dev/reset-state.mjs
 *
 * Lokal "nullstill state"-script. Tømmer alle pågående spillrunder, resetter
 * test-spiller-saldoer, og lar deg starte fra fresh state — uten å måtte
 * dropdate hele DB-en.
 *
 * Skal IKKE påvirke struktur (tabeller / indekser); den treffer kun
 * runtime-data og test-bruker-data.
 *
 * Idempotent. Trygg å kjøre selv om DB er tom.
 *
 * Bruk:
 *   npm run dev:reset
 *
 * Hva som skjer:
 *   1. Slett alle game_sessions / game_checkpoints (in-progress runder)
 *   2. Slett alle Redis room-state-keys (room:* og lock:*)
 *   3. Slett wallet-transaksjoner for demo-spillere — beholder konto, men
 *      reset saldo til 5000 NOK på deposit-siden via en OPS-correction.
 *   4. Slett pending payment_requests for demo-spillere
 *   5. Print sammendrag
 *
 * Sikkerhet:
 *   Vi nekter å kjøre hvis DB-en ikke er en "demo"-DB (sjekk: kun lov hvis
 *   ingen ikke-demo-spillere har transaksjoner i siste 24t — heuristikk).
 *   Override med RESET_FORCE=1 hvis du virkelig vil.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename2 = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filename2);
const ROOT_LOCAL = path.resolve(__dirnameLocal, "../..");

// pg, dotenv, ioredis ligger i root node_modules (workspace-hoisted) eller
// i apps/backend/node_modules. createRequire gir oss CJS-imports.
const require = createRequire(import.meta.url);

function resolveDep(name, optional = false) {
  const candidates = [
    path.join(ROOT_LOCAL, "node_modules", name),
    path.join(ROOT_LOCAL, "apps/backend/node_modules", name),
  ];
  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* fall through */
    }
  }
  if (optional) return null;
  throw new Error(
    `Kunne ikke laste '${name}' fra ${candidates.join(" eller ")}. Kjør 'npm install' fra root.`,
  );
}

const dotenv = resolveDep("dotenv");
const pg = resolveDep("pg");
const ioredisModule = resolveDep("ioredis", true);
const Redis = ioredisModule?.default ?? ioredisModule ?? null;

// Plukk .env fra apps/backend så vi har samme connection-string som backend
dotenv.config({ path: path.join(ROOT_LOCAL, "apps/backend/.env") });

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
function color(name, t) {
  if (!process.stdout.isTTY) return t;
  return `${COLORS[name] ?? ""}${t}${COLORS.reset}`;
}
function step(label) {
  console.log(color("cyan", `▸ ${label}`));
}

// ── Sikkerhetssjekk ─────────────────────────────────────────────────────────

async function assertSafeToReset(client) {
  if (process.env.RESET_FORCE === "1") {
    console.log(color("yellow", "[reset] RESET_FORCE=1 — hopper sikkerhetssjekk"));
    return;
  }
  // Heuristikk: hvis det finnes brukere med email som IKKE matcher
  // demo-mønstrene OG som har hatt transaksjoner siste 7 dager, NEKT.
  const result = await client.query(
    `SELECT COUNT(*)::int AS cnt
       FROM app_users u
       JOIN wallet_transactions t ON t.wallet_id = u.wallet_id
      WHERE u.email NOT LIKE 'demo-%@%'
        AND u.email NOT LIKE '%@example.com'
        AND u.email NOT LIKE 'tobias@%'
        AND t.created_at > now() - interval '7 days'`
  );
  const nonDemoActivity = result.rows[0]?.cnt ?? 0;
  if (nonDemoActivity > 0) {
    console.error(
      color(
        "red",
        `[reset] ABORTERT: fant ${nonDemoActivity} transaksjoner siste 7 dager fra ikke-demo-brukere. Dette ser ikke ut til å være en demo-DB.`
      )
    );
    console.error(
      color("red", "[reset] Sett RESET_FORCE=1 hvis du virkelig vil fortsette.")
    );
    process.exit(2);
  }
}

// ── Hovedlogikk ─────────────────────────────────────────────────────────────

async function resetGameSessions(client) {
  step("Sletter pågående spillrunder (game_sessions / checkpoints)");
  const sessions = await client.query("DELETE FROM game_checkpoints");
  console.log(`  ${color("dim", `slettet ${sessions.rowCount ?? 0} checkpoints`)}`);
  const gs = await client.query("DELETE FROM game_sessions");
  console.log(`  ${color("dim", `slettet ${gs.rowCount ?? 0} game_sessions`)}`);
}

async function resetPaymentRequests(client) {
  step("Sletter pending payment_requests fra demo-spillere");
  // Sjekk at tabellen finnes — kan være rensigninger som ikke har migrering
  const exists = await client.query(
    `SELECT to_regclass('public.app_payment_requests') AS t`
  );
  if (!exists.rows[0]?.t) {
    console.log(color("dim", "  app_payment_requests finnes ikke — hopper"));
    return;
  }
  const result = await client.query(
    `DELETE FROM app_payment_requests
       WHERE user_id IN (
         SELECT id FROM app_users
          WHERE email LIKE 'demo-%@%' OR email LIKE '%@example.com'
       )
         AND status = 'PENDING'`
  );
  console.log(`  ${color("dim", `slettet ${result.rowCount ?? 0} pending requests`)}`);
}

async function resetWallets(client) {
  step("Resetter demo-spiller-saldoer til 5000 NOK");
  // Vi trekker en correction-tx slik at saldo lander på 5000 NOK
  const usersRes = await client.query(
    `SELECT u.id, u.email, u.wallet_id, w.deposit_balance, w.winnings_balance
       FROM app_users u
       LEFT JOIN wallet_accounts w ON w.id = u.wallet_id
      WHERE u.email LIKE 'demo-%@%' OR u.email LIKE '%@example.com'`
  );
  const targetCents = 5000 * 100;
  let updated = 0;
  for (const row of usersRes.rows) {
    if (!row.wallet_id) continue;
    // Direkte UPDATE av wallet — vi går rundt vanlig pengeflyt fordi dette
    // er en lokal-test-helper. ALDRI bruk denne mot prod-DB.
    await client.query(
      `UPDATE wallet_accounts
          SET deposit_balance = $2,
              winnings_balance = 0,
              updated_at = now()
        WHERE id = $1`,
      [row.wallet_id, targetCents]
    );
    updated += 1;
  }
  console.log(`  ${color("dim", `oppdaterte ${updated} demo-wallets til 5000 NOK`)}`);
}

async function resetRedis() {
  step("Tømmer Redis room-state og locks");
  if (!Redis) {
    console.log(
      color("yellow", "  ioredis ikke funnet — hopper Redis-rensing")
    );
    return;
  }
  const redisUrl =
    process.env.REDIS_URL ??
    (process.env.REDIS_HOST
      ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT ?? 6379}`
      : "redis://localhost:6379");
  let client;
  try {
    client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // ikke prøv på nytt — bare fail-fast
    });
    await client.connect();

    // Pattern-scan + delete alle nøkler under kjente prefixer
    const patterns = [
      "room:*",
      "lock:*",
      "ticket:*",
      "game1:*",
      "game2:*",
      "game3:*",
      "spinngo:*",
    ];
    let totalDeleted = 0;
    for (const pat of patterns) {
      let cursor = "0";
      do {
        const [next, keys] = await client.scan(cursor, "MATCH", pat, "COUNT", 100);
        cursor = next;
        if (keys.length > 0) {
          const dCount = await client.del(...keys);
          totalDeleted += dCount;
        }
      } while (cursor !== "0");
    }
    console.log(`  ${color("dim", `slettet ${totalDeleted} Redis-nøkler`)}`);
    await client.quit();
  } catch (err) {
    console.log(
      color("yellow", `  Redis ikke tilgjengelig (${err.message}) — hopper`)
    );
    if (client) {
      try {
        client.disconnect();
      } catch {
        /* swallow */
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(color("bold", "Spillorama Local State Reset"));
  console.log(color("dim", "Sletter runtime-state og resetter demo-saldoer"));
  console.log("");

  const conn =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING;
  if (!conn) {
    console.error(
      color(
        "red",
        "[reset] mangler APP_PG_CONNECTION_STRING (eller WALLET_PG_CONNECTION_STRING) i miljø"
      )
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: conn });
  await client.connect();

  try {
    await assertSafeToReset(client);
    await resetGameSessions(client);
    await resetPaymentRequests(client);
    await resetWallets(client);
  } finally {
    await client.end();
  }

  await resetRedis();

  console.log("");
  console.log(color("green", "✓ State nullstilt"));
  console.log(
    color(
      "dim",
      "  Test-spillere har 5000 NOK på depositkonto. Pågående runder slettet."
    )
  );
  console.log("");
}

main().catch((err) => {
  console.error(color("red", `[reset] feil: ${err.stack ?? err.message}`));
  process.exit(1);
});
