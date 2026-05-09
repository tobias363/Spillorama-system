#!/usr/bin/env npx tsx
/**
 * Spillorama pilot Q3 2026 — komplett prod-seed-orkestrator.
 *
 * Setter opp pilot-data for produksjon i 4 Teknobingo-haller:
 *   - Teknobingo Årnes (master)
 *   - Teknobingo Bodø
 *   - Teknobingo Brumunddal
 *   - Teknobingo Fauske
 *
 * Hva scriptet gjør (i rekkefølge):
 *   1. Resolverer hall-id fra slug (lokal-dev-trygt + prod-trygt — UUID-er
 *      kan avvike mellom miljøer, men slugs er stabile).
 *   2. Verifiserer at app_game_catalog har de 13 katalog-spillene.
 *   3. UPSERT av Group of Halls "Pilot Q3 2026 — Teknobingo" med
 *      master_hall_id pinnet til Teknobingo Årnes. Member-listen håndheves
 *      atomisk (drop+insert i én transaksjon).
 *   4. UPSERT av spilleplan "Pilot Q3 2026 — Hovedplan" bundet til GoH-en.
 *      Items refererer 13 katalog-spill via slug-lookup.
 *   5. UPSERT av 10 test-spillere per hall (40 totalt) med:
 *        - role=PLAYER, kyc_status=VERIFIED
 *        - app_hall_registrations status=ACTIVE
 *        - 1000 NOK starting deposit_balance + wallet_entries bootstrap
 *        - compliance_data.is_test=true for senere cleanup
 *      Email-format: `pilot-q3-<hall-slug>-<n>@spillorama.no`
 *   6. UPSERT av 1 bingovert (agent) per hall med primary-hall-binding.
 *      Email-format: `pilot-q3-agent-<hall-slug>@spillorama.no`
 *      compliance_data.is_test=true for senere cleanup.
 *
 * Idempotent: kan kjøres flere ganger uten å skape duplikater. Eksisterende
 * rader oppdateres selektivt — passord roteres IKKE på allerede satte
 * brukere (re-runs trygge).
 *
 * SIKKERHETSGUARD:
 *   PILOT_TARGET=live må eksplisitt settes for prod-DB. Default-mål er
 *   "local". Mot live må også PILOT_PASSWORD eksplisitt settes (min 12
 *   tegn) — default-passord lekker aldri til prod ved feil.
 *
 * Bruk:
 *   # Lokal dev (krever docker-compose up + npm run migrate):
 *   APP_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama \
 *     npx tsx scripts/seed-pilot-prod-q3-2026.mts
 *
 *   # Dry-run (logger alt, skriver ingenting):
 *   PILOT_DRY_RUN=1 \
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/seed-pilot-prod-q3-2026.mts
 *
 *   # Mot prod (Tobias kjører manuelt):
 *   PILOT_TARGET=live \
 *   PILOT_PASSWORD=<sterkt passord> \
 *   APP_PG_CONNECTION_STRING=postgres://...prod... \
 *     npx tsx scripts/seed-pilot-prod-q3-2026.mts
 *
 * Env-variabler:
 *   APP_PG_CONNECTION_STRING — påkrevd, DB-URL
 *   APP_PG_SCHEMA            — valgfritt, default "public"
 *   PILOT_DRY_RUN            — "1"/"true" → logg kun, ingen skriving
 *   PILOT_TARGET             — "local"|"live", default "local"
 *   PILOT_PASSWORD           — passord for nye test-spillere/agenter
 *                              (default "Spillorama123!" KUN for local target;
 *                              må settes eksplisitt for live)
 *   PILOT_CREATED_BY         — userId loggført som createdBy. Default
 *                              "pilot-prod-seed-q3-2026".
 *
 * Verifiser etter kjøring:
 *   npx tsx scripts/verify-pilot-prod-q3-2026.mts
 *
 * Cleanup etter pilot:
 *   Se docs/operations/PILOT_PROD_SEEDING_Q3_2026.md §"Cleanup".
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

// Last .env fra apps/backend så APP_PG_CONNECTION_STRING blir tilgjengelig
// også når scriptet kjøres fra repo-rot.
dotenv.config({ path: path.resolve(__dirname, "../apps/backend/.env") });

// ── Pilot-konfigurasjon (KANONISK) ──────────────────────────────────────────
//
// Disse 4 hall-slugs matcher app_halls.slug fra `seed-halls.ts`. UUID-ene
// er forventede prod-IDer (verifisert mot project_pilot_readiness_2026_05_01.md
// memory og BIN-587-task-prompt 2026-05-08). Faktisk hall-id resolveres
// run-time fra slug — i lokal dev kan UUID-ene avvike (seed-halls genererer
// nye), men i prod skal de matche eksakt.

/**
 * Pilot-hall-spesifikasjon. `expectedProdHallId` er KUN dokumentasjon —
 * scriptet bruker faktisk hall-id resolved fra slug.
 */
