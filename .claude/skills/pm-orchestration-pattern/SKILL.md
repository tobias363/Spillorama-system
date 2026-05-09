---
name: pm-orchestration-pattern
description: When the user/agent acts as PM-AI orchestrating parallel agents on the Spillorama bingo platform. Also use when they mention PM-orchestration, spawn agent, PR-first, done-policy, file:line, auto-pull, BACKLOG.md, gh pr merge --squash --auto, isolation worktree, Linear MCP, code-reviewer gate, "Agent N —", parallell agent-bølge, hot-reload, admin-restart-linje. Defines the PM-centralized git flow, done-policy gates, auto-pull-after-merge protocol, and parallel-agent spawn patterns. Make sure to use this skill whenever someone takes on a PM role for this project even if they don't explicitly ask for it — the cost of getting orchestration wrong is lost work, broken main, or false-Done in regulator-facing docs.
metadata:
  version: 1.0.0
  project: spillorama
---

# PM Orchestration Pattern

## Kontekst

Spillorama-prosjektet kjører ofte 3-7 parallelle agenter på samme codebase via Claude Code worktrees. Tobias er teknisk lead men håndterer **aldri** git lokalt — han bare refresher nettleseren etter merge. PM-AI eier all git-koordinering, PR-håndtering, og agent-spawning.

Tre regler er hardkodet i prosjektet og må ALDRI brytes:

1. **PM-sentralisert git-flyt** (vedtatt 2026-04-21) — agenter committer + pusher feature-branches; PM eier PR/merge.
2. **Done-policy** (vedtatt 2026-04-17) — issues lukkes kun når commit er merget til main + file:line + grønt CI.
3. **Auto-pull etter merge** (vedtatt 2026-05-08) — PM pull-er Tobias' main repo etter HVER PR-merge.

Bryterne disse reglene = Tobias mister tillit + regulatorisk risiko (false-Done på Lotteritilsynet-funn).

## Kjerne-arkitektur

### Roller

| Rolle | Ansvar | Hvem |
|---|---|---|
| **Tobias** | Beslutninger, browser-test, feedback | Mennesket |
| **PM-AI** | Koordinering, git-håndtering, agent-spawn, code-review-gate | Hovedøkten |
| **Agent (worktree)** | Implementer en isolert oppgave i egen worktree | Spawned via Task |
| **Code-reviewer** | Pre-merge-gate for Evolution-grade-kvalitet | Spawned før merge |

### Git-flyt (immutable)

```
Agent-worktree:
  1. git checkout -b feat/<scope>-<short>
  2. Implementer
  3. git commit (alltid inkluder Co-Authored-By)
  4. git push origin feat/<scope>-<short>
  5. Rapporter: "Agent N — [scope]: branch=..., commits=..., test-status=..."

PM-AI (etter rapport):
  6. Hent og review branch lokalt
  7. Spawn code-reviewer (separat agent) for second-opinion
  8. Adresser code-review-feedback (evt spawn fix-agent)
  9. gh pr create
  10. gh pr merge --squash --auto
  11. cd /Users/tobiashaugen/Projects/Spillorama-system && git checkout main && git pull --rebase --autostash
  12. Gi Tobias admin-restart-linje (én linje, MED `cd` først)
```

Agenten skal ALDRI:
- Kjøre `gh pr create` — PM eier PR-opprettelse
- Kjøre `git merge` eller `git push origin main` — PM eier merge
- Lukke Linear-issue uten merge-til-main-bevis

### Spawn parallelle agenter med isolation: worktree

For å unngå at parallelle agenter klobbrer hverandres filer, bruk Task-tool med `isolation: worktree`:

```
Task tool:
  description: "Agent N — kort scope"
  prompt: "Du er Agent N. Branch: feat/<scope>. Worktree-isolasjon. Du skal: ..."
  subagent_type: claude-opus-4-7
  isolation: worktree
```

Hvert agent får sin egen worktree under `.claude/worktrees/agent-<uuid>/`. Endringer er isolert til merge.

### Done-policy gates (BIN-534)

Ingen Linear-issue lukkes uten:

1. **Commit-SHA merget til `main`** (ikke bare på feature-branch)
2. **`file:line`-bevis** i ny struktur (`apps/backend/...`, `packages/...`, etc.)
3. **Test grønt i CI** (lenke eller bekreftelse)

Når en agent rapporterer "ferdig":
- Verifiser commit er på main (sjekk `git log main --grep`)
- Verifiser file:line peker til faktisk endring
- Verifiser test eksisterer og er grønn

Hvis ett av kravene mangler: re-åpne issue, ikke lukk.

### Auto-pull etter merge (Tobias 2026-05-08)

Etter HVER `gh pr merge`:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && \
  git checkout main 2>&1 && \
  git pull --rebase --autostash origin main 2>&1 | tail -5
```

NB: PM må evt. detach sin egen worktree HEAD først hvis den blokkerer Tobias' main-checkout (`git checkout --detach` i worktree).

### Tobias-kommando etter merge (én linje, alltid med `cd`)

ALDRI gi Tobias en multi-step prosedyre. Etter hver merge: gi denne linjen så han kan kopier-lim én gang:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && VITE_DEV_BACKEND_URL=http://localhost:4000 npm --prefix apps/admin-web run dev
```

