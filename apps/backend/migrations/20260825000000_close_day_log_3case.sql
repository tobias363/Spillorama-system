-- BIN-700: CloseDay 3-case — utvider app_close_day_log med tids-vindu og notes.
--
-- Legacy `closeDayAdd` (legacy/unity-backend/App/Controllers/GameController.js
-- 10126–10265) lagret per dato et tids-vindu (startTime, endTime) som angir
-- når på dagen rom-blokkering gjelder. For Consecutive-mode genererte
-- legacy:
--   - første dag:   startTime → "23:59"
--   - mellomdager:  "00:00"   → "23:59"
--   - siste dag:    "00:00"   → endTime
-- Random-mode (frittstående datoer): hver dato bruker sitt eget vindu.
-- Single-mode: dato + vindu (default 00:00 → 23:59 hvis ikke spesifisert).
--
-- BIN-623 (forrige versjon) støttet kun "lukk dagen som helhet" og hadde ikke
-- start_time/end_time-kolonner. Denne migrasjonen legger dem til som NULL-
-- nullbar (eksisterende rader → "hele dagen"), pluss en valgfri notes-felt
-- for hall-operatør-notater (jul, påske, "stengt for ombygning").
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

ALTER TABLE app_close_day_log
  ADD COLUMN IF NOT EXISTS start_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS end_time   TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes      TEXT NULL;

COMMENT ON COLUMN app_close_day_log.start_time IS
  'BIN-700: HH:MM (24t) — starten på lukke-vinduet for denne dagen. NULL = hele dagen lukket.';

COMMENT ON COLUMN app_close_day_log.end_time IS
  'BIN-700: HH:MM (24t) — slutten på lukke-vinduet for denne dagen. NULL = hele dagen lukket.';

COMMENT ON COLUMN app_close_day_log.notes IS
  'BIN-700: hall-operatør-notater (eks. "jul", "påske", "ombygning"). Valgfri.';
