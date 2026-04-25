/**
 * Admin SMS broadcast-endepunkt.
 *
 * Lar ADMIN sende SMS til en spesifisert liste av spillere via Sveve. Bruker
 * spilleres registrerte telefonnummer (hentet fra app_users.phone). Spillere
 * uten telefonnummer hoppes over (audit-loggen viser hvor mange).
 *
 * Permission: SETTINGS_WRITE (ADMIN-only). Vi kunne lagt til eget
 * SMS_BROADCAST-permission, men returbruk av eksisterende ADMIN-only
 * permission gir samme effektive policy uten ny rolle-matrise-endring.
 *
 * Audit-logg: 1 rad per broadcast, med:
 *   - actorId, actorType
 *   - resource: "sms_broadcast"
 *   - details: { recipientCount, sent, failed, skipped, messageLength,
 *     sender, maskedSampleNumber }
 *   - INGEN rå-meldingsinnhold (kan inneholde sensitive data) — kun
 *     `messageLength`. Bruker se en revisjons-eksport kan lese audit-loggen
 *     uten å eksponere innholdet.
 *
 * Rate-limit: cap på 1000 mottakere per request (forhindrer mistakes ved
 * hall-bredde-broadcast). Ingen per-time-limit i denne PR-en — kommer i
 * eventuell oppfølger.
 */

import express from "express";
import type { Pool } from "pg";
import type { PlatformService, PublicAppUser, UserRole } from "../platform/PlatformService.js";
import type { SveveSmsService } from "../integration/SveveSmsService.js";
import { maskPhone } from "../integration/SveveSmsService.js";
import type { AuditLogService, AuditActorType } from "../compliance/AuditLogService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-sms-broadcast" });

const MAX_RECIPIENTS_PER_REQUEST = 1000;
const MAX_MESSAGE_LENGTH = 1000;

export interface AdminSmsBroadcastRouterDeps {
  platformService: PlatformService;
  smsService: SveveSmsService;
  auditLogService: AuditLogService;
  pool: Pool;
  schema: string;
  /** Permission required (default SETTINGS_WRITE — ADMIN-only). */
  broadcastPermission?: AdminPermission;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error("Ugyldig schema-navn.");
  }
  return schema;
}

