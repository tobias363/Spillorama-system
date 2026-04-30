#!/usr/bin/env npx tsx
/**
 * Seed-demo: komplett pilot-dag-state for end-to-end demo (admin + agent +
 * spillere kan logge inn og se levende data).
 *
 * Idempotent: kan kjøres flere ganger uten å krasje. Alle INSERTs bruker
 * `ON CONFLICT DO NOTHING / DO UPDATE` eller eksisterer-sjekker.
 *
 * Seeder:
 *   1) `demo-hall` (Hall Number 999, navnet "Demo Bingohall", aktiv) med
 *      tv_token og en konservativ adresse.
 *   2) Hall-gruppe "Demo GoH" med demo-hallen som master + medlem.
 *   3) GameType-katalog-rad for Spill 1 (slug `bingo`) inn i
 *      `app_game_management` med 8 ticket-farger og pattern-priser per farge
 *      (Rad 1-4 + Fullt Hus).
 *   4) Fire sub-games i `app_sub_games` — én per mini-game-type i Game 1-
 *      rotasjonen (Wheel of Fortune, Treasure Chest, Mystery Joker,
 *      ColorDraft) med pattern-rad + 8 farge-array (Small/Large ×
 *      Yellow/White/Purple + Red + Green). Stable IDs gjør re-runs
 *      idempotente. BIN-804 F1.
 *   5) Schedule-mal i `app_schedules` (Mon-Sun 18:00-22:00) som bundler
 *      alle 4 sub-games i `sub_games_json`.
 *   6) DailySchedule for I DAG og I MORGEN status=active koblet til
 *      hall + hall-gruppe + game-management. Refererer alle 4 sub-games
 *      i `subgames_json` slik at agenten kan rotere gjennom hele mini-
 *      game-katalogen i én demo-dag.
 *   7) Admin-bruker `demo-admin@spillorama.no` (role=ADMIN).
 *   8) Agent-bruker `demo-agent@spillorama.no` (role=AGENT) tilknyttet
 *      demo-hallen som primaryHallId via `app_agent_halls` med is_primary.
 *   9) 3 spillere `demo-spiller-1@example.com` ... `-3@example.com` med
 *      hallId=demo-hall, KYC=VERIFIED, 500 kr i wallet (deposit_balance).
 *  10) `app_hall_registrations`-rader (status=ACTIVE) for hver demo-spiller
 *      slik at agentens player-lookup (`searchPlayersInHall`) faktisk finner
 *      dem. JOIN-en i PlatformService krever `r.status = 'ACTIVE'`, så uten
 *      dette får agent-portalen tomme søkeresultater. Stable id-er
 *      (`reg-<userId>`) gjør re-runs idempotente.
 *
 * Bruk:
 *   cd apps/backend
 *   npm run seed:demo-pilot-day
 *
 * Forutsetning: `.env` har `APP_PG_CONNECTION_STRING`. Migrasjoner er kjørt
 * (`npm run migrate`).
 *
 * Override passord: sett `DEMO_SEED_PASSWORD` i env. Default er
 * `Spillorama123!` (12+ tegn med stor + liten + siffer + symbol).
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

// ── Konstanter (samme over kjøringer = idempotent) ──────────────────────────

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";

// Stabile id-er — gjør re-kjøring trygt og output-link stabilt.
const HALL_ID = "demo-hall-999";
const HALL_SLUG = "demo-hall";
const HALL_NUMBER = 999;
const HALL_NAME = "Demo Bingohall";
const HALL_ADDRESS = "Demogata 1, 0000 Demo";

const HALL_GROUP_ID = "demo-goh";
const HALL_GROUP_NAME = "Demo GoH";

const GAME_MANAGEMENT_ID = "demo-gm-spill1";
const SCHEDULE_ID = "demo-sched-spill1";
const SCHEDULE_NUMBER = "SID_DEMO_SPILL1";
const DAILY_SCHEDULE_TODAY_ID = "demo-ds-today";
const DAILY_SCHEDULE_TOMORROW_ID = "demo-ds-tomorrow";

/**
 * BIN-804 (F1): 4 sub-games — én per mini-game-type i `MINIGAME_ROTATION`
 * (BingoEngineMiniGames.ts:47-52). Stable IDs gjør re-runs idempotente.
 *
 * Mini-game-rotasjonen skjer engine-side (rotasjonen leser ikke sub-game-
 * navn), så sub-gamen er kun en label/preset for admin/agent-UI. Vi gir
 * hvert sub-game en kjenbar tittel slik at agent kan velge presens som
 * matcher det mini-game som planlegges spilt — i en demo-flyt der vi
 * ønsker å rotere gjennom alle 4 mini-game-typer.
 */
