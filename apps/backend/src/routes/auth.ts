import express from "express";
import type { Pool } from "pg";
import type { PlatformService } from "../platform/PlatformService.js";
import type { BankIdKycAdapter } from "../adapters/BankIdKycAdapter.js";
import type { AuthTokenService } from "../auth/AuthTokenService.js";
import type { UserPinService } from "../auth/UserPinService.js";
import { normalizeNorwegianPhone } from "../auth/phoneValidation.js";
import type { TwoFactorService } from "../auth/TwoFactorService.js";
import type { SessionService } from "../auth/SessionService.js";
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
  /**
   * REQ-130 (PDF 9 Frontend CR): PIN-login support. Optional — endpoints
   * /api/auth/login-phone, /api/auth/pin/* returnerer PIN_NOT_CONFIGURED
   * hvis ikke wired opp.
   */
  userPinService?: UserPinService;
  /** REQ-129: TOTP-basert two-factor. Når satt aktiveres /api/auth/2fa/* endepunktene og login krever TOTP for brukere med 2FA aktivert. */
  twoFactorService?: TwoFactorService;
  /** REQ-132: Active sessions + 30-min inactivity-timeout. Når satt aktiveres /api/auth/sessions/* endepunktene og recordLogin kalles på login. */
  sessionService?: SessionService;
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
    userPinService,
    twoFactorService,
    sessionService,
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
    // REQ-132: 30-min inactivity-timeout. touchActivity revoker sesjonen
    // og kaster SESSION_TIMED_OUT hvis grensen er overskredet — kastet
    // før getUserFromAccessToken så klient får riktig feilkode.
    if (sessionService) {
      await sessionService.touchActivity(accessToken);
    }
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

      // REQ-129: 2FA-flyt. Hvis 2FA er aktivert, verifiser kun passordet
      // her og returner en challenge — sesjonen opprettes først etter at
      // klienten har sendt TOTP-koden via /api/auth/2fa/login.
      if (twoFactorService) {
        const { userId } = await platformService.verifyCredentialsWithoutSession({
          email,
          password,
        });
        const enabled = await twoFactorService.isEnabled(userId);
        if (enabled) {
          const challenge = await twoFactorService.createChallenge(userId);
          // Skriv login-attempt-audit allerede her så vi har spor av at
          // passordet matchet selv om TOTP ikke er fullført ennå.
          fireLoginAudit({
            actorId: userId,
            actorType: "USER",
            action: "auth.login.2fa.challenge_issued",
            resource: "session",
            resourceId: null,
            ipAddress,
            userAgent,
          });
          apiSuccess(res, {
            requires2FA: true,
            challengeId: challenge.challengeId,
            challengeExpiresAt: challenge.expiresAt,
          });
          return;
        }
      }

      const session = await platformService.login({
        email,
        password
      });
      // REQ-132: persist user-agent + IP på sesjonen.
      if (sessionService) {
        try {
          await sessionService.recordLogin({
            accessToken: session.accessToken,
            userAgent,
            ipAddress,
          });
        } catch (err) {
          logger.warn({ err }, "[REQ-132] recordLogin feilet (ikke-fatal)");
        }
      }
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

  // ── REQ-130 (PDF 9 Frontend CR): Phone+PIN-login ──────────────────────
  //
  // /api/auth/login-phone — alternativ til /api/auth/login som tar
  //                          { phone, pin } i stedet for { email, password }.
  // /api/auth/pin/setup    — auth'd: aktiver/oppdater PIN.
  // /api/auth/pin/disable  — auth'd: krever passord, sletter PIN.
  // /api/auth/pin/status   — auth'd: hent PIN-status (enabled/locked).

  router.post("/api/auth/login-phone", async (req, res) => {
    const ipAddress = clientIp(req);
    const userAgent = requestUserAgent(req);
    let phoneForAudit: string | null = null;
    try {
      if (!userPinService) {
        throw new DomainError(
          "PIN_NOT_CONFIGURED",
          "PIN-innlogging er ikke aktivert på serveren."
        );
      }
      // Phone + PIN er begge påkrevd — normaliser før vi gjør noe annet.
      const phoneE164 = normalizeNorwegianPhone(req.body?.phone);
      phoneForAudit = phoneE164;
      const pinRaw = mustBeNonEmptyString(req.body?.pin, "pin");

      const user = await platformService.findUserByPhoneE164(phoneE164);
      if (!user) {
        // Enumeration-safe: ikke skille mellom "ingen bruker" og "feil PIN"
        // mot eksterne kallere. Logg internt slik at admin kan triage.
        logger.warn(
          { maskedPhone: maskPhone(phoneE164) },
          "[REQ-130] login-phone: ukjent eller ikke-unikt telefonnummer"
        );
        // Selv om vi ikke har bruker, skal vi bruke fast tid for å
        // unngå timing-avsløring. UserPinService.verifyPin kjører
        // scrypt selv ved ukjent userId; vi simulerer kostnaden ved
        // å kalle verifyPin med en fiktiv ID — får det til å kaste
        // INVALID_CREDENTIALS uansett.
        try {
          await userPinService.verifyPin("__nonexistent__", pinRaw);
        } catch {
          // Bevisst suppress — vi er allerede i feil-flyt.
        }
        throw new DomainError("INVALID_CREDENTIALS", "Ugyldig telefon eller PIN.");
      }

      // verifyPin kaster ved feil. Hvis OK fortsetter vi til session.
      await userPinService.verifyPin(user.id, pinRaw);

      const session = await platformService.createSessionForPinLogin(user.id);
      fireLoginAudit({
        actorId: session.user.id,
        actorType: "USER",
        action: "auth.login",
        resource: "session",
        resourceId: null,
        details: { method: "phone-pin" },
        ipAddress,
        userAgent,
      });
      apiSuccess(res, session);
    } catch (error) {
      const failureReason = error instanceof DomainError ? error.code : "UNKNOWN";
      // Forsøk å resolve actorId hvis vi har funnet en bruker (PIN_LOCKED-
      // tilfellet). Ved ukjent telefon hopper vi over.
      let failedActorId: string | null = null;
      if (phoneForAudit) {
        try {
          const existing = await platformService.findUserByPhoneE164(phoneForAudit);
          failedActorId = existing?.id ?? null;
        } catch {
          // Audit-trail er best-effort.
        }
      }
      fireLoginAudit({
        actorId: failedActorId,
        actorType: "USER",
        action: "auth.login.failed",
        resource: "session",
        resourceId: null,
        details: { method: "phone-pin", failureReason },
        ipAddress,
        userAgent,
      });
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/pin/setup", async (req, res) => {
    try {
      if (!userPinService) {
        throw new DomainError(
          "PIN_NOT_CONFIGURED",
          "PIN-innlogging er ikke aktivert på serveren."
        );
      }
      const user = await getAuthenticatedUser(req);
      const pin = mustBeNonEmptyString(req.body?.pin, "pin");
      await userPinService.setupPin(user.id, pin);
      const status = await userPinService.getStatus(user.id);
      apiSuccess(res, { enabled: status.enabled });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/auth/pin/disable", async (req, res) => {
    try {
      if (!userPinService) {
        throw new DomainError(
          "PIN_NOT_CONFIGURED",
          "PIN-innlogging er ikke aktivert på serveren."
        );
      }
      const user = await getAuthenticatedUser(req);
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const ok = await platformService.verifyCurrentPassword(user.id, password);
      if (!ok) {
        throw new DomainError(
          "INVALID_CREDENTIALS",
          "Passord er feil."
        );
      }
      await userPinService.disablePin(user.id);
      apiSuccess(res, { disabled: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/auth/pin/status", async (req, res) => {
    try {
      if (!userPinService) {
        // Ikke en feil — returner et "ikke konfigurert"-objekt.
        apiSuccess(res, {
          enabled: false,
          locked: false,
          lockedUntil: null,
          failedAttempts: 0,
          lastUsedAt: null,
          configured: false,
        });
        return;
      }
      const user = await getAuthenticatedUser(req);
      const status = await userPinService.getStatus(user.id);
      apiSuccess(res, { ...status, configured: true });
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

  // ── REQ-129: 2FA / TOTP ─────────────────────────────────────────────────
  //
  // Endepunkter aktiveres kun når twoFactorService er injisert i deps.
  // Setup-flow:
  //   POST /api/auth/2fa/setup        — generer pending_secret + otpauth-URI
  //   POST /api/auth/2fa/verify       — verify pending_secret + enable + 10 backup-codes
  // Login-flow (initiert fra /api/auth/login):
  //   POST /api/auth/2fa/login        — sender { challengeId, code } -> session
  // Disable + status:
  //   POST /api/auth/2fa/disable      — krever passord OG TOTP-kode
  //   GET  /api/auth/2fa/status       — read-only status (enabled, backupCodesRemaining)
  //   POST /api/auth/2fa/backup-codes/regenerate — krever passord; returnerer 10 nye

  if (twoFactorService) {
    const tfa = twoFactorService;

    router.post("/api/auth/2fa/setup", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const result = await tfa.setup({
          userId: user.id,
          accountLabel: user.email,
        });
        apiSuccess(res, {
          secret: result.secret,
          otpauthUri: result.otpauthUri,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/2fa/verify", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const code = mustBeNonEmptyString(req.body?.code, "code");
        const { backupCodes } = await tfa.verifyAndEnable({
          userId: user.id,
          code,
        });
        fireLoginAudit({
          actorId: user.id,
          actorType: "USER",
          action: "auth.2fa.enabled",
          resource: "user",
          resourceId: user.id,
          ipAddress: clientIp(req),
          userAgent: requestUserAgent(req),
        });
        apiSuccess(res, { enabled: true, backupCodes });
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/2fa/login", async (req, res) => {
      const ipAddress = clientIp(req);
      const userAgent = requestUserAgent(req);
      try {
        const challengeId = mustBeNonEmptyString(req.body?.challengeId, "challengeId");
        const code = mustBeNonEmptyString(req.body?.code, "code");
        const { userId } = await tfa.consumeChallenge(challengeId);
        try {
          await tfa.verifyTotpForLogin({ userId, code });
        } catch (err) {
          fireLoginAudit({
            actorId: userId,
            actorType: "USER",
            action: "auth.login.2fa.failed",
            resource: "session",
            resourceId: null,
            details: {
              failureReason: err instanceof DomainError ? err.code : "UNKNOWN",
            },
            ipAddress,
            userAgent,
          });
          throw err;
        }
        const session = await platformService.issueSessionForUser(userId);
        if (sessionService) {
          try {
            await sessionService.recordLogin({
              accessToken: session.accessToken,
              userAgent,
              ipAddress,
            });
          } catch (err) {
            logger.warn({ err }, "[REQ-132] recordLogin (2fa-login) feilet");
          }
        }
        fireLoginAudit({
          actorId: userId,
          actorType: "USER",
          action: "auth.login",
          resource: "session",
          resourceId: null,
          details: { method: "totp" },
          ipAddress,
          userAgent,
        });
        apiSuccess(res, session);
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/2fa/disable", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const password = mustBeNonEmptyString(req.body?.password, "password");
        const code = mustBeNonEmptyString(req.body?.code, "code");
        // Defense-in-depth: krever både korrekt passord og TOTP-kode.
        const passwordOk = await platformService.verifyUserPassword(user.id, password);
        if (!passwordOk) {
          throw new DomainError("INVALID_CREDENTIALS", "Feil passord.");
        }
        await tfa.disable({ userId: user.id, code });
        fireLoginAudit({
          actorId: user.id,
          actorType: "USER",
          action: "auth.2fa.disabled",
          resource: "user",
          resourceId: user.id,
          ipAddress: clientIp(req),
          userAgent: requestUserAgent(req),
        });
        apiSuccess(res, { disabled: true });
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.get("/api/auth/2fa/status", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const status = await tfa.getStatus(user.id);
        apiSuccess(res, status);
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/2fa/backup-codes/regenerate", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const password = mustBeNonEmptyString(req.body?.password, "password");
        const passwordOk = await platformService.verifyUserPassword(user.id, password);
        if (!passwordOk) {
          throw new DomainError("INVALID_CREDENTIALS", "Feil passord.");
        }
        const { backupCodes } = await tfa.regenerateBackupCodes(user.id);
        fireLoginAudit({
          actorId: user.id,
          actorType: "USER",
          action: "auth.2fa.backup_codes_regenerated",
          resource: "user",
          resourceId: user.id,
          ipAddress: clientIp(req),
          userAgent: requestUserAgent(req),
        });
        apiSuccess(res, { backupCodes });
      } catch (error) {
        apiFailure(res, error);
      }
    });
  }

  // ── REQ-132: Active sessions + logout-all ──────────────────────────────
  //
  //   GET  /api/auth/sessions               — list aktive (med isCurrent-flagg)
  //   POST /api/auth/sessions/logout-all    — revoke alle (beholder gjeldende default)
  //   POST /api/auth/sessions/:id/logout    — revoke spesifikk (må eies av bruker)

  if (sessionService) {
    const sess = sessionService;

    router.get("/api/auth/sessions", async (req, res) => {
      try {
        const accessToken = getAccessTokenFromRequest(req);
        // Touch + auth-check inline (ikke gå via getAuthenticatedUser så vi
        // har tilgang til accessToken for isCurrent-flagg).
        await sess.touchActivity(accessToken);
        const user = await platformService.getUserFromAccessToken(accessToken);
        const sessions = await sess.listActiveSessions({
          userId: user.id,
          currentAccessToken: accessToken,
        });
        apiSuccess(res, { sessions });
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/sessions/logout-all", async (req, res) => {
      try {
        const accessToken = getAccessTokenFromRequest(req);
        await sess.touchActivity(accessToken);
        const user = await platformService.getUserFromAccessToken(accessToken);
        // Default: behold nåværende sesjon ("logout everywhere except here").
        // Klienten kan be eksplisitt om å logge ut alle inkl. nåværende
        // ved å sende { includeCurrent: true }.
        const includeCurrent = req.body?.includeCurrent === true;
        const result = await sess.logoutAll({
          userId: user.id,
          exceptAccessToken: includeCurrent ? null : accessToken,
        });
        fireLoginAudit({
          actorId: user.id,
          actorType: "USER",
          action: "auth.sessions.logout_all",
          resource: "user",
          resourceId: user.id,
          details: { count: result.count, includeCurrent },
          ipAddress: clientIp(req),
          userAgent: requestUserAgent(req),
        });
        apiSuccess(res, { count: result.count });
      } catch (error) {
        apiFailure(res, error);
      }
    });

    router.post("/api/auth/sessions/:id/logout", async (req, res) => {
      try {
        const user = await getAuthenticatedUser(req);
        const sessionId = mustBeNonEmptyString(req.params.id, "id");
        await sess.logoutSession({ userId: user.id, sessionId });
        fireLoginAudit({
          actorId: user.id,
          actorType: "USER",
          action: "auth.sessions.logout_one",
          resource: "session",
          resourceId: sessionId,
          ipAddress: clientIp(req),
          userAgent: requestUserAgent(req),
        });
        apiSuccess(res, { loggedOut: true });
      } catch (error) {
        apiFailure(res, error);
      }
    });
  }

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
