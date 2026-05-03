/**
 * Regression test for BIN-PILOT-DAY P0-1 (2026-05-01):
 *
 * `buildAuthCheck` (i `statusBootstrap.ts`) skrev tidligere
 *   SELECT 1 FROM app_user_sessions LIMIT 1
 *
 * mens den faktiske tabellen heter `app_sessions` (definert i
 * `migrations/20260413000001_initial_schema.sql:78`). Dette førte til at
 * `/api/status` rapporterte `auth: outage` i prod ved hver sjekk.
 *
 * Denne testen kjører `bootstrapStatusPage` med stubbede dependencies og
 * verifiserer at auth-sjekken sender `SELECT 1 FROM app_sessions LIMIT 1`
 * — slik at en fremtidig regresjon (typo som returnerer det gamle navnet)
 * fanges av CI før deploy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { bootstrapStatusPage } from "../statusBootstrap.js";

function makePoolStub(): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    },
  } as unknown as Pool;
  return { pool, queries };
}

test("buildAuthCheck queries app_sessions (not app_user_sessions)", async () => {
  const { pool, queries } = makePoolStub();

  const fakePlatformService = {
    listHalls: async () => [],
  } as unknown as Parameters<typeof bootstrapStatusPage>[0]["platformService"];

  const fakeWalletAdapter = {
    listAccounts: async () => [],
  } as unknown as Parameters<typeof bootstrapStatusPage>[0]["walletAdapter"];

  const fakeEngine = {
    getAllRoomCodes: () => [],
  } as unknown as Parameters<typeof bootstrapStatusPage>[0]["engine"];

  const { statusService } = bootstrapStatusPage({
    pool,
    platformService: fakePlatformService,
    walletAdapter: fakeWalletAdapter,
    engine: fakeEngine,
    cacheTtlMs: 0, // ingen cache så vi sikkert kjører checks her
  });

  const snapshot = await statusService.getSnapshot();

  // Auth-komponenten skal være "operational" når app_sessions kan leses.
  const authRow = snapshot.components.find((c) => c.component === "auth");
  assert.ok(authRow, "auth-komponent mangler i snapshot");
  assert.equal(
    authRow.status,
    "operational",
    `auth-status forventet operational, fikk ${authRow.status} (${authRow.message ?? ""})`,
  );

  // Ekstra forsvar mot regresjon: vi skal ha sett en query mot app_sessions
  // og IKKE mot app_user_sessions.
  const sawAppSessions = queries.some((q) => /\bapp_sessions\b/.test(q));
  const sawAppUserSessions = queries.some((q) => /\bapp_user_sessions\b/.test(q));

  assert.equal(
    sawAppUserSessions,
    false,
    "auth-sjekken refererer fortsatt til app_user_sessions (regresjon av P0-1).",
  );
  assert.equal(
    sawAppSessions,
    true,
    "auth-sjekken sender ikke en query mot app_sessions slik den skulle.",
  );
});
