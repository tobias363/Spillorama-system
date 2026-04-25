/**
 * GAP #23: Screen Saver admin-service.
 *
 * Multi-image carousel for hall-TV / dedikerte terminaler. Hvert bilde har
 * en absolutt URL (CDN/Cloudinary), per-image vis-tid og display_order.
 * Bilder kan være globale (`hall_id=null`) eller per-hall.
 *
 * Wireframe: WIREFRAME_CATALOG.md §PDF 14 — Screen Saver Setting.
 *
 * Avgrensninger:
 *   - On/off-toggle og global timeout-minutter ligger i SettingsService
 *     (`branding.screen_saver_enabled` + `branding.screen_saver_timeout_minutes`).
 *     Denne service eier KUN bildelista.
 *   - Cloudinary-upload-flyt er ikke implementert i pilot-scope; admin-UI
 *     leverer en ferdig URL (klient-side upload via Cloudinary widget eller
 *     manuelt URL-feltt). Service-laget validerer at URL er http(s).
 *     TODO BIN-XXX: server-side upload via @cloudinary/url-gen + signed
 *     uploads når CLOUDINARY_*-env er klare.
 *
 * Tabell: `app_screen_saver_images` (migration 20260425125008).
 *   - Service-laget initialiserer IKKE skjemaet (BIN-661 forward-only) —
 *     migration må ha kjørt før service brukes.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { normalizeAbsoluteHttpUrl } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "screen-saver-service" });

/** Vis-tid maks 300 sekunder (5 min) — håndheves også av DB CHECK. */
const DISPLAY_SECONDS_MIN = 1;
const DISPLAY_SECONDS_MAX = 300;
const DEFAULT_DISPLAY_SECONDS = 10;

const DISPLAY_ORDER_MAX = 1000;

export interface ScreenSaverImage {
  id: string;
  /** NULL = globalt bilde (alle haller). */
  hallId: string | null;
  imageUrl: string;
  displayOrder: number;
  displaySeconds: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListScreenSaverImagesFilter {
  /**
   * Filter:
   *   - undefined: returner ALLE (globale + per-hall) — admin-overview
   *   - null: kun globale bilder
   *   - string: kun bilder for én hall (matcher hall_id eksakt — globale ikke inkludert)
   *
   * Bruk `getCarouselForHall(hallId)` hvis du vil ha "globale + per-hall" merge.
   */
  hallId?: string | null;
  /** Inkluder soft-deleted rader. Default false. */
  includeDeleted?: boolean;
  /** Filtrer på is_active. */
  activeOnly?: boolean;
}

export interface CreateScreenSaverImageInput {
  hallId?: string | null;
  imageUrl: string;
  displayOrder?: number;
  displaySeconds?: number;
  isActive?: boolean;
  createdBy: string;
}

export interface UpdateScreenSaverImageInput {
  imageUrl?: string;
  displayOrder?: number;
  displaySeconds?: number;
  isActive?: boolean;
}

export interface ReorderEntry {
  id: string;
  displayOrder: number;
}

export interface ScreenSaverServiceOptions {
  connectionString: string;
  schema?: string;
}

interface ScreenSaverImageRow {
  id: string;
  hall_id: string | null;
  image_url: string;
  display_order: number;
  display_seconds: number;
  is_active: boolean;
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

function validateImageUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new DomainError("INVALID_INPUT", "imageUrl er påkrevd.");
  }
  if (input.length > 2048) {
    throw new DomainError("INVALID_INPUT", "imageUrl er for lang (maks 2048 tegn).");
  }
  return normalizeAbsoluteHttpUrl(input, "imageUrl", "INVALID_IMAGE_URL");
}

function validateDisplaySeconds(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    throw new DomainError(
      "INVALID_INPUT",
      `displaySeconds må være et heltall (${DISPLAY_SECONDS_MIN}-${DISPLAY_SECONDS_MAX}).`
    );
  }
  if (input < DISPLAY_SECONDS_MIN || input > DISPLAY_SECONDS_MAX) {
    throw new DomainError(
      "INVALID_INPUT",
      `displaySeconds må være mellom ${DISPLAY_SECONDS_MIN} og ${DISPLAY_SECONDS_MAX}.`
    );
  }
  return input;
}

