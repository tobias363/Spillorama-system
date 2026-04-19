-- BIN-498: per-hall TV-display URL.
--
-- Holds an optional embed URL (e.g. ad reel, partner promo) shown on the
-- hall's TV-display when no live game is running. Nullable — most halls
-- start without an embed.
--
-- Up migration
ALTER TABLE app_halls
  ADD COLUMN tv_url TEXT;

COMMENT ON COLUMN app_halls.tv_url IS
  'BIN-498: optional embed URL shown on the hall TV-display between rounds.';
