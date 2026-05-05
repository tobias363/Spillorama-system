# BIN-RKT-004 — Spill 2 stuck room auto-recovered

| Felt        | Verdi                                          |
|-------------|------------------------------------------------|
| Severity    | HIGH                                           |
| Category    | recovery                                       |
| Retryable   | nei (recovery er allerede applied)             |
| Alert       | rate-threshold (>3/h)                          |
| Introduced  | Fase 2A 2026-05-05 (root-cause fix 2026-05-04) |

## Symptom

```json
{
  "level": "warn",
  "msg": "auto-recovered stuck room (drawn=21, status=RUNNING, endedReason=null)",
  "errorCode": "BIN-RKT-004",
  "module": "Game2AutoDrawTickService",
  "roomCode": "ROCKET-1",
  "drawnCount": 21
}
```

## Hva betyr det

Et Spill 2-rom satt fast i `status=RUNNING` med `drawnNumbers.length >= 21`
(dvs. alle 21 baller trukket) **uten** at `endedReason` ble satt. Auto-draw-
cron har kalt `forceEndStaleRound` som markerer rommet som ENDED og lar
`PerpetualRoundService` spawne en ny runde.

## Sjelden men HIGH severity fordi...

Dette indikerer en bug i `Game2Engine.onDrawCompleted` eller
checkpoint-persistens. Mulige rot-årsaker:

1. **Hook-feil ved siste-draw payout** — wallet-shortage eller compliance-
   error fanget av `handleHookError` etter draw-bagen var tom, slik at
   status aldri ble mutert til ENDED.
2. **Process-restart mid-end** — draw-bagen ble tømt men `forceEndGame`-
   transaksjonen ble ikke persistert før crash.
3. **Race med admin manual end** — to operasjoner kappkjørte og en mistet
   sin status-mutation.

## Hvor ofte er det normalt

Skal være sjeldent (< 3/h). Hvis rate øker:

1. Sjekk om det er korrelasjon med deploy-tider.
2. Sjekk wallet-shortage-rate i samme periode.
3. Sjekk om det er én hall som dominerer — kan være hall-spesifikk
   compliance-config-issue.

## Fix på root-cause

1. Søk Sentry breadcrumbs for `BIN-RKT-004`. Identifiser hva som var
   siste hook som kjørte før recovery.
2. Sjekk `Game2Engine.onDrawCompleted` for try/catch-mønstre som svelger
   feil uten å sette `endedReason`.
3. Hvis recovery-rate øker: vurder å adde wallet-shortage-circuit-breaker
   i payout-stien.

## Relatert kode

- `apps/backend/src/game/Game2AutoDrawTickService.ts` (recovery-logikk)
- `apps/backend/src/game/Game2Engine.ts:onDrawCompleted` (root-cause-area)
- `apps/backend/src/game/PerpetualRoundService.ts:handleGameEnded`
