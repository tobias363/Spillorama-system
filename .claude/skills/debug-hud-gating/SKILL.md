---
name: debug-hud-gating
description: Gate-strategi for debug-HUD + event-log-panel i Spillorama spillerklient. Use when the user or agent works with debug-HUD, event-log-panel, debug-gating, isDebugHudEnabled, mountDebugHud, DebugEventLogPanel, ConsoleBridge, FetchInstrument, ErrorHandler, FetchBridge, EventTracker, EventStreamer, or anything related to player-shell debug-overlay synlighet. Use this whenever someone touches `packages/game-client/src/games/game1/Game1Controller.ts`'s mountDebugHud-block, `packages/game-client/src/games/game1/debug/*` debug-modulene, or considers changing how debug-HUD aktiveres — even if they don't mention debug-gating directly.
metadata:
  version: 1.0.0
  project: spillorama
---

# Debug-HUD gating

**Status:** Aktiv (vedtatt 2026-05-15)
**Eier:** Tobias Haugen (teknisk lead)
**Scope:** `packages/game-client/src/games/game1/`

---

## Hva er debug-HUD + event-log-panel?

Spillorama-spillerklienten har to debug-overlay-er som mountes av
`Game1Controller.mountDebugHud()`:

1. **SPILL1 DEBUG-HUD** (top-right) — viser `roomCode`, `hallId`,
   `playerId`, `scheduledGameId`, isolation-status, tracker-event-counter,
   siste anomali. Inneholder "Dump diagnose"- og "Rapporter bug"-knapper.
2. **EVENT-LOG-panel** (top-left, `DebugEventLogPanel`) — real-time
   event-strøm med filter-pills (all/user/api/socket/state), "Rapporter
   bug", "Dump", "Clear", toggle Ctrl+Alt+D.

I tillegg installeres disse instrumentation-modulene fra
`mountDebugHud()` (alle gated på samme flagg):
- `ConsoleBridge` — pipe console.log/warn/error til EventTracker
- `FetchInstrument` — wrapper fetch for å logge HTTP-kall
- `ErrorHandler` — fanger `window.onerror` + `unhandledrejection`
- `installSocketEmitInstrument` — proxy socket-emit
- `EventStreamer` — POST'er events til `/api/_dev/debug/events`

## Hvordan aktivere

**KUN via URL-param `?debug=full`** (Tobias-direktiv 2026-05-15).

```
http://localhost:4000/web/?dev-user=demo-pilot-spiller-1&debug=full
```

Når URL-en inneholder `?debug=full`:
- HUD mountes top-right
- Event-log-panel mountes top-left
- ConsoleBridge/FetchInstrument/ErrorHandler/SocketEmit installeres
- EventStreamer starter polling mot backend
- Dump + Rapporter-bug-knapper er aktive

Når URL-en IKKE inneholder `?debug=full`:
- Ingen visuell overlay
- Ingen ekstra instrumentation
- Spilleren får full spillopplevelse uten støy

## Hvorfor opt-in via URL bare?

**Tobias-direktiv 2026-05-15** (IMMUTABLE):
> "Kan du også fjerne alle de debug feltnee? du får alt av data tilgjengelgi
> så trenger ikke disse. da får jeg også full spillopplevelse"

Tidligere triggers (alle FJERNET 2026-05-15):
- `?debug=1` — for kort til å være eksplisitt opt-in (default for mange URL-loggere)
- `?debug=true` — samme problem
- `localStorage.DEBUG_SPILL1_DRAWS=true` — **lekte til prod-brukere** fordi
  localStorage overlever sesjoner. Hvis QA satte flagget på en delt
  test-maskin, ville alle senere brukere se HUD permanent.

`?debug=full` er valgt fordi:
1. Eksplisitt — ingen kan sette det uten å vite hva det gjør
2. URL-bound — forsvinner ved neste side-load
3. Stringent — `?debug=1` vil IKKE aktivere (default-spillere er trygge selv om de skriver det)

`isDebugHudEnabled()` i `Game1Controller.ts:1136` har **ingen localStorage-fallback**:

```typescript
private isDebugHudEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("debug") === "full";
  } catch {
    return false;
  }
}
```

## Hva som IKKE endres (kontrakter)

Disse må fortsatt fungere uavhengig av debug-HUD-flagg:

