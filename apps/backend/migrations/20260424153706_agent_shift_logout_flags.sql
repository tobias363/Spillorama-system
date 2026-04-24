-- Wireframe Gap #9 (PDF 17.6): Shift Log Out-flyt med 2 checkboxer.
--
-- Spec: docs/architecture/WIREFRAME_PDF16_17_GAPS_2026-04-24.md §9
--
-- Bakgrunn:
--   Agent V1.0 wireframe 17.6 (Shift Log Out-popup) krever at bingovert kan
--   avslutte skiftet sitt med to flagg:
--
--     1. "Distribute winnings to physical players" — markerer alle pending
--        cashouts (app_physical_ticket_pending_payouts) for agenten som
--        tilgjengelig for neste agent til å utbetale.
--     2. "Transfer register ticket to next agent" — markerer åpne
--        ticket-ranges (app_agent_ticket_ranges) for agenten som overførbare
--        ved neste innlogging / transfer-hall-access-flyt.
--
--   Begge flaggene er opt-in; logout uten avkrysning = legacy-oppførsel
--   (kun shift.end som før). Flaggene skrives til app_agent_shifts for
--   audit + rapport, mens selve markeringen skjer på child-tabellene.
--
-- Designvalg:
--   * distributed_winnings / transferred_register_tickets er BOOLEAN DEFAULT
--     FALSE på app_agent_shifts. Eksisterende rader får false implisitt.
--   * logout_notes er TEXT NULL for valgfri audit-kommentar fra bingovert
--     (legacy V1.0 har et fri-tekst-felt på popup-skjermen som vi beholder).
--   * pending_for_next_agent på app_physical_ticket_pending_payouts er
--     BOOLEAN DEFAULT FALSE. Settes true når distribute-flagget sendes.
--     Partial-indeks for rask query av "pending cashouts tilgjengelig for
--     meg".
--   * transfer_to_next_agent på app_agent_ticket_ranges er BOOLEAN DEFAULT
--     FALSE. Settes true sammen med transferred_register_tickets på shiften.
--     AgentTicketRangeService skal sjekke dette flagget ved neste
--     registrering og tilby overtagelse.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

ALTER TABLE app_agent_shifts
  ADD COLUMN IF NOT EXISTS distributed_winnings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferred_register_tickets BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logout_notes TEXT NULL;

COMMENT ON COLUMN app_agent_shifts.distributed_winnings         IS 'Gap #9: true hvis agent krysset av for "Distribute winnings to physical players" ved logout. Pending cashouts merkes pending_for_next_agent = true.';
COMMENT ON COLUMN app_agent_shifts.transferred_register_tickets IS 'Gap #9: true hvis agent krysset av for "Transfer register ticket to next agent" ved logout. Åpne ticket-ranges merkes transfer_to_next_agent = true.';
COMMENT ON COLUMN app_agent_shifts.logout_notes                 IS 'Gap #9: valgfri audit-notat fra bingovert på logout-popup (legacy V1.0 fri-tekst-felt).';

ALTER TABLE app_physical_ticket_pending_payouts
  ADD COLUMN IF NOT EXISTS pending_for_next_agent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_physical_ticket_pending_payouts.pending_for_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Distribute winnings" ved logout. Neste agent ser denne raden i sin cashout-vakt. Settes false igjen ved paid_out_at / rejected_at (håndteres i service).';

-- Partial-indeks: "hvilke pending cashouts er overtakelses-klare i denne hallen?"
-- Brukt av neste agents dashboard ved innlogging.
CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_next_agent
  ON app_physical_ticket_pending_payouts (hall_id)
  WHERE pending_for_next_agent = true AND paid_out_at IS NULL AND rejected_at IS NULL;

ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS transfer_to_next_agent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_agent_ticket_ranges.transfer_to_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Transfer register ticket" ved logout. Neste agent ved transfer-hall-access ser åpne ranges som tilgjengelig for overtagelse.';

-- Partial-indeks: "hvilke range-er er merket som transfer-klare i denne hallen?"
CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_transfer_ready
  ON app_agent_ticket_ranges (hall_id)
  WHERE transfer_to_next_agent = true AND closed_at IS NULL;
