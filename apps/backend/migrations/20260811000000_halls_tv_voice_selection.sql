-- TV-kiosk Voice Selection per hall.
--
-- Legger til kolonnen `tv_voice_selection` på `app_halls` slik at hver hall
-- kan velge hvilken stemme (voice1, voice2 eller voice3) som brukes av
-- TV-klienten ved ball-utrop. Default er 'voice1' for bakoverkompatibilitet
-- med eksisterende haller.
--
-- Kontekst (2026-04-24, Tobias): wireframe PDF 14 (TV Screen + Winners)
-- krever voice-valg per hall. Admin-panel → Hall settings har nå en
-- dropdown som skriver denne kolonnen; TV-klienten leser den ved mount via
-- `GET /api/tv/:hallId/voice` og broadcaster endringer på `tv:voice-changed`
-- til `hall:<id>:display`.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS tv_voice_selection TEXT
    NOT NULL DEFAULT 'voice1'
    CHECK (tv_voice_selection IN ('voice1', 'voice2', 'voice3'));

COMMENT ON COLUMN app_halls.tv_voice_selection IS
  'TV-kiosk voice-pack valgt for denne hallen. Én av voice1 / voice2 / voice3. TV-klienten laster tilsvarende audio-filer ved mount og reloader ved tv:voice-changed-event.';
