import express from "express";
import { toPublicError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { SwedbankPayService } from "../payments/SwedbankPayService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseBooleanEnv,
} from "../util/httpHelpers.js";

export interface PaymentsRouterDeps {
  platformService: PlatformService;
  swedbankPayService: SwedbankPayService;
  emitWalletRoomUpdates: (walletIds: string[]) => Promise<void>;
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): express.Router {
  const { platformService, swedbankPayService, emitWalletRoomUpdates } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/payments/swedbank/topup-intent", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const amount = mustBePositiveAmount(req.body?.amount);
      const intent = await swedbankPayService.createTopupIntent({
        userId: user.id,
        walletId: user.walletId,
        amountMajor: amount,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined
      });
      apiSuccess(res, intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/payments/swedbank/confirm", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.body?.intentId, "intentId");
      const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([user.walletId]);
      }
      apiSuccess(res, result.intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/payments/swedbank/intents/:intentId", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.params.intentId, "intentId");
      const shouldRefresh = parseBooleanEnv(
        typeof req.query.refresh === "string" ? req.query.refresh : undefined,
        false
      );
      if (!shouldRefresh) {
        const intent = await swedbankPayService.getIntentForUser(intentId, user.id);
        apiSuccess(res, intent);
        return;
      }

      const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([user.walletId]);
      }
      apiSuccess(res, result.intent);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/payments/swedbank/callback", async (req, res) => {
    try {
      const result = await swedbankPayService.processCallback(req.body);
      if (result.walletCreditedNow) {
        await emitWalletRoomUpdates([result.intent.walletId]);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[swedbank-callback] failed", error);
      res.status(500).json({
        ok: false,
        error: toPublicError(error)
      });
    }
  });

  return router;
}
