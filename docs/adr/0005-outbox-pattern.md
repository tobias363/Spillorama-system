# ADR-0005 — Outbox-pattern for events (BIN-761)

**Status:** Accepted
**Dato:** 2026-04-26
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-004-outbox-pattern.md` til ny struktur. Innhold uendret.

## Kontekst

Spillorama produserer events som må leveres pålitelig til flere downstream-systemer:

- Wallet-transaksjoner → Postgres + Sentry-trace + (fremtidig) ekstern reconciliation
- Compliance-events → audit-trail + (fremtidig) Lotteritilsynet rapport
- Game-events → Socket.IO bredkast + (fremtidig) data-warehouse

Tidlig kode brukte "fire-and-forget" pattern: backend skriver til Postgres, deretter prøver å pushe
til Socket.IO + send mail + write Sentry. Hvis backend krasjer mellom Postgres-commit og Socket.IO,
har vi inkonsistent state — DB sier "ja", klient vet ikke.

For wallet (BIN-761) ble dette spesielt kritisk: spiller debit'es i DB, men kvitterings-event når
aldri klient. Spilleren ser ikke at saldo er trukket og prøver igjen → dobbeltkrediter eller forvirring.

Industri-norm: **transactional outbox pattern**.

## Beslutning

Innfør `app_event_outbox`-tabell:

```sql
CREATE TABLE app_event_outbox (
  id UUID PRIMARY KEY,
  aggregate_type VARCHAR(64),  -- 'wallet', 'compliance', 'game'
  aggregate_id UUID,
  event_type VARCHAR(64),
  payload JSONB,
  created_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0
);
```

**Skrivemønster:**
1. I samme transaction som mutering: INSERT i `app_event_outbox`
2. Cron-jobb (hvert 5 sek) leser `WHERE delivered_at IS NULL ORDER BY created_at LIMIT 100`
3. Per event: pusher til Socket.IO, sender mail, skriver Sentry breadcrumb
4. Ved suksess: UPDATE `delivered_at = now()`
5. Ved feil: UPDATE `retry_count++`, exponential backoff
6. Etter 7 dager + max retries: alarm til ops, manuelt rydde opp

**Garanti:** hvis Postgres-commit lykkes, leveres eventet **eventually**. Hvis Postgres-commit feiler,
leveres ikke eventet (rollback). **At-least-once delivery** med idempotency på mottaker-side.

## Konsekvenser

### Positive
- **Konsistens:** state og events alltid i sync (begge committet i samme transaction)
- **Pålitelighet:** krasj mellom mutering og bredkast håndteres av cron-retry
- **Observable:** outbox-tabell viser umiddelbart hvilke events er stuck
- **Idempotency:** kombineres med ADR mottaker-side dedup (BIN-767 cleanup)

### Negative
- **Latency:** event-levering forsinkes med opptil 5 sek (cron-poll-interval). For game-events trengs
  raskere path — se Praktisk hybrid under.
- **Database-cost:** ekstra INSERT per mutering, ekstra cron-load. Mitigert av batching og index.

### Nøytrale
- **Praktisk hybrid:** for tidskritiske events (Socket.IO `draw:new`) gjør vi BÅDE direkte push og
  outbox-write. Outbox er backup hvis direct push feiler. Dette er pragmatisk kompromiss mellom
  latency og pålitelighet.

## Alternativer vurdert

### Alternativ A: Saga-pattern med kompenserende transaksjoner
Avvist:
- Overkill for vår skala
- Krever distribuert transaction-koordinator
- Vanskeligere å resonnere om

### Alternativ B: Message broker (Kafka, RabbitMQ)
Avvist:
- Ekstra infra å drifte
- Overkill for nåværende behov
- Fremtidig vurdering når vi når 100 000+-skala

### Alternativ C: Kun direct-push uten outbox
Avvist:
- Race condition mellom DB-commit og bredkast
- Bevist problematisk i prod (BIN-761)

## Implementasjon

- ✅ `app_event_outbox`-tabell deployet
- ✅ Cron-jobb (`outboxDeliveryCron.ts`) leverer events
- ✅ Wallet bruker outbox for transaksjons-events
- ⚠️ Compliance og game-events bruker fortsatt direct-push (Wave 2 prioritet)
- ✅ BIN-767 cleanup-jobb: TTL 90 dager på leverte events

Skills som bør oppdateres: `wallet-outbox-pattern`, `audit-hash-chain`.

## Referanser

- BIN-761 (Linear)
- `apps/backend/src/wallet/WalletOutboxService.ts`
- `apps/backend/src/jobs/outboxDeliveryCron.ts`
- `apps/backend/migrations/00NN_event_outbox.sql`
- ADR-0004 (hash-chain audit) — relatert event-pålitelighet
