-- Drop the `app_halls.client_variant` rollback-flag column.
--
-- Historikk: BIN-540 (20260418090000_add_hall_client_variant.sql) innførte
-- et per-hall flagg som kunne vippes mellom 'unity' | 'web' | 'unity-fallback'
-- for å rulle tilbake Unity-stacken hall-for-hall i piloten. Unity er nå
-- fullstendig fjernet fra systemet (2026-04-21) og flagget er dekodet i
-- applikasjonslaget (`PlatformService.getHallClientVariant` returnerer
-- alltid "web"). Kolonnen er dermed dødvekt og kan droppes.
--
-- Rekkefølge på drop: CHECK-constraint først (Postgres kobler den til
-- kolonnen via auto-navn <table>_<col>_check), så selve kolonnen.
-- NOT EXISTS-guards gjør migrasjonen idempotent mot miljøer som allerede
-- kan ha droppet noe av dette manuelt.

ALTER TABLE app_halls
  DROP CONSTRAINT IF EXISTS app_halls_client_variant_check;

ALTER TABLE app_halls
  DROP COLUMN IF EXISTS client_variant;
