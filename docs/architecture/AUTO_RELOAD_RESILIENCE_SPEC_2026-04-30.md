# Auto-Reload-Resiliens for Spillorama-klient — Spec

**Dato:** 2026-04-30
**Status:** Forskning + design — ikke implementert
**Scope:** Spiller-vendt klient (web-shell + Pixi-spill-runtime) i nettleser OG terminal-EXE

## 0. Hvorfor dette dokumentet finnes

Tobias rapporterte 2026-04-30 at en spiller etter § 66-pause (5-min obligatorisk pause etter 60 min spill) fikk "siden kunne ikke lastes — oppdater siden". På terminal-EXE-er i hallen finnes **ingen oppdater-knapp for kunden**. Ønsket atferd:

1. Aldri vis "kontakt support / oppdater siden" hvis stille auto-reload kunne fikse feilen.
2. Vis loading-bilde med kontekst ("Pausen er over — gjenoppretter…").
3. Eskalér til "kontakt support" **kun** når problemet er bekreftet ikke-recoverable.

For non-tech: dokumentet sier hva klienten skal gjøre uten å spørre kunden. Tekniske detaljer i appendix A.

---

## 1. Research-summary — bransjens patterns

Evolution Gaming publiserer ikke klient-koden, men bransje-konsensus er godt dokumentert. Viktigste mønstre:

