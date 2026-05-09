# ADR-0006 — Strukturerte error-codes

**Status:** Accepted
**Dato:** 2026-05-05
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-005-structured-error-codes.md` til ny struktur. Innhold uendret.

## Kontekst

Tidlig kode kastet fri-tekst-feil:

```typescript
throw new Error("Insufficient balance for ticket purchase");
```

Dette ga tre problemer:

1. **Klient kan ikke lokalisere:** norsk-spiller ser engelsk feilmelding. Hvis vi vil oversette,
   må klient regex'e error-string.
2. **Sentry grupperer dårlig:** "Insufficient balance for ticket purchase" og "Insufficient balance for
   spin attempt" havner i hver sin gruppe — egentlig samme problem.
3. **Operasjon kan ikke kommunisere fix:** "fix er deployet for feilen 'Insufficient balance for ticket
   purchase'" er klønete. Med ID kunne vi sagt "fix for BIN-WAL-INSUFFICIENT i v2026.05.04".

Casino-grade-systemer bruker strukturerte error-codes som førsteklasses borgere.

## Beslutning

Innfør `BingoError`-klasse:

```typescript
class BingoError extends Error {
  constructor(
    public code: BingoErrorCode,    // f.eks. "BIN-WAL-001"
    public details?: Record<string, unknown>,
    message?: string                // Engelsk default-melding (kun for utvikler-logs)
  ) { super(message ?? code); }
}
```

**Format:** `BIN-<MODULE>-<NUMBER>`
- `BIN-WAL-NNN` — wallet
- `BIN-CMP-NNN` — compliance
- `BIN-G1-NNN`, `BIN-G2-NNN`, `BIN-G3-NNN` — game-spesifikk
- `BIN-RKT-NNN` — Spill 2 (Rocket) spesifikk
- `BIN-AUTH-NNN` — auth
- `BIN-SCH-NNN` — schedule

**Klient-side:** har en map `errorCode → lokalisert melding`. Ved nye codes legges norsk + engelsk
oversettelse til.

**HTTP-respons-shape (allerede i bruk):**
```json
{
  "ok": false,
  "error": {
    "code": "BIN-WAL-001",
    "message": "Insufficient balance",
    "details": { "required": 50, "available": 10 }
  }
}
```

**Sentry:** `Sentry.captureException(err, { tags: { errorCode: err.code } })` for fingerprint-grupping.

## Konsekvenser

### Positive
- **Lokalisering:** klient oversetter basert på code, ikke string
- **Sentry-grupping:** samme code = samme issue
- **Ops-kommunikasjon:** "fix for BIN-WAL-001 deployet" entydig
- **Type-safety:** TypeScript enum gir compile-time-validering at code finnes
- **Backwards-compat:** legge til nye codes er ikke breaking (kun fjerne er det)

### Negative
- **Migration-cost:** alle eksisterende `throw new Error(...)` må erstattes. Status: 60% migrert.
- **Disiplin:** nye errors må få unique code, ikke gjenbruke eksisterende. Code review fanger dette.

### Nøytrale
- Code-allokering må koordineres for å unngå kollisjoner. Vi bruker incrementing per modul, dokumentert i
  `docs/engineering/ERROR_CODES.md` (TODO).

## Alternativer vurdert

### Alternativ A: HTTP status codes only
Avvist:
- 400/422/500 er for grovt — vi trenger sub-classification
- Klient kan ikke skille "insufficient funds" fra "limit exceeded" på status alene

### Alternativ B: Error class hierarchy (InsufficientBalanceError, LimitExceededError)
Avvist:
- 100+ klasser blir uoversiktlig
- Vanskelig å serialisere over wire (kun JSON-shape)
- Code-string er enklere å logge og søke

### Alternativ C: Throw raw strings
Avvist:
- Brudd med casino-grade-prinsippet
- Sentry-grupping og lokalisering blir umulig

## Implementasjon

- ✅ `BingoError` klasse i `apps/backend/src/errors/`
- ✅ Wallet- og compliance-modules bruker structured codes
- ⚠️ Game-modules under migrering (Fase 2A)
- ⚠️ `docs/engineering/ERROR_CODES.md` katalog mangler — TODO

## Referanser

- `apps/backend/src/errors/BingoError.ts`
- `apps/backend/src/errors/codes.ts` (under utvikling)
- `packages/shared-types/src/api.ts` — error-response-shape
- Fase 2A roadmap (BACKLOG.md)
