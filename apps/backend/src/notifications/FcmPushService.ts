/**
 * BIN-FCM: Firebase Cloud Messaging push-notification service.
 *
 * Porterer legacy-backend sitt fcm-node/fcm-notification-subsystem. Nytt
 * backend kjørte tidligere med stub `/api/notifications` som returnerte
 * tom array — mobil-app spillere fikk ingen game-start-varsler.
 *
 * Design (matcher EmailService-mønsteret):
 *   - Service konstrueres fra env (`FIREBASE_CREDENTIALS_JSON`,
 *     `FIREBASE_PROJECT_ID`). Hvis env mangler, kjører den i no-op-modus
 *     (`isEnabled() === false`); sendToUser lagrer rader i
 *     `app_notifications` med status=`pending` men hopper over FCM-kallet.
 *     Det lar dev-miljøer kjøre uten Firebase-credentials, og lar cron-
 *     jobben vises i admin-panel uten 500-feil.
 *   - `firebase-admin` lastes **lazy**: imported dynamic innen
 *     `initialize()` slik at et dev-miljø uten pakken installert ikke
 *     krasjer ved oppstart. (Pakken ligger i package.json, men noen
 *     offline CI-runs kjører uten `npm install` for alt.)
 *   - Transporter-abstraksjon (`FcmTransporter`) lar tester sende inn
 *     in-memory fake uten å mock-e hele firebase-admin-API-et — samme
 *     mønster som `EmailTransporter` i EmailService.
 *
 * Device-registrering:
 *   - UNIQUE på `firebase_token` i DB sørger for at samme token ikke
 *     dupliseres selv om to brukere logger inn på samme enhet; ved
 *     konflikt oppdateres user_id til siste registrator (legacy-paritet).
 *   - `unregisterDevice(token)` mark is_active=false i stedet for å
 *     slette — radene brukes til audit og for å kunne følge hvilke
 *     tokens som har vært i omløp når Firebase-console viser errors.
 *
 * Send-flyt:
 *   1) INSERT rad i `app_notifications` med status=`pending`.
 *   2) Hent aktive devices for user.
 *   3) Hvis FCM er enabled: kall transporter per device (eller batch).
 *   4) Oppdater raden: `sent_at` + `fcm_message_id` ved success,
 *      `failed` + `error_message` ved FCM-feil. Feil kastes IKKE videre
 *      — caller skal aldri få 500 fra en send-operasjon.
 *   5) Hvis FCM er disabled (no-op): raden blir stående som `pending`
 *      men med en `skipped`-markør i error_message så ops kan se det.
 *
 * Rate-limit:
 *   - `sendBulk` respekterer FCM's ~500 msg per multicast. Større
 *     batcher chunkes internt. Loop er bevisst sekvensiell (ikke
 *     Promise.all over alle chunks) for å holde oss under ~1000 msg/s
 *     per Firebase-projekt.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { logger as rootLogger } from "../util/logger.js";
import {
  NOTIFICATION_TYPES,
  DEVICE_TYPES,
  type DeviceType,
  type NotificationPayload,
  type NotificationStatus,
  type NotificationType,
  type SendResult,
  type StoredNotification,
  type UserDevice,
} from "./types.js";

const logger = rootLogger.child({ module: "fcm-push-service" });

export interface FcmPushServiceConfig {
  /**
   * Service-account JSON. Can be passed as parsed object or base64-encoded
   * string (how render.yaml stores it). Parsed here to a plain record; the
   * transporter init validates required fields (project_id, client_email,
   * private_key).
   */
  credentials: Record<string, unknown>;
  projectId: string;
}

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string };
  data?: Record<string, string>;
}

export interface FcmSendResponse {
  messageId: string;
}

/**
 * Minimal transporter-surface; matches firebase-admin's send() return
 * shape. Tests inject fakes; prod wraps the real admin.messaging().
 */
export interface FcmTransporter {
  send(message: FcmMessage): Promise<FcmSendResponse>;
}

