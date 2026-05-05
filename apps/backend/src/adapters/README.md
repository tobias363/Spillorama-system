# Module: `apps/backend/src/adapters`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~10 647

## Ansvar

Eksterne integrasjoner og pluggable backends:
- Postgres adapter (kjerne-database-tilgang)
- Redis adapter (rom-state, sessions)
- KYC adapter (BankID + local fallback)
- Wallet provider adapter (postgres + external wallet)
- RNG adapter (in-house crypto-secure)

## Hvorfor adapter-pattern?

Spillorama bruker adapter-pattern for å kunne svitsjes mellom implementasjoner:
- Test-miljø: `InMemoryWalletAdapter`, `LocalKycAdapter`
- Prod: `PostgresWalletAdapter`, `BankIdAdapter`
- Future: `ExternalWalletAdapter` (hvis vi noensinne flytter wallet eksternt)

Konfigurasjon via env vars:
- `WALLET_PROVIDER=postgres|external`
- `KYC_PROVIDER=bankid|local`
- `ROOM_STATE_PROVIDER=memory|redis`

## Public API

| Adapter | Funksjon |
|---|---|
| `PostgresWalletAdapter` | Postgres-basert wallet (default prod) |
| `BankIdAdapter` | BankID KYC-handshake |
| `LocalKycAdapter` | Mock KYC for dev |
| `RedisRoomStateAdapter` | Distribuert rom-state |
| `MemoryRoomStateAdapter` | In-memory rom-state (dev) |

## Invariants

1. **Adapter-interface = sannhets-kilde:** alle implementasjoner må følge samme kontrakt
2. **Configurable via env, ikke kode:** ingen `if (NODE_ENV === ...)` i forretnings-kode

## Postgres pool-config

Pool-tuning leses fra env-vars via `apps/backend/src/util/pgPool.ts`:

| Env-var | Default | Notat |
|---|---|---|
| `PG_POOL_MAX` | `20` | Max-størrelse per pool. Render `basic_256mb`-plan caper på ~30 connections totalt — to pools (shared platform + wallet) kan ikke gå mye over 15 hver i prod uten å overstige cap. Test-miljø kan bumpes høyere. |
| `PG_POOL_IDLE_TIMEOUT_MS` | `30_000` | Hvor lenge idle-client kan ligge i pool før den lukkes. |
| `PG_POOL_CONNECTION_TIMEOUT_MS` | `3_000` | Hvor lenge en query venter på en pool-client. **Wave 3b (2026-05-06):** redusert fra 5s → 3s for fail-fast på pool-exhaustion. Ses som `pgPoolWaiting`-metric-spike → on-call alert. |
| `PG_STATEMENT_TIMEOUT_MS` | `30_000` | `statement_timeout` settes på hver ny client. Caper runaway-queries. |

To pools eksisterer i prod:
- **shared** (`apps/backend/src/util/sharedPool.ts`) — platform + audit + auth + admin
- **wallet** (`apps/backend/src/adapters/PostgresWalletAdapter.ts`) — wallet-only

Pool-utilization er observerbar via:
- `GET /api/admin/observability/db-pool` (live snapshot, RBAC: ADMIN_PANEL_ACCESS)
- Prometheus-gauges `spillorama_pg_pool_*` (sample hvert 5s, label `pool` skiller "shared" / "wallet")

Se ADR-010 og audit §6.4 for kontekst.

## Referanser

- `apps/backend/src/adapters/createWalletAdapter.ts`
- `apps/backend/src/adapters/createKycAdapter.ts`
- ADR-010 (casino-grade observability)
- `docs/architecture/SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md` §6.4
- CLAUDE.md miljø-variabler
