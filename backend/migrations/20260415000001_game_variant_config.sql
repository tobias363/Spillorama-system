-- BIN-436: Game variant configuration for ticket types, colors, and patterns.
--
-- Adds variant_config JSONB to hall_game_schedules so each scheduled game
-- can have its own ticket types, prize patterns, and game-specific settings.
--
-- This replaces the old AIS subGame1.ticketColor / subGame1.options system
-- with a single JSONB column that stores the full variant configuration.

ALTER TABLE hall_game_schedules
  ADD COLUMN IF NOT EXISTS variant_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN hall_game_schedules.variant_config IS
  'Game variant config: ticket types, patterns, prices. Schema depends on game_type.';

-- Seed standard variant configs for existing schedules that have game_type set.
-- game_type values: "standard", "elvis", "traffic-light"

-- Standard bingo config (default ticket types matching old AIS "color" gameType)
UPDATE hall_game_schedules
SET variant_config = '{
  "ticketTypes": [
    {"name": "Small Yellow", "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Small White",  "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Small Purple", "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Small Red",    "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Small Green",  "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Small Orange", "type": "small", "priceMultiplier": 1, "ticketCount": 1},
    {"name": "Large Yellow", "type": "large", "priceMultiplier": 3, "ticketCount": 3},
    {"name": "Large White",  "type": "large", "priceMultiplier": 3, "ticketCount": 3}
  ],
  "patterns": [
    {"name": "Row 1", "claimType": "LINE", "prizePercent": 10, "design": 1},
    {"name": "Row 2", "claimType": "LINE", "prizePercent": 10, "design": 2},
    {"name": "Row 3", "claimType": "LINE", "prizePercent": 10, "design": 3},
    {"name": "Row 4", "claimType": "LINE", "prizePercent": 10, "design": 4},
    {"name": "Full House", "claimType": "BINGO", "prizePercent": 60, "design": 0}
  ]
}'::jsonb
WHERE game_type = 'standard' AND variant_config = '{}'::jsonb;

-- Elvis variant config
UPDATE hall_game_schedules
SET variant_config = '{
  "ticketTypes": [
    {"name": "Elvis 1", "type": "elvis", "priceMultiplier": 2, "ticketCount": 2},
    {"name": "Elvis 2", "type": "elvis", "priceMultiplier": 2, "ticketCount": 2},
    {"name": "Elvis 3", "type": "elvis", "priceMultiplier": 2, "ticketCount": 2},
    {"name": "Elvis 4", "type": "elvis", "priceMultiplier": 2, "ticketCount": 2},
    {"name": "Elvis 5", "type": "elvis", "priceMultiplier": 2, "ticketCount": 2}
  ],
  "patterns": [
    {"name": "Row 1", "claimType": "LINE", "prizePercent": 10, "design": 1},
    {"name": "Row 2", "claimType": "LINE", "prizePercent": 10, "design": 2},
    {"name": "Row 3", "claimType": "LINE", "prizePercent": 10, "design": 3},
    {"name": "Row 4", "claimType": "LINE", "prizePercent": 10, "design": 4},
    {"name": "Full House", "claimType": "BINGO", "prizePercent": 60, "design": 0}
  ],
  "replaceAmount": 0
}'::jsonb
WHERE game_type = 'elvis' AND variant_config = '{}'::jsonb;

-- Traffic Light variant config
UPDATE hall_game_schedules
SET variant_config = '{
  "ticketTypes": [
    {"name": "Traffic Light", "type": "traffic-light", "priceMultiplier": 3, "ticketCount": 3,
     "colors": ["Small Red", "Small Yellow", "Small Green"]}
  ],
  "patterns": [
    {"name": "Row 1", "claimType": "LINE", "prizePercent": 10, "design": 1},
    {"name": "Row 2", "claimType": "LINE", "prizePercent": 10, "design": 2},
    {"name": "Row 3", "claimType": "LINE", "prizePercent": 10, "design": 3},
    {"name": "Row 4", "claimType": "LINE", "prizePercent": 10, "design": 4},
    {"name": "Full House", "claimType": "BINGO", "prizePercent": 60, "design": 0}
  ]
}'::jsonb
WHERE game_type = 'traffic-light' AND variant_config = '{}'::jsonb;
