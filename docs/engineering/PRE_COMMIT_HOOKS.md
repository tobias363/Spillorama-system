# Pre-commit hooks

## TL;DR

Repoet kjører [husky](https://typicode.github.io/husky/) +
[lint-staged](https://github.com/lint-staged/lint-staged) som pre-commit
hook. Når du `git commit`, sjekker hookene endrede filer mot et sett
regler **før** committen lander. Tidligere måtte vi vente 5-10 min på CI
for å oppdage de samme feilene.

- **Konfig:** `.lintstagedrc.json` (rotnivå)
- **Hook-script:** `.husky/pre-commit`
- **Validatorer:** `scripts/hooks/*.mjs`
- **Mer kontekst:** [CSS_LINTING.md](./CSS_LINTING.md) (CSS-spesifikke regler)

## Hva hooken sjekker

| Filtype | Regel | Skript / kommando |
|---|---|---|
| `**/*.css` | stylelint-regler (no-backdrop-filter m.fl.) | `stylelint --fix --allow-empty-input` |
| `**/*.{ts,tsx,mts,cts}` | no-backdrop-js, no-unsafe-html | `npm run lint:no-backdrop-js`, `npm run lint:no-unsafe-html` |
| `apps/backend/src/**/*.ts` | TypeScript strict (errors only) | `npm --prefix apps/backend run check` |
| `.claude/skills/*/SKILL.md` | YAML-frontmatter (`name`, `description`, `metadata.version`) | `scripts/hooks/validate-skill-frontmatter.mjs` |
| `docs/**/*.md` | Relative `[label](path)` og `@docs/...` peker på fil som finnes | `scripts/hooks/check-markdown-links.mjs` |
| `apps/backend/migrations/*.sql` | `YYYYMMDDhhmmss_snake_case.sql` + chronological-ordering | `scripts/hooks/validate-migration-name.mjs` |
| `**/*.{png,jpg,jpeg,gif,webp,mp3,mp4,zip,gz,tgz,tar,pdf,exe,dmg,iso}` | ≤ 1 MB per fil (overstyres av `.lfs-allowed-paths`) | `scripts/hooks/check-large-binaries.mjs` |

Alle reglene er **strict** (commit blokkeres) bortsett fra:

- **SKILL.md kort beskrivelse:** advarsel hvis `description` er < 100 tegn,
  men commit går igjennom. Pushy beskrivelser trigger skill-loaderen
  bedre, derav anbefalingen.

## Forventet kjøretid

På en typisk Spill 1-PR (5-10 endrede filer):

- Bare CSS/TS-lint: ~1-2 sek
- Backend-tsc-check med backend-fil: 7-10 sek
- Skill/doc/migration-validatorer: < 100 ms hver

Hele hooken ferdig på under 10-15 sek selv ved tunge backend-endringer.
Vesentlig raskere enn 5-10 min CI-feedback.

## Hvordan kjøre lint-staged manuelt

```bash
# Test endringer du har staget, uten å committe:
npx lint-staged --no-stash

# Lint alle filer i et område (matchende mønster i .lintstagedrc.json):
git diff --name-only main HEAD | xargs -I {} bash -c \
  'echo {} | grep -qE "\.(ts|tsx|mts|cts)$" && node scripts/hooks/...'
```

## Hvordan unndra hooken (nødstilfeller)

```bash
git commit --no-verify -m "..."
```

`--no-verify` skipper alle pre-commit hooks. **Bruk sparsomt**:

- ✅ OK: emergency hot-fix på prod der CI er nede og du vet endringen
  er trygg.
- ✅ OK: WIP-commit på en feature-branch som ingen andre jobber på, der
  du planlegger å fikse opp før merge.
- ❌ Ikke OK: regelmessig sløyfe for å unngå å fikse en regel — fiks
  regelen eller ta den ut.

CI kjører fortsatt samme regler på PR-en, så `--no-verify` skjuler ikke
problemet, det utsetter det bare.

## Hvordan legge til en ny hook

1. **Skriv validator-skript** i `scripts/hooks/<navn>.mjs`. Det skal:
   - Ta filstier som argv (lint-staged forwarder).
   - Skrive feilmeldinger til `stderr`.
   - Exit 0 ved success, exit ≥ 1 ved minst én feil.
   - Være rask (< 1 sek for 10 filer).
2. **Legg til pattern + kommando** i `.lintstagedrc.json`:
   ```json
   "min/glob/**/*.ext": ["node scripts/hooks/<navn>.mjs"]
   ```
3. **Test lokalt** med `npx lint-staged --no-stash` etter å ha staget
   en fil som matcher.
4. **Dokumenter regelen** i tabellen øverst i denne fila.

For komplekse hooks som krever runtime-flagg eller sequencing, bruk
`bash -c '...'` istedenfor å kalle skriptet direkte.

## Hvordan diagnostisere en feilende hook

```bash
# Se hva som er staget:
git diff --cached --name-only

# Kjør lint-staged i debug-modus:
npx lint-staged --no-stash --debug

# Kjør en validator direkte mot en fil:
node scripts/hooks/check-markdown-links.mjs docs/some/file.md
```

## Vanlige feil + fix

| Feil | Årsak | Fix |
|---|---|---|
| `migration-name: timestamp not greater than newest existing` | Du har back-datert en ny migrasjon, eller en eldre migrasjon er staged sammen med en nyere | Gi den nye migrasjonen et timestamp større enn den nyeste eksisterende. node-pg-migrate kjører i lex-rekkefølge, så lavere timestamps shuffler apply-rekkefølgen ved frisk DB. |
| `broken link 'X' -> path not found` | Refaktor flyttet en fil men referanser i docs ble ikke oppdatert | Fiks lenken til den nye plasseringen, eller fjern lenken hvis filen er slettet. |
| `description is short` (advarsel, ikke blokkering) | SKILL.md description har < 100 tegn | Skill-loaderens triggering blir bedre med rikere beskrivelse — utvid med eksempler på når skillen skal aktiveres. |
| `exceeds 1.00 MB binary-size limit` | Du committer en stor binærfil til repoet | Bruk Git LFS eller en CDN. Hvis intentionalt, legg path-globben inn i `.lfs-allowed-paths`. |
| `cannot parse '<line>'` (skill-frontmatter) | YAML-frontmatter har syntaks som vår mini-parser ikke håndterer | Hold frontmatter til simple `key: value` + én indentert `metadata:`-blokk. Hvis du trenger lister/multi-line, oppgrader parser til js-yaml. |
| `lint-staged could not find any staged files` | Du `git add`-et men ingen filer matcher noen glob | OK — hooken har ikke noe å si til endringen. Commit går igjennom. |

## Om sammenhengen til CI

Pre-commit kjører lokalt og er per-fil-fokusert (kun staget). CI kjører
mer omfattende sjekker (full test-suite, full type-check, compliance,
visual regression). Pre-commit erstatter ikke CI — den utvider, så
feedback-loopen blir kortere for ting som er enkle å oppdage lokalt.

CI har siste-ord. Hvis pre-commit er grønn men CI er rød, er det fordi
en regel kjører bredere på CI (f.eks. test-suiten eller hele type-check)
— fiks de og pust.

## Endringslogg

| Dato | Endring | PR |
|---|---|---|
| 2026-04-24 | CSS no-backdrop-filter pre-commit (initial) | PR #468 |
| 2026-05-08 | Utvidet med skill-frontmatter, markdown-link, migration-name og store-binary-validatorer. Konfig flyttet til `.lintstagedrc.json`. | feat/pre-commit-hooks-husky |
