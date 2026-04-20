-- BIN-623: CloseDay log — regulatorisk dagsavslutning per GameManagement.
--
-- Hver rad representerer én lukket dag for ett spill (GameManagement). Tabellen
-- er append-only på (game_management_id, close_date): unique-indeks hindrer
-- dobbel-lukking av samme dag og gir fail-fast idempotency i service-laget.
--
-- Regulatorisk rolle:
--   Pengespillforskriften § 64 krever rekonstruerbar historikk per dag. Denne
--   tabellen er et sekundært oppslag — primær audit-trail skrives til
--   `app_audit_log` (action = "admin.game.close-day") i samme transaksjon slik
--   at både "strukturert aggregat-snapshot" og "hvem-gjorde-hva-når" er
--   bevart. Raden her mister ikke data om `app_audit_log` skulle feile
--   (fire-and-forget i audit-laget, se BIN-588).
--
-- Legacy-kontekst:
--   Legacy `closeDay` (legacy/unity-backend/App/Controllers/GameController.js
--   10126–10414) lagret "closed time-slots" embedded i `dailySchedule.otherData.closeDay`
--   som liste av (closeDate, startTime, endTime). Det er en SCHEDULING-feature
--   (markér et tidsvindu som stengt), ikke en audit-lukking av kjørt dag.
--   BIN-623 introduserer den regulatorisk-orienterte dagslukkingen som ikke
--   fantes i legacy-stacken — admin-UI (closeDay.html) slo bare fast at en
--   runde skulle markeres ferdig, uten audit-trail.
--
-- Summary-snapshot:
--   `summary_json` holder aggregatene vi har i dag (totalSold, totalEarning
--   fra `app_game_management`). Når BIN-622-tabellene for tickets/wins/jackpots
--   normaliseres videre, utvides snapshot-strukturen. Eksisterende rader
--   blir urørt siden kolonnen er JSONB og parseres defensivt.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_close_day_log (
  id                  TEXT PRIMARY KEY,
  game_management_id  TEXT NOT NULL,
  -- YYYY-MM-DD i hall-tidssone. Holdt som DATE slik at unique-indeks + range-
  -- queries på "lukket i dag" ikke trenger å tenke på tidssone-konvertering
  -- per query.
  close_date          DATE NOT NULL,
  closed_by           TEXT NULL,
  -- Aggregat-snapshot på lukketidspunkt. Inneholder minimum:
  --   { totalSold, totalEarning, ticketsSold, winnersCount,
  --     payoutsTotal, jackpotsTotal, capturedAt }
  -- Defensivt parse-mønster i service — manglende felter fallbackes til 0.
  summary_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency-håndheving: én lukking per (spill, dato).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_close_day_log_game_date
  ON app_close_day_log(game_management_id, close_date);

-- Oppslags-index for "har dette spillet blitt lukket nylig?"-queries.
CREATE INDEX IF NOT EXISTS idx_app_close_day_log_game_recent
  ON app_close_day_log(game_management_id, closed_at DESC);

COMMENT ON TABLE app_close_day_log IS
  'BIN-623: regulatorisk dagslukking per GameManagement. Unique (game_management_id, close_date) håndhever idempotency. Sekundær til app_audit_log.';

COMMENT ON COLUMN app_close_day_log.close_date IS
  'BIN-623: lukke-dato (YYYY-MM-DD) i hall-tidssone. UNIQUE med game_management_id.';

COMMENT ON COLUMN app_close_day_log.summary_json IS
  'BIN-623: aggregat-snapshot (totalSold, totalEarning, ticketsSold, winnersCount, payoutsTotal, jackpotsTotal, capturedAt). Defensivt parset — manglende felter = 0.';
