# Lokal admin-web mot prod-backend (Setup A)

**Tobias 2026-05-01:** Korteste mulige feedback-loop for frontend-arbeid på `apps/admin-web/`. Vite kjører lokalt på port 5174 og proxyer alle API + socket-kall til live prod-backend på Render. Frontend-endringer hot-reloader på <1s. Ingen lokal Postgres / Redis / backend kreves.

## Kjør

```bash
# Fra repo-root
npm run dev:admin:prod
```

Åpne: <http://localhost:5174/admin/>

Hot-reload er på — endre en fil i `apps/admin-web/src/` og browseren refresher umiddelbart med endringen din.

## Hva proxyes

| Path-prefix | Mål |
|---|---|
| `/api/*` | `https://spillorama-system.onrender.com/api/*` |
| `/socket.io` | `wss://spillorama-system.onrender.com/socket.io` |
| `/tv-voices/*` | `https://spillorama-system.onrender.com/tv-voices/*` |

Alle requests fra browseren går mot `localhost:5174` — Vite proxyer dem videre. Det betyr ingen CORS-problemer.

## Når man bør bruke denne

✅ **Bruk for:**
- Endringer i `apps/admin-web/src/` (TypeScript, CSS, HTML)
- Bug-fixes i Modal/Header/Sidebar/pages
- Wireframe-paritet-arbeid på admin-UI
- A/B-test av komponenter mot ekte prod-data

❌ **Ikke bruk for:**
- Backend-endringer (`apps/backend/`) — krever full lokal stack (se Alternativ B)
- Endringer i `packages/shared-types` — backend må re-build for å plukke dem opp
- Tester som krever DB-mutasjoner du ikke vil ha i prod (eks. opprette/slette haller via UI)

## Sikkerhets-merknader

- **Du jobber mot LIVE prod-DB.** Hver knappetrykk i UI-en kan endre prod-data.
- Logg inn med en demo-konto eller test-konto, ikke en konto som kan rote bort produksjonsdata.
- Hvis en API-endring krever backend-deploy: gjør endringen i koden, push til feature-branch, admin-merge, vent ~3-5 min for deploy. Frontend-en din peker fortsatt på prod og vil plukke opp den nye API-en når den er live.

## Standard local-dev (uendret)

```bash
# Mot lokal backend på port 3000 (krever apps/backend kjørende)
npm run dev:admin
```

## Implementasjon

`apps/admin-web/vite.config.ts` leser `VITE_DEV_BACKEND_URL` fra prosess-env. `dev:prod-backend`-scriptet setter den til Render-URL-en. Default (uten env-var) er `http://localhost:3000` for å beholde eksisterende lokal-dev-flyt.
