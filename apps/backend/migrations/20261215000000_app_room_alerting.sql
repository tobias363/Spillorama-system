-- BIN-815 / R8: Alerting for live-rom-helse (Spill 1/2/3).
--
-- Mandat-ref: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.4 R8.
--
-- Ops-loggen for alerts som RoomAlertingService trigger på basis av R7 health-
-- endepunktene. Hver alert som faktisk sendes (eller ville blitt sendt) får
-- en rad her med:
--   * stable scenario-key (room+component+grunn) for de-dup
--   * payload sendt til Slack/PagerDuty/console
--   * kanaler det ble sendt til (ARRAY)
--   * hash-chain link for tamper-evident audit
--
-- Hash-chain (per BIN-764-mønster):
--   * `entry_hash` = SHA256(prev_entry_hash + canonical_json(row_payload))
--   * `previous_entry_hash` = forrige rads `entry_hash` globalt
--   * Genesis-rad bruker zero-hash (64x '0')
--   * Service beregner og setter ved INSERT — ingen trigger nødvendig
--
-- Forward-only (BIN-661): ingen Down. `app_alert_log` er en operativ logg —
-- hvis noe må fjernes, skriv ny migrasjon med ALTER eller TRUNCATE etter
-- audit-tids-vindu.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_alert_log (
  id                   BIGSERIAL PRIMARY KEY,
  -- Stable nøkkel for de-dup. Format: "<game>:<hallId>:<scenario>"
  -- (eks. "spill1:hallA:status_down", "spill2:hallA:redis_unhealthy").
  -- Brukes også som PagerDuty `dedup_key`.
  scenario_key         TEXT NOT NULL,
  -- Spill-slug ('spill1' | 'spill2' | 'spill3' | 'global') for filter/UI.
  game                 TEXT NOT NULL,
  -- Hall-ID når alerten er hall-spesifikk; NULL for globale (eks. wallet-recon).
  hall_id              TEXT NULL,
  -- Hva som trigget alerten (eks. 'status_down', 'draw_stale',
  -- 'redis_unhealthy', 'db_unhealthy', 'wallet_reconciliation_mismatch').
  scenario             TEXT NOT NULL,
  -- Severity for UI/PagerDuty. 'critical' = side-page, 'warning' = Slack-only.
  severity             TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  -- Menneskevennlig melding sendt til kanaler.
  message              TEXT NOT NULL,
  -- Strukturert payload (kopier av health-snapshot + metadata).
  details              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Kanaler det FAKTISK ble sendt til. Tom array = console-fallback only.
  channels             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Hash-chain (BIN-764-mønster) — tamper-evident audit-trail.
  -- 64-tegn hex SHA-256.
  entry_hash           TEXT NOT NULL,
  previous_entry_hash  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- De-dup-vindu lookup: "har vi sendt en alert for samme scenario_key
-- innenfor siste N minutter?" — enkel filter på scenario_key + created_at.
CREATE INDEX IF NOT EXISTS idx_app_alert_log_scenario_created
  ON app_alert_log (scenario_key, created_at DESC);

-- UI/filter på spill og hall.
CREATE INDEX IF NOT EXISTS idx_app_alert_log_game_hall_created
  ON app_alert_log (game, hall_id, created_at DESC);

-- Audit-walking: rebygg hele kjeden.
CREATE INDEX IF NOT EXISTS idx_app_alert_log_chain
  ON app_alert_log (id);

COMMENT ON TABLE app_alert_log IS
  'BIN-815 (R8): Operativ logg for live-rom-alerts (Spill 1/2/3). Hash-chain (BIN-764-mønster) gjør den tamper-evident.';
COMMENT ON COLUMN app_alert_log.scenario_key IS
  'Stable nøkkel for de-dup. Format: "<game>:<hallId>:<scenario>". Også brukt som PagerDuty dedup_key.';
COMMENT ON COLUMN app_alert_log.entry_hash IS
  'SHA-256 hex over (previous_entry_hash + canonical_json(row_payload)). Tamper-evident.';
COMMENT ON COLUMN app_alert_log.previous_entry_hash IS
  'entry_hash fra forrige rad globalt. Genesis-rad bruker 64x ''0''.';
