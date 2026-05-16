# PM Self-Test Heuristikk

**Status:** Autoritativ fra 2026-05-16 (Fase 3 P3 — ADR-0024 follow-up).
**Eier:** PM-AI.
**Implementasjon:** `scripts/pm-knowledge-continuity.mjs` + `scripts/__tests__/pm-knowledge-continuity.test.mjs`.
**Analogt med:** [`COMPREHENSION_VERIFICATION.md`](./COMPREHENSION_VERIFICATION.md) (Tier-3 fragility-paraphrase).

---

## Hvorfor dette finnes

`pm-knowledge-continuity.mjs --validate-self-test` valideret tidligere bare:
- ≥ 10 svar (av 12 spørsmål)
- Hvert svar ≥ 80 tegn (etter strip av backtick-spans)
- Ingen placeholder-token (`TODO`, `fyll inn`, `n/a`, etc.)
- Pack-SHA256-referanse finnes

Det er **fritekst-check** uten heuristisk validering. En PM kan skrive 80+ chars generisk gibberish ("Jeg har lest alt og forstår alle aspekter ved systemet, inkludert pilot og wallet og compliance og live-room") og passere uten å demonstrere internalisering av pack-en.

Tier-3 fragility-comprehension (`verify-context-comprehension.mjs`, 48 tester) løste samme problem for FRAGILITY-entries via paraphrase-heuristikk. Fase 3 P3 utvider self-test med tilsvarende mønster — per-spørsmål-anker + fluff-deteksjon.

## Hva som nå sjekkes

For hvert av de 12 self-test-spørsmålene:

1. **Lengde** ≥ 80 chars (etter strip av backtick-spans) — eksisterende
2. **Ingen placeholder-token** (`TODO|TBD|fyll inn|placeholder|kommer|ukjent|vet ikke|n/a|na`) — eksisterende
3. **Ingen generic-fluff-pattern** (`ok|lest|lest gjennom|tatt en titt|have read|read pack`) — **Fase 3 P3 nytt**
4. **Per-spørsmål-anker matcher** — **Fase 3 P3 nytt**

I tillegg, pack-SHA256-referanse må være ekte (ikke `"missing"`).

## Per-spørsmål-anker-tabell

Definert i `PER_QUESTION_ANCHORS` i `scripts/pm-knowledge-continuity.mjs`. Sammendrag:

| Q | Spørsmål | Forventet anker |
|---|---|---|
| Q1 | Videreføringsprioritet fra handoff/export | `PM_HANDOFF_<dato>.md` eller `PM_SESSION_KNOWLEDGE_EXPORT_<dato>.md` filnavn |
| Q2 | Åpne PR-er / røde workflows / branches | PR-nummer (`#NNNN`), workflow-navn, eller branch-navn (`codex/...`, `claude/...`) |
| Q3 | P0/P1-risikoer | `BIN-NNN`, `P0|P1` + domene-keyword, eller `file.ts:line` |
| Q4 | Arkitekturvalg + invariants | `ADR-NNNN`, arkitektur-doc-navn, eller invariant-begrep (hash-chain, outbox, perpetual-room) |
| Q5 | Relevante skills | Skill-navn fra `.claude/skills/` (eks. `spill1-master-flow`, `wallet-outbox-pattern`) |
| Q6 | PITFALLS_LOG-entries | `§X.Y`-format |
| Q7 | Observability-kilder | `Sentry`, `PostHog`, `pilot-monitor`, eller Sentry-issue-ID (`SPILLORAMA-BACKEND-N`) |
| Q8 | Git-state + uferdige filer | Branch-navn, fil-path, eller eksplisitt "working tree clean" |
| Q9 | Forrige PM-leveranse | PR-nummer, commit-SHA (7+ hex), eller spesifikk leveranse-referanse |
| Q10 | Første konkrete handling | `BIN-NNN`, fil-path, eller CLI-kommando (`npm run`, `node scripts`, `bash scripts`, `git rebase`, `gh pr`) |
| Q11 | Leveranseformat fra agenter | `AGENT_DELIVERY_REPORT_TEMPLATE`, "8 seksjon", eller `[delivery-report-not-applicable:]` |
| Q12 | Kunnskapsoppdateringer | `SKILL.md`, `PITFALLS_LOG.md`, eller `AGENT_EXECUTION_LOG.md` referert |

Hvert spørsmål har 2-3 alternative ankere — minst ett må treffe.

