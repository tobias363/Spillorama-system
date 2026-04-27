-- Tobias 2026-04-27: ADMIN Super-User Operations Console (`/admin/ops`).
--
-- Bakgrunn:
-- ADMIN trenger live ops-dashboard på tvers av alle haller. User-direktiv:
-- «jeg må være superbruker som kan raskt få oversikt over alle haller og
-- alle pågående trekninger. er det feks en group og halls som har
-- problemer, må jeg raskt kunne gå inn der for å begynne å feilsøke å
-- hjelpe til».
--
-- Denne tabellen lagrer ops-spesifikke alerts som ikke har egen tabell
-- fra før (hall-offline, stuck-room, pre-flight-feil, settlement-diff).
-- Eksisterende alert-kilder (wallet_reconciliation_alerts, payment_requests
-- pending > 30min, player stop-game vote, agent ready-state) konsumeres
-- av AdminOpsService.listActiveAlerts som SQL-views, ikke duplisert her.
--
-- Idempotency-strategi: app_ops_alerts har en partial unique index over
-- (type, hall_id) WHERE acknowledged_at IS NULL. Det betyr at same
-- (type+hall) ikke kan ha to åpne alerts samtidig — service-laget
-- ON CONFLICT DO NOTHING. Det fjerner dupletter ved tette ticks (samme
-- pattern som wallet_reconciliation_alerts).
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_ops_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  type TEXT NOT NULL,
  hall_id TEXT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ NULL,
  acknowledged_by_user_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hovedindex for unack-listing (newest first). Partial over kun åpne
-- alerts holder størrelsen lav.
CREATE INDEX IF NOT EXISTS idx_app_ops_alerts_unack
  ON app_ops_alerts (severity, created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Per-hall lookup ved drill-down i ops-konsollet.
CREATE INDEX IF NOT EXISTS idx_app_ops_alerts_hall
  ON app_ops_alerts (hall_id, created_at DESC);

-- Idempotens: samme (type, hall_id) kan ikke ha to åpne alerts samtidig.
-- Coalesce er nødvendig fordi UNIQUE-indekser i Postgres aksepterer NULL
-- som distinkt — vi vil ha global-alerts (hall_id IS NULL) idempotent på
-- type alene.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_ops_alerts_open_per_type_hall
  ON app_ops_alerts (type, COALESCE(hall_id, ''))
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE app_ops_alerts IS
  'ADMIN Ops Console: ops-spesifikke alerts (hall-offline, stuck-room, pre-flight-feil, settlement-diff). Andre alert-kilder (wallet-reconciliation, pending-payment-requests, stop-game-vote) leses fra sine egne tabeller via AdminOpsService.';
COMMENT ON COLUMN app_ops_alerts.severity IS
  'INFO = informasjonell, WARNING = advarsel, CRITICAL = krever umiddelbar handling.';
COMMENT ON COLUMN app_ops_alerts.type IS
  'Maskinlesbar alert-type, eks. "hall.offline", "room.stuck.no_draws", "settlement.diff.force_required". Stabil dotted-form for filtrering i UI.';
COMMENT ON COLUMN app_ops_alerts.hall_id IS
  'Hall-id hvis alerten gjelder en spesifikk hall. NULL for global-alerts.';
COMMENT ON COLUMN app_ops_alerts.details IS
  'Fri-formet JSON med alert-spesifikk metadata (room-code, lastDrawAt, threshold osv.). Ikke PII.';