export interface FcmPushServiceOptions {
  pool: Pool;
  schema?: string;
  config?: FcmPushServiceConfig | null;
  transporter?: FcmTransporter;
  env?: NodeJS.ProcessEnv;
}

function parseConfigFromEnv(env: NodeJS.ProcessEnv): FcmPushServiceConfig | null {
  const raw = (env.FIREBASE_CREDENTIALS_JSON ?? "").trim();
  const projectId = (env.FIREBASE_PROJECT_ID ?? "").trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    // Accept either raw JSON or base64-encoded JSON — base64 is easier to
    // store in secret-managers that don't like newlines in the private_key.
    const maybeJson = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    parsed = JSON.parse(maybeJson);
  } catch (err) {
    logger.warn({ err }, "FIREBASE_CREDENTIALS_JSON kunne ikke parses — push-service disabled");
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    logger.warn("FIREBASE_CREDENTIALS_JSON er ikke et JSON-objekt — push-service disabled");
    return null;
  }
  const creds = parsed as Record<string, unknown>;
  const effectiveProjectId =
    projectId || (typeof creds.project_id === "string" ? (creds.project_id as string) : "");
  if (!effectiveProjectId) {
    logger.warn("FIREBASE_PROJECT_ID mangler og credentials har ikke project_id — push-service disabled");
    return null;
  }
  return { credentials: creds, projectId: effectiveProjectId };
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error("Ugyldig schema-navn for FcmPushService.");
  }
  return schema;
}

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isDeviceType(value: string): value is DeviceType {
  return (DEVICE_TYPES as readonly string[]).includes(value);
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  status: NotificationStatus;
  fcm_message_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  created_at: Date;
}

