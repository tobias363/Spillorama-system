---
name: trace-id-observability
description: When the user/agent works with logging, tracing, or correlation across the Spillorama bingo platform. Also use when they mention traceId, correlation-id, MED-1, observability, structured-logging, trace-propagation, Socket.IO trace, DB-query-trace, AsyncLocalStorage, X-Trace-Id, x-trace-id header, log-injection, audit-trail. Defines how trace-IDs flow client → HTTP → Socket.IO → DB so support can correlate bug reports with backend logs and DB queries on a single ID. Make sure to use this skill whenever someone touches loggers, middleware, Socket.IO event-handlers, or DB-query helpers even if they don't explicitly ask for it — broken trace-propagation kills the 5-minute-MTTR target.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/middleware/traceId.ts, apps/backend/src/middleware/traceId.test.ts, apps/backend/src/middleware/socketTraceId.ts, apps/backend/src/middleware/socketTraceId.test.ts, apps/backend/src/util/traceContext.ts, apps/backend/src/util/traceContext.test.ts, apps/backend/src/observability/** -->

# Trace-ID Observability

## Kontekst

Casino-grade-mål er **5-min MTTR** ved produksjons-incidents. Pilot-skala 2026 er 36 000 samtidige spillere — én bug kan ramme 1500 spillere på 30 sekunder. Uten korrelert trace-ID kan support ikke koble klient-bug-rapport til backend-logs til DB-queries.

MED-1 (trace-ID propagation) ble vedtatt i ADR-010 som del av casino-grade-observability-stacken. Per 2026-05-08:

| Lag | Status | Notater |
|---|---|---|
| Klient (browser) | OK Implementert | `packages/game-client/src/debug/debugLogger.ts` — `trace_id` per session |
| HTTP entry (Express) | OK Implementert | `apps/backend/src/middleware/traceId.ts` |
| AsyncLocalStorage propagation | OK Implementert | `apps/backend/src/util/traceContext.ts` — auto-merge i alle `logger.*`-kall |
| Logger-integrasjon | OK Implementert | Strukturerte logs har `traceId` automatisk |
| Socket.IO events | Partial Delvis | Header-lesing OK, men `clientRequestId` fra payload må mappes inn |
| DB-queries (`pg_stat_activity`) | Partial Delvis | `SET LOCAL app.trace_id` ikke konsistent — primært for slow-query-debug |

## Kjerne-arkitektur

### AsyncLocalStorage som primitiv

Vi bruker Node-native `AsyncLocalStorage` (stable siden Node 16) — IKKE `cls-hooked`. ALS har null overhead når ingen context er aktiv og er den moderne async-context-primitive. Implementert i `apps/backend/src/util/traceContext.ts`.

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

const traceStore = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return traceStore.run(ctx, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return traceStore.getStore();
}
```

### HTTP middleware (Express)

```typescript
import { traceIdMiddleware } from "./middleware/traceId.js";
app.use(traceIdMiddleware());
```

Adferd:
- Leser `X-Trace-Id`-header hvis present (validert mot `/^[a-zA-Z0-9_.-]{1,128}$/`).
- Hvis ikke present: minter ny UUID v4.
- Setter `X-Trace-Id` på response så klient kan korrelere.
- Wrapper `next()` i `runWithTraceContext` så ALS er aktiv hele request-livssyklusen.

### Logger-integrasjon (zero-config)

Når middleware er satt opp henter alle `logger.*`-kall context automatisk:

```typescript
import { logger } from "./logger.js";

// Inne i en HTTP-handler:
logger.info({ roomCode }, "Player joined");
// → output: { traceId: "uuid", requestId: "uuid", roomCode: "...", level: "info", msg: "Player joined" }
```

Strukturert log-format:

```json
{
  "traceId": "<uuid>",
  "requestId": "<uuid>",
  "level": "info|warn|error",
  "module": "Game1Engine|WalletService|...",
  "msg": "...",
  "userId": "<optional>",
  "roomCode": "<optional>",
  "gameId": "<optional>"
}
```

### Header-validering hindrer log-injection

Innkommende `X-Trace-Id` blir kun akseptert hvis den matcher `/^[a-zA-Z0-9_.-]{1,128}$/`. Dette hindrer at en ondskapsfull klient embed-er newlines eller control-chars for å forfalske log-linjer.

```typescript
const INCOMING_TRACE_ID_REGEX = /^[a-zA-Z0-9_.-]{1,128}$/;

