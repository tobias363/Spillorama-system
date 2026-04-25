-- TASK HS: Hall-status farge-kode (Rød/Oransje/Grønn) + start-/slutt-scan-flyt.
--
-- Spec: Task HS locked av Tobias 2026-04-24.
--
-- Formål:
--   Utvider app_game1_hall_ready_status med start- og slutt-scan-data slik at
--   master-dashboard kan fargekode haller basert på scan-flyt:
--     🔴 Rød    = playerCount == 0 (ingen bonger solgt → ekskluderes auto)
--     🟠 Oransje = spillere finnes, men final-scan mangler eller ikke klar
--     🟢 Grønn   = alle spillere telt + slutt-scan gjort + Klar trykket
--
-- Scan-flyt (låst):
--   1. Start-scan (før salg)  → start_ticket_id + start_scanned_at
--   2. Agent selger bonger
--   3. Slutt-scan (etter salg) → final_scan_ticket_id + final_scanned_at
--   4. sold_range = [start_ticket_id, final_scan_ticket_id - 1]  (eksakt)
--   5. Agent trykker Klar → is_ready=true (eksisterende logikk, krever nå at
--      finalScanDone=true)
--
-- Edge-case (låst):
--   Hall uten fysiske bonger (digital-only) trenger ikke å scanne — service-
--   laget markerer `finalScanDone=true` automatisk når physical_tickets_sold
--   + start_ticket_id begge er 0/NULL, slik at hallen kan gå grønn kun på
--   readyConfirmed. Scan-kolonnene her er utelukkende for fysisk-bong-
--   scenarioet.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

ALTER TABLE app_game1_hall_ready_status
  ADD COLUMN IF NOT EXISTS start_ticket_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS start_scanned_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_scan_ticket_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_scanned_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN app_game1_hall_ready_status.start_ticket_id IS
  'TASK HS: ticketId for første bong øverst i bunken (før salg starter).';

COMMENT ON COLUMN app_game1_hall_ready_status.start_scanned_at IS
  'TASK HS: tidspunkt for start-scan. Idempotent re-scan oppdaterer feltet.';

COMMENT ON COLUMN app_game1_hall_ready_status.final_scan_ticket_id IS
  'TASK HS: ticketId for første usolgte bong etter salg. sold_range = [start_ticket_id, final_scan_ticket_id - 1].';

COMMENT ON COLUMN app_game1_hall_ready_status.final_scanned_at IS
  'TASK HS: tidspunkt for slutt-scan.';
