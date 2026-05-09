# GitHub Copilot Instructions — Spillorama-System

These instructions configure GitHub Copilot for the Spillorama codebase. Copilot reads this file before suggesting code, so suggestions should respect the conventions, regulatory rules, and architectural boundaries documented below.

When in doubt about anything game-, payout-, or live-room-related, prefer pointing the developer at the authoritative docs over guessing — those docs are listed under "Authoritative references" near the bottom.

---

## Project at a glance

Spillorama is a live bingo platform for the Norwegian market, regulated under pengespillforskriften. It runs three live "hovedspill" (main games) and one databingo, with a wallet, KYC, responsible-gaming, hall operations, and an admin/agent console.

| Layer | Tech | Version | Purpose |
|---|---|---|---|
| Runtime | Node.js / Bun | 22.x | Backend |
| HTTP | Express | 4.21 | REST API |
| Real-time | Socket.IO | 4.8 | Game updates, multiplayer sync |
| DB | PostgreSQL | 16 | System of record |
| Cache | Redis | 7 | Room state, sessions, rate-limiting |
| Build | Vite | 6.3 | Admin web + game client |
| Game render | Pixi.js | 8.6 | WebGL 2D rendering |
| Language | TypeScript | 5.8–5.9 | `strict: true` everywhere |
| Tests | tsx --test / vitest | 4.19 / 3.1 | Unit, integration, compliance |
| Deploy | Docker + Render.com (Frankfurt) | — | Blue/green |

The repo is a monorepo: `apps/` (backend, admin-web), `packages/` (shared-types, game-client), `infra/`, `legacy/`, `docs/`.

---

## 🚨 Read-first blockers — never skip these for the relevant code areas

If a code change touches a live-game module, payout, or live-room behavior, the suggestion must respect the rules in the doc listed. Copilot should bias toward suggesting "see this doc first" comments rather than inventing rules.

### Spill 1, 2, 3 fundament (mandatory before live-game changes)

The three live games have fundamentally different architectures. Assumptions from one do not transfer to the others.

| Game | Slug | Authoritative doc |
|---|---|---|
| Spill 1 | `bingo` | `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 2 | `rocket` | `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 3 | `monsterbingo` | `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` |

Touching `GamePlanEngineBridge`, `Spill2GlobalRoomService`, `Game3PhaseStateMachine`, master actions, scheduled-game lifecycle, perpetual loops, draw-tick, ticket purchase, payout, lobby aggregator, or the room codes (`BINGO_<groupId>`, `ROCKET`, `MONSTERBINGO`) requires the corresponding doc.

If code disagrees with the doc, the doc wins and the code must be fixed.

### Live-room robustness (P0 mandate, non-negotiable)

`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — Evolution Gaming-grade target: 99.95 %+ uptime within opening hours. Anything that touches room architecture, socket events, draw-tick, ticket purchase, or wallet-touch from room events must respect R1–R12 in that mandate.

When suggesting room/socket/draw code, Copilot should default to:
- Idempotent socket handlers (`clientRequestId` deduped via `SocketIdempotencyStore`)
- State that survives a backend instance crash (Redis-backed; no in-memory-only state)
- Structured logging at every state transition (`room.opened`, `round.started`, `draw.next`, `claim.submitted`, `round.finished`)
- Outbox pattern for any wallet-touch triggered from a room event

### Game rules + payout (canonical)

`docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — bong prices, auto-multiplier, single-prize cap (databingo only), Trafikklys, Oddsen, multi-winner pot-splitting, and the engine-bridge ticket-config shape. Read before touching any payout path.

---

## Game catalog quick reference

This table prevents the most common confusions. The marketing names, code names, slugs, and regulatory categories are all distinct dimensions — check the table rather than guessing.

| Marketing | Code-name | Slug | Category | Org cut (§11) | Trekning |
|---|---|---|---|---|---|
| Spill 1 (Hovedspill 1) | `game1` | `bingo` | Hovedspill, 75-ball 5×5 with free center | 15 % | Live, master-driven |
| Spill 2 (Hovedspill 2) | `game2` | `rocket` | Hovedspill, 21-ball 3×3 (full plate), ONE global room | 15 % | Live, perpetual auto-tick |
| Spill 3 (Hovedspill 3) | `game3` | `monsterbingo` | Hovedspill, 75-ball 5×5 NO free center, ONE global room, phase-state-machine | 15 % | Live, perpetual auto-tick |
| SpinnGo (Spill 4) | `game5` | `spillorama` | **Databingo**, 60-ball 3×5 + roulette | 30 % | Player-startet, forhåndstrukket |
| Candy | — | `candy` | External iframe, third-party | n/a | Tredjeparts |