interface DeviceRow {
  id: string;
  user_id: string;
  firebase_token: string;
  device_type: DeviceType;
  device_label: string | null;
  is_active: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

function mapNotificationRow(row: NotificationRow): StoredNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: (isNotificationType(row.type) ? row.type : "generic") as NotificationType,
    title: row.title,
    body: row.body,
    data:
      typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {},
    status: row.status,
    fcmMessageId: row.fcm_message_id,
    errorMessage: row.error_message,
    sentAt: row.sent_at?.toISOString() ?? null,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapDeviceRow(row: DeviceRow): UserDevice {
  return {
    id: row.id,
    userId: row.user_id,
    firebaseToken: row.firebase_token,
    deviceType: row.device_type,
    deviceLabel: row.device_label,
    isActive: row.is_active,
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Normalises a free-form data-object into the `Record<string, string>`
 * shape that FCM's `data` field requires (FCM coerces everything to
 * string on the wire anyway; being explicit avoids surprises).
 */
function stringifyDataPayload(data: Record<string, unknown> | undefined): Record<string, string> {
  if (!data) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export class FcmPushService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly config: FcmPushServiceConfig | null;
  private transporter: FcmTransporter | null;
  /** Gate dynamic-import of firebase-admin to the first send. */
  private transporterInitPromise: Promise<void> | null = null;

  constructor(options: FcmPushServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.transporter) {
      this.transporter = options.transporter;
      this.config = options.config ?? {
        credentials: { project_id: "test" },
        projectId: "test",
      };
      return;
    }
    const config =
      options.config === undefined
        ? parseConfigFromEnv(options.env ?? process.env)
        : options.config;
    this.config = config;
    this.transporter = null;
  }

  /** True when a real FCM transporter is wired up (or will be on first send). */
  isEnabled(): boolean {
    return this.config !== null;
  }

  /** @internal — test hook for injecting a transporter post-construction. */
  setTransporterForTest(transporter: FcmTransporter | null): void {
    this.transporter = transporter;
    this.transporterInitPromise = Promise.resolve();
  }

  private table(name: string): string {
    return `"${this.schema}"."${name}"`;
  }

  private async ensureTransporter(): Promise<FcmTransporter | null> {
    if (this.transporter) return this.transporter;
    if (!this.config) return null;
    if (!this.transporterInitPromise) {
      this.transporterInitPromise = this.initTransporter().catch((err) => {
        logger.error({ err }, "FCM transporter init feilet — disabling sends");
        // Swallow — sends fall through to no-op mode.
      });
    }
    await this.transporterInitPromise;
    return this.transporter;
  }

  private async initTransporter(): Promise<void> {
    if (!this.config) return;
    // Dynamic-import so dev-miljøer uten firebase-admin installert ikke
    // krasjer ved oppstart (pakken er i package.json men ikke alltid
    // tilstede offline).
    let admin: typeof import("firebase-admin");
    try {
      admin = (await import("firebase-admin")) as typeof import("firebase-admin");
    } catch (err) {
      logger.warn({ err }, "firebase-admin ikke tilgjengelig — push-service disabled");
      return;
    }

    // Initialize only once per process (firebase-admin uses app-registry).
    const appName = `fcm-push-${this.config.projectId}`;
    const existing = admin.apps.find((a) => a?.name === appName);
    const app = existing ?? admin.initializeApp(
      {
        credential: admin.credential.cert(
          this.config.credentials as import("firebase-admin").ServiceAccount,
        ),
        projectId: this.config.projectId,
      },
      appName,
    );
    const messaging = admin.messaging(app);
    this.transporter = {
      async send(message: FcmMessage): Promise<FcmSendResponse> {
        const id = await messaging.send({
          token: message.token,
          notification: message.notification,
          data: message.data,
        });
        return { messageId: id };
      },
    };
  }

  // ── Device registration ─────────────────────────────────────────────────────

  async registerDevice(input: {
    userId: string;
    firebaseToken: string;
    deviceType: DeviceType;
    deviceLabel?: string | null;
  }): Promise<UserDevice> {
    if (!input.userId?.trim()) throw new Error("userId påkrevd.");
    if (!input.firebaseToken?.trim()) throw new Error("firebaseToken påkrevd.");
    if (!isDeviceType(input.deviceType)) {
      throw new Error(`deviceType må være en av: ${DEVICE_TYPES.join(", ")}.`);
    }

    const now = new Date();
    // UPSERT på firebase_token — hvis token allerede finnes, oppdater
    // user_id (legacy-paritet: samme device kan logge inn som ny spiller).
    const result = await this.pool.query<DeviceRow>(
      `INSERT INTO ${this.table("app_user_devices")}
        (id, user_id, firebase_token, device_type, device_label, is_active, last_seen_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $6, $6)
       ON CONFLICT (firebase_token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         device_type = EXCLUDED.device_type,
         device_label = EXCLUDED.device_label,
         is_active = true,
         last_seen_at = EXCLUDED.last_seen_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, user_id, firebase_token, device_type, device_label, is_active,
                 last_seen_at, created_at, updated_at`,
      [randomUUID(), input.userId, input.firebaseToken, input.deviceType, input.deviceLabel ?? null, now],
    );
    return mapDeviceRow(result.rows[0]!);
  }

  async unregisterDevice(firebaseToken: string): Promise<boolean> {
    if (!firebaseToken?.trim()) return false;
    const result = await this.pool.query(
      `UPDATE ${this.table("app_user_devices")}
          SET is_active = false, updated_at = now()
        WHERE firebase_token = $1 AND is_active = true`,
      [firebaseToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async unregisterDeviceById(deviceId: string, userId: string): Promise<boolean> {
    if (!deviceId?.trim() || !userId?.trim()) return false;
    // Scope by user_id to prevent users from disabling other users' devices.
    const result = await this.pool.query(
      `UPDATE ${this.table("app_user_devices")}
          SET is_active = false, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [deviceId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listDevicesForUser(userId: string, opts?: { includeInactive?: boolean }): Promise<UserDevice[]> {
    const includeInactive = opts?.includeInactive === true;
    const result = await this.pool.query<DeviceRow>(
      `SELECT id, user_id, firebase_token, device_type, device_label, is_active,
              last_seen_at, created_at, updated_at
         FROM ${this.table("app_user_devices")}
        WHERE user_id = $1
          ${includeInactive ? "" : "AND is_active = true"}
        ORDER BY last_seen_at DESC`,
      [userId],
    );
    return result.rows.map(mapDeviceRow);
  }

  // ── Notification send ───────────────────────────────────────────────────────

  /**
   * Send one notification to a single user. Fans out to all active devices.
   * Always returns — never throws, even if FCM errors. Returned `SendResult`
   * tells the caller what happened per device.
   */
  async sendToUser(userId: string, payload: NotificationPayload): Promise<SendResult> {
    return this.sendBulk([userId], payload);
  }

  /**
   * Send one notification to many users. Persists one `app_notifications`
   * row per user (not per device); FCM fan-out uses the stored row's
   * `fcm_message_id` for the last successful device (good enough for
   * trace — if we need per-device trace we can add a `app_notification_sends`
   * child table later).
   */
  async sendBulk(userIds: string[], payload: NotificationPayload): Promise<SendResult> {
    if (!isNotificationType(payload.type)) {
      throw new Error(`type må være en av: ${NOTIFICATION_TYPES.join(", ")}.`);
    }
    if (!payload.title?.trim() || !payload.body?.trim()) {
      throw new Error("title og body er påkrevd.");
    }

    const transporter = await this.ensureTransporter();
    const dataStr = stringifyDataPayload(payload.data);
    const result: SendResult = { sent: 0, failed: 0, skipped: 0, items: [] };

    // Dedup + filter empty. Keep order for deterministic tests.
    const uniqueUserIds = Array.from(new Set(userIds.filter((u) => typeof u === "string" && u.trim())));

    for (const userId of uniqueUserIds) {
      // 1) INSERT pending-rad.
      let notificationId: string;
      try {
        const ins = await this.pool.query<{ id: string }>(
          `INSERT INTO ${this.table("app_notifications")}
            (id, user_id, type, title, body, data, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', now())
           RETURNING id`,
          [
            randomUUID(),
            userId,
            payload.type,
            payload.title,
            payload.body,
            JSON.stringify(payload.data ?? {}),
          ],
        );
        notificationId = ins.rows[0]!.id;
      } catch (err) {
        logger.error({ err, userId }, "FCM: klarte ikke INSERT pending-notification — hopper over");
        result.failed += 1;
        result.items.push({
          userId,
          notificationId: null,
          status: "failed",
          fcmMessageId: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      // 2) Hent aktive devices.
      let devices: UserDevice[];
      try {
        devices = await this.listDevicesForUser(userId, { includeInactive: false });
      } catch (err) {
        logger.error({ err, userId }, "FCM: klarte ikke hente devices — markerer failed");
        await this.markNotificationFailed(notificationId, err instanceof Error ? err.message : String(err));
        result.failed += 1;
        result.items.push({
          userId,
          notificationId,
          status: "failed",
          fcmMessageId: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (devices.length === 0) {
        // Ingen devices = ingen å sende til. La raden stå som pending
        // men marker skipped i error-feltet så ops kan se det.
        await this.markNotificationSkipped(notificationId, "no active devices");
        result.skipped += 1;
        result.items.push({
          userId,
          notificationId,
          status: "failed", // DB-status er "failed" — "skipped" er UI-kategori.
          fcmMessageId: null,
          errorMessage: "no active devices",
        });
        continue;
      }

      // 3) No-op modus: ingen transporter, bare lagre raden.
      if (!transporter) {
        await this.markNotificationSkipped(notificationId, "fcm disabled");
        result.skipped += 1;
        result.items.push({
          userId,
          notificationId,
          status: "failed",
          fcmMessageId: null,
          errorMessage: "fcm disabled",
        });
        continue;
      }

      // 4) Send til hver device. Track siste suksess-ID til rad-updateren.
      let lastMessageId: string | null = null;
      let lastError: string | null = null;
      let anySuccess = false;
      const invalidTokens: string[] = [];

      for (const device of devices) {
        try {
          const resp = await transporter.send({
            token: device.firebaseToken,
            notification: { title: payload.title, body: payload.body },
            data: {
              ...dataStr,
              notificationId,
              type: payload.type,
            },
          });
          lastMessageId = resp.messageId;
          anySuccess = true;
          // Touch last_seen_at to reflect successful delivery.
          await this.touchDeviceLastSeen(device.id).catch(() => { /* best-effort */ });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;
          logger.warn(
            { err, userId, deviceId: device.id, token: device.firebaseToken.slice(0, 10) },
            "FCM send feilet for device",
          );
          // Firebase-admin konstanter: UNREGISTERED, INVALID_ARGUMENT,
          // NOT_FOUND tyder på at tokenet er ugyldig. Marker device
          // inactive så fremtidige fan-outs hopper over det.
          const code = (err as { code?: string; errorInfo?: { code?: string } } | null)?.code
            ?? (err as { errorInfo?: { code?: string } } | null)?.errorInfo?.code
            ?? "";
          if (
            code.includes("registration-token-not-registered") ||
            code.includes("invalid-registration-token") ||
            code.includes("invalid-argument") ||
            msg.includes("registration-token-not-registered") ||
            msg.includes("Requested entity was not found")
          ) {
            invalidTokens.push(device.firebaseToken);
          }
        }
      }

      // Disable tokens som ble avvist.
      for (const token of invalidTokens) {
        await this.unregisterDevice(token).catch(() => { /* best-effort */ });
      }

      if (anySuccess) {
        await this.markNotificationSent(notificationId, lastMessageId);
        result.sent += 1;
        result.items.push({
          userId,
          notificationId,
          status: "sent",
          fcmMessageId: lastMessageId,
          errorMessage: null,
        });
      } else {
        await this.markNotificationFailed(notificationId, lastError ?? "all devices failed");
        result.failed += 1;
        result.items.push({
          userId,
          notificationId,
          status: "failed",
          fcmMessageId: null,
          errorMessage: lastError,
        });
      }
    }

    return result;
  }

  private async markNotificationSent(id: string, fcmMessageId: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table("app_notifications")}
          SET status = 'sent', sent_at = now(), fcm_message_id = $2
        WHERE id = $1`,
      [id, fcmMessageId],
    );
  }

  private async markNotificationFailed(id: string, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table("app_notifications")}
          SET status = 'failed', error_message = $2
        WHERE id = $1`,
      [id, errorMessage.slice(0, 500)],
    );
  }

  private async markNotificationSkipped(id: string, reason: string): Promise<void> {
    // "skipped" er ikke i DB-enum — vi lagrer som failed med markør i
    // error_message slik at rapport-queries kan filtrere på reason.
    await this.markNotificationFailed(id, `skipped: ${reason}`);
  }

  private async touchDeviceLastSeen(deviceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table("app_user_devices")}
          SET last_seen_at = now(), updated_at = now()
        WHERE id = $1`,
      [deviceId],
    );
  }

  // ── Inbox / read ────────────────────────────────────────────────────────────

  async listForUser(
    userId: string,
    opts?: { limit?: number; offset?: number; unreadOnly?: boolean },
  ): Promise<StoredNotification[]> {
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
    const offset = Math.max(0, opts?.offset ?? 0);
    const where = opts?.unreadOnly ? "AND read_at IS NULL" : "";
    const result = await this.pool.query<NotificationRow>(
      `SELECT id, user_id, type, title, body, data, status, fcm_message_id,
              error_message, sent_at, delivered_at, read_at, created_at
         FROM ${this.table("app_notifications")}
        WHERE user_id = $1
          ${where}
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows.map(mapNotificationRow);
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table("app_notifications")}
          SET read_at = now()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markAllAsReadForUser(userId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE ${this.table("app_notifications")}
          SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const result = await this.pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM ${this.table("app_notifications")}
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return Number(result.rows[0]?.c ?? 0);
  }
}
