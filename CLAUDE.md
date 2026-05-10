# Spillorama-System

> ## ⛔ STOP — PM-onboarding-gate (HARD-BLOCK FØR FØRSTE KODE-HANDLING)
>
> **Hvis du er en AI eller person som opptrer som PM (Project Manager) for dette prosjektet,
> har du FORBUD mot å skrive kode, åpne PR, mergee, eller koordinere agenter før du har passert
> følgende vanntette gate:**
>
> ```bash
> bash scripts/pm-checkpoint.sh --validate    # exit 0 = passert, exit 1 = må kjøres
> ```
>
> **Hvis exit ≠ 0:** kjør den interaktive gaten først:
>
> ```bash
> bash scripts/pm-checkpoint.sh
> ```
>
> Gaten krever per-fil-bekreftelse av ALLE `docs/operations/PM_HANDOFF_*.md` fra prosjekt-start
> (2026-04-23) til i dag, med 1-3 setninger fri-tekst-takeaway per fil. Den skriver
> `.pm-onboarding-confirmed.txt` til repo-roten som bevis på passert gate. Filen er gyldig i 7
> dager (`PM_CHECKPOINT_VALIDITY_DAYS`).
>
> **Hvorfor vanntett gate?** Tobias-direktiv 2026-05-10: "Vi må gjøre dette så vanntett som mulig
> så ny PM ikke går i de samme fallgruvene som tidligere." Tidligere PM-er har hoppet over eldre
> handoffs og repetert kontekst-tap. Denne gaten er designet for å være umulig å skippe uten å
> bryte direktivet eksplisitt.
>
> **For ikke-PM-roller** (Tobias selv, agenter under PM-koordinering, eksterne utviklere): du
> trenger ikke kjøre gaten — den er kun for personen/AI-en som koordinerer prosjektet på toppen.
> PR-template har checkbox for å indikere rollen.
>
> Detaljer i [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](./docs/engineering/PM_ONBOARDING_PLAYBOOK.md) §3.

---

Live bingo platform for the Norwegian market with real-time multiplayer games, wallet management, and regulatory compliance (pengespillforskriften). The system handles player authentication, responsible gaming, hall-based game sessions, and payment integration.

> ## 🛡️ PM-håndhevings-system (4 lag) — Tobias-direktiv 2026-05-10
>
> Spillorama har fire uavhengige håndhevings-lag som tvinger PM-er til å lese
> dokumentasjon FØR kode-handlinger, og verifisere CI ETTER hver merge:
>
> | Lag | Hva | Hvor håndheves |
> |---|---|---|
> | 1. **Onboarding-gate** | PM må bekrefte lest ALLE handoffs (med 1-3 setn. takeaway per fil) | `bash scripts/pm-checkpoint.sh` (interaktiv) |
> | 2. **Pre-commit blokk** | Commit blokkeres lokalt hvis gate ikke gyldig | `.husky/pre-commit` → `node scripts/check-pm-gate.mjs --strict` |
> | 3. **PR-merge blokk** | PR kan ikke merges uten verifisert gate-marker | `.github/workflows/pm-gate-enforcement.yml` |
> | 4. **Post-merge CI-watcher** | Røde workflows på main → auto-issue tagger PM | `.github/workflows/pm-merge-verification.yml` |
>
> **PM-en har en av sine viktigste plikter i å verifisere at alle PR-er går
> grønt gjennom CI** (per Tobias-direktiv). Detaljer:
> [`docs/operations/PM_PR_VERIFICATION_DUTY.md`](./docs/operations/PM_PR_VERIFICATION_DUTY.md).
>
> **For ikke-PM-roller** (Tobias selv, agenter under PM-koordinering, dependabot):
> bruk `gate-not-applicable: <rolle>` i PR-beskrivelsen, eller
> `PM_GATE_BYPASS=1` for engang-bypass (dokumentert).
>
> **Public audit-trail** (hash-only, ingen takeaways eksponert):
> [`docs/.pm-confirmations.log`](./docs/.pm-confirmations.log).

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js / Bun | 22.x | Server runtime for backend |
| Backend Framework | Express | 4.21 | HTTP server and routing |
| Real-time | Socket.IO | 4.8 | Player connections, game updates, multiplayer sync |
| Database | PostgreSQL | 16 | System of record for accounts, wallets, compliance |
| Cache | Redis | 7 | Room state, session storage, rate limiting |
| Frontend Build | Vite | 6.3 | Fast dev server and bundling for web/admin |
| Game Engine | Pixi.js | 8.6 | WebGL-based 2D game rendering (spill-client) |
| Language | TypeScript | 5.8–5.9 | Strict mode enabled across all packages |
| Testing | vitest / tsx --test | 3.1 / 4.19 | Unit and compliance tests |
| Deployment | Docker + Render.com | - | Frankfurt region, Blue-Green deploys |

