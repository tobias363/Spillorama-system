# Agent Delivery Report Template

**Status:** Autoritativ fra 2026-05-15.
**Bruk:** PM kopierer denne inn i agent-prompts eller krever at agenten rapporterer i dette formatet før PR.
**Formål:** Gjøre hver agentleveranse overtakbar for neste PM uten ekstra spørsmål.

---

## Template

```markdown
## Agent Delivery Report — <agent-navn / scope>

**Branch:** `<branch>`
**Commit(s):** `<sha>` / `<sha>`
**PR:** #<nummer hvis åpnet, ellers "PM åpner">
**Scope:** <kort, konkret avgrensning>

### 1. Context read before changes

- <Fil/skill/ADR/PITFALL agenten leste>
- <Hvorfor denne konteksten var relevant>

### 2. What changed

- <Kodeendring 1 med filsti>
- <Kodeendring 2 med filsti>
- <Doc-endring 1 med filsti>

### 3. Invariants preserved

- <Hva agenten bevisst ikke endret>
- <Hvilken arkitekturregel eller ADR som ble bevart>
- <Hva som ville vært farlig å endre senere>

### 4. Tests and verification

- `<kommando>` — pass/fail
- `<testfil>` — hvilken regresjon den beskytter
- Hvis test ikke kjørt: <konkret grunn + risiko>

### 5. Knowledge updates

- Skill: `.claude/skills/<skill>/SKILL.md` — <seksjon oppdatert>
- PITFALLS_LOG: `docs/engineering/PITFALLS_LOG.md` §<X.Y> — <tittel>
- AGENT_EXECUTION_LOG: `docs/engineering/AGENT_EXECUTION_LOG.md` — <entry-tittel>

### 6. Lessons learned

- <Ny kunnskap fremtidige agenter/PM-er må vite>
- <Hva som nå funker>
- <Hva fremtidige agenter ikke må "rydde opp" eller reversere>

### 7. Open risk / follow-up

- <Ingen> eller <konkret risiko, eier og neste handling>

### 8. Ready for PR

Ready for PR: ja/nei
Reason: <hvorfor>
```

---

## PM acceptance rule

PM skal ikke åpne eller merge PR basert på en agentleveranse før rapporten svarer på alle åtte seksjoner.

Unntak er bare tillatt for rene mekaniske endringer, for eksempel format-only, ren rename eller config-pin. Unntaket skal stå eksplisitt i PR-body med hvorfor skill/PITFALLS/AGENT_EXECUTION_LOG ikke ble oppdatert.

---

## Hvorfor rapporten er streng

Spillorama er live-room pengespill med regulatorisk og økonomisk risiko. En kodeendring uten kunnskapsforklaring er ikke ferdig arbeid, fordi neste PM eller agent da kan reversere en bevisst fix og bruke tid på samme feil igjen.

Rapporten er derfor en leveransekontrakt:

- Kode viser hva som endret seg.
- Tester viser at det virker nå.
- Skill og PITFALLS_LOG viser hvorfor det ikke skal brytes senere.
- Agent Delivery Report viser hvordan PM overtar arbeidet uten spørsmål.
