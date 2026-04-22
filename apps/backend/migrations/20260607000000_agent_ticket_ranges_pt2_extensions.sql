-- PT2: Utvidelser av `app_agent_ticket_ranges` for agent range-registrering.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--
-- Bakgrunn:
--   `app_agent_ticket_ranges` (migrasjon 20260417000003) eksisterer fra før med
--   `initial_serial`, `final_serial`, `serials` JSONB og `next_available_index`.
--   PT2 legger til to kolonner som PT3-batch-salg og PT5-handover trenger:
--
--     * `current_top_serial`  — peker på toppen av usolgte bonger i rangen.
--       Dekrementerer ved hver PT3-batch-oppdatering. Ved opprettelse
--       settes den lik `initial_serial`. NULL for historiske closed ranges
--       som eksisterer før PT2 landet (men eksisterende installasjoner er
--       tomme — tabellen er ny i BIN-661 Bølge 2).
--
--     * `handover_from_range_id` — peker på rangen som ble overlevert ved
--       PT5-handover. NULL for første-registrering (ikke handover).
--
--   PT2 selve håndteringen av rader skjer i `AgentTicketRangeService` og
--   wirer seg mot `StaticTicketService` (PT1). Ingen backfill — nye rader
--   skrives med `current_top_serial = initial_serial` eksplisitt.
--
-- Designvalg:
--   * `current_top_serial` er NULLABLE (ikke NOT NULL) for å tolerere
--     eksisterende rader fra pre-PT2-kode (det finnes ingen, men vi er
--     forward-only-strenge og unngår backfill). Service-laget tilordner
--     alltid verdien ved INSERT.
--   * `handover_from_range_id` referer til samme tabell — ON DELETE SET NULL
--     for å beholde handover-historikk selv om avtroppende range slettes
--     (regulatorisk krav om bevaring av audit-spor).
--   * Partial-indeks på aktive ranges for (agent_id, hall_id) — hot path
--     for "liste aktive ranges for denne bingoverten".
--
-- Forward-only (BIN-661): ingen Down-seksjon.

ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS current_top_serial     TEXT NULL,
  ADD COLUMN IF NOT EXISTS handover_from_range_id TEXT NULL
    REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL;

COMMENT ON COLUMN app_agent_ticket_ranges.current_top_serial     IS 'PT2/PT3: peker på toppen av usolgte bonger i rangen. Settes lik initial_serial ved PT2-opprettelse, dekrementerer ved hver PT3-batch-oppdatering (ny top = scannet neste-topp-serial).';
COMMENT ON COLUMN app_agent_ticket_ranges.handover_from_range_id IS 'PT5: peker på avtroppende range ved vakt-skift. NULL for første-registrering (ikke handover).';

-- PT2 hot-path: "liste aktive ranges for denne bingoverten" (UI-dashboard).
-- Matcher det eksisterende partial-indeksmønsteret i migrasjon 20260417000003.
CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_agent_hall_open
  ON app_agent_ticket_ranges (agent_id, hall_id, registered_at DESC)
  WHERE closed_at IS NULL;
