# ADR-0011 — Casino-grade observability

**Status:** Accepted
**Dato:** 2026-04-28
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-010-casino-grade-observability.md` til ny struktur. Innhold uendret.

## Kontekst

Casino-grade-mål (Evolution Gaming-paritet) krever 5-min MTTR ved produksjons-incidents. Pilot-skala 2026
er 36 000 samtidige spillere — én bug kan ramme 1500 spillere på 30 sekunder.

Tidlig observability-state:
- Sentry fanget unhandled errors, men ikke "klient sa X, server svarte Y, men UI er stuck i Z"
- Render.com logs hadde requests men ikke trace-id-kobling mellom frontend, backend, og DB
- Ingen daglig anchor-snapshot for audit-integritet (jf. ADR-0004)
- Wallet-reconciliation var manuell (ingen daglig automatisk verifikasjon)

Industri-norm for casino-grade:
- Trace-ID propagering: browser → socket → engine → DB (samme ID i alle logger)
- Strukturerte error-codes (jf. ADR-0006)
- Daglig audit-anchor + verifiserings-script
- Automatisk reconciliation av kritiske beløp (wallet, payout, compliance-ledger)

## Beslutning

Innfør **observability-stack** med fire komponenter:

### 1. Trace-ID propagering (MED-1)
- Klient genererer `trace_id` per session
- Sendes med hver HTTP-request (`x-trace-id` header) og hver Socket.IO-event-payload
- Backend logger `trace_id` i alle logs (Sentry breadcrumbs, Render structured logs)
- DB-queries inkluderer `set local app.trace_id = '...'` så pg_stat_activity har trace
- **Resultat:** kan korrelere bug-rapport (klient-side) med backend-logs og DB-queries på én ID

### 2. Strukturerte error-codes (jf. ADR-0006)
- Sentry grupperer på `errorCode`-tag, ikke fri-tekst
- Klient-side bug-rapport inkluderer `errorCode` så support kan slå opp i Sentry

### 3. Daglig audit-anchor (jf. ADR-0004)
- Cron ved midnatt: fang siste curr_hash, signér med JWT, lagre i `app_audit_anchors`
- `npm run verify:audit-chain` bevis tidsstempler

### 4. Daglig reconciliation
- **Wallet:** sum av alle saldo + alle outstanding holds + jackpot-pots = sum av deposit + winnings - withdrawals
  - Cron-jobb (`walletReconciliationCron.ts`) flagger avvik → Sentry alert
  - Pre-pilot-verifikasjon 2026-05-01: 21 alerts → 0 etter fix
- **Compliance-ledger:** sum av STAKE = sum av wallet-debits, sum av PRIZE = sum av wallet-credits
- **House-account:** opening balance + revenue - payouts + adjustments = closing balance

## Konsekvenser

### Positive
- **5-min MTTR mulig:** support kan slå opp trace-id og se hele pipeline-flyten
- **Audit-integritet bevisbar:** hash-chain + daglig anchor gir sannferdig historikk
- **Pengetap fanges automatisk:** reconciliation-cron alarmer på avvik
- **Casino-grade-paritet:** matcher Evolution/Playtech observability-norm

### Negative
- **Implementasjon-cost:** trace-id må trådes gjennom hele stack — krever refactor i ~30 filer
- **Sentry-cost øker:** flere events tagget per request. Akseptabelt for casino-grade
- **Storage-cost:** outbox + audit-trail vokser ~10 GB/år ved pilot-skala. OK.

### Nøytrale
- **Disiplin:** alle nye log-statements må inkludere trace-id. ESLint-rule og code review fanger.

## Alternativer vurdert

### Alternativ A: OpenTelemetry/Jaeger
Avvist (foreløpig):
- Overkill for nåværende skala
- Ekstra infra
- Kan vurderes ved 100 000+ skala

### Alternativ B: Datadog APM
Avvist:
- Lisens-kost
- Vendor-lock-in
- Sentry + Render.com logs er tilstrekkelig nå

### Alternativ C: Kun Sentry, ingen trace-id
Avvist:
- Mister evne til å korrelere klient + backend + DB
- Casino-grade-prinsipp brutt

## Implementasjon

- ⚠️ Trace-ID propagering (MED-1): klient-side ✅, backend HTTP ✅, Socket.IO delvis, DB-queries TODO
- ✅ Strukturerte error-codes: 60% migrert (ADR-0006)
- ✅ Hash-chain audit: deployet (ADR-0004)
- ✅ Wallet-reconciliation: deployet, 0 alerts pre-pilot
- ⚠️ Compliance-ledger reconciliation: deployet men ikke bredt validert
- ⚠️ House-account reconciliation: TODO

Skills som bør oppdateres: `trace-id-observability`, `audit-hash-chain`, `health-monitoring-alerting`,
`live-room-robusthet-mandate`, `dr-runbook-execution`.

## Referanser

- ADR-0004 (hash-chain audit)
- ADR-0006 (structured error codes)
- ADR-0007 (klient-debug-suite)
- `apps/backend/src/observability/`
- `docs/operations/OBSERVABILITY_RUNBOOK.md`
- `docs/operations/LIVE_ROOM_OBSERVABILITY_2026-04-29.md`
