# Services + tjeneste-grenser

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-08T18:25:44Z
> Commit: `70247c21` (branch: `feat/auto-generated-architecture-docs`)

Oversikt over alle apps og pakker i monorepoet. `apps/` = deploy-bare
enheter (egne package.json + build), `packages/` = delt kode importert
av apps via workspace-symlinks.

> **Kryss-import-regel:** Apps importerer ALDRI fra hverandre. All delt
> kode flyttes til `packages/`. Brudd på dette gir CI-feil.

## Apps

| App | Path | Har package.json | Har src/ | Linjer kode (.ts/.tsx) |
|---|---|:---:|:---:|---:|
| `admin-web` | `apps/admin-web` | ✓ | ✓ | 109733 |
| `android` | `apps/android` | – | – | 0 |
| `backend` | `apps/backend` | ✓ | ✓ | 454435 |
| `ios` | `apps/ios` | – | – | 0 |
| `windows` | `apps/windows` | – | – | 0 |

## Packages (delt kode)

| Pakke | Path | Har package.json | Linjer kode (.ts/.tsx) |
|---|---|:---:|---:|
| `game-client` | `packages/game-client` | ✓ | 50888 |
| `shared-types` | `packages/shared-types` | ✓ | 7124 |

## Backend-domene-kataloger (apps/backend/src/)

Hver mappe representerer en bounded context.

| Domene | Antall .ts-filer |
|---|---:|
| `adapters` | 44 |
| `admin` | 63 |
| `agent` | 50 |
| `auth` | 17 |
| `boot` | 1 |
| `compliance` | 46 |
| `draw-engine` | 10 |
| `errors` | 2 |
| `game` | 277 |
| `integration` | 28 |
| `jobs` | 29 |
| `media` | 2 |
| `middleware` | 11 |
| `notifications` | 4 |
| `observability` | 17 |
| `payments` | 10 |
| `platform` | 10 |
| `ports` | 12 |
| `routes` | 234 |
| `scripts` | 6 |
| `security` | 5 |
| `services` | 16 |
| `sockets` | 67 |
| `spillevett` | 11 |
| `store` | 6 |
| `util` | 51 |
| `wallet` | 13 |
