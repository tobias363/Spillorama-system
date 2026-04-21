-- GAME1_SCHEDULE PR 4a: physical_tickets.assigned_game_id → FK app_game1_scheduled_games(id).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
--
-- Bakgrunn: BIN-587 B4a la `assigned_game_id TEXT NULL` på app_physical_tickets
-- uten FK fordi det pekte til legacy room-id-strenger uten egen tabell.
-- GAME1_SCHEDULE PR 1 innførte app_game1_scheduled_games som første kanoniske
-- target. Denne migrasjonen linker kolonnen til den nye tabellen.
--
-- Designvalg:
--   * NOT VALID-constraint: vi validerer ikke eksisterende rader nå fordi
--     legacy kan ha andre ref-er (room-ID-strenger eller NULL) i disse
--     radene. Nye rader valideres mot constraintet fra denne migrasjonen
--     og fremover. En separat VALIDATE-migrasjon kjøres når legacy-data er
--     cleanup'et eller migrert (tracked som eget issue i PR 4b).
--   * ON DELETE SET NULL: hvis et scheduled_game slettes, mister vi bare
--     koblingen — billetten forblir i tabellen (forward-only BIN-661).
--     Matcher tidligere intensjon med assigned_game_id NULL = "ikke tildelt".
--   * Batches-tabellen har også `assigned_game_id TEXT NULL` — samme FK
--     legges på der, same NOT VALID-strategi.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

ALTER TABLE app_physical_tickets
  ADD CONSTRAINT fk_physical_tickets_scheduled_game
  FOREIGN KEY (assigned_game_id)
  REFERENCES app_game1_scheduled_games(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE app_physical_ticket_batches
  ADD CONSTRAINT fk_physical_ticket_batches_scheduled_game
  FOREIGN KEY (assigned_game_id)
  REFERENCES app_game1_scheduled_games(id)
  ON DELETE SET NULL
  NOT VALID;

COMMENT ON CONSTRAINT fk_physical_tickets_scheduled_game
  ON app_physical_tickets IS
  'GAME1_SCHEDULE PR4a: FK til app_game1_scheduled_games. NOT VALID for å unngå validering av legacy rader; VALIDATE kjører i separat migrasjon når legacy er ryddet.';

COMMENT ON CONSTRAINT fk_physical_ticket_batches_scheduled_game
  ON app_physical_ticket_batches IS
  'GAME1_SCHEDULE PR4a: FK til app_game1_scheduled_games. NOT VALID for legacy-kompatibilitet; validering deferred.';
