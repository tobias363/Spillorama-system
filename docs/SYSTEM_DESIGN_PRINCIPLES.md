# Spillorama — System Design Principles

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**Status:** Levende dokument. Endres kun ved fundamentale arkitekturskifter (forventet 3-4 ganger per år maks).

> **Til ny utvikler:** Dette er vår "true north". Når en beslutning føles vanskelig, kom tilbake hit
> og spør: "stemmer dette med våre prinsipper?" Hvis ikke — eskalér til Tobias før du fortsetter.

---

## 1. Vår ambisjon

Spillorama skal være **casino-grade på linje med Evolution Gaming og Playtech Bingo**.

**Hva betyr det konkret:**
- Spillere opplever <100 ms latens for ball-trekninger på 36 000-skala
- Server-state er aldri ute av sync med klient mer enn 1 frame (50 ms)
- Vi krasjer ikke. Vi degraderer pent. Hvis Postgres er nede, fortsetter rom-state lokalt; ingen state-tap
- Vi fail-closed på compliance: hvis spillevett-tjenesten er nede, blokkerer vi spill — ikke åpner
- Vi har strukturert observability (Sentry + structured logs + trace-id pipeline) som gir 5-min MTTR

**Forskjellen fra "vanlig SaaS":** vi er regulert pengespill. Hver krone som beveger seg må ha audit-trail.
Hver bug som påvirker utbetaling kan koste konsesjonen. Vi prioriterer korrekthet over hastighet.

---

## 2. Pilot-skala

**24 haller × 1500 spillere = 36 000 samtidige.**

Dette er ikke et fremtidsmål — det er pilot-skala 2026. Alle arkitekturvalg må tåle 36 000 samtidige
WebSocket-tilkoblinger uten degradering.

**Konsekvenser:**
- Per-hall-rom for Spill 2/3 ville ikke skalere — derfor ETT globalt rom (se ADR-001)
- Per-spiller-state må holdes i Redis (rom-state-cache), ikke kun Postgres
- Bredkast-throttling på Socket.IO: ingen `io.emit` til 36 000 spillere uten room-targeting

---

## 3. Bærende prinsipper

### 3.1 Server er sannhets-kilde, klient er view

Backend (`apps/backend`) eier all state. Klient (`packages/game-client`, `apps/admin-web`) viser kun.

**Praksis:**
- Klient sjekker aldri "kan spille X" basert på lokal state. Den spør server.
- Klient simulerer aldri trekninger lokalt. Server pusher resultatet.
- Hvis klient og server uenige om hvilke baller som er trukket: server vinner, klient resetter.

**Hvorfor:** regulatorisk audit krever entydig kilde. Spillere må ikke kunne manipulere klient-state for å
få bedre odds.

### 3.2 Perpetual rom (Spill 2/3) er IKKE Spill 1

Dette er et fundamentalt arkitekturskille som mange nye utviklere bommer på:

- **Spill 1** = master-styrt, per hall, schedule-driven, agent-koordinert
- **Spill 2/3** = ETT globalt rom per spill, perpetual loop, system-driven (ingen agent involvert)

**De deler kode** (BingoEngine, RoomState, Socket.IO) men har **fundamentalt forskjellige
livssyklus-modeller**.

