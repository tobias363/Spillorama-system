#!/usr/bin/env npx tsx
/**
 * Fase 4 (2026-05-07): data-migrasjon-skript for spilleplan-redesign.
 *
 * Migrerer eksisterende data fra:
 *   - app_game1_scheduled_games
 *   - app_daily_schedules
 *   - hall_game_schedules
 *   - app_schedules
 * til ny modell:
 *   - app_game_catalog
 *   - app_game_plan
 *   - app_game_plan_item
 *   - app_game_plan_run
 *
 * Modus:
 *   --dry-run   Vis hva som ville skje, ingen writes (default-output).
 *   --execute   Faktisk migrasjon — INSERTer rader i nye tabeller.
 *   --rollback  Sletter alle rader migrert av denne skriptet (idempotent).
 *
 * Idempotens-strategi:
 *   - Catalog-rader får deterministisk id basert på sub_game_name slug.
 *   - Plan-rader får deterministisk id basert på (hall_id, weekday-key, time-key).
 *   - Plan-item-rader: composite (plan_id, position).
 *   - Re-kjøring → INSERT ... ON CONFLICT DO NOTHING (eksisterende rader uberørt).
 *
 * Rollback-strategi:
 *   - Identifiserer rader skrevet med våre deterministiske id-er
 *     (matching prefix "mig-fase4-...").
 *   - Sletter i FK-rekkefølge: plan_run → plan_item → plan → catalog.
 *
 * Audit:
 *   - Hver kjøring logger til app_audit_log med:
 *     action="data_migration.game_plan_redesign.execute" (eller .dry_run / .rollback)
 *
 * Usage:
 *   npx tsx scripts/migrate-game-plan-2026-05-07.ts --dry-run
 *   npx tsx scripts/migrate-game-plan-2026-05-07.ts --execute
 *   npx tsx scripts/migrate-game-plan-2026-05-07.ts --rollback
 *
 * Live-deploy-trygt:
 *   - Skriptet bruker INSERT ... ON CONFLICT DO NOTHING for idempotens.
 *   - Eksisterende rader (i gamle tabeller) er uberørt.
 *   - Kan kjøres mens prod er live — ingen ALTER TABLE eller LOCK.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  MIGRATION_PREFIX,
  DEFAULT_PRIZES_FALLBACK,
  slugify,
  deterministicCatalogId,
  deterministicPlanId,
  parsePrizeDescription,
  bitmaskToWeekdays,
  jsDayOfWeekToKey,
} from "./migrate-game-plan-helpers.js";

// ── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const execute = args.includes("--execute");
const rollback = args.includes("--rollback");

if ([dryRun, execute, rollback].filter(Boolean).length !== 1) {
  console.error(
    "Usage: npx tsx scripts/migrate-game-plan-2026-05-07.ts <--dry-run | --execute | --rollback>",
  );
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────────

const connectionString = process.env.APP_PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("Error: APP_PG_CONNECTION_STRING env var required");
  process.exit(1);
}
const schema = process.env.APP_PG_SCHEMA?.trim() || "public";

// ── ID-prefix for sporing (re-eksportert fra helpers for backward-compat) ───
// Migration-prefix og default-prizes er importert fra ./migrate-game-plan-helpers.

interface PrintRow {
  table: string;
  action: "INSERT" | "SKIP" | "DELETE";
  id: string;
  detail?: string;
}

// ── Migration logic ──────────────────────────────────────────────────────

interface MigrationStats {
  catalogsCreated: number;
  catalogsSkipped: number;
  plansCreated: number;
  plansSkipped: number;
  itemsCreated: number;
  itemsSkipped: number;
  runsCreated: number;
  runsSkipped: number;
  warnings: string[];
}

function emptyStats(): MigrationStats {
  return {
    catalogsCreated: 0,
    catalogsSkipped: 0,
    plansCreated: 0,
    plansSkipped: 0,
    itemsCreated: 0,
    itemsSkipped: 0,
    runsCreated: 0,
    runsSkipped: 0,
    warnings: [],
  };
}

function printRow(r: PrintRow) {
  const action = r.action.padEnd(7);
  console.log(`  ${action} ${r.table.padEnd(28)} ${r.id} ${r.detail ?? ""}`);
}

interface SubGameAggregate {
  slug: string;
  displayName: string;
  /** Average parsed prizes from sources (or fallback). */
  prizes: typeof DEFAULT_PRIZES_FALLBACK;
  /** Whether any source flagged this as jackpot-game. */
  requiresJackpot: boolean;
  /** Bonus game slug if any source had it. */
  bonusGameSlug: string | null;
  /** Source count (for warnings). */
  sourceCount: number;
}

