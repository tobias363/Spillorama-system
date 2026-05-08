# ADR-0009 — PM-sentralisert git-flyt

**Status:** Accepted
**Dato:** 2026-04-21
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-008-pm-centralized-git-flow.md` til ny struktur. Innhold uendret.

## Kontekst

Spillorama bruker AI-agenter (Claude Code) parallelt for å øke leveringskapasitet. Hver agent jobber
i egen worktree på sin egen feature-branch.

Tidlig modell: agenter kjørte selv `gh pr create` og merget direkte etter CI-passing. Dette ga problemer:

1. **Race conditions ved parallell merging:** to agenter merget hver sin PR samme minutt — den andre
   måtte rebase-rebase-rebase
2. **Kvalitetskontroll inkonsistent:** noen PR-er fikk strenge review, andre kom rett gjennom
3. **Cross-cutting concerns oppdaget for sent:** PR A og PR B kunne hver for seg være OK men sammen
   skape regresjon
4. **Falske Done-funn:** issue ble lukket basert på PR-åpning, men commit nådde aldri main (BIN-534, jf.
   ADR-0010)

## Beslutning

Innfør **PM-sentralisert git-flyt** (vedtatt 2026-04-21):

**Agenter:**
- Commit + push feature-branch (lokal `git push origin <branch>`)
- Rapporter til PM som "Agent N — [scope]:" med branch-navn, commit-SHA, test-status
- IKKE `gh pr create`. IKKE merge. IKKE force-push.

**PM (Tobias eller orkestrerings-agent):**
- Eier `gh pr create`
- Eier merge-rekkefølge
- Eier kvalitetskontroll (review-pass, CI-validering, cross-cutting-sjekk)

Dette gir én beslutningstager for merge-orden og forhindrer cross-cutting-issues.

## Konsekvenser

### Positive
- **Færre merge-konflikter:** PM seriealiserer mergene, ikke parallelt-race
- **Bedre kvalitetskontroll:** alle PR-er får samme review-tilnærming
- **Cross-cutting fanges:** PM ser flere PR-er sammen og oppdager interaksjoner
- **Audit-trail bedre:** klart hvem som godkjente hva

### Negative
- **Bottleneck-risiko:** hvis PM er borte, stopper merging. Mitigert ved at Tobias er primær PM med
  delegering ved behov.
- **Latency:** agent ferdig kl 14:00, merge skjer kanskje kl 16:00. Akseptabelt for kvalitet.

### Nøytrale
- **Disiplin:** agenter må ikke "snike" — `git push --force` til main forbudt. CI har branch-protection.

## Alternativer vurdert

### Alternativ A: Auto-merge etter CI-pass
Avvist:
- Race conditions
- Cross-cutting fanges ikke

### Alternativ B: Merge-train (Mergify/lignende)
Avvist:
- Ekstra infra
- Mister manuell PM-vurdering

### Alternativ C: Per-feature long-lived branches med periodisk merge
Avvist:
- For komplisert for vår skala
- Branches divergerer for mye

## Implementasjon

- ✅ Vedtatt og dokumentert i CLAUDE.md
- ✅ Memory-fil `feedback_git_flow.md` er auto-loaded i hver sesjon
- ✅ Agenter rapporterer "Agent N — [scope]:" konsekvent

Skills som bør oppdateres: `pm-orchestration-pattern`.

## Referanser

- Memory: `~/.claude/projects/.../feedback_git_flow.md`
- CLAUDE.md §"PM-centralized git workflow"
- Spawn-agent-mønstre i sesjons-handoff-er
