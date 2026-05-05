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

## Referanser

- `apps/backend/src/adapters/createWalletAdapter.ts`
- `apps/backend/src/adapters/createKycAdapter.ts`
- CLAUDE.md miljø-variabler
