#!/usr/bin/env npx tsx
/**
 * Seed-demo: komplett pilot-dag-state for end-to-end demo (admin + agent +
 * spillere kan logge inn og se levende data).
 *
 * Idempotent: kan kjøres flere ganger uten å krasje. Alle INSERTs bruker
 * `ON CONFLICT DO NOTHING / DO UPDATE` eller eksisterer-sjekker.
 *
 * Seeder TO profiler i samme run (begge er idempotente):
 *
 * Profil A — single-hall (legacy demo, beholdes for bakover-kompatibilitet):
 *   1) `demo-hall-999` (Hall Number 999, "Demo Bingohall") med tv_token.
 *   2) Hall-gruppe "Demo GoH" med demo-hallen som eneste medlem.
 *   3) Admin `demo-admin@spillorama.no`.
 *   4) Agent `demo-agent@spillorama.no` med demo-hall-999 som primary.
 *   5) 3 spillere `demo-spiller-1..3@example.com` på demo-hall-999.
 *   6) GameManagement (Spill 1) + 4 sub-games + schedule-mal + daily
 *      schedules for i dag og i morgen.
 *
 * Profil B — 4-hall-pilot (Bølge 1: 4 sammenkoblede haller med master):
 *   1) 4 haller `demo-hall-001..004` (Hall Number 1001-1004) med stabile
 *      tv_token-uuid-er (hardkodet for re-run-stabilitet).
 *   2) Hall-gruppe "Demo Pilot GoH" (id `demo-pilot-goh`) med alle 4 haller
 *      som medlemmer; `demo-hall-001` registrert som master via daily-
 *      schedule.hall_ids_json.masterHallId (master-konseptet bor på
 *      runtime-nivået, ikke i app_hall_group_members som kun lagrer
 *      medlemskap — se 20260424000000_hall_groups.sql).
 *   3) 4 agenter `demo-agent-1..4@spillorama.no` — én per hall som
 *      primary, øvrige 3 haller som non-primary i app_agent_halls (slik
 *      at agenten kan se group-of-hall-data men shift-er kun i sin egen
 *      hall via partial-unique-index på is_primary).
 *   4) 12 spillere `demo-spiller-1..12@example.com` (3 per hall) med
 *      app_hall_registrations status=ACTIVE og 500 kr på deposit-wallet.
 *   5) Egen schedule-mal `demo-sched-pilot-goh` + 2 daily schedules
 *      (i dag + i morgen) bundet til pilot-gruppen og master-hallen.
 *      Sub-games gjenbrukes fra Profil A (mini-game-rotasjonen er
 *      engine-side og skiller ikke per-gruppe).
 *
 * Begge profiler kjøres alltid — de bruker disjunkte stable IDs så
 * re-runs er trygge. Ønsker du å skru av en profil, kommenter ut
 * `await seedSingleHallProfile(...)` eller `await seedFourHallProfile(...)`
 * i `main()`.
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

// Pilot-day-fix 2026-05-01: tobias@nordicprofil.no er PM-tilgangs-bruker
// som ble brukt i E2E-rapporten 2026-05-01. Manglet i seed → INVALID_CREDENTIALS
// ved login. Vi bruker fast id `demo-user-admin-tobias` (i tillegg til den
// generiske demo-admin) slik at PM kan logge inn med sin egen e-post.
const TOBIAS_ADMIN_ID = "demo-user-admin-tobias";
const TOBIAS_ADMIN_EMAIL = "tobias@nordicprofil.no";
const TOBIAS_ADMIN_DISPLAY = "Tobias";
const TOBIAS_ADMIN_SURNAME = "Haugen";

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

// ── Profil B: 4-hall-pilot (Bølge 1) ────────────────────────────────────────

/**
 * 4 sammenkoblede haller for pilot-demo. `demo-hall-001` er master.
 *
 * tv_token er hardkodet til stabile UUID-strenger slik at re-runs gir samme
 * verdi (i motsetning til Profil A som lar Postgres generere via
 * gen_random_uuid() ved første INSERT). Hardkoding gjør det også enklere å
 * dele TV-URL i pilot-dokumentasjonen uten å måtte slå opp DB-en.
 */
interface PilotHall {
  id: string;
  slug: string;
  hallNumber: number;
  name: string;
  address: string;
  tvToken: string;
}

const PILOT_HALLS: readonly PilotHall[] = [
  {
    id: "demo-hall-001",
    slug: "demo-pilot-hall-1",
    hallNumber: 1001,
    name: "Demo Bingohall 1 (Master)",
    address: "Pilotveien 1, 0001 Demo",
    // Stabile UUID-strenger (manuelt valgte, ikke verdifulle hemmeligheter
    // — kun for at TV-URL-en skal være deterministisk i pilot-demo).
    tvToken: "11111111-1111-4111-8111-111111111111",
  },
  {
    id: "demo-hall-002",
    slug: "demo-pilot-hall-2",
    hallNumber: 1002,
    name: "Demo Bingohall 2",
    address: "Pilotveien 2, 0002 Demo",
    tvToken: "22222222-2222-4222-8222-222222222222",
  },
  {
    id: "demo-hall-003",
    slug: "demo-pilot-hall-3",
    hallNumber: 1003,
    name: "Demo Bingohall 3",
    address: "Pilotveien 3, 0003 Demo",
    tvToken: "33333333-3333-4333-8333-333333333333",
  },
  {
    id: "demo-hall-004",
    slug: "demo-pilot-hall-4",
    hallNumber: 1004,
    name: "Demo Bingohall 4",
    address: "Pilotveien 4, 0004 Demo",
    tvToken: "44444444-4444-4444-8444-444444444444",
  },
];

const PILOT_MASTER_HALL_ID = PILOT_HALLS[0].id;
const PILOT_HALL_GROUP_ID = "demo-pilot-goh";
const PILOT_HALL_GROUP_NAME = "Demo Pilot GoH";

const PILOT_SCHEDULE_ID = "demo-sched-pilot-goh";
const PILOT_SCHEDULE_NUMBER = "SID_DEMO_PILOT_GOH";
const PILOT_DAILY_SCHEDULE_TODAY_ID = "demo-ds-pilot-today";
const PILOT_DAILY_SCHEDULE_TOMORROW_ID = "demo-ds-pilot-tomorrow";
const PILOT_GAME_MANAGEMENT_ID = "demo-gm-pilot-spill1";

interface PilotAgent {
  id: string;
  email: string;
  displayName: string;
  primaryHallId: string;
}