if (typeof candidate === "string" && INCOMING_TRACE_ID_REGEX.test(candidate)) {
  traceId = candidate;
}
```

## Immutable beslutninger

### Aldri bruk console.log

`console.log` omgår både ALS-context og strukturert log-format. Bruk alltid:

```typescript
import { logger } from "./logger.js";
logger.info({ ...details }, "message");
```

Pre-merge-sjekk: grep'er for `console.log` i diff. Tillat kun i CLI-scripts og tester.

### Trace-ID genereres på edge

Klient eller HTTP-entry minter trace-ID. Backend SKAL aldri overstyre en gyldig innkommende trace-ID — bare validere format og bruke som-er. Dette gjør at:
- Klient kan inkludere trace-ID i bug-rapport
- Support kan slå den opp direkte i Render logs / Sentry breadcrumbs
- En request som passerer gjennom flere services bevarer samme ID

### Berik context underveis (ikke erstatt)

Når downstream-kode lærer mer om request (auth → userId, room-resolve → roomCode), skal det bruke `setTraceField`:

```typescript
import { setTraceField } from "../util/traceContext.js";

setTraceField("userId", user.id);
setTraceField("roomCode", room.code);
```

Etterfølgende `logger.*`-kall får automatisk de nye feltene. ALS-context er per-request — ingen kryss-request-lekkasje.

### Socket.IO event-handlers må wrappe i runWithTraceContext

For Socket.IO emits fra klient: les `traceId` fra payload, mintr ny hvis manglende, og wrap handler:

```typescript
socket.on("ticket:mark", (payload, ack) => {
  const traceId = validateTraceId(payload.traceId) ?? newTraceId();
  runWithTraceContext({ traceId, requestId: traceId }, async () => {
    try {
      await handleTicketMark(payload);
      ack({ ok: true });
    } catch (err) {
      logger.error({ err }, "ticket:mark failed");
      ack({ ok: false, code: "INTERNAL_ERROR" });
    }
  });
});
```

Per 2026-05-08 er denne mønsteret ikke konsistent appliert på alle Socket.IO event-handlers. Når du touch-er en handler: legg til wrapping samtidig.

### DB-query-tagging er nice-to-have, ikke krav

For slow-query-debug:

```typescript
await client.query(`SET LOCAL app.trace_id = $1`, [getTraceContext()?.traceId ?? "unknown"]);
const result = await client.query("SELECT ...", [...]);
```

Dette gjør at `pg_stat_activity` viser trace-ID for kjørende queries — nyttig for å koble en treg query til en spesifikk request. **Ikke krav for normal logging** (logger gjør jobben), men nyttig når man jakter på N+1 eller deadlock.

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| `console.log` i prod-kode | Logs uten traceId — umulig å korrelere | Bruk `logger.info({...}, "msg")` |
| Glemt å wrappe Socket.IO-handler | Async-arbeid mister context, logger får `undefined` traceId | Wrap i `runWithTraceContext({ traceId, requestId: traceId }, async () => {...})` |
| Overstyrer innkommende traceId | Klient kan ikke korrelere bug-rapport | Bruk innkommende hvis gyldig format, ellers mintr |
| Logger-fixed message uten objekt | `logger.info("msg")` — context-felter mangler | `logger.info({ field: value }, "msg")` |
| Header-injection i `X-Trace-Id` | Forfalskede log-linjer | Header-regex `/^[a-zA-Z0-9_.-]{1,128}$/` (allerede implementert) |
| Trace-ID lekker mellom requests | Ofte ses i konkurrent-request-flyt | ALS isolerer per request — sjekk at `runWithTraceContext` faktisk wrapper hele lifecycle |
| Manuell threading av traceId via funksjons-args | Refactor-galskap, glemmes ofte | Bruk ALS — `getTraceContext()` virker overalt downstream |

## Kanonisk referanse

- `apps/backend/src/util/traceContext.ts` — ALS-implementasjon, `runWithTraceContext`, `getTraceContext`, `setTraceField`
- `apps/backend/src/middleware/traceId.ts` — Express middleware
- `apps/backend/src/middleware/traceId.test.ts` — adferd-spec
- `packages/game-client/src/debug/debugLogger.ts` — klient-side trace-ID-generering
- `packages/game-client/src/debug/types.ts` — DebugLogEntry shape
- `docs/decisions/ADR-010-casino-grade-observability.md` — vedtatt mandat
- `docs/decisions/ADR-005-structured-error-codes.md` — relatert: errorCode-felt
- `docs/observability/CLIENT_DEBUG_SUITE.md` — klient-side debug-flyt

## Når denne skill-en er aktiv

- Skrive ny Express-middleware (sikre at den ikke bryter ALS-flow)
- Skrive ny Socket.IO event-handler (wrappe i `runWithTraceContext`)
- Endre `logger.ts` eller log-format
- Touche en kodeflyt der trace-ID i dag mangler
- Reviewe en PR for log-injection eller `console.log`-bruk
- Feilsøke "bug-rapport viser trace-ID, men jeg finner ingenting i Render logs" (verifiser at klient og backend bruker samme ID)
- Implementere DB-query-tagging for slow-query-debug
- Berike audit-trail med struktur-data (userId, roomCode)
