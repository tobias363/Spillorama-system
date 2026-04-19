-- Blokk 1.11 — Idempotency-Key støtte for papir-bong salg.
--
-- Agent-salg av papir-bong (`POST /api/agent/physical-tickets/sell`) bumpes
-- både `app_agent_ticket_ranges.next_available_index` OG
-- `app_draw_session_halls.physical_tickets_sold` i én transaksjon. En klient
-- som retryer (nettverks-flapp, timeout) MÅ ikke dobbelt-telle — så klienten
-- sender `Idempotency-Key`-header og serveren husker responsen.
--
-- Konvensjoner: `app_` prefiks, TEXT PK-komponenter, JSONB for body-kopien
-- så vi kan returnere eksakt samme struktur som første gang uten re-kjøring.
--
-- Bordet er delt (ikke papir-bong-spesifikt) — `endpoint`-kolonnen er med
-- i PK så fremtidige endepunkter kan gjenbruke samme mekanikk uten
-- nøkkel-kollisjoner mellom endpoints.

-- Up Migration

CREATE TABLE IF NOT EXISTS app_idempotency_records (
  idempotency_key  TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  response_body    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, endpoint)
);

COMMENT ON TABLE  app_idempotency_records              IS 'Idempotency-Key lagring. Klienter retryer med samme nøkkel + endpoint og får tilbake cached svar.';
COMMENT ON COLUMN app_idempotency_records.endpoint     IS 'Endepunkt-identifikator (f.eks. "physical-tickets:sell"). Med i PK for å unngå kollisjon mellom endpoints.';
COMMENT ON COLUMN app_idempotency_records.response_body IS 'JSONB-kopi av den første vellykkede responsen. Ble lagret etter at transaksjonen committet.';

-- TTL-cleanup skjer senere (Blokk 4-noe). For nå akkumulerer vi — volumet
-- er lavt (antall papir-bong-salg per dag per hall).
