-- BIN-FCM: push-notifikasjoner for mobil-app (Firebase Cloud Messaging).
--
-- Porterer legacy-backend sitt fcm-node/fcm-notification-subsystem:
--   * `sendGameStartNotifications` (cron hver 1min, pre-game-varsler)
--   * `EnableNotification` / `UpdateFirebaseToken` (socket — device-registrering)
--   * `PlayerNotifications` / `sendMulNotifications` (socket — send varsel)
--
-- To tabeller:
--
-- 1) `app_user_devices` — hvilke devices (iOS/Android) en spiller har registrert
--    FCM-token for. Én spiller kan ha flere devices (telefon + tablet),
--    derfor egen tabell framfor enkel `firebase_token`-kolonne på `app_users`.
--    `is_active` styres av service-laget (mark=false når FCM returnerer
--    UNREGISTERED — vi beholder raden for audit/debug i stedet for DELETE).
--
-- 2) `app_notifications` — historisk logg over varsler sendt til spillere.
--    Både for visning i app (GET /api/notifications) og for trace/debug
--    når FCM svarer failed. JSONB `data`-kolonne rommer deep-link-payload
--    (gameId, url osv).
--
-- Design-valg:
--   * `type` er fritekst (ikke enum) slik at nye varseltyper kan legges
--     til uten migration. Service-laget har konstant-liste som valideres
--     før insert — DB er bare lagring.
--   * `title` / `body` er lagret som strings (ikke JSONB) for nå.
--     Multi-språk kan legges til som egen `locale`-kolonne senere hvis
--     behov — pilot kjører bare på norsk.
--   * `fcm_message_id` er responsen fra FCM (`projects/.../messages/xyz`)
--     slik at ops kan korrelere med Firebase-console.
--   * `status` styres gjennom livssyklus:
--         `pending`  — rad opprettet, ikke sendt til FCM enda
--         `sent`     — FCM har akseptert (men ikke nødvendigvis levert)
--         `failed`   — FCM avviste (se `error_message`)
--   * `read_at` / `delivered_at` er valgfrie — vi oppdaterer dem kun når
--     vi får signal (in-app les, eller mobil-app ACK via egen endpoint).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent via
-- `CREATE TABLE IF NOT EXISTS`.

-- Up migration

CREATE TABLE IF NOT EXISTS app_user_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  firebase_token  TEXT NOT NULL,
  device_type     TEXT NOT NULL CHECK (device_type IN ('ios', 'android', 'web')),
  device_label    TEXT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_user_devices_token UNIQUE (firebase_token)
);

COMMENT ON TABLE app_user_devices IS
  'BIN-FCM: FCM-tokens per device for mobil-app push-notifikasjoner. Unique på token for å matche legacy-dedupering.';
COMMENT ON COLUMN app_user_devices.firebase_token IS
  'FCM registration token fra Firebase SDK på klient. Kan roteres — klient POST-er ny token til /api/notifications/device ved endring.';
COMMENT ON COLUMN app_user_devices.is_active IS
  'False når FCM returnerer UNREGISTERED/INVALID_ARGUMENT — beholdes for audit, ekskluderes fra fan-out.';

-- Hot queries: "finn alle aktive devices for user X" (fan-out ved send)
-- og "finn device på token" (register/unregister).
CREATE INDEX IF NOT EXISTS idx_app_user_devices_user_active
  ON app_user_devices (user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_app_user_devices_last_seen
  ON app_user_devices (last_seen_at DESC);


CREATE TABLE IF NOT EXISTS app_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  fcm_message_id   TEXT NULL,
  error_message    TEXT NULL,
  sent_at          TIMESTAMPTZ NULL,
  delivered_at     TIMESTAMPTZ NULL,
  read_at          TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_notifications IS
  'BIN-FCM: historisk logg over push-notifikasjoner. Brukes både for in-app-liste (GET /api/notifications) og for trace/debug ved FCM-feil.';
COMMENT ON COLUMN app_notifications.type IS
  'Fritekst-type, eks "game-start", "bonus", "rg-warning", "deposit-confirmed". Validert av FcmPushService før insert.';
COMMENT ON COLUMN app_notifications.data IS
  'Deep-link-payload: { gameId, url, scheduledGameId, ... }. Sendes også til FCM som data-payload slik at klient kan route.';
COMMENT ON COLUMN app_notifications.status IS
  'pending=opprettet men ikke sendt. sent=FCM akseptert. delivered=klient ACK. failed=FCM avviste (se error_message).';
COMMENT ON COLUMN app_notifications.fcm_message_id IS
  'Firebase message-name (f.eks. projects/<project>/messages/<id>). Brukes for korrelasjon med Firebase-console.';

-- Hot queries: "hent siste varsler for user X" (inbox) + "finn ulest".
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created
  ON app_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
  ON app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- For cron-job som sjekker "har vi allerede sendt game-start for denne runden?"
CREATE INDEX IF NOT EXISTS idx_app_notifications_type_data
  ON app_notifications (type, created_at DESC);
