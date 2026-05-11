-- BIN-XXXX (Tobias-direktiv 2026-05-11): scheduled-game room_code unique
-- index skal kun gjelde AKTIVE rader (ikke completed/cancelled).
--
-- Bakgrunn:
-- ----------
-- F-NEW-2 (PR fra 2026-05-09) endret `GamePlanEngineBridge.createScheduled
-- GameForPlanRunPosition` til å sette `room_code` opp-front ved INSERT
-- (deterministisk fra `canonicalRoomCode(masterHallId, groupHallId)`) i
-- stedet for lazy-binding ved første spiller-join. Det fikset E2E pilot-
-- blokkeren der `room_code` var NULL etter master.start, slik at engine
-- emit-pathen (`io.to(room_code).emit(...)`) ikke kunne finne et rom.
--
-- Imidlertid avdekker live-testing 2026-05-11 (Tobias-rapport på hall-
-- isolation-testing) at `DemoAutoMasterTickService` looper plan-runs
-- raskt: completed → DELETE run → ny start → ny scheduled-game. Den nye
-- scheduled-game-en prøver å sette samme room_code som forrige completed
-- game (siden begge bruker deterministisk `BINGO_<groupId>`), men hindres
-- av partial unique index `idx_app_game1_scheduled_games_room_code`. Da
-- faller bridge til 23505-catch-blokken som re-INSERTer uten room_code
-- (`assignedRoomCode = null`), og auto-draw-tick emitter til `io.to(NULL)`
-- → ingen broadcast.
--
-- Også relevant for pilot-haller med advance(): hvis en hall fullfører
-- runde N og umiddelbart starter runde N+1 før completed-raden er ryddet
-- ut, vil samme room_code-kollisjon trigge fallback til NULL.
--
-- Fix:
-- ----
-- Endre partial unique index til ALSO ekskludere terminale statuser
-- ('completed', 'cancelled'). Dette håndhever fortsatt unik room_code-
-- binding blant AKTIVE rader (scheduled / purchase_open / ready_to_start /
-- running / paused) — som er det index-en faktisk skal beskytte mot
-- (dobbel-binding av samme rom på tvers av aktive runder) — uten å
-- blokkere gjenbruk av room_code når forrige runde er ferdig.
--
-- Konsekvens:
-- -----------
-- - Aktiv unique-violation hindring beholdes: man kan ikke ha to AKTIVE
--   scheduled-games med samme room_code (race-safety).
-- - Completed/cancelled rader beholder sin historiske room_code for audit
--   (samme som før — ingen UPDATE).
-- - DemoAutoMasterTickService-loopen virker uten å falle til lazy-binding.
-- - Pilot-haller med advance() får ikke lenger NULL room_code på neste
--   runde.
--
-- Lookup-paths (read-only):
-- --------------------------
-- Verifisert (grep mot apps/backend/src/**/*.ts) at INGEN kode-paths gjør
-- `SELECT FROM app_game1_scheduled_games WHERE room_code = X`. Eneste
-- SELECT-er av room_code er via primary-key (id) i
-- `Game1DrawEngineService.getRoomCodeForScheduledGame`. Endringen påvirker
-- IKKE noen lesepath; kun INSERT-konflikt-håndtering.
--
-- Forward-only (BIN-661, ADR-0014): ingen Down-seksjon. Migrasjonen er
-- idempotent: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Compliance:
-- -----------
-- `room_code` er ikke et compliance-felt. Endringen påvirker ingen audit-
-- chain, wallet, eller §11/§66/§71-data. Ingen ledger-effekter.

-- Up migration

DROP INDEX IF EXISTS idx_app_game1_scheduled_games_room_code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_game1_scheduled_games_room_code
  ON app_game1_scheduled_games (room_code)
  WHERE room_code IS NOT NULL
    AND status NOT IN ('completed', 'cancelled');
