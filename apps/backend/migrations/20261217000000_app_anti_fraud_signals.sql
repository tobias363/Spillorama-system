-- BIN-806 A13: anti-fraud / velocity-checks + bot-detection.
--
-- Audit-trail-tabell for hver risk-assessment som anti-fraud-pipelinen kjører
-- på en wallet-mutasjon (debit/credit/transfer). Kolonner:
--
--   * `risk_level` — `low` / `medium` / `high` / `critical`. `critical`
--     blokkerer transaksjonen (DomainError `FRAUD_RISK_CRITICAL`); `high`
--     tillater men markerer `flagged_for_review` så admin kan følge opp.
--   * `signals_json` — array av signal-koder + metadata. Eks.
--     `[{"code":"VELOCITY_HOUR","count":12,"threshold":10}]`. Brukes både
--     til scoring (samme signal → samme risk-bidrag) og til admin-UI for
--     forklaring.
--   * `transaction_id` — peker mot `wallet_transactions` når en faktisk
--     wallet-tx ble committet (low/medium/high). NULL for `critical` der
--     pre-commit-blokkering hindret transaksjonen i å eksistere.
--   * `action_taken` — `logged` / `flagged_for_review` / `blocked`.
--     Speiler hva pipelinen faktisk gjorde med transaksjonen.
--
-- Heuristikk-baserte signaler genereres i `AntiFraudService` (apps/backend/
-- src/security/AntiFraudService.ts). ML-baserte modeller er ikke planlagt
-- for pilot — heuristikkene er nok til å oppfylle BIN-806's akseptanse.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_anti_fraud_signals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hall_id         TEXT NULL,
  transaction_id  TEXT NULL,
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  signals_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_taken    TEXT NOT NULL CHECK (action_taken IN ('logged', 'flagged_for_review', 'blocked')),
  ip_address      TEXT NULL,
  amount_cents    BIGINT NULL,
  operation_type  TEXT NULL,
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot-path: hent flagg for admin-review-listen, sortert nyest først.
CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_review_queue
  ON app_anti_fraud_signals (assessed_at DESC)
  WHERE action_taken IN ('flagged_for_review', 'blocked');

-- Per-hall-filter (HALL_OPERATOR auto-scope) når egen hall sjekkes.
CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_hall
  ON app_anti_fraud_signals (hall_id, assessed_at DESC)
  WHERE hall_id IS NOT NULL;

-- Per-spiller-historikk (admin → "vis alle flagg for denne brukeren").
CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_user
  ON app_anti_fraud_signals (user_id, assessed_at DESC);

-- Risk-nivå-aggregat for dashboards (count by level over windows).
CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_risk_level
  ON app_anti_fraud_signals (risk_level, assessed_at DESC);

COMMENT ON TABLE app_anti_fraud_signals IS
  'BIN-806 A13: anti-fraud risk-assessments per wallet-mutasjon. Ett rad per assessment. signals_json = heuristikk-treff. action_taken = pipeline-utfall.';

COMMENT ON COLUMN app_anti_fraud_signals.transaction_id IS
  'Wallet-tx-id ved low/medium/high (lenker til wallet_transactions.id). NULL ved critical der pipelinen blokkerte før commit.';

COMMENT ON COLUMN app_anti_fraud_signals.signals_json IS
  'JSONB-array av signal-rapporter: [{code, count?, threshold?, ...}]. Stable code-namespace: VELOCITY_HOUR, VELOCITY_DAY, AMOUNT_DEVIATION, MULTI_ACCOUNT_IP, BOT_TIMING.';

COMMENT ON COLUMN app_anti_fraud_signals.action_taken IS
  'Hva pipelinen faktisk gjorde: logged (low/medium → tillat + logg), flagged_for_review (high → tillat + logg + admin-flagg), blocked (critical → blokker pre-commit).';
