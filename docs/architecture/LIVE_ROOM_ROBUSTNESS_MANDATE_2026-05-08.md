# Live-rom-robusthet — arkitektur-mandat

**Status:** Autoritativt arkitektur-mandat. Overstyrer alle andre prioriteringer for live-rom-systemet.
**Dato:** 2026-05-08
**Eier:** Tobias Haugen (teknisk lead)
**Mål-nivå:** Evolution Gaming-grade robusthet.

---

## 1. Direktivet

> "Det er ekstremt viktig at arkitekturen rundt rommene er robust. Spill 1, 2 og 3 er live rom som alltid må være live innenfor åpningstid. Hvis dette er bygd sånn at det feiler et par ganger i løpet av dagen eller på dårlig arkitektur, vil vi få mye ufornøyde kunder og tape penger på at kundene vil til andre konkurrenter. Vi må sette alle de ressursene vi ser hensiktsmessige for at vi får like robust løsning på dette område som Evolution Gaming."
>
> — Tobias, 2026-05-08

Live-rommene for Spill 1, Spill 2 og Spill 3 er **kritisk infrastruktur**. Nedetid eller flaky-oppførsel innenfor åpningstid er ikke akseptabelt.

---

## 2. Hvorfor dette er P0

- **Direkte tap av omsetning** — hver feilet runde, hver "rom utilgjengelig"-melding er penger som går til konkurrent.
- **Tillit som ikke kan kjøpes tilbake** — bingo-spillere er vanedyr. Mister vi dem én gang på ustabilitet, kommer de ikke tilbake.
- **Regulatorisk risiko** — pengespillforskriften §66 (obligatorisk pause) og §71 (rapportering) kan ikke håndheves korrekt hvis rom-state er inkonsistent.
- **Pilot-blokker** — vi kan ikke gå live i fire pilot-haller hvis grunnflyten faller når en runde feiler.

Dette er ikke en "P1 etter pilot" — dette er **fundament som må være på plass før pilot går live**.

---

## 3. Robusthet-krav (Evolution-grade)

### 3.1 Tilgjengelighet
- **Mål:** 99.95 % uptime innenfor åpningstid (≤ 4 min/uke nedetid).
- **Stretch:** 99.99 % (≤ 50 sek/uke).
- Måles per (hall, dato) — ikke aggregert over alle haller (én hall ned er fortsatt en feil).

### 3.2 Determinisme
- **Ingen race-conditions** mellom socket-events, draw-tick, ticket-purchase, payout.
- **Idempotent håndtering** av alle state-overganger (start, draw-next, pause, resume, finish).
- **REPEATABLE READ** eller serialisering på alle wallet-touch-paths (allerede etablert i casino-grade-wallet, BIN-761→764).

### 3.3 Recovery
- **Automatisk re-kobling** for klient innen 3 sek etter midlertidig nettverksfeil.
- **State-replay** ved klient-reconnect — klient skal kunne hente full rom-state og fortsette uten tap.
- **Cross-instance failover** — hvis backend-instans dør midt i en runde, skal annen instans plukke opp via Redis-state og fortsette uten å miste draws eller marks.
- **Idempotente socket-meldinger** med `clientRequestId`/`messageId` slik at duplikate emits ikke gir doble effekter.

### 3.4 Observabilitet
- **Strukturert event-logg** for hver state-overgang (`room.opened`, `round.started`, `draw.next`, `claim.submitted`, `round.finished`).
- **Health-endpoint per rom** — `/api/games/spill1/lobby?hallId=X` returnerer alltid live-state, aldri stale > 5 sek.
- **Metrics:** p50/p95/p99 for socket-roundtrip, draw-tick-jitter, ticket-purchase-latency.
- **Alerting:** PagerDuty/varsling hvis et rom står i error-state > 30 sek.

### 3.5 Last og kapasitet
- **Tåle 1000 samtidige klienter per rom** uten degradering (4 haller × 250 spillere er pilot-realistisk; vi planlegger for 10× pilot).
- **Backpressure** ved ticket-purchase-burst (alle kjøper i siste minutt før rundestart).
- **Graceful degradation** — hvis Redis er treg, fall tilbake til at backend kun aksepterer read-only state og varsler ops.

### 3.6 Konsistens med wallet
- **Aldri** belaste lommebok uten at ticket-rad faktisk er commit-et.
- **Aldri** utbetale premie uten audit-event.
- Outbox-pattern (allerede etablert) skal brukes for alle wallet-touch fra rom-event.

---

## 4. Hva vi har i dag (per 2026-05-08)

### 4.1 Styrker
- **Casino-grade wallet** med outbox + REPEATABLE READ + nightly reconciliation + hash-chain audit (BIN-761→764).
- **Per-instance lock** på draw-tick (Redis-basert).
- **Socket.IO med room-isolation** per hall/scheduled-game.
- **Game1ScheduleTickService** håndterer auto-flip `scheduled` → `purchase_open` → `running`.