## Quick Start

```bash
# Prerequisites
# - Node.js 22+ or Bun
# - Docker + Docker Compose (for local Postgres/Redis)
# - Git

# Clone and install
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system
npm install

# F1 (E2E-verification 2026-Q3): root `npm install` installerer ikke
# automatisk i workspaces. Hvis backend-deps mangler ved `npm run dev`
# (f.eks. `Cannot find package 'nodemailer'`), kjør:
npm --prefix apps/backend install

# F2 (E2E-verification 2026-Q3): shared-types må bygges før backend dev
# startes første gang (ellers feiler import av '@spillorama/shared-types').
npm run build:types

# One-command lokal-stack: Docker + Postgres + Redis + migrate + smart-seed +
# stale-state-cleanup + backend + admin-web + game-client + visual-harness.
# Skriver utvidet status-tabell (PIDs, DB-state, test-URL-er med dynamisk
# TV-token) når alt er oppe. Ctrl+C dreper alt pent.
npm run dev:all

# Hvis du har en gammel runde som henger — start med fersh pilot-state:
npm run dev:all -- --reset-state

# Tilgjengelige flagg: --no-docker --no-harness --no-admin --skip-migrate
#                     --force-seed --reset-state

# (Backwards-compat: gamle individuelle dev-kommandoer fungerer fortsatt)
npm run dev            # Bare backend (port 4000)
npm run dev:admin      # Bare admin UI (port 5174)
npm run dev:games      # Bare game client (port 5173)

# Spin up local infrastructure (Postgres + Redis + backend)
docker-compose up -d

# Type-check backend
npm run check

# Run tests
npm test                    # All units
npm run test:compliance     # Regulatory tests only
npm run test:visual        # Playwright visual regression

# Build for production
npm run build
```

## Project Structure

