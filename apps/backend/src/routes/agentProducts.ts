/**
 * BIN-583 B3.6: agent product-sale endpoints.
 *
 *   GET    /api/agent/products                      — listing for agentens hall
 *   POST   /api/agent/products/carts                — opprett draft cart
 *   GET    /api/agent/products/carts/:id            — hent cart
 *   POST   /api/agent/products/carts/:id/finalize   — betal + commit salg
 *   POST   /api/agent/products/carts/:id/cancel     — soft-cancel draft
 *   GET    /api/agent/products/sales/current-shift  — sales for nåværende shift
 *
 * RBAC:
 *   - PRODUCT_READ for list
 *   - AGENT_PRODUCT_SELL for cart + finalize + cancel
 *
 * Hall-scope: agentens shift.hallId bestemmer hvilke produkter som vises
 * og hvilken hall salget bokføres mot. Ingen query-param-override.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { ProductService } from "../agent/ProductService.js";
import type {
  AgentProductSaleService,
  ProductPaymentMethod,
  ProductCartUserType,
} from "../agent/AgentProductSaleService.js";
import {
  assertAdminPermission,
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

const logger = rootLogger.child({ module: "agent-products-router" });

export interface AgentProductsRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  productService: ProductService;
  productSaleService: AgentProductSaleService;
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

function parsePaymentMethod(value: unknown): ProductPaymentMethod {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "paymentMethod er påkrevd.");
  }
  const upper = value.toUpperCase() as ProductPaymentMethod;
  if (!["CASH", "CARD", "CUSTOMER_NUMBER"].includes(upper)) {
    throw new DomainError(
      "INVALID_INPUT",
      "paymentMethod må være CASH, CARD eller CUSTOMER_NUMBER."
    );
  }
  return upper;
}

function parseUserType(value: unknown): ProductCartUserType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "userType er påkrevd.");
  }
  const upper = value.toUpperCase() as ProductCartUserType;
  if (upper !== "ONLINE" && upper !== "PHYSICAL") {
    throw new DomainError("INVALID_INPUT", "userType må være ONLINE eller PHYSICAL.");
  }
  return upper;
}

export function createAgentProductsRouter(deps: AgentProductsRouterDeps): express.Router {
  const {
    platformService,
    auditLogService,
    agentService,
    agentShiftService,
    productService,
    productSaleService,
  } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
    }
    return { userId: user.id, role: user.role };
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-583 B3.6] audit append failed");
    });
  }

  // ── List products in agentens hall ──────────────────────────────────────

  router.get("/api/agent/products", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PRODUCT_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Dette endepunktet er kun for AGENT.");
      }
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift først.");
      const products = await productService.listHallProducts(shift.hallId, { activeOnly: true });
      apiSuccess(res, {
        hallId: shift.hallId,
        products: products.map((p) => p.product),
        count: products.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Cart operations ─────────────────────────────────────────────────────

  router.post("/api/agent/products/carts", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_PRODUCT_SELL");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cart-opprett kan kun utføres av AGENT.");
      }
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const userType = parseUserType(req.body.userType);
      const linesInput = Array.isArray(req.body.lines) ? (req.body.lines as unknown[]) : [];
      const lines = linesInput.map((l) => {
        if (!isRecordObject(l)) throw new DomainError("INVALID_INPUT", "Hver linje må være et objekt.");
        return {
          productId: mustBeNonEmptyString(l.productId, "productId"),
          quantity: Number(l.quantity),
        };
      });
      const cart = await productSaleService.createCart({
        agentUserId: actor.userId,
        userType,
        username: typeof req.body.username === "string" ? req.body.username : null,
        userId: typeof req.body.userId === "string" ? req.body.userId : null,
        lines,
      });
      fireAudit({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.product.cart.create",
        resource: "product_cart",
        resourceId: cart.id,
        details: {
          hallId: cart.hallId,
          shiftId: cart.shiftId,
          totalCents: cart.totalCents,
          lineCount: cart.lines.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, cart);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/agent/products/carts/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_PRODUCT_SELL");
      const cartId = mustBeNonEmptyString(req.params.id, "id");
      const cart = await productSaleService.getCart(cartId);
      if (actor.role === "AGENT" && cart.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne cart.");
      }
      apiSuccess(res, cart);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/agent/products/carts/:id/finalize", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_PRODUCT_SELL");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Finalize kan kun utføres av AGENT.");
      }
      const cartId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      const paymentMethod = parsePaymentMethod(req.body.paymentMethod);
      const expectedTotalCents = Number(req.body.expectedTotalCents);
      if (!Number.isInteger(expectedTotalCents) || expectedTotalCents < 0) {
        throw new DomainError("INVALID_INPUT", "expectedTotalCents må være ≥ 0.");
      }
      const clientRequestId = mustBeNonEmptyString(req.body.clientRequestId, "clientRequestId");
      const result = await productSaleService.finalizeSale({
        agentUserId: actor.userId,
        cartId,
        paymentMethod,
        expectedTotalCents,
        clientRequestId,
      });
      fireAudit({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.product.sale.finalize",
        resource: "product_sale",
        resourceId: result.sale.id,
        details: {
          cartId,
          orderId: result.sale.orderId,
          paymentMethod,
          totalCents: result.sale.totalCents,
          hallId: result.sale.hallId,
          shiftId: result.sale.shiftId,
          playerUserId: result.sale.playerUserId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/agent/products/carts/:id/cancel", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_PRODUCT_SELL");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cancel kan kun utføres av AGENT.");
      }
      const cartId = mustBeNonEmptyString(req.params.id, "id");
      const cart = await productSaleService.cancelCart(cartId, actor.userId);
      fireAudit({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.product.cart.cancel",
        resource: "product_cart",
        resourceId: cart.id,
        details: { orderId: cart.orderId, hallId: cart.hallId, shiftId: cart.shiftId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, cart);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/agent/products/sales/current-shift", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_PRODUCT_SELL");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Shift-sales er kun for AGENT.");
      }
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) {
        apiSuccess(res, { shiftId: null, sales: [], count: 0 });
        return;
      }
      const sales = await productSaleService.listSalesForShift(shift.id);
      apiSuccess(res, { shiftId: shift.id, sales, count: sales.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