### 4.2 Svakheter / risiko-områder
- **Klient-rom-tilgang er knyttet til scheduled-game-rad** — hvis ingen rad i `purchase_open`/`running`, klient får "FÅR IKKE KOBLET TIL ROM". Lobby-rom-konsept (PR #1018) er foundation, men Game1Controller-wireup gjenstår.
- **Spill 2 perpetual-room er nytt** (PR #1016) og ikke battle-tested under last.
- **Spill 3 phase-state-machine** (PR #1008) er foundation; engine-integrasjon gjenstår.
- **Cross-instance failover er ikke verifisert** — vi har Redis-state, men ingen test som faktisk dreper en backend-instans midt i en runde og verifiserer at annen instans plukker opp.
- **Ingen chaos-testing** av rom-arkitektur.
- **Manglende load-test** mot 1000+ samtidige klienter.
- **Ingen automatic re-connect-handling** verifisert end-to-end.

---

## 5. Tiltak — prioritert (P0 før pilot live)

| # | Tiltak | Estimat | Status |
|---|---|---|---|
| R1 | **Lobby-rom Game1Controller-wireup** — løse "FÅR IKKE KOBLET TIL ROM" ende-til-ende | 1-2d | Foundation: PR #1018 åpen |
| R2 | **Failover-test** — drep backend-instans midt i runde, verifiser at annen instans plukker opp uten å miste draws | 2-3d | Ikke startet |
| R3 | **Klient-reconnect-test** — verifiser at klient som mister nett 5/15/60 sek får full state-replay og kan fortsette uten tap | 2d | Ikke startet |
| R4 | **Load-test** — k6 eller artillery-script som simulerer 1000 samtidige klienter per rom over 60 min | 2-3d | Ikke startet |
| R5 | **Idempotent socket-event-håndtering** — `clientRequestId`-deduplisering på `ticket:mark`, `claim:submit`, `ticket:buy` | 2d | Delvis (wallet har, sockets ikke verifisert) |
| R6 | **Outbox for room-events** — alle wallet-touch fra room-events går via outbox | 1-2d | Wallet-siden ferdig; rom-side må verifiseres |
| R7 | **Health-endpoint per rom** — `/api/games/{slug}/health?hallId=X` med p95-latency, last-draw-age, connected-clients | 1d | Ikke startet |
| R8 | **Alerting** — PagerDuty/Slack-varsel hvis rom står i error-state > 30 sek eller draw-tick-jitter > 2s | 1d | Ikke startet |
| R9 | **Spill 2 perpetual-room load-test** — verifiser at perpetual-loop ikke akkumulerer leaks over 24t | 2d | Ikke startet |
| R10 | **Spill 3 phase-state-machine engine-wireup + chaos-test** — verifiser at engine fortsetter korrekt etter midlertidig backend-nedetid | 3-4d | Foundation: PR #1008 |
| R11 | **Per-rom resource-isolation** — én rom-feil må aldri ta ned andre rom (process-level isolation eller sirkel-bryter per rom) | 3-5d | Ikke startet |
| R12 | **Disaster-recovery-runbook** — dokumentert prosedyre for rom-failover, DB-failover, Redis-failover, full instance-restart | 1d | Eksisterer i `docs/operations/` men må valideres mot rom-arkitektur |

**Sum:** ~22-30 dev-dager. Kan parallelliseres med 3-4 agenter til ~7-10 kalenderdager.

---

## 6. Pilot-gating

Før pilot går live i én hall (Teknobingo Årnes som master + 3 deltager-haller):

**Må være lukket:**
- [x] R1 (foundation, krever Game1Controller-wireup som final step)
- [ ] R2 — failover-test grønn
- [ ] R3 — reconnect-test grønn
- [ ] R5 — idempotent socket-events verifisert
- [ ] R7 — health-endpoint live
- [ ] R8 — alerting live
- [ ] R12 — runbook validert

**Kan være planlagt etter pilot (men før utvidelse til flere haller):**
- R4 (load-test for skala-utvidelse)
- R6 (outbox-validering)
- R9 (Spill 2 24t-test)
- R10 (Spill 3 chaos-test)
- R11 (per-rom isolation)

---

## 7. Hvordan måle "Evolution Gaming-grade"

Evolution publiserer ikke sine SLA-er offentlig, men markeds-rykte / kunde-erfaring tilsier:
- **Uptime under live-event:** 99.99 %+ (de tar ned for vedlikehold, men aldri midt i runde).
- **Reconnect:** sekunder, ikke minutter — spilleren merker sjelden et nettverks-glipp.
- **Determinisme:** absolutt — to spillere som ser samme runde får samme resultat. Ingen "ble kortet ditt borte".
- **Auditerbar:** hver hånd / hver runde kan reproduseres event-for-event for compliance.

Vår benchmark er ikke "feilfri kode" — det er "håndterer feil så godt at sluttbruker ikke merker det". Det krever:
- Redundans
- Failover
- Idempotens
- Observabilitet

---

## 8. Eierskap

- **Arkitektur-eier:** Tobias.
- **Implementasjons-eier:** PM (jeg) + agent-team.
- **Ops-eier:** TBD — Tobias avgjør om eksternt SRE-byrå skal involveres for R2/R3/R4.

Hvis vi finner at egen kapasitet ikke holder for å nå Evolution-nivå, er **eksternt løft** (kortvarig SRE-konsulent eller chaos-engineering-byrå) bedre enn å gå live på sub-par robusthet.

---

## 9. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial. Doc-fester direktiv fra Tobias om Evolution-grade robusthet. | PM-AI (Claude Opus 4.7) |

---

## 10. Referanser

- [docs/architecture/SPILL_DETALJER_PER_SPILL.md](./SPILL_DETALJER_PER_SPILL.md) — §1.0.1 lobby-rom-konsept
- [docs/architecture/SPILL_REGLER_OG_PAYOUT.md](./SPILL_REGLER_OG_PAYOUT.md) — §9 multi-vinner-regel (regulatorisk korrekthet)
- [docs/operations/](../operations/) — runbooks, deployment
- PR #1018 — lobby-rom-foundation
- PR #1016 — Spill 2 perpetual room
- PR #1008 — Spill 3 phase-state-machine
- BIN-761→764 — casino-grade wallet (eksisterende fundament)
