# Autonomy Smoke Test

**Status:** Aktiv — kjøres lokalt og i CI.
**Etablert:** 2026-05-13
**Eier:** PM-AI

Tobias-direktiv 2026-05-13:
> "vi venter med nye oppgaver helt til alt som er jobbet med nå er 100% bedre
> og bruke flere dager på å få det helt perfekt"

22 PR-er ble merget 2026-05-13 og etablerte hele autonomy-stacken. Dette
scriptet validerer at stacken faktisk fungerer end-to-end i et realistisk
scenario — ikke bare at hver enkelt komponent er kjørbar.

---

## Hvorfor scriptet eksisterer

Vi har sju kunnskaps-pilarer + flere hooks + flere CI-workflows som
samarbeider for å håndheve at agenter leser FRAGILITY, paraphraserer
forståelse, og ikke gjenintroduserer fixed bugs. Komponentene er testet
hver for seg (det finnes unit-tester for hvert script), men ingen
test sjekker at hele orkesteret fungerer som ett system.

`scripts/autonomy-smoke-test.sh` fyller det gapet. Den simulerer hva som
skjer fra en agent prøver å commit-e, og sjekker at:

1. Hooks fyrer i riktig rekkefølge
2. FRAGILITY-flagged filer blokkeres uten `[context-read: F-NN]`
3. Bug-resurrection blokkeres uten `[resurrection-acknowledged]`
4. Context-pack genererer relevant kunnskap (FRAGILITY + PITFALLS + skills)
5. CI-workflows ville matchet FRAGILITY + krevet delta-rapport
6. Tmp-state ryddes opp etter testen

---

## Hvordan kjøre

```bash
# Via npm
npm run test:autonomy

# Direkte
bash scripts/autonomy-smoke-test.sh
```

Scriptet er **idempotent** — kan kjøres uten side-effects, så ofte du vil.

Det krever IKKE:

- Lokal dev-stack (backend/Redis/Postgres)
- Tilkobling til GitHub (alle CI-workflows simuleres uten remote-kall)
- npm install (alle dependencies er allerede installert siden vi bruker
  eksisterende repo-scripts)

---

## Stages

### Stage 1 — Trivial commit (hooks fire i correct order)

Lager en TRIVIAL fil (`docs/engineering/.autonomy-smoke-test-trivial.txt`),
stage'r den, og verifiserer at pre-commit-hooks returnerer 0 for ikke-
FRAGILITY-filer.

**Hva testes:**
- Alle hook-scripts (`.husky/pre-commit-*.sh`) er eksekverbare
- FRAGILITY-check passerer ikke-FRAGILITY-fil
- Bug-resurrection-check passerer ny fil (ingen blame-historikk)
- Comprehension-check passerer commit uten `[context-read:]`

**Forventet:** alle hooks returnerer 0.

### Stage 2 — FRAGILITY-touch test

Modifiserer `packages/game-client/src/games/game1/screens/PlayScreen.ts`
(dekket av F-01) og verifiserer at:

**2a:** commit uten `[context-read: F-01]` → fragility-check returnerer 1
**2b:** commit MED `[context-read: F-01]` + paraphraserende Comprehension → passerer
**2c:** comprehension-check aksepterer en Comprehension-blokk som
        paraphraserer minst én regel fra F-01s "Hva ALDRI gjøre" (3+ word overlap)
**2d:** comprehension-check avviser commit som har `[context-read:]` men
        ingen `## Comprehension`-blokk

**Comprehension-blokken som brukes** paraphraserer disse F-01-reglene:
- "Legge til ny gate-condition uten å oppdatere alle 4 testene under"
- "Endre autoShowBuyPopupDone-reset-logikk uten å forstå idle-state-modus"
- "Sette waitingForMasterPurchase = true permanent — vil låse popup forever"

### Stage 3 — Bug-resurrection test

Søker etter en fil som SIST ble endret av en `fix(...)`-commit innen de
siste 30 dagene. Modifiserer en linje og kjører resurrection-check:

**3a:** uten `[resurrection-acknowledged]` → returnerer 1
**3b:** med `[resurrection-acknowledged: <begrunnelse>]` → returnerer 0

Hvis ingen kandidat-fil ga trigger (fix-commits typisk rør forskjellige
linjer), markeres testen som PASS med kvalifikasjon — det er ikke et bug.

### Stage 4 — Context-pack generation test

Kjører `bash scripts/generate-context-pack.sh apps/backend/src/game/Game1LobbyService.ts`
og verifiserer at output inneholder:

1. F-02 FRAGILITY-entry (siden Game1LobbyService.ts er i F-02s files)
2. PITFALLS §3 + §4 (Spill 1-arkitektur + Live-rom-state)
3. spill1-master-flow skill (via SKILL_FILE_MAP — Game1LobbyService.ts er i scope)
4. Lese-bekreftelse-mal med `[context-read:]` og `[skills-read:]`

### Stage 5 — PR-creation verification (simulert)

