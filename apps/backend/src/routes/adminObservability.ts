/**
 * Admin observability — error-rates + registry endpoints (Fase 2A — 2026-05-05).
 *
 * Endepunkter:
 *
 *   GET /api/admin/observability/error-rates?includeZero=false
 *     Returnerer error-rate-snapshot for alle codes som har sett events
 *     (default), eller alle registry-codes når includeZero=true. Brukes av
 *     dashboards til å rendre rate-tabell + alert-trigger-tester.
 *
 *   GET /api/admin/observability/error-codes
 *     Returnerer full registry med metadata (tittel, severity, kategori,
 *     runbook). Brukes av on-call-UI for å slå opp en kode rapportert i
 *     en alert.
 *
 * Sikkerhetsmodell:
 *   - Bearer-auth påkrevd (intern admin-route — IKKE offentlig).
 *   - Permission: ADMIN_PANEL_ACCESS — alle interne roller får lese.
 *     Counter-data er ikke regulatorisk-sensitivt (ingen PII), men det
 *     viser potensielle internal vulnerabilities så vi gater det bak admin-
 *     panel uansett.
 *
 * Cache:
 *   - Ingen caching — counter-state kan endre seg per millisekund og
 *     dashboard polling-loop bør se ferskeste tall.
 */

import express from "express";
import {
  ERROR_CODES,
  listErrorCodes,
  type ErrorCode,
  type ErrorCodeMetadata,
} from "../observability/errorCodes.js";
import {
  getErrorRates,
  type ErrorRateSnapshot,
} from "../observability/errorMetrics.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";

export interface AdminObservabilityRouterDeps {
  platformService: PlatformService;
  /**
   * Permission required to read error-rates. Default ADMIN_PANEL_ACCESS —
   * exposeable for at HALL_OPERATOR-tilgang skal kunne strammes av miljø-
   * konfig hvis en hall ikke skal se internal observability.
   */
  permission?: AdminPermission;
}

// ── Wire-types ──────────────────────────────────────────────────────────────

export interface AdminErrorRatesResponse {
  /** Snapshot-timestamp (ISO-8601). */
  generatedAt: string;
  /** Antall codes returnert. */
  count: number;
  /** Per-code rate-snapshot, sortert lifetime desc, så code asc. */
  rates: Array<{
    code: string;
    lifetime: number;
    perMinute: number;
    /** ISO-8601 eller null. */
    lastSeenAt: string | null;
    severity: string;
    category: string;
  }>;
}

export interface AdminErrorCodesResponse {
  /** Antall codes i registry. */
  count: number;
  /** Per-code metadata. */
  codes: Array<{
    code: ErrorCode;
    title: string;
    severity: string;
    category: string;
    retryable: boolean;
    alertRule: string;
    runbook: string;
    introduced: string;
    deprecated?: boolean;
  }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function snapshotToWire(snap: ErrorRateSnapshot): AdminErrorRatesResponse["rates"][number] {
  return {
    code: snap.code,
    lifetime: snap.lifetime,
    perMinute: snap.perMinute,
    lastSeenAt: snap.lastSeenAt ? snap.lastSeenAt.toISOString() : null,
    severity: snap.severity,
    category: snap.category,
  };
}

function metadataToWire(
  code: ErrorCode,
  meta: ErrorCodeMetadata,
): AdminErrorCodesResponse["codes"][number] {
  return {
    code,
    title: meta.title,
    severity: meta.severity,
    category: meta.category,
    retryable: meta.retryable,
    alertRule: meta.alertRule,
    runbook: meta.runbook,
    introduced: meta.introduced,
    ...(meta.deprecated ? { deprecated: meta.deprecated } : {}),
  };
}

function parseIncludeZero(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

// ── Router factory ──────────────────────────────────────────────────────────

export function createAdminObservabilityRouter(
  deps: AdminObservabilityRouterDeps,
): express.Router {
  const router = express.Router();
  const permission: AdminPermission = deps.permission ?? "ADMIN_PANEL_ACCESS";

  async function requireAdmin(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await deps.platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission, "Ikke tilgang til observability.");
    return user;
  }

  /**
   * GET /api/admin/observability/error-rates
   *
   * Default returnerer kun codes som har sett events (lifetime > 0). Pass
   * `?includeZero=true` for å få med alle registry-codes (nyttig for full
   * dashboard-grid).
   */
  router.get("/api/admin/observability/error-rates", async (req, res) => {
    try {
      await requireAdmin(req);
      const includeZero = parseIncludeZero(req.query["includeZero"]);
      const rates = getErrorRates(includeZero).map(snapshotToWire);
      const payload: AdminErrorRatesResponse = {
        generatedAt: new Date().toISOString(),
        count: rates.length,
        rates,
      };
      apiSuccess(res, payload);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  /**
   * GET /api/admin/observability/error-codes
   *
   * Returnerer full registry. Brukes av on-call UI — typisk når en alert
   * peker på "BIN-RKT-002" og vakthavende skal slå opp severity, runbook,
   * og introduced-PR.
   */
  router.get("/api/admin/observability/error-codes", async (req, res) => {
    try {
      await requireAdmin(req);
      const list = listErrorCodes();
      const payload: AdminErrorCodesResponse = {
        count: list.length,
        codes: list.map(({ code, meta }) => metadataToWire(code, meta)),
      };
      apiSuccess(res, payload);
    } catch (err) {
      apiFailure(res, err);
    }
  });

  /**
   * GET /api/admin/observability/error-codes/:code
   *
   * Returnerer metadata for én spesifikk code. 404 hvis ukjent. Brukes av
   * runbook-app for direkte-link til en error-codes side.
   */
  router.get("/api/admin/observability/error-codes/:code", async (req, res) => {
    try {
      await requireAdmin(req);
      const codeParam = String(req.params["code"] ?? "").trim();
      if (!codeParam) {
        return apiFailure(
          res,
          new Error("INVALID_INPUT: code-param er påkrevd."),
        );
      }
      const meta = (ERROR_CODES as Record<string, ErrorCodeMetadata>)[codeParam];
      if (!meta) {
        res.status(404).json({
          ok: false,
          error: { code: "ERROR_CODE_NOT_FOUND", message: `Ukjent error-code: ${codeParam}` },
        });
        return;
      }
      apiSuccess(res, metadataToWire(codeParam as ErrorCode, meta));
    } catch (err) {
      apiFailure(res, err);
    }
  });

  return router;
}
