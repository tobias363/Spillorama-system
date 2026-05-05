# BIN-RUM-002 — Host ikke i players[] men hostPlayerId satt (data-integrity)

| Felt        | Verdi                                          |
|-------------|------------------------------------------------|
| Severity    | CRITICAL                                       |
| Category    | data-integrity                                 |
| Retryable   | nei                                            |
| Alert       | immediate (PagerDuty)                          |
| Introduced  | Fase 2A 2026-05-05                             |

## Symptom

`hostPlayerId` på et rom peker på en spiller som ikke er i `players[]`,
men ingen recovery-mekanisme har trigget. Forskjellig fra BIN-RKT-001 som
har auto-fallback — denne CRITICAL-en betyr at vi ikke har klart å
re-assigne host og rommet er i ubrukelig state.

## Hvorfor CRITICAL

Auto-draw-cron har host-fallback. Andre kode-stier (manuell admin-trigger,
host-only mutations) har det IKKE. Hvis dette logges betyr det at en
operasjon trengte host og kunne ikke finne en.

## Sjekkliste

1. **Type operasjon** — sjekk Sentry breadcrumb. Var det:
   - Admin manual-end? → admin må re-trigge etter recovery.
   - Manual claim-validation? → spiller får feil "ingen host".
   - Schedule-forced restart? → cron kan retry-e.
2. **Affected room** — én eller flere?
3. **Players-list** — er den faktisk tom, eller har den fremdeles spillere?
   - Tom: rom skulle vært destroyed, men ikke. Bug i `room:leave`-handler.
   - Med spillere: host-reassignment-logikken har en bug.

## Recovery

1. Identifiser rom-koden fra log-payload.
2. Hvis players[] tom: kall `engine.destroyRoom(roomCode)` via admin-API.
3. Hvis players[] har spillere: kall `engine.setHostPlayer(roomCode, players[0].id)`
   (admin-route, om implementert) eller via DB-update.

## Forebygging

`room:leave`-handleren skal alltid:

1. Hvis avtroppende spiller var host: pick neste spiller som host.
2. Hvis ingen igjen: destroy room atomisk.

Verifiser at denne logikken ikke har race-windows der host kan miste status
før reassign skjer.

## Relatert kode

- `apps/backend/src/game/RoomLifecycleService.ts:handleLeave`
- `apps/backend/src/game/BingoEngine.ts:assertHost`
