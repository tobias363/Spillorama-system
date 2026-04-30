/**
 * Seed legacy admin-panel-snapshots → ny backend (foundational migration).
 *
 * Hentet fra: `https://spillorama.aistechnolabs.info` admin-panel
 * (legacy MongoDB-stack). Ekstraksjon-katalog: `docs/legacy-snapshots/2026-04-30/`.
 *
 * Forskjellig fra `legacySubGameImporter.ts`:
 *   - `legacySubGameImporter.ts` aksepterer en *normalisert* JSON-payload
 *     (fra MongoDB-eksport eller manuell forbearbeiding).
 *   - Denne modulen leser de *rå* admin-panel-snapshotene i deres faktiske
 *     shape og bygger den normaliserte payloaden + tilstander for
 *     schedules/daily-schedules som ikke håndteres av runImport().
 *
 * Tabeller som berøres:
 *   - app_game_types        (5 legacy spilltyper, minus deprecated Game 4)
 *   - app_sub_games         (én rad per unik sub-game-mal-navn)
 *   - app_patterns          (Rad 1-4 + Fullt Hus + Mystery + Oddsen + Jackpot)
 *   - app_schedules         (én rad per schedule-snapshot)
 *   - app_daily_schedules   (én rad per DSN-mapping i game-management)
 *
 * Idempotent: alle skriv er UPSERT på naturlig nøkkel:
 *   - GameType:      type_slug
 *   - SubGame:       sub_game_number   (utledet fra type_slug + name)
 *   - Pattern:       (game_type_id, pattern_number)
 *   - Schedule:      schedule_number   (utledet fra schedule.name)
 *   - DailySchedule: id                (preserveres fra legacy schedule_object_id
 *                                       så subsequent re-runs treffer samme rad)
 *
 * Hopp over:
 *   - Turbomania / Game 4 / themebingo (DEPRECATED BIN-496)
 *   - Lynbingo daglige tidsplaner (tom i legacy)
 *
 * Validering:
 *   - Legacy ticket-farge-strenger valideres mot `TICKET_COLORS` fra
 *     shared-types. En ukjent farge → throw så scriptet ikke skriver
 *     halvferdig data.
 *
 * Bruk:
 *   - CLI-wrapper: `apps/backend/scripts/seed-legacy-game-config.ts`
 *   - Direkte: `runSeed(client, { snapshotDir, dryRun, schema, createdBy })`
 */

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Client, PoolClient } from "pg";
import { z } from "zod";

import {
  TICKET_COLORS,
  type TicketColor,
} from "@spillorama/shared-types";

import {
  runImport,
  type ImportLogger,
  type ImportReport,
  type ImportRecordResult,
  type LegacyGameType,
  type LegacySubGame,
  type LegacyPattern,
} from "./legacySubGameImporter.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface QueryClient {
  query: Client["query"] | PoolClient["query"];
}

export interface SeedOptions {
  /** Directory containing the JSON snapshots (default: docs/legacy-snapshots/2026-04-30). */
  snapshotDir: string;
  /** If true: validate + report uten DB-writes. */
  dryRun?: boolean;
  /** Postgres schema (default: 'public'). */
  schema?: string;
  /** created_by for nye rader. */
  createdBy?: string;
  /** Logger; default console. */
  logger?: ImportLogger;
}

export interface SeedReport {
  /** Total rader behandlet på tvers av alle 5 tabeller. */
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Per-tabell-aggregat. */
  perResource: {
    gameType: { total: number; created: number; updated: number; failed: number };
    subGame: { total: number; created: number; updated: number; failed: number };
    pattern: { total: number; created: number; updated: number; failed: number };
    schedule: { total: number; created: number; updated: number; failed: number };
    dailySchedule: {
      total: number;
      created: number;
      updated: number;
      skipped: number;
      failed: number;
    };
  };
  /** Detaljerte poster (samme shape som runImport sin records). */
  records: ImportRecordResult[];
  /** Mapping-rapport. */
  mapping: MappingReport;
}

/**
 * Mapping-rapport: hvilke felter som ble droppet fordi ny schema mangler
 * support, samt hvilke legacy-typer som ble hoppet over.
 */
export interface MappingReport {
  droppedLegacyFields: string[];
  skippedLegacyTypes: string[];
  unknownTicketColors: string[];
  notes: string[];
}

// ── Constants — slug + ticket-color mapping ─────────────────────────────────

/**
 * Legacy spilltype → ny stack slug + label.
 *
 * Per `docs/architecture/SPILLKATALOG.md`. Game 4 er deprecated (BIN-496) og
 * skal IKKE migreres.
 */
const LEGACY_TO_NEW_GAME_TYPE = {
  "Papir bingo": {
    typeSlug: "bingo",
    name: "Spill 1",
    legacyId: "5f807893e86e8b18e65ed6f7",
    pattern: true,
    gridRows: 5,
    gridColumns: 5,
    rangeMin: 1,
    rangeMax: 75,
  },
  Lynbingo: {
    typeSlug: "rocket",
    name: "Spill 2",
    legacyId: "5f8078b3e86e8b18e65ed6f8",
    pattern: false,
    gridRows: 3,
    gridColumns: 5,
    rangeMin: 1,
    rangeMax: 60,
  },
  BingoBonanza: {
    typeSlug: "monsterbingo",
    name: "Spill 3",
    legacyId: "5f8078cbe86e8b18e65ed6f9",
    pattern: true,
    gridRows: 5,
    gridColumns: 5,
    rangeMin: 1,
    rangeMax: 60,
  },
  // INTENTIONALLY OMITTED: Turbomania / Game 4 / themebingo (DEPRECATED BIN-496)
  SpinnGo: {
    typeSlug: "spillorama",
    name: "SpinnGo",
    legacyId: "659bccf3bc629b04503c58ed",
    pattern: false,
    gridRows: 3,
    gridColumns: 5,
    rangeMin: 1,
    rangeMax: 60,
  },
} as const;

