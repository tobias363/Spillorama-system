# ADR-0015 — §71 Regulatory ledger: parallel-write to canonical hash-chained table

**Status:** Accepted
**Dato:** 2026-05-09
**Deciders:** Tobias (teknisk lead) + compliance-engineering
**Konsulterer:** Pengespillforskriften §71, Lotteritilsynet
**Supersedes (delvis):** ADR-0004 (hash-chain-audit) — denne ADR-en korrigerer to falske påstander om §71-data-laget; ADR-0004 forblir gyldig for wallet-laget men trenger oppdatering.

## Kontekst

§71-verifikasjons-arbeidet (mai 2026) avdekket at to migrasjons-tabeller var
definert men aldri brukt:

- `app_regulatory_ledger` (migrasjon `20260417000005`) — append-only ledger
  med hash-chain + immutability-trigger
- `app_daily_regulatory_reports` (migrasjon `20260417000006`) — daglig rapport
  med signed_hash (dag-til-dag-kjede)

Aktiv kode skrev i stedet til `app_rg_compliance_ledger` som **mangler**:

- Immutability-trigger (UPDATE/DELETE er teknisk mulig — ingen DB-vakt)
- Hash-chain (ingen `prev_hash`/`event_hash`-felter)
- Signed-hash på daglig rapport-nivå

For pilot-gating Q3 2026 må Lotteritilsynet kunne verifisere §71-data
tampersikkert. Dagens implementasjon er **ikke** tampersikker.

Konsekvens hvis vi går live uten fix:

- Audit-revisjon kan oppdage at §71-data ikke har integritets-garanti
- Pengespillforskriften §82 åpner for dagsbøter (50k-500k NOK presedens)
- Tap av tillit ved første review

## Beslutning

Vi implementerer **parallel-write** mellom `app_rg_compliance_ledger` og
`app_regulatory_ledger`:

```
ComplianceLedger.recordComplianceLedgerEvent(...)
  ├── INSERT app_rg_compliance_ledger    ← legacy, primary, untouched
  └── (optional sink, fire-and-forget)
        └── INSERT app_regulatory_ledger ← new, hash-chained, immutable
```

Sink er **non-blocking**: feil i §71-store logges men forplanter seg
aldri til wallet-touch. Legacy-flyten forblir system-of-record under
overgangsperioden (~1 måned dual-write data) hvoretter vi kan flippe
primary path slik at `app_regulatory_ledger` blir kanonisk.

For daglig rapport bygges `DailyRegulatoryReportService` som aggregerer
fra `app_regulatory_ledger` og skriver hash-chain-signerte rader til
`app_daily_regulatory_reports`.

### Hash-chain design

**Per-event (`app_regulatory_ledger.event_hash`):**

- ÉN global kjede over alle events
- SHA-256 input: `prev_hash || canonicalJSON(felter)`
- `metadata` ekskludert fra hash (matches migrasjons-kommentar) — tampering
  med metadata bryter ikke kjeden, hvilket er OK fordi penge-beløp er ikke
  i metadata
- Concurrency: Postgres advisory-lock per insert (process-level — pilot er
  single-instance; multi-instance trenger row-lock-tightening)

**Per-dag (`app_daily_regulatory_reports.signed_hash`):**

- ÉN kjede per `(hall_id, channel)` tuple
- Begrunnelse: per-hall verifisering, kanal-skille matcher §11 (15% vs 30%)
- Alternativ vurdert: én global daglig kjede — forkastet fordi nye haller
  mid-pilot ville krevd chain-replay (operasjonelt skjørt)

### Mapping legacy → §71

- `STAKE` → `TICKET_SALE` (positiv amount)
- `PRIZE`, `EXTRA_PRIZE` → `PRIZE_PAYOUT` (negativ amount; `EXTRA_PRIZE` får
  `metadata.extraPrize=true` for traceability)
- `ORG_DISTRIBUTION`, `HOUSE_RETAINED`, `HOUSE_DEFICIT` → `ADJUSTMENT`
  (positiv amount, kontekst i metadata)

### Manglende §71-felter (G4)

Beregnes nå under daily-report-aggregering:

- `tickets_sold_count`: COUNT(*) av TICKET_SALE-rader
- `unique_players`: COUNT(DISTINCT user_id) av TICKET_SALE-rader (NOT NULL)
- `ledger_first_sequence`: MIN(sequence) per (date, hall, channel)
- `ledger_last_sequence`: MAX(sequence) per (date, hall, channel)

## Konsekvenser

### Positive

- §71-data har nå casino-grade integritets-garantier (mirror av wallet-
  laget BIN-764)
- Lotteritilsynet kan verifisere chain-integrity gjennom `verifyChain()`
  metoder på begge stores
- Backwards-compat fullt bevart — `app_rg_compliance_ledger` er uendret,
  alle eksisterende rapporter, query-er og tests fortsetter å fungere
- Idempotent re-run: cron kan kjøres flere ganger samme dag (UNIQUE-
  constraint blokkerer duplikate daily-report-rader)
