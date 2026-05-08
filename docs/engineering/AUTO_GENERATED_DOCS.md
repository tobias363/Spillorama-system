# Auto-genererte arkitektur-artefakter

**Status:** Operativ. Kjører på hver push til main (siden 2026-05-08).
**Kilde:** `scripts/generate-architecture-docs.sh` + `.github/workflows/auto-generate-docs.yml`.

## Bakgrunn

Tobias 2026-05-08: håndskrevne arkitektur-dokumenter blir stale. Agenter finner dem, leser dem, og handler på utdatert info — det førte gjentatte ganger til at PM-er måtte korrigere arbeid som var basert på feil "current state".

Løsning: auto-genererte artefakter committes til `docs/auto-generated/` på hver push til main. Innholdet leses fra **kildene** (openapi.yaml, migrations, package.json, SKILL.md, TS-imports), ikke fra håndskrevne markdown-filer. Da kan ikke filene drifte fra koden.

## Hva genereres

| Fil | Innhold | Kilde |
|---|---|---|
| `MODULE_DEPENDENCIES.md` | Apps + packages dep-graf (mermaid) + backend-domene-graf | `apps/*/package.json`, `packages/*/package.json`, TS-imports |
| `DB_SCHEMA_SNAPSHOT.md` | Tabeller + ALTER TABLE-statistikk + indekser | `apps/backend/migrations/*.sql` (parse-basert) |
| `API_ENDPOINTS.md` | Alle endpoints fra openapi.yaml, gruppert på tag | `apps/backend/openapi.yaml` |
| `MIGRATIONS_LOG.md` | Kronologisk liste over migrations | `apps/backend/migrations/*.sql` |
| `SKILLS_CATALOG.md` | Alle SKILL.md med navn + description | `.claude/skills/*/SKILL.md` |
| `SERVICES_OVERVIEW.md` | Apps/packages struktur, LOC, backend-domener | `apps/`, `packages/`, `apps/backend/src/` |
| `README.md` | Forklaring av mappen | (statisk) |

## Hvor lagres det

Alle filer skrives til `docs/auto-generated/`. Mappen har en marker-fil `.AUTO_GENERATED_DO_NOT_EDIT` som forklarer at innholdet ikke skal redigeres manuelt.

## Hvor ofte oppdateres

GitHub Action `.github/workflows/auto-generate-docs.yml` kjører:

1. Ved hver push til `main` som rører kildefiler (paths-filter på workflow):
   - `apps/backend/openapi.yaml`
   - `apps/backend/migrations/**`
   - `apps/backend/src/**`
   - `apps/admin-web/src/**`
   - `packages/**`
   - `apps/*/package.json`, `packages/*/package.json`
   - `.claude/skills/**`
   - `scripts/generate-architecture-docs.sh`
   - `.github/workflows/auto-generate-docs.yml`
2. Manuelt via "Run workflow" i GitHub Actions UI (`workflow_dispatch`).

Når det er endring i output, committes en commit med melding `chore(auto-doc): refresh architecture artefacts from main [skip ci]`. `[skip ci]`-suffix forhindrer at andre CI-jobber trigger på den syntetiske commiten.

## Hvordan kjøre lokalt

```bash
./scripts/generate-architecture-docs.sh
```

Output havner i `docs/auto-generated/`. Skriptet er idempotent — kjør så mange ganger du vil.

## Hvordan legge til en ny generator

1. Legg til en ny `generate_<x>` funksjon i `scripts/generate-architecture-docs.sh`.
2. Legg til kallet i `main`-seksjonen nederst i samme fil.
3. Oppdater listen over filer i `docs/auto-generated/README.md`.
4. Oppdater dette dokumentet med beskrivelse.
5. Hvis generatoren krever ny kilde-katalog som path-filter må kjenne til, oppdater `paths`-listen i `.github/workflows/auto-generate-docs.yml`.

## Begrensninger

- **DB-skjema er parse-basert**, ikke `pg_dump`. Vi kjører bevisst IKKE mot live-DB i CI. For 100% korrekt skjema, kjør `psql -d <prod> -c "\\d+"` direkte. Snapshot-en er tilstrekkelig for agent-onboarding men IKKE for compliance-bevis (Lotteritilsynet).
- **Module-graf er heuristisk** (regex-parse av imports, kap på 120 backend-domene-kanter). For full per-fil-graf, kjør `npx depcruise --output-type mermaid apps/backend/src` lokalt.
- **Filer cappes ved 5000 linjer** som sikkerhetsnett. Hvis en seksjon trunkeres, vurder å splitte i flere filer eller oppsummere.
- **Bash 3 kompatibel** (macOS default) — ingen `declare -A`, ingen `[[ -v ]]`.
- **Ingen secrets/PII** i output. Generatorene leser kun fra `.sql`/`.yaml`/`.md`/`package.json` — alle kilder uten secrets.

## Designprinsipper

1. **Idempotent** — kjør så ofte du vil, output endres bare når kilder endres.
2. **Pure shell + standard CLI** (awk/grep/sed) så scriptet kjører i CI uten dependencies.
3. **Fail-soft** — hvis én generator feiler, skal de andre fortsatt kjøre. (Vi har bevisst ikke `set -e` for å la grep med tomt resultat være ok.)
4. **Self-documenting** — alle filer har en autogenerert header med tidsstempel, commit-SHA og lenke til generatoren.

## Hvorfor ikke commit'e via PR?

Agenten committer direkte til `main` med `[skip ci]`. Vi gjør det fordi:

- Output er deterministisk avledet fra kilder — ingen review-verdi.
- PR-roundtrip ville bremse oppdateringer og kreve unødvendig admin-arbeid.
- `[skip ci]` forhindrer trigger-loops.

Hvis output noensinne avviker fra forventning, blir det åpenbart — neste utvikler eller agent som leser filen ser det.

## Referanser

- `scripts/generate-architecture-docs.sh` — generator-skript
- `.github/workflows/auto-generate-docs.yml` — CI-workflow
- `docs/auto-generated/` — output-mappen
- `docs/auto-generated/README.md` — bruker-dokumentasjon for konsumenter
- `CLAUDE.md` — peker agenter til auto-generated som "current state"-kilde
