-- BIN-640: single-ticket cashout for fysiske papirbilletter.
--
-- Admin-endepunkt `POST /api/admin/physical-tickets/:uniqueId/cashout`
-- registrerer en utbetaling (cashout) for én fysisk billett som har
-- vunnet. Én rad per utbetalt billett; UNIQUE(ticket_unique_id) gir
-- idempotens-garanti (forsøk nr. 2 returnerer ALREADY_CASHED_OUT).
--
-- Mønsteret bevisst atskilt fra:
--   - `app_agent_transactions` (krever active shift, agent-initiert)
--   - `app_hall_cash_transactions` (agent-shift-delta-oppgjør)
--
-- Cashout her er admin/hall-operator-initiert; selve kontant-flyten
-- fra hall til spiller håndteres regnskapsmessig av close-day (samme
-- modell som andre fysisk-papir-betalinger registreres via audit-log).
--
-- Norsk pengespillforskriften §64: mutasjoner på regulatorisk sporbar
-- data må logges i `app_audit_log` — det gjøres i service-laget via
-- AuditLogService.record({ action: 'admin.physical_ticket.cashout' }).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_physical_ticket_cashouts (
  id                  TEXT PRIMARY KEY,
  ticket_unique_id    TEXT NOT NULL UNIQUE,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  game_id             TEXT NULL,
  payout_cents        BIGINT NOT NULL CHECK (payout_cents > 0),
  paid_by             TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes               TEXT NULL,
  other_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (ticket_unique_id) REFERENCES app_physical_tickets(unique_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_cashouts_hall_paid_at
  ON app_physical_ticket_cashouts(hall_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_cashouts_game
  ON app_physical_ticket_cashouts(game_id, paid_at DESC)
  WHERE game_id IS NOT NULL;

COMMENT ON TABLE app_physical_ticket_cashouts IS
  'BIN-640: én rad per cashout av fysisk papirbillett. UNIQUE(ticket_unique_id) => idempotens.';
COMMENT ON COLUMN app_physical_ticket_cashouts.payout_cents IS
  'Utbetalt beløp i cents (øre). Bestemmes av agent/admin via check-bingo (BIN-641) forut for cashout.';
COMMENT ON COLUMN app_physical_ticket_cashouts.paid_by IS
  'admin/hall-operator som registrerte utbetalingen. FK til app_users.';