## Bypass-mekanisme

Hvis pack genuint ikke inneholder en type referanse (eks. ingen åpne PR-er → Q2-anker `#NNNN` ikke applicable), kan PM bruke:

```text
[self-test-bypass: <begrunnelse min 20 tegn forklarer hvorfor heuristikken ikke gjelder>]
```

Bypass short-circuit-er hele valideringen (alle 4 checks). Brukes med disiplin — overforbruk indikerer at heuristikken må kalibreres.

Bypass-begrunnelse < 20 tegn = fail. Begrunnelse skal være sporbar til pack-state ("alle PR-er merget", "pilot ikke startet ennå", etc.).

## Hvordan kalibrere heuristikken

Heuristikken er bevisst designet for å fange:
- Tomme/placeholder-svar
- Generic fluff ("OK", "lest gjennom")
- Lange-men-tomme svar uten konkrete pack-referanser

Den er IKKE designet for å validere semantisk korrekthet — det er Tobias' ansvar via stikkprøve.

Hvis en legitim PM-svar feiler valideringen:

1. **Først:** sjekk om svaret virkelig refererer pack-evidens. Hvis ikke → riktig fail.
2. **Hvis ja:** ankeret er kanskje for snevert. Foreslå utvidelse i `PER_QUESTION_ANCHORS`.
3. **Hvis pack-spesifikk situasjon:** bruk `[self-test-bypass: ...]` med begrunnelse.

## Forholdet til Tier-3 fragility-paraphrase

Begge bruker samme meta-pattern:

| Element | Tier-3 (fragility) | Self-test (Fase 3 P3) |
|---|---|---|
| Input | Commit-msg `## Comprehension`-blokk | 12-svar self-test-fil |
| Anker | Fil-mention fra `**Filer:**` + 3-ord overlap med `**Hva ALDRI gjøre:**` | Per-spørsmål regex fra `PER_QUESTION_ANCHORS` |
| Fluff-reject | Generic-pattern-array | Generic-pattern-array (overlappende) |
| Bypass | `[comprehension-bypass: ≥20 chars]` | `[self-test-bypass: ≥20 chars]` |
| Tester | 48 (`verify-context-comprehension.test.mjs`) | 55 (`pm-knowledge-continuity.test.mjs`) |

Disse to + delivery-report-gate (Fase 3 P1) bruker nå samme meta-pattern. En fremtidig refactor kan ekstrahere felles helpers (`contentWords`, `isGenericText`, stop-word-set) til `scripts/lib/paraphrase-heuristics.mjs` slik at de tre konsumentene deler én kilde til sannhet. **Ikke gjort i denne PR-en** — krever endring av Tier-3-modulen og dermed re-validering av eksisterende 48 tester. Spores som potensielt follow-up i ADR-0024 konsolideringskriterier.

## Når denne fila skal oppdateres

- Når et nytt spørsmål legges til i `SELF_TEST_QUESTIONS` (utvid PER_QUESTION_ANCHORS-tabellen)
- Når en eksisterende anker viser seg å ha for høy false-positive-rate (kalibrer)
- Når heuristikken konsolideres til felles `paraphrase-heuristics.mjs` (oppdater referansene)

## Cross-references

- [`scripts/pm-knowledge-continuity.mjs`](../../scripts/pm-knowledge-continuity.mjs) — implementasjonen
- [`scripts/__tests__/pm-knowledge-continuity.test.mjs`](../../scripts/__tests__/pm-knowledge-continuity.test.mjs) — 55 tester
- [`scripts/verify-context-comprehension.mjs`](../../scripts/verify-context-comprehension.mjs) — Tier-3 (analog pattern)
- [`docs/engineering/COMPREHENSION_VERIFICATION.md`](./COMPREHENSION_VERIFICATION.md) — Tier-3 dokumentasjon
- [`docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md`](../operations/PM_KNOWLEDGE_CONTINUITY_V2.md) — overordnet kontinuitet-spec
- [`docs/adr/0024-pm-knowledge-enforcement-architecture.md`](../adr/0024-pm-knowledge-enforcement-architecture.md) — meta-ADR
- [`.claude/skills/pm-orchestration-pattern/SKILL.md`](../../.claude/skills/pm-orchestration-pattern/SKILL.md) v1.6.0 — orkestreringsmønster

---

**Sist oppdatert:** 2026-05-16 (Fase 3 P3 introdusert).
