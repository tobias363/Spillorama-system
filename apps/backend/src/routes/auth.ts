import express from "express";
import type { Pool } from "pg";
import type { PlatformService } from "../platform/PlatformService.js";
import type { BankIdKycAdapter } from "../adapters/BankIdKycAdapter.js";
import type { AuthTokenService } from "../auth/AuthTokenService.js";
import type { EmailService } from "../integration/EmailService.js";
import type { SveveSmsService } from "../integration/SveveSmsService.js";
import { maskPhone } from "../integration/SveveSmsService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { DomainError } from "../game/BingoEngine.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
} from "../util/httpHelpers.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "auth-router" });

export interface AuthRouterDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  bankIdAdapter: BankIdKycAdapter | null;
  authTokenService: AuthTokenService;
  emailService: EmailService;
  /**
   * BIN-629: when present, the login endpoint emits `auth.login` /
   * `auth.login.failed` audit-rows so admin-player-detail can render
   * login-history. Optional — callers without audit wiring (e.g. focused
   * unit tests) still work; the events are just silently skipped.
   */
  auditLogService?: AuditLogService;
  /** Base-URL brukt til å bygge reset-lenker, e.g. "https://app.spillorama.no". */
  webBaseUrl: string;
  /** Support-e-post rendret i template-footer. */
  supportEmail: string;
  /**
   * SMS-service — when present, /api/auth/forgot-password also accepts
   * { phone } in the body and sends OTP via SMS for users without email
   * (or who explicitly requested phone-based reset).
   */
  smsService?: SveveSmsService;
  /** Pool + schema needed for phone-based user lookup. Required if smsService is set. */
  pool?: Pool;
  schema?: string;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function requestUserAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

