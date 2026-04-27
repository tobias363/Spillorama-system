-- BIN-PILOT — Utvid ticket-color-palette fra 6 til 11 farger.
--
-- Spec: docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md §2.7
--       docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md §8 #3
--       docs/architecture/WIREFRAME_CATALOG.md §17.13 / §17.15
--
-- Bakgrunn:
--   Tobias bekreftet 2026-04-23 at vi skal utvide til "alle 8 farger nå".
--   Master-plan-2026-04-24 §2.7 oppgir "11-palette". Wireframe-katalog
--   §17.15 nevner palette: Small/Large × Yellow/White/Purple, pluss Red,
--   Green, Blue, Small Green. Vi mapper til 11 verdier:
--
--     Originale 6 (beholdes):
--       small_yellow, small_white, large_yellow, large_white,
--       small_purple, large_purple
--
--     Nye 5:
--       small_red, large_red, small_green, large_green, small_blue
--
--   Når wireframe nevner bare "Red"/"Green"/"Blue" uten Small/Large er det
--   fordi farge-størrelses-aksen ikke er bestemt for de nye fargene i
--   legacy-spec. Vi velger å eksponere Small + Large for Red og Green
--   (paritet med originale 6) og Small for Blue. Større utvidelser kan
--   legges til senere uten ny migration ved å endre CHECK-constraint.
--
-- Designvalg:
--   * Forward-only: ingen Down-seksjon (BIN-661).
--   * DROP + ADD CONSTRAINT atomisk i samme transaksjon.
--   * Eksisterende rader er garantert i de 6 originale verdiene, så ny
--     CHECK passer dem alle uten data-migrasjon.
--   * `app_static_tickets` og `app_agent_ticket_ranges` har sin egen,
--     mer gruppert color-aksen ('small'/'large'/'traffic-light') og
--     berøres IKKE av denne migrasjonen — de representerer en annen
--     domene-model (PT2-flyt) enn `app_ticket_ranges_per_game` (PT4-flyt).
--
-- Up

DO $$
BEGIN
  -- Find og drop eksisterende CHECK-constraint på ticket_type. Navn er
  -- ikke deterministisk (auto-generert av Postgres), så vi looper.
  PERFORM 1
  FROM pg_constraint
  WHERE conrelid = 'app_ticket_ranges_per_game'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%ticket_type%';

  IF FOUND THEN
    EXECUTE (
      SELECT 'ALTER TABLE app_ticket_ranges_per_game DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'app_ticket_ranges_per_game'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%ticket_type%'
      LIMIT 1
    );
  END IF;
END$$;

ALTER TABLE app_ticket_ranges_per_game
  ADD CONSTRAINT app_ticket_ranges_per_game_ticket_type_check
  CHECK (ticket_type IN (
    'small_yellow',
    'small_white',
    'large_yellow',
    'large_white',
    'small_purple',
    'large_purple',
    'small_red',
    'large_red',
    'small_green',
    'large_green',
    'small_blue'
  ));

COMMENT ON COLUMN app_ticket_ranges_per_game.ticket_type IS
  '11-palette: small_yellow/small_white/large_yellow/large_white/small_purple/large_purple/small_red/large_red/small_green/large_green/small_blue. Pre-pilot utvidelse 2026-10-01 (master-plan §2.7).';