interface DemoSubGame {
  id: string;
  number: string;
  name: string;
  // Brukes som sub-game-slug i admin-UI; matcher MiniGamesConfigService-
  // type-feltet ("wheel"/"chest"/"mystery"/"colordraft").
  miniGameSlug: string;
}

const SUB_GAMES: readonly DemoSubGame[] = [
  {
    id: "demo-sg-wheel",
    number: "SG_DEMO_WHEEL",
    name: "Wheel of Fortune",
    miniGameSlug: "wheel",
  },
  {
    id: "demo-sg-chest",
    number: "SG_DEMO_CHEST",
    name: "Treasure Chest",
    miniGameSlug: "chest",
  },
  {
    id: "demo-sg-mystery",
    number: "SG_DEMO_MYSTERY",
    name: "Mystery Joker",
    miniGameSlug: "mystery",
  },
  {
    id: "demo-sg-colordraft",
    number: "SG_DEMO_COLORDRAFT",
    name: "ColorDraft",
    miniGameSlug: "colordraft",
  },
];

const ADMIN_ID = "demo-user-admin";
const ADMIN_EMAIL = "demo-admin@spillorama.no";
const ADMIN_DISPLAY = "Demo Admin";
const ADMIN_SURNAME = "Spillorama";

const AGENT_ID = "demo-user-agent";
const AGENT_EMAIL = "demo-agent@spillorama.no";
const AGENT_DISPLAY = "Demo Agent";
const AGENT_SURNAME = "Bingovert";

interface DemoPlayer {
  id: string;
  email: string;
  displayName: string;
}

const PLAYERS: DemoPlayer[] = [
  { id: "demo-user-spiller-1", email: "demo-spiller-1@example.com", displayName: "Demo Spiller 1" },
  { id: "demo-user-spiller-2", email: "demo-spiller-2@example.com", displayName: "Demo Spiller 2" },
  { id: "demo-user-spiller-3", email: "demo-spiller-3@example.com", displayName: "Demo Spiller 3" },
];

const PLAYER_BIRTH_DATE = "1990-01-01";
const PLAYER_DEPOSIT_MAJOR = 500; // 500 NOK på deposit-siden av wallet

// 8 ticket-farger per Tobias-vedtak (LEGACY_1_TO_1_MAPPING_2026-04-23 §8 #3).
// Backend matcher dem til prizes per phase per farge.
const TICKET_COLORS = [
  "smallYellow",
  "largeYellow",
  "smallWhite",
  "largeWhite",
  "smallPurple",
  "largePurple",
  "red",
  "green",
] as const;

// ── Hash helper (matcher PlatformService.hashPassword) ──────────────────────

