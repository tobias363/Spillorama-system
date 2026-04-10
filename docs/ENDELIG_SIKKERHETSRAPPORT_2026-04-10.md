# Endelig sikkerhetsrapport: RNG, trekksikkerhet og spillintegritet i Spillorama Bingo

**Dato:** 10. april 2026
**Utarbeidet av:** Senior konsulent, endelig teknisk gjennomgang
**Grunnlag:** Konsolidering av to uavhengige konsulentrapporter + egen kodegjennomgang
**Scope:** RNG, trekning, claims, wallet-integritet, WebSocket-sikkerhet, persistering, recovery, compliance og operasjonell robusthet
**Klassifisering:** Konfidensiell - kun for intern distribusjon

---

## 1. Sammendrag

Denne rapporten er den endelige konsolideringen av to uavhengige konsulentgjennomganger og en tredje verifiseringsrunde direkte mot gjeldende kode.

### Hovedkonklusjon

**Systemet skal ikke gaa live med ekte penger i dagens form.**

De to foregaaende rapportene identifiserer korrekt de alvorligste arkitekturelle svakhetene. Denne endelige gjennomgangen bekrefter samtlige funn og legger til **9 nye vesentlige forhold** som ikke var dekket.

Totalt identifiseres **21 unike funn** fordelt slik:

| Alvorlighetsgrad | Antall | Nye i denne rapporten |
|------------------|--------|-----------------------|
| P0 - Blokkerende | 8      | 2                     |
| P1 - Maa lukkes  | 7      | 4                     |
| P2 - Viktige     | 4      | 2                     |
| P3 - Lave        | 2      | 1                     |

---

## 2. Verifiserte funn fra tidligere rapporter

Foelgende funn fra rapport 1 og 2 er verifisert som korrekte og fortsatt gjeldende:

### 2.1 RNG og shuffle (Bekreftet korrekt)

- `randomInt()` fra `node:crypto` brukes i spillkritisk logikk.
- Fisher-Yates-shuffle i `ticket.ts` er korrekt implementert.
- `makeShuffledBallBag(60)` produserer en ekte permutasjon av 1-60.

### 2.2 Klartekstlogging av trekkerekkefoelge (KRITISK-3, bekreftet)

Hele trekkesekken logges som `RNG_DRAW_BAG` ved spillstart. Enhver med loggtilgang kan se fremtidige trekk. Fortsatt ett av de mest alvorlige funnene.

### 2.3 Snapshot kan ikke gjenskape neste trekk (KRITISK-5, bekreftet)

`GameSnapshot` lagrer `drawnNumbers` og `remainingNumbers`, men ikke `drawBag` (den ordnede restsekvensen). Recovery kan ikke bli korrekt.

### 2.4 Snapshot-serialisering destruerer kryss-data (KRITISK-6, bekreftet)

`serializeGame()` flater ut `Set<number>[]` per brett til en enkelt `number[]` per spiller. Mapping per billett gaar tapt og kan ikke rekonstrueres for spillere med flere brett.

### 2.5 BINGO-claim mangler single-winner-sperre (KRITISK-4, bekreftet)

`submitClaim()` har eksplisitt guard for `LINE` via `game.lineWinnerId`, men ingen tilsvarende guard for `BINGO` foer `await walletAdapter.transfer()`. Race-vindu eksisterer.

### 2.6 Aktiv spilltilstand kun i minnet (KRITISK-2, bekreftet)

`BingoEngine` bruker intern `Map<string, RoomState>`. Redis-koden finnes men er ikke koblet inn i produksjonsbanene.

### 2.7 Normal spillslutt persisteres ikke (HOEY-6, bekreftet)

Avslutning via `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY` og `BINGO_CLAIMED` skriver ikke `GAME_END`-checkpoint. Kun manuell `endGame()` gjoer det.

### 2.8 Buy-in kan bli delvis committet (HOEY-4, bekreftet)

Wallet-debitering skjer foer `room.currentGame` etableres og foer checkpoint bekreftes. Ingen rollback ved feil etter debitering.

### 2.9 Redis-tiltak er ikke operativt innkoblet (HOEY-7, bekreftet)

`roomStateStore.loadAll()` kalles, men hydrert tilstand mates ikke inn i `BingoEngine`. `redisSchedulerLock` instansieres men brukes ikke av `DrawScheduler`.

