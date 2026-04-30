/**
 * BIN-625: Schedule admin-service (gjenbrukbar spill-mal / sub-game-bundle).
 *
 * Admin-CRUD for Schedule-maler. Tabellen `app_schedules` lagrer én rad per
 * mal; subgame-bundle ligger i `sub_games_json` inntil BIN-621 normaliserer
 * det videre. En Schedule er et TEMPLATE — DailySchedule (BIN-626) er
 * kalender-raden som instantierer malen på en gitt dato/hall.
 *
 * Soft-delete default: `deleted_at` + status = 'inactive'. Hard-delete
 * (`remove({ hard: true })`) er tilgjengelig når status = 'inactive' og
 * malen aldri har blitt brukt — cross-ref-sjekk mot app_daily_schedules
 * er ikke gjort her fordi legacy bruker sub_games_json-ids, ikke en direkte
 * FK mot schedule.id. Follow-up lander med BIN-621/626-koblingen.
 *
 * Legacy-opphav:
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  validateMysteryConfig,
  validateRowPrizesByColor,
  SUB_GAME_TYPES,
  type SubGameType,
} from "@spillorama/shared-types";
import { DomainError } from "../errors/DomainError.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";

const logger = rootLogger.child({ module: "schedule-service" });

/**
 * HV2-B4 (Tobias 2026-04-30): per-hall prize-floor lookup contract.
 *
 * Duck-typed slice av `Spill1PrizeDefaultsService` slik at ScheduleService
 * kan injiseres med både prod-tjenesten (Postgres-basert) og
 * `InMemorySpill1PrizeDefaultsService` i tester uten å dra inn pg-Pool i
 * unit-test-pathen.
 *
 * Returverdien speiler `Spill1PrizeDefaults`: 5 faser i kroner. Caller må
 * tåle at servicen kaster (DB-feil, network-blip) — ScheduleService logger
 * og throw'er videre, slik at fail-closed-semantikk bevares.
 */
export interface Spill1PrizeDefaultsLookup {
  getDefaults(hallId: string): Promise<{
    phase1: number;
    phase2: number;
    phase3: number;
    phase4: number;
    phase5: number;
  }>;
}

export type ScheduleStatus = "active" | "inactive";
export type ScheduleType = "Auto" | "Manual";

const VALID_STATUS: ScheduleStatus[] = ["active", "inactive"];
const VALID_TYPE: ScheduleType[] = ["Auto", "Manual"];

const HH_MM_RE = /^[0-9]{2}:[0-9]{2}$/;

/**
 * Audit 2026-04-30 (PR #748): Spill 1 legacy-paritet override-felter.
 * Speiler `Spill1OverridesSchema` i `packages/shared-types/src/schemas/admin.ts`.
 * Felt valideres via `assertSpill1Overrides` ved create/update.
 */
export interface ScheduleSpill1Overrides {
  tvExtra?: {
    pictureYellow?: number;
    frameYellow?: number;
    fullHouseYellow?: number;
  };
  oddsen56?: {
    fullHouseWithin56Yellow?: number;
    fullHouseWithin56White?: number;
  };
  spillerness2?: {
    minimumPrize?: number;
  };
}

/**
 * Fri-form subgame-slot i en Schedule-mal. Feltene matcher legacy
 * scheduleController.createSchedulePostData (ticketTypesData, jackpotData,
 * elvisData, timing). Ukjente felter bevares via `extra` slik at admin-UI
 * kan round-trippe uten data-tap før BIN-621 normaliserer.
 */
export interface ScheduleSubgame {
  name?: string;
  customGameName?: string;
  startTime?: string;
  endTime?: string;
  notificationStartTime?: string;
  minseconds?: number;
  maxseconds?: number;
  seconds?: number;
  ticketTypesData?: Record<string, unknown>;
  jackpotData?: Record<string, unknown>;
  elvisData?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /**
   * feat/schedule-8-colors-mystery: sub-game-type-diskriminant.
   * "STANDARD" (default) = pattern + ticket-colors som tidligere.
   * "MYSTERY" = Mystery Game-variant (Admin V1.0 s. 5, rev. 2023-10-05).
   */
  subGameType?: SubGameType;
  /**
   * Audit 2026-04-30 (PR #748): legacy-paritet override-felter for Tv Extra,
   * Oddsen 56 og Spillerness Spill 2. Optional — manglende felt lar
   * variant-mapper falle tilbake til `SPILL1_SUB_VARIANT_DEFAULTS`.
   *
   * Bevares ved create/update + round-trip via `assertSpill1Overrides`.
   */
  spill1Overrides?: ScheduleSpill1Overrides;
}