async function hashScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

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

    // 1) Hall ----------------------------------------------------------------
    await upsertHall(client);
    console.log(`  [hall]            ${HALL_SLUG} (id=${HALL_ID}, hallNumber=${HALL_NUMBER})`);

    // 2) Hall-gruppe + medlemskap -------------------------------------------
    await upsertHallGroup(client);
    await ensureHallGroupMember(client, HALL_GROUP_ID, HALL_ID);
    console.log(`  [hall-group]      ${HALL_GROUP_NAME} (id=${HALL_GROUP_ID}) -> master ${HALL_ID}`);

    // 3) Admin-bruker --------------------------------------------------------
    await upsertUser(client, {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      displayName: ADMIN_DISPLAY,
      surname: ADMIN_SURNAME,
      role: "ADMIN",
      hallId: null,
      birthDate: null,
      kycStatus: "VERIFIED",
    });
    console.log(`  [admin]           ${ADMIN_EMAIL} (id=${ADMIN_ID})`);

    // 4) Agent-bruker + hall-tildeling --------------------------------------
    await upsertUser(client, {
      id: AGENT_ID,
      email: AGENT_EMAIL,
      displayName: AGENT_DISPLAY,
      surname: AGENT_SURNAME,
      role: "AGENT",
      hallId: HALL_ID, // Behold også som primary i app_users.hall_id (legacy 1:1)
      birthDate: null,
      kycStatus: "VERIFIED",
    });
    await ensureAgentHallAssignment(client, AGENT_ID, HALL_ID, ADMIN_ID);
    console.log(`  [agent]           ${AGENT_EMAIL} (id=${AGENT_ID}) primaryHall=${HALL_ID}`);

    // 5) Spillere + wallet topup + hall-registrering ------------------------
    // Hall-registrering (app_hall_registrations status=ACTIVE) er PÅKREVD for
    // at agent-portalens player-lookup (`searchPlayersInHall` i
    // PlatformService) skal finne spilleren — JOIN-en der filtrerer på
    // `r.hall_id = X AND r.status = 'ACTIVE'`. Uten denne raden returnerer
    // søket alltid 0 treff, selv om `app_users.hall_id` peker til hallen.
    for (const player of PLAYERS) {
      await upsertUser(client, {
        id: player.id,
        email: player.email,
        displayName: player.displayName,
        surname: "Demo",
        role: "PLAYER",
        hallId: HALL_ID,
        birthDate: PLAYER_BIRTH_DATE,
        kycStatus: "VERIFIED",
      });
      const topup = await maybeTopUpPlayerWallet(client, player.id, PLAYER_DEPOSIT_MAJOR);
      const tag = topup.ok
        ? `wallet=${topup.walletId} (${PLAYER_DEPOSIT_MAJOR} NOK)`
        : `wallet topup hoppet over: ${topup.reason}`;
      console.log(`  [player]          ${player.email} (id=${player.id}) ${tag}`);

      // Wallet-id er stabilt: `wallet-user-<userId>` (matcher upsertUser).
      const walletId = `wallet-user-${player.id}`;
      const registrationId = `reg-${player.id}`;
      await upsertHallRegistration(client, {
        id: registrationId,
        userId: player.id,
        walletId,
        hallId: HALL_ID,
        activatedByUserId: ADMIN_ID,
      });
      console.log(`  [hall-reg]        ${registrationId} (user=${player.id}, hall=${HALL_ID}, status=ACTIVE)`);
    }

    // 6) GameManagement (Spill 1) -------------------------------------------
    await upsertGameManagement(client, ADMIN_ID);
    console.log(`  [game-management] ${GAME_MANAGEMENT_ID} (Spill 1, slug=bingo)`);

    // 7) SubGames (4 stk — én per mini-game-type) ---------------------------
    for (const sg of SUB_GAMES) {
      await upsertSubGame(client, ADMIN_ID, sg);
      console.log(
        `  [sub-game]        ${sg.id} (${sg.name}, mini-game=${sg.miniGameSlug}, 8 ticket-farger)`,
      );
    }

    // 8) Schedule-mal (Mon-Sun 18:00-22:00) ---------------------------------
    await upsertSchedule(client, ADMIN_ID);
    console.log(`  [schedule]        ${SCHEDULE_NUMBER} (id=${SCHEDULE_ID}, Mon-Sun 18:00-22:00)`);

    // 9) DailySchedule for i dag + i morgen ---------------------------------
    const today = startOfDayUtc(new Date());
    const tomorrow = new Date(today.getTime() + 24 * 3_600_000);
    await upsertDailySchedule(
      client,
      DAILY_SCHEDULE_TODAY_ID,
      "Demo dagsplan (i dag)",
      today,
      ADMIN_ID,
    );
    await upsertDailySchedule(
      client,
      DAILY_SCHEDULE_TOMORROW_ID,
      "Demo dagsplan (i morgen)",
      tomorrow,
      ADMIN_ID,
    );
    console.log(
      `  [daily-schedule]  i dag=${today.toISOString().slice(0, 10)} | i morgen=${tomorrow
        .toISOString()
        .slice(0, 10)}`,
    );

    // Hent ut tv_token for utskrift (kun hvis kolonnen finnes).
    let tvToken = "<ikke konfigurert>";
    if (await columnExists(client, "app_halls", "tv_token")) {
      const { rows: hallRows } = await client.query<{ tv_token: string | null }>(
        "SELECT tv_token FROM app_halls WHERE id = $1",
        [HALL_ID],
      );
      tvToken = hallRows[0]?.tv_token ?? "<MANGLER>";
    }

    await client.query("COMMIT");

    printInstructions(tvToken);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed-demo-pilot-day] feilet:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// ── Steg-funksjoner ─────────────────────────────────────────────────────────

