# docs/auto-generated/

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Innholdet i denne mappen
> overskrives av `.github/workflows/auto-generate-docs.yml` på hver
> push til main.

## Hvorfor?

Tobias 2026-05-08: håndskrevne arkitektur-dokumenter blir stale. Agenter
finner dem, leser dem, og handler på utdatert info. Løsningen er å
auto-generere "current state"-artefakter fra **kildene**:

- `apps/backend/openapi.yaml` → API-endpoints-katalog
- `apps/backend/migrations/*.sql` → DB-skjema-snapshot + migration-log
- `apps/` + `packages/` (TypeScript imports) → module dependency-graph
- `.claude/skills/*/SKILL.md` → skills-katalog
- `apps/backend/src/<domene>/` → backend-domene-grenser

## Filer

| Fil | Innhold |
|---|---|
| `MODULE_DEPENDENCIES.md` | Apps + packages dep-graf (mermaid) + backend-domene-graf |
| `DB_SCHEMA_SNAPSHOT.md` | Tabeller + ALTER TABLE-statistikk parset fra migrations |
| `API_ENDPOINTS.md` | Alle endepunkter fra openapi.yaml, gruppert på tag |
| `MIGRATIONS_LOG.md` | Kronologisk liste over migrations |
| `SKILLS_CATALOG.md` | Alle SKILL.md med navn + description |
| `SERVICES_OVERVIEW.md` | Apps/packages struktur, LOC, backend-domener |

## Når brukes dette?

- **Ved start av agent-sesjon:** hvis du leter etter "current state",
  les disse FØRST før du graver i kode.
- **Ved arkitektur-spørsmål:** "Hvilke endpoints finnes for hall-X?"
  → `API_ENDPOINTS.md`. "Hvor lever wallet-koden?" → `SERVICES_OVERVIEW.md`.
- **Ved skill-discovery:** "Finnes det en skill for X?" → `SKILLS_CATALOG.md`.

## Hvordan oppdatere?

Du gjør det ikke manuelt. CI-jobben kjører på hver push til main.
Lokalt:

```bash
./scripts/generate-architecture-docs.sh
```

## Hvordan legge til en ny generator?

1. Legg til en ny `generate_<x>` funksjon i
   `scripts/generate-architecture-docs.sh`.
2. Legg til kallet i `main`-seksjonen nederst.
3. Oppdater `docs/engineering/AUTO_GENERATED_DOCS.md` med beskrivelse.

## Begrensninger

- DB-skjema er **parse-basert**, ikke pg_dump. Ikke autoritativt for
  compliance-bevis — bruk `psql -c "\\d+"` mot prod-DB for det.
- Module-graf er heuristisk (regex-parse av imports). For 100% korrekt
  graf, kjør `npx depcruise` lokalt.
- Filer cappes ved 5000 linjer; lange seksjoner trunkateres.
