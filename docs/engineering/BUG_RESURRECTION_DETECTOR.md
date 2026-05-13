# Bug-Resurrection Detector

**Status:** Aktiv (2026-05-13)
**Eier:** PM-AI (vedlikeholdes ved hver agent-sesjon)
**Bakgrunn:** [PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md §6](./PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md) + [FRAGILITY_LOG.md](./FRAGILITY_LOG.md) + [PITFALLS_LOG.md §5](./PITFALLS_LOG.md)

---

## Hvorfor dette eksisterer

Spillorama-pilot mai 2026 hadde en gjentakende dynamikk Tobias kalte
**"2 skritt frem 1 tilbake"**:

1. Agent A merger en `fix(...)`-PR som løser en bug
2. Agent B (eller A senere) endrer kode i samme region av en annen grunn
3. Endringen reverterer Agent A's fix utilsiktet
4. Den fixede bugen kommer tilbake — ofte oppdaget av Tobias ved manuell test
5. Sirkelen gjentar seg

Detektoren tvinger eksplisitt bekreftelse før commit hvis du redigerer
linjer som SIST ble endret av en `fix(...)`-commit innenfor de siste 30
dagene. Du må enten **rulle tilbake endringen** eller eksplisitt
**acknowledge** at endringen er intensjonell og at du har lest den
relevante fix-historikken.

---

## Slik virker det

### Algoritme

For hver commit (eller staged-endring):

1. **Finn endrede filer** (`git diff --name-only`)
2. **For hver fil**, hent line-ranges som ble modifisert
   (`git diff --unified=0`) — kun gamle linjer som ble endret eller
   slettet, ikke pure additions
3. **Blame line-rangen** mot parent-commit (`git blame --porcelain -L ...`)
   — finn SHA-en som SIST endret hver linje
4. **For hver blame-SHA**, sjekk om commit-subject matcher
   `^fix(\(.+\))?:` (Conventional Commits fix-pattern) OG om
   commit-tid er innenfor `--days`-vinduet (default 30 dager)
5. **Hvis match**: rapporter som resurrection-candidate

Hvis minst én resurrection-candidate finnes:

- **Pre-commit hook**: blokkerer commit hvis commit-meldingen ikke har
  `[resurrection-acknowledged: <grunn>]`
- **CI workflow**: blokkerer merge hvis ingen commit-melding eller PR-body
  har acknowledgment

### Detection eksempel

```
git log --oneline --since="1 month ago" -- src/auth.ts
abc1234 (fix: handle session expiry race) — 5 dager siden
def5678 (feat: add 2FA flag)              — 2 dager siden  ← din PR

git blame src/auth.ts (linje 42-50, mot abc1234)
abc1234 line 42-47  ← din commit endret disse
```

Resultat: **resurrection-candidate** fordi linje 42-47 sist ble endret av
en `fix(...)`-commit innen 30 dager.

---

## CLI

```bash
node scripts/scan-blame-for-recent-fixes.mjs [options]
```

### Flagg

| Flagg | Default | Beskrivelse |
|---|---|---|
| `--ref <ref>` | `--staged` | Git-ref å scanne (eks. `HEAD`, `abc1234`) |
| `--staged` | (default) | Scan staged endringer (for pre-commit hook) |
| `--days <N>` | 30 | Recency-vindu i dager |
| `--format <human\|json>` | `human` | Output-format |
| `--quiet` | false | Print kun ved match |
| `--commit-msg-file <p>` | auto | Path til commit-msg fil (for hook) |
| `--help, -h` | — | Vis hjelp |

### Exit-koder

| Exit | Betydning |
|---|---|
| 0 | Ingen resurrection-candidates (eller acknowledgment satt) |
| 1 | Resurrection-candidates funnet uten acknowledgment |
| 2 | Script-feil (git ikke tilgjengelig, ugyldig ref, etc.) |

### Eksempler

```bash
# Scan staged changes (default)
node scripts/scan-blame-for-recent-fixes.mjs

# Scan en spesifikk commit
node scripts/scan-blame-for-recent-fixes.mjs --ref abc1234 --days 30

# JSON-output for CI-integrasjon
node scripts/scan-blame-for-recent-fixes.mjs --ref HEAD --format json

# Quiet mode for pre-commit hook
node scripts/scan-blame-for-recent-fixes.mjs --staged --quiet
```

---

## Pre-commit hook

Husky-hooken kjøres automatisk ved `git commit`:

```bash
# .husky/pre-commit (utdrag)
.husky/pre-commit-resurrection-check.sh || exit 1
```

Hook'en bruker `scripts/scan-blame-for-recent-fixes.mjs --staged` og blokkerer
commit hvis exit-code != 0.

### Override-flow

Hvis du fikser en bug i en region som nettopp ble fikset (sibling-bug
eller ufullstendig forrige fix), legg til en marker i commit-meldingen:

```
fix(spill1): handle disconnect during draw (sibling to #1267)

[resurrection-acknowledged: PR #1267 fikset disconnect ETTER game-end;
 dette fikser disconnect UNDER aktiv draw — ulike code-paths]
```

Hook'en finner `[resurrection-acknowledged: ...]` regex-match og lar
commit'en gå gjennom.

