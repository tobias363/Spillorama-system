/**
 * BIN-583 B3.1: agent-side endepunkter — auth + shift + self-service.
 *
 * Endepunkter:
 *   POST /api/agent/auth/login            — agent-login (wraps platform)
 *   POST /api/agent/auth/logout           — revoker access-token
 *   GET  /api/agent/auth/me               — agent-profil + halls
 *   PUT  /api/agent/auth/me               — oppdater egen profil
 *   POST /api/agent/auth/change-password  — endre eget passord
 *   POST /api/agent/auth/change-avatar    — sett avatar-filnavn
 *   POST /api/agent/auth/update-language  — språk (nb/nn/en/sv/da)
 *   POST /api/agent/shift/start           — åpne shift i valgt hall
 *   POST /api/agent/shift/end             — avslutt aktiv shift  *
 *   GET  /api/agent/shift/current         — hent aktiv shift
 *   GET  /api/agent/shift/history         — paginert shift-logg
 *   POST /api/agent/shift/logout          — Gap #9: logout med checkbox-flagg  *
 *   GET  /api/agent/shift/pending-cashouts — Gap #9: pending cashouts for logout-modal
 *
 *   * P0-2 (REGULATORISK — pengespillforskriften): /shift/end OG /shift/logout
 *     blokkerer terminering hvis det ikke finnes en `app_shift_settlements`-rad
 *     for inneværende skift. Klienten må først kalle /shift/close-day
 *     (createAgentSettlementRouter) for å fullføre Settlement Report. Hvis
 *     blokkert, returneres 400 SETTLEMENT_REQUIRED_BEFORE_LOGOUT og
 *     audit-event `agent.shift.terminate_blocked_no_settlement` skrives.
 *
 * Audit-log-hooks:
 *   - Alle handlinger logges via AuditLogService med actor_type='AGENT'
 *     (migrasjon 20260418220300 har lagt til verdien i CHECK).
 *   - Avatar-endring i B3.1 lagrer kun filnavn; selve filopplasting er
 *     admin-flyt (SFTP/S3). Ports legacy agentChangeAvatar som "set
 *     avatar-reference", ikke multipart-upload.
 *   - P0-2: `agent.shift.terminate_blocked_no_settlement` skrives ved hver
 *     blokkert /shift/end- eller /shift/logout-request — Lotteritilsynet-bevis.
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AgentSettlementService } from "../agent/AgentSettlementService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-router" });

export interface AgentRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  auditLogService: AuditLogService;
  /**
   * P0-2 (REGULATORISK — pengespillforskriften): brukes til å verifisere at
   * det finnes en `app_shift_settlements`-rad for inneværende skift FØR
   * `/shift/end` eller `/shift/logout` får terminere skiftet. Optional for
   * backwards-compat med test-rigger som ikke trenger settlement-enforcement;
   * produksjon (apps/backend/src/index.ts) skal alltid injisere denne. Hvis
   * `undefined`, hopp over enforcement (legacy-modus, kun i unit-tester).
   */
  agentSettlementService?: AgentSettlementService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

