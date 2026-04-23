#!/usr/bin/env npx tsx
/**
 * Demo-seed for lokal test av TV-skjerm (PR #411) + Spill 1 bonusspill
 * (Wheel, Chest, Mystery, ColorDraft).
 *
 * Idempotent: kan kjøres flere ganger uten å krasje. Alle INSERTs bruker
 * `ON CONFLICT DO NOTHING` eller `WHERE NOT EXISTS`-sjekker.
 *
 * Seeder:
 *   1) `demo-hall` (aktiv, med tv_token)
 *   2) admin@spillorama.no (ADMIN) + demo-player@spillorama.no (PLAYER)
 *      - Player får 1000 kr topup på deposit-siden.
 *   3) `app_hall_groups` med demo-hallen som eneste medlem (trengs for
 *      daily_schedule + scheduled-games FK).
 *   4) `app_game_management` for Spill 1 (bingo) med alle 4 mini-games
 *      aktivert i `config_json.spill1.miniGames` + pattern-liste
 *      (1-Rad + Full Plate) og billett-farger.
 *   5) `app_schedules` schedule-mal som refererer Spill 1 + én sub-game.
 *   6) `app_daily_schedules` med `otherData.scheduleId` pekende mot malen
 *      (slik at scheduler-tick kan plukke det opp).
 *   7) `app_game1_scheduled_games` — direkte INSERT én rad i status
 *      `purchase_open` slik at admin kan starte spillet NÅ uten å vente
 *      på scheduler-tick.
 *
 * Bruk:
 *   cd apps/backend
 *   npm run seed:demo-tv-bonus
 *
 * Forutsetning: `.env` har `APP_PG_CONNECTION_STRING`. Migrasjoner er kjørt
 * (`npm run migrate`). Scriptet antar at `seed-halls.ts` IKKE trengs — vi
 * oppretter `demo-hall` lokalt så det ikke kolliderer med produksjons-haller.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const scrypt = promisify(scryptCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── Konstanter (samme mønster på tvers av kjøringer = idempotent) ────────────

const HALL_SLUG = "demo-hall";
const HALL_NAME = "Demo Hall (Lokal Test)";
const HALL_GROUP_NAME = "Demo Group (Lokal Test)";

const ADMIN_EMAIL = "admin@spillorama.no";
const ADMIN_PASSWORD = "Admin1234Demo!"; // 12+ tegn, stor+liten+siffer
const ADMIN_DISPLAY = "Demo Admin";
const ADMIN_SURNAME = "Spillorama";

const PLAYER_EMAIL = "demo-player@spillorama.no";
const PLAYER_PASSWORD = "Player1234Demo!";
const PLAYER_DISPLAY = "Demo Player";
const PLAYER_SURNAME = "Testy";
const PLAYER_BIRTH_DATE = "1990-01-01";
const PLAYER_DEPOSIT_MAJOR = 1000; // 1000 NOK major-units

const GAME_MANAGEMENT_ID = "gm-demo-spill1";
const SCHEDULE_ID = "sched-demo-spill1";
const SCHEDULE_NUMBER = "SID_DEMO_SPILL1";
const DAILY_SCHEDULE_ID = "ds-demo-spill1";
const SCHEDULED_GAME_ID = "sg-demo-spill1";

// ── Hash helper (matcher PlatformService.hashPassword) ───────────────────────

async function hashScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

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

  try {
    await client.query("BEGIN");

    // 1) Hall --------------------------------------------------------------
    const hallId = await upsertHall(client);
    console.log(`  ✓ Hall: ${HALL_SLUG} (id=${hallId})`);

    // 2) Admin + Player ----------------------------------------------------
    const adminId = await upsertUser(client, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: ADMIN_DISPLAY,
      surname: ADMIN_SURNAME,
      role: "ADMIN",
      hallId: null,
      birthDate: null,
    });
    console.log(`  ✓ Admin-bruker: ${ADMIN_EMAIL} (id=${adminId})`);

    const playerId = await upsertUser(client, {
      email: PLAYER_EMAIL,
      password: PLAYER_PASSWORD,
      displayName: PLAYER_DISPLAY,
      surname: PLAYER_SURNAME,
      role: "PLAYER",
      hallId,
      birthDate: PLAYER_BIRTH_DATE,
    });
    console.log(`  ✓ Player: ${PLAYER_EMAIL} (id=${playerId})`);

    // Wallet: topup 1000 kr på deposit-siden for player.
    // Kun hvis PostgresWalletAdapter kjører mot samme DB. Hvis wallet er
    // file/memory hopper vi over og advarer — player vil ha 0 kr saldo og
    // må topup via admin-UI.
    const depositResult = await maybeTopUpPlayerWallet(client, playerId);
    if (depositResult.ok) {
      console.log(
        `  ✓ Player deposit: ${PLAYER_DEPOSIT_MAJOR} NOK (wallet_id=${depositResult.walletId})`,
      );
    } else {
      console.log(
        `  · Player wallet topup hoppet over: ${depositResult.reason}`,
      );
    }

    // 3) Hall-gruppe + medlem ---------------------------------------------
    const hallGroupId = await upsertHallGroup(client, hallId);
    console.log(`  ✓ Hall-gruppe: ${HALL_GROUP_NAME} (id=${hallGroupId})`);

    // 4) GameManagement (Spill 1 med 4 mini-games) ------------------------
    await upsertGameManagement(client, adminId);
    console.log(`  ✓ GameManagement: ${GAME_MANAGEMENT_ID} (Spill 1 + 4 mini-games)`);

    // 5) Schedule-mal -----------------------------------------------------
    await upsertSchedule(client, adminId);
    console.log(`  ✓ Schedule-mal: ${SCHEDULE_NUMBER}`);

    // 6) DailySchedule ----------------------------------------------------
    await upsertDailySchedule(client, adminId, hallId, hallGroupId);
    console.log(`  ✓ DailySchedule: ${DAILY_SCHEDULE_ID} (otherData.scheduleId=${SCHEDULE_ID})`);

    // 7) Scheduled game (direkte INSERT så admin kan starte NÅ) ----------
    await upsertScheduledGame(client, hallId, hallGroupId);
    console.log(`  ✓ Scheduled game: ${SCHEDULED_GAME_ID} (status=purchase_open)`);

    // Hent tv_token + print instruksjoner til slutt.
    const { rows: hallRows } = await client.query<{ tv_token: string }>(
      "SELECT tv_token FROM app_halls WHERE id = $1",
      [hallId],
    );
    const tvToken = hallRows[0]?.tv_token ?? "<MANGLER>";

    await client.query("COMMIT");

    printInstructions({ hallId, tvToken });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed-demo-tv-and-bonus] feilet:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// ── Steg-funksjoner ──────────────────────────────────────────────────────────

async function upsertHall(client: Client): Promise<string> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_halls WHERE slug = $1",
    [HALL_SLUG],
  );
  if (existing.rows[0]) {
    // Sørg for aktiv + tv_token satt (ikke NULL).
    await client.query(
      `UPDATE app_halls
         SET is_active = true,
             tv_token = COALESCE(tv_token, gen_random_uuid()::text),
             updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return existing.rows[0].id;
  }
  const id = randomUUID();
  await client.query(
    `INSERT INTO app_halls
       (id, slug, name, region, address, is_active, tv_token)
     VALUES
       ($1, $2, $3, 'NO', 'Storgata 1, 0000 Demo', true, gen_random_uuid()::text)`,
    [id, HALL_SLUG, HALL_NAME],
  );
  return id;
}

interface UpsertUserInput {
  email: string;
  password: string;
  displayName: string;
  surname: string;
  role: "ADMIN" | "PLAYER";
  hallId: string | null;
  birthDate: string | null;
}

async function upsertUser(client: Client, input: UpsertUserInput): Promise<string> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_users WHERE email = $1",
    [input.email],
  );
  if (existing.rows[0]) {
    // Re-sett hall_id hvis mangler (hjelper når seed-halls.ts tidligere kjørte
    // før player fikk hallId).
    if (input.hallId) {
      await client.query(
        `UPDATE app_users SET hall_id = $2, updated_at = now()
         WHERE id = $1 AND hall_id IS NULL`,
        [existing.rows[0].id, input.hallId],
      );
    }
    return existing.rows[0].id;
  }
  const id = randomUUID();
  const walletId = `wallet-user-${id}`;
  const passwordHash = await hashScrypt(input.password);
  await client.query(
    `INSERT INTO app_users
       (id, email, display_name, surname, password_hash, wallet_id, role,
        birth_date, hall_id, compliance_data)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10::jsonb)`,
    [
      id,
      input.email,
      input.displayName,
      input.surname,
      passwordHash,
      walletId,
      input.role,
      input.birthDate,
      input.hallId,
      JSON.stringify({ createdBy: "SEED_DEMO_TV_BONUS" }),
    ],
  );
  return id;
}

/**
 * Topup 1000 kr på player-walleten hvis Postgres wallet-tabeller finnes.
 * Hvis `wallet_accounts`-tabell ikke finnes (file/memory-provider aktiv),
 * hopper vi over og lar admin-UI topup manuelt.
 *
 * NB: Vi dupliserer ikke PostgresWalletAdapter sin forretningslogikk her
 * (deposit_balance + full transaksjon-semantikk). For en demo-bruker er en
 * direkte INSERT tilstrekkelig.
 */
