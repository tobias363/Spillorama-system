# Spill 1 gameType-misklassifisering — Impact Investigation

**Dato:** 2026-04-25
**Forfatter:** Investigation Agent (re-spawn)
**Type:** Decision-support, ikke fix.
**Oppdatert 2026-04-25:** Spill-klassifisering avklart per [SPILLKATALOG.md](../architecture/SPILLKATALOG.md) (korrigert versjon). Spill 1, 2, 3 er **hovedspill** (15%); SpinnGo (Spill 4 / game5 / slug `spillorama`) er **databingo** (30%). Anbefalingen i §6 og §7 er oppdatert tilsvarende — scope er **Spill 1-3 + mini-games**, ikke alle interne spill.

## TL;DR

Misklassifiseringen gjelder Spill 1, 2, 3 og deres mini-games — men **ikke** SpinnGo (game5/spillorama), som regulatorisk **er** databingo og skal beholde `gameType: "DATABINGO"`. `"DATABINGO"` er hardkodet i alle interne game-engines (BingoEngine, Game2Engine, Game3Engine, BingoEngineMiniGames + Game1*Service), `house-account-id`-formatet (`house-{hallId}-databingo-{channel}`), §11-overskudd-regelen (30%) og PrizePolicyManager. Et bytte til `"MAIN_GAME"` for Spill 1-3 vil **bryte hall-balanse-readout** (kontoid-mismatch), **endre lovkrav fra 30% til 15%** ved overskudd-fordeling for Spill 1-3 (riktig per SPILLKATALOG), og kreve oppdatering av ~28 backend-filer + ~15 testfiler. SpinnGo-paths (game5-spesifikk kode + spillorama-slug-call-sites) skal **ikke** endres. RNG-sertifiserings-dokumentene er **interne utkast** (status "LUKKET — ekstern sertifisering ikke regulatorisk paakrevd"), ikke innsendt.

**Anbefalt strategi:** (B) Bytt kode for Spill 1-3 + mini-games til `MAIN_GAME` + minimal backfill av house-account-IDs for Spill 1-3-trafikk. SpinnGo-paths beholdes uendret. §11-prosent-regelen i `ComplianceLedgerOverskudd.ts:75` er strukturelt korrekt (DATABINGO=30%, MAIN_GAME=15%); det er kun call-site-misklassifiseringen som må fikses.

---

## §1 Hvor brukes gameType-feltet?

### Skriving (33 call-sites totalt — Spill 1-3 + SpinnGo)
- `apps/backend/src/game/BingoEngine.ts:735, 1259, 1268, 1579, 1759, 1777, 1882, 2306, 2330` — kjernen i Spill 1 ledger-skriving (STAKE/PRIZE). **Skal endres til MAIN_GAME.**
- `apps/backend/src/game/Game1PayoutService.ts:330, 368` — payout-payload for Spill 1. **Skal endres til MAIN_GAME.**
- `apps/backend/src/game/Game1TicketPurchaseService.ts:492` — ticket-kjøp for Spill 1. **Skal endres til MAIN_GAME.**
- `apps/backend/src/game/Game2Engine.ts:168, 320, 444` — Spill 2 (samme pattern). **Skal endres til MAIN_GAME.**
- `apps/backend/src/game/Game3Engine.ts:254, 485` — Spill 3 (samme pattern). **Skal endres til MAIN_GAME.**
- `apps/backend/src/game/BingoEngineMiniGames.ts:141, 271` — Spill 1 mini-games (Wheel, Treasure, etc.). **Skal endres til MAIN_GAME** (mini-games er del av Spill 1 hovedspill).
- `apps/backend/src/game/PrizePolicyManager.ts:17, 85, 152, 299` — `PrizeGameType = "DATABINGO"` som default. **Default må parametriseres per spill-slug** (Spill 1-3 → MAIN_GAME; SpinnGo → DATABINGO).
- `apps/backend/src/sockets/adminHallEvents.ts:60-62` — hall-balance-readout antar **kun** DATABINGO. **Må utvides til å lese begge gameTypes** for haller som driver både hovedspill og databingo.
- `apps/backend/src/routes/adminCompliance.ts:143, 158` og `adminReports.ts:63` — admin-report defaults. **Defaults må parametriseres.**

### SpinnGo-spesifikke call-sites (skal IKKE endres)
- Eventuelle game5-spesifikke engines/services (hvis de eksisterer som egne filer) skal beholde `gameType: "DATABINGO"`. Slug-routing (`gameSlug === "spillorama"`) bestemmer kategori i runtime; for nåværende kode skjer dette via PrizePolicyManager-defaults og hardkodede strenger som må gjøres slug-bevisste.