### Bypass-mekanismer

| Metode | Bruk | Når |
|---|---|---|
| `[resurrection-acknowledged: <grunn>]` | Normalt | Intensjonell endring, sibling-bug |
| `RESURRECTION_BYPASS=1 git commit ...` | Emergency | Akutt prod-fix, dokumenter |
| `git commit --no-verify` | Siste utvei | Hook har bug eller miljøfeil |

**Best practice:** Dokumenter alltid bypass-grunn i commit-meldingen,
selv om hook'en ikke tvinger det.

---

## CI workflow

`.github/workflows/bug-resurrection-check.yml` kjører på hver PR og:

1. Henter alle commits mellom merge-base og PR HEAD
2. For hver commit: kjører detektoren med `--format json --days 30`
3. Hvis noen commit har resurrection-candidates uten acknowledgment:
   - Sjekker PR-body for `Resurrection acknowledged: <grunn>` eller
     `resurrection-bypass: <grunn>` eller
     `resurrection-not-applicable: <rolle>`
4. Hvis ingen acknowledgment finnes noe sted: failer workflow + auto-kommentar

### PR-body acknowledgment

For å acknowledge på PR-nivå (i stedet for per-commit), skriv en av disse
i PR-body:

```markdown
Resurrection acknowledged: PR #1267 fikset post-game-end disconnect; jeg fikser sibling-bug under aktiv draw

# eller emergency-bypass
resurrection-bypass: kritisk prod-incident, Tobias-godkjenning gitt

# eller ikke-applicable
resurrection-not-applicable: docs-only PR
```

---

## Når detektoren IKKE skal trigge

Detektoren bruker konservative heuristikker for å unngå false positives:

| Scenario | Behandling |
|---|---|
| Pure additions (ingen gamle linjer endret) | Skip |
| Filen er ny i denne PR-en | Skip (blame har ingen historie) |
| Forrige commit var IKKE `fix(...)` (eks. `feat`, `chore`, `refactor`) | Ikke trigger |
| Forrige fix er > 30 dager gammel | Skip (utenfor vindu) |
| Filen er binary | Skip |
| Filen ble slettet | Skip |

### Når det fortsatt vil trigge "feil"

- **Cosmetic refactor i recent-fix region**: agenten må eksplisitt
  acknowledge selv om endringen er kosmetisk. **Dette er BEVISST** —
  hver kosmetisk endring i en fragile region krever bekreftelse, fordi
  selv små endringer kan reintrodusere bugs.

- **Tilbake-rulling av PR**: hvis du eksplisitt vil rulle tilbake en
  fix-commit (`git revert <fix-sha>`), så vil revert-commit'en touche
  samme linjer som fix'en. Acknowledge med
  `[resurrection-acknowledged: intensjonell revert av <fix-sha> per <grunn>]`.

- **Merge-konflikt-resolutions**: hvis du resolver en konflikt der den
  ene siden er en fix, kan resolved code touche samme linjer. Acknowledge.

---

## Integrasjon med øvrige systemer

| System | Relasjon |
|---|---|
| [FRAGILITY_LOG.md](./FRAGILITY_LOG.md) | Komplementært. FRAGILITY krever `[context-read: F-NN]` for spesifikke regioner. Resurrection krever `[resurrection-acknowledged: ...]` for recent fix-regions. Begge kan trigge samme commit. |
| [PITFALLS_LOG.md §5](./PITFALLS_LOG.md) | Git-fallgruver — denne detektoren er et automatisk fail-safe |
| [PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md](./PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md) §6 | Anti-mønstre — "manuell loop-iterasjon er forbudt" |
| `.husky/pre-commit` | Trinn 4 (etter FRAGILITY-check) |
| Linear | Resurrection-acknowledgments bør refereres i Linear-kommentarer for sporbarhet |

---

## Skript-vedlikehold

### Avhengigheter

Scriptet bruker kun Node.js innebygde moduler (`node:child_process`,
`node:fs`, `node:path`, `node:url`). Ingen npm-pakker krevd.

### Testing

```bash
npx vitest run scripts/__tests__/scan-blame-for-recent-fixes.test.mjs
```

29 tester dekker:
- Happy paths (3 scenarier)
- CLI-flagg (8 scenarier)
- Edge cases (8 scenarier)
- Acknowledgment-formater (4 scenarier)
- Staged-mode (3 scenarier)
- Real Spillorama-chain (1 scenario)

### Endre `--days` default

Edit `scripts/scan-blame-for-recent-fixes.mjs:69` — `opts.days = 30`.
Vurder også å oppdatere CI workflow (`--days 30` i `bug-resurrection-check.yml`).

### Endre fix-pattern

Edit `scripts/scan-blame-for-recent-fixes.mjs:151` — `FIX_PATTERN` regex.
Default er Conventional Commits `^(fix|Fix)(\(...\))?:\s`. Hvis du vil
inkludere andre prefixes (eks. `hotfix:`), oppdater regex og legg til test
i `scripts/__tests__/`.

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — detektor + pre-commit hook + CI workflow + 29 tester | Agent (Tier 3 autonomy) |

