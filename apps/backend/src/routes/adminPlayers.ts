/**
 * BIN-587 B2.2 + B2.3: admin-endepunkter for KYC-moderasjon og player
 * lifecycle.
 *
 * Separert fra `admin.ts` for å holde den filen overkommelig; logisk
 * gruppert rundt spiller-lifecycle-ressursen.
 *
 * B2.2 (KYC-moderasjon):
 *   GET    /api/admin/players/pending
 *   GET    /api/admin/players/rejected
 *   POST   /api/admin/players/:id/approve
 *   POST   /api/admin/players/:id/reject
 *   POST   /api/admin/players/:id/resubmit
 *   GET    /api/admin/players/:id
 *   GET    /api/admin/players/:id/audit
 *   PUT    /api/admin/players/:id/kyc-status
 *
 * B2.3 (lifecycle):
 *   GET    /api/admin/players/search?query=...
 *   GET    /api/admin/players/export.csv
 *   POST   /api/admin/players/bulk-import
 *   GET    /api/admin/players/:id/hall-status
 *   PUT    /api/admin/players/:id/hall-status
 *   POST   /api/admin/players/:id/soft-delete
 *   POST   /api/admin/players/:id/restore
 *   POST   /api/admin/players/:id/bankid-reverify
 *
 * Alle mutasjoner logges til AuditLogService og sender tilsvarende
 * e-post til spilleren (godkjent/avvist). E-post er fire-and-forget
 * så en SMTP-feil aldri blokkerer moderasjons-handlingen.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  KycStatus,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { EmailService } from "../integration/EmailService.js";
import type { BankIdKycAdapter } from "../adapters/BankIdKycAdapter.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { parseCsv } from "../util/csvImport.js";
import { exportCsv, type CsvColumn } from "../util/csvExport.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-players" });

export interface AdminPlayersRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  emailService: EmailService;
  /** BIN-587 B2.3: for bankid-reverify. Null hvis BankID ikke er konfigurert. */
  bankIdAdapter: BankIdKycAdapter | null;
  /** Base-URL brukt til å bygge resubmit-lenker (sendt i reject-e-post). */
  webBaseUrl: string;
  supportEmail: string;
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

/**
 * Offentlig DTO for spiller-lister — strips ut felt som ikke hører hjemme
 * i moderator-UI (ingen wallet-transaksjoner/sesjonsdetaljer her).
 */
function publicPlayerSummary(user: {
  id: string;
  email: string;
  displayName: string;
  surname?: string;
  phone?: string;
  kycStatus: KycStatus;
  birthDate?: string;
  kycVerifiedAt?: string;
  kycProviderRef?: string;
  hallId: string | null;
  createdAt: string;
  updatedAt: string;
  complianceData?: Record<string, unknown>;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    surname: user.surname ?? null,
    phone: user.phone ?? null,
    kycStatus: user.kycStatus,
    birthDate: user.birthDate ?? null,
    kycVerifiedAt: user.kycVerifiedAt ?? null,
    kycProviderRef: user.kycProviderRef ?? null,
    hallId: user.hallId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    complianceData: user.complianceData ?? null,
  };
}

function parseKycStatus(raw: unknown): KycStatus {
  const s = mustBeNonEmptyString(raw, "status").toUpperCase();
  if (s === "UNVERIFIED" || s === "PENDING" || s === "VERIFIED" || s === "REJECTED") {
    return s;
  }
  throw new DomainError("INVALID_INPUT", "status må være UNVERIFIED, PENDING, VERIFIED eller REJECTED.");
}

function parseReason(raw: unknown, field = "reason"): string {
  const r = mustBeNonEmptyString(raw, field);
  if (r.length > 500) {
    throw new DomainError("INVALID_INPUT", `${field} er for lang (maks 500 tegn).`);
  }
  return r;
}

