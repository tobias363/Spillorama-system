-- Tobias-feedback 2026-05-08: defense-in-depth FK-constraints for GoH-relasjoner.
--
-- Bakgrunn:
-- Vi har akkurat (BRIDGE_FAILED-bug) oppdaget at scheduled-games og plan-runs
-- ble stående som orphan-rader etter sletting av en Group of Halls (GoH). Agent
-- P implementerer nå hard-delete med eksplisitt cascade i `HallGroupService`-
-- laget, men service-laget kan bypasses (DB-admin, raw SQL, framtidig kode som
-- glemmer cascade-call). Denne migrasjonen legger ON DELETE CASCADE på FK-er
-- på DB-nivå som backup — null orphan-data uansett hvem som driver sletting.
--
-- Koden i Agent P og denne FK-cascaden er KOMPLEMENTÆRE, ikke konkurrerende:
--   * Service-laget gjør hard-delete med eksplisitt cascade (audit-trail,
--     bedre feilmeldinger, transaksjons-kontroll, blokkering ved aktive runs).
--   * DB-laget cascader uansett — siste sikkerhetsnett om service bypasses.
--
-- Endringer (alle CASCADE for konsistens med Agent P sin spec — null orphan):
--   1. app_hall_group_members.group_id      : allerede CASCADE (legg på som no-op
--                                              for å sikre uavhengig av eksisterende
--                                              constraint-navn).
--   2. app_game_plan.group_of_halls_id      : ingen FK i dag — legg til FK +
--                                              CASCADE. Først opprydding av
--                                              orphan-rader.
--   3. app_game_plan_run.plan_id            : i dag RESTRICT → bytt til CASCADE.
--   4. app_game_plan_item.plan_id           : allerede CASCADE (no-op).
--   5. app_game1_scheduled_games.group_hall_id : i dag RESTRICT → bytt til CASCADE.
--
-- Strategi: ALTER TABLE DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT for å være
-- idempotent og uavhengig av eksisterende constraint-navn. PG-default
-- constraint-navn er `<table>_<column>_fkey` for inline REFERENCES — vi bruker
-- den exakte navngivningen som ble generert av tidligere migrasjoner.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent.
--
-- Up migration

-- 1. app_hall_group_members.group_id → CASCADE
--    Allerede CASCADE i 20260424000000_hall_groups.sql:140, men vi gjør drop+add
--    her for sikkerhets skyld (idempotent og garantert riktig oppførsel etter
--    denne migrasjonen). Re-establishing samme constraint er trygt.
ALTER TABLE app_hall_group_members
  DROP CONSTRAINT IF EXISTS app_hall_group_members_group_id_fkey;
ALTER TABLE app_hall_group_members
  ADD CONSTRAINT app_hall_group_members_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES app_hall_groups(id) ON DELETE CASCADE;

-- 2. app_game_plan.group_of_halls_id → ADD FK + CASCADE
--    Ingen FK i dag (20261210000000_app_game_catalog_and_plan.sql:104, kommentar
--    forklarer hvorfor: FK ble utelatt fordi tabellen "ikke fantes ennå" — men
--    den finnes faktisk via 20260424000000_hall_groups.sql).
--
--    Før vi kan håndheve FK, må vi rydde opp orphan-rader som peker på en
--    ikke-eksisterende GoH. Vi setter group_of_halls_id = NULL der referansen
--    er ugyldig — men XOR-CHECK i app_game_plan krever at enten hall_id eller
--    group_of_halls_id er satt. Hvis begge skulle bli NULL, brytes CHECK. I
--    praksis: planer med ugyldig group_of_halls_id og hall_id=NULL er allerede
--    "døde" — vi rapporterer dem og lar service-laget rydde dem manuelt heller
--    enn å auto-slette dem her. Antallet er forventet 0-1 etter Agent P's
--    cascade-fix er deployed.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM app_game_plan p
  WHERE p.group_of_halls_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app_hall_groups g WHERE g.id = p.group_of_halls_id
    );
  IF orphan_count > 0 THEN
    RAISE NOTICE 'Migration 20261216000000: rydder % orphan-rader i app_game_plan.group_of_halls_id', orphan_count;
    -- For rader som har hall_id satt: trygt å nulle ut group_of_halls_id (XOR holder)
    UPDATE app_game_plan
       SET group_of_halls_id = NULL,
           updated_at        = now()
     WHERE group_of_halls_id IS NOT NULL
       AND hall_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM app_hall_groups g WHERE g.id = app_game_plan.group_of_halls_id
       );
    -- For rader som ikke har hall_id (ville brutt XOR ved NULL): soft-deactiver
    -- og null ut. CHECK-constrainten (hall_or_group XOR) krever da at vi
    -- midlertidig dropper og legger på igjen, eller at vi setter en placeholder
    -- hall_id. Enkleste trygge tilnærming: marker is_active=FALSE + null
    -- begge feltene. CHECK-constrainten brytes da; vi må derfor droppe og
    -- legge tilbake CHECK rundt operasjonen.
    PERFORM 1
      FROM app_game_plan
     WHERE group_of_halls_id IS NOT NULL
       AND hall_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM app_hall_groups g WHERE g.id = app_game_plan.group_of_halls_id
       )
     LIMIT 1;
    IF FOUND THEN
      ALTER TABLE app_game_plan DROP CONSTRAINT IF EXISTS app_game_plan_hall_or_group;
      UPDATE app_game_plan
         SET group_of_halls_id = NULL,
             is_active         = FALSE,
             updated_at        = now()
       WHERE group_of_halls_id IS NOT NULL
         AND hall_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM app_hall_groups g WHERE g.id = app_game_plan.group_of_halls_id
         );
      ALTER TABLE app_game_plan
        ADD CONSTRAINT app_game_plan_hall_or_group CHECK (
          (hall_id IS NOT NULL AND group_of_halls_id IS NULL) OR
          (hall_id IS NULL AND group_of_halls_id IS NOT NULL)
        );
    END IF;
  END IF;