/**
 * Pass 1: scan eksisterende sub-game-navn fra alle kilder og bygg en unik
 * katalog-set. Vi normaliserer på slug så f.eks "Wheel of Fortune" og
 * "wheel of fortune" havner som samme catalog-rad.
 */
async function scanCatalogSources(
  client: pg.Client,
): Promise<Map<string, SubGameAggregate>> {
  const map = new Map<string, SubGameAggregate>();

  function add(
    rawName: string,
    sourceLabel: string,
    prizeHint: ReturnType<typeof parsePrizeDescription>,
    requiresJackpot: boolean,
    bonusGameSlug: string | null,
  ) {
    const slug = slugify(rawName);
    if (!slug) return;
    const existing = map.get(slug);
    if (existing) {
      existing.sourceCount += 1;
      if (requiresJackpot) existing.requiresJackpot = true;
      if (bonusGameSlug && !existing.bonusGameSlug) {
        existing.bonusGameSlug = bonusGameSlug;
      }
      // Hvis vi har bedre prize-data, oppdater
      if (prizeHint) {
        if (prizeHint.rad1) existing.prizes.rad1 = prizeHint.rad1;
        if (prizeHint.rad2) existing.prizes.rad2 = prizeHint.rad2;
        if (prizeHint.rad3) existing.prizes.rad3 = prizeHint.rad3;
        if (prizeHint.rad4) existing.prizes.rad4 = prizeHint.rad4;
        if (prizeHint.bingo) {
          existing.prizes.bingo.gul = prizeHint.bingo;
          existing.prizes.bingo.hvit = prizeHint.bingo;
        }
      }
    } else {
      const prizes = JSON.parse(
        JSON.stringify(DEFAULT_PRIZES_FALLBACK),
      ) as typeof DEFAULT_PRIZES_FALLBACK;
      if (prizeHint) {
        if (prizeHint.rad1) prizes.rad1 = prizeHint.rad1;
        if (prizeHint.rad2) prizes.rad2 = prizeHint.rad2;
        if (prizeHint.rad3) prizes.rad3 = prizeHint.rad3;
        if (prizeHint.rad4) prizes.rad4 = prizeHint.rad4;
        if (prizeHint.bingo) {
          prizes.bingo.gul = prizeHint.bingo;
          prizes.bingo.hvit = prizeHint.bingo;
        }
      }
      map.set(slug, {
        slug,
        displayName: rawName,
        prizes,
        requiresJackpot,
        bonusGameSlug,
        sourceCount: 1,
      });
    }
    void sourceLabel; // unused but useful for debug
  }

  // ── hall_game_schedules ────────────────────────────────────────────────
  const hgsRows = await client.query<{
    display_name: string;
    prize_description: string;
  }>(`SELECT display_name, prize_description FROM ${schema}.hall_game_schedules WHERE is_active = true`);
  for (const r of hgsRows.rows) {
    const hint = parsePrizeDescription(r.prize_description);
    const isJackpot = /jackpot/i.test(r.display_name);
    add(r.display_name, "hall_game_schedules", hint, isJackpot, null);
  }

  // ── app_schedules.sub_games_json ───────────────────────────────────────
  const schedRows = await client.query<{ sub_games_json: unknown }>(
    `SELECT sub_games_json FROM ${schema}.app_schedules WHERE deleted_at IS NULL`,
  );
  for (const r of schedRows.rows) {
    if (!Array.isArray(r.sub_games_json)) continue;
    for (const sg of r.sub_games_json as unknown[]) {
      if (!sg || typeof sg !== "object") continue;
      const obj = sg as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name : null;
      if (!name) continue;
      const isJackpot = /jackpot/i.test(name);
      // Plukk ut bonus-slug hvis "extra" har det
      let bonusSlug: string | null = null;
      const extra = obj.extra;
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        const v = (extra as Record<string, unknown>).bonusGame;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const slug = (v as Record<string, unknown>).slug;
          if (typeof slug === "string") bonusSlug = slug;
        }
      }
      add(name, "app_schedules", null, isJackpot, bonusSlug);
    }
  }

  // ── app_game1_scheduled_games (sub_game_name) ──────────────────────────
  const sgRows = await client.query<{
    sub_game_name: string;
    custom_game_name: string | null;
  }>(
    `SELECT sub_game_name, custom_game_name FROM ${schema}.app_game1_scheduled_games`,
  );
  for (const r of sgRows.rows) {
    const name = r.custom_game_name ?? r.sub_game_name;
    const isJackpot = /jackpot/i.test(name);
    add(name, "app_game1_scheduled_games", null, isJackpot, null);
  }

  return map;
}

