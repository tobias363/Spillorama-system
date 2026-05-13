# Comprehension Verification — Tier-3 enforcement

**Status:** Aktiv (etablert 2026-05-13)
**Eier:** PM-AI vedlikeholder, alle agenter/utviklere må forholde seg til den
**Tilhører:** Autonomi-pyramiden (Tier-1 = FRAGILITY_LOG, Tier-2 = pre-commit-fragility-check, Tier-3 = denne)

> "[context-read: F-NN]-tagger er kun en lese-bekreftelse, ikke en comprehension-bekreftelse. Vi trenger heuristisk validering som tvinger paraphrase."
> — Tobias-direktiv 2026-05-13

---

## 0. Hvorfor dette dokumentet eksisterer

Spillorama har FRAGILITY_LOG.md (Tier-1) som flagger fragile kode-regioner
og pre-commit-fragility-check.sh (Tier-2) som krever at agenter inkluderer
`[context-read: F-NN]` i commit-meldinger når de rør fragile filer.

Problemet: en agent kan **lyve med konstant kostnad** — bare lim inn
`[context-read: F-01]` uten faktisk å ha lest entry-en. Det er enkelt å
gjøre, vanskelig å fange, og fjerner hele beskyttelsen Tier-2 var ment å gi.

Tier-3 lukker dette gapet ved å kreve en `## Comprehension`-blokk i
commit-meldingen som **heuristisk** demonstrerer at agenten har lest
entry-en. Validering skjer i pre-commit hook og blokkerer commit hvis
heuristikken feiler.

---

## 1. Hvordan det fungerer

### 1.1 Tre lag av enforcement

```
┌──────────────────────────────────────────────────────────────┐
│ Tier 1: FRAGILITY_LOG.md (manuell katalog)                  │
│ Manuelt vedlikeholdt. Hver fragility-entry har:              │
│   - Filer (path med backticks)                                │
│   - Hva ALDRI gjøre (bullets)                                │
│   - Hvilke tester MÅ stå grønn                                │
│   - Manuell verifikasjon                                      │
│   - Historisk skade                                           │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Tier 2: pre-commit-fragility-check.sh                        │
│ Bash hook. Sjekker staged filer mot FRAGILITY_LOG-filsti.    │
│ Hvis match: krever [context-read: F-NN] i commit-message.    │
│ ❌ FORDEL: enkel å verifisere                                  │
│ ❌ ULEMPE: kan lyves bort med konstant kostnad                │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Tier 3: pre-commit-comprehension.sh + Node-script (DENNE)    │
│ Krever ## Comprehension-blokk når [context-read:] satt.      │
│ Heuristisk validering:                                        │
│   1. Lengde 100-2000 chars                                    │
│   2. Ikke matche "jeg leste"-generic patterns                 │
│   3. Minst én filsti fra entry nevnt                          │
│   4. Minst én "Hva ALDRI gjøre"-regel paraphrasert (3+ ord)   │
│ ✅ FORDEL: krever ekte arbeid for å passere                   │
│ ✅ FORDEL: heuristisk = ingen LLM-kost                        │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Pipeline-flyt

Når en agent committer:

1. `.husky/pre-commit` orchestrator kjører i rekkefølge:
   - Trinn 1: PM-gate
   - Trinn 2: Tier-A intent
   - **Trinn 3: FRAGILITY-check** (krever `[context-read: F-NN]`)
   - **Trinn 4: COMPREHENSION-check** (krever `## Comprehension`-blokk)
   - Trinn 5: Lint-staged
2. Hvis commit-message inneholder ingen `[context-read:]`-marker → Tier-3 exit umiddelbart
3. Hvis match → henter FRAGILITY-entry, parser dens regler + filer
4. Sjekker mot `## Comprehension`-blokk
5. Pass → exit 0 + skriver `.git/comprehension-notes/comprehension-<sha>.txt`
6. Fail → exit 1 + viser detaljerte feilmeldinger

### 1.3 Performance

Hooken er optimalisert for å være "billig når den ikke gjelder":

| Scenario | Tid |
|---|---|
| Commit uten `[context-read:]` | ~100ms (regex-check + early exit) |
| Commit med `[context-read:]` (FRAGILITY_LOG ~250 linjer) | ~150-200ms (parse + validering) |
| Commit med bypass-marker | ~120ms (early bypass path) |

Ingen LLM-API-kall. Ingen nettverk. Bare regex og string-overlap.

---

## 2. Format på commit-message som passer sjekken

### 2.1 Minimal "passer-eksempel" (Norwegian)

