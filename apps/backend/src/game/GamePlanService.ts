/**
 * Fase 1 (2026-05-07): GamePlanService — admin-CRUD for spilleplan-template.
 *
 * Tabeller: `app_game_plan` + `app_game_plan_item`. Service-laget støtter
 * drag-and-drop-rekkefølge via `setItems` som ATOMISK erstatter hele
 * sekvensen i en transaksjon (DELETE * + INSERT N).
 *
 * Hall vs. group: planen er bundet til ENTEN `hallId` ELLER `groupOfHallsId`
 * (XOR håndhevet av DB-CHECK). app_groups-tabellen finnes ikke ennå —
 * derfor ingen FK på `groupOfHallsId` i denne migrasjonen. Når den kommer
 * kan service-laget legges til en eksistens-sjekk her.
 *
 * Out-of-scope for Fase 1:
 *   - Routes (Fase 3)
 *   - Admin-UI (Fase 2)
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { GameCatalogService } from "./GameCatalogService.js";
import {
  BONUS_GAME_SLUG_VALUES,
  type BonusGameSlug,
} from "./gameCatalog.types.js";
import type {
  CreateGamePlanInput,
  GamePlan,
  GamePlanItem,
  GamePlanWithItems,
  ListGamePlanFilter,
  SetGamePlanItemsInput,
  UpdateGamePlanInput,
  Weekday,
} from "./gamePlan.types.js";
import { WEEKDAY_VALUES } from "./gamePlan.types.js";

const logger = rootLogger.child({ module: "game-plan-service" });

const VALID_WEEKDAYS = new Set<Weekday>(WEEKDAY_VALUES);
const VALID_BONUS_SLUGS = new Set<BonusGameSlug>(BONUS_GAME_SLUG_VALUES);

/**
 * Tolkning A (2026-05-07): valider per-item bonus-spill-override.
 *
 * - undefined eller null → returner null (ingen override).
 * - string → må være i `BONUS_GAME_SLUG_VALUES`. Trim + lowercase
 *   normaliseres for å matche slug-whitelist.
 * - alt annet → INVALID_INPUT.
 */
function assertBonusGameOverride(
  value: unknown,
  field: string,
): BonusGameSlug | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være streng eller null.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const slug = trimmed.toLowerCase() as BonusGameSlug;
  if (!VALID_BONUS_SLUGS.has(slug)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være en av: ${BONUS_GAME_SLUG_VALUES.join(", ")} (fikk "${trimmed}").`,
    );
  }
  return slug;
}
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ITEMS_PER_PLAN = 100;

// ── input-validering ────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`,
    );
  }
  return trimmed;
}

function assertWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "weekdays må være en liste.");
  }
  if (value.length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "weekdays må ha minst én dag.",
    );
  }
  const seen = new Set<Weekday>();
  const out: Weekday[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new DomainError(
        "INVALID_INPUT",
        "weekdays må være en liste av strenger.",
      );
    }
    const w = raw.trim().toLowerCase() as Weekday;
    if (!VALID_WEEKDAYS.has(w)) {
      throw new DomainError(
        "INVALID_INPUT",
        `weekdays må være subset av ${WEEKDAY_VALUES.join(", ")} (fikk "${raw}").`,
      );
    }
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

