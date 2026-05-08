# ADR-0007 — Klient-debug-suite

**Status:** Accepted
**Dato:** 2026-05-05
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-006-client-debug-suite.md` til ny struktur. Innhold uendret.

## Kontekst

Når en spiller rapporterer "spillet henger" er diagnose vanskelig:

- Spiller kan ikke gi oss console-logs (mobile devices, ikke-tekniske brukere)
- Vi har Sentry, men det fanger kun unhandled errors — ikke "klient sa X til server, server svarte Y, men
  UI er fortsatt i state Z"
- Backend-logs viser kun server-side perspektiv

Casino-grade-mål krever 5-min MTTR. Uten klient-side-data blir MTTR 30+ min med "hvilken nettleser har
du? Kan du sende screenshot? Kan du åpne console?"

## Beslutning

Innfør **debug-suite** på klient:

1. **Ring buffer** — lagrer siste 500 events lokalt (Socket.IO inn/ut, state-overganger, render-frame-tider)
2. **Trace-ID propagering** — klient genererer `trace_id` per session, sender med hver request og
   socket-event. Backend logger samme trace_id (jf. ADR-0011).
3. **Debug-overlay** — usynlig som default, aktiveres med tasten `Ctrl+Shift+D`. Viser
   - State (LOBBY/PLAYING/etc)
   - Sist mottatte event
   - Aktive bonger
   - Wallet-balance
   - Trace-ID
4. **Bug-rapport-knapp** — i debug-overlay, sender ring-buffer + trace-id + system-info til Sentry breadcrumb.
   Spiller får referanse-ID å gi support.

**Production:** debug-suite er alltid aktiv (ikke dev-only), men overlay er hidden by default.
Prestasjonskostnad: <2% (ring-buffer er O(1) per event).

## Konsekvenser

### Positive
- **Diagnose-tid kuttes drastisk:** support kan be om "Ctrl+Shift+D, klikk Send Bug Report, gi meg ID"
- **Trace-ID gir ende-til-ende-bilde:** klient-event + backend-log + DB-query alle har samme ID
- **Casino-grade observability:** matcher industri-norm (Evolution gir support-side trace-IDs)

### Negative
- **Compute/memory-cost:** ring-buffer i RAM, ~1 MB. Akseptabelt på alle plattformer.
- **Privacy:** ring-buffer kan inneholde wallet-balance og spill-historikk. Sendes kun ved eksplisitt
  bruker-handling (Send Bug Report). PII (e-mail, navn) inkluderes ikke.

### Nøytrale
- **Disiplin:** nye events må bruke `clientLogger.event(...)` ikke `console.log`. ESLint-rule
  forhindrer console.log i committed kode.

## Alternativer vurdert

### Alternativ A: Sentry session replay
Avvist (foreløpig):
- Spiller-screencast inkluderer alt på skjermen — privacy-issue
- Mister Socket.IO-event-detalj
- Kan vurderes som tillegg, ikke erstatning

### Alternativ B: Server-side log-aggregering only
Avvist:
- Kan ikke fange "klient så X men UI viste Y"
- Mister rendering- og animation-bugs som kun synes på klient

### Alternativ C: Be spillere om DevTools-åpning
Avvist:
- Ikke-tekniske brukere kan ikke
- Mobile har ikke DevTools
- Spillere ringer support før vi kan lære dem opp

## Implementasjon

- ⚠️ Fase 2B i fremdrift — basis ring-buffer på plass, overlay og bug-rapport-knapp gjenstår
- ✅ Trace-ID-genereringen er implementert (clientTraceId)
- ⚠️ Backend trace-id-propagering (MED-1) er delvis implementert

Skills som bør oppdateres: `trace-id-observability`, `health-monitoring-alerting`.

## Referanser

- `packages/game-client/src/diagnostics/` — debug-suite
- `packages/game-client/src/telemetry/` — trace-id og event-buffer
- ADR-0011 — observability-trådning
- Fase 2B roadmap (BACKLOG.md)
