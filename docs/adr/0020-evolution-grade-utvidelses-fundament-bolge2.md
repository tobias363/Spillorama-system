# ADR-0020 — Evolution-grade utvidelses-fundament (Bølge 2)

**Status:** Accepted
**Dato:** 2026-05-10
**Deciders:** Tobias Haugen
**Konsulterer:** Senior arkitekt-audit 2026-05-10 (P1-funn)

## Kontekst

ADR-0019 lukket 4 P0-funn for casino-grade state-konsistens (Bølge 1). Tobias-direktiv 2026-05-10:
> "Sett av så mange ressurser som mulig. Spawn nye agenter så lenge det ikke skaper konflikt."

Senior-arkitekt-audit identifiserte 5 P1-funn som er **utvidelses-blokkere** (4-hall pilot OK, men 24-hall skala kreves dekket). 1 er obsolet etter ADR-0017. 1 må vente til Bølge 1 #1169 merger pga fil-konflikt.

Pluss 2 R-tiltak fra `LIVE_ROOM_ROBUSTNESS_MANDATE` som er klargjort men ikke implementert (R4 + R9).

## Beslutning

**Bølge 2 implementerer 4 parallelle tiltak**, alle med distinkte filer (ingen konflikt med Bølge 1 åpne PR-er):

### P1-3 — Redis-alarmer + health-monitor (Agent E, 2-3d)

**Problem:** `RedisRoomStateStore.persistAsync` logger kun `error` ved feil, propagerer ikke. `RedisSchedulerLock` aksepterer `maxRetriesPerRequest: 3` — etter det går connection-errors stille. R8 alerting eksisterer men er ikke wired på Redis health.

**Løsning:**
- Wire `RedisHealthMonitor` til `RoomAlertingService`
- Trigger PagerDuty hvis Redis er nede > 30s
- Add metric `redis_persist_failures_total`
- Vurder Postgres-fallback hvis Redis nede > 5s sammenhengende

### P1-6 — R11 per-rom resource-isolation (Agent F, 5d)

**Problem:** Én rom-feil kan teoretisk ta ned andre rom (delt event-loop, delt DB-pool). 4-hall pilot OK, 24-hall ikke verifisert.

**Løsning:**
- Sirkel-bryter per rom rundt `engine.drawNextNumber`, `Game1MasterControlService`-actions
- P95-tracking per rom
- Hvis ett rom over 5s p95 → tag som degraded, alert R8

### R4 — Load-test 1000 klienter (Agent G, 2-3d)

**Problem:** Skala-utvidelse fra 4 → 24 haller × 1500 spillere = 36 000 samtidige er ikke verifisert under last.

**Løsning:**
- k6 eller artillery-script
- Simuler 1000 samtidige klienter per rom over 60 min
- Måle p50/p95/p99 socket-roundtrip, draw-tick-jitter, ticket-purchase-latency
- Identifiser flaskehalser (Redis pool, DB pool, Socket.IO adapter)

### R9 — Spill 2 24t-leak-test (Agent H, 2d)

**Problem:** Spill 2 perpetual-loop er ikke verifisert å holde 24t kontinuerlig kjøring uten leak/drift.

**Løsning:**
- Chaos-infra-script som kjører Spill 2 i 24t
- Måler memory-vekst, socket-handle-leaks, Redis-key-vekst
- Verifiserer `Game2AutoDrawTickService` ikke akkumulerer pending-states
- Documenterer baseline + threshold for alarm

## Bevisst utelatt fra Bølge 2

### P1-1 Jackpot reset-hook (OBSOLET)
ADR-0017 fjernet daglig jackpot-akkumulering helt. Reset-hook ble ubrukt. Lukker ikke-trengende.

### P1-5 Broadcast-batching `draw:new` vs `room:update`
Touch-er `roomHelpers.ts` som er Agent A's domain (#1169 ikke merget enda). **Bølge 2.5** etter #1169 merger.

### MASTER_HALL_RED-fjerning
Krever Tobias eksplisitt direktiv-overstyring av 2026-05-08-direktivet. På vent.

### P1-4 Over-midnatt-vinduer Spill 2
Pilot 11-23 åpningstid OK. Post-pilot prioritet.

## Konsekvenser

### Positive
- **Pilot-utvidelses-blokkere lukkes** — fra 4 til 24 haller blir trygt
- **Operative alarmer** for Redis-degradering — operasjonsteam kan svare innen SLA
- **Load-validert skala** — vet hvor flaskehalsen er FØR den treffer i prod
- **Spill 2 24t-stabilitet** — verifisert at perpetual-loop ikke leaker

### Negative
- ~12-13 dev-dager parallellisert til ~5-7 kalenderdager (siste agent er F med 5d estimat)
- Krever Prometheus + PagerDuty wiring som ikke er fullt operativ enda
- Load-test krever staging-miljø (eller dedikert load-test-rig)

### Nøytrale
- Bølge 2.5 (P1-5 broadcast-batching) etterfølger når #1169 merger
- Bølge 3 (P2 polish) post-pilot

## Implementasjon

| Agent | PR | Scope | Estimat |
|---|---|---|---|
| Agent E | TBD | P1-3 Redis-alarmer | 2-3d |
| Agent F | TBD | P1-6 R11 per-rom isolation | 5d |
| Agent G | TBD | R4 Load-test 1000 klienter | 2-3d |
| Agent H | TBD | R9 Spill 2 24t-leak-test infra | 2d |

Hver agent får eget worktree (`/tmp/agent-{e,f,g,h}-...`) per PITFALLS §11.3.

## Referanser

- [ADR-0019](../adr/0019-evolution-grade-state-consistency-bolge1.md) — Bølge 1 P0-funn
- [LIVE_ROOM_ROBUSTNESS_MANDATE](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — opprinnelig R1-R12
- Tobias-direktiv 2026-05-10 — "ekstrem viktig at dette blir gjort riktig"
- Senior-arkitekt-audit 2026-05-10 (in-session)