### 2.10 Motor-default for payoutPercent (HOEY-2, bekreftet)

`payoutPercent ?? 100` i motoren er en farlig fallback, selv om runtime-defaulten normalt er 80%.

---

## 3. Nye funn i denne rapporten

### P0 - NYE BLOKKERENDE FUNN

#### KRITISK-7: WebSocket-tilkobling krever ikke autentisering

**Fil:** `backend/src/index.ts`, socket connection handler

Socket.IO-serveren utfoerer ingen autentiseringssjekk ved tilkoblingstidspunktet. Token valideres foerst naar en handling utfoeres via `requireAuthenticatedPlayerAction()`.

**Konsekvens:**
- Uautentiserte klienter kan koble seg til og lytte paa alle broadcast-meldinger
- Romoppdateringer, trekk-hendelser og claim-resultater sendes til alle i rommet via `io.to(roomCode).emit()`
- En angriper kan observere spilltilstand i sanntid uten aa identifisere seg

**Anbefaling:**
- Implementer Socket.IO middleware som validerer JWT ved tilkobling
- Avvis tilkoblinger uten gyldig token
- Krev re-autentisering ved token-fornyelse

#### KRITISK-8: Uarmerte spillere kan sende inn claims

**Fil:** `backend/src/game/BingoEngine.ts`, `submitClaim()`

`submitClaim()` validerer kryss mot billetter, men sjekker **ikke** om spilleren var armert (betalte buy-in) for gjeldende runde. En spiller som ikke deltok oekonomisk kan teoretisk vinne premiepotten.

**Konsekvens:**
- En spiller som observerer uten aa betale buy-in kan sende `claim:submit` med type `BINGO`
- Hvis spillerens display-billett tilfeldigvis matcher, godkjennes claimen
- Utbetaling skjer fra en premiepott spilleren ikke bidro til

**Anbefaling:**
- Legg til eksplisitt sjekk av armert-status i `submitClaim()` foer validering
- Avvis alle claims fra spillere som ikke er i `armedPlayerIds` for gjeldende runde

---

### P1 - NYE HOEYE FUNN

#### HOEY-8: WalletAdapter-idempotency brukes ikke

**Filer:** `backend/src/adapters/WalletAdapter.ts` (interface), `backend/src/game/BingoEngine.ts` (kall)

`WalletAdapter`-interfacet definerer `idempotencyKey` i `TransactionOptions`. `PostgresWalletAdapter` implementerer dette korrekt med duplikatsjekk. Men `BingoEngine` sender **aldri** med idempotency-noekkel paa noen wallet-operasjon.

**Konsekvens:**
- Den enkleste og mest robuste beskyttelsen mot dobbeltutbetaling ligger klar men er ikke aktivert
- Ved nettverksfeil og retry kan samme operasjon utfoeres to ganger

**Anbefaling:**
- Send `{ idempotencyKey: claim.id }` paa alle transfer-kall i `submitClaim()`
- Send `{ idempotencyKey: \`buyin-\${gameId}-\${playerId}\` }` paa buy-in-operasjoner

#### HOEY-9: Rate limiting er per socket, ikke per spiller

**Fil:** `backend/src/middleware/socketRateLimit.ts`

Rate-begrensning spores paa `socketId`, ikke paa wallet eller spiller-ID. En spiller som kobler fra og kobler til igjen faar ny `socketId` og dermed nullstilte tellere.

**Konsekvens:**
- Ondsinnet bruk kan omgaa rate limits ved aa reconnecte
- Spesielt relevant for `claim:submit` (5 per 5 sekunder) og `draw:next` (5 per 2 sekunder)

**Anbefaling:**
- Spoer rate limits paa `walletId` eller `playerId` i tillegg til `socketId`
- Behold socket-basert sporing for uautentiserte hendelser

#### HOEY-10: Checkpoint er deaktivert som standard

**Fil:** `backend/src/index.ts`, linje ~305

`BINGO_CHECKPOINT_ENABLED` har default `false`. I en standard deploy uten eksplisitt konfigurering er **all checkpointing avslaaatt**. Utbetalinger skjer uten database-backup.

**Konsekvens:**
- Standard oppfoersel er at ingen spilltilstand persisteres til database
- Alle diskusjoner om checkpoint-hull er akademiske saa lenge funksjonen er avslaaatt
- Et krasj resulterer i fullstendig tap av all aktiv spilltilstand

