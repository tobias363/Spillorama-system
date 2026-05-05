# Module: `apps/backend/src/middleware`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~1 694

## Ansvar

Express + Socket.IO middleware:
- Auth-token verifisering (Bearer)
- RBAC-permission-sjekk
- Rate-limiting (HTTP + Socket.IO per IP, per user, per socket)
- Request-logging (med trace-id)
- CSP-headers (security)
- Hall-scope-filter for HALL_OPERATOR
- Trace-ID propagation (jf. ADR-010)

## Public API

| Middleware | Funksjon |
|---|---|
| `requireAuth` | Krever gyldig Bearer-token |
| `requirePermission(perm)` | RBAC-sjekk |
| `requireHallScope(hallId)` | HALL_OPERATOR scope-sjekk |
| `rateLimitMiddleware` | HTTP rate-limiting |
| `socketRateLimiter` | Per-socket rate-limit |
| `traceIdMiddleware` | Sett `req.trace_id` fra header eller generer |
| `securityHeadersMiddleware` | CSP, HSTS, X-Frame-Options |

## Invariants

1. **Auth alltid først:** før RBAC, før rate-limit
2. **Trace-ID alltid satt:** før alle andre middleware
3. **CSP report-only mode** under utrulling, blokk-mode etter validering
4. **Rate-limit bypass for ADMIN** kun for nødsfall (audit-loggget)

## Referanser

- ADR-010 (observability)
- BIN-776 (CSP-violation reports)
- `apps/backend/openapi.yaml` (Security tag)
