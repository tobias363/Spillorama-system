-- BIN-700: Loyalty-system (tiers + player-state + activity-events).
--
-- Port av legacy `legacy/unity-backend/App/Controllers/LoyaltyController.js`
-- (7 metoder) + `App/Services/LoyaltyService.js`. Legacy implementasjonen var
-- enkel (en navn/points-liste); vi porter et tier-basert system:
--
--   - `app_loyalty_tiers` = admin-definerte tiers (bronze/silver/gold/...)
--     med min_points/max_points-bånd + benefits_json.
--   - `app_loyalty_player_state` = per-spiller aggregat (current tier,
--     lifetime_points, month_points, last_updated_at). Én rad per bruker.
--   - `app_loyalty_events` = append-only aktivitets-log (type + delta +
--     metadata). Gir revisjonsspor + kilde-data for framtidige rapporter.
--
-- Avgrensning mot BIN-668 (leaderboard_tiers):
--   - Leaderboard-tier = plass-basert premie-mapping (runtime-leaderboard
--     aggregerer fra faktiske wins). Konkurransepreget, tidsavgrenset.
--   - Loyalty-tier = persistent spiller-status basert på akkumulert aktivitet.
--     Gir benefits (bonus, prioritet, gratisspinn) heller enn kontant-premier.
--   - De to systemene overlapper IKKE: en vinner på topplisten er ikke
--     automatisk i en høyere loyalty-tier, og vice versa.
--
-- Points-award:
--   - BIN-700 leverer kun det manuelle API-et (admin.loyalty.award) + tabell-
--     skjemaene. Automatisk points-award fra spill-aktivitet (ticket-kjøp,
--     session-deltakelse, milepæler) krever integrasjon i BingoEngine som er
--     out-of-scope for denne PR-en og lander i en egen follow-up.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

-- ── 1. Loyalty tiers (admin-konfigurerte nivå-bånd) ─────────────────────────

