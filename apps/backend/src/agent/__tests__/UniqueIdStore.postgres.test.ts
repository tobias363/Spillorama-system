/**
 * P0-4 (BIN-pilot 2026-05-01): regression tests for PostgresUniqueIdStore.
 *
 * Background — produksjon-pilot 2026-05-01 viste at
 * `POST /api/agent/unique-ids` returnerte `INTERNAL_ERROR` på alle forsøk.
 * Root cause: `insertCard` bandt `hours_validity` som JS-`number` (integer),
 * mens SQL-en bruker `($4 || ' hours')::interval` som krever at parameteren
 * er TEXT (eller eksplisitt cast). PostgreSQL kaster da `operator does not
 * exist: integer || unknown` → bobler opp som generic Error → `apiFailure`
 * mapper til `INTERNAL_ERROR`.
 *
 * Disse testene bruker en mock-pool som inspiserer SQL og parametrene som
 * blir sendt til `pool.query`. De fanger regresjon hvis noen later parametere
 * uten String()-cast i interval-konkateneringen.
 *
 * Konvensjon i kodebasen — alle ($N || ' hours/seconds/days')::interval-
 * konstruksjoner bruker String(...) for parameter-binding:
 *   - apps/backend/src/payments/SwedbankPayService.ts:666
 *   - apps/backend/src/jobs/swedbankPaymentSync.ts:61
 *   - apps/backend/src/game/Game1TransferHallService.ts:319
 *   - apps/backend/src/jobs/bankIdExpiryReminder.ts:92,103
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PostgresUniqueIdStore } from "../UniqueIdStore.js";

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

/** Minimal Pool stub som fanger query-tekst + parametre og returnerer en
 *  passende fake-rad (i samme form som RETURNING * gir tilbake fra
 *  app_unique_ids). Bare insertCard og insertTransaction trenger å
 *  returnere data; de andre returneres som tomme/identitets-svar. */
function makeMockPool(): { pool: unknown; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const pool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });

      const now = new Date();
      if (/INSERT\s+INTO\s+app_unique_ids\b/i.test(sql)) {
        const p = params ?? [];
        return {
          rows: [
            {
              id: p[0],
              hall_id: p[1],
              balance_cents: p[2],
              purchase_date: now,
              expiry_date: new Date(now.getTime() + 24 * 60 * 60 * 1000),
              hours_validity: typeof p[3] === "string" ? Number(p[3]) : p[3],
              payment_type: p[4],
              created_by_agent_id: p[5],
              printed_at: now,
              reprinted_count: 0,
              last_reprinted_at: null,
              last_reprinted_by: null,
              status: "ACTIVE",
              regenerated_from_id: p[6] ?? null,
              created_at: now,
              updated_at: now,
            },
          ],
        };
      }
      if (/INSERT\s+INTO\s+app_unique_id_transactions\b/i.test(sql)) {
        const p = params ?? [];
        return {
          rows: [
            {
              id: p[0],
              unique_id: p[1],
              action_type: p[2],
              amount_cents: p[3],
              previous_balance: p[4],
              new_balance: p[5],
              payment_type: p[6],
              agent_user_id: p[7],
              game_type: p[8],
              reason: p[9],
              created_at: now,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  return { pool, queries };
}

test("P0-4: insertCard binds hours_validity as a STRING, not integer", async () => {
  const { pool, queries } = makeMockPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new PostgresUniqueIdStore({ pool: pool as any });

  await store.insertCard({
    id: "100000001",
    hallId: "hall-a",
    balanceCents: 20_000,
    hoursValidity: 24,
    paymentType: "CASH",
    createdByAgentId: "agent-1",
  });

  const insertQuery = queries.find((q) => /INSERT\s+INTO\s+app_unique_ids\b/i.test(q.sql));
  assert.ok(insertQuery, "expected INSERT INTO app_unique_ids");
  const params = insertQuery.params ?? [];
  // Parameter $4 (zero-indexed [3]) is the hours-validity. Må være TEXT
  // (string) — ikke number — slik at PostgreSQL kan utføre `$4 || ' hours'`
  // uten å treffe `operator does not exist: integer || unknown`.
  assert.equal(
    typeof params[3],
    "string",
    `hours_validity bound as ${typeof params[3]} — må være "string" (P0-4 regresjon)`
  );
  assert.equal(params[3], "24", "stringified verdi bevarer hoursValidity-tallet");
});

test("P0-4: insertCard SQL caster $4 til INT for hours_validity-kolonnen", async () => {
  const { pool, queries } = makeMockPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new PostgresUniqueIdStore({ pool: pool as any });

  await store.insertCard({
    id: "100000002",
    hallId: "hall-a",
    balanceCents: 10_000,
    hoursValidity: 48,
    paymentType: "CARD",
    createdByAgentId: "agent-1",
  });

  const insertQuery = queries.find((q) => /INSERT\s+INTO\s+app_unique_ids\b/i.test(q.sql));
  assert.ok(insertQuery);
  // SQL-en må caste til INT for kolonne-typen (INTEGER NOT NULL CHECK >= 24).
  // `$4::int` er signaturen vi forventer — uten den ville `INSERT` feile fordi
  // tekst ikke kan settes inn i en INTEGER-kolonne.
  assert.match(
    insertQuery.sql,
    /\$4::int\b/,
    "SQL må caste $4 til ::int for hours_validity-kolonnen"
  );
  // Verifiser at intervall-konkateneringen fortsatt bruker $4 som tekst.
  assert.match(
    insertQuery.sql,
    /\(\$4 \|\| ' hours'\)::interval/,
    "intervall-konkateneringen må fortsatt være ($4 || ' hours')::interval"
  );
});

test("P0-4: insertCard fungerer for ulike hoursValidity-verdier (24, 25, 168, 720)", async () => {
  for (const h of [24, 25, 168, 720]) {
    const { pool, queries } = makeMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PostgresUniqueIdStore({ pool: pool as any });
    const card = await store.insertCard({
      id: `card-${h}`,
      hallId: "hall-a",
      balanceCents: 5000,
      hoursValidity: h,
      paymentType: "CASH",
      createdByAgentId: "agent-1",
    });
    const insertQuery = queries.find((q) =>
      /INSERT\s+INTO\s+app_unique_ids\b/i.test(q.sql)
    );
    const params = insertQuery?.params ?? [];
    assert.equal(typeof params[3], "string", `h=${h}: må være string`);
    assert.equal(params[3], String(h));
    // Returnert kort skal eksponere INTEGER, ikke string.
    assert.equal(card.hoursValidity, h);
  }
});
