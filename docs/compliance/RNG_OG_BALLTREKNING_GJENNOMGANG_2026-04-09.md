# Konsulentrapport: RNG, Balltrekning og RTP i Spillorama Bingo

**Dato:** 9. april 2026
**Oppdragsgiver:** Prosjektleder, Spillorama
**Utarbeidet av:** Senior ledende teknisk konsulent
**Scope:** Random Number Generation (RNG), balltrekning, billettgenerering, RTP-mekanikk og operasjonell beredskap
**Klassifisering:** Konfidensiell — kun for intern distribusjon

---

## Innholdsfortegnelse

1. [Sammendrag for ledelsen](#1-sammendrag-for-ledelsen)
2. [Systemarkitektur relevant for RNG og trekning](#2-systemarkitektur-relevant-for-rng-og-trekning)
3. [Slik fungerer balltrekningen i detalj](#3-slik-fungerer-balltrekningen-i-detalj)
4. [Slik fungerer billettgenerering](#4-slik-fungerer-billettgenerering)
5. [Slik fungerer RTP og utbetalingsmekanikk](#5-slik-fungerer-rtp-og-utbetalingsmekanikk)
6. [Slik fungerer automatisk trekning (DrawScheduler)](#6-slik-fungerer-automatisk-trekning-drawscheduler)
7. [Funn og risikovurdering](#7-funn-og-risikovurdering)
8. [Prioritert handlingsplan](#8-prioritert-handlingsplan)
9. [Vedlegg: Relevante filer og kodereferanser](#9-vedlegg-relevante-filer-og-kodereferanser)

---

## 1. Sammendrag for ledelsen

Spillorama-bingosystemet bruker en kryptografisk sikker tilfeldighetskilde (`node:crypto`) for både balltrekning og billettgenerering. Den underliggende algoritmen (Fisher-Yates shuffle) er korrekt implementert. Dette er et godt utgangspunkt.

Imidlertid er det **fem kritiske mangler** som må adresseres før systemet kan gå live med ekte penger:

1. **Ingen uavhengig RNG-sertifisering** — koden er ikke testet eller godkjent av et akkreditert laboratorium.
2. **All aktiv spilltilstand lever i prosessminnet** — en serverrestart mister pågående spill.
3. **Hele den forhåndsbestemte trekkerekkefølgen logges i klartekst** — innsiderisiko.
4. **Ingen mekanisme for å gjenopprette et spill etter krasj** — checkpoints dekker ikke mellom-trekk-tilstand.
5. **payoutPercent har default 100%** — systemet gir bort hele potten hvis admin glemmer konfigurasjonen.

**Min anbefaling:** Systemet kan ikke gå live med pengespill i nåværende tilstand. De tre første punktene er regulatoriske showstoppere. De to siste er operasjonelle risiko som vil koste penger.

---

## 2. Systemarkitektur relevant for RNG og trekning

### Overordnet flyt

```
┌──────────────────────────────────────────────────────────────────┐
│  SPILLSTART (game:start / auto-start via DrawScheduler)          │
│                                                                  │
│  1. BingoEngine.startGame() kalles                               │
│  2. makeShuffledBallBag(60) → forhånds-shufflet array [1..60]    │
│  3. generateTraditional75Ticket() → 3×5 grid per spiller         │
│  4. drawBag lagres i GameState (i minnet)                        │
│  5. Hele drawBag logges i RNG_DRAW_BAG audit-event               │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  TREKNING (draw:next / auto-draw via DrawScheduler)              │
│                                                                  │
│  1. drawNextNumber() kalles                                      │
│  2. game.drawBag.shift() → popper neste forhåndsbestemt tall     │
│  3. Tallet legges til game.drawnNumbers                          │
│  4. Socket.IO broadcast: draw:new til alle i rommet              │
│  5. Sjekk: maxDrawsPerRound nådd? → avslutt runde              │
│  6. Sjekk: drawBag tom? → avslutt runde                        │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  GEVINST (claim:submit)                                          │
│                                                                  │
│  1. Spiller sender LINE eller BINGO claim                        │
│  2. Server validerer mot spillerens brett og markeringer          │
│  3. Utbetaling beregnes: cap av prizePool, payoutBudget,         │
│     singlePrizeCap og remainingPayoutBudget                     │
│  4. Wallet-overføring utføres                                    │
│  5. Compliance-ledger og payout-audit oppdateres                 │
│  6. Checkpoint skrives til PostgreSQL                             │
└──────────────────────────────────────────────────────────────────┘
```

### Nøkkelkomponenter

| Komponent | Fil | Ansvar |
|-----------|-----|--------|
| BingoEngine | `backend/src/game/BingoEngine.ts` | All forretningslogikk: spillstart, trekning, gevinst, compliance |
| ticket.ts | `backend/src/game/ticket.ts` | Fisher-Yates shuffle, billettgenerering, mønstersjekk |
| DrawScheduler | `backend/src/draw-engine/DrawScheduler.ts` | Automatisk runde-start og auto-trekning med timing |
| DrawWatchdog | `backend/src/draw-engine/DrawWatchdog.ts` | Overvåker "stuck" rom og frigjør hengende låser |
| DrawSchedulerLock | `backend/src/draw-engine/DrawSchedulerLock.ts` | Per-rom mutex med timeout |
| PostgresBingoSystemAdapter | `backend/src/adapters/PostgresBingoSystemAdapter.ts` | Checkpoint-persistering til PostgreSQL |
| SocketRateLimiter | `backend/src/middleware/socketRateLimit.ts` | Rate-begrensning per socket per hendelse |

---

## 3. Slik fungerer balltrekningen i detalj

### 3.1 Tilfeldighetskilde

Systemet bruker `randomInt()` fra Node.js sitt `node:crypto`-modul. Denne funksjonen er bygget på operativsystemets CSPRNG (Cryptographically Secure Pseudo-Random Number Generator):
- **Linux/macOS:** `getrandom()` / `/dev/urandom`
- **Windows:** `BCryptGenRandom()`

Dette er **korrekt valg** for pengespill. `Math.random()` brukes ikke noe sted i spillogikken (kun i ikke-spillkritisk kode som instans-ID-generering).

### 3.2 Shuffling-algoritme: Fisher-Yates

```typescript
// backend/src/game/ticket.ts, linje 7-14
function shuffle<T>(values: T[]): T[] {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);   // kryptografisk sikker
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

**Vurdering:** Fisher-Yates (Knuth shuffle) er den anerkjente standarden for uniform permutasjon. Implementasjonen er korrekt:
- Itererer bakover fra siste element
- Velger tilfeldig posisjon fra `[0, i]` (inklusiv)
- Bruker CSPRNG for hvert byttevalg
- Produserer uniform fordeling over alle `n!` permutasjoner

### 3.3 Generering av trekkesekken

```typescript
// backend/src/game/ticket.ts, linje 31-33
export function makeShuffledBallBag(maxNumber = 60): number[] {
  return shuffle(Array.from({ length: maxNumber }, (_, i) => i + 1));
}
```

Ved spillstart genereres et array `[1, 2, 3, ..., 60]` som deretter stokkes med Fisher-Yates. Resultatet er en komplett, forhåndsbestemt rekkefølge for alle 60 baller.

### 3.4 Selve trekningen

```typescript
// backend/src/game/BingoEngine.ts, linje 678
const nextNumber = game.drawBag.shift();
```

`drawNextNumber()` gjør bare en `shift()` — den popper første element fra den forhånds-stokka køen. Det er ingen tilleggstilfeldighet per trekk. Ball #1 til #60 er bestemt i det øyeblikket spillet starter.

### 3.5 Begrensninger og stoppregler

| Regel | Verdi | Kilde |
|-------|-------|-------|
| Maks baller i spillet | 60 | `MAX_BINGO_BALLS = 60` |
| Maks trekk per runde | 30 (konfigurerbart) | `maxDrawsPerRound` |
| Minimum mellom runder | 30 sekunder | `minRoundIntervalMs` |

Runden avsluttes automatisk ved:
- `BINGO_CLAIMED` — en spiller har full bingo
- `MAX_DRAWS_REACHED` — maxDrawsPerRound nådd
- `DRAW_BAG_EMPTY` — alle baller trukket
- `MANUAL_END` — operatør avslutter manuelt

---

## 4. Slik fungerer billettgenerering

### 4.1 Billettformat

Hver billett er et **3×5 grid** med 15 tall (ingen tomme celler, ingen "free space"):

```
Kolonne 1: 3 tilfeldige tall fra [1–12]
Kolonne 2: 3 tilfeldige tall fra [13–24]
Kolonne 3: 3 tilfeldige tall fra [25–36]
Kolonne 4: 3 tilfeldige tall fra [37–48]
Kolonne 5: 3 tilfeldige tall fra [49–60]
```

Tallene i hver kolonne er sortert stigende.

### 4.2 Genereringsprosess

```typescript
// backend/src/game/ticket.ts, linje 35-56
export function generateTraditional75Ticket(): Ticket {
  const columns = [
    pickUniqueInRange(1, 12, 3),   // 3 av 12 mulige
    pickUniqueInRange(13, 24, 3),
    pickUniqueInRange(25, 36, 3),
    pickUniqueInRange(37, 48, 3),
    pickUniqueInRange(49, 60, 3)
  ];
  // ... bygg 3×5 grid fra kolonnene
}
```

`pickUniqueInRange()` bruker også `shuffle()` (med `crypto.randomInt()`) for å velge tilfeldige tall innenfor hver kolonne-range.

### 4.3 Billetter per spiller

Konfigurerbart 1–5 billetter per spiller per runde (begrenset av hall-konfigurasjon).

---

## 5. Slik fungerer RTP og utbetalingsmekanikk

### 5.1 Begrepet "RTP" i dette systemet

Spillorama bruker **ikke** en klassisk slot-RTP med vektet symbolfordeling og forhåndsbestemt tilbakebetalingsprosent over tid. I stedet opererer systemet med et **budsjett-cap-system per runde**:

```
PrizePool     = entryFee × antall betalende spillere
PayoutBudget  = PrizePool × (payoutPercent / 100)
```

`payoutPercent` er konfigurerbart per hall via admin-panelet (0–100%). Ved 80% payoutPercent og 10 spillere a 50 NOK:

```
PrizePool     = 50 × 10 = 500 NOK
PayoutBudget  = 500 × 0.80 = 400 NOK
Hus-margin    = 500 − 400 = 100 NOK (20%)
```

### 5.2 Gevinstfordeling

| Gevinst | Beregning | Capped av |
|---------|-----------|-----------|
| **LINE** (første komplette rad/kolonne) | 30% av PrizePool | remainingPayoutBudget, singlePrizeCap |
| **BINGO** (alle tall markert) | Resten av remainingPrizePool | remainingPayoutBudget, singlePrizeCap |

Rekkefølgen er: LINE-gevinst først, deretter trekkes det beløpet fra budsjett og pool, og BINGO-vinneren får resten.

### 5.3 Prize Policy (gevinst-cap)

I tillegg til RTP-budsjettet finnes et **PrizePolicy-system** som setter absolutte grenser:

| Parameter | Default |
|-----------|---------|
| `singlePrizeCap` | 2 500 NOK per enkeltgevinst |
| `dailyExtraPrizeCap` | 12 000 NOK per dag for ekstrapremier |

Disse er konfigurerbare per hall og spilltype, med versjonert historikk.

### 5.4 RTP-tracking i claims

Hver claim (gevinstkrav) får registrert:
- `rtpBudgetBefore` — budsjett før utbetaling
- `rtpBudgetAfter` — budsjett etter utbetaling
- `rtpCapped` — om utbetalingen ble begrenset av budsjettet
- `payoutWasCapped` — om utbetalingen ble begrenset av noen cap
- `payoutPolicyVersion` — hvilken policy-versjon som gjaldt

### 5.5 Payout Audit Trail

Utbetalinger registreres i en **hash-kjede** (append-only audit trail). Hvert event peker til forrige via `previousHash`, noe som gjør manipulasjon detekterbar:

```typescript
// BingoEngine.ts: appendPayoutAuditEvent()
chainIndex: this.payoutAuditTrail.length,
previousHash: this.lastPayoutAuditHash,
eventHash: createHash("sha256").update(JSON.stringify({...})).digest("hex")
```

---

## 6. Slik fungerer automatisk trekning (DrawScheduler)

### 6.1 Tick-loop

DrawScheduler kjører en `setInterval` hvert **250ms** (konfigurerbart). Hvert tick:

1. Henter alle aktive rom-oppsummeringer
2. Anvender ventende innstillingsendringer
3. For hvert rom: sjekk auto-start og auto-draw

### 6.2 Auto-start av runder

Når `autoRoundStartEnabled = true`:
- Sjekk om nok spillere er i rommet (`autoRoundMinPlayers`)
- Sjekk om nok tid har gått siden forrige runde (`autoRoundStartIntervalMs`)
- Acquire per-rom lock
- Kall `onAutoStart` callback som kjører `engine.startGame()` + trekker første ball
- Sett anchor for drift-fri timing

### 6.3 Auto-draw av baller

Når `autoDrawEnabled = true` og runde pågår:
- **Anchor-basert timing**: Neste trekk due = `anchor + (count + 1) × intervalMs`
- Ingen drift over tid (i motsetning til ren `setInterval`)
- Håndterer "missed intervals" (f.eks. lang GC-pause) ved re-anchoring i stedet for burst
- Acquire per-rom lock før trekning
- Kall `onAutoDraw` callback som kjører `engine.drawNextNumber()` + broadcast

### 6.4 Watchdog

DrawWatchdog kjører separat (hvert 5 sekund) og sjekker:
- Om et RUNNING-rom ikke har hatt trekning innen `3 × drawInterval`
- Frigjør hengende låser
- Eskalerer etter 3 påfølgende stuck-deteksjoner

### 6.5 Lock-mekanisme

Per-rom mutex med 5-sekunders timeout:
- Forhindrer dobbeltrekning (to scheduler-ticks prøver å trekke samtidig)
- Force-release ved timeout (logges som warning)
- In-process only — **fungerer ikke med flere Node-instanser**

---

## 7. Funn og risikovurdering

### KRITISK-1: Ingen RNG-sertifisering eller tredjepartsgodkjenning

**Beskrivelse:** Det finnes ingen referanser i kodebasen til GLI (Gaming Laboratories International), eCOGRA, iTech Labs, BMM Testlabs, NMI (Norsk Marinteknisk Institutt for spillteknologi), eller noen annen akkreditert testlab.

**Hva mangler:**
- Statistisk testing av RNG-output (NIST SP 800-22, Diehard, TestU01)
- Formell verifisering av Fisher-Yates-implementasjonen av uavhengig part
- Dokumentert seed-/entropy-håndtering
- Sertifiseringsrapport som bekrefter at output er uniform og uforutsigbar
- Formalisert mapping mellom RNG og spillutfall

**Risiko:** Norsk regulering for databingo krever at spillsystemet er godkjent. Uten sertifisering kan man ikke dokumentere overfor Lotteritilsynet at trekningen er rettferdig.

**Anbefaling:** Engasjer et akkreditert testlaboratorium for å gjennomføre RNG-testing og sertifisering før live-drift.

---

### KRITISK-2: All aktiv spilltilstand lever i prosessminnet

**Beskrivelse:** `BingoEngine` lagrer alle rom, spillere, aktive spill, trekkesekker, markeringer og gevinstkrav i `Map`-objekter i Node.js-prosessens heap-minne.

**Implikasjon:** En serverrestart (deploy, krasj, OOM-kill, Render dyno-cycling) betyr:
- Alle aktive spill forsvinner umiddelbart
- Spillere som har betalt innskudd mister penger
- Trekkerekkefølge og spilltilstand kan ikke gjenskapes

**Eksisterende mitigering:** `PostgresBingoSystemAdapter` skriver checkpoints til PostgreSQL ved:
- Spillstart (`BUY_IN`)
- Utbetaling (`PAYOUT`)
- Spillslutt (`GAME_END`)

**Hva som mangler:** Checkpoints skrives **ikke** etter hver trekning. En krasj mellom trekk #15 og trekk #16 betyr at snapshotet i databasen viser tilstand ved spillstart eller siste utbetaling — ikke nåværende trekkstatus. Det finnes heller ingen replay-mekanisme som gjenskaper et rom fra checkpoints. `findIncompleteGames()` eksisterer men brukes bare til å markere dem som ENDED, ikke til å gjenopprette dem.

**Risiko:** Tapt innskudd uten mulighet for kompensasjon. Regulatorisk brudd hvis spill med penger ikke kan gjenopprettes.

**Anbefaling:**
1. Skriv checkpoint etter **hver trekning**, ikke bare ved utbetaling
2. Implementer faktisk replay/recovery som gjenskaper rommet fra siste checkpoint
3. Vurder å flytte all romtilstand til Redis eller PostgreSQL (BIN-170 er startet men ikke fullført)
4. Single-instance lock (DrawSchedulerLock) skalerer ikke — krever distribuert lås for HA

---

### KRITISK-3: Forhåndsbestemt trekkerekkefølge logges i klartekst

**Beskrivelse:** Ved spillstart logges hele drawBag (alle 60 tall i trekkerekkefølge) som strukturert JSON:

```typescript
// BingoEngine.ts, linje 624-633
logger.info({
  event: "RNG_DRAW_BAG",
  drawBag: game.drawBag,   // [42, 17, 3, 55, 8, ...]  alle 60 tall
  ballCount: game.drawBag.length,
  ...
}, "RNG draw bag generated");
```

**Implikasjon:** Enhver person med tilgang til serverlogger (Render dashboard, log-aggregator, eller lokal terminal) kan se hvilke tall som kommer **før de er trukket**. I et flerspillerspill med innsats er dette en direkte innsiderisiko.

**Risiko:** Operatører, utviklere eller driftspersonell kan utnytte denne kunnskapen for å vinne.

**Anbefaling:**
- Logg kun en SHA-256 hash av drawBag (for etterprøvbarhet)
- Gjør den fulle sekvensen kun tilgjengelig via et dedikert, tilgangskontrollert og tidsforseglet audit-endepunkt som først åpnes etter at runden er avsluttet
- Vurder commitment scheme: publiser hash av neste tall før trekning, avslør etterpå

---

### HØY-1: Ingen entropy-injeksjon mellom trekk

**Beskrivelse:** Hele trekksekvensen er fastlåst ved spillstart. Det er ingen mekanisme for:
- Periodevis re-seeding av RNG
- Tilleggstilfeldighet per trekk
- Verifiserbar "commitment scheme"

**Implikasjon:** Matematisk er dette ekvivalent med en treknemaskin — hele utfallsrommet er bestemt i en enkelt operasjon. Men det skiller seg fra fysiske bingomaskiner der hvert tall trekkes uavhengig.

**Risiko:** Reguleringsmyndigheter kan kreve at hvert trekk er en uavhengig stokastisk hendelse, ikke en forhåndsbestemt sekvens. Dette er jurisdiksjonsavhengig og må avklares med Lotteritilsynet.

**Anbefaling:** Avklar med reguleringsmyndigheten om pre-shuffled bag er akseptabelt. Hvis ikke: implementer per-trekk tilfeldig valg fra gjenværende baller.

---

### HØY-2: payoutPercent default er 100%

**Beskrivelse:**

```typescript
// BingoEngine.ts, linje 517
const payoutPercent = input.payoutPercent ?? 100;
```

Hvis operatøren glemmer å sette payoutPercent ved spillstart (eller admin-konfigurasjonen mangler), betaler systemet ut **100% av potten**. Huset tjener ingenting.

**Risiko:** Direkte inntektstap. I automatisert drift (DrawScheduler) er det spesielt farlig fordi runder starter uten manuell kontroll.

**Anbefaling:** Fjern default. Krev eksplisitt konfigurasjon. Feil med tydelig melding hvis payoutPercent mangler.

---

### HØY-3: Checkpoint-hull mellom trekk og utbetaling

**Beskrivelse:** `onCheckpoint()` kalles bare ved tre hendelser: `BUY_IN`, `PAYOUT` og `GAME_END`. Mellom disse hendelsene — altså under selve trekningen — lagres ingenting til disk.

```typescript
// PostgresBingoSystemAdapter.ts, linje 50-51
async onNumberDrawn(_input: NumberDrawnInput): Promise<void> {
  // Individual draws tracked in-memory; snapshot captures all drawn numbers
}
```

Kommentaren bekrefter eksplisitt at trekk bare spores i minnet.

**Risiko:** Et spill med 30 trekk der krasj skjer ved trekk #28 — spillere har kanskje alt markert LINE — vil miste all tilstand. Innskuddet er allerede trukket fra wallet men spillet kan ikke fullføres.

**Anbefaling:** Implementer trekk-for-trekk persistering, minimum som batch per N trekk.

---

### MEDIUM-1: Ingen rate-begrensning på manuell trekning (socket)

**Beskrivelse:** Socket-hendelsen `draw:next` har rate limit `windowMs: 2000, maxEvents: 5`, men dette gjelder per socket-tilkobling. BingoEngine sin `drawNextNumber()` har ingen intern tidskontroll mellom trekk.

Via admin REST-endepunktet `/api/admin/rooms:roomCode/draw-next` er det ingen rate limit i det hele tatt — bare rollesjekkk.

**Risiko:** En admin eller host kan fyre av mange trekk i rask rekkefølge, noe som kan skape UX-problemer og potensielt race conditions i auto-mark-logikken på klientsiden.

**Anbefaling:** Legg til minimum-intervall mellom trekk i `drawNextNumber()` selv (f.eks. 500ms), uavhengig av kilde.

---

### MEDIUM-2: Billetter genereres uavhengig av hverandre

**Beskrivelse:** `generateTraditional75Ticket()` genererer hver billett isolert. Det er ingen kryss-validering mot andre billetter i samme runde.

**Implikasjon:**
- To spillere kan i teorien få identiske billetter (sannsynligheten er ekstremt lav men ikke null: ca. 1 av 2.6 × 10^12 per billettpar med 60-balls-formatet)
- Det er ingen garanti for balansert fordeling av tall på tvers av spillere
- Ingen "collision detection" eller duplikat-sjekk

**Risiko:** Svært lav reell risiko, men i et regulert system bør det dokumenteres og eventuelt håndteres med duplikat-deteksjon.

**Anbefaling:** Legg til duplikat-sjekk ved billettgenerering. Dokumenter sannsynlighetsberegningen formelt.

---

### MEDIUM-3: Ingen server-side automatisk markering

**Beskrivelse:** Spillere må aktivt kalle `ticket:mark` for hvert trukket tall. Serveren automarkerer ikke.

```typescript
// BingoEngine.ts, linje 712-713
if (!game.drawnNumbers.includes(input.number)) {
  throw new DomainError("NUMBER_NOT_DRAWN", "Tallet er ikke trukket ennå.");
}
```

Serveren validerer at tallet *er* trukket, men markerer det ikke automatisk.

**Risiko:** Hvis klienten (Unity/nettleser) ikke sender mark-meldinger (nettverksfeil, krasj, treghet), mister spilleren gevinsten selv om brettet kvalifiserer. I et automatisert bingosystem bør serveren vite hvilke brett som har gevinst uavhengig av klient-input.

**Anbefaling:** Implementer server-side auto-markering etter hver trekning, eller i det minste server-side gevinstvalidering som sjekker alle brett etter hvert trekk.

---

### MEDIUM-4: Single-instance lock skalerer ikke

**Beskrivelse:** `DrawSchedulerLock` er en in-process `Map<string, ...>`. Kommentaren i koden sier eksplisitt:

```
// In-process only (single Node instance). For multi-instance, swap the
// backing store for a Redis/Postgres advisory lock.
```

**Risiko:** Systemet kan ikke kjøre med flere Node-instanser uten risiko for dobbeltrekning. Render har auto-scaling som kan spinne opp flere instanser under last.

**Anbefaling:** Implementer Redis- eller PostgreSQL-basert distribuert lås (BIN-170 er startet). Konfigurer Render til maks 1 instans inntil dette er løst.

---

### LAV-1: Feil dokumentasjon i types.ts

```typescript
export interface Ticket {
  // 5x5 board, where 0 indicates the free center square.
  grid: number[][];
}
```

Griddet er **3×5** uten free space. Kommentaren er misvisende og kan forvirre nye utviklere.

---

### LAV-2: Funksjonsnavn "generateTraditional75Ticket" er misvisende

Funksjonen genererer 60-balls bingo-billetter (3×5, tall 1–60), men heter "traditional75" som refererer til 75-balls amerikansk bingo (5×5, tall 1–75). Navngivningen stemmer ikke med implementasjonen.

---

## 8. Prioritert handlingsplan

| Prio | ID | Funn | Tiltak | Estimat |
|------|-----|------|--------|---------|
| **P0 — Blokkerende** | KRITISK-1 | Ingen RNG-sertifisering | Engasjer akkreditert testlab for RNG-evaluering | 4–8 uker (ekstern) |
| **P0 — Blokkerende** | KRITISK-2 | Spilltilstand i minne | Implementer per-trekk persistering og replay-mekanisme | 2–3 uker |
| **P0 — Blokkerende** | KRITISK-3 | DrawBag i klartekst-logger | Krypter/hash logg-output, tidsforseglet audit-endepunkt | 2–3 dager |
| **P1 — Kritisk** | HØY-1 | Ingen per-trekk entropy | Avklar med Lotteritilsynet; eventuelt implementer per-trekk valg | 1 uke (avklaring) |
| **P1 — Kritisk** | HØY-2 | payoutPercent default 100% | Fjern default, krev eksplisitt konfigurasjon | 0.5 dag |
| **P1 — Kritisk** | HØY-3 | Checkpoint-hull | Utvid onNumberDrawn til å skrive checkpoint per N trekk | 2–3 dager |
| **P2 — Viktig** | MEDIUM-1 | Ingen rate-limit manuell draw | Legg til minimum-intervall i drawNextNumber() | 0.5 dag |
| **P2 — Viktig** | MEDIUM-2 | Uavhengig billettgenerering | Duplikat-deteksjon ved generering | 1 dag |
| **P2 — Viktig** | MEDIUM-3 | Ingen server-side auto-mark | Server-side gevinstsjekk etter hver trekning | 2–3 dager |
| **P2 — Viktig** | MEDIUM-4 | Single-instance lock | Implementer Redis-basert distribuert lås | 1 uke |
| **P3 — Lav** | LAV-1 | Feil kommentar i types.ts | Korriger kommentar | 5 min |
| **P3 — Lav** | LAV-2 | Misvisende funksjonsnavn | Rename til generateDatabingo60Ticket | 0.5 dag |

### Kritisk sti for go-live

```
Uke 1-2:  HØY-2 (payoutPercent) + KRITISK-3 (logg-beskyttelse)
          + HØY-3 (checkpoint-hull) + start KRITISK-2 (persistering)
Uke 2-4:  Fullfør KRITISK-2 + MEDIUM-4 (distribuert lås)
          + MEDIUM-1 (rate-limit) + HØY-1 (regulatorisk avklaring)
Uke 4-8:  KRITISK-1 (RNG-sertifisering, ekstern prosess)
          + MEDIUM-2 + MEDIUM-3 (parallelt)
```

---

## 9. Vedlegg: Relevante filer og kodereferanser

### Kjerne-RNG og trekning
| Fil | Linjer | Innhold |
|-----|--------|---------|
| `backend/src/game/ticket.ts` | 1–108 | `shuffle()`, `makeShuffledBallBag()`, `generateTraditional75Ticket()`, mønstersjekk |
| `backend/src/game/BingoEngine.ts` | 613 | `drawBag: makeShuffledBallBag(MAX_BINGO_BALLS)` — der sekken genereres |
| `backend/src/game/BingoEngine.ts` | 663–704 | `drawNextNumber()` — der neste ball trekkes |
| `backend/src/game/BingoEngine.ts` | 624–633 | `RNG_DRAW_BAG` audit-logg |
| `backend/src/game/BingoEngine.ts` | 736–1013 | `submitClaim()` — gevinstvalidering og utbetaling |

### RTP og utbetaling
| Fil | Linjer | Innhold |
|-----|--------|---------|
| `backend/src/game/BingoEngine.ts` | 601–602 | PrizePool og PayoutBudget beregning |
| `backend/src/game/BingoEngine.ts` | 819–908 | LINE-gevinst med RTP-cap |
| `backend/src/game/BingoEngine.ts` | 910–999 | BINGO-gevinst med RTP-cap |
| `backend/src/game/BingoEngine.ts` | 1317+ | `upsertPrizePolicy()` — gevinst-cap-system |
| `backend/src/game/types.ts` | 30–32 | `rtpBudgetBefore`, `rtpBudgetAfter`, `rtpCapped` i ClaimRecord |

### Automasjon og overvåking
| Fil | Linjer | Innhold |
|-----|--------|---------|
| `backend/src/draw-engine/DrawScheduler.ts` | 1–609 | Komplett auto-start/auto-draw scheduler |
| `backend/src/draw-engine/DrawWatchdog.ts` | 1–172 | Stuck-room deteksjon |
| `backend/src/draw-engine/DrawSchedulerLock.ts` | 1–135 | Per-rom mutex |
| `backend/src/draw-engine/DrawErrorClassifier.ts` | — | Feilklassifisering for scheduler |

### Persistering og crash recovery
| Fil | Linjer | Innhold |
|-----|--------|---------|
| `backend/src/adapters/PostgresBingoSystemAdapter.ts` | 1–297 | Checkpoint-system, schema, recovery |
| `backend/src/store/RoomStateStore.ts` | 1–100+ | Serialisering av romtilstand (BIN-170, påbegynt) |

### Rate-limiting
| Fil | Linjer | Innhold |
|-----|--------|---------|
| `backend/src/middleware/socketRateLimit.ts` | 16–29 | Default rate limits per socket-hendelse |

---

**Slutt på rapport.**

*Denne rapporten er basert på fullstendig gjennomgang av kildekoden i Spillorama-system-repoet per 9. april 2026. Alle kodereferanser er verifisert mot gjeldende kode på branch `codex/expand-candy-integration-tasks`.*
