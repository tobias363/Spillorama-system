# Delta-rapport — codex/fix-scheduled-ticket-mark-2026-05-17

## Hva ble endret

- `apps/backend/src/game/Game1ScheduledTicketMarkService.ts` — ny scheduled Spill 1-validator for high-frequency `ticket:mark`. Bruker `RoomSnapshot.scheduledGameId`, DB-backed scheduled-game state, drawn-number lookup og per-player assignment lookup.
- `apps/backend/src/sockets/gameEvents/ticketEvents.ts` — `ticket:mark` prøver scheduled validator før legacy `BingoEngine.markNumber()`.
- `apps/backend/src/sockets/gameEvents/deps.ts` — ny optional dep `validateScheduledGame1TicketMark`.
- `apps/backend/src/index.ts` — wirer `Game1ScheduledTicketMarkService` inn i socket deps.
- `apps/backend/src/game/Game1ScheduledTicketMarkService.test.ts` og `apps/backend/src/sockets/gameEvents/ticketEvents.scheduled.test.ts` — regresjonstester for scheduled mark path, fallback og cache.
- `.claude/skills/spill1-master-flow/SKILL.md`, `docs/engineering/PITFALLS_LOG.md`, `docs/engineering/AGENT_EXECUTION_LOG.md` — knowledge-protocol update.

## Hva andre steder kunne ha blitt brutt

- Legacy/ad-hoc `ticket:mark`: bevart ved at validator returnerer `false` for rom uten `scheduledGameId`; test dekker fallback.
- GoH/scheduled player socket-flow: endringen påvirker kun mark-ack validering, ikke draw/payout/pattern-eval. `Game1DrawEngineService.drawNext()` eier fortsatt `markings_json`.
- DB-load under 4x80: full scheduled room snapshot per mark er eksplisitt unngått; service cacher draw-state og per-player ticket numbers.
- Auth/spoofing: `requireAuthenticatedPlayerAction` kjører fortsatt før validatoren, og validatoren sjekker at `playerId` finnes i rommet.

## Nye fragilities oppdaget

- Ingen ny FRAGILITY_LOG-entry. Eksisterende fallgruve §6.23 er oppdatert fra åpen til løst.
- Ny invariant for fremtidige agenter: scheduled Spill 1 socket-events som leser running-state må ikke anta at legacy `BingoEngine.currentGame` er autoritativ.

## Brief for neste agent

- Hvis du endrer `ticket:mark`, `claim:submit`, reconnect eller scheduled room-state, start med `spill1-master-flow` v1.23.0 og PITFALLS §6.23.
- Ikke erstatt `Game1ScheduledTicketMarkService` med `getAuthoritativeRoomSnapshot()` per mark. Det kan virke korrekt i unit-test, men vil reintrodusere load-problem ved 4x80/1000-spiller skala.
- Neste live-verifisering bør kjøre GoH-runner og kreve `markAcks > 0` og `markFailures === 0` eller konkret analysert race på terminal draw.

## Tester kjørt

- unit-tests: ✅ `LOG_LEVEL=warn npx tsx --test src/sockets/gameEvents/ticketEvents.scheduled.test.ts src/game/Game1ScheduledTicketMarkService.test.ts`
- typecheck: ✅ `npm run check --workspace apps/backend`
- backend-suite: ✅ `npm --prefix apps/backend run test` (11595 tester, 0 failures, 140 skipped, 1 todo)
- docs: ✅ `npm run docs:check` (0 errors, 2 eksisterende ADR-numbering warnings)
- skill-map: ✅ `npm run skills:map`
