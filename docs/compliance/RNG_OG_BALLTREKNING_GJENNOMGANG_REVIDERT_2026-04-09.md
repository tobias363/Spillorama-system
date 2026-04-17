# Revidert konsulentrapport: RNG, balltrekning og trekksikkerhet i Spillorama Bingo

**Dato:** 9. april 2026  
**Utarbeidet av:** Konsulent nr. 2, teknisk kontrollgjennomgang  
**Grunnlag:** Verifikasjon av rapporten `RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` mot gjeldende kode i repoet  
**Scope:** RNG, trekning, billettgenerering, checkpointing, recovery, utbetaling, locking og operasjonell robusthet  
**Klassifisering:** Konfidensiell - kun for intern distribusjon

---

## 1. Formaal og konklusjon

Denne rapporten er en **revisjon og kvalitetssikring** av den opprinnelige gjennomgangen. Første rapport er i hovedsak riktig paa kjernepunktene:

- RNG-kilden er kryptografisk forsvarlig (`node:crypto`).
- Fisher-Yates-shufflingen er korrekt implementert.
- Klartekstlogging av hele `drawBag` er en reell innsiderisiko.
- Aktiv spilltilstand er ikke robust nok for pengespill.
- Recovery-loesningen er ikke produksjonsklar.

Likevel er den opprinnelige rapporten **ikke komplett nok til aa brukes som eneste sannhetsgrunnlag for utbedringsarbeid**. Ved kontrollgjennomgang fant jeg fire vesentlige forhold som maa legges til eller korrigeres:

1. **BINGO-claim mangler eksplisitt single-winner-sperre og er utsatt for dobbeltutbetaling ved samtidige claims.**
2. **Checkpointformatet kan ikke gjenskape neste trekk, fordi snapshotet ikke lagrer `drawBag`.**
3. **Normal avslutning av runder persisterer ikke en fullstendig endelig sluttilstand.**
4. **Redis-basert rompersistens og distribuert scheduler-lock finnes i repoet, men er ikke koblet inn i de aktive produksjonsbanene.**

Min oppdaterte anbefaling er derfor uendret paa hovednivaa: **systemet boer ikke gaa live med ekte penger i dagens form**. Men prioriteringsrekkefoelgen for utbedring boer justeres sammenlignet med foerste rapport.

---

## 2. Hva i foerste rapport er verifisert som korrekt

### 2.1 RNG og shuffle

Foerste rapport beskriver korrekt at:

- `randomInt()` fra `node:crypto` brukes i spillkritisk tilfeldig logikk.
- `shuffle()` i `backend/src/game/ticket.ts` er en korrekt Fisher-Yates-implementasjon.
- `makeShuffledBallBag(60)` lager en full permutasjon av tallene 1-60.
- `drawNextNumber()` trekker tall ved aa konsumere den forhåndsstokkede sekken.

Dette er teknisk riktig beskrivelse av hvordan trekningen fungerer i dag.

### 2.2 Klartekstlogging av trekkerekkefolge

Foerste rapport identifiserer korrekt at hele trekkesekken logges ved spillstart som `RNG_DRAW_BAG`. Dette er fortsatt ett av de alvorligste funnene, fordi enhver med loggtilgang kan se fremtidige trekk.

### 2.3 In-memory spilltilstand og mangelfull recovery

Foerste rapport identifiserer korrekt at den operative spilltilstanden lever i prosessminnet i `BingoEngine`, og at PostgreSQL-checkpointing ikke gir fungerende recovery i dagens implementasjon.

Dette funnet er korrekt, men ved kontrollgjennomgang viser det seg aa være **enda mer alvorlig enn opprinnelig formulert**, jf. kapittel 4.

---

## 3. Korrigeringer til foerste rapport

### 3.1 Korrigering A: `payoutPercent ?? 100` er en reell fotgun, men ikke den mest presserende live-path-risikoen

Foerste rapport peker korrekt paa at motoren har denne defaulten:

- `backend/src/game/BingoEngine.ts`: `const payoutPercent = input.payoutPercent ?? 100;`

