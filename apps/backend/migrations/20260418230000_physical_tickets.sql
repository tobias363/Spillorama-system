-- BIN-587 B4a: fysiske papirbilletter (admin-konfig + salg-audit).
--
--   app_physical_ticket_batches — en batch er en serie unike IDs (range
--   start-end) tilhørende én hall. Kan knyttes til et spesifikt spill
--   (assigned_game_id). Batch har default_price_cents som brukes hvis
--   en spesifikk billett ikke overstyrer.
--
--   app_physical_tickets — én rad per genererert unique-ID. status
--   UNSOLD|SOLD|VOIDED. price_cents NULL betyr "bruk batch.default_
--   price_cents". sold_by peker til agenten som solgte (oppdateres av
--   BIN-583 agent-POS-endepunkt; admin-siden eier skjemaet).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_physical_ticket_batches (
  id                    TEXT PRIMARY KEY,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  batch_name            TEXT NOT NULL,
  range_start           BIGINT NOT NULL,
  range_end             BIGINT NOT NULL,
  default_price_cents   BIGINT NOT NULL CHECK (default_price_cents >= 0),
  game_slug             TEXT NULL,
  assigned_game_id      TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  created_by            TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (range_end >= range_start),
  -- Overlap-prevention er enforced i service-laget (krever at vi sjekker
  -- mot alle aktive batches i samme hall). Partial index aksept.
  UNIQUE (hall_id, batch_name)
);

CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_batches_hall
  ON app_physical_ticket_batches(hall_id);

CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_batches_game
  ON app_physical_ticket_batches(assigned_game_id)
  WHERE assigned_game_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_physical_tickets (
  id               TEXT PRIMARY KEY,
  batch_id         TEXT NOT NULL REFERENCES app_physical_ticket_batches(id) ON DELETE CASCADE,
  unique_id        TEXT UNIQUE NOT NULL,
  hall_id          TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'UNSOLD'
                     CHECK (status IN ('UNSOLD', 'SOLD', 'VOIDED')),
  price_cents      BIGINT NULL CHECK (price_cents IS NULL OR price_cents >= 0),
  assigned_game_id TEXT NULL,
  sold_at          TIMESTAMPTZ NULL,
  sold_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  buyer_user_id    TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  voided_at        TIMESTAMPTZ NULL,
  voided_by        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  voided_reason    TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_physical_tickets_batch
  ON app_physical_tickets(batch_id);

CREATE INDEX IF NOT EXISTS idx_app_physical_tickets_game_status
  ON app_physical_tickets(assigned_game_id, status)
  WHERE assigned_game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_physical_tickets_hall_status
  ON app_physical_tickets(hall_id, status);

COMMENT ON TABLE app_physical_ticket_batches IS
  'BIN-587 B4a: batch av fysiske papirbilletter. range_start/end definerer unike ID-er.';
COMMENT ON COLUMN app_physical_tickets.price_cents IS
  'NULL = bruk batch.default_price_cents. Satt = overstyring for denne billetten.';
COMMENT ON COLUMN app_physical_tickets.sold_by IS
  'BIN-587 B4a/BIN-583: agenten som utførte salget. Oppdateres av agent-POS-endepunkt i BIN-583.';
