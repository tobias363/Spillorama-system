-- BIN-583 B3.6: Product-salg (admin katalog + agent cart + sale).
--
-- Port of legacy productManagement.* + agentcashinoutController.sellProductAgent.
-- Spillorama bruker produkt-salg som hall-operativ kiosk-funksjonalitet
-- (snacks, drikke, merchandise) — ikke del av bingo-spillet selv.
--
-- Tabeller:
--   app_product_categories   — kategoritre (flat — ingen parent ref i MVP)
--   app_products             — produkt-katalog, global (pris satt sentralt)
--   app_hall_products        — hall-assignment (hvilke produkter som selges hvor)
--   app_product_carts        — draft carts (agent bygger før checkout)
--   app_product_cart_items   — linje-items per cart
--   app_product_sales        — finalized sales (audit-spor + link til transaksjon)
--
-- Betalingsmetoder: CASH, CARD, CUSTOMER_NUMBER (wallet-trekk).
-- CUSTOMER_NUMBER krever gyldig player-wallet i agentens hall.
--
-- Up

CREATE TABLE IF NOT EXISTS app_product_categories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_product_categories_active
  ON app_product_categories (is_active) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS app_products (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NULL,
  price_cents   BIGINT NOT NULL CHECK (price_cents >= 0),
  category_id   TEXT NULL REFERENCES app_product_categories(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status
  ON app_products (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category
  ON app_products (category_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS app_hall_products (
  hall_id      TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (hall_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_hall_products_hall
  ON app_hall_products (hall_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS app_product_carts (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL UNIQUE,
  agent_user_id   TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id         TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  shift_id        TEXT NOT NULL REFERENCES app_agent_shifts(id) ON DELETE RESTRICT,
  user_type       TEXT NOT NULL CHECK (user_type IN ('ONLINE','PHYSICAL')),
  user_id         TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  username        TEXT NULL,
  total_cents     BIGINT NOT NULL CHECK (total_cents >= 0),
  status          TEXT NOT NULL DEFAULT 'CART_CREATED'
                    CHECK (status IN ('CART_CREATED','ORDER_PLACED','CANCELLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_carts_shift
  ON app_product_carts (shift_id, status);
CREATE INDEX IF NOT EXISTS idx_product_carts_agent
  ON app_product_carts (agent_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_product_cart_items (
  cart_id          TEXT NOT NULL REFERENCES app_product_carts(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES app_products(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS app_product_sales (
  id                TEXT PRIMARY KEY,
  cart_id           TEXT NOT NULL REFERENCES app_product_carts(id) ON DELETE RESTRICT,
  order_id          TEXT NOT NULL UNIQUE,
  hall_id           TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  shift_id          TEXT NOT NULL REFERENCES app_agent_shifts(id) ON DELETE RESTRICT,
  agent_user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  player_user_id    TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  payment_method    TEXT NOT NULL CHECK (payment_method IN ('CASH','CARD','CUSTOMER_NUMBER')),
  total_cents       BIGINT NOT NULL CHECK (total_cents >= 0),
  wallet_tx_id      TEXT NULL,
  agent_tx_id       TEXT NULL REFERENCES app_agent_transactions(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_sales_shift
  ON app_product_sales (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_sales_hall
  ON app_product_sales (hall_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_sales_player
  ON app_product_sales (player_user_id) WHERE player_user_id IS NOT NULL;

-- Down
-- DROP TABLE IF EXISTS app_product_sales;
-- DROP TABLE IF EXISTS app_product_cart_items;
-- DROP TABLE IF EXISTS app_product_carts;
-- DROP TABLE IF EXISTS app_hall_products;
-- DROP TABLE IF EXISTS app_products;
-- DROP TABLE IF EXISTS app_product_categories;