export interface Schedule {
  id: string;
  scheduleName: string;
  scheduleNumber: string;
  scheduleType: ScheduleType;
  luckyNumberPrize: number;
  status: ScheduleStatus;
  isAdminSchedule: boolean;
  manualStartTime: string;
  manualEndTime: string;
  subGames: ScheduleSubgame[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateScheduleInput {
  scheduleName: string;
  scheduleType?: ScheduleType;
  /** Auto-genereres hvis ikke satt (`SID_YYYYMMDD_HHMMSS`). */
  scheduleNumber?: string;
  luckyNumberPrize?: number;
  status?: ScheduleStatus;
  isAdminSchedule?: boolean;
  manualStartTime?: string;
  manualEndTime?: string;
  subGames?: ScheduleSubgame[];
  createdBy: string;
  /**
   * HV2-B4 (2026-04-30): valgfri hall-kontekst for floor-validering.
   *
   * Når satt OG service har `spill1PrizeDefaults` injisert, valideres alle
   * `subGames[i].spill1Overrides`-felter mot hall-defaults via
   * `Spill1PrizeDefaultsService.getDefaults(hallId)`. Override-verdier som
   * er lavere enn hall-default kaster `MIN_PRIZE_BELOW_HALL_DEFAULT` med
   * strukturert `details` (phase, attemptedNok, hallDefaultNok, ...).
   *
   * Når **utelatt**, faller validering tilbake til wildcard-default
   * (`hall_id='*'`) — dette gir en hall-agnostisk "global floor"-sjekk
   * som er trygt for templates som gjenbrukes på tvers av haller.
   *
   * Spill 2/3 og SpinnGo påvirkes IKKE — `spill1Overrides`-shape er
   * Spill 1-spesifikk og valideringen kjøres kun når slot-en har overrides.
   */
  hallIdForFloorValidation?: string;
  /**
   * HV2-B4: actor-id for audit-loggen ved validation-failure. Default:
   * `createdBy` (samme bruker som oppretter raden). Routes som vet bedre
   * (f.eks. ADMIN som lager template på vegne av en agent) kan overstyre.
   */
  actorIdForAudit?: string;
  /** HV2-B4: actor-type for audit-loggen. Default: USER. */
  actorTypeForAudit?: AuditActorType;
}

export interface UpdateScheduleInput {
  scheduleName?: string;
  scheduleType?: ScheduleType;
  luckyNumberPrize?: number;
  status?: ScheduleStatus;
  manualStartTime?: string;
  manualEndTime?: string;
  subGames?: ScheduleSubgame[];
  /** HV2-B4: se `CreateScheduleInput.hallIdForFloorValidation`. */
  hallIdForFloorValidation?: string;
  /** HV2-B4: actor-id for audit-loggen ved validation-failure. */
  actorIdForAudit?: string;
  /** HV2-B4: actor-type for audit-loggen. Default: USER. */
  actorTypeForAudit?: AuditActorType;
}

export interface ListScheduleFilter {
  scheduleType?: ScheduleType;
  status?: ScheduleStatus;
  /** Søk i scheduleName + scheduleNumber (case-insensitive, ILIKE). */
  search?: string;
  /** Filter på created_by — brukes av AGENT-rolle for "mine maler". */
  createdBy?: string;
  /**
   * Hvis true (default): returner både `created_by = createdBy` OG
   * `is_admin_schedule = true`-rader. Matcher legacy agent-flyt der
   * agent ser egne + admin-opprettede maler.
   */
  includeAdminForOwner?: boolean;
  limit?: number;
  includeDeleted?: boolean;
}

export interface ScheduleServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
  /**
   * HV2-B4: optional Spill 1 prize-floor lookup. Når satt aktiveres
   * floor-validering for `subGames[i].spill1Overrides` i create/update.
   * Servicen er duck-typed — produksjons-wiring sender
   * `Spill1PrizeDefaultsService`, tester kan sende
   * `InMemorySpill1PrizeDefaultsService`.
   *
   * Når undefined: ScheduleService skipper floor-validering (legacy-
   * kompatibilitet for tester og pre-HV-2-deploys).
   */
  spill1PrizeDefaults?: Spill1PrizeDefaultsLookup;
  /**
   * HV2-B4: optional audit-log-skriver. Når satt OG floor-validering
   * feiler, skrives en `schedule.create_failed.minprize_below_default`
   * (eller `update_failed`) audit-event FØR DomainError kastes. Audit-
   * skriving er fail-soft — feil her blokkerer ikke selve validering-
   * exception.
   */
  auditLogService?: AuditLogService;
}

interface ScheduleRow {
  id: string;
  schedule_name: string;
  schedule_number: string;
  schedule_type: ScheduleType;
  lucky_number_prize: string | number;
  status: ScheduleStatus;
  is_admin_schedule: boolean;
  manual_start_time: string;
  manual_end_time: string;
  sub_games_json: unknown;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertName(value: unknown, field = "scheduleName"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertScheduleNumber(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "scheduleNumber er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError(
      "INVALID_INPUT",
      "scheduleNumber kan maksimalt være 200 tegn."
    );
  }
  return trimmed;
}

function assertType(value: unknown): ScheduleType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "scheduleType må være en streng.");
  }
  const v = value.trim() as ScheduleType;
  if (!VALID_TYPE.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `scheduleType må være én av ${VALID_TYPE.join(", ")}.`
    );
  }
  return v;
}

function assertStatus(value: unknown): ScheduleStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const v = value.trim() as ScheduleStatus;
  if (!VALID_STATUS.includes(v)) {
    throw new DomainError(
      "INVALID_INPUT",
      `status må være én av ${VALID_STATUS.join(", ")}.`
    );
  }
  return v;
}

