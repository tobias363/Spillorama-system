# Release Notes - Wave 1 Pilot

Version: `0.2.0-wave1`  
Dato: `2026-03-04`  
Planlagt Wave 1 pilot: `2026-03-09`

## Hva denne leveransen er

Dette er en pilotklar leveranse for første hall (Wave 1) med:

- hardening av realtime-flyt i Spillorama-klient
- oppstrammet backend-konfigurasjon og compliance-kontroller
- operativ dokumentpakke for pilot, rollback og go/no-go

## Viktigste endringer

### 1) Spillorama klient/editor

- Play-knapp støtter nå deterministisk realtime-start/trekk.
- Bedre håndtering av join/create-pending for å unngå duplikate room-kall.
- Auto-login bootstrap håndteres mer robust når auth mangler.
- Editor-verktøy har ekstra guardrails rundt opprydding av manglende scripts.

### 2) Backend runtime/compliance

- `.env` lastes eksplisitt via `dotenv` i backend startup.
- `BINGO_MIN_PLAYERS_TO_START` introdusert:
  - produksjon: minimum 2 spillere
  - utvikling: minimum 1 spiller
- `BingoEngine` bruker konfigurerbar minste spillergrense ved spillstart.
- Autoscheduler håndterer forventet domene-feil (`PLAYER_ALREADY_IN_RUNNING_GAME`) uten støyende feillogger i dev.

### 3) Kvalitet og deploy-gate

- Ny CI-workflow krever grønn compliance-suite før merge/deploy.
- Compliance-suite dekker tapsgrenser, pausekrav, selvutelukkelse, timing, billettgrenser og premietak.

### 4) Operativ styring

- Hall pilot runbook: `HALL_PILOT_RUNBOOK.md`
- Rollout-plan 1 -> 3 -> 20: `ROLLOUT_PLAN_1_3_20.md`
- Samlet P0 sign-off: `P0_SIGNOFF.md`
- Wave 1 go/no-go mal: `WAVE1_GO_NO_GO_SIGNOFF_2026-03-09.md`
- Release-pakke/commit-struktur: `RELEASE_PACKAGE_WAVE1.md`

## Verifisering brukt for denne pakken

Kommandoer kjørt mot backend:

- `npm --prefix backend run check`
- `npm --prefix backend run build`
- `npm --prefix backend run test`
- `npm --prefix backend run test:compliance`

## Kjente forhold før pilotstart

- Kontaktinformasjon i runbook må fylles med faktiske navn/telefon.
- Hall-ID, dato og signaturfelt i go/no-go dokument må fylles før pilot.
- Branch protection bør kreve `Compliance Gate` for release-branch.
