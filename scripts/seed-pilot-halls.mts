#!/usr/bin/env npx tsx
/**
 * Pilot-test rigging: seed 4 pilot-haller + 1 hall-gruppe ("Pilot-Link Telemark").
 *
 * Målet er å sette opp en enkel pilot-konfigurasjon for Spill 1 live-test med
 * 4 haller i én hall-gruppe, slik at Tobias kan teste cross-hall-synk uten å
 * rote med produksjonsdata.
 *
 * Gjenbruker eksisterende service-APIer:
 *   - PlatformService.createHall — oppretter hver pilot-hall
 *   - PlatformService.updateHall — setter active-state hvis hallen finnes fra før
 *   - HallGroupService.create / update — oppretter eller oppdaterer gruppen
 *
 * Idempotent: hvis en hall eller gruppe allerede finnes (matchet på slug/name),
 * oppdateres den i stedet for å duplisere.
 *
 * Usage:
 *   # Fra repo-rot (målet er lokal utviklings-DB):
 *   APP_PG_CONNECTION_STRING=postgres://... npx tsx scripts/seed-pilot-halls.mts
 *
 *   # Dry-run (logger kun hva som ville skje — ingen DB-skriving):
 *   PILOT_DRY_RUN=1 APP_PG_CONNECTION_STRING=... npx tsx scripts/seed-pilot-halls.mts
 *
 *   # Mot live-DB (forsikring: må sette eksplisitt):
 *   PILOT_TARGET=live APP_PG_CONNECTION_STRING=... npx tsx scripts/seed-pilot-halls.mts
 *
 * Env-variabler:
 *   APP_PG_CONNECTION_STRING   — påkrevd, DB-URL
 *   APP_PG_SCHEMA              — valgfritt, default "public"
 *   PILOT_DRY_RUN              — "1"/"true" → logg kun, ingen skriving
 *   PILOT_TARGET               — "local"|"live", default "local". Live krever
 *                                eksplisitt "live" for å unngå ulykker.
 *   PILOT_CREATED_BY           — userId som registreres som createdBy på
 *                                hall-gruppen. Default "pilot-seed-script".
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Last .env fra apps/backend slik at standardvariabler blir tilgjengelige også
// når scriptet kjøres fra repo-rot.
dotenv.config({ path: path.resolve(__dirname, "../apps/backend/.env") });

import { PlatformService } from "../apps/backend/src/platform/PlatformService.js";
import { HallGroupService } from "../apps/backend/src/admin/HallGroupService.js";
import { InMemoryWalletAdapter } from "../apps/backend/src/adapters/InMemoryWalletAdapter.js";

/** Canonical pilot-hall-definisjoner. Brukes også av teardown-script og QA-guide. */
export const PILOT_HALLS = [
  {
    slug: "pilot-notodden",
    name: "Notodden Pilot",
    region: "NO",
    address: "Storgata 1, 3674 Notodden",
    organizationNumber: "000000001",
    settlementAccount: "0000.00.00001",
    invoiceMethod: "EHF",
  },
  {
    slug: "pilot-skien",
    name: "Skien Pilot",
    region: "NO",
    address: "Henrik Ibsens gate 1, 3724 Skien",
    organizationNumber: "000000002",
    settlementAccount: "0000.00.00002",
    invoiceMethod: "EHF",
  },
  {
    slug: "pilot-porsgrunn",
    name: "Porsgrunn Pilot",
    region: "NO",
    address: "Storgata 1, 3916 Porsgrunn",
    organizationNumber: "000000003",
    settlementAccount: "0000.00.00003",
    invoiceMethod: "EHF",
  },
  {
    slug: "pilot-kragero",
    name: "Kragerø Pilot",
    region: "NO",
    address: "P.A. Heuchs gate 1, 3770 Kragerø",
    organizationNumber: "000000004",
    settlementAccount: "0000.00.00004",
    invoiceMethod: "EHF",
  },
] as const;

/** Navn på hall-gruppen som binder pilot-hallene sammen. */
export const PILOT_GROUP_NAME = "Pilot-Link (Telemark)";

type HallSeed = (typeof PILOT_HALLS)[number];

interface SeedContext {
  dryRun: boolean;
  target: "local" | "live";
  createdBy: string;
}

function readContext(): SeedContext {
  const dryRun = ["1", "true", "yes"].includes(
    String(process.env.PILOT_DRY_RUN ?? "").toLowerCase()
  );
  const targetRaw = (process.env.PILOT_TARGET ?? "local").toLowerCase();
  const target = targetRaw === "live" ? "live" : "local";
  const createdBy =
    process.env.PILOT_CREATED_BY?.trim() || "pilot-seed-script";
  return { dryRun, target, createdBy };
}

