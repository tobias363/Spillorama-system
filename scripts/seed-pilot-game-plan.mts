#!/usr/bin/env npx tsx
/**
 * Pilot-test rigging: seed test-GameManagement-rader for pilot-test av Spill 1.
 *
 * Oppretter 3 spill-varianter (morgen / lunsj / kveld) som pilot-hallene kan
 * starte via admin-konsollen. Hver rad får en realistisk `config_json` som
 * beskriver premier, ticket-farger og pattern-fase-oppsett — nok til at
 * variant-binder i runtime (roomState.bindVariantConfigForRoom) kan plukke
 * opp og bruke konfigurasjonen.
 *
 * Gjenbruker GameManagementService (apps/backend/src/admin/GameManagementService.ts)
 * for all skriving, med repeatToken som idempotency-nøkkel slik at scriptet
 * kan kjøres flere ganger uten duplisering.
 *
 * Forutsetninger:
 *   - seed-pilot-halls.mts er kjørt først (pilot-hallene må eksistere).
 *   - APP_PG_CONNECTION_STRING peker på samme DB som backend.
 *
 * Usage:
 *   APP_PG_CONNECTION_STRING=postgres://... npx tsx scripts/seed-pilot-game-plan.mts
 *
 *   # Dry-run:
 *   PILOT_DRY_RUN=1 APP_PG_CONNECTION_STRING=... npx tsx scripts/seed-pilot-game-plan.mts
 *
 * Env-variabler: se seed-pilot-halls.mts (samme sett).
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../apps/backend/.env") });

import { GameManagementService } from "../apps/backend/src/admin/GameManagementService.js";
import type {
  CreateGameManagementInput,
  GameManagement,
} from "../apps/backend/src/admin/GameManagementService.js";

/**
 * GameType-slug for Spill 1 (Norsk 75-ball databingo). Brukes som
 * `game_type_id` i app_game_management — service aksepterer enten UUID eller
 * stabil slug. Vi bruker slug-formen `game_1` som legacy + test-konvensjonen
 * (se apps/backend/src/game/DrawBagStrategy.ts og adminSubGames.test.ts).
 */
const GAME1_TYPE_SLUG = "game_1";

/** Standard fase-oppsett for Spill 1: 5 faser, økende kompleksitet. */
interface PhaseConfig {
  phaseId: string;
  name: string;
  /** Premie i hele kroner. */
  prize: number;
}

const DEFAULT_PHASES: readonly PhaseConfig[] = [
  { phaseId: "phase1", name: "1 Rad eller 1 Kolonne", prize: 100 },
  { phaseId: "phase2", name: "2 Kolonner", prize: 200 },
  { phaseId: "phase3", name: "3 Kolonner", prize: 200 },
  { phaseId: "phase4", name: "4 Kolonner", prize: 200 },
  { phaseId: "fullHouse", name: "Fullt Hus", prize: 1000 },
] as const;

/** Per-farge premier for lunsj-varianten (Elvis-bonger + farge-premier). */
interface ColorPrize {
  color: string;
  displayName: string;
  prize: number;
}

const LUNCH_COLOR_PRIZES: readonly ColorPrize[] = [
  { color: "white", displayName: "Hvit", prize: 500 },
  { color: "yellow", displayName: "Gul", prize: 500 },
  { color: "purple", displayName: "Lilla", prize: 500 },
  { color: "red", displayName: "Rød", prize: 1000 },
] as const;

/** Per-farge jackpot for kveld-varianten. */
const EVENING_JACKPOT_COLORS: readonly ColorPrize[] = [
  { color: "white", displayName: "Hvit jackpot", prize: 2500 },
  { color: "yellow", displayName: "Gul jackpot", prize: 5000 },
  { color: "purple", displayName: "Lilla jackpot", prize: 10000 },
] as const;

/** Dato-helpere: bygger ISO-tidspunkt for i dag kl HH:MM i lokal tid. */
function todayAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Slutt-tidspunkt: samme dag kl 23:59 — gir nok headroom for ad-hoc testing. */
function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

interface PilotGameSeed {
  /** Kort stabil nøkkel — brukes som repeatToken for idempotency. */
  key: string;
  input: Omit<CreateGameManagementInput, "createdBy" | "repeatToken">;
}

