-- Player profile image storage (GAP #5).
--
-- Bakgrunn: legacy `routes/backend.js:754` — `POST /player/profile/image/update`
-- lagret to-element-array `profilePic[0]` (front) + `profilePic[1]` (back) på
-- spilleren. Disse ble brukt både som BankID-selfie/dokument-bilder og som
-- generelt profilbilde. Ny stack splitter de tre kategoriene i hver sin kolonne
-- så audit-loggen kan skille mellom "spilleren oppdaterte profilbildet sitt"
-- (lav-risk) og "spilleren lastet opp BankID-dokument" (compliance-relevant).
--
-- Design-valg:
--   - Tre nullable kolonner på app_users: profile_image_url, bankid_selfie_url,
--     bankid_document_url. Lagrer URL-en (storage-path) der bildet er
--     persistert; faktiske bytes ligger i et pluggbart storage-lag (lokal
--     fil-katalog som default, Cloudinary som senere bytte — TODO).
--   - URL-formatet er en relativ sti (f.eks. /uploads/profile/<id>.png) for
--     lokal storage eller en absolutt https://res.cloudinary.com/... URL
--     når Cloudinary-adapteren tas i bruk. Backend gjør ikke pre-emptive
--     URL-validering ved skriving; service-laget garanterer formatet.
--   - Ingen nye indekser — kolonnene leses bare som en del av den fulle
--     user-rad-en (mapUser i PlatformService).

-- Up migration

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS profile_image_url     TEXT NULL,
  ADD COLUMN IF NOT EXISTS bankid_selfie_url     TEXT NULL,
  ADD COLUMN IF NOT EXISTS bankid_document_url   TEXT NULL;

COMMENT ON COLUMN app_users.profile_image_url IS
  'URL/storage-path for spillerens generelle profilbilde (avatar). Settes via POST /api/players/me/profile/image?category=profile.';
COMMENT ON COLUMN app_users.bankid_selfie_url IS
  'URL/storage-path for BankID-selfie (compliance-relevant). Settes via POST /api/players/me/profile/image?category=bankid_selfie. Audit-logget per upload.';
COMMENT ON COLUMN app_users.bankid_document_url IS
  'URL/storage-path for BankID-dokumentbilde (compliance-relevant). Settes via POST /api/players/me/profile/image?category=bankid_document. Audit-logget per upload.';