```
spillorama-system/
├── apps/
│   ├── backend/                # Node.js / Socket.IO server (Render deploy)
│   │   ├── src/
│   │   │   ├── index.ts        # Express + Socket.IO setup
│   │   │   ├── game/           # BingoEngine, Game3Engine, game logic
│   │   │   ├── adapters/       # Postgres, KYC, wallet adapters
│   │   │   ├── compliance/     # Pengespillforskriften audit & rules
│   │   │   ├── auth/           # Auth tokens, JWT, session
│   │   │   ├── wallet/         # Wallet state, transfers, KYC
│   │   │   ├── integration/    # Email, SMS, Swedbank Pay
│   │   │   ├── platform/       # Hall config, player management
│   │   │   ├── draw-engine/    # Draw scheduling, RNG
│   │   │   ├── util/           # Helpers, metrics, logging
│   │   │   ├── middleware/     # Rate limiting, auth guards
│   │   │   ├── migrations/     # DB migration scripts
│   │   │   └── compliance/     # Test suite for regulations
│   │   ├── openapi.yaml        # API spec (3.1.0)
│   │   ├── package.json
│   │   └── tsconfig.json       # strict: true, ES2022 target
│   │
│   ├── admin-web/              # Admin portal (static Vite build, CDN deploy)
│   │   ├── src/
│   │   │   ├── main.ts         # Entry point
│   │   │   ├── pages/          # Admin views (dashboard, reports, users)
│   │   │   └── styles/         # CSS modules
│   │   ├── index.html
│   │   └── vite.config.ts
│   │
│   ├── ios/                    # iOS shell (SwiftUI placeholder)
│   ├── android/                # Android shell (Kotlin placeholder)
│   └── windows/                # Windows shell (placeholder)
│
├── packages/
│   ├── shared-types/           # Zod + TypeScript type definitions
│   │   ├── src/
│   │   │   ├── index.ts        # Core types (Player, Room, Game, etc)
│   │   │   ├── game.ts         # Game-specific types
│   │   │   ├── api.ts          # HTTP request/response types
│   │   │   ├── socket-events.ts # Socket.IO event signatures
│   │   │   └── spill1-patterns.ts # Game 1 patterns (bingo cards)
│   │   └── __tests__/          # Shared type validation tests
│   │
│   └── game-client/            # Pixi.js-based web game client
│       ├── src/
│       │   ├── main.ts         # Vite entry
│       │   ├── games/          # game1/, game2/, game3/, game5/ (Spill 1–4 — Game 4 deprecated)
│       │   ├── ui/             # UI overlays, lobby, chat
│       │   ├── engine/         # Pixi rendering, animation, input
│       │   ├── socket/         # Socket.IO event handlers
│       │   └── i18n/           # Internationalization (Norwegian)
│       └── vite.config.ts
│
├── infra/
│   ├── deploy-backend.sh       # Manual backend deploy script
│   └── ...                     # Infrastructure automation
│
├── docs/
│   ├── architecture/           # System design, boundaries, scope
│   ├── compliance/             # Pengespillforskriften, audit logs
│   ├── engineering/            # Workflows, conventions, patterns
│   ├── operations/             # Runbooks, deployment
│   └── api/                    # API docs (auto-gen from OpenAPI)
│
├── .github/
│   ├── workflows/              # CI/CD: type-check, compliance, deploy
│   └── pull_request_template.md
│
├── docker-compose.yml          # Local dev: backend + postgres + redis
├── render.yaml                 # Render.com Blueprint (IaC)
├── package.json                # Root workspace manifest
└── tsconfig.json               # Shared TypeScript config
```

## Architecture Overview

**Three-tier system:**

1. **Backend** (Node.js/Express + Socket.IO)
   - Authority for game state, room management, wallet, compliance
   - Postgres for persistence; Redis for distributed room state
   - Adapters layer for wallet backends (Postgres, external), KYC (BankID, local), RNG

2. **Frontend** (Admin Web)
   - Static Vite SPA deployed to CDN
   - Hall operator dashboard, player management, audit logs
   - Communicates with backend via HTTP + Socket.IO

3. **Game Client** (Pixi.js)
   - Web-native games Spill 1–4 (code-names game1, game2, game3, game5) rendered on WebGL
   - Candy is an external third-party game integrated via iframe (not implemented in this repo)
   - Real-time multiplayer via Socket.IO
   - Embedded in lobby or standalone

**Key Principles:**
- Backend is source of truth for game state
- All real-time events flow through Socket.IO
- Regulatory compliance is built-in (not bolted on)
- Responsible gaming enforced at hall + player level
- No external RNG dependency; in-house random draw

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| BingoEngine | `apps/backend/src/game/` | Core 75/90-ball bingo logic |
| Game3Engine | `apps/backend/src/game/` | Alternative game variant |
| PlatformService | `apps/backend/src/platform/` | Hall config, player registration |
| WalletService | `apps/backend/src/wallet/` | Deposits, withdrawals, balance checks |
| ResponsibleGamingStore | `apps/backend/src/game/` | Limit enforcement, self-exclusion, pause |
| AuditLogService | `apps/backend/src/compliance/` | Pengespillforskriften audit trail |
| AuthTokenService | `apps/backend/src/auth/` | JWT session management |
| DrawScheduler | `apps/backend/src/draw-engine/` | Draw timing and RNG |
| SocketRateLimiter | `apps/backend/src/middleware/` | Per-socket rate limiting |
| Pixi Game Client | `packages/game-client/src/` | Multiplayer game rendering |
| Shared Types | `packages/shared-types/src/` | Type source of truth (Zod validated) |

## Development Guidelines

### Code Style