**`game4` / `themebingo` is deprecated (BIN-496).** Do not suggest it. Do not import from it. If you see it, flag it.

The fundamental architectural differences:

- **Spill 1** = per-hall lobby room (`spill1:lobby:{hallId}`) + GoH master room + plan-runtime + scheduled-games. Master starts/pauses deliberately. 13 catalog variants share this slug family.
- **Spill 2** = ONE global room (`ROCKET`) + perpetual loop + auto-tick. No master, no plan. Auto-starts on `Spill2Config.minTicketsToStart`. Jackpot mapping per draw-count, optional Lucky Number bonus.
- **Spill 3** = ONE global room (`MONSTERBINGO`) + perpetual loop + **sequential phase-state-machine** (Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus). Phase machine is unique to Spill 3.

Do not generalize an abstraction across Spill 1/2/3 unless explicitly asked.

---

## ID disambiguation (post-Bølge 1+2+3 refactor, 2026-05-08)

This is the source of many bugs. Get it right.

- `currentScheduledGameId` is the **only** id used for master write-actions (start / pause / resume / stop / advance / setJackpot).
- `planRunId` is internal to plan-runtime. **Never** use it directly for write actions from the UI.
- Master actions go through `POST /api/agent/game1/master/{action}` (the canonical `MasterActionService`). Do **not** suggest the older `/api/agent/game-plan/*` or `/api/admin/game1/games/:id/*` endpoints from the UI — they still exist for backend-internal callers but UI is locked to the new path.
- The lobby aggregator (`GameLobbyAggregator`, `GET /api/agent/game1/lobby?hallId=X`) is the single source of truth for what the master/agent UI shows. Don't reintroduce dual-fetch.

### Deprecated patterns — do not suggest

```ts
// ❌ Deleted in Bølge 3 — these files no longer exist
import { … } from "@/api/agent-game-plan-adapter";
import { … } from "@/api/agent-master-actions";

// ❌ Wrong id for master write-actions
pauseGame1(planRunId, reason);

// ❌ Deprecated game-name
import "@/games/game4";
import "@/games/themebingo";

// ❌ Use structured logger in apps/backend/src/util/logger.ts
console.log("draw event", { ... });

// ❌ Direct SQL against wallet tables
await pgPool.query("UPDATE app_wallet_accounts SET balance = ...");
```

```ts
// ✅ Correct
import { fetchLobbyState, pauseMaster, resumeMaster } from "@/api/agent-game1";

await pauseMaster(currentScheduledGameId, { hallId });

import { logger } from "../util/logger.js";
logger.info({ event: "draw.next", roomCode, ball }, "draw advanced");

// Wallet mutations only via the adapter port (outbox + REPEATABLE READ)
await walletAdapter.debit({ walletId, amountCents, reason, idempotencyKey });
```

---

## Architectural conventions Copilot must respect

### Module boundaries

- `apps/backend` and `apps/admin-web` do **not** cross-import. Anything shared lives in `packages/shared-types` (Zod-validated wire formats) or `packages/game-client`.
- `apps/admin-web` does not import from `apps/backend/src/...`. If a type is needed on both sides, move it into `packages/shared-types`.
- `legacy/` is read-only reference code; do not import from it into `apps/` or `packages/`.

### Wallet, compliance, and audit

- **Wallet mutations** must go through the `WalletAdapter` port (`apps/backend/src/adapters/`). Direct SQL against `app_wallet_accounts`, `app_wallet_transactions`, etc. is forbidden — the adapter wraps the outbox + REPEATABLE READ requirement from BIN-761→764.
- **Compliance events** (stake, prize, refund, extra-prize, correction) go through `ComplianceLedgerService` / `AuditLogService`. Never write to `app_rg_compliance_ledger` or `app_audit_log` directly from a route handler.
- **`gameType` mapping** is centralized in `apps/backend/src/game/ledgerGameTypeForSlug.ts`. `bingo`/`rocket`/`monsterbingo` → `MAIN_GAME`; `spillorama` → `DATABINGO`. Never hard-code `"DATABINGO"` for Spill 1–3.
- **Hall binding** for ticket purchases goes against the **purchasing hall** (`actor_hall_id`), not the master hall. Compliance §71 reports break otherwise.

