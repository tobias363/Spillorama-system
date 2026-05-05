# Spillorama Error Codes — Fase 2A (2026-05-05)

**Status:** Fase 2A merget. Migrasjon av call-sites fortsetter i Fase 2B.

**Hvorfor:** Pilot-skala (24 haller × 1500 spillere = 36 000 samtidige
tilkoblinger). Når noe feiler i prod trenger ops å:

1. Identifisere kode-stien umiddelbart via stable error-code (`BIN-RKT-002`).
2. Korrelere events på tvers av socket → engine → DB via trace-ID.
3. Få alert i sann tid når kategori ikke er håndtert.
4. Replaye hendelse-rekken for postmortem.
5. Måle metrics per kategori (rate, p95-resolution).

## Format

```
BIN-<MODULE>-<NUMBER>
```

| Felt    | Verdi                                                              |
|---------|--------------------------------------------------------------------|
| BIN     | Domene — alltid `BIN` (bingo / pengespill).                        |
| MODULE  | 3-bokstavers subdomain (se tabell under).                          |
| NUMBER  | 3-siffer økende (001, 002, ...).                                   |

### Module-mapping

| Prefix  | Modul                    | Eksempel-flyt                                |
|---------|--------------------------|----------------------------------------------|
| `RKT`   | Spill 2 (rocket)         | Auto-draw, perpetual loop, host-fallback     |
| `MON`   | Spill 3 (monsterbingo)   | Auto-draw, perpetual loop                    |
| `BIN`   | Spill 1 (norsk-bingo)    | Schedule, master-control, manual bingo-check |
| `WLT`   | Wallet                   | Debit, credit, idempotency                   |
| `CMP`   | Compliance               | Pengespillforskriften, fail-closed checks    |
| `SCK`   | Socket.IO                | Emit-fail, disconnect-mid-send               |
| `DRW`   | Draw-engine              | Race-conditions (DRAW_TOO_SOON, etc.)        |
| `RUM`   | Room management          | Lifecycle, host, players, snapshot           |
| `PAY`   | Payout / payment         | Swedbank, manual cash-out                    |
| `AUTH`  | Auth / session           | Token, login, BankID                         |

## Severity

| Level     | Beskrivelse                                              | Alert-default     |
|-----------|----------------------------------------------------------|-------------------|
| CRITICAL  | Spillere kan ikke spille. Pilot-blokker.                 | `immediate`       |
| HIGH      | Kjernefunksjon nede for noen brukere.                    | `immediate`       |
| MEDIUM    | Forventet edge-case som vi vil måle.                     | `rate-threshold`  |
| LOW       | Diagnostisk informasjon.                                 | `none`            |

## Kategori

| Kategori          | Brukes når...                                          |
|-------------------|--------------------------------------------------------|
| `race-condition`  | Concurrent ops kappkjørte (host-fallback, throttle).   |
| `data-integrity`  | State er korrupt (host ikke i players[], mismatch).    |
| `external-error`  | Eksternt API/tjeneste feilet (DB, Redis, Sentry).      |
| `client-input`    | Klient sendte ugyldig input — for telemetri.           |
| `infra`           | Infra/network/IO-feil (timeout, ENOSPC, OOM).          |
| `scaling`         | Capacity/throughput (queue-overflow, rate-limit).      |
| `game-logic`      | Forventet game-flow (DRAW_TOO_SOON, NO_MORE_NUMBERS).  |
| `recovery`        | Recovery / fallback-aktivering trigget.                |

## Hvordan bruke registret

### Throw med error-code

```typescript
import { DomainError } from "../errors/DomainError.js";

// 3-arg shorthand: error-code som tredje arg
throw new DomainError("NOT_HOST", "Kun host", "BIN-RUM-001");

// 4-arg form: details + error-code
throw new DomainError(
  "HALLS_NOT_READY",
  "Haller er ikke klare.",
  { unreadyHalls: ["A", "B"] },
  "BIN-RUM-005",
);
```

Backwards-kompat: alle eksisterende `new DomainError("CODE", "msg")` og
`new DomainError("CODE", "msg", details)` fortsetter å fungere uendret.

### Logg med structured-logger

