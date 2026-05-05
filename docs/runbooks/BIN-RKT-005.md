# BIN-RKT-005 — Spill 2 broadcaster.onDrawCompleted threw

| Felt        | Verdi                                          |
|-------------|------------------------------------------------|
| Severity    | HIGH                                           |
| Category    | external-error                                 |
| Retryable   | nei (server-state allerede oppdatert)          |
| Alert       | immediate (PagerDuty)                          |
| Introduced  | Fase 2A 2026-05-05 (broadcaster bug-fix 2026-05-04) |

## Symptom

```json
{
  "level": "error",
  "msg": "broadcaster.onDrawCompleted threw — server-state oppdatert men klient-UI kan være stale",
  "errorCode": "BIN-RKT-005",
  "module": "Game2AutoDrawTickService",
  "roomCode": "ROCKET-1",
  "drawIndex": 5,
  "gameId": "g-uuid"
}
```

## Hva betyr det

Server-side draw lyktes (engine-state oppdatert) men `broadcaster.onDrawCompleted`
kastet en feil. Klient-UI har **ikke** mottatt `draw:new`-event, så
spillerne ser fremdeles forrige ball (potensielt "Trekk: N-1/21").

## Spillere ser dette som...

- Trekk-counter står stille selv om server fortsetter å trekke.
- Vinneren får ikke vinner-overlay etter siste-draw.
- `room:update` på neste socket-event vil eventually korrigere UI, men
  det kan ta sekunder.

## Sjekkliste

1. **Type feil** — sjekk Sentry breadcrumb for stack-trace:
   - `Cannot read properties of undefined` → broadcaster-fabric-bug.
   - `Socket.IO emit timeout` → Redis-adapter ned eller server overload.
   - `JSON.stringify cyclic` → snapshot-objekt korrupt.
2. **Skala-effekt** — hvis høy rate, kan socket-emit-pool være saturated.
3. **Affected-spillere** — hvilken hall? Én hall vs. flere?

## Recovery

- Klient mottar `room:update` ved neste tick (typisk 30s).
- Hvis multiple BIN-RKT-005 i rad: socket-adapter må restartes manuelt.
- Sjekk at `index.ts:game23DrawBroadcasterAdapter` er wired korrekt.

## Relatert kode

- `apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts`
- `apps/backend/src/game/Game2AutoDrawTickService.ts` (broadcaster-call)