const PILOT_AGENTS: readonly PilotAgent[] = PILOT_HALLS.map((hall, index) => ({
  id: `demo-agent-${index + 1}`,
  email: `demo-agent-${index + 1}@spillorama.no`,
  displayName: `Demo Pilot Agent ${index + 1}`,
  primaryHallId: hall.id,
}));

interface PilotPlayer {
  id: string;
  email: string;
  displayName: string;
  hallId: string;
}

// 12 spillere — 3 per hall (1-3 → hall-001, 4-6 → hall-002, ...).
// Stable IDs `demo-pilot-spiller-N` så de ikke kolliderer med Profil A's
// `demo-user-spiller-N`-spillere. Email-prefiks `demo-pilot-spiller-` for
// å unngå email-kollisjon med Profil A (`demo-spiller-1..3@example.com`)
// — `upsertUser` slår opp på email + id, så delt email ville endt med
// at pilot-INSERT oppdaterer Profil A-raden i stedet for å lage en ny.
const PILOT_PLAYERS: readonly PilotPlayer[] = (() => {
  const out: PilotPlayer[] = [];
  for (let hallIdx = 0; hallIdx < PILOT_HALLS.length; hallIdx += 1) {
    const hall = PILOT_HALLS[hallIdx];
    for (let p = 1; p <= 3; p += 1) {
      const num = hallIdx * 3 + p;
      out.push({
        id: `demo-pilot-spiller-${num}`,
        email: `demo-pilot-spiller-${num}@example.com`,
        displayName: `Demo Pilot Spiller ${num}`,
        hallId: hall.id,
      });
    }
  }
  return out;
})();

// 11 ticket-farger (BIN-PILOT, master-plan §2.7). Snake_case-format som
// matcher canonical TICKET_TYPES i `apps/backend/src/agent/TicketRegistrationService.ts:49`
// + DB CHECK-constraint i migration 20261001000000_ticket_ranges_11_color_palette.sql.
//
// Tidligere brukte denne seed-en camelCase + simplified `red`/`green` —
// dette mismatcher backend-enum og førte til at ticket-color-rendering i
// agent-portal ble blokkert (modal-popup forventer `small_yellow` osv.,
// ikke `smallYellow` eller `red`). Korrigert 2026-05-01 (pilot-day-seed).
const TICKET_COLORS = [
  "small_yellow",
  "small_white",
  "large_yellow",
  "large_white",
  "small_purple",
  "large_purple",
  "small_red",
  "large_red",
  "small_green",
  "large_green",
  "small_blue",
] as const;

// ── Hash helper (matcher PlatformService.hashPassword) ──────────────────────

async function hashScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

/**
 * Pilot-day-fix 2026-05-01: tving reset av passord for en kjent seed-bruker.
 * upsertUser preserverer eksisterende passord, men spesifikke admin-brukere
 * (tobias@nordicprofil.no) må kunne logge inn med det dokumenterte
 * DEMO_PASSWORD selv etter manuelle DB-endringer eller mistet passord.
 */
async function forceResetPassword(
  client: Client,
  email: string,
  password: string,
): Promise<void> {
  // Pilot-day-fix 2026-05-01: matcher på email i stedet for userId. Samme
  // grunn som upsertUser: PM-bruker kan ligge med annen id i prod
  // (`tobias-admin`) enn seedens `demo-user-admin-tobias`, og UPDATE WHERE
  // id = ... ville da treffe 0 rader og passord-reset ville ikke skje.
  const hash = await hashScrypt(password);
  await client.query(
    `UPDATE app_users
        SET password_hash = $2,
            updated_at = now()
      WHERE email = $1`,
    [email, hash],
  );
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

    console.log("== Profil A: single-hall demo ==");
    await seedSingleHallProfile(client);

    console.log("");
    console.log("== Profil B: 4-hall-pilot ==");
    await seedFourHallProfile(client);

    // Hent ut tv_token for utskrift (kun hvis kolonnen finnes) — Profil A.
    let singleHallTvToken = "<ikke konfigurert>";
    if (await columnExists(client, "app_halls", "tv_token")) {
      const { rows: hallRows } = await client.query<{ tv_token: string | null }>(
        "SELECT tv_token FROM app_halls WHERE id = $1",
        [HALL_ID],
      );
      singleHallTvToken = hallRows[0]?.tv_token ?? "<MANGLER>";
    }

    await client.query("COMMIT");

    printInstructions(singleHallTvToken);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed-demo-pilot-day] feilet:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// ── Profil A: single-hall (legacy demo) ─────────────────────────────────────