### Plan-runtime vs scheduled-game

These are two different state machines. Keep the boundary clean:
- `app_game_plan` / `app_game_plan_run` / `GamePlanRunService` = plan-runtime (which game in the sequence is active for the day).
- `app_game1_scheduled_games` / `Game1MasterControlService` / `BingoEngine` = engine instance for one round.
- `GamePlanEngineBridge` is the **only** place that crosses between the two. Don't add new crossings.

### Logging

Use the structured logger:

```ts
import { logger } from "../util/logger.js";
logger.warn({ module: "Spill2Engine", roomCode, drawCount }, "auto-spawn skipped — outside opening hours");
```

`console.log` / `console.error` is reserved for migration scripts and CLI tools. In `apps/backend/src/`, prefer `logger.info|warn|error|debug`.

### Idempotency

- Socket events that mutate state (`ticket:mark`, `claim:submit`, `ticket:buy`, master actions) require a `clientRequestId` (UUID v4). Server dedups via `SocketIdempotencyStore` (Redis, 5-min TTL).
- HTTP endpoints that mutate wallets / settle agents accept an `Idempotency-Key` header and dedup via `app_idempotency_keys` (90-day TTL).

### Strict TypeScript

- All packages compile with `strict: true`. Don't add `// @ts-ignore` or `any` casts unless there's a justified comment.
- Zod schemas in `packages/shared-types/` are the wire-format source of truth. Backend and admin-web both import from there.

---

## Pengespillforskriften — regulatory rules baked into code

These are not nice-to-haves. The system must enforce them.

- **§11 distribution to organizations:** 15 % for hovedspill (Spill 1–3), 30 % for databingo (SpinnGo). Wired through `ComplianceLedgerOverskudd`.
- **§66 mandatory pause:** Player session > 60 min → 5-min mandatory pause. Configured via `BINGO_PLAY_SESSION_LIMIT_MS` and `BINGO_PAUSE_DURATION_MS`. Enforced fail-closed.
- **§71 daily reporting:** Every (hall, date) needs a generated report. `apps/backend/src/jobs/dailyReports*.ts`.
- **Single-prize cap:** **Only databingo (`spillorama`) has a 2 500 kr cap.** Hovedspill (Spill 1–3) have **no cap** — a Lilla bong can win 3 000 kr on Innsatsen Fullt Hus or 4 500 kr on Oddsen-HIGH; that's intentional and regulatory-fine.
- **No external RNG:** In-house `DrawScheduler` is the source of randomness. No third-party RNG cert is required, but the in-house engine is auditable (event-log replay supported).
- **Self-exclusion:** 1-year duration, fail-closed. Voluntary pauses configurable.
- **Hall-based responsible gaming:** Loss limits are per (player, hall, period). Default 900 kr/day, 4 400 kr/month per hall.

When a feature touches any of these, suggest reading `docs/compliance/` first.

---

## Bong prices and payout mechanics (one-page summary)

Full spec: `docs/architecture/SPILL_REGLER_OG_PAYOUT.md`. Quick reference for Copilot:

```
Bong prices (all hovedspill except Trafikklys):
  Hvit  =  5 kr (500 øre) → multiplier × 1
  Gul   = 10 kr (1000 øre) → multiplier × 2
  Lilla = 15 kr (1500 øre) → multiplier × 3

Trafikklys: flat 15 kr (all bongs); prizes vary by drawn ROW COLOR, not bong color.

Auto-multiplier formula:
  actualPrize = base × (ticketPriceCents / 500)

Applies to Rad 1, Rad 2, Rad 3, Rad 4, AND Fullt Hus (bingo).

Multi-winner pot split (BIN-997):
  pot[size] = base × bongMultiplier
  share = pot[size] / count_of_winning_tickets_at_that_size
  floor-rounding remainder → HOUSE_RETAINED ledger event

Cap rule:
  MAIN_GAME (bingo, rocket, monsterbingo) → NO cap
  DATABINGO (spillorama)                  → 2500 kr cap per single prize
```