function validateDisplayOrder(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    throw new DomainError("INVALID_INPUT", "displayOrder må være et ikke-negativt heltall.");
  }
  if (input > DISPLAY_ORDER_MAX) {
    throw new DomainError(
      "INVALID_INPUT",
      `displayOrder kan ikke overstige ${DISPLAY_ORDER_MAX}.`
    );
  }
  return input;
}

function validateHallId(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") {
    throw new DomainError("INVALID_INPUT", "hallId må være en streng eller null.");
  }
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) {
    throw new DomainError("INVALID_INPUT", "hallId er for lang.");
  }
  return trimmed;
}

export class ScreenSaverService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: ScreenSaverServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for ScreenSaverService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook (Object.create-pattern). */
  static forTesting(pool: Pool, schema = "public"): ScreenSaverService {
    const svc = Object.create(ScreenSaverService.prototype) as ScreenSaverService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_screen_saver_images"`;
  }

  private map(row: ScreenSaverImageRow): ScreenSaverImage {
    return {
      id: row.id,
      hallId: row.hall_id,
      imageUrl: row.image_url,
      displayOrder: row.display_order,
      displaySeconds: row.display_seconds,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      deletedAt: asIsoOrNull(row.deleted_at),
    };
  }

  /**
   * Liste av screen-saver-bilder. Default: alle (globale + per-hall),
   * sortert etter (hall_id NULL FIRST, display_order, created_at).
   */
  async list(filter: ListScreenSaverImagesFilter = {}): Promise<ScreenSaverImage[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.hallId === null) {
      conditions.push("hall_id IS NULL");
    } else if (typeof filter.hallId === "string") {
      const id = validateHallId(filter.hallId);
      if (id !== null) {
        params.push(id);
        conditions.push(`hall_id = $${params.length}`);
      } else {
        // Tom streng → ingen treff (eksplisitt; ikke fall through til globale).
        return [];
      }
    }
    if (filter.activeOnly) {
      conditions.push("is_active = true");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await this.pool.query<ScreenSaverImageRow>(
      `SELECT id, hall_id, image_url, display_order, display_seconds,
              is_active, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       ${where}
       ORDER BY hall_id NULLS FIRST, display_order ASC, created_at ASC`,
      params
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * Returnerer aktive bilder for én hall: globale (hall_id IS NULL) +
   * hall-spesifikke. Sortert: hall-spesifikke først (overrider globale), så
   * display_order. Brukes av TV-app-rendering (read-only public-ish).
   */
  async getCarouselForHall(hallId: string): Promise<ScreenSaverImage[]> {
    const id = validateHallId(hallId);
    if (id === null) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd for getCarouselForHall.");
    }
    const { rows } = await this.pool.query<ScreenSaverImageRow>(
      `SELECT id, hall_id, image_url, display_order, display_seconds,
              is_active, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE deleted_at IS NULL
         AND is_active = true
         AND (hall_id = $1 OR hall_id IS NULL)
       ORDER BY hall_id NULLS LAST, display_order ASC, created_at ASC`,
      [id]
    );
    return rows.map((r) => this.map(r));
  }

  async get(id: string): Promise<ScreenSaverImage> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<ScreenSaverImageRow>(
      `SELECT id, hall_id, image_url, display_order, display_seconds,
              is_active, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "Bilde finnes ikke.");
    }
    return this.map(row);
  }

  async create(input: CreateScreenSaverImageInput): Promise<ScreenSaverImage> {
    const imageUrl = validateImageUrl(input.imageUrl);
    const hallId = validateHallId(input.hallId);
    const displaySeconds =
      input.displaySeconds === undefined
        ? DEFAULT_DISPLAY_SECONDS
        : validateDisplaySeconds(input.displaySeconds);
    const displayOrder =
      input.displayOrder === undefined ? 0 : validateDisplayOrder(input.displayOrder);
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
    if (!input.createdBy?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdBy er påkrevd.");
    }

    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<ScreenSaverImageRow>(
        `INSERT INTO ${this.table()}
           (id, hall_id, image_url, display_order, display_seconds,
            is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, hall_id, image_url, display_order, display_seconds,
                   is_active, created_by, created_at, updated_at, deleted_at`,
        [id, hallId, imageUrl, displayOrder, displaySeconds, isActive, input.createdBy]
      );
      return this.map(rows[0]!);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "";
      if (/foreign key|violates foreign key/i.test(msg) && /hall/i.test(msg)) {
        throw new DomainError("HALL_NOT_FOUND", "Oppgitt hall-ID finnes ikke.");
      }
      logger.error({ err }, "[GAP #23] screen-saver insert failed");
      throw err;
    }
  }

  async update(id: string, update: UpdateScreenSaverImageInput): Promise<ScreenSaverImage> {
    const existing = await this.get(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "SCREEN_SAVER_IMAGE_DELETED",
        "Kan ikke oppdatere et slettet bilde."
      );
    }
    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.imageUrl !== undefined) {
      const validated = validateImageUrl(update.imageUrl);
      params.push(validated);
      sets.push(`image_url = $${params.length}`);
    }
    if (update.displayOrder !== undefined) {
      const validated = validateDisplayOrder(update.displayOrder);
      params.push(validated);
      sets.push(`display_order = $${params.length}`);
    }
    if (update.displaySeconds !== undefined) {
      const validated = validateDisplaySeconds(update.displaySeconds);
      params.push(validated);
      sets.push(`display_seconds = $${params.length}`);
    }
    if (update.isActive !== undefined) {
      params.push(Boolean(update.isActive));
      sets.push(`is_active = $${params.length}`);
    }

    if (!sets.length) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }
    sets.push("updated_at = now()");

    params.push(id.trim());
    const { rows } = await this.pool.query<ScreenSaverImageRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, hall_id, image_url, display_order, display_seconds,
                 is_active, created_by, created_at, updated_at, deleted_at`,
      params
    );
    return this.map(rows[0]!);
  }

  /**
   * Soft-delete: setter `deleted_at` slik at audit-historikk består.
   * Hard-delete kan gjøres via egen migration ved behov.
   */
  async remove(id: string): Promise<void> {
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.table()}
       SET deleted_at = now(), is_active = false, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id.trim()]
    );
    if (!rowCount) {
      throw new DomainError("SCREEN_SAVER_IMAGE_NOT_FOUND", "Bilde finnes ikke.");
    }
  }

  /**
   * Reorder en batch av bilder atomisk. Inputene må alle eksistere og
   * være ikke-slettet. Brukes når admin drar bilder rundt i UI-en og
   * sender ferdig sortert liste.
   *
   * Validering: alle id-er må være unike, alle display_order må være
   * gyldige (0-DISPLAY_ORDER_MAX), og alle id-er må eksistere.
   */
  async reorder(entries: ReorderEntry[]): Promise<ScreenSaverImage[]> {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen entries oppgitt.");
    }
    const seenIds = new Set<string>();
    const validated: Array<{ id: string; displayOrder: number }> = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        throw new DomainError("INVALID_INPUT", "Hver entry må være et objekt.");
      }
      if (typeof entry.id !== "string" || !entry.id.trim()) {
        throw new DomainError("INVALID_INPUT", "entry.id er påkrevd.");
      }
      const id = entry.id.trim();
      if (seenIds.has(id)) {
        throw new DomainError("INVALID_INPUT", `Duplikat id i reorder-batch: ${id}`);
      }
      seenIds.add(id);
      const displayOrder = validateDisplayOrder(entry.displayOrder);
      validated.push({ id, displayOrder });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { id, displayOrder } of validated) {
        const { rowCount } = await client.query(
          `UPDATE ${this.table()}
           SET display_order = $1, updated_at = now()
           WHERE id = $2 AND deleted_at IS NULL`,
          [displayOrder, id]
        );
        if (!rowCount) {
          throw new DomainError(
            "SCREEN_SAVER_IMAGE_NOT_FOUND",
            `Bilde finnes ikke (eller er slettet): ${id}`
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[GAP #23] reorder failed");
      throw new DomainError(
        "SCREEN_SAVER_REORDER_FAILED",
        "Kunne ikke oppdatere visningsrekkefølgen."
      );
    } finally {
      client.release();
    }
    // Returner alle påvirkede bilder i ny rekkefølge.
    const ids = validated.map((v) => v.id);
    const { rows } = await this.pool.query<ScreenSaverImageRow>(
      `SELECT id, hall_id, image_url, display_order, display_seconds,
              is_active, created_by, created_at, updated_at, deleted_at
       FROM ${this.table()}
       WHERE id = ANY($1::text[])
       ORDER BY display_order ASC, created_at ASC`,
      [ids]
    );
    return rows.map((r) => this.map(r));
  }
}
