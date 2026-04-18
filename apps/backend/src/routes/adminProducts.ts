/**
 * BIN-583 B3.6: admin product-catalog + hall-assignment.
 *
 * Endepunkter:
 *   GET    /api/admin/product-categories                       (PRODUCT_READ)
 *   POST   /api/admin/product-categories                       (PRODUCT_WRITE)
 *   PUT    /api/admin/product-categories/:id                   (PRODUCT_WRITE)
 *   DELETE /api/admin/product-categories/:id                   (PRODUCT_WRITE)
 *   GET    /api/admin/products                                 (PRODUCT_READ)
 *   POST   /api/admin/products                                 (PRODUCT_WRITE)
 *   GET    /api/admin/products/:id                             (PRODUCT_READ)
 *   PUT    /api/admin/products/:id                             (PRODUCT_WRITE)
 *   DELETE /api/admin/products/:id                             (PRODUCT_WRITE)
 *   GET    /api/admin/halls/:hallId/products                   (PRODUCT_READ)
 *   PUT    /api/admin/halls/:hallId/products                   (PRODUCT_WRITE)
 *
 * Hall-scope: HALL_OPERATOR kan bare se/modifisere egen hall.
 * Katalog (products + categories) er sentralt — ADMIN-only for skrive,
 * men HALL_OPERATOR + SUPPORT kan lese (for å bygge hall-bindings).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { ProductService } from "../agent/ProductService.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-products" });

export interface AdminProductsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  productService: ProductService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function actorTypeFromRole(role: PublicAppUser["role"]): "ADMIN" | "SUPPORT" | "HALL_OPERATOR" | "USER" {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SUPPORT") return "SUPPORT";
  if (role === "HALL_OPERATOR") return "HALL_OPERATOR";
  return "USER";
}

export function createAdminProductsRouter(deps: AdminProductsRouterDeps): express.Router {
  const { platformService, auditLogService, productService } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-583 B3.6] audit append failed");
    });
  }

  // ── Categories ──────────────────────────────────────────────────────────

  router.get("/api/admin/product-categories", async (req, res) => {
    try {
      await requirePermission(req, "PRODUCT_READ");
      const includeInactive =
        typeof req.query.includeInactive === "string" &&
        ["1", "true", "yes"].includes(req.query.includeInactive.toLowerCase());
      const categories = await productService.listCategories({ includeInactive });
      apiSuccess(res, { categories, count: categories.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/product-categories", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const category = await productService.createCategory({
        name: mustBeNonEmptyString(req.body.name, "name"),
        sortOrder: typeof req.body.sortOrder === "number" ? req.body.sortOrder : undefined,
        isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.category.create",
        resource: "product_category",
        resourceId: category.id,
        details: { name: category.name },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, category);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/product-categories/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const category = await productService.updateCategory(id, {
        name: typeof req.body.name === "string" ? req.body.name : undefined,
        sortOrder: typeof req.body.sortOrder === "number" ? req.body.sortOrder : undefined,
        isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.category.update",
        resource: "product_category",
        resourceId: category.id,
        details: { changed: Object.keys(req.body) },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, category);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/product-categories/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await productService.softDeleteCategory(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.category.soft_delete",
        resource: "product_category",
        resourceId: id,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Products ────────────────────────────────────────────────────────────

  router.get("/api/admin/products", async (req, res) => {
    try {
      await requirePermission(req, "PRODUCT_READ");
      const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() || undefined : undefined;
      const statusRaw = typeof req.query.status === "string" ? req.query.status.trim() : undefined;
      const status = statusRaw === "ACTIVE" || statusRaw === "INACTIVE" ? statusRaw : undefined;
      const products = await productService.listProducts({ categoryId, status });
      apiSuccess(res, { products, count: products.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/products", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const product = await productService.createProduct({
        name: mustBeNonEmptyString(req.body.name, "name"),
        priceCents: Number(req.body.priceCents),
        categoryId: typeof req.body.categoryId === "string" ? req.body.categoryId : undefined,
        description: typeof req.body.description === "string" ? req.body.description : undefined,
        status: req.body.status === "ACTIVE" || req.body.status === "INACTIVE" ? req.body.status : undefined,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.create",
        resource: "product",
        resourceId: product.id,
        details: { name: product.name, priceCents: product.priceCents },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, product);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/products/:id", async (req, res) => {
    try {
      await requirePermission(req, "PRODUCT_READ");
      const id = mustBeNonEmptyString(req.params.id, "id");
      const product = await productService.getProduct(id);
      apiSuccess(res, product);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/products/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const input: Parameters<ProductService["updateProduct"]>[1] = {};
      if (typeof req.body.name === "string") input.name = req.body.name;
      if (typeof req.body.priceCents === "number") input.priceCents = req.body.priceCents;
      if (req.body.categoryId !== undefined) {
        input.categoryId = typeof req.body.categoryId === "string" ? req.body.categoryId : null;
      }
      if (req.body.description !== undefined) {
        input.description = typeof req.body.description === "string" ? req.body.description : null;
      }
      if (req.body.status === "ACTIVE" || req.body.status === "INACTIVE") input.status = req.body.status;
      const product = await productService.updateProduct(id, input);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.update",
        resource: "product",
        resourceId: product.id,
        details: { changed: Object.keys(input) },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, product);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/products/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      await productService.softDeleteProduct(id);
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.product.soft_delete",
        resource: "product",
        resourceId: id,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Hall assignment ─────────────────────────────────────────────────────

  router.get("/api/admin/halls/:hallId/products", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_READ");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      const activeOnly =
        typeof req.query.activeOnly !== "string" ||
        ["1", "true", "yes"].includes(req.query.activeOnly.toLowerCase());
      const rows = await productService.listHallProducts(hallId, { activeOnly });
      apiSuccess(res, { hallId, products: rows, count: rows.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/halls/:hallId/products", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_WRITE");
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      assertUserHallScope(actor, hallId);
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const productIds = Array.isArray(req.body.productIds) ? (req.body.productIds as unknown[]) : [];
      const clean = productIds.filter((p): p is string => typeof p === "string");
      const result = await productService.setHallProducts({
        hallId,
        productIds: clean,
        actorUserId: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actorTypeFromRole(actor.role),
        action: "admin.hall.products.update",
        resource: "hall",
        resourceId: hallId,
        details: { hallId, ...result },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { hallId, ...result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
