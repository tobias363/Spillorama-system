-- BIN-516: chat-persistens DB.
--
-- Replays chat history to late-joiners (and to all clients on reconnect).
-- Keys are TEXT (not FK) because rooms + players live only in engine memory;
-- the room-code is stable enough to scope queries, hall_id covers spillvett
-- audit, and player_name is denormalized so a deleted player's old chat
-- still shows authorship.
--
-- Up
CREATE TABLE IF NOT EXISTS app_chat_messages (
  id           BIGSERIAL PRIMARY KEY,
  hall_id      TEXT NOT NULL,
  room_code    TEXT NOT NULL,
  player_id    TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  message      TEXT NOT NULL CHECK (length(message) <= 500),
  emoji_id     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_chat_messages_room_created
  ON app_chat_messages (room_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_chat_messages_hall_created
  ON app_chat_messages (hall_id, created_at DESC);

COMMENT ON TABLE app_chat_messages IS
  'BIN-516: chat history per room. Replayed on chat:history. Bounded by length(message) <= 500.';
