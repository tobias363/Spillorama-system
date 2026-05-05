# Module: `apps/backend/src/observability`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen

## Ansvar

Casino-grade observability (jf. ADR-010):
- Structured logging (Pino) med trace-id propagation
- Sentry-integrasjon (errors, breadcrumbs, performance)
- Status-page service (BIN-791) — komponent-helse-sjekk
- Live-room metrics (player-count, draw-rate)
- Reconciliation cron-jobs (wallet, compliance-ledger)
- Audit-anchor cron (daglig signed snapshot, ADR-003)

## Ikke-ansvar

- Sentry-konfig på klient-side (delegert til `packages/game-client/diagnostics`)
- Render-side metrics (delegert til Render.com)

## Public API

| Service | Funksjon |
|---|---|
| `Logger` | Pino-wrappper med trace-id |
| `SentryClient` | Wrapper rundt Sentry SDK |
| `StatusService` | Komponent-helse-aggregering |
| `LiveRoomMetricsService` | Real-time room-stats |
| `traceIdMiddleware` | Sett trace_id på request |

## Invariants

1. **Trace-ID propagation tvers stack:** klient → HTTP → Socket.IO → DB
2. **Structured logs alltid:** ikke `console.log`
3. **Sentry-tags:** `module`, `errorCode`, `userId`, `hallId`, `roomCode`
4. **PII redaction** før logging (passwords, nationalId, tokens)
5. **Daily anchor cron** kjører ved midnatt Oslo

## Referanser

- ADR-010 (casino-grade observability)
- ADR-003 (hash-chain audit)
- `docs/operations/OBSERVABILITY_RUNBOOK.md`
- `docs/operations/LIVE_ROOM_OBSERVABILITY_2026-04-29.md`
- BIN-791 (status-page)
