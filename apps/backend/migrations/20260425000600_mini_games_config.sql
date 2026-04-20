-- BIN-679: otherGames mini-game config (Wheel, Chest, Mystery, Colordraft).
--
-- Admin-konfigurasjon av de fire mini-spillene som Game 1 runtime allerede
-- kjører (wheel of fortune, treasure chest, mystery game, colordraft). Ren
-- KONFIGURASJON — ikke runtime-state. Runtime leser i dag hardkodede
-- prize-arrays i BingoEngine.ts (`MINIGAME_PRIZES`, `JACKPOT_PRIZES`);
-- wiring runtime til å lese fra denne tabellen er eksplisitt out-of-scope
-- for BIN-679 og lander som separat PR slik at admin-UI-sidene kan lande
-- først uten å rokkere runtime-kontrakten.
--
-- Design-valg: én tabell med `game_type` discriminator (unik) + per-spill
-- `config_json` JSONB. Tilsvarer legacy-strukturen i
-- legacy/unity-backend/App/Models/otherGame.js (Mongo-kolleksjonen
-- `otherGame` har én rad per `slug` med et prizeList-felt per spill). Fire
-- separate tabeller var vurdert men gir gjentatt struktur uten funksjonell
-- gevinst siden hvert spill er en singleton-konfig (én rad pr spill).
--
-- Gjenbruk:
--   - Samme mønster som app_leaderboard_tiers (BIN-668) + app_schedules
--     (BIN-625). Tabell-navn prefiks `app_`, TEXT-PK, updated_by-referanse
--     til app_users med ON DELETE SET NULL.
--   - GET returnerer defaults hvis raden ikke finnes (upsert-on-PUT
--     mønster). Admin-UI trenger ikke egne "init"-knapper.
--
-- Soft-delete: IKKE relevant for denne tabellen. Det er 4 singleton-konfiger
-- (én pr spill-type). `active = false` er eneste disable-mekanisme.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_mini_games_config (
  id                    TEXT PRIMARY KEY,
  -- Diskriminator. Enum-like; validering i service-laget. Unik slik at hver
  -- spill-type har nøyaktig én konfig-rad.
  game_type             TEXT NOT NULL
    CHECK (game_type IN ('wheel', 'chest', 'mystery', 'colordraft')),
  -- Spill-spesifikk konfig. Schema varierer per game_type:
  --   wheel:      { segments: [{ label, prizeAmount, weight, color? }, ... 50], ... }
  --   chest:      { prizes: [{ label, prizeAmount, weight }, ...], chestCount?, ... }
  --   mystery:    { rewards: [{ label, prizeAmount, weight }, ...], ... }
  --   colordraft: { colors: [{ color, prizeAmounts: [...], weight? }, ...], ... }
  -- Fri-form for fremtidige felter (icon, eligibility, drop-rates, etc.).
  config_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aktiv-flag. Admin kan deaktivere et mini-spill uten å slette konfig;
  -- runtime respekterer flagget når wiring lander.
  active                BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id    TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Én rad per game_type (singleton-konfig).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_mini_games_config_game_type
  ON app_mini_games_config(game_type);

COMMENT ON TABLE app_mini_games_config IS
  'BIN-679: admin-konfig for Game 1 mini-spillene (wheel, chest, mystery, colordraft). Én singleton-rad per game_type. Ren KONFIGURASJON; runtime bruker i dag hardkodede prize-arrays (BingoEngine.MINIGAME_PRIZES), wiring til denne tabellen lander som separat PR.';

COMMENT ON COLUMN app_mini_games_config.game_type IS
  'BIN-679: diskriminator. Lovlige verdier: wheel, chest, mystery, colordraft. Unik — hver spill-type har nøyaktig én konfig-rad.';

COMMENT ON COLUMN app_mini_games_config.config_json IS
  'BIN-679: spill-spesifikk konfig-payload. Schema varierer per game_type; valideres av service-laget og shared-types Zod-schemas.';

COMMENT ON COLUMN app_mini_games_config.active IS
  'BIN-679: aktiv-flag. Admin kan deaktivere et mini-spill uten å slette konfig. Runtime respekterer flagget når wiring lander.';
