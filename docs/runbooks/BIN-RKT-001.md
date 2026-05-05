# BIN-RKT-001 — Spill 2 host disconnected, fallback applied

| Felt        | Verdi                                          |
|-------------|------------------------------------------------|
| Severity    | MEDIUM                                         |
| Category    | recovery                                       |
| Retryable   | nei (recovery er allerede applied)             |
| Alert       | rate-threshold (>10/min)                       |
| Introduced  | Fase 2A 2026-05-05 (host-fallback fix 2026-05-04) |

## Symptom

Strukturert log-event:

```json
{
  "level": "info",
  "msg": "host fallback — original host not in players list, fortsetter med første tilgjengelige spiller",
  "errorCode": "BIN-RKT-001",
  "module": "Game2AutoDrawTickService",
  "roomCode": "ROCKET-1",
  "oldHostId": "...",
  "newHostId": "...",
  "reason": "host_disconnected"
}
```

## Hva betyr det

`hostPlayerId` for et Spill 2-rom peker på en spiller som ikke lenger er i
`players[]`. Auto-draw-cron-en faller tilbake til første tilgjengelige
spiller som actor for `engine.drawNextNumber`. Spill-runden fortsetter
normalt.

## Hvor ofte er det normalt

Forventet ved fane-refresh, Wi-Fi-blip, eller fanelukking. Bør være < 1/min
i normal drift. Hvis rate > 10/min, sjekk:

1. Er det Wi-Fi-problemer i hallene?
2. Er det en deploy som har trigget mange disconnects?
3. Er det en bug som kicker spillere ut for tidlig?

## Fix når rate øker

1. Sjekk Sentry breadcrumbs for `BIN-RKT-001` — finn fellesfaktor (hall,
   tidspunkt, klient-versjon).
2. Sjekk `room:leave`-rate i samme periode. Hvis høyt → klient-bug.
3. Hvis kun én hall: sjekk hall-side nettverk.

## Relatert kode

- `apps/backend/src/game/Game2AutoDrawTickService.ts` (host-fallback-logikk)
- `apps/backend/src/game/Game3AutoDrawTickService.ts` (samme mønster)
