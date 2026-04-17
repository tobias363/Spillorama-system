import express from "express";
import type { PlatformService } from "../platform/PlatformService.js";
import type { BankIdKycAdapter } from "../adapters/BankIdKycAdapter.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
} from "../util/httpHelpers.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";

export interface AuthRouterDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  bankIdAdapter: BankIdKycAdapter | null;
}

export function createAuthRouter(deps: AuthRouterDeps): express.Router {
  const { platformService, walletAdapter, bankIdAdapter } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request) {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/auth/register", async (req, res) => {
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const displayName = mustBeNonEmptyString(req.body?.displayName, "displayName");
      const surname = mustBeNonEmptyString(req.body?.surname, "surname");
      const birthDate = mustBeNonEmptyString(req.body?.birthDate, "birthDate");
      const phone = typeof req.body?.phone === "string" && req.body.phone.trim()
        ? req.body.phone.trim()
        : undefined;
      const complianceData = req.body?.complianceData && typeof req.body.complianceData === "object"
        ? req.body.complianceData as Record<string, unknown>
        : undefined;
      const session = await platformService.register({
        email,
        password,
        displayName,
        surname,
        phone,
        birthDate,
        complianceData
      });
      apiSuccess(res, session);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BankID verification (BIN-274) ─────────────────────────────────────────
  router.post("/api/auth/bankid/init", async (req, res) => {
    try {
      if (!bankIdAdapter) {
        apiSuccess(res, {
          sessionId: `bankid-${Date.now()}`,
          authUrl: null,
          status: "NOT_CONFIGURED",
          message: "BankID-integrasjon er ikke konfigurert. Bruk manuell verifisering."
        });
        return;
      }
      const user = await getAuthenticatedUser(req);
      const { sessionId, authUrl } = bankIdAdapter.createAuthSession(user.id);
      apiSuccess(res, { sessionId, authUrl, status: "PENDING" });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/auth/bankid/callback", async (req, res) => {
    try {
      if (!bankIdAdapter) {
        res.status(501).json({ error: "BankID ikke konfigurert" });
        return;
      }
      const { code, state, session_id } = req.query as Record<string, string>;
      if (!code || !state || !session_id) {
        res.status(400).json({ error: "Mangler code, state eller session_id" });
        return;
      }
      const result = await bankIdAdapter.handleCallback(session_id, code, state);
      if (result.birthDate) {
        await platformService.submitKycVerification({ userId: result.userId, birthDate: result.birthDate, nationalId: result.nationalId ?? undefined });
      }
      // Redirect user back to web shell after BankID verification
      res.redirect("/web/?bankid=complete");
    } catch (error) {
      console.error("[BankID] Callback error:", error);
      res.redirect("/web/?bankid=error");
    }
  });

  router.get("/api/auth/bankid/status/:sessionId", async (req, res) => {
    try {
      if (!bankIdAdapter) {
        apiSuccess(res, { sessionId: req.params.sessionId, status: "NOT_CONFIGURED", verified: false });
        return;
      }
      // Check user's KYC status directly
      const user = await getAuthenticatedUser(req);
      apiSuccess(res, {
        sessionId: req.params.sessionId,
        status: user.kycStatus === "VERIFIED" ? "COMPLETE" : "PENDING",
        verified: user.kycStatus === "VERIFIED",
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/login", async (req, res) => {
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const session = await platformService.login({
        email,
        password
      });
      apiSuccess(res, session);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/logout", async (req, res) => {
    try {
      const accessToken = getAccessTokenFromRequest(req);
      await platformService.logout(accessToken);
      apiSuccess(res, { loggedOut: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-174: Token refresh — issue new token, revoke old one
  router.post("/api/auth/refresh", async (req, res) => {
    try {
      const accessToken = getAccessTokenFromRequest(req);
      const session = await platformService.refreshSession(accessToken);
      apiSuccess(res, session);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      apiSuccess(res, user);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Profile management ────────────────────────────────────────────────────

  router.put("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const updated = await platformService.updateProfile(user.id, {
        displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
        email: typeof req.body?.email === "string" ? req.body.email : undefined,
        phone: typeof req.body?.phone === "string" ? req.body.phone : undefined
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/change-password", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const currentPassword = mustBeNonEmptyString(req.body?.currentPassword, "currentPassword");
      const newPassword = mustBeNonEmptyString(req.body?.newPassword, "newPassword");
      await platformService.changePassword(user.id, { currentPassword, newPassword });
      apiSuccess(res, { changed: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      await platformService.deleteAccount(user.id);
      apiSuccess(res, { deleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Forgot password (stub — always returns success to avoid user enumeration) ──

  router.post("/api/auth/forgot-password", async (_req, res) => {
    // Always return success regardless of whether the email exists.
    // In production, this would send an email with a reset link.
    apiSuccess(res, { sent: true });
  });

  router.get("/api/kyc/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      apiSuccess(res, {
        userId: user.id,
        status: user.kycStatus,
        birthDate: user.birthDate,
        verifiedAt: user.kycVerifiedAt,
        providerReference: user.kycProviderRef
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/kyc/verify", async (req, res) => {
    try {
      const accessToken = getAccessTokenFromRequest(req);
      const user = await platformService.getUserFromAccessToken(accessToken);
      await platformService.submitKycVerification({
        userId: user.id,
        birthDate: mustBeNonEmptyString(req.body?.birthDate, "birthDate"),
        nationalId: typeof req.body?.nationalId === "string" ? req.body.nationalId : undefined
      });
      const refreshedUser = await platformService.getUserFromAccessToken(accessToken);
      apiSuccess(res, {
        user: refreshedUser
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Transaction history ───────────────────────────────────────────────────

  router.get("/api/wallet/me/transactions", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const limit = parseLimit(req.query.limit, 50);
      const transactions = await walletAdapter.listTransactions(user.walletId, limit);
      apiSuccess(res, transactions);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