function assertHhMm(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være 'HH:MM' eller tom.`);
  }
  const s = value.trim();
  if (s === "") return "";
  if (!HH_MM_RE.test(s)) {
    throw new DomainError("INVALID_INPUT", `${field} må være 'HH:MM' eller tom.`);
  }
  const [hh, mm] = s.split(":").map((x) => Number(x));
  if (hh === undefined || mm === undefined || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new DomainError("INVALID_INPUT", `${field} må være gyldig 'HH:MM'.`);
  }
  return s;
}

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

/**
 * Audit 2026-04-30 (PR #748): valider `spill1Overrides`-objekt på subgame-slot.
 * Speiler `Spill1OverridesSchema` (Zod) i `packages/shared-types/src/schemas/admin.ts`.
 *
 * Returnerer typed `ScheduleSpill1Overrides` eller undefined når mangler.
 * Kaster `INVALID_INPUT` ved strukturelle feil (negative tall, ikke-heltall etc.).
 */
function assertSpill1Overrides(
  value: unknown,
  field: string
): ScheduleSpill1Overrides | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  const v = value as Record<string, unknown>;
  const out: ScheduleSpill1Overrides = {};

  if (v.tvExtra !== undefined && v.tvExtra !== null) {
    if (typeof v.tvExtra !== "object" || Array.isArray(v.tvExtra)) {
      throw new DomainError("INVALID_INPUT", `${field}.tvExtra må være et objekt.`);
    }
    const tv = v.tvExtra as Record<string, unknown>;
    const tvOut: ScheduleSpill1Overrides["tvExtra"] = {};
    if (tv.pictureYellow !== undefined) {
      tvOut.pictureYellow = assertNonNegativeInt(
        tv.pictureYellow,
        `${field}.tvExtra.pictureYellow`
      );
    }
    if (tv.frameYellow !== undefined) {
      tvOut.frameYellow = assertNonNegativeInt(
        tv.frameYellow,
        `${field}.tvExtra.frameYellow`
      );
    }
    if (tv.fullHouseYellow !== undefined) {
      tvOut.fullHouseYellow = assertNonNegativeInt(
        tv.fullHouseYellow,
        `${field}.tvExtra.fullHouseYellow`
      );
    }
    out.tvExtra = tvOut;
  }

  if (v.oddsen56 !== undefined && v.oddsen56 !== null) {
    if (typeof v.oddsen56 !== "object" || Array.isArray(v.oddsen56)) {
      throw new DomainError("INVALID_INPUT", `${field}.oddsen56 må være et objekt.`);
    }
    const o = v.oddsen56 as Record<string, unknown>;
    const oOut: ScheduleSpill1Overrides["oddsen56"] = {};
    if (o.fullHouseWithin56Yellow !== undefined) {
      oOut.fullHouseWithin56Yellow = assertNonNegativeInt(
        o.fullHouseWithin56Yellow,
        `${field}.oddsen56.fullHouseWithin56Yellow`
      );
    }
    if (o.fullHouseWithin56White !== undefined) {
      oOut.fullHouseWithin56White = assertNonNegativeInt(
        o.fullHouseWithin56White,
        `${field}.oddsen56.fullHouseWithin56White`
      );
    }
    out.oddsen56 = oOut;
  }

  if (v.spillerness2 !== undefined && v.spillerness2 !== null) {
    if (typeof v.spillerness2 !== "object" || Array.isArray(v.spillerness2)) {
      throw new DomainError(
        "INVALID_INPUT",
        `${field}.spillerness2 må være et objekt.`
      );
    }
    const sp = v.spillerness2 as Record<string, unknown>;
    const spOut: ScheduleSpill1Overrides["spillerness2"] = {};
    if (sp.minimumPrize !== undefined) {
      spOut.minimumPrize = assertNonNegativeInt(
        sp.minimumPrize,
        `${field}.spillerness2.minimumPrize`
      );
    }
    out.spillerness2 = spOut;
  }

  // Returner undefined hvis alle sub-objekter manglet (ingen-op).
  return Object.keys(out).length > 0 ? out : undefined;
}

function assertOptionalObject(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

function assertSubgames(value: unknown): ScheduleSubgame[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "subGames må være en array.");
  }
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new DomainError("INVALID_INPUT", `subGames[${i}] må være et objekt.`);
    }
    const r = raw as Record<string, unknown>;
    const slot: ScheduleSubgame = {};
    if (r.name !== undefined) {
      if (typeof r.name !== "string") {
        throw new DomainError("INVALID_INPUT", `subGames[${i}].name må være en streng.`);
      }
      slot.name = r.name;
    }
    if (r.customGameName !== undefined) {
      if (r.customGameName !== null && typeof r.customGameName !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].customGameName må være en streng.`
        );
      }
      if (typeof r.customGameName === "string") slot.customGameName = r.customGameName;
    }
    if (r.startTime !== undefined) {
      slot.startTime = assertHhMm(r.startTime, `subGames[${i}].startTime`);
    }
    if (r.endTime !== undefined) {
      slot.endTime = assertHhMm(r.endTime, `subGames[${i}].endTime`);
    }
    if (r.notificationStartTime !== undefined) {
      if (typeof r.notificationStartTime !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].notificationStartTime må være en streng.`
        );
      }
      slot.notificationStartTime = r.notificationStartTime;
    }
    if (r.minseconds !== undefined) {
      slot.minseconds = assertNonNegativeInt(
        r.minseconds,
        `subGames[${i}].minseconds`
      );
    }
    if (r.maxseconds !== undefined) {
      slot.maxseconds = assertNonNegativeInt(
        r.maxseconds,
        `subGames[${i}].maxseconds`
      );
    }
    if (r.seconds !== undefined) {
      slot.seconds = assertNonNegativeInt(r.seconds, `subGames[${i}].seconds`);
    }
    const tData = assertOptionalObject(
      r.ticketTypesData,
      `subGames[${i}].ticketTypesData`
    );
    if (tData !== undefined) slot.ticketTypesData = tData;
    const jData = assertOptionalObject(
      r.jackpotData,
      `subGames[${i}].jackpotData`
    );
    if (jData !== undefined) slot.jackpotData = jData;
    const eData = assertOptionalObject(r.elvisData, `subGames[${i}].elvisData`);
    if (eData !== undefined) slot.elvisData = eData;
    const extra = assertOptionalObject(r.extra, `subGames[${i}].extra`);
    if (extra !== undefined) slot.extra = extra;

    // feat/schedule-8-colors-mystery: validér sub-game-type + ekstra-felter.
    // Lagres på wire som eget felt på subgame-objektet, ikke inne i `extra`,
    // slik at service-laget kan diskriminere uten å pakke opp JSON.
    if (r.subGameType !== undefined) {
      if (typeof r.subGameType !== "string") {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].subGameType må være en streng.`
        );
      }
      const sgType = r.subGameType as SubGameType;
      if (!(SUB_GAME_TYPES as readonly string[]).includes(sgType)) {
        throw new DomainError(
          "INVALID_INPUT",
          `subGames[${i}].subGameType må være én av ${SUB_GAME_TYPES.join(", ")}.`
        );
      }
      slot.subGameType = sgType;
    }

    // Audit 2026-04-30 (PR #748): valider og persister `spill1Overrides`
    // (Tv Extra, Oddsen 56, Spillerness Spill 2). Påvirker ikke andre felt;
    // mangler → undefined → variant-mapper bruker SPILL1_SUB_VARIANT_DEFAULTS.
    if (r.spill1Overrides !== undefined) {
      const overrides = assertSpill1Overrides(
        r.spill1Overrides,
        `subGames[${i}].spill1Overrides`
      );
      if (overrides !== undefined) slot.spill1Overrides = overrides;
    }

    // rowPrizesByColor + mysteryConfig: lagres i `extra` for bakoverkompat
    // (unormalisert JSONB). Valideres her hvis satt.
    if (slot.extra) {
      const rp = (slot.extra as Record<string, unknown>).rowPrizesByColor;
      if (rp !== undefined) {
        const err = validateRowPrizesByColor(rp);
        if (err) {
          throw new DomainError(
            "INVALID_INPUT",
            `subGames[${i}].extra.${err}`
          );
        }
      }
      const mc = (slot.extra as Record<string, unknown>).mysteryConfig;
      if (mc !== undefined) {
        const err = validateMysteryConfig(mc);
        if (err) {
          throw new DomainError(
            "INVALID_INPUT",
            `subGames[${i}].extra.${err}`
          );
        }
      }
    }

    return slot;
  });
}

