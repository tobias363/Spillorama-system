-- Tobias-feedback 2026-05-08: Master-hall-valg på Group of Halls (GoH).
--
-- Bakgrunn:
-- I dag plukkes `app_game1_scheduled_games.master_hall_id` per spawn fra
-- `run.hall_id` (plan-runtime — den hallen agenten driver). For pilot-haller
-- (Teknobingo Årnes som master + Bodø/Brumunddal/Fauske) ønsker Tobias at
-- master-rollen skal være pinned på GoH-en — slik at samme hall alltid er
-- master uansett hvilken hall sin master-agent som starter en plan-run.
--
-- Vi legger derfor til `master_hall_id` på `app_hall_groups`. NULL = ingen
-- pinned master (legacy-fallback til `run.hall_id` står). Når satt, må
-- hallen være medlem av gruppen — service-laget (HallGroupService) håndhever
-- denne invarianten ved create/update.
--
-- Forward-only (BIN-661 konvensjon): ingen Down-seksjon. Idempotent
-- (ADD COLUMN IF NOT EXISTS). FK ON DELETE SET NULL — hvis master-hallen
-- slettes nullstilles peker. Hallen-medlemskap (`app_hall_group_members`)
-- har ON DELETE CASCADE som rydder eget medlemskap; vi lar `master_hall_id`
-- gå til NULL i samme operasjon for å beholde gruppen synlig.
--
-- Up migration

ALTER TABLE app_hall_groups
  ADD COLUMN IF NOT EXISTS master_hall_id TEXT NULL
    REFERENCES app_halls(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_hall_groups_master_hall_id
  ON app_hall_groups(master_hall_id)
  WHERE master_hall_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN app_hall_groups.master_hall_id IS
  '2026-05-08: pinned master-hall for GoH. NULL = ingen pin (faller tilbake til run.hall_id ved spawn). Service-laget håndhever at hallen er medlem av gruppen.';