async function maybeTopUpPlayerWallet(
  client: Client,
  playerId: string,
): Promise<{ ok: true; walletId: string } | { ok: false; reason: string }> {
  // Sjekk om wallet_accounts-tabellen finnes (postgres-adapter aktiv).
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'wallet_accounts'
     ) AS exists`,
  );
  if (!rows[0]?.exists) {
    return {
      ok: false,
      reason: "wallet_accounts-tabell finnes ikke (file/memory-provider aktiv — manuell topup via admin-UI)",
    };
  }

  const { rows: userRows } = await client.query<{ wallet_id: string }>(
    "SELECT wallet_id FROM app_users WHERE id = $1",
    [playerId],
  );
  const walletId = userRows[0]?.wallet_id;
  if (!walletId) {
    return { ok: false, reason: "wallet_id mangler på player-raden" };
  }

  // Idempotent: setter deposit_balance direkte hvis konto finnes, eller
  // oppretter med deposit_balance = 1000 (major-units NOK).
  //
  // NB: `balance` er GENERATED ALWAYS AS (deposit_balance + winnings_balance)
  // siden migrasjon 20260606000000_wallet_split_deposit_winnings.sql, så vi
  // kan IKKE INSERT-e inn `balance` direkte.
  try {
    await client.query(
      `INSERT INTO wallet_accounts
         (id, deposit_balance, winnings_balance, is_system, created_at, updated_at)
       VALUES ($1, $2, 0, false, now(), now())
       ON CONFLICT (id) DO UPDATE
         SET deposit_balance = GREATEST(wallet_accounts.deposit_balance, EXCLUDED.deposit_balance),
             updated_at = now()`,
      [walletId, PLAYER_DEPOSIT_MAJOR],
    );
    return { ok: true, walletId };
  } catch (err) {
    return {
      ok: false,
      reason: `wallet_accounts-INSERT feilet: ${(err as Error).message}`,
    };
  }
}

async function upsertHallGroup(client: Client, hallId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_hall_groups WHERE name = $1 AND deleted_at IS NULL",
    [HALL_GROUP_NAME],
  );
  let groupId: string;
  if (existing.rows[0]) {
    groupId = existing.rows[0].id;
  } else {
    groupId = randomUUID();
    await client.query(
      `INSERT INTO app_hall_groups (id, name, status, products_json, extra_json)
       VALUES ($1, $2, 'active', '[]'::jsonb, '{}'::jsonb)`,
      [groupId, HALL_GROUP_NAME],
    );
  }
  // Legg til hall som medlem (idempotent via PK).
  await client.query(
    `INSERT INTO app_hall_group_members (group_id, hall_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [groupId, hallId],
  );
  return groupId;
}

