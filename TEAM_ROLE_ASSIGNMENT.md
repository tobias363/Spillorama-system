# Team and Role Assignment

Date: 2026-03-04
Purpose: lock role ownership for `BG-001` to `BG-028` planning and Sprint 1 execution.

## Confirmed Planning Handles

1. `BE-1` - Backend/game rules/auth owner
2. `BE-2` - Data model/reporting/ledger owner
3. `CL-1` - Unity client owner
4. `QA-1` - QA/compliance test owner

## Sprint 1 Role Allocation

1. `BE-1`
Tasks:
- `BG-001` auth guard on socket gameplay events
- `BG-010` backend production safety guard
- `BG-011` 30-second databingo sequence gate
- `BG-012` ticket cap validation hardening and tests

2. `BE-2`
Tasks:
- `BG-002` hall/terminal schema and APIs
- `BG-004` session + hall binding constraints
- migration and compatibility support across Sprint 1

3. `CL-1`
Tasks:
- `BG-010` Unity autoplay disablement for production
- token-only gameplay path in client
- hall selection wiring in realtime join flow

4. `QA-1`
Tasks:
- Sprint 1 compliance matrix for `BG-001`, `BG-002`, `BG-004`, `BG-010`, `BG-011`, `BG-012`
- regression scripts for auth expiry, reconnect, and timer edge cases

## Assignment Notes

1. Replace role handles with personal names in your project tool if needed.
2. Keep ownership stable through Sprint 1 to avoid context switching.
3. Any spillover from Sprint 1 rolls into Sprint 2 before new scope is pulled.
