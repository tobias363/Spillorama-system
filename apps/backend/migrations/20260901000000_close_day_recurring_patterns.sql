-- REQ-116 / BIR-058 / BIR-059: Recurring close-day patterns.
--
-- Hall-driver må kunne sette opp permanent ukeplan for stengning, eks.
-- "alltid stengt mandager", "stengt første tirsdag i måneden", "stengt
-- 1. juledag hvert år". Dette utvider BIN-700 close-day-suite (PR #497)
-- som støttet Single / Consecutive / Random.
--
-- Modellen er pattern-rad + expansion: når en pattern lagres genererer
-- service-laget alle individuelle datoer i tids-rom (`start_date` →
-- `end_date`/`max_occurrences`) og lagrer én rad per dato i
-- `app_close_day_log`. Hver child-rad får `recurring_pattern_id` som
-- peker tilbake til parent-raden — slik at "Slett pattern" enkelt kan
-- finne og fjerne alle expanded child-rader.
--
-- Pattern-typer (i `pattern_json`):
--   - { type: "weekly",          daysOfWeek: number[] }   // 0=Sun .. 6=Sat
--   - { type: "monthly_dates",   dates: number[] }         // 1..31, ugyldige (eks 31. feb) hoppes over
--   - { type: "monthly_weekday", week: 1|2|3|4|"last", dayOfWeek: number } // første mandag, siste fredag etc.
--   - { type: "yearly",          month: 1..12, day: 1..31 } // 1. januar, 17. mai
--   - { type: "daily" }                                     // alle dager
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_close_day_recurring_patterns (
  id                TEXT PRIMARY KEY,
  game_management_id TEXT NOT NULL,
  pattern_json      JSONB NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NULL,
  max_occurrences   INTEGER NULL,
  start_time        TEXT NULL,
  end_time          TEXT NULL,
  notes             TEXT NULL,
  created_by        TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ NULL,
  deleted_by        TEXT NULL
);

COMMENT ON TABLE  app_close_day_recurring_patterns IS
  'REQ-116: parent-rad for recurring close-day patterns. Expansion lagres som child-rader i app_close_day_log med recurring_pattern_id-peker.';
COMMENT ON COLUMN app_close_day_recurring_patterns.pattern_json IS
  'REQ-116: discriminated union — { type: "weekly"|"monthly_dates"|"monthly_weekday"|"yearly"|"daily", ... }.';
COMMENT ON COLUMN app_close_day_recurring_patterns.start_date IS
  'REQ-116: inkludert. Default = i dag hvis service-laget setter den.';
COMMENT ON COLUMN app_close_day_recurring_patterns.end_date IS
  'REQ-116: inkludert. NULL betyr expansion stopper på max_occurrences eller default-cap (366 dager).';
COMMENT ON COLUMN app_close_day_recurring_patterns.max_occurrences IS
  'REQ-116: maks antall expanderte datoer. NULL = default-cap (365). Brukes uavhengig av eller sammen med end_date.';
COMMENT ON COLUMN app_close_day_recurring_patterns.start_time IS
  'REQ-116: HH:MM (24t) — vindu-start brukt på alle expanderte child-rader. NULL = hele dagen.';
COMMENT ON COLUMN app_close_day_recurring_patterns.end_time IS
  'REQ-116: HH:MM (24t) — vindu-slutt. NULL = hele dagen.';
COMMENT ON COLUMN app_close_day_recurring_patterns.deleted_at IS
  'REQ-116: soft-delete. DELETE-endepunkt setter denne + deleted_by, og soft-deleter samtidig alle child-rader i app_close_day_log via recurring_pattern_id.';

CREATE INDEX IF NOT EXISTS idx_app_close_day_recurring_patterns_game_active
  ON app_close_day_recurring_patterns (game_management_id)
  WHERE deleted_at IS NULL;

-- Child-rader: legg til peker fra app_close_day_log → recurring-pattern.
ALTER TABLE app_close_day_log
  ADD COLUMN IF NOT EXISTS recurring_pattern_id TEXT NULL;

COMMENT ON COLUMN app_close_day_log.recurring_pattern_id IS
  'REQ-116: peker til parent-rad i app_close_day_recurring_patterns hvis denne datoen ble generert via recurring expansion. NULL for manuelle (Single / Consecutive / Random) lukkinger.';

CREATE INDEX IF NOT EXISTS idx_app_close_day_log_recurring_pattern
  ON app_close_day_log (recurring_pattern_id)
  WHERE recurring_pattern_id IS NOT NULL;