export function createAgentRouter(deps: AgentRouterDeps): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    auditLogService,
    agentSettlementService,
  } = deps;
  const router = express.Router();

  async function requireAgent(req: express.Request): Promise<{
    userId: string;
    role: UserRole;
    email: string;
  }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    if (user.role !== "AGENT") {
      throw new DomainError("FORBIDDEN", "Kun agenter har tilgang til dette endepunktet.");
    }
    // Defense-in-depth: deaktivert agent skal ikke ha gyldig tilgang.
    await agentService.requireActiveAgent(user.id);
    return { userId: user.id, role: user.role, email: user.email };
  }

  /**
   * P0-2 (REGULATORISK — pengespillforskriften): kontrollerer at skiftet har
   * en `app_shift_settlements`-rad før termination tillates. Audit-logger
   * blokkering så Lotteritilsynet kan se at vi enforcer kravet.
   *
   * Returnerer hvis settlement finnes ELLER hvis service ikke er injisert
   * (legacy-modus for tester). Kaster `SETTLEMENT_REQUIRED_BEFORE_LOGOUT`
   * hvis settlement mangler.
   */
  async function requireSettlementBeforeTermination(
    req: express.Request,
    actor: { userId: string; role: UserRole },
    shiftId: string,
    routeAction: string
  ): Promise<void> {
    if (!agentSettlementService) {
      // Legacy-modus / test-rigg uten settlement-tjeneste — hopp over.
      return;
    }
    const settlement = await agentSettlementService.getSettlementByShiftId(shiftId);
    if (settlement) {
      return; // settlement finnes — termination kan fortsette
    }
    // Audit fail-closed: regulatorisk-bevis på at vi blokkerte.
    void auditLogService.record({
      actorId: actor.userId,
      actorType: "AGENT",
      action: "agent.shift.terminate_blocked_no_settlement",
      resource: "shift",
      resourceId: shiftId,
      details: {
        attemptedRoute: routeAction,
        reason: "settlement_required_before_logout",
      },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    throw new DomainError(
      "SETTLEMENT_REQUIRED_BEFORE_LOGOUT",
      "Du må fullføre Settlement (POST /api/agent/shift/close-day) før du kan logge ut. Pengespillforskriften krever skift-oppgjør før termination."
    );
  }

  // ── POST /api/agent/auth/login ──────────────────────────────────────────
  router.post("/api/agent/auth/login", async (req, res) => {
    try {
      const email = mustBeNonEmptyString(req.body?.email, "email");
      const password = mustBeNonEmptyString(req.body?.password, "password");
      const session = await platformService.login({ email, password });
      if (session.user.role !== "AGENT") {
        // Revoker token med en gang slik at login via feil endepunkt ikke
        // etterlater en gyldig session.
        await platformService.logout(session.accessToken).catch(() => {});
        void auditLogService.record({
          actorId: session.user.id,
          actorType: "SYSTEM",
          action: "agent.login.fail",
          resource: "user",
          resourceId: session.user.id,
          details: { reason: "not-an-agent", role: session.user.role },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        throw new DomainError("FORBIDDEN", "Kun agenter kan logge inn her.");
      }
      // Verifiser agent_status=active (fail-closed).
      const profile = await agentService.requireActiveAgent(session.user.id);
      void auditLogService.record({
        actorId: session.user.id,
        actorType: "AGENT",
        action: "agent.login",
        resource: "user",
        resourceId: session.user.id,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        user: session.user,
        agent: profile,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "INVALID_CREDENTIALS") {
        void auditLogService.record({
          actorId: null,
          actorType: "SYSTEM",
          action: "agent.login.fail",
          resource: "user",
          resourceId: null,
          details: { reason: "invalid-credentials" },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/auth/logout ─────────────────────────────────────────
  router.post("/api/agent/auth/logout", async (req, res) => {
    try {
      const token = getAccessTokenFromRequest(req);
      const user = await platformService.getUserFromAccessToken(token).catch(() => null);
      await platformService.logout(token);
      if (user) {
        void auditLogService.record({
          actorId: user.id,
          actorType: "AGENT",
          action: "agent.logout",
          resource: "user",
          resourceId: user.id,
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, { loggedOut: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/auth/me ──────────────────────────────────────────────
  router.get("/api/agent/auth/me", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const profile = await agentService.getById(actor.userId);
      apiSuccess(res, profile);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PUT /api/agent/auth/me ──────────────────────────────────────────────
  router.put("/api/agent/auth/me", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const body = req.body ?? {};
      // Selv-service-whitelist: agent kan kun endre displayName, email, phone.
      const allowed = ["displayName", "email", "phone"] as const;
      const patch: Record<string, unknown> = {};
      for (const key of allowed) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      // Eksplisitt avvis felter som ikke er self-service.
      for (const forbidden of ["role", "hallIds", "primaryHallId", "agentStatus", "parentUserId"]) {
        if (body[forbidden] !== undefined) {
          throw new DomainError("FORBIDDEN", `Feltet ${forbidden} kan ikke endres av agenten selv.`);
        }
      }
      const updated = await agentService.updateAgent(actor.userId, patch, {
        role: actor.role,
        userId: actor.userId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.profile.update",
        resource: "user",
        resourceId: actor.userId,
        details: { fields: Object.keys(patch) },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/auth/change-password ────────────────────────────────
  router.post("/api/agent/auth/change-password", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const oldPassword = mustBeNonEmptyString(req.body?.oldPassword, "oldPassword");
      const newPassword = mustBeNonEmptyString(req.body?.newPassword, "newPassword");
      // Verifiser gammelt passord ved å forsøke login med agentens e-post.
      // Enklere enn å duplisere scrypt-logikken her.
      await platformService.login({ email: actor.email, password: oldPassword }).catch(() => {
        throw new DomainError("INVALID_CREDENTIALS", "Feil gammelt passord.");
      });
      await platformService.setUserPassword(actor.userId, newPassword);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.password.change",
        resource: "user",
        resourceId: actor.userId,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { changed: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/auth/change-avatar ──────────────────────────────────
  router.post("/api/agent/auth/change-avatar", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const avatarFilename = mustBeNonEmptyString(req.body?.avatarFilename, "avatarFilename");
      // Begrens til enkel whitelist — punktum, bokstaver, tall, bindestrek.
      if (!/^[\w.-]{1,128}$/.test(avatarFilename)) {
        throw new DomainError("INVALID_AVATAR_FILENAME", "avatarFilename inneholder ugyldige tegn.");
      }
      const updated = await agentService.updateAgent(actor.userId, { avatarFilename }, actor);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.avatar.change",
        resource: "user",
        resourceId: actor.userId,
        details: { avatarFilename },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/auth/update-language ────────────────────────────────
  router.post("/api/agent/auth/update-language", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const language = mustBeNonEmptyString(req.body?.language, "language");
      const updated = await agentService.updateAgent(actor.userId, { language }, actor);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.language.change",
        resource: "user",
        resourceId: actor.userId,
        details: { language: updated.language },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, updated);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/shift/start ─────────────────────────────────────────
  router.post("/api/agent/shift/start", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const shift = await agentShiftService.startShift({
        userId: actor.userId,
        hallId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.shift.start",
        resource: "shift",
        resourceId: shift.id,
        details: { hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, shift);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/shift/end ───────────────────────────────────────────
  // P0-2 (REGULATORISK — pengespillforskriften): blokkerer hvis settlement
  // mangler. Agenten må først kalle POST /api/agent/shift/close-day for å
  // fullføre Settlement Report. Returnerer 400 SETTLEMENT_REQUIRED_BEFORE_LOGOUT
  // og skriver audit-event `agent.shift.terminate_blocked_no_settlement` ved
  // blokkering (Lotteritilsynet-bevis).
  router.post("/api/agent/shift/end", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      // Agenten kan avslutte uten å oppgi shiftId — vi slår opp aktiv
      // shift. ADMIN kan force-close med eksplisitt shiftId (håndteres
      // i egen admin-endepunkt — her kun eier-flyt).
      const active = await agentShiftService.getCurrentShift(actor.userId);
      if (!active) {
        throw new DomainError("NO_ACTIVE_SHIFT", "Du har ingen aktiv shift.");
      }
      // P0-2: blokker hvis settlement mangler.
      await requireSettlementBeforeTermination(
        req,
        { userId: actor.userId, role: actor.role },
        active.id,
        "POST /api/agent/shift/end"
      );
      const ended = await agentShiftService.endShift({
        shiftId: active.id,
        actor: { userId: actor.userId, role: actor.role },
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.shift.end",
        resource: "shift",
        resourceId: ended.id,
        details: {
          hallId: ended.hallId,
          durationSeconds: Math.floor(
            (new Date(ended.endedAt ?? Date.now()).getTime() -
              new Date(ended.startedAt).getTime()) / 1000
          ),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, ended);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/current ────────────────────────────────────────
  router.get("/api/agent/shift/current", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      apiSuccess(res, { shift });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/history ────────────────────────────────────────
  router.get("/api/agent/shift/history", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const limit = parseLimit(req.query?.limit, 50);
      const offsetRaw = req.query?.offset;
      const offset = typeof offsetRaw === "string" ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0) : 0;
      const shifts = await agentShiftService.getHistory(actor.userId, { limit, offset });
      apiSuccess(res, { shifts, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/shift/logout ────────────────────────────────────────
  // Wireframe Gap #9 (PDF 17.6): logout med opt-in checkbox-flagg.
  //
  // Body-shape:
  //   { distributeWinnings?: boolean,
  //     transferRegisterTickets?: boolean,
  //     logoutNotes?: string | null }
  //
  // Uten flagg = backwards-compat med eksisterende /shift/end-flyt. Med
  // flagg = pending cashouts og/eller ticket-ranges merkes for overtagelse
  // av neste agent.
  //
  // P0-2 (REGULATORISK — pengespillforskriften): blokkerer hvis settlement
  // mangler. Samme regulatoriske kontrakt som /shift/end over — agent må
  // først kalle /shift/close-day. Audit-event
  // `agent.shift.terminate_blocked_no_settlement` skrives ved blokkering.
  router.post("/api/agent/shift/logout", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const body = (req.body ?? {}) as {
        distributeWinnings?: unknown;
        transferRegisterTickets?: unknown;
        logoutNotes?: unknown;
      };
      const flags: {
        distributeWinnings?: boolean;
        transferRegisterTickets?: boolean;
        logoutNotes?: string | null;
      } = {};
      if (body.distributeWinnings !== undefined) {
        flags.distributeWinnings = Boolean(body.distributeWinnings);
      }
      if (body.transferRegisterTickets !== undefined) {
        flags.transferRegisterTickets = Boolean(body.transferRegisterTickets);
      }
      if (body.logoutNotes !== undefined) {
        flags.logoutNotes = typeof body.logoutNotes === "string"
          ? body.logoutNotes.slice(0, 1000)
          : null;
      }
      // P0-2 (REGULATORISK): blokker hvis settlement mangler. Slår opp aktiv
      // shift først for å få shiftId; service.logout gjør samme oppslag, men
      // vi trenger ID for settlement-sjekken.
      const active = await agentShiftService.getCurrentShift(actor.userId);
      if (!active) {
        throw new DomainError("NO_ACTIVE_SHIFT", "Du har ingen aktiv shift.");
      }
      await requireSettlementBeforeTermination(
        req,
        { userId: actor.userId, role: actor.role },
        active.id,
        "POST /api/agent/shift/logout"
      );
      const result = await agentShiftService.logout(actor.userId, flags);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.shift.logout",
        resource: "shift",
        resourceId: result.shift.id,
        details: {
          hallId: result.shift.hallId,
          distributeWinnings: flags.distributeWinnings ?? false,
          transferRegisterTickets: flags.transferRegisterTickets ?? false,
          pendingCashoutsFlagged: result.pendingCashoutsFlagged,
          ticketRangesFlagged: result.ticketRangesFlagged,
          hasLogoutNotes: typeof flags.logoutNotes === "string" && flags.logoutNotes.length > 0,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        shift: result.shift,
        pendingCashoutsFlagged: result.pendingCashoutsFlagged,
        ticketRangesFlagged: result.ticketRangesFlagged,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/shift/pending-cashouts ───────────────────────────────
  // Wireframe Gap #9: "View Cashout Details"-lenke i logout-popup.
  router.get("/api/agent/shift/pending-cashouts", async (req, res) => {
    try {
      const actor = await requireAgent(req);
      const pendingCashouts = await agentShiftService.listPendingCashouts(actor.userId);
      apiSuccess(res, { pendingCashouts, count: pendingCashouts.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-router initialised (13 endpoints)");
  return router;
}
