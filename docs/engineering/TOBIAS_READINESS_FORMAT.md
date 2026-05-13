# Tobias Readiness Format — auto-genererte smoke-test-steg per PR

**Status:** Aktiv (2026-05-13)
**Eier:** PM-AI (vedlikeholder maler + heuristikk)
**Formål:** Tobias' verifiserings-burden ned — han skal se nøyaktig hva han skal teste, ikke gjette ut fra diff.

---

## Hvorfor

Tobias' direktiv 2026-05-13:

> "Vi må få fremgang nå."

Hver PR mergees blindly hvis CI er grønn, og Tobias gjør deretter manuell smoke-test. Problemet: han må selv lese diffen for å vite *hva* han skal teste. Det er friksjon på et kritisk punkt — vi skal redusere det.

Løsningen: workflow `ai-fragility-review.yml` kjører `scripts/generate-tobias-readiness.mjs` for hver PR, som klassifiserer endrede filer mot kjente "test-scenarier" og rendrer ferdig markdown-blokk i PR-kommentaren. Blokken inneholder:

- **Estimated test time** (typisk 2-8 min)
- **Pre-req** (typisk `npm run dev:nuke` etter merge)
- **Hva endret** (1-3 setninger fra commit-melding eller fil-typer)
- **Smoke-test steps** (konkrete URL-er, credentials, klikk-rekkefølge, forventet resultat)
- **Forventet feilbilde** (typiske symptomer hvis PR-en er broken)

For docs-only PR-er vises kun "Smoke-test ikke nødvendig" — Tobias slipper å bruke tid.

---

## Hvordan det fungerer

### Pipeline

```
PR opened/synced/reopened
        ↓
ai-fragility-review.yml workflow trigger
        ↓
1. git diff --name-only base..head → /tmp/diff-files.txt
2. git log --format='%s' base..head → /tmp/commit-messages.txt
3. node scripts/generate-tobias-readiness.mjs → /tmp/tobias-readiness.md
        ↓
4. Kombiner med FRAGILITY-review (eksisterende) → PR-kommentar
        ↓
5. Auto-comment (oppdater eksisterende eller opprett ny)
```

### Heuristikk for scenario-matching

`scripts/generate-tobias-readiness.mjs` har en `classifyFile(filepath)`-funksjon som mapper hver endret fil til ett eller flere scenario-tags:

| Fil-mønster | Scenarier |
|---|---|
| `apps/backend/src/sockets/game1*` | master-start + spiller-buy |
| `apps/backend/src/game/MasterActionService.ts` | master-start + master-stop + master-advance |
| `apps/backend/src/game/GamePlanRunService.ts` | master-start + master-stop |
| `apps/backend/src/game/Game1*Service.ts` | master-start + spiller-buy |
| `apps/backend/src/game/Game1Engine.ts` | spiller-mark |
| `apps/backend/src/game/BingoEngine.ts` | spiller-mark |
| `apps/backend/src/game/Game1DrawEngineService.ts` | spiller-mark |
| `apps/backend/src/game/Game1PayoutService.ts` | master-advance + wallet-touch |
| `apps/backend/src/game/Game1TicketPurchaseService.ts` | spiller-buy + wallet-touch |
| `apps/backend/src/wallet/*` | wallet-touch |
| `apps/backend/src/compliance/*` | wallet-touch |
| `packages/game-client/src/games/game1/screens/PlayScreen.ts` | spiller-buy + spiller-mark |
| `packages/game-client/src/games/game1/components/BuyPopup*` | spiller-buy |
| `packages/game-client/src/games/game1/components/TicketGrid*` | spiller-buy |
| `apps/admin-web/src/pages/cash-inout/*` | master-start + master-stop |
| `apps/admin-web/src/pages/agent-portal/NextGamePanel*` | master-start + master-advance |
| `packages/shared-types/src/spill1*` | master-start + spiller-buy |
| `docs/*`, `*.md`, `.husky/*`, `scripts/*`, `.github/*` | docs-only |
| _(ingen match)_ | unknown |

Flere scenarier per fil aggregeres til unique-sett på tvers av PR-ens fil-liste.

### Maler