Special variants:

- **Trafikklys** (`prize_multiplier_mode = "explicit_per_color"`): row-color drawn at start, prizes from `prizesPerRowColor` / `bingoPerRowColor`.
- **Oddsen** (`gameVariant = "oddsen"`, slugs `oddsen-55`/`56`/`57`): Fullt Hus on draw ≤ `targetDraw` → HIGH bucket (`bingoBaseHigh`); after → LOW (`bingoBaseLow`). Rows 1–4 follow standard auto-multiplier.

---

## File and code naming

| Kind | Convention | Example |
|---|---|---|
| Class / adapter file | PascalCase | `BingoEngine.ts`, `PostgresWalletAdapter.ts` |
| Utility / service file | camelCase | `apiHelpers.ts`, `roomState.ts` |
| Test file | co-located `*.test.ts` / `*.spec.ts` | `BingoEngine.test.ts` |
| Config file | lowercase with hyphens | `vite.config.ts` |
| Class / type / interface | PascalCase | `class BingoEngine`, `type GameSnapshot` |
| Function / const | camelCase | `function fetchPlayer()`, `const createAdapter = () => {}` |
| Variable | camelCase | `const userData`, `let isLoading` |
| Boolean | `is` / `has` / `should` prefix | `isLocked`, `hasPermission`, `shouldRetry` |
| Constant | SCREAMING_SNAKE_CASE | `const MAX_BET_AMOUNT = 5000` |
| Private field | `_underscore` prefix | `private _cache: Map<...>` |

### Import order

Always group, blank line between groups, type-only imports last:

```ts
// 1. External packages
import express from "express";
import { Server } from "socket.io";

// 2. Node internals
import { randomUUID } from "node:crypto";
import path from "node:path";

// 3. Workspace (absolute) imports
import type { GameSnapshot } from "@spillorama/shared-types";

// 4. Relative imports
import { BingoEngine } from "./game/BingoEngine.js";
import { createAdapter } from "./util/adapterFactory.js";

// 5. Type-only imports last (or co-located with their group using `type`)
import type { Player } from "./types.js";
```

Use `.js` suffix on relative imports (NodeNext module resolution).

---

## Testing

