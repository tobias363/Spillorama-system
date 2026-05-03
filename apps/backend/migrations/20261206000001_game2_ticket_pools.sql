-- 2026-12-06 (Tobias UX, PDF 17 wireframe side 5): Spill 2 Choose Tickets pool
-- persistens.
--
-- Bakgrunn:
-- ChooseTicketsScreen genererer 32 forhåndsgenererte 3×3-brett (1-21
-- ball-range) per spiller per spill og spillerne velger N (max 30) av disse.
-- Pool var tidligere kun in-memory i `Game2TicketPoolService` — det betyr at
-- pool-state forsvinner ved Render-restart, og alle spillere mister sine valg
-- midt-runde.
--
-- Strategi:
-- Persistér pool i `app_game2_ticket_pools`-tabellen med composite-unique på
-- (room_code, player_id, game_id). Ticket-grids serialiseres som JSONB array
-- av 32 number[][]. Purchased indices lagres som INTEGER[]. pick_any_number
-- kan være NULL (spiller har ikke valgt Lucky Number ennå).
--
-- Cache-strategi:
-- Service holder fortsatt in-memory cache for hot-path performance, men DB er
-- kilden ved cold-start (lazy-load ved første tilgang for en gitt
-- room/player/gameId).
--
-- Cleanup:
-- `deletePoolForGame(gameId)` kalles ved game-end så vi ikke akkumulerer
-- ferdig-spilte pools. Pool er per-runde (gameId regenereres ved hver
-- BingoEngine.startGame).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_game2_ticket_pools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code       TEXT NOT NULL,
  player_id       UUID NOT NULL,
  game_id         TEXT NOT NULL,
  ticket_grids    JSONB NOT NULL,
  purchased_indices INTEGER[] NOT NULL DEFAULT '{}',
  pick_any_number INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_game2_ticket_pools_pick_any_number_range
    CHECK (pick_any_number IS NULL OR (pick_any_number >= 1 AND pick_any_number <= 21)),
  CONSTRAINT app_game2_ticket_pools_room_player_game_unique
    UNIQUE (room_code, player_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_app_game2_ticket_pools_game_id
  ON app_game2_ticket_pools (game_id);

COMMENT ON TABLE app_game2_ticket_pools IS
  'Spill 2 (rocket) Choose Tickets pool — 32 forhåndsgenererte 3×3-brett per spiller per runde. Persistert så pool overlever Render-restart. ticket_grids er JSONB-array av 32 number[][] (3×3 grids, ball-range 1-21). purchased_indices er 0-indeksert array av brett spilleren har kjøpt. Slettes ved game-end via Game2TicketPoolService.deletePoolForGame.';

COMMENT ON COLUMN app_game2_ticket_pools.room_code IS
  'Room-code (eks "ROCKET" for shared global rocket-rom).';

COMMENT ON COLUMN app_game2_ticket_pools.player_id IS
  'app_users.id for spilleren.';

COMMENT ON COLUMN app_game2_ticket_pools.game_id IS
  'BingoEngine game-id (RoomState.currentGame.id). Ny gameId per runde, så pool regenereres deterministisk per (room, player, game).';

COMMENT ON COLUMN app_game2_ticket_pools.ticket_grids IS
  'JSONB-array av 32 brett. Hver brett er number[][] (3×3 grid med 9 unike tall fra 1-21). Genereres deterministisk fra mulberry32(hash(room+player+game)).';

COMMENT ON COLUMN app_game2_ticket_pools.purchased_indices IS
  '0-indekserte brett-numre spilleren har kjøpt fra de 32 forhåndsgenererte. Max 30 (delt grense med bet:arm).';

COMMENT ON COLUMN app_game2_ticket_pools.pick_any_number IS
  'Spillerens valgte Lucky Number for runden (1-21). NULL hvis ikke valgt ennå.';