**Anbefaling:**
- Endre default til `true` og krev eksplisitt opt-out
- Avvis oppstart i produksjonsmodus uten checkpoint-konfigurasjon

#### HOEY-11: Redis-persistering er fire-and-forget med svelgede feil

**Fil:** `backend/src/store/RedisRoomStateStore.ts`

`set()` kaller `persistAsync().catch(() => {})`. Feil logges internt, men kallende kode faar aldri beskjed om at persistering feilet.

**Konsekvens:**
- Serveren kan svare klienten med suksess selv om Redis-skriving mislyktes
- Ved krasj kort etter er romtilstanden tapt uten at noen vet det

**Anbefaling:**
- Gjor `persist()` synkron og kast feil oppover
- Alternativt: implementer write-confirmation foer klientsvar

---

### P2 - NYE VIKTIGE FUNN

#### MEDIUM-4: Admin-trekk logfoerer feil aktoer-ID

**Fil:** `backend/src/index.ts`, admin draw-next endpoint

Naar en admin trigger trekk via API, registreres `snapshot.hostPlayerId` som aktoer - ikke admin-brukerens ID. Audit-trail viser feil person.

**Konsekvens:**
- Regulatorisk audit kan ikke fastslaa hvem som faktisk trigget et trekk
- Brudd paa krav om sporbarhet i pengespillsystemer

**Anbefaling:**
- Legg til `auditActorId` og `auditSource` i draw-operasjoner
- Logg baade teknisk aktoer og autoriserende bruker

#### MEDIUM-5: Payout audit hash-kjede er ikke implementert

**Fil:** `backend/src/game/BingoEngine.ts`

Koden definerer `lastPayoutAuditHash = "GENESIS"` og `PayoutAuditEvent`-typen, men hash-verdien oppdateres aldri. Rammen finnes, men kjeden bygges ikke.

**Konsekvens:**
- Det som ser ut som en uforanderlig auditkjede er tom
- Ingen kryptografisk binding mellom utbetalingshendelser

**Anbefaling:**
- Implementer faktisk hash-kjede med SHA-256
- Lagre kjeden til persistent storage (ikke kun in-memory)

---

### P3 - NYE LAVE FUNN

#### LAV-3: Ingen WebSocket-meldingstoerrelse

**Fil:** `backend/src/index.ts`, Socket.IO-konfigurasjon

Socket.IO er konfigurert uten `maxHttpBufferSize`. Standard er 1 MB per melding.

**Anbefaling:**
- Sett `maxHttpBufferSize: 100 * 1024` (100 KB)

---

## 4. Komplett risikovurdering

### P0 - Blokkerende foer pengespill

| ID | Funn | Kilde |
|----|------|-------|
| KRITISK-1 | Ingen sertifisert RNG-godkjenning fra akkreditert tredjepart | Rapport 1 |
| KRITISK-2 | Aktiv spilltilstand kun i prosessminnet | Rapport 1 |
| KRITISK-3 | Klartekstlogging av full trekkerekkefoelge | Rapport 1 |
| KRITISK-4 | BINGO-claim kan gi dobbeltutbetaling ved samtidige claims | Rapport 2 |
| KRITISK-5 | Snapshot kan ikke gjenskape neste trekk | Rapport 2 |
| KRITISK-6 | Serialisering destruerer kryss-data per billett | Rapport 2 |
| KRITISK-7 | WebSocket-tilkobling krever ikke autentisering | **Ny** |
| KRITISK-8 | Uarmerte spillere kan sende inn claims | **Ny** |

### P1 - Maa lukkes i samme arbeidsstream

| ID | Funn | Kilde |
|----|------|-------|
| HOEY-2 | Motor-default for payoutPercent er 100% | Rapport 1 |
| HOEY-4 | Buy-in kan bli delvis committet uten rollback | Rapport 2 |
| HOEY-6 | Sluttstatus persisteres ikke ved automatisk spillslutt | Rapport 2 |
| HOEY-7 | Redis-state og distribuert lock ikke innkoblet | Rapport 2 |
| HOEY-8 | WalletAdapter-idempotency ikke brukt | **Ny** |
| HOEY-9 | Rate limiting per socket, ikke per spiller | **Ny** |
| HOEY-10 | Checkpoint deaktivert som standard | **Ny** |
| HOEY-11 | Redis-persistering er fire-and-forget | **Ny** |