interface PilotHallSpec {
  /** Hall-slug i app_halls.slug — også brukt i email-format. */
  slug: string;
  /** Display-navn for log-output. */
  displayName: string;
  /**
   * Forventet hall-UUID i prod — KUN for dokumentasjon og sanity-warning.
   * Hvis faktisk-id avviker, scriptet logger advarsel men bruker faktisk-id.
   */
  expectedProdHallId: string;
  /** True hvis denne er master-hallen for GoH. Maks ÉN per pilot. */
  isMaster: boolean;
}

/**
 * Pilot-hall-resolved — slug+id etter run-time DB-lookup. Brukes internt
 * i scriptet etter pre-flight har resolvet slug → faktisk hall-id.
 */
interface PilotHall extends PilotHallSpec {
  /** Faktisk hall-ID resolved fra app_halls.slug ved pre-flight. */
  hallId: string;
}

export const PILOT_HALL_SPECS: readonly PilotHallSpec[] = [
  {
    slug: "arnes",
    displayName: "Teknobingo Årnes",
    expectedProdHallId: "b18b7928-3469-4b71-a34d-3f81a1b09a88",
    isMaster: true,
  },
  {
    slug: "bodo",
    displayName: "Teknobingo Bodø",
    expectedProdHallId: "afebd2a2-52d7-4340-b5db-64453894cd8e",
    isMaster: false,
  },
  {
    slug: "brumunddal",
    displayName: "Teknobingo Brumunddal",
    expectedProdHallId: "46dbd01a-4033-4d87-86ca-bf148d0359c1",
    isMaster: false,
  },
  {
    slug: "fauske",
    displayName: "Teknobingo Fauske",
    expectedProdHallId: "ff631941-f807-4c39-8e41-83ca0b50d879",
    isMaster: false,
  },
] as const;

/**
 * Backward-compat alias — re-eksporteres for verify-scriptet og evt. andre
 * konsumenter. Bruker `expectedProdHallId` som `hallId`-felt så signature
 * forblir lik. NB: faktisk hall-id i live brukes via run-time-resolved
 * `PilotHall[]` fra `resolveHallIds()`-helperen.
 */
export const PILOT_HALLS: readonly PilotHall[] = PILOT_HALL_SPECS.map((s) => ({
  ...s,
  hallId: s.expectedProdHallId,
}));

/** Group of Halls metadata. Stable id så re-runs kan finne samme rad. */
export const PILOT_GROUP_ID = "pilot-q3-2026-teknobingo";
export const PILOT_GROUP_NAME = "Pilot Q3 2026 — Teknobingo";