async function upsertHall(client: Client): Promise<void> {
  // INSERT med ON CONFLICT på primary key (id) — idempotent. Setter også
  // tv_token første gang hvis kolonnen finnes (ble lagt til i 20260423).
  // hall_number ble lagt til i 20260701 — inkluderes i INSERT med fallback til
  // NULL dersom kolonnen ikke finnes (defensiv mot eldre snapshot).
  const tvTokenCol = await columnExists(client, "app_halls", "tv_token");
  const hallNumberCol = await columnExists(client, "app_halls", "hall_number");

  // Bygg dynamisk INSERT: standard-kolonner + valgfrie hall_number + tv_token.
  const cols = ["id", "slug", "name", "region", "address", "is_active"];
  const placeholders = ["$1", "$2", "$3", "'NO'", "$4", "true"];
  const values: unknown[] = [HALL_ID, HALL_SLUG, HALL_NAME, HALL_ADDRESS];
  let nextIdx = values.length + 1;

  if (hallNumberCol) {
    cols.push("hall_number");
    placeholders.push(`$${nextIdx++}`);
    values.push(HALL_NUMBER);
  }
  if (tvTokenCol) {
    cols.push("tv_token");
    placeholders.push(`gen_random_uuid()::text`);
  }

  // ON CONFLICT (id) for idempotent re-runs. Ved oppdatering setter vi navn/
  // adresse/aktiv/hall_number, men beholder tv_token (genereres bare ved
  // første INSERT så det er stabilt på tvers av kjøringer).
  const updateSet = [
    "slug = EXCLUDED.slug",
    "name = EXCLUDED.name",
    "address = EXCLUDED.address",
    "is_active = true",
    "updated_at = now()",
  ];
  if (hallNumberCol) updateSet.push("hall_number = EXCLUDED.hall_number");
  // tv_token oppdateres ikke — bevar genererte token.

  const sql = `
    INSERT INTO app_halls (${cols.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (id) DO UPDATE
      SET ${updateSet.join(", ")}
  `;
  await client.query(sql, values);

  // Hvis tv_token-kolonnen finnes men er NULL fra en gammel rad, fyll inn nå.
  if (tvTokenCol) {
    await client.query(
      `UPDATE app_halls
         SET tv_token = gen_random_uuid()::text,
             updated_at = now()
       WHERE id = $1 AND tv_token IS NULL`,
      [HALL_ID],
    );
  }
}

async function upsertHallGroup(client: Client): Promise<void> {
  // app_hall_groups schema: BIN-665 har deleted_at + status + name UNIQUE
  // (partial). Vi setter et stabilt id slik at re-runs er idempotente.
  await client.query(
    `INSERT INTO app_hall_groups (id, name, status, products_json, extra_json, created_by)
     VALUES ($1, $2, 'active', '[]'::jsonb, '{}'::jsonb, NULL)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           status = 'active',
           deleted_at = NULL,
           updated_at = now()`,
    [HALL_GROUP_ID, HALL_GROUP_NAME],
  );
}

async function ensureHallGroupMember(
  client: Client,
  groupId: string,
  hallId: string,
): Promise<void> {
  // PRIMARY KEY (group_id, hall_id) sikrer idempotens.
  await client.query(
    `INSERT INTO app_hall_group_members (group_id, hall_id)
     VALUES ($1, $2)
     ON CONFLICT (group_id, hall_id) DO NOTHING`,
    [groupId, hallId],
  );
}

interface UpsertUserInput {
  id: string;
  email: string;
  displayName: string;
  surname: string;
  role: "ADMIN" | "PLAYER" | "AGENT";
  hallId: string | null;
  birthDate: string | null;
  kycStatus: "PENDING" | "VERIFIED" | "REJECTED" | "UNVERIFIED";
}