### P2 - Viktige, men sekundaere

| ID | Funn | Kilde |
|----|------|-------|
| MEDIUM-1 | Manuell draw mangler internt minimumsintervall | Rapport 1 |
| MEDIUM-3 | Ingen server-side gevinstdeteksjon | Rapport 1 |
| MEDIUM-4 | Admin-trekk logfoerer feil aktoer-ID | **Ny** |
| MEDIUM-5 | Payout audit hash-kjede ikke implementert | **Ny** |

### P3 - Lave

| ID | Funn | Kilde |
|----|------|-------|
| LAV-1 | Misvisende kommentarer i types.ts | Rapport 1 |
| LAV-3 | Ingen WebSocket-meldingstoerrelse | **Ny** |

---

## 5. Testdekning - vurdering

Relevante backend-tester passerer, men testbasen gir **falsk trygghet**:

| Kategori | Dekning | Risiko |
|----------|---------|--------|
| Draw-scheduling | 100+ tester | Lav |
| Compliance (tapsbegrensning, pauser) | 10+ tester | Lav |
| Samtidige BINGO-claims | Ingen | **Kritisk** |
| Checkpoint/recovery | Ingen | **Kritisk** |
| Wallet-feil under utbetaling | Ingen | **Kritisk** |
| Uarmert spiller sender claim | Ingen | **Kritisk** |
| WebSocket-autentisering | Ingen | Hoey |
| Produksjonsformat 3x5/60 baller | Nei (testadapter bruker forenklet oppsett) | Medium |

---

## 6. Anbefalt handlingsrekkefoelge

### Fase 0 - Umiddelbare sperrer (1-3 dager)

Disse kan og boer lukkes uavhengig av arkitekturbeslutninger:

1. **Autentisering paa WebSocket-tilkobling** - Socket.IO middleware med JWT-validering
2. **Guard for armert-status i submitClaim()** - Avvis claims fra uarmerte spillere
3. **Aktiver wallet-idempotency** - Send claim.id som idempotencyKey paa alle transfer-kall
4. **Endre checkpoint-default til true** - Krev eksplisitt opt-out i produksjon

### Fase 1 - Autorativ sannhetsmodell (1-2 uker)

Designbeslutninger som maa tas foer detaljutbedringer:

1. Hva er den autorative kilden for aktiv spilltilstand?
2. Hvordan persisteres trekkesekvensen sikkert?
3. Hvilken snapshot/replay-modell skal brukes ved krasj?
4. Hva er korrekt sluttstatusmodell for alle avslutningsbaner?

### Fase 2 - OEkonomiske og regulatoriske hull (2-3 uker)

1. Fjern klartekstlogging av drawBag (etter at sikker audit er paa plass)
2. Innfoer atomisk single-winner-beskyttelse for BINGO
3. Sikre at alle spillsluttbaner skriver endelig checkpoint
4. Gjor oppstartssekvensen atomisk eller kompensasjonsbasert
5. Implementer audit hash-kjede

### Fase 3 - Distribuert drift og robusthet (2-3 uker)

1. Integrer romtilstandslageret i BingoEngine
2. Integrer distribuert lock i DrawScheduler
3. Gjor Redis-persistering synkron med feilhaandtering
4. Implementer spiller-basert rate limiting
5. Fiks admin audit-trail

### Fase 4 - Test, dokumentasjon og sertifisering (3-4 uker)

1. Legg til concurrency-tester for samtidige claims
2. Legg til recovery-tester for krasj-scenarier
3. Legg til wallet-feiltester
4. Dokumenter trekksikkerhetsmodell
5. Send til uavhengig sertifisering

---

## 7. Komplett prioritert handlingsplan

