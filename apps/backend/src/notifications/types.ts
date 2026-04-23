/**
 * BIN-FCM: shared types for the push-notification subsystem.
 *
 * Separated from FcmPushService.ts to keep the service body focused on the
 * send-flow, and so routes/jobs can import the type-surface without pulling
 * in firebase-admin (which is loaded lazily in the service).
 */

export const NOTIFICATION_TYPES = [
  "game-start",
  "game-reminder",
  "bonus",
  "rg-warning",
  "deposit-confirmed",
  "withdraw-confirmed",
  "kyc-status-change",
  "admin-broadcast",
  "generic",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEVICE_TYPES = ["ios", "android", "web"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const NOTIFICATION_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "failed",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * Notification as persisted in `app_notifications`. Shape mirrors the DB row
 * (snake_case → camelCase) + decoded `data` JSONB.
 */
export interface StoredNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: NotificationStatus;
  fcmMessageId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Input to `sendToUser` / `sendBulk`. `type` validates against the constant
 * list; callers must build structured `data` payloads themselves so deep-
 * links stay type-checked at the call-site (we can't enforce schema on a
 * free-form JSONB).
 */
export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Free-form payload. Stored in app_notifications.data and sent as FCM data-payload. */
  data?: Record<string, unknown>;
}

/**
 * Device as returned from registration/lookup. Used by service + routes.
 */
export interface UserDevice {
  id: string;
  userId: string;
  firebaseToken: string;
  deviceType: DeviceType;
  deviceLabel: string | null;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result returned by sendToUser / sendBulk. `sent` counts notifications
 * successfully accepted by FCM, `failed` counts FCM-rejections, `skipped`
 * counts users with no active devices. Per-user breakdown is in `items`.
 */
export interface SendResult {
  sent: number;
  failed: number;
  skipped: number;
  items: Array<{
    userId: string;
    notificationId: string | null;
    status: NotificationStatus;
    fcmMessageId: string | null;
    errorMessage: string | null;
  }>;
}
