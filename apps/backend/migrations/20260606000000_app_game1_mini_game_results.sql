-- BIN-690 Spor 3 M1: app_game1_mini_game_results (framework-persistens).
--
-- Spec: docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Spor 3
--
-- Formål: én rad per trigget mini-game-instans. Orchestrator (M1) INSERT-er
-- raden når en Fullt Hus-vinner trigger en mini-game, og UPDATE-er raden
-- når spilleren har gjort sitt valg og resultatet er utbetalt.
--
-- Kontrast mot `app_mini_games_config` (BIN-679): dén tabellen er admin-
-- konfigurasjon (én singleton-rad per spill-type, fri-form prize-lister).
-- Denne tabellen er RUNTIME-historikk (én rad per trigget instans, med
-- resultat + payout-referanse).
--
-- Designvalg:
--   * `mini_game_type` TEXT + CHECK: framework-type-discriminator. Matcher
--     MiniGameType-interface (MiniGame.type). Utvides når M2-M5 legges til.
--   * `scheduled_game_id` FK REFERENCES app_game1_scheduled_games: mini-
--     game er bundet til én Spill 1-instans. ON DELETE CASCADE slik at
--     rader forsvinner hvis spillet slettes.
--   * `winner_user_id` TEXT (ikke FK): spiller som trigget mini-game.
--     Ikke FK pga bruker-sletting ikke skal fjerne historikk.
--   * `triggered_at` / `completed_at`: lifecycle-timestamps. `completed_at`
--     NULL frem til spilleren har gjort valg + resultatet er utbetalt.
--     Orchestrator bruker dette til å detektere "abandoned" mini-games.
--   * `result_json` JSONB: spill-spesifikt resultat-payload. Schema varierer
--     per mini_game_type (wheel → { segmentIndex, prize }, chest → { chestIdx,
--     prize }, osv.). Valideres av mini-game-implementasjonen i M2-M5.
--   * `payout_cents` INT DEFAULT 0: utbetalt beløp i øre. 0 hvis mini-game
--     enda ikke fullført eller gave 0 kr.
--   * `choice_json` JSONB NULL: spillerens valg (f.eks. { chestIdx: 2 }
--     for chest, { color: "red" } for colordraft). NULL hvis spillet ikke
--     krever valg (wheel = ingen valg, bare spin).
--   * `config_snapshot_json` JSONB: snapshot av mini-game-config på
--     trigger-tidspunkt. Beskytter mot admin-endringer midt i spillet.
--   * UNIQUE (scheduled_game_id, winner_user_id): én mini-game per
--     (scheduled_game, winner). Legacy-pattern: én vinner per Fullt Hus →
--     én mini-game. Hvis fremtidig multi-winner Fullt Hus → migrer til
--     (scheduled_game_id, winner_user_id, triggered_at).
--
-- Indekser:
--   * (scheduled_game_id): list mini-games per spill (admin-overview).
--   * (winner_user_id, triggered_at DESC): spillerens mini-game-historikk.
--   * (completed_at) WHERE completed_at IS NULL: abandoned-detektor
--     (orchestrator-cron i M2+ kan finne ufullførte).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_game1_mini_game_results (
  id                      TEXT PRIMARY KEY,
  scheduled_game_id       TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id)
                            ON DELETE CASCADE,
  -- Framework-type. CHECK-listen utvides når M2-M5 lander. Start med alle
  -- fire typer så migrasjonen ikke må re-kjøres for å akseptere dem.
  mini_game_type          TEXT NOT NULL
                            CHECK (mini_game_type IN (
                              'wheel',
                              'chest',
                              'colordraft',
                              'oddsen'
                            )),
  -- Spilleren som trigget mini-game (typisk Fullt Hus-vinner).
  winner_user_id          TEXT NOT NULL,
  -- Snapshot av admin-config på trigger-tidspunkt.
  config_snapshot_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Spillerens valg (hvis relevant). NULL for wheel-type.
  choice_json             JSONB NULL,
  -- Spill-spesifikt resultat-payload. NULL frem til completed_at er satt.
  result_json             JSONB NULL,
  -- Utbetalt beløp i øre. 0 hvis ikke ferdig eller ingen premie.
  payout_cents            INTEGER NOT NULL DEFAULT 0
                            CHECK (payout_cents >= 0),
  triggered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ NULL,
  -- Én mini-game per (spill, vinner).
  CONSTRAINT uq_game1_mini_game_results_sg_winner UNIQUE
    (scheduled_game_id, winner_user_id)
);

-- Admin-overview: list mini-games per spill.
CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_scheduled
  ON app_game1_mini_game_results(scheduled_game_id);

-- Spiller-historikk: mini-games siste først.
CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_winner_triggered
  ON app_game1_mini_game_results(winner_user_id, triggered_at DESC);

-- Abandoned-detektor (partial-index for ikke-fullførte).
CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_open
  ON app_game1_mini_game_results(triggered_at)
  WHERE completed_at IS NULL;

COMMENT ON TABLE app_game1_mini_game_results IS
  'BIN-690 M1: runtime-historikk for Game 1 mini-games. Én rad per trigget instans. INSERT ved trigger, UPDATE ved completion.';

COMMENT ON COLUMN app_game1_mini_game_results.mini_game_type IS
  'BIN-690 M1: framework-type-discriminator. Matcher MiniGame.type i backend/src/game/minigames/types.ts. Utvides når M2-M5 lander.';

COMMENT ON COLUMN app_game1_mini_game_results.config_snapshot_json IS
  'BIN-690 M1: snapshot av app_mini_games_config.config_json på trigger-tidspunkt. Beskytter mot admin-endringer midt i spillet.';

COMMENT ON COLUMN app_game1_mini_game_results.choice_json IS
  'BIN-690 M1: spillerens valg hvis spillet krever det (chest/colordraft/oddsen). NULL for wheel-type (kun spin).';

COMMENT ON COLUMN app_game1_mini_game_results.result_json IS
  'BIN-690 M1: spill-spesifikt resultat-payload. Schema valideres av mini-game-implementasjonen (M2-M5). NULL frem til completed_at er satt.';

COMMENT ON COLUMN app_game1_mini_game_results.payout_cents IS
  'BIN-690 M1: utbetalt beløp i øre. 0 hvis spillet enda ikke fullført eller resultatet gav 0 kr.';

COMMENT ON COLUMN app_game1_mini_game_results.completed_at IS
  'BIN-690 M1: NULL frem til spilleren har gjort valg + resultatet er utbetalt. Abandoned-detektor bruker partial-index.';