async function upsertUser(client: Client, input: UpsertUserInput): Promise<void> {
  // Stabilt wallet_id som matcher user_id-konvensjonen i seed-demo-tv-and-bonus.
  const walletId = `wallet-user-${input.id}`;

  // Sørg for at kontoen eksisterer i wallet_accounts før vi peker fra
  // app_users (FK), slik at INSERT ikke feiler på UNIQUE wallet_id.
  await ensureWalletAccount(client, walletId);

  // Sjekk om brukeren finnes — vi vil bevare passord-hashen ved re-runs så vi
  // ikke utilsiktet roterer og inntreffer en lockout. Hvis brukeren ikke
  // finnes genererer vi ny hash.
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_users WHERE id = $1 OR email = $2 LIMIT 1",
    [input.id, input.email],
  );

  const kycVerifiedAt = input.kycStatus === "VERIFIED" ? "now()" : "NULL";

  if (existing.rows[0]) {
    // Oppdater profil-felt + KYC-status, men la passord stå urørt.
    const sql = `UPDATE app_users
                   SET email = $2,
                       display_name = $3,
                       surname = $4,
                       role = $5,
                       hall_id = $6,
                       birth_date = $7::date,
                       kyc_status = $8,
                       kyc_verified_at = ${kycVerifiedAt},
                       updated_at = now()
                 WHERE id = $1`;
    await client.query(sql, [
      input.id,
      input.email,
      input.displayName,
      input.surname,
      input.role,
      input.hallId,
      input.birthDate,
      input.kycStatus,
    ]);
    return;
  }

  // Ny rad — genrer passord-hash og INSERT med stabilt id + wallet_id.
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
    "$7",
    "$8",
    "$9::date",
    `'{"createdBy":"SEED_DEMO_PILOT_DAY"}'::jsonb`,
  ];
  const values: unknown[] = [
    input.id,
    input.email,
    input.displayName,
    input.surname,
    passwordHash,
    walletId,
    input.role,
    input.kycStatus,
    input.birthDate,
  ];

  if (hasHallId) {
    cols.push("hall_id");
    placeholders.push(`$${values.length + 1}`);
    values.push(input.hallId);
  }
  if (input.kycStatus === "VERIFIED") {
    cols.push("kyc_verified_at");
    placeholders.push("now()");
  }

  await client.query(
    `INSERT INTO app_users (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})`,
    values,
  );
}

async function ensureAgentHallAssignment(
  client: Client,
  userId: string,
  hallId: string,
  assignedByUserId: string | null,
): Promise<void> {
  // app_agent_halls: PK (user_id, hall_id), partial unique on is_primary
  // per user. Vi setter is_primary=true her og dropper evt. annen primary
  // for samme user først (matcher AgentStore.assignHall-logikken).
  await client.query(
    `UPDATE app_agent_halls SET is_primary = false
       WHERE user_id = $1 AND is_primary AND hall_id <> $2`,
    [userId, hallId],
  );
  await client.query(
    `INSERT INTO app_agent_halls (user_id, hall_id, is_primary, assigned_by_user_id)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (user_id, hall_id) DO UPDATE
       SET is_primary = true,
           assigned_by_user_id = EXCLUDED.assigned_by_user_id`,
    [userId, hallId, assignedByUserId],
  );
}

interface UpsertHallRegistrationInput {
  id: string;
  userId: string;
  walletId: string;
  hallId: string;
  activatedByUserId: string | null;
}

/**
 * Sørger for at en spiller har en ACTIVE hall-registrering, slik at
 * agent-portalens player-lookup faktisk finner spilleren.
 *
 * Skjema (`app_hall_registrations`, BIN-583/initial_schema):
 *   id PK, user_id FK, wallet_id, hall_id FK, status
 *   ('PENDING'|'ACTIVE'|'INACTIVE'|'BLOCKED'), requested_at,
 *   activated_at, activated_by_user_id FK, created_at, updated_at,
 *   UNIQUE (user_id, hall_id).
 *
 * Vi bruker `ON CONFLICT (id)` for å være idempotent, og bevarer en
 * eksisterende `activated_at` (`COALESCE`) så vi ikke ruller fram
 * tidsstempelet på re-runs. UNIQUE (user_id, hall_id) gjør at vi heller
 * ikke kan duplisere raden via konkurrerende kjøringer.
 */