async function seedSingleHallProfile(client: Client): Promise<void> {
  // 1) Hall
  await upsertHall(client);
  console.log(`  [hall]            ${HALL_SLUG} (id=${HALL_ID}, hallNumber=${HALL_NUMBER})`);

  // 2) Hall-gruppe + medlemskap
  await upsertHallGroup(client);
  await ensureHallGroupMember(client, HALL_GROUP_ID, HALL_ID);
  console.log(`  [hall-group]      ${HALL_GROUP_NAME} (id=${HALL_GROUP_ID}) -> master ${HALL_ID}`);

  // 3) Admin-bruker
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

  // 3b) Pilot-day-fix 2026-05-01: PM tobias@nordicprofil.no
  await upsertUser(client, {
    id: TOBIAS_ADMIN_ID,
    email: TOBIAS_ADMIN_EMAIL,
    displayName: TOBIAS_ADMIN_DISPLAY,
    surname: TOBIAS_ADMIN_SURNAME,
    role: "ADMIN",
    hallId: null,
    birthDate: null,
    kycStatus: "VERIFIED",
  });
  // upsertUser preserverer passord på eksisterende brukere — for tobias-admin
  // tvinger vi reset til DEMO_PASSWORD slik at E2E-rapportens
  // INVALID_CREDENTIALS-feil løses. Idempotent: roterer hver gang seed kjøres.
  await forceResetPassword(client, TOBIAS_ADMIN_EMAIL, DEMO_PASSWORD);
  console.log(`  [admin]           ${TOBIAS_ADMIN_EMAIL} (id=${TOBIAS_ADMIN_ID}) [password reset]`);

  // 4) Agent-bruker + hall-tildeling
  await upsertUser(client, {
    id: AGENT_ID,
    email: AGENT_EMAIL,
    displayName: AGENT_DISPLAY,
    surname: AGENT_SURNAME,
    role: "AGENT",
    hallId: HALL_ID,
    birthDate: null,
    kycStatus: "VERIFIED",
  });
  await ensureAgentHallAssignment(client, AGENT_ID, HALL_ID, ADMIN_ID, true);
  console.log(`  [agent]           ${AGENT_EMAIL} (id=${AGENT_ID}) primaryHall=${HALL_ID}`);

  // 5) Spillere + wallet topup + hall-registrering
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

    const walletId = `wallet-user-${player.id}`;
    if (topup.ok) {
      // Sørg for at wallet-ledger har bootstrap-entry så reconciliation
      // ikke flagger CRITICAL-alert (BIN-763).
      await ensureWalletBootstrapEntry(client, walletId, "deposit", PLAYER_DEPOSIT_MAJOR);
    }
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

  // 6) GameManagement (Spill 1)
  await upsertGameManagement(client, GAME_MANAGEMENT_ID, "Demo Spill 1 (Wheel of Fortune)", ADMIN_ID);
  console.log(`  [game-management] ${GAME_MANAGEMENT_ID} (Spill 1, slug=bingo)`);

  // 7) SubGames (4 stk — én per mini-game-type)
  for (const sg of SUB_GAMES) {
    await upsertSubGame(client, ADMIN_ID, sg);
    console.log(
      `  [sub-game]        ${sg.id} (${sg.name}, mini-game=${sg.miniGameSlug}, 8 ticket-farger)`,
    );
  }

  // 8) Schedule-mal (Mon-Sun 18:00-22:00)
  await upsertSchedule(
    client,
    SCHEDULE_ID,
    SCHEDULE_NUMBER,
    "Demo Spill 1 mal",
    ADMIN_ID,
  );
  console.log(`  [schedule]        ${SCHEDULE_NUMBER} (id=${SCHEDULE_ID}, Mon-Sun 18:00-22:00)`);

  // 9) DailySchedule for i dag + i morgen
  const today = startOfDayUtc(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 3_600_000);
  await upsertDailySchedule(client, {
    id: DAILY_SCHEDULE_TODAY_ID,
    name: "Demo dagsplan (i dag)",
    startDate: today,
    adminId: ADMIN_ID,
    gameManagementId: GAME_MANAGEMENT_ID,
    scheduleId: SCHEDULE_ID,
    masterHallId: HALL_ID,
    hallIds: [HALL_ID],
    groupHallIds: [HALL_GROUP_ID],
  });
  await upsertDailySchedule(client, {
    id: DAILY_SCHEDULE_TOMORROW_ID,
    name: "Demo dagsplan (i morgen)",
    startDate: tomorrow,
    adminId: ADMIN_ID,
    gameManagementId: GAME_MANAGEMENT_ID,
    scheduleId: SCHEDULE_ID,
    masterHallId: HALL_ID,
    hallIds: [HALL_ID],
    groupHallIds: [HALL_GROUP_ID],
  });
  console.log(
    `  [daily-schedule]  i dag=${today.toISOString().slice(0, 10)} | i morgen=${tomorrow
      .toISOString()
      .slice(0, 10)}`,
  );

  // 9b) Pilot-day-fix 2026-05-01: pre-spawn app_game1_scheduled_games for
  // i dag + i morgen direkte (Game1ScheduleTickService cron er default OFF).
  // Uten dette returnerer findActiveGameForHall null og hele Game1-runtime
  // er blokkert i demo-miljø. Idempotent via UNIQUE-constraint.
  const todaySpawn = await spawnScheduledGamesForDay(client, {
    dailyScheduleId: DAILY_SCHEDULE_TODAY_ID,
    scheduleId: SCHEDULE_ID,
    scheduledDay: today,
    masterHallId: HALL_ID,
    hallIds: [HALL_ID],
    groupHallId: HALL_GROUP_ID,
  });
  const tomorrowSpawn = await spawnScheduledGamesForDay(client, {
    dailyScheduleId: DAILY_SCHEDULE_TOMORROW_ID,
    scheduleId: SCHEDULE_ID,
    scheduledDay: tomorrow,
    masterHallId: HALL_ID,
    hallIds: [HALL_ID],
    groupHallId: HALL_GROUP_ID,
  });
  console.log(
    `  [scheduled-games] i dag spawned=${todaySpawn.spawned} skipped=${todaySpawn.skipped} | i morgen spawned=${tomorrowSpawn.spawned} skipped=${tomorrowSpawn.skipped}`,
  );

  // 10) Kiosk-produkter (Sell Products-flyt, wireframe 17.12).
  await seedKioskProducts(client, [HALL_ID], ADMIN_ID);
}

// ── Profil B: 4-hall-pilot ─────────────────────────────────────────────────