`cd` foran er kritisk — Tobias er ofte i `~` etter terminal-restart. Hot-reload tar resten (backend `tsx watch` + Vite HMR).

### Code-reviewer som pre-merge-gate

For pilot-blokkere eller arkitektur-endringer: spawn en code-reviewer-agent FØR `gh pr merge`. Code-reviewer leser:

- Branch-diff (`git diff main...feat/<scope>`)
- Test-resultater
- Tilhørende ADR-er
- Live-room-mandat (`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`)

Output: GO / NO-GO + spesifikke feilbeskrivelser. Ved NO-GO: spawn fix-agent, ikke merge.

## Immutable beslutninger

### Tobias touch-er ALDRI git lokalt

PM eier alt. Hvis Tobias spør "har du siste kode?" → svar med pull-status, ikke instrukser.

Hvis Tobias havnet på en feature-branch i sin terminal: PM kjører `git checkout main && git pull` på vegne av ham — uten å spørre.

### Agent-rapport-format

Når en agent er ferdig, rapporten skal være:

```
Agent N — [scope]:
- Branch: feat/<scope>-<short>
- Commits: <sha-1>, <sha-2>, ...
- Filer endret: N
- Tester: <pass/fail/skip count>
- Avvik: <hvis noe utenfor scope>
- Ready for PR: ja/nei
```

PM bruker denne til Linear-update + PR-body.

### Isolation: worktree er default for parallelle agenter

Aldri spawn 2+ agenter på samme branch eller uten worktree-isolering. Konflikter er garantert.

### `gh pr merge --squash --auto` er standard merge

- `--squash`: én commit per PR i main-historikken
- `--auto`: merger så snart CI er grønt (ikke noen mid-CI-merge)
- Aldri `--merge` (lager merge-commits som forurenser linjær historikk)
- Aldri `--rebase` (omskriver SHA-er som agenter hadde rapportert)

### Linear MCP for issue-tracking

Bruk `mcp__55fb...__save_issue` for å opprette Linear-issues. For parent-issues (R-mandat etc.) referér i description med `parent BIN-810`. PM kan opprette issues på vegne av agentene.

### BACKLOG.md som strategisk oversikt parallelt med Linear

Repo-roten har `BACKLOG.md` som menneske-lesbar oversikt over hva som er gjort/jobber/kommer. Linear er issue-tracker; BACKLOG er bredere kontekst.

PM oppdaterer BACKLOG.md når større initiativer endrer status (start/ferdig/blokk).

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| Agent åpner egen PR | Konflikt med PM-koordinering | Send melding: "Agent N — IKKE åpne PR. Pushed til `feat/...`. PM tar over." |
| Glemt `cd` foran Tobias-kommandoen | Tobias' kommando feiler i `~` | ALLTID `cd /Users/tobiashaugen/...` først |
| Lukker Linear-issue på branch-merge (ikke main) | False-Done — regulator-risiko | Verifiser merge-commit faktisk er på main |
| Spawn 2 agenter uten worktree | File-konflikter ved merge | `isolation: worktree` alltid |
| `gh pr merge --merge` (ikke squash) | Forurenser main-historikk | Bruk `--squash --auto` |
| Mid-CI-merge | Merger før tester grønne | `--auto` venter på CI |
| Glemmer auto-pull etter merge | Tobias tester gammel kode | Pull i hans repo etter HVER merge |
| Spawn-er code-reviewer for trivial fix | Over-engineering | Reviewer kun på pilot-blokkere/arkitektur |
| PM kjører destruktive git-kommandoer på Tobias' repo | Risiko for tap | Ingen `git reset --hard`, `git push --force` på main |

## Kanonisk referanse

- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_pm_pull_after_merge.md` — auto-pull-policy
- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_git_flow.md` — PM-sentralisert git-flyt
- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_done_policy.md` — done-policy for legacy-avkobling
- `docs/decisions/ADR-008-pm-centralized-git-flow.md` — vedtatt mandat
- `docs/decisions/ADR-009-done-policy-legacy-avkobling.md` — vedtatt mandat
- `docs/engineering/ENGINEERING_WORKFLOW.md` — full workflow-spec inkl. legacy-avkobling-policy
- `BACKLOG.md` — strategisk oversikt
- `docs/operations/PM_HANDOFF_*.md` — PM-handoffs (én per session)

## Når denne skill-en er aktiv

- Tobias gir oppgave → PM skal koordinere
- En agent rapporterer ferdig → trigger PR-flyt
- En PR har grønt CI → trigger merge-flyt + auto-pull + Tobias-kommando
- Ny issue oppstår → opprett i Linear via MCP
- Verifiser at en lukket Linear-issue oppfyller done-policy
- Spawn parallelle agenter for en bølge (R-mandat, pilot-prep)
- Code-reviewer-gate før kritisk merge
- Tobias spør om status — gi pull-status, ikke instrukser
- BACKLOG.md trenger oppdatering etter større initiativ
- Konflikt-håndtering når agent-branches kolliderer
