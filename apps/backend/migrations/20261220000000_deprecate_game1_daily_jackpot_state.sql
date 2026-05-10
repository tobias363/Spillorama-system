-- Deprecate app_game1_jackpot_state per ADR-0017 (2026-05-10).
--
-- Bakgrunn:
-- ----------
-- Daglig jackpot-akkumulering for Spill 1 (start 2000 kr → +4000 kr/dag,
-- max 30 000 kr, draw-thresholds 50/55/56/57) er fjernet per
-- ADR-0017 — Tobias-direktiv 2026-05-10. Bingoverten setter nå alltid
-- jackpot manuelt for jackpot-katalog-spillet (plan-position 7) via
-- JackpotSetupModal i master-konsollet.
--
-- Cron-jobben Game1JackpotAccumulationTickService og tilhørende kode
-- (Game1JackpotStateService.applyDailyAccumulation, getCurrentJackpot
-- m.fl.) er fjernet i PR #1159 (commit 30844dc2). Ingen produksjons-kode
-- leser eller skriver til denne tabellen lenger.
--
-- Tabellen `app_game1_jackpot_state` beholdes for forward-only-policy
-- (ADR-0014) men er ubrukt fra og med 2026-05-10. Eksisterende rader
-- nullstilles slik at evt. stale lesninger gir 0 i stedet for legacy
-- 2000 kr / 30 000 kr-verdier.
--
-- Audit-tabellen `app_game1_jackpot_awards` (BIN-764 / ADR-0004) er
-- IKKE påvirket av denne migrasjonen. Den er immutable og inneholder
-- historiske jackpot-utbetalinger som må bevares for Lotteritilsynet-
-- traceability.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
-- Idempotent (UPDATE WHERE current_amount_cents != 0): trygg å re-kjøre.

-- Up migration

-- Nullstill alle eksisterende rader så stale lesninger gir 0.
-- WHERE-filter gjør operasjonen trivielt idempotent — re-kjøring gjør
-- ingenting når alle rader allerede er 0.
UPDATE app_game1_jackpot_state
   SET current_amount_cents = 0
 WHERE current_amount_cents != 0;

-- Marker tabellen deprecated i skjema-kommentar.
COMMENT ON TABLE app_game1_jackpot_state IS
  'DEPRECATED 2026-05-10 (ADR-0017): Daglig jackpot-akkumulering fjernet. '
  'Bingovert setter jackpot manuelt per Jackpot-katalog-spill (plan-pos 7) '
  'via JackpotSetupModal. Tabellen beholdes for forward-only-policy '
  '(ADR-0014). Lesninger fra denne tabellen vil returnere 0 i nye sesjoner.';

-- Marker kolonner deprecated for å gjøre intensjonen tydelig i psql/\d+.
COMMENT ON COLUMN app_game1_jackpot_state.current_amount_cents IS
  'DEPRECATED 2026-05-10 (ADR-0017): Nullstilt. Brukes ikke lenger.';

COMMENT ON COLUMN app_game1_jackpot_state.last_accumulation_date IS
  'DEPRECATED 2026-05-10 (ADR-0017): Cron-job fjernet (Game1JackpotAccumulationTickService).';
