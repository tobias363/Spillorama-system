# Changelog

Alle merkbare endringer i dette prosjektet dokumenteres her.

## [0.2.0-wave1] - 2026-03-04

### Added

- Compliance gate workflow i GitHub Actions: `.github/workflows/compliance-gate.yml`.
- Egen compliance test-suite: `backend/src/compliance/compliance-suite.test.ts`.
- Nytt backend dev-script for single-watch oppsett: `backend/scripts/dev-single.sh` (`npm run dev:single`).
- Operasjonsdokumenter for pilot/utrulling/sign-off:
  - `HALL_PILOT_RUNBOOK.md`
  - `ROLLOUT_PLAN_1_3_20.md`
  - `P0_SIGNOFF.md`
  - `WAVE1_GO_NO_GO_SIGNOFF_2026-03-09.md`
  - `RELEASE_PACKAGE_WAVE1.md`
  - `RELEASE_NOTES_WAVE1.md`

### Changed

- Spillorama-klient:
  - Play-knapp kan starte + drive realtime runde via `PlayRealtimeRound`.
  - Bedre guardrails for join/create-pending og auth-bootstrap.
  - Bedre editor-sikkerhet for manglende scripts før Play Mode.
- Backend:
  - Laster `.env` eksplisitt via `dotenv`.
  - Ny policy `BINGO_MIN_PLAYERS_TO_START` med miljøstyrt minstegrense.
  - `BingoEngine` støtter konfigurerbar `minPlayersToStart`.
  - Scheduler håndterer `PLAYER_ALREADY_IN_RUNNING_GAME` mer robust i dev.

### Verification

- `npm --prefix backend run check`
- `npm --prefix backend run build`
- `npm --prefix backend run test`
- `npm --prefix backend run test:compliance`
