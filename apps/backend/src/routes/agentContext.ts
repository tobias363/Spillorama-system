/**
 * Agent-portal skeleton (feat/agent-portal-skeleton):
 * GET /api/agent/context — returnerer agentens operasjonelle kontekst
 * (assigned halls, primary hall, group-of-hall + coarse permissions-flag)
 * slik at admin-web agent-portal kan rendre header ("Group of Hall Name -
 * Hall Name") og side-nav-visning uten å treffe /api/agent/auth/me +
 * /api/agent/dashboard separat.
 *
 * Scope i denne PR-en: stub — backend henter AgentProfile + første hall,
 * og returnerer navn/ID. Group-of-hall er ikke tilgjengelig i nåværende
 * schema, så feltet er nullable inntil BIN-xxx (group-of-hall wiring)
 * lander.
 *
 * Auth: AGENT + HALL_OPERATOR. ADMIN/SUPPORT nektes (bruker
 * /api/admin/permissions for sin egen konfigurasjon).
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";

export interface AgentContextRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
}

export interface AgentContextResponse {
  agent: {
    userId: string;
    email: string;
    displayName: string;
    role: "AGENT" | "HALL_OPERATOR";
  };
  /**
   * Primary hall for this session. For AGENT: from agent_profile. For
   * HALL_OPERATOR (no agent_profile row): the first assigned admin-hall.
   * null if no halls are assigned yet (edge-case; UI shows a warning).
   */
  hall: {
    id: string;
    name: string;
    slug: string;
    region: string;
  } | null;
  /**
   * Group-of-halls parent, if any. Currently null — group-of-hall wiring
   * is not in the agent-profile schema yet (separate PR).
   */
  groupOfHalls: {
    id: string;
    name: string;
  } | null;
  /** All halls the user may act on (for HALL_OPERATOR: their group). */
  assignedHalls: Array<{ id: string; name: string; isPrimary: boolean }>;
  /**
   * Coarse permissions-flag for front-end layout — full permission-check
   * happens server-side on each endpoint. AGENT_TX_READ is always true
   * when this endpoint responds (it's gated by role).
   */
  capabilities: {
    canApprovePlayers: boolean;
    canSettle: boolean;
    canCreateUniqueId: boolean;
  };
}

export function createAgentContextRouter(deps: AgentContextRouterDeps): express.Router {
  const { platformService, agentService } = deps;
  const router = express.Router();

  router.get("/api/agent/context", async (req, res) => {
    try {
      const token = getAccessTokenFromRequest(req);
      const user = await platformService.getUserFromAccessToken(token);

      // Only AGENT + HALL_OPERATOR land in the agent-portal. Other roles
      // (ADMIN, SUPPORT, PLAYER) are rejected — they use the admin-panel.
      if (user.role !== "AGENT" && user.role !== "HALL_OPERATOR") {
        throw new DomainError(
          "FORBIDDEN",
          "Agent-context er kun tilgjengelig for AGENT + HALL_OPERATOR."
        );
      }

      const response: AgentContextResponse = {
        agent: {
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
        hall: null,
        groupOfHalls: null,
        assignedHalls: [],
        // Coarse capabilities. Full RBAC is enforced per-endpoint; these
        // are layout-hints only.
        capabilities: {
          canApprovePlayers: user.role === "AGENT" || user.role === "HALL_OPERATOR",
          canSettle: user.role === "AGENT" || user.role === "HALL_OPERATOR",
          canCreateUniqueId: user.role === "AGENT" || user.role === "HALL_OPERATOR",
        },
      };

      if (user.role === "AGENT") {
        // agent_profile rows exist for AGENT-role only. Fail-open — if
        // the profile is missing (legacy row) we return null halls rather
        // than 500ing.
        try {
          const profile = await agentService.getById(user.id);
          const halls = profile.halls;
          response.assignedHalls = await resolveHallNames(platformService, halls);
          const primary = halls.find((h) => h.isPrimary) ?? halls[0];
          if (primary) {
            const primaryHall = response.assignedHalls.find((h) => h.id === primary.hallId);
            if (primaryHall) {
              response.hall = {
                id: primaryHall.id,
                name: primaryHall.name,
                slug: "",
                region: "",
              };
              // Best-effort enrichment with slug/region from the hall-store.
              try {
                const full = await platformService.getHall(primary.hallId);
                response.hall.slug = full.slug;
                response.hall.region = full.region;
              } catch {
                // ignore — skeleton endpoint, partial context is fine
              }
            }
          }
        } catch (err) {
          if (!(err instanceof DomainError && err.code === "AGENT_NOT_FOUND")) {
            throw err;
          }
        }
      }
      // HALL_OPERATOR: no agent_profile row. `assignedHalls` remains empty
      // for now; a future PR will wire hall-assignment for hall-operators
      // via app_admin_hall_ops_assignments or similar.

      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}

async function resolveHallNames(
  platformService: PlatformService,
  halls: Array<{ hallId: string; isPrimary: boolean }>
): Promise<Array<{ id: string; name: string; isPrimary: boolean }>> {
  const out: Array<{ id: string; name: string; isPrimary: boolean }> = [];
  for (const h of halls) {
    try {
      const full = await platformService.getHall(h.hallId);
      out.push({ id: full.id, name: full.name, isPrimary: h.isPrimary });
    } catch {
      // Hall was deleted — skip silently; agent-portal will fail-closed
      // when attempting to operate on a missing hall.
    }
  }
  return out;
}