```typescript
import {
  logError,
  logWarn,
  logInfo,
} from "../observability/structuredLogger.js";

try {
  await engine.drawNextNumber({ roomCode, actorPlayerId });
} catch (err) {
  logError(
    {
      module: "Game2AutoDrawTickService",
      errorCode: "BIN-RKT-002",
      roomCode,
      drawIndex: snapshot.drawnNumbers.length,
    },
    "tick failed — engine.drawNextNumber threw",
    err,
  );
}
```

Side-effekter (alle automatiske):

- `pino.error` med metadata (severity, category, runbook, traceId).
- Counter +1 (admin-endpoint kan rapportere rate).
- Sentry breadcrumb.
- Sentry `captureException` hvis severity er CRITICAL eller HIGH.

### Hent rate-snapshot

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/api/admin/observability/error-rates
```

Response:

```json
{
  "ok": true,
  "data": {
    "generatedAt": "2026-05-05T10:30:00.000Z",
    "count": 3,
    "rates": [
      {
        "code": "BIN-RKT-001",
        "lifetime": 142,
        "perMinute": 7,
        "lastSeenAt": "2026-05-05T10:29:54.123Z",
        "severity": "MEDIUM",
        "category": "recovery"
      }
    ]
  }
}
```

`?includeZero=true` returnerer alle registry-codes (også med 0 events).

### Slå opp metadata for én code

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/api/admin/observability/error-codes/BIN-RKT-002
```

## Hvordan legge til en ny code

1. Bestem modul-prefix (RKT/MON/DRW/...) basert på hvor feilen oppstår.
2. Ta neste ledige nummer i den modulen.
3. Legg til entry i `apps/backend/src/observability/errorCodes.ts`:
   ```typescript
   "BIN-RKT-009": {
     title: "Spill 2 — kort beskrivelse",
     severity: "HIGH",
     category: "race-condition",
     retryable: false,
     alertRule: "immediate",
     runbook: "docs/runbooks/BIN-RKT-009.md",
     introduced: "PR #XXX",
   },
   ```
4. Lag stub `docs/runbooks/BIN-RKT-009.md` med kjente symptomer og fix.
5. Bruk koden i `DomainError`-throw eller `logError`-call.
6. Verifiser med test: `npm test -- errorCodes.test.ts`.

## Hvordan deprecate en code

**Aldri** fjern en code. Dashboards og alert-regler binder mot stable
identifiers. Marker i stedet:

```typescript
"BIN-RKT-001": {
  title: "Spill 2 host fallback applied",
  // ... eksisterende metadata
  deprecated: true,
},
```

Legg til ny code (BIN-RKT-009 e.l.) hvis behovet for telemetri består,
og oppdater migrate gradvis.

## Eksempel-output

Structured-logger-output (JSON):

```json
{
  "level": "error",
  "time": "2026-05-05T10:30:00.000Z",
  "msg": "tick failed — engine.drawNextNumber threw",
  "errorCode": "BIN-RKT-002",
  "severity": "HIGH",
  "category": "external-error",
  "runbook": "docs/runbooks/BIN-RKT-002.md",
  "module": "Game2AutoDrawTickService",
  "roomCode": "ROCKET-1",
  "drawIndex": 7,
  "traceId": "uuid-from-ALS",
  "err": {
    "name": "Error",
    "message": "...",
    "stack": "...",
    "code": "WALLET_TIMEOUT"
  }
}
```

## Migrasjon-roadmap

| Fase  | Scope                                          | Status               |
|-------|------------------------------------------------|----------------------|
| 2A    | Registry, structured-logger, metrics, admin API + 5-10 PoC migrations | **Merget 2026-05-05** |
| 2B    | Audit alle `DomainError`-throws, tildel codes | Pågående             |
| 2C    | Sentry alert-regler basert på `alertRule`-meta | Planlagt             |
| 3     | Engine-refactor — fjerne dødt kode-stier       | Planlagt             |

## Referanser

- Source registry: `apps/backend/src/observability/errorCodes.ts`
- Logger: `apps/backend/src/observability/structuredLogger.ts`
- Metrics: `apps/backend/src/observability/errorMetrics.ts`
- Admin route: `apps/backend/src/routes/adminObservability.ts`
- DomainError: `apps/backend/src/errors/DomainError.ts`
- Sentry-wiring: `apps/backend/src/observability/sentry.ts` (BIN-539)
- TraceContext: `apps/backend/src/util/traceContext.ts` (MED-1)
