import express from "express";
import { toPublicError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { SwedbankPayService } from "../payments/SwedbankPayService.js";
import {
  SWEDBANK_SIGNATURE_HEADER,
  verifySwedbankSignature,
} from "../payments/swedbankSignature.js";
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
  /**
   * BIN-603: shared secret for Swedbank webhook HMAC-SHA256 verification.
   * Empty string = webhook is treated as mis-configured and returns 503
   * (fail-closed). The raw bytes of the request body must reach this
   * router via `req.rawBody` — see the `express.json` `verify` hook in
   * index.ts.
   */
  swedbankWebhookSecret: string;
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): express.Router {
  const { platformService, swedbankPayService, emitWalletRoomUpdates, swedbankWebhookSecret } = deps;
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

  // REQ-137: pending-deposit reminder.
  // Returnerer åpne (ikke-fullførte) Swedbank top-up-intents for innlogget
  // spiller, yngre enn 24 timer. Lobby-shellen poller dette ved mount og
  // hvert 5. minutt for å vise en popup-påminnelse: "Du har et åpent
  // innskudd på X kr — vil du fullføre?".
  router.get("/api/payments/pending-deposit", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intents = await swedbankPayService.listPendingIntentsForUser(user.id);
      apiSuccess(res, { intents });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // REQ-137: stamp last_reminded_at slik at vi får audit-trail på når
  // klienten viste reminderen. Klient styrer 5-min-intervall selv —
  // dette endepunktet er fire-and-forget og blokkerer ikke popup-rendering.
  router.post("/api/payments/pending-deposit/:intentId/reminded", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const intentId = mustBeNonEmptyString(req.params.intentId, "intentId");
      const updated = await swedbankPayService.markIntentReminded(intentId, user.id);
      apiSuccess(res, { reminded: updated });
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
    // BIN-603: HMAC-SHA256 verification over the raw request body BEFORE we
    // touch processCallback. The callback path is internet-exposed; without
    // signature verification anyone can POST a plausible Swedbank payload
    // and force us to hit Swedbank's API for reconciliation. Wallet credit
    // is still gated by the authoritative fetchPaymentOrder call inside
    // reconcileRow, so unsigned spam can't steal money — but it is DoS /
    // log-noise and diverges from industry standard. Verified here,
    // fail-closed on any mis-configuration.
    if (!swedbankWebhookSecret) {
      console.error("[swedbank-callback] SWEDBANK_WEBHOOK_SECRET is not configured; refusing callback");
      res.status(503).json({
        ok: false,
        error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Swedbank webhook-verifisering er ikke konfigurert." },
      });
      return;
    }
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const signatureHeader = req.headers[SWEDBANK_SIGNATURE_HEADER];
    if (!verifySwedbankSignature(rawBody, signatureHeader, swedbankWebhookSecret)) {
      const orderReference =
        typeof req.body?.orderReference === "string" ? req.body.orderReference : undefined;
      console.warn("[swedbank-callback] signature verification failed", {
        orderReference,
        hasHeader: Boolean(signatureHeader),
        bodyLength: rawBody.length,
      });
      res.status(401).json({
        ok: false,
        error: { code: "INVALID_SIGNATURE", message: "Swedbank webhook-signatur er ugyldig." },
      });
      return;
    }

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