```
fix(game-client): juster popup auto-show

[context-read: F-01]

Mer detaljer om hva som ble endret og hvorfor.

## Comprehension

F-01 viser at PlayScreen.ts har en 5-conditions popup-auto-show-gate hvor
autoShowBuyPopupDone reset-logikken må forbli per-runde. Jeg har sjekket at
getEventTracker.track-callen for popup.autoShowGate er beholdt fordi server-side
monitor avhenger av det, og at jeg ikke endrer gate-conditions eller idle-state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

**Hva sjekken faktisk verifiserer:**

| Krav | Hvordan dette eksempelet passerer |
|---|---|
| `## Comprehension`-blokk finnes | ✓ |
| 100-2000 chars | ~370 chars |
| Ikke matche `jeg leste`-pattern | ✓ (starter med "F-01 viser at") |
| Nevner filsti fra F-01 | ✓ ("PlayScreen.ts") |
| Paraphraserer ≥ 1 regel (3+ ord overlap) | ✓ ("getEventTracker", "track", "popup.autoShowGate", "monitor" matches "Fjerne getEventTracker().track('popup.autoShowGate', ...) — server-side monitor avhenger av det") |

### 2.2 Multiple FID-er i samme commit

Når commit rør flere fragile filer:

```
fix(autonomy): wire fragility + comprehension hooks

[context-read: F-01, F-02]

## Comprehension

F-01 dekker PlayScreen.ts og popup-auto-show-gate. Jeg har sjekket at jeg
ikke fjerner getEventTracker track-callen og at autoShowBuyPopupDone forblir
per-runde. F-02 dekker GamePlanRunService.ts og lifecycle. Jeg har verifisert
at masterStop også resetter app_game_plan_run.status og at jeg ikke endrer
Game1LobbyService.buildNextGameFromItem uten å sjekke begge state-maskinene.

Co-Authored-By: ...
```

Sjekken validerer hvert FID **separat** mot samme `## Comprehension`-blokk.
Hvis F-01 og F-02 ikke kan begge tilfredsstilles av samme blokk, så må
blokken utvides til å dekke begge.

### 2.3 Komma-separert vs separate tagger

Begge format godtas:

```
[context-read: F-01, F-02]
```

```
[context-read: F-01]
[context-read: F-02]
```

---

## 3. Override-mekanisme (bypass)

### 3.1 Når bruke bypass

Kun i ekte nødsituasjoner:
- Prod-incident pågår, manuell fiks nødvendig
- Verktøyet selv har bug og blokkerer legitim arbeid
- Tobias har eksplisitt gitt grønt lys

### 3.2 Bypass-format

Inkluder i commit-message:

```
[comprehension-bypass: <begrunnelse minst 20 tegn>]
```

Eksempel:

```
fix(emergency): hotfix Spill 1 lobby crash

[context-read: F-01]
[comprehension-bypass: prod incident BIN-9999, full review post-merge planlagt]

## Comprehension

(skipped via bypass)
```

### 3.3 Bypass-verifikasjon

- Sjekken logger en WARNING til stderr (vises i pre-commit-output)
- Bypass krever minst 20 tegn begrunnelse (rejecter "ok", "fix later", etc.)
- PR-reviewer skal verifisere at bypass-en er legitim
- Bypass-bruk loggføres implisitt via commit-message i git-historikk

### 3.4 Env-bypass (siste utvei)

```bash
COMPREHENSION_BYPASS=1 git commit -m "..."
```

Skipper sjekken uten å kreve marker i commit-message. Bruk KUN hvis
verktøyet selv er broken. Dokumenter i PR-beskrivelsen.

---

## 4. Hvordan sjekken validerer (intern logikk)

### 4.1 Parser FRAGILITY_LOG

Henter ut for hver `## F-NN`-entry:
- **Files**: backtick-wrapped paths (`PlayScreen.ts`) eller bare paths (`apps/backend/src/...`)
- **NeverDo**: bullets under `**Hva ALDRI gjøre:**`-header
- **Title**: navn etter `:` på header-linjen

Glob-pattern (`tests/e2e/*.spec.ts`) støttes — matches mot
comprehension-tekst via regex-konvertering (`*` → `[^/\s]*`).

### 4.2 Validerings-pipeline

For hver `[context-read: F-NN]`-referanse:

1. **Lengde-sjekk**: comprehension-tekst mellom 100 og 2000 chars
2. **Generic-pattern-sjekk**: ikke matche `/^(jeg leste|ok|lest|done|read it|...)$/i`
3. **Filsti-sjekk**: minst én entry-fil må nevnes i tekst (full path, basename ≥ 5 chars, eller glob-match)
4. **Regel-paraphrase-sjekk**: minst én rule fra "Hva ALDRI gjøre" må ha ≥ 3 content-words overlap

### 4.3 Stop-word-filter

`ruleOverlap` ignorerer norsk + engelsk stop-words (`og`, `er`, `den`,
`the`, `is`, etc.). Bare meningsfulle content-words teller mot 3-ord-grensen.