type LegacyGameTypeName = keyof typeof LEGACY_TO_NEW_GAME_TYPE;

/**
 * Legacy ticket-color string → kanonisk TICKET_COLORS slug.
 *
 * Legacy bruker case-sensitive strings som "Small Yellow" / "Large White".
 * Kanonisk er enum string ("SMALL_YELLOW"). Mapping er stable og dekker alle
 * 11 + 5 Elvis-varianter. Ukjente strenger → null + rapporteres som feil.
 */
const LEGACY_COLOR_TO_CANONICAL: Record<string, TicketColor> = {
  "Small Yellow": "SMALL_YELLOW",
  "Large Yellow": "LARGE_YELLOW",
  "Small White": "SMALL_WHITE",
  "Large White": "LARGE_WHITE",
  "Small Purple": "SMALL_PURPLE",
  "Large Purple": "LARGE_PURPLE",
  "Small Red": "RED",
  "Small Green": "GREEN",
  "Small Blue": "BLUE",
  "Small Elvis1": "ELVIS1",
  "Small Elvis2": "ELVIS2",
  "Small Elvis3": "ELVIS3",
  "Small Elvis4": "ELVIS4",
  "Small Elvis5": "ELVIS5",
};

/** Sub-game-typer hvor seedet skal sette is_jackpot=true. */
const JACKPOT_SUB_GAME_NAMES = new Set([
  "Jackpot",
  "Innsatsen",
]);
/** Mystery-sub-game (sett is_mys=true). */
const MYSTERY_SUB_GAME_NAMES = new Set(["Mystery"]);
/** Wheel of Fortune sub-game (sett is_wof=true). */
const WOF_SUB_GAME_NAMES = new Set(["Wheel of Fortune"]);
/** Treasure Chest sub-game (sett is_tchest=true). */
const TCHEST_SUB_GAME_NAMES = new Set(["Treasure Chest"]);

// ── Snapshot-Zod-validators ─────────────────────────────────────────────────