END $$;

ALTER TABLE app_game_plan
  DROP CONSTRAINT IF EXISTS app_game_plan_group_of_halls_id_fkey;
ALTER TABLE app_game_plan
  ADD CONSTRAINT app_game_plan_group_of_halls_id_fkey
    FOREIGN KEY (group_of_halls_id) REFERENCES app_hall_groups(id) ON DELETE CASCADE;

-- 3. app_game_plan_run.plan_id → bytt RESTRICT til CASCADE
--    20261210000000:173 satt RESTRICT — Agent P sin spec (hard-delete med
--    cascade i kode) gjør at vi nå vil at DB skal cascade også, ellers er
--    DB-laget løsere enn service-laget.
ALTER TABLE app_game_plan_run
  DROP CONSTRAINT IF EXISTS app_game_plan_run_plan_id_fkey;
ALTER TABLE app_game_plan_run
  ADD CONSTRAINT app_game_plan_run_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES app_game_plan(id) ON DELETE CASCADE;

-- 4. app_game_plan_item.plan_id → CASCADE
--    Allerede CASCADE i 20261210000000:150, drop+add for idempotent garanti.
ALTER TABLE app_game_plan_item
  DROP CONSTRAINT IF EXISTS app_game_plan_item_plan_id_fkey;
ALTER TABLE app_game_plan_item
  ADD CONSTRAINT app_game_plan_item_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES app_game_plan(id) ON DELETE CASCADE;

-- 5. app_game1_scheduled_games.group_hall_id → bytt RESTRICT til CASCADE
--    20260428000000:82 satt RESTRICT — sammen med Agent P sin spec (hard-delete
--    av relaterte scheduled-games ved GoH-slett) gjør vi DB-laget like sterkt.
ALTER TABLE app_game1_scheduled_games
  DROP CONSTRAINT IF EXISTS app_game1_scheduled_games_group_hall_id_fkey;
ALTER TABLE app_game1_scheduled_games
  ADD CONSTRAINT app_game1_scheduled_games_group_hall_id_fkey
    FOREIGN KEY (group_hall_id) REFERENCES app_hall_groups(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT app_hall_group_members_group_id_fkey
  ON app_hall_group_members IS
  '2026-05-08: ON DELETE CASCADE — defense-in-depth, sammen med HallGroupService.delete() hard-delete cascade i kode.';

COMMENT ON CONSTRAINT app_game_plan_group_of_halls_id_fkey
  ON app_game_plan IS
  '2026-05-08: ON DELETE CASCADE — FK introdusert for å forhindre orphan plan-rader når GoH slettes. Erstatter fraværet av FK fra 20261210000000.';

COMMENT ON CONSTRAINT app_game_plan_run_plan_id_fkey
  ON app_game_plan_run IS
  '2026-05-08: ON DELETE CASCADE — endret fra RESTRICT (20261210000000) for å matche Agent P sin hard-delete-spec. Run-rader er runtime-state, ikke audit; cascade er trygt.';

COMMENT ON CONSTRAINT app_game_plan_item_plan_id_fkey
  ON app_game_plan_item IS
  '2026-05-08: ON DELETE CASCADE — bekreftet (eksisterte før, idempotent re-add).';

COMMENT ON CONSTRAINT app_game1_scheduled_games_group_hall_id_fkey
  ON app_game1_scheduled_games IS
  '2026-05-08: ON DELETE CASCADE — endret fra RESTRICT (20260428000000) for å matche Agent P sin hard-delete-spec. Scheduled-games har participating_halls_json snapshot for audit/replay.';