async function seedFourHallProfile(client: Client): Promise<void> {
  // 1) 4 haller med stabile tv_token-er.
  for (const hall of PILOT_HALLS) {
    await upsertPilotHall(client, hall);
    console.log(
      `  [hall]            ${hall.slug} (id=${hall.id}, hallNumber=${hall.hallNumber})`,
    );
  }

  // 2) Hall-gruppe "Demo Pilot GoH" + 4 medlemmer.
  // Master-konseptet bor IKKE i app_hall_group_members (kun group_id +
  // hall_id + added_at). Master settes via daily_schedule.hall_ids_json.
  // Vi noterer master-id-en i extra_json så admin-UI kan finne den uten
  // å lese alle aktive daily-schedules.
  await upsertPilotHallGroup(client);
  for (const hall of PILOT_HALLS) {
    await ensureHallGroupMember(client, PILOT_HALL_GROUP_ID, hall.id);
  }
  console.log(
    `  [hall-group]      ${PILOT_HALL_GROUP_NAME} (id=${PILOT_HALL_GROUP_ID}) ` +
      `-> master ${PILOT_MASTER_HALL_ID} + ${PILOT_HALLS.length - 1} non-master`,
  );

  // 3) 4 agenter — hver med sin egen hall som primary + de tre andre som
  // non-primary. Partial unique-index på is_primary håndhever én primary
  // per agent (se 20260418220100_agent_halls.sql).
  for (const agent of PILOT_AGENTS) {
    await upsertUser(client, {
      id: agent.id,
      email: agent.email,
      displayName: agent.displayName,
      surname: "Pilotvert",
      role: "AGENT",
      hallId: agent.primaryHallId, // legacy 1:1
      birthDate: null,
      kycStatus: "VERIFIED",
    });

    // Sett primary først (clearer evt. annen primary), deretter non-primary
    // for de tre øvrige hallene.
    await ensureAgentHallAssignment(client, agent.id, agent.primaryHallId, ADMIN_ID, true);
    for (const hall of PILOT_HALLS) {
      if (hall.id === agent.primaryHallId) continue;
      await ensureAgentHallAssignment(client, agent.id, hall.id, ADMIN_ID, false);
    }

    const otherHallCount = PILOT_HALLS.length - 1;
    console.log(
      `  [agent]           ${agent.email} (id=${agent.id}) primary=${agent.primaryHallId} +${otherHallCount} non-primary`,
    );
  }

  // 4) 12 spillere (3 per hall) med wallet topup + hall-registrering.
  for (const player of PILOT_PLAYERS) {
    await upsertUser(client, {
      id: player.id,
      email: player.email,
      displayName: player.displayName,
      surname: "Pilot",
      role: "PLAYER",
      hallId: player.hallId,
      birthDate: PLAYER_BIRTH_DATE,
      kycStatus: "VERIFIED",
    });
    const topup = await maybeTopUpPlayerWallet(client, player.id, PLAYER_DEPOSIT_MAJOR);
    const tag = topup.ok
      ? `wallet=${topup.walletId} (${PLAYER_DEPOSIT_MAJOR} NOK)`
      : `wallet topup hoppet over: ${topup.reason}`;
    console.log(`  [player]          ${player.email} (id=${player.id}, hall=${player.hallId}) ${tag}`);

    const walletId = `wallet-user-${player.id}`;
    if (topup.ok) {
      await ensureWalletBootstrapEntry(client, walletId, "deposit", PLAYER_DEPOSIT_MAJOR);
    }
    const registrationId = `reg-${player.id}`;
    await upsertHallRegistration(client, {
      id: registrationId,
      userId: player.id,
      walletId,
      hallId: player.hallId,
      activatedByUserId: ADMIN_ID,
    });
    console.log(
      `  [hall-reg]        ${registrationId} (user=${player.id}, hall=${player.hallId}, status=ACTIVE)`,
    );
  }

  // 5) Egen GameManagement-rad for pilot-gruppen (gjenbruker samme
  // ticket-farger og pattern-config som Profil A — det er kun navn + id
  // som varierer).
  await upsertGameManagement(
    client,
    PILOT_GAME_MANAGEMENT_ID,
    "Demo Pilot Spill 1 (4-hall master/slave)",
    ADMIN_ID,
  );
  console.log(`  [game-management] ${PILOT_GAME_MANAGEMENT_ID} (Spill 1, pilot-gruppe)`);

  // SubGames og engine-mini-game-rotasjon er felles på tvers av profiler
  // (engine leser ikke per-gruppe), så vi gjenbruker SUB_GAMES seedet i
  // Profil A. Daily schedules under viser til disse via subgames_json.

  // 6) Schedule-mal for pilot-gruppen.
  await upsertSchedule(
    client,
    PILOT_SCHEDULE_ID,
    PILOT_SCHEDULE_NUMBER,
    "Demo Pilot Spill 1 mal",
    ADMIN_ID,
  );
  console.log(
    `  [schedule]        ${PILOT_SCHEDULE_NUMBER} (id=${PILOT_SCHEDULE_ID}, Mon-Sun 18:00-22:00)`,
  );

  // 7) Daily schedules for i dag + i morgen, med master-hall + alle 4
  // haller i hall_ids_json og pilot-gruppen som groupHallIds.
  const today = startOfDayUtc(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 3_600_000);
  const allHallIds = PILOT_HALLS.map((h) => h.id);

  await upsertDailySchedule(client, {
    id: PILOT_DAILY_SCHEDULE_TODAY_ID,
    name: "Demo Pilot dagsplan (i dag)",
    startDate: today,
    adminId: ADMIN_ID,
    gameManagementId: PILOT_GAME_MANAGEMENT_ID,
    scheduleId: PILOT_SCHEDULE_ID,
    masterHallId: PILOT_MASTER_HALL_ID,
    hallIds: allHallIds,
    groupHallIds: [PILOT_HALL_GROUP_ID],
  });
  await upsertDailySchedule(client, {
    id: PILOT_DAILY_SCHEDULE_TOMORROW_ID,
    name: "Demo Pilot dagsplan (i morgen)",
    startDate: tomorrow,
    adminId: ADMIN_ID,
    gameManagementId: PILOT_GAME_MANAGEMENT_ID,
    scheduleId: PILOT_SCHEDULE_ID,
    masterHallId: PILOT_MASTER_HALL_ID,
    hallIds: allHallIds,
    groupHallIds: [PILOT_HALL_GROUP_ID],
  });
  console.log(
    `  [daily-schedule]  i dag=${today.toISOString().slice(0, 10)} | i morgen=${tomorrow
      .toISOString()
      .slice(0, 10)} (master=${PILOT_MASTER_HALL_ID})`,
  );

  // 7b) Pilot-day-fix 2026-05-01: pre-spawn app_game1_scheduled_games (se
  // Profil A for begrunnelse — cron er default OFF, vi må fylle direkte).
  const pilotTodaySpawn = await spawnScheduledGamesForDay(client, {
    dailyScheduleId: PILOT_DAILY_SCHEDULE_TODAY_ID,
    scheduleId: PILOT_SCHEDULE_ID,
    scheduledDay: today,
    masterHallId: PILOT_MASTER_HALL_ID,
    hallIds: allHallIds,
    groupHallId: PILOT_HALL_GROUP_ID,
  });
  const pilotTomorrowSpawn = await spawnScheduledGamesForDay(client, {
    dailyScheduleId: PILOT_DAILY_SCHEDULE_TOMORROW_ID,
    scheduleId: PILOT_SCHEDULE_ID,
    scheduledDay: tomorrow,
    masterHallId: PILOT_MASTER_HALL_ID,
    hallIds: allHallIds,
    groupHallId: PILOT_HALL_GROUP_ID,
  });
  console.log(
    `  [scheduled-games] i dag spawned=${pilotTodaySpawn.spawned} skipped=${pilotTodaySpawn.skipped} | i morgen spawned=${pilotTomorrowSpawn.spawned} skipped=${pilotTomorrowSpawn.skipped}`,
  );

  // 8) Kiosk-produkter — bind til alle 4 pilot-haller.
  await seedKioskProducts(client, allHallIds, ADMIN_ID);
}

// ── Kiosk-produkter (BIN-583 B3.6 / wireframe 17.12) ────────────────────────

