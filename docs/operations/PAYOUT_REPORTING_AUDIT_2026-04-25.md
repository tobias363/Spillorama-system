# Payout & Avregning — Reporting Audit til Lotteritilsynet

**Forfatter**: Audit-agent (Tobias) | **Dato**: 2026-04-25 | **Branch**: `docs/payout-reporting-audit`

## Sammendrag (TL;DR)

Vi har **god dekning på interne avregnings-flyter** (Agent settlement, Hall Account Report, Withdraw XML, Compliance Ledger med daily-report) og **alt råstoff Lotteritilsynet ber om finnes i DB**. Men det vi i dag genererer er **ikke direkte koblet til Lotteritilsynets rapporteringsformat (Altinn LS-0003)** — det krever en ekstra mapping-/eksportlag.

**Rangering av rapporteringsstrategi:**
1. **Anbefalt MVP (Alt 2)**: Scheduled job + CSV/PDF e-post til regnskap → de manuelt fyller Altinn LS-0003. Bruker Compliance Ledger som finnes. ~3-5 dagers arbeid.
2. **Senere (Alt 1)**: On-demand PDF i admin-UI for ad-hoc revisjon. Lav effort, høy manuell kostnad per innsending. ~1-2 dager.
3. **Frafalt for nå (Alt 3)**: Direkte Altinn-API-integrasjon. **Lotteritilsynet har ikke åpen API for LS-0003** — kun interaktivt skjema med rolle "Utfyller/innsender". Sett av som backlog-item.

**Pilot-strategi**: Lever Alt 2 i én sprint mot pilot-hall, valider at regnskap-mottaker faktisk trenger det formatet vi sender, og om Altinn-skjemaet matcher feltene våre. Deretter beslutter vi om vi vil videreutvikle eller ikke.

---

## 1. Hva vi har nå

### 1.1 Inventar — kilder og rapport-typer