function mapRoleToActorType(role: UserRole): AuditActorType {
  switch (role) {
    case "ADMIN":
      return "ADMIN";
    case "HALL_OPERATOR":
      return "HALL_OPERATOR";
    case "SUPPORT":
      return "SUPPORT";
    case "PLAYER":
      return "PLAYER";
    default:
      return "USER";
  }
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

export function createAdminSmsBroadcastRouter(
  deps: AdminSmsBroadcastRouterDeps
): express.Router {
  const schema = assertSchemaName(deps.schema);
  const permission: AdminPermission = deps.broadcastPermission ?? "SETTINGS_WRITE";
  const router = express.Router();

  async function requireAdmin(req: express.Request): Promise<PublicAppUser> {
    const token = getAccessTokenFromRequest(req);
    const user = await deps.platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission, "Ikke tilgang til SMS-broadcast.");
    return user;
  }

  /**
   * Resolv user-IDer til telefonnumre. Filtrerer bort soft-deleted og brukere
   * uten phone. Returnerer både [phones] og diagnose-felter for audit.
   */
  async function resolvePhonesForUsers(userIds: string[]): Promise<{
    phones: string[];
    skippedNoPhone: number;
    skippedNotFound: number;
  }> {
    if (userIds.length === 0) {
      return { phones: [], skippedNoPhone: 0, skippedNotFound: 0 };
    }
    const result = await deps.pool.query<{ id: string; phone: string | null }>(
      `SELECT id, phone FROM "${schema}"."app_users"
        WHERE id = ANY($1::text[])
          AND deleted_at IS NULL`,
      [userIds]
    );
    const found = new Set<string>();
    const phones: string[] = [];
    let skippedNoPhone = 0;
    for (const row of result.rows) {
      found.add(row.id);
      if (row.phone && row.phone.trim()) {
        phones.push(row.phone.trim());
      } else {
        skippedNoPhone++;
      }
    }
    const skippedNotFound = userIds.filter((id) => !found.has(id)).length;
    return { phones, skippedNoPhone, skippedNotFound };
  }

  // POST /api/admin/sms/broadcast
  router.post("/api/admin/sms/broadcast", async (req, res) => {
    try {
      const actor = await requireAdmin(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Validate: recipients[] er user-IDer, message er ren tekst.
      const rawRecipients = body.recipients;
      if (!Array.isArray(rawRecipients)) {
        throw new DomainError(
          "INVALID_INPUT",
          "recipients må være en array av user-IDer."
        );
      }
      const recipients = rawRecipients
        .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        .map((r) => r.trim());
      if (recipients.length === 0) {
        throw new DomainError(
          "INVALID_INPUT",
          "recipients må inneholde minst én user-ID."
        );
      }
      if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
        throw new DomainError(
          "INVALID_INPUT",
          `Maks ${MAX_RECIPIENTS_PER_REQUEST} mottakere per request.`
        );
      }

      const message = mustBeNonEmptyString(body.message, "message");
      if (message.length > MAX_MESSAGE_LENGTH) {
        throw new DomainError(
          "INVALID_INPUT",
          `Meldingen kan maks være ${MAX_MESSAGE_LENGTH} tegn.`
        );
      }

      const sender =
        typeof body.sender === "string" && body.sender.trim()
          ? body.sender.trim()
          : undefined;

      // Resolv user-IDer → telefonnumre.
      const resolution = await resolvePhonesForUsers(recipients);
      if (resolution.phones.length === 0) {
        // Ingen mottakere har telefonnummer — ikke en hard error, men
        // returnér detaljert info så admin ser hvorfor.
        const detail = {
          targets: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          skippedNoPhone: resolution.skippedNoPhone,
          skippedNotFound: resolution.skippedNotFound,
          message: "Ingen av de valgte spillerne har registrert telefonnummer.",
        };
        // Audit også når ingen ble sendt — vi vil se forsøkene.
        void deps.auditLogService
          .record({
            actorId: actor.id,
            actorType: mapRoleToActorType(actor.role),
            action: "admin.sms.broadcast",
            resource: "sms_broadcast",
            resourceId: null,
            details: {
              recipientCount: recipients.length,
              sent: 0,
              failed: 0,
              skipped: 0,
              skippedNoPhone: resolution.skippedNoPhone,
              skippedNotFound: resolution.skippedNotFound,
              messageLength: message.length,
              sender: sender ?? null,
              outcome: "no_phones",
            },
            ipAddress: clientIp(req),
            userAgent: userAgent(req),
          })
          .catch((err) =>
            logger.warn({ err }, "audit.record feilet — ignorert")
          );
        apiSuccess(res, detail);
        return;
      }

      const result = await deps.smsService.sendBulk(
        resolution.phones,
        message,
        sender
      );

      // Audit-rad — INGEN rå-meldings-tekst, INGEN rå-telefonnumre.
      void deps.auditLogService
        .record({
          actorId: actor.id,
          actorType: mapRoleToActorType(actor.role),
          action: "admin.sms.broadcast",
          resource: "sms_broadcast",
          resourceId: null,
          details: {
            recipientCount: recipients.length,
            sent: result.sent,
            failed: result.failed,
            skipped: result.skipped,
            skippedNoPhone: resolution.skippedNoPhone,
            skippedNotFound: resolution.skippedNotFound,
            messageLength: message.length,
            sender: sender ?? null,
            // Ett eksempel-nummer (masked) for diagnostikk uten PII.
            maskedSampleNumber:
              result.items[0]?.to ??
              (resolution.phones[0] ? maskPhone(resolution.phones[0]) : null),
            outcome:
              result.failed > 0 ? "partial" : result.sent > 0 ? "sent" : "noop",
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch((err) =>
          logger.warn({ err }, "audit.record feilet — ignorert")
        );

      apiSuccess(res, {
        targets: resolution.phones.length,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        skippedNoPhone: resolution.skippedNoPhone,
        skippedNotFound: resolution.skippedNotFound,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