Det som mangler i foerste rapport er at de aktive startstiene i serveren normalt sender inn `runtimeBingoSettings.payoutPercent`, og denne runtime-defaulten settes fra serverkonfigurasjonen, ikke fra motor-defaulten. I gjeldende kode er runtime-defaulten 80%.

**Revidert vurdering:**

- Dette er fortsatt en farlig API-default i motoren.
- Men den er mindre kritisk i dagens hovedflyt enn foerste rapport antyder.
- Den boer fortsatt fjernes, fordi enhver ny kallesti som glemmer aa sende inn feltet vil falle tilbake til 100%.

**Oppdatert alvorlighetsgrad:** Høy, men ikke blant de tre mest kritiske funnene.

### 3.2 Korrigering B: Redis-arbeidet er ikke en aktiv mitigering slik repoet staar naa

Foerste rapport nevner at BIN-170 er paabegynt. Det stemmer, men kontrollgjennomgangen viser at dette lett kan misforstaaes som om risikoen er delvis mitigert.

Det finnes kode for:

- `RoomStateStore` / `RedisRoomStateStore`
- `RedisSchedulerLock`

Men i de aktive produksjonsbanene gjelder fortsatt:

- `BingoEngine` bruker sin egen interne `Map<string, RoomState>`
- `DrawScheduler` oppretter fortsatt sin egen `DrawSchedulerLock`
- `roomStateStore.loadAll()` kalles ved oppstart, men den hydrerte tilstanden mates ikke inn i `BingoEngine`
- `redisSchedulerLock` instansieres, men brukes ikke av `DrawScheduler`

**Revidert vurdering:**

- Dette er ikke bare "ikke fullfort".
- Det er per naa **ikke operativt innkoblet** i kritisk flyt.
- Risikoen for tap av tilstand og single-instance-avhengighet maa derfor vurderes som fullt ut gjeldende.

### 3.3 Korrigering C: Dagens sluttpersistens er svakere enn foerste rapport beskriver

Foerste rapport peker korrekt paa checkpoint-hull mellom trekk. Det som mangler, er at dagens kode ogsaa har hull **ved normal spillslutt**:

- `GAME_END`-checkpoint skrives bare i manuell `endGame()`
- Slutt via `MAX_DRAWS_REACHED` setter kun status i minnet
- Slutt via `DRAW_BAG_EMPTY` setter kun status i minnet
- Slutt via `BINGO_CLAIMED` skriver `PAYOUT`-checkpoint foer sluttstatus og sluttbudsjetter er ferdig oppdatert

**Konsekvens:**

- Den sist persisterte snapshoten kan vaere en mellomtilstand som ikke representerer endelig spillslutt.
- Recovery/audit vil dermed kunne vise et avvik mellom wallet-transaksjoner og lagret spillstatus.

Dette maa loeftes opp fra "checkpoint-hull" til et mer konkret krav om **autorativ endelig spilltilstand per runde**.

---

## 4. Nye vesentlige funn som manglet i foerste rapport

### KRITISK-4: `BINGO` mangler eksplisitt single-winner-sperre og er utsatt for dobbeltutbetaling

I `submitClaim()` finnes eksplisitt sperre for `LINE`:

- Hvis `game.lineWinnerId` finnes, blir ny LINE-claim avvist.

Det finnes ikke tilsvarende sperre for `BINGO`. Koden gjør:

1. Validerer om spillerens markeringer gir full bingo
2. Setter `game.bingoWinnerId = player.id`
3. Kaller `await walletAdapter.transfer(...)`
4. Oppdaterer deretter sluttstatus

Siden operasjonen inneholder `await`, finnes det et vindu der en ny claim kan komme inn foer runden faktisk er markert ferdig avsluttet og foer det finnes en eksplisitt "BINGO already claimed"-guard.

**Risiko:**

- Dobbeltutbetaling eller udefinert claim-race ved samtidige klientkall
- Ikke-deterministisk vinner ved konkurrerende claims
- Alvorlig økonomisk og regulatorisk feil

