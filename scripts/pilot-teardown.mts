#!/usr/bin/env npx tsx
/**
 * Pilot-test rigging: rollback-script som soft-sletter pilot-test-data.
 *
 * Fjerner kun rader opprettet av seed-pilot-halls.mts og seed-pilot-game-plan.mts:
 *   - GameManagement-rader der config_json.repeatToken starter med "pilot-"
 *     eller config_json.pilotTag er satt
 *   - Hall-gruppen "Pilot-Link (Telemark)"
 *   - Pilot-haller (slug-prefix "pilot-") — deaktiveres, ikke hard-slettes
 *
 * Alt gjøres som soft-delete / inactive så historikk bevares. Hard-delete er
 * ikke støttet — kjør manuell SQL hvis du absolutt må purge.
 *
 * Idempotent: kjør på nytt → ingen feil hvis data allerede er fjernet.
 *
 * Rører IKKE produksjonsdata (alle matchere bruker "pilot-" prefix eller
 * PILOT_GROUP_NAME konstant).
 *
 * Usage:
 *   APP_PG_CONNECTION_STRING=postgres://... npx tsx scripts/pilot-teardown.mts
 *
 *   # Dry-run:
 *   PILOT_DRY_RUN=1 APP_PG_CONNECTION_STRING=... npx tsx scripts/pilot-teardown.mts
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../apps/backend/.env") });

import { PlatformService } from "../apps/backend/src/platform/PlatformService.js";
import { HallGroupService } from "../apps/backend/src/admin/HallGroupService.js";
import { GameManagementService } from "../apps/backend/src/admin/GameManagementService.js";
import { InMemoryWalletAdapter } from "../apps/backend/src/adapters/InMemoryWalletAdapter.js";
import { PILOT_HALLS, PILOT_GROUP_NAME } from "./seed-pilot-halls.mjs";

interface TeardownContext {
  dryRun: boolean;
}

function readContext(): TeardownContext {
  const dryRun = ["1", "true", "yes"].includes(
    String(process.env.PILOT_DRY_RUN ?? "").toLowerCase()
  );
  return { dryRun };
}

function requireConnectionString(): string {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    "";
  if (!connectionString.trim()) {
    console.error(
      "[pilot-teardown] APP_PG_CONNECTION_STRING mangler."
    );
    process.exit(1);
  }
  return connectionString;
}

async function removePilotGameManagement(
  service: GameManagementService,
  ctx: TeardownContext
): Promise<void> {
  const all = await service.list({ limit: 500, includeDeleted: false });
  const pilotRows = all.filter((row) => {
    const token = row.config?.repeatToken;
    const tag = row.config?.pilotTag;
    return (
      (typeof token === "string" && token.startsWith("pilot-")) ||
      (typeof tag === "string" && tag.startsWith("pilot-"))
    );
  });
  console.log(
    `[pilot-teardown] ${pilotRows.length} GameManagement-rader matcher pilot-tag`
  );
  for (const row of pilotRows) {
    if (ctx.dryRun) {
      console.log(`  [dry-run] ville soft-slette ${row.name} (id=${row.id})`);
      continue;
    }
    await service.remove(row.id);
    console.log(`  x soft-slettet ${row.name} (id=${row.id})`);
  }
}

async function removePilotGroup(
  service: HallGroupService,
  ctx: TeardownContext
): Promise<void> {
  const all = await service.list({ limit: 500, includeDeleted: false });
  const found = all.find((g) => g.name === PILOT_GROUP_NAME);
  if (!found) {
    console.log(
      `[pilot-teardown] hall-gruppe "${PILOT_GROUP_NAME}" finnes ikke — hopper over`
    );
    return;
  }
  if (ctx.dryRun) {
    console.log(
      `  [dry-run] ville soft-slette hall-gruppe "${found.name}" (id=${found.id})`
    );
    return;
  }
  await service.remove(found.id);
  console.log(`  x soft-slettet hall-gruppe "${found.name}" (id=${found.id})`);
}

async function deactivatePilotHalls(
  platform: PlatformService,
  ctx: TeardownContext
): Promise<void> {
  for (const hall of PILOT_HALLS) {
    try {
      const existing = await platform.getHall(hall.slug);
      if (!existing.isActive) {
        console.log(
          `  = ${existing.name} (${existing.slug}) allerede inaktiv — hopper over`
        );
        continue;
      }
      if (ctx.dryRun) {
        console.log(
          `  [dry-run] ville deaktivere ${existing.name} (${existing.slug})`
        );
        continue;
      }
      await platform.updateHall(existing.slug, { isActive: false });
      console.log(`  x deaktiverte ${existing.name} (${existing.slug})`);
    } catch (error: unknown) {
      // Match på DomainError.code (stabil) i stedet for Norsk message-tekst.
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "HALL_NOT_FOUND") {
        console.log(`  · ${hall.slug} finnes ikke — hopper over`);
        continue;
      }
      throw error;
    }
  }
}

async function main(): Promise<void> {
  const ctx = readContext();
  const connectionString = requireConnectionString();
  const schema = process.env.APP_PG_SCHEMA ?? "public";

  console.log("[pilot-teardown] start");
  console.log(`  schema: ${schema}`);
  console.log(`  dry-run: ${ctx.dryRun}`);
  console.log("");

  const wallet = new InMemoryWalletAdapter();
  const platform = new PlatformService(wallet, { connectionString, schema });
  const hallGroupService = new HallGroupService({ connectionString, schema });
  const gameManagementService = new GameManagementService({
    connectionString,
    schema,
  });

  // Rekkefølge: GameManagement → HallGroup → Hall, slik at ingen
  // fremmednøkkel-referanser peker til en slettet hall før gruppen er fjernet.
  console.log("[pilot-teardown] fjerner pilot-GameManagement-rader");
  await removePilotGameManagement(gameManagementService, ctx);

  console.log("");
  console.log("[pilot-teardown] fjerner pilot-hall-gruppe");
  await removePilotGroup(hallGroupService, ctx);

  console.log("");
  console.log("[pilot-teardown] deaktiverer pilot-haller");
  await deactivatePilotHalls(platform, ctx);

  console.log("");
  console.log("[pilot-teardown] ferdig");
  process.exit(0);
}

const invokedDirectly =
  import.meta.url ===
  `file://${path.resolve(process.argv[1] ?? "")}`;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[pilot-teardown] feilet:", error);
    process.exit(1);
  });
}
