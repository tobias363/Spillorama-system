# Spill 1 gameType-misklassifisering — Impact Investigation

**Dato:** 2026-04-25
**Forfatter:** Investigation Agent (re-spawn)
**Type:** Decision-support, ikke fix.

## TL;DR

Misklassifiseringen er ikke bare et Spill 1-problem — `"DATABINGO"` er hardkodet i alle interne game-engines (Spill 1/2/3/4 + mini-games), `house-account-id`-formatet (`house-{hallId}-databingo-{channel}`), §11-overskudd-regelen (30%) og PrizePolicyManager. Et bytte til `"MAIN_GAME"` for kun Spill 1 vil **bryte hall-balanse-readout** (kontoid-mismatch), **endre lovkrav til 15%** ved overskudd-fordeling, og kreve oppdatering av 32 backend-filer + 18 testfiler. RNG-sertifiserings-dokumentene er **interne utkast** (status "LUKKET — ekstern sertifisering ikke regulatorisk paakrevd"), ikke innsendt.

**Anbefalt strategi:** (B) Bytt kode + minimal backfill av house-account-IDs, men **kun etter PM-beslutning** om hvorvidt 15%- eller 30%-grensen er korrekt for Spill 1. Hvis 30% er den faktiske avtalen som hallene har inngått med organisasjonene, må gameType=DATABINGO **beholdes** og §11-koden i stedet refaktoreres til en hall-konfigurert prosent.

---

## §1 Hvor brukes gameType-feltet?

### Skriving (33 call-sites totalt — ikke kun Spill 1)
- `apps/backend/src/game/BingoEngine.ts:735, 1259, 1268, 1579, 1759, 1777, 1882, 2306, 2330` — kjernen i Spill 1 ledger-skriving (STAKE/PRIZE).
- `apps/backend/src/game/Game1PayoutService.ts:330, 368` — payout-payload for Spill 1.
- `apps/backend/src/game/Game1TicketPurchaseService.ts:492` — ticket-kjøp for Spill 1.
- `apps/backend/src/game/Game2Engine.ts:168, 320, 444` — Spill 2 (samme pattern).
- `apps/backend/src/game/Game3Engine.ts:254, 485` — Spill 3 (samme pattern).
- `apps/backend/src/game/BingoEngineMiniGames.ts:141, 271` — Spill 1 mini-games (Wheel, Treasure, etc.).
- `apps/backend/src/game/PrizePolicyManager.ts:17, 85, 152, 299` — `PrizeGameType = "DATABINGO"` som default.
- `apps/backend/src/sockets/adminHallEvents.ts:60-62` — hall-balance-readout antar **kun** DATABINGO.
- `apps/backend/src/routes/adminCompliance.ts:143, 158` og `adminReports.ts:63` — admin-report defaults.