async function upsertGameManagement(client: Client, adminId: string): Promise<void> {
  const configJson = {
    spill1: {
      // Alle 4 mini-games aktivert i rotasjon (wheel → chest → mystery → colordraft).
      // Merk: orchestrator-typen bruker navn "colordraft"/"mystery"/"wheel"/"chest",
      // mens legacy BingoEngine-typen bruker "wheelOfFortune"/"treasureChest"/
      // "mysteryGame"/"colorDraft" for host-player-room-modus. For scheduled-
      // games bruker orchestrator de nye navn (se minigames/types.ts §MINI_GAME_TYPES).
      // Merk: "oddsen" er scheduled-games-frameworkets navn på det som legacy-
// BingoEngine kalte "mysteryGame" (M5-implementasjonen). Gyldige typer er
// wheel | chest | colordraft | oddsen (se minigames/types.ts §MiniGameType).
miniGames: ["wheel", "chest", "colordraft", "oddsen"],
      patterns: [
        { id: "1-rad", name: "1 Rad", claimType: "LINE", prizePercent: 30, order: 1 },
        { id: "full-plate", name: "Full Plate", claimType: "BINGO", prizePercent: 70, order: 2 },
      ],
      ticketColors: ["yellow", "white", "red"],
    },
  };
  await client.query(
    `INSERT INTO app_game_management
       (id, game_type_id, name, ticket_type, ticket_price,
        start_date, end_date, status, config_json, created_by)
     VALUES
       ($1, 'game_1', 'Demo Spill 1 (TV + Bonusspill)', 'Small', 0,
        now() - interval '1 day', now() + interval '30 days', 'active',
        $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE
       SET config_json = EXCLUDED.config_json,
           status = 'active',
           updated_at = now()`,
    [GAME_MANAGEMENT_ID, JSON.stringify(configJson), adminId],
  );
}