**Anbefaling:**

- Innfoer eksplisitt guard for `game.bingoWinnerId`
- Beskytt claim-behandling med romnivaa-laas eller atomisk claim-state
- Legg til test for samtidige `BINGO`-claims

### KRITISK-5: Snapshotformatet kan ikke gjenskape neste trekk

Dette er etter min vurdering det viktigste tekniske utelatelsen i foerste rapport.

`GameSnapshot` lagrer:

- `drawnNumbers`
- `remainingNumbers`

Men **ikke**:

- `drawBag`
- neste gjenvaerende rekkefolge

Dermed kan dere ikke bruke dagens checkpoints til aa rekonstruere hva neste korrekte trekk skulle være. Dette gjelder selv om dere begynner aa skrive checkpoint etter hvert trekk.

**Konsekvens:**

- Recovery kan ikke bli korrekt kun ved aa "checkpoint'e oftere"
- Hvis klartekstloggingen av `drawBag` fjernes uten aa etablere annen sikker persistering, mister dere samtidig den eneste varige kopien av sekvensen

**Anbefaling:**

- Definer en autorativ persistert trekketilstand
- Lagre enten full `drawBag`, eller en kryptografisk bundet representasjon som kan gjenoppbygge gjenværende sekvens
- Avklar samtidig hvordan denne tilstanden skal brukes i recovery og audit

### KRITISK-6: Snapshot-serialisering destruerer data om spillernes kryss

I et funn som underbygger at recovery i dagens løsning er umulig å benytte seg av, har vi identifisert at `serializeGame()` ødelegger data om spillernes avkrysninger (`marks`).

Motoren oppbevarer kryss som ett sett per brett (`Map<string, Set<number>[]>`). Men under bygging av spille-snapshot skjer følgende:
- Alle kryss for en gitt spiller slås sammen ("flattenes") til én enkelt, felles liste av tall (1D array).

**Konsekvens:**
- Det er matematisk umulig å deserialisere nøyaktig hvilke kryss som hører til hvilket brett for klienter som har kjøpt flere brett.
- Må spillemotoren noen gang gjenopptas, mangler motoren datagrunnlag for å validere gyldigheten av BINGO på et spesifikt brett.

**Anbefaling:**
- `GameSnapshot` må oppdateres til å lagre marks strukturert (f.eks. `Record<string, number[][]>`) for å opprettholde mapping per billett.

### HØY-4: Buy-in kan gjennomfores delvis foer runden er konsistent opprettet

I `startGame()` skjer rekkefølgen i dag slik:

1. Velg kvalifiserte spillere
2. Trekk buy-in fra wallet
3. Generer billetter
4. Sett `room.currentGame`
5. Forsok checkpoint

Hvis wallet-transfer lykkes for noen spillere, og det deretter skjer feil under billettgenerering eller senere i oppstarten, finnes det ingen samlet rollback som gjenoppretter debiterte innsatser.

**Risiko:**

- Spillere kan bli trukket penger uten at en gyldig runde er konsistent etablert
- Revisjon mellom wallet og spillmotor kan få avvik

**Anbefaling:**

- Definer atomisk oppstartssekvens
- Enten reserver midler foer spillstart og commit ved vellykket oppstart
- Eller implementer eksplisitt kompensasjonsflyt ved oppstartsfeil

### HØY-5: Testgrunnlaget dekker ikke de viktigste feilsituasjonene

Relevante backend-tester passerer, men testbasen gir mindre trygghet enn det kan se ut som:

- Jeg fant ingen tester for samtidig `BINGO`-claim
- Jeg fant ingen tester for checkpoint/recovery av aktive spill
- Jeg fant ingen tester som verifiserer endelig `GAME_END`-persistens ved automatisk spillslutt
- `FixedTicketBingoAdapter` i engine-testene bruker et 5x5-lignende testbrett med free space, ikke produksjonsformatet 3x5 / 60 baller

**Risiko:**

