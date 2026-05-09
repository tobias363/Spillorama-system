# §71 daglig-rapport: verifikasjon for pilot Q3 2026

**Dato:** 2026-05-09
**Forfatter:** Compliance-engineering (Claude Opus 4.7)
**Status:** Pilot-go/no-go-vurdering — **NO-GO uten kritiske fixer**
**Eier:** Tobias Haugen (teknisk lead)
**Foranledning:** Pilot-go-live Q3 2026 (4 haller, Teknobingo Årnes som master)
**Linear:** TBD — anbefales opprettet som "Compliance: §71 daily-report parity" med 3-5 sub-issues
**Skal leses sammen med:**
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` (gameType + cap-regler)
- `docs/architecture/SPILLKATALOG.md` (regulatorisk klassifisering)
- `apps/backend/src/spillevett/reportExport.ts` (PDF-generator for spiller-rapport — IKKE §71)
- `apps/backend/src/game/ComplianceLedgerAggregation.ts` (faktisk §71-aggregator-kode)
- `apps/backend/openapi.yaml` linje 4940+ (`/api/admin/reports/daily/*`)

---

## TL;DR

Spillorama har **byggekloss-paritet** med §71-krav (data finnes, aggregator fungerer, hash-chain på wallet-nivå er på plass, idempotency-key håndhevet), men **leveranse-paritet mangler**:

1. **Ingen sendings-kanal** til Lotteritilsynet — verken e-post, SFTP, REST eller portal-upload
2. **`app_regulatory_ledger` + `app_daily_regulatory_reports`-tabellene er definert i migrasjon men ingen TypeScript-kode skriver til dem** — den faktiske aggregatoren leser fra `app_rg_compliance_ledger` (en helt annen tabell uten hash-chain eller immutability-trigger)
3. **`npm run verify:audit-chain`-script som ADR-0004 og README hevder finnes — eksisterer ikke**
4. **Dag-til-dag-kjede (signed_hash) som migrasjonen krever — ingen kode beregner den**
5. **Output-format ikke verifisert mot Lotteritilsynet** — vi har JSON + CSV, men forskriften spesifiserer ikke format. Felter må antakeligvis utvides (TICKETS_SOLD_COUNT, UNIQUE_PLAYERS) for å matche tabellens spesifikke kolonner

**Pilot-blokker:** Ja, hvis Lotteritilsynet faktisk krever rapport innenfor 24t etter forretningsdag-slutt. **Ikke-blokker** hvis pilot kan kjøre på best-effort med manuell rapport på forespørsel (vurdering må gjøres av Tobias / juridisk).

---

## 1. Forventet rapport-format (pengespillforskriften §71)

### 1.1 Forskriftstekst

Pengespillforskriften, **§71. Rapportering av omsetning og premier**, sier:

> Tillatelsesinnehaveren skal daglig rapportere omsetning av bonger og utdeling av premier til
> Lotteritilsynet. Rapporten skal være tilgjengelig for kontroll innen 24 timer etter
> forretningsdagens utløp.

Kilde: [Lovdata.no — pengespillforskriften kapittel 11 (§§64-72)](https://lovdata.no/forskrift/2025-03-13-466). Lotteritilsynet er
ansvarlig myndighet for tolkning og kontroll.

### 1.2 Påkrevde data-felter (utleder fra forskriften + bransje-norm)

Forskriften spesifiserer ikke et eksakt rapport-skjema, men sammenholdt med:

- §11 (organisasjons-distribusjon) — som krever skiller mellom hovedspill (15%) og databingo (30%)
- §64 (spilleplan) — som krever per-hall- og per-spill-data
- Lotteritilsynets generelle krav til regnskapsrapporter (analog til Norsk Tipping/Rikstoto)

… må rapporten inneholde minst følgende **per (forretningsdag, hall, spill-type, kanal)**:

| Felt | Beskrivelse | Eksisterer i vår kode? |
|---|---|---|
| `report_date` | Forretningsdag (YYYY-MM-DD, Europe/Oslo) | ✅ `report.date` |
| `hall_id` | Hall-ID | ✅ `row.hallId` |
| `game_type` | MAIN_GAME / DATABINGO | ✅ `row.gameType` |
| `channel` | HALL / INTERNET | ✅ `row.channel` |
| `gross_turnover` (NOK) | Sum innkjøp av bonger | ✅ `row.grossTurnover` |
| `prizes_paid` (NOK) | Sum utbetalt til spillere | ✅ `row.prizesPaid` |
| `net` (NOK) | grossTurnover − prizesPaid | ✅ `row.net` |
| `tickets_sold_count` | Antall bonger solgt | ⚠️ `row.stakeCount` finnes men teller LEDGER-events, ikke bonger |
| `unique_players` | Antall distinkte spillere | ❌ Ikke i `DailyComplianceReport` (finnes i `RevenueSummary` kun) |
| `ledger_first_sequence` | Første rad-sekvens i kjeden | ❌ Ikke beregnet |
| `ledger_last_sequence` | Siste rad-sekvens i kjeden | ❌ Ikke beregnet |
| `prev_hash` | SHA-256 av forrige dags signed_hash | ❌ Ikke beregnet |
| `signed_hash` | SHA-256 av rad + prev_hash (tampersikring) | ❌ Ikke beregnet |
| `house_retained` | Split-rounding rest-øre (audit) | ✅ `row.houseRetained` (HIGH-6) |

Felter merket ❌ finnes som **kolonner i migrasjons-skjemaet `app_daily_regulatory_reports`** (se §3.4
nedenfor), men beregnes IKKE av aktiv kode.

### 1.3 Sendings-kanal og tidsfrist

Forskriften sier "tilgjengelig for kontroll innen 24 timer". Det innebærer (basert på praksis fra
Norsk Tipping/Rikstoto):

- **Push-modell:** daglig SFTP-opplasting eller e-post med signert PDF til Lotteritilsynet
- **Pull-modell:** REST-endepunkt med Lotteritilsynet-allowlist

**Spillorama-implementasjon:** **ingen.** Det finnes ingen kode som sender rapport noensteds —
verken til Lotteritilsynet, til regnskap, eller til hall-operatør automatisk. Daglige rapporter
arkiveres kun lokalt i Postgres (`app_daily_reports`-snapshot via persistence-laget) og må hentes
manuelt via `GET /api/admin/reports/daily/archive/:date` av en admin med
`DAILY_REPORT_READ`-permission.

---

## 2. Vår nåværende implementasjon

### 2.1 Aktiv kode-sti

```
[ledger-write]                        [aggregator]              [HTTP / cron]
─────────────                          ──────────                 ───────────
recordComplianceLedgerEvent       →   generateDailyReport   →   POST /api/admin/reports/daily/run
  (BingoEngine, mini-games,           (in-memory iter             POST /api/admin/reports/daily?format=csv
   ticket-purchase, payout)           over complianceLedger       cron tick (yesterdayOsloKey)
                                       array)
                                                              →   archive: app_daily_reports
                                                                  (snapshot-rad i Postgres)
```

**Filer:**

- `apps/backend/src/game/ComplianceLedger.ts:354-462` — barrel for `generateDailyReport`,
  `runDailyReportJob`, `exportDailyReportCsv`. Delegerer til `ComplianceLedgerAggregation.ts`.
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:43-156` — kjernen, ren funksjon, ingen
  side-effekter. Tar `entries: ReadonlyArray<ComplianceLedgerEntry>` + `{ date, hallId?,
  gameType?, channel? }` og returnerer `DailyComplianceReport`.
- `apps/backend/src/game/ComplianceLedgerAggregation.ts:678-733` — `exportDailyReportCsv` med 12
  kolonner (date, hall_id, game_type, channel, gross_turnover, prizes_paid, net, stake_count,
  prize_count, extra_prize_count, house_retained, house_retained_count) + `ALL`-summary-rad.
- `apps/backend/src/game/ComplianceLedgerOverskudd.ts:71-85` — §11-prosent-kalkyle:
  `minimumPercent: row.gameType === "DATABINGO" ? 0.3 : 0.15`. Fordeler proporsjonalt over
  organisasjons-allokeringer.
- `apps/backend/src/game/ledgerGameTypeForSlug.ts:81-98` — slug → `MAIN_GAME` / `DATABINGO`-mapping.
  Sannhetskilde for §11-klassifisering.
- `apps/backend/src/util/schedulerSetup.ts:312-340` — `createDailyReportScheduler`. Tick-er hver time,
  kjører `runDailyReportJob({ date: yesterdayOsloKey(now) })` så snart en ny Oslo-dag starter.
  Default-aktivert (`DAILY_REPORT_JOB_ENABLED=true`, default-intervall `DAILY_REPORT_JOB_INTERVAL_MS`
  = 60 min).
- `apps/backend/src/routes/adminReports.ts:80-147` — HTTP-endepunkter:
  - `POST /api/admin/reports/daily/run` (krever `DAILY_REPORT_RUN`-perm: ADMIN/HALL_OPERATOR/AGENT)
  - `GET /api/admin/reports/daily?date=YYYY-MM-DD&format=json|csv` (DAILY_REPORT_READ)
  - `GET /api/admin/reports/daily/archive/:date` (DAILY_REPORT_READ)

### 2.2 Ledger-event-felter persistert

**Tabell:** `app_rg_compliance_ledger` (definert i `migrations/20260413000001_initial_schema.sql:369`).

Felter (per `ComplianceLedgerEntry` i `ComplianceLedgerTypes.ts:45-65`):

```typescript
{
  id: string,                   // UUID
  createdAt: string,            // ISO 8601
  createdAtMs: number,          // epoch ms
  hallId: string,               // KJØPE-hallens ID (PR #443 fix)
  gameType: "MAIN_GAME" | "DATABINGO",
  channel: "HALL" | "INTERNET",
  eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE" | "ORG_DISTRIBUTION" | "HOUSE_RETAINED" | "HOUSE_DEFICIT",
  amount: number,               // NOK med 2 desimaler
  currency: "NOK",
  roomCode?: string,
  gameId?: string,              // scheduledGameId for Spill 1
  claimId?: string,
  playerId?: string,
  walletId?: string,
  sourceAccountId?: string,
  targetAccountId?: string,
  policyVersion?: string,
  batchId?: string,             // Settes ved ORG_DISTRIBUTION
  metadata?: Record<string, unknown>,
  idempotencyKey: string,       // PILOT-STOP-SHIP 2026-04-28
}
```

**Idempotency:** UNIQUE-index `idx_app_rg_compliance_ledger_idempotency` (BIN-685, migrasjon
`20260428080000_compliance_ledger_idempotency.sql`). INSERT bruker `ON CONFLICT (idempotency_key) DO
NOTHING` for å hindre dobbel-telling i §71-rapport ved soft-fail-retry. **10 unit-tests** verifiserer
dette i `apps/backend/src/game/ComplianceLedger.idempotency.test.ts` (alle grønne).

### 2.3 §71-felt-mapping fra forskriften → vår implementasjon

| §71-felt (utledet) | Mapping | Status |
|---|---|---|
| Daglig rapport per hall | `report.rows` filtrert på `hallId` | ✅ |
| Hovedspill (Spill 1-3) skille | `gameType=MAIN_GAME` per `ledgerGameTypeForSlug.ts` | ✅ Korrekt klassifisering |
| Databingo (SpinnGo) skille | `gameType=DATABINGO` for slug `spillorama`/`game5` | ✅ |
| Hall-kanal (kontant) | `channel=HALL` for `cash_agent`/`card_agent` | ✅ Per `Game1TicketPurchaseService.ts:605` |
| Internett-kanal (digital wallet) | `channel=INTERNET` for `digital_wallet` | ✅ |
| Omsetning (gross_turnover) | Sum `STAKE`-events per (hall, gameType, channel) | ✅ |
| Premier (prizes_paid) | Sum `PRIZE` + `EXTRA_PRIZE`-events | ✅ |
| Netto (gross − prizes) | Beregnet i `generateDailyReport`-funksjonen | ✅ |
| §11-distribusjon | 15% MAIN_GAME / 30% DATABINGO via `previewOverskuddDistribution` | ✅ |
| Multi-hall-binding (kjøpe-hall) | `actor_hall_id` = `input.hallId` på purchase | ✅ PR #443 |
| Daglig kjede (prev_hash → signed_hash) | Migrasjon definerer det, men koden beregner det IKKE | ❌ |
| Tampersikring | `app_rg_compliance_ledger` har INGEN immutability-trigger | ❌ |
| Sendings-kanal | Ingen — manuelt admin-pull via REST-endepunkt | ❌ |
| Tidsfrist (24t) | Cron kjører hver time, fanger neste Oslo-dag automatisk | ✅ |

---

## 3. Verifikasjons-tester

### 3.1 Test 1 — Faktisk output-shape (kjørt 2026-05-09)

Vi kjørte `docs/compliance/scripts/spill71-report-shape-probe.ts` mot `ComplianceLedgerAggregation.ts`
direkte. Probe-en simulerer 7 ledger-events (5 STAKE/PRIZE for Spill 1, 1 STAKE/PRIZE for SpinnGo,
1 HOUSE_RETAINED) over to haller (Teknobingo Årnes + Bodø) og to spill-typer.

**Resultat — kanonisk JSON-output (`POST /api/admin/reports/daily/run`):**

```json
{
  "date": "2026-05-09",
  "generatedAt": "2026-05-08T22:02:49.204Z",
  "rows": [
    {
      "hallId": "afebd2a2-52d7-4340-b5db-64453894cd8e",
      "gameType": "DATABINGO",
      "channel": "INTERNET",
      "grossTurnover": 100,
      "prizesPaid": 25,
      "net": 75,
      "stakeCount": 1,
      "prizeCount": 1,
      "extraPrizeCount": 0,
      "houseRetained": 0,
      "houseRetainedCount": 0
    },
    {
      "hallId": "b18b7928-3469-4b71-a34d-3f81a1b09a88",
      "gameType": "MAIN_GAME",
      "channel": "HALL",
      "grossTurnover": 80,
      "prizesPaid": 1000,
      "net": -920,
      "stakeCount": 2,
      "prizeCount": 1,
      "extraPrizeCount": 0,
      "houseRetained": 0.05,
      "houseRetainedCount": 1
    },
    {
      "hallId": "b18b7928-3469-4b71-a34d-3f81a1b09a88",
      "gameType": "MAIN_GAME",
      "channel": "INTERNET",
      "grossTurnover": 75,
      "prizesPaid": 0,
      "net": 75,
      "stakeCount": 1,
      "prizeCount": 0,
      "extraPrizeCount": 0,
      "houseRetained": 0,
      "houseRetainedCount": 0
    }
  ],
  "totals": {
    "grossTurnover": 255,
    "prizesPaid": 1025,
    "net": -770,
    "stakeCount": 4,
    "prizeCount": 2,
    "extraPrizeCount": 0,
    "houseRetained": 0.05,
    "houseRetainedCount": 1
  }
}
```

**Resultat — CSV-eksport (`GET /api/admin/reports/daily?date=2026-05-09&format=csv`):**

```csv
date,hall_id,game_type,channel,gross_turnover,prizes_paid,net,stake_count,prize_count,extra_prize_count,house_retained,house_retained_count
2026-05-09,afebd2a2-52d7-4340-b5db-64453894cd8e,DATABINGO,INTERNET,100,25,75,1,1,0,0,0
2026-05-09,b18b7928-3469-4b71-a34d-3f81a1b09a88,MAIN_GAME,HALL,80,1000,-920,2,1,0,0.05,1
2026-05-09,b18b7928-3469-4b71-a34d-3f81a1b09a88,MAIN_GAME,INTERNET,75,0,75,1,0,0,0,0
2026-05-09,ALL,ALL,ALL,255,1025,-770,4,2,0,0.05,1
```

**Verdier matcher forventning:**
- ✅ Per-hall-skille (hver hall har egen rad per gameType/channel)
- ✅ MAIN_GAME / DATABINGO skiller
- ✅ HALL / INTERNET skiller
- ✅ Net = grossTurnover − prizesPaid
- ✅ HOUSE_RETAINED separert fra prizesPaid (HIGH-6 dual-balance bevart)
- ✅ Sortering: hallId → gameType → channel (som `ComplianceLedgerAggregation.ts:114-124`)
- ❌ **Mangler:** unique_players, tickets_sold_count (vs ledger-events), prev_hash, signed_hash,
  ledger sequence-bounds

### 3.2 Test 2 — gameType-skiller (Spill 1-3 = MAIN_GAME, SpinnGo = DATABINGO)

Verifisert via `ledgerGameTypeForSlug.ts` (file ref: `apps/backend/src/game/ledgerGameTypeForSlug.ts:55-69`):

```typescript
const SPILL1_SLUGS = new Set(["bingo", "game_1"]);          // MAIN_GAME
const SPILL2_SLUGS = new Set(["rocket", "game_2", "tallspill"]); // MAIN_GAME
const SPILL3_SLUGS = new Set(["monsterbingo", "mønsterbingo", "game_3"]); // MAIN_GAME
// SpinnGo (`spillorama` / `game_5`) → DATABINGO (default-fallthrough)
```

Bekreftet i unit-test `apps/backend/src/game/ComplianceLedger.test.ts` (kjørte 2026-05-09):
**25 av 25 tester grønne.**

```text
✔ generateDailyReport beregner riktig grossTurnover, prizesPaid og net per hall/gameType/channel (0.344ms)
✔ exportDailyReportCsv genererer gyldig CSV med header og total-rad (0.145125ms)
✔ HIGH-6: generateDailyReport aggregerer HOUSE_RETAINED som egen dimensjon, ikke i prizesPaid (0.102917ms)
[…]
ℹ tests 25  ℹ pass 25  ℹ fail 0
```

### 3.3 Test 3 — §11-prosent-distribusjon (15% MAIN_GAME / 30% DATABINGO)

Probe-en kjørte `previewOverskuddDistribution` mot rapporten over og bekreftet:

```text
─── §11 minimum-distribusjon-preview (Hovedspill 15%, Databingo 30%) ───
{
  "requiredMinimum": 33.75,        // (75 × 0.30) + (75 × 0.15) = 22.5 + 11.25
  "distributedAmount": 33.75,
  "transfers": [
    { "gameType": "DATABINGO", "amount": 11.25 },  // 50% × 22.50 (org-1)
    { "gameType": "DATABINGO", "amount": 11.25 },  // 50% × 22.50 (org-2)
    { "gameType": "MAIN_GAME", "amount": 5.62 },   // 50% × 11.25 (org-1)
    { "gameType": "MAIN_GAME", "amount": 5.63 }    // 50% × 11.25 (org-2, +0.01 rest)
  ]
}

─── Verifisering — §11-prosent per gameType ───
  hall=afebd2a2.. gameType=DATABINGO channel=INTERNET net=75 expected_§11_amount=22.50 (30%)
  hall=b18b7928.. gameType=MAIN_GAME channel=HALL net=-920 expected_§11_amount=0.00 (15%)  ← negativ net distribueres ikke
  hall=b18b7928.. gameType=MAIN_GAME channel=INTERNET net=75 expected_§11_amount=11.25 (15%)
```

**Verifikasjons-funn:**
- ✅ Korrekte prosenter per gameType
- ✅ Negativ `net` (dvs. utbetaling > omsetning) distribueres ikke (`Math.max(0, row.net)` i
  `ComplianceLedgerOverskudd.ts:76`)
- ✅ Rundings-rest tillegges første allocation (sum-invariant bevart, `0.01 NOK` til org-2)
- ✅ Source-account skiller på gameType (`house-{hallId}-databingo-internet` vs
  `house-{hallId}-main_game-internet`)

### 3.4 Test 4 — Multi-hall actor_hall_id-binding (PR #443)

Verifisert via kode-inspeksjon av `Game1TicketPurchaseService.ts:606-624`:

```typescript
await this.complianceLedgerPort.recordComplianceLedgerEvent({
  hallId: input.hallId,                        // KJØPE-hallens ID (ikke master)
  gameType: ledgerGameTypeForSlug("bingo"),   // MAIN_GAME for Spill 1
  channel,                                     // HALL eller INTERNET basert på paymentMethod
  eventType: "STAKE",
  amount: centsToAmount(totalAmountCents),
  gameId: input.scheduledGameId,
  playerId: input.buyerUserId,
  // ...
});
```

Tilsvarende verifisert i:
- `Game1PayoutService.ts:390` — PRIZE bindes til VINNERENS kjøpe-hall (`winner.hallId` fra
  `app_game1_ticket_purchases.hall_id`)
- Mini-game-orchestrator + pot-evaluator (begge via `complianceLedgerPort`)

**Konsekvens:** §71-rapport per hall blir korrekt for multi-hall-runder hvor 4 haller deler én
draw-engine. Dette var en P0 regulatorisk fix (CRIT-1) lukket i K1-bølgen.

### 3.5 Test 5 — Audit hash-chain integrity

**Status:** ❌ Ikke verifiserbar med nåværende implementasjon.

**Funn:**
- `npm run verify:audit-chain` finnes IKKE i `apps/backend/package.json` — ADR-0004 og
  `apps/backend/src/compliance/README.md:116,157` referer til et script som ikke eksisterer.
- Ingen fil med navn `verifyAuditChain*` eller `auditAnchor*` i hele backend-treet.
- `app_compliance_audit_log` (som ADR-0004 hevder finnes med prev_hash + curr_hash) — denne tabellen
  EKSISTERER IKKE. Faktisk admin-audit-tabell heter `app_audit_log` (migrasjon
  `20260418160000_app_audit_log.sql`) og har INGEN hash-felter.
- `app_audit_anchors`-tabellen (referert i `compliance/README.md:154`) EKSISTERER IKKE i migrasjons-treet.

**Hva FINNES av hash-chain:**
- `app_wallet_entries.entry_hash` + `previous_entry_hash` — wallet-nivå hash-chain (BIN-764,
  migrasjon `20260902000000_wallet_entries_hash_chain.sql`).
- `apps/backend/src/wallet/WalletAuditVerifier.ts` — verifiserer wallet-hash-chain.
- `apps/backend/src/jobs/walletAuditVerify.ts` — nightly cron som kjører verifier.
- `apps/backend/src/game/PayoutAuditTrail.ts:29-32` — in-memory hash-chain for payout-events
  (`chainIndex`, `previousHash`, `eventHash`).

**Konklusjon:** Wallet-laget har casino-grade hash-chain. **Compliance-ledger-laget (§71-data) har
det IKKE.** Det gir paradoksalt nok bedre integritet på wallet-tx (hvor pengene er) enn på rapport-
data (som er det Lotteritilsynet får). I prinsipp kan en angriper med DB-skrive-tilgang manipulere
`app_rg_compliance_ledger` uten oppdagelse.

---

## 4. Gap-analyse — hva mangler for §71-paritet

### 4.1 Kritisk (pilot-blokker hvis Lotteritilsynet håndhever 24t-frist)

| Gap | Beskrivelse | Estimat |
|---|---|---|
| **G1: Sendings-kanal** | Ingen automatisk push av rapport til Lotteritilsynet. Rapporten genereres + arkiveres lokalt, men sendes ikke noen sted. Lotteritilsynet må selv pull-e via REST (krever IP-allowlist + admin-credentials, ikke nå). | 3-5 dager |
| **G2: Tampersikring av §71-data** | `app_rg_compliance_ledger` har INGEN immutability-trigger. Sammenlign `app_regulatory_ledger` (migrasjon `20260417000005`) som har trigger + hash-chain — men er IKKE i bruk. Migrere aktiv kode til `app_regulatory_ledger`-tabellen. | 5-7 dager |
| **G3: Daglig signed-hash-kjede** | Migrasjonen for `app_daily_regulatory_reports` (20260417000006) krever `signed_hash` over `(report_date, hall_id, channel, ticket_turnover, prizes_paid, tickets_sold, unique_players, first_seq, last_seq, prev_hash)` — dette beregnes IKKE av aktiv kode. | 2-3 dager (når G2 er på plass) |
| **G4: Felter som mangler** | `unique_players`, `tickets_sold_count` (som faktisk antall bonger, ikke ledger-events), `ledger_first_sequence`, `ledger_last_sequence`. Alle finnes som kolonner i migrasjons-skjemaet `app_daily_regulatory_reports`, men beregnes ikke. | 2-3 dager |

**Sum:** 12-18 dev-dager. Bør gjøres som én sammenhengende bølge (G2 lager fundament, G3 + G4 bygger videre).

### 4.2 Viktig (ikke pilot-blokker, men compliance-risiko)

| Gap | Beskrivelse | Estimat |
|---|---|---|
| **G5: `verify:audit-chain`-script** | ADR-0004 + README hevder scriptet finnes. Implementer minimum to scripts: én for `WalletAuditVerifier` (eksisterer som job, mangler npm-script-binding) + én for ny `RegulatoryLedgerVerifier` (G2 leveranse). | 1 dag |
| **G6: Rapport-format-bekreftelse fra Lotteritilsynet** | Vi vet ikke om de godtar JSON, CSV, PDF, XML eller noe annet. Send eksempel-rapport (kan være fra demo-data) til Lotteritilsynet og be om format-bekreftelse FØR pilot. Krever ikke kode — krever brev. | 0 dev-dager + 2-4 ukers respons-tid fra Lotteritilsynet |
| **G7: PDF-versjon av §71-rapport** | Vi har PDF-generator for spiller-rapport (`reportExport.ts`), men ikke for daglig regulatorisk rapport. Hvis Lotteritilsynet krever PDF, må vi bygge det. Mal kan baseres på `Hall Account Report` (legacy 20-felter-tabell). | 2-3 dager |
| **G8: ADR-0004 oppdatering** | ADR sier at hash-chain er på `app_compliance_audit_log` med `prev_hash`/`curr_hash`. Faktisk er det på `app_wallet_entries` med `entry_hash`/`previous_entry_hash`. ADR må enten oppdateres med riktig info, eller migrasjon for ledger-hash-chain må kjøres. | 0.5 dag |

### 4.3 Nice-to-have (post-pilot, ikke blokker)

| Gap | Beskrivelse | Estimat |
|---|---|---|
| **G9: Avstemming mot wallet** | Daglig rapport bør sammenlignes mot wallet-tx-summer som consistency-check. Hvis avvik > 1 NOK → alert. | 2 dager |
| **G10: Real-time-dashboard for compliance** | Tobias / hall-operatør kan se "i dag så langt" uten å vente på cron. Bygges på `generateRangeReport` for siste 24t. | 1-2 dager (frontend tyngst) |
| **G11: Multi-format-eksport** | XML / iXBRL hvis Lotteritilsynet krever det (analog Norsk Tippings rapporter). | 3-5 dager |
| **G12: Backfill av eksisterende §71-data** | Hvis G2 migrerer til `app_regulatory_ledger`, må eksisterende `app_rg_compliance_ledger`-rader migreres over. ON CONFLICT-håndtering for å bevare idempotency. | 2-3 dager |

---

## 5. Anbefalinger til Tobias

### 5.1 Før pilot-go-live (kritisk)

1. **Send brev til Lotteritilsynet med spørsmål om format og kanal.** Inkluder eksempel-rapport (JSON
   + CSV fra §3.1 over) og spør:
   - "Aksepterer dere dette formatet?"
   - "Hvilken kanal foretrekker dere — SFTP, e-post, eller pull-API?"
   - "Hva er sanksjonen ved 24t-overskridelse?"
   - "Hva er forventet detaljnivå (per-spill, per-game, per-claim)?"

   Dette er **ikke et juridisk valg** — det er en faktisk-spørring som styrer scope.

2. **Implementer G2 + G3 + G4 (12-18 dev-dager)** — flytt aktiv kode til `app_regulatory_ledger` med
   hash-chain og immutability-trigger. Dette er allerede 80% gjort i migrasjons-skjemaet —
   TypeScript-laget mangler.

3. **Implementer G1 (3-5 dev-dager)** — minst e-post-utsendelse av PDF til
   `compliance@lotteritilsynet.no` (eller ekvivalent) hver morgen kl 06:00 Europe/Oslo. Bruk
   eksisterende `nodemailer`-oppsett fra `reportExport.ts`.

4. **Pilot-test:** Verifiser én gang at faktisk produserte rapport for én pilot-dag matcher
   manuelt-aggregert sum fra wallet-tx. Avvik > 1 NOK → STOP-SHIP.

### 5.2 Etter pilot-1 (P1)

5. Implementer G5 (`verify:audit-chain`-script) — knytt eksisterende `WalletAuditVerifier` til
   `package.json:scripts.verify:audit-chain` + bygg ny `RegulatoryLedgerVerifier` (G2-leveranse).
6. Implementer G7 (PDF-format) hvis Lotteritilsynet svarer at de krever det.
7. Oppdater ADR-0004 (G8) — realiteten samsvarer ikke med dokumentet.

### 5.3 Post-pilot (P2)

8. G9 — daglig avstemming wallet vs ledger.
9. G10 — real-time dashboard.
10. G11 — XML hvis Lotteritilsynet krever det.

---

## 6. Pilot-go/no-go-vurdering

### 6.1 Kan vi pilotere med dagens implementasjon?

**Det avhenger av Lotteritilsynets håndhevelse:**

| Scenario | Pilot-go? | Begrunnelse |
|---|---|---|
| **A: Lotteritilsynet håndhever 24t-frist strikt** | ❌ NO-GO | Ingen sendings-kanal. Vi blir formelt i compliance-brudd fra dag 1. |
| **B: Lotteritilsynet aksepterer manuell rapport på forespørsel** | ⚠️ BETINGET GO | Vi kan generere rapport via REST-endepunkt + sende manuelt på forespørsel. **Krav:** dokumentert i pilot-runbook + Tobias commit til å levere innen 4t hvis forespurt. |
| **C: Lotteritilsynet krever spesifikt format vi ikke har** | ❌ NO-GO | Hvis JSON/CSV ikke aksepteres, må vi bygge XML/PDF før pilot. |
| **D: Lotteritilsynet ikke informert om pilot** | ❌ NO-GO | Pilot er "regulatorisk drift" og må meldes inn. |

### 6.2 Compliance-risiko ved pilot-go uten G1-G4

Hvis pilot kjøres uten G1-G4:

- **Lavt sannsynlig:** Lotteritilsynet ber om rapport vi kan ikke levere på 24t.
- **Middels sannsynlig:** Audit-revisjon avdekker manglende hash-chain på §71-data.
- **Høyt sannsynlig:** Vi får krav om å fikse innen 30 dager fra Lotteritilsynet etter første audit.

**Pengespillforskriften §82 åpner for** dagsbøter ved brudd på rapporteringsplikt. Beløpene er ikke
spesifisert, men presedens fra Norsk Tipping/Rikstoto antyder kr 50.000 - 500.000 per dag etter en
første advarsel.

### 6.3 Anbefalt vei videre

**Min anbefaling (compliance-engineering):**

1. **Stopp pilot-go-live** inntil scenario A/B/C er avklart med Lotteritilsynet (brev + svar).
2. Hvis svaret peker mot scenario B (manuell på forespørsel): **GO med dagens kode + dokumentert
   pilot-runbook-prosedyre**.
3. Hvis svaret peker mot scenario A eller C: **NO-GO** — implementer G1-G4 først (12-18 dev-dager).

**Alternativt — Tobias' beslutning:**

Vurdér å piloteringen som "regulatorisk testing" snarere enn full produksjon. Pilot-haller varsles
om at dette er lukket testing under tilsyn. Lotteritilsynet får skriftlig forhåndsvarsel, og pilot
låses til 4-6 ukers vindu med begrenset omsetning. Dette gir tid til å implementere G1-G4 parallelt
uten å bryte rapport-plikt formelt.

---

## 7. Tabell — alle relevante filer og linjer

| Område | Fil | Linjer |
|---|---|---|
| Aggregator (kjerne) | `apps/backend/src/game/ComplianceLedgerAggregation.ts` | 43-156 (generateDailyReport), 678-733 (CSV-eksport) |
| §11-distribusjon | `apps/backend/src/game/ComplianceLedgerOverskudd.ts` | 71-85 (computeRowsWithMinimum), 108-191 (createBatch) |
| Slug → gameType | `apps/backend/src/game/ledgerGameTypeForSlug.ts` | 81-98 |
| Aktiv ledger-tabell | `apps/backend/migrations/20260413000001_initial_schema.sql` | 369-394 (`app_rg_compliance_ledger`) |
| Idempotency-key | `apps/backend/migrations/20260428080000_compliance_ledger_idempotency.sql` | 19-38 |
| **Ubrukt §71-tabell** | `apps/backend/migrations/20260417000005_regulatory_ledger.sql` | hele filen — `app_regulatory_ledger` med hash-chain |
| **Ubrukt §71-rapport-tabell** | `apps/backend/migrations/20260417000006_daily_regulatory_reports.sql` | hele filen — `app_daily_regulatory_reports` med signed_hash |
| Ledger-types | `apps/backend/src/game/ComplianceLedgerTypes.ts` | 15-65 (event-typer + entry-shape) |
| HTTP-endepunkter | `apps/backend/src/routes/adminReports.ts` | 80-147 (daily/run, daily, daily/archive) |
| OpenAPI | `apps/backend/openapi.yaml` | 4940-5050 (Admin — Ledger-tag) |
| Cron-scheduler | `apps/backend/src/util/schedulerSetup.ts` | 312-340 |
| RBAC | `apps/backend/src/platform/AdminAccessPolicy.ts` | 23-25 (DAILY_REPORT_RUN, DAILY_REPORT_READ) |
| Multi-hall-binding | `apps/backend/src/game/Game1TicketPurchaseService.ts` | 606-624 |
| Multi-hall payout-binding | `apps/backend/src/game/Game1PayoutService.ts` | 380-420 (PRIZE-event) |
| Hash-chain (wallet) | `apps/backend/migrations/20260902000000_wallet_entries_hash_chain.sql` | hele filen |
| Hash-chain verifier (wallet) | `apps/backend/src/wallet/WalletAuditVerifier.ts` | hele filen |
| Audit-trail (in-memory) | `apps/backend/src/game/PayoutAuditTrail.ts` | 29-130 |
| ADR-0004 (delvis utdatert) | `docs/adr/0004-hash-chain-audit.md` | hele filen — referer til app_compliance_audit_log som ikke finnes |
| Test (alle grønne) | `apps/backend/src/game/ComplianceLedger.test.ts` | 25 tester |
| Test idempotency (alle grønne) | `apps/backend/src/game/ComplianceLedger.idempotency.test.ts` | 10 tester |
| **Verifikasjons-script (denne PR)** | `docs/compliance/scripts/spill71-report-shape-probe.ts` | hele filen |

---

## 8. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-09 | Initial. Verifisert output-format mot kode + kjørt 35 grønne tester + identifisert 12 gaps. Pilot-go/no-go-vurdering: NO-GO uten G1-G4, BETINGET GO med Lotteritilsynet-bekreftet manuell-leveranse. | Compliance-engineering (Claude Opus 4.7) |

---

## 9. Referanser

- [Pengespillforskriften (lovdata.no)](https://lovdata.no/forskrift/2025-03-13-466) — kapittel 11
  (§§64-72), spesifikt §71 (rapportering)
- ADR-0002 — Perpetual room-modell (begrunner §64 + §71 hall-rapport)
- ADR-0003 — System-actor (driver `actor_hall_id`-binding)
- ADR-0004 — Hash-chain audit (delvis utdatert, krever revisjon)
- ADR-0008 — Spillkatalog-klassifisering (driver gameType-mapping)
- BIN-588 — AuditLogService
- BIN-685 — ComplianceLedger idempotency
- BIN-764 — Casino-grade wallet (hash-chain, outbox)
- PR #443 — actor_hall_id-fix for multi-hall
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — gameType + cap-regler (kanonisk)
- `docs/architecture/SPILLKATALOG.md` — regulatorisk klassifisering (Tobias-låst 2026-04-25)
- `docs/operations/PM_HANDOFF_2026-04-23.md` §6.7 — pilot-stop-ship for compliance-ledger