### Lesing/aggregering (compliance-flate)
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:43-141` — `generateDailyReport()` filtrerer/grupperer på `gameType`. Sorteringskode (`a.gameType.localeCompare(b.gameType)`) er stabilt.
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:225-320, 384-493, 501-564, 572-652` — `generateGameStatistics`, `generateTimeSeries`, `generateTopPlayers`, `generateGameSessions` — alle har valgfri `gameType`-filter og grupperer per `(hallId, gameType)`.
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts:75` — **§11-kalkyle**: `minimumPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15`.
- `apps/backend/src/game/ComplianceLedgerValidators.ts:130` — `makeHouseAccountId()` lager `house-{hallId}-{gameType.toLowerCase()}-{channel.toLowerCase()}`. **gameType lekkes inn i wallet-account-IDs**.
- `apps/backend/src/admin/reports/HallSpecificReport.ts:289-294` — fallback-mapping `DATABINGO → game4`, `MAIN_GAME → game1` når slot-routing feiler.
- `apps/backend/src/compliance/HallAccountReportService.ts:42, 171, 186-242` — group-by date×gameType.
- `apps/backend/src/spillevett/reportExport.ts:23-25` — labels `MAIN_GAME → "Hovedspill"`, alt annet → "Databingo".

### Persistert
- `apps/backend/migrations/20260413000001_initial_schema.sql:374` — `app_rg_compliance_ledger.game_type TEXT NOT NULL` (ingen CHECK-constraint, så DB godtar begge).
- `apps/backend/migrations/20260413000001_initial_schema.sql:407` — `app_rg_overskudd_batches.game_type TEXT NULL` (filterfelt).
- `apps/backend/migrations/20260413000001_initial_schema.sql:425` — `app_rg_hall_organizations.game_type TEXT NULL`.
- **Wallet-tabellen** (via `makeHouseAccountId`): alle eksisterende house-saldoer er på `house-{hallId}-databingo-{channel}`.

NB: `apps/backend/migrations/20260417000005_regulatory_ledger.sql` (`app_regulatory_ledger`, append-only § 71-tabellen) har **ingen** `game_type`-kolonne — kun `channel` og `hall_id`. Dette er en separat hovedbok med eget hash-kjede. Ikke berørt av endringen.

## §2 Bytte-konsekvenser

### Forward-effekt (etter kode-bytte til `"MAIN_GAME"`)
1. **Nye ledger-rader** for Spill 1 vil ha `game_type='MAIN_GAME'`. `generateDailyReport` grupperer per `(hallId, gameType, channel)`, så **rapporten splittes**: før-bytte-data under `DATABINGO`, etter-bytte under `MAIN_GAME`. CSV-export, dashboard-grafer og admin-tabeller viser begge linjer.
2. **§11-kalkyle endres**: nye Spill 1-rader får 15% minimum-fordeling istedenfor 30% (`ComplianceLedgerOverskudd.ts:75`). For en netto på 1000 kr skulle 300 kr ut til organisasjoner — nå går 150 kr ut. **Direkte regulatorisk og avtalemessig endring.**
3. **Hall-balance-readout knekker** (`adminHallEvents.ts:60-62`): listen `HALL_BALANCE_ACCOUNT_PAIRS` antar kun `DATABINGO`. Nye penger lagres på `house-{hallId}-main_game-{channel}`, men admin-UI leser kun `house-{hallId}-databingo-{channel}`. Hallene ser saldo gå mot null selv om penger fortsatt finnes på den nye kontoen.
4. **HallSpecificReport-fallback**: `DATABINGO → game4` (`HallSpecificReport.ts:292`). Etter bytte havner Spill 1-rader uten slot-binding feil i `game1` (riktig nå), men gamle rader fortsatt i `game4`. **Historisk data omklassifiseres ikke.**
5. **Overskudd-batch-historikk** (`app_rg_overskudd_batches.game_type`): historiske batcher bevares som DATABINGO; nye lages som MAIN_GAME. Dashboard-filter "vis kun MAIN_GAME" vil skjule alt før bytte-dato.

### Bakover-effekt (eksisterende rader)
- **Ingen automatisk migrering** — rader er immutable per § 71-trigger på `app_regulatory_ledger` (men `app_rg_compliance_ledger` har ikke samme trigger; den **er** mutable i DB). Likevel: data-integritet og hash-kjede-prinsipp tilsier at vi ikke retroaktivt re-skriver gameType uten en kompenserende ledger-rad.
- **Wallet-balanser** står på gamle account-IDs (`house-…-databingo-…`). Hvis vi ikke migrerer disse, har hallene "to lommebøker": den gamle med opphopet saldo, og den nye for nye salg.

## §3 §11 overskudd-fordeling

**Nåværende kode:** `ComplianceLedgerOverskudd.ts:75` — DATABINGO ⇒ 0.30, MAIN_GAME ⇒ 0.15.

Per `docs/engineering/TECHNICAL_BACKLOG.md:177-178` er regelen: "Main game min 15% to organizations" / "Databingo min 30% to organizations". Per `docs/architecture/SPILLKATALOG.md §5.3`: "Siden vi kun driver hovedspill, er 15%-regelen relevant og 30%-regelen skal fjernes."

**Konklusjon:** Med dagens hardkoding `gameType="DATABINGO"` for Spill 1 trigger vi 30%-grensen (utdeler **mer** til organisasjoner enn pengespillforskriften krever for hovedspill). Hvis spikretingen i SPILLKATALOG er korrekt og Spill 1 faktisk er hovedspill, har vi enten **(a)** overforpliktet oss til organisasjonene (som de neppe protesterer mot), eller **(b)** koden gir korrekt resultat fordi avtalen med organisasjonene er 30% uavhengig av lovkategori. Dette må PM avklare med juridisk/økonomi før kode endres.

## §4 RNG-sertifiseringsdokumenter

Sjekket dokument-statuser:

| Fil | Status-felt | Innsendt? |
|---|---|---|
| `docs/compliance/KRITISK1_RNG_SERTIFISERINGSPLAN.md` | "Status: LUKKET — ekstern sertifisering er ikke regulatorisk paakrevd" | **Nei** — interne utkast. Linje 11: "Pengespillforskriften stiller ingen krav til ekstern RNG-sertifisering." |
| `docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md` | "Document purpose: Formal algorithm description for submission to accredited RNG test laboratory." Tittel: "Spillorama Databingo" | **Nei** — formelt "klar for innsending", men sertifisering er aktivt avlyst per planen. |
| `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` | Linje 320: "Norsk regulering for databingo krever at spillsystemet er godkjent…" | Intern audit, ikke innsendt. |

**Koordinering:** Ingen ekstern koordinering nødvendig før korreksjon. Endring kan gjøres som ren intern-redigering (Spillorama Databingo → Spillorama Hovedspill) i alle tre dokumenter samtidig som koden endres.

Memory-fil `MEMORY.md` bekrefter: "no external RNG cert needed".

## §5 Test-impact

**18 testfiler** refererer DATABINGO/MAIN_GAME. Følgende vil knekke ved bytte (faktiske assertions, ikke bare typesetup):

| Fil | Antall DATABINGO | Knekker? | Notat |
|---|---|---|---|
| `apps/backend/src/game/Game1PayoutService.complianceLedger.test.ts:172` | 1 | **Ja** | `assert.equal(prizeCalls[0]!.gameType, "DATABINGO")` — eksplisitt assertion. |
| `apps/backend/src/game/Game1TicketPurchaseService.complianceLedger.test.ts:219` | 1 | **Ja** | Samme pattern. |
| `apps/backend/src/game/ComplianceLedger.test.ts` | 47 | **Ja** | Hele suite bygd rundt DATABINGO som default-fixture. Krever omskriving. |
| `apps/backend/src/admin/reports/HallSpecificReport.test.ts:248` | 6 | **Ja** | Tester `DATABINGO → game4` fallback. Må oppdateres siden Spill 1 nå kommer som MAIN_GAME. |
| `apps/backend/src/sockets/__tests__/adminHallEvents.test.ts:336-364` | 5 | **Ja** | Tester `house-hall-a-databingo-hall` account-ID. Knekker både account-ID og `HALL_BALANCE_ACCOUNT_PAIRS`. |
| `apps/backend/src/spillevett/reportExport.test.ts` | 3 | Trolig | Tester label-mapping. |
| `apps/backend/src/spillevett/playerReport.test.ts` | 2 | Trolig | Mixer DATABINGO og MAIN_GAME — fortsatt gyldig hvis bare Spill 1 byttes. |
| `apps/backend/src/spillevett/__tests__/cross-game.test.ts` | 1 | Mulig | Ledger-fixture. |
| `apps/backend/src/game/BingoEngine.test.ts` | 7 | **Ja** | Engine-integrasjonstester. |
| `apps/backend/src/game/ticket.bin672.test.ts` | 3 | Nei | Bruker `DATABINGO60_SLUGS` (slugs, ikke gameType). |
| `apps/backend/src/routes/__tests__/adminUsers.test.ts` | 5 | Trolig | Setup/fixture. |
| `apps/backend/src/routes/__tests__/adminUniqueIdsAndPayouts.test.ts` | 1 | Mulig | |

**Estimat:** 9 testfiler **garantert** knekker, 4 ekstra **trolig** knekker. Total fixture-omskriving: minst 70 linjer over 13 filer.

## §6 Anbefalt fix-strategi (3 alternativer)

### (A) Bytt kode, ingen migrasjon
**Hva:** Endre alle Spill 1 call-sites til `"MAIN_GAME"`. Behold gamle DATABINGO-rader i ledger og wallet uendret.
**Pros:** Minst risiko for data-integritet. Ingen DB-migrasjon. Følger append-only-prinsippet.
**Cons:** Hall-balance-readout knekker (account-ID-mismatch). Saldo "låst" på gammel `house-…-databingo-…`-konto. Nye salg går til `house-…-main_game-…`. Rapporten splittes per dato. Krever **også** kodeendring i `adminHallEvents.ts:60-62` for å spørre begge gameTypes — som likevel er en migrasjon, bare i kode.

### (B) Bytt kode + backfill-migration ⭐ ANBEFALT (med forbehold)
**Hva:** Endre kode + lag DB-migrasjon som **(1)** legger inn kompenserende ledger-rader (eller en explicit `gameTypeBeforeMigration`-kolonne) og **(2)** wallet-transfers fra gamle `house-…-databingo-…` til nye `house-…-main_game-…`-kontoer per hall, gjort som én atomisk transaksjon under nattlig vedlikehold.
**Pros:** Renest sluttilstand. Hall-balance fungerer. Rapporter konsistente. Følger forskrift-krav til hovedspill (15%).
**Cons:** Krever PM-godkjennelse av §11-prosent-endring (15% vs 30% — kan være avtalemessig brudd). Krever code-freeze under migrasjon. Data-integritet: må dokumentere migrasjon i § 71-hovedboken som ADJUSTMENT-rader.

### (C) Bytt kode + migrasjon + ledger-versjon-flagg
**Hva:** Som (B), men legg til `app_rg_compliance_ledger.schema_version INT` med default 1. Etter migrasjon settes nye rader til version 2. Aggregering kan toggle mellom v1- og v2-semantikk.
**Pros:** Fullstendig audit-spor. Tilsvarende fungerer som "før vs etter"-rekonstruksjon ved revisjonstilsyn.
**Cons:** Mest kompleksitet. Mest test-impact. Overkill hvis bytte aldri repeteres.

**Anbefaling: (B)**, men **bare etter PM-beslutning på §3** (er 30%-regelen avtalemessig forpliktelse, eller bug?). Hvis 30% er forpliktelse, må fix være **å beholde DATABINGO i koden** og isteden refaktorere `ComplianceLedgerOverskudd.ts:75` til å lese hall-konfigurert minimum-prosent. Å endre koden uten å avklare overskuddsprosent er regulatorisk og kontraktsmessig risiko.

## §7 Beslutninger PM må ta

1. **§11-prosent**: Skal Spill 1-overskudd være 15% (lov-minimum for hovedspill) eller 30% (dagens kode-effekt fra DATABINGO-flagging)? Spør juridisk + sjekk hall-organisasjons-avtaler.
2. **Scope av bytte**: Kun Spill 1, eller alle interne spill (Spill 1-4 + mini-games)? SPILLKATALOG sier alle skal være MAIN_GAME, men ingen er det i kode.
3. **Wallet-migrasjon**: Skal vi konsolidere `house-…-databingo-…` ⇒ `house-…-main_game-…` per hall, eller la dem stå parallelt? Konsolidering krever code-freeze.
4. **Test-omskriving**: Godkjenn 9-13 testfiler oppdateres som del av bytte-PR (ikke som follow-up).
5. **RNG-dokumenter**: Bekreft at alle tre `KRITISK1_RNG_*.md` og `RNG_OG_BALLTREKNING_GJENNOMGANG_*.md` kan internredigeres uten ekstern koordinering. (Confirmation: status-felt sier "LUKKET — ikke paakrevd", så svar er ja, men la PM bekrefte.)
6. **Sekvensering**: Bytte før eller etter pilot-launch av Spill 1? Anbefaling: **etter** for å unngå rapport-splitt midt i pilot.

---

**Vedlegg — referanser brukt:**
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts` (§11-kjernen)
- `apps/backend/src/game/ComplianceLedgerAggregation.ts` (rapport-aggregering)
- `apps/backend/src/game/ComplianceLedgerValidators.ts` (account-ID-format)
- `apps/backend/src/sockets/adminHallEvents.ts:60-62` (hall-balance hardkoding)
- `apps/backend/migrations/20260413000001_initial_schema.sql:370-414` (DB-schema)
- `apps/backend/migrations/20260417000005_regulatory_ledger.sql` (separat § 71-hovedbok, ikke berørt)
- `docs/architecture/SPILLKATALOG.md §2, §5` (spikret klassifisering)
- `docs/engineering/TECHNICAL_BACKLOG.md:177-178` (15% vs 30%-regelen)
- `docs/compliance/KRITISK1_RNG_SERTIFISERINGSPLAN.md` (status: LUKKET)
