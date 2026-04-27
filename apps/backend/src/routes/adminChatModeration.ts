/**
 * HIGH-11: chat-moderasjons-endepunkter for admin-panel.
 *
 * Casino Review fant at chat persisteres via `chatMessageStore.insert`
 * (fire-and-forget i `chatEvents.ts`), men ingen route eksponerte chat
 * for moderasjon. For et regulert pengespill (pengespillforskriften §13)
 * må hall-operator kunne søke i chat for compliance-issues (mobbing,
 * hvitvasking, child-exposure) og logge sletting for revisjon.
 *
 * Endepunkter:
 *   GET  /api/admin/chat/messages
 *        — liste m/ filter (hallId, roomCode, fromDate, toDate, search,
 *          includeDeleted), pagination. RBAC: CHAT_MODERATION_READ.
 *   POST /api/admin/chat/messages/:id/delete
 *        — soft-delete med påkrevd `reason`. RBAC: CHAT_MODERATION_WRITE.
 *          AuditLog: `admin.chat.delete` (regulatorisk spor).
 *
 * Hall-scope: HALL_OPERATOR ser/sletter kun chat fra egen hall (håndheves
 * via `resolveHallScopeFilter` i list og `assertUserHallScope` i delete).
 * ADMIN + SUPPORT ser globalt; SUPPORT er read-only.
 *
 * Sletting er soft: raden beholdes, og gameplay-stien viser
 * "[Slettet av moderator]" til andre spillere.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type {
  ChatMessageStore,
  ChatModerationListFilter,
  ModerationChatMessage,
} from "../store/ChatMessageStore.js";
import {
  assertAdminPermission,
  assertUserHallScope,
  resolveHallScopeFilter,
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
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-chat-moderation" });

/** HIGH-11: påkrevd minimum lengde på sletting-årsak. */
export const CHAT_DELETE_REASON_MIN_LENGTH = 5;
/** HIGH-11: matcher CHECK-constraint i DB. */
export const CHAT_DELETE_REASON_MAX_LENGTH = 500;