- Kritiske race- og recovery-feil kan eksistere uten aa bli oppdaget av grønt testløp

**Anbefaling:**

- Legg til produksjonsnære tester foer selve utbedringsarbeidet starter
- Prioriter concurrency, checkpoint og recovery

---

## 5. Oppdatert risikovurdering

### P0 - Blokkerende foer pengespill

1. **Ingen sertifisert RNG-/trekkgodkjenning fra akkreditert tredjepart**
2. **Klartekstlogging av full trekkerekkefølge**
3. **Manglende autorativ persistert spilltilstand**
4. **Snapshotformat kan ikke gjenskape neste trekk**
5. **Snapshot-serialisering destruerer presisjonsdata for kryss**
6. **`BINGO`-claim kan gi dobbeltutbetaling ved samtidige claims**

### P1 - Maa lukkes i samme arbeidsstroem

1. **Normal spillslutt persisteres ikke fullstendig**
2. **Delvis wallet-debitering kan skje foer runden er konsistent etablert**
3. **Distribuert tilstand/lock er ikke faktisk koblet inn**
4. **Checkpointing under trekning mangler fortsatt**

### P2 - Viktige, men sekundære i forhold til P0/P1

1. Manuell draw mangler internt minimumsintervall
2. Ingen server-side auto-markering / serverdrevet gevinstdeteksjon
3. Billettduplikater er teoretisk mulige
4. Misvisende navn og kommentarer i billettmodell

---

## 6. Oppdatert anbefalt handlingsrekkefolge

### Fase 1 - Fastsett autorativ sannhetsmodell

Dette maa avklares foer detaljutbedringer:

- Hva er den autorative kilden for aktiv spilltilstand?
- Hvordan persisteres trekkesekvensen sikkert?
- Hvilken snapshot/replay-modell skal brukes ved krasj?
- Hva er korrekt sluttstatusmodell for alle avslutningsbaner?

**Uten dette risikerer dere aa lappe symptomer i feil rekkefolge.**

### Fase 2 - Lukk de direkte økonomiske og regulatoriske hullene

1. Fjern klartekstlogging av `drawBag`, men bare etter at sikker audit/persistering av trekksekvens er paa plass
2. Innfoer atomisk single-winner-beskyttelse for `BINGO`
3. Sikre at alle spillsluttbaner skriver endelig checkpoint
4. Sikre at oppstartsfeil ikke etterlater irreversible buy-ins uten gyldig spilltilstand

### Fase 3 - Koble faktisk inn distribuert drift

1. Integrer romtilstandslageret i `BingoEngine`
2. Integrer distribuert lock i `DrawScheduler`
3. Test flerinstans-oppsett eksplisitt

### Fase 4 - Dokumentasjon, test og regulatorisk pakke

1. Legg til recovery- og concurrency-tester
2. Dokumenter trekksikkerhetsmodell og replay-modell
3. Send systemet til uavhengig sertifisering

---

## 7. Oppdatert prioritert handlingsplan

