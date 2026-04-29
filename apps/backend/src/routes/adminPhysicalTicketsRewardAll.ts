/**
 * BIN-639: admin bulk reward-all for fysiske papirbilletter.
 *
 *   POST /api/admin/physical-tickets/reward-all
 *
 * Body:
 *   {
 *     gameId: string,
 *     rewards: Array<{ uniqueId: string, amountCents: number }>
 *   }
 *
 * Response:
 *   {
 *     rewardedCount: number,
 *     totalPayoutCents: number,
 *     skippedCount: number,
 *     details: Array<{ uniqueId, status, amountCents?, cashoutId?, hallId?, message? }>
 *   }
 *
 * Workflow:
 *   1. Operatør scanner ALLE potensielle vinner-bonger via BIN-641
 *      check-bingo — stamper numbers + pattern + evaluated_at.
 *   2. Admin-UI kalkulerer payoutCents per vinner basert på game-prize-
 *      structure + stamped pattern.
 *   3. Admin klikker "Betal alle vinnere" → dette endepunktet mottar
 *      `{ gameId, rewards[] }` og verifiserer + distribuerer per ticket.
 *
 * Hver ticket er egen mini-transaksjon (ikke atomisk på tvers) — én feil
 * skipper ikke de andre. Idempotens i to lag:
 *   1) `is_winning_distributed`-flagg på ticket-raden.
 *   2) BIN-640 `app_physical_ticket_cashouts.ticket_unique_id` UNIQUE.
 *
 * Audit-logging:
 *   - Per vellykket ticket: `admin.physical_ticket.reward` med
 *     `{ uniqueId, gameId, hallId, payoutCents, cashoutId, actor }`.
 *   - Bulk-event på slutten: `admin.physical_ticket.reward_all` med
 *     `{ gameId, rewardedCount, totalPayoutCents, skippedCount, actor }`.
 *
 * Permisjon: `PHYSICAL_TICKET_WRITE` (ADMIN + HALL_OPERATOR).
 *
 * Hall-scope: For tickets i HALL_OPERATOR sin egen hall er reward OK; for
 * tickets i annen hall markeres detaljen `skipped_wrong_game` fra service
 * (ticket.assigned_game_id bindes uansett til ett spesifikt spill). I
 * tillegg gjør vi en pre-kartlegging og avviser hele requesten hvis
 * HALL_OPERATOR sender tickets fra annen hall — mønster konsistent med
 * BIN-640 cashout-route (`assertUserHallScope`).
 *
 * Regulatorisk mønster: Følger BIN-640 — vi registrerer utbetalingen, men
 * flytter ingen penger mellom wallets. Fysisk cash utbetales av operatør
 * offline; denne endepunktet gir audit-trail + double-claim-beskyttelse.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { PhysicalTicketService, RewardAllDetail } from "../compliance/PhysicalTicketService.js";
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

const logger = rootLogger.child({ module: "admin-physical-tickets-reward-all" });

export interface AdminPhysicalTicketsRewardAllDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  physicalTicketService: PhysicalTicketService;
}

/** Maks antall tickets per call — beskyttelse mot overdimensjonert payload. */
const MAX_REWARDS_PER_CALL = 5000;

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

interface ParsedReward {
  uniqueId: string;
  amountCents: number;
}

function parseRewards(raw: unknown): ParsedReward[] {
  if (!Array.isArray(raw)) {
    throw new DomainError("INVALID_INPUT", "rewards må være en array.");
  }
  if (raw.length > MAX_REWARDS_PER_CALL) {
    throw new DomainError(
      "INVALID_INPUT",
      `rewards har ${raw.length} elementer — over grensen ${MAX_REWARDS_PER_CALL}.`,
    );
  }
  const seen = new Set<string>();
  const out: ParsedReward[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!isRecordObject(entry)) {
      throw new DomainError("INVALID_INPUT", `rewards[${i}] må være et objekt.`);
    }
    const uniqueIdRaw = entry.uniqueId;
    if (typeof uniqueIdRaw !== "string" || !uniqueIdRaw.trim()) {
      throw new DomainError("INVALID_INPUT", `rewards[${i}].uniqueId er påkrevd.`);
    }
    const uniqueId = uniqueIdRaw.trim();
    if (seen.has(uniqueId)) {
      throw new DomainError(
        "INVALID_INPUT",
        `rewards[${i}].uniqueId=${uniqueId} er duplisert i payload.`,
      );
    }
    seen.add(uniqueId);
    const amountRaw = entry.amountCents;
    const amountCents = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    if (
      !Number.isFinite(amountCents) ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        `rewards[${i}].amountCents må være et positivt heltall.`,
      );
    }
    out.push({ uniqueId, amountCents });
  }
  return out;
}

export function createAdminPhysicalTicketsRewardAllRouter(
  deps: AdminPhysicalTicketsRewardAllDeps,
): express.Router {
  const { platformService, auditLogService, physicalTicketService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-639] audit append failed");
    });
  }

  router.post("/api/admin/physical-tickets/reward-all", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PHYSICAL_TICKET_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const gameId = mustBeNonEmptyString(req.body.gameId, "gameId");
      const rewards = parseRewards(req.body.rewards);

      // Hall-scope for HALL_OPERATOR: forhånds-sjekk at alle tickets i payload
      // tilhører operatørens hall. Vi gjør dette fordi service-laget uansett
      // ville `skipped_wrong_game` for annen hall (ticket.assigned_game_id-
      // miss-match), men HALL_OPERATOR skal aldri få *se* at en annen halls
      // ticket finnes/ikke — så vi avviser hele requesten opp-front.
      if (actor.role === "HALL_OPERATOR" && rewards.length > 0) {
        for (const r of rewards) {
          const ticket = await physicalTicketService.findByUniqueId(r.uniqueId);
          if (ticket) {
            // Kaster DomainError FORBIDDEN hvis hall mismatcher.
            assertUserHallScope(actor, ticket.hallId);
          }
          // Hvis ticket ikke finnes, lar vi service-laget håndtere
          // (ticket_not_found-status). Hall-scope er ikke aktuelt.
        }
      }

      const result = await physicalTicketService.rewardAll({
        gameId,
        rewards,
        actorId: actor.id,
      });

      const actorType = actorTypeFromRole(actor.role);
      const ip = clientIp(req);
      const ua = userAgent(req);

      // Per-ticket audit-events for vellykkede rewards.
      for (const detail of result.details) {
        if (detail.status === "rewarded") {
          fireAudit({
            actorId: actor.id,
            actorType,
            action: "admin.physical_ticket.reward",
            resource: "physical_ticket",
            resourceId: detail.uniqueId,
            details: {
              uniqueId: detail.uniqueId,
              gameId,
              hallId: detail.hallId ?? null,
              payoutCents: detail.amountCents ?? 0,
              cashoutId: detail.cashoutId ?? null,
              actor: actor.id,
            },
            ipAddress: ip,
            userAgent: ua,
          });
        }
      }

      // Bulk audit-event.
      fireAudit({
        actorId: actor.id,
        actorType,
        action: "admin.physical_ticket.reward_all",
        resource: "game",
        resourceId: gameId,
        details: {
          gameId,
          rewardedCount: result.rewardedCount,
          totalPayoutCents: result.totalPayoutCents,
          skippedCount: result.skippedCount,
          actor: actor.id,
        },
        ipAddress: ip,
        userAgent: ua,
      });

      apiSuccess(res, {
        rewardedCount: result.rewardedCount,
        totalPayoutCents: result.totalPayoutCents,
        skippedCount: result.skippedCount,
        details: result.details satisfies RewardAllDetail[],
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