**File Naming:**
- Classes and adapters: **PascalCase** (`BingoEngine.ts`, `PostgresWalletAdapter.ts`)
- Utilities and services: **camelCase** (`apiHelpers.ts`, `roomState.ts`)
- Test files: `*.test.ts` or `*.spec.ts` co-located with source
- Config files: lowercase with hyphens (`vite.config.ts`, `tsconfig.json`)

**Code Naming:**
- Components/Classes: **PascalCase** (`export class BingoEngine { }`)
- Functions: **camelCase** (`function fetchPlayer()`, `export const createAdapter = () => { }`)
- Variables: **camelCase** (`const userData`, `let isLoading`)
- Constants: **SCREAMING_SNAKE_CASE** (`const MAX_BET_AMOUNT = 5000`)
- Boolean vars: **is/has/should** prefix (`isLocked`, `hasPermission`)
- Private fields: **_underscore** prefix (`this._cache`)
- Type aliases/Interfaces: **PascalCase** (`type GameSnapshot = { ... }`)

**Import Order:**
1. External packages (`express`, `socket.io`, `pg`)
2. Node internal (`node:fs`, `node:path`)
3. Absolute imports from workspace (`@spillorama/shared-types`)
4. Relative imports (`./util`, `../game`)
5. Type-only imports with `type` keyword (`import type { Player } from '...'`)

**Example:**
```typescript
// ✅ Correct
import express from 'express';
import { Server } from 'socket.io';
import type { GameSnapshot } from '@spillorama/shared-types';
import { BingoEngine } from './game/BingoEngine.js';
import { createAdapter } from './util/adapterFactory.js';

class WalletAdapter {
  private _cache: Map<string, number> = new Map();
  
  async transferFunds(playerId: string, amount: number): Promise<void> {
    const MAX_TRANSFER = 100000;
    if (amount > MAX_TRANSFER) {
      throw new Error('Exceeds limit');
    }
    // ...
  }
}
```

### Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`

**Scopes:** `backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance`

**Examples:**
```
feat(backend): add hall-level betting limits

fix(game-client): correct spill1 ball animation timing

test(backend): add tests for ResponsibleGamingStore

docs(compliance): update pengespillforskriften audit trail spec
```

### Testing Strategy

- **Unit tests:** Test business logic, edge cases, error paths. Co-locate with source.
- **Integration tests:** Database queries, Socket.IO messaging, API endpoints.
- **Compliance tests:** Pengespillforskriften rules (`npm run test:compliance`).
- **Visual tests:** Playwright (`npm run test:visual`) for game rendering.

Test data should use fixtures from `apps/backend/src/__fixtures__/`. Avoid touching production databases in tests.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend dev server (port 4000, hot reload via tsx) |
| `npm run dev:admin` | Start admin-web dev server (Vite, port 5173) |
| `npm run dev:games` | Start game-client dev server (Vite, port 5174) |
| `npm run check` | Type-check backend with TypeScript |
| `npm run build` | Build all: shared-types → game-client → admin-web → backend |
| `npm test` | Run all unit tests |
| `npm run test:compliance` | Run pengespillforskriften audit tests |
| `npm run test:visual` | Run Playwright visual regression tests |
| `npm run test:visual:update` | Update visual test snapshots |
| `npm run test:visual:ui` | Run visual tests in UI mode |
| `npm run spec:lint` | Lint OpenAPI spec (redocly) |
| `npm run deploy:backend` | Deploy backend to Render (manual, rarely used) |
| `docker-compose up` | Spin up local Postgres 16 + Redis 7 + backend |
| `docker-compose down` | Stop local services |

## Environment Variables

**Backend required (.env):**

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Execution context | `development` or `production` |
| `PORT` | Yes | HTTP server port | `4000` |
| `APP_PG_CONNECTION_STRING` | Yes | Main Postgres connection | `postgres://user:pw@localhost/spillorama` |
| `APP_PG_SCHEMA` | Yes | Schema name | `public` |
| `REDIS_URL` | Yes | Redis connection for room state | `redis://localhost:6379` |
| `SESSION_SECRET` | Yes | Secret for session signing | (generate random 32-char string) |
| `JWT_SECRET` | Yes | Secret for JWT tokens | (generate random 32-char string) |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh tokens | (generate random 32-char string) |
| `WALLET_PROVIDER` | Yes | Wallet backend: `postgres` or external | `postgres` |
| `KYC_PROVIDER` | Yes | KYC backend: `bankid` or `local` | `local` (dev) |
| `ROOM_STATE_PROVIDER` | Yes | Room state: `memory` or `redis` | `redis` |
| `SCHEDULER_LOCK_PROVIDER` | Yes | Draw scheduler lock: `memory` or `redis` | `redis` |

