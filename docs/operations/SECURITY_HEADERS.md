# Security headers — runbook (BIN-776 / M2)

Strict CSP, HSTS, and friends. Goal: A+ on https://securityheaders.com and
an enforced CSP that blocks XSS payloads while keeping the player-shell,
admin-web, Pixi game-client, and Candy iframe-host working.

## What gets sent

`securityHeadersMiddleware()` (apps/backend/src/middleware/securityHeaders.ts)
sets the following on every response:

| Header | Value (summary) |
| --- | --- |
| `Content-Security-Policy(-Report-Only)` | Strict — see `buildCspDirectives` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (production only) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | denies camera/mic/geo/USB/MIDI/payment/etc. |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-site` |

CSP allow-list highlights:

- `script-src 'self'` — no inline scripts, no `unsafe-eval`.
- `style-src 'self' 'unsafe-inline'` — required by Pixi/Tailwind runtime
  injection; tracked for replacement with nonces in BIN-777.
- `img-src` includes Cloudinary (KYC photo IDs) plus `data:` and `blob:`.
- `connect-src` includes Swedbank Pay, Render WSS for Socket.IO, and Candy.
- `frame-src` only Candy (`candy-backend-ldvg.onrender.com`); everything else
  is blocked.
- `frame-ancestors 'none'` — defence-in-depth duplicate of X-Frame-Options.
- `report-uri /api/csp-report`.

## Rollout plan (report-only → enforce)

1. **Stage A — report-only (default).** Set `CSP_MODE=report-only` (or leave
   unset). Deploy. Monitor `/api/csp-report` log entries
   (`module=csp-report` `msg=csp.violation`) for ~1 week.
2. **Stage B — fix legitimate violations.** Most reports during stage A
   come from third-party browser extensions and can be ignored. Anything
   originating from our own bundle (e.g. an inline `<style>` we forgot)
   needs a code fix or a directive widening.
3. **Stage C — flip to enforce.** Set `CSP_MODE=enforce` in Render env.
   Re-deploy. Verify the player-shell, admin-web, and Candy iframe still
   load and the player can complete a top-up + game-join + payout flow.

Roll back by setting `CSP_MODE=report-only` and re-deploying.

## Adding a new third-party origin

If we onboard a new analytics/monitoring vendor, prefer the env-var path
so it does not require a code release:

```bash
CSP_EXTRA_CONNECT_SRC=https://o000000.ingest.sentry.io,https://api.example.com
```

The middleware splits on `,`, trims whitespace, and appends to `connect-src`.

For categories other than `connect-src` (e.g. a new `img-src` host) edit
`buildCspDirectives` in `securityHeaders.ts` and add a unit-test.

## Verifying after deploy

```bash
# Headers present?
curl -sI https://spillorama-system.onrender.com/health | grep -iE 'content-security|strict-transport|x-frame|referrer|permissions'

# Score check (manual): paste host into https://securityheaders.com
```

Local smoke:

```bash
npm --prefix apps/backend run dev &
curl -sI http://localhost:4000/api/games | grep -iE 'content-security|x-content-type|x-frame'
```

## CORS allow-list (BIN-49)

The CORS layer is independent of the CSP middleware but ships in the same
hardening pass. `CORS_ALLOWED_ORIGINS` is required in production — the
server refuses to start with wildcard CORS when `NODE_ENV=production`.
For local dev leave it unset (wildcard) or add the dev ports:

```bash
CORS_ALLOWED_ORIGINS=https://spillorama-system.onrender.com,http://localhost:4000,http://localhost:5173,http://localhost:5174
```

## CSP-violation report endpoint

`POST /api/csp-report` accepts both the legacy `report-uri` envelope and
the modern Reporting API array. Body limit 16 KB; per-field clip 2048
chars. Always returns 204. Mounted before the rate-limiter so bursts
during the report-only stage are not silently 429'd.

See OpenAPI tag `Security` and `apps/backend/src/routes/cspReport.ts`.

## Related tickets

- **BIN-776** — this work (CSP/CORS strict + security headers).
- **BIN-777** — replace `style-src 'unsafe-inline'` with build-time
  nonces (follow-up).
- **BIN-49** — CORS production allow-list (already merged; documented
  here for completeness).
