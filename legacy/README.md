# Legacy — arkivert kode

Denne mappen inneholder alt som **fases ut** og ikke er en del av den aktive stacken.

## Innhold

| Mappe | Opprinnelig navn | Beskrivelse |
|-------|------------------|-------------|
| `unity-backend/` | `unity-bingo-backend/` | Legacy Node.js Express MVC-backend (fases ut til fordel for `apps/backend/`). |
| `unity-client/` | `Spillorama/` | Legacy Unity-klient (erstattes av web-shell + PixiJS game-client i `packages/game-client/`). |
| `scripts/` | `scripts/unity-*.sh` | Unity vendor-SDK-tooling og test-smoke-scripts. |
| `docs/` | (ulike `docs/*-unity-*.md`) | Utdatert Unity-dokumentasjon. |

## Status

- **Ikke aktiv utvikling.** Disse systemene kjøres fortsatt i produksjon parallelt mens ny stack rulles ut hall for hall, men nye features legges KUN i den nye stacken.
- **Planlagt ekstraksjon:** hele `legacy/`-mappen flyttes ut av dette repoet til et eget `spillorama-legacy`-repo når faseutkoblingen er fullført. Se Linear-prosjekt «Legacy-avkobling: Game 1–5 + backend-paritet».
- **Ikke modifiser** med mindre det er kritisk sikkerhetsfix eller hall-spesifikk bug som ikke kan vente på ny stack.

## Referanser

- Linear-prosjekt: [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)
- Ny arkitektur: se `/docs/architecture/` og rot-`README.md`

---

## Ekstraksjon til eget repo — prosedyre

Når faseutkoblingen er fullført og Unity-stacken tas ut av produksjon, trekkes `legacy/` ut i et nytt repo `tobias363/spillorama-legacy` med bevart git-historikk.

### Forberedelse

1. Bekreft at ingen halls kjører på Unity-stacken lenger (sjekk `apps/backend` deploy-logger og hall-konfig).
2. Lag siste snapshot av `legacy/` i hovedrepoet som tag: `git tag legacy-final-snapshot`.
3. Arkiver tag-en på Linear-prosjektet «Legacy-avkobling».

### Uttrekking med git-filter-repo (bevart historikk)

```bash
# På en arbeidskopi — ikke hovedrepoet
git clone --no-local /path/to/Spillorama-system /tmp/spillorama-legacy-extract
cd /tmp/spillorama-legacy-extract

# Behold kun legacy/ sin historikk
git filter-repo --path legacy/ --path-rename legacy/:

# Resultat: alle commits som har rørt legacy/ filer blir bevart,
# med legacy/-prefikset fjernet slik at strukturen blir rot-relativ.

# Push til nytt repo
gh repo create tobias363/spillorama-legacy --private --source=. --push
```

### Post-merge i hovedrepoet

Etter at uttrekking er bekreftet fullført:

```bash
# I hovedrepoet — fjern legacy/ helt
git rm -r legacy/
git commit -m "chore(repo): remove legacy/ — extracted to tobias363/spillorama-legacy"

# Rydd opp referanser i root README og .gitignore
# (fjern alt under "Legacy Unity-tooling"-seksjonen og legacy-ignorer).
```

### Avhengigheter som må håndteres

- **`scripts/release-all.sh`** kaller `legacy/scripts/unity-webgl-build.sh` når `RUN_UNITY_BUILD=true`. Dette deaktiveres naturlig ved at Unity-bygg ikke lenger kjøres. Fjerner `RUN_UNITY_BUILD`-blokken i samme commit som sletter `legacy/`.
- **`docs/architecture/ARKITEKTUR.md`**, **`SPILLORAMA_SYSTEM_SCOPE_...md`** refererer til `legacy/unity-client/` som "under utfasing" — skriv om disse til rent historisk språk etter uttrekking.
- **Linear-prosjektet «Legacy-avkobling»** markeres som `Done` med referanse til det nye repoet og commit-SHA-en som sletter `legacy/`.

### Rollback

Hvis en kritisk feil oppdages etter uttrekking, gjenopprett:

```bash
git revert <slett-commit-sha>
```

Dette bringer tilbake hele `legacy/`-treet på committed historikk, slik at hovedrepoet kan fortsette å levere Unity-bygg midlertidig.