/** GamePlan metadata. Stable id for idempotens. */
export const PILOT_PLAN_ID = "pilot-q3-2026-hovedplan";
export const PILOT_PLAN_NAME = "Pilot Q3 2026 — Hovedplan";
export const PILOT_PLAN_WEEKDAYS: readonly string[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
export const PILOT_PLAN_START_TIME = "11:00";
export const PILOT_PLAN_END_TIME = "21:00";

/**
 * Plan-items: rekkefølgen av spill i sekvens. Bruker slug fra
 * `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §1.4 (de 13 katalog-spillene).
 *
 * Disse slugs MÅ være seedet i `app_game_catalog` før dette scriptet kan
 * kjøres. Verifisert via `seed-demo-pilot-day` eller manuell admin-CRUD.
 */
export const PILOT_PLAN_ITEM_SLUGS: readonly string[] = [
  "bingo",
  "1000-spill",
  "5x500",
  "ball-x-10",
  "innsatsen",
  "jackpot",
  "kvikkis",
  "oddsen-55",
  "oddsen-56",
  "oddsen-57",
  "trafikklys",
  "tv-extra",
  "bingo", // siste spill — gjentar standard for natt-runde
];

/** Antall test-spillere som lages per hall. */
export const PLAYERS_PER_HALL = 10;

/** Starting deposit-balance (NOK) på test-spillere. */
export const PLAYER_DEPOSIT_MAJOR = 1000;

/** Birth-date for alle test-spillere (over 18 — KYC-validering). */
export const PLAYER_BIRTH_DATE = "1990-01-01";

/** Email-prefiks for alle pilot-Q3-test-spillere. Brukes i cleanup-filter. */
export const PILOT_PLAYER_EMAIL_PREFIX = "pilot-q3-";

/** Email-prefiks for alle pilot-Q3-bingoverter. Brukes i cleanup-filter. */
export const PILOT_AGENT_EMAIL_PREFIX = "pilot-q3-agent-";

/**
 * Markerer alle test-data som skal fjernes etter pilot. Settes i
 * `compliance_data.is_test` for spillere/agenter, og i `extra.is_test` for
 * GoH/plan. Cleanup-script filterer på dette.
 */
export const PILOT_TEST_MARKER = "pilot-q3-2026";

// ── Context + env-handling ──────────────────────────────────────────────────

interface SeedContext {
  dryRun: boolean;
  target: "local" | "live";
  password: string;
  createdBy: string;
}

function readContext(): SeedContext {
  const dryRun = ["1", "true", "yes"].includes(
    String(process.env.PILOT_DRY_RUN ?? "").toLowerCase(),
  );
  const targetRaw = (process.env.PILOT_TARGET ?? "local").toLowerCase();
  const target: "local" | "live" = targetRaw === "live" ? "live" : "local";
  const createdBy =
    process.env.PILOT_CREATED_BY?.trim() || "pilot-prod-seed-q3-2026";

  // SIKKERHET: live-target krever eksplisitt PILOT_PASSWORD så vi ikke
  // bruker default-passordet i prod ved en feil.
  let password: string;
  if (target === "live") {
    const envPwd = process.env.PILOT_PASSWORD?.trim();
    if (!envPwd) {
      console.error(
        "[seed-pilot-prod-q3] PILOT_TARGET=live krever PILOT_PASSWORD eksplisitt.",
      );
      console.error(
        "    Sett PILOT_PASSWORD til et sterkt passord (min 12 tegn).",
      );
      process.exit(1);
    }
    if (envPwd.length < 12) {
      console.error(
        "[seed-pilot-prod-q3] PILOT_PASSWORD må være minst 12 tegn for live-target.",
      );
      process.exit(1);
    }
    password = envPwd;
  } else {
    password = process.env.PILOT_PASSWORD?.trim() || "Spillorama123!";
  }

  return { dryRun, target, password, createdBy };
}

function requireConnectionString(): string {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    "";
  if (!connectionString.trim()) {
    console.error(
      "[seed-pilot-prod-q3] APP_PG_CONNECTION_STRING mangler. Sett denne i .env eller som env-var.",
    );
    process.exit(1);
  }
  return connectionString;
}

// ── Hashing (matcher PlatformService.hashPassword) ──────────────────────────

async function hashScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

// ── Schema-introspeksjon ────────────────────────────────────────────────────

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

// ── Pre-flight: resolve halls via slug (idempotent + lokal-dev-trygt) ──────

/**
 * Slår opp hall-rader via slug i app_halls. Returnerer fulle PilotHall-
 * objekter med faktisk run-time-hallId. Aborter scriptet hvis noen mangler.
 *
 * Logger en advarsel (ikke abort) hvis faktisk hall-id avviker fra
 * `expectedProdHallId` — dette skjer normalt i lokal dev (seed-halls
 * genererer nye UUIDs per run), men i prod skal det være en exact match.
 */
async function resolveHallIds(client: Client): Promise<readonly PilotHall[]> {
  const slugs = PILOT_HALL_SPECS.map((h) => h.slug);
  const { rows } = await client.query<{
    id: string;
    slug: string;
    is_active: boolean;
  }>(
    `SELECT id, slug, is_active FROM app_halls WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const resolved: PilotHall[] = [];
  const missing: PilotHallSpec[] = [];
  const inactive: PilotHallSpec[] = [];

  for (const spec of PILOT_HALL_SPECS) {
    const row = bySlug.get(spec.slug);
    if (!row) {
      missing.push(spec);
      continue;
    }
    if (!row.is_active) {
      inactive.push(spec);
    }
    resolved.push({ ...spec, hallId: row.id });

    if (row.id !== spec.expectedProdHallId) {
      console.warn(
        `  [warn] ${spec.slug}: faktisk hall-id ${row.id} avviker fra forventet prod-id ${spec.expectedProdHallId} — bruker faktisk-id (forventet kun lokalt dev)`,
      );
    }
  }

  if (missing.length > 0) {
    console.error(
      "[seed-pilot-prod-q3] ABORT — disse hall-slugs finnes IKKE i app_halls:",
    );
    for (const h of missing) {
      console.error(`  - ${h.displayName} (slug=${h.slug})`);
    }
    console.error(
      "\nKjør `npx tsx apps/backend/scripts/seed-halls.ts` først for å seede hallene.",
    );
    process.exit(1);
  }

  if (inactive.length > 0) {
    console.error(
      "[seed-pilot-prod-q3] ABORT — disse hallene er INACTIVE i app_halls:",
    );
    for (const h of inactive) {
      console.error(`  - ${h.displayName} (slug=${h.slug})`);
    }
    console.error(
      "\nAktiver hallene via admin/halls eller `UPDATE app_halls SET is_active=TRUE WHERE slug IN (...)`",
    );
    process.exit(1);
  }

  console.log(
    `  [resolve-halls] ${resolved.length}/${PILOT_HALL_SPECS.length} pilot-haller resolved fra slug`,
  );
  return resolved;
}

// ── Pre-flight: verify game-catalog has required slugs ──────────────────────

async function verifyCatalogHasRequiredSlugs(client: Client): Promise<void> {
  const exists = await tableExists(client, "app_game_catalog");
  if (!exists) {
    console.error(
      "[seed-pilot-prod-q3] ABORT — `app_game_catalog`-tabell finnes ikke.",
    );
    console.error(
      "    Kjør `npm --prefix apps/backend run migrate` først.",
    );
    process.exit(1);
  }
  const requiredSlugs = Array.from(new Set(PILOT_PLAN_ITEM_SLUGS));
  const { rows } = await client.query<{ slug: string }>(
    `SELECT slug FROM app_game_catalog
     WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
    [requiredSlugs],
  );
  const found = new Set(rows.map((r) => r.slug));
  const missing = requiredSlugs.filter((s) => !found.has(s));
  if (missing.length > 0) {
    console.error(
      "[seed-pilot-prod-q3] ABORT — disse katalog-spillene mangler i app_game_catalog:",
    );
    for (const s of missing) {
      console.error(`  - ${s}`);
    }
    console.error(
      "\nKjør `npm --prefix apps/backend run seed:demo-pilot-day` først,",
    );
    console.error(
      "eller seed katalogen manuelt via admin-UI under /admin/#/games/catalog.",
    );
    process.exit(1);
  }
  console.log(
    `  [verify-catalog] alle ${requiredSlugs.length} katalog-spill finnes`,
  );
}

// ── Resolve created_by for FK-references ────────────────────────────────────

/**
 * Resolverer en valid `created_by`-userId for FK-referanser i app_hall_groups
 * og app_game_plan. Begge kolonner er nullable + ON DELETE SET NULL, så
 * NULL er lovlig fallback hvis ingen admin-bruker finnes som matcher
 * `ctx.createdBy`. Foretrekker admin-rolle hvis tilgjengelig.
 */
async function resolveCreatedByUserId(
  client: Client,
  ctx: SeedContext,
): Promise<string | null> {
  // Sjekk om ctx.createdBy matcher en eksisterende user-id direkte.
  const direct = await client.query<{ id: string }>(
    `SELECT id FROM app_users WHERE id = $1 LIMIT 1`,
    [ctx.createdBy],
  );
  if (direct.rows.length > 0) return direct.rows[0].id;

  // Fall back: finn enhver ADMIN-bruker for audit-trail.
  const admin = await client.query<{ id: string }>(
    `SELECT id FROM app_users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1`,
  );
  if (admin.rows.length > 0) return admin.rows[0].id;

  // Til slutt: NULL (kolonnene er nullable).
  return null;
}

// ── Group of Halls ──────────────────────────────────────────────────────────

async function upsertHallGroup(
  client: Client,
  ctx: SeedContext,
  resolvedHalls: readonly PilotHall[],
  createdByUserId: string | null,
): Promise<void> {
  const masterHallId = resolvedHalls.find((h) => h.isMaster)?.hallId;
  if (!masterHallId) {
    throw new Error("Ingen master-hall definert i PILOT_HALL_SPECS");
  }
  const allHallIds = resolvedHalls.map((h) => h.hallId);

  if (ctx.dryRun) {
    console.log(
      `  [dry-run] ville UPSERT GoH "${PILOT_GROUP_NAME}" med master=${masterHallId}, ${allHallIds.length} medlemmer (createdBy=${createdByUserId ?? "NULL"})`,
    );
    return;
  }

  // Verify whether master_hall_id-kolonnen finnes (kreves siden 20261214 migration).
  const hasMasterCol = await columnExists(
    client,
    "app_hall_groups",
    "master_hall_id",
  );
  if (!hasMasterCol) {
    throw new Error(
      "app_hall_groups.master_hall_id mangler — kjør migrasjonen 20261214000000_app_hall_groups_master_hall_id.sql først",
    );
  }

  // UPSERT gruppen. Hvis den finnes, oppdater navn + master + extra. Member-
  // listen håndteres separat (DELETE + INSERT av medlemmer i samme tx).
  const extra = JSON.stringify({
    is_test: true,
    test_marker: PILOT_TEST_MARKER,
    seeded_at: new Date().toISOString(),
    seeded_by_script: "seed-pilot-prod-q3-2026",
  });

  await client.query(
    `INSERT INTO app_hall_groups
       (id, name, status, master_hall_id, products_json, extra_json,
        created_by, created_at, updated_at)
     VALUES
       ($1, $2, 'active', $3, '[]'::jsonb, $4::jsonb, $5, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           status = 'active',
           master_hall_id = EXCLUDED.master_hall_id,
           extra_json = EXCLUDED.extra_json,
           deleted_at = NULL,
           updated_at = now()`,
    [PILOT_GROUP_ID, PILOT_GROUP_NAME, masterHallId, extra, createdByUserId],
  );

  // Erstatt member-list atomisk: drop alle, så insert alle igjen.
  await client.query(
    `DELETE FROM app_hall_group_members WHERE group_id = $1`,
    [PILOT_GROUP_ID],
  );
  for (const hall of resolvedHalls) {
    await client.query(
      `INSERT INTO app_hall_group_members (group_id, hall_id, added_at)
       VALUES ($1, $2, now())`,
      [PILOT_GROUP_ID, hall.hallId],
    );
  }
  console.log(
    `  [hall-group]      ${PILOT_GROUP_NAME} (id=${PILOT_GROUP_ID}, master=${masterHallId}, members=${resolvedHalls.length})`,
  );
}

// ── GamePlan + items ────────────────────────────────────────────────────────

async function upsertGamePlan(
  client: Client,
  ctx: SeedContext,
  createdByUserId: string | null,
): Promise<void> {
  if (ctx.dryRun) {
    console.log(
      `  [dry-run] ville UPSERT plan "${PILOT_PLAN_NAME}" + ${PILOT_PLAN_ITEM_SLUGS.length} items (createdBy=${createdByUserId ?? "NULL"})`,
    );
    return;
  }

  // UPSERT plan-meta. NB: app_game_plan har CHECK constraint på XOR
  // (hall_id XOR group_of_halls_id) — vi setter group_of_halls_id og lar
  // hall_id være NULL.
  await client.query(
    `INSERT INTO app_game_plan
       (id, name, description, hall_id, group_of_halls_id, weekdays_json,
        start_time, end_time, is_active, created_by_user_id,
        created_at, updated_at)
     VALUES
       ($1, $2, $3, NULL, $4, $5::jsonb, $6::time, $7::time, TRUE, $8,
        now(), now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           group_of_halls_id = EXCLUDED.group_of_halls_id,
           weekdays_json = EXCLUDED.weekdays_json,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           is_active = TRUE,
           updated_at = now()`,
    [
      PILOT_PLAN_ID,
      PILOT_PLAN_NAME,
      `Pilot Q3 2026 spilleplan — alle 13 katalog-spill, ${PILOT_HALL_SPECS.length} haller. Auto-seedet av seed-pilot-prod-q3-2026.`,
      PILOT_GROUP_ID,
      JSON.stringify(PILOT_PLAN_WEEKDAYS),
      PILOT_PLAN_START_TIME,
      PILOT_PLAN_END_TIME,
      createdByUserId,
    ],
  );

  // Items: drop alle eksisterende for denne planen, så insert i sekvens.
  // Stable items-id basert på (plan, position) for predictability.
  await client.query(
    `DELETE FROM app_game_plan_item WHERE plan_id = $1`,
    [PILOT_PLAN_ID],
  );

  // Slå opp catalog-id per slug (én gang).
  const slugSet = Array.from(new Set(PILOT_PLAN_ITEM_SLUGS));
  const { rows: catalogRows } = await client.query<{
    id: string;
    slug: string;
  }>(
    `SELECT id, slug FROM app_game_catalog
     WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
    [slugSet],
  );
  const catalogBySlug = new Map(catalogRows.map((r) => [r.slug, r.id]));

  for (let i = 0; i < PILOT_PLAN_ITEM_SLUGS.length; i += 1) {
    const slug = PILOT_PLAN_ITEM_SLUGS[i];
    const catalogId = catalogBySlug.get(slug);
    if (!catalogId) {
      throw new Error(
        `Catalog-slug "${slug}" ikke funnet — pre-flight skulle fanget dette`,
      );
    }
    const itemId = `${PILOT_PLAN_ID}-item-${i + 1}`;
    await client.query(
      `INSERT INTO app_game_plan_item
         (id, plan_id, position, game_catalog_id, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        itemId,
        PILOT_PLAN_ID,
        i + 1,
        catalogId,
        `Pilot Q3 2026 — posisjon ${i + 1}: ${slug}`,
      ],
    );
  }

  console.log(
    `  [game-plan]       ${PILOT_PLAN_NAME} (id=${PILOT_PLAN_ID}, ${PILOT_PLAN_ITEM_SLUGS.length} items, GoH=${PILOT_GROUP_ID})`,
  );
}