| # | Mønster | Kjerneinnsikt | Kilde |
|---|---|---|---|
| 1 | **Eksponentiell backoff + jitter** | Start 500ms-1s, dobl hver gang, cap 30s, multipliser med tilfeldig 0.5-1.0 for å unngå thundering herd. Formel: `delay = min(base × 2^n, 30s) × (0.5 + random × 0.5)`. | [WebSocket.org](https://websocket.org/guides/reconnection/) |
| 2 | **Sekvensnummer-resync** | Server tildeler stigende ID per melding. Ved reconnect sender klient siste-ID; server replayer alt nyere. | [WebSocket.org](https://websocket.org/guides/reconnection/) |
| 3 | **Maks-retries / maks-tid før eskalering** | 10-15 forsøk eller 2-5 min wall-clock. 12 retries fra 500ms-base = ca 2 min. Etter dette: gi opp og vis "kontakt support". | [OneUptime](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection/view) |
| 4 | **Idempotency-keys for outbound** | Klient kø-er ikke-ack-ede emits og resender med samme ID. Spillorama har dette via `mini_game:resume` (MED-10). | [WebSocket.org](https://websocket.org/guides/reconnection/) |
| 5 | **Token-refresh før reconnect** | Hent fersk JWT silent før nytt handshake. Refresh-fail → eskalering. | [Reform — Expired tokens](https://www.reform.app/blog/handle-expired-api-tokens) |
| 6 | **Service-worker offline-fallback** | Cached app-shell vises i stedet for browser-default-error når WAN er nede. | [MDN PWA tutorial](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Offline_Service_workers), [getfishtank.com](https://www.getfishtank.com/insights/building-native-like-offline-experience-in-nextjs-pwas) |
| 7 | **Kiosk auto-restart on crash** | Terminal-OS restarter app-en hvis den krasjer. | [Android-kiosk KB](https://help.android-kiosk.com/en/article/kb-automatic-page-reload-options-1491o3/), [Microsoft Learn](https://learn.microsoft.com/en-us/answers/questions/5646843/kiosk-connectivity-live-video-needs-to-restart-eve) |
| 8 | **Heartbeat ping/pong** | Klient sender ping 30s; ingen pong innen 10s → behandle som disconnect. Socket.IO innebygd. | [WebSocket.org](https://websocket.org/guides/reconnection/) |
| 9 | **Ingen "refresh"-instruksjoner i kiosk-feilmeldinger** | I kiosk er "trykk F5"-tekst meningsløs. | [Android-kiosk KB](https://help.android-kiosk.com/en/article/kb-automatic-page-reload-options-1491o3/) |

**Konklusjon:** Industri sier *stille auto-recovery først, eskalering sist*. Spillorama gjør allerede #1, #4, #8 — men #3, #5 og #9 mangler.

---

## 2. Current-state-analyse — hva utløser bug-en

### Hva som finnes

- `packages/game-client/src/components/LoadingOverlay.ts` — state-machine med "stuck"-detector som etter 5s viser **"Last siden på nytt"**-knapp.
- `packages/game-client/src/net/SpilloramaSocket.ts` — Socket.IO med `reconnection: true`, `Infinity` attempts, 1s-30s backoff (innebygd jitter via `randomizationFactor: 0.5`).
- `packages/game-client/src/games/game1/logic/ReconnectFlow.ts` — `resumeRoom` → `getRoomState` fallback → snapshot-apply. 5s SYNC-timeout.
- `apps/backend/public/web/spillvett.js` — § 66-pause-modal med live nedtelling (linje 740-845). Polling 15s via `ensureRefreshLoop` (linje 318-326).
- MED-10 `sendMiniGameJoin` + `sendMiniGameResume` etter reconnect.

### Hva som forårsaker bug-en

Etter § 66-pause utløp:
1. Backend setter `restrictions.isBlocked = false`.
2. Klient venter på neste 15-sek-poll (`spillvett.js:321`). Server pusher ikke aktivt `compliance:state`.
3. Hvis token utløpte i pausen (8t JWT) → første HTTP returnerer 401.
4. `apiRequest` (linje 253-267) kaster Error → catch setter `state.error` → `complianceAllowsPlay()` returnerer false → spillknapper deaktivert + feilmelding.
5. **Brukeren ser feil, ikke en loader.** På terminal: ingen vei ut.

I tillegg: hvis Pixi-runtime er åpen, viser `LoadingOverlay`'s 5s-stuck-timer **"Last siden på nytt"**-knapp som er meningsløs på terminal.

### Viktig nyanse

Spillorama har **god foundation** — Socket.IO retry-er allerede uendelig. Bug-en er at recovery-UI gir opp for tidlig (5s) og viser eskalering når det skjer stille auto-recovery i bakgrunnen.

---

## 3. Proposed-design — tre stier

Hver feil klassifiseres basert på hvor lenge auto-recovery har prøvd og feiltype.

### Sti A — Stille auto-recovery (0-30 sek)

**Når:** Socket-disconnect, token-utløpt, § 66-pause utløp, 503 m/`Retry-After`, manglende `room:update`.

**UI:** `LoadingOverlay` med kontekst-tekst (ingen knapp):
- Pause-utløp: "Pausen er over — gjenoppretter spill…"
- Network-blip: "Kobler til igjen…"
- Token: "Verifiserer økt…"
- Resync: "Henter rundedata…"

**Bakgrunn:**
1. Socket.IO retry-er med backoff (allerede).
2. På `reconnect`-event: hent fersk token fra `/api/auth/refresh`, oppdater `socket.auth.accessToken`, kjør `resumeRoom`.
3. Polling-loop: ved 401 → silent token-refresh + retry. Fortsatt feil → sti B.
4. § 66-pause: når server-modal nedtelling treffer 0, klient gjør automatisk `compliance` + `room:state`-fetch uten å vise feil.

### Sti B — Forlenget loading (30 sek - 2 min)

**Når:** Sti A har feilet 30 sekunder.

**UI:** `LoadingOverlay` med sterkere tekst: "Vi har problemer med å koble til. Prøver igjen…" + sub-tekst "Forsøk 5 av 12". Ingen reload-knapp på terminal.

**Bakgrunn:**
1. Etter 3 mislykkede reconnects (ca 7s med backoff): klient gjør `location.reload()` programmatisk på nettleser, eller utløser kiosk-launcher-restart på terminal.
2. Telemetri: `auto_reload_triggered` med `reason`, `attemptNumber`.
3. Service-worker (hvis aktiv) serverer cached app-shell uten WAN.

### Sti C — Bekreftet ikke-recoverable (2+ min)

**Når:** 12+ retries, eller 503 med `Retry-After: indef`, eller 3+ `auto_reload_triggered` innen 5 min.

**UI:** Ny `SupportContactOverlay`:
- "Vi har problemer med å koble til"
- "Vennligst kontakt support på {hall-spesifikt nummer}"
- Diskret "Prøver igjen automatisk om 30s"-tekst
- **Ingen "oppdater siden"-knapp** noen sted.

**Bakgrunn:** Auto-retry fortsetter med 30s-intervall. Ved suksess → fjern overlay, gjenoppta uten å forstyrre. Telemetri: `escalated_to_support`.

### Terminal-modus deteksjon

To strategier (redundans):
1. **Build-time:** terminal-builds setter `window.__SPILLORAMA_TERMINAL__ = true` via injected script.
2. **Runtime:** sjekk user-agent for kjent kiosk-Chromium + `location.protocol === "file:"`.

I terminal-modus: aldri vis "Last siden på nytt"; auto-reload kjøres etter 30s i stedet for 60s; eskalering inkluderer hall-spesifikt support-tlf.

---

## 4. Sized PR-plan

| PR | Tittel | Filer | Estimat | Tester |
|---|---|---|---|---|
| **PR-1** | Fjern reload-knapp + auto-reload-policy | `LoadingOverlay.ts`, test, `Game1Controller.ts` | 4-6 t | Verifiser `auto_reload_triggered` etter 30s |
| **PR-2** | Reconnect m/token-refresh + sti-B-eskalering | `SpilloramaSocket.ts`, `ReconnectFlow.ts`, ny `AutoReloadPolicy.ts` | 6-8 t | Unit-tester på counter-state, terskler |
| **PR-3** | § 66-pause-utløps-handler | `spillvett.js` linje 740-845, ny `pauseExpiryHandler.js` | 4-6 t | Manuell: kort-circuit pause, verifiser auto-reload |
| **PR-4** | Terminal-modus-detection + bygg-flag | `vite.config.ts`, `LoadingOverlay.ts`, ny `clientEnvironment.ts` | 4 t | Snapshot terminal vs browser |
| **PR-5** | `SupportContactOverlay` + per-hall kontakt-info | Ny komponent, admin-felt, DB-migrasjon `app_halls.support_phone` | 6-8 t | E2E: 3 fail → overlay m/korrekt nummer |

**Totalt:** 24-32 dev-timer (3-4 dev-dager). PR-1+PR-2 lander først, deretter PR-3+PR-4 parallelt, til slutt PR-5.

### Risiko

- **PR-1 (Lav):** Eksisterende test-suite dekker overlay; mock `location.reload` i jsdom.
- **PR-2 (Medium):** Token-refresh-race hvis refresh-token også utløpt → return-til-login. BIN-279 proactive refresh hjelper.
- **PR-3 (Medium):** § 66 er regulatorisk — auto-reload må ikke bypasse pause-håndhevelse. Backend er fail-closed; klient kun re-fetch + state-rebuild.
- **PR-4 (Lav):** Krever ops-koordinering for terminal-build-env i Render.
- **PR-5 (Lav-medium):** Trenger seed-data for support-telefon på alle eksisterende haller før prod.

---

## 5. Åpne spørsmål til Tobias

1. **Hva er "kontakt support"-info?** Per-hall telefon? Felles? Vi trenger en kanal kunden kan bruke uten Internett (telefon).
2. **Terminal-build-pipeline:** finnes det allerede én, eller deployer vi samme web-build til kiosk-browser? Avgjør PR-4-scope.
3. **§ 66-pause: skal modal lukke seg automatisk** når pausen er over, eller trykker spilleren en knapp? Auto-redirect til lobby er renere.
4. **Hvor aggressivt auto-reloade på aktiv runde?** Hvis spilleren har bonger og runden er IN_PROGRESS, full `location.reload()` er sterk reset. Bør vi heller restarte kun spill-app-en via `bridge.start()/destroy()`?
5. **Service-worker / PWA:** finnes? Trengs for offline-side i sti C. Uten service-worker: hvis WAN er totalt borte er hele app-bundle borte.
6. **Telemetri:** hvor rapporteres `auto_reload_triggered` + `escalated_to_support`? Sentry? Allerede via `Telemetry.ts`?

---

## Appendix A — Tekniske detaljer

### A1. Backoff-formel

```typescript
function nextDelay(attempt: number): number {
  const base = 1000, max = 30000;
  const exponential = Math.min(base * Math.pow(2, attempt), max);
  return Math.floor(exponential * (0.5 + Math.random() * 0.5));
}
```
Per [WebSocket.org](https://websocket.org/guides/reconnection/). Socket.IO matcher allerede dette via `reconnectionDelay` + `reconnectionDelayMax` + `randomizationFactor`.

### A2. Eskaleringsterskler

| Terskel | Action |
|---|---|
| 3 sek | Vis loader m/kontekst (sti A). Ingen knapp. |
| 30 sek (≈ 5 retries) | Programmatisk `location.reload()` (sti B). |
| 60 sek | Repeat reload én gang. |
| 2 min (12 retries) | `SupportContactOverlay` (sti C). Auto-retry 30s-intervall. |
| 5 min | Telemetri `permanent_disconnect`. |

### A3. State-resync (eksisterer + utvidelser)

Eksisterer: `resumeRoom` + `getRoomState`-fallback (`ReconnectFlow.ts`); `mini_game:resume` (MED-10); BIN-501 event-buffer; `wallet:state`-push (BIN-760).

Trenger utvidelse: `compliance:state`-push fra server når § 66 utløper, eller behold polling men håndter som "stille resync".

### A4. Lint-regel

Etter PR-1+PR-4 skal `grep -rn "Last siden\|oppdater siden\|refresh.*page" packages/game-client apps/backend/public/web` returnere 0 hits. Custom ESLint-rule eller pre-commit grep-check kan håndheve.
