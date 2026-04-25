# KRITISK-1: RNG-verifisering — Status og konklusjon

**Dato:** 10. april 2026
**Status:** LUKKET — ekstern sertifisering er ikke regulatorisk paakrevd
**Oppdatert:** Basert paa gjennomgang av faktiske krav i pengespillforskriften
**Presisert 2026-04-25:** Spillorama driver tre hovedspill (Spill 1, 2, 3) og ett databingo (SpinnGo / Spill 4 / slug `spillorama`). RNG-algoritmen er den samme for alle fire spill — kun pool-stoerrelsen varierer (75-ball for Spill 1, 60-ball for Spill 2/3 og SpinnGo). Se [`docs/architecture/SPILLKATALOG.md`](../architecture/SPILLKATALOG.md).

---

## 1. Konklusjon

Sikkerhetsgjennomgangen identifiserte KRITISK-1 som behov for ekstern RNG-sertifisering fra akkreditert testlab. Etter gjennomgang av det faktiske regelverket (pengespillforskriften og tilhoerende forskrifter) er dette **ikke et krav** verken for hovedspill (Spill 1-3) eller databingo (SpinnGo) i Norge.

Pengespillforskriften stiller ingen krav til ekstern RNG-sertifisering. De faktiske kravene er listet i seksjon 3 nedenfor.

**Hva vi har gjort i stedet:**
- Intern statistisk pre-test med 1 000 000 sekvenser og 1 000 000 billetter — **alle 5 tester bestaaatt**
- Formell algoritmebeskrivelse dokumentert (`docs/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md`)
- Test-harness tilgjengelig for gjentatt verifisering (`backend/tools/rng-test-harness.ts`)

---

## 2. RNG-implementasjon og verifisering

### Implementasjon

| Komponent | Detalj |
|-----------|--------|
| CSPRNG-kilde | `node:crypto.randomInt()` (OpenSSL CSPRNG via Node.js) |
| Algoritme | Fisher-Yates shuffle (`ticket.ts:7-14`) |
| Ballpool | 60 baller, 5 kolonner a 12 tall |
| Trekksekvens | `makeShuffledBallBag(60)` — shuffler array [1..60] |
| Integritetslogg | SHA-256 hash av drawBag ved spillstart |
| Checkpoint | drawBag persistert i `RecoverableGameSnapshot` for crash recovery |

### Intern pre-test resultater (1M samples, 2026-04-10)

| Test | Statistikk | Terskel | Resultat |
|------|-----------|---------|----------|
| Chi-squared: foersteposisjon-uniformitet | 55.26 | 86.38 (p=0.01, df=59) | BESTAAATT |
| Chi-squared: alle 60 posisjoner | 82.16 (verste) | 86.38 (p=0.01, df=59) | BESTAAATT |
| Maks frekvensavvik | 2.85% | 5.0% | BESTAAATT |
| Chi-squared: billett-kolonnedistribusjon | 13.26 (verste) | 24.72 (p=0.01, df=11) | BESTAAATT |
| Seriell korrelasjon: nabopar | z=1.592 | |z| < 3.0 | BESTAAATT |

Fullstendige resultater og raadata i `backend/tools/rng-output/`.

---

## 3. Faktiske regulatoriske krav (pengespillforskriften)

Disse er de faktiske kravene som gjelder for elektroniske bingospill i Norge — bade hovedspill og databingo. Punktene under gjelder Spillorama-systemet samlet (Spill 1-3 hovedspill + SpinnGo databingo) der ikke annet er presisert. Se [SPILLKATALOG.md](../architecture/SPILLKATALOG.md) §3 for ledger-dimensjoner og prosent-fordeling per kategori.

### 3.1 Registrering i offentlig kontrollert system (SS 4)
Spillingen paa elektroniske bingospill skal registreres gjennom et felles, offentlig kontrollert system. For databingo gjaldt dette fra 2023.

### 3.2 Spilleridentifisering (SS 4)
- Hver spiller skal identifiseres med eID nivaa hoeyt (BankID eller tilsvarende)
- Unikt kundeforhold hos hver pengespilltilbyder
- Alle spilltransaksjoner registrert mot kundeforhold

### 3.3 Tapsgrenser og pausefunksjon (SS 65)
- Maks tap: **900 kr/dag** og **4 400 kr/maaned** (elektronisk hovedspill + databingo per bingolokale)
- **5 minutters pause** etter 1 times spill

### 3.4 Spilloversikt
Spilleren skal tilbys verktoy med oversikt over tap siste aar og siste maaned.

### 3.5 Bonger og systemkrav
- Elektroniske bonger: eget serienummer og enkeltnummer
- Arrangoeor, spillested og produsent skal fremgaa
- Maks 30 elektroniske bonger per spill
- En spillkonto per tilbyder

### 3.6 Risikovurdering (SSSS 2-3)
Aarlig risikovurdering for aa forebygge spilleproblemer, kriminalitet og uredelig gjennomfoeoring.

### 3.7 Regnskap og rapportering
- Daglige rapporter
- Kvartalsvise sammendrag (omsetning, gevinster, utbetaling til organisasjoner)
- Revisorbekreftelse ved bruk av entrepenoeor (halvaarlig)

### 3.8 Hvitvasking
- Kundetiltak etter hvitvaskingsloven SS 12
- Loepende oppdatering etter SS 24
- Transaksjonsoversikt

### 3.9 Ansvarlighetsmerking
Alle elektroniske terminaler merket med hjelpelinjen for spilleavhengige.

---

## 4. Vedlikehold av RNG-kvalitet

Selv om ekstern sertifisering ikke er paakrevd, boer foelgende gjennomfoeres loepende:

| Tiltak | Frekvens |
|--------|----------|
| Kjoer `rng-test-harness.ts` etter endringer i `ticket.ts` | Ved kodeendring |
| Overvaakning av utbetalingsprosent (faktisk vs konfigurert) | Daglig/ukentlig |
| Node.js security advisory-sjekk for crypto-modul | Ved oppgradering |
| Verifiser at SHA-256 hash-kjeden er intakt i loggene | Periodisk stikkproeve |