interface PlanAggregate {
  hallId: string;
  /** Weekday-key — "mon-fri" mønster for grupperte planer. */
  weekdays: string[];
  startTime: string;
  endTime: string;
  /** Sub-games i sekvens (slug-basert). */
  subGameSlugs: string[];
  source: string;
}

/**
 * Pass 2: scan plan-kilder (hall_game_schedules + app_daily_schedules) og
 * bygg en samling av plan-aggregat. Vi grupperer på (hallId, weekday).
 */
async function scanPlanSources(
  client: pg.Client,
): Promise<Map<string, PlanAggregate>> {
  const plans = new Map<string, PlanAggregate>();

  // ── hall_game_schedules ────────────────────────────────────────────────
  // En rad per (hall, day_of_week, start_time, sub-game). Vi grupperer
  // per (hall, day_of_week) for å lage en plan med flere items.
  const hgsRows = await client.query<{
    hall_id: string;
    day_of_week: number | null;
    start_time: string;
    display_name: string;
    sort_order: number;
  }>(
    `SELECT hall_id, day_of_week, start_time, display_name, sort_order
     FROM ${schema}.hall_game_schedules
     WHERE is_active = true
     ORDER BY hall_id, day_of_week, start_time, sort_order`,
  );

  for (const r of hgsRows.rows) {
    if (r.day_of_week === null) continue; // ingen ukedag → hopp over
    const weekdayKey = jsDayOfWeekToKey(r.day_of_week);
    if (!weekdayKey) continue;
    const groupKey = `${r.hall_id}|${weekdayKey}`;
    const slug = slugify(r.display_name);
    if (!slug) continue;

    const existing = plans.get(groupKey);
    if (existing) {
      existing.subGameSlugs.push(slug);
    } else {
      // start_time: "HH:MM:SS" eller "HH:MM" — kapp til "HH:MM"
      const startTime = String(r.start_time).slice(0, 5);
      // end_time fallback: 21:00 for dagvariant, 23:00 for kveldsplan
      const startHour = parseInt(startTime.slice(0, 2), 10);
      const endTime = startHour < 18 ? "21:00" : "23:00";
      plans.set(groupKey, {
        hallId: r.hall_id,
        weekdays: [weekdayKey],
        startTime,
        endTime,
        subGameSlugs: [slug],
        source: "hall_game_schedules",
      });
    }
  }

  // ── app_daily_schedules + app_schedules ───────────────────────────────
  // Mer komplekst: daily_schedule har subgames_json eller henviser til
  // schedule via otherData.scheduleId. Vi gjør en grov forenkling: hver
  // daily_schedule blir en plan med alle dens sub-games.
  const dsRows = await client.query<{
    id: string;
    hall_id: string | null;
    week_days: number;
    day: string | null;
    start_time: string;
    end_time: string;
    subgames_json: unknown;
    other_data_json: unknown;
  }>(
    `SELECT id, hall_id, week_days, day, start_time, end_time,
            subgames_json, other_data_json
     FROM ${schema}.app_daily_schedules
     WHERE deleted_at IS NULL AND status IN ('active', 'running')`,
  );

  for (const r of dsRows.rows) {
    if (!r.hall_id) continue; // multi-hall — hoppes over for nå (single-hall fokus)
    if (!r.start_time || !r.end_time) continue;
    // Avled ukedager
    let weekdays: string[] = [];
    if (r.week_days > 0) {
      weekdays = bitmaskToWeekdays(r.week_days);
    } else if (r.day) {
      const dayMap: Record<string, string> = {
        monday: "mon",
        tuesday: "tue",
        wednesday: "wed",
        thursday: "thu",
        friday: "fri",
        saturday: "sat",
        sunday: "sun",
      };
      const k = dayMap[r.day];
      if (k) weekdays.push(k);
    }
    if (weekdays.length === 0) continue;

    // subgames_json: array av {subGameId, name, ...} eller bare ids
    const subSlugs: string[] = [];
    if (Array.isArray(r.subgames_json)) {
      for (const sg of r.subgames_json as unknown[]) {
        if (!sg || typeof sg !== "object") continue;
        const obj = sg as Record<string, unknown>;
        const name =
          typeof obj.name === "string"
            ? obj.name
            : typeof obj.subGameName === "string"
              ? obj.subGameName
              : null;
        if (!name) continue;
        const slug = slugify(name);
        if (slug) subSlugs.push(slug);
      }
    }

    // For hver ukedag, lag en plan-aggregat
    for (const wk of weekdays) {
      const groupKey = `${r.hall_id}|${wk}`;
      if (plans.has(groupKey)) {
        // Allerede dekket av hall_game_schedules — overrid hvis daily har items
        if (subSlugs.length > 0) {
          plans.set(groupKey, {
            hallId: r.hall_id,
            weekdays: [wk],
            startTime: r.start_time,
            endTime: r.end_time,
            subGameSlugs: subSlugs,
            source: "app_daily_schedules",
          });
        }
      } else if (subSlugs.length > 0) {
        plans.set(groupKey, {
          hallId: r.hall_id,
          weekdays: [wk],
          startTime: r.start_time,
          endTime: r.end_time,
          subGameSlugs: subSlugs,
          source: "app_daily_schedules",
        });
      }
    }
  }

  return plans;
}

