-- Blokk 1.12a — Hall-autentisering: bind HALL_OPERATOR-bruker til én hall.
--
-- Etter Blokk 1.12 skrev vi ledger-rader hvor `hall_id` kom fra request-body
-- og ble validert kun av rolletilgang (HALL_OPERATOR). Det betød at en
-- operator ved hall A i teorien kunne registrere papir-bonger for hall B
-- via admin-UI-et og dermed forgifte regulator-kjeden.
--
-- Denne migrasjonen gir HALL_OPERATOR en obligatorisk `hall_id`-binding som
-- applikasjonslaget (AdminAccessPolicy.assertHallScope) håndhever på de
-- ledger-kritiske endepunktene: agent-ticket-ranges, physical-ticket-sales,
-- hall-ready. ADMIN + SUPPORT er fortsatt plattform-vide (hall_id IS NULL).
-- PLAYER har aldri hall-binding.
--
-- CHECK-constrainten garanterer at HALL_OPERATOR-rader alltid har en hall.
-- Hvis bingo_dev har HALL_OPERATOR-rader som ikke er re-bundet, må de
-- enten få hall_id eller demoteres først — migrasjonen feiler ellers.

-- Up Migration

ALTER TABLE app_users
  ADD COLUMN hall_id TEXT NULL REFERENCES app_halls(id) ON DELETE RESTRICT;

COMMENT ON COLUMN app_users.hall_id IS
  'Hall-binding for HALL_OPERATOR (påkrevd). ADMIN/SUPPORT/PLAYER har NULL. Håndheves via AdminAccessPolicy.assertHallScope på ledger-kritiske endepunkter.';

-- Lookup fra hall → operatorer (f.eks. admin-UI: "hvem står i kassa?").
CREATE INDEX IF NOT EXISTS idx_app_users_hall_id
  ON app_users (hall_id)
  WHERE hall_id IS NOT NULL;

ALTER TABLE app_users
  ADD CONSTRAINT chk_app_users_hall_operator_has_hall
  CHECK (
    (role = 'HALL_OPERATOR' AND hall_id IS NOT NULL)
    OR role <> 'HALL_OPERATOR'
  );
