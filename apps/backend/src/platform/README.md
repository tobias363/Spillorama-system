# Module: `apps/backend/src/platform`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~6 927

## Ansvar

Plattform-tjenester på tvers av spill:
- Hall-administrasjon (CRUD, settings)
- Group of Hall (gruppering, master-tilknytning)
- Spiller-registrering og profil
- Game-management (enable/disable, settings)
- KYC-status (verifisering, override, audit)
- Schedule-management (§64 spilleplan)
- Loyalty-systemet (BIN-700)
- CMS (FAQ, Terms, Responsible Gaming)

## Ikke-ansvar

- Auth/sessions (delegert til `auth/`)
- Wallet (delegert til `wallet/`)
- Spill-runtime (delegert til `game/`)

## Public API

| Service | Funksjon |
|---|---|
| `PlatformService` | Hall + Player + Game CRUD, KYC override |
| `HallService` | Hall-spesifikk logikk (config, tv-token) |
| `GroupOfHallService` | Hall-grupper, master-binding |
| `ScheduleService` | §64 spilleplan management |
| `GameManagementService` | Game-config per hall |
| `LoyaltyService` | Punkt-system, tier-tilknytning |
| `CmsService` | Public + admin CMS-content |

HTTP-endepunkter (via `routes/`):
- `/api/halls`, `/api/admin/halls/*`
- `/api/admin/players/*` (KYC-moderation)
- `/api/admin/games/*`, `/api/admin/settings/*`
- `/api/cms/*` (public)
- `/api/loyalty/*`

## Avhengigheter

- Postgres (`app_halls`, `app_users`, `app_app_games`, `app_schedule_slots`, ...)
- `auth/` — RBAC
- `compliance/AuditLogService` — audit-events for endringer

## Invariants

1. **Hall-scoping for HALL_OPERATOR:** kan kun se/endre egen hall
2. **KYC-override krever ADMIN + reason** — eksplisitt audit-trail
3. **Schedule-overlap-prevent:** to slots samme dag samme hall blokkert
4. **CMS regulatorisk slugs:** `responsible-gaming` krever LIVE-versjon (ikke draft)
5. **Audit alle endringer** med actor + before/after

## Bug-testing-guide

### "Hall-operator ser annen hall sin data"
- Sjekk `resolveHallScopeFilter` i RBAC
- Sjekk `app_users.hall_id` for kalleren
- Sjekk om route bruker hall-scope-middleware

### "KYC-status hopper tilfeldig"
- Sjekk audit-log for resourceId = userId
- Sannsynligvis to admin-er moderert samtidig

## Referanser

- `docs/architecture/modules/backend/PlatformService.md`
- `docs/architecture/modules/backend/ScheduleService.md`
- ADR-009 (Done-policy)
