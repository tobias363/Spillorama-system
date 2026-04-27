-- HIGH-11: chat-moderasjons-felter på app_chat_messages.
--
-- Casino Review fant at chat persisteres (BIN-516) uten at admin kan
-- moderere — for et regulert pengespill (pengespillforskriften §13) må
-- hall-operator kunne søke + slette mobbing/hvitvaskings-snakk og logge
-- handlingen for revisjon.
--
-- Soft-delete: vi beholder raden så audit-trailen er intakt, men setter
-- deleted_at + deleted_by_user_id + delete_reason. Andre spillere ser
-- "[Slettet av moderator]" via socket-laget; admin-listingen viser den
-- opprinnelige meldingen for compliance-innsyn.
--
-- Up migration
ALTER TABLE app_chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS delete_reason      TEXT NULL
    CHECK (delete_reason IS NULL OR length(delete_reason) <= 500);

-- Søke-indeks for moderator-listingen: filtrere på hall + tidsvindu er
-- den vanligste spørringen (legacy: "se all chat fra hall X siste 24t").
CREATE INDEX IF NOT EXISTS idx_app_chat_messages_hall_room_created
  ON app_chat_messages (hall_id, room_code, created_at DESC);

-- Partial-indeks for kun-aktive meldinger — admin-list-spørringen
-- filtrerer typisk bort soft-deleted, og sletting er sjelden.
CREATE INDEX IF NOT EXISTS idx_app_chat_messages_active
  ON app_chat_messages (created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN app_chat_messages.deleted_at IS
  'HIGH-11: soft-delete timestamp. NULL = aktiv melding.';
COMMENT ON COLUMN app_chat_messages.deleted_by_user_id IS
  'HIGH-11: bruker-id på moderator som slettet (audit-spor).';
COMMENT ON COLUMN app_chat_messages.delete_reason IS
  'HIGH-11: påkrevd årsak for soft-delete (maks 500 tegn).';
