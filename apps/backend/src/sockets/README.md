# Module: `apps/backend/src/sockets`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~7 916

## Ansvar

Socket.IO-basert real-time kommunikasjon:
- Per-rom event-bredkast (room.state_changed, draw.new, claim.confirmed)
- Klient-tilkobling og auth (Bearer-token i query)
- Rate-limiting per socket
- Reconnect-håndtering (snapshot ved reconnect)
- Auto-reconnect ved window.online-event (PR #937)
- Event-versjonering (for backwards-compat)

## Ikke-ansvar

- Spill-logikk (delegert til `game/`)
- Wallet/compliance (delegert til respektive moduler)
- HTTP-routing (delegert til `routes/`)

## Public API

Hoved-event-namespaces:
- `/game1` — Spill 1 (per hall)
- `/game2` — Spill 2 (globalt ROCKET)
- `/game3` — Spill 3 (globalt MONSTERBINGO)
- `/admin-game1` — admin-oversikt
- `/tv` — TV-skjerm read-only

| Service | Funksjon |
|---|---|
| `SocketServer` | Setup + middleware (auth, rate-limit) |
| `SocketRateLimiter` | Per-socket throttling |
| `RoomBroadcaster` | Targeted bredkast til room-id |
| `ReconnectSnapshotService` | Ved reconnect, send fullt state-snapshot |

## Hoved-events

### Server → Klient
- `room.state_changed` — LOBBY/PLAYING/ENDED
- `draw.new` — ny ball trukket
- `claim.confirmed` — vinner bekreftet
- `wallet.balance_updated` — saldo endret
- `master.changed` — master-hall byttet (Spill 1)
- `transfer.requested|completed|expired` — master-handover (Spill 1)
- `hall.ready_state_changed` — hall ready-status

### Klient → Server
- `room:join` — bli med i rom
- `ticket.mark` — marker ball på ticket
- `claim.submit` — submit claim
- `chat.send` — chat-melding
- `master.signal_ready` — bingovert signaler ready (Spill 1)

## Avhengigheter

- Socket.IO 4.8
- Redis adapter (for cross-instance bredkast når horizontal scaling)
- `auth/AuthTokenService` — token-validering
- `game/` — event-handlers

## Invariants

1. **Auth ved connection:** Bearer-token må være gyldig, eller socket disconnectes
2. **Rate-limit per socket:** 100 events/min default, gjennomtenkt for spill-fluen
3. **Targeted bredkast:** aldri `io.emit(...)` til alle 36 000 — bruk `io.to(roomCode).emit(...)`
4. **Reconnect-snapshot er authoritativ:** klient resetter state ved reconnect
5. **Event-versjonering:** breaking changes legger til ny event-type, ikke endrer eksisterende
6. **Event-id på alle mutating events** for klient-side dedup

## Bug-testing-guide

### "Spillere mister tilkobling tilfeldig"
- Sjekk Render.com network logs
- Sjekk `SocketRateLimiter` er ikke for streng
- Sjekk om Socket.IO heartbeat-config matcher klient
- Sjekk PR #937 — auto-reconnect ved online-event

### "Sent event når ikke alle"
- Bruk `io.to(roomCode).emit` (ikke `io.emit`)
- Sjekk om alle klienter er joined i `roomCode`-rom
- Sjekk Redis pub/sub hvis horizontal-scaling

### "Reconnect viser feil state"
- Sjekk `ReconnectSnapshotService` retur
- Sjekk om klient bruker snapshot-versjon, ikke event-deltas

## Operasjonelle notater

### Pilot-skala
- 36 000 samtidige tilkoblinger
- Gjennomsnitt 50-100 events/sek per spillerunde
- Use room-targeting alltid — bredkast til alle ville være katastrofalt

### Sentry-tags
- `module:sockets`
- `socketId:<id>`
- `roomCode:<code>`
- `eventType:<type>`

## Referanser

- `docs/architecture/EVENT_PROTOCOL.md` — full event-katalog
- `docs/architecture/WIRE_CONTRACT.md` — wire-format spec
- PR [#937](https://github.com/tobias363/Spillorama-system/pull/937) — auto-reconnect
- ADR-001, ADR-002 (system-actor for system-driven events)
