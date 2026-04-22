# Spillorama-system

> Scope-beslutning 9. april 2026: dette repoet er kun for live bingo-systemet. Hvis denne README-en er i konflikt med `docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`, er det dokumentet styrende.

Dette repoet eier live bingo-plattformen:

- live portal
- live auth
- live wallet
- live compliance
- live admin
- live Spillorama-lobby
- live Spillorama-spill (web-native + iOS/Android/Windows shells)
- generisk spillkatalog

Det eier ikke Candy demo-login, Candy demo-admin eller Candy demo-settings.

## Repo-struktur

```
.
├── apps/                    # Deployable applications
│   ├── backend/             # Node/TypeScript backend (Render.com-deployet)
│   ├── admin-web/           # Static admin UI
│   ├── ios/                 # iOS shell placeholder (Swift/SwiftUI)
│   ├── android/             # Android shell placeholder (Kotlin)
│   └── windows/             # Windows/exe shell placeholder (Tauri eller Electron)
│
├── packages/                # Shared libraries (npm workspaces)
│   ├── shared-types/        # Delte TypeScript-typer (backend ↔ klient)
│   └── game-client/         # Web-native spill-klient (Pixi.js)
│
├── infra/                   # Deploy-scripts og infra-kode
│   └── deploy-backend.sh
│
├── docs/                    # Prosjekt-dokumentasjon (tematisk inndelt)
│   ├── architecture/        # Arkitektur, scope, boundaries
│   ├── compliance/          # Pengespillforskriften, Spillvett, audit
│   ├── engineering/         # Workflow, conventions, rapporter
│   ├── operations/          # Runbooks, incident response
│   └── archive/             # Utdatert/historisk
│
├── .github/workflows/       # CI + compliance gate
├── docker-compose.yml       # Lokal stack (backend + postgres + redis) — må ligge i rot
├── render.yaml              # Render.com Blueprint — må ligge i rot
└── package.json             # Root workspace manifest
```

**Designprinsipper:**

- `apps/` = deployables. Alt som kjører i produksjon mot sluttbruker eller drift.
- `packages/` = delte bibliotek. Ingen deploy — konsumeres av apps.
- `infra/` = deploy-scripts og infra-kode.
- Best practice holdes: én tydelig kilde per modul, ingen blanding av deployables og delt kode, én dokumentasjonsgren.

Se [apps/README.md](apps/README.md) for detaljer.

## Tre kodebaser

| System | Lokal mappe | Repo | Produksjon | Eier |
|---|---|---|---|---|
| Live bingo | `/Users/tobiashaugen/Projects/Spillorama-system/` | `tobias363/Spillorama-system` | `https://spillorama-system.onrender.com/` | portal, wallet, auth, compliance, admin, lobby |
| Candy | `/Users/tobiashaugen/Projects/Candy/` | `tobias363/candy-web` | Candy-klient og spillkode | selve spillet, UI, assets, gameplay |
| demo-backend | `/Users/tobiashaugen/Projects/demo-backend/` | `tobias363/demo-backend` | `https://candy-backend-ldvg.onrender.com/` | demo-login, demo-admin, demo-settings, demo-drift |

## Domener og ruter

| Domene | Path | System | Betydning |
|---|---|---|---|
| `spillorama-system.onrender.com` | `/` | Live bingo | portal |
| `spillorama-system.onrender.com` | `/admin/` | Live bingo | live admin |
| `spillorama-system.onrender.com` | `/web/` | Live bingo | lobby / web-native spill |
| `candy-backend-ldvg.onrender.com` | `/` | demo-backend | Candy integrasjonsflate / testflate |
| `candy-backend-ldvg.onrender.com` | `/admin/` | demo-backend | Candy demo-admin |

Samme route-navn på to forskjellige domener betyr ikke samme system.

## Hvor skal endringer gjøres?

| Jeg vil endre | Riktig kodebase | Kommentar |
|---|---|---|
| Live portal eller live admin | `Spillorama-system` | jobb i `apps/admin-web/` eller `apps/backend/src/admin/` |
| Live wallet, auth eller compliance | `Spillorama-system` | jobb i `apps/backend/src/` |
| Web-native spill (Spill 1–5) | `Spillorama-system` | jobb i `packages/game-client/src/games/` |
| iOS / Android / Windows-klient | `Spillorama-system` | jobb i `apps/{ios,android,windows}/` |
| Candy gameplay, UI eller assets | `Candy` | jobb i Candy-repoet |
| Candy demo-login, demo-admin eller demo-settings | `demo-backend` | jobb i `demo-backend`-repoet |

## Kom i gang

```bash
# Installer avhengigheter (root og alle workspaces)
npm install

# Type-sjekk backend
npm run check

# Bygg alt (shared-types → game-client → backend)
npm run build

# Kjør compliance-suite (regulatorisk gate)
npm run test:compliance

# Alt samlet
npm run check:all

# Dev-server (backend på port 4000)
npm run dev

# Lint OpenAPI-spec (BIN-605)
npm run spec:lint --prefix apps/backend
```

**OpenAPI-spec:** `apps/backend/openapi.yaml` (3.1.0) dekker alle HTTP-endepunkter. CI kjører `redocly lint` mot spec-en — brutt struct (ugyldig OpenAPI 3.1) eller dangling `$ref` feiler build. Policy-warnings er toggled via [`apps/backend/redocly.yaml`](apps/backend/redocly.yaml). Kjør lokalt før commit med kommandoen over.

## Candy i live bingo

Live bingo kan fortsatt kjenne til Candy som et eksternt spill på generisk nivå, for eksempel via spillkatalog, launch-URL eller en generisk embed-mekanisme. Live bingo skal ikke eie demo-driften rundt Candy.

Det betyr i praksis at `Spillorama-system` kan inneholde:

- Candy tile i lobbyen
- `POST /api/games/candy/launch`
- `/api/ext-wallet/*`
- iframe/overlay-hosting fra live `/web/`

Det betyr ikke at `Spillorama-system` skal eie Candy gameplay eller Candy-backend.

## Les disse dokumentene for full detalj

- [docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md](docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md)
- [docs/architecture/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md](docs/architecture/CANDY_SEPARATION_AND_FUTURE_OPERATING_MODEL_2026-04-09.md)
- [docs/architecture/ARKITEKTUR.md](docs/architecture/ARKITEKTUR.md)
- [docs/engineering/ENGINEERING_WORKFLOW.md](docs/engineering/ENGINEERING_WORKFLOW.md)

## Render-navnstatus

Repo og Blueprint bruker navnet `Spillorama-system` / `spillorama-system`.

Live host er `https://spillorama-system.onrender.com/`.

## Kort regel

Hvis endringen kun trengs for at `https://candy-backend-ldvg.onrender.com/` eller `https://candy-backend-ldvg.onrender.com/admin/` skal fungere, skal den ikke lages i dette repoet.