| Rapport-type | Filplassering | Format | Frekvens | Dekker / omfang |
|---|---|---|---|---|
| **Compliance Ledger Daily Report** | `apps/backend/src/game/ComplianceLedger.ts` + `ComplianceLedgerAggregation.ts` `generateDailyReport()` | JSON (in-mem) + CSV via `exportDailyReportCsv()` | Daglig, scheduled (ca 23:00 lokal) — `apps/backend/src/util/schedulerSetup.ts:194-227` | Per hall × game-type × channel: gross turnover, prizes paid, net, stake/prize counts. **Dette er det nærmeste vi kommer §11-rapportering**. |
| **Compliance Ledger Range Report** | `ComplianceLedgerAggregation.ts` `generateRangeReport()` | JSON | On-demand via admin-UI | Multi-day aggregering for kvartalsvis innsending. |
| **Daily Report Endpoints** | `apps/backend/src/routes/adminReports.ts:80-130` | JSON eller CSV (`?format=csv`) | On-demand | Admin GET `/api/admin/reports/daily?date=YYYY-MM-DD&format=csv`, hall-scope auto-filtreres for HALL_OPERATOR. |
| **Agent Settlement (15-rad breakdown)** | `apps/backend/src/agent/AgentSettlementService.ts` | JSON i DB + PDF via `apps/backend/src/util/pdfExport.ts` `generateDailyCashSettlementPdf()` | Per shift (1+ per dag per hall) | Per maskin: Metronia/OK Bingo/Franco/Otium IN/OUT/Sum + Norsk Tipping/Rikstoto + Rekvisita/Kaffe/Bilag/Bank/Gevinst overføring. **Dekker fullt PDF 16.25 / 17.10**. Nedlastbar receipt (bilag PDF/JPG). |
| **Hall Account Report (per hall, daglig)** | `apps/backend/src/compliance/HallAccountReportService.ts` | JSON | On-demand admin-UI | Ledger-derivert per dag × game-type, supplert med `app_hall_manual_adjustments` (BANK_DEPOSIT/WITHDRAWAL/CORRECTION/REFUND). |
| **Settlement List + Edit** | `apps/admin-web/src/pages/hallAccountReport/SettlementPage.ts` + `apps/backend/src/routes/agentSettlement.ts` | UI + JSON + PDF download | On-demand | Lister alle settlements per hall, GET PDF + GET receipt + PUT edit (audit-logget). |
| **Withdraw in Bank XML-eksport** | `apps/backend/src/admin/WithdrawXmlExportService.ts` (egen format, ikke pain.001) | XML på disk + e-post-vedlegg | Daglig kl 23 — `apps/backend/src/jobs/xmlExportDailyTick.ts` | Alle ACCEPTED bank-uttak siden forrige batch, per agent eller global. Fil + DB-batch-tracking + email-allowlist via `AccountingEmailService`. |
| **Withdraw in Hall** (kontant) | `apps/admin-web/src/pages/amountwithdraw/RequestsPage.ts` (Approve/Reject) | UI-kø + ledger-tx | Real-time | Spilleren henter kontant — bokføres mot hall.cash_balance. Ingen XML, kun in-system. |
| **Withdraw History** | `apps/admin-web/src/pages/amountwithdraw/HistoryPage.ts` | UI + CSV-eksport | On-demand | Hall + Bank kombinert, filter på dato + type. |
| **Past Winning History** (PDF 17.32) | `apps/admin-web/src/pages/reports/...` (#467 merged) | UI + CSV | On-demand | Spille-vinsthistorikk. |
| **Hall Specific Report** (PDF 17.36) | `apps/admin-web/src/pages/reports/hallSpecific/HallSpecificReportPage.ts` | UI + CSV | On-demand | Per-hall omsetning per spill-type. |
| **Total Revenue Report** | `apps/admin-web/src/pages/reports/totalRevenue/TotalRevenueReportPage.ts` | UI | On-demand | Aggregert over alle haller. |
| **Audit Log** | `apps/backend/src/compliance/AuditLogService.ts` | DB append-only + admin-UI search | Real-time skriving | Hver settlement-edit, payout, uttak-godkjenning, role-endring etc. — kompletterer rapportering med "hvem gjorde hva, når". |

### 1.2 Tekniske byggesteiner som er på plass

- **Append-only ComplianceLedger** med STAKE/PRIZE/EXTRA_PRIZE/ORG_DISTRIBUTION events (`apps/backend/src/game/ComplianceLedgerTypes.ts:17`). Dette er **kjernen for §11-rapportering**.
- **PDF-generator** (pdfkit-basert, `apps/backend/src/util/pdfExport.ts`) — kan brukes for både settlement og fremtidige Lotteritilsynet-rapporter.
- **CSV-eksport** av daily report finnes allerede (`exportDailyReportCsv`).
- **E-post-allowlist + dispatcher** for regnskap-mottakere (`AccountingEmailService` + `app_withdraw_email_allowlist`).
- **Scheduled jobs**-rammeverk (`JobScheduler.ts`) — vi vet hvordan vi legger på en ny daglig/kvartalsvis cron.
- **Hall-scope RBAC** (`AdminAccessPolicy.resolveHallScopeFilter`) — HALL_OPERATOR ser kun egen hall, ADMIN/SUPPORT ser alle.
- **Audit-trail** på settlement-edit (`PUT /api/admin/shifts/:shiftId/settlement` med `editedByUserId + editReason`).

---

## 2. Hva mangler

### 2.1 Gap mot wireframes

| Gap | Wireframe | Status nå | Notat |
|---|---|---|---|
| **PDF-eksport av Hall Account Report** | 16.23, 16.24 ("Download PDF iht dato") | Kun JSON/CSV via `/api/admin/reports/daily` | Vi har PDF for settlement, men ikke for selve Hall Account Report-tabellen. |
| **Lotteritilsynet/§11-rapport som eget skjema** | Ikke i wireframes | Ikke implementert | Wireframes dekker intern bingonett-regnskap, ikke ekstern myndighet. **Dette er gapet vi løser her**. |
| **Kvartalsvis aggregert rapport** | Ikke i wireframes | Manuelt — admin må kjøre range-report fire ganger | `generateRangeReport` finnes; mangler scheduled job + ferdig formatert kvartalsskjema. |
| **Eksplisitt §11-felt-mapping** | Ikke i wireframes | Mangler | Vi vet ikke 1:1 hvilke felt LS-0003 forventer. Krever pilot-test mot regnskap. |

### 2.2 Sannsynlige regulatoriske krav vi må dekke (pengespillforskriften kap. 11)

Basert på Lotteritilsynet/Lovdata research (kilder under):

1. **Daglig rapport** — *"Daglig rapport må føres for omsetning av bonger og fordeling av gevinster i hovedspill og databingo"* — vi har dette i ComplianceLedger.
2. **Kvartalsvis innsending fra entreprenør (medhjelper)** — *"Bingomedhjelpere skal rapportere fire ganger i året"* og *"sammendrag fra daglige rapporter sendes Lotteritilsynet innen 2 uker etter Q1 og Q3"*. Vi har data, mangler innsendingsformat.
3. **Årlig regnskap til 1. juni** — *"Organisasjonene skal sende regnskapsopplysninger til Lotteritilsynet hvert år innen 1. juni"*.
4. **Dokumentasjon på utbetaling til organisasjoner** — *"dokumentasjon av utbetalinger til den enkelte forening"*. Vi har `ORG_DISTRIBUTION`-event i ledger + `ComplianceLedgerOverskudd.ts` for fordeling.
5. **Format**: Altinn-skjema **LS-0003 "Rapporteringsskjema"**. Krever rolle "Utfyller/innsender". **Ingen offentlig API for innsending** — kun interaktivt skjema (verifisert via Altinn skjemaoversikt).

### 2.3 Manglende capabilities

- ❌ **Mapping fra Compliance Ledger-rad → LS-0003-feltnavn** (krever feltbeskrivelse fra Altinn-skjemaet eller pilottest).
- ❌ **Kvartalsvis sammendrag-rapport** som eget eksport-format (PDF/Excel egnet for vedlegg til Altinn).
- ❌ **"Hvem fyller inn LS-0003"** — tooling-mappe + e-post-allowlist for regnskap/økonomi-ansvarlig.
- ❌ **Formell QA-prosess** før innsending (4-eyes signoff på kvartalsrapport).
- ❌ **Auditor-bekreftelse hvis entreprenørmodell** (se memory `project_regulatory_requirements.md` punkt 8). Krever ekstern revisor-kobling (manuell).
- ⚠️ **Norsk Tipping Dag/Rikstoto Dag-feltene** flagges i wireframe som "reflekteres IKKE i rapport, kun Totalt" — verifiser at vi følger samme regel mot Lotteritilsynet.

---

## 3. Anbefaling — 3 alternativer

### Alt 1 — Manuell PDF-eksport via admin-UI (LAVESTE EFFORT, MEST MANUELT)

**Hva**: Legg til "Generer kvartalsrapport" -knapp i admin-UI under Hall Account Report. Kjører `generateRangeReport` for valgt kvartal og leverer PDF + CSV-bilag.

**Kost**: 1-2 dagers arbeid (én ny admin-side + PDF-template + reuse `pdfExport.ts`).

**Driftsbyrde**: Regnskap må manuelt åpne admin-panel hver kvartal, generere rapport, fylle inn LS-0003 i Altinn på basis av PDF-en. ~30-60 min per kvartal per hall.

**Risiko**: Glemmes lett. Ingen auto-reminder. Hver hall må gjøre dette selvstendig.

**Når dette passer**: Hvis vi har <5 haller og regnskap allerede har eksisterende månedsrytme.

---

### Alt 2 — Scheduled job + e-post til regnskap (MEDIUM EFFORT, SEMI-AUTOMATISK) ⭐ ANBEFALT

**Hva**: Tre nye komponenter:

1. **Cron-job** (`apps/backend/src/jobs/regulatoryReportTick.ts`) som hver 1. dag i Q+1 (1. apr / 1. jul / 1. okt / 1. jan) kjører `generateRangeReport` for forrige kvartal per hall.
2. **PDF + CSV eksport** med Lotteritilsynet-tilpasset feltnavn (mapping-tabell vi avtaler med pilot-hall):
   - Omsetning hovedspill (turnover MAIN_GAME)
   - Gevinster utbetalt hovedspill (prizes MAIN_GAME)
   - Omsetning databingo
   - Gevinster databingo
   - Andel til organisasjoner (`ORG_DISTRIBUTION`-events)
   - Antall spilte runder
3. **E-post via `AccountingEmailService`** til regnskap/økonomi-allowlist (gjenbruk av eksisterende `app_withdraw_email_allowlist` eller ny `app_regulatory_email_allowlist`).

**Kost**: 3-5 dagers arbeid:
- Dag 1: ny cron-tick + range-aggregator wrapper (gjenbruker `generateRangeReport`)
- Dag 2-3: PDF-template som matcher LS-0003-feltene + CSV-bilag
- Dag 3-4: e-post-flow + admin-UI for "send manuelt nå"-knapp + audit-log
- Dag 4-5: tester + dokumentasjon (runbook)

**Driftsbyrde**: Regnskap mottar e-post automatisk hvert kvartal med ferdig PDF + CSV-vedlegg. De fyller manuelt inn Altinn LS-0003 (ca 10-20 min per innsending).

**Risiko**: Lav. Hvis SMTP feiler, batch ligger i DB og kan re-sendes (samme retry-pattern som `xmlExportDailyTick`). Inntil pilot-test vet vi ikke 100% at PDF-feltene matcher LS-0003.

**Forutsetning**: Ett gjennomgang/pilot-tester med pilot-hall sin regnskapsfører for å validere PDF-formatet.

---

### Alt 3 — Direkte API-integrasjon mot Lotteritilsynet (HØY EFFORT, FULLSTENDIG AUTOMATISK)

**Hva**: Programmatisk innsending av LS-0003 via Altinn API.

**Status**: **Ikke gjennomførbart i dag**. Verifisert via Altinn skjemaoversikt og Lotteritilsynet-kontakt:
- Altinn LS-0003 er et **interaktivt skjema**, ikke API-basert innsending.
- Krever Altinn-rolle "Utfyller/innsender" som tilhører person/organisasjon, ikke maskin-bruker.
- Lotteritilsynet har ikke publisert offentlig API-kontrakt for bingo-rapportering.

**Hvis vi likevel vil**:
- Reverse-engineer Altinn-form-fields → bygge programmatisk submitter (juridisk gråsone, kan brytes når Altinn endrer skjemaet).
- Kontakte Lotteritilsynet (postmottak@lottstift.no / 57 82 80 00) for å høre om de planlegger åpen API.
- Vente til Altinn 3.0/Maskinporten utvider tjeneste-katalogen.

**Kost ved fremtidig API**: 10-15 dager (Maskinporten-integrasjon + felt-mapping + signing + retry-logikk + ekstra audit-trail).

**Anbefaling**: **Ikke prioriter nå**. Legg som backlog-item, ta opp til vurdering hvert år (sjekk om Lotteritilsynet har publisert API).

---

## 4. Foreslått pilot-strategi

### Minimum Viable Pilot (MVP) — 1 sprint (~5 dager)

**Scope**:
1. **Implementer Alt 2 i begrenset form**:
   - Ett nytt endpoint: `GET /api/admin/reports/regulatory/quarter?year=2026&quarter=1&hallId=X` som returnerer PDF.
   - Ingen automatisk cron ennå — kun on-demand.
   - PDF-template med følgende seksjoner: omsetning hovedspill, omsetning databingo, gevinster, organisasjons-fordeling, antall spilte runder per dag.
2. **Pilot-hall valider** med sin regnskapsfører at PDF-en matcher LS-0003-feltene.
3. **Iterér** på feltmapping basert på feedback — typisk 1-2 runder.

### Etter MVP-godkjent — full lansering (~3 dager til)

4. **Cron-job** som kjører automatisk hvert kvartal (1. apr / 1. jul / 1. okt / 1. jan kl 06:00 lokal).
5. **E-post-allowlist** for regnskap-mottakere per hall (eller global).
6. **Admin-UI**: "Send kvartalsrapport manuelt nå"-knapp + historikk-visning av tidligere innsendte batcher (gjenbruker `app_xml_export_batches`-pattern).
7. **Runbook** i `docs/operations/REGULATORY_REPORTING_RUNBOOK.md` som beskriver:
   - Hva som genereres når
   - Hvor mottakerne legges til
   - Hvordan re-sende om e-post feiler
   - Hvilke felt som mappes til LS-0003

### Hva som kan vente

- ❌ **Direkte Altinn-API-integrasjon** (Alt 3) — backlog-item.
- ❌ **Auto-fyll av LS-0003-skjema via Altinn-form-scraping** — backlog (juridisk vurdering først).
- ❌ **Auditor-revisor-portal** for ekstern bekreftelse (entreprenørmodell punkt 8) — manuell prosess inntil videre, vi sender PDF til revisor som vedlegg.
- ❌ **Per-organisasjon-fordeling-rapport** (overskudd til frivillige org) — krever egen runde med org-administrasjon når den modellen aktiveres. `ComplianceLedgerOverskudd.ts` har grunnlaget.
- ⚠️ **Norsk Tipping/Rikstoto sub-rapportering** — verifiser kravnivå (egne avtaler vs Lotteritilsynet-aggregat).

---

## 5. Konkrete neste-steg (handlingsorientert)

| # | Steg | Eier | Effort |
|---|---|---|---|
| 1 | Bekreft pilot-hall + få kontakt med deres regnskapsfører | PM | 1 dag |
| 2 | Hent ned LS-0003 PDF-skjema fra Altinn → identifiser nøyaktig felt-liste | Audit-agent | 2 timer |
| 3 | Verifiser at `ComplianceLedger`-events dekker alle LS-0003-felt (gap-analyse) | Backend-agent | 1 dag |
| 4 | Implementér MVP `GET /api/admin/reports/regulatory/quarter` + PDF-template | Backend + Web-agent | 2-3 dager |
| 5 | Pilot-test mot regnskapsfører | PM + Pilot-hall | 1 uke |
| 6 | Iterér felt-mapping → cron-job + e-post + admin-UI | Backend-agent | 2-3 dager |
| 7 | Runbook + onboarding av øvrige haller | PM + Audit-agent | 1 dag |

**Estimert total**: 2-3 sprint-uker fra pilot-bestilling til operativ rapportering på alle haller.

---

## 6. Risiko og forutsetninger

- **Forutsetning A**: Pengespillforskriften §11 ikke endres mellom Q2 2026 og lansering. Lavt sannsynlighet for endring.
- **Forutsetning B**: LS-0003-skjemaet beholder samme feltstruktur (siste revisjon: juni 2019 ifølge LT-skjema06-soknad-om-foreningsbingo, men LS-0003 kan være nyere). **Verifiser ved nedlasting.**
- **Risiko 1**: Pilot-test avdekker manglende felt i ledger (f.eks. detaljer på lot-bilag-merking). Mitigation: sett av buffer i sprint 2.
- **Risiko 2**: Norsk Tipping/Rikstoto bokførings-kompabilitet — disse er ikke vårt produkt men passerer hall-kassa. Wireframe 16.25 noterer at "Dag" kun bokføres i Totalt. Pilot-tester om dette aksepteres av regnskap.
- **Risiko 3**: Manglende rolle-tilgang for service-konto i Altinn — kun person-rolle "Utfyller/innsender" støttes. Bekreft at regnskap har riktig Altinn-rolle.
- **Risiko 4**: Hvis vi senere må over til Alt 3 (API), må vi bygge Maskinporten-klient. **Ikke planlegg for det nå**.

---

## 7. Kilder

- [Forskrift om pengespill (pengespillforskriften) Kap. 11 — Lovdata](https://lovdata.no/dokument/SF/forskrift/2022-11-17-1978/kap11)
- [Forskrift om bingo Kap. 5 — Krav til regnskap, Lovdata](https://lovdata.no/dokument/SFO/forskrift/2004-11-30-1528/KAPITTEL_5)
- [Altinn LS-0003 Rapporteringsskjema — Lotteri- og stiftelsestilsynet](https://info.altinn.no/skjemaoversikt/lotteri--og-stiftelsestilsynet/rapporteringsskjema/)
- [Altinn — Pliktig regnskapsskjema for forhåndsgodkjente organisasjoner](https://info.altinn.no/skjemaoversikt/lotteri--og-stiftelsestilsynet/pliktig-regnskapsskjema-for-forhandsgodkjente-organisasjoner/)
- Intern: `docs/architecture/WIREFRAME_CATALOG.md` §16.20-16.25, §15.7-15.8, §17.10
- Intern: User-memory `project_regulatory_requirements.md` (verifiserte krav fra Lotteritilsynet)
- Intern: `apps/backend/src/game/ComplianceLedger.ts` — append-only ledger
- Intern: `apps/backend/src/agent/AgentSettlementService.ts` — settlement-orkestrator
- Intern: `apps/backend/src/admin/WithdrawXmlExportService.ts` — XML-eksport-pattern (mal for kvartalsrapport)

---

## 8. Vedtatte beslutninger (fyll inn etter PM-review)

- [ ] PM godkjenner Alt 2 som MVP-strategi
- [ ] Pilot-hall + regnskapsfører bekreftet
- [ ] Sprint-bestilling lagt inn i Linear/PM-tracker
- [ ] Aksept av ikke å bygge Alt 3 nå (Altinn-API-integrasjon)