| Prio | ID | Funn | Tiltak | Estimat |
|------|----|------|--------|---------|
| **P0** | KRITISK-1 | Ingen tredjeparts RNG-godkjenning | Engasjer akkreditert testlab | 4-8 uker |
| **P0** | KRITISK-7 | WebSocket uten autentisering | Socket.IO auth middleware | 0.5 dag |
| **P0** | KRITISK-8 | Uarmerte kan claime | Guard i submitClaim() | 0.5 dag |
| **P0** | KRITISK-3 | Klartekstlogging av drawBag | Erstatt med sikker auditmodell | 2-3 dager |
| **P0** | KRITISK-4 | BINGO-claim race | Atomisk single-winner-guard | 1-2 dager |
| **P0** | KRITISK-5 | Snapshot mangler drawBag | Utvid snapshotmodell | 2-4 dager |
| **P0** | KRITISK-6 | Serialisering destruerer kryss | Behold struktur per billett | 1-2 dager |
| **P0** | KRITISK-2 | Spilltilstand kun i minnet | Reell recovery/replay | 2-3 uker |
| **P1** | HOEY-8 | Idempotency ikke brukt | Aktiver paa alle wallet-kall | 0.5 dag |
| **P1** | HOEY-10 | Checkpoint default false | Endre default, krev opt-out | 0.5 dag |
| **P1** | HOEY-11 | Redis fire-and-forget | Synkron persist med feil | 1-2 dager |
| **P1** | HOEY-6 | Sluttstatus ikke persistert | Checkpoint for alle avslutningsbaner | 1-2 dager |
| **P1** | HOEY-4 | Delvis buy-in commit | Atomisk oppstart eller kompensasjon | 2-4 dager |
| **P1** | HOEY-9 | Rate limit per socket | Spiller-basert rate limiting | 1 dag |
| **P1** | HOEY-7 | Redis ikke innkoblet | Koble inn state store og lock | 1-2 uker |
| **P2** | HOEY-2 | payoutPercent default 100 | Fjern default, krev eksplisitt | 0.5 dag |
| **P2** | MEDIUM-1 | Ingen draw cadence-beskyttelse | Minimumsintervall i drawNextNumber | 0.5 dag |
| **P2** | MEDIUM-4 | Admin audit trail feil | Logg riktig aktoer-ID | 0.5 dag |
| **P2** | MEDIUM-5 | Audit hash-kjede tom | Implementer SHA-256-kjede | 2-3 dager |
| **P3** | LAV-1 | Misvisende kommentarer | Korriger | 5 min |
| **P3** | LAV-3 | Ingen WS-meldingsgrense | Sett maxHttpBufferSize | 5 min |

**Samlet estimat ekskludert ekstern sertifisering:** 6-10 uker

---

## 8. Kodereferanser

### Nye funn

| Funn | Fil | Detalj |
|------|-----|--------|
| KRITISK-7 | `backend/src/index.ts` | `io.on("connection")` mangler auth middleware |
| KRITISK-8 | `backend/src/game/BingoEngine.ts` | `submitClaim()` mangler armed-sjekk |
| HOEY-8 | `backend/src/game/BingoEngine.ts` | Alle `walletAdapter.transfer()`-kall mangler idempotencyKey |
| HOEY-9 | `backend/src/middleware/socketRateLimit.ts` | Noekkel er `socketId:eventName` |
| HOEY-10 | `backend/src/index.ts` | `parseBooleanEnv(BINGO_CHECKPOINT_ENABLED, false)` |
| HOEY-11 | `backend/src/store/RedisRoomStateStore.ts` | `persistAsync().catch(() => {})` |
| MEDIUM-4 | `backend/src/index.ts` | Admin draw bruker `snapshot.hostPlayerId` |
| MEDIUM-5 | `backend/src/game/BingoEngine.ts` | `lastPayoutAuditHash = "GENESIS"` aldri oppdatert |
| LAV-3 | `backend/src/index.ts` | Socket.IO uten `maxHttpBufferSize` |

---

## 9. Konklusjon

Spillorama Bingo har et **forsvarlig kryptografisk fundament** (node:crypto RNG, korrekt Fisher-Yates) og **gjennomtenkt wallet-arkitektur** (ACID-transaksjoner, idempotency-stoette). Men det er et betydelig gap mellom det som er designet og det som er operativt koblet inn.

De 8 P0-funnene representerer til sammen en risiko der:
- Penger kan utbetales feil (dobbeltutbetaling, uarmert vinner)
- Spilltilstand kan gaa tapt uten mulighet for gjenoppretting
- Trekkerekkefoelgen kan observeres paa forhaand
- Uautentiserte parter kan observere spilltilstand

**Anbefaling:** Stopp all utvikling av nye funksjoner. Alloker hele teamet til utbedring av P0- og P1-funn i den rekkefølgen som er beskrevet i kapittel 6. Foerst naar disse er lukket og verifisert, bor systemet sendes til uavhengig sertifisering.

---

**Slutt paa endelig rapport.**
