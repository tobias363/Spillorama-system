# ADR-0004 — Hash-chain audit-trail (BIN-764)

**Status:** Accepted
**Dato:** 2026-04-26
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-003-hash-chain-audit.md` til ny struktur. Innhold uendret.

## Kontekst

Pengespillforskriften krever uforanderlig audit-trail for alle finansielle transaksjoner. Ved
revisjon må vi kunne bevise at audit-rader ikke har blitt redigert etter innsetting.

Standard append-only-tabell beskytter mot ved-en-feil-sletting (constraint), men ikke mot
**ondsinnet redigering** av en aktør med direkte DB-tilgang. En revisor kan ikke se forskjell
på en autentisk historikk og en historikk som ble re-skrevet i går.

Casino-grade-systemer (Evolution Live Casino, Playtech) bruker **hash-chain audit-trail**:

- Hver audit-rad inkluderer hash av forrige rad
- Ondsinnet redigering av historisk rad bryter hash-kjeden fra den raden og frem
- Daglig anchor-snapshot publiseres til immutable storage (eller Lotteritilsynet)

## Beslutning

Implementer hash-chain audit-trail i `app_compliance_audit_log`:

```sql
CREATE TABLE app_compliance_audit_log (
  id UUID PRIMARY KEY,
  prev_hash CHAR(64) NOT NULL,    -- SHA-256 av forrige rad
  curr_hash CHAR(64) NOT NULL,    -- SHA-256(prev_hash || row_data)
  -- ... øvrige felter (actor, action, resource, etc.)
);
```

Algoritme:
1. Ved innsett: les `curr_hash` fra forrige rad → bruk som `prev_hash`
2. Beregn `curr_hash = SHA-256(prev_hash || canonicalize(row_data))`
3. Insert med både prev_hash og curr_hash

**Daglig anchor:** cron-jobb ved midnatt henter siste curr_hash, signerer med JWT-secret, lagrer i
`app_audit_anchors`. Ved revisjon kan vi bevise at audit-trail ved tidspunkt T inkluderte rad N med
hash X.

**Verifisering:** `npm run verify:audit-chain` itererer alle rader, regenerer kjeden, sammenligner.
Brudd flagges med rad-id og forventet vs faktisk hash.

## Konsekvenser

### Positive
- **Casino-grade audit-integritet:** ondsinnet redigering oppdages
- **Lotteritilsynet-paritet:** matcher industri-norm (Evolution, Playtech)
- **Daglig anchor gir tidsbasert bevis:** "audit-trail ved 2026-05-05 23:59 inkluderte rad N med
  hash X" kan bevises uten DB-tilgang
- **Verifiserbar:** `verify:audit-chain` script kan kjøres i CI eller ved revisjon

### Negative
- **Ytelse-cost:** hver insert leser forrige rad (en LIMIT 1 ORDER BY created_at DESC). Mitigert av
  index. Ved 36 000-skala: ~10 000 audit-events/min → ~166/sek = OK.
- **Migration-engangs-cost:** eksisterende audit-rader uten hash-kjede må fylles inn (one-shot job).
- **Krever disiplin:** alle audit-events MÅ gå via AuditLogService — direkte INSERT fra annen kode
  bryter kjeden.

### Nøytrale
- Hvis backend krasjer mellom prev_hash-read og insert, kan man få collision (to rader med samme
  prev_hash). Mitigert av unique constraint på (prev_hash, curr_hash) — second-writer feiler og må
  retry'e.

## Alternativer vurdert

### Alternativ A: Postgres WAL-based audit (logical replication til separate audit-DB)
Avvist:
- Krever ekstra infra
- Beskytter ikke mot ondsinnet INSERT i audit-DB
- Mindre revisjon-forståelig

### Alternativ B: Periodic checksums (uten hash-chain)
Avvist:
- Beskytter ikke mot redigering mellom checksums
- Industri-norm er hash-chain

### Alternativ C: Ingen integritets-mekanisme (kun append-only constraint)
Avvist:
- Lotteritilsynet kan kreve bevis ved revisjon
- Casino-grade-prinsipp brutt

## Implementasjon

- ✅ `app_compliance_audit_log` tabell med prev_hash + curr_hash deployet
- ✅ AuditLogService skriver hash-kjede ved hver insert
- ✅ Daglig anchor-cron deployet
- ✅ `npm run verify:audit-chain` script

Skills som bør oppdateres: `audit-hash-chain`, `pengespillforskriften-compliance`.

## Referanser

- BIN-764 (Linear)
- `apps/backend/src/compliance/AuditLogService.ts`
- `apps/backend/src/scripts/verifyAuditChain.ts`
- `apps/backend/src/jobs/auditAnchorCron.ts`
- ADR-0003 (system-actor) — driver actor-felt i hash-chain
