---
name: pm-orchestration-pattern
description: When the user/agent acts as PM-AI orchestrating parallel agents on the Spillorama bingo platform. Also use when they mention PM-orchestration, spawn agent, PR-first, done-policy, file:line, auto-pull, BACKLOG.md, gh pr merge --squash --auto, isolation worktree, Linear MCP, code-reviewer gate, "Agent N —", parallell agent-bølge, hot-reload, admin-restart-linje, dev:nuke, pm-push-control, cascade-rebase, auto-rebase-on-merge, scope-check, knowledge-protocol-checkbox, bug-resurrection, branch protection, CODEOWNERS, required reviews, access approval matrix, emergency merge. Defines the PM-centralized git flow, done-policy gates, auto-pull-after-merge protocol, access/approval checks, and parallel-agent spawn patterns. Make sure to use this skill whenever someone takes on a PM role for this project even if they don't explicitly ask for it — the cost of getting orchestration wrong is lost work, broken main, false-Done in regulator-facing docs, or unsafe merge controls.
metadata:
  version: 1.7.0
  project: spillorama
---

<!-- scope: BACKLOG.md, docs/operations/PM_HANDOFF_*.md, docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md, docs/engineering/PM_*.md, docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md, docs/engineering/AGENT_TASK_CONTRACT.md, scripts/agent-onboarding.sh, scripts/pm-onboarding.sh, scripts/pm-checkpoint.sh, scripts/pm-knowledge-continuity.mjs, scripts/purchase-open-forensics.sh, scripts/dev/observability-snapshot.mjs, scripts/generate-context-pack.sh, scripts/generate-agent-contract.sh, .github/workflows/pm-*.yml, .github/workflows/*gate*.yml, .github/workflows/bug-resurrection-check.yml -->

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
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:nuke
```

`cd` foran er kritisk — Tobias er ofte i `~` etter terminal-restart.

**`dev:nuke` (vedtatt 2026-05-11) er standard restart-kommando** — den dreper ALLE stale prosesser (port 4000-5175 + Docker), FLUSHALL Redis, canceler stale runder i Postgres, re-seeder via `--reset-state`, og starter ren stack (backend + admin-web + game-client + visual-harness) i ÉN kommando. Garantert clean state — ingen selective restart hvor en av lagene kan henge i stale state.

**Selective admin-restart (gammel kommando) er SUPERSEDED.** Bruk IKKE:
```bash
# IKKE BRUK — selective restart, lar backend/Docker være urørte
lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && npm --prefix apps/admin-web run dev
```
Den gir falsk trygghet hvis merge inkluderer endringer på flere lag.

### PM Push Control — multi-agent koordinering (Phase 2, 2026-05-13)

Når 5-10+ agenter pusher parallelt: bruk `scripts/pm-push-control.mjs` for visibility + konflikt-deteksjon:

```bash
# Når du spawner agent — registrer scope FØRST
node scripts/pm-push-control.mjs register <agent-id> <branch> <fil-glob-1> <fil-glob-2>

# Se hva som er aktivt nå
node scripts/pm-push-control.mjs list

# Sjekk konflikter (in-flight + åpne PR-er)
node scripts/pm-push-control.mjs conflicts

# Få topologisk-sortert merge-rekkefølge
node scripts/pm-push-control.mjs merge-order

# Compare deklarert scope vs ACTUAL diff
node scripts/pm-push-control.mjs diff <agent-id>

# Daemon-modus (poll hver 30s, Mac-notif på nye pushes)
node scripts/pm-push-control.mjs watch

# HTML-dashboard
bash scripts/generate-push-control-dashboard.sh --open --watch
```

Registry-fil: `.claude/active-agents.json` (commit-able). Etter agent-leveranse + PR: `node scripts/pm-push-control.mjs unregister <agent-id>`.

**Pre-spawn-sjekkliste:** før du spawner ny agent, kjør `list` + `conflicts` for å se om scope overlapper med pågående arbeid. Hvis overlapp er uunngåelig (eks. `AGENT_EXECUTION_LOG.md`), dokumenter i `conflictsAcknowledged`-feltet.

### Live-test forensics før implementation-agent

Når en live-test har stanget 2+ ganger, skal PM stoppe vanlig implementation-flow og lage forensic evidence pack før ny agent får kode-scope. Målet er å klassifisere root cause med DB/logg/Sentry/PostHog-data, ikke sende agenten inn med en antakelse.

For `purchase_open`-flyten er standardkommando:

```bash
npm run forensics:purchase-open -- --phase before-master
# Trigger master-action / kjøpsforsøk, vent 30 sek
npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id>
```

Evidence pack skal legges ved agent-prompten. Implementer-agenten må sitere konkrete rader/logglinjer fra rapporten når den forklarer root cause.

### Observability snapshot før/etter live-test

Når PM kjører live-test, GoH full-plan-run eller bug-repro med Sentry/PostHog
tilgjengelig, skal PM ta maskinlesbart snapshot før og etter testen:

```bash
npm run observability:snapshot -- --label before-<scope> --window-minutes=60
# Kjør testen/reproen
npm run observability:snapshot -- \
  --label after-<scope> \
  --window-minutes=60 \
  --compare docs/evidence/<...>/before-file.json
```

`scripts/dev/observability-snapshot.mjs` leser secrets fra
`~/.spillorama-secrets/sentry.env`, `~/.spillorama-secrets/posthog.env` og
eventuelt `~/.spillorama-secrets/postgres-readonly.env` uten å printe dem.
Hvis read-only DB-URL finnes, brukes den før admin/full-access URL. Rapporten
skriver JSON + Markdown under `docs/evidence/` og inkluderer:

- Sentry unresolved issues for `spillorama-backend` og `spillorama-frontend`
- Sentry new/increased issue comparison ved `--compare`
- PostHog event-counts for testvinduet og event-deltas ved `--compare`
- `/tmp/pilot-monitor.log` severity counts + P0/P1-linjer
- Lett Postgres status-snapshot (`pg_stat_activity`, scheduled games, plan-runs)

**Regel:** Hvis live-test har regressjon eller brukes som agent-evidence, skal
Sentry/PostHog-snapshot legges ved agent-contract. Ikke oppsummer "Sentry ren"
eller "PostHog så ok ut" muntlig uten filsti til rapport.

### Fact-bound Agent Task Contract (2026-05-15)

For high-risk implementation-agent skal PM generere prompt-kontrakt med:

```bash
npm run agent:contract -- \
  --agent "Agent A — <scope>" \
  --objective "<konkret mål>" \
  --files <path> \
  --evidence <forensic-report.md> \
  --risk P0 \
  --output /tmp/agent-contract-<scope>.md
```

Kontrakten er source of truth for agenten. Den inkluderer main-SHA, write-boundary,
evidence, relevante skills, context-pack, hard constraints, skill-doc-protokoll
og delivery-report krav.

**Regel:** PM skal ikke sende high-risk implementation-prompt som ren fritekst.
Hvis objective og evidence ikke henger sammen, skal agenten stoppe og melde
konflikt i stedet for å implementere en antakelse.

### Auto-rebase-on-merge (Phase 2)

`.github/workflows/auto-rebase-on-merge.yml` rebases automatisk overlappende åpne PR-er etter en merge. Forhindrer at parallelle PR-er ender i CONFLICTING-state.

**Zero-overlap invariant (2026-05-15):** Når ingen åpne PR-er overlapper
med merget PR, workflowen må skrive nøyaktig én linje til
`$GITHUB_OUTPUT`: `overlap_count=0`. Ikke bruk `grep -c ... || echo 0`
inne i command substitution; ved null matches kan det produsere både
`0` og fallback-`0`, som GitHub tolker som ugyldig output-format. For
tomlinje-filtrering i `bash -e -o pipefail`, bruk `sed '/^$/d'` heller
enn `grep -v '^$'`.

**Når PM må manuelt rebase:**
- Auto-rebase feiler pga genuine konflikt (logikk-konflikt, ikke bare tekstlig)
- PR var basert på en branch som ble force-pushed
- Cherry-pick av kun noen commits er nødvendig

**Cascade-rebase-mønster (vedtatt 2026-05-10):** Hvis du har kjede A → B → C der hver baserer på forrige:
- Aldri squash-merge alle samtidig — squash gir ny SHA → kjedede PR-er ender CONFLICTING
- Enten: rebase B mot main etter A merges, så C mot main etter B merges (sequential cascade)
- Eller: bruk combined PR fra start (cherry-pick alle commits til én branch fra main)

### Knowledge-protocol-checkbox (vedtatt 2026-05-13)

Hver PR som rører pilot-relatert kode MÅ ha utfylt checkbox-seksjon "Knowledge protocol" i PR-body. Håndheves av `.github/workflows/knowledge-protocol-gate.yml`.

Sjekklisten inkluderer:
- [ ] PITFALLS_LOG sjekket for relatert kategori
- [ ] AGENT_EXECUTION_LOG entry skrevet etter levering
- [ ] Hvis ny fallgruve oppdaget: lagt til i PITFALLS_LOG samme PR
- [ ] Knowledge-pekere inkludert i agent-prompt hvis aktuelt

### PM Knowledge Continuity v2 (vedtatt 2026-05-15)

PM skal ikke starte kodehandling, spawn av implementer-agent eller merge før disse tre validerer:

```bash
bash scripts/pm-checkpoint.sh --validate
bash scripts/pm-doc-absorption-gate.sh --validate
node scripts/pm-knowledge-continuity.mjs --validate
```

Hvis `pm-knowledge-continuity.mjs --validate` feiler, kjør full evidence-pack + self-test-flyt:

```bash
node scripts/pm-knowledge-continuity.mjs --generate-pack \
  --output /tmp/pm-knowledge-continuity-pack.md
node scripts/pm-knowledge-continuity.mjs --self-test-template \
  --pack /tmp/pm-knowledge-continuity-pack.md \
  --output /tmp/pm-knowledge-self-test.md
$EDITOR /tmp/pm-knowledge-self-test.md
node scripts/pm-knowledge-continuity.mjs --confirm-self-test \
  /tmp/pm-knowledge-self-test.md \
  --pack /tmp/pm-knowledge-continuity-pack.md
```

Hensikten er å bevise operativ kunnskapsparitet:
- Forrige PMs leveranser og uferdige arbeid.
- Åpne PR-er, røde workflows, branches og utrackede filer.
- P0/P1-risikoer, invariants, relevante skills og PITFALLS.
- Første handling og hvorfor den fortsetter i samme spor.

Dokumenter i repo er nødvendig, men ikke nok. PM må vise at konteksten er absorbert.

### Bug-resurrection-detector (vedtatt 2026-05-13)

`.husky/pre-commit-resurrection-check.sh` + `.github/workflows/bug-resurrection-check.yml` blokkerer commits som modifiserer kode i regioner som var bug-fixet innenfor siste 30 dager — med mindre commit-melding inneholder `[resurrection-acknowledged: <grunn>]`.

Adresserer "2 skritt frem 1 tilbake"-mønsteret. Hvis du som PM får denne blokkeringen på en agent-PR:
1. Verifiser at agenten har lest fix-historikken til regionen
2. Hvis intensjonell endring: send tilbake til agent med "legg til `[resurrection-acknowledged: <årsak>]` i commit-melding"
3. Hvis utilsiktet revert av fix: avvis PR, send tilbake med fix-historie

### Skill-freshness-gate (vedtatt 2026-05-13)

Hver PR sjekker om endrede filer er innenfor scope av en stale skill (90+ dager uten oppdatering + 50+ commits til scope). Hvis ja → informativ kommentar på PR (ikke blokkerende). PM kan velge å oppdatere skillen i samme PR med commit-message-tag `[skill-refreshed: <name>]`.

### Code-reviewer som pre-merge-gate

For pilot-blokkere eller arkitektur-endringer: spawn en code-reviewer-agent FØR `gh pr merge`. Code-reviewer leser:

- Branch-diff (`git diff main...feat/<scope>`)
- Test-resultater
- Tilhørende ADR-er
- Live-room-mandat (`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`)

Output: GO / NO-GO + spesifikke feilbeskrivelser. Ved NO-GO: spawn fix-agent, ikke merge.

### Access-/approval-matrise før branch-protection-endringer (2026-05-15)

Før PM endrer branch protection, required reviews, CODEOWNERS, bypass-labels
eller hotfix-autoritet, les `docs/operations/ACCESS_APPROVAL_MATRIX.md`.

Per 2026-05-15:
- `tobias363` er eneste reelle admin/approver.
- `tobias50` har write, men er ikke uavhengig reviewer.
- CODEOWNERS peker til `@tobias363` for kritiske paths.
- Required reviews er derfor bevisst AV til minst én uavhengig approver
  er onboardet og dokumentert.

High-risk PR-er (wallet, compliance, live-room engine, migrations,
GitHub Actions, branch protection, secrets, prod infra, Sentry/PostHog
alert policy) skal likevel ha synlig Tobias-godkjenning i PR-kommentar
eller review før merge.

Emergency merge/hotfix skal bruke labels:
- `approved-emergency-merge`
- `post-merge-review-required`
- `approved-pm-bypass` hvis PM-gate bypasses
- `approved-knowledge-bypass` hvis knowledge-protocol bypasses

PM-gate-workflows som validerer bypass-labels må hente labels live fra
GitHub API ved kjøring. Ikke stol på `context.payload.pull_request.labels`:
rerun av en workflow bruker opprinnelig event-payload og ser ikke labels som
ble lagt til etter første PR-event.

Ikke aktiver required reviews bare fordi det høres riktig ut. Først
auditer faktisk collaborator-liste, CODEOWNERS og reviewer-roster. Hvis
reviewer ikke finnes, er riktig kontroll å dokumentere risikoen og holde
reviews av til rosteren finnes.

## Immutable beslutninger

### Tobias touch-er ALDRI git lokalt

PM eier alt. Hvis Tobias spør "har du siste kode?" → svar med pull-status, ikke instrukser.

Hvis Tobias havnet på en feature-branch i sin terminal: PM kjører `git checkout main && git pull` på vegne av ham — uten å spørre.

### Agent-rapport-format

Når en agent er ferdig, rapporten skal følge [`docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`](../../../docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md). Minimum:

```
Agent Delivery Report — <scope>
- Branch + commits
- Context read before changes
- What changed
- Invariants preserved
- Tests and verification
- Knowledge updates: skill + PITFALLS_LOG + AGENT_EXECUTION_LOG
- Lessons learned
- Open risk / follow-up
- Ready for PR: ja/nei + reason
```

PM bruker denne til Linear-update + PR-body. Hvis rapporten mangler context read, invariants, tests eller knowledge updates, åpnes ikke PR før agenten har levert komplettering eller PM har gjort eksplisitt unntak i PR-body.

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
| Cascade-rebase: squash-merge kjedede PR-er sekvensielt uten å rebase mellom | PR B/C ender i `mergeable: CONFLICTING` | Rebase B mot main ETTER A merges. Eller combined PR fra start. |
| Selective admin-restart etter merge | Backend/Docker ikke restartet; falsk trygghet | Bruk `npm run dev:nuke` ALLTID (vedtatt 2026-05-11) |
| Spawne agent uten å registrere i pm-push-control | Ingen synlighet over parallelle scopes | `node scripts/pm-push-control.mjs register <id> <branch> <globs>` ved spawn |
| Hopper over knowledge-protocol-checkbox | CI blokkerer PR | Fyll alle checkbox i PR-body, eller send tilbake til agent |
| Ignorerer bug-resurrection-warning | Kan re-introdusere fixed bug | Verifiser fix-historie, evt. legg til `[resurrection-acknowledged: <grunn>]` |
| Ignorerer skill-freshness-warning på PR | Skill drifter videre fra koden | Vurder skill-refresh i samme PR med `[skill-refreshed: <name>]` |
| 5+ parallelle agenter uten worktree-isolasjon | File-revert-konflikter ved merge | ALLTID `isolation: worktree` for ≥ 2 parallelle agenter |
| Aktiverer required reviews uten approver-roster | PR-er låses eller "review" blir falsk uavhengighet | Følg `ACCESS_APPROVAL_MATRIX.md` §6-§7 før branch protection endres |
| PM har dokumentene, men ingen operativ self-test | Ny PM spør om allerede dokumentert kontekst eller pivot-er fra forrige spor | Kjør `pm-knowledge-continuity.mjs` evidence pack + self-test før første kodehandling |
| Required check har `pull_request.paths`-filter | Docs-only/auto-doc PR mangler check-context og branch protection blokkerer merge | Required PR-checks må alltid kjøre, eller ha always-run wrapper-jobb |
| Diff-basert PR-gate kjører på closed/merged PR | Post-merge `edited`-event gir `fatal: bad object <head_sha>` etter branch deletion | Job-level guard: `if: ${{ github.event.pull_request.state == 'open' }}` |
| PM spawner implementation-agent uten forensic evidence etter gjentatt live-test-feil | Agenten fikser symptom eller feil lag; Tobias opplever "2 dager uten at vi skjønner hvorfor" | Kjør relevant forensic-runner først og krev root-cause-sitering i agent-prompt |
| PM skriver high-risk agent-prompt fra hukommelse/fritekst | Agenten misforstår fakta, scope eller hva som er hypotese vs root cause | Generer `npm run agent:contract -- ...` og lim hele kontrakten inn i prompten |
| PM kjører live-test med Sentry/PostHog åpne i nettleser, men uten frozen snapshot | Neste PM/agent kan ikke vite hvilke issues/events som oppstod i samme testvindu | Kjør `npm run observability:snapshot` før/etter og bruk `--compare` |

## Kanonisk referanse

- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_dev_nuke_after_merge.md` — STANDARD restart-kommando (vedtatt 2026-05-11, supersederer pull-after-merge)
- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_git_flow.md` — PM-sentralisert git-flyt
- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_done_policy.md` — done-policy for legacy-avkobling
- `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/feedback_pm_verify_ci.md` — PM verifiser CI 5-10 min etter PR-åpning (vedtatt 2026-05-09)
- `docs/adr/0009-pm-centralized-git-flow.md` — vedtatt mandat
- `docs/adr/0010-done-policy-legacy-avkobling.md` — vedtatt mandat
- `docs/engineering/ENGINEERING_WORKFLOW.md` — full workflow-spec
- `docs/engineering/PM_PUSH_CONTROL.md` — multi-agent push-control (Phase 2)
- `docs/engineering/PM_ONBOARDING_PLAYBOOK.md` — playbook for hver PM-overgang (60-90 min onboarding)
- `docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md` — evidence pack + self-test før første kodehandling
- `docs/engineering/AGENT_TASK_CONTRACT.md` — fact-bound prompt-kontrakt før high-risk implementation-agent
- `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md` — agentleveranseformat før PR
- `docs/engineering/BUG_RESURRECTION_DETECTOR.md` — anti-regression-hook
- `docs/engineering/SKILL_FRESHNESS.md` — skill-refresh-cadence
- `docs/operations/ACCESS_APPROVAL_MATRIX.md` — access, approval, bypass-labels og required-review-kriterier
- `scripts/pm-push-control.mjs` — registry + watch + dashboard
- `scripts/pm-checkpoint.sh` — hard-block onboarding-gate for ny PM
- `scripts/pm-knowledge-continuity.mjs` — PM evidence pack + self-test-validering
- `scripts/purchase-open-forensics.sh` — purchase_open forensic evidence pack før implementation-agent
- `scripts/dev/observability-snapshot.mjs` — Sentry/PostHog/pilot-monitor/DB snapshot før/etter live-test
- `scripts/generate-agent-contract.sh` — genererer prompt-kontrakt med scope, evidence, skills (skill@version@SHA-lockfile fra v1.4.0), context-pack, §3a ripple analysis og doc-protokoll
- `scripts/verify-contract-freshness.mjs` — verifiser at skill-SHA-er i en lagret kontrakt matcher current HEAD før agent-spawn (Fase 2 — ADR-0024)
- `docs/evidence/README.md` — persistent evidence-storage konvensjon `docs/evidence/<contract-id>/` (Fase 2 — ADR-0024)
- `scripts/validate-delivery-report.mjs` — teknisk validering av Agent Delivery Report i PR-body, inkludert §5 cross-check mot diff (Fase 3 — ADR-0024)
- `.github/workflows/delivery-report-gate.yml` — CI-gate som blokkerer high-risk PR-er uten gyldig delivery-report
- `scripts/pm-knowledge-continuity.mjs` — Fase 3 P3-utvidet: per-spørsmål-heuristikk + generic-fluff-reject + `[self-test-bypass: ...]`-marker (55 tester)
- `docs/engineering/PM_SELF_TEST_HEURISTICS.md` — per-spørsmål-anker-tabell + kalibrerings-guide for self-test-validator
- `BACKLOG.md` — strategisk oversikt
- `docs/operations/PM_HANDOFF_*.md` — PM-handoffs (én per session)
- `.claude/active-agents.json` — registry over aktive agenter (commit-able)

## Når denne skill-en er aktiv

- Tobias gir oppgave → PM skal koordinere
- En agent rapporterer ferdig → trigger PR-flyt
- En PR har grønt CI → trigger merge-flyt + auto-pull + Tobias-kommando (`dev:nuke`)
- Ny issue oppstår → opprett i Linear via MCP
- Verifiser at en lukket Linear-issue oppfyller done-policy
- Spawn parallelle agenter for en bølge (R-mandat, pilot-prep, autonomy-wave)
- Code-reviewer-gate før kritisk merge
- Tobias spør om status — gi pull-status, ikke instrukser
- BACKLOG.md trenger oppdatering etter større initiativ
- Konflikt-håndtering når agent-branches kolliderer
- 5+ parallelle agenter → bruk `pm-push-control.mjs` for scope-deklarering og konflikt-deteksjon
- Cascade-rebase nødvendig når kjedede PR-er må mergees
- Auto-rebase feiler → manuell rebase nødvendig
- Bug-resurrection-warning på PR → verifiser fix-historie
- Branch protection / required reviews / CODEOWNERS / bypass-labels skal endres

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial — etablert PM-orchestration-mandate |
| 2026-05-13 | v1.1.0 — la til Phase-2-mekanismer fra autonomy-wave: pm-push-control, auto-rebase-on-merge, cascade-rebase-mønster, knowledge-protocol-checkbox, bug-resurrection-detector, skill-freshness-gate. Byttet til `dev:nuke` som standard restart-kommando (vedtatt 2026-05-11). |
| 2026-05-15 | v1.2.0 — la til access-/approval-matrise, required-review lock-kriterier, emergency-labels og fallgruven "required reviews uten approver-roster". |
| 2026-05-15 | v1.2.1 — dokumenterte zero-overlap invariant for `auto-rebase-on-merge.yml` etter post-merge output-format-feil. |
| 2026-05-15 | v1.2.2 — dokumenterte at PM-gate må hente bypass-labels live fra GitHub API, ikke stale PR-event-payload. |
| 2026-05-15 | v1.3.0 — la til PM Knowledge Continuity v2 evidence pack/self-test og Agent Delivery Report som PM-hardening. |
| 2026-05-15 | v1.3.1 — dokumenterte at required PR-checks ikke kan ha `pull_request.paths`-filter som gjør check-context missing. |
| 2026-05-15 | v1.3.2 — dokumenterte at diff-baserte PR-gates må skippe non-open PR-events for å unngå falske røde checks etter merge. |
| 2026-05-15 | v1.3.3 — la til live-test forensic evidence pack før implementation-agent, med `scripts/purchase-open-forensics.sh` som standard for purchase_open-feilen. |
| 2026-05-15 | v1.3.4 — la til fact-bound Agent Task Contract og `scripts/generate-agent-contract.sh` for å hindre agent-misforståelser i high-risk arbeid. |
| 2026-05-16 | v1.5.0 — Fase 3 Punkt 1 etter ADR-0024: teknisk validering av Agent Delivery Report via ny `scripts/validate-delivery-report.mjs` + `delivery-report-gate.yml`. Validatoren krever alle 8 H3-headere, cross-checker §5 "Knowledge updates"-claims mot diff, og krever §4 "Tests"/§8 "Ready"-format. Bypass via `[delivery-report-not-applicable: <begrunnelse>]` + label. 32 tester. PITFALLS §11.22 ny fallgruve. |
| 2026-05-16 | v1.5.1 — la til `scripts/dev/observability-snapshot.mjs` som standard før/etter live-test: Sentry, PostHog, pilot-monitor og read-only DB snapshots med `--compare`, slik at agent-evidence ikke baseres på muntlig observability-status. |
| 2026-05-16 | v1.6.0 — Fase 3 Punkt 3 etter ADR-0024: per-spørsmål-heuristikk i `scripts/pm-knowledge-continuity.mjs` self-test-validator. Hver av de 12 spørsmålene har konkret anker-regex (PM_HANDOFF-filnavn, PR-numre, ADR-NNNN, §X.Y, skill-navn osv.). Generic-fluff-mønstre rejecteres. Bypass via `[self-test-bypass: <begrunnelse min 20 tegn>]`. 55 tester. Etablerer meta-pattern "paraphrase-validation med per-felt-anker" — nå brukt i 3 gates (Tier-3 fragility + delivery-report §5 + self-test). Fremtidig konsolidering til `scripts/lib/paraphrase-heuristics.mjs` spores som follow-up i ADR-0024. PITFALLS §11.23 ny fallgruve. Ny doc: `docs/engineering/PM_SELF_TEST_HEURISTICS.md`. |
| 2026-05-16 | v1.7.0 — Fase A av ADR-0024 layered defense: pre-spawn agent-contract-gate som lukker hullet ingen post-delivery-gates fanger. Ny `.github/workflows/agent-contract-gate.yml` (shadow-mode 2026-05-16 → 2026-05-23, hard-fail tidligst 2026-05-24) validerer at high-risk PR-er har `Contract-ID:` + `Contract-path:` (eller `[agent-contract-not-applicable: ...]` bypass). Ny `scripts/validate-pr-agent-contract.mjs` (29 tester) + `scripts/pm-spawn-agent.sh` (lokal wrapper). Ny `scripts/bypass-telemetry.mjs` (26 tester) + ukentlig cron som åpner GH-issue når ADR-0024 konsolideringskriterier treffes. PITFALLS §11.25 ny fallgruve. Layered defense eksplisitt dokumentert i ADR-0024 (ikke duplikat av eksisterende gates). |