- Per-hall chain isolerer audit-arbeid (én hall ned bryter ikke andre haller)

### Negative

- Dual-write øker DB-aktivitet (~2x INSERT per ledger-event under overgang)
- Process-level advisory-lock er ikke cross-instance (multi-instance pilot
  trenger row-lock-tightening — ikke pilot-blokker for single-instance Q3)
- Mapping er litt lossy (EXTRA_PRIZE collapses inn i PRIZE_PAYOUT, sentinel
  in metadata bevarer audit-kjede men ikke som distinct event-type)

### Nøytrale

- Etter ~1 måned dual-write kan vi flippe primary path — er en separat
  beslutning som krever audit av faktiske data først
- ADR-0004 må oppdateres for å reflektere at hash-chain er på TO laget
  (wallet på `app_wallet_entries`, §71 på `app_regulatory_ledger`)

## Alternativer vurdert

### Alternativ A: Migrere `app_rg_compliance_ledger` til å ha hash-chain

Legge til `prev_hash` + `event_hash` på eksisterende tabell + immutability-
trigger.

**Hvorfor ikke valgt:**

- Eksisterende rader (millioner) ville måtte backfilles med hash-kjede
- Risiko for å bryte aktive query-er som ikke forventer triggeren
- Migrasjons-tabellene `app_regulatory_ledger` + `app_daily_regulatory_reports`
  er allerede i prod (deploy-et) — å la dem stå ubrukt er forvirrende
- Mappings legacy → §71 er ikke 1:1 (event-type collapse), så vi vil
  uansett trenge separat tabell

### Alternativ B: Slett migrasjonene + skriv hash-chain-felter til `app_rg_compliance_ledger`

Som A, men også fjerne de ubrukte tabellene.

**Hvorfor ikke valgt:**

- Migrasjoner er allerede i prod — fjerning krever DROP-migrasjon som er
  destruktiv
- Mister muligheten til å ha klart skille mellom OPERASJONELT ledger og
  §71-CANONICAL ledger

### Alternativ C: Synchronous write til begge tabeller (samme transaksjon)

I stedet for fire-and-forget, gjøre §71-write i samme transaksjon som
legacy-write.

**Hvorfor ikke valgt:**

- §71-store outage ville da blokkere wallet-touch — uakseptabelt for pilot
  (one bad migration kan ta ned hele drift)
- Hash-chain advisory-lock kan blokkere lenge under last → ledger-write-
  latency på wallet-pathen
- Etter overgangsperioden kan vi vurdere å flippe primary path (Alternativ C
  for §71-store) — men ikke under transition

## Implementasjon

Lokasjon: `apps/backend/src/compliance/regulatory/`

| Fil | Ansvar |
|---|---|
| `RegulatoryLedgerHash.ts` | SHA-256 + canonical-JSON helpers |
| `RegulatoryLedgerStore.ts` | Postgres adapter for `app_regulatory_ledger` + `app_daily_regulatory_reports` |
| `RegulatoryLedgerService.ts` | Maps legacy entry → §71 shape |
| `DailyRegulatoryReportService.ts` | Aggregerer + skriver daglig rapport-rad |
| `*.test.ts` | 41 unit-tester |
| `README.md` | Dev-dokumentasjon |

Wiring: `apps/backend/src/index.ts` boot, etter `complianceLedgerPort`-closure.
Hooked inn via `engine.getComplianceLedgerInstance().setRegulatoryLedgerSink()`.

Daily-report integrert via `createDailyReportScheduler({ regulatoryReportService })`.

## Test-status

- 41 unit-tester på pure-functions (hash, mapping) — alle grønne
- Eksisterende ComplianceLedger-tests (35 tester) — fortsatt grønne (backwards-
  compat verifisert)
- Integration-test mot live Postgres ikke i denne PR-en — kjøres som del av
  `npm run test:e2e` på CI

## G5+ followups (ikke i denne ADR-en)

- G1: Sendings-kanal til Lotteritilsynet (avventer brev-svar)
- G5: `npm run verify:audit-chain` script (skeleton finnes, trenger CLI)
- G6: Lotteritilsynet format-bekreftelse
- G7: PDF-export
- G9: Wallet vs ledger reconciliation
- G10: Real-time dashboard
- G11: XML/iXBRL hvis Lotteritilsynet krever
- G12: Backfill av `app_rg_compliance_ledger` → `app_regulatory_ledger`

## Referanser

- Pengespillforskriften §71 — rapporteringsplikt
- ADR-0004 — hash-chain-audit (for wallet-laget; må oppdateres for §71-laget)
- BIN-764 — wallet hash-chain (mønster vi mirror-er)
- `docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md` — fullstendig
  verifikasjons-rapport som drev dette arbeidet
- Migration `20260417000005_regulatory_ledger.sql`
- Migration `20260417000006_daily_regulatory_reports.sql`
- PR `feat/spill71-g2-g4-regulatory-ledger`