Hver scenario har en markdown-mal i `scripts/tobias-readiness-templates/<scenario>.md`. Malen rendres direkte (med placeholder-substitusjon for `{{FILE_LIST}}` og `{{SUMMARY}}`).

Eksisterende maler:
- `master-start.md`
- `master-stop.md`
- `master-advance.md`
- `spiller-buy.md`
- `spiller-mark.md`
- `wallet-touch.md`
- `docs-only.md` — viser "Smoke-test ikke nødvendig"
- `unknown.md` — fallback for filer som ikke matches

### Aggregering

- Hvis ALLE filer er docs-only → kun docs-only-mal vises (estimated time = "0 min")
- Hvis blandet → kun reelle scenarier vises (docs-only droppes som støy)
- Hvis kun "unknown" → unknown-fallback vises
- Hvis "unknown" sammen med ekte scenarier → unknown droppes (de andre er mer informative)

---

## Vedlikehold

### Legge til ny scenario

1. Lag `scripts/tobias-readiness-templates/<navn>.md` med markdown-mal
2. Mal skal ha:
   - `### Smoke-test steps (kort beskrivelse)`-header
   - Konkrete URL-er + credentials
   - Klikk-rekkefølge med tall (1. ... 2. ...)
   - "**Expected:** ..." i steg som verifiserer atferd
   - `### Forventet feilbilde hvis PR er broken`-seksjon
3. Oppdater `classifyFile()` i `scripts/generate-tobias-readiness.mjs` med matching-regelen
4. Legg til test-case i `scripts/__tests__/generate-tobias-readiness.test.mjs`
5. Eventuell ny fixture-fil i `scripts/__tests__/fixtures/diff-<navn>.txt`
6. Oppdater denne docen — tabell over fil-mønstre + scenarier

### Justere eksisterende mal

Bare rediger `scripts/tobias-readiness-templates/<scenario>.md`. Endringen tar effekt på neste PR-workflow-run.

### Endre heuristikk

Rediger `classifyFile()` eller `aggregateScenarios()` i `scripts/generate-tobias-readiness.mjs`. Kjør tester:

```bash
node --test scripts/__tests__/generate-tobias-readiness.test.mjs
```

---

## Test og bruk lokalt

Generere readiness-seksjon for en lokal diff:

```bash
# Mot main
git diff --name-only main HEAD > /tmp/my-diff.txt
git log --format='%s' main..HEAD > /tmp/my-commits.txt

node scripts/generate-tobias-readiness.mjs \
  --diff-file /tmp/my-diff.txt \
  --commit-messages /tmp/my-commits.txt
```

Output skrives til stdout (eller `--output-file <path>` for å lagre).

---

## Kvalitets-prinsipper

Hver mal skal:

1. **Være konkret** — `http://localhost:5174/admin/agent/cash-in-out`, ikke "admin-konsoll"
2. **Inkludere credentials** — `demo-agent-1@spillorama.no` / `Spillorama123!`
3. **Si hva som er forventet** — "Status bytter til running innen 2 sek", ikke "verify it works"
4. **Liste typiske feilbilder** — så Tobias kan kjenne igjen kjente regresjoner
5. **Være kort** — typisk 4-7 steg, ikke 20+
6. **Bruke norsk** — Tobias' arbeidsspråk; matches PM-onboarding-direktiv

Anti-mønstre å unngå:

- ❌ "Test that the feature works"
- ❌ "Verify the new behavior"
- ❌ "Make sure nothing is broken"
- ✅ "Klikk Start runde → status bytter til running innen 2 sek"
- ✅ "Sjekk Network-tab for `ticket:mark`-event"

---

## Relaterte docs

- `.github/workflows/ai-fragility-review.yml` — workflowen som genererer + poster kommentar
- `docs/engineering/FRAGILITY_LOG.md` — F-NN-entries (komplementært til Tobias-readiness)
- `docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md` §1.3 — fokus-områder for test
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` §5 — Tobias-kommunikasjons-mønstre
- `scripts/generate-tobias-readiness.mjs` — script source
- `scripts/tobias-readiness-templates/` — markdown-maler per scenario

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — 8 maler (master-start/stop/advance, spiller-buy/mark, wallet-touch, docs-only, unknown), heuristikk + test-suite | PM-AI (Tobias-direktiv 2026-05-13) |
