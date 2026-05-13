# Skill Freshness — hvordan vi holder domain-skills relevante

**Status:** Aktiv (2026-05-13)
**Eier:** Tobias Haugen / PM-AI
**Relatert:**
- [`KNOWLEDGE_AUTONOMY_PROTOCOL.md`](./KNOWLEDGE_AUTONOMY_PROTOCOL.md) — overordnet kunnskaps-flyt
- [`.claude/skills/`](../../.claude/skills/) — skill-katalog
- [`scripts/skill-evolution-review.sh`](../../scripts/skill-evolution-review.sh) — bi-weekly skill-stub-foreslager

---

## 1. Hvorfor skills blir stale

Spillorama har 20+ domain-skills i `.claude/skills/<name>/SKILL.md`. Hver
skill dekker et arkitektonisk område (wallet, master-flow, compliance,
etc.) og lastes inn i agent-kontekst når mønsteret matcher.

Skills blir stale fordi:

1. **Koden endrer seg, men skillen ikke** — wallet-stack endrer seg 50
   ganger i 2 måneder, men `wallet-outbox-pattern/SKILL.md` har ingen
   commits. Agenter får utdatert mønster-beskrivelse.
2. **Nye fallgruver oppdages**, men dokumenteres bare i `PITFALLS_LOG`
   eller `FRAGILITY_LOG` — skill-en forblir uvitende.
3. **Filer flyttes eller refaktoreres**, men skillen refererer til de gamle
   pathene. Agenten leter forgjeves.
4. **Beslutninger blir reverttert** uten at skillen oppdateres.

Konsekvensen: agenter handler på utdatert kontekst, gjentar gamle bugs, og
PM må re-forklare ting som "burde stå i skillen".

---

## 2. Freshness-terskler

| Status | Alder (dager) | Tilleggsbetingelse | Konsekvens |
|---|---|---|---|
| **Fresh** | < 30 | — | OK, ingen action |
| **Fresh-but-aging** | 30-60 | — | OK, men flagget i ukentlig rapport |
| **Aging** | 60-90 | — | Flagget i rapport, vurder refresh |
| **Stale** | 90+ | — | Flagget rødt, refresh anbefalt |
| **Very-stale** | 90+ | 50+ commits til scope-filer siste 60 dager | Auto-issue, manuell review påkrevd |

Tersklene er definert i `scripts/check-skill-freshness.mjs` og kan justeres
sentralt der.

### Hvorfor "very-stale" krever begge betingelser

Å være 90+ dager gammel er ikke nødvendigvis et problem hvis koden i scope
heller ikke har endret seg — da er skillen fortsatt korrekt. Problemet er
når **koden har endret seg mye (50+ commits) mens skillen er statisk** —
da garanterer vi mismatch.

Eks: `audit-hash-chain` kan være 120 dager gammel og fortsatt korrekt hvis
ingen har rørt hash-chain-koden siden. Men hvis det er 80 commits til
`apps/backend/src/wallet/AuditLogService.ts` i mellomtiden, **må** skillen
reviewes.

---

## 3. Hvordan vi måler — scope-header

Hver `SKILL.md` skal ha en `<!-- scope: ... -->` HTML-kommentar som lister
glob-pattern for filene skillen dekker.

**Format:**

```markdown
---
name: wallet-outbox-pattern
description: When the user/agent works with wallet-mutating code, payout, ...
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/wallet/**, apps/backend/src/adapters/PostgresWalletAdapter.ts, apps/backend/src/payments/** -->

# Casino-grade wallet — outbox + REPEATABLE READ + hash-chain

...
```

**Regler:**

- Plasser scope-headeren rett etter front-matter (men før første `##`).
- Bruk komma-separasjon mellom patterns.
- Pattern kan være:
  - Eksakt sti: `apps/backend/src/wallet/WalletService.ts`
  - Glob med `**`: `apps/backend/src/wallet/**`
  - Mapper-prefix: `apps/backend/src/wallet/` (matches via prefix-check)
- Ikke ha mer enn ~10 patterns per skill — hvis du trenger flere, er
  scope-en for bred og skillen burde splittes.

### Skills uten scope-header

Skip skill-en — den vises i rapporten som "scope-undefined". Disse må
oppdateres med scope-header for å delta i freshness-analysen. Dette er
også del av B2-prosjektet (skill-file-mapping).

---

## 4. Hvordan refresh en skill

Når en skill er stale eller very-stale:

### Steg 1 — Les skillen + sammenlign med kode

```bash
# Skim skill-content
cat .claude/skills/<name>/SKILL.md

# Sjekk hvilke filer skillen referer til
grep -E "apps/|packages/|scripts/" .claude/skills/<name>/SKILL.md

# Sjekk om filene finnes og om innholdet matcher
```

### Steg 2 — Oppdater innhold

Vanlige endringer:

- **Nye eksempler:** legg til pattern fra recent agent-leveranser (se
  `AGENT_EXECUTION_LOG.md` for inspirasjon).
- **Anti-eksempler:** legg til fallgruver fra `PITFALLS_LOG.md` som er
  relevante for skill-domain.