function requireConnectionString(): string {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    "";
  if (!connectionString.trim()) {
    console.error(
      "[pilot-seed-halls] APP_PG_CONNECTION_STRING mangler. Sett denne i .env eller som miljøvariabel."
    );
    process.exit(1);
  }
  return connectionString;
}

async function upsertPilotHall(
  platform: PlatformService,
  hall: HallSeed,
  ctx: SeedContext
): Promise<{ id: string; slug: string; created: boolean }> {
  if (ctx.dryRun) {
    console.log(`  [dry-run] ville upserte hall ${hall.slug} (${hall.name})`);
    return { id: `dry-run-${hall.slug}`, slug: hall.slug, created: true };
  }
  try {
    const created = await platform.createHall({ ...hall, isActive: true });
    console.log(`  + opprettet ${created.name} (${created.slug})`);
    return { id: created.id, slug: created.slug, created: true };
  } catch (error: unknown) {
    // DomainError bruker `code`-feltet for diskriminering; message er Norsk
    // user-facing tekst. Matcher på code for robust identifisering.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code !== "HALL_SLUG_EXISTS") {
      throw error;
    }
    // Finn eksisterende og forsikre at den er aktiv + riktig shape.
    const existing = await platform.getHall(hall.slug);
    const updated = await platform.updateHall(existing.slug, {
      name: hall.name,
      region: hall.region,
      address: hall.address,
      organizationNumber: hall.organizationNumber,
      settlementAccount: hall.settlementAccount,
      invoiceMethod: hall.invoiceMethod,
      isActive: true,
    });
    console.log(`  = oppdaterte eksisterende ${updated.name} (${updated.slug})`);
    return { id: updated.id, slug: updated.slug, created: false };
  }
}

async function upsertPilotGroup(
  hallGroupService: HallGroupService,
  hallIds: string[],
  ctx: SeedContext
): Promise<void> {
  if (ctx.dryRun) {
    console.log(
      `  [dry-run] ville upserte hall-gruppe "${PILOT_GROUP_NAME}" med ${hallIds.length} haller`
    );
    return;
  }
  const existing = await hallGroupService.list({
    includeDeleted: false,
    limit: 500,
  });
  const found = existing.find((g) => g.name === PILOT_GROUP_NAME);
  if (!found) {
    const group = await hallGroupService.create({
      name: PILOT_GROUP_NAME,
      hallIds,
      status: "active",
      createdBy: ctx.createdBy,
    });
    console.log(
      `  + opprettet hall-gruppe "${group.name}" (id=${group.id}) med ${group.members.length} haller`
    );
    return;
  }
  const updated = await hallGroupService.update(found.id, {
    hallIds,
    status: "active",
  });
  console.log(
    `  = oppdaterte hall-gruppe "${updated.name}" (id=${updated.id}) til ${updated.members.length} haller`
  );
}

async function main(): Promise<void> {
  const ctx = readContext();
  const connectionString = requireConnectionString();
  const schema = process.env.APP_PG_SCHEMA ?? "public";

  console.log("[pilot-seed-halls] start");
  console.log(`  target: ${ctx.target}`);
  console.log(`  schema: ${schema}`);
  console.log(`  dry-run: ${ctx.dryRun}`);
  console.log("");

  if (ctx.target === "live") {
    console.log(
      "[pilot-seed-halls] NB! Kjører mot LIVE-DB. Bruker pilot-* slugs så produksjonsdata er urørt."
    );
  }

  const wallet = new InMemoryWalletAdapter();
  const platform = new PlatformService(wallet, {
    connectionString,
    schema,
  });
  const hallGroupService = new HallGroupService({
    connectionString,
    schema,
  });

  console.log(`[pilot-seed-halls] upsert ${PILOT_HALLS.length} pilot-haller`);
  const hallIds: string[] = [];
  for (const hall of PILOT_HALLS) {
    const res = await upsertPilotHall(platform, hall, ctx);
    hallIds.push(res.id);
  }

  console.log("");
  console.log(`[pilot-seed-halls] upsert hall-gruppe "${PILOT_GROUP_NAME}"`);
  await upsertPilotGroup(hallGroupService, hallIds, ctx);

  console.log("");
  console.log("[pilot-seed-halls] ferdig");
  process.exit(0);
}

// Kjør main() kun når scriptet er invoked direkte (ikke ved re-export for
// konstanter). Dette hindrer at teardown-scriptet — som importerer PILOT_HALLS
// og PILOT_GROUP_NAME herfra — ikke får seed-main() til å kjøre automatisk.
const invokedDirectly =
  import.meta.url ===
  `file://${path.resolve(process.argv[1] ?? "")}`;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[pilot-seed-halls] feilet:", error);
    process.exit(1);
  });
}
