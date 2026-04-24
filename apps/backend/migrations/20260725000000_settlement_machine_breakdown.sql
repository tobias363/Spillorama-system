-- K1 settlement machine breakdown: utvider app_agent_settlements med full
-- 15-rad maskin-breakdown fra legacy wireframes (PDF 13 §13.5 + PDF 15 §15.8).
--
-- Regulatorisk: pengespillforskriften § 64 krever at vi kan rekonstruere
-- dagsoppgjør per maskin/kategori. Før denne endringen hadde vi kun
-- aggregerte shift-totaler (cash_in/out) + et fritekst `other_data`-felt.
-- Nå lagrer vi struktert 15-rad breakdown pluss bilag-dokument.
--
-- Design-valg: JSONB heller enn 45 dedikerte kolonner, fordi:
--   1. 15 maskiner × 3 IN/OUT/Sum-kolonner = 45 kolonner — SELECT * blir tungt
--   2. Enklere å utvide med nye maskin-typer uten migration-kostnad
--   3. JSONB er indeksbart for agg-queries (e.g. SUM per maskin-type)
--   4. Matcher hvordan B3.4/B3.5 allerede bruker `other_data` JSONB
--
-- Struktur av machine_breakdown JSONB (15 rader + calculations):
-- {
--   "rows": {
--     "metronia":            { "in_cents": 481000, "out_cents": 174800 },
--     "ok_bingo":            { "in_cents": 362000, "out_cents": 162500 },
--     "franco":              { "in_cents": 477000, "out_cents": 184800 },
--     "otium":               { "in_cents": 0,      "out_cents": 0 },
--     "norsk_tipping_dag":   { "in_cents": 0,      "out_cents": 0 },
--     "norsk_tipping_totall":{ "in_cents": 0,      "out_cents": 0 },
--     "rikstoto_dag":        { "in_cents": 0,      "out_cents": 0 },
--     "rikstoto_totall":     { "in_cents": 0,      "out_cents": 0 },
--     "rekvisita":           { "in_cents": 2500,   "out_cents": 0 },
--     "servering":           { "in_cents": 26000,  "out_cents": 0 },
--     "bilag":               { "in_cents": 0,      "out_cents": 0 },
--     "bank":                { "in_cents": 81400,  "out_cents": 81400 },
--     "gevinst_overfoering_bank": { "in_cents": 0, "out_cents": 0 },
--     "annet":               { "in_cents": 0,      "out_cents": 0 }
--   },
--   "ending_opptall_kassie_cents": 4613,
--   "innskudd_drop_safe_cents": 0,
--   "difference_in_shifts_cents": 0
-- }
--
-- Bilag-receipt lagres som base64 data-URL i eget JSONB-felt for å unngå
-- at vi må bygge ut S3/Render-disk-infrastruktur akkurat nå. Max 10 MB
-- håndheves i service-laget (index.ts aksepterer 15 MB body). Når vi
-- senere flytter til ekstern blob-storage, kan vi migrere feltet til URL.

-- Up migration

ALTER TABLE app_agent_settlements
  ADD COLUMN IF NOT EXISTS machine_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE app_agent_settlements
  ADD COLUMN IF NOT EXISTS bilag_receipt JSONB NULL;

-- GIN-indeks for aggregat-queries på maskin-type (f.eks. sum metronia/dag).
CREATE INDEX IF NOT EXISTS idx_app_agent_settlements_machine_breakdown
  ON app_agent_settlements USING gin (machine_breakdown);

COMMENT ON COLUMN app_agent_settlements.machine_breakdown IS
  'K1: 15-rad maskin-breakdown pr wireframe (PDF 13 §13.5, PDF 15 §15.8). Se migration-header for full struktur.';
COMMENT ON COLUMN app_agent_settlements.bilag_receipt IS
  'K1: opplastet bilag (PDF/JPG) som JSON: { mime, filename, dataUrl, sizeBytes, uploadedAt }. NULL = ikke opplastet.';
