# PM Knowledge Continuity v2

**Status:** Autoritativ fra 2026-05-15.
**Eier:** PM-AI / Tobias Haugen.
**Formål:** Sikre at ny PM faktisk har operativ kunnskapsparitet før første kodehandling, ikke bare at dokumentene finnes.

---

## Hvorfor dette laget finnes

Eksisterende PM-gates sikrer at PM bekrefter handoffs, ADR-er, PITFALLS_LOG, skills og knowledge-exports. Det er nødvendig, men ikke nok for et live-room system med ekte penger: en PM kan ha lest alt og likevel mangle et operativt svar på "hva gjør jeg nå, hva må ikke røres, og hvilke risikoer er aktive akkurat nå?".

Knowledge Continuity v2 legger derfor til to beviskrav:

1. **Evidence pack:** maskin-generert current-state-pakke fra repo, git, siste handoff, siste knowledge-export, ADR, PITFALLS_LOG, skills, PR-er og workflows.
2. **PM self-test:** fritekstsvar på konkrete spørsmål som beviser at PM kan fortsette arbeidet i samme spor uten å spørre Tobias om allerede dokumentert kontekst.

Dette er ikke erstatning for `PM_HANDOFF_*`, `PM_SESSION_KNOWLEDGE_EXPORT_*`, skills eller ADR-er. Det er et ekstra bevislag over dem.

---

## Startprosedyre

Kjøres etter `pm-checkpoint.sh` og `pm-doc-absorption-gate.sh`, før første kodehandling:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system

node scripts/pm-knowledge-continuity.mjs --generate-pack \
  --output /tmp/pm-knowledge-continuity-pack.md

node scripts/pm-knowledge-continuity.mjs --self-test-template \
  --pack /tmp/pm-knowledge-continuity-pack.md \
  --output /tmp/pm-knowledge-self-test.md

$EDITOR /tmp/pm-knowledge-self-test.md

node scripts/pm-knowledge-continuity.mjs --confirm-self-test \
  /tmp/pm-knowledge-self-test.md \
  --pack /tmp/pm-knowledge-continuity-pack.md

node scripts/pm-knowledge-continuity.mjs --validate
```

Når dette passerer, finnes `.pm-knowledge-continuity-confirmed.txt` i repo-rot. Den er lokal bevismarkør, gyldig i 7 dager med mindre `PM_KNOWLEDGE_VALIDITY_DAYS` settes.

---

## Hva PM må kunne svare på

Self-testen krever konkrete svar på minst disse områdene:

- Videreføringsprioritet fra siste PM-handoff og knowledge-export.
- Åpne PR-er, røde workflows, branches og uferdig arbeid.
- Aktive P0/P1-risikoer for live-room, wallet, compliance og pilot.
- Invariants og arkitekturvalg som ikke må brytes.
- Skills og PITFALLS_LOG-entries som må leses før agent-spawn.
- Observability som må være aktiv under test.
- Git-state og utrackede filer som ikke må blandes inn i PR.
- Agent-leveranseformat før PM åpner PR.
- Dokumenter og skills som må oppdateres hvis ny kunnskap oppstår.

Svar som bare sier "lest", "OK", "TODO", "kommer" eller annen placeholder-tekst avvises av scriptet.

**Fase 3 P3 heuristikk (2026-05-16):** I tillegg til lengde- og placeholder-sjekk kjører scriptet nå per-spørsmål-anker-validering:

- Q1 forventer `PM_HANDOFF_<dato>` eller `PM_SESSION_KNOWLEDGE_EXPORT_<dato>` filnavn.
- Q2 forventer PR-nummer (`#NNNN`), workflow-navn eller branch-navn.
- Q3 forventer `BIN-NNN`, P0/P1 + domene-keyword, eller `file.ts:line`.
- Q4 forventer `ADR-NNNN` eller arkitektur-doc-navn.
- Q5 forventer skill-navn fra `.claude/skills/`.
- Q6 forventer `§X.Y`-format.
- Q7 forventer Sentry/PostHog/pilot-monitor + konkret handling.
- Q8 forventer branch-navn, fil-path eller "working tree clean".
- Q9 forventer PR-nummer, commit-SHA eller spesifikk leveranse-referanse.
- Q10 forventer fil-path, `BIN-NNN`, eller CLI-kommando.
- Q11 forventer `AGENT_DELIVERY_REPORT`-referanse eller 8-seksjon-struktur.
- Q12 forventer `SKILL.md` / `PITFALLS_LOG.md` / `AGENT_EXECUTION_LOG.md`-referanse.

Generic-fluff-pattern ("OK", "lest gjennom", "tatt en titt", "have read") avvises ekstra etter placeholder-check.

**Bypass for pack-spesifikke unntak:** Legg `[self-test-bypass: <begrunnelse min 20 tegn>]` i self-test-filen hvis pack genuint ikke inneholder en type referanse (eks. ingen åpne PR-er → Q2-anker ikke applicable). Bypass short-circuit-er hele valideringen. Bruk med disiplin.

Full beskrivelse + 55 tester finnes i [`docs/engineering/PM_SELF_TEST_HEURISTICS.md`](../engineering/PM_SELF_TEST_HEURISTICS.md).

---

## PM-regel

Ingen PM skal starte kodehandling, spawn av implementer-agent, merge, branch-protection-endring eller test-sesjon før:

1. `bash scripts/pm-checkpoint.sh --validate` passerer.
2. `bash scripts/pm-doc-absorption-gate.sh --validate` passerer.
3. `node scripts/pm-knowledge-continuity.mjs --validate` passerer.

Hvis gaten må bypasses, skal det behandles som eksplisitt PM-gate-bypass med synlig audit trail i PR-body og label `approved-pm-bypass`.

---

## Agent-regel

Alle implementer-/fix-agenter skal levere rapport i formatet fra [`docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`](../engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md). PM skal ikke åpne PR før rapporten dokumenterer:

- Hvilken kontekst agenten leste.
- Hvilke invariants den bevarte.
- Hvilke filer den endret.
- Hvilke tester den kjørte eller hvorfor test ikke var relevant.
- Hvilken skill, PITFALLS_LOG-entry og AGENT_EXECUTION_LOG-entry som ble oppdatert, eller eksplisitt begrunnelse for unntak.
- Eventuelle åpne risikoer.

Dette gjør at neste PM får både kodeendringen og mentalmodellen bak endringen.

---

## Drift og vedlikehold

- Evidence pack skrives normalt til `/tmp/` og skal ikke committes.
- `.pm-knowledge-continuity-confirmed.txt` er lokal bekreftelse og kan revideres av Tobias etter behov.
- Hvis nye kunnskapskilder blir kanoniske, oppdater `scripts/pm-knowledge-continuity.mjs`, denne fila, `PM_SESSION_START_CHECKLIST.md` og `pm-orchestration-pattern`-skillen i samme PR.
- Hvis self-testen blir for lett å passere med generiske svar, stram valideringen i scriptet og legg ny entry i `PITFALLS_LOG.md` §8.