function buildGameSeeds(): PilotGameSeed[] {
  return [
    {
      key: "pilot-morgen-bingo-v1",
      input: {
        gameTypeId: GAME1_TYPE_SLUG,
        name: "Pilot Morgen-bingo",
        ticketType: "Large",
        ticketPrice: 10,
        startDate: todayAt(9, 0),
        endDate: endOfToday(),
        status: "active",
        config: {
          pilotTag: "pilot-morgen",
          description:
            "Standard 5-fase Spill 1 — 4 pilot-haller i samme link. Faste premier.",
          phases: DEFAULT_PHASES,
          hallGroupName: "Pilot-Link (Telemark)",
          ticketColors: ["white", "yellow", "purple"],
          elvisBonus: false,
          perColorPrize: false,
          jackpot: null,
        },
      },
    },
    {
      key: "pilot-lunsj-bingo-v1",
      input: {
        gameTypeId: GAME1_TYPE_SLUG,
        name: "Pilot Lunsj-bingo (Elvis)",
        ticketType: "Large",
        ticketPrice: 15,
        startDate: todayAt(12, 0),
        endDate: endOfToday(),
        status: "active",
        config: {
          pilotTag: "pilot-lunsj",
          description:
            "Lunsj-variant med Elvis-bonger + per-farge-premier. Testcase for bonusbong-integrasjon.",
          phases: DEFAULT_PHASES,
          hallGroupName: "Pilot-Link (Telemark)",
          ticketColors: ["white", "yellow", "purple", "red"],
          elvisBonus: true,
          perColorPrize: true,
          colorPrizes: LUNCH_COLOR_PRIZES,
          jackpot: null,
        },
      },
    },
    {
      key: "pilot-kveld-bingo-v1",
      input: {
        gameTypeId: GAME1_TYPE_SLUG,
        name: "Pilot Kveld-bingo (Jackpot)",
        ticketType: "Large",
        ticketPrice: 20,
        startDate: todayAt(18, 0),
        endDate: endOfToday(),
        status: "active",
        config: {
          pilotTag: "pilot-kveld",
          description:
            "Kveld-variant med per-farge-jackpot (hvit/gul/lilla). Testcase for variant-binder jackpot-mapping.",
          phases: DEFAULT_PHASES,
          hallGroupName: "Pilot-Link (Telemark)",
          ticketColors: ["white", "yellow", "purple"],
          elvisBonus: false,
          perColorPrize: false,
          jackpot: {
            type: "per-color",
            colors: EVENING_JACKPOT_COLORS,
          },
        },
      },
    },
  ];
}

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
      "[pilot-seed-game-plan] APP_PG_CONNECTION_STRING mangler."
    );
    process.exit(1);
  }
  return connectionString;
}

async function upsertGameManagement(
  service: GameManagementService,
  seed: PilotGameSeed,
  ctx: SeedContext
): Promise<GameManagement | null> {
  if (ctx.dryRun) {
    console.log(
      `  [dry-run] ville upserte GameManagement "${seed.input.name}" (key=${seed.key})`
    );
    return null;
  }
  // Idempotency: finn eksisterende rad via repeatToken i config_json.
  const existing = await service.list({ limit: 500, includeDeleted: false });
  const match = existing.find(
    (row) =>
      typeof row.config?.repeatToken === "string" &&
      row.config.repeatToken === seed.key
  );
  if (match) {
    const updated = await service.update(match.id, {
      name: seed.input.name,
      ticketType: seed.input.ticketType ?? null,
      ticketPrice: seed.input.ticketPrice ?? 0,
      startDate: seed.input.startDate,
      endDate: seed.input.endDate ?? null,
      status: seed.input.status ?? "active",
      config: { ...(seed.input.config ?? {}), repeatToken: seed.key },
    });
    console.log(
      `  = oppdaterte ${updated.name} (id=${updated.id}, status=${updated.status})`
    );
    return updated;
  }
  const created = await service.create({
    ...seed.input,
    createdBy: ctx.createdBy,
    // Embed repeatToken inn i config_json så videre kjøringer finner raden.
    // Bruk `repeatedFromId` peker mot egen id ville vært selvreferanse som vi
    // unngår — vi matcher på config.repeatToken direkte i list-sjekken over.
    config: { ...(seed.input.config ?? {}), repeatToken: seed.key },
  });
  console.log(
    `  + opprettet ${created.name} (id=${created.id}, status=${created.status})`
  );
  return created;
}

async function main(): Promise<void> {
  const ctx = readContext();
  const connectionString = requireConnectionString();
  const schema = process.env.APP_PG_SCHEMA ?? "public";

  console.log("[pilot-seed-game-plan] start");
  console.log(`  target: ${ctx.target}`);
  console.log(`  schema: ${schema}`);
  console.log(`  dry-run: ${ctx.dryRun}`);
  console.log("");

  const service = new GameManagementService({ connectionString, schema });
  const seeds = buildGameSeeds();

  console.log(
    `[pilot-seed-game-plan] upsert ${seeds.length} GameManagement-rader`
  );
  for (const seed of seeds) {
    await upsertGameManagement(service, seed, ctx);
  }

  console.log("");
  console.log("[pilot-seed-game-plan] ferdig");
  process.exit(0);
}

const invokedDirectly =
  import.meta.url ===
  `file://${path.resolve(process.argv[1] ?? "")}`;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[pilot-seed-game-plan] feilet:", error);
    process.exit(1);
  });
}
