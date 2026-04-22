-- BIN-690 Spor 3 M5: app_game1_oddsen_state — cross-round state for Oddsen.
--
-- Spec: docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Spor 3 M5
--       + PR-M5 scope (2026-04-22): Oddsen er unik fordi tallet velges MELLOM
--       bingo-runder, persisteres, og resolves ved neste spill i samme hall.
--
-- Formål: Oddsen er det eneste mini-spillet med cross-round state. Forrige
-- Fullt Hus-vinner velger et av tallene 55/56/57 (default). Valget lagres
-- per-hall i denne tabellen og resolves når NESTE scheduled_game trekker
-- det valgte tallet som draw #57 (eller hvilket som er terskel). Pot er
-- 1500 kr (ticket=10) eller 3000 kr (ticket=20).
--
-- Kontrast mot app_game1_mini_game_results (M1):
--   * mini_game_results: én rad per trigget mini-game-instans, bundet til
--     ÉN scheduled_game (trigget + resolves samme spill). Passer for
--     wheel/chest/colordraft som spilles UNDER bingo-runden.
--   * oddsen_state: én rad per valg, spenner ACROSS to scheduled_games
--     (set_by_game_id i spill N, resolves i chosen_for_game_id = spill N+1).
--     Skiller pga cross-round semantikk + behov for regulatorisk sporbarhet
--     på cross-game ledger-trail (valget kan overleve server-restart, og
--     må kunne rekonstrueres forensic).
--
-- Design:
--   * chosen_number INTEGER CHECK (55, 56, 57): kun tre gyldige tall.
--     DB-constraint beskytter mot korrupt valg selv ved engine-bug.
--   * chosen_by_player_id TEXT: spiller som valgte. Ikke FK pga bruker-
--     sletting ikke skal fjerne historikk (samme pattern som
--     mini_game_results.winner_user_id).
--   * chosen_for_game_id TEXT FK app_game1_scheduled_games(id) ON DELETE
--     RESTRICT: spillet der state skal evalueres. RESTRICT (ikke CASCADE)
--     fordi historikk må bevares selv om et fremtidig spill senere slettes.
--   * set_by_game_id TEXT FK app_game1_scheduled_games(id) ON DELETE
--     RESTRICT: spillet der valget ble gjort (forrige Fullt Hus-vinner).
--   * UNIQUE (hall_id, chosen_for_game_id): kun ett aktivt valg per
--     (hall, neste-spill). Hindrer dobbel-INSERT ved retry. Hvis to forrige-
--     vinnere forsøker å velge for samme neste spill (sjelden multi-winner
--     Fullt Hus-scenario) → andre forsøk blir rejectet.
--   * resolved_at / resolved_outcome / pot_amount_cents: NULL frem til
--     evaluerings-tidspunkt. 'hit' = treff → pot utbetalt, 'miss' = ikke
--     truffet, 'expired' = neste-spill fullførte uten å nå terskel.
--   * ticket_size_at_win TEXT CHECK ('small','large'): snapshot av forrige-
--     vinners ticket-pris-kategori. Bestemmer pot-størrelse når resolved:
--     small → 1500 kr, large → 3000 kr. Lagres her fordi vinner-billetten
--     kan bli endret i ettertid (sjeldent, men historikk skal være immutable).
--   * hall_id TEXT FK app_halls(id) ON DELETE RESTRICT: hallen valget er
--     gyldig i. Cross-round state er per-hall fordi halls spiller ulike
--     scheduled_games parallelt — valg i hall A gjelder hall A's neste
--     spill, ikke hall B's.
--
-- Indekser:
--   * (hall_id, chosen_for_game_id) UNIQUE: samme som UNIQUE-constraint.
--   * (chosen_for_game_id): draw-engine lookup "finnes aktiv Oddsen-state
--     for dette spillet?" — brukes for resolving ved draw #N.
--   * (resolved_at) WHERE resolved_at IS NULL: abandoned-/expired-detektor
--     for cleanup-cron (fremtid).
--
-- Regulatoriske krav:
--   * Server-autoritativ: spilleren sender chosen_number via klient, men
--     engine validerer ∈ [55,56,57] og persisterer. Pot-beløp bestemmes
--     server-side av ticket_size_at_win.
--   * Audit: INSERT logges som mini_game.oddsen_number_chosen, resolve
--     logges som mini_game.oddsen_resolved_{hit,miss,expired}.
--   * Idempotency for payout: idempotency-key = `g1-oddsen-${id}` forhindrer
--     dobbel credit ved draw-retry. Se MiniGameOddsenEngine-kommentarer.
--   * Fail-closed: hvis chosen_for_game_id er NULL (ingen neste spill
--     planlagt), insert rejectes i service-laget før DB-hit.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_game1_oddsen_state (
  id                      TEXT PRIMARY KEY,
  -- Hall valget er gyldig i (per-hall cross-round state).
  hall_id                 TEXT NOT NULL
                            REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Valgt tall, kun 55/56/57 i M5.
  chosen_number           INTEGER NOT NULL
                            CHECK (chosen_number IN (55, 56, 57)),
  -- Spilleren som valgte (forrige Fullt Hus-vinner). Ikke FK pga
  -- bruker-sletting skal ikke fjerne historikk.
  chosen_by_player_id     TEXT NOT NULL,
  -- Spillet der valget skal evalueres (neste planlagte scheduled_game i hallen).
  chosen_for_game_id      TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Spillet der valget ble gjort (spillet der Fullt Hus ble vunnet).
  set_by_game_id          TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Ticket-størrelse ved win — bestemmer pot-størrelse ved resolve.
  -- small = 1500 kr pot, large = 3000 kr pot (M5-default).
  ticket_size_at_win      TEXT NOT NULL
                            CHECK (ticket_size_at_win IN ('small', 'large')),
  set_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL frem til evaluerings-tidspunkt.
  resolved_at             TIMESTAMPTZ NULL,
  resolved_outcome        TEXT NULL
                            CHECK (resolved_outcome IS NULL OR
                                   resolved_outcome IN ('hit', 'miss', 'expired')),
  -- Utbetalt pot i øre ved hit (NULL hvis miss/expired eller ikke resolved).
  pot_amount_cents        BIGINT NULL
                            CHECK (pot_amount_cents IS NULL OR pot_amount_cents >= 0),
  -- ID på wallet-transaksjonen for payout (ved hit). NULL hvis ingen payout.
  wallet_transaction_id   TEXT NULL,
  -- Én aktiv state per (hall, neste-spill). Hindrer dobbel-INSERT.
  CONSTRAINT uq_game1_oddsen_state_hall_for_game UNIQUE
    (hall_id, chosen_for_game_id)
);