export interface AdminChatModerationRouterDeps {
  platformService: PlatformService;
  auditLogService: AuditLogService;
  chatMessageStore: ChatMessageStore;
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

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalIso(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være ISO-8601 dato/tid.`
    );
  }
  return new Date(ms).toISOString();
}

function parseOptionalOffset(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "string") return 0;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * HIGH-11: trimmer + validerer årsak-tekst. Speil av `parseReason` i
 * adminPlayers.ts men med chat-spesifikke grenser.
 */
function parseDeleteReason(raw: unknown): string {
  const reason = mustBeNonEmptyString(raw, "reason");
  if (reason.length < CHAT_DELETE_REASON_MIN_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `reason må være minst ${CHAT_DELETE_REASON_MIN_LENGTH} tegn.`
    );
  }
  if (reason.length > CHAT_DELETE_REASON_MAX_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `reason er for lang (maks ${CHAT_DELETE_REASON_MAX_LENGTH} tegn).`
    );
  }
  return reason;
}

/** HIGH-11: DTO som returneres til admin-UI (matchet av frontend-typen). */
function publicModerationMessage(m: ModerationChatMessage): {
  id: string;
  hallId: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
} {
  return {
    id: m.id,
    hallId: m.hallId,
    roomCode: m.roomCode,
    playerId: m.playerId,
    playerName: m.playerName,
    message: m.message,
    emojiId: m.emojiId,
    createdAt: m.createdAt,
    deletedAt: m.deletedAt,
    deletedByUserId: m.deletedByUserId,
    deleteReason: m.deleteReason,
  };
}

export function createAdminChatModerationRouter(
  deps: AdminChatModerationRouterDeps
): express.Router {
  const { platformService, auditLogService, chatMessageStore } = deps;
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
      logger.warn(
        { err, action: event.action },
        "[HIGH-11] audit append failed (continuing)"
      );
    });
  }

  // ── GET /api/admin/chat/messages ─────────────────────────────────────────
  //
  // List + filtrer chat-meldinger for moderasjon. Hall-scope håndheves for
  // HALL_OPERATOR. ADMIN + SUPPORT ser globalt.
  router.get("/api/admin/chat/messages", async (req, res) => {
    try {
      const user = await requireAdminPermissionUser(req, "CHAT_MODERATION_READ");

      const explicitHallId = parseOptionalString(req.query.hallId);
      // resolveHallScopeFilter throws FORBIDDEN hvis HALL_OPERATOR forsøker
      // å filtrere på en annen hall enn sin egen, eller hvis HALL_OPERATOR
      // ikke har tildelt hall.
      const scopedHallId = resolveHallScopeFilter(
        { role: user.role, hallId: user.hallId ?? null },
        explicitHallId
      );

      const filter: ChatModerationListFilter = {
        limit: parseLimit(req.query.limit, 100),
        offset: parseOptionalOffset(req.query.offset),
        includeDeleted: parseBooleanFlag(req.query.includeDeleted),
      };
      if (scopedHallId !== undefined) filter.hallId = scopedHallId;
      const roomCode = parseOptionalString(req.query.roomCode);
      if (roomCode !== undefined) filter.roomCode = roomCode;
      const fromDate = parseOptionalIso(req.query.fromDate, "fromDate");
      if (fromDate !== undefined) filter.fromDate = fromDate;
      const toDate = parseOptionalIso(req.query.toDate, "toDate");
      if (toDate !== undefined) filter.toDate = toDate;
      const search = parseOptionalString(req.query.search);
      if (search !== undefined) filter.search = search;

      const { messages, total } = await chatMessageStore.listForModeration(filter);

      apiSuccess(res, {
        messages: messages.map(publicModerationMessage),
        total,
        limit: filter.limit ?? 100,
        offset: filter.offset ?? 0,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/admin/chat/messages/:id/delete ─────────────────────────────
  //
  // Soft-delete én melding. Påkrevd `reason` (5-500 tegn). Idempotent:
  // re-sletting overskriver ikke første moderator. Skriver
  // `admin.chat.delete` til audit-log med moderator + årsak.
  router.post("/api/admin/chat/messages/:id/delete", async (req, res) => {
    try {
      const actor = await requireAdminPermissionUser(req, "CHAT_MODERATION_WRITE");
      const id = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const reason = parseDeleteReason(req.body.reason);

      // 404-aktig ved ukjent id — vi henter raden først så vi kan hall-scope
      // på HALL_OPERATOR + få previous state for audit.
      const existing = await chatMessageStore.getById(id);
      if (!existing) {
        throw new DomainError(
          "CHAT_MESSAGE_NOT_FOUND",
          "Chat-meldingen finnes ikke."
        );
      }

      // Hall-scope: HALL_OPERATOR kan kun slette i egen hall. ADMIN globalt.
      assertUserHallScope(
        { role: actor.role, hallId: actor.hallId ?? null },
        existing.hallId,
        "Du kan kun moderere chat fra din egen hall."
      );

      const updated = await chatMessageStore.softDelete({
        id,
        deletedByUserId: actor.id,
        deleteReason: reason,
      });

      // softDelete kan returnere null kun ved samtidig-feil (DB-utfall) —
      // i praksis fanget av getById-sjekken over.
      if (!updated) {
        throw new DomainError(
          "CHAT_MESSAGE_NOT_FOUND",
          "Chat-meldingen finnes ikke."
        );
      }

      // Idempotens-flagg: var den allerede slettet før dette kallet?
      const wasAlreadyDeleted = existing.deletedAt !== null;

      // Audit-spor: regulatorisk-kritisk — hvem slettet hva og hvorfor.
      // Vi inkluderer originalmeldingen (maks 500 tegn) så audit-rapporten
      // kan dokumentere innholdet selv etter sletting. Player-id beholdes
      // så compliance kan korrelere mot AML/responsible-gaming-data.
      fireAudit({
        actorId: actor.id,
        actorType:
          actor.role === "ADMIN"
            ? "ADMIN"
            : actor.role === "HALL_OPERATOR"
            ? "HALL_OPERATOR"
            : actor.role === "SUPPORT"
            ? "SUPPORT"
            : "USER",
        action: "admin.chat.delete",
        resource: "chat_message",
        resourceId: id,
        details: {
          hallId: existing.hallId,
          roomCode: existing.roomCode,
          targetPlayerId: existing.playerId,
          targetPlayerName: existing.playerName,
          originalMessage: existing.message,
          reason,
          wasAlreadyDeleted,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      apiSuccess(res, {
        message: publicModerationMessage(updated),
        wasAlreadyDeleted,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