| Modul | Hvorfor alltid aktiv |
|---|---|
| **EventTracker** (singleton, `debug/EventTracker.ts`) | Brukes til Sentry-breadcrumbs uavhengig av om panel er mounted. `getEventTracker()` er trygg å kalle alltid. |
| **Sentry-bootstrap** (`telemetry/Sentry.ts` + `observability/sentryBootstrap.ts`) | Egen aktivering — bygger på `VITE_SENTRY_DSN`, ikke på debug-flagg. |
| **OBS-2 / installDebugSuite** (`debug/activation.ts` + `debug/installDebugSuite.ts`) | Separat debug-system med rrweb-recorder + state-dump. Bruker `spillorama.debug` localStorage/cookie + `?debug=1` URL. **IKKE samme gate som denne skill-en dekker.** |

## Hvordan rydde opp legacy localStorage-flagg

`Game1Controller.start()` kaller `cleanupLegacyDebugFlag()` ved hver
instansiering:

```typescript
private cleanupLegacyDebugFlag(): void {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.localStorage === "undefined") return;
    window.localStorage.removeItem("DEBUG_SPILL1_DRAWS");
  } catch {
    // best-effort
  }
}
```

Dette sikrer at brukere som hadde `DEBUG_SPILL1_DRAWS=true` fra tidligere
sesjoner ikke fortsetter å se HUD selv etter at trigger er fjernet.

## Hvor å gjøre endringer (filer)

| Fil | Hva |
|---|---|
| `packages/game-client/src/games/game1/Game1Controller.ts` | `isDebugHudEnabled()`, `mountDebugHud()`, `cleanupLegacyDebugFlag()` |
| `packages/game-client/src/games/game1/debug/DebugEventLogPanel.ts` | Event-log-panel-komponenten |
| `packages/game-client/src/games/game1/debug/ConsoleBridge.ts` | Gate i `installConsoleBridge()` |
| `packages/game-client/src/games/game1/debug/FetchInstrument.ts` | Gate i `installFetchInstrument()` |
| `packages/game-client/src/games/game1/debug/FetchBridge.ts` | Gate i `isEnabled()` |
| `packages/game-client/src/games/game1/debug/ErrorHandler.ts` | Gate i `installErrorHandler()` |

## Anti-mønstre

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Legg til `localStorage`-trigger for HUD | Hold URL-bound — `?debug=full` er ENESTE trigger |
| Gjør HUD on-by-default i dev | Default OFF — også i dev. Bruk URL-param for å aktivere. |
| Mount HUD via `?debug=1` eller andre korte koder | Kun `?debug=full` (eksplisitt opt-in) |
| Fjern `cleanupLegacyDebugFlag()` | Beholder — rydder opp brukere med gammel localStorage-state |
| Gating `EventTracker` på debug-flagg | EventTracker er ALLTID aktiv (Sentry-breadcrumbs). Kun panelet/HUD skal gates. |
| Endre OBS-2 / installDebugSuite-gate (`debug/activation.ts`) | Separat system. Hold dem decoupled. |

## Verifikasjon

For å verifisere at default-modus skjuler debug-HUD:

```bash
# 1. Start dev-stack
npm run dev:nuke

# 2. Åpne uten debug-param
open "http://localhost:4000/web/?dev-user=demo-pilot-spiller-1"
# Forventet: ingen HUD synlig, ingen event-log-boks

# 3. Åpne med debug-param
open "http://localhost:4000/web/?dev-user=demo-pilot-spiller-1&debug=full"
# Forventet: HUD top-right, event-log top-left
```

Hvis du ser HUD uten `?debug=full` i URL:
- Sjekk om `localStorage.DEBUG_SPILL1_DRAWS` er satt — skal ryddes av `cleanupLegacyDebugFlag()`
- Sjekk om `installDebugSuite` (OBS-2) er aktivert — det er en separat HUD (gold border, drag-bar)

## Relaterte direktiver

- Tobias-direktiv 2026-05-15: "fjern alle de debug feltnee ... full spillopplevelse"
- §2.19 IMMUTABLE: Skill-doc-protokoll alltid i fix-agent-prompts
- `PITFALLS_LOG.md` §7: Debug-HUD + event-log skjult som default

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-15 | Initial — `?debug=full`-only gating; localStorage-trigger fjernet; legacy-flagg auto-cleanup | Agent (på Tobias-direktiv) |