// ── Wallet helpers (port av seed-teknobingo-test-players) ──────────────────

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

async function maybeTopUpPlayerWallet(
  client: Client,
  userId: string,
  amountMajor: number,
): Promise<{ ok: true; walletId: string } | { ok: false; reason: string }> {
  const exists = await tableExists(client, "wallet_accounts");
  if (!exists) {
    return { ok: false, reason: "wallet_accounts-tabell finnes ikke" };
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

async function ensureWalletBootstrapEntry(
  client: Client,
  walletId: string,
  accountSide: "deposit" | "winnings",
  targetBalanceMajor: number,
): Promise<void> {
  const hasWalletEntries = await tableExists(client, "wallet_entries");
  if (!hasWalletEntries) return;

  const operationId = `pilot-q3-bootstrap-${walletId}-${accountSide}`;
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

// ── Player upsert ───────────────────────────────────────────────────────────

interface UpsertPlayerInput {
  id: string;
  email: string;
  displayName: string;
  surname: string;
  hallId: string;
  password: string;
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

  // compliance_data brukes til å markere test-spillere for senere cleanup.
  const complianceData = JSON.stringify({
    createdBy: "SEED_PILOT_PROD_Q3_2026",
    is_test: true,
    test_marker: PILOT_TEST_MARKER,
    seeded_at: new Date().toISOString(),
  });

  if (existing.rows[0]) {
    // Bevarer passord — re-runs roterer ikke credentials.
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
              compliance_data = $7::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        existingId,
        input.email,
        input.displayName,
        input.surname,
        input.hallId,
        PLAYER_BIRTH_DATE,
        complianceData,
      ],
    );
    return { created: false };
  }

  const passwordHash = await hashScrypt(input.password);
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
    "$8::jsonb",
  ];
  const values: unknown[] = [
    input.id,
    input.email,
    input.displayName,
    input.surname,
    passwordHash,
    walletId,
    PLAYER_BIRTH_DATE,
    complianceData,
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

// ── Agent upsert ────────────────────────────────────────────────────────────

interface UpsertAgentInput {
  id: string;
  email: string;
  displayName: string;
  surname: string;
  primaryHallId: string;
  password: string;
  /** FK til app_users.id — NULL hvis ingen admin finnes ennå. */
  assignedByUserId: string | null;
}

async function upsertAgent(
  client: Client,
  input: UpsertAgentInput,
): Promise<{ created: boolean }> {
  const walletId = `wallet-user-${input.id}`;
  await ensureWalletAccount(client, walletId);

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM app_users WHERE id = $1 OR email = $2 LIMIT 1",
    [input.id, input.email],
  );

  const complianceData = JSON.stringify({
    createdBy: "SEED_PILOT_PROD_Q3_2026",
    is_test: true,
    test_marker: PILOT_TEST_MARKER,
    seeded_at: new Date().toISOString(),
    role_note: "agent (bingovert)",
  });

  let userId: string;
  let created = false;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE app_users
          SET email = $2,
              display_name = $3,
              surname = $4,
              role = 'AGENT',
              hall_id = $5,
              kyc_status = 'VERIFIED',
              kyc_verified_at = COALESCE(kyc_verified_at, now()),
              compliance_data = $6::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        userId,
        input.email,
        input.displayName,
        input.surname,
        input.primaryHallId,
        complianceData,
      ],
    );
  } else {
    const passwordHash = await hashScrypt(input.password);
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
      "compliance_data",
    ];
    const placeholders = [
      "$1",
      "$2",
      "$3",
      "$4",
      "$5",
      "$6",
      "'AGENT'",
      "'VERIFIED'",
      "now()",
      "$7::jsonb",
    ];
    const values: unknown[] = [
      input.id,
      input.email,
      input.displayName,
      input.surname,
      passwordHash,
      walletId,
      complianceData,
    ];
    if (hasHallId) {
      cols.push("hall_id");
      placeholders.push(`$${values.length + 1}`);
      values.push(input.primaryHallId);
    }
    await client.query(
      `INSERT INTO app_users (${cols.join(", ")})
       VALUES (${placeholders.join(", ")})`,
      values,
    );
    userId = input.id;
    created = true;
  }

  // app_agent_profiles (BIN-583 B3.1) — INSERT-or-update profile-row.
  // Fail-soft hvis tabellen ikke finnes (dev-DB uten migration).
  const hasAgentProfiles = await tableExists(client, "app_agent_profiles");
  if (hasAgentProfiles) {
    await client.query(
      `INSERT INTO app_agent_profiles
         (user_id, language, agent_status, parent_user_id, created_at, updated_at)
       VALUES ($1, 'nb', 'active', NULL, now(), now())
       ON CONFLICT (user_id) DO UPDATE
         SET agent_status = 'active',
             updated_at = now()`,
      [userId],
    );
  }

  // app_agent_halls — primary-binding.
  const hasAgentHalls = await tableExists(client, "app_agent_halls");
  if (hasAgentHalls) {
    // Drop all hall-bindings for this agent, så insert primary-binding.
    // Dette håndterer re-runs der primary-hallen er endret.
    await client.query(
      `DELETE FROM app_agent_halls WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `INSERT INTO app_agent_halls
         (user_id, hall_id, is_primary, assigned_at, assigned_by_user_id)
       VALUES ($1, $2, TRUE, now(), $3)`,
      [userId, input.primaryHallId, input.assignedByUserId],
    );
  }

  return { created };
}

// ── Main flow ───────────────────────────────────────────────────────────────

interface SeedReport {
  hallName: string;
  hallId: string;
  playersCreated: number;
  playersExisted: number;
  walletTopupOk: number;
  agentCreated: boolean;
  agentExisted: boolean;
}

async function main(): Promise<void> {
  const ctx = readContext();
  const connectionString = requireConnectionString();
  const schema = process.env.APP_PG_SCHEMA ?? "public";

  console.log("[seed-pilot-prod-q3] start");
  console.log(`  target:    ${ctx.target}`);
  console.log(`  schema:    ${schema}`);
  console.log(`  dry-run:   ${ctx.dryRun}`);
  console.log(`  createdBy: ${ctx.createdBy}`);
  console.log("");

  if (ctx.target === "live") {
    console.log(
      "[seed-pilot-prod-q3] *** LIVE-DB MODE *** — sjekk APP_PG_CONNECTION_STRING peker på prod.",
    );
    console.log("");
  }

  const client = new Client({ connectionString });
  await client.connect();

  const reports: SeedReport[] = [];

  try {
    if (!ctx.dryRun) {
      await client.query("BEGIN");
    }

    console.log("[1/5] Pre-flight: resolve halls via slug");
    const resolvedHalls = await resolveHallIds(client);

    console.log("");
    console.log("[2/5] Pre-flight: verify game-catalog has required slugs");
    await verifyCatalogHasRequiredSlugs(client);

    // Resolverer FK-ref for created_by — eksisterende admin ELLER NULL.
    // Dette er nødvendig fordi ctx.createdBy er en pseudo-string som ikke
    // tilsvarer en faktisk app_users.id i fersk DB.
    const createdByUserId = await resolveCreatedByUserId(client, ctx);
    console.log(
      `  [resolve-created-by] using userId=${createdByUserId ?? "NULL (ingen admin funnet)"}`,
    );

    console.log("");
    console.log("[3/5] Group of Halls + master-binding");
    await upsertHallGroup(client, ctx, resolvedHalls, createdByUserId);

    console.log("");
    console.log("[4/5] GamePlan + items (13 katalog-spill)");
    await upsertGamePlan(client, ctx, createdByUserId);

    console.log("");
    console.log(
      `[5/5] Test-spillere (${PLAYERS_PER_HALL}/hall) + bingoverter (1/hall)`,
    );

    for (const hall of resolvedHalls) {
      console.log(`\n== ${hall.displayName} (${hall.hallId}) ==`);
      const report: SeedReport = {
        hallName: hall.displayName,
        hallId: hall.hallId,
        playersCreated: 0,
        playersExisted: 0,
        walletTopupOk: 0,
        agentCreated: false,
        agentExisted: false,
      };

      // 5a. Test-spillere
      for (let i = 1; i <= PLAYERS_PER_HALL; i += 1) {
        const userId = `${PILOT_PLAYER_EMAIL_PREFIX}${hall.slug}-${i}`;
        const email = `${PILOT_PLAYER_EMAIL_PREFIX}${hall.slug}-${i}@spillorama.no`;
        const displayName = `Pilot Q3 ${hall.slug}-${i}`;

        if (ctx.dryRun) {
          console.log(`  [dry-run] ville UPSERT spiller ${email}`);
          continue;
        }

        const result = await upsertPlayer(client, {
          id: userId,
          email,
          displayName,
          surname: "Pilot",
          hallId: hall.hallId,
          password: ctx.password,
        });
        if (result.created) report.playersCreated += 1;
        else report.playersExisted += 1;

        const topup = await maybeTopUpPlayerWallet(
          client,
          userId,
          PLAYER_DEPOSIT_MAJOR,
        );
        if (topup.ok) {
          await ensureWalletBootstrapEntry(
            client,
            topup.walletId,
            "deposit",
            PLAYER_DEPOSIT_MAJOR,
          );
          report.walletTopupOk += 1;
        }

        const walletId = `wallet-user-${userId}`;
        await upsertHallRegistration(client, {
          id: `reg-${userId}`,
          userId,
          walletId,
          hallId: hall.hallId,
          activatedByUserId: createdByUserId,
        });

        const tag = result.created ? "[NEW]" : "[upd]";
        const wTag = topup.ok ? "wallet=ok" : `wallet-skip:${topup.reason}`;
        console.log(`  ${tag} ${email} → reg-${userId} (${wTag})`);
      }

      // 5b. Bingovert (1 per hall)
      const agentId = `${PILOT_AGENT_EMAIL_PREFIX}${hall.slug}`;
      const agentEmail = `${PILOT_AGENT_EMAIL_PREFIX}${hall.slug}@spillorama.no`;

      if (ctx.dryRun) {
        console.log(`  [dry-run] ville UPSERT bingovert ${agentEmail}`);
      } else {
        const agentResult = await upsertAgent(client, {
          id: agentId,
          email: agentEmail,
          displayName: `Bingovert ${hall.displayName}`,
          surname: "Pilot",
          primaryHallId: hall.hallId,
          password: ctx.password,
          assignedByUserId: createdByUserId,
        });
        if (agentResult.created) {
          report.agentCreated = true;
        } else {
          report.agentExisted = true;
        }
        const tag = agentResult.created ? "[NEW]" : "[upd]";
        console.log(`  ${tag} ${agentEmail} → primary-hall=${hall.hallId}`);
      }

      reports.push(report);
    }

    if (!ctx.dryRun) {
      await client.query("COMMIT");
    }
  } catch (err) {
    if (!ctx.dryRun) {
      await client.query("ROLLBACK");
    }
    console.error("\n[seed-pilot-prod-q3] failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log("\n");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  PILOT Q3 2026 — SEED REPORT");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  GoH:    ${PILOT_GROUP_NAME} (id=${PILOT_GROUP_ID})`);
  console.log(`  Plan:   ${PILOT_PLAN_NAME} (id=${PILOT_PLAN_ID})`);
  console.log(`  Items:  ${PILOT_PLAN_ITEM_SLUGS.length} katalog-spill`);
  console.log("");
  let totalPlayers = 0;
  let totalAgents = 0;
  for (const r of reports) {
    const players = r.playersCreated + r.playersExisted;
    totalPlayers += players;
    if (r.agentCreated || r.agentExisted) totalAgents += 1;
    console.log(
      `  ${r.hallName.padEnd(30)} players=${players} (${r.playersCreated} new) wallet_ok=${r.walletTopupOk} agent=${r.agentCreated ? "NEW" : r.agentExisted ? "upd" : "—"}`,
    );
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log(
    `  TOTAL: ${totalPlayers} test-spillere, ${totalAgents} bingoverter`,
  );
  console.log("══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Login-credentials:");
  console.log(
    `  Spillere: ${PILOT_PLAYER_EMAIL_PREFIX}<hall>-<n>@spillorama.no  (n=1..${PLAYERS_PER_HALL})`,
  );
  console.log(
    `  Agenter:  ${PILOT_AGENT_EMAIL_PREFIX}<hall>@spillorama.no`,
  );
  if (ctx.target === "local") {
    console.log(`  Passord:  ${ctx.password}`);
  } else {
    console.log(`  Passord:  <see PILOT_PASSWORD env-var>`);
  }
  console.log("");
  console.log("Verifiser:");
  console.log("  npx tsx scripts/verify-pilot-prod-q3-2026.mts");
  console.log("");
  console.log("Cleanup etter pilot:");
  console.log("  Se docs/operations/PILOT_PROD_SEEDING_Q3_2026.md §Cleanup");
}

const invokedDirectly =
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[seed-pilot-prod-q3] feilet:", error);
    process.exit(1);
  });
}