CREATE TABLE IF NOT EXISTS app_loyalty_tiers (
  id                  TEXT PRIMARY KEY,
  -- Display-navn ("Bronze", "Silver", "Gold", "Platinum"). Unik pr ikke-
  -- slettet rad (partial unique index under).
  name                TEXT NOT NULL,
  -- Hierarkisk rangering (1 = laveste, høyere = bedre). Unik pr ikke-slettet
  -- rad slik at admin ikke kan lage to tiers på samme rank (ingen tvetydighet
  -- i tier-assignment).
  rank                INTEGER NOT NULL CHECK (rank > 0),
  -- Inklusiv minimums-grense for å kvalifisere. Tier-assignment-logikken
  -- velger høyeste tier hvor `lifetime_points >= min_points`.
  min_points          INTEGER NOT NULL DEFAULT 0 CHECK (min_points >= 0),
  -- Eksklusiv maks-grense. NULL = ingen øvre grense (toppnivå). Ikke brukt
  -- til assignment (vi velger alltid høyeste rank) men lagres for admin-
  -- oversikt/visning.
  max_points          INTEGER NULL CHECK (max_points IS NULL OR max_points > min_points),
  -- Fri-form benefits-payload (bonus-prosent, fri-spinn, prioritet i kø).
  -- Konsumeres av framtidig integrasjon; denne PR-en bare lagrer.
  benefits_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aktiv-flag. Deaktivert tier er fortsatt i rangeringen men ny
  -- tier-assignment hopper over den (fallback til neste aktive lavere rank).
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unike indekser på (name) og (rank) for ikke-slettede rader.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_loyalty_tiers_name
  ON app_loyalty_tiers(name)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_loyalty_tiers_rank
  ON app_loyalty_tiers(rank)
  WHERE deleted_at IS NULL;

-- Indeks for assignment-query (finn høyeste tier hvor lifetime_points >= min_points).
CREATE INDEX IF NOT EXISTS idx_app_loyalty_tiers_rank_active
  ON app_loyalty_tiers(rank DESC, min_points ASC)
  WHERE deleted_at IS NULL AND active = true;

COMMENT ON TABLE app_loyalty_tiers IS
  'BIN-700: admin-konfigurerte loyalty-tiers (bronze/silver/gold/...). Rank-basert; assignment velger høyeste aktive tier der lifetime_points >= min_points.';

COMMENT ON COLUMN app_loyalty_tiers.rank IS
  'BIN-700: hierarkisk rang. 1 = laveste. Høyere rank = bedre tier. Unik pr ikke-slettet rad.';

COMMENT ON COLUMN app_loyalty_tiers.benefits_json IS
  'BIN-700: fri-form benefits-payload (bonus-prosent, fri-spinn, prioritet). Konsumeres av framtidig integrasjon — denne PR lagrer kun.';

-- ── 2. Loyalty player-state (én rad pr spiller) ─────────────────────────────

CREATE TABLE IF NOT EXISTS app_loyalty_player_state (
  user_id              TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  -- Nåværende tier (NULL = ingen tier-tildeling ennå; admin kan manuelt sette
  -- en tier uavhengig av points). Når automatic assignment lander, settes
  -- dette automatisk basert på lifetime_points vs app_loyalty_tiers.min_points.
  current_tier_id      TEXT NULL REFERENCES app_loyalty_tiers(id) ON DELETE SET NULL,
  -- Akkumulerte poeng siden konto ble opprettet (aldri reset).
  lifetime_points      INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  -- Poeng akkumulert i inneværende måned. Reset av monthly-reset-job hver 1.
  -- i måneden. Brukes av framtidige månedlige kampanjer (utenfor scope her).
  month_points         INTEGER NOT NULL DEFAULT 0 CHECK (month_points >= 0),
  -- ISO-måned-nøkkel ("2026-04") for reset-idempotens. Job oppdaterer denne
  -- til ny måned etter reset. NULL ved første lifetime-insert.
  month_key            TEXT NULL,
  -- Override-flag: true hvis admin har låst tier manuelt (bypass automatic
  -- assignment). Når false kan future assignment-jobb reassigne.
  tier_locked          BOOLEAN NOT NULL DEFAULT false,
  -- Tidspunkt for siste oppdatering av state (points eller tier-endring).
  last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_loyalty_player_state_tier
  ON app_loyalty_player_state(current_tier_id)
  WHERE current_tier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_loyalty_player_state_lifetime
  ON app_loyalty_player_state(lifetime_points DESC);

COMMENT ON TABLE app_loyalty_player_state IS
  'BIN-700: per-spiller loyalty-aggregat. current_tier_id er NULL før første tier-assignment. month_points reset av loyalty-monthly-reset-job.';

COMMENT ON COLUMN app_loyalty_player_state.tier_locked IS
  'BIN-700: manuell tier-override fra admin. true = bypass automatic assignment (for VIP-program etc.).';

COMMENT ON COLUMN app_loyalty_player_state.month_key IS
  'BIN-700: ISO-måned-nøkkel ("YYYY-MM") for reset-idempotens. Job bruker denne til å unngå dobbel-reset.';

-- ── 3. Loyalty events (append-only aktivitets-log) ──────────────────────────

CREATE TABLE IF NOT EXISTS app_loyalty_events (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- Event-type: 'admin_award' (manuell justering), 'game_play' (automatisk
  -- fra spill, reservert), 'milestone' (jubileum etc.), 'monthly_reset'
  -- (markør-rad når month_points nullstilles), 'tier_override' (admin satte
  -- tier manuelt).
  event_type          TEXT NOT NULL,
  -- Poeng-endring. Positiv = tildeling, negativ = reversal/justering.
  -- Kan være 0 for rene markør-events (monthly_reset, tier_override).
  points_delta        INTEGER NOT NULL DEFAULT 0,
  -- Fri-form metadata: admin-note, game-session-id, milestone-type, osv.
  metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Hvem utførte event (NULL for system/automatic events).
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_loyalty_events_user_time
  ON app_loyalty_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_loyalty_events_type_time
  ON app_loyalty_events(event_type, created_at DESC);

COMMENT ON TABLE app_loyalty_events IS
  'BIN-700: append-only loyalty-aktivitets-log. Alle points-endringer + tier-overrides + monthly-resets registreres her for revisjonsspor.';

COMMENT ON COLUMN app_loyalty_events.event_type IS
  'BIN-700: event-type-slug. Kjente: admin_award, game_play (reservert), milestone, monthly_reset, tier_override.';