async function upsertSchedule(client: Client, adminId: string): Promise<void> {
  // En sub-game: 1-Rad + Full Plate med yellow/white/red billetter.
  // NotificationStartTime "60s" = purchase opens 60 sekunder før start.
  const subGames = [
    {
      name: "Demo Spill 1",
      custom_game_name: "Demo Spill 1",
      start_time: "19:00",
      end_time: "19:30",
      notificationStartTime: "60s",
      minseconds: 30,
      maxseconds: 120,
      seconds: 60,
      ticketTypesData: {
        ticketType: ["yellow", "white", "red"],
        ticketPrice: [500, 1000, 2000],
        ticketPrize: [0, 0, 0],
        options: [],
      },
      jackpotData: {
        jackpotPrize: { white: 0, yellow: 0, purple: 0 },
        jackpotDraw: 0,
      },
      elvisData: { replaceTicketPrice: 0 },
    },
  ];
  await client.query(
    `INSERT INTO app_schedules
       (id, schedule_name, schedule_number, schedule_type,
        lucky_number_prize, status, is_admin_schedule,
        manual_start_time, manual_end_time, sub_games_json, created_by)
     VALUES
       ($1, 'Demo Spill 1 mal', $2, 'Manual',
        0, 'active', true,
        '19:00', '19:30', $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE
       SET sub_games_json = EXCLUDED.sub_games_json,
           status = 'active',
           updated_at = now()`,
    [SCHEDULE_ID, SCHEDULE_NUMBER, JSON.stringify(subGames), adminId],
  );
}

async function upsertDailySchedule(
  client: Client,
  adminId: string,
  hallId: string,
  hallGroupId: string,
): Promise<void> {
  const otherData = { scheduleId: SCHEDULE_ID };
  // Scheduler-ticken forventer groupHallIds[0] — uten dette hopper den over
  // daily_schedule og spawner ikke nye scheduled_games for fremtidige dager.
  // Demo-scheduled-game vi direkte-INSERT-er er uavhengig av dette, men
  // groupHallIds må være satt for at fremtidige ticks skal fungere.
  const hallIdsJson = {
    masterHallId: hallId,
    hallIds: [hallId],
    groupHallIds: [hallGroupId],
  };
  const subgamesJson = [
    {
      subGameId: `${SCHEDULE_ID}-sg0`,
      index: 0,
      ticketPrice: 500,
      prizePool: 0,
      patternId: "full-plate",
      status: "active",
    },
  ];
  await client.query(
    `INSERT INTO app_daily_schedules
       (id, name, game_management_id, hall_id, hall_ids_json,
        week_days, day, start_date, end_date,
        start_time, end_time, status,
        stop_game, special_game, is_saved_game, is_admin_saved_game,
        innsatsen_sales, subgames_json, other_data_json, created_by)
     VALUES
       ($1, 'Demo Spill 1 dagsplan', $2, $3, $4::jsonb,
        127, NULL, now() - interval '1 day', now() + interval '30 days',
        '19:00', '19:30', 'running',
        false, false, false, false,
        0, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (id) DO UPDATE
       SET status = 'running',
           stop_game = false,
           other_data_json = EXCLUDED.other_data_json,
           subgames_json = EXCLUDED.subgames_json,
           updated_at = now()`,
    [
      DAILY_SCHEDULE_ID,
      GAME_MANAGEMENT_ID,
      hallId,
      JSON.stringify(hallIdsJson),
      JSON.stringify(subgamesJson),
      JSON.stringify(otherData),
      adminId,
    ],
  );
}