See `apps/backend/.env.example` for complete list and defaults.

## Testing

- **Unit tests:** `npm test` runs all `*.test.ts` files via `tsx --test` (Node's built-in runner) and vitest for game-client.
- **Coverage target:** No hard requirement, but aim for critical paths (wallet, compliance, game logic).
- **Compliance tests:** Mandatory before merge. `npm run test:compliance` runs pengespillforskriften validation.
- **Visual regression:** Playwright snapshots for game rendering (`npm run test:visual`).

## Deployment

### Local Development
```bash
docker-compose up -d
npm install
npm run dev
```

### Staging
- Push to `staging` branch
- Render auto-deploys from staging branch
- Logs: `https://dashboard.render.com/`

### Production
1. Create PR from `codex/*` to `main`
2. CI passes (type-check, compliance)
3. Squash and merge to `main`
4. Tag with `v<YYYY.MM.DD.N>` for release
5. Render auto-deploys from main
6. Health check: `GET /health` (should return 200)
7. Post-deploy smoke test: login, wallet balance, payment intent, game join

**Rollback:** Render dashboard → redeploy previous successful version.

## Additional Resources

- **Auto-genererte arkitektur-artefakter:** @docs/auto-generated/ — current state fra main (API-endpoints, DB-skjema, modul-graf, skills-katalog). Les disse FØRST når du leter etter "current state" — håndskrevne docs kan være stale.
- **Architecture decisions:** @docs/architecture/ARKITEKTUR.md
- **Pengespillforskriften compliance:** @docs/compliance/
- **OpenAPI spec:** @apps/backend/openapi.yaml (auto-served at `/api/docs`)
- **Workflow & PR checklist:** @docs/engineering/ENGINEERING_WORKFLOW.md
- **Operations & runbooks:** @docs/operations/
- **Render Blueprint:** @render.yaml

### Auto-genererte arkitektur-artefakter

`docs/auto-generated/` inneholder alltid-friske artefakter generert fra main av `.github/workflows/auto-generate-docs.yml`:

- `MODULE_DEPENDENCIES.md` — apps + packages dep-graf (mermaid) + backend-domene-graf
- `DB_SCHEMA_SNAPSHOT.md` — tabeller + ALTER TABLE-statistikk parset fra migrations
- `API_ENDPOINTS.md` — alle endpoints fra openapi.yaml, gruppert på tag
- `MIGRATIONS_LOG.md` — kronologisk liste over migrations
- `SKILLS_CATALOG.md` — alle SKILL.md med navn + description
- `SERVICES_OVERVIEW.md` — apps/packages struktur, LOC, backend-domener

**Hvis du leter etter "current state", LES disse FØRST før du graver i kode.** For å regenerere lokalt: `./scripts/generate-architecture-docs.sh`. Filene skal ALDRI redigeres manuelt — endringer overskrives.

## Key Decisions & Constraints

1. **No external RNG**: In-house draw engine. No third-party RNG certification required.
2. **Postgres source of truth**: Redis is ephemeral cache only. All critical state persists to Postgres.
3. **Socket.IO for real-time**: All game updates push to players via Socket.IO, not polling.
4. **Hall-based responsible gaming**: Limits enforced per hall, per player. Voluntary pause and 1-year self-exclusion built-in.
5. **TypeScript strict mode**: All packages must compile with `strict: true`.
6. **Monorepo sharing via packages/**: Apps do NOT cross-import. Shared code moves to packages/.

## Legacy & Scope Boundaries

- **This repo owns:** Live bingo system (portal, wallet, auth, compliance, admin, lobby, Spill 1–4 web-native games + Candy iframe integration)
- **External:** Candy demo-login, demo-admin, demo-settings, and Candy gameplay live in `tobias363/candy-web`
- **Scope decision (2026-04-09):** See @docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md for boundary rules

## Project-specific Conventions

These are decisions baked in by the Spillorama team — not auto-detectable from code.

### 🚨 Spill 1, 2, 3 fundament (LESE-FØRST-I-SESJON — gjelder ALL kode som rører live-spillene)

Hvis du rører ETT av live-spillene — Spill 1 (`bingo`), Spill 2 (`rocket`) eller Spill 3 (`monsterbingo`) — les den tilsvarende implementasjons-status-doc-en **FØR du gjør noe**:

| Spill | Slug | Doc | Når du må lese |
|---|---|---|---|
| **Spill 1** | `bingo` | @docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md | plan-runtime, master-actions (start/pause/resume/advance), scheduled-game lifecycle, klient-lobby, NextGamePanel, Spill1HallStatusBox, GamePlanEngineBridge, GoH-master-koblinger, transfer-master, ticket-purchase, draw-engine, payout |
| **Spill 2** | `rocket` | @docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md | Spill2GlobalRoomService, Spill2ConfigService, Game2AutoDrawTickService, Game2Engine, Game2JackpotTable, Lucky Number, perpetual loop, ROCKET-rom, jackpot-mapping per draw-count |
| **Spill 3** | `monsterbingo` | @docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md | Spill3GlobalRoomService, Spill3ConfigService, Game3AutoDrawTickService, Game3Engine, **Game3PhaseStateMachine**, autoClaimPhaseMode, fixed/percentage premie-modus, MONSTERBINGO-rom, sequential rad-faser |

**Spillene har FUNDAMENTALT forskjellige arkitekturer:**

- **Spill 1** = per-hall lobby + GoH-master + plan-runtime + scheduled-games. Master starter/pauser bevisst.
- **Spill 2** = ETT globalt rom (`ROCKET`) + perpetual loop + auto-tick. Ingen master, ingen plan. Auto-start på `minTicketsToStart`. Jackpot-mapping per draw-count.
- **Spill 3** = ETT globalt rom (`MONSTERBINGO`) + perpetual loop + **phase-state-machine** (Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus med auto-pause mellom faser). Unik for Spill 3 — verken Spill 1 eller Spill 2 har det.

**Antakelser fra ett spill overføres IKKE til de andre.** Endringer i `GamePlanEngineBridge` rører ikke Spill 2/3. Endringer i `Spill2GlobalRoomService` rører ikke Spill 1/3. Endringer i `Game3PhaseStateMachine` rører ikke Spill 1/2.

**Regel ved konflikt:** Hvis koden motsier doc-en, **doc-en vinner**. Oppdater doc-en samtidig som du gjør en avgjørelse — men IKKE handle utenom den uten eksplisitt Tobias-godkjennelse i samme sesjon.

Direktiv fra Tobias 2026-05-08: *"må gjøre sånn at man alltid leser denne slik at man ikke handler utenom de reglene som er satt"*, *"alt av kode som krangler mot hverandre må fjernes ... fundamentet legges godt nå"*, og *"veldig viktig at disse ulikhetene [Spill 1 vs Spill 2/3] kommer frem i beskrivelsen"*.

Dette gjelder uavhengig av om oppgaven er backend, frontend, klient, test, dokumentasjon eller infrastruktur — så lenge ett av live-spillene berøres.

### 🚨 Live-rom-robusthet (P0-MANDAT — ikke kompromisser)

Spill 1, 2 og 3 er live-rom som **alltid** må være tilgjengelige innenfor spilleplanens åpningstid. Mål: Evolution Gaming-grade oppetid (99.95 %+). Hvis du rører rom-arkitektur, socket-events, draw-tick, ticket-purchase eller wallet-touch fra rom-events: **les @docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md først**. R1-R12 i mandatet er pilot-gating. Direktiv fra Tobias 2026-05-08.

### Game rules + payout (KANONISK — les FØR du rører payout-kode)

See @docs/architecture/SPILL_REGLER_OG_PAYOUT.md for autoritative regler om bongpriser, auto-multiplikator, single-prize cap (databingo only), spesialspill (Trafikklys + Oddsen), bonus-spill, multi-vinner, og engine-bridge ticket-config-shape. Hvis du finner kode som motsier doc-en, **doc-en vinner** og koden må fikses.

For per-spill-detaljer (mekanikk, premier, bonus-defaults for hvert av de 13 katalog-spillene + Spill 2/3/4 + bonus-mini-spill): se @docs/architecture/SPILL_DETALJER_PER_SPILL.md.

### Game catalog (master truth)

See @docs/architecture/SPILLKATALOG.md for the definitive game catalog. Quick mapping:

| Marketing | Code-name | Slug | Category | Trekning |
|-----------|-----------|------|----------|----------|
| Spill 1 (Hovedspill 1) | game1 | `bingo` | Hovedspill (75-ball 5×5) | Live |
| Spill 2 (Hovedspill 2) | game2 | `rocket` | Hovedspill (21-ball 3×3, full plate, ETT globalt rom) | Live |
| Spill 3 (Hovedspill 3) | game3 | `monsterbingo` | Hovedspill (75-ball 5×5 uten free, T/X/7/Pyramide à 25%, ETT globalt rom) | Live |
| SpinnGo (Spill 4) | game5 | `spillorama` | **Databingo** (60-ball 3×5 + roulette) | Player-startet |
| Candy | — | `candy` | External iframe (third-party) | Tredjeparts |

**Game 4 / `game4` / `themebingo` is deprecated (BIN-496). Do not use.**

Spillorama drives **three live hovedspill** (Spill 1-3) **and one databingo** (SpinnGo, player-started) per pengespillforskriften. Candy is integrated via iframe with shared wallet — third-party, not Spillorama's regulatory responsibility.

**§11 distribution to organizations:**
- Hovedspill (Spill 1-3): minimum 15%
- Databingo (SpinnGo): minimum 30%

Earlier docs claimed all four were hovedspill — that was incorrect and corrected 2026-04-25.

### Persistent memory

Project memory lives in `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/` with `MEMORY.md` as the index. Auto-loaded each session — use it for user profile, feedback rules, and project decisions that survive across sessions.

### Architecture Decision Records (ADR)

Design-beslutninger som påvirker ≥ 2 agenter eller services dokumenteres som ADR-er i `docs/adr/`. Når du tar en slik beslutning, **lag en ADR FØR du commiterer kode** — ellers glir "why"-konteksten bort med PM-handovers.

- Index: @docs/adr/README.md
- Template: @docs/adr/_template.md
- Selv-referansen (om ADR-prosessen): @docs/adr/0001-adr-format-og-prosess.md

ADR-er er **immutable etter merge**. Hvis du må snu, lag ny ADR som markerer den gamle `Superseded by ADR-MMMM`. Sentrale skills i `.claude/skills/` peker på relevante ADR-er i `Relaterte ADR-er`-seksjonen.

> **Migrering 2026-05-08:** ADR-er er flyttet fra `docs/decisions/` (3-siffer) til `docs/adr/` (4-siffer). Eldre referanser til `ADR-NNN` skal mappes til `NNNN` per katalog i `docs/decisions/README.md`.

### Git workflow (PM-centralized, adopted 2026-04-21)

- **Agents** commit + push feature-branches only.
- **PM** owns `gh pr create` + merge.
- Agents report deliverables as `"Agent N — [scope]:"` with branch, commits, test status.

This avoids accidental cross-agent merges and keeps merge order under one decision-maker.

### Done-policy (adopted 2026-04-17)

A Linear issue is closed only when:

1. Commit is **merged to `main`** (not just feature-branch)
2. `file:line` reference is provided as evidence
3. Test (or green-CI link) confirms behavior

Adopted after four false Done-findings.

### Pitfalls log + agent execution log (adopted 2026-05-10)

Tobias-direktiv 2026-05-10: dokumentasjon av fallgruver er kritisk for å unngå
gjenta gamle feil. To dokumenter eier dette ansvaret:

- **[`docs/engineering/PITFALLS_LOG.md`](docs/engineering/PITFALLS_LOG.md)** — sentral fallgruve-katalog (63+ entries i 11 kategorier: compliance, wallet, spill-arkitektur, live-rom, git/PR, test, frontend, doc-disiplin, env, routing, agent-orkestrering)
- **[`docs/engineering/AGENT_EXECUTION_LOG.md`](docs/engineering/AGENT_EXECUTION_LOG.md)** — kronologisk agent-arbeid med inputs/outputs/learnings per leveranse

**Når du skal kode på et tema:**
1. Skim PITFALLS_LOG-indeks
2. Les §-er for ditt scope (eks. §1 + §2 for wallet/compliance, §3 for spill-arkitektur)
3. Hvis du planlegger spawn av agent: inkluder relevante §-pekere i prompt

**Når du oppdager ny fallgruve:**
- Legg til entry i PITFALLS_LOG samme PR som fix
- Format dokumentert nederst i PITFALLS_LOG ("Hvordan legge til ny entry")

**Når du har levert agent-arbeid:**
- Append entry i AGENT_EXECUTION_LOG (PM eier dette)

### Spill 1 first (YAGNI)

Complete Spill 1 (`game1`) before generalizing toward Spill 2/3 abstractions.

### Browser debugging

Use `chrome-devtools-mcp` tools (console logs, screenshots, JS eval, network) — never `computer-use` for browser tasks.

### Unity-paritet rule

1:1 parity with the legacy Unity client applies to **functional logic only**. Visual polish is the web team's choice with documented deviation.

### Wireframe & legacy mapping

When scope crosses a legacy screen, reference these in agent prompts:

- @docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md — master 1:1 legacy mapping
- @docs/architecture/WIREFRAME_CATALOG.md — full content catalog (1760 lines, 65+ screens)
- @docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md — pilot critical path

### Agent onboarding

Hver agent-sesjon bør starte med:

```bash
./scripts/agent-onboarding.sh > /tmp/onboarding.md
```

Les `/tmp/onboarding.md` for current state (refaktor-bølger, sist merger,
åpne pilot-blokkere, aktive worktrees, tilgjengelige skills) før første
kode-endring. Se @docs/engineering/AGENT_ONBOARDING.md for detaljer.

### PM onboarding (NY PM)

**Hvis du tar over som PM**, følg den fulle onboarding-rutinen i
@docs/engineering/PM_ONBOARDING_PLAYBOOK.md (60-90 min). Generer live
current-state-rapport med:

```bash
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
```

For 1-side cheatsheet under sesjonen, se
@docs/engineering/PM_ONBOARDING_QUICKREF.md. For mal-prompts til
research-agenter ved første onboarding, se
@docs/engineering/PM_ONBOARDING_AGENT_PROMPTS.md.

Playbook dekker: Tobias' immutable direktiver, trinn-for-trinn rutine,
kommunikasjons-mønstre, compliance + regulatorisk, pilot-status R1-R12,
tekniske prosedyrer (PR/deploy/rollback), anti-mønstre, og
sjekkpunkter for fullført onboarding.

---

Generated for Claude Code automation. Last updated 2026-05-08.


## Skill Usage Guide

When working on tasks involving these technologies, invoke the corresponding skill:

| Skill | Invoke When |
|-------|-------------|
| redis | Provides Redis caching for room state, sessions, and rate limiting |
| node | Runs backend server with Node.js runtime and development environment |
| express | Manages Express HTTP server routing and middleware handling |
| socket.io | Handles Socket.IO real-time communication and multiplayer game updates |
| postgresql | Manages PostgreSQL database for users, wallets, and game state |
| typescript | Enforces TypeScript strict mode and type safety across all packages |
| vite | Configures Vite frontend bundler and development server |
| docker | Manages Docker containerization and local development infrastructure |
| zod | Validates application schemas and type definitions with Zod |
| pixi | Renders 2D game graphics with Pixi.js WebGL rendering engine |
| vitest | Runs unit tests with Vitest and compliance test framework |
| playwright | Executes Playwright visual regression tests for game rendering |
| bun | Provides Bun runtime as alternative JavaScript runtime |
