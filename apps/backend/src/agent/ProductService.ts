/**
 * BIN-583 B3.6: produkt-katalog + hall-assignment.
 *
 * Port of legacy `productManagement.js` (kategorier + produkter + hall-
 * bindings). Tre discrete modeller:
 *
 *   app_product_categories — flat kategoritre
 *   app_products           — global katalog (ADMIN eier, HALL_OPERATOR
 *                            ser for å binde til egen hall)
 *   app_hall_products      — hall → produkt-binding (hall-operatør styrer
 *                            hvilke produkter som er aktive i egen hall)
 *
 * Pricing: `product.price_cents` er sentralt. Hall kan ikke overstyre
 * pris — forenkler rapportering, matcher legacy-konvensjonen.
 *
 * Soft-delete: både kategorier og produkter bruker `deleted_at`
 * TIMESTAMPTZ NULL. Sletting frigjør hall-bindings via CASCADE.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "product-service" });

export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface ProductCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  categoryId: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HallProduct {
  hallId: string;
  productId: string;
  isActive: boolean;
  addedAt: string;
  addedBy: string | null;
}

export interface ProductServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
}

interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: string | number;
  category_id: string | null;
  status: ProductStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface HallProductRow {
  hall_id: string;
  product_id: string;
  is_active: boolean;
  added_at: Date | string;
  added_by: string | null;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmptyString(value: unknown, field: string, maxLen = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new DomainError("INVALID_INPUT", `${field} er for lang (maks ${maxLen} tegn).`);
  }
  return trimmed;
}

function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

function assertProductStatus(value: unknown): ProductStatus {
  if (value === "ACTIVE" || value === "INACTIVE") return value;
  throw new DomainError("INVALID_INPUT", "status må være ACTIVE eller INACTIVE.");
}

export class ProductService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: ProductServiceOptions) {
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
        "ProductService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): ProductService {
    const svc = Object.create(ProductService.prototype) as ProductService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    return svc;
  }

  private categoriesTable(): string { return `"${this.schema}"."app_product_categories"`; }
  private productsTable(): string { return `"${this.schema}"."app_products"`; }
  private hallProductsTable(): string { return `"${this.schema}"."app_hall_products"`; }

  // ── Categories ──────────────────────────────────────────────────────────

  async listCategories(opts: { includeInactive?: boolean } = {}): Promise<ProductCategory[]> {
    const where = opts.includeInactive
      ? "WHERE deleted_at IS NULL"
      : "WHERE deleted_at IS NULL AND is_active = TRUE";
    const { rows } = await this.pool.query<CategoryRow>(
      `SELECT id, name, sort_order, is_active, created_at, updated_at
       FROM ${this.categoriesTable()}
       ${where}
       ORDER BY sort_order ASC, name ASC`
    );
    return rows.map((r) => this.mapCategory(r));
  }

  async createCategory(input: { name: string; sortOrder?: number; isActive?: boolean }): Promise<ProductCategory> {
    const name = assertNonEmptyString(input.name, "name");
    const sortOrder = input.sortOrder !== undefined ? assertNonNegativeInt(input.sortOrder, "sortOrder") : 0;
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
    const id = randomUUID();
    const { rows } = await this.pool.query<CategoryRow>(
      `INSERT INTO ${this.categoriesTable()} (id, name, sort_order, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, sort_order, is_active, created_at, updated_at`,
      [id, name, sortOrder, isActive]
    );
    return this.mapCategory(rows[0]);
  }

  async updateCategory(id: string, input: { name?: string; sortOrder?: number; isActive?: boolean }): Promise<ProductCategory> {
    assertNonEmptyString(id, "id");
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      params.push(assertNonEmptyString(input.name, "name"));
      sets.push(`name = $${params.length}`);
    }
    if (input.sortOrder !== undefined) {
      params.push(assertNonNegativeInt(input.sortOrder, "sortOrder"));
      sets.push(`sort_order = $${params.length}`);
    }
    if (input.isActive !== undefined) {
      params.push(Boolean(input.isActive));
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) {
      throw new DomainError("INVALID_INPUT", "Ingen felter å oppdatere.");
    }
    sets.push("updated_at = NOW()");
    params.push(id);
    const { rows } = await this.pool.query<CategoryRow>(
      `UPDATE ${this.categoriesTable()} SET ${sets.join(", ")}
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING id, name, sort_order, is_active, created_at, updated_at`,
      params
    );
    if (!rows[0]) throw new DomainError("NOT_FOUND", "Kategori ikke funnet.");
    return this.mapCategory(rows[0]);
  }

  async softDeleteCategory(id: string): Promise<void> {
    assertNonEmptyString(id, "id");
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.categoriesTable()} SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) throw new DomainError("NOT_FOUND", "Kategori ikke funnet.");
  }

  // ── Products ─────────────────────────────────────────────────────────────

  async listProducts(filter: { categoryId?: string; status?: ProductStatus; includeDeleted?: boolean } = {}): Promise<Product[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) conditions.push("deleted_at IS NULL");
    if (filter.categoryId) {
      params.push(filter.categoryId);
      conditions.push(`category_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(assertProductStatus(filter.status));
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query<ProductRow>(
      `SELECT id, name, description, price_cents, category_id, status, created_at, updated_at
       FROM ${this.productsTable()}
       ${where}
       ORDER BY name ASC`,
      params
    );
    return rows.map((r) => this.mapProduct(r));
  }

  async getProduct(id: string): Promise<Product> {
    assertNonEmptyString(id, "id");
    const { rows } = await this.pool.query<ProductRow>(
      `SELECT id, name, description, price_cents, category_id, status, created_at, updated_at
       FROM ${this.productsTable()} WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rows[0]) throw new DomainError("NOT_FOUND", "Produkt ikke funnet.");
    return this.mapProduct(rows[0]);
  }

  async createProduct(input: {
    name: string;
    priceCents: number;
    categoryId?: string | null;
    description?: string | null;
    status?: ProductStatus;
  }): Promise<Product> {
    const name = assertNonEmptyString(input.name, "name");
    const priceCents = assertNonNegativeInt(input.priceCents, "priceCents");
    const categoryId = input.categoryId?.trim() || null;
    const description = input.description?.trim() || null;
    const status = input.status ? assertProductStatus(input.status) : "ACTIVE";

    if (categoryId) {
      const { rows: catRows } = await this.pool.query(
        `SELECT 1 FROM ${this.categoriesTable()} WHERE id = $1 AND deleted_at IS NULL`,
        [categoryId]
      );
      if (!catRows.length) throw new DomainError("INVALID_INPUT", "Kategori finnes ikke.");
    }

    const id = randomUUID();
    const { rows } = await this.pool.query<ProductRow>(
      `INSERT INTO ${this.productsTable()} (id, name, description, price_cents, category_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, price_cents, category_id, status, created_at, updated_at`,
      [id, name, description, priceCents, categoryId, status]
    );
    return this.mapProduct(rows[0]);
  }

  async updateProduct(id: string, input: {
    name?: string;
    priceCents?: number;
    categoryId?: string | null;
    description?: string | null;
    status?: ProductStatus;
  }): Promise<Product> {
    assertNonEmptyString(id, "id");
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      params.push(assertNonEmptyString(input.name, "name"));
      sets.push(`name = $${params.length}`);
    }
    if (input.priceCents !== undefined) {
      params.push(assertNonNegativeInt(input.priceCents, "priceCents"));
      sets.push(`price_cents = $${params.length}`);
    }
    if (input.categoryId !== undefined) {
      params.push(input.categoryId?.trim() || null);
      sets.push(`category_id = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description?.trim() || null);
      sets.push(`description = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(assertProductStatus(input.status));
      sets.push(`status = $${params.length}`);
    }
    if (!sets.length) throw new DomainError("INVALID_INPUT", "Ingen felter å oppdatere.");
    sets.push("updated_at = NOW()");
    params.push(id);
    const { rows } = await this.pool.query<ProductRow>(
      `UPDATE ${this.productsTable()} SET ${sets.join(", ")}
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING id, name, description, price_cents, category_id, status, created_at, updated_at`,
      params
    );
    if (!rows[0]) throw new DomainError("NOT_FOUND", "Produkt ikke funnet.");
    return this.mapProduct(rows[0]);
  }

  async softDeleteProduct(id: string): Promise<void> {
    assertNonEmptyString(id, "id");
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.productsTable()} SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) throw new DomainError("NOT_FOUND", "Produkt ikke funnet.");
  }

  // ── Hall bindings ────────────────────────────────────────────────────────

  async listHallProducts(hallId: string, opts: { activeOnly?: boolean } = {}): Promise<Array<HallProduct & { product: Product }>> {
    assertNonEmptyString(hallId, "hallId");
    const activeClause = opts.activeOnly === false ? "" : "AND hp.is_active = TRUE AND p.status = 'ACTIVE'";
    const { rows } = await this.pool.query<HallProductRow & ProductRow>(
      `SELECT hp.hall_id, hp.product_id, hp.is_active, hp.added_at, hp.added_by,
              p.id, p.name, p.description, p.price_cents, p.category_id, p.status,
              p.created_at, p.updated_at
       FROM ${this.hallProductsTable()} hp
       JOIN ${this.productsTable()} p ON p.id = hp.product_id
       WHERE hp.hall_id = $1 AND p.deleted_at IS NULL ${activeClause}
       ORDER BY p.name ASC`,
      [hallId]
    );
    return rows.map((r) => ({
      hallId: r.hall_id,
      productId: r.product_id,
      isActive: r.is_active,
      addedAt: asIso(r.added_at),
      addedBy: r.added_by,
      product: this.mapProduct(r),
    }));
  }

  /**
   * Replace hall → product bindings atomically. Inputs som ikke finnes
   * i lista deaktiveres (is_active=FALSE, ikke slettet — historikk).
   */
  async setHallProducts(input: {
    hallId: string;
    productIds: string[];
    actorUserId: string;
  }): Promise<{ added: number; removed: number; active: number }> {
    const hallId = assertNonEmptyString(input.hallId, "hallId");
    const actorUserId = assertNonEmptyString(input.actorUserId, "actorUserId");
    if (!Array.isArray(input.productIds)) {
      throw new DomainError("INVALID_INPUT", "productIds må være en array.");
    }
    const unique = Array.from(new Set(input.productIds.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim())));
    if (unique.length > 500) {
      throw new DomainError("INVALID_INPUT", "Maks 500 produkter per hall.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Verifiser at alle produktene finnes og ikke er slettet.
      if (unique.length) {
        const { rows } = await client.query(
          `SELECT id FROM ${this.productsTable()} WHERE id = ANY($1) AND deleted_at IS NULL`,
          [unique]
        );
        if (rows.length !== unique.length) {
          throw new DomainError("INVALID_INPUT", "Ett eller flere produkter finnes ikke.");
        }
      }
      // Deaktiver alle nåværende bindings for hallen først.
      const { rowCount: removedCount } = await client.query(
        `UPDATE ${this.hallProductsTable()} SET is_active = FALSE
         WHERE hall_id = $1 AND is_active = TRUE AND NOT (product_id = ANY($2))`,
        [hallId, unique]
      );
      // Oppsert de nye bindings (re-aktiver hvis de fantes fra før).
      let addedCount = 0;
      for (const productId of unique) {
        const { rowCount } = await client.query(
          `INSERT INTO ${this.hallProductsTable()} (hall_id, product_id, is_active, added_by)
           VALUES ($1, $2, TRUE, $3)
           ON CONFLICT (hall_id, product_id)
           DO UPDATE SET is_active = TRUE, added_at = NOW(), added_by = $3
           WHERE ${this.hallProductsTable()}.is_active = FALSE`,
          [hallId, productId, actorUserId]
        );
        if (rowCount) addedCount += 1;
      }
      await client.query("COMMIT");
      return {
        added: addedCount,
        removed: removedCount ?? 0,
        active: unique.length,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err, hallId }, "[BIN-583 B3.6] setHallProducts failed");
      throw new DomainError("PRODUCT_HALL_UPDATE_FAILED", "Kunne ikke oppdatere hall-produkter.");
    } finally {
      client.release();
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private mapCategory(row: CategoryRow): ProductCategory {
    return {
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order),
      isActive: row.is_active,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  private mapProduct(row: ProductRow): Product {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priceCents: Number(row.price_cents),
      categoryId: row.category_id,
      status: row.status,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }
}