/**
 * Generer Schedule-nummer à la legacy (SID_YYYYMMDD_HHMMSS + ms-suffix for
 * kollisjonstoleranse). Bruker UTC så to parallelle innkomster som skjer
 * innen samme millisekund får ulikt suffix via randomUUID-chunk.
 */
function generateScheduleNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const suffix = randomUUID().split("-")[0] ?? "";
  return `SID_${y}${m}${d}_${hh}${mm}${ss}_${suffix}`;
}

export class ScheduleService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;
  /**
   * HV2-B4: prize-floor lookup. Undefined → floor-validering skipper.
   *
   * Mutable så `index.ts` kan injisere etter konstruksjon — i prod-wiring
   * konstrueres `Spill1PrizeDefaultsService` etter `ScheduleService` (begge
   * trenger `sharedPool`, men `auditLogService`-trinnet ligger i mellom).
   * Identical mønster som `SwedbankPayService.setAuditLogger`.
   */
  private spill1PrizeDefaults: Spill1PrizeDefaultsLookup | undefined;
  /** HV2-B4: audit-log for validation-failure events. */
  private auditLogService: AuditLogService | undefined;

  constructor(options: ScheduleServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "ScheduleService krever pool eller connectionString."
      );
    }
    this.spill1PrizeDefaults = options.spill1PrizeDefaults;
    this.auditLogService = options.auditLogService;
  }

  /**
   * HV2-B4: post-construction injection av floor-default-lookup. Brukt av
   * `index.ts` der `Spill1PrizeDefaultsService` konstrueres etter at
   * `ScheduleService` allerede er instansiert. Pass `null` for å koble fra
   * (test-cleanup el.l.).
   */
  setSpill1PrizeDefaults(lookup: Spill1PrizeDefaultsLookup | null): void {
    this.spill1PrizeDefaults = lookup ?? undefined;
  }

  /**
   * HV2-B4: post-construction injection av audit-log-service. Pass `null`
   * for å koble fra. Følger samme pattern som
   * `SwedbankPayService.setAuditLogger`.
   */
  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? undefined;
  }

  /**
   * @internal — test-hook.
   *
   * Backward-compat: signaturen tar fortsatt kun pool + schema for
   * eksisterende test-suites. HV2-B4-tester som trenger floor-validering
   * bruker den utvidede `forTestingWithDeps`-varianten.
   */
  static forTesting(pool: Pool, schema = "public"): ScheduleService {
    return ScheduleService.forTestingWithDeps({ pool, schema });
  }

  /**
   * @internal — HV2-B4 utvidet test-hook.
   *
   * Tillater å injisere `spill1PrizeDefaults` og `auditLogService` i tester
   * så floor-valideringen kan stubbes uten å snurre opp en faktisk
   * Postgres-server. Pool og schema er alltid required (samme som
   * `forTesting`), de andre er optional.
   */
  static forTestingWithDeps(opts: {
    pool: Pool;
    schema?: string;
    spill1PrizeDefaults?: Spill1PrizeDefaultsLookup;
    auditLogService?: AuditLogService;
  }): ScheduleService {
    const svc = Object.create(ScheduleService.prototype) as ScheduleService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(opts.schema ?? "public");
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    (svc as unknown as { spill1PrizeDefaults: Spill1PrizeDefaultsLookup | undefined })
      .spill1PrizeDefaults = opts.spill1PrizeDefaults;
    (svc as unknown as { auditLogService: AuditLogService | undefined }).auditLogService =
      opts.auditLogService;
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_schedules"`;
  }

  async list(filter: ListScheduleFilter = {}): Promise<Schedule[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.scheduleType) {
      params.push(assertType(filter.scheduleType));
      conditions.push(`schedule_type = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    if (filter.search && filter.search.trim()) {
      const pattern = `%${filter.search.trim()}%`;
      params.push(pattern);
      const p1 = params.length;
      params.push(pattern);
      const p2 = params.length;
      conditions.push(
        `(schedule_name ILIKE $${p1} OR schedule_number ILIKE $${p2})`
      );
    }
    if (filter.createdBy) {
      if (filter.includeAdminForOwner !== false) {
        // Legacy agent-flyt: se egne + admin-opprettede.
        params.push(filter.createdBy);
        conditions.push(
          `(created_by = $${params.length} OR is_admin_schedule = true)`
        );
      } else {
        params.push(filter.createdBy);
        conditions.push(`created_by = $${params.length}`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<ScheduleRow>(
      `SELECT id, schedule_name, schedule_number, schedule_type,
              lucky_number_prize, status, is_admin_schedule,
              manual_start_time, manual_end_time, sub_games_json,
              created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<Schedule> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<ScheduleRow>(
      `SELECT id, schedule_name, schedule_number, schedule_type,
              lucky_number_prize, status, is_admin_schedule,
              manual_start_time, manual_end_time, sub_games_json,
              created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCHEDULE_NOT_FOUND", "Schedule-malen finnes ikke.");
    }
    return this.map(row);
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    await this.ensureInitialized();
    const scheduleName = assertName(input.scheduleName);
    const scheduleType = input.scheduleType ? assertType(input.scheduleType) : "Manual";
    const scheduleNumber = input.scheduleNumber
      ? assertScheduleNumber(input.scheduleNumber)
      : generateScheduleNumber();
    const luckyNumberPrize =
      input.luckyNumberPrize === undefined
        ? 0
        : assertNonNegativeInt(input.luckyNumberPrize, "luckyNumberPrize");
    const status = input.status ? assertStatus(input.status) : "active";
    const isAdminSchedule =
      input.isAdminSchedule === undefined ? true : Boolean(input.isAdminSchedule);
    const subGames = assertSubgames(input.subGames);

    // Auto-type: avled manual-tidene fra første/siste subgame hvis ikke
    // eksplisitt gitt. Dette matcher legacy createSchedulePostData.
    let manualStartTime = assertHhMm(input.manualStartTime, "manualStartTime");
    let manualEndTime = assertHhMm(input.manualEndTime, "manualEndTime");
    if (scheduleType === "Auto" && subGames.length > 0) {
      if (!manualStartTime && subGames[0]?.startTime) {
        manualStartTime = subGames[0].startTime;
      }
      if (!manualEndTime && subGames[subGames.length - 1]?.endTime) {
        manualEndTime = subGames[subGames.length - 1]!.endTime!;
      }
    }

    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    // HV2-B4: håndhev `subVariant.minPrize ≥ hall-default` før insert.
    // Skipper hvis service ikke er konfigurert med prizeDefaults-lookup.
    await this.validateSpill1OverridesAgainstHallFloors(subGames, {
      operation: "create",
      hallIdForFloorValidation: input.hallIdForFloorValidation,
      actorId: input.actorIdForAudit ?? input.createdBy,
      actorType: input.actorTypeForAudit ?? "USER",
      scheduleResourceId: null,
      scheduleName,
    });

    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<ScheduleRow>(
        `INSERT INTO ${this.table()}
           (id, schedule_name, schedule_number, schedule_type,
            lucky_number_prize, status, is_admin_schedule,
            manual_start_time, manual_end_time, sub_games_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
         RETURNING id, schedule_name, schedule_number, schedule_type,
                   lucky_number_prize, status, is_admin_schedule,
                   manual_start_time, manual_end_time, sub_games_json,
                   created_by, created_at, updated_at, deleted_at`,
        [
          id,
          scheduleName,
          scheduleNumber,
          scheduleType,
          luckyNumberPrize,
          status,
          isAdminSchedule,
          manualStartTime,
          manualEndTime,
          JSON.stringify(subGames),
          input.createdBy,
        ]
      );
      return this.map(rows[0]!);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "23505") {
        throw new DomainError(
          "SCHEDULE_NUMBER_CONFLICT",
          "scheduleNumber er allerede i bruk."
        );
      }
      logger.error({ err }, "[BIN-625] schedule insert failed");
      throw new DomainError(
        "SCHEDULE_INSERT_FAILED",
        "Kunne ikke lagre Schedule."
      );
    }
  }

  async update(id: string, update: UpdateScheduleInput): Promise<Schedule> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SCHEDULE_DELETED",
        "Schedule er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.scheduleName !== undefined) {
      sets.push(`schedule_name = $${params.length + 1}`);
      params.push(assertName(update.scheduleName));
    }
    if (update.scheduleType !== undefined) {
      sets.push(`schedule_type = $${params.length + 1}`);
      params.push(assertType(update.scheduleType));
    }
    if (update.luckyNumberPrize !== undefined) {
      sets.push(`lucky_number_prize = $${params.length + 1}`);
      params.push(assertNonNegativeInt(update.luckyNumberPrize, "luckyNumberPrize"));
    }
    if (update.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(assertStatus(update.status));
    }
    if (update.manualStartTime !== undefined) {
      sets.push(`manual_start_time = $${params.length + 1}`);
      params.push(assertHhMm(update.manualStartTime, "manualStartTime"));
    }
    if (update.manualEndTime !== undefined) {
      sets.push(`manual_end_time = $${params.length + 1}`);
      params.push(assertHhMm(update.manualEndTime, "manualEndTime"));
    }
    if (update.subGames !== undefined) {
      const validated = assertSubgames(update.subGames);
      // HV2-B4: håndhev `subVariant.minPrize ≥ hall-default` før UPDATE.
      // Kjører kun når subGames endres — andre felt-oppdateringer (navn,
      // status, tidspunkter) påvirker ikke override-feltene og trenger
      // ingen re-validering.
      await this.validateSpill1OverridesAgainstHallFloors(validated, {
        operation: "update",
        hallIdForFloorValidation: update.hallIdForFloorValidation,
        actorId: update.actorIdForAudit ?? existing.createdBy ?? null,
        actorType: update.actorTypeForAudit ?? "USER",
        scheduleResourceId: existing.id,
        scheduleName: existing.scheduleName,
      });
      sets.push(`sub_games_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(validated));
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");
    params.push(existing.id);

    const { rows } = await this.pool.query<ScheduleRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, schedule_name, schedule_number, schedule_type,
                 lucky_number_prize, status, is_admin_schedule,
                 manual_start_time, manual_end_time, sub_games_json,
                 created_by, created_at, updated_at, deleted_at`,
      params
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCHEDULE_NOT_FOUND", "Schedule-malen finnes ikke.");
    }
    return this.map(row);
  }

  /**
   * Default: soft-delete (sett deleted_at, status='inactive'). Hvis `hard=true`
   * og raden er inaktiv (status='inactive' eller allerede slettet), hard-
   * delete kan kjøres. Hard-delete av en active-mal blokkeres — sett
   * status='inactive' først via update().
   */
  async remove(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SCHEDULE_DELETED",
        "Schedule er allerede slettet."
      );
    }
    const canHardDelete =
      options.hard === true && existing.status === "inactive";

    if (canHardDelete) {
      await this.pool.query(`DELETE FROM ${this.table()} WHERE id = $1`, [
        existing.id,
      ]);
      return { softDeleted: false };
    }
    if (options.hard === true) {
      throw new DomainError(
        "SCHEDULE_HARD_DELETE_BLOCKED",
        "Hard-delete krever status='inactive' først."
      );
    }
    await this.pool.query(
      `UPDATE ${this.table()}
       SET deleted_at = now(), status = 'inactive', updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: true };
  }

  /**
   * HV2-B4 (Tobias 2026-04-30): valider `subGames[i].spill1Overrides` mot
   * hall-default-floors. Implementerer kontrakten i
   * `docs/architecture/HV2_BIR036_SPEC_2026-04-30.md` §2: "Per-spill-
   * override kan ØKE floor men aldri senke under hall-default."
   *
   * **Skip-rules:**
   *   * Service ikke wired med `spill1PrizeDefaults` → no-op (legacy/test).
   *   * `subGames` har ingen `spill1Overrides`-felter → no-op (per-slot).
   *   * Bare felter som mapper til 5-fase-modellen valideres:
   *     - `spill1Overrides.tvExtra.fullHouseYellow` → phase 5 (Fullt Hus).
   *     - `spill1Overrides.spillerness2.minimumPrize` → phase 1 (Rad 1).
   *     - Picture/Frame (TV Extra) og Oddsen 56-felter ER konseptuelt
   *       utenfor 5-fase-modellen (concurrent custom-patterns / mini-game).
   *       De arver IKKE hall-floors. Matcher `applySpill1HallFloors` som
   *       ekskluderer dem fra floor-overlay i runtime.
   *
   * **Hall-lookup:**
   *   * `hallIdForFloorValidation` satt → hent defaults for den hallen.
   *   * Utelatt → fall tilbake til wildcard-defaults (`hall_id='*'`) som
   *     representerer den globale hall-default-baselinen alle haller arver.
   *     Dette gir hall-agnostisk validering for templates som gjenbrukes.
   *
   * **Audit-log:**
   *   Ved validation-failure skrives en
   *   `schedule.create_failed.minprize_below_default` (eller `update_*`)
   *   audit-event MED `actorId`, `hallId`, `subgameIndex`, `field`,
   *   `phase`, `attemptedNok`, `hallDefaultNok`. Audit-skriving er
   *   fail-soft — feil i `record(...)` blokkerer ikke selve DomainError.
   *
   * **Throws:** `MIN_PRIZE_BELOW_HALL_DEFAULT` med tilsvarende `details`.
   */
  private async validateSpill1OverridesAgainstHallFloors(
    subGames: ScheduleSubgame[],
    ctx: {
      operation: "create" | "update";
      hallIdForFloorValidation: string | undefined;
      actorId: string | null;
      actorType: AuditActorType;
      scheduleResourceId: string | null;
      scheduleName: string;
    },
  ): Promise<void> {
    if (!this.spill1PrizeDefaults) return;

    // Tidlig-exit hvis ingen sub-games har overrides — sparer DB-round-trip.
    const hasAnyOverrides = subGames.some(
      (sg) => sg.spill1Overrides !== undefined && sg.spill1Overrides !== null,
    );
    if (!hasAnyOverrides) return;

    // Wildcard som default når caller ikke spesifiserer hall — representerer
    // den globale baseline-floor som alle haller arver fra.
    // `Spill1PrizeDefaultsService.SPILL1_DEFAULTS_WILDCARD_HALL` = "*".
    const lookupHallId =
      ctx.hallIdForFloorValidation && ctx.hallIdForFloorValidation.trim()
        ? ctx.hallIdForFloorValidation.trim()
        : "*";

    let defaults: {
      phase1: number;
      phase2: number;
      phase3: number;
      phase4: number;
      phase5: number;
    };
    try {
      defaults = await this.spill1PrizeDefaults.getDefaults(lookupHallId);
    } catch (err) {
      // DB-/network-feil: fail-closed med klar melding så caller vet at
      // valideringen ikke kunne fullføres. Dette matcher fail-closed-
      // semantikk på compliance-pathen i resten av systemet.
      logger.error(
        { err, hallId: lookupHallId, operation: ctx.operation },
        "[HV2-B4] floor-defaults lookup failed — kan ikke validere spill1Overrides",
      );
      throw new DomainError(
        "SPILL1_PRIZE_DEFAULTS_UNAVAILABLE",
        "Kunne ikke hente hall-default-grenser for floor-validering. Prøv igjen.",
        { hallId: lookupHallId },
      );
    }

    // Sjekk hver sub-game-slot. Stop ved første feil (én feilmelding er
    // nok for admin-UX — admin retter feltet og prøver igjen).
    for (let i = 0; i < subGames.length; i++) {
      const slot = subGames[i];
      if (!slot?.spill1Overrides) continue;
      const overrides = slot.spill1Overrides;

      // 1. Tv Extra Full House → phase 5 (Fullt Hus).
      const tvFullHouse = overrides.tvExtra?.fullHouseYellow;
      if (typeof tvFullHouse === "number" && tvFullHouse < defaults.phase5) {
        await this.failFloorValidation(ctx, {
          subgameIndex: i,
          field: "spill1Overrides.tvExtra.fullHouseYellow",
          phase: 5,
          phaseLabel: "Fullt Hus",
          attemptedNok: tvFullHouse,
          hallDefaultNok: defaults.phase5,
          lookupHallId,
        });
      }

      // 2. Spillerness Spill 2 minimumPrize → phase 1 (Rad 1).
      const sp2Min = overrides.spillerness2?.minimumPrize;
      if (typeof sp2Min === "number" && sp2Min < defaults.phase1) {
        await this.failFloorValidation(ctx, {
          subgameIndex: i,
          field: "spill1Overrides.spillerness2.minimumPrize",
          phase: 1,
          phaseLabel: "Rad 1",
          attemptedNok: sp2Min,
          hallDefaultNok: defaults.phase1,
          lookupHallId,
        });
      }
    }
  }

  /**
   * HV2-B4 helper: skriv audit-event + kast DomainError ved floor-violation.
   * Audit-skriving er fail-soft — feil her blokkerer ikke selve exception.
   */
  private async failFloorValidation(
    ctx: {
      operation: "create" | "update";
      actorId: string | null;
      actorType: AuditActorType;
      scheduleResourceId: string | null;
      scheduleName: string;
    },
    failure: {
      subgameIndex: number;
      field: string;
      phase: 1 | 2 | 3 | 4 | 5;
      phaseLabel: string;
      attemptedNok: number;
      hallDefaultNok: number;
      lookupHallId: string;
    },
  ): Promise<never> {
    const action =
      ctx.operation === "create"
        ? "schedule.create_failed.minprize_below_default"
        : "schedule.update_failed.minprize_below_default";
    if (this.auditLogService) {
      try {
        await this.auditLogService.record({
          actorId: ctx.actorId,
          actorType: ctx.actorType,
          action,
          resource: "schedule",
          resourceId: ctx.scheduleResourceId,
          details: {
            scheduleName: ctx.scheduleName,
            hallId: failure.lookupHallId,
            subgameIndex: failure.subgameIndex,
            field: failure.field,
            phase: failure.phase,
            phaseLabel: failure.phaseLabel,
            attemptedNok: failure.attemptedNok,
            hallDefaultNok: failure.hallDefaultNok,
          },
        });
      } catch (err) {
        logger.warn(
          { err, action },
          "[HV2-B4] audit-log skriving feilet — fortsetter med DomainError",
        );
      }
    }
    throw new DomainError(
      "MIN_PRIZE_BELOW_HALL_DEFAULT",
      `Phase ${failure.phase} (${failure.phaseLabel}): forsøkt minPrize ${failure.attemptedNok} kr ` +
        `er under hall-default ${failure.hallDefaultNok} kr. Per-spill-override kan ikke ` +
        `senke under hall-default. Endre hall-default først hvis du vil ha lavere floor.`,
      {
        hallId: failure.lookupHallId,
        subgameIndex: failure.subgameIndex,
        field: failure.field,
        phase: failure.phase,
        phaseLabel: failure.phaseLabel,
        attemptedNok: failure.attemptedNok,
        hallDefaultNok: failure.hallDefaultNok,
      },
    );
  }

  private map(row: ScheduleRow): Schedule {
    const rawSubgames = Array.isArray(row.sub_games_json) ? row.sub_games_json : [];
    const subGames: ScheduleSubgame[] = rawSubgames
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => {
        const slot: ScheduleSubgame = {};
        if (typeof s.name === "string") slot.name = s.name;
        if (typeof s.customGameName === "string") slot.customGameName = s.customGameName;
        if (typeof s.startTime === "string") slot.startTime = s.startTime;
        if (typeof s.endTime === "string") slot.endTime = s.endTime;
        if (typeof s.notificationStartTime === "string") {
          slot.notificationStartTime = s.notificationStartTime;
        }
        if (typeof s.minseconds === "number") slot.minseconds = s.minseconds;
        if (typeof s.maxseconds === "number") slot.maxseconds = s.maxseconds;
        if (typeof s.seconds === "number") slot.seconds = s.seconds;
        if (s.ticketTypesData && typeof s.ticketTypesData === "object" && !Array.isArray(s.ticketTypesData)) {
          slot.ticketTypesData = s.ticketTypesData as Record<string, unknown>;
        }
        if (s.jackpotData && typeof s.jackpotData === "object" && !Array.isArray(s.jackpotData)) {
          slot.jackpotData = s.jackpotData as Record<string, unknown>;
        }
        if (s.elvisData && typeof s.elvisData === "object" && !Array.isArray(s.elvisData)) {
          slot.elvisData = s.elvisData as Record<string, unknown>;
        }
        if (s.extra && typeof s.extra === "object" && !Array.isArray(s.extra)) {
          slot.extra = s.extra as Record<string, unknown>;
        }
        if (typeof s.subGameType === "string") {
          const sgType = s.subGameType as SubGameType;
          if ((SUB_GAME_TYPES as readonly string[]).includes(sgType)) {
            slot.subGameType = sgType;
          }
        }
        // Audit 2026-04-30 (PR #748): round-trip spill1Overrides på read.
        // Defensivt: assertSpill1Overrides for å filtrere ut korrupt data
        // (returner undefined på feil i stedet for å kaste i map-pathen).
        if (s.spill1Overrides !== undefined && s.spill1Overrides !== null) {
          try {
            const overrides = assertSpill1Overrides(
              s.spill1Overrides,
              "spill1Overrides"
            );
            if (overrides !== undefined) slot.spill1Overrides = overrides;
          } catch {
            // Korrupt JSONB i DB — drop felt på read i stedet for å kaste.
            // Mapper-defaults brukes når feltet mangler.
          }
        }
        return slot;
      });
    return {
      id: row.id,
      scheduleName: row.schedule_name,
      scheduleNumber: row.schedule_number,
      scheduleType: row.schedule_type,
      luckyNumberPrize: Number(row.lucky_number_prize),
      status: row.status,
      isAdminSchedule: Boolean(row.is_admin_schedule),
      manualStartTime: row.manual_start_time,
      manualEndTime: row.manual_end_time,
      subGames,
      createdBy: row.created_by,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      deletedAt: asIsoOrNull(row.deleted_at),
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id TEXT PRIMARY KEY,
          schedule_name TEXT NOT NULL,
          schedule_number TEXT NOT NULL UNIQUE,
          schedule_type TEXT NOT NULL DEFAULT 'Manual'
            CHECK (schedule_type IN ('Auto','Manual')),
          lucky_number_prize BIGINT NOT NULL DEFAULT 0
            CHECK (lucky_number_prize >= 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','inactive')),
          is_admin_schedule BOOLEAN NOT NULL DEFAULT true,
          manual_start_time TEXT NOT NULL DEFAULT ''
            CHECK (manual_start_time = '' OR manual_start_time ~ '^[0-9]{2}:[0-9]{2}$'),
          manual_end_time TEXT NOT NULL DEFAULT ''
            CHECK (manual_end_time = '' OR manual_end_time ~ '^[0-9]{2}:[0-9]{2}$'),
          sub_games_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_created_at
         ON ${this.table()}(created_at DESC) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_type
         ON ${this.table()}(schedule_type) WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_schedules_created_by
         ON ${this.table()}(created_by) WHERE deleted_at IS NULL`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-625] schedules schema init failed");
      throw new DomainError(
        "SCHEDULE_INIT_FAILED",
        "Kunne ikke initialisere schedules-tabell."
      );
    } finally {
      client.release();
    }
  }
}