export function createAuthRouter(deps: AuthRouterDeps): express.Router {
  const {
    platformService,
    walletAdapter,
    bankIdAdapter,
    authTokenService,
    emailService,
    auditLogService,
    webBaseUrl,
    supportEmail,
    smsService,
    pool,
    schema,
  } = deps;
  const router = express.Router();

  // Validate schema-name once if provided.
  const safeSchema =
    schema && /^[a-z_][a-z0-9_]*$/i.test(schema) ? schema : "public";

  /**
   * Look up user by phone for SMS-based forgot-password. Soft-deleted
   * brukere filtreres bort. Returnerer null hvis ingen match.
   */
  async function findUserByPhone(
    phoneRaw: string
  ): Promise<{ id: string; phone: string; displayName: string } | null> {
    if (!pool) return null;
    const phone = phoneRaw.trim();
    if (!phone) return null;
    const result = await pool.query<{
      id: string;
      phone: string;
      display_name: string;
    }>(
      `SELECT id, phone, display_name FROM "${safeSchema}"."app_users"
        WHERE phone = $1
          AND deleted_at IS NULL
        LIMIT 2`,
      [phone]
    );
    // Hvis flere brukere har samme telefonnummer (skal være sjeldent men
    // mulig hvis registrering aldri har håndhevet UNIQUE) — returner null
    // og logg, slik at vi ikke risikerer å sende OTP til feil bruker.
    if (result.rows.length === 0) return null;
    if (result.rows.length > 1) {
      logger.warn(
        { maskedPhone: maskPhone(phone) },
        "[forgot-password] flere brukere med samme telefonnummer — ignorert"
      );
      return null;
    }
    const row = result.rows[0]!;
    return { id: row.id, phone: row.phone, displayName: row.display_name };
  }

  /**
   * Generer 6-sifret OTP-streng. Brukes som "fake token" via authTokenService
   * — egentlig en password-reset token, men i SMS-form trenger vi en kortere
   * verdi enn standard 32-tegn-token. Vi lagrer den lange tokenet i DB og
   * sender de første 6 sifrene til brukeren — brukeren skriver disse inn,
   * og endepunktet bruker dem som lookup-key. For nå genererer vi en kort
   * numerisk OTP og lar authTokenService håndtere TTL.
   *
   * For minimum-PR-scope: vi sender resetLink (samme som email-flow) — bare
   * via SMS i stedet. Lenken er kort nok til å sende på SMS, og bruker har
   * konsistent UX.
   */

  /**
   * BIN-629: fire-and-forget audit emit. Same policy as AuditLogService
   * internals — never block the auth response on audit-DB outages; the
   * structured logger below keeps an intent-trail in any case.
   */
  function fireLoginAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    if (!auditLogService) return;
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-629] login audit append failed");
    });
  }

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
    const ipAddress = clientIp(req);
    const userAgent = requestUserAgent(req);
    let emailForAudit: string | null = null;
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      emailForAudit = email;
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const session = await platformService.login({
        email,
        password
      });
      // BIN-629: per-spiller login-history. actorId = spiller-id så admin-
      // detaljside kan filtrere direkte i /api/admin/players/:id/login-history.
      fireLoginAudit({
        actorId: session.user.id,
        actorType: "USER",
        action: "auth.login",
        resource: "session",
        resourceId: null,
        ipAddress,
        userAgent,
      });
      apiSuccess(res, session);
    } catch (error) {
      // BIN-629: log failed attempts too. Look up the account by email so
      // admin can see "someone tried to log in to player X" — useful for
      // credential-stuffing triage. If the email isn't ours, actorId stays
      // null; the row still lands but won't surface in per-player filters.
      let failedActorId: string | null = null;
      if (emailForAudit) {
        try {
          const existing = await platformService.findUserByEmail(emailForAudit);
          failedActorId = existing?.id ?? null;
        } catch {
          // Deliberately swallow — audit-trail is best-effort.
        }
      }
      const failureReason = error instanceof DomainError ? error.code : "UNKNOWN";
      fireLoginAudit({
        actorId: failedActorId,
        actorType: "USER",
        action: "auth.login.failed",
        resource: "session",
        resourceId: null,
        details: { failureReason },
        ipAddress,
        userAgent,
      });
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

  // ── Forgot password + reset (BIN-587 B2.1) ──────────────────────────────
  //
  // Alle responser er enumeration-safe: vi returnerer alltid { sent: true }
  // uansett om e-posten finnes eller ikke. Real-world e-post sendes kun
  // dersom brukeren finnes og EmailService er konfigurert. Ved stub-e-post
  // (SMTP ikke konfigurert) logges lenken i warn-level — utvikling/test.

  router.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const emailRaw =
        typeof req.body?.email === "string" ? req.body.email : "";
      const phoneRaw =
        typeof req.body?.phone === "string" ? req.body.phone : "";

      // Aksepter enten email ELLER phone. Phone-modus krever smsService +
      // pool (ellers fall-back til "ingen handling" — fortsatt enumeration-safe).
      if (!emailRaw.trim() && !phoneRaw.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "email eller phone er påkrevd."
        );
      }

      // Phone-flow har prioritet hvis både er satt — eksplisitt kanal valgt.
      if (phoneRaw.trim()) {
        if (smsService && pool) {
          const phoneUser = await findUserByPhone(phoneRaw);
          if (phoneUser) {
            try {
              const { token, expiresAt } = await authTokenService.createToken(
                "password-reset",
                phoneUser.id
              );
              const base = webBaseUrl.replace(/\/+$/, "");
              const resetLink = `${base}/reset-password/${encodeURIComponent(token)}`;
              // SMS-meldingen skal være kort. Vi sender resetLink + utløp.
              const message = `Spillorama: tilbakestill passord her: ${resetLink} (utløper om 1 time).`;
              const smsResult = await smsService.sendSms({
                to: phoneUser.phone,
                message,
              });
              if (smsResult.skipped) {
                logger.warn(
                  {
                    userId: phoneUser.id,
                    maskedPhone: maskPhone(phoneUser.phone),
                    resetLink,
                    expiresAt,
                  },
                  "[forgot-password] SMS-stub-mode — reset-link logget, ikke sendt"
                );
              } else if (!smsResult.ok) {
                logger.warn(
                  {
                    userId: phoneUser.id,
                    maskedPhone: maskPhone(phoneUser.phone),
                    error: smsResult.error,
                    attempts: smsResult.attempts,
                  },
                  "[forgot-password] SMS feilet etter retry"
                );
              }
            } catch (err) {
              // Ikke la SMS-/token-feil lekke ut via enumeration.
              logger.error(
                { err, userId: phoneUser.id },
                "[forgot-password] phone-flow internal error"
              );
            }
          }
        } else {
          logger.warn(
            "[forgot-password] phone-flow forespurt men SMS-service ikke konfigurert"
          );
        }
        // Enumeration-safe: alltid samme respons uansett om bruker finnes.
        apiSuccess(res, { sent: true });
        return;
      }

      // Email-flow (eksisterende, BIN-587 B2.1).
      const user = await platformService.findUserByEmail(emailRaw);
      if (user) {
        try {
          const { token, expiresAt } = await authTokenService.createToken(
            "password-reset",
            user.id
          );
          const base = webBaseUrl.replace(/\/+$/, "");
          const resetLink = `${base}/reset-password/${encodeURIComponent(token)}`;
          const sendResult = await emailService.sendTemplate({
            to: user.email,
            template: "reset-password",
            context: {
              username: user.displayName,
              resetLink,
              expiresInHours: 1,
              supportEmail,
            },
          });
          if (sendResult.skipped) {
            logger.warn(
              { userId: user.id, resetLink, expiresAt },
              "[BIN-587 B2.1] SMTP disabled — reset-link not sent; logged for dev only"
            );
          }
        } catch (err) {
          // Ikke la e-post-/token-feil lekke ut via enumeration.
          logger.error({ err, userId: user.id }, "[BIN-587 B2.1] forgot-password internal error");
        }
      }
      apiSuccess(res, { sent: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const token = mustBeNonEmptyString(req.params.token, "token");
      const { userId } = await authTokenService.validate("password-reset", token);
      // Returner minimum info — kun at tokenet er gyldig. Brukes av
      // reset-password-skjema for å vise "sett nytt passord"-form.
      apiSuccess(res, { valid: true, userId });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const token = mustBeNonEmptyString(req.params.token, "token");
      const newPassword = mustBeNonEmptyString(req.body?.newPassword, "newPassword");
      const { userId, tokenId } = await authTokenService.validate("password-reset", token);
      // Consume først så en mislykket setPassword ikke etterlater tokenet
      // gjenbrukbart. setPassword revoker sesjoner som side-effekt.
      await authTokenService.consume("password-reset", tokenId);
      await platformService.setPassword(userId, newPassword);
      apiSuccess(res, { reset: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/verify-email/:token", async (req, res) => {
    try {
      const token = mustBeNonEmptyString(req.params.token, "token");
      const { userId, tokenId } = await authTokenService.validate("email-verify", token);
      await authTokenService.consume("email-verify", tokenId);
      await platformService.markEmailVerified(userId);
      apiSuccess(res, { verified: true });
    } catch (error) {
      apiFailure(res, error);
    }
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
