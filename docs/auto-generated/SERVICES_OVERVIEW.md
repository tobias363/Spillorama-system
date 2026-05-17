# Services + tjeneste-grenser

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-17T17:48:12Z
> Commit: `a40d4d2e` (branch: `main`)

Oversikt over alle apps og pakker i monorepoet. `apps/` = deploy-bare
enheter (egne package.json + build), `packages/` = delt kode importert
av apps via workspace-symlinks.

> **Kryss-import-regel:** Apps importerer ALDRI fra hverandre. All delt
> kode flyttes til `packages/`. Brudd på dette gir CI-feil.

## Apps

| App | Path | Har package.json | Har src/ | Linjer kode (.ts/.tsx) |
|---|---|:---:|:---:|---:|
| `admin-web` | `apps/admin-web` | ✓ | ✓ | 113500 |
| `android` | `apps/android` | – | – | 0 |
| `backend` | `apps/backend` | ✓ | ✓ | 10779 |
| `ios` | `apps/ios` | – | – | 0 |
| `windows` | `apps/windows` | – | – | 0 |

## Packages (delt kode)

| Pakke | Path | Har package.json | Linjer kode (.ts/.tsx) |
|---|---|:---:|---:|
| `game-client` | `packages/game-client` | ✓ | 76017 |
| `shared-types` | `packages/shared-types` | ✓ | 7606 |

## Backend-domene-kataloger (apps/backend/src/)

Hver mappe representerer en bounded context.

| Domene | Antall .ts-filer |
|---|---:|
| `adapters` | 46 |
| `admin` | 63 |
| `agent` | 50 |
| `auth` | 17 |
| `boot` | 1 |
| `compliance` | 53 |
| `draw-engine` | 10 |
| `errors` | 2 |
| `game` | 319 |
| `integration` | 28 |
| `jobs` | 33 |
| `media` | 2 |
| `middleware` | 11 |
| `notifications` | 4 |
| `observability` | 43 |
| `payments` | 10 |
| `platform` | 12 |
| `ports` | 12 |
| `routes` | 252 |
| `scripts` | 6 |
| `security` | 5 |
| `services` | 16 |
| `sockets` | 75 |
| `spillevett` | 11 |
| `store` | 7 |
| `util` | 62 |
| `wallet` | 14 |
