# Module: `apps/backend/src/routes`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~36 600

## Ansvar

HTTP-endepunkter for Spillorama. Mapper Express-routes til service-kall.
Holder routing-logikk separert fra business-logikk.

## Ikke-ansvar

- Business-logikk (delegert til `game/`, `wallet/`, `compliance/`, `auth/`, etc.)
- Database-tilgang direkte (gå alltid via service-laget)
- Socket.IO-events (delegert til `sockets/`)

## Public API

Routes organisert per domene. Hver route-fil eksporterer en Express Router som mountes i
`apps/backend/src/index.ts`.

## Struktur

Routes organisert per domene:
- `auth.ts` — `/api/auth/*`
- `wallet.ts` — `/api/wallet/*`, `/api/wallets/*`
- `game.ts` — `/api/games/*`, `/api/rooms/*`, `/api/leaderboard`
- `spillevett.ts` — `/api/spillevett/*`
- `payments.ts` — `/api/payments/*`
- `admin/*.ts` — `/api/admin/*` (RBAC-guarded)
- `agent/*.ts` — `/api/agent/*` (AGENT-role)
- `players.ts` — `/api/players/*`
- `publicCms.ts` — `/api/cms/*` (un-authenticated)
- `publicStatus.ts` — `/api/status/*` (un-authenticated)
- `csp.ts` — `/api/csp-report` (CSP-violation reports)

## Avhengigheter

- `auth/` — middleware for token-verifisering
- `middleware/` — rate-limiting, RBAC
- Service-laget (game, wallet, compliance, etc.)

## Invariants

1. **Standardisert respons-shape:**
   ```json
   { "ok": true, "data": <payload> }
   { "ok": false, "error": { "code": "BIN-XXX-001", "message": "...", "details": {...} } }
   ```
2. **OpenAPI-paritet:** alle endepunkter dokumentert i `apps/backend/openapi.yaml`
3. **Auth-default:** alle endepunkter krever Bearer-token unntatt eksplisitte unntak
   (login, register, public CMS, public status, webhooks)
4. **RBAC enforcement:** admin-endepunkter sjekker permissions før service-kall
5. **No business logic:** routes kun mapper request → service → response
6. **Rate-limited:** alle endepunkter inkludert i global HTTP rate-limiter

## Avhengigheter (out)

`routes/` brukes av:
- Express app (`apps/backend/src/index.ts`)

## Bug-testing-guide

### "Endepunkt returnerer 401 selv med token"
- Sjekk middleware-rekkefølge (auth før route)
- Sjekk om token er expired
- Sjekk Redis-tilkobling

### "Endepunkt returnerer 403 (FORBIDDEN)"
- Sjekk RBAC-permissions for kallers role
- For HALL_OPERATOR: sjekk hall-scoping (kun egen hall)

### "OpenAPI mismatch"
- Kjør `npm run spec:lint` (redocly)
- Sjekk om response-shape matcher Zod-schema

## Operasjonelle notater

### Sentry-tags
- `module:routes`
- `route:<path>`
- `method:GET|POST|PUT|DELETE`

### Logging
- Alle requests logget med `trace_id`, `userId`, `route`, `status`, `duration`
- Slow queries (>500ms) flagget
- Errors logget med fullstack + Sentry breadcrumb

## Referanser

- `apps/backend/openapi.yaml` (autoritativ API-spec)
- `docs/engineering/HTTP_ENDPOINT_MATRIX.md` (oversikt)
- ADR-005 (structured error codes)
- ADR-010 (observability)