const GameMappingSchema = z
  .object({
    spillTypes: z
      .record(
        z.string(),
        z
          .object({
            _legacy_id: z.string().optional(),
            _new_slug: z.string().optional(),
            _new_label: z.string().optional(),
            dailySchedules: z
              .array(
                z
                  .object({
                    id_display: z.string().optional(),
                    label: z.string().optional(),
                    date_range: z.string().optional(),
                    time_window: z.string().optional(),
                    group_of_halls: z.string().optional(),
                    master_hall: z.string().optional(),
                    type: z.string().optional(),
                    status: z.string().optional(),
                    // Optional because Turbomania-rader (deprecated Game 4) i
                    // legacy-snapshot mangler schedule_object_id. Disse hoppes
                    // over i seed-loopen uansett, så vi gjør feltet
                    // optional + sjekker manuelt i upsertDailySchedule.
                    schedule_object_id: z.string().optional(),
                    links: z.record(z.string(), z.unknown()).optional(),
                    patterns_text: z.string().optional(),
                    prizes_text_compressed: z.string().optional(),
                    _note: z.string().optional(),
                  })
                  .passthrough()
              )
              .optional(),
            _note: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const ScheduleSubGameFieldsSchema = z
  .object({
    name: z.string(),
    custom_game_name: z.string().optional(),
    notificationStartTime: z.string().optional(),
    minseconds: z.string().optional(),
    maxseconds: z.string().optional(),
    seconds: z.string().optional(),
    "ticketColorType][": z.array(z.string()).optional(),
    jackpotPrizeYellow: z.string().optional(),
    jackpotPrizeWhite: z.string().optional(),
    jackpotDraw: z.string().optional(),
    jackpotInnsatsenDraw: z.string().optional(),
    replace_price: z.string().optional(),
    minimumPrize: z.string().optional(),
  })
  .passthrough();

const ScheduleSubGameSchema = z
  .object({
    fields: ScheduleSubGameFieldsSchema,
    prices: z.record(z.string(), z.string()).optional(),
    prizes: z.record(z.string(), z.unknown()).optional(),
    ticketColors: z.array(z.unknown()).optional(),
  })
  .passthrough();

const ScheduleSnapshotSchema = z
  .object({
    schedule: z.object({
      name: z.string(),
      luckyNumberPrize: z.string().optional(),
      scheduleType: z.enum(["Auto", "Manual"]).default("Manual"),
      manualStartTime: z.string().optional(),
      manualEndTime: z.string().optional(),
    }),
    subGameCount: z.number().int().nonnegative().optional(),
    subGames: z.array(ScheduleSubGameSchema),
  })
  .passthrough();

const BingoBonanzaConfigSchema = z
  .object({
    config: z.object({
      mainGameName: z.string(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      schedule: z.record(z.string(), z.array(z.string())).optional(),
      isBotGame: z.string().optional(),
      groupHalls: z.string().optional(),
      subGames: z.array(z.record(z.string(), z.unknown())),
    }),
  })
  .passthrough();

// ── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Hoved-seed-flyt:
 *   1. Les + valider alle 9 dump-filer fra snapshotDir.
 *   2. Bygg LegacyPayload (gameTypes, subGames, patterns) → kjør runImport.
 *   3. Upsert app_schedules per schedule-fil.
 *   4. Upsert app_daily_schedules per DSN-mapping (lookup mot game_management).
 */
export async function runSeed(
  client: QueryClient,
  options: SeedOptions
): Promise<SeedReport> {
  const schema = assertSchemaName(options.schema ?? "public");
  const dryRun = options.dryRun === true;
  const createdBy = options.createdBy?.trim() || "system-seed-legacy";
  const logger = options.logger ?? defaultLogger();
  const mapping: MappingReport = {
    droppedLegacyFields: [],
    skippedLegacyTypes: [],
    unknownTicketColors: [],
    notes: [],
  };

  // 1) Read snapshots ─────────────────────────────────────────────────────
  logger.info(`[SEED] Leser snapshots fra ${options.snapshotDir}`);
  const snapshots = readSnapshots(options.snapshotDir);
  logger.info(
    `[SEED] Funnet: 1 game-management-mapping, ${snapshots.scheduleSnapshots.length} schedule(s), ${snapshots.bingoBonanzaConfig ? "1 BingoBonanza-config" : "0 BingoBonanza-config"}, ${snapshots.savedGamesList ? "1 saved-games-list" : "0 saved-games-list"}`
  );

  // 2) Build LegacyPayload from all sources + run base import ─────────────
  const payload = buildLegacyPayload(snapshots, mapping, logger);
  const importReport = await runImport(client, payload, {
    dryRun,
    schema,
    createdBy,
    logger,
  });

  // 3) Upsert schedules ───────────────────────────────────────────────────
  const scheduleResults: ImportRecordResult[] = [];
  for (const snapshot of snapshots.scheduleSnapshots) {
    try {
      const result = await upsertSchedule(client, schema, snapshot, {
        dryRun,
        createdBy,
      });
      scheduleResults.push(result);
      if (result.action === "failed") {
        logger.warn(`[SEED] Schedule '${result.key}' feilet: ${result.reason}`);
      } else {
        logger.info(`[SEED] Schedule '${result.key}' → ${result.action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      scheduleResults.push({
        resource: "subGame", // closest match — we re-tag below
        key: snapshot.schedule.name,
        action: "failed",
        reason: msg,
      });
      logger.error(
        `[SEED] Schedule '${snapshot.schedule.name}' feil: ${msg}`
      );
    }
  }

  // 4) Upsert daily schedules ─────────────────────────────────────────────
  const dailyResults: Array<ImportRecordResult & { skipped?: boolean }> = [];
  for (const [legacyTypeName, info] of Object.entries(
    snapshots.gameMapping.spillTypes ?? {}
  )) {
    if (legacyTypeName === "Turbomania") {
      mapping.skippedLegacyTypes.push(
        "Turbomania (Game 4 / themebingo) — DEPRECATED BIN-496"
      );
      logger.info(
        "[SEED] Hopper over Turbomania (Game 4 / themebingo) — DEPRECATED BIN-496"
      );
      continue;
    }
    const ds = (info as { dailySchedules?: unknown[] }).dailySchedules ?? [];
    if (ds.length === 0) {
      if (legacyTypeName === "Lynbingo") {
        mapping.skippedLegacyTypes.push(
          "Lynbingo (rocket) — ingen daily-schedules i legacy (tom)"
        );
      }
      continue;
    }
    for (const raw of ds) {
      try {
        const result = await upsertDailySchedule(
          client,
          schema,
          legacyTypeName as LegacyGameTypeName,
          raw as Record<string, unknown>,
          { dryRun, createdBy }
        );
        dailyResults.push(result);
        if (result.action === "failed") {
          logger.warn(
            `[SEED] DailySchedule '${result.key}' feilet: ${result.reason}`
          );
        } else if (result.action === "skipped") {
          logger.info(
            `[SEED] DailySchedule '${result.key}' hoppet over: ${result.reason}`
          );
        } else {
          logger.info(
            `[SEED] DailySchedule '${result.key}' → ${result.action}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const key =
          (raw as { schedule_object_id?: string }).schedule_object_id ??
          legacyTypeName;
        dailyResults.push({
          resource: "subGame",
          key,
          action: "failed",
          reason: msg,
        });
        logger.error(`[SEED] DailySchedule '${key}' feil: ${msg}`);
      }
    }
  }

  // 5) Aggregate report ───────────────────────────────────────────────────
  const allRecords: ImportRecordResult[] = [
    ...importReport.records,
    ...scheduleResults,
    ...dailyResults.map((r) => ({
      resource: r.resource,
      key: r.key,
      action: r.action,
      reason: r.reason,
      id: r.id,
    })),
  ];

  const report: SeedReport = {
    total: allRecords.length,
    created: allRecords.filter((r) => r.action === "created").length,
    updated: allRecords.filter((r) => r.action === "updated").length,
    skipped: allRecords.filter((r) => r.action === "skipped").length,
    failed: allRecords.filter((r) => r.action === "failed").length,
    perResource: {
      gameType: aggregate(importReport.records, "gameType"),
      subGame: aggregateSubGame(importReport.records),
      pattern: aggregate(importReport.records, "pattern"),
      schedule: aggregateScheduleResults(scheduleResults),
      dailySchedule: aggregateDailyResults(dailyResults),
    },
    records: allRecords,
    mapping,
  };

  logger.info(
    `[SEED] Ferdig. total=${report.total} created=${report.created} updated=${report.updated} skipped=${report.skipped} failed=${report.failed}${dryRun ? " (DRY RUN)" : ""}`
  );

  return report;
}

// ── Snapshot reading + parsing ──────────────────────────────────────────────

interface ParsedSnapshots {
  gameMapping: z.infer<typeof GameMappingSchema>;
  scheduleSnapshots: Array<z.infer<typeof ScheduleSnapshotSchema>>;
  bingoBonanzaConfig: z.infer<typeof BingoBonanzaConfigSchema> | null;
  savedGamesList: { savedGames?: Record<string, unknown[]> } | null;
}

function readSnapshots(dir: string): ParsedSnapshots {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  let gameMapping: z.infer<typeof GameMappingSchema> | null = null;
  let bingoBonanzaConfig: z.infer<typeof BingoBonanzaConfigSchema> | null = null;
  let savedGamesList: { savedGames?: Record<string, unknown[]> } | null = null;
  const scheduleSnapshots: Array<z.infer<typeof ScheduleSnapshotSchema>> = [];

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (file === "legacy-game-management-mapping.json") {
      const parsed = GameMappingSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Invalid game-management-mapping shape: ${parsed.error.message}`
        );
      }
      gameMapping = parsed.data;
    } else if (file === "legacy-bingobonanza-game3-config.json") {
      const parsed = BingoBonanzaConfigSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Invalid bingobonanza-game3-config shape: ${parsed.error.message}`
        );
      }
      bingoBonanzaConfig = parsed.data;
    } else if (file === "legacy-saved-games-list.json") {
      savedGamesList = raw as { savedGames?: Record<string, unknown[]> };
    } else if (file.startsWith("legacy-schedule-")) {
      const parsed = ScheduleSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Invalid schedule snapshot in ${file}: ${parsed.error.message}`
        );
      }
      scheduleSnapshots.push(parsed.data);
    }
  }

  if (!gameMapping) {
    throw new Error(
      `Mangler legacy-game-management-mapping.json i ${dir}`
    );
  }

  return {
    gameMapping,
    scheduleSnapshots,
    bingoBonanzaConfig,
    savedGamesList,
  };
}

// ── Build LegacyPayload from snapshots ──────────────────────────────────────

function buildLegacyPayload(
  snapshots: ParsedSnapshots,
  mapping: MappingReport,
  logger: ImportLogger
): {
  gameTypes: LegacyGameType[];
  subGames: LegacySubGame[];
  patterns: LegacyPattern[];
} {
  const gameTypes: LegacyGameType[] = [];
  const subGames: LegacySubGame[] = [];
  const patterns: LegacyPattern[] = [];

  // GameTypes — hardcoded mapping, idempotent UPSERT på type_slug
  for (const [legacyName, info] of Object.entries(LEGACY_TO_NEW_GAME_TYPE)) {
    const m = info as (typeof LEGACY_TO_NEW_GAME_TYPE)[LegacyGameTypeName];
    gameTypes.push({
      typeSlug: m.typeSlug,
      legacyId: m.legacyId,
      name: m.name,
      pattern: m.pattern,
      gridRows: m.gridRows,
      gridColumns: m.gridColumns,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      status: "active",
      extra: {
        legacyName,
        sourcedFrom: "admin-panel-snapshot 2026-04-30",
      },
    });
  }
  // INTENTIONALLY OMITTED: Turbomania (Game 4 / themebingo) — DEPRECATED BIN-496.
  if (!mapping.skippedLegacyTypes.includes("game-type:Turbomania")) {
    mapping.skippedLegacyTypes.push("game-type:Turbomania (Game 4)");
  }

  // Sub-games + patterns from schedule-snapshots.
  // Strategi: hver unik (gameTypeSlug, sub-game-name) → én SubGame-rad.
  // Hver sub-game som har `prizes`-block → én rad i app_patterns per
  // (color×row) kombinasjon? Det blir for mange. Vi velger enklere:
  // genererer 5 patterns per gametype (Row 1-4 + Full House) pluss spesielle
  // (Mystery, Oddsen 56, Jackpot). Pattern-mask bevares i shared-types
  // PatternCycler — vi bruker enkle masks for nå (kan refines senere).
  const seenSubGames = new Set<string>(); // sub_game_number-set
  const seenPatterns = new Set<string>(); // (gameTypeSlug, pattern_number)

  for (const snapshot of snapshots.scheduleSnapshots) {
    for (const sg of snapshot.subGames) {
      const subName = sg.fields.name;
      // Spillorama-bingo (Game 1 / Spill 1) er hjemmet til alle sub-games
      // i legacy-snapshots — sub-game-katalog er Game 1-spesifikk.
      const gameTypeSlug = "bingo";

      // Validate ticket colors (fail-closed på ukjente).
      const legacyColors = sg.fields["ticketColorType]["] ?? [];
      const canonicalColors: TicketColor[] = [];
      for (const lc of legacyColors) {
        const canonical = LEGACY_COLOR_TO_CANONICAL[lc];
        if (!canonical) {
          mapping.unknownTicketColors.push(`${lc} (sub-game: ${subName})`);
          throw new Error(
            `Ukjent legacy-ticket-color '${lc}' i sub-game '${subName}'. ` +
              `Valid colors: ${TICKET_COLORS.join(", ")}. ` +
              `Verifiser at LEGACY_COLOR_TO_CANONICAL i seedLegacyGameConfig.ts ` +
              `dekker fargen, eller at fargen er korrekt skrevet i snapshot.`
          );
        }
        canonicalColors.push(canonical);
      }

      const subGameNumber = `SG_LEGACY_${gameTypeSlug}_${slugify(subName)}`;
      if (!seenSubGames.has(subGameNumber)) {
        seenSubGames.add(subGameNumber);
        subGames.push({
          gameTypeSlug,
          gameName: "Game1",
          name: subName,
          subGameNumber,
          ticketColors: canonicalColors,
          status: "active",
          // patternRows kobles inn etter at patterns er upsertet — vi gir
          // dem som logiske referanser (sub-game vil peke på pattern_number
          // via name match). Service-laget normaliserer dette i framtidige
          // CRUD-operasjoner.
          patternRows: deriveDefaultPatternRows(subName).map((p) => ({
            patternId: p.patternId,
            name: p.name,
          })),
          extra: {
            sourcedFrom: "admin-panel-schedule-snapshot 2026-04-30",
            customGameName: sg.fields.custom_game_name ?? null,
            notificationStartTime: sg.fields.notificationStartTime ?? null,
            minSeconds: maybeInt(sg.fields.minseconds),
            maxSeconds: maybeInt(sg.fields.maxseconds),
            secondsPerBall: maybeInt(sg.fields.seconds),
            jackpotPrizeYellow: maybeInt(sg.fields.jackpotPrizeYellow),
            jackpotPrizeWhite: maybeInt(sg.fields.jackpotPrizeWhite),
            jackpotDraw: maybeInt(sg.fields.jackpotDraw),
            jackpotInnsatsenDraw: maybeInt(sg.fields.jackpotInnsatsenDraw),
            elvisReplacePrice: maybeInt(sg.fields.replace_price),
            spillernessMinimumPrize: maybeInt(sg.fields.minimumPrize),
            // LEGACY-FIELD `prices`-blokken har én pris per farge —
            // bevares for read-back; ny stack lagrer pris i schedules.
            legacyPricesByColor: extractPricesByColor(sg.prices ?? {}),
            // LEGACY-FIELD `prizes`-blokken har Row1-4/FullHouse per farge.
            legacyPrizesByColor: sg.prizes ?? {},
          },
        });
      }

      // Patterns: 5 standard patterns (Row 1-4 + Full House) per gameType,
      // pluss spesialvarianter for Oddsen/Mystery/Jackpot.
      for (const pat of deriveDefaultPatternRows(subName)) {
        const key = `${gameTypeSlug}::${pat.patternNumber}`;
        if (seenPatterns.has(key)) continue;
        seenPatterns.add(key);
        patterns.push({
          gameTypeSlug,
          patternNumber: pat.patternNumber,
          name: pat.name,
          mask: pat.mask,
          claimType: pat.claimType,
          orderIndex: pat.orderIndex,
          design: pat.design,
          isJackpot: JACKPOT_SUB_GAME_NAMES.has(subName),
          isMys: MYSTERY_SUB_GAME_NAMES.has(subName),
          isWoF: WOF_SUB_GAME_NAMES.has(subName),
          isTchest: TCHEST_SUB_GAME_NAMES.has(subName),
          status: "active",
          extra: {
            sourcedFrom: "admin-panel-schedule-snapshot 2026-04-30",
            associatedSubGame: subName,
          },
        });
      }
    }
  }

  // Patterns from BingoBonanza (Game 3) config-snapshot.
  if (snapshots.bingoBonanzaConfig) {
    const cfg = snapshots.bingoBonanzaConfig.config;
    const gameTypeSlug = "monsterbingo";
    // Sub-games[0] har patterns; sub-games[1] er spillkonfig.
    const sg0 = cfg.subGames?.[0] as
      | { patterns?: Array<{ name: string; prize_tier1?: number; prize_tier2?: number; prize_tier3?: number }> }
      | undefined;
    if (sg0?.patterns) {
      for (let idx = 0; idx < sg0.patterns.length; idx++) {
        const p = sg0.patterns[idx]!;
        const patternNumber = `PT_LEGACY_monsterbingo_${slugify(p.name)}`;
        const key = `${gameTypeSlug}::${patternNumber}`;
        if (seenPatterns.has(key)) continue;
        seenPatterns.add(key);
        const mask = patternNameToMask(p.name);
        patterns.push({
          gameTypeSlug,
          patternNumber,
          name: p.name,
          mask,
          claimType: p.name === "Coverall" ? "BINGO" : "LINE",
          orderIndex: idx,
          design: p.name === "Coverall" ? 2 : 1,
          status: "active",
          extra: {
            sourcedFrom: "admin-panel-bingobonanza-config 2026-04-30",
            prizeTier1: p.prize_tier1 ?? null,
            prizeTier2: p.prize_tier2 ?? null,
            prizeTier3: p.prize_tier3 ?? null,
          },
        });
      }
    }
    // LEGACY-FIELD: cfg.subGames[1] (ticketPrice, luckyNumberPrize, ...)
    // har ingen ny-schema-kolonne — droppes som per-game-management.config_json.
    mapping.droppedLegacyFields.push(
      "BingoBonanza.subGames[1].ticketPrice/luckyNumberPrize/seconds_per_ball/minTicketCount → konfig hører til app_game_management.config_json (utenfor seed-scope)"
    );
  } else {
    logger.warn(
      "[SEED] Ingen BingoBonanza-config-snapshot funnet — Game 3 patterns ikke seedes."
    );
  }

  return { gameTypes, subGames, patterns };
}

/**
 * Standard 5-pattern-bundle som hver sub-game-mal eksponerer:
 *   - Row 1, Row 2, Row 3, Row 4 (claim_type=LINE)
 *   - Full House (claim_type=BINGO)
 *
 * Spesielle sub-games (Mystery, Oddsen 56, Jackpot, Innsatsen) bruker samme
 * 5 grunn-patterns men markerer is_mys/is_jackpot/is_lucky_bonus i is_*-flagg
 * på pattern-raden.
 */
function deriveDefaultPatternRows(_subGameName: string): Array<{
  patternNumber: string;
  name: string;
  mask: number;
  claimType: "LINE" | "BINGO";
  orderIndex: number;
  design: number;
  patternId: string;
}> {
  const result = [];
  for (let row = 0; row < 4; row++) {
    const mask = ((1 << 5) - 1) << (row * 5); // 5 bits for given row
    const num = `PT_LEGACY_bingo_row_${row + 1}`;
    result.push({
      patternNumber: num,
      name: `Row ${row + 1}`,
      mask,
      claimType: "LINE" as const,
      orderIndex: row,
      design: 1,
      patternId: num, // same id for sub-game.patternRows reference
    });
  }
  result.push({
    patternNumber: "PT_LEGACY_bingo_full_house",
    name: "Full House",
    mask: (1 << 25) - 1,
    claimType: "BINGO" as const,
    orderIndex: 4,
    design: 2,
    patternId: "PT_LEGACY_bingo_full_house",
  });
  return result;
}

/**
 * Heuristikk: navnet → 25-bit-maske. Gir best-effort guesses for kjente
 * pattern-navn (Row 1, Coverall, Pyramid, X osv.). Ukjente navn gir 0
 * (admin må fylle inn manuelt etter seed).
 */
function patternNameToMask(name: string): number {
  const n = name.toLowerCase().trim();
  if (n === "coverall" || n.includes("full house") || n === "fullt hus") {
    return (1 << 25) - 1;
  }
  const rowMatch = n.match(/^row\s*(\d)$/);
  if (rowMatch) {
    const row = Number(rowMatch[1]) - 1;
    if (row >= 0 && row < 5) return ((1 << 5) - 1) << (row * 5);
  }
  // Defaulter til 0 — kalller må fylle inn senere via admin-UI.
  return 0;
}

// ── Schedule + DailySchedule UPSERT ─────────────────────────────────────────

async function upsertSchedule(
  client: QueryClient,
  schema: string,
  snapshot: z.infer<typeof ScheduleSnapshotSchema>,
  options: { dryRun: boolean; createdBy: string }
): Promise<ImportRecordResult> {
  const scheduleNumber = `SID_LEGACY_${slugify(snapshot.schedule.name)}`;
  const scheduleName = snapshot.schedule.name;
  const luckyPrizeKr = maybeInt(snapshot.schedule.luckyNumberPrize) ?? 0;
  const luckyPrizeOre = luckyPrizeKr * 100;
  const scheduleType = snapshot.schedule.scheduleType;
  const start = sanitizeTimeStr(snapshot.schedule.manualStartTime);
  const end = sanitizeTimeStr(snapshot.schedule.manualEndTime);
  const subGamesJson = snapshot.subGames.map((sg, idx) =>
    serializeScheduleSubGame(sg, idx)
  );

  const table = `"${schema}"."app_schedules"`;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE schedule_number = $1 AND deleted_at IS NULL`,
    [scheduleNumber]
  );

  if (options.dryRun) {
    return {
      resource: "subGame",
      key: scheduleNumber,
      action:
        existing.rowCount && existing.rowCount > 0 ? "updated" : "created",
      reason: "dry-run (schedule)",
      id: existing.rows[0]?.id,
    };
  }

  if (existing.rowCount && existing.rowCount > 0) {
    const id = existing.rows[0]!.id;
    await client.query(
      `UPDATE ${table}
       SET schedule_name = $2,
           schedule_type = $3,
           lucky_number_prize = $4,
           manual_start_time = $5,
           manual_end_time = $6,
           sub_games_json = $7::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        scheduleName,
        scheduleType,
        luckyPrizeOre,
        start,
        end,
        JSON.stringify(subGamesJson),
      ]
    );
    return {
      resource: "subGame",
      key: scheduleNumber,
      action: "updated",
      id,
    };
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO ${table}
       (id, schedule_name, schedule_number, schedule_type,
        lucky_number_prize, status, is_admin_schedule,
        manual_start_time, manual_end_time, sub_games_json, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      id,
      scheduleName,
      scheduleNumber,
      scheduleType,
      luckyPrizeOre,
      "active",
      true,
      start,
      end,
      JSON.stringify(subGamesJson),
      options.createdBy,
    ]
  );
  return {
    resource: "subGame",
    key: scheduleNumber,
    action: "created",
    id,
  };
}

/**
 * Wire-format som ScheduleService leser. Bevarer minimum-shapen
 * scheduleController forventet (custom_game_name, notificationStartTime,
 * timing, ticketTypesData, jackpotData, elvisData) pluss legacy raw
 * fields i `extra` for round-trip.
 */
function serializeScheduleSubGame(
  sg: z.infer<typeof ScheduleSubGameSchema>,
  index: number
): Record<string, unknown> {
  const f = sg.fields;
  const colors = f["ticketColorType]["] ?? [];
  const canonicalColors = colors.map(
    (c) => LEGACY_COLOR_TO_CANONICAL[c] ?? c
  );

  return {
    index,
    name: f.name,
    custom_game_name: f.custom_game_name ?? f.name,
    notificationStartTime: f.notificationStartTime ?? "0s",
    minseconds: maybeInt(f.minseconds) ?? 5,
    maxseconds: maybeInt(f.maxseconds) ?? 15,
    seconds: maybeInt(f.seconds) ?? 5,
    ticketTypesData: {
      ticketType: canonicalColors,
      legacyTicketType: colors,
      ticketPrice: extractPricesByColor(sg.prices ?? {}),
      ticketPrize: sg.prizes ?? {},
    },
    jackpotData:
      f.jackpotPrizeYellow || f.jackpotPrizeWhite || f.jackpotDraw
        ? {
            jackpotPrizeYellow: maybeInt(f.jackpotPrizeYellow),
            jackpotPrizeWhite: maybeInt(f.jackpotPrizeWhite),
            jackpotDraw: maybeInt(f.jackpotDraw),
            jackpotInnsatsenDraw: maybeInt(f.jackpotInnsatsenDraw),
          }
        : null,
    elvisData: f.replace_price
      ? { replaceTicketPrice: maybeInt(f.replace_price) }
      : null,
    extra: {
      minimumPrize: maybeInt(f.minimumPrize),
    },
  };
}

async function upsertDailySchedule(
  client: QueryClient,
  schema: string,
  legacyTypeName: LegacyGameTypeName,
  raw: Record<string, unknown>,
  options: { dryRun: boolean; createdBy: string }
): Promise<ImportRecordResult & { skipped?: boolean }> {
  const id = String(raw["schedule_object_id"] ?? "");
  if (!id) {
    return {
      resource: "subGame",
      key: legacyTypeName,
      action: "failed",
      reason: "Mangler schedule_object_id i daily-schedule-mapping.",
    };
  }
  const table = `"${schema}"."app_daily_schedules"`;
  const meta = LEGACY_TO_NEW_GAME_TYPE[legacyTypeName];
  if (!meta) {
    return {
      resource: "subGame",
      key: id,
      action: "failed",
      reason: `Ukjent legacy game-type: ${legacyTypeName}`,
    };
  }

  const idDisplay =
    String(raw["id_display"] ?? raw["label"] ?? `${legacyTypeName}_${id.slice(0, 8)}`);
  const dateRange = String(raw["date_range"] ?? "");
  const timeWindow = String(raw["time_window"] ?? "");
  const groupOfHalls = String(raw["group_of_halls"] ?? "");
  const masterHall = String(raw["master_hall"] ?? "");
  const status = String(raw["status"] ?? "Aktiv");
  const newStatus = status.toLowerCase().includes("aktiv") ? "active" : "inactive";

  // Parse start/end dates from date_range "DD/MM/YYYY-DD/MM/YYYY"
  const [startStr, endStr] = parseLegacyDateRange(dateRange);
  // Parse times from "HH:MM - HH:MM"
  const [startTime, endTime] = parseLegacyTimeWindow(timeWindow);

  if (!startStr) {
    return {
      resource: "subGame",
      key: id,
      action: "failed",
      reason: `Kunne ikke parse start-dato fra '${dateRange}'.`,
    };
  }

  // Note: Turbomania (Game 4 / themebingo) håndteres tidligere i runSeed-
  // loopen via en `continue` så denne funksjonen aldri kalles for den.
  // For SpinnGo: dailySchedules array er tom/truncated i extraction. Hvis
  // vi får en rad allikevel, seedes den med best-effort.
  // For Lynbingo: dailySchedules er tom; nås ikke her.

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

  // hall_id NULL siden vi ikke har hall-uuid-mapping ennå (Test Hall, Oslo).
  // hall_ids_json bevarer legacy-info for senere normalisering når halls
  // er seeded med samsvarende navn.
  const hallIdsJson = {
    masterHallName: masterHall || null,
    groupOfHallsName: groupOfHalls || null,
    hallIds: [],
    groupHallIds: [],
  };

  const otherDataJson: Record<string, unknown> = {
    legacyType: legacyTypeName,
    legacyTypeId: meta.legacyId,
    newGameTypeSlug: meta.typeSlug,
    legacyIdDisplay: idDisplay,
    legacyStatus: status,
    legacyDateRange: dateRange,
    legacyTimeWindow: timeWindow,
    sourcedFrom: "admin-panel-game-management 2026-04-30",
  };
  if (raw["patterns_text"]) {
    otherDataJson.legacyPatternsText = raw["patterns_text"];
  }
  if (raw["prizes_text_compressed"]) {
    otherDataJson.legacyPrizesTextCompressed = raw["prizes_text_compressed"];
  }
  if (raw["type"]) {
    otherDataJson.legacyTypeLabel = raw["type"];
  }

  if (options.dryRun) {
    return {
      resource: "subGame",
      key: id,
      action:
        existing.rowCount && existing.rowCount > 0 ? "updated" : "created",
      reason: "dry-run (daily-schedule)",
      id,
    };
  }

  if (existing.rowCount && existing.rowCount > 0) {
    await client.query(
      `UPDATE ${table}
       SET name = $2,
           hall_ids_json = $3::jsonb,
           start_date = $4,
           end_date = $5,
           start_time = $6,
           end_time = $7,
           status = $8,
           other_data_json = $9::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        idDisplay,
        JSON.stringify(hallIdsJson),
        startStr,
        endStr,
        startTime,
        endTime,
        newStatus,
        JSON.stringify(otherDataJson),
      ]
    );
    return {
      resource: "subGame",
      key: id,
      action: "updated",
      id,
    };
  }

  await client.query(
    `INSERT INTO ${table}
       (id, name, hall_ids_json, week_days, start_date, end_date,
        start_time, end_time, status, other_data_json, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      id,
      idDisplay,
      JSON.stringify(hallIdsJson),
      0,
      startStr,
      endStr,
      startTime,
      endTime,
      newStatus,
      JSON.stringify(otherDataJson),
      options.createdBy,
    ]
  );
  return {
    resource: "subGame",
    key: id,
    action: "created",
    id,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Ugyldig schema-navn: ${schema}`);
  }
  return schema;
}

function defaultLogger(): ImportLogger {
  return {
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function maybeInt(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function sanitizeTimeStr(v: string | undefined): string {
  if (!v) return "";
  // Accept HH:MM only; reject anything else.
  return /^[0-9]{2}:[0-9]{2}$/.test(v) ? v : "";
}

function extractPricesByColor(
  pricesRaw: Record<string, string>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(pricesRaw)) {
    // Legacy keys are prefixed with "][" — stripp og resten er fargenavn.
    const stripped = k.startsWith("][") ? k.slice(2) : k;
    out[stripped] = maybeInt(v);
  }
  return out;
}

/**
 * "29/04/2026-09/05/2026" → ["2026-04-29T00:00:00.000Z", "2026-05-09T23:59:59.999Z"]
 */
function parseLegacyDateRange(s: string): [string | null, string | null] {
  if (!s) return [null, null];
  const parts = s.split("-").map((p) => p.trim());
  if (parts.length !== 2) return [null, null];
  const start = parseDmy(parts[0]!);
  const end = parseDmy(parts[1]!, true);
  return [start, end];
}

function parseDmy(s: string, endOfDay = false): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, "0");
  const mm = m[2]!.padStart(2, "0");
  const yyyy = m[3]!;
  const time = endOfDay ? "23:59:59.999Z" : "00:00:00.000Z";
  return `${yyyy}-${mm}-${dd}T${time}`;
}

function parseLegacyTimeWindow(s: string): [string, string] {
  if (!s) return ["", ""];
  // "01:27 - 21:27" or "01:27-21:27"
  const m = s.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (!m) return ["", ""];
  return [m[1]!, m[2]!];
}

function aggregate(
  records: ImportRecordResult[],
  resource: ImportRecordResult["resource"]
): { total: number; created: number; updated: number; failed: number } {
  const filtered = records.filter((r) => r.resource === resource);
  return {
    total: filtered.length,
    created: filtered.filter((r) => r.action === "created").length,
    updated: filtered.filter((r) => r.action === "updated").length,
    failed: filtered.filter((r) => r.action === "failed").length,
  };
}

/**
 * subGame-aggregator skiller seg fra `aggregate` fordi `runImport` returnerer
 * kun de rene SubGame-postene med resource='subGame', mens vi gjenbruker
 * 'subGame'-tag for schedule + daily-schedule i denne seedet (siden
 * ImportRecordResult.resource ikke har egne enum-verdier for dem).
 *
 * Vi finner derfor sub-game-postene basert på key-prefiks: "SG_LEGACY_*".
 */
function aggregateSubGame(
  records: ImportRecordResult[]
): { total: number; created: number; updated: number; failed: number } {
  const filtered = records.filter(
    (r) => r.resource === "subGame" && r.key.startsWith("SG_LEGACY_")
  );
  return {
    total: filtered.length,
    created: filtered.filter((r) => r.action === "created").length,
    updated: filtered.filter((r) => r.action === "updated").length,
    failed: filtered.filter((r) => r.action === "failed").length,
  };
}

function aggregateScheduleResults(
  records: ImportRecordResult[]
): { total: number; created: number; updated: number; failed: number } {
  const filtered = records.filter((r) => r.key.startsWith("SID_LEGACY_"));
  return {
    total: filtered.length,
    created: filtered.filter((r) => r.action === "created").length,
    updated: filtered.filter((r) => r.action === "updated").length,
    failed: filtered.filter((r) => r.action === "failed").length,
  };
}

function aggregateDailyResults(
  records: Array<ImportRecordResult & { skipped?: boolean }>
): { total: number; created: number; updated: number; skipped: number; failed: number } {
  return {
    total: records.length,
    created: records.filter((r) => r.action === "created").length,
    updated: records.filter((r) => r.action === "updated").length,
    skipped: records.filter((r) => r.action === "skipped").length,
    failed: records.filter((r) => r.action === "failed").length,
  };
}

// Eksponert for testbarhet.
export const _internals = {
  LEGACY_TO_NEW_GAME_TYPE,
  LEGACY_COLOR_TO_CANONICAL,
  buildLegacyPayload,
  deriveDefaultPatternRows,
  patternNameToMask,
  parseLegacyDateRange,
  parseLegacyTimeWindow,
  serializeScheduleSubGame,
  slugify,
  maybeInt,
  extractPricesByColor,
  readSnapshots,
};
