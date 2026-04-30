/**
 * BIN-791: Public Status Page — HTTP endpoints (no auth required).
 *
 * Eksponerer offentlige read-endpoints som status-siden konsumerer:
 *
 *   GET /api/status            → komponent-snapshot (cachet 30s)
 *   GET /api/status/uptime     → 24t per-komponent uptime-bøtter
 *   GET /api/status/incidents  → aktive + nylige incidents
 *
 * Sikkerhetsmodell:
 *   - INGEN auth — status-siden er offentlig.
 *   - Lese-only (klienten kan ikke endre status eller publisere
 *     incidents). Admin-publisering går via egne admin-routes.
 *   - Cache-Control: public, max-age=30 — mismatcher den interne
 *     30s-cachen i StatusService, men forhindrer at status-siden
 *     hamrer backenden ved en større incident (når mange spillere
 *     refresher samtidig).
 *
 * Ingen Bearer-auth, ingen rate-limit (offentlig route brukt av
 * monitoring-systemer + spillere). Hvis vi senere ser misbruk,
 * legger vi på en IP-basert rate-limit i index.ts (`rateLimitGuard`).
 */

import express from "express";
import {
  StatusService,
  type ComponentHealth,
  type StatusSnapshot,
} from "../observability/StatusService.js";
import type { StatusIncidentService, StatusIncident } from "../admin/StatusIncidentService.js";
import { apiSuccess, apiFailure } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "public-status" });

/**
 * Cache-Control header for public status responses. 30s match the internal
 * StatusService cache, så klient og server cache havner i synk.
 */
const PUBLIC_CACHE_HEADER = "public, max-age=30";

export interface PublicStatusRouterDeps {
  statusService: StatusService;
  /**
   * Optional — dersom vi kjører uten DB (test/dev) skipper vi
   * incidents-routen og returnerer en tom liste.
   */
  statusIncidentService?: StatusIncidentService;
}

interface PublicStatusResponse {
  overall: StatusSnapshot["overall"];
  generatedAt: string;
  components: ComponentHealth[];
}

interface PublicIncidentResponse {
  id: string;
  title: string;
  description: string;
  status: StatusIncident["status"];
  impact: StatusIncident["impact"];
  affectedComponents: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * Strip server-internal-only fields from an incident before exposing it
 * publicly. We strip out `createdByUserId`/`updatedByUserId` since the
 * public never needs the moderator's identity.
 */
function asPublicIncident(incident: StatusIncident): PublicIncidentResponse {
  return {
    id: incident.id,
    title: incident.title,
    description: incident.description,
    status: incident.status,
    impact: incident.impact,
    affectedComponents: incident.affectedComponents,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    resolvedAt: incident.resolvedAt,
  };
}

export function createPublicStatusRouter(
  deps: PublicStatusRouterDeps,
): express.Router {
  const { statusService, statusIncidentService } = deps;
  const router = express.Router();

  // ── GET /api/status ────────────────────────────────────────────────────────
  router.get("/api/status", async (_req, res) => {
    try {
      const snapshot = await statusService.getSnapshot();
      res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
      const payload: PublicStatusResponse = {
        overall: snapshot.overall,
        generatedAt: snapshot.generatedAt,
        components: snapshot.components,
      };
      apiSuccess(res, payload);
    } catch (err) {
      log.warn({ err }, "[public-status] /api/status failed");
      apiFailure(res, err);
    }
  });

  // ── GET /api/status/uptime ─────────────────────────────────────────────────
  router.get("/api/status/uptime", async (_req, res) => {
    try {
      // Sørg for at vi har minst ett sample før vi returnerer uptime.
      // Ellers vil samtlige bøtter være tomme på første kall og UI-en
      // viser en "ingen data"-melding feilaktig.
      await statusService.getSnapshot();
      const uptime = statusService.getUptime();
      res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
      apiSuccess(res, { uptime });
    } catch (err) {
      log.warn({ err }, "[public-status] /api/status/uptime failed");
      apiFailure(res, err);
    }
  });

  // ── GET /api/status/incidents ──────────────────────────────────────────────
  router.get("/api/status/incidents", async (_req, res) => {
    try {
      // Ingen DB-tilgang? Returnér tomme lister (ikke 500). Status-siden
      // skal være tilgjengelig uansett om incidents-DB er konfigurert.
      if (!statusIncidentService) {
        res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
        apiSuccess(res, { active: [], recent: [] });
        return;
      }
      const [active, recent] = await Promise.all([
        statusIncidentService.listActive(),
        statusIncidentService.listRecent(50),
      ]);
      res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
      apiSuccess(res, {
        active: active.map(asPublicIncident),
        recent: recent.map(asPublicIncident),
      });
    } catch (err) {
      log.warn({ err }, "[public-status] /api/status/incidents failed");
      apiFailure(res, err);
    }
  });

  return router;
}