**Praksis:**
- For Spill 2/3: ingen "master hall", ingen "agent ready"-handshake. System-actor genererer events.
- For Spill 1: master-hall styrer "Start Next Game", andre haller signalerer "Ready"
- Kode som blander de to (f.eks. `assertHost` på Spill 2/3) er en bug. Se [`#942`](https://github.com/tobias363/Spillorama-system/pull/942).

**Hvorfor:** å presse Spill 2/3 inn i Spill 1-modellen ville gi 24-1500 single-points-of-failure (master-hall
disconnect = hele runden henger). Perpetual-modell skalerer; master-modell er regulatorisk korrekt for
hovedspill-i-hall.

Se [ADR-001](./decisions/ADR-001-perpetual-room-model-spill2-3.md).

### 3.3 System-actor for system-driven actions

Når BingoEngine produserer et trekk uten en menneskelig handler (perpetual loop, auto-draw, time-based
escalation), audit-loggen får actor `SYSTEM` — ikke en falsk player-id.

**Hvorfor:** revisjon krever at vi kan svare "hvem trakk denne ballen?" entydig. "System" er et legitimt
svar; "player-id 0" er en løgn.

Se [ADR-002](./decisions/ADR-002-system-actor.md).

### 3.4 Idempotente operasjoner overalt

Hver mutering må kunne gjentas trygt med samme resultat. Klienter retry'er. Backend må ikke dobbeltkrediter
wallet, dobbeltscore claims, eller sende dobbelt push-notification.

**Praksis:**
- Wallet-operasjoner har `idempotency-key` (BIN-767 cleanup-jobb sletter etter 90 dager)
- Claim-submit har `claim_id` som primær-nøkkel
- Socket.IO-events har `event_id` for dedup på klient

### 3.5 Strukturerte error-codes over fri-tekst

I stedet for `throw new Error("Insufficient balance")`, bruk `throw new BingoError("BIN-WAL-INSUFFICIENT", { ... })`.

**Format:** `BIN-<MODULE>-<NUMBER>` (f.eks. `BIN-RKT-001` for Spill 2 Rocket modul, error 1)

**Hvorfor:**
- Klient kan oversette til lokalisert melding
- Sentry kan gruppere på code, ikke fri-tekst
- Operasjon kan svare "fix for BIN-RKT-001 er deployet i v2026.05.04"

Se [ADR-005](./decisions/ADR-005-structured-error-codes.md). Status: under utrulling (Fase 2A).

### 3.6 Trace-ID propagering: browser → socket → engine → DB

Hver request får en `trace_id` fra browser. Den følger gjennom HTTP-headers, Socket.IO event-payloads,
backend-logs, og ned til Postgres-queries. Når noe går galt, kan vi se HELE pipeline-flyten på én ID.

**Status:** delvis implementert (MED-1). Se [ADR-010](./decisions/ADR-010-casino-grade-observability.md).

### 3.7 Backwards-kompatibilitet over breaking changes

Vi har 4 plattformer (web, iOS, Android, Windows) som potensielt har gamle versjoner i felt. Backend må:

- Ikke fjerne API-endepunkter uten 90-dagers deprecation-window
- Ikke endre socket.io event-shapes uten versjonering
- Akseptere both gamle og nye client-versjoner samtidig

Når breaking changes er nødvendige: lag ny endepunkt/event, deprecate gammel, migrer klienter, fjern.

### 3.8 Quality over speed

**Tobias-direktiv 2026-05-05:** "Ingen deadline, kvalitet over hastighet. All død kode skal fjernes."

Dette er ikke en holdning — det er en regel. Hvis du står foran valget "ship buggy nå" eller "fiks det
riktig som tar 2 dager til", velg fiksen.

### 3.9 All død kode skal fjernes

Tobias-direktiv 2026-05-05. Vi har for mange arkivfiler, deprecated routes, og "kanskje vi trenger den"-kode.
Når du ser dødt kode under refactor, fjern det. Ikke kommenter ut.

---

## 4. Ikke-mål (det vi IKKE bygger)

### 4.1 Vi bygger IKKE en white-label-platform

Spillorama er en pengespill-operatør. Vi har én konsesjon, én spill-katalog, én jurisdiction.
Vi skal ikke abstrahere "tenant" som bygger andre operatører på toppen av oss.

**Hvorfor det er en regel:** abstraherte tenant-modeller koster enormt i kompleksitet og gir null verdi
for én operatør. YAGNI.

### 4.2 Vi bygger IKKE sosiale features

Ingen friend-list, leaderboard-utenfor-spill, chat-mellom-spillere-utenfor-rom. Hvert spill har sin
egen chat (regulert), men vi er ikke en sosial plattform.

### 4.3 Vi flytter IKKE Spill 1 til perpetual-modell

Spill 1 er regulatorisk korrekt som master-styrt-per-hall (jf. pengespillforskriften §64 spilleplan,
§71 hall-rapport). Selv om perpetual-modell ville være enklere kode, ville det bryte regulatorisk modell
og kreve ny godkjennelse fra Lotteritilsynet.

Se [ADR-001](./decisions/ADR-001-perpetual-room-model-spill2-3.md) for begrunnelse.

### 4.4 Vi sertifiserer IKKE RNG eksternt

Lotteritilsynet krever ikke ekstern RNG-sertifisering for norsk databingo. Vi har in-house draw-engine
med dokumentert algoritme-beskrivelse ([`docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md`](./compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md)).

### 4.5 Vi porterer IKKE legacy Unity-spill

Tre legacy Unity-spill ligger under `legacy/unity-client/`. De vedlikeholdes ikke. Nye spill bygges
web-native i `packages/game-client/`. Unity-1:1-paritet gjelder kun **funksjonell logikk**, ikke
visuell polish (memo `project_unity_parity_rule`).

---

## 5. Når disse prinsippene kommer i konflikt

Prioritetsrekkefølge:
1. **Regulatorisk korrekthet** (pengespillforskriften)
2. **Sikkerhet** (kunde-data, finansielle transaksjoner)
3. **Pålitelighet** (uptime, ingen state-tap)
4. **Korrekthet** (ingen feil-utbetaling, korrekt audit-trail)
5. **Skalerbarhet** (36 000-skala)
6. **Vedlikeholdbarhet** (lesbar kode, lav kompleksitet)
7. **Performance** (latens, render-tid)
8. **Utvikler-ergonomi** (DX, build-tid)

Hvis to prinsipper står i veien for hverandre — det høyere vinner alltid.

---

## 6. Hva er endret nylig

| Dato | Endring | Begrunnelse |
|---|---|---|
| 2026-05-05 | Lagt til "Quality > speed" og "fjern død kode" | Tobias-direktiv |
| 2026-05-04 | Klargjort perpetual-modell ≠ Spill 1 | Sesjons-erfaring fra #942 |
| 2026-04-28 | Casino-grade-ambisjon eksplisitt | CASINO_GRADE_ARCHITECTURE_RESEARCH |
| 2026-04-25 | Spillkatalog korrigert (SpinnGo = databingo) | Tobias-korrigering |

---

**Dette dokumentet er kontrakt mellom Tobias og utviklingsteamet. Avvik må eskaleres, ikke bare implementeres.**
