/**
 * PDF 17 §17.29 + §17.30 + §17.31 + §17.32 — Agent history-list endpoints.
 *
 * Wireframe-mapping:
 *   - PDF 17 §17.29  GET  /api/agent/orders/history       — Order History (product sales)
 *   - PDF 17 §17.30  GET  /api/agent/orders/:id           — View Order Details
 *   - PDF 17 §17.31  GET  /api/agent/sold-tickets         — Sold Tickets list
 *   - PDF 17 §17.32  GET  /api/agent/winnings-history     — Past Game Winning History
 *                    (alias / spec-naming. Eksisterende canonical-rute er
 *                     /api/agent/reports/past-winning-history.)
 *
 * RBAC (felles for alle 4 endepunkter):
 *   - AGENT          → må ha aktiv shift; hall-scope = shift.hallId; egen agentUserId.
 *   - HALL_OPERATOR  → hall-scope = user.hallId; ser alle agenters salg/bonger i hallen.
 *   - ADMIN          → globalt scope; kan filtrere på vilkårlig hallId.
 *   - PLAYER/AGENT_INACTIVE → FORBIDDEN.
 *
 * Read-only endpoints. Ingen audit-log siden hverken cart-/sale-snapshot eller
 * static-ticket-listinger inneholder PII utover hva agenten allerede ser.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type {
  AgentProductSaleService,
  ProductPaymentMethod,
} from "../agent/AgentProductSaleService.js";
import type { StaticTicketService } from "../compliance/StaticTicketService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import {
  buildPastWinningHistory,
  type PastWinningSourceTicket,
} from "../agent/reports/PastWinningHistoryReport.js";

export interface AgentHistoryListsRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  productSaleService: AgentProductSaleService;
  staticTicketService: StaticTicketService;
}

interface ResolvedActor {
  user: PublicAppUser;
  /** null = ADMIN (globalt). Ellers påkrevd hall. */
  hallId: string | null;
  role: UserRole;
}

const VALID_PAYMENT_METHODS: readonly ProductPaymentMethod[] = [
  "CASH",
  "CARD",
  "CUSTOMER_NUMBER",
] as const;

