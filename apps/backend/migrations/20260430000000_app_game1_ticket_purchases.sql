-- GAME1_SCHEDULE PR 4a: app_game1_ticket_purchases — ticket-purchase-foundation.
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
--
-- Formål: én rad = én purchase-transaksjon (atomisk — en kjøper kan ha flere
-- billetter i én purchase). Tabellen er *felles grunnmur* for Game 1:
-- uansett om draw-engine bygges som Alt 1 eller Alt 3, trenger vi å vite
-- hvem som har kjøpt hvilke billetter til hvilket scheduled_game, når, og
-- i hvilken hall. Tabellen er kilden til sannhet for sales-tracking, audit
-- og refund-flyten.
--
-- Designvalg:
--   * `scheduled_game_id` FK → app_game1_scheduled_games(id) med ON DELETE
--     RESTRICT — purchase-historikk skal bevares selv om et scheduled game
--     slettes (BIN-661 forward-only semantikk + pengeflyt-audit).
--   * `buyer_user_id` FK → app_users(id) med ON DELETE RESTRICT — vi vil
--     ikke miste purchase-koblingen om en user slettes midt i plan.
--   * `hall_id` FK → app_halls(id) ON DELETE RESTRICT — hallen spilleren sto
--     i da kjøpet ble gjort. Viktig for hall-limits og Spillvett-rapporter.
--     Ikke avledet fra buyer.home_hall — spillere kan spille i flere haller.
--   * `ticket_spec_json` JSONB: array av { color, size, count, price_cents_each }.
--     Eksempel: [{"color":"yellow","size":"small","count":3,"price_cents_each":2000}].
--     Denormalisert snapshot av ticket-konfig på kjøp-tidspunktet (priser
--     valideres mot scheduled_games.ticket_config_json i service-laget).
--   * `total_amount_cents` BIGINT: Σ(count * price_cents_each) på kjøp-tidspunktet.
--     CHECK >= 0 (gratisbilletter støttes i teorien; service-laget avgjør policy).
--   * `payment_method` TEXT CHECK IN (…): 3 modi.
--       - 'digital_wallet' — kjøp fra egen spillerkonto (walletAdapter.debit).
--       - 'cash_agent'     — kontant via agent (ingen wallet-flyt).
--       - 'card_agent'     — kort via agent (ingen wallet-flyt).
--   * `agent_user_id` FK → app_users(id) ON DELETE SET NULL: kreves hvis
--     payment_method er agent-basert. Enforcet i service-laget fordi DB
--     CHECK ikke kan kombinere NULL-semantikk på tvers av kolonner rent.
--   * `idempotency_key` TEXT + UNIQUE: safe retry. Samme nøkkel → samme
--     purchase (idempotent hit returneres uten ny debit). Nøkkel format:
--     "game1-purchase:{scheduled_game_id}:{buyer_user_id}:{clientRequestId}".
--   * `refund_*`-felter: NULL frem til refund skjer. `refund_transaction_id`
--     peker til wallet-tx-ID ved digital_wallet refund, eller er NULL for
--     agent-refunds (håndteres fysisk, kun logg + audit).
--
-- Indexer:
--   * scheduled_game_id — per-spill sales queries + hall ready-snapshot.
--   * buyer_user_id — "mine billetter for dette spillet".
--   * hall_id — hall-lokal sales + Spillvett-rapport.
--   * partial (scheduled_game_id) WHERE refunded_at IS NULL — refundable
--     lookup brukes i refund-flyten og ved draw-engine-ticket-enumeration.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_ticket_purchases (
  id                        TEXT PRIMARY KEY,
  scheduled_game_id         TEXT NOT NULL
                              REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  buyer_user_id             TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                   TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Array av { color, size, count, price_cents_each }. Snapshot av priser
  -- ved kjøp — service-laget validerer mot scheduled_games.ticket_config_json.
  ticket_spec_json          JSONB NOT NULL,
  total_amount_cents        BIGINT NOT NULL
                              CHECK (total_amount_cents >= 0),
  payment_method            TEXT NOT NULL
                              CHECK (payment_method IN (
                                'digital_wallet',
                                'cash_agent',
                                'card_agent'
                              )),
  -- Må være satt hvis payment_method er agent-basert (enforcet i service).
  agent_user_id             TEXT NULL
                              REFERENCES app_users(id) ON DELETE SET NULL,
  -- Idempotency for safe retry. Samme key → returner eksisterende rad
  -- uten ny wallet-debit (alreadyExisted: true).
  idempotency_key           TEXT NOT NULL,
  purchased_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Refund-state: NULL = ikke refundert. Settes ved refundPurchase().
  refunded_at               TIMESTAMPTZ NULL,
  refund_reason             TEXT NULL,
  refunded_by_user_id       TEXT NULL
                              REFERENCES app_users(id) ON DELETE SET NULL,
  -- wallet-tx-ID for digital_wallet-refund; NULL for agent-cash/card
  -- (håndteres fysisk, kun audit-log spor).
  refund_transaction_id     TEXT NULL,
  UNIQUE (idempotency_key)
);

-- Per-spill sales-listing (scheduler-tick, draw-engine-ticket-enumeration).
CREATE INDEX IF NOT EXISTS idx_game1_purchases_scheduled_game
  ON app_game1_ticket_purchases(scheduled_game_id);

-- "Mine billetter for dette spillet" + buyer-history.
CREATE INDEX IF NOT EXISTS idx_game1_purchases_buyer
  ON app_game1_ticket_purchases(buyer_user_id);

-- Hall-lokal sales-rapport + Spillvett-limit-sjekk per hall.
CREATE INDEX IF NOT EXISTS idx_game1_purchases_hall
  ON app_game1_ticket_purchases(hall_id);

-- Refundable lookup: ikke-refunderte rader per scheduled_game. Brukt av
-- refund-flyten og ved draw-engine-billett-enumerering i PR 4b.
CREATE INDEX IF NOT EXISTS idx_game1_purchases_refundable
  ON app_game1_ticket_purchases(scheduled_game_id)
  WHERE refunded_at IS NULL;

COMMENT ON TABLE app_game1_ticket_purchases IS
  'GAME1_SCHEDULE PR4a: én rad per purchase-transaksjon til et Game 1 scheduled_game. Felles grunnmur for draw-engine (PR 4b).';

COMMENT ON COLUMN app_game1_ticket_purchases.ticket_spec_json IS
  'GAME1_SCHEDULE PR4a: array [{color, size, count, price_cents_each}]. Snapshot av kjøp — validert mot scheduled_games.ticket_config_json i service-laget.';

COMMENT ON COLUMN app_game1_ticket_purchases.payment_method IS
  'GAME1_SCHEDULE PR4a: digital_wallet (walletAdapter.debit), cash_agent (agent tar kontanter), card_agent (agent kjører kort).';

COMMENT ON COLUMN app_game1_ticket_purchases.idempotency_key IS
  'GAME1_SCHEDULE PR4a: UNIQUE safe-retry-nøkkel. Samme verdi ved retry returnerer eksisterende purchase uten ny wallet-debit.';

COMMENT ON COLUMN app_game1_ticket_purchases.refund_transaction_id IS
  'GAME1_SCHEDULE PR4a: wallet-tx-ID ved digital_wallet-refund. NULL for agent-payments (refund skjer fysisk, kun audit-logg).';