| Prio | ID | Funn | Tiltak | Estimat |
|------|----|------|--------|---------|
| **P0** | KRITISK-1 | Ingen tredjeparts RNG-godkjenning | Engasjer akkreditert testlab | 4-8 uker |
| **P0** | KRITISK-3 | Klartekstlogging av full `drawBag` | Erstatt med sikker auditmodell | 2-3 dager |
| **P0** | KRITISK-5 | Snapshot kan ikke gjenskape neste trekk | Utvid snapshotmodell med autorativ trekketilstand | 2-4 dager design + implementering |
| **P0** | KRITISK-6 | Serialisering destruerer kryss-data | Behold kryss-struktur per billett i snapshotformatet | 1-2 dager |
| **P0** | KRITISK-4 | `BINGO`-claim kan race | Innfoer atomisk single-winner-guard og tester | 1-2 dager |
| **P0** | KRITISK-2 | Aktiv spilltilstand er ikke robust persistert | Implementer reell recovery/replay | 2-3 uker |
| **P1** | HØY-6 | Sluttstatus persisteres ikke konsekvent | Skriv endelig checkpoint for alle avslutningsbaner | 1-2 dager |
| **P1** | HØY-4 | Buy-in kan bli delvis commit'et | Gjør oppstart atomisk eller kompensasjonsbasert | 2-4 dager |
| **P1** | HØY-7 | Redis-tiltak er ikke innkoblet | Koble inn state store og distribuert lock i live path | 1-2 uker |
| **P1** | HØY-3 | Checkpoint-hull mellom trekk | Persister trekketilstand per trekk eller per definert batch | 2-4 dager |
| **P2** | HØY-2 | Motor-default for `payoutPercent` er 100 | Fjern default og krev eksplisitt verdi | 0.5 dag |
| **P2** | MEDIUM-1 | Ingen intern draw cadence-beskyttelse | Minsteintervall i `drawNextNumber()` | 0.5 dag |
| **P2** | MEDIUM-3 | Ingen server-side gevinstdrift | Serverdrevet markering eller gevinstsjekk | 2-3 dager |
| **P3** | LAV-1 | Misvisende kommentar i `types.ts` | Korriger kommentar | 5 min |
| **P3** | LAV-2 | Misvisende funksjonsnavn | Rename til 60-balls-navn | 0.5 dag |

---

## 8. Kodereferanser for de nye og korrigerte funnene

### BINGO race / dobbeltutbetaling

- `backend/src/game/BingoEngine.ts`
  - `submitClaim()` har guard for `LINE`, men ikke tilsvarende guard for `BINGO`
  - `game.bingoWinnerId` settes foer `await walletAdapter.transfer(...)`

### Snapshotformat / recovery-begrensning

- `backend/src/game/types.ts`
  - `GameSnapshot` mangler `drawBag`
  - Type for `marks` er en flat `number[]` per spiller
- `backend/src/game/BingoEngine.ts`
  - `serializeGame()` lagrer `remainingNumbers`, ikke gjenværende trekkesekvens
  - `serializeGame()` slår sammen (flattens) `Set<number>[]` til én `number[]` per spiller
- `backend/src/adapters/BingoSystemAdapter.ts`
  - `CheckpointInput.snapshot` peker til dette snapshotformatet

### Sluttpersistens

- `backend/src/game/BingoEngine.ts`
  - `endGame()` skriver `GAME_END`
  - avslutning via `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY` og `BINGO_CLAIMED` gjoer ikke det samme

### Ikke-innkoblet Redis-state / lock

- `backend/src/index.ts`
  - `roomStateStore` og `redisSchedulerLock` instansieres
  - `roomStateStore.loadAll()` kalles ved oppstart
- `backend/src/game/BingoEngine.ts`
  - fortsatt intern `Map<string, RoomState>`
- `backend/src/draw-engine/DrawScheduler.ts`
  - oppretter fortsatt lokal `DrawSchedulerLock`

### Oppstartssekvens / delvis buy-in

- `backend/src/game/BingoEngine.ts`
  - buy-in trekkes foer `room.currentGame` etableres og foer checkpoint er bekreftet

### Testdekning

- `backend/src/game/BingoEngine.test.ts`
  - produksjonsformatet 3x5/60 baller er ikke det testadapteret modellerer
  - ingen identifisert test for samtidig `BINGO`-claim eller recovery-flyt

---

## 9. Verifikasjonsgrunnlag

Jeg verifiserte denne rapporten mot gjeldende kode i repoet og kjorer relevante backend-tester. Testene passerte, men testgrunnlaget dekker ikke concurrency- og recovery-risikoene som er beskrevet over.

Dette dokumentet boer brukes som **revidert arbeidsgrunnlag** foran utbedringsplanen. Dersom dere vil vaere helt presise foer implementering, anbefaler jeg neste steg i denne rekkefolgen:

1. Beslutning om autorativ state/replay-modell
2. Teknisk design for claim-atomisitet og sluttpersistens
3. Deretter kodeendringer

---

**Slutt paa revidert rapport.**