/**
 * 8 standard kiosk-produkter matchet mot wireframe-katalog §17.12 (Coffee /
 * Chocolate / Rice + relaterte snacks). Stable ID-er gjør re-runs idempotente,
 * og produktene bindes til hver hall vi seder via `app_hall_products`.
 *
 * Pilot-blokker fjernet 2026-05-01: `GET /api/agent/products` returnerte
 * tom liste fordi katalogen aldri var seedet, og dermed kunne ikke
 * "Sell Products"-flyten testes (steg 5 i pilot-dag-verifisering).
 */
interface DemoCategory {
  id: string;
  name: string;
  sortOrder: number;
}

interface DemoProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  categoryId: string;
}

const DEMO_CATEGORIES: readonly DemoCategory[] = [
  { id: "demo-cat-coffee", name: "Kaffe & varm drikke", sortOrder: 10 },
  { id: "demo-cat-snacks", name: "Snacks & sjokolade", sortOrder: 20 },
  { id: "demo-cat-misc", name: "Annet", sortOrder: 30 },
];

const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    id: "demo-prod-coffee",
    name: "Kaffe",
    description: "Filterkaffe, kopp",
    priceCents: 2000, // 20 kr
    categoryId: "demo-cat-coffee",
  },
  {
    id: "demo-prod-tea",
    name: "Te",
    description: "Te, kopp",
    priceCents: 2000, // 20 kr
    categoryId: "demo-cat-coffee",
  },
  {
    id: "demo-prod-cocoa",
    name: "Varm sjokolade",
    description: "Kakao, kopp",
    priceCents: 2500, // 25 kr
    categoryId: "demo-cat-coffee",
  },
  {
    id: "demo-prod-chocolate",
    name: "Sjokolade",
    description: "Sjokoladeplate",
    priceCents: 3000, // 30 kr
    categoryId: "demo-cat-snacks",
  },
  {
    id: "demo-prod-chips",
    name: "Potetgull",
    description: "Liten pose",
    priceCents: 2500, // 25 kr
    categoryId: "demo-cat-snacks",
  },
  {
    id: "demo-prod-rice",
    name: "Risboller",
    description: "Risboller, pose",
    priceCents: 2500, // 25 kr
    categoryId: "demo-cat-snacks",
  },
  {
    id: "demo-prod-water",
    name: "Vann",
    description: "Flaske 0,5L",
    priceCents: 2500, // 25 kr
    categoryId: "demo-cat-misc",
  },
  {
    id: "demo-prod-juice",
    name: "Brus",
    description: "Boks 0,33L",
    priceCents: 3000, // 30 kr
    categoryId: "demo-cat-misc",
  },
];

async function upsertKioskCategory(
  client: Client,
  category: DemoCategory,
): Promise<void> {
  await client.query(
    `INSERT INTO app_product_categories (id, name, sort_order, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           sort_order = EXCLUDED.sort_order,
           is_active = TRUE,
           deleted_at = NULL,
           updated_at = NOW()`,
    [category.id, category.name, category.sortOrder],
  );
}

async function upsertKioskProduct(
  client: Client,
  product: DemoProduct,
): Promise<void> {
  await client.query(
    `INSERT INTO app_products
       (id, name, description, price_cents, category_id, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           price_cents = EXCLUDED.price_cents,
           category_id = EXCLUDED.category_id,
           status = 'ACTIVE',
           deleted_at = NULL,
           updated_at = NOW()`,
    [
      product.id,
      product.name,
      product.description,
      product.priceCents,
      product.categoryId,
    ],
  );
}

async function ensureHallProductBinding(
  client: Client,
  hallId: string,
  productId: string,
  addedByUserId: string | null,
): Promise<void> {
  // PRIMARY KEY (hall_id, product_id) sikrer idempotens.
  await client.query(
    `INSERT INTO app_hall_products (hall_id, product_id, is_active, added_by)
     VALUES ($1, $2, TRUE, $3)
     ON CONFLICT (hall_id, product_id) DO UPDATE
       SET is_active = TRUE`,
    [hallId, productId, addedByUserId],
  );
}

