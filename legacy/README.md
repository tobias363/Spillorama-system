# Legacy — arkivert kode

Denne mappen inneholder alt som **fases ut** og ikke er en del av den aktive stacken.

## Innhold

| Mappe | Opprinnelig navn | Beskrivelse |
|-------|------------------|-------------|
| `unity-backend/` | `unity-bingo-backend/` | Legacy Node.js Express MVC-backend (fases ut til fordel for `apps/backend/`). |
| `unity-client/` | `Spillorama/` | Legacy Unity-klient (erstattes av web-shell + PixiJS game-client i `packages/game-client/`). |

## Status

- **Ikke aktiv utvikling.** Disse systemene kjøres fortsatt i produksjon parallelt mens ny stack rulles ut hall for hall, men nye features legges KUN i den nye stacken.
- **Planlagt ekstraksjon:** hele `legacy/`-mappen flyttes ut av dette repoet til et eget `spillorama-legacy`-repo når faseutkoblingen er fullført. Se Linear-prosjekt «Legacy-avkobling: Game 1–5 + backend-paritet».
- **Ikke modifiser** med mindre det er kritisk sikkerhetsfix eller hall-spesifikk bug som ikke kan vente på ny stack.

## Referanser

- Linear-prosjekt: [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)
- Ny arkitektur: se `/docs/architecture/` og rot-`README.md`
