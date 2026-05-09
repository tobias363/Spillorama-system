# Diagram 3: Draw Flow — Spill 1 (Master-styrt)

**Sist oppdatert:** 2026-05-06

Spill 1 (`bingo`) er master-styrt per hall. Bingovert i master-hallen klikker "Start Next Game",
andre haller signaliserer "Ready", og draw-engine begynner å trekke baller.

Se ADR-001 for hvorfor Spill 1 er per-hall master-styrt mens Spill 2/3 er global perpetual.

```mermaid
sequenceDiagram
    autonumber
    participant MA as Master-agent
    participant OA as Andre haller<br/>(agent-portal)
    participant BE as Backend<br/>(Game1Engine)
    participant DB as Postgres
    participant R as Redis<br/>(RoomState)
    participant P as Spillere<br/>(game-client)
    participant TV as TV-skjerm

    Note over MA,TV: Pre-spill: agenter har solgt tickets,<br/>schedule sier neste runde 19:00

    MA->>BE: POST /api/game1/rooms/:hallId/ready
    BE->>R: Update hallReady[masterHall] = true
    BE-->>MA: OK
    BE-->>OA: socket emit hall.ready_state_changed

    OA->>BE: POST /api/game1/rooms/:hallId/ready
    BE->>R: Update hallReady[hall] = true
    BE-->>OA: OK
    BE-->>MA: socket emit hall.ready_state_changed
    BE-->>TV: socket emit hall.ready_state

    Note over MA: Master ser alle haller klare

    MA->>BE: POST /api/game1/rooms/:hallId/start

    BE->>BE: assertHost(masterHall)
    BE->>R: Sjekk alle haller ready
    alt Ikke alle klare
        BE-->>MA: 400 + Liste over not-ready haller
    else Alle klare
        BE->>DB: BEGIN TX
        BE->>DB: INSERT app_game_session
        BE->>DB: UPDATE app_room SET state=PLAYING
        BE->>DB: COMMIT TX
        BE->>R: Set roomState=PLAYING

        BE-->>MA: 200 + sessionId
        BE-->>OA: socket emit room.state_changed
        BE-->>P: socket emit game.started
        BE-->>TV: socket emit room.state_changed

        Note over BE: Auto-draw cron starter:<br/>2 sek mellom baller

        loop For hver ball til Fullt Hus eller end-of-game
            BE->>BE: drawNextBall()<br/>(crypto.randomInt fra ikke-trukne)
            BE->>DB: INSERT app_draw_event
            BE->>R: Push ball til drawnBalls
            BE-->>P: socket emit draw.new<br/>{ ball, drawNumber, sessionId }
            BE-->>TV: socket emit draw.new
            BE-->>MA: socket emit draw.new
            BE-->>OA: socket emit draw.new

            P->>BE: socket emit ticket.mark<br/>{ ticketId, ball }
            BE->>R: Update ticket-state
            BE->>BE: evaluateClaims()

            alt Claim funnet
                BE->>DB: BEGIN TX
                BE->>DB: INSERT app_claim
                BE->>DB: UPDATE app_wallet (payout) + wallet_entries with hash-chain
                BE->>DB: INSERT app_audit_log
                BE->>DB: COMMIT TX
                BE-->>P: socket emit claim.confirmed
                BE-->>TV: socket emit claim.confirmed (winner-display)
                BE-->>MA: socket emit claim.confirmed
            end
        end

        BE->>DB: UPDATE app_game_session SET state=FINISHED
        BE->>R: Set roomState=ENDED
        BE-->>P: socket emit game.ended
        BE-->>TV: socket emit game.ended
    end
```

## Master-hall responsibility

Master-hallen styrer kun **rundens timing** — ikke selve trekningene. Trekningene er rene
crypto.randomInt fra ikke-trukne-baller, bundet til sessionId.

Master kan:
- Trigger "Start Next Game" når alle haller signalerer ready
- Trigger "Pause" mid-runde for bingo-check
- Trigger "End Round" hvis alt blir kaos

Master kan IKKE:
- Hoppe over baller eller manipulere RNG
- Avgjøre claims (det er BingoEngine sin jobb)
- Endre payout-policy mid-runde

## Master-handover

Hvis master-hallen blir offline mid-runde, kan annen hall ta over via `transferHallAccess`-handshake.
Se [Diagram 5: Master-handover](./05-master-handover.md).

## Compliance-binding

Hver claim binder ComplianceLedger-rad til **kjøpe-hallen** (ikke master-hallen). Dette er BIN-661 fix
(PR #443) — viktig for §71 hall-rapport.

Se ADR-002 (system-actor) og ADR-007 (spillkatalog).

## Referanser

- `apps/backend/src/game/Game1RoomFactory.ts`
- `apps/backend/src/game/Game1HallReadyService.ts`
- `apps/backend/src/game/Game1AutoDrawTickService.ts`
- `apps/backend/src/game/Game1DrawEngineService.ts`
- ADR-001 (perpetual vs master)
- ADR-002 (system-actor)