function assertTime(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være streng "HH:MM".`,
    );
  }
  const trimmed = value.trim();
  if (!TIME_REGEX.test(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være "HH:MM" (24-timer).`,
    );
  }
  return trimmed;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function assertHallOrGroup(
  hallId: string | null | undefined,
  groupOfHallsId: string | null | undefined,
): { hallId: string | null; groupOfHallsId: string | null } {
  const hall =
    typeof hallId === "string" && hallId.trim() ? hallId.trim() : null;
  const group =
    typeof groupOfHallsId === "string" && groupOfHallsId.trim()
      ? groupOfHallsId.trim()
      : null;
  if (hall && group) {
    throw new DomainError(
      "INVALID_INPUT",
      "Kan ikke binde plan til både hallId og groupOfHallsId.",
    );
  }
  if (!hall && !group) {
    throw new DomainError(
      "INVALID_INPUT",
      "Plan må bindes til enten hallId eller groupOfHallsId.",
    );
  }
  return { hallId: hall, groupOfHallsId: group };
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function timeRowToString(value: unknown): string {
  if (typeof value === "string") {
    // Postgres returnerer 'HH:MM:SS' for TIME — kapp til 'HH:MM'.
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  if (value instanceof Date) {
    const h = String(value.getUTCHours()).padStart(2, "0");
    const m = String(value.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  return "00:00";
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}

function isCheckViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23514";
  }
  return false;
}

// ── row mapping ─────────────────────────────────────────────────────────

interface GamePlanRow {
  id: string;
  name: string;
  description: string | null;
  hall_id: string | null;
  group_of_halls_id: string | null;
  weekdays_json: unknown;
  start_time: unknown;
  end_time: unknown;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  created_by_user_id: string | null;
}

interface GamePlanItemRow {
  id: string;
  plan_id: string;
  position: number;
  game_catalog_id: string;
  bonus_game_override: string | null;
  notes: string | null;
  created_at: Date | string;
}

function parseWeekdays(raw: unknown): Weekday[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Weekday>();
  const out: Weekday[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const w = v.trim().toLowerCase() as Weekday;
    if (VALID_WEEKDAYS.has(w) && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

function mapPlanRow(row: GamePlanRow): GamePlan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    hallId: row.hall_id,
    groupOfHallsId: row.group_of_halls_id,
    weekdays: parseWeekdays(row.weekdays_json),
    startTime: timeRowToString(row.start_time),
    endTime: timeRowToString(row.end_time),
    isActive: Boolean(row.is_active),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    createdByUserId: row.created_by_user_id,
  };
}

function mapItemRow(row: GamePlanItemRow): GamePlanItem {
  // Tolkning A (2026-05-07): bonus_game_override kan ha vilkårlig tekst i
  // DB hvis migrasjonen kjøres uten service-validering. Filtrer mot
  // whitelist og fall tilbake til null hvis det er noe rart.
  const rawOverride = row.bonus_game_override;
  const bonusGameOverride: BonusGameSlug | null =
    typeof rawOverride === "string" &&
    VALID_BONUS_SLUGS.has(rawOverride as BonusGameSlug)
      ? (rawOverride as BonusGameSlug)
      : null;
  return {
    id: row.id,
    planId: row.plan_id,
    position: Number(row.position),
    gameCatalogId: row.game_catalog_id,
    bonusGameOverride,
    notes: row.notes,
    createdAt: asIso(row.created_at),
  };
}

// ── service ─────────────────────────────────────────────────────────────

export interface GamePlanServiceOptions {
  pool: Pool;
  schema?: string;
  catalogService: GameCatalogService;
  auditLogService?: AuditLogService | null;
}

export class GamePlanService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly catalogService: GameCatalogService;
  private auditLogService: AuditLogService | null;

  constructor(options: GamePlanServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.catalogService = options.catalogService;
    this.auditLogService = options.auditLogService ?? null;
  }

  /** @internal — test-hook. */
  static forTesting(opts: {
    pool: Pool;
    schema?: string;
    catalogService: GameCatalogService;
    auditLogService?: AuditLogService | null;
  }): GamePlanService {
    const svc = Object.create(GamePlanService.prototype) as GamePlanService;
    (svc as unknown as { pool: Pool }).pool = opts.pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(
      opts.schema ?? "public",
    );
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

  private planTable(): string {
    return `"${this.schema}"."app_game_plan"`;
  }

  private itemTable(): string {
    return `"${this.schema}"."app_game_plan_item"`;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  async list(filter: ListGamePlanFilter = {}): Promise<GamePlan[]> {
    const limit =
      filter.limit && filter.limit > 0
        ? Math.min(Math.floor(filter.limit), 500)
        : 200;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filter.hallId !== undefined) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.groupOfHallsId !== undefined) {
      params.push(filter.groupOfHallsId);
      conditions.push(`group_of_halls_id = $${params.length}`);
    }
    if (filter.isActive !== undefined) {
      params.push(Boolean(filter.isActive));
      conditions.push(`is_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<GamePlanRow>(
      `SELECT id, name, description, hall_id, group_of_halls_id, weekdays_json,
              start_time, end_time, is_active, created_at, updated_at, created_by_user_id
       FROM ${this.planTable()}
       ${where}
       ORDER BY name ASC, created_at ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(mapPlanRow);
  }

  async getById(id: string): Promise<GamePlanWithItems | null> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows: planRows } = await this.pool.query<GamePlanRow>(
      `SELECT id, name, description, hall_id, group_of_halls_id, weekdays_json,
              start_time, end_time, is_active, created_at, updated_at, created_by_user_id
       FROM ${this.planTable()}
       WHERE id = $1`,
      [id.trim()],
    );
    if (!planRows[0]) return null;
    const plan = mapPlanRow(planRows[0]);
    const items = await this.fetchItems(plan.id);
    return { ...plan, items };
  }

  private async fetchItems(
    planId: string,
  ): Promise<GamePlanWithItems["items"]> {
    const { rows } = await this.pool.query<GamePlanItemRow>(
      `SELECT id, plan_id, position, game_catalog_id, bonus_game_override, notes, created_at
       FROM ${this.itemTable()}
       WHERE plan_id = $1
       ORDER BY position ASC`,
      [planId],
    );
    if (rows.length === 0) return [];
    const items = rows.map(mapItemRow);
    // Hent catalog-entries i en batch.
    const uniqueCatalogIds = Array.from(
      new Set(items.map((i) => i.gameCatalogId)),
    );
    const catalogById = new Map<string, Awaited<ReturnType<GameCatalogService["getById"]>>>();
    for (const cid of uniqueCatalogIds) {
      catalogById.set(cid, await this.catalogService.getById(cid));
    }
    return items.map((item) => {
      const entry = catalogById.get(item.gameCatalogId);
      if (!entry) {
        throw new DomainError(
          "GAME_CATALOG_NOT_FOUND",
          `Plan-item refererer til ukjent catalog-entry ${item.gameCatalogId}.`,
        );
      }
      return { ...item, catalogEntry: entry };
    });
  }

  // ── writes ────────────────────────────────────────────────────────────

  async create(
    input: CreateGamePlanInput,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: input.createdByUserId,
      actorType: "ADMIN",
    },
  ): Promise<GamePlanWithItems> {
    const name = assertNonEmptyString(input.name, "name", MAX_NAME_LENGTH);
    const description =
      input.description === undefined || input.description === null
        ? null
        : input.description.trim().length === 0
          ? null
          : assertNonEmptyString(
              input.description,
              "description",
              MAX_DESCRIPTION_LENGTH,
            );
    const { hallId, groupOfHallsId } = assertHallOrGroup(
      input.hallId,
      input.groupOfHallsId,
    );
    const weekdays = assertWeekdays(input.weekdays);
    const startTime = assertTime(input.startTime, "startTime");
    const endTime = assertTime(input.endTime, "endTime");
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      throw new DomainError(
        "INVALID_INPUT",
        "startTime må være før endTime (samme dag).",
      );
    }
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
    const createdByUserId = assertNonEmptyString(
      input.createdByUserId,
      "createdByUserId",
      200,
    );

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.planTable()}
           (id, name, description, hall_id, group_of_halls_id, weekdays_json,
            start_time, end_time, is_active, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::time, $8::time, $9, $10)`,
        [
          id,
          name,
          description,
          hallId,
          groupOfHallsId,
          JSON.stringify(weekdays),
          startTime,
          endTime,
          isActive,
          createdByUserId,
        ],
      );
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Plan-data brøt DB-constraint (hall/group XOR eller tids-vindu).",
        );
      }
      throw err;
    }
    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_plan.create",
      resourceId: id,
      details: { name, hallId, groupOfHallsId, weekdays },
    });
    const created = await this.getById(id);
    if (!created) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        "Plan forsvant rett etter oppretting.",
      );
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateGamePlanInput,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: "system",
      actorType: "ADMIN",
    },
  ): Promise<GamePlanWithItems> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const existing = await this.getById(id.trim());
    if (!existing) {
      throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertNonEmptyString(patch.name, "name", MAX_NAME_LENGTH));
    }
    if (patch.description !== undefined) {
      const desc =
        patch.description === null
          ? null
          : patch.description.trim().length === 0
            ? null
            : assertNonEmptyString(
                patch.description,
                "description",
                MAX_DESCRIPTION_LENGTH,
              );
      sets.push(`description = $${params.length + 1}`);
      params.push(desc);
    }
    // Hall/group XOR — hvis EN av dem oppgis, må vi sørge for at den
    // motsatte er null. Vi resolver til endelige verdier.
    if (patch.hallId !== undefined || patch.groupOfHallsId !== undefined) {
      const finalHall =
        patch.hallId !== undefined ? patch.hallId : existing.hallId;
      const finalGroup =
        patch.groupOfHallsId !== undefined
          ? patch.groupOfHallsId
          : existing.groupOfHallsId;
      const resolved = assertHallOrGroup(finalHall, finalGroup);
      sets.push(`hall_id = $${params.length + 1}`);
      params.push(resolved.hallId);
      sets.push(`group_of_halls_id = $${params.length + 1}`);
      params.push(resolved.groupOfHallsId);
    }
    if (patch.weekdays !== undefined) {
      sets.push(`weekdays_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertWeekdays(patch.weekdays)));
    }
    if (patch.startTime !== undefined) {
      sets.push(`start_time = $${params.length + 1}::time`);
      params.push(assertTime(patch.startTime, "startTime"));
    }
    if (patch.endTime !== undefined) {
      sets.push(`end_time = $${params.length + 1}::time`);
      params.push(assertTime(patch.endTime, "endTime"));
    }
    // Cross-field: start_time < end_time.
    const finalStart =
      patch.startTime !== undefined
        ? assertTime(patch.startTime, "startTime")
        : existing.startTime;
    const finalEnd =
      patch.endTime !== undefined
        ? assertTime(patch.endTime, "endTime")
        : existing.endTime;
    if (timeToMinutes(finalStart) >= timeToMinutes(finalEnd)) {
      throw new DomainError(
        "INVALID_INPUT",
        "startTime må være før endTime (samme dag).",
      );
    }
    if (patch.isActive !== undefined) {
      if (typeof patch.isActive !== "boolean") {
        throw new DomainError("INVALID_INPUT", "isActive må være boolean.");
      }
      sets.push(`is_active = $${params.length + 1}`);
      params.push(patch.isActive);
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    sets.push("updated_at = now()");
    params.push(existing.id);
    try {
      await this.pool.query(
        `UPDATE ${this.planTable()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params,
      );
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Update brøt DB-constraint (hall/group XOR eller tids-vindu).",
        );
      }
      throw err;
    }
    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_plan.update",
      resourceId: existing.id,
      details: { changedFields: Object.keys(patch) },
    });
    const updated = await this.getById(existing.id);
    if (!updated) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        "Plan forsvant under update.",
      );
    }
    return updated;
  }

  async deactivate(
    id: string,
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: "system",
      actorType: "ADMIN",
    },
  ): Promise<void> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const existing = await this.getById(id.trim());
    if (!existing) {
      throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
    }
    if (!existing.isActive) return;
    await this.pool.query(
      `UPDATE ${this.planTable()}
       SET is_active = FALSE, updated_at = now()
       WHERE id = $1`,
      [existing.id],
    );
    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_plan.deactivate",
      resourceId: existing.id,
      details: { name: existing.name },
    });
  }

  /**
   * Drag-and-drop-mønsteret: erstatter HELE sekvensen atomisk i én
   * transaksjon. Position regnes ut fra array-indeks (1-based).
   *
   * Duplikater er TILLATT — Tobias 2026-05-07: Spill 2 og 14 i bildet er
   * begge "Innsatsen". Service-laget validerer derimot at hver
   * `gameCatalogId` faktisk eksisterer og er aktiv, og at antall items
   * er ≤ MAX_ITEMS_PER_PLAN.
   */
  async setItems(
    planId: string,
    items: SetGamePlanItemsInput[],
    actor: { actorId: string; actorType?: "ADMIN" | "USER" } = {
      actorId: "system",
      actorType: "ADMIN",
    },
  ): Promise<GamePlanWithItems> {
    if (!planId?.trim()) {
      throw new DomainError("INVALID_INPUT", "planId er påkrevd.");
    }
    if (!Array.isArray(items)) {
      throw new DomainError("INVALID_INPUT", "items må være en liste.");
    }
    if (items.length > MAX_ITEMS_PER_PLAN) {
      throw new DomainError(
        "INVALID_INPUT",
        `Maks ${MAX_ITEMS_PER_PLAN} items per plan.`,
      );
    }
    const existing = await this.getById(planId.trim());
    if (!existing) {
      throw new DomainError("GAME_PLAN_NOT_FOUND", "Plan finnes ikke.");
    }

    // Valider hver item — catalog-entry må eksistere og være aktiv.
    const seenCatalogIds = new Set<string>();
    const validatedItems: SetGamePlanItemsInput[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const raw = items[i];
      if (!raw || typeof raw !== "object") {
        throw new DomainError(
          "INVALID_INPUT",
          `items[${i}] må være et objekt.`,
        );
      }
      const catalogId = assertNonEmptyString(
        raw.gameCatalogId,
        `items[${i}].gameCatalogId`,
        200,
      );
      // Bare hent catalog-entry én gang per unik id (effektivisering).
      if (!seenCatalogIds.has(catalogId)) {
        const catalogEntry = await this.catalogService.getById(catalogId);
        if (!catalogEntry) {
          throw new DomainError(
            "GAME_CATALOG_NOT_FOUND",
            `Catalog-entry ${catalogId} finnes ikke.`,
          );
        }
        if (!catalogEntry.isActive) {
          throw new DomainError(
            "GAME_CATALOG_INACTIVE",
            `Catalog-entry ${catalogId} er deaktivert — kan ikke legges i sekvens.`,
          );
        }
        seenCatalogIds.add(catalogId);
      }
      const notes =
        raw.notes === undefined || raw.notes === null
          ? null
          : raw.notes.trim().length === 0
            ? null
            : assertNonEmptyString(raw.notes, `items[${i}].notes`, 500);
      // Tolkning A (2026-05-07): valider per-item bonus-spill-override.
      const bonusGameOverride = assertBonusGameOverride(
        raw.bonusGameOverride,
        `items[${i}].bonusGameOverride`,
      );
      validatedItems.push({
        gameCatalogId: catalogId,
        bonusGameOverride,
        notes,
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM ${this.itemTable()} WHERE plan_id = $1`,
        [existing.id],
      );
      for (let i = 0; i < validatedItems.length; i += 1) {
        const item = validatedItems[i];
        await client.query(
          `INSERT INTO ${this.itemTable()}
             (id, plan_id, position, game_catalog_id, bonus_game_override, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            existing.id,
            i + 1,
            item.gameCatalogId,
            item.bonusGameOverride ?? null,
            item.notes ?? null,
          ],
        );
      }
      await client.query(
        `UPDATE ${this.planTable()}
         SET updated_at = now()
         WHERE id = $1`,
        [existing.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    void this.audit({
      actorId: actor.actorId,
      actorType: actor.actorType ?? "ADMIN",
      action: "game_plan.set_items",
      resourceId: existing.id,
      details: {
        itemCount: validatedItems.length,
        catalogIds: validatedItems.map((i) => i.gameCatalogId),
        // Tolkning A (2026-05-07): logg bonus-override-mønsteret for sporbarhet.
        // Lagrer en parallell array av kun bonus-overrides — null der ingen
        // override er satt — så vi kan korrelere mot catalogIds-arrayen.
        bonusOverrides: validatedItems.map((i) => i.bonusGameOverride ?? null),
      },
    });

    const updated = await this.getById(existing.id);
    if (!updated) {
      throw new DomainError(
        "GAME_PLAN_NOT_FOUND",
        "Plan forsvant under setItems.",
      );
    }
    return updated;
  }

  // ── audit-helper ──────────────────────────────────────────────────────

  private async audit(input: {
    actorId: string;
    actorType: "ADMIN" | "USER";
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
        resource: "game_plan",
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
