/**
 * Pilot-blokker regression-test (2026-05-13).
 *
 * # Bug
 *
 * PR #1284 introduserte `Game1ArmedToPurchaseConversionService` for å
 * konvertere armed lobby-state til `app_game1_ticket_purchases`-rader når
 * master starter en scheduled-game. Begge SQL-SELECT-ene i flyten
 * (hooken i `index.ts:runArmedToPurchaseConversionForSpawn` OG
 * `Game1ArmedToPurchaseConversionService.loadScheduledGame`) refererte til
 * kolonnen `hall_id` — som IKKE eksisterer på `app_game1_scheduled_games`.
 * Tabellen har kun `master_hall_id` + `group_hall_id`.
 *
 * Konsekvens:
 *   - Hver hook-trigger kastet `ERROR: column "hall_id" does not exist`
 *     (Postgres error 42703).
 *   - `MasterActionService.triggerArmedConversionHook` fanget feilen og
 *     logget warning — engine.startGame kjørte videre uten konvertering.
 *   - 0 ticket-purchases ble opprettet, selv om spillere hadde armed
 *     bonger og en aktiv wallet-reservasjon.
 *   - Bingo-engine fant 0 purchases → 0 brett-assignments → spillere
 *     så ingen brett i live-rom og fikk pengene returnert ved game-end.
 *
 * Tobias rapporterte 2026-05-12 22:51 (debug-dump
 * spillorama-debug-2026-05-12T22-51-52.json):
 *   > "Bonger blir vist før runden starter, men etter jeg starter runden
 *   >  kommer de opp som forhåndskjøp og er ikke i spill i runden jeg da
 *   >  kjøpte de for."
 *
 * # Fix
 *
 * Begge SQL-SELECT-ene endret til å bruke faktiske kolonnenavn:
 *   - `apps/backend/src/index.ts:runArmedToPurchaseConversionForSpawn`:
 *     SELECT `room_code, ticket_config_json` (droppet `hall_id` siden
 *     ikke brukt i hook-body — masterHallId kommer fra input).
 *   - `Game1ArmedToPurchaseConversionService.loadScheduledGame`:
 *     SELECT `id, master_hall_id, ticket_config_json` (droppet `hall_id`,
 *     beholder `master_hall_id` for `ScheduledGameRow`-interface).
 *
 * # Hva testen verifiserer
 *
 * Mot ekte Postgres (skip uten WALLET_PG_TEST_CONNECTION_STRING):
 *
 *   1. SELECT med faktiske kolonnenavn (slik koden nå gjør) fungerer
 *      uten 42703-feil.
 *   2. SELECT med BUG-shape (`hall_id` istedenfor `master_hall_id`)
 *      KASTER 42703 — hvis en fremtidig regression introduserer
 *      `hall_id`-referansen igjen, vil denne assertion sikre at testen
 *      ruller seg om at SELECT faktisk feiler.
 *
 * Bruk samme skip-mønster og schema-isolasjon som
 * `gameLobbyAggregator.pauseReason.test.ts`.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres regression-test";

function makeTestSchema(): string {
  return `armed_conv_sql_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Speiler `app_game1_scheduled_games`-shape som ble opprettet av
 * migrasjon 20260428000000 + senere kolonne-tillegg. Vi tar med kun de
 * kolonnene fix-paths-en SELECTer — det dekker både hook (`room_code`,
 * `ticket_config_json`) og `loadScheduledGame` (`id`, `master_hall_id`,
 * `ticket_config_json`).
 */
async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE "${schema}"."app_game1_scheduled_games" (
      id UUID PRIMARY KEY,
      master_hall_id TEXT NOT NULL,
      group_hall_id TEXT,
      room_code TEXT,
      status TEXT NOT NULL DEFAULT 'ready_to_start',
      ticket_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "regression: index.ts hook SELECT bruker IKKE ikke-eksisterende hall_id",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);
      const id = randomUUID();
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, master_hall_id, group_hall_id, room_code, ticket_config_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [id, "demo-hall-001", "demo-pilot-goh", "BINGO_DEMO-PILOT-GOH", "{}"],
      );

      // Den nye (fixede) shape — fra runArmedToPurchaseConversionForSpawn
      const { rows } = await pool.query<{
        room_code: string | null;
        ticket_config_json: unknown;
      }>(
        `SELECT room_code, ticket_config_json
           FROM "${schema}"."app_game1_scheduled_games"
          WHERE id = $1`,
        [id],
      );

      assert.equal(rows.length, 1, "Forventet én rad fra SELECT");
      assert.equal(rows[0]?.room_code, "BINGO_DEMO-PILOT-GOH");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "regression: Game1ArmedToPurchaseConversionService.loadScheduledGame SELECT bruker korrekte kolonner",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);
      const id = randomUUID();
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, master_hall_id, ticket_config_json)
         VALUES ($1, $2, $3::jsonb)`,
        [id, "demo-hall-001", "{}"],
      );

      // Den nye (fixede) shape — fra loadScheduledGame
      const { rows } = await pool.query<{
        id: string;
        master_hall_id: string;
        ticket_config_json: unknown;
      }>(
        `SELECT id, master_hall_id, ticket_config_json
           FROM "${schema}"."app_game1_scheduled_games"
          WHERE id = $1`,
        [id],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.master_hall_id, "demo-hall-001");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "guard: SELECT med pre-fix-bug-shape (hall_id) kaster 42703 column does not exist",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      // Den GAMLE (bug) shape — fra PR #1284 før fix
      await assert.rejects(
        () =>
          pool.query(
            `SELECT room_code, hall_id, ticket_config_json
               FROM "${schema}"."app_game1_scheduled_games"
              WHERE id = $1`,
            ["irrelevant"],
          ),
        (err: unknown) => {
          const e = err as { code?: string };
          assert.equal(
            e.code,
            "42703",
            `Forventet 42703 (undefined_column) men fikk ${e.code}`,
          );
          return true;
        },
        "SELECT med ikke-eksisterende hall_id skal kaste 42703",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