### 4.4 Out-of-band: git-notes

Ved vellykket validering skrives en note til
`.git/comprehension-notes/comprehension-<short-sha>.txt` med:
- Verifiserte FID-er
- Timestamp
- Comprehension-preview (første 500 chars)

Brukes til retrospektiv audit (er X-commit verifisert?). Fail-soft hvis
git-state ikke tillater note-skriving.

---

## 5. Når sjekken IKKE kjører

For ytelse skipper hooken full validering når:

| Scenario | Resultat |
|---|---|
| Commit-message har ingen `[context-read:]`-marker | Skip (regex-check + exit 0) |
| FRAGILITY_LOG.md mangler | Skip (fail-soft, exit 0) |
| Node ikke installert | Skip med warning |
| Script-fil ikke funnet (forward-compat) | Skip (fail-soft) |
| `COMPREHENSION_BYPASS=1` env-var | Skip med warning |
| Interne feil i scriptet | Skip med error-log (fail-soft for å ikke blokkere alt) |

---

## 6. Komplementære systemer

Comprehension-verification jobber sammen med:

1. **pre-commit-fragility-check.sh** — krever `[context-read:]`-marker
2. **ai-fragility-review.yml** — post-PR feedback fra GitHub Actions med "har du sjekket X?"
3. **delta-report-gate.yml** — krever delta-rapport for endringer på Tier-A-paths
4. **knowledge-protocol-gate.yml** — PR-template checkbox "knowledge protocol oppdatert"

Sammen utgjør disse en multi-lag forsvar mot "endre uten kontekst".

---

## 7. Vedlikehold

### 7.1 Tuning heuristikken

Hvis vi ser **false-positives** (legitime commits blokkert):
- Sjekk `scripts/__tests__/verify-context-comprehension.test.mjs` for nye edge-cases
- Vurdér å øke `MAX_COMPREHENSION_CHARS` eller justere `MIN_OVERLAP_WORDS`
- Legg til stop-words i `STOP_WORDS`-settet hvis nye norske/engelske fyll-ord oppdages

Hvis vi ser **false-negatives** (lett-bypassed):
- Skjerp `GENERIC_PATTERNS` med nye fluff-fraser
- Vurdér å øke `MIN_OVERLAP_WORDS` fra 3 til 4

Endringer bør ALLTID legge til tester i `verify-context-comprehension.test.mjs`
før de mergees.

### 7.2 Når oppdatere docs

Oppdater denne fila når:
- Nye FRAGILITY-entries krever spesifikk parse-håndtering
- Validerings-reglene endres (lengde, overlap-grenser)
- Nye bypass-mekanismer legges til
- Performance-mål endres

### 7.3 Fremtidige utvidelser (post-pilot)

- **Claude API-integrasjon**: send commit-message + entry til Claude og spør
  "har denne developer'en faktisk lest entry-en?". Krever budget + caching.
- **Per-entry severity**: noen F-NN-entries er kritiske (P0), andre er soft.
  Tunbar streng-het per entry.
- **Cross-PR feedback**: når en PR mergees uten comprehension, autopost
  PR-kommentar med "neste gang, husk å..."

Ingen av disse er pilot-blokkere.

---

## 8. Test-suite

`scripts/__tests__/verify-context-comprehension.test.mjs` dekker:
- Parser: 6 tester (entries, files, never-do, section-breaks, glob, real-file)
- extractComprehensionBlock: 5 tester
- extractContextReadFids: 5 tester
- extractBypassReason: 3 tester
- isGenericText: 5 tester
- ruleOverlap: 3 tester
- findFileMention: 4 tester
- validateEntryAgainstComprehension: 6 tester
- validateCommitMessage (e2e): 8 tester
- Heuristic-quality guards: 2 tester

Kjøres med:
```bash
node --test scripts/__tests__/verify-context-comprehension.test.mjs
# eller via cli-flag:
node scripts/verify-context-comprehension.mjs --test
```

48 tests, alle passerer.

---

## 9. Eksempel: lokal feilsøk

Hvis pre-commit blokkerer deg, kjør sjekken manuelt for debug:

```bash
# Lagre commit-message til fil
cat > /tmp/my-msg.txt << 'EOF'
fix(scope): ...

[context-read: F-01]

## Comprehension

...
EOF

# Kjør sjekken
node scripts/verify-context-comprehension.mjs --commit-msg /tmp/my-msg.txt
```

Exit-koder:
- `0` = pass
- `1` = fail (med diagnostics på stderr)
- `2` = bruksfeil (--commit-msg ikke gitt etc.)

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — comprehension-verification etablert som Tier-3 over FRAGILITY_LOG og pre-commit-fragility-check | PM-AI (Claude Opus 4.7) |
