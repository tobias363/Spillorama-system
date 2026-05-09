#!/usr/bin/env npx tsx
/**
 * Spillorama pilot Q3 2026 — verifikasjons-script.
 *
 * Sjekker at all pilot-data er på plass og konsistent. Output:
 *   - "READY FOR PILOT" hvis alt er OK
 *   - Liste over mangler hvis noe er feil
 *
 * Ingen skriving — kun read-only SELECT.
 *
 * Bruk:
 *   APP_PG_CONNECTION_STRING=postgres://... npx tsx scripts/verify-pilot-prod-q3-2026.mts
 *
 * Exit-kode:
 *   0 = READY FOR PILOT
 *   1 = mangler funnet (sjekk output)
 *   2 = pre-condition-feil (DB ikke nåbar, schema mangler)
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import {
  PILOT_HALL_SPECS,
  PILOT_GROUP_ID,
  PILOT_GROUP_NAME,
  PILOT_PLAN_ID,
  PILOT_PLAN_NAME,
  PILOT_PLAN_ITEM_SLUGS,
  PILOT_PLAYER_EMAIL_PREFIX,
  PILOT_AGENT_EMAIL_PREFIX,
  PLAYERS_PER_HALL,
  PLAYER_DEPOSIT_MAJOR,
} from "./seed-pilot-prod-q3-2026.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../apps/backend/.env") });

interface CheckResult {
  name: string;
  ok: boolean;
  details: string;
}

function check(name: string, ok: boolean, details: string): CheckResult {
  return { name, ok, details };
}

async function main(): Promise<void> {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    "";
  if (!connectionString.trim()) {
    console.error("[verify-pilot-prod-q3] APP_PG_CONNECTION_STRING mangler.");
    process.exit(2);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err) {
    console.error("[verify-pilot-prod-q3] DB-tilkobling feilet:", err);
    process.exit(2);
  }

  console.log("[verify-pilot-prod-q3] kjører verifikasjon mot");
  console.log(`  schema: ${process.env.APP_PG_SCHEMA ?? "public"}`);
  console.log("");

  const results: CheckResult[] = [];

  try {
    // ── 1. Halls resolveres via slug (lokal-dev-trygt + prod-trygt) ─────────
    const slugs = PILOT_HALL_SPECS.map((h) => h.slug);
    const { rows: hallRows } = await client.query<{
      id: string;
      slug: string;
      is_active: boolean;
    }>(
      `SELECT id, slug, is_active FROM app_halls WHERE slug = ANY($1::text[])`,
      [slugs],
    );
    const hallBySlug = new Map(hallRows.map((r) => [r.slug, r]));

    // Bygg resolved hallId-mapping for downstream queries.
    const resolvedHallIdBySpec = new Map<string, string>();
    for (const spec of PILOT_HALL_SPECS) {
      const row = hallBySlug.get(spec.slug);
      if (!row) {
        results.push(
          check(
            `Hall: ${spec.displayName}`,
            false,
            `slug=${spec.slug} finnes IKKE i app_halls — kjør apps/backend/scripts/seed-halls.ts`,
          ),
        );
      } else if (!row.is_active) {
        results.push(
          check(
            `Hall: ${spec.displayName}`,
            false,
            `slug=${spec.slug} er INACTIVE — aktiver via admin/halls`,
          ),
        );
      } else {
        resolvedHallIdBySpec.set(spec.slug, row.id);
        const idHint =
          row.id === spec.expectedProdHallId
            ? `id=${row.id} (matcher prod)`
            : `id=${row.id} (avviker fra forventet prod-id ${spec.expectedProdHallId} — OK lokalt)`;
        results.push(
          check(
            `Hall: ${spec.displayName}`,
            true,
            `${idHint} slug=${row.slug} active`,
          ),
        );
      }
    }

    // ── 2. Group of Halls + master-binding ──────────────────────────────────
    const { rows: gohRows } = await client.query<{
      id: string;
      name: string;
      status: string;
      master_hall_id: string | null;
      deleted_at: Date | null;
    }>(
      `SELECT id, name, status, master_hall_id, deleted_at
         FROM app_hall_groups
        WHERE id = $1`,
      [PILOT_GROUP_ID],
    );
    const goh = gohRows[0];
    if (!goh) {
      results.push(
        check(
          `GoH: ${PILOT_GROUP_NAME}`,
          false,
          `id=${PILOT_GROUP_ID} finnes ikke — kjør seed-pilot-prod-q3-2026.mts`,
        ),
      );
    } else {
      // Master-hall verifisering basert på resolved id (slug-lookup).
      const expectedMasterSpec = PILOT_HALL_SPECS.find((h) => h.isMaster);
      const expectedMasterId = expectedMasterSpec
        ? resolvedHallIdBySpec.get(expectedMasterSpec.slug)
        : undefined;
      const masterOk = goh.master_hall_id === expectedMasterId;
      const statusOk = goh.status === "active";
      const notDeleted = goh.deleted_at === null;
      results.push(
        check(
          `GoH: ${goh.name}`,
          statusOk && notDeleted && masterOk,
          `master=${goh.master_hall_id ?? "NULL"} (forventet ${expectedMasterId ?? "??"}); status=${goh.status}; deleted=${notDeleted ? "no" : "YES"}`,
        ),
      );

      // Verify members basert på resolved IDs.
      const { rows: memberRows } = await client.query<{ hall_id: string }>(
        `SELECT hall_id FROM app_hall_group_members WHERE group_id = $1`,
        [PILOT_GROUP_ID],
      );
      const memberSet = new Set(memberRows.map((r) => r.hall_id));
      const missingMembers = PILOT_HALL_SPECS.filter((spec) => {
        const hid = resolvedHallIdBySpec.get(spec.slug);
        return !hid || !memberSet.has(hid);
      });
      if (missingMembers.length > 0) {
        results.push(
          check(
            `GoH-members`,
            false,
            `mangler ${missingMembers.map((h) => h.displayName).join(", ")}`,
          ),
        );
      } else {
        results.push(
          check(
            `GoH-members`,
            true,
            `${memberSet.size}/${PILOT_HALL_SPECS.length} haller registrert`,
          ),
        );
      }
    }

    // ── 3. GamePlan + items ─────────────────────────────────────────────────
    const { rows: planRows } = await client.query<{
      id: string;
      name: string;
      hall_id: string | null;
      group_of_halls_id: string | null;
      is_active: boolean;
      start_time: string;
      end_time: string;
    }>(
      `SELECT id, name, hall_id, group_of_halls_id, is_active,
              start_time::text AS start_time, end_time::text AS end_time
         FROM app_game_plan
        WHERE id = $1`,
      [PILOT_PLAN_ID],
    );
    const plan = planRows[0];
    if (!plan) {
      results.push(
        check(
          `Plan: ${PILOT_PLAN_NAME}`,
          false,
          `id=${PILOT_PLAN_ID} finnes ikke — kjør seed-script`,
        ),
      );
    } else {
      const goodGroup = plan.group_of_halls_id === PILOT_GROUP_ID;
      results.push(
        check(
          `Plan: ${plan.name}`,
          plan.is_active && goodGroup,
          `group=${plan.group_of_halls_id ?? "NULL"} active=${plan.is_active} ${plan.start_time}-${plan.end_time}`,
        ),
      );

      // Plan-items count + slug-paritet.
      const { rows: itemRows } = await client.query<{
        position: number;
        slug: string;
      }>(
        `SELECT i.position, c.slug
           FROM app_game_plan_item i
           JOIN app_game_catalog c ON c.id = i.game_catalog_id
          WHERE i.plan_id = $1
          ORDER BY i.position`,
        [PILOT_PLAN_ID],
      );
      const expectedCount = PILOT_PLAN_ITEM_SLUGS.length;
      const actualCount = itemRows.length;
      const slugsMatch = itemRows.every(
        (r, i) => r.slug === PILOT_PLAN_ITEM_SLUGS[i],
      );
      results.push(
        check(
          `Plan-items`,
          actualCount === expectedCount && slugsMatch,
          `${actualCount}/${expectedCount} items, slug-paritet=${slugsMatch ? "OK" : "MISMATCH"}`,
        ),
      );
    }

    // ── 4. Test-spillere per hall ───────────────────────────────────────────
    for (const spec of PILOT_HALL_SPECS) {
      const resolvedHallId = resolvedHallIdBySpec.get(spec.slug);
      if (!resolvedHallId) {
        // Hall mangler — feilen er allerede rapportert i §1.
        continue;
      }

      const emailPrefix = `${PILOT_PLAYER_EMAIL_PREFIX}${spec.slug}-`;
      const { rows: playerRows } = await client.query<{
        id: string;
        email: string;
        kyc_status: string;
        deposit_balance: string | null;
        balance: string | null;
      }>(
        `SELECT u.id, u.email, u.kyc_status,
                wa.deposit_balance,
                CASE WHEN wa.deposit_balance IS NULL THEN wa.balance::text
                     ELSE NULL END AS balance
           FROM app_users u
           LEFT JOIN wallet_accounts wa ON wa.id = u.wallet_id
          WHERE u.email LIKE $1 AND u.role = 'PLAYER'`,
        [`${emailPrefix}%@spillorama.no`],
      );

      const expected = PLAYERS_PER_HALL;
      const verified = playerRows.filter(
        (r) => r.kyc_status === "VERIFIED",
      ).length;
      const withBalance = playerRows.filter((r) => {
        const bal = Number(r.deposit_balance ?? r.balance ?? "0");
        return bal >= PLAYER_DEPOSIT_MAJOR;
      }).length;

      results.push(
        check(
          `Players: ${spec.displayName}`,
          playerRows.length >= expected &&
            verified === playerRows.length &&
            withBalance === playerRows.length,
          `${playerRows.length}/${expected} spillere, ${verified} VERIFIED, ${withBalance} med ≥${PLAYER_DEPOSIT_MAJOR} NOK`,
        ),
      );

      // Hall-registreringer aktive — bruk resolved id.
      const { rows: regRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM app_hall_registrations r
          WHERE r.hall_id = $1
            AND r.status = 'ACTIVE'
            AND r.user_id IN (
              SELECT id FROM app_users WHERE email LIKE $2
            )`,
        [resolvedHallId, `${emailPrefix}%@spillorama.no`],
      );
      const regCount = Number(regRows[0]?.count ?? "0");
      results.push(
        check(
          `Hall-reg: ${spec.displayName}`,
          regCount >= expected,
          `${regCount}/${expected} ACTIVE-registreringer`,
        ),
      );
    }

    // ── 5. Bingoverter (1 per hall) ─────────────────────────────────────────
    for (const spec of PILOT_HALL_SPECS) {
      const resolvedHallId = resolvedHallIdBySpec.get(spec.slug);
      if (!resolvedHallId) continue;

      const agentEmail = `${PILOT_AGENT_EMAIL_PREFIX}${spec.slug}@spillorama.no`;
      const { rows: agentRows } = await client.query<{
        id: string;
        role: string;
        hall_id: string | null;
      }>(
        `SELECT id, role, hall_id FROM app_users WHERE email = $1 AND role = 'AGENT'`,
        [agentEmail],
      );
      const agent = agentRows[0];
      if (!agent) {
        results.push(
          check(
            `Agent: ${spec.displayName}`,
            false,
            `${agentEmail} ikke funnet`,
          ),
        );
        continue;
      }

      // Verify primary hall-binding via app_agent_halls (hvis tabellen finnes).
      const { rows: bindRows } = await client.query<{
        hall_id: string;
        is_primary: boolean;
      }>(
        `SELECT hall_id, is_primary
           FROM app_agent_halls
          WHERE user_id = $1 AND hall_id = $2`,
        [agent.id, resolvedHallId],
      );
      const binding = bindRows[0];
      const ok =
        binding !== undefined &&
        binding.is_primary === true &&
        agent.hall_id === resolvedHallId;
      results.push(
        check(
          `Agent: ${spec.displayName}`,
          ok,
          `${agentEmail} agent.hall_id=${agent.hall_id} primary-binding=${binding?.is_primary ?? "MISSING"}`,
        ),
      );
    }

    // ── 6. Game-catalog dekning ─────────────────────────────────────────────
    const requiredSlugs = Array.from(new Set(PILOT_PLAN_ITEM_SLUGS));
    const { rows: catRows } = await client.query<{ slug: string }>(
      `SELECT slug FROM app_game_catalog
        WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
      [requiredSlugs],
    );
    const catSlugs = new Set(catRows.map((r) => r.slug));
    const missingCatalog = requiredSlugs.filter((s) => !catSlugs.has(s));
    results.push(
      check(
        `Game-catalog`,
        missingCatalog.length === 0,
        `${catSlugs.size}/${requiredSlugs.length} slugs aktive${missingCatalog.length ? ` — mangler: ${missingCatalog.join(", ")}` : ""}`,
      ),
    );
  } finally {
    await client.end();
  }

  // ── Output ──────────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  PILOT Q3 2026 — VERIFIKASJONS-RAPPORT");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("");
  for (const r of results) {
    const mark = r.ok ? "[OK]" : "[FEIL]";
    console.log(`  ${mark.padEnd(7)} ${r.name.padEnd(35)} ${r.details}`);
  }
  console.log("");

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("  ✅ READY FOR PILOT");
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(0);
  } else {
    console.log("══════════════════════════════════════════════════════════════");
    console.log(`  ❌ ${failed.length} mangler funnet`);
    console.log("══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("Fix:");
    console.log("  1. Sjekk feilmeldinger over.");
    console.log("  2. Re-kjør seed-scriptet:");
    console.log("       npx tsx scripts/seed-pilot-prod-q3-2026.mts");
    console.log("  3. Re-kjør verifikasjon for å bekrefte fix.");
    process.exit(1);
  }
}

const invokedDirectly =
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[verify-pilot-prod-q3] feilet:", error);
    process.exit(2);
  });
}