async function dryRunMigration(client: pg.Client): Promise<MigrationStats> {
  const stats = emptyStats();
  console.log("\n=== Pass 1: Scanning catalog sources ===");
  const catalogs = await scanCatalogSources(client);
  console.log(`Found ${catalogs.size} unique sub-game-types across sources.\n`);
  for (const [slug, agg] of catalogs.entries()) {
    const id = deterministicCatalogId(slug);
    // Sjekk om det allerede finnes en katalog med samme id
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.app_game_catalog WHERE id = $1`,
      [id],
    );
    if (existing.rows.length > 0) {
      stats.catalogsSkipped += 1;
      printRow({
        table: "app_game_catalog",
        action: "SKIP",
        id,
        detail: `(already migrated, sources=${agg.sourceCount})`,
      });
    } else {
      stats.catalogsCreated += 1;
      printRow({
        table: "app_game_catalog",
        action: "INSERT",
        id,
        detail: `slug=${slug}, name="${agg.displayName}", jackpot=${agg.requiresJackpot}, sources=${agg.sourceCount}`,
      });
    }
  }

  console.log("\n=== Pass 2: Scanning plan sources ===");
  const plans = await scanPlanSources(client);
  console.log(`Found ${plans.size} unique (hall, weekday) plan-groups.\n`);
  for (const [groupKey, agg] of plans.entries()) {
    const wkKey = agg.weekdays.join("-");
    const planId = deterministicPlanId(agg.hallId, wkKey);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.app_game_plan WHERE id = $1`,
      [planId],
    );
    if (existing.rows.length > 0) {
      stats.plansSkipped += 1;
      printRow({
        table: "app_game_plan",
        action: "SKIP",
        id: planId,
        detail: `(already migrated)`,
      });
    } else {
      stats.plansCreated += 1;
      printRow({
        table: "app_game_plan",
        action: "INSERT",
        id: planId,
        detail: `hall=${agg.hallId.slice(0, 8)}, days=${wkKey}, items=${agg.subGameSlugs.length}, source=${agg.source}`,
      });
      stats.itemsCreated += agg.subGameSlugs.length;
    }
    void groupKey;
  }

  // Plan-runs migreres ikke automatisk — bare aktive runs migreres,
  // og admin har sjelden aktive runs ved migrasjons-tidspunktet (de
  // settes opp på nytt i ny modell).
  console.log("\n=== Plan-runs: skipped (manual setup in new model) ===");

  return stats;
}

