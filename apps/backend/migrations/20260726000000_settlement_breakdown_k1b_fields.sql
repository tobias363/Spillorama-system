-- K1-B: utvider machine_breakdown JSONB-skjema med shift-delta-felter for
-- 1:1-paritet med wireframe 16.25 / 17.10.
--
-- Bakgrunn (BIN-K1B): K1-A introduserte machine_breakdown JSONB med 14 maskin-
-- rader + 3 shift-delta-felter (ending_opptall_kassie_cents, innskudd_drop_safe_cents,
-- difference_in_shifts_cents). Wireframe 16.25 viser imidlertid 5-felts shift-
-- delta-seksjon:
--   1. Kasse start skift           — kasse_start_skift_cents (NY)
--   2. Kasse endt skift før dropp  — ending_opptall_kassie_cents (eksisterende)
--   3. Endring                     — beregnet (= ending - start)
--   4. Innskudd dropsafe           — innskudd_drop_safe_cents (eksisterende)
--   5. Påfyll/ut kasse             — paafyll_ut_kasse_cents (NY)
--   6. Totalt dropsafe + påfyll    — totalt_dropsafe_paafyll_cents (NY)
--   7. Difference in shifts        — difference_in_shifts_cents (eksisterende)
--
-- Korrekt formel (wireframe 16.25):
--   difference_in_shifts =
--     (totalt_dropsafe_paafyll - endring) + endring - totalt_sum_kasse_fil
--   ↳ algebraisk forenklet: difference = totalt_dropsafe_paafyll - totalt_sum_kasse_fil
--
-- Implementering: JSONB-skjema er permissivt. DDL-endring ikke nødvendig.
-- Backwards compat: K1-A-rader uten de nye feltene parses med default 0
-- via asMachineBreakdown() / validateMachineBreakdown() i koden.
--
-- Denne migration-fila er ren dokumentasjon — den kjører ingen DDL.
-- Comment-update under fanger den nye strukturen for fremtidige reviewere.

COMMENT ON COLUMN app_agent_settlements.machine_breakdown IS
  'K1-B: 14 maskin-rader + 5-felts shift-delta-seksjon pr wireframe 16.25/17.10.
   Struktur:
     {
       "rows": {
         "metronia": { "in_cents": ..., "out_cents": ... },
         "ok_bingo": { ... }, "franco": { ... }, "otium": { ... },
         "norsk_tipping_dag": { ... }, "norsk_tipping_totall": { ... },
         "rikstoto_dag": { ... }, "rikstoto_totall": { ... },
         "rekvisita": { ... }, "servering": { ... }, "bilag": { ... },
         "bank": { ... }, "gevinst_overfoering_bank": { ... }, "annet": { ... }
       },
       "kasse_start_skift_cents": <int>,            -- K1-B
       "ending_opptall_kassie_cents": <int>,
       "innskudd_drop_safe_cents": <int>,
       "paafyll_ut_kasse_cents": <int>,             -- K1-B (kan være negativ)
       "totalt_dropsafe_paafyll_cents": <int>,      -- K1-B (= innskudd + paafyll)
       "difference_in_shifts_cents": <int>
     }
   Formel: difference = totalt_dropsafe_paafyll - sum(rows: in - out)';
