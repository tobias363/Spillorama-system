-- GAME1_SCHEDULE PR 2: app_game1_hall_ready_status (per-hall ready-flagg + sales-snapshot).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.2 + §3.4.
--
-- Formål: hver participating hall for et spawned Game 1-spill får en rad.
-- Bingovert-en i hallen trykker "klar" → is_ready=true, ready_at=NOW(),
-- digital_tickets_sold + physical_tickets_sold snapshot fra salgstall. Når
-- alle non-excluded haller er klare, flipper scheduler-tick spillets status
-- fra 'purchase_open' → 'ready_to_start'. Master-UI ser grønn/rød per hall
-- via socket-event `game1:ready-status-update`.
--
-- PK (game_id, hall_id) gjør UPSERT-flyten trivielt idempotent — bingovert
-- kan trykke klar → angre → klar igjen uten dobbelt-rad.
--
-- Designvalg:
--   * `game_id` FK → app_game1_scheduled_games(id) med ON DELETE CASCADE,
--     slik at sletting av et game-row (cancelled end-of-day, cleanup) rydder
--     opp ready-status-rader.
--   * `hall_id` FK → app_halls(id) med ON DELETE RESTRICT — vi vil ikke
--     miste audit-koblingen om en hall slettes midt i en plan.
--   * `is_ready` + `ready_at` + `ready_by_user_id` — bingovert-signalet.
--     ready_by_user_id er IKKE FK fordi user-sletting ikke skal fjerne
--     historikk (matcher mønsteret i app_game1_scheduled_games).
--   * `digital_tickets_sold` / `physical_tickets_sold` — INT snapshot på
--     ready-trykk-tidspunktet. Senere viser master-UI dette i live-view.
--     Default 0 (rad opprettes på første ready-trykk; evt seed-pre-create
--     er opt-in i service-laget).
--   * `excluded_from_game` + `excluded_reason` — master ekskluderer hall
--     (teknisk feil). `allParticipatingHallsReady` teller kun non-excluded.
--
-- Indexer:
--   * (game_id, is_ready) for "er alle klare?"-sjekk (hyppig query i
--     scheduler-tick + master-UI).
--   * (hall_id, is_ready) for per-hall dashboards og audit.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_hall_ready_status (
  game_id                  TEXT NOT NULL
                             REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  hall_id                  TEXT NOT NULL
                             REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Ready-signal fra bingovert.
  is_ready                 BOOLEAN NOT NULL DEFAULT false,
  ready_at                 TIMESTAMPTZ NULL,
  -- Audit: userId til bingovert som trykket klar. Ikke FK — bevares ved user-delete.
  ready_by_user_id         TEXT NULL,
  -- Snapshot av salgstall på ready-trykk-tidspunktet.
  digital_tickets_sold     INTEGER NOT NULL DEFAULT 0
                             CHECK (digital_tickets_sold >= 0),
  physical_tickets_sold    INTEGER NOT NULL DEFAULT 0
                             CHECK (physical_tickets_sold >= 0),
  -- Master-ekskludering (teknisk feil i hall; teller ikke i allReady).
  excluded_from_game       BOOLEAN NOT NULL DEFAULT false,
  excluded_reason          TEXT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, hall_id)
);

-- "Er alle klare?"-query i scheduler-tick (transitionReadyToStartGames).
CREATE INDEX IF NOT EXISTS idx_game1_hall_ready_game_ready
  ON app_game1_hall_ready_status(game_id, is_ready);

-- Per-hall dashboards + audit ("hvor mange ganger har denne hallen vært klar?").
CREATE INDEX IF NOT EXISTS idx_game1_hall_ready_hall_ready
  ON app_game1_hall_ready_status(hall_id, is_ready);

COMMENT ON TABLE app_game1_hall_ready_status IS
  'GAME1_SCHEDULE PR2: per-hall ready-flagg + sales-snapshot per spawned Game 1-spill. Bingovert trykker klar → UPSERT is_ready=true + snapshot.';

COMMENT ON COLUMN app_game1_hall_ready_status.digital_tickets_sold IS
  'GAME1_SCHEDULE PR2: antall solgte digitale billetter per hall på ready-trykk-tidspunktet (snapshot, ikke live).';

COMMENT ON COLUMN app_game1_hall_ready_status.physical_tickets_sold IS
  'GAME1_SCHEDULE PR2: antall solgte fysiske billetter per hall på ready-trykk-tidspunktet (snapshot, ikke live).';

COMMENT ON COLUMN app_game1_hall_ready_status.excluded_from_game IS
  'GAME1_SCHEDULE PR2: master har ekskludert denne hallen (teknisk feil). allParticipatingHallsReady teller kun non-excluded rader.';
