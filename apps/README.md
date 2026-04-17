# apps/ — Deployerbare applikasjoner

Alle sluttbruker-applikasjoner og tjenester ligger her. Biblioteker og delte pakker ligger i `packages/`.

## Nåværende apper

| Mappe | Type | Beskrivelse |
|-------|------|-------------|
| `backend/` | Node.js / TS | Socket.IO-backend (bingo-backend) — autoritativ server for rom, trekning, wallet, compliance |
| `admin-web/` | Web | Admin-UI for hall-operatører og drift |
| `android/` | Android Gradle | Native Android-shell (Kotlin) |
| `ios/` | iOS (placeholder) | iOS-shell — ikke startet |
| `windows/` | Desktop (placeholder) | Windows-shell (.exe) — ikke startet |

## Prinsipper

- **Hver app eier sitt egen deploy-target.** Backend deployes til Render, admin-web til CDN, mobile apps til hhv App Store/Play Store.
- **Deling skjer via `packages/`**, ikke direkte referanser mellom apper.
- **Ingen cross-app imports.** Hvis to apper trenger samme kode → flytt til `packages/`.
