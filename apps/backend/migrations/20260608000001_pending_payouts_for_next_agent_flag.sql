-- BIN-778: Splittet ut fra 20260424153706_agent_shift_logout_flags.sql
--
-- Spec: docs/architecture/WIREFRAME_PDF16_17_GAPS_2026-04-24.md §9
--       (Wireframe Gap #9 — Shift Log Out "Distribute winnings"-checkbox)
--
-- Bakgrunn:
--   Den opprinnelige Wireframe-Gap-#9-migrasjonen
--   (20260424153706_agent_shift_logout_flags.sql) ALTER-et tre tabeller:
--     1. app_agent_shifts             (opprettet 20260418220200, OK)
--     2. app_agent_ticket_ranges      (opprettet 20260417000003, OK)
--     3. app_physical_ticket_pending_payouts
--          opprettet 20260608000000_physical_ticket_pending_payouts.sql
--          — DETTE er etter 04-24, så ALTER-en feilet på frisk shadow-DB
--          før 06-08 kjørte. Schema-gate-CI fanget bug-en.
--
--   Fix: ALTER-en på app_physical_ticket_pending_payouts og tilhørende
--   partial-indeks er flyttet hit, til en migrasjon med timestamp ETTER
--   06-08-tabellen. Migrasjons-rekkefølge i frisk DB blir nå korrekt.
--
-- Idempotens (kritisk):
--   Prod-DB har allerede kjørt den opprinnelige 04-24-migrasjonen (med
--   ALTER-en intakt). For at denne split-en ikke skal regressere prod
--   bruker vi ADD COLUMN IF NOT EXISTS og CREATE INDEX IF NOT EXISTS.
--   På prod blir denne migrasjonen et trygt no-op (kolonne + indeks
--   allerede finnes). På shadow-DB legger den til kolonnen + indeksen
--   så schema-baseline matcher.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

ALTER TABLE app_physical_ticket_pending_payouts
  ADD COLUMN IF NOT EXISTS pending_for_next_agent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_physical_ticket_pending_payouts.pending_for_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Distribute winnings" ved logout. Neste agent ser denne raden i sin cashout-vakt. Settes false igjen ved paid_out_at / rejected_at (håndteres i service).';

-- Partial-indeks: "hvilke pending cashouts er overtakelses-klare i denne hallen?"
-- Brukt av neste agents dashboard ved innlogging.
CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_next_agent
  ON app_physical_ticket_pending_payouts (hall_id)
  WHERE pending_for_next_agent = true AND paid_out_at IS NULL AND rejected_at IS NULL;