export function createAdminPlayersRouter(deps: AdminPlayersRouterDeps): express.Router {
  const {
    platformService,
    auditLogService,
    emailService,
    bankIdAdapter,
    webBaseUrl,
    supportEmail,
  } = deps;
  const router = express.Router();

  async function requireAdminPermissionUser(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  function fireAudit(event: Parameters<AuditLogService["record"]>[0]): void {
    auditLogService.record(event).catch((err) => {
      logger.warn({ err, action: event.action }, "[BIN-587 B2.2] audit append failed");
    });
  }

  async function sendKycEmail(
    kind: "approved" | "rejected",
    user: { email: string; displayName: string },
    opts?: { reason?: string }
  ): Promise<void> {
    const base = webBaseUrl.replace(/\/+$/, "");
    try {
      if (kind === "approved") {
        await emailService.sendTemplate({
          to: user.email,
          template: "kyc-approved",
          context: { username: user.displayName, supportEmail },
        });
      } else {
        await emailService.sendTemplate({
          to: user.email,
          template: "kyc-rejected",
          context: {
            username: user.displayName,
            reason: opts?.reason ?? "",
            resubmitLink: `${base}/kyc/resubmit`,
            supportEmail,
          },
        });
      }
    } catch (err) {
      logger.warn({ err, kind, userId: user.email }, "[BIN-587 B2.2] KYC e-post failed (non-blocking)");
    }
  }

  // ── List endpoints ───────────────────────────────────────────────────────

  router.get("/api/admin/players/pending", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const limit = parseLimit(req.query.limit, 100);
      const players = await platformService.listUsersByKycStatus("PENDING", { limit });
      apiSuccess(res, {
        players: players.map((p) => publicPlayerSummary(p)),
        count: players.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/players/rejected", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const limit = parseLimit(req.query.limit, 100);
      const players = await platformService.listUsersByKycStatus("REJECTED", { limit });
      apiSuccess(res, {
        players: players.map((p) => publicPlayerSummary(p)),
        count: players.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Static-path endpoints MÅ komme før :id-rutene (route-matching) ───────

  router.get("/api/admin/players/search", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const query = mustBeNonEmptyString(req.query.query, "query");
      const limit = parseLimit(req.query.limit, 50);
      const includeDeleted =
        typeof req.query.includeDeleted === "string" &&
        ["1", "true", "yes"].includes(req.query.includeDeleted.toLowerCase());
      const players = await platformService.searchPlayers({ query, limit, includeDeleted });
      apiSuccess(res, {
        players: players.map((p) => publicPlayerSummary(p)),
        count: players.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/players/export.csv", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const kycStatusRaw = typeof req.query.kycStatus === "string" ? req.query.kycStatus.trim() : "";
      const kycStatus = kycStatusRaw ? parseKycStatus(kycStatusRaw) : undefined;
      const hallIdRaw = typeof req.query.hallId === "string" ? req.query.hallId.trim() : "";
      const hallId = hallIdRaw.length ? hallIdRaw : undefined;
      const limit = parseLimit(req.query.limit, 5000);
      const includeDeleted =
        typeof req.query.includeDeleted === "string" &&
        ["1", "true", "yes"].includes(req.query.includeDeleted.toLowerCase());
      const players = await platformService.listPlayersForExport({
        kycStatus,
        hallId,
        limit,
        includeDeleted,
      });
      const columns: CsvColumn<(typeof players)[number]>[] = [
        { header: "id", accessor: (p) => p.id },
        { header: "email", accessor: (p) => p.email },
        { header: "displayName", accessor: (p) => p.displayName },
        { header: "surname", accessor: (p) => p.surname ?? "" },
        { header: "phone", accessor: (p) => p.phone ?? "" },
        { header: "birthDate", accessor: (p) => p.birthDate ?? "" },
        { header: "kycStatus", accessor: (p) => p.kycStatus },
        { header: "hallId", accessor: (p) => p.hallId ?? "" },
        { header: "createdAt", accessor: (p) => p.createdAt },
      ];
      const csv = exportCsv(players, columns, { bom: true });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="players-export-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.status(200).send(csv);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/bulk-import", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_LIFECYCLE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const csvText = typeof req.body.csv === "string" ? req.body.csv : undefined;
      const rawRows = Array.isArray(req.body.rows) ? (req.body.rows as unknown[]) : undefined;
      let parsedRows: Array<Record<string, string>>;
      if (csvText) {
        const parsed = parseCsv(csvText, { trim: true });
        parsedRows = parsed.rows;
      } else if (rawRows) {
        parsedRows = rawRows.filter(isRecordObject).map((r) => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === "string") out[k] = v;
          }
          return out;
        });
      } else {
        throw new DomainError("INVALID_INPUT", "Oppgi enten 'csv' (string) eller 'rows' (array).");
      }
      if (parsedRows.length === 0) {
        throw new DomainError("INVALID_INPUT", "Ingen rader å importere.");
      }
      if (parsedRows.length > 1000) {
        throw new DomainError("INVALID_INPUT", "Maks 1000 rader per import.");
      }
      const summary = await platformService.bulkImportPlayers(parsedRows);
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "SUPPORT",
        action: "player.bulk_import",
        resource: "user",
        resourceId: null,
        details: {
          totalRows: parsedRows.length,
          imported: summary.imported,
          skipped: summary.skipped,
          errorCount: summary.errors.length,
          // Loggfør kun e-post-domener + rad-tall, ikke hele e-post-listen —
          // personvern: ADMIN audit skal ikke inneholde alle importerte
          // adresser i klartekst. Feilmeldinger logges i detalj.
          errors: summary.errors.map((e) => ({
            row: e.row,
            emailDomain: e.email && e.email.includes("@") ? e.email.split("@")[1] : null,
            error: e.error,
          })),
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        imported: summary.imported,
        skipped: summary.skipped,
        errors: summary.errors,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Detail + audit-history ───────────────────────────────────────────────

  router.get("/api/admin/players/:id", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const user = await platformService.getUserById(userId);
      apiSuccess(res, publicPlayerSummary(user));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/players/:id/audit", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const limit = parseLimit(req.query.limit, 100);
      // Sikre at brukeren faktisk finnes før vi avslører audit-hull.
      await platformService.getUserById(userId);
      const events = await auditLogService.list({
        resource: "user",
        resourceId: userId,
        limit,
      });
      apiSuccess(res, { events, count: events.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  router.post("/api/admin/players/:id/approve", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_KYC_MODERATE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const note = isRecordObject(req.body) && typeof req.body.note === "string"
        ? req.body.note.trim().slice(0, 500)
        : undefined;
      const updated = await platformService.approveKycAsAdmin({
        userId,
        actorId: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : actor.role === "SUPPORT" ? "SUPPORT" : "USER",
        action: "player.kyc.approve",
        resource: "user",
        resourceId: userId,
        details: {
          note: note ?? null,
          previousStatus: null, // kalleren kan trekke dette fra audit-historikken
          newStatus: "VERIFIED",
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      void sendKycEmail("approved", updated);
      apiSuccess(res, publicPlayerSummary(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/:id/reject", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_KYC_MODERATE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const reason = parseReason(req.body.reason);
      const updated = await platformService.rejectKycAsAdmin({
        userId,
        actorId: actor.id,
        reason,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : actor.role === "SUPPORT" ? "SUPPORT" : "USER",
        action: "player.kyc.reject",
        resource: "user",
        resourceId: userId,
        details: {
          reason,
          newStatus: "REJECTED",
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      void sendKycEmail("rejected", updated, { reason });
      apiSuccess(res, publicPlayerSummary(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/:id/resubmit", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_KYC_MODERATE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const updated = await platformService.resubmitKycAsAdmin({
        userId,
        actorId: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : actor.role === "SUPPORT" ? "SUPPORT" : "USER",
        action: "player.kyc.resubmit",
        resource: "user",
        resourceId: userId,
        details: {
          newStatus: "UNVERIFIED",
          note: "Admin reopened KYC for resubmit",
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, publicPlayerSummary(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/players/:id/kyc-status", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_KYC_OVERRIDE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const status = parseKycStatus(req.body.status);
      const reason = parseReason(req.body.reason);
      const updated = await platformService.overrideKycStatusAsAdmin({
        userId,
        actorId: actor.id,
        status,
        reason,
      });
      fireAudit({
        actorId: actor.id,
        actorType: "ADMIN",
        action: "player.kyc.override",
        resource: "user",
        resourceId: userId,
        details: {
          reason,
          newStatus: status,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, publicPlayerSummary(updated));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── B2.3: Lifecycle — hall-status, soft-delete, bankid-reverify ─────────

  router.get("/api/admin/players/:id/hall-status", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PLAYER_KYC_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      await platformService.getUserById(userId); // 404 hvis ukjent
      const statuses = await platformService.listPlayerHallStatus(userId);
      apiSuccess(res, { statuses, count: statuses.length });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/players/:id/hall-status", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_LIFECYCLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      if (typeof req.body.isActive !== "boolean") {
        throw new DomainError("INVALID_INPUT", "isActive må være boolean.");
      }
      const reason =
        typeof req.body.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 500)
          : null;
      const result = await platformService.setPlayerHallStatus({
        userId,
        hallId,
        isActive: req.body.isActive,
        reason,
        actorId: actor.id,
      });
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "SUPPORT",
        action: "player.hall_status.set",
        resource: "user",
        resourceId: userId,
        details: {
          hallId,
          isActive: req.body.isActive,
          reason,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/:id/soft-delete", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_LIFECYCLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const reason =
        isRecordObject(req.body) && typeof req.body.reason === "string"
          ? req.body.reason.trim().slice(0, 500)
          : null;
      await platformService.softDeletePlayer(userId);
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "SUPPORT",
        action: "player.soft_delete",
        resource: "user",
        resourceId: userId,
        details: { reason },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { softDeleted: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/:id/restore", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_LIFECYCLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      await platformService.restorePlayer(userId);
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "SUPPORT",
        action: "player.restore",
        resource: "user",
        resourceId: userId,
        details: {},
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { restored: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/players/:id/bankid-reverify", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "PLAYER_LIFECYCLE_WRITE");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const updated = await platformService.resetKycForReverify({
        userId,
        actorId: actor.id,
      });
      let session: { sessionId: string; authUrl: string } | null = null;
      if (bankIdAdapter) {
        try {
          session = bankIdAdapter.createAuthSession(userId);
        } catch (err) {
          logger.warn({ err, userId }, "[BIN-587 B2.3] bankid createAuthSession failed");
        }
      }
      fireAudit({
        actorId: actor.id,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "SUPPORT",
        action: "player.bankid.reverify",
        resource: "user",
        resourceId: userId,
        details: {
          bankIdConfigured: bankIdAdapter !== null,
          sessionIssued: session !== null,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, {
        user: publicPlayerSummary(updated),
        bankIdSession: session,
        bankIdConfigured: bankIdAdapter !== null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
