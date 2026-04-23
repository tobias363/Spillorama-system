/**
 * BIN-587 B4b follow-up: spiller-side voucher-innløsning (HTTP fallback).
 *
 * Primær-kanal er socket-event `voucher:redeem` (se
 * `sockets/gameEvents/voucherEvents.ts`). Denne routeren er en
 * HTTP-fallback for klienter som ikke er koblet via socket — f.eks.
 * pre-lobby "Sjekk koden"-UI eller et fremtidig mobil-onboarding-flyt.
 *
 * Endepunkter:
 *   - POST /api/voucher/validate   — rent read (ingen state-endring)
 *   - POST /api/voucher/redeem     — atomisk innløsning
 *   - GET  /api/voucher/my         — spillerens tidligere innløsninger
 *
 * Autorisasjon: access-token (PlatformService). Rolle-gate på PLAYER.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { VoucherRedemptionService } from "../compliance/VoucherRedemptionService.js";
import {
  apiSuccess, apiFailure, getAccessTokenFromRequest,
  mustBeNonEmptyString, parseLimit,
} from "../util/httpHelpers.js";

export interface VoucherRouterDeps {
  platformService: PlatformService;
  voucherRedemptionService: VoucherRedemptionService;
}

function assertPlayer(user: PublicAppUser): void {
  if (user.role !== "PLAYER") {
    throw new DomainError(
      "FORBIDDEN",
      "Kun spillere kan innløse vouchere via denne kanalen.",
    );
  }
}

function parseTicketPriceCents(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "ticketPriceCents må være et positivt heltall (cents).",
    );
  }
  return n;
}

function parseOptionalString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

export function createVoucherRouter(deps: VoucherRouterDeps): express.Router {
  const { platformService, voucherRedemptionService } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/voucher/validate", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      assertPlayer(user);
      const code = mustBeNonEmptyString(req.body?.code, "code");
      const gameSlug = mustBeNonEmptyString(req.body?.gameSlug, "gameSlug");
      const ticketPriceCents = parseTicketPriceCents(req.body?.ticketPriceCents);

      const discount = await voucherRedemptionService.validateCode({
        code, userId: user.id, gameSlug, ticketPriceCents,
      });
      apiSuccess(res, { discount, validateOnly: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/voucher/redeem", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      assertPlayer(user);
      const code = mustBeNonEmptyString(req.body?.code, "code");
      const gameSlug = mustBeNonEmptyString(req.body?.gameSlug, "gameSlug");
      const ticketPriceCents = parseTicketPriceCents(req.body?.ticketPriceCents);
      const scheduledGameId = parseOptionalString(req.body?.scheduledGameId);
      const roomCode = parseOptionalString(req.body?.roomCode);

      const redemption = await voucherRedemptionService.redeem({
        code,
        userId: user.id,
        walletId: user.walletId,
        gameSlug,
        ticketPriceCents,
        scheduledGameId,
        roomCode,
      });
      apiSuccess(res, redemption);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/voucher/my", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      assertPlayer(user);
      const limit = parseLimit(req.query.limit, 50);
      const list = await voucherRedemptionService.listRedemptionsForUser(user.id, limit);
      apiSuccess(res, { redemptions: list, count: list.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
