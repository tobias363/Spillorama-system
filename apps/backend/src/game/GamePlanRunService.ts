/**
 * Fase 1 (2026-05-07): GamePlanRunService — runtime-state for spilleplan.
 *
 * Tabell: `app_game_plan_run`. Service-laget håndterer:
 *   - getOrCreateForToday: idempotent — opprett "idle"-rad hvis ingen finnes
 *     for (hall, business_date), ellers returner eksisterende.
 *   - start: idle → running, set started_at + master_user_id, current_position=1.
 *   - advanceToNext: inkrementer current_position. Hvis catalog-entry på
 *     ny posisjon krever jackpot-setup og override mangler, returner
 *     `jackpotSetupRequired=true` (run flyttes ikke før master submitter).
 *     Hvis vi går forbi siste posisjon → status=finished.
 *   - setJackpotOverride: lagrer trekk + premier per posisjon for jackpot-
 *     popup (master fyller i UI når jackpot-spill skal starte).
 *   - pause/resume/finish: status-overganger.
 *
 * Status-overganger:
 *   idle → running (via start)
 *   running ↔ paused (via pause/resume)
 *   running/paused → finished (via finish OR advanceToNext-past-end)
 *   idle → finished (force-finish, OK)
 *
 * Out-of-scope for Fase 1:
 *   - Routes (Fase 3)
 *   - Master-dashbord-kobling (Fase 3)
 *   - Multi-hall coordination (allerede dekket av eksisterende
 *     Game1HallReadyService osv. — denne service-en er en _override_-laget
 *     for plan-templates).
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GameCatalogService } from "./GameCatalogService.js";
import type { GamePlanService } from "./GamePlanService.js";
import type {
  AdvanceToNextResult,
  GamePlanRun,
  GamePlanRunStatus,
  JackpotOverride,
} from "./gamePlan.types.js";
import type { TicketColor } from "./gameCatalog.types.js";
import { TICKET_COLOR_VALUES } from "./gameCatalog.types.js";

const logger = rootLogger.child({ module: "game-plan-run-service" });

const VALID_TICKET_COLORS = new Set<TicketColor>(TICKET_COLOR_VALUES);
// Trekk-range — vi tillater 1..90 selv om Spill 1 er 1..75. Forskjellige
// spill-typer i kataloget kan ha ulikt range. Mer detaljert validering må
// flyttes til den enkelte spill-engine i Fase 3.
const MIN_DRAW = 1;
const MAX_DRAW = 90;

// ── input-validering ────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertHallId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
  }
  return value.trim();
}

function assertBusinessDate(value: unknown): string {
  // Aksepterer Date eller "YYYY-MM-DD"-streng. Returnerer "YYYY-MM-DD"
  // (Oslo-tz). Vi unngår å regne tz-konvertering selv — caller må passe
  // på at de sender en Oslo-tz-dato. Dette matcher mønsteret i
  // CloseDayService og andre eksisterende services.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DomainError("INVALID_INPUT", "businessDate er ugyldig dato.");
    }
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new DomainError(
        "INVALID_INPUT",
        "businessDate må være Date eller 'YYYY-MM-DD'.",
      );
    }
    return trimmed;
  }
  throw new DomainError(
    "INVALID_INPUT",
    "businessDate må være Date eller 'YYYY-MM-DD'.",
  );
}

function assertNotPastDate(businessDate: string): void {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  if (businessDate < todayStr) {
    throw new DomainError(
      "INVALID_INPUT",
      `businessDate ${businessDate} er i fortiden — kun i dag eller senere er tillatt.`,
    );
  }
}

function assertJackpotOverride(
  raw: unknown,
  allowedColors: Set<TicketColor>,
): JackpotOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DomainError(
      "INVALID_INPUT",
      "override må være et objekt med draw + prizesCents.",
    );
  }
  const obj = raw as Record<string, unknown>;
  const drawN = Number(obj.draw);
  if (!Number.isFinite(drawN) || !Number.isInteger(drawN)) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.draw må være heltall.",
    );
  }
  if (drawN < MIN_DRAW || drawN > MAX_DRAW) {
    throw new DomainError(
      "INVALID_INPUT",
      `override.draw må være mellom ${MIN_DRAW} og ${MAX_DRAW}.`,
    );
  }
  if (
    !obj.prizesCents ||
    typeof obj.prizesCents !== "object" ||
    Array.isArray(obj.prizesCents)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.prizesCents må være et objekt.",
    );
  }
  const prizes: Partial<Record<TicketColor, number>> = {};
  for (const [k, v] of Object.entries(obj.prizesCents as Record<string, unknown>)) {
    if (!VALID_TICKET_COLORS.has(k as TicketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} er ikke en gyldig bongfarge.`,
      );
    }
    if (!allowedColors.has(k as TicketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} matcher ikke catalog-game.ticketColors.`,
      );
    }
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new DomainError(
        "INVALID_INPUT",
        `override.prizesCents.${k} må være positivt heltall (øre).`,
      );
    }
    prizes[k as TicketColor] = n;
  }
  if (Object.keys(prizes).length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "override.prizesCents må ha minst én farge.",
    );
  }
  return { draw: drawN, prizesCents: prizes };
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return asIso(value);
}

function dateRowToString(value: unknown): string {
  if (typeof value === "string") {
    // Postgres returnerer 'YYYY-MM-DD' eller full ISO — kapp til 10 tegn.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    const yyyy = value.getUTCFullYear();
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(value.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "0000-00-00";
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}

// ── row mapping ─────────────────────────────────────────────────────────

interface GamePlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: unknown;
  current_position: number;
  status: string;
  jackpot_overrides_json: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  master_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseJackpotOverrides(
  raw: unknown,
): Record<string, JackpotOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, JackpotOverride> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;
    const drawN = Number(obj.draw);
    if (!Number.isFinite(drawN) || !Number.isInteger(drawN)) continue;
    let prizesRaw: unknown = obj.prizesCents;
    // Tolerer både camelCase og snake_case fra DB.
    if (prizesRaw === undefined) prizesRaw = obj.prizes_cents;
    if (!prizesRaw || typeof prizesRaw !== "object" || Array.isArray(prizesRaw)) {
      continue;
    }
    const prizes: Partial<Record<TicketColor, number>> = {};
    for (const [pk, pv] of Object.entries(
      prizesRaw as Record<string, unknown>,
    )) {
      if (!VALID_TICKET_COLORS.has(pk as TicketColor)) continue;
      const n = Number(pv);
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
        prizes[pk as TicketColor] = n;
      }
    }
    out[k] = { draw: drawN, prizesCents: prizes };
  }
  return out;
}

function mapRow(row: GamePlanRunRow): GamePlanRun {
  const status = row.status as GamePlanRunStatus;
  return {
    id: row.id,
    planId: row.plan_id,
    hallId: row.hall_id,
    businessDate: dateRowToString(row.business_date),
    currentPosition: Number(row.current_position),
    status,
    jackpotOverrides: parseJackpotOverrides(row.jackpot_overrides_json),
    startedAt: asIsoOrNull(row.started_at),
    finishedAt: asIsoOrNull(row.finished_at),
    masterUserId: row.master_user_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

// ── service ─────────────────────────────────────────────────────────────

export interface GamePlanRunServiceOptions {
  pool: Pool;
  schema?: string;
  planService: GamePlanService;
  catalogService: GameCatalogService;
  auditLogService?: AuditLogService | null;
}

export class GamePlanRunService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly planService: GamePlanService;
  private readonly catalogService: GameCatalogService;
  private auditLogService: AuditLogService | null;

  constructor(options: GamePlanRunServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.planService = options.planService;
    this.catalogService = options.catalogService;
    this.auditLogService = options.auditLogService ?? null;
  }

  /** @internal — test-hook. */
  static forTesting(opts: {
    pool: Pool;
    schema?: string;
    planService: GamePlanService;
    catalogService: GameCatalogService;
    auditLogService?: AuditLogService | null;
  }): GamePlanRunService {
    const svc = Object.create(
      GamePlanRunService.prototype,
    ) as GamePlanRunService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
    (svc as unknown as {
      planService: GamePlanService;
    }).planService = opts.planService;
    (svc as unknown as {
      catalogService: GameCatalogService;
    }).catalogService = opts.catalogService;
    (svc as unknown as {
      auditLogService: AuditLogService | null;
    }).auditLogService = opts.auditLogService ?? null;
    return svc;
  }

  setAuditLogService(service: AuditLogService | null): void {
    this.auditLogService = service ?? null;
  }

  private table(): string {
    return `"${this.schema}"."app_game_plan_run"`;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  /**
   * Hent aktiv (idle/running/paused) eller siste run for (hallId,
   * businessDate). Ingen oppretting — caller må selv kalle
   * `getOrCreateForToday` hvis de vil ha en idempotent create.
   */
  async findForDay(
    hallId: string,
    businessDate: Date | string,
  ): Promise<GamePlanRun | null> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    const { rows } = await this.pool.query<GamePlanRunRow>(
      `SELECT id, plan_id, hall_id, business_date, current_position, status,
              jackpot_overrides_json, started_at, finished_at, master_user_id,
              created_at, updated_at
       FROM ${this.table()}
       WHERE hall_id = $1 AND business_date = $2::date`,
      [hall, dateStr],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Idempotent create. Hvis ingen run finnes for (hall, businessDate)
   * opprettes en idle-rad bundet til en plan. Hvis flere planer matcher
   * (hall + ukedag) tar service-en den første aktive (sortert på navn).
   *
   * Hvis ingen plan finnes som dekker (hall, weekday) kastes
   * `NO_MATCHING_PLAN`.
   */
  async getOrCreateForToday(
    hallId: string,
    businessDate: Date | string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    assertNotPastDate(dateStr);

    const existing = await this.findForDay(hall, dateStr);
    if (existing) return existing;

    // Finn matchende plan. Vi henter alle aktive planer for hallen og
    // velger første som matcher ukedag.
    const weekdayKey = this.weekdayFromDateStr(dateStr);
    const candidates = await this.planService.list({
      hallId: hall,
      isActive: true,
      limit: 50,
    });
    const matched = candidates.find((p) =>
      (p.weekdays as readonly string[]).includes(weekdayKey),
    );
    if (!matched) {
      throw new DomainError(
        "NO_MATCHING_PLAN",
        `Ingen aktiv plan dekker (hall=${hall}, weekday=${weekdayKey}).`,
      );
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.table()}
           (id, plan_id, hall_id, business_date, current_position, status, jackpot_overrides_json)
         VALUES ($1, $2, $3, $4::date, 1, 'idle', '{}'::jsonb)`,
        [id, matched.id, hall, dateStr],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Race: noen andre opprettet en run mellom findForDay og INSERT.
        const racy = await this.findForDay(hall, dateStr);
        if (racy) return racy;
      }
      throw err;
    }
    void this.audit({
      actorId: "system",
      actorType: "SYSTEM",
      action: "game_plan_run.create",
      resourceId: id,
      details: { planId: matched.id, hallId: hall, businessDate: dateStr },
    });
    const created = await this.findForDay(hall, dateStr);
    if (!created) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Run forsvant rett etter create.",
      );
    }
    return created;
  }

  // ── status-overganger ─────────────────────────────────────────────────

  async start(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate). Kall getOrCreateForToday først.",
      );
    }
    if (run.status !== "idle") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke starte run med status=${run.status} (kun 'idle' tillatt).`,
      );
    }
    await this.pool.query(
      `UPDATE ${this.table()}
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           current_position = 1,
           master_user_id = $2,
           updated_at = now()
       WHERE id = $1`,
      [run.id, masterUserId.trim()],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.start",
      resourceId: run.id,
      details: { planId: run.planId, hallId: hall, businessDate: dateStr },
    });
    return this.requireById(run.id);
  }

  async pause(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "paused", [
      "running",
    ]);
  }

  async resume(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "running", [
      "paused",
    ]);
  }

  async finish(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<GamePlanRun> {
    return this.changeStatus(hallId, businessDate, masterUserId, "finished", [
      "idle",
      "running",
      "paused",
    ]);
  }

  /**
   * Forsøk å flytte til neste posisjon. Hvis catalog-entry på ny posisjon
   * krever jackpot-setup og override mangler i `jackpot_overrides_json`,
   * blir run IKKE oppdatert — service-en returnerer bare
   * `jackpotSetupRequired=true` så caller (master-UI) kan vise popup.
   *
   * Hvis vi går forbi siste posisjon i sekvensen → status=finished.
   */
  async advanceToNext(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
  ): Promise<AdvanceToNextResult> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (run.status !== "running" && run.status !== "paused") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke advance fra status=${run.status} (krever 'running' eller 'paused').`,
      );
    }

    const plan = await this.planService.getById(run.planId);
    if (!plan) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        "Plan finnes ikke (sletet?).",
      );
    }
    const items = plan.items;
    const newPosition = run.currentPosition + 1;
    if (newPosition > items.length) {
      // Siste posisjon nådd — finish.
      await this.pool.query(
        `UPDATE ${this.table()}
         SET status = 'finished',
             finished_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [run.id],
      );
      void this.audit({
        actorId: masterUserId.trim(),
        actorType: "USER",
        action: "game_plan_run.finish",
        resourceId: run.id,
        details: {
          reason: "advance_past_end",
          previousPosition: run.currentPosition,
        },
      });
      const finished = await this.requireById(run.id);
      return { run: finished, nextGame: null, jackpotSetupRequired: false };
    }

    const nextItem = items.find((i) => i.position === newPosition);
    if (!nextItem) {
      throw new DomainError(
        "GAME_PLAN_RUN_CORRUPT",
        `Plan-sekvens har ingen item på posisjon ${newPosition}.`,
      );
    }
    const nextGame = nextItem.catalogEntry;

    // Sjekk om jackpot-setup mangler.
    const overrideKey = String(newPosition);
    const hasOverride =
      Object.prototype.hasOwnProperty.call(run.jackpotOverrides, overrideKey);
    if (nextGame.requiresJackpotSetup && !hasOverride) {
      // IKKE oppdater run — bare returner flagget. Master-UI viser popup,
      // setJackpotOverride lagrer data, deretter kalles advanceToNext igjen.
      return {
        run,
        nextGame,
        jackpotSetupRequired: true,
      };
    }

    await this.pool.query(
      `UPDATE ${this.table()}
       SET current_position = $2,
           updated_at = now()
       WHERE id = $1`,
      [run.id, newPosition],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.advance",
      resourceId: run.id,
      details: {
        fromPosition: run.currentPosition,
        toPosition: newPosition,
        catalogId: nextGame.id,
        catalogSlug: nextGame.slug,
      },
    });
    const advanced = await this.requireById(run.id);
    return { run: advanced, nextGame, jackpotSetupRequired: false };
  }

  /**
   * Lagre jackpot-popup-data fra master. Position må peke til en jackpot-
   * posisjon i den løpende planen (catalog-entry må ha
   * requiresJackpotSetup=true). Prizes-keys må matche catalog-entry sine
   * ticketColors.
   */
  async setJackpotOverride(
    hallId: string,
    businessDate: Date | string,
    position: number,
    override: { draw: number; prizesCents: Record<string, number> },
    masterUserId: string,
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (
      !Number.isFinite(position) ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      throw new DomainError("INVALID_INPUT", "position må være positivt heltall.");
    }
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (run.status === "finished") {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        "Kan ikke sette jackpot-override på en ferdig run.",
      );
    }
    const plan = await this.planService.getById(run.planId);
    if (!plan) {
      throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
    }
    const item = plan.items.find((i) => i.position === position);
    if (!item) {
      throw new DomainError(
        "INVALID_INPUT",
        `Plan har ingen item på posisjon ${position}.`,
      );
    }
    if (!item.catalogEntry.requiresJackpotSetup) {
      throw new DomainError(
        "INVALID_INPUT",
        `Spillet på posisjon ${position} krever ikke jackpot-setup.`,
      );
    }
    const allowedColors = new Set<TicketColor>(item.catalogEntry.ticketColors);
    const validated = assertJackpotOverride(override, allowedColors);

    // Atomisk merge — jsonb_set ville krevd at vi serialiserte hver verdi
    // separat. Vi leser, merger, skriver tilbake. Her er det safe fordi
    // master er én bruker per hall og vi ikke har samtidighet på samme
    // (hall, position).
    const merged = { ...run.jackpotOverrides, [String(position)]: validated };
    await this.pool.query(
      `UPDATE ${this.table()}
       SET jackpot_overrides_json = $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [run.id, JSON.stringify(merged)],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: "game_plan_run.jackpot_set",
      resourceId: run.id,
      details: {
        position,
        catalogId: item.catalogEntry.id,
        catalogSlug: item.catalogEntry.slug,
        draw: validated.draw,
        prizeColors: Object.keys(validated.prizesCents),
      },
    });
    return this.requireById(run.id);
  }

  // ── interne hjelpere ──────────────────────────────────────────────────

  private async changeStatus(
    hallId: string,
    businessDate: Date | string,
    masterUserId: string,
    target: GamePlanRunStatus,
    allowedFrom: GamePlanRunStatus[],
  ): Promise<GamePlanRun> {
    const hall = assertHallId(hallId);
    const dateStr = assertBusinessDate(businessDate);
    if (typeof masterUserId !== "string" || !masterUserId.trim()) {
      throw new DomainError("INVALID_INPUT", "masterUserId er påkrevd.");
    }
    const run = await this.findForDay(hall, dateStr);
    if (!run) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        "Ingen run for (hall, businessDate).",
      );
    }
    if (!allowedFrom.includes(run.status)) {
      throw new DomainError(
        "GAME_PLAN_RUN_INVALID_TRANSITION",
        `Kan ikke gå fra status=${run.status} til ${target}.`,
      );
    }
    const finishedFragment =
      target === "finished"
        ? ", finished_at = COALESCE(finished_at, now())"
        : "";
    await this.pool.query(
      `UPDATE ${this.table()}
       SET status = $2,
           updated_at = now()${finishedFragment}
       WHERE id = $1`,
      [run.id, target],
    );
    void this.audit({
      actorId: masterUserId.trim(),
      actorType: "USER",
      action: `game_plan_run.${target}`,
      resourceId: run.id,
      details: { fromStatus: run.status, toStatus: target },
    });
    return this.requireById(run.id);
  }

  private async requireById(id: string): Promise<GamePlanRun> {
    const { rows } = await this.pool.query<GamePlanRunRow>(
      `SELECT id, plan_id, hall_id, business_date, current_position, status,
              jackpot_overrides_json, started_at, finished_at, master_user_id,
              created_at, updated_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new DomainError(
        "GAME_PLAN_RUN_NOT_FOUND",
        `Run ${id} finnes ikke.`,
      );
    }
    return mapRow(rows[0]);
  }

  private weekdayFromDateStr(dateStr: string): string {
    // dateStr = "YYYY-MM-DD" — bruk Date.parse i UTC og hent dag-of-week
    // basert på lokal-tid. Caller har allerede normalisert til Oslo-tz
    // (samme antagelse som CloseDayService).
    const d = new Date(`${dateStr}T00:00:00Z`);
    const idx = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][idx];
  }

  // ── audit-helper ──────────────────────────────────────────────────────

  private async audit(input: {
    actorId: string;
    actorType: "USER" | "SYSTEM" | "ADMIN";
    action: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogService) return;
    try {
      await this.auditLogService.record({
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        resource: "game_plan_run",
        resourceId: input.resourceId,
        details: input.details,
      });
    } catch (err) {
      logger.warn(
        { err, action: input.action },
        "[fase-1] audit-log feilet — fortsetter",
      );
    }
  }
}
