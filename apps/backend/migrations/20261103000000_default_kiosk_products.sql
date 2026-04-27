-- BIN-PILOT — Seed default kiosk-produkter for Sell Products-flyt.
--
-- Spec: docs/architecture/WIREFRAME_CATALOG.md §17.12 (agent kiosk-salg)
--       MASTER_PLAN_SPILL1_PILOT_2026-04-24.md (pilot-blokker — agenten
--       kan ikke selge kaffe/snacks uten katalog-data).
--
-- Wireframe-eksempel: agent-knapper viser "Coffee", "Chocolate", "Rice"
-- — så vi seeder placeholder-katalog som hver hall kan justere senere
-- via /productList + /hallProductList.
--
-- Idempotent: ON CONFLICT DO NOTHING på både kategori, produkt og hall-
-- binding gjør at re-kjøring ikke duplikerer rader.
--
-- Up migration

-- 1. Standard "Kiosk"-kategori.
INSERT INTO app_product_categories (id, name, sort_order, is_active)
VALUES
  ('cat-kiosk', 'Kiosk', 0, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. Tre default-produkter.
-- Priser i øre (cents) — wireframe sier kr 30 / 25 / 20.
INSERT INTO app_products (id, name, description, price_cents, category_id, status)
VALUES
  ('prod-coffee',    'Kaffe',       'Kopp kaffe',                3000, 'cat-kiosk', 'ACTIVE'),
  ('prod-chocolate', 'Sjokolade',   'Sjokoladeplate',            2500, 'cat-kiosk', 'ACTIVE'),
  ('prod-rice',      'Riskake',     'Riskake snack',             2000, 'cat-kiosk', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 3. Bind alle eksisterende haller til alle tre produkter.
-- Senere kan hall-operatør deaktivere per produkt via app_hall_products.is_active.
INSERT INTO app_hall_products (hall_id, product_id, is_active)
SELECT h.id, p.id, TRUE
FROM app_halls h
CROSS JOIN (VALUES ('prod-coffee'), ('prod-chocolate'), ('prod-rice')) AS p(id)
ON CONFLICT (hall_id, product_id) DO NOTHING;