function parseIsoOrDefault(value: unknown, fieldName: string, fallback: Date): string {
  if (value === undefined || value === null || value === "") {
    return fallback.toISOString();
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dayStart = new Date(`${trimmed}T00:00:00.000Z`);
    const dayEnd = new Date(`${trimmed}T23:59:59.999Z`);
    if (fieldName === "from") return dayStart.toISOString();
    if (fieldName === "to") return dayEnd.toISOString();
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  return new Date(ms).toISOString();
}

function parseOptionalPositiveInt(
  value: unknown,
  field: string,
  max = 500,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et positivt heltall.`);
  }
  return Math.min(n, max);
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalPaymentMethod(value: unknown): ProductPaymentMethod | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  if (!upper) return undefined;
  if (!(VALID_PAYMENT_METHODS as readonly string[]).includes(upper)) {
    throw new DomainError(
      "INVALID_INPUT",
      "paymentMethod må være CASH, CARD eller CUSTOMER_NUMBER.",
    );
  }
  return upper as ProductPaymentMethod;
}

/**
 * Mapper UI-terminologi (Cash/Card/Customer Number) til
 * `ProductPaymentMethod`. Tolererer både norsk (Kontant/Kort)
 * og engelsk (Cash/Card) input.
 */
function parsePaymentTypeAlias(value: unknown): ProductPaymentMethod | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  switch (upper) {
    case "":
      return undefined;
    case "CASH":
    case "KONTANT":
      return "CASH";
    case "CARD":
    case "KORT":
      return "CARD";
    case "CUSTOMER_NUMBER":
    case "CUSTOMERNUMBER":
    case "CUSTOMER NUMBER":
    case "WALLET":
    case "BINGOKONTO":
      return "CUSTOMER_NUMBER";
    default:
      throw new DomainError(
        "INVALID_INPUT",
        "paymentType må være Cash, Card eller Customer Number.",
      );
  }
}

export function createAgentHistoryListsRouter(
  deps: AgentHistoryListsRouterDeps,
): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    productSaleService,
    staticTicketService,
  } = deps;
  const router = express.Router();

  /**
   * Felles RBAC-resolver for alle endepunktene i denne ruteren.
   */
  async function resolveActor(req: express.Request): Promise<ResolvedActor> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
      const shift = await agentShiftService.getCurrentShift(user.id);
      if (!shift) {
        throw new DomainError(
          "SHIFT_NOT_ACTIVE",
          "Du må starte en shift før du kan hente historikk.",
        );
      }
      return { user, hallId: shift.hallId, role: "AGENT" };
    }
    if (user.role === "HALL_OPERATOR") {
      if (!user.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Din bruker er ikke tildelt en hall — kontakt admin.",
        );
      }
      return { user, hallId: user.hallId, role: "HALL_OPERATOR" };
    }
    if (user.role === "ADMIN") {
      return { user, hallId: null, role: "ADMIN" };
    }
    throw new DomainError(
      "FORBIDDEN",
      "Kun AGENT, HALL_OPERATOR og ADMIN har tilgang til agent-historikk.",
    );
  }

  /**
   * Resolverer hall-scope basert på actor + (valgfri) explicit hallId.
   * Agent og hall-operator kan ikke overstyre til annen hall — kaster FORBIDDEN.
   * Returnerer hallId (kan være undefined for ADMIN uten filter).
   */
  function resolveHallScope(
    actor: ResolvedActor,
    explicitHallId: string | undefined,
  ): string | undefined {
    if (actor.hallId !== null) {
      if (explicitHallId && explicitHallId !== actor.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Du har ikke tilgang til denne hallen.",
        );
      }
      return actor.hallId;
    }
    return explicitHallId;
  }

  // ── PDF 17 §17.29 — Order History (product sales) ──────────────────────
  router.get("/api/agent/orders/history", async (req, res) => {
    try {
      const actor = await resolveActor(req);

      // Default-vindu: 7 dager bak (samme som past-winning).
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const explicitHallId = optionalNonEmpty(req.query.hallId);
      const hallId = resolveHallScope(actor, explicitHallId);

      // PDF 17 §17.29 har en `paymentType`-dropdown — UI-aliaset.
      // For bakoverkompatibilitet aksepterer vi også canonical `paymentMethod`.
      const paymentMethod =
        parseOptionalPaymentMethod(req.query.paymentMethod) ??
        parsePaymentTypeAlias(req.query.paymentType);

      const orderIdPrefix = optionalNonEmpty(req.query.search) ??
        optionalNonEmpty(req.query.orderId);

      // AGENT ser kun egne salg. HALL_OPERATOR/ADMIN kan se alle, men kan
      // valgfritt filtrere på agentUserId.
      let agentUserId: string | undefined;
      if (actor.role === "AGENT") {
        agentUserId = actor.user.id;
      } else {
        agentUserId = optionalNonEmpty(req.query.agentUserId);
      }

      const offset = parseOptionalPositiveInt(req.query.offset, "offset", 100_000) ?? 0;
      const limit = parseOptionalPositiveInt(req.query.limit, "limit", 500) ?? 100;

      const result = await productSaleService.listSalesForAgent({
        hallId,
        agentUserId,
        from,
        to,
        paymentMethod,
        orderIdPrefix,
        offset,
        limit,
      });

      apiSuccess(res, {
        sales: result.sales,
        total: result.total,
        from,
        to,
        hallId: hallId ?? null,
        offset,
        limit,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PDF 17 §17.30 — View Order Details ────────────────────────────────
  router.get("/api/agent/orders/:id", async (req, res) => {
    try {
      const actor = await resolveActor(req);
      const saleId = mustBeNonEmptyString(req.params.id, "id");

      const data = await productSaleService.getSaleWithLines(saleId);
      if (!data) {
        throw new DomainError("NOT_FOUND", "Order finnes ikke.");
      }

      // Hall-scope: AGENT/HALL_OPERATOR må matche, ellers FORBIDDEN.
      if (actor.hallId !== null && data.sale.hallId !== actor.hallId) {
        throw new DomainError(
          "FORBIDDEN",
          "Du har ikke tilgang til denne orderen.",
        );
      }
      // AGENT ser kun egne salg.
      if (actor.role === "AGENT" && data.sale.agentUserId !== actor.user.id) {
        throw new DomainError(
          "FORBIDDEN",
          "Du har kun tilgang til dine egne salg.",
        );
      }

      apiSuccess(res, data);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PDF 17 §17.32 (alias) — Past Game Winning History ─────────────────
  // Spec ber om `/api/agent/winnings-history`. Implementasjon er identisk
  // med eksisterende `/api/agent/reports/past-winning-history` (BIN-17.32).
  router.get("/api/agent/winnings-history", async (req, res) => {
    try {
      const actor = await resolveActor(req);

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const explicitHallId = optionalNonEmpty(req.query.hallId);
      const hallId = resolveHallScope(actor, explicitHallId);

      const ticketIdFilter =
        optionalNonEmpty(req.query.ticketId) ?? optionalNonEmpty(req.query.search);
      const offset = parseOptionalPositiveInt(req.query.offset, "offset", 100_000) ?? 0;
      const limit = parseOptionalPositiveInt(req.query.limit, "limit", 500) ?? 100;

      const tickets = await staticTicketService.listPaidOutInRange({
        hallId,
        from,
        to,
        ticketIdPrefix: ticketIdFilter,
      });

      const sources: PastWinningSourceTicket[] = tickets
        .filter((t) => t.paidOutAt !== null)
        .map((t) => ({
          ticketId: t.ticketSerial,
          ticketType: t.ticketType,
          ticketColor: t.ticketColor,
          priceCents: t.paidOutAmountCents,
          paidOutAt: t.paidOutAt as string,
          winningPattern: null,
          hallId: t.hallId,
        }));

      const result = buildPastWinningHistory({
        tickets: sources,
        from,
        to,
        ticketId: ticketIdFilter,
        offset,
        limit,
      });

      apiSuccess(res, {
        ...result,
        hallId: hallId ?? null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PDF 17 §17.31 — Sold Ticket UI ─────────────────────────────────────
  router.get("/api/agent/sold-tickets", async (req, res) => {
    try {
      const actor = await resolveActor(req);

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = parseIsoOrDefault(req.query.from, "from", defaultFrom);
      const to = parseIsoOrDefault(req.query.to, "to", now);
      if (Date.parse(from) > Date.parse(to)) {
        throw new DomainError("INVALID_INPUT", "'from' må være <= 'to'.");
      }

      const explicitHallId = optionalNonEmpty(req.query.hallId);
      const hallId = resolveHallScope(actor, explicitHallId);

      const ticketIdFilter =
        optionalNonEmpty(req.query.ticketId) ?? optionalNonEmpty(req.query.search);

      // PDF 17 §17.31 har dropdown med Physical/Terminal/Web. Per dato støtter
      // backend kun "physical" (StaticTicketService). Andre verdier blir
      // 200 OK med tom liste (UI kan vise filtrert "ingen treff" — bedre UX
      // enn å tvinge agent til å rydde dropdown).
      const typeFilter = (optionalNonEmpty(req.query.type) ?? "physical").toLowerCase();
      if (!["physical", "terminal", "web", "all", ""].includes(typeFilter)) {
        throw new DomainError(
          "INVALID_INPUT",
          "type må være physical, terminal, web eller all.",
        );
      }

      const offset = parseOptionalPositiveInt(req.query.offset, "offset", 100_000) ?? 0;
      const limit = parseOptionalPositiveInt(req.query.limit, "limit", 500) ?? 100;

      let rows: Array<{
        dateTime: string;
        ticketId: string;
        ticketType: string;
        ticketColor: string;
        priceCents: number | null;
        winningPattern: string | null;
        soldType: "physical";
        hallId: string;
      }> = [];

      if (typeFilter === "physical" || typeFilter === "all" || typeFilter === "") {
        const tickets = await staticTicketService.listSoldInRange({
          hallId,
          from,
          to,
          ticketIdPrefix: ticketIdFilter,
        });
        rows = tickets
          .filter((t) => t.purchasedAt !== null)
          .map((t) => ({
            dateTime: t.purchasedAt as string,
            ticketId: t.ticketSerial,
            ticketType: t.ticketType,
            ticketColor: t.ticketColor,
            // priceCents her speiler eventuelt utbetalt beløp — selve sale-
            // prisen er ikke lagret på static-ticket-raden i dagens skjema.
            // Vises som null hvis ikke utbetalt.
            priceCents: t.paidOutAmountCents,
            // winningPattern er ikke i static-skjemaet; UI viser "—".
            winningPattern: null,
            soldType: "physical" as const,
            hallId: t.hallId,
          }));
      }
      // For "terminal"/"web" returnerer vi tom array (gap dokumentert i kommentar).

      const total = rows.length;
      const pageRows = rows.slice(offset, offset + limit);

      apiSuccess(res, {
        rows: pageRows,
        total,
        from,
        to,
        hallId: hallId ?? null,
        offset,
        limit,
        type: typeFilter,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
