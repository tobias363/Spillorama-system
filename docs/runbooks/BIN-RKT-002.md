# BIN-RKT-002 — Spill 2 auto-draw engine.drawNextNumber unexpected error

| Felt        | Verdi                                          |
|-------------|------------------------------------------------|
| Severity    | HIGH                                           |
| Category    | external-error                                 |
| Retryable   | ja (cron retry-er ved neste tick)              |
| Alert       | immediate (PagerDuty)                          |
| Introduced  | Fase 2A 2026-05-05                             |

## Symptom

```json
{
  "level": "error",
  "msg": "drawNextNumber failed — uventet engine-error",
  "errorCode": "BIN-RKT-002",
  "module": "Game2AutoDrawTickService",
  "roomCode": "ROCKET-1",
  "drawIndex": 7,
  "err": { "name": "Error", "message": "..." }
}
```

## Hva betyr det

`engine.drawNextNumber` kastet en feil som **ikke** er en kjent
race-condition (DRAW_TOO_SOON, NO_MORE_NUMBERS, GAME_NOT_RUNNING,
GAME_PAUSED, GAME_ENDED). Det kan være:

1. Wallet-timeout under payout-side-effekt.
2. Database-connection-pool exhausted.
3. NotImplementedError eller assertion-feil i engine.
4. Memory-pressure som kicker `out of memory`.

## Sjekkliste

1. **Sentry breadcrumb** — se hva som feilet: wallet, DB, engine?
2. **TraceID** — slå opp i logs. Finn upstream-event (room:join, bet:arm,
   start_game) for å rekonstruere kontekst.
3. **Rate** — én forekomst eller spike?
   - Én: vanlig race-event eller memory-glitch. Watch for repeat.
   - Spike: noe systemisk (DB nede, deploy-rollback krevet).
4. **Wallet status** — `GET /health/wallet` skal returnere `200 OK`.
5. **Pool-saturation** — sjekk Render dashboard for DB-connection-count.

## Recovery

- Cron retry-er automatisk ved neste tick (30s default).
- Hvis feil persisterer på samme rom > 3 ticks, vurder manuell `forceEndStaleRound`
  via admin-route.

## Relatert kode

- `apps/backend/src/game/Game2AutoDrawTickService.ts:tick()` (catch-block)
- `apps/backend/src/game/BingoEngine.ts:drawNextNumber()`