### Lesing/aggregering (compliance-flate)
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:43-141` — `generateDailyReport()` filtrerer/grupperer på `gameType`. Sorteringskode (`a.gameType.localeCompare(b.gameType)`) er stabilt.
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:225-320, 384-493, 501-564, 572-652` — `generateGameStatistics`, `generateTimeSeries`, `generateTopPlayers`, `generateGameSessions` — alle har valgfri `gameType`-filter og grupperer per `(hallId, gameType)`.
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts:75` — **§11-kalkyle**: `minimumPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15`. **Strukturelt korrekt — Spill 1-3 (15%) og SpinnGo (30%) er korrekt fordelt så snart call-sites skriver riktig gameType.**
- `apps/backend/src/game/ComplianceLedgerValidators.ts:130` — `makeHouseAccountId()` lager `house-{hallId}-{gameType.toLowerCase()}-{channel.toLowerCase()}`. **gameType lekkes inn i wallet-account-IDs** — etter fix vil Spill 1-3 ha account-IDs `house-{hallId}-main_game-{channel}` mens SpinnGo beholder `house-{hallId}-databingo-{channel}`.
- `apps/backend/src/admin/reports/HallSpecificReport.ts:289-294` — fallback-mapping `DATABINGO → game4`, `MAIN_GAME → game1` når slot-routing feiler. **OK etter fix.**
- `apps/backend/src/compliance/HallAccountReportService.ts:42, 171, 186-242` — group-by date×gameType.
- `apps/backend/src/spillevett/reportExport.ts:23-25` — labels `MAIN_GAME → "Hovedspill"`, alt annet → "Databingo". **Strukturelt korrekt.**

### Persistert
- `apps/backend/migrations/20260413000001_initial_schema.sql:374` — `app_rg_compliance_ledger.game_type TEXT NOT NULL` (ingen CHECK-constraint, så DB godtar begge).
- `apps/backend/migrations/20260413000001_initial_schema.sql:407` — `app_rg_overskudd_batches.game_type TEXT NULL` (filterfelt).
- `apps/backend/migrations/20260413000001_initial_schema.sql:425` — `app_rg_hall_organizations.game_type TEXT NULL`.
- **Wallet-tabellen** (via `makeHouseAccountId`): alle eksisterende house-saldoer er på `house-{hallId}-databingo-{channel}` — også for Spill 1-3-trafikk. Etter fix skal Spill 1-3-trafikk gå til `house-{hallId}-main_game-{channel}`.

NB: `apps/backend/migrations/20260417000005_regulatory_ledger.sql` (`app_regulatory_ledger`, append-only § 71-tabellen) har **ingen** `game_type`-kolonne — kun `channel` og `hall_id`. Dette er en separat hovedbok med eget hash-kjede. Ikke berørt av endringen.

## §2 Bytte-konsekvenser

### Forward-effekt (etter kode-bytte til `"MAIN_GAME"` for Spill 1-3)
1. **Nye ledger-rader** for Spill 1-3 vil ha `game_type='MAIN_GAME'`. SpinnGo fortsetter med `DATABINGO`. `generateDailyReport` grupperer per `(hallId, gameType, channel)`, så **rapporten splittes**: før-bytte Spill 1-3-data under `DATABINGO`, etter-bytte under `MAIN_GAME`. SpinnGo-rader urørt. CSV-export, dashboard-grafer og admin-tabeller viser begge linjer.
2. **§11-kalkyle endres** for Spill 1-3 (riktig retning): nye Spill 1-3-rader får 15% minimum-fordeling istedenfor 30% (`ComplianceLedgerOverskudd.ts:75`). For en netto på 1000 kr fra Spill 1-3 skulle 150 kr ut til organisasjoner — før-fix gikk 300 kr ut. **Direkte regulatorisk korreksjon — Spillorama har overforpliktet seg til organisasjonene før fix.** SpinnGo-rader fortsatt 30% (korrekt).
3. **Hall-balance-readout knekker for Spill 1-3** (`adminHallEvents.ts:60-62`): listen `HALL_BALANCE_ACCOUNT_PAIRS` antar kun `DATABINGO`. Spill 1-3-penger lagres på `house-{hallId}-main_game-{channel}` etter fix, men admin-UI leser kun `house-{hallId}-databingo-{channel}`. Hallene ser saldo gå mot null for Spill 1-3 selv om penger fortsatt finnes på den nye kontoen. **Må fikses i samme PR.**
4. **HallSpecificReport-fallback**: `DATABINGO → game4` (`HallSpecificReport.ts:292`). Etter bytte havner Spill 1-3-rader uten slot-binding feil i `game1` (riktig nå); SpinnGo (`spillorama`-slug) routes via slot eller faller på DATABINGO-fallback. Gamle Spill 1-3-rader fortsatt i `game4`. **Historisk data omklassifiseres ikke.**
5. **Overskudd-batch-historikk** (`app_rg_overskudd_batches.game_type`): historiske batcher for Spill 1-3-trafikk bevares som DATABINGO; nye lages som MAIN_GAME. SpinnGo-batches uendret. Dashboard-filter "vis kun MAIN_GAME" vil skjule Spill 1-3-data fra før bytte-dato.

### Bakover-effekt (eksisterende rader)
- **Ingen automatisk migrering** — rader er immutable per § 71-trigger på `app_regulatory_ledger` (men `app_rg_compliance_ledger` har ikke samme trigger; den **er** mutable i DB). Likevel: data-integritet og hash-kjede-prinsipp tilsier at vi ikke retroaktivt re-skriver gameType uten en kompenserende ledger-rad.
- **Wallet-balanser** for Spill 1-3-trafikk står på gamle account-IDs (`house-…-databingo-…`). Hvis vi ikke migrerer disse, har hallene "to lommebøker" for Spill 1-3: den gamle med opphopet saldo, og den nye for nye salg. SpinnGo-konti urørt.

## §3 §11 overskudd-fordeling

**Nåværende kode:** `ComplianceLedgerOverskudd.ts:75` — DATABINGO ⇒ 0.30, MAIN_GAME ⇒ 0.15.

Per `docs/engineering/TECHNICAL_BACKLOG.md:177-178` er regelen: "Main game min 15% to organizations" / "Databingo min 30% to organizations". Per [SPILLKATALOG.md](../architecture/SPILLKATALOG.md) §2 (korrigert 2026-04-25): Spill 1-3 er hovedspill (15%); SpinnGo er databingo (30%).

**Konklusjon:** §11-kalkyle-koden (`gameType === "DATABINGO" ? 0.3 : 0.15`) er **strukturelt korrekt**. Problemet er at call-sites for Spill 1-3 hardkoder `gameType="DATABINGO"`, slik at 30%-grensen feilaktig trigges. Etter fix vil Spill 1-3 trigge 15%-grensen (riktig per pengespillforskriften §11 for hovedspill); SpinnGo fortsetter på 30% (riktig for databingo). PM-avklaring om hall-organisasjons-avtaler er fortsatt nødvendig — hvis hallene avtalemessig har lovet 30% for Spill 1-3 (uavhengig av lovkategori), må regelen overstyres per hall.

## §4 RNG-sertifiseringsdokumenter

Sjekket dokument-statuser:

| Fil | Status-felt | Innsendt? |
|---|---|---|
| `docs/compliance/KRITISK1_RNG_SERTIFISERINGSPLAN.md` | "Status: LUKKET — ekstern sertifisering er ikke regulatorisk paakrevd" | **Nei** — interne utkast. Linje 11: "Pengespillforskriften stiller ingen krav til ekstern RNG-sertifisering." |
| `docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md` | "Document purpose: Formal algorithm description for submission to accredited RNG test laboratory." Tittel: "Spillorama Databingo" | **Nei** — formelt "klar for innsending", men sertifisering er aktivt avlyst per planen. |
| `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` | Linje 320: "Norsk regulering for databingo krever at spillsystemet er godkjent…" | Intern audit, ikke innsendt. |

**Koordinering:** Ingen ekstern koordinering nødvendig før korreksjon. Endring kan gjøres som ren intern-redigering i alle tre dokumenter — presisering av at Spillorama har **både** hovedspill (Spill 1-3) og databingo (SpinnGo), ikke at hele systemet er ett av delene.

Memory-fil `MEMORY.md` bekrefter: "no external RNG cert needed".

## §5 Test-impact

**18 testfiler** refererer DATABINGO/MAIN_GAME. Følgende vil knekke ved bytte (faktiske assertions, ikke bare typesetup) — scope er Spill 1-3-tester; SpinnGo-tester urørt:

| Fil | Antall DATABINGO | Knekker? | Notat |
|---|---|---|---|
| `apps/backend/src/game/Game1PayoutService.complianceLedger.test.ts:172` | 1 | **Ja** | `assert.equal(prizeCalls[0]!.gameType, "DATABINGO")` — skal endres til `"MAIN_GAME"`. |
| `apps/backend/src/game/Game1TicketPurchaseService.complianceLedger.test.ts:219` | 1 | **Ja** | Samme pattern. Skal endres til `"MAIN_GAME"`. |
| `apps/backend/src/game/ComplianceLedger.test.ts` | 47 | **Ja** | Hele suite bygd rundt DATABINGO som default-fixture. Krever omskriving — Spill 1-3-fixtures til MAIN_GAME, behold DATABINGO-fixtures der relevant for SpinnGo-tester. |
| `apps/backend/src/admin/reports/HallSpecificReport.test.ts:248` | 6 | **Ja** | Tester `DATABINGO → game4` fallback. Må oppdateres siden Spill 1 nå kommer som MAIN_GAME. |
| `apps/backend/src/sockets/__tests__/adminHallEvents.test.ts:336-364` | 5 | **Ja** | Tester `house-hall-a-databingo-hall` account-ID. Knekker både account-ID og `HALL_BALANCE_ACCOUNT_PAIRS`. Test må utvides til å verifisere begge gameTypes. |
| `apps/backend/src/spillevett/reportExport.test.ts` | 3 | Trolig | Tester label-mapping. |
| `apps/backend/src/spillevett/playerReport.test.ts` | 2 | Trolig | Mixer DATABINGO og MAIN_GAME — fortsatt gyldig hvis bare Spill 1-3 byttes. |
| `apps/backend/src/spillevett/__tests__/cross-game.test.ts` | 1 | Mulig | Ledger-fixture. |
| `apps/backend/src/game/BingoEngine.test.ts` | 7 | **Ja** | Engine-integrasjonstester for Spill 1. |
| `apps/backend/src/game/ticket.bin672.test.ts` | 3 | Nei | Bruker `DATABINGO60_SLUGS` (slugs, ikke gameType). |
| `apps/backend/src/routes/__tests__/adminUsers.test.ts` | 5 | Trolig | Setup/fixture. |
| `apps/backend/src/routes/__tests__/adminUniqueIdsAndPayouts.test.ts` | 1 | Mulig | |

**Estimat:** 9 testfiler **garantert** knekker, 4 ekstra **trolig** knekker. Total fixture-omskriving: minst 70 linjer over 13 filer.

## §6 Anbefalt fix-strategi (oppdatert 2026-04-25)

### (A) Bytt kode for Spill 1-3, ingen migrasjon
**Hva:** Endre alle Spill 1-3 call-sites (BingoEngine + Game1*Service + Game2Engine + Game3Engine + BingoEngineMiniGames) til `"MAIN_GAME"`. Behold SpinnGo-paths (game5-spesifikke) på `"DATABINGO"`. Ingen DB-migrasjon.
**Pros:** Minst risiko for data-integritet. Følger append-only-prinsippet.
**Cons:** Hall-balance-readout knekker for Spill 1-3 (account-ID-mismatch). Saldo "låst" på gammel `house-…-databingo-…`-konto for Spill 1-3-trafikk. Nye Spill 1-3-salg går til `house-…-main_game-…`. Rapporten splittes per dato. Krever **også** kodeendring i `adminHallEvents.ts:60-62` for å spørre begge gameTypes — som likevel er en migrasjon, bare i kode.

### (B) Bytt kode + backfill-migration ⭐ ANBEFALT
**Hva:**
1. Endre Spill 1-3 + mini-game call-sites til `"MAIN_GAME"`. SpinnGo (game5/spillorama) urørt på `"DATABINGO"`.
2. Lag DB-migrasjon som **(a)** legger inn kompenserende ledger-rader for historiske Spill 1-3-rader (eller en explicit `gameTypeBeforeMigration`-kolonne) og **(b)** wallet-transfers fra gamle `house-…-databingo-…` til nye `house-…-main_game-…`-kontoer per hall, **kun for Spill 1-3-andelen** av saldo (krever per-spill-trafikk-rekonstruksjon eller en konservativ split-strategi). Atomisk transaksjon under nattlig vedlikehold.
3. Oppdater `adminHallEvents.ts:60-62` `HALL_BALANCE_ACCOUNT_PAIRS` til å lese begge gameTypes per hall.
4. Oppdater `PrizePolicyManager.ts` defaults til å parametriseres per slug.

**Pros:** Renest sluttilstand. Hall-balance fungerer for både Spill 1-3 (15%) og SpinnGo (30%). Rapporter konsistente. Følger forskrift-krav korrekt.
**Cons:** Krever PM-godkjennelse av §11-prosent-endring for Spill 1-3 (15% kontra dagens feilaktige 30%). Krever code-freeze under migrasjon. Data-integritet: må dokumentere migrasjon i § 71-hovedboken som ADJUSTMENT-rader. Per-spill-trafikk-rekonstruksjon for wallet-balanser kan være vanskelig — alternativ er at hallene aksepterer at gammel saldo står på DATABINGO-konto og kun nye salg går til MAIN_GAME.

### (C) Bytt kode + migrasjon + ledger-versjon-flagg
**Hva:** Som (B), men legg til `app_rg_compliance_ledger.schema_version INT` med default 1. Etter migrasjon settes nye rader til version 2. Aggregering kan toggle mellom v1- og v2-semantikk.
**Pros:** Fullstendig audit-spor. Tilsvarende fungerer som "før vs etter"-rekonstruksjon ved revisjonstilsyn.
**Cons:** Mest kompleksitet. Mest test-impact. Overkill hvis bytte aldri repeteres.

**Anbefaling: (B)**, scope **kun Spill 1-3 + mini-games**. SpinnGo-paths (game5-spesifikk kode) skal **ikke** endres — SpinnGo er regulatorisk databingo (30%) og koden reflekterer dette korrekt. Refaktorering av `ComplianceLedgerOverskudd.ts:75` er ikke nødvendig — den lese-koden er strukturelt korrekt.

## §7 Beslutninger PM må ta (oppdatert 2026-04-25)

1. **§11-prosent**: Avklart per [SPILLKATALOG.md](../architecture/SPILLKATALOG.md) §2 — Spill 1-3 = 15% (hovedspill), SpinnGo = 30% (databingo). Hvis hall-organisasjons-avtaler avviker fra dette, må regelen overstyres per hall via konfigurasjon, ikke via gameType-feilklassifisering.
2. **Scope av bytte**: **Kun Spill 1-3 + tilhørende mini-games**. SpinnGo (Spill 4 / game5 / slug `spillorama`) skal **ikke** endres — den er korrekt klassifisert som DATABINGO i kode allerede.
3. **Wallet-migrasjon**: Skal vi konsolidere `house-…-databingo-…` ⇒ `house-…-main_game-…` per hall **for Spill 1-3-andelen** av historisk saldo, eller la dem stå parallelt og kun la nye salg gå til ny konto? Konsolidering krever code-freeze og per-spill-trafikk-rekonstruksjon (vanskelig). Anbefaling: parallell, oppdater `HALL_BALANCE_ACCOUNT_PAIRS` til å lese begge.
4. **Test-omskriving**: Godkjenn 9-13 testfiler oppdateres som del av bytte-PR (ikke som follow-up). Spill 1-3-fixtures → MAIN_GAME, SpinnGo-fixtures (hvis eksplisitte) beholdes som DATABINGO.
5. **RNG-dokumenter**: Bekreft at alle tre `KRITISK1_RNG_*.md` og `RNG_OG_BALLTREKNING_GJENNOMGANG_*.md` kan internredigeres for å presisere at Spillorama har **både** hovedspill og databingo (ikke at systemet er det ene eller andre). Status-felt sier "LUKKET — ikke paakrevd", så ingen ekstern koordinering. Cleanup sweep 2026-04-25 har gjennomført denne presiseringen.
6. **Sekvensering**: Bytte før eller etter pilot-launch av Spill 1? Anbefaling: **før** for å unngå at pilot-data ender opp på feil gameType-klassifisering. Hvis dette ikke er mulig, bytt umiddelbart etter pilot-stabilisering og dokumenter splittet i rapporten.

---

**Vedlegg — referanser brukt:**
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts` (§11-kjernen)
- `apps/backend/src/game/ComplianceLedgerAggregation.ts` (rapport-aggregering)
- `apps/backend/src/game/ComplianceLedgerValidators.ts` (account-ID-format)
- `apps/backend/src/sockets/adminHallEvents.ts:60-62` (hall-balance hardkoding)
- `apps/backend/migrations/20260413000001_initial_schema.sql:370-414` (DB-schema)
- `apps/backend/migrations/20260417000005_regulatory_ledger.sql` (separat § 71-hovedbok, ikke berørt)
- [docs/architecture/SPILLKATALOG.md](../architecture/SPILLKATALOG.md) §1, §2, §3 (korrigert klassifisering 2026-04-25)
- `docs/engineering/TECHNICAL_BACKLOG.md:177-178` (15% vs 30%-regelen)
- `docs/compliance/KRITISK1_RNG_SERTIFISERINGSPLAN.md` (status: LUKKET)
