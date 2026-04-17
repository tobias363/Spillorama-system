-- BIN-496: Game 4 (temabingo) utgår — ingen klient-implementasjon, ingen plan om å bygge.
--
-- Referanser:
-- - docs/architecture/LEGACY_DECOUPLING_STATUS.md §4.2
-- - docs/engineering/PARITY_MATRIX.md (Game 4 utelatt fra matrise)
-- - docs/architecture/migration-plan-unity-to-web.md §2.1 ("Game 4 utgår og skal ikke migreres")
-- - Relaterte duplikater: BIN-513 (themes), BIN-518 (MysteryGameFinished G4), BIN-497 (voucher)
--
-- Endring: setter temabingo.is_enabled = false. Raden beholdes for historisk
-- referanse og revisjonsspor — fjernes fullt når legacy/ slettes per BIN-537.
--
-- Rollback (manuell): UPDATE app_games SET is_enabled = true WHERE slug = 'temabingo';

BEGIN;

UPDATE app_games
SET is_enabled = false
WHERE slug = 'temabingo';

COMMIT;