- Unit tests run via `tsx --test` for backend (Node's built-in runner) and `vitest` for `packages/game-client`. Co-locate tests with source.
- Integration tests that need Postgres or Redis must skip-graceful when the dependency is unavailable. Pattern:
  ```ts
  const dbAvailable = await isPostgresAvailable();
  test("hits real DB", { skip: !dbAvailable }, async () => { ... });
  ```
- `npm run test:compliance` runs the pengespillforskriften test suite. It is mandatory before merge.
- Visual regression via Playwright: `npm run test:visual` (and `:update` to refresh snapshots).
- Chaos / load tests live in `infra/chaos-tests/` and `infra/loadtest/`. Don't suggest those for routine PRs — they are pilot-gating for R2/R3/R4.
- Snapshot-style tests for state aggregators (e.g. `GameLobbyAggregator.test.ts`) cover all canonical states. When adding a state, add a snapshot.

Use fixtures from `apps/backend/src/__fixtures__/` rather than constructing test data inline. **Never** point tests at a production DB.

---

## Commit conventions (Conventional Commits)

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

| Field | Allowed values |
|---|---|
| Type | `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf` |
| Scope | `backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance` |

Examples:

```
feat(backend): add hall-level betting limits
fix(game-client): correct spill1 ball animation timing
test(backend): add tests for ResponsibleGamingStore
docs(compliance): update pengespillforskriften audit trail spec
```

PRs target `main` from feature branches (`codex/*`, `chore/*`, `feat/*`, `fix/*`, etc.). Squash-merge is the default. CI must pass `backend`, `compliance`, `architecture-lint`, and the matrix-check.

---

## Local development

| Command | What it does |
|---|---|
| `docker-compose up -d` | Start Postgres 16 + Redis 7 + backend |
| `npm run dev` | Backend dev server (port 4000, hot reload via tsx) |
| `npm run dev:admin` | Admin-web Vite dev server (port 5174 in current setup) |
| `npm run dev:games` | Game-client Vite dev server |
| `npm run check` | Type-check backend |
| `npm run build` | Full build: shared-types → game-client → admin-web → backend |
| `npm test` | Run all unit tests |
| `npm run test:compliance` | Run pengespillforskriften suite |
| `npm run spec:lint` | Lint OpenAPI spec via redocly |

Required env vars (see `apps/backend/.env.example` for the full list): `NODE_ENV`, `PORT`, `APP_PG_CONNECTION_STRING`, `APP_PG_SCHEMA`, `REDIS_URL`, `SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WALLET_PROVIDER`, `KYC_PROVIDER`, `ROOM_STATE_PROVIDER`, `SCHEDULER_LOCK_PROVIDER`. **Do not embed secrets in suggestions.**

---

## When suggesting code, prefer…

- Reading the relevant fundament doc when touching live-game code, instead of inferring rules from neighboring files.
- The structured `logger` over `console.*`.
- The `WalletAdapter` / `ComplianceLedger` / `AuditLogService` ports over direct DB access.
- Zod-validated types from `@spillorama/shared-types` for any wire format.
- Idempotency keys (`clientRequestId`, `Idempotency-Key`) on all mutating endpoints.
- Returning structured error codes (e.g. `LOBBY_INCONSISTENT`, `JACKPOT_SETUP_REQUIRED`, `BRIDGE_FAILED`, `HALL_NOT_IN_GROUP`) over generic strings — see ADR-0006.
- `currentScheduledGameId` for master write-actions, never `planRunId`.
- Slug-form keys (`small_yellow`, `large_purple`) in engine ticket configs (`spill1.ticketColors[]`), not family-form (`yellow`, `white`).
- Tests that skip-graceful without infra rather than tests that hard-fail in CI environments without Postgres/Redis.

## Avoid suggesting…

- Anything from `legacy/` as a pattern to follow — it's reference only.
- Cross-app imports (`apps/admin-web` → `apps/backend/src/...`).
- `console.log` in `apps/backend/src/` (use the structured logger).
- Direct SQL against wallet, ledger, or audit tables.
- Hard-coding `"DATABINGO"` or `"MAIN_GAME"` outside `ledgerGameTypeForSlug.ts`.
- `pauseGame1(planRunId, ...)` or any master action keyed by `planRunId`.
- Files or imports referencing `game4` / `themebingo`.
- Re-introducing the deleted `agent-game-plan-adapter.ts` / `agent-master-actions.ts` patterns (Bølge 3 collapsed them into `agent-game1.ts`).
- A 2 500 kr cap on Spill 1–3 payouts (it's databingo-only).
- Single-room generalizations across Spill 1 / 2 / 3 — their architectures are intentionally distinct.
- Emojis in files, unless explicitly asked.

---

## When in doubt — point to authoritative docs

| Domain | Doc |
|---|---|
| Spill 1 (`bingo`) | `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 2 (`rocket`) | `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Spill 3 (`monsterbingo`) | `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md` |
| Live-room robustness mandate | `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` |
| Game rules + payout (canonical) | `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` |
| Per-game details (13 catalog variants + bonus) | `docs/architecture/SPILL_DETALJER_PER_SPILL.md` |
| Game catalog (marketing → slug) | `docs/architecture/SPILLKATALOG.md` |
| System architecture overview | `docs/architecture/ARKITEKTUR.md` |
| Engineering workflow + PR rules | `docs/engineering/ENGINEERING_WORKFLOW.md` |
| OpenAPI spec | `apps/backend/openapi.yaml` (also at `/api/docs`) |
| Compliance details | `docs/compliance/` |
| Operations + runbooks | `docs/operations/` |
| ADR index | `docs/adr/README.md` |
| Auto-generated current state | `docs/auto-generated/` (API endpoints, DB schema, module graph — never edit by hand) |

For "current state" questions, `docs/auto-generated/` is freshest because it is regenerated from `main` on every push. Hand-written docs may be stale; the auto-generated set never is.

---

## Final guardrails

- Live-bingo is regulated. A wrong payout, a missed §66 pause, or a multi-hall compliance bug is a Lotteritilsynet-level incident. When in doubt, suggest a more conservative implementation and a TODO that points to the relevant doc.
- "Doc-en vinner" — when code and the authoritative docs disagree, the docs are correct and the code is the bug. Don't normalize the code's behavior into a suggestion.
- The fundament-docs above are not aspirational — they describe what is shipped on `main`. Trust them.
