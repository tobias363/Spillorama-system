-- Task 1.6: `app_game1_master_transfer_requests` — runtime master-overføring.
--
-- Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3 +
-- B.10. Legacy-referanse: legacy/unity-backend/Game/AdminEvents/AdminController/
-- AdminController.js linje 253-522 (`transferHallAccess` + `approveTransferHallAccess`).
--
-- Formål: spore agent-initierte master-hall-overføringer i Spill 1. Flow:
--   1. Agent på nåværende master-hall klikker "Overfør master til Hall B"
--      → INSERT rad med status='pending' og valid_till = NOW() + 60s.
--   2. Agent på target-hall godtar → UPDATE status='approved' og
--      `app_game1_scheduled_games.master_hall_id = to_hall_id`.
--      Alternativt avviser → UPDATE status='rejected'.
--   3. Hvis ingen svar innen 60s, expiry-tick UPDATE status='expired'.
--
-- Låst produkt-krav (PM-godkjent 2026-04-24):
--   * Agent-initiert (ikke admin-initiert)
--   * Target-hall aksepterer direkte (ingen admin-godkjenning-mellomtrinn)
--   * 60s TTL på request
--   * Én aktiv request om gangen per gameId — ny request kansellerer forrige
--   * Audit-logg via eksisterende `app_game1_master_audit` (ny action-type).
--
-- Designvalg:
--   * `id` UUID PRIMARY KEY med gen_random_uuid() default (matcher mønster i
--     nyere migrations som accumulating_pots / voucher_redemptions).
--   * `game_id` FK → app_game1_scheduled_games(id) med ON DELETE CASCADE —
--     requests er underordnet gameId, sletter vi spillet mister de mening.
--   * `from_hall_id` / `to_hall_id` TEXT uten FK (matcher pattern i
--     app_game1_master_audit hvor hall-referanser ikke er FK for å beholde
--     audit-trail selv om hall slettes).
--   * `initiated_by_user_id` TEXT uten FK (samme pattern).
--   * `status` CHECK-constraint — whitelist 4 states.
--   * `valid_till` brukes av expiry-tick (WHERE status='pending' AND valid_till < NOW()).
--   * `responded_by_user_id` NULLABLE — satt ved approve/reject.
--   * `reject_reason` NULLABLE — satt ved reject.
--   * `created_at` / `updated_at` TIMESTAMPTZ DEFAULT NOW().
--
-- Indekser:
--   * (game_id, status) — "finn aktiv pending request for gameId".
--   * (valid_till) WHERE status='pending' — expiry-tick scan.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_master_transfer_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                TEXT NOT NULL
                           REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  from_hall_id           TEXT NOT NULL,
  to_hall_id             TEXT NOT NULL,
  initiated_by_user_id   TEXT NOT NULL,
  initiated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_till             TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN (
                             'pending',
                             'approved',
                             'rejected',
                             'expired'
                           )),
  responded_by_user_id   TEXT NULL,
  responded_at           TIMESTAMPTZ NULL,
  reject_reason          TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game1_master_transfer_game_status
  ON app_game1_master_transfer_requests(game_id, status);

CREATE INDEX IF NOT EXISTS idx_game1_master_transfer_valid_till_pending
  ON app_game1_master_transfer_requests(valid_till)
  WHERE status = 'pending';

COMMENT ON TABLE app_game1_master_transfer_requests IS
  'Task 1.6: agent-initierte master-hall-overføringer for Spill 1. 60s TTL, én aktiv request per game. Approve → UPDATE app_game1_scheduled_games.master_hall_id.';

COMMENT ON COLUMN app_game1_master_transfer_requests.status IS
  'pending (awaiting response) | approved (master_hall_id updated) | rejected (target declined) | expired (TTL tick).';

COMMENT ON COLUMN app_game1_master_transfer_requests.valid_till IS
  'Request utløper automatisk hvis target ikke aksepterer innen denne tiden. Expiry-tick: UPDATE status=expired WHERE status=pending AND valid_till < NOW().';