async function upsertScheduledGame(
  client: Client,
  hallId: string,
  hallGroupId: string,
): Promise<void> {
  // Direkte INSERT av scheduled_game i status 'purchase_open' slik at
  // admin kan starte NÅ. Scheduler-ticken vil ikke spawne duplikat pga
  // UNIQUE (daily_schedule_id, scheduled_day, sub_game_index).
  const ticketConfig = {
    ticketType: ["yellow", "white", "red"],
    ticketPrice: [500, 1000, 2000],
    ticketPrize: [0, 0, 0],
  };
  const jackpotConfig = {
    jackpotPrize: { white: 0, yellow: 0, purple: 0 },
    jackpotDraw: 0,
  };
  const gameConfig = {
    spill1: {
      // Merk: "oddsen" er scheduled-games-frameworkets navn på det som legacy-
// BingoEngine kalte "mysteryGame" (M5-implementasjonen). Gyldige typer er
// wheel | chest | colordraft | oddsen (se minigames/types.ts §MiniGameType).
miniGames: ["wheel", "chest", "colordraft", "oddsen"],
      patterns: [
        { id: "1-rad", name: "1 Rad", claimType: "LINE", prizePercent: 30, order: 1 },
        { id: "full-plate", name: "Full Plate", claimType: "BINGO", prizePercent: 70, order: 2 },
      ],
      ticketColors: ["yellow", "white", "red"],
    },
  };
  const today = new Date();
  const yyyyMmDd = today.toISOString().slice(0, 10);
  const startTime = new Date(today.getTime() + 60_000); // start om 60s
  const endTime = new Date(today.getTime() + 60 * 60_000); // +1t

  await client.query(
    `INSERT INTO app_game1_scheduled_games
       (id, daily_schedule_id, schedule_id,
        sub_game_index, sub_game_name, custom_game_name,
        scheduled_day, scheduled_start_time, scheduled_end_time,
        notification_start_seconds,
        ticket_config_json, jackpot_config_json, game_config_json,
        game_mode,
        master_hall_id, group_hall_id, participating_halls_json,
        status, excluded_hall_ids_json)
     VALUES
       ($1, $2, $3,
        0, 'Demo Spill 1', 'Demo Spill 1',
        $4::date, $5::timestamptz, $6::timestamptz,
        60,
        $7::jsonb, $8::jsonb, $9::jsonb,
        'Manual',
        $10, $11, $12::jsonb,
        'purchase_open', '[]'::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET status = CASE
             WHEN app_game1_scheduled_games.status IN ('completed', 'cancelled')
             THEN 'purchase_open'
             ELSE app_game1_scheduled_games.status
           END,
           game_config_json = EXCLUDED.game_config_json,
           scheduled_start_time = EXCLUDED.scheduled_start_time,
           scheduled_end_time = EXCLUDED.scheduled_end_time,
           scheduled_day = EXCLUDED.scheduled_day,
           actual_start_time = NULL,
           actual_end_time = NULL,
           updated_at = now()`,
    [
      SCHEDULED_GAME_ID,
      DAILY_SCHEDULE_ID,
      SCHEDULE_ID,
      yyyyMmDd,
      startTime.toISOString(),
      endTime.toISOString(),
      JSON.stringify(ticketConfig),
      JSON.stringify(jackpotConfig),
      JSON.stringify(gameConfig),
      hallId,
      hallGroupId,
      JSON.stringify([hallId]),
    ],
  );
}

// ── Utskrift ─────────────────────────────────────────────────────────────────

function printInstructions(args: { hallId: string; tvToken: string }): void {
  const { hallId, tvToken } = args;
  const line = "─".repeat(72);
  console.log("");
  console.log("✓ Demo-data seedet.");
  console.log(line);
  console.log("Backend:        http://localhost:4000");
  console.log("Admin-web:      http://localhost:5174/admin/");
  console.log("Game-client:    via admin-web dev-server (se runbook)");
  console.log("");
  console.log(`Admin login:    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Player login:   ${PLAYER_EMAIL} / ${PLAYER_PASSWORD}`);
  console.log("");
  console.log(`Hall:           ${HALL_SLUG} (id: ${hallId})`);
  console.log(
    `TV-URL:         http://localhost:5174/admin/#/tv/${hallId}/${tvToken}`,
  );
  console.log(
    `Winners-URL:    http://localhost:5174/admin/#/tv/${hallId}/${tvToken}/winners`,
  );
  console.log(line);
  console.log("");
  console.log("Neste steg — se docs/operations/LOCAL_TEST_TV_AND_MINIGAMES.md");
}

main().catch((error) => {
  console.error("[seed-demo-tv-and-bonus] uventet feil:", error);
  process.exit(1);
});