async function executeMigration(client: pg.Client): Promise<MigrationStats> {
  const stats = emptyStats();

  await client.query("BEGIN");

  try {
    // Pass 1: catalogs
    const catalogs = await scanCatalogSources(client);
    for (const [slug, agg] of catalogs.entries()) {
      const id = deterministicCatalogId(slug);
      const ticketColors = ["gul", "hvit"];
      const ticketPrices = { gul: 1000, hvit: 500 };
      // Sjekk bingo-keys matcher ticketColors
      const bingoPrizes: Record<string, number> = {};
      for (const c of ticketColors) {
        bingoPrizes[c] = agg.prizes.bingo[c] ?? 100000;
      }
      const prizesCents = {
        rad1: agg.prizes.rad1,
        rad2: agg.prizes.rad2,
        rad3: agg.prizes.rad3,
        rad4: agg.prizes.rad4,
        bingo: bingoPrizes,
      };
      // Validate bonus-slug whitelist
      const validBonusSlugs = new Set([
        "mystery",
        "wheel_of_fortune",
        "treasure_chest",
        "color_draft",
      ]);
      const bonusSlug =
        agg.bonusGameSlug && validBonusSlugs.has(agg.bonusGameSlug)
          ? agg.bonusGameSlug
          : null;

      const result = await client.query(
        `INSERT INTO ${schema}.app_game_catalog
           (id, slug, display_name, description, rules_json,
            ticket_colors_json, ticket_prices_cents_json, prizes_cents_json,
            bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
            is_active, sort_order, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                 $9, $10, $11, true, 0, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          slug,
          agg.displayName.slice(0, 200),
          `Migrert fra legacy (${agg.sourceCount} kilder)`,
          JSON.stringify({}),
          JSON.stringify(ticketColors),
          JSON.stringify(ticketPrices),
          JSON.stringify(prizesCents),
          bonusSlug,
          bonusSlug !== null,
          agg.requiresJackpot,
        ],
      );
      if (result.rowCount === 0) {
        stats.catalogsSkipped += 1;
      } else {
        stats.catalogsCreated += 1;
      }
    }

    // Pass 2: plans + items
    const plans = await scanPlanSources(client);
    for (const [, agg] of plans.entries()) {
      const wkKey = agg.weekdays.join("-");
      const planId = deterministicPlanId(agg.hallId, wkKey);

      // Sjekk at hall finnes (FK-pre-flight)
      const hallExists = await client.query<{ id: string }>(
        `SELECT id FROM ${schema}.app_halls WHERE id = $1`,
        [agg.hallId],
      );
      if (hallExists.rows.length === 0) {
        stats.warnings.push(
          `Hall ${agg.hallId} finnes ikke — hopper over plan ${planId}`,
        );
        continue;
      }

      const planResult = await client.query(
        `INSERT INTO ${schema}.app_game_plan
           (id, name, description, hall_id, group_of_halls_id,
            weekdays_json, start_time, end_time, is_active, created_by_user_id)
         VALUES ($1, $2, $3, $4, NULL, $5::jsonb, $6, $7, true, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [
          planId,
          `Migrert plan (${wkKey})`,
          `Migrert fra ${agg.source}`,
          agg.hallId,
          JSON.stringify(agg.weekdays),
          agg.startTime,
          agg.endTime,
        ],
      );
      if (planResult.rowCount === 0) {
        stats.plansSkipped += 1;
      } else {
        stats.plansCreated += 1;
      }

      // Items: én rad per sub-game-slug
      for (let i = 0; i < agg.subGameSlugs.length; i++) {
        const slug = agg.subGameSlugs[i]!;
        const catalogId = deterministicCatalogId(slug);
        const itemId = `${MIGRATION_PREFIX}item-${planId.slice(MIGRATION_PREFIX.length + 5)}-${i + 1}`;

        // Pre-flight: catalog må eksistere
        const catalogExists = await client.query<{ id: string }>(
          `SELECT id FROM ${schema}.app_game_catalog WHERE id = $1`,
          [catalogId],
        );
        if (catalogExists.rows.length === 0) {
          stats.warnings.push(
            `Catalog ${catalogId} ikke funnet for item ${itemId} — hopper over`,
          );
          continue;
        }

        const itemResult = await client.query(
          `INSERT INTO ${schema}.app_game_plan_item
             (id, plan_id, position, game_catalog_id, notes)
           VALUES ($1, $2, $3, $4, NULL)
           ON CONFLICT (id) DO NOTHING`,
          [itemId, planId, i + 1, catalogId],
        );
        if (itemResult.rowCount === 0) {
          stats.itemsSkipped += 1;
        } else {
          stats.itemsCreated += 1;
        }
      }
    }

    // Audit-log
    await client.query(
      `INSERT INTO ${schema}.app_audit_log
         (id, actor_id, actor_type, action, resource, resource_id, details)
       VALUES ($1, NULL, 'SYSTEM', 'data_migration.game_plan_redesign.execute',
               'system', NULL, $2::jsonb)`,
      [randomUUID(), JSON.stringify(stats)],
    );

    await client.query("COMMIT");
    return stats;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function rollbackMigration(client: pg.Client): Promise<MigrationStats> {
  const stats = emptyStats();

  console.log(
    "Rollback: deleting all rows with id starting with",
    MIGRATION_PREFIX,
  );

  await client.query("BEGIN");
  try {
    // FK-rekkefølge: plan_run → plan_item → plan → catalog
    const runDel = await client.query(
      `DELETE FROM ${schema}.app_game_plan_run WHERE id LIKE $1`,
      [`${MIGRATION_PREFIX}%`],
    );
    stats.runsCreated -= runDel.rowCount ?? 0;

    const itemDel = await client.query(
      `DELETE FROM ${schema}.app_game_plan_item WHERE id LIKE $1`,
      [`${MIGRATION_PREFIX}%`],
    );
    stats.itemsCreated -= itemDel.rowCount ?? 0;

    const planDel = await client.query(
      `DELETE FROM ${schema}.app_game_plan WHERE id LIKE $1`,
      [`${MIGRATION_PREFIX}%`],
    );
    stats.plansCreated -= planDel.rowCount ?? 0;

    const catDel = await client.query(
      `DELETE FROM ${schema}.app_game_catalog WHERE id LIKE $1`,
      [`${MIGRATION_PREFIX}%`],
    );
    stats.catalogsCreated -= catDel.rowCount ?? 0;

    // Audit
    await client.query(
      `INSERT INTO ${schema}.app_audit_log
         (id, actor_id, actor_type, action, resource, resource_id, details)
       VALUES ($1, NULL, 'SYSTEM', 'data_migration.game_plan_redesign.rollback',
               'system', NULL, $2::jsonb)`,
      [randomUUID(), JSON.stringify(stats)],
    );

    await client.query("COMMIT");
    return stats;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    let stats: MigrationStats;
    if (dryRun) {
      console.log("=== DRY RUN — no writes ===");
      stats = await dryRunMigration(client);
    } else if (execute) {
      console.log("=== EXECUTE — writing to DB ===");
      stats = await executeMigration(client);
    } else {
      stats = await rollbackMigration(client);
    }

    console.log("\n=== Stats ===");
    console.log(JSON.stringify(stats, null, 2));

    if (stats.warnings.length > 0) {
      console.log("\n=== Warnings ===");
      for (const w of stats.warnings) {
        console.log(`- ${w}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