async function seedKioskProducts(
  client: Client,
  hallIds: readonly string[],
  adminId: string,
): Promise<void> {
  // Sjekk at tabellen finnes — products-migrasjonen er fra 2026-04-20 så
  // dette skal alltid være sant i moderne snapshots.
  if (!(await tableExists(client, "app_products"))) {
    console.log("  [products]        hopper over — app_products-tabell finnes ikke");
    return;
  }
  for (const category of DEMO_CATEGORIES) {
    await upsertKioskCategory(client, category);
  }
  for (const product of DEMO_PRODUCTS) {
    await upsertKioskProduct(client, product);
  }
  for (const hallId of hallIds) {
    for (const product of DEMO_PRODUCTS) {
      await ensureHallProductBinding(client, hallId, product.id, adminId);
    }
  }
  console.log(
    `  [products]        ${DEMO_CATEGORIES.length} kategorier + ${DEMO_PRODUCTS.length} produkter ` +
      `bundet til ${hallIds.length} hall(er)`,
  );
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

async function upsertPilotHall(client: Client, hall: PilotHall): Promise<void> {
  // Parameterisert variant av upsertHall for 4-hall-pilot. I motsetning til
  // single-hall-versjonen setter vi tv_token til en hardkodet stabil verdi
  // (fra PILOT_HALLS-arrayen) slik at TV-URL i pilot-runbook er deterministisk
  // på tvers av re-seeds — operatører trenger ikke slå opp DB-en for å lime
  // inn URL i kiosk-modus.
  const tvTokenCol = await columnExists(client, "app_halls", "tv_token");
  const hallNumberCol = await columnExists(client, "app_halls", "hall_number");

  const cols = ["id", "slug", "name", "region", "address", "is_active"];
  const placeholders = ["$1", "$2", "$3", "'NO'", "$4", "true"];
  const values: unknown[] = [hall.id, hall.slug, hall.name, hall.address];
  let nextIdx = values.length + 1;

  if (hallNumberCol) {
    cols.push("hall_number");
    placeholders.push(`$${nextIdx++}`);
    values.push(hall.hallNumber);
  }
  if (tvTokenCol) {
    cols.push("tv_token");
    placeholders.push(`$${nextIdx++}`);
    values.push(hall.tvToken);
  }

  // ON CONFLICT (id) for idempotens. Til forskjell fra upsertHall oppdaterer
  // vi tv_token også, slik at hardkodet stable token alltid vinner over evt.
  // tidligere autogenerert verdi (en eldre kjøring kan ha satt en gen_random
  // før vi byttet til stabile tokens).
  const updateSet = [
    "slug = EXCLUDED.slug",
    "name = EXCLUDED.name",
    "address = EXCLUDED.address",
    "is_active = true",
    "updated_at = now()",
  ];
  if (hallNumberCol) updateSet.push("hall_number = EXCLUDED.hall_number");
  if (tvTokenCol) updateSet.push("tv_token = EXCLUDED.tv_token");

  const sql = `
    INSERT INTO app_halls (${cols.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (id) DO UPDATE
      SET ${updateSet.join(", ")}
  `;
  await client.query(sql, values);
}

async function upsertPilotHallGroup(client: Client): Promise<void> {
  // Pilot-gruppe (4 sammenkoblede haller). Strukturen i app_hall_groups
  // er identisk med single-hall-gruppen — kun id + name varierer.
  await client.query(
    `INSERT INTO app_hall_groups (id, name, status, products_json, extra_json, created_by)
     VALUES ($1, $2, 'active', '[]'::jsonb, $3::jsonb, NULL)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           status = 'active',
           extra_json = EXCLUDED.extra_json,
           deleted_at = NULL,
           updated_at = now()`,
    [
      PILOT_HALL_GROUP_ID,
      PILOT_HALL_GROUP_NAME,
      // Master-hall lagres i extra_json så admin-UI kan finne den uten å
      // måtte joine app_daily_schedules.hall_ids_json. Runtime-master på
      // selve game-runden bor fortsatt i daily-schedule (den er kanonisk).
      JSON.stringify({ masterHallId: PILOT_MASTER_HALL_ID, kind: "pilot" }),
    ],
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
    // Pilot-day-fix 2026-05-01: SELECT matcher på id ELLER email — det
    // betyr at en bruker kan ligge i DB med en annen id enn `input.id`
    // (f.eks. produksjons-id `tobias-admin` vs seedens
    // `demo-user-admin-tobias`). Vi må derfor UPDATE-e på den faktiske
    // eksisterende id-en, ellers oppdaterer vi 0 rader og seeden tror
    // alt gikk bra.
    const existingId = existing.rows[0].id;
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
      existingId,
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
  isPrimary: boolean,
): Promise<void> {
  // app_agent_halls: PK (user_id, hall_id), partial unique on is_primary
  // per user. Når vi setter is_primary=true må vi også droppe evt. annen
  // primary for samme user (matcher AgentStore.assignHall-logikken).
  // Når isPrimary=false er det en ren upsert uten å røre andre rader.
  if (isPrimary) {
    await client.query(
      `UPDATE app_agent_halls SET is_primary = false
         WHERE user_id = $1 AND is_primary AND hall_id <> $2`,
      [userId, hallId],
    );
  }
  await client.query(
    `INSERT INTO app_agent_halls (user_id, hall_id, is_primary, assigned_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, hall_id) DO UPDATE
       SET is_primary = EXCLUDED.is_primary,
           assigned_by_user_id = COALESCE(EXCLUDED.assigned_by_user_id, app_agent_halls.assigned_by_user_id)`,
    [userId, hallId, isPrimary, assignedByUserId],
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
 * Sørger for at wallet-ledger (`wallet_entries`) har en bootstrap-rad som
 * matcher `deposit_balance` på kontoen. Uten denne genererer den nattlige
 * wallet-reconciliation-jobben (BIN-763) CRITICAL-alarmer fordi
 * SUM(wallet_entries) ≠ wallet_accounts.deposit_balance.
 *
 * Idempotent via stable `operation_id` (`seed-bootstrap-{walletId}-{side}`).
 * Hvis entry-en allerede finnes, hoppes inserten over.
 *
 * `entry_hash NULL` markerer raden som legacy/seed (BIN-764 audit-verifier
 * hopper over disse uten alarm — pre-BIN-764-konvensjon, dokumentert i
 * `WalletAuditVerifier.ts` "legacy-rader uten entry_hash").
 *
 * Diff-beregning: differanse mellom faktisk `deposit_balance` og current
 * SUM av credit-debit i ledger. Hvis konto allerede er balansert (f.eks.
 * via real wallet-aktivitet), gjør funksjonen ingenting.
 */
async function ensureWalletBootstrapEntry(
  client: Client,
  walletId: string,
  accountSide: "deposit" | "winnings",
  targetBalanceMajor: number,
): Promise<void> {
  const operationId = `seed-bootstrap-${walletId}-${accountSide}`;

  // Idempotency: ble bootstrap allerede skrevet?
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM wallet_entries WHERE operation_id = $1 LIMIT 1",
    [operationId],
  );
  if (existing.rows.length > 0) return;

  // Diff: faktisk deposit_balance vs ledger-sum.
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
  if (Math.abs(diff) < 0.01) return; // Already balanced — no bootstrap needed.

  // Skriv én bootstrap-entry. NULL entry_hash + NULL previous_entry_hash
  // markerer raden som legacy/seed (audit-verifier hopper over).
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

/**
 * Sett deposit_balance ≥ amount for spilleren. Bruker `GREATEST` så
 * re-kjøring ikke senker en allerede-større saldo (og dermed ikke utilsiktet
 * fjerner penger en operatør har topput senere). Returns ok-flag som lar
 * scriptet rapportere status uten å feile hele transaksjonen.
 *
 * Etter at deposit_balance er satt, kalles `ensureWalletBootstrapEntry` for
 * å sikre at wallet-ledger (`wallet_entries`) har en matchende bootstrap-rad.
 * Uten den vil BIN-763 wallet-reconciliation-jobben rapportere CRITICAL-alert.
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

async function upsertGameManagement(
  client: Client,
  id: string,
  name: string,
  adminId: string,
): Promise<void> {
  // Tickets-priser per farge i øre (10/20/30/40 kr × 1/1.5/2/2.5).
  // Snake_case-keys matcher canonical TICKET_TYPES (11-color palette).
  const ticketPrices: Record<string, number> = {
    small_yellow: 1000,
    small_white: 1500,
    large_yellow: 2000,
    large_white: 3000,
    small_purple: 2500,
    large_purple: 4000,
    small_red: 1000,
    large_red: 2000,
    small_green: 1000,
    large_green: 2000,
    small_blue: 1000,
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
       ($1, 'bingo', $2, 'Large', 0,
        now() - interval '1 day', now() + interval '30 days', 'active',
        $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           config_json = EXCLUDED.config_json,
           status = 'active',
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           updated_at = now(),
           deleted_at = NULL`,
    [id, name, JSON.stringify(configJson), adminId],
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

  // Self-healing for legacy seed-data: tidligere seed-versjoner brukte
  // andre IDer (f.eks. `demo-sg-wof` for "Wheel of Fortune" i stedet for
  // `demo-sg-wheel`). Indeksene `uq_app_sub_games_name_per_type` og
  // `uq_app_sub_games_sub_game_number` (begge partial WHERE deleted_at
  // IS NULL) blokkerer da en ren INSERT med samme name/number men ny id.
  // Vi tømmer derfor "stale" demo-rader med samme name eller number men
  // ulik id før vi kjører UPSERT. Trygt: ingen FK peker til
  // app_sub_games.id (verifisert mot pg_constraint 2026-05-01) — kun
  // JSONB-felt i app_daily_schedules refererer ID-en, og dette seed-
  // scriptet overskriver subgames_json til å peke på ny id i samme run.
  await client.query(
    `DELETE FROM app_sub_games
       WHERE id <> $1
         AND id LIKE 'demo-%'
         AND game_type_id = 'bingo'
         AND (name = $2 OR sub_game_number = $3)`,
    [sg.id, sg.name, sg.number],
  );

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
           sub_game_number = EXCLUDED.sub_game_number,
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

async function upsertSchedule(
  client: Client,
  id: string,
  scheduleNumber: string,
  scheduleName: string,
  adminId: string,
): Promise<void> {
  // BIN-804 F1: bundler alle 4 sub-games i schedule-malen slik at hele
  // mini-game-rotasjonen er konfigurert i én plan. Hvert sub-game får
  // identisk timing/pris-config — kun navn + subGameId varierer.
  //
  // Pilot-day-fix 2026-05-01: feltnavn er camelCase (`startTime`/`endTime`)
  // for å matche Game1ScheduleTickService.ScheduleSubGame som leser
  // `sg.startTime` / `sg.endTime`. Tidligere snake_case (`start_time`)
  // førte til at tick-en flagget alle sub-games som "mangler startTime"
  // og hoppet over spawn — pilot-blokker.
  //
  // Pilot-day-fix 2026-05-01 (åpningstider): malen viser ukedags-vinduet
  // (Mon-Fri 11-20). app_schedules har bare ett manual_start/manual_end-
  // felt, så lørdag/søndag-tidene styres på app_daily_schedules-nivå.
  const subGames = SUB_GAMES.map((sg) => ({
    subGameId: sg.id,
    name: sg.name,
    customGameName: sg.name,
    startTime: WEEKDAY_HOURS.startTime,
    endTime: WEEKDAY_HOURS.endTime,
    notificationStartTime: "60s",
    minseconds: 30,
    maxseconds: 120,
    seconds: 60,
    miniGameSlug: sg.miniGameSlug,
    ticketTypesData: {
      ticketType: TICKET_COLORS,
      // 11 priser i øre — match TICKET_COLORS-rekkefølgen.
      ticketPrice: [
        1000, 1500, 2000, 3000, 2500, 4000,
        1000, 2000, 1000, 2000, 1000,
      ],
      ticketPrize: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      options: [],
    },
    jackpotData: {
      jackpotPrize: { yellow: 0, white: 0, purple: 0, red: 0, green: 0, blue: 0 },
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
       ($1, $2, $3, 'Manual',
        0, 'active', true,
        $6, $7, $4::jsonb, $5)
     ON CONFLICT (id) DO UPDATE
       SET schedule_name = EXCLUDED.schedule_name,
           sub_games_json = EXCLUDED.sub_games_json,
           status = 'active',
           manual_start_time = EXCLUDED.manual_start_time,
           manual_end_time = EXCLUDED.manual_end_time,
           updated_at = now(),
           deleted_at = NULL`,
    [
      id,
      scheduleName,
      scheduleNumber,
      JSON.stringify(subGames),
      adminId,
      WEEKDAY_HOURS.startTime,
      WEEKDAY_HOURS.endTime,
    ],
  );
}

interface UpsertDailyScheduleInput {
  id: string;
  name: string;
  startDate: Date;
  adminId: string;
  gameManagementId: string;
  scheduleId: string;
  masterHallId: string;
  hallIds: readonly string[];
  groupHallIds: readonly string[];
}

async function upsertDailySchedule(
  client: Client,
  input: UpsertDailyScheduleInput,
): Promise<void> {
  // Mon-Sun bitmask = 1+2+4+8+16+32+64 = 127. Setter samme bitmask
  // for begge daglige planer slik at scheduler-tick kan plukke dem opp
  // uavhengig av ukedag.
  const otherData = { scheduleId: input.scheduleId };
  const hallIdsJson = {
    masterHallId: input.masterHallId,
    hallIds: input.hallIds,
    groupHallIds: input.groupHallIds,
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
  const endDate = new Date(input.startDate.getTime() + 24 * 3_600_000 - 1_000);

  // status='running' (ikke 'active'): Game1ScheduleTickService.ts:403
  // filtrerer kun på status='running' når den henter daily-schedules som
  // skal spawnes til scheduled_games. 'active' er en lagret-men-ikke-aktiv
  // tilstand som tick-en hopper over (regulatorisk: admin må eksplisitt
  // markere planen som "kjører" før første tick spawn). For seed-formål
  // setter vi 'running' direkte slik at scheduler-cron umiddelbart plukker
  // opp planen og spillere ser games i lobby uten manuell aktivering.
  // Pilot-blokker fjernet 2026-05-01: tidligere 'active' førte til at
  // schedule-listing viste raden men ingen game ble spawnet.
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
        '18:00', '22:00', 'running',
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
           status = 'running',
           stop_game = false,
           subgames_json = EXCLUDED.subgames_json,
           other_data_json = EXCLUDED.other_data_json,
           updated_at = now(),
           deleted_at = NULL`,
    [
      input.id,
      input.name,
      input.gameManagementId,
      input.masterHallId,
      JSON.stringify(hallIdsJson),
      input.startDate.toISOString(),
      endDate.toISOString(),
      JSON.stringify(subgamesJson),
      JSON.stringify(otherData),
      input.adminId,
    ],
  );
}

// ── Pilot-day-fix 2026-05-01: spawn scheduled-games rader direkte ───────────
//
// Game1ScheduleTickService cron-jobben (game1ScheduleTick.ts) er som default
// disabled (GAME1_SCHEDULE_TICK_ENABLED=false). I dev/demo betyr det at
// app_game1_scheduled_games forblir tom selv etter at daily_schedule har
// status='running' — Game1ScheduleTickService.findActiveGameForHall
// returnerer null og pilot-flow blokkeres.
//
// Denne funksjonen replikerer INSERT-shapen fra spawnUpcomingGame1Games
// (Game1ScheduleTickService.ts:706-737) for én daily_schedule × én dag ×
// alle sub_games. Idempotent via UNIQUE(daily_schedule_id, scheduled_day,
// sub_game_index) + ON CONFLICT DO NOTHING. Kjøres for "i dag" (startOfDayUtc)
// for begge profiler, slik at E2E-rapporten kan finne et aktivt game uten
// å måtte vente på at cron skal aktiveres.
interface SpawnScheduledGamesInput {
  dailyScheduleId: string;
  scheduleId: string;
  scheduledDay: Date; // skal være startOfDayUtc
  masterHallId: string;
  hallIds: readonly string[];
  groupHallId: string;
  scheduleType?: "Auto" | "Manual";
}

async function spawnScheduledGamesForDay(
  client: Client,
  input: SpawnScheduledGamesInput,
): Promise<{ spawned: number; skipped: number }> {
  // Sjekk at tabellen finnes (dev-miljø uten migrasjoner skal ikke krasje).
  if (!(await tableExists(client, "app_game1_scheduled_games"))) {
    console.log(
      "  [scheduled-games] hopper over — tabell app_game1_scheduled_games finnes ikke",
    );
    return { spawned: 0, skipped: 0 };
  }

  const isoDay = input.scheduledDay.toISOString().slice(0, 10);
  const result = { spawned: 0, skipped: 0 };

  for (let i = 0; i < SUB_GAMES.length; i++) {
    const sg = SUB_GAMES[i]!;
    // 18:00-22:00 i UTC, samme som schedule-malen og daily_schedule.
    const startTs = new Date(`${isoDay}T18:00:00Z`);
    const endTs = new Date(`${isoDay}T22:00:00Z`);

    // ticket_config_json: bruk samme TICKET_COLORS-payload som
    // upsertSchedule serialiserer på sub_games_json (mirror).
    const ticketConfigJson: Record<string, unknown> = {
      ticketType: TICKET_COLORS,
      ticketPrice: [
        1000, 1500, 2000, 3000, 2500, 4000, 1000, 2000, 1000, 2000, 1000,
      ],
      ticketPrize: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      options: [],
    };
    const jackpotConfigJson: Record<string, unknown> = {
      jackpotPrize: { yellow: 0, white: 0, purple: 0, red: 0, green: 0, blue: 0 },
      jackpotDraw: 0,
    };

    // randomUUID() — unngå deterministisk id, ON CONFLICT håndterer
    // re-runs via business-key (daily_schedule_id, scheduled_day, sub_game_index).
    const id = randomBytes(16).toString("hex");

    try {
      const { rowCount } = await client.query(
        `INSERT INTO app_game1_scheduled_games
           (id, daily_schedule_id, schedule_id, sub_game_index, sub_game_name,
            custom_game_name, scheduled_day, scheduled_start_time,
            scheduled_end_time, notification_start_seconds,
            ticket_config_json, jackpot_config_json, game_mode,
            master_hall_id, group_hall_id, participating_halls_json,
            status, game_config_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::timestamptz,
                 $9::timestamptz, $10, $11::jsonb, $12::jsonb, $13,
                 $14, $15, $16::jsonb, 'scheduled', NULL)
         ON CONFLICT (daily_schedule_id, scheduled_day, sub_game_index)
           DO NOTHING`,
        [
          id,
          input.dailyScheduleId,
          input.scheduleId,
          i,
          sg.name,
          sg.name,
          isoDay,
          startTs.toISOString(),
          endTs.toISOString(),
          60, // notificationStartSeconds — 60s default
          JSON.stringify(ticketConfigJson),
          JSON.stringify(jackpotConfigJson),
          input.scheduleType ?? "Manual",
          input.masterHallId,
          input.groupHallId,
          JSON.stringify(input.hallIds),
        ],
      );
      if ((rowCount ?? 0) > 0) {
        result.spawned += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "23505") {
        // UNIQUE-violation — race med en annen seed-kjøring.
        result.skipped += 1;
      } else {
        // Bubbel opp; main()-tx ROLLBACK håndterer.
        throw err;
      }
    }
  }
  return result;
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
  console.log("PROFIL A — Single-hall demo (legacy, beholdt for bakover-kompatibilitet)");
  console.log(line);
  console.log(`Hall:           ${HALL_NAME} (slug=${HALL_SLUG}, hallNumber=${HALL_NUMBER})`);
  console.log(`Hall id:        ${HALL_ID}`);
  console.log(`Hall-gruppe:    ${HALL_GROUP_NAME} (id=${HALL_GROUP_ID})`);
  console.log(`TV-token:       ${tvToken}`);
  console.log(`TV-URL:         http://localhost:4000/admin/#/tv/${HALL_ID}/${tvToken}`);
  console.log(line);
  console.log("Innlogginger (alle bruker passord fra DEMO_SEED_PASSWORD):");
  console.log(`  Admin login:  ${ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Admin login:  ${TOBIAS_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Agent login:  ${AGENT_EMAIL} / ${DEMO_PASSWORD}`);
  for (const player of PLAYERS) {
    console.log(`  Player login: ${player.email} / ${DEMO_PASSWORD} (500 NOK på depositkonto)`);
  }
  console.log(line);
  console.log(
    `PROFIL B — 4-hall-pilot (Bølge 1: master ${PILOT_MASTER_HALL_ID} + 3 medlemmer)`,
  );
  console.log(line);
  console.log(`Hall-gruppe:    ${PILOT_HALL_GROUP_NAME} (id=${PILOT_HALL_GROUP_ID})`);
  console.log(
    `Master-hall:    ${PILOT_MASTER_HALL_ID} (kun bingovert med utvidet ansvar — ingen egen rolle)`,
  );
  for (const hall of PILOT_HALLS) {
    const masterTag = hall.id === PILOT_MASTER_HALL_ID ? " [MASTER]" : "";
    console.log(
      `  ${hall.id}${masterTag} (Hall #${hall.hallNumber}, ${hall.name})`,
    );
    console.log(
      `    TV-URL:     http://localhost:4000/admin/#/tv/${hall.id}/${hall.tvToken}`,
    );
  }
  console.log(line);
  console.log("Pilot-innlogginger (samme passord):");
  for (const agent of PILOT_AGENTS) {
    console.log(
      `  Agent login:  ${agent.email} / ${DEMO_PASSWORD} (primary=${agent.primaryHallId})`,
    );
  }
  for (const player of PILOT_PLAYERS) {
    console.log(
      `  Player login: ${player.email} / ${DEMO_PASSWORD} (hall=${player.hallId}, 500 NOK)`,
    );
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