-- Draw-engine lookup: "finnes aktiv Oddsen-state for dette spillet?"
-- Brukes for resolving ved draw #57 (eller terskel) i Game1DrawEngineService.
CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_for_game
  ON app_game1_oddsen_state(chosen_for_game_id)
  WHERE resolved_at IS NULL;

-- Spiller-historikk: "mine Oddsen-valg" for bruker-UI (fremtid).
CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_player
  ON app_game1_oddsen_state(chosen_by_player_id, set_at DESC);

-- Hall-rapport + cron-cleanup av expired states.
CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_hall
  ON app_game1_oddsen_state(hall_id, set_at DESC);

COMMENT ON TABLE app_game1_oddsen_state IS
  'BIN-690 M5: cross-round state for Oddsen mini-game. Forrige Fullt Hus-vinner velger et tall 55/56/57; state resolves ved neste spill i samme hall. Én rad per valg.';

COMMENT ON COLUMN app_game1_oddsen_state.chosen_number IS
  'BIN-690 M5: valgt tall (55, 56 eller 57). CHECK enforcer DB-validering selv ved engine-bug.';

COMMENT ON COLUMN app_game1_oddsen_state.chosen_for_game_id IS
  'BIN-690 M5: scheduled_game der state skal evalueres. Engine slår opp denne ved draw-resolve i Game1DrawEngineService.';

COMMENT ON COLUMN app_game1_oddsen_state.ticket_size_at_win IS
  'BIN-690 M5: snapshot av forrige-vinners ticket-pris-kategori. small → 1500 kr pot, large → 3000 kr pot.';

COMMENT ON COLUMN app_game1_oddsen_state.resolved_outcome IS
  'BIN-690 M5: hit = treff på valgt tall ved terskel-draw, miss = ikke truffet, expired = neste-spill fullførte uten resolve (sjeldent).';