async function upsertHallRegistration(
  client: Client,
  input: UpsertHallRegistrationInput,
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
           activated_by_user_id = COALESCE(app_hall_registrations.activated_by_user_id, EXCLUDED.activated_by_user_id),
           updated_at = now()`,
    [input.id, input.userId, input.walletId, input.hallId, input.activatedByUserId],
  );
}

async function ensureWalletAccount(client: Client, walletId: string): Promise<void> {
  // wallet_accounts.balance er GENERATED ALWAYS AS (deposit + winnings) etter
  // 20260606 wallet_split_deposit_winnings. Vi setter deposit_balance via en
  // separat helper (maybeTopUpPlayerWallet), så her oppretter vi bare en
  // tom konto hvis den ikke finnes.
  const hasDepositBalance = await columnExists(client, "wallet_accounts", "deposit_balance");
  if (hasDepositBalance) {
    await client.query(
      `INSERT INTO wallet_accounts (id, deposit_balance, winnings_balance, is_system)
       VALUES ($1, 0, 0, false)
       ON CONFLICT (id) DO NOTHING`,
      [walletId],
    );
  } else {
    // Pre-split fallback: balance er en vanlig kolonne.
    await client.query(
      `INSERT INTO wallet_accounts (id, balance, is_system)
       VALUES ($1, 0, false)
       ON CONFLICT (id) DO NOTHING`,
      [walletId],
    );
  }
}

/**
 * Sett deposit_balance ≥ amount for spilleren. Bruker `GREATEST` så
 * re-kjøring ikke senker en allerede-større saldo (og dermed ikke utilsiktet
 * fjerner penger en operatør har topput senere). Returns ok-flag som lar
 * scriptet rapportere status uten å feile hele transaksjonen.
 */
async function maybeTopUpPlayerWallet(
  client: Client,
  userId: string,
  amountMajor: number,
): Promise<{ ok: true; walletId: string } | { ok: false; reason: string }> {
  // Sjekk om wallet_accounts-tabellen finnes (postgres-adapter aktiv).
  const exists = await tableExists(client, "wallet_accounts");
  if (!exists) {
    return {
      ok: false,
      reason: "wallet_accounts-tabell finnes ikke (file/memory-provider aktiv)",
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

  const hasDepositBalance = await columnExists(client, "wallet_accounts", "deposit_balance");
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
      // Pre-split fallback (skal ikke forekomme i moderne snapshot).
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

async function upsertGameManagement(client: Client, adminId: string): Promise<void> {
  // Tickets-priser per farge i øre (10/20/30/40 kr × 1/1.5/2/2.5).
  const ticketPrices: Record<string, number> = {
    smallYellow: 1000,
    largeYellow: 2000,
    smallWhite: 1500,
    largeWhite: 3000,
    smallPurple: 2500,
    largePurple: 4000,
    red: 1000,
    green: 1000,
  };

  // Pattern-priser per farge (Rad 1-4 + Fullt Hus). Pris i kroner.
  // Konservative tall som matcher legacy-eksempler i wireframe-katalogen.
  const patternPrices = TICKET_COLORS.map((color) => ({
    color,
    row1: 50,
    row2: 100,
    row3: 150,
    row4: 200,
    fullHouse: 1000,
  }));

  const configJson = {
    spill1: {
      miniGames: ["wheel", "chest", "colordraft", "oddsen"],
      patterns: [
        { id: "row-1", name: "Rad 1", claimType: "LINE", prizePercent: 10, order: 1 },
        { id: "row-2", name: "Rad 2", claimType: "LINE", prizePercent: 15, order: 2 },
        { id: "row-3", name: "Rad 3", claimType: "LINE", prizePercent: 20, order: 3 },
        { id: "row-4", name: "Rad 4", claimType: "LINE", prizePercent: 25, order: 4 },
        { id: "full-house", name: "Fullt Hus", claimType: "BINGO", prizePercent: 30, order: 5 },
      ],
      ticketColors: TICKET_COLORS,
      ticketPrices,
      patternPrices,
    },
  };

  await client.query(
    `INSERT INTO app_game_management
       (id, game_type_id, name, ticket_type, ticket_price,
        start_date, end_date, status, config_json, created_by)
     VALUES
       ($1, 'bingo', 'Demo Spill 1 (Wheel of Fortune)', 'Large', 0,
        now() - interval '1 day', now() + interval '30 days', 'active',
        $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           config_json = EXCLUDED.config_json,
           status = 'active',
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           updated_at = now(),
           deleted_at = NULL`,
    [GAME_MANAGEMENT_ID, JSON.stringify(configJson), adminId],
  );
}

async function upsertSubGame(
  client: Client,
  adminId: string,
  sg: DemoSubGame,
): Promise<void> {
  const patternRows = [
    { patternId: "row-1", name: "Rad 1" },
    { patternId: "row-2", name: "Rad 2" },
    { patternId: "row-3", name: "Rad 3" },
    { patternId: "row-4", name: "Rad 4" },
    { patternId: "full-house", name: "Fullt Hus" },
  ];

  // BIN-804 F1: lagre mini-game-slug i extra_json så admin/agent-UI kan
  // skille presens-typene (rotasjonen velger fortsatt selv hvilken type
  // som spilles, men labelen synliggjør hva sub-gamen representerer).
  const extraJson = { miniGameSlug: sg.miniGameSlug };

  await client.query(
    `INSERT INTO app_sub_games
       (id, game_type_id, game_name, name, sub_game_number,
        pattern_rows_json, ticket_colors_json, status,
        extra_json, created_by)
     VALUES
       ($1, 'bingo', 'Spill 1', $2, $3,
        $4::jsonb, $5::jsonb, 'active',
        $6::jsonb, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           game_name = EXCLUDED.game_name,
           pattern_rows_json = EXCLUDED.pattern_rows_json,
           ticket_colors_json = EXCLUDED.ticket_colors_json,
           extra_json = EXCLUDED.extra_json,
           status = 'active',
           updated_at = now(),
           deleted_at = NULL`,
    [
      sg.id,
      sg.name,
      sg.number,
      JSON.stringify(patternRows),
      JSON.stringify(TICKET_COLORS),
      JSON.stringify(extraJson),
      adminId,
    ],
  );
}

async function upsertSchedule(client: Client, adminId: string): Promise<void> {
  // BIN-804 F1: bundler alle 4 sub-games i schedule-malen slik at hele
  // mini-game-rotasjonen er konfigurert i én plan. Hvert sub-game får
  // identisk timing/pris-config — kun navn + subGameId varierer.
  const subGames = SUB_GAMES.map((sg) => ({
    subGameId: sg.id,
    name: sg.name,
    custom_game_name: sg.name,
    start_time: "18:00",
    end_time: "22:00",
    notificationStartTime: "60s",
    minseconds: 30,
    maxseconds: 120,
    seconds: 60,
    miniGameSlug: sg.miniGameSlug,
    ticketTypesData: {
      ticketType: TICKET_COLORS,
      ticketPrice: [1000, 2000, 1500, 3000, 2500, 4000, 1000, 1000],
      ticketPrize: [0, 0, 0, 0, 0, 0, 0, 0],
      options: [],
    },
    jackpotData: {
      jackpotPrize: { yellow: 0, white: 0, purple: 0, red: 0, green: 0 },
      jackpotDraw: 0,
    },
    elvisData: { replaceTicketPrice: 0 },
  }));

  await client.query(
    `INSERT INTO app_schedules
       (id, schedule_name, schedule_number, schedule_type,
        lucky_number_prize, status, is_admin_schedule,
        manual_start_time, manual_end_time, sub_games_json, created_by)
     VALUES
       ($1, 'Demo Spill 1 mal', $2, 'Manual',
        0, 'active', true,
        '18:00', '22:00', $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE
       SET schedule_name = EXCLUDED.schedule_name,
           sub_games_json = EXCLUDED.sub_games_json,
           status = 'active',
           manual_start_time = EXCLUDED.manual_start_time,
           manual_end_time = EXCLUDED.manual_end_time,
           updated_at = now(),
           deleted_at = NULL`,
    [SCHEDULE_ID, SCHEDULE_NUMBER, JSON.stringify(subGames), adminId],
  );
}

async function upsertDailySchedule(
  client: Client,
  id: string,
  name: string,
  startDate: Date,
  adminId: string,
): Promise<void> {
  // Mon-Sun bitmask = 1+2+4+8+16+32+64 = 127. Setter samme bitmask
  // for begge daglige planer slik at scheduler-tick kan plukke dem opp
  // uavhengig av ukedag.
  const otherData = { scheduleId: SCHEDULE_ID };
  const hallIdsJson = {
    masterHallId: HALL_ID,
    hallIds: [HALL_ID],
    groupHallIds: [HALL_GROUP_ID],
  };
  // BIN-804 F1: alle 4 sub-games refereres i daily schedule-en slik at
  // agent kan rotere gjennom hele mini-game-katalogen i én demo-dag.
  // `index` styrer rekkefølgen i sub-game-tabellen, ikke mini-game-
  // rotasjonen (engine-side, BingoEngineMiniGames.MINIGAME_ROTATION).
  const subgamesJson = SUB_GAMES.map((sg, index) => ({
    subGameId: sg.id,
    index,
    ticketPrice: 1000,
    prizePool: 0,
    patternId: "full-house",
    status: "active",
  }));
  // Sett end_date til 23:59:59 samme dag for stabil filtrering.
  const endDate = new Date(startDate.getTime() + 24 * 3_600_000 - 1_000);

  await client.query(
    `INSERT INTO app_daily_schedules
       (id, name, game_management_id, hall_id, hall_ids_json,
        week_days, day, start_date, end_date,
        start_time, end_time, status,
        stop_game, special_game, is_saved_game, is_admin_saved_game,
        innsatsen_sales, subgames_json, other_data_json, created_by)
     VALUES
       ($1, $2, $3, $4, $5::jsonb,
        127, NULL, $6::timestamptz, $7::timestamptz,
        '18:00', '22:00', 'active',
        false, false, false, false,
        0, $8::jsonb, $9::jsonb, $10)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           game_management_id = EXCLUDED.game_management_id,
           hall_id = EXCLUDED.hall_id,
           hall_ids_json = EXCLUDED.hall_ids_json,
           week_days = EXCLUDED.week_days,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           status = 'active',
           stop_game = false,
           subgames_json = EXCLUDED.subgames_json,
           other_data_json = EXCLUDED.other_data_json,
           updated_at = now(),
           deleted_at = NULL`,
    [
      id,
      name,
      GAME_MANAGEMENT_ID,
      HALL_ID,
      JSON.stringify(hallIdsJson),
      startDate.toISOString(),
      endDate.toISOString(),
      JSON.stringify(subgamesJson),
      JSON.stringify(otherData),
      adminId,
    ],
  );
}

// ── Schema-introspection helpers ────────────────────────────────────────────

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table],
  );
  return rows[0]?.exists === true;
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
  return rows[0]?.exists === true;
}

function startOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

// ── Utskrift ────────────────────────────────────────────────────────────────

function printInstructions(tvToken: string): void {
  const line = "─".repeat(72);
  console.log("");
  console.log("Demo pilot-day seedet — admin/agent/spillere er klare for innlogging.");
  console.log(line);
  console.log(`Hall:           ${HALL_NAME} (slug=${HALL_SLUG}, hallNumber=${HALL_NUMBER})`);
  console.log(`Hall id:        ${HALL_ID}`);
  console.log(`Hall-gruppe:    ${HALL_GROUP_NAME} (id=${HALL_GROUP_ID})`);
  console.log(`TV-token:       ${tvToken}`);
  console.log(line);
  console.log("Innlogginger (alle bruker passord fra DEMO_SEED_PASSWORD):");
  console.log(`  Admin login:  ${ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Agent login:  ${AGENT_EMAIL} / ${DEMO_PASSWORD}`);
  for (const player of PLAYERS) {
    console.log(`  Player login: ${player.email} / ${DEMO_PASSWORD} (500 NOK på depositkonto)`);
  }
  console.log(line);
  console.log("Endpoint-test:");
  console.log(
    `  curl -X POST http://localhost:4000/api/admin/auth/login \\
       -H "Content-Type: application/json" \\
       -d '{"email":"${ADMIN_EMAIL}","password":"${DEMO_PASSWORD}"}'`,
  );
  console.log(line);
}

main().catch((error) => {
  console.error("[seed-demo-pilot-day] uventet feil:", error);
  process.exit(1);
});
