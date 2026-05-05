# Module: `apps/backend/src/admin`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~30 752

## Ansvar

Admin-spesifikk backend-logikk:
- Admin-auth (login, RBAC, permissions)
- Admin-bootstrap (første admin-konto)
- Game settings management (per game og per hall)
- Compliance-moderation (limits, exclusions, KYC)
- Reports (daily, ledger, payout-audit)
- Surplus distribution (§11)
- Status-page management (BIN-791)

## Ikke-ansvar

- Spill-runtime (delegert til `game/`)
- Wallet-mutering (delegert til `wallet/`)
- Public CMS (delegert til `platform/CmsService`)

## Public API

Admin-services for:
- User-role management (assign roles, hall-binding)
- Game settings catalog + change-log
- Hall config + game-config-overrides
- Prize-policy (CRUD + version)
- Distribution-batches (preview + commit)
- Daily report generation

HTTP-endepunkter: `/api/admin/*` (alle RBAC-guarded)

## Invariants

1. **Alle admin-actions audit-loggget** med actor + before/after
2. **HALL_OPERATOR auto-scoped** til egen hall (kan ikke overstyre via query)
3. **Critical actions krever 2FA** (kommer Wave X)
4. **Admin-bootstrap én-gangs:** etter første admin er endpoint deaktivert

## Referanser

- ADR-008 (PM-sentralisert git)
- ADR-009 (Done-policy)
- `docs/operations/ADMIN_RUNBOOK_OPERATOR_RBAC.md`