- **Oppdater file-paths:** hvis filer har flyttet.
- **Reference oppdaterte ADR-er:** hvis arkitekturen er endret.
- **Slett deprecated avsnitt:** hvis koden ikke lenger fungerer slik.

### Steg 3 — Commit med riktig tag

```bash
git add .claude/skills/<name>/SKILL.md
git commit -m "docs(skills): refresh <name> [skill-refreshed: <name>]

- Oppdaterte file:line-pekere etter wallet-refaktor
- La til pattern for IdempotencyKeys (BIN-767)
- Slettet deprecated SERIALIZABLE-eksempel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Tag `[skill-refreshed: <name>]` brukes for å spore refresh-aktivitet over
tid (kan brukes i framtidige analyser).

### Steg 4 — Verifiser

Etter merge, sjekk at skillen ikke vises som stale i neste ukentlige
rapport (se artifact i `skill-freshness-weekly`-workflowen).

---

## 5. Hvordan deprecate en skill

Hvis en skill ikke lenger er relevant (eks. spillet er fjernet, mønsteret
er erstattet):

**Option A — Soft-deprecate (anbefalt):**

Legg til status-header øverst i SKILL.md:

```markdown
---
name: themebingo-deprecated
description: DEPRECATED — temabingo (game4) ble fjernet BIN-496 (2026-04-17). Bruk i stedet ...
status: deprecated
deprecatedDate: 2026-04-17
deprecatedReason: Game 4 / themebingo fjernet permanent
---
```

Eller flytt til `.claude/skills/_archive/` (gjør slik at den ikke matcher
keyword-trigger lenger).

**Option B — Hard-delete:**

```bash
git rm -r .claude/skills/<name>/
git commit -m "chore(skills): remove deprecated <name> skill"
```

Bare hvis du er sikker på at ingen historiske docs eller PR-er linker dit.

---

## 6. Hvordan legge til ny scope-header til eksisterende skill

```bash
# Editer SKILL.md
$EDITOR .claude/skills/<name>/SKILL.md

# Plasser scope-header rett etter front-matter:
# <!-- scope: apps/backend/src/<dir>/**, ... -->

# Verifiser at scope-en plukker opp relevante filer
node scripts/check-skill-freshness.mjs --quiet | \
  python3 -c "
import json, sys
r = json.load(sys.stdin)
for s in r['skills']:
    if s['name'] == '<name>':
        print(f\"scope={s['scope']}\")
        print(f\"commitsInScope={s['commitsInScope']}\")
        print(f\"status={s['status']}\")
"

# Commit
git add .claude/skills/<name>/SKILL.md
git commit -m "docs(skills): add scope-header to <name> for freshness-tracking"
```

---

## 7. CI-gates

### Ukentlig (mandag 09:00 UTC)

`.github/workflows/skill-freshness-weekly.yml` kjører:

1. Lager rapport over alle skills
2. Hvis ≥ 1 very-stale skill funnet → **auto-oppretter GitHub issue**
   med label `skill-freshness`
3. Skriver sammendrag til Actions Summary
4. Lagrer rapport som artifact (30 dagers retention)

Issue dedupliserings: hvis en åpen issue allerede finnes fra siste 7
dager, oppretter vi ikke en ny.

### PR-tid (på hver pull_request)

`.github/workflows/skill-freshness-pr-check.yml` kjører:

1. Sjekker om PR-endrede filer matcher scope av noen stale skill
2. Hvis ja → poster informativ kommentar på PR
3. **Ikke blokkerende** — bare heads-up

Kommentaren oppdateres ved hver push, og fjernes hvis PR endres slik at
ingen stale skill matches lenger.

---

## 8. Lokal bruk

Sjekk freshness-status før du gjør PR:

```bash
# Full markdown-rapport
node scripts/check-skill-freshness.mjs --markdown

# JSON for scripting
node scripts/check-skill-freshness.mjs

# Bare very-stale skills (for triage)
node scripts/check-skill-freshness.mjs --very-stale-only

# PR-mode: hvilke skills dekker filer i din branch?
node scripts/check-skill-freshness.mjs --pr-mode --markdown

# Eller mot annen base-branch
node scripts/check-skill-freshness.mjs --pr-mode --pr-base=origin/main --markdown
```

---

## 9. Sammenheng med andre kunnskaps-pilarer

| Pilar | Hvordan den interagerer med skill-freshness |
|---|---|
| **PITFALLS_LOG** | Nye fallgruver bør reflekteres i relevante skills — refresh-tag |
| **FRAGILITY_LOG** | Hvis en fil flagges som fragile, sjekk om noen skill referer den |
| **BUG_CATALOG** | Recurring bugs i et domene → skill mangler anti-pattern |
| **AGENT_EXECUTION_LOG** | Recurring leveranser → skill bør oppdateres med nye eksempler |
| **skill-evolution-review.sh** | Bi-weekly script som identifiserer recurring patterns og foreslår nye skills |

---

## 10. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — terskler + scope-header + workflows | PM-AI (B3-task) |