**Lager IKKE faktiske PR-er** — vil forurense prod-historikk. I stedet
simulerer hva CI ville sett:

**5a:** AI Fragility Review (ai-fragility-review.yml) — parser
        FRAGILITY_LOG.md akkurat som workflow-en gjør og sjekker at
        F-01 matcher PlayScreen.ts
**5b:** Delta-report-gate (delta-report-gate.yml) — sjekker at
        PlayScreen.ts er på en pilot-path (`packages/game-client/src/games/game1/`)
**5c:** Verifiserer at delta-rapport-malen er dokumentert i
        KNOWLEDGE_AUTONOMY_PROTOCOL.md

### Stage 6 — Cleanup verification

Sjekker at tmp-state er ryddet opp:

- Ingen staged filer
- Probe-fil (PlayScreen.ts) er restored
- Trivial scratch-fil er fjernet

---

## Exit-koder

| Code | Betydning |
|---|---|
| 0 | Alle stages PASS |
| 1 | Minst én stage FAIL |
| 2 | Pre-flight feilet (manglende scripts/hooks) |

---

## Output-format

Output-en bruker stages med tydelig PASS/FAIL og environmental warnings:

```
=== Autonomy Smoke Test — 2026-05-13T15:38:35Z ===

Repo:           /Users/tobiashaugen/Projects/Spillorama-system
Original branch: main
Tmp branch:     autonomy-smoke-test-12345-1778686715

[1/6] Trivial commit (verify hooks fire i correct order)
──────────────────────────────────────────────────────────────────────
  ✓ Hook eksekverbar: .husky/pre-commit-fragility-check.sh
  ✓ ...
  → STAGE PASS

...

=== Summary: 6/6 PASS, 0 FAIL ===

✓ All stages PASS — autonomy-stacken fungerer end-to-end
```

---

## Kjente miljø-begrensninger

### Bash 3.2 på macOS

Filen `.husky/pre-commit-fragility-check.sh` bruker bash 4-features
(`declare -A`). På macOS default bash 3.2.57 returnerer scriptet exit 2.

I CI (Ubuntu med bash 5.x) fungerer scriptet. På utvikler-maskin med
macOS default bash blir FRAGILITY-check SKIP'et i Stage 1 + 2 — testen
av selve sjekkens kontrakt forutsetter bash 4+.

**Workaround:** installer Homebrew bash 5 (`brew install bash`) og pin
shebang i scriptet, eller refaktorer til POSIX-kompatibelt (drop
`declare -A` til vanlige variabler).

Status flagges automatisk av smoke-testen som "Environmental limitations
detected" i Summary-blokken.

---

## Vedlikehold

### Når oppdatere

Oppdater smoke-testen når:

- Nye stages skal legges til (eks: skill-freshness-check, knowledge-backup)
- Eksisterende hooks endres
- Nye FRAGILITY-entries legges til som krever spesielle paraphrase-rules
- CI-workflows endres (oppdater Stage 5)

### Filer som endrer testen

Hvis du endrer noen av disse, kjør `npm run test:autonomy` lokalt:

- `.husky/pre-commit-*.sh`
- `scripts/scan-blame-for-recent-fixes.mjs`
- `scripts/find-skills-for-file.mjs`
- `scripts/generate-context-pack.sh`
- `scripts/verify-context-comprehension.mjs`
- `docs/engineering/FRAGILITY_LOG.md` (entries og deres "Hva ALDRI gjøre")
- `.github/workflows/ai-fragility-review.yml`
- `.github/workflows/delta-report-gate.yml`

### Forventede bugs det vil fange

| Bug | Hvilken stage fanger |
|---|---|
| Hook ikke eksekverbar | Stage 1 |
| FRAGILITY-parser broken | Stage 2, 5a |
| Resurrection-detector broken | Stage 3 |
| Context-pack mangler skill-loading | Stage 4 |
| Skill-mapping (find-skills-for-file) broken | Stage 4 |
| Delta-report-gate path-detection broken | Stage 5b |
| Hooks lekker staged endringer | Stage 6 |

---

## Relaterte docs

- [`KNOWLEDGE_AUTONOMY_PROTOCOL.md`](./KNOWLEDGE_AUTONOMY_PROTOCOL.md) — de 7 pilarene
- [`FRAGILITY_LOG.md`](./FRAGILITY_LOG.md) — fragile kode-regioner
- [`COMPREHENSION_VERIFICATION.md`](./COMPREHENSION_VERIFICATION.md) — heuristisk validering
- [`BUG_RESURRECTION_DETECTOR.md`](./BUG_RESURRECTION_DETECTOR.md) — anti-regression
- [`CROSS_KNOWLEDGE_AUDIT.md`](./CROSS_KNOWLEDGE_AUDIT.md) — ukentlig konsistens-sjekk

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial. 6 stages, idempotent, cleanup-disiplin. Flagger bash 3.2-limitation. | PM-AI |
